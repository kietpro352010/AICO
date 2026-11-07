import { DatabaseSync } from "node:sqlite";
import { Migration } from "../migration-runner.js";

export const migrationV040: Migration = {
  id: "20261106_001_v040_agent_columns",
  name: "v0.4.0 Add agent, quota pool, and usage event columns for v2.2.1 target schema",
  up: (db: DatabaseSync) => {
    // 1. Upgrade agents table
    const agentCols = new Set(
      (db.prepare("PRAGMA table_info(agents)").all() as any[]).map((c) => c.name)
    );

    const agentAdditions: [string, string][] = [
      ["desired_config_status", "TEXT NOT NULL DEFAULT 'configured'"],
      ["runtime_status", "TEXT NOT NULL DEFAULT 'unknown'"],
      ["session_mode", "TEXT NOT NULL DEFAULT 'web_interactive'"],
      ["dispatch_mode", "TEXT NOT NULL DEFAULT 'operator_handoff'"],
      ["invocation_approval_policy", "TEXT NOT NULL DEFAULT 'none_within_policy'"],
      ["action_approval_policy", "TEXT NOT NULL DEFAULT 'by_action_risk_matrix'"],
      ["allowed_scopes_json", "TEXT NOT NULL DEFAULT '[]'"],
      ["verified_runtime_model", "TEXT"],
      ["access_profile", "TEXT NOT NULL DEFAULT 'web_agent_logical'"],
      ["permission_policy_json", "TEXT NOT NULL DEFAULT '{}'"],
      ["last_verified_at", "TEXT"]
    ];

    for (const [col, def] of agentAdditions) {
      if (!agentCols.has(col)) {
        db.exec(`ALTER TABLE agents ADD COLUMN ${col} ${def};`);
      }
    }

    // 2. Upgrade quota_pools table
    const poolCols = new Set(
      (db.prepare("PRAGMA table_info(quota_pools)").all() as any[]).map((c) => c.name)
    );

    const poolAdditions: [string, string][] = [
      ["quota_class", "TEXT NOT NULL DEFAULT 'normal'"],
      ["max_concurrent_tasks", "INTEGER NOT NULL DEFAULT 2"],
      ["cooldown_seconds", "INTEGER NOT NULL DEFAULT 0"],
      ["pool_status", "TEXT NOT NULL DEFAULT 'active'"]
    ];

    for (const [col, def] of poolAdditions) {
      if (!poolCols.has(col)) {
        db.exec(`ALTER TABLE quota_pools ADD COLUMN ${col} ${def};`);
      }
    }

    // 3. Upgrade agent_usage_events table if it exists
    const hasUsageTable = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='agent_usage_events'")
      .get();

    if (hasUsageTable) {
      const usageCols = new Set(
        (db.prepare("PRAGMA table_info(agent_usage_events)").all() as any[]).map((c) => c.name)
      );

      const usageAdditions: [string, string][] = [
        ["request_id", "TEXT"],
        ["task_id", "TEXT"],
        ["quota_pool_id", "TEXT"],
        ["usage_category", "TEXT NOT NULL DEFAULT 'mcp_tool_activity'"],
        ["duration_ms", "INTEGER"],
        ["request_bytes", "INTEGER"],
        ["response_bytes", "INTEGER"],
        ["input_tokens", "INTEGER"],
        ["output_tokens", "INTEGER"],
        ["cached_tokens", "INTEGER"],
        ["confidence", "TEXT NOT NULL DEFAULT 'verified'"]
      ];

      for (const [col, def] of usageAdditions) {
        if (!usageCols.has(col)) {
          db.exec(`ALTER TABLE agent_usage_events ADD COLUMN ${col} ${def};`);
        }
      }
    }
  }
};
