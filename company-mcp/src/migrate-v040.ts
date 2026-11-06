import { DatabaseSync } from "node:sqlite";

/**
 * Migration v0.4.0: Agent Identity & Workspace Foundation
 * Adds:
 * - agent_credentials: SHA-256 hashed tokens, scopes, revocation, expiry
 * - agent_workspaces: relative root path, status, access profiles
 * - agent_workspace_activities: granular audit logging for all workspace file operations
 */
export function migrateV040(db: DatabaseSync): void {
  db.exec("PRAGMA foreign_keys = ON;");
  db.exec("PRAGMA busy_timeout = 5000;");

  db.exec(`
    -- 1. Agent Credentials Table
    CREATE TABLE IF NOT EXISTS agent_credentials (
      credential_id TEXT PRIMARY KEY,
      agent_id TEXT NOT NULL REFERENCES agents(agent_id) ON DELETE CASCADE,
      key_prefix TEXT NOT NULL,
      secret_hash TEXT NOT NULL UNIQUE,
      scopes_json TEXT NOT NULL DEFAULT '["workspace:read","workspace:write:self"]',
      status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'revoked', 'expired')),
      expires_at TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      last_used_at TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_credentials_hash ON agent_credentials(secret_hash);
    CREATE INDEX IF NOT EXISTS idx_credentials_agent ON agent_credentials(agent_id, status);

    -- 2. Agent Workspaces Table
    CREATE TABLE IF NOT EXISTS agent_workspaces (
      workspace_id TEXT PRIMARY KEY,
      agent_id TEXT NOT NULL UNIQUE REFERENCES agents(agent_id) ON DELETE CASCADE,
      relative_root TEXT NOT NULL,
      workspace_status TEXT NOT NULL DEFAULT 'active' CHECK(workspace_status IN ('initializing', 'active', 'suspended', 'archived')),
      access_profile TEXT NOT NULL DEFAULT 'standard' CHECK(access_profile IN ('standard', 'restricted', 'logical_only')),
      allowed_paths_json TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_workspaces_agent ON agent_workspaces(agent_id);

    -- 3. Agent Workspace Activities (Audit Logging)
    CREATE TABLE IF NOT EXISTS agent_workspace_activities (
      activity_id INTEGER PRIMARY KEY AUTOINCREMENT,
      agent_id TEXT NOT NULL REFERENCES agents(agent_id) ON DELETE CASCADE,
      workspace_id TEXT NOT NULL REFERENCES agent_workspaces(workspace_id) ON DELETE CASCADE,
      action_type TEXT NOT NULL CHECK(action_type IN ('read', 'write', 'delete', 'share_artifact', 'command_exec')),
      target_path TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('allowed', 'denied', 'error')),
      details_json TEXT,
      recorded_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_activities_agent ON agent_workspace_activities(agent_id, recorded_at);
  `);

  // Seed default workspaces for the 6 principal agents if not already seeded
  const existingAgents = db.prepare(`SELECT agent_id FROM agents`).all() as Array<{ agent_id: string }>;

  const insertWorkspace = db.prepare(`
    INSERT INTO agent_workspaces (workspace_id, agent_id, relative_root, access_profile, workspace_status)
    VALUES (?, ?, ?, ?, 'active')
    ON CONFLICT(agent_id) DO NOTHING
  `);

  for (const agent of existingAgents) {
    const isWebAgent = ["chatgpt-01", "argon-01", "argon-02"].includes(agent.agent_id);
    const accessProfile = isWebAgent ? "logical_only" : "standard";
    const workspaceId = `ws_${agent.agent_id}`;
    const relativeRoot = `workspaces/${agent.agent_id}`;

    insertWorkspace.run(workspaceId, agent.agent_id, relativeRoot, accessProfile);
  }
}
