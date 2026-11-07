import * as fs from "node:fs";
import * as path from "node:path";
import * as crypto from "node:crypto";
import { ConnectionManager } from "../db/connection-manager.js";

export class WorkspaceArtifactService {
  private baseDir: string;
  private connManager?: ConnectionManager;

  constructor(baseDirOrConn?: string | ConnectionManager) {
    if (typeof baseDirOrConn === "string") {
      this.baseDir = path.resolve(baseDirOrConn);
    } else {
      this.baseDir = path.resolve("D:/AI-COMPANY");
      this.connManager = baseDirOrConn;
    }
  }

  public validateAndResolveSafePath(relativePath: string, subfolder = "workspaces"): string {
    if (!relativePath || typeof relativePath !== "string") {
      throw new Error("Invalid path argument");
    }

    if (relativePath.includes("\0")) {
      throw new Error("WORKSPACE_PATH_SECURITY_VIOLATION: Path contains null byte injection");
    }

    const folderRoot = path.resolve(this.baseDir, subfolder);
    const resolvedPath = path.resolve(folderRoot, relativePath);

    // Enforce root containment
    if (!resolvedPath.startsWith(folderRoot + path.sep) && resolvedPath !== folderRoot) {
      throw new Error(`WORKSPACE_PATH_SECURITY_VIOLATION: Path traversal denied: path escapes ${subfolder} boundary`);
    }

    return resolvedPath;
  }

  public safeWriteArtifact(relativePath: string, content: string | Buffer, subfolder = "workspaces"): { bytesWritten: number; fullPath: string; checksum_sha256: string } {
    const fullPath = this.validateAndResolveSafePath(relativePath, subfolder);
    const parentDir = path.dirname(fullPath);

    if (!fs.existsSync(parentDir)) {
      fs.mkdirSync(parentDir, { recursive: true });
    }

    const strContent = typeof content === "string" ? content : content.toString("utf8");
    const checksum = crypto.createHash("sha256").update(strContent).digest("hex");

    // Atomic write via temporary swap file
    const tempPath = fullPath + `.tmp.${Date.now()}`;
    fs.writeFileSync(tempPath, content);
    fs.renameSync(tempPath, fullPath);

    const stat = fs.statSync(fullPath);
    return { bytesWritten: stat.size, fullPath, checksum_sha256: checksum };
  }

  public safeReadArtifact(relativePath: string, subfolder = "workspaces"): string {
    const fullPath = this.validateAndResolveSafePath(relativePath, subfolder);
    if (!fs.existsSync(fullPath)) {
      throw new Error(`RESOURCE_NOT_FOUND: Artifact not found: ${relativePath}`);
    }
    return fs.readFileSync(fullPath, "utf8");
  }

  public readArtifact(agentId: string, relativePath: string): { relative_path: string; content: string; encoding: "utf8"; checksum_sha256: string } {
    const fullSubpath = path.join(agentId, relativePath);
    const content = this.safeReadArtifact(fullSubpath);
    const checksum = crypto.createHash("sha256").update(content).digest("hex");
    return {
      relative_path: relativePath,
      content,
      encoding: "utf8",
      checksum_sha256: checksum
    };
  }

  public writeArtifact(params: { agentId: string; relativePath: string; content: string; overwrite?: boolean }): { relative_path: string; bytes_written: number; checksum_sha256: string } {
    const fullSubpath = path.join(params.agentId, params.relativePath);
    const { bytesWritten, checksum_sha256 } = this.safeWriteArtifact(fullSubpath, params.content);
    return {
      relative_path: params.relativePath,
      bytes_written: bytesWritten,
      checksum_sha256
    };
  }

  public shareArtifact(params: { fromAgentId: string; toAgentId: string; sourceRelativePath: string; taskId?: string }): { artifact_id: string; checksum_sha256: string; recipient_inbox_ref: string } {
    const read = this.readArtifact(params.fromAgentId, params.sourceRelativePath);
    const artifactId = "art_" + crypto.randomBytes(12).toString("hex");
    const baseName = path.basename(params.sourceRelativePath);
    const targetRef = `inbox/${artifactId}_${baseName}`;

    this.writeArtifact({
      agentId: params.toAgentId,
      relativePath: targetRef,
      content: read.content,
      overwrite: true
    });

    return {
      artifact_id: artifactId,
      checksum_sha256: read.checksum_sha256,
      recipient_inbox_ref: targetRef
    };
  }
}
