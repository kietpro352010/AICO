import * as fs from "node:fs";
import * as path from "node:path";
import * as crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { Migration } from "../migration-runner.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function computeSchemaChecksum(): string {
  const localSql = path.join(__dirname, "schema-v050-rc2.sql");
  let sqlBytes = Buffer.alloc(0);
  if (fs.existsSync(localSql)) {
    sqlBytes = fs.readFileSync(localSql);
  }
  return crypto.createHash("sha256")
    .update("20261106_002_v050_target_tables_v221")
    .update(sqlBytes)
    .digest("hex");
}

export const migrationV050Schema: Migration = {
  id: "20261106_002_v050_target_tables",
  name: "v0.5.0 RC2 Tables, Constraints and Triggers",
  checksum: computeSchemaChecksum(),
  up: (db: DatabaseSync) => {
    const localSql = path.join(__dirname, "schema-v050-rc2.sql");
    const fallbackSql = "D:/AICO_V2_2_1_IMPLEMENTATION_PACK/AICO_DATABASE_SCHEMA_V0.5.0_RC2.sql";

    let sqlContent = "";
    if (fs.existsSync(localSql)) {
      sqlContent = fs.readFileSync(localSql, "utf8");
    } else if (fs.existsSync(fallbackSql)) {
      sqlContent = fs.readFileSync(fallbackSql, "utf8");
    } else {
      throw new Error("Canonical schema file schema-v050-rc2.sql not found");
    }

    db.exec(sqlContent);

    try {
      db.exec("ALTER TABLE audit_events ADD COLUMN event_id TEXT;");
    } catch {}
    try {
      db.exec("ALTER TABLE audit_events ADD COLUMN event_hash_sha256 TEXT;");
    } catch {}

    // Seed Human Principal (Founder)
    db.exec(`
      INSERT OR IGNORE INTO human_principals (
        human_id, display_name, official_title, windows_account, scopes_json, status
      ) VALUES (
        'founder-01', 'Company Founder', 'Owner & Principal Decision Maker', 'kietp', '["*"]', 'active'
      );
    `);

    // Seed default agent workspaces
    db.exec(`
      INSERT OR IGNORE INTO agent_workspaces (workspace_id, agent_id, relative_root, access_profile, logical_only)
      VALUES
        ('ws_flash-01', 'flash-01', 'agents/flash-01', 'standard', 0),
        ('ws_flash-02', 'flash-02', 'agents/flash-02', 'standard', 0),
        ('ws_codex-01', 'codex-01', 'agents/codex-01', 'standard', 0),
        ('ws_chatgpt-01', 'chatgpt-01', 'agents/chatgpt-01', 'logical_only', 1),
        ('ws_argon-01', 'argon-01', 'agents/argon-01', 'logical_only', 1),
        ('ws_argon-02', 'argon-02', 'agents/argon-02', 'logical_only', 1);
    `);

    // Seed default project
    db.exec(`
      INSERT OR IGNORE INTO projects (
        project_id, name, description, status, owner_agent_id, approved_by_human_id, priority, risk_class
      ) VALUES (
        'proj_aico_v221', 'AICO v2.2.1 Core Implementation', 'Canonical v2.2.1 Core Architecture & Service Implementation',
        'active', 'flash-01', 'founder-01', 'P0', 'high'
      );
    `);

    // Create compatibility view for credentials
    db.exec(`
      CREATE VIEW IF NOT EXISTS credentials AS
      SELECT 
        credential_id,
        human_id AS principal_id,
        'human' AS principal_type,
        key_prefix,
        secret_hash,
        secret_hash AS token_hash,
        scopes_json,
        status,
        CASE WHEN status = 'revoked' THEN 1 ELSE 0 END AS is_revoked,
        0 AS allow_public_gateway,
        expires_at,
        last_used_at,
        revoked_at,
        revoked_reason,
        created_at
      FROM human_credentials
      UNION ALL
      SELECT 
        credential_id,
        agent_id AS principal_id,
        'agent' AS principal_type,
        key_prefix,
        secret_hash,
        secret_hash AS token_hash,
        scopes_json,
        status,
        CASE WHEN status = 'revoked' THEN 1 ELSE 0 END AS is_revoked,
        allow_public_gateway,
        expires_at,
        last_used_at,
        revoked_at,
        revoked_reason,
        created_at
      FROM agent_credentials;
    `);
  }
};
