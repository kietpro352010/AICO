import * as fs from "node:fs";
import * as path from "node:path";
import * as crypto from "node:crypto";
import { ConnectionManager } from "../db/connection-manager.js";
import { resolveCanonicalFilesystemPath } from "../db/migration-runner.js";
import {
  assertAuthenticatedContext,
  hasPrincipalScope,
  isFounderHuman,
  type PrincipalContext
} from "../security/context-store.js";
import {
  assertValidSingleSegment,
  isPathWithinBoundary,
  resolveContainedWorkspacePath
} from "../security/path-containment.js";
import { normalizeBoundedLimit } from "../contracts/query-limits.js";

export interface WorkspaceActivityView {
  activity_id: number;
  request_id: string;
  agent_id: string;
  workspace_id: string;
  action_type: string;
  target_path: string;
  status: string;
  bytes_count: number;
  recorded_at: string;
}

export type WorkspaceAccessMode = "read" | "write" | "audit";

export type WorkspaceIoStage =
  | "pre_parent_dir"
  | "pre_write_open"
  | "pre_write_commit"
  | "post_write_verify"
  | "pre_read_open"
  | "post_read_verify";

export interface WorkspaceArtifactServiceOptions {
  onBeforeIoStage?: (stage: WorkspaceIoStage, targetPath: string) => void;
}

export class WorkspaceArtifactService {
  private baseDir: string;
  private connManager?: ConnectionManager;
  private onBeforeIoStage?: (stage: WorkspaceIoStage, targetPath: string) => void;

  constructor(
    baseDirOrConn?: string | ConnectionManager,
    connManager?: ConnectionManager,
    options?: WorkspaceArtifactServiceOptions
  ) {
    if (typeof baseDirOrConn === "string") {
      this.baseDir = path.resolve(baseDirOrConn);
      this.connManager = connManager;
    } else {
      this.baseDir = path.resolve("D:/AI-COMPANY");
      this.connManager = baseDirOrConn;
    }
    this.onBeforeIoStage = options?.onBeforeIoStage;
  }

  public validateAndResolveSafePath(
    relativePath: string,
    subfolder = "workspaces",
    targetAgentId?: string
  ): string {
    if (!relativePath || typeof relativePath !== "string") {
      throw new Error("WORKSPACE_PATH_SECURITY_VIOLATION: Invalid path argument");
    }

    return resolveContainedWorkspacePath({
      baseDir: this.baseDir,
      subfolder,
      agentId: targetAgentId,
      relativePath,
      ensureRootExists: true
    }).canonicalPath;
  }

  private resolveScopedWorkspaceTarget(params: {
    relativePath: string;
    subfolder: string;
    ctx: PrincipalContext;
    targetAgentId?: string;
    ensureRootExists?: boolean;
  }): { resolvedPath: string; canonicalPath: string; boundaryRootRealPath: string; effectiveAgentId?: string } {
    let effectiveAgentId = params.targetAgentId;
    if (!effectiveAgentId && params.ctx.principalType === "agent") {
      if (!params.ctx.agentId) {
        throw new Error(
          `PERMISSION_DENIED: Principal '${params.ctx.principalId}' has no agent workspace`
        );
      }
      effectiveAgentId = params.ctx.agentId;
    } else if (!effectiveAgentId && !isFounderHuman(params.ctx)) {
      throw new Error(
        `PERMISSION_DENIED: Target agent workspace identifier is required for principal '${params.ctx.principalId}'`
      );
    }

    const contained = resolveContainedWorkspacePath({
      baseDir: this.baseDir,
      subfolder: params.subfolder,
      agentId: effectiveAgentId,
      relativePath: params.relativePath,
      ensureRootExists: params.ensureRootExists ?? true
    });

    return {
      ...contained,
      effectiveAgentId
    };
  }

