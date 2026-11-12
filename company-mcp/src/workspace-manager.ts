import { existsSync, mkdirSync } from "node:fs";
import { normalize, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { AgentIdentity } from "./agent-identity-service.js";
import { resolveCanonicalFilesystemPath } from "./db/migration-runner.js";
import { isPathWithinBoundary, resolveContainedAbsoluteRootPath } from "./security/path-containment.js";

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

    try {
      const canonicalCompanyRoot = resolveCanonicalFilesystemPath(this.companyRoot);
      const canonicalWsRoot = resolveCanonicalFilesystemPath(callerWs.absolute_root);
      if (!isPathWithinBoundary(canonicalWsRoot, canonicalCompanyRoot)) {
        this.logActivity(caller.agent_id, callerWs.workspace_id, action, targetRelativePath, "denied", {
          error: "Workspace root escapes company root"
        });
        return {
          safePath: "",
          isAllowed: false,
          reason: "Security violation: Symlink or junction escape on workspace root"
        };
      }

      const { safePath } = resolveContainedAbsoluteRootPath({
        workspaceRoot: canonicalWsRoot,
        relativePath: targetRelativePath
      });
      this.logActivity(caller.agent_id, callerWs.workspace_id, action, targetRelativePath, "allowed");
      return { safePath, isAllowed: true };
    } catch (err: any) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logActivity(caller.agent_id, callerWs.workspace_id, action, targetRelativePath, "denied", {
        error: msg
      });
      return { safePath: "", isAllowed: false, reason: msg };
    }
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
