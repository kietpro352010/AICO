import { DatabaseSync } from "node:sqlite";
import { Migration } from "../migration-runner.js";

export const migrationV040: Migration = {
  id: "20261106_001_v040_agent_columns",
  name: "v0.4.0 Add agent identity and policy columns",
  up: (db: DatabaseSync) => {
    const tableInfo = db.prepare("PRAGMA table_info(agents)").all() as any[];
    const colNames = new Set(tableInfo.map((c) => c.name));

    if (!colNames.has("session_mode")) {
      db.exec("ALTER TABLE agents ADD COLUMN session_mode TEXT DEFAULT 'supervised';");
    }
    if (!colNames.has("dispatch_mode")) {
      db.exec("ALTER TABLE agents ADD COLUMN dispatch_mode TEXT DEFAULT 'local_process';");
    }
    if (!colNames.has("invocation_approval_policy")) {
      db.exec("ALTER TABLE agents ADD COLUMN invocation_approval_policy TEXT DEFAULT 'risk_based';");
    }
    if (!colNames.has("action_approval_policy")) {
      db.exec("ALTER TABLE agents ADD COLUMN action_approval_policy TEXT DEFAULT 'standard';");
    }
    if (!colNames.has("allowed_scopes_json")) {
      db.exec("ALTER TABLE agents ADD COLUMN allowed_scopes_json TEXT DEFAULT '[]';");
    }
  }
};