  private assertCanonicalDirectoryChain(
    boundaryRootRealPath: string,
    targetDir: string,
    createMissing: boolean,
    missingErrorMessage?: string
  ): string {
    let rootLstat: fs.Stats;
    try {
      rootLstat = fs.lstatSync(boundaryRootRealPath);
    } catch {
      throw new Error(
        "WORKSPACE_PATH_SECURITY_VIOLATION: Workspace boundary root missing or inaccessible"
      );
    }
    if (rootLstat.isSymbolicLink() || !rootLstat.isDirectory()) {
      throw new Error(
        "WORKSPACE_PATH_SECURITY_VIOLATION: Workspace boundary root is a symlink/junction or non-directory"
      );
    }
    const rootCanon = resolveCanonicalFilesystemPath(boundaryRootRealPath);
    if (!isPathWithinBoundary(rootCanon, boundaryRootRealPath)) {
      throw new Error(
        "WORKSPACE_PATH_SECURITY_VIOLATION: Workspace boundary root escaped canonical path"
      );
    }

    if (!isPathWithinBoundary(targetDir, boundaryRootRealPath)) {
      throw new Error(
        "WORKSPACE_PATH_SECURITY_VIOLATION: Target parent directory escapes workspace boundary"
      );
    }

    const relDir = path.relative(boundaryRootRealPath, targetDir);
    if (!relDir || relDir === ".") {
      return boundaryRootRealPath;
    }

    const segments = relDir.split(/[/\\]+/).filter((s) => s.length > 0);
    let currentDir = boundaryRootRealPath;

    for (const seg of segments) {
      if (seg === "." || seg === "..") {
        throw new Error(
          "WORKSPACE_PATH_SECURITY_VIOLATION: Traversal segment forbidden in directory chain"
        );
      }
      currentDir = path.join(currentDir, seg);

      let segLstat: fs.Stats | null = null;
      try {
        segLstat = fs.lstatSync(currentDir);
      } catch (err: any) {
        if (err?.code !== "ENOENT") throw err;
      }

      if (!segLstat) {
        if (!createMissing) {
          throw new Error(
            missingErrorMessage || "RESOURCE_NOT_FOUND: Parent directory missing for target"
          );
        }
        try {
          fs.mkdirSync(currentDir);
        } catch (err: any) {
          if (err?.code !== "EEXIST") throw err;
        }
        segLstat = fs.lstatSync(currentDir);
      }

      if (segLstat.isSymbolicLink() || !segLstat.isDirectory()) {
        throw new Error(
          `WORKSPACE_PATH_SECURITY_VIOLATION: Symlink or junction directory detected at '${seg}'`
        );
      }

      const canonDir = resolveCanonicalFilesystemPath(currentDir);
      if (!isPathWithinBoundary(canonDir, boundaryRootRealPath)) {
        throw new Error(
          `WORKSPACE_PATH_SECURITY_VIOLATION: Canonical directory escape denied at '${seg}'`
        );
      }
      currentDir = canonDir;
    }

    return currentDir;
  }

  private assertContainedLeafTarget(params: {
    boundaryRootRealPath: string;
    canonicalParentDir: string;
    fullPath: string;
    relativePathLabel: string;
    allowMissing: boolean;
    allowExisting: boolean;
  }): fs.Stats | null {
    const verifiedParent = this.assertCanonicalDirectoryChain(
      params.boundaryRootRealPath,
      params.canonicalParentDir,
      false,
      `RESOURCE_NOT_FOUND: Artifact not found: ${params.relativePathLabel}`
    );

    const expectedPath = path.join(verifiedParent, path.basename(params.fullPath));
    let leafLstat: fs.Stats | null = null;
    try {
      leafLstat = fs.lstatSync(expectedPath);
    } catch (err: any) {
      if (err?.code !== "ENOENT") throw err;
    }

    if (leafLstat) {
      if (leafLstat.isSymbolicLink()) {
        throw new Error(
          `WORKSPACE_PATH_SECURITY_VIOLATION: Symlink or junction target denied for '${params.relativePathLabel}'`
        );
      }
      if (leafLstat.isDirectory()) {
        throw new Error(
          `WORKSPACE_PATH_SECURITY_VIOLATION: Target '${params.relativePathLabel}' is a directory`
        );
      }
      const canonLeaf = resolveCanonicalFilesystemPath(expectedPath);
      if (!isPathWithinBoundary(canonLeaf, params.boundaryRootRealPath)) {
        throw new Error(
          `WORKSPACE_PATH_SECURITY_VIOLATION: Symlink escape denied: target '${params.relativePathLabel}' points outside workspace`
        );
      }
      if (!params.allowExisting) {
        throw new Error(
          `FILE_ALREADY_EXISTS: Cannot overwrite existing file '${params.relativePathLabel}' without overwrite=true`
        );
      }
    } else if (!params.allowMissing) {
      throw new Error(`RESOURCE_NOT_FOUND: Artifact not found: ${params.relativePathLabel}`);
    }

    return leafLstat;
  }

