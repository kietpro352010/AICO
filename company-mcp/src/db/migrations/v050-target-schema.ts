import { DatabaseSync } from "node:sqlite";
import { Migration } from "../migration-runner.js";

export const migrationV050Schema: Migration = {
  id: "20261106_002_v050_target_tables",
  name: "v0.5.0 RC2 Tables, Constraints and Triggers",
  up: (db: DatabaseSync) => {
    // T01: agents table already exists, ensure index
    db.exec(`CREATE INDEX IF NOT EXISTS idx_agents_routing ON agents(routing_priority, agent_id);`);

    // T02: quota_pools already exists
    // T03: credentials
    db.exec(`
      CREATE TABLE IF NOT EXISTS credentials (
        credential_id TEXT PRIMARY KEY,
        principal_id TEXT NOT NULL,
        token_hash TEXT NOT NULL,
        scopes_json TEXT NOT NULL DEFAULT '[]',
        allow_public_gateway INTEGER NOT NULL DEFAULT 0,
        is_revoked INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        expires_at TEXT,
        last_used_at TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_credentials_principal ON credentials(principal_id);
    `);

    // T04: approval_requests
    db.exec(`
      CREATE TABLE IF NOT EXISTS approval_requests (
        approval_id TEXT PRIMARY KEY,
        action_type TEXT NOT NULL,
        requested_by TEXT NOT NULL,
        required_approver TEXT NOT NULL,
        payload_hash_sha256 TEXT NOT NULL,
        canonical_payload_json TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        created_at TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        decided_at TEXT,
        decided_by TEXT,
        reason TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_approval_status ON approval_requests(status);
    `);

    // T05: projects
    db.exec(`
      CREATE TABLE IF NOT EXISTS projects (
        project_id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'active',
        created_at TEXT NOT NULL,
        description TEXT
      );
    `);

    // T06: tasks
    db.exec(`
      CREATE TABLE IF NOT EXISTS tasks (
        task_id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        title TEXT NOT NULL,
        state TEXT NOT NULL DEFAULT 'CREATED',
        assigned_to TEXT,
        created_by TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY(project_id) REFERENCES projects(project_id)
      );
      CREATE INDEX IF NOT EXISTS idx_tasks_project ON tasks(project_id);
      CREATE INDEX IF NOT EXISTS idx_tasks_state ON tasks(state);
    `);

    // T07: audit_events (immutable)
    db.exec(`
      CREATE TABLE IF NOT EXISTS audit_events (
        event_id TEXT PRIMARY KEY,
        actor_id TEXT NOT NULL,
        action TEXT NOT NULL,
        resource_type TEXT NOT NULL,
        resource_id TEXT NOT NULL,
        outcome TEXT NOT NULL,
        payload_json TEXT,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_events(created_at);
    `);
  }
};
