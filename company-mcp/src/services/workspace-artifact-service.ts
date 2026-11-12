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

  private writeFileAtomically(fullPath: string, content: string | Buffer): { bytesWritten: number; checksum_sha256: string } {
    const parentDir = path.dirname(fullPath);
    if (!fs.existsSync(parentDir)) {
      fs.mkdirSync(parentDir, { recursive: true });
    }

    const strContent = typeof content === "string" ? content : content.toString("utf8");
    const checksum = crypto.createHash("sha256").update(strContent).digest("hex");

    const tempPath = fullPath + `.tmp.${Date.now()}.${crypto.randomBytes(4).toString("hex")}`;
    fs.writeFileSync(tempPath, content);
    fs.renameSync(tempPath, fullPath);

    const stat = fs.statSync(fullPath);
    return { bytesWritten: stat.size, checksum_sha256: checksum };
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

    const { canonicalPath: fullPath, effectiveAgentId } = this.resolveScopedWorkspaceTarget({
      relativePath,
      subfolder,
      ctx,
      targetAgentId,
      ensureRootExists: true
    });
    const auditAgentId = effectiveAgentId || ctx.agentId || ctx.principalId;

    if (fs.existsSync(fullPath) && overwrite === false) {
      this.logActivity({
        requestId: ctx.requestId || "req_fs",
        agentId: auditAgentId,
        workspaceId: `ws_${auditAgentId}`,
        actionType: "write",
        targetPath: relativePath,
        status: "denied",
        bytesCount: 0,
        errorCode: "FILE_ALREADY_EXISTS"
      });
      throw new Error(`FILE_ALREADY_EXISTS: Cannot overwrite existing file '${relativePath}' without overwrite=true`);
    }

    const { bytesWritten, checksum_sha256 } = this.writeFileAtomically(fullPath, content);

    this.logActivity({
      requestId: ctx.requestId || "req_fs",
      agentId: auditAgentId,
      workspaceId: `ws_${auditAgentId}`,
      actionType: "write",
      targetPath: relativePath,
      status: "succeeded",
      bytesCount: bytesWritten
    });

    return { bytesWritten, fullPath, checksum_sha256 };
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

    const { canonicalPath: fullPath, effectiveAgentId } = this.resolveScopedWorkspaceTarget({
      relativePath,
      subfolder,
      ctx,
      targetAgentId,
      ensureRootExists: true
    });
    const auditAgentId = effectiveAgentId || ctx.agentId || ctx.principalId;

    if (!fs.existsSync(fullPath)) {
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

    const content = fs.readFileSync(fullPath, "utf8");

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
            const canonicalTarget = resolveCanonicalFilesystemPath(fullItemPath);
            if (!isPathWithinBoundary(canonicalTarget, agentRootPath)) {
              continue;
            }
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
    const { canonicalPath: recipientDestPath } = resolveContainedWorkspacePath({
      baseDir: this.baseDir,
      subfolder: "workspaces",
      agentId: safeToAgentId,
      relativePath: targetRef,
      ensureRootExists: true
    });

    const { bytesWritten } = this.writeFileAtomically(recipientDestPath, read.content);

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