  private writeFileAtomically(params: {
    fullPath: string;
    boundaryRootRealPath: string;
    content: string | Buffer;
    overwrite: boolean;
    relativePathLabel: string;
  }): { bytesWritten: number; checksum_sha256: string; verifiedPath: string } {
    const strContent =
      typeof params.content === "string" ? params.content : params.content.toString("utf8");
    const bufferContent = Buffer.isBuffer(params.content)
      ? params.content
      : Buffer.from(params.content, "utf8");
    const checksum = crypto.createHash("sha256").update(strContent).digest("hex");

    this.onBeforeIoStage?.("pre_parent_dir", params.fullPath);

    const canonicalParentDir = this.assertCanonicalDirectoryChain(
      params.boundaryRootRealPath,
      path.dirname(params.fullPath),
      true
    );
    const targetFileName = path.basename(params.fullPath);
    const verifiedTargetPath = path.join(canonicalParentDir, targetFileName);

    this.assertContainedLeafTarget({
      boundaryRootRealPath: params.boundaryRootRealPath,
      canonicalParentDir,
      fullPath: verifiedTargetPath,
      relativePathLabel: params.relativePathLabel,
      allowMissing: true,
      allowExisting: params.overwrite
    });

    const noFollowFlag = fs.constants.O_NOFOLLOW ?? 0;

    if (!params.overwrite) {
      this.onBeforeIoStage?.("pre_write_open", verifiedTargetPath);
      this.onBeforeIoStage?.("pre_write_commit", verifiedTargetPath);

      const recheckedParent = this.assertCanonicalDirectoryChain(
        params.boundaryRootRealPath,
        canonicalParentDir,
        false
      );
      const finalTargetPath = path.join(recheckedParent, targetFileName);
      this.assertContainedLeafTarget({
        boundaryRootRealPath: params.boundaryRootRealPath,
        canonicalParentDir: recheckedParent,
        fullPath: finalTargetPath,
        relativePathLabel: params.relativePathLabel,
        allowMissing: true,
        allowExisting: false
      });

      let fd: number | null = null;
      try {
        fd = fs.openSync(
          finalTargetPath,
          fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | noFollowFlag,
          0o600
        );
      } catch (err: any) {
        if (err?.code === "EEXIST") {
          let existingLstat: fs.Stats | null = null;
          try {
            existingLstat = fs.lstatSync(finalTargetPath);
          } catch {}
          if (existingLstat?.isSymbolicLink()) {
            throw new Error(
              `WORKSPACE_PATH_SECURITY_VIOLATION: Symlink or junction target denied for '${params.relativePathLabel}'`
            );
          }
          throw new Error(
            `FILE_ALREADY_EXISTS: Cannot overwrite existing file '${params.relativePathLabel}' without overwrite=true`
          );
        }
        if (err?.code === "ELOOP") {
          throw new Error(
            `WORKSPACE_PATH_SECURITY_VIOLATION: Symlink follow denied on write '${params.relativePathLabel}'`
          );
        }
        throw err;
      }

      try {
        const fstat = fs.fstatSync(fd);
        const lstat = fs.lstatSync(finalTargetPath);
        if (
          lstat.isSymbolicLink() ||
          (fstat.ino && lstat.ino && fstat.ino !== lstat.ino) ||
          (fstat.dev && lstat.dev && fstat.dev !== lstat.dev)
        ) {
          throw new Error(
            `WORKSPACE_PATH_SECURITY_VIOLATION: TOCTOU mismatch detected after exclusive open on '${params.relativePathLabel}'`
          );
        }

        let offset = 0;
        while (offset < bufferContent.length) {
          offset += fs.writeSync(fd, bufferContent, offset, bufferContent.length - offset);
        }
        fs.fsyncSync(fd);
      } finally {
        fs.closeSync(fd);
      }

      this.onBeforeIoStage?.("post_write_verify", finalTargetPath);
      const postStat = this.assertContainedLeafTarget({
        boundaryRootRealPath: params.boundaryRootRealPath,
        canonicalParentDir: recheckedParent,
        fullPath: finalTargetPath,
        relativePathLabel: params.relativePathLabel,
        allowMissing: false,
        allowExisting: true
      });

      return {
        bytesWritten: postStat ? postStat.size : fs.lstatSync(finalTargetPath).size,
        checksum_sha256: checksum,
        verifiedPath: finalTargetPath
      };
    }

    const tempPath =
      verifiedTargetPath + `.tmp.${Date.now()}.${crypto.randomBytes(6).toString("hex")}`;
    let tempFd: number | null = null;

    try {
      this.onBeforeIoStage?.("pre_write_open", verifiedTargetPath);
      const openParent = this.assertCanonicalDirectoryChain(
        params.boundaryRootRealPath,
        canonicalParentDir,
        false
      );
      const safeTempPath = path.join(openParent, path.basename(tempPath));

      tempFd = fs.openSync(
        safeTempPath,
        fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | noFollowFlag,
        0o600
      );
      let offset = 0;
      while (offset < bufferContent.length) {
        offset += fs.writeSync(tempFd, bufferContent, offset, bufferContent.length - offset);
      }
      fs.fsyncSync(tempFd);
      fs.closeSync(tempFd);
      tempFd = null;

      this.onBeforeIoStage?.("pre_write_commit", verifiedTargetPath);

      const commitParent = this.assertCanonicalDirectoryChain(
        params.boundaryRootRealPath,
        openParent,
        false
      );
      const finalTargetPath = path.join(commitParent, targetFileName);
      this.assertContainedLeafTarget({
        boundaryRootRealPath: params.boundaryRootRealPath,
        canonicalParentDir: commitParent,
        fullPath: safeTempPath,
        relativePathLabel: path.basename(safeTempPath),
        allowMissing: false,
        allowExisting: true
      });
      this.assertContainedLeafTarget({
        boundaryRootRealPath: params.boundaryRootRealPath,
        canonicalParentDir: commitParent,
        fullPath: finalTargetPath,
        relativePathLabel: params.relativePathLabel,
        allowMissing: true,
        allowExisting: true
      });

      fs.renameSync(safeTempPath, finalTargetPath);

      this.onBeforeIoStage?.("post_write_verify", finalTargetPath);
      this.assertCanonicalDirectoryChain(params.boundaryRootRealPath, commitParent, false);
      const postStat = this.assertContainedLeafTarget({
        boundaryRootRealPath: params.boundaryRootRealPath,
        canonicalParentDir: commitParent,
        fullPath: finalTargetPath,
        relativePathLabel: params.relativePathLabel,
        allowMissing: false,
        allowExisting: true
      });

      return {
        bytesWritten: postStat ? postStat.size : fs.lstatSync(finalTargetPath).size,
        checksum_sha256: checksum,
        verifiedPath: finalTargetPath
      };
    } finally {
      if (tempFd !== null) {
        try {
          fs.closeSync(tempFd);
        } catch {}
      }
      try {
        fs.lstatSync(tempPath);
        fs.unlinkSync(tempPath);
      } catch {}
    }
  }

