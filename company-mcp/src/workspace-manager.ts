import { existsSync, mkdirSync, realpathSync } from "node:fs";
import { isAbsolute, normalize, resolve, sep } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { AgentIdentity } from "./agent-identity-service.js";

export type WorkspaceInfo = {
  workspace_id: string;
  agent_id: string;
  relative_root: string;
  absolute_root: string;
  workspace_status: string;
  access_profile: string;
};

export class WorkspaceManager {
  private companyRoot: string;

  constructor(
    private db: DatabaseSync,
    companyRoot = "D:/AI-COMPANY"
  ) {
    this.companyRoot = normalize(resolve(companyRoot));
  }

  /**
   * Retrieves workspace configuration for a registered agent from database.
   */
  public getWorkspace(agentId: string): WorkspaceInfo | null {
    const row = this.db.prepare(`
      SELECT workspace_id, agent_id, relative_root, workspace_status, access_profile
      FROM agent_workspaces
      WHERE agent_id = ?
    `).get(agentId) as {
      workspace_id: string;
      agent_id: string;
      relative_root: string;
      workspace_status: string;
      access_profile: string;
    } | undefined;

    if (!row) return null;

    const absoluteRoot = normalize(resolve(this.companyRoot, row.relative_root));

    return {
      workspace_id: row.workspace_id,
      agent_id: row.agent_id,
      relative_root: row.relative_root,
      absolute_root: absoluteRoot,
      workspace_status: row.workspace_status,
      access_profile: row.access_profile
    };
  }

  /**
   * Initializes standard folder structure for a physical agent workspace on disk.
   */
  public initializeWorkspaceFolders(agentId: string): string {
    const ws = this.getWorkspace(agentId);
    if (!ws) throw new Error(`Workspace not registered for agent: ${agentId}`);

    // If logical only (e.g. web agents), we only create inbox and outbox
    const subfolders = ws.access_profile === "logical_only"
      ? ["inbox", "outbox", "reports"]
      : ["profile", "inbox", "outbox", "tasks", "notes", "reports", "artifacts", "repos"];

    for (const sub of subfolders) {
      const fullPath = resolve(ws.absolute_root, sub);
      mkdirSync(fullPath, { recursive: true });
    }

    return ws.absolute_root;
  }

  /**
   * Validates and resolves a file path within the agent's assigned workspace.
   * Strictly prevents Path Traversal (e.g. '../', Windows absolute drives, UNC paths, symlink escapes).
   */
  public resolveSecurePath(
    caller: AgentIdentity,
    targetRelativePath: string,
    action: "read" | "write" | "delete"
  ): { safePath: string; isAllowed: boolean; reason?: string } {
    const callerWs = this.getWorkspace(caller.agent_id);
    if (!callerWs) {
      this.logActivity(caller.agent_id, "unknown", action, targetRelativePath, "denied", { error: "No workspace" });
      return { safePath: "", isAllowed: false, reason: "Agent workspace not found" };
    }

    if (callerWs.workspace_status !== "active") {
      this.logActivity(caller.agent_id, callerWs.workspace_id, action, targetRelativePath, "denied", { error: "Workspace inactive" });
      return { safePath: "", isAllowed: false, reason: `Workspace is ${callerWs.workspace_status}` };
    }

    // 1. Chặn absolute paths, drive letters (e.g. C:, D:) và UNC paths (\\)
    if (isAbsolute(targetRelativePath) || /^[a-zA-Z]:/.test(targetRelativePath) || targetRelativePath.startsWith("\\\\")) {
      this.logActivity(caller.agent_id, callerWs.workspace_id, action, targetRelativePath, "denied", { error: "Absolute path forbidden" });
      return { safePath: "", isAllowed: false, reason: "Security violation: Absolute or drive-qualified paths forbidden" };
    }

    // 2. Chặn rõ ràng chuỗi '..' trong đường dẫn (trước khi resolve)
    const segments = targetRelativePath.replace(/\\/g, "/").split("/");
    if (segments.includes("..")) {
      this.logActivity(caller.agent_id, callerWs.workspace_id, action, targetRelativePath, "denied", { error: "Path traversal '..' detected" });
      return { safePath: "", isAllowed: false, reason: "Security violation: Path traversal '..' detected" };
    }

    // 3. Resolve vào root workspace của caller
    const candidatePath = normalize(resolve(callerWs.absolute_root, targetRelativePath));

    const normalizedWsRoot = callerWs.absolute_root.endsWith(sep)
      ? callerWs.absolute_root
      : callerWs.absolute_root + sep;

    if (!candidatePath.startsWith(normalizedWsRoot) && candidatePath !== callerWs.absolute_root) {
      this.logActivity(caller.agent_id, callerWs.workspace_id, action, targetRelativePath, "denied", { error: "Out-of-bounds path" });
      return { safePath: "", isAllowed: false, reason: "Security violation: Target is outside assigned workspace boundary" };
    }

    // 4. Kiểm tra symlink escape nếu file/parent đã tồn tại
    if (existsSync(candidatePath)) {
      try {
        const real = realpathSync(candidatePath);
        if (!real.startsWith(callerWs.absolute_root)) {
          this.logActivity(caller.agent_id, callerWs.workspace_id, action, targetRelativePath, "denied", { error: "Symlink escape attempt" });
          return { safePath: "", isAllowed: false, reason: "Security violation: Symlink escape detected" };
        }
      } catch (err: any) {
        return { safePath: "", isAllowed: false, reason: `Filesystem resolution error: ${err.message}` };
      }
    }

    this.logActivity(caller.agent_id, callerWs.workspace_id, action, targetRelativePath, "allowed");
    return { safePath: candidatePath, isAllowed: true };
  }

  /**
   * Logs workspace operations to agent_workspace_activities.
   */
  public logActivity(
    agentId: string,
    workspaceId: string,
    actionType: "read" | "write" | "delete" | "share_artifact" | "command_exec",
    targetPath: string,
    status: "allowed" | "denied" | "error",
    details: Record<string, any> = {}
  ): void {
    try {
      this.db.prepare(`
        INSERT INTO agent_workspace_activities (agent_id, workspace_id, action_type, target_path, status, details_json)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(agentId, workspaceId, actionType, targetPath, status, JSON.stringify(details));
    } catch (e) {
      console.error("[WorkspaceManager] Failed to log activity:", e);
    }
  }
}
