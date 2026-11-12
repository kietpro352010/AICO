import * as fs from "node:fs";
import * as path from "node:path";
import {
  CanonicalPathFs,
  DEFAULT_CANONICAL_PATH_FS,
  normalizePathForComparison,
  normalizeSegmentWin32Artifacts,
  resolveCanonicalFilesystemPath
} from "../db/migration-runner.js";

const SAFE_SINGLE_SEGMENT_RE = /^[a-zA-Z0-9._-]+$/;

function assertNoNullByte(value: string): void {
  if (value.includes("\0") || /%00/i.test(value)) {
    throw new Error("WORKSPACE_PATH_SECURITY_VIOLATION: Path contains null byte injection");
  }
}

export function assertValidSingleSegment(segment: string, label: string): string {
  if (typeof segment !== "string" || segment.length === 0) {
    throw new Error(`WORKSPACE_PATH_SECURITY_VIOLATION: Path traversal denied: empty ${label}`);
  }
  assertNoNullByte(segment);
  if (
    segment === "." ||
    segment === ".." ||
    segment.includes("/") ||
    segment.includes("\\") ||
    segment.includes(":") ||
    !SAFE_SINGLE_SEGMENT_RE.test(segment) ||
    normalizeSegmentWin32Artifacts(segment, false) !== segment
  ) {
    throw new Error(
      `WORKSPACE_PATH_SECURITY_VIOLATION: Path traversal denied: invalid ${label} '${segment}'`
    );
  }
  return segment;
}

export function isPathWithinBoundary(candidatePath: string, boundaryRoot: string): boolean {
  const normCandidate = normalizePathForComparison(path.resolve(candidatePath)).replace(/\/+$/, "");
  const normRoot = normalizePathForComparison(path.resolve(boundaryRoot)).replace(/\/+$/, "");
  return normCandidate === normRoot || normCandidate.startsWith(normRoot + "/");
}

function assertLexicalRelativePathSafe(relativePath: string): void {
  if (typeof relativePath !== "string") {
    throw new Error("WORKSPACE_PATH_SECURITY_VIOLATION: Path traversal denied: path must be a string");
  }
  assertNoNullByte(relativePath);

  if (
    relativePath.startsWith("\\\\") ||
    relativePath.startsWith("//") ||
    relativePath.startsWith("\\??\\") ||
    /^[a-zA-Z]:/.test(relativePath) ||
    path.isAbsolute(relativePath)
  ) {
    throw new Error(
      "WORKSPACE_PATH_SECURITY_VIOLATION: Path traversal denied: Absolute or drive-qualified or UNC paths are forbidden"
    );
  }

  const rawSegments = relativePath.replace(/\\/g, "/").split("/");
  for (const seg of rawSegments) {
    if (seg.length === 0) continue;
    if (seg.includes(":")) {
      throw new Error(
        "WORKSPACE_PATH_SECURITY_VIOLATION: Path traversal denied: alternate data streams and colons are forbidden"
      );
    }
    const winStripped = seg.replace(/[. ]+$/, "");
    if (seg === ".." || winStripped === ".." || /^\.{2,}[. ]*$/.test(seg)) {
      throw new Error("WORKSPACE_PATH_SECURITY_VIOLATION: Path traversal denied: traversal segment '..' detected");
    }
    if (seg !== "." && /[. ]$/.test(seg)) {
      throw new Error(
        "WORKSPACE_PATH_SECURITY_VIOLATION: Path traversal denied: trailing dots or spaces in path segment are forbidden"
      );
    }
  }
}

export interface ContainedWorkspacePathOptions {
  baseDir: string;
  subfolder?: string;
  agentId?: string;
  relativePath: string;
  ensureRootExists?: boolean;
  fsOps?: CanonicalPathFs;
}

/**
 * Resolves a path and strictly verifies lexical and canonical filesystem containment
 * within `<baseDir>/<subfolder>` or `<baseDir>/<subfolder>/<agentId>`, blocking
 * directory traversal, Win32 dot/space/ADS aliases, junctions, and dangling symlinks.
 */