  private logActivity(params: {
    requestId: string;
    agentId: string;
    workspaceId: string;
    actionType: "list" | "read" | "write" | "delete" | "share_artifact" | "git_sync";
    targetPath: string;
    status: "succeeded" | "denied" | "failed";
    bytesCount: number;
    errorCode?: string;
  }): void {
    if (!this.connManager) return;
    try {
      this.connManager.withWriteTransaction((db) => {
        db.prepare(`
          INSERT INTO agent_workspace_activities (
            request_id, agent_id, workspace_id, action_type, target_path,
            status, bytes_count, error_code, details_json
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, '{}')
        `).run(
          params.requestId,
          params.agentId,
          params.workspaceId,
          params.actionType,
          params.targetPath,
          params.status,
          params.bytesCount,
          params.errorCode || null
        );
      });
    } catch {
      // Activity logging best-effort without aborting core file op
    }
  }

  public authorizeWorkspaceAccess(
    ctx: PrincipalContext | undefined,
    targetAgentId: string | undefined,
    mode: WorkspaceAccessMode
  ): void {
    assertAuthenticatedContext(ctx, `workspace ${mode}`);

    if (isFounderHuman(ctx)) {
      return;
    }

    if (mode === "write") {
      if (ctx.principalType !== "agent" || !ctx.agentId) {
        throw new Error(
          `PERMISSION_DENIED: Workspace write access denied for non-agent principal '${ctx.principalId}'`
        );
      }
      if (targetAgentId && ctx.agentId !== targetAgentId) {
        throw new Error(
          `PERMISSION_DENIED: Cross-agent write access to workspace of agent '${targetAgentId}' denied for principal '${ctx.principalId}'`
        );
      }
      return;
    }

    if (mode === "audit") {
      if (hasPrincipalScope(ctx, "workspace:audit:read") || hasPrincipalScope(ctx, "workspace:audit")) {
        return;
      }
      throw new Error(
        `PERMISSION_DENIED: Workspace audit access denied for principal '${ctx.principalId}' (requires workspace:audit:read)`
      );
    }

    // mode === "read"
    if (ctx.principalType === "agent" && ctx.agentId && (!targetAgentId || ctx.agentId === targetAgentId)) {
      return;
    }
    if (hasPrincipalScope(ctx, "workspace:read:any")) {
      return;
    }

    throw new Error(
      `PERMISSION_DENIED: Access to workspace of agent '${targetAgentId ?? "root"}' denied for principal '${ctx.principalId}'`
    );
  }

  public checkOwnershipOrScope(
    ctx?: PrincipalContext,
    targetAgentId?: string,
    mode: WorkspaceAccessMode = "read"
  ): void {
    this.authorizeWorkspaceAccess(ctx, targetAgentId, mode);
  }

