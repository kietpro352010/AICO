import * as fs from "node:fs";
import * as path from "node:path";
import * as crypto from "node:crypto";
import { ConnectionManager } from "../db/connection-manager.js";
import type { PrincipalContext } from "../security/context-store.js";

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

export class WorkspaceArtifactService {
  private baseDir: string;
  private connManager?: ConnectionManager;

  constructor(baseDirOrConn?: string | ConnectionManager, connManager?: ConnectionManager) {
    if (typeof baseDirOrConn === "string") {
      this.baseDir = path.resolve(baseDirOrConn);
      this.connManager = connManager;
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
    if (!fs.existsSync(folderRoot)) {
      fs.mkdirSync(folderRoot, { recursive: true });
    }

    const folderRootRealPath = fs.realpathSync(folderRoot);
    const resolvedPath = path.resolve(folderRootRealPath, relativePath);

    // Initial boundary check
    if (!resolvedPath.startsWith(folderRootRealPath + path.sep) && resolvedPath !== folderRootRealPath) {
      throw new Error(`WORKSPACE_PATH_SECURITY_VIOLATION: Path traversal denied: path escapes ${subfolder} boundary`);
    }

    // Realpath and Reparse point / Symlink validation
    if (fs.existsSync(resolvedPath)) {
      const realTarget = fs.realpathSync(resolvedPath);
      if (!realTarget.startsWith(folderRootRealPath + path.sep) && realTarget !== folderRootRealPath) {
        throw new Error(`WORKSPACE_PATH_SECURITY_VIOLATION: Symlink escape denied: target points outside ${subfolder} boundary`);
      }
    } else {
      // For paths not yet created, verify existing ancestor directory
      let ancestor = path.dirname(resolvedPath);
      while (!fs.existsSync(ancestor) && ancestor !== folderRootRealPath) {
        ancestor = path.dirname(ancestor);
      }
      if (fs.existsSync(ancestor)) {
        const realAncestor = fs.realpathSync(ancestor);
        if (!realAncestor.startsWith(folderRootRealPath + path.sep) && realAncestor !== folderRootRealPath) {
          throw new Error(`WORKSPACE_PATH_SECURITY_VIOLATION: Ancestor symlink escape denied`);
        }
      }
    }

    return resolvedPath;
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

  public checkOwnershipOrScope(ctx?: PrincipalContext, targetAgentId?: string): void {
    if (!ctx) return;
    if (ctx.principalType === "human" || ctx.principalId === "founder-01") {
      return;
    }
    if (ctx.scopes.has("workspace:read:any") || ctx.scopes.has("workspace:audit:read") || ctx.scopes.has("*")) {
      return;
    }
    if (targetAgentId && ctx.agentId && ctx.agentId !== targetAgentId) {
      throw new Error(`PERMISSION_DENIED: Access to workspace of agent '${targetAgentId}' denied for principal '${ctx.principalId}'`);
    }
  }

  public safeWriteArtifact(
    relativePath: string,
    content: string | Buffer,
    subfolder = "workspaces",
    overwrite = true,
    ctx?: PrincipalContext,
    targetAgentId?: string
  ): { bytesWritten: number; fullPath: string; checksum_sha256: string } {
    this.checkOwnershipOrScope(ctx, targetAgentId);
    const fullPath = this.validateAndResolveSafePath(relativePath, subfolder);

    if (fs.existsSync(fullPath) && overwrite === false) {
      this.logActivity({
        requestId: ctx?.requestId || "req_fs",
        agentId: targetAgentId || ctx?.agentId || "unknown",
        workspaceId: `ws_${targetAgentId || ctx?.agentId || "default"}`,
        actionType: "write",
        targetPath: relativePath,
        status: "denied",
        bytesCount: 0,
        errorCode: "FILE_ALREADY_EXISTS"
      });
      throw new Error(`FILE_ALREADY_EXISTS: Cannot overwrite existing file '${relativePath}' without overwrite=true`);
    }

    const parentDir = path.dirname(fullPath);
    if (!fs.existsSync(parentDir)) {
      fs.mkdirSync(parentDir, { recursive: true });
    }

    const strContent = typeof content === "string" ? content : content.toString("utf8");
    const checksum = crypto.createHash("sha256").update(strContent).digest("hex");

    // Atomic write via temp file
    const tempPath = fullPath + `.tmp.${Date.now()}.${crypto.randomBytes(4).toString("hex")}`;
    fs.writeFileSync(tempPath, content);
    fs.renameSync(tempPath, fullPath);

    const stat = fs.statSync(fullPath);

    this.logActivity({
      requestId: ctx?.requestId || "req_fs",
      agentId: targetAgentId || ctx?.agentId || "unknown",
      workspaceId: `ws_${targetAgentId || ctx?.agentId || "default"}`,
      actionType: "write",
      targetPath: relativePath,
      status: "succeeded",
      bytesCount: stat.size
    });

    return { bytesWritten: stat.size, fullPath, checksum_sha256: checksum };
  }

  public safeReadArtifact(
    relativePath: string,
    subfolder = "workspaces",
    ctx?: PrincipalContext,
    targetAgentId?: string
  ): string {
    this.checkOwnershipOrScope(ctx, targetAgentId);
    const fullPath = this.validateAndResolveSafePath(relativePath, subfolder);

    if (!fs.existsSync(fullPath)) {
      this.logActivity({
        requestId: ctx?.requestId || "req_fs",
        agentId: targetAgentId || ctx?.agentId || "unknown",
        workspaceId: `ws_${targetAgentId || ctx?.agentId || "default"}`,
        actionType: "read",
        targetPath: relativePath,
        status: "failed",
        bytesCount: 0,
        errorCode: "RESOURCE_NOT_FOUND"
      });
      throw new Error(`RESOURCE_NOT_FOUND: Artifact not found: ${relativePath}`);
    }

    const content = fs.readFileSync(fullPath, "utf8");

    this.logActivity({
      requestId: ctx?.requestId || "req_fs",
      agentId: targetAgentId || ctx?.agentId || "unknown",
      workspaceId: `ws_${targetAgentId || ctx?.agentId || "default"}`,
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
    const fullSubpath = path.join(agentId, relativePath);
    const content = this.safeReadArtifact(fullSubpath, "workspaces", ctx, agentId);
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
    const fullSubpath = path.join(params.agentId, params.relativePath);
    const { bytesWritten, checksum_sha256 } = this.safeWriteArtifact(
      fullSubpath,
      params.content,
      "workspaces",
      params.overwrite ?? true,
      params.ctx,
      params.agentId
    );
    return {
      relative_path: params.relativePath,
      bytes_written: bytesWritten,
      checksum_sha256
    };
  }

  public shareArtifact(params: {
    fromAgentId: string;
    toAgentId: string;
    sourceRelativePath: string;
    taskId?: string;
    ctx?: PrincipalContext;
  }): { artifact_id: string; checksum_sha256: string; recipient_inbox_ref: string } {
    this.checkOwnershipOrScope(params.ctx, params.fromAgentId);
    const read = this.readArtifact(params.fromAgentId, params.sourceRelativePath, params.ctx);
    const artifactId = "art_" + crypto.randomBytes(12).toString("hex");
    const baseName = path.basename(params.sourceRelativePath);
    const targetRef = `inbox/${artifactId}_${baseName}`;

    this.writeArtifact({
      agentId: params.toAgentId,
      relativePath: targetRef,
      content: read.content,
      overwrite: true,
      ctx: params.ctx
    });

    this.logActivity({
      requestId: params.ctx?.requestId || "req_fs",
      agentId: params.fromAgentId,
      workspaceId: `ws_${params.fromAgentId}`,
      actionType: "share_artifact",
      targetPath: params.sourceRelativePath,
      status: "succeeded",
      bytesCount: Buffer.byteLength(read.content)
    });

    return {
      artifact_id: artifactId,
      checksum_sha256: read.checksum_sha256,
      recipient_inbox_ref: targetRef
    };
  }

  public listActivities(filter?: {
    agentId?: string;
    workspaceId?: string;
    actionType?: string;
    limit?: number;
  }): WorkspaceActivityView[] {
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

      query += " ORDER BY recorded_at DESC";
      if (filter?.limit) {
        query += " LIMIT ?";
        params.push(filter.limit);
      } else {
        query += " LIMIT 50";
      }

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