export function resolveContainedWorkspacePath(options: ContainedWorkspacePathOptions): {
  resolvedPath: string;
  canonicalPath: string;
  boundaryRootRealPath: string;
} {
  const fsOps = options.fsOps ?? DEFAULT_CANONICAL_PATH_FS;
  const subfolder = assertValidSingleSegment(options.subfolder ?? "workspaces", "workspace folder");
  const ensureRootExists = options.ensureRootExists ?? true;

  assertLexicalRelativePathSafe(options.relativePath);

  const baseDirAbs = path.resolve(options.baseDir);
  if (ensureRootExists && !fs.existsSync(baseDirAbs)) {
    fs.mkdirSync(baseDirAbs, { recursive: true });
  }
  const baseDirRealPath = resolveCanonicalFilesystemPath(baseDirAbs, fsOps);

  const folderRawPath = path.join(baseDirRealPath, subfolder);
  if (ensureRootExists && !fs.existsSync(folderRawPath)) {
    fs.mkdirSync(folderRawPath, { recursive: true });
  }
  const folderRootRealPath = resolveCanonicalFilesystemPath(folderRawPath, fsOps);
  if (
    !isPathWithinBoundary(folderRootRealPath, baseDirRealPath) ||
    normalizePathForComparison(folderRootRealPath) !== normalizePathForComparison(folderRawPath)
  ) {
    throw new Error(
      `WORKSPACE_PATH_SECURITY_VIOLATION: Symlink or junction escape denied on folder '${subfolder}'`
    );
  }

  let boundaryRootRealPath = folderRootRealPath;
  let scopeLabel = subfolder;

  if (options.agentId !== undefined) {
    const safeAgentId = assertValidSingleSegment(options.agentId, "agent identifier");
    scopeLabel = `${subfolder}/${safeAgentId}`;
    const agentRawPath = path.join(folderRootRealPath, safeAgentId);
    if (ensureRootExists && !fs.existsSync(agentRawPath)) {
      fs.mkdirSync(agentRawPath, { recursive: true });
    }
    const agentCanonical = resolveCanonicalFilesystemPath(agentRawPath, fsOps);
    if (
      !isPathWithinBoundary(agentCanonical, folderRootRealPath) ||
      normalizePathForComparison(agentCanonical) !== normalizePathForComparison(agentRawPath)
    ) {
      throw new Error(
        `WORKSPACE_PATH_SECURITY_VIOLATION: Symlink or junction escape denied on agent workspace '${safeAgentId}'`
      );
    }
    boundaryRootRealPath = agentCanonical;
  }

  const candidatePath = path.resolve(boundaryRootRealPath, options.relativePath || ".");
  if (!isPathWithinBoundary(candidatePath, boundaryRootRealPath)) {
    throw new Error(
      `WORKSPACE_PATH_SECURITY_VIOLATION: Path traversal denied: path escapes ${scopeLabel} boundary`
    );
  }

  const canonicalCandidate = resolveCanonicalFilesystemPath(candidatePath, fsOps);
  if (!isPathWithinBoundary(canonicalCandidate, boundaryRootRealPath)) {
    throw new Error(
      `WORKSPACE_PATH_SECURITY_VIOLATION: Symlink escape denied: target points outside ${scopeLabel} boundary`
    );
  }

  return {
    resolvedPath: candidatePath,
    canonicalPath: canonicalCandidate,
    boundaryRootRealPath
  };
}

/**
 * Validates canonical containment against an already-known absolute workspace root directory.
 */
export function resolveContainedAbsoluteRootPath(params: {
  workspaceRoot: string;
  relativePath: string;
  fsOps?: CanonicalPathFs;
}): { safePath: string; boundaryRootRealPath: string } {
  const fsOps = params.fsOps ?? DEFAULT_CANONICAL_PATH_FS;
  assertLexicalRelativePathSafe(params.relativePath);

  const rootResolved = path.resolve(params.workspaceRoot);
  const boundaryRootRealPath = resolveCanonicalFilesystemPath(rootResolved, fsOps);

  const candidatePath = path.resolve(boundaryRootRealPath, params.relativePath || ".");
  if (!isPathWithinBoundary(candidatePath, boundaryRootRealPath)) {
    throw new Error("WORKSPACE_PATH_SECURITY_VIOLATION: Path traversal denied: target escapes workspace root");
  }

  const canonicalCandidate = resolveCanonicalFilesystemPath(candidatePath, fsOps);
  if (!isPathWithinBoundary(canonicalCandidate, boundaryRootRealPath)) {
    throw new Error("WORKSPACE_PATH_SECURITY_VIOLATION: Symlink escape denied: target points outside workspace root");
  }

  return {
    safePath: canonicalCandidate,
    boundaryRootRealPath
  };
}