  public safeWriteArtifact(
    relativePath: string,
    content: string | Buffer,
    subfolder = "workspaces",
    overwrite = true,
    ctx?: PrincipalContext,
    targetAgentId?: string
  ): { bytesWritten: number; fullPath: string; checksum_sha256: string } {
    this.authorizeWorkspaceAccess(ctx, targetAgentId, "write");
    assertAuthenticatedContext(ctx, "safeWriteArtifact");
    if (!relativePath || typeof relativePath !== "string") {
      throw new Error("WORKSPACE_PATH_SECURITY_VIOLATION: Invalid path argument");
    }

    const { resolvedPath, boundaryRootRealPath, effectiveAgentId } = this.resolveScopedWorkspaceTarget({
      relativePath,
      subfolder,
      ctx,
      targetAgentId,
      ensureRootExists: true
    });
    const auditAgentId = effectiveAgentId || ctx.agentId || ctx.principalId;

    let writeRes: { bytesWritten: number; checksum_sha256: string; verifiedPath: string };
    try {
      writeRes = this.writeFileAtomically({
        fullPath: resolvedPath,
        boundaryRootRealPath,
        content,
        overwrite,
        relativePathLabel: relativePath
      });
    } catch (err: any) {
      const msg = String(err?.message || err);
      const isExists = msg.startsWith("FILE_ALREADY_EXISTS");
      const isSecurity = msg.includes("WORKSPACE_PATH_SECURITY_VIOLATION");
      this.logActivity({
        requestId: ctx.requestId || "req_fs",
        agentId: auditAgentId,
        workspaceId: `ws_${auditAgentId}`,
        actionType: "write",
        targetPath: relativePath,
        status: isExists || isSecurity ? "denied" : "failed",
        bytesCount: 0,
        errorCode: isExists
          ? "FILE_ALREADY_EXISTS"
          : isSecurity
            ? "WORKSPACE_PATH_SECURITY_VIOLATION"
            : "WRITE_FAILED"
      });
      throw err;
    }

    this.logActivity({
      requestId: ctx.requestId || "req_fs",
      agentId: auditAgentId,
      workspaceId: `ws_${auditAgentId}`,
      actionType: "write",
      targetPath: relativePath,
      status: "succeeded",
      bytesCount: writeRes.bytesWritten
    });

    return {
      bytesWritten: writeRes.bytesWritten,
      fullPath: writeRes.verifiedPath,
      checksum_sha256: writeRes.checksum_sha256
    };
  }

  public safeReadArtifact(
    relativePath: string,
    subfolder = "workspaces",
    ctx?: PrincipalContext,
    targetAgentId?: string
  ): string {
    this.authorizeWorkspaceAccess(ctx, targetAgentId, "read");
    assertAuthenticatedContext(ctx, "safeReadArtifact");
    if (!relativePath || typeof relativePath !== "string") {
      throw new Error("WORKSPACE_PATH_SECURITY_VIOLATION: Invalid path argument");
    }

    const { resolvedPath, boundaryRootRealPath, effectiveAgentId } = this.resolveScopedWorkspaceTarget({
      relativePath,
      subfolder,
      ctx,
      targetAgentId,
      ensureRootExists: true
    });
    const auditAgentId = effectiveAgentId || ctx.agentId || ctx.principalId;

    let verifiedTargetPath: string;
    let preReadLstat: fs.Stats;
    try {
      const canonicalParentDir = this.assertCanonicalDirectoryChain(
        boundaryRootRealPath,
        path.dirname(resolvedPath),
        false,
        `RESOURCE_NOT_FOUND: Artifact not found: ${relativePath}`
      );
      verifiedTargetPath = path.join(canonicalParentDir, path.basename(resolvedPath));
      const leaf = this.assertContainedLeafTarget({
        boundaryRootRealPath,
        canonicalParentDir,
        fullPath: verifiedTargetPath,
        relativePathLabel: relativePath,
        allowMissing: false,
        allowExisting: true
      });
      preReadLstat = leaf!;
    } catch (err: any) {
      const msg = String(err?.message || err);
      const isSecurity = msg.includes("WORKSPACE_PATH_SECURITY_VIOLATION");
      this.logActivity({
        requestId: ctx.requestId || "req_fs",
        agentId: auditAgentId,
        workspaceId: `ws_${auditAgentId}`,
        actionType: "read",
        targetPath: relativePath,
        status: isSecurity ? "denied" : "failed",
        bytesCount: 0,
        errorCode: isSecurity ? "WORKSPACE_PATH_SECURITY_VIOLATION" : "RESOURCE_NOT_FOUND"
      });
      throw err;
    }

    this.onBeforeIoStage?.("pre_read_open", verifiedTargetPath);

    const noFollowFlag = fs.constants.O_NOFOLLOW ?? 0;
    let fd: number;
    try {
      fd = fs.openSync(verifiedTargetPath, fs.constants.O_RDONLY | noFollowFlag);
    } catch (err: any) {
      if (err?.code === "ELOOP") {
        this.logActivity({
          requestId: ctx.requestId || "req_fs",
          agentId: auditAgentId,
          workspaceId: `ws_${auditAgentId}`,
          actionType: "read",
          targetPath: relativePath,
          status: "denied",
          bytesCount: 0,
          errorCode: "WORKSPACE_PATH_SECURITY_VIOLATION"
        });
        throw new Error(
          `WORKSPACE_PATH_SECURITY_VIOLATION: Symlink follow denied on read '${relativePath}'`
        );
      }
      this.logActivity({
        requestId: ctx.requestId || "req_fs",
        agentId: auditAgentId,
        workspaceId: `ws_${auditAgentId}`,
        actionType: "read",
        targetPath: relativePath,
        status: "failed",
        bytesCount: 0,
        errorCode: "RESOURCE_NOT_FOUND"
      });
      throw new Error(`RESOURCE_NOT_FOUND: Artifact not found: ${relativePath}`);
    }

    let content: string;
    try {
      const postOpenParent = this.assertCanonicalDirectoryChain(
        boundaryRootRealPath,
        path.dirname(verifiedTargetPath),
        false,
        `RESOURCE_NOT_FOUND: Artifact not found: ${relativePath}`
      );
      const postOpenLeaf = this.assertContainedLeafTarget({
        boundaryRootRealPath,
        canonicalParentDir: postOpenParent,
        fullPath: verifiedTargetPath,
        relativePathLabel: relativePath,
        allowMissing: false,
        allowExisting: true
      })!;
      const fstat = fs.fstatSync(fd);
      if (
        (fstat.ino && postOpenLeaf.ino && fstat.ino !== postOpenLeaf.ino) ||
        (fstat.dev && postOpenLeaf.dev && fstat.dev !== postOpenLeaf.dev) ||
        (fstat.ino && preReadLstat.ino && fstat.ino !== preReadLstat.ino) ||
        (fstat.dev && preReadLstat.dev && fstat.dev !== preReadLstat.dev)
      ) {
        throw new Error(
          `WORKSPACE_PATH_SECURITY_VIOLATION: TOCTOU file identity changed during read '${relativePath}'`
        );
      }

      content = fs.readFileSync(fd, "utf8");

      this.onBeforeIoStage?.("post_read_verify", verifiedTargetPath);
      this.assertCanonicalDirectoryChain(
        boundaryRootRealPath,
        postOpenParent,
        false,
        `RESOURCE_NOT_FOUND: Artifact not found: ${relativePath}`
      );
      const finalLeaf = this.assertContainedLeafTarget({
        boundaryRootRealPath,
        canonicalParentDir: postOpenParent,
        fullPath: verifiedTargetPath,
        relativePathLabel: relativePath,
        allowMissing: false,
        allowExisting: true
      })!;
      if (
        (fstat.ino && finalLeaf.ino && fstat.ino !== finalLeaf.ino) ||
        (fstat.dev && finalLeaf.dev && fstat.dev !== finalLeaf.dev)
      ) {
        throw new Error(
          `WORKSPACE_PATH_SECURITY_VIOLATION: TOCTOU file identity changed before return '${relativePath}'`
        );
      }
    } catch (err: any) {
      const msg = String(err?.message || err);
      if (msg.includes("WORKSPACE_PATH_SECURITY_VIOLATION")) {
        this.logActivity({
          requestId: ctx.requestId || "req_fs",
          agentId: auditAgentId,
          workspaceId: `ws_${auditAgentId}`,
          actionType: "read",
          targetPath: relativePath,
          status: "denied",
          bytesCount: 0,
          errorCode: "WORKSPACE_PATH_SECURITY_VIOLATION"
        });
      }
      throw err;
    } finally {
      fs.closeSync(fd);
    }

    this.logActivity({
      requestId: ctx.requestId || "req_fs",
      agentId: auditAgentId,
      workspaceId: `ws_${auditAgentId}`,
      actionType: "read",
      targetPath: relativePath,
      status: "succeeded",
      bytesCount: Buffer.byteLength(content)
    });

    return content;
  }

  public readArtifact(
    agentId: string,
    relativePath: string,
    ctx?: PrincipalContext
  ): { relative_path: string; content: string; encoding: "utf8"; checksum_sha256: string } {
    const safeAgentId = assertValidSingleSegment(agentId, "agent identifier");
    const content = this.safeReadArtifact(relativePath, "workspaces", ctx, safeAgentId);
    const checksum = crypto.createHash("sha256").update(content).digest("hex");
    return {
      relative_path: relativePath,
      content,
      encoding: "utf8",
      checksum_sha256: checksum
    };
  }

  public writeArtifact(params: {
    agentId: string;
    relativePath: string;
    content: string;
    overwrite?: boolean;
    ctx?: PrincipalContext;
  }): { relative_path: string; bytes_written: number; checksum_sha256: string } {
    const safeAgentId = assertValidSingleSegment(params.agentId, "agent identifier");
    const { bytesWritten, checksum_sha256 } = this.safeWriteArtifact(
      params.relativePath,
      params.content,
      "workspaces",
      params.overwrite ?? true,
      params.ctx,
      safeAgentId
    );
    return {
      relative_path: params.relativePath,
      bytes_written: bytesWritten,
      checksum_sha256
    };
  }

  public listFiles(params: {
    agentId: string;
    relativeDir?: string;
    recursive?: boolean;
    includeHidden?: boolean;
    ctx?: PrincipalContext;
  }): {
    files: Array<{
      relative_path: string;
      size_bytes: number;
      modified_at: string;
      is_directory: boolean;
    }>;
    total_files: number;
    total_bytes: number;
  } {
    this.authorizeWorkspaceAccess(params.ctx, params.agentId, "read");
    assertAuthenticatedContext(params.ctx, "listFiles");
    const safeAgentId = assertValidSingleSegment(params.agentId, "agent identifier");

    const { canonicalPath: safeDirPath, boundaryRootRealPath: agentRootPath } =
      resolveContainedWorkspacePath({
        baseDir: this.baseDir,
        subfolder: "workspaces",
        agentId: safeAgentId,
        relativePath: params.relativeDir || "",
        ensureRootExists: true
      });

    if (!fs.existsSync(safeDirPath)) {
      return { files: [], total_files: 0, total_bytes: 0 };
    }

    const results: Array<{
      relative_path: string;
      size_bytes: number;
      modified_at: string;
      is_directory: boolean;
    }> = [];

    let totalBytes = 0;

    const traverse = (dir: string) => {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (!params.includeHidden && entry.name.startsWith(".")) {
          continue;
        }

        const fullItemPath = path.join(dir, entry.name);
        try {
          const lstat = fs.lstatSync(fullItemPath);
          if (lstat.isSymbolicLink()) {
            continue;
          }
          const canonicalTarget = resolveCanonicalFilesystemPath(fullItemPath);
          if (!isPathWithinBoundary(canonicalTarget, agentRootPath)) {
            continue;
          }

          const relToAgent = path.relative(agentRootPath, fullItemPath).replace(/\\/g, "/");
          const stat = fs.statSync(fullItemPath);
          const isDir = entry.isDirectory();
          if (!isDir) totalBytes += stat.size;
          results.push({
            relative_path: relToAgent,
            size_bytes: isDir ? 0 : stat.size,
            modified_at: stat.mtime.toISOString(),
            is_directory: isDir
          });
          if (isDir && (params.recursive ?? true)) {
            traverse(fullItemPath);
          }
        } catch {
          // Skip inaccessible or broken symlink entries
        }
      }
    };

    traverse(safeDirPath);

    this.logActivity({
      requestId: params.ctx.requestId || "req_fs",
      agentId: safeAgentId,
      workspaceId: `ws_${safeAgentId}`,
      actionType: "list",
      targetPath: params.relativeDir || "/",
      status: "succeeded",
      bytesCount: totalBytes
    });

    return {
      files: results,
      total_files: results.filter((r) => !r.is_directory).length,
      total_bytes: totalBytes
    };
  }

  public getWorkspaceMeta(agentId: string, ctx?: PrincipalContext): {
    agent_id: string;
    workspace_id: string;
    workspace_mode: string;
    exists: boolean;
    file_count: number;
    total_bytes: number;
    root_directory: string;
    allowed_subdirectories: string[];
    created_at: string;
  } {
    this.authorizeWorkspaceAccess(ctx, agentId, "read");
    assertAuthenticatedContext(ctx, "getWorkspaceMeta");
    const safeAgentId = assertValidSingleSegment(agentId, "agent identifier");

    const { canonicalPath: agentRoot } = resolveContainedWorkspacePath({
      baseDir: this.baseDir,
      subfolder: "workspaces",
      agentId: safeAgentId,
      relativePath: "",
      ensureRootExists: false
    });
    const exists = fs.existsSync(agentRoot);
    let fileCount = 0;
    let totalBytes = 0;
    let createdAt = new Date().toISOString();

    if (exists) {
      try {
        const stat = fs.statSync(agentRoot);
        createdAt = stat.birthtime.toISOString();
        const listed = this.listFiles({ agentId: safeAgentId, recursive: true, ctx });
        fileCount = listed.total_files;
        totalBytes = listed.total_bytes;
      } catch {}
    }

    return {
      agent_id: safeAgentId,
      workspace_id: `ws_${safeAgentId}`,
      workspace_mode: "isolated_directory",
      exists,
      file_count: fileCount,
      total_bytes: totalBytes,
      root_directory: `workspaces/${safeAgentId}`,
      allowed_subdirectories: ["inbox", "reports", "artifacts", "src", "output"],
      created_at: createdAt
    };
  }

  public shareArtifact(params: {
    fromAgentId: string;
    toAgentId: string;
    sourceRelativePath: string;
    taskId?: string;
    ctx?: PrincipalContext;
  }): { artifact_id: string; checksum_sha256: string; recipient_inbox_ref: string } {
    const safeFromAgentId = assertValidSingleSegment(params.fromAgentId, "source agent identifier");
    const safeToAgentId = assertValidSingleSegment(params.toAgentId, "recipient agent identifier");
    this.authorizeWorkspaceAccess(params.ctx, safeFromAgentId, "write");
    assertAuthenticatedContext(params.ctx, "shareArtifact");

    const read = this.readArtifact(safeFromAgentId, params.sourceRelativePath, params.ctx);
    const artifactId = "art_" + crypto.randomBytes(12).toString("hex");
    const rawBaseName = path.basename(read.relative_path.replace(/\\/g, "/"));
    if (
      !rawBaseName ||
      rawBaseName === "." ||
      rawBaseName === ".." ||
      rawBaseName.includes(":") ||
      /[. ]$/.test(rawBaseName)
    ) {
      throw new Error("WORKSPACE_PATH_SECURITY_VIOLATION: Invalid shared artifact filename");
    }

    const targetRef = `inbox/${artifactId}_${rawBaseName}`;
    const { resolvedPath: recipientDestPath, boundaryRootRealPath: recipientRoot } =
      resolveContainedWorkspacePath({
        baseDir: this.baseDir,
        subfolder: "workspaces",
        agentId: safeToAgentId,
        relativePath: targetRef,
        ensureRootExists: true
      });

    const { bytesWritten } = this.writeFileAtomically({
      fullPath: recipientDestPath,
      boundaryRootRealPath: recipientRoot,
      content: read.content,
      overwrite: false,
      relativePathLabel: targetRef
    });

    this.logActivity({
      requestId: params.ctx.requestId || "req_fs",
      agentId: safeFromAgentId,
      workspaceId: `ws_${safeFromAgentId}`,
      actionType: "share_artifact",
      targetPath: params.sourceRelativePath,
      status: "succeeded",
      bytesCount: bytesWritten
    });

    return {
      artifact_id: artifactId,
      checksum_sha256: read.checksum_sha256,
      recipient_inbox_ref: targetRef
    };
  }

  public listActivities(
    filter?: {
      agentId?: string;
      workspaceId?: string;
      actionType?: string;
      limit?: number;
    },
    ctx?: PrincipalContext
  ): WorkspaceActivityView[] {
    this.authorizeWorkspaceAccess(ctx, filter?.agentId, "audit");
    const limit = normalizeBoundedLimit(filter?.limit);
    if (!this.connManager) return [];
    return this.connManager.withReadTransaction((db) => {
      let query = "SELECT * FROM agent_workspace_activities WHERE 1=1";
      const params: any[] = [];

      if (filter?.agentId) {
        query += " AND agent_id = ?";
        params.push(filter.agentId);
      }
      if (filter?.workspaceId) {
        query += " AND workspace_id = ?";
        params.push(filter.workspaceId);
      }
      if (filter?.actionType) {
        query += " AND action_type = ?";
        params.push(filter.actionType);
      }

      query += " ORDER BY recorded_at DESC LIMIT ?";
      params.push(limit);

      const rows = db.prepare(query).all(...params) as any[];
      return rows.map((r) => ({
        activity_id: r.activity_id,
        request_id: r.request_id,
        agent_id: r.agent_id,
        workspace_id: r.workspace_id,
        action_type: r.action_type,
        target_path: r.target_path,
        status: r.status,
        bytes_count: r.bytes_count,
        recorded_at: r.recorded_at
      }));
    });
  }
}
