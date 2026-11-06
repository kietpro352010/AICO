import { mkdirSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

const DB_PATH = "D:/AI-COMPANY/data/aico.db";
const BACKUP_DIR = "D:/AI-COMPANY/backup";

mkdirSync(BACKUP_DIR, { recursive: true });

const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const backupPath = `${BACKUP_DIR}/aico-before-v03-${stamp}.db`;

const db = new DatabaseSync(DB_PATH);

try {
  // Create a consistent SQLite backup before migration.
  db.exec(`VACUUM INTO '${backupPath}'`);
  console.log("Backup created:", backupPath);

  db.exec("PRAGMA busy_timeout = 5000;");
  db.exec("BEGIN IMMEDIATE;");

  try {
    const columns = new Set(
      (db.prepare("PRAGMA table_info(agents)").all() as Array<{name: string}>)
        .map(column => column.name)
    );

    const migrations = [
      {
        name: "usage_tier",
        sql: `ALTER TABLE agents ADD COLUMN usage_tier
          TEXT NOT NULL DEFAULT 'high'
          CHECK(usage_tier IN ('high', 'medium', 'low'))`
      },
      {
        name: "routing_priority",
        sql: `ALTER TABLE agents ADD COLUMN routing_priority
          INTEGER NOT NULL DEFAULT 1
          CHECK(routing_priority IN (1, 2, 3))`
      },
      {
        name: "quota_pool",
        sql: `ALTER TABLE agents ADD COLUMN quota_pool
          TEXT NOT NULL DEFAULT 'unassigned'`
      },
      {
        name: "reasoning_level",
        sql: `ALTER TABLE agents ADD COLUMN reasoning_level
          TEXT NOT NULL DEFAULT 'pending'
          CHECK(reasoning_level IN ('high', 'think', 'pending'))`
      },
      {
        name: "reasoning_verified",
        sql: `ALTER TABLE agents ADD COLUMN reasoning_verified
          INTEGER NOT NULL DEFAULT 0
          CHECK(reasoning_verified IN (0, 1))`
      },
      {
        name: "model_verified",
        sql: `ALTER TABLE agents ADD COLUMN model_verified
          INTEGER NOT NULL DEFAULT 0
          CHECK(model_verified IN (0, 1))`
      }
    ];

    for (const migration of migrations) {
      if (!columns.has(migration.name)) {
        db.exec(migration.sql);
        console.log("Added:", migration.name);
      } else {
        console.log("Already exists:", migration.name);
      }
    }

    db.exec(`
      CREATE TABLE IF NOT EXISTS quota_pools (
        pool_id TEXT PRIMARY KEY,
        provider TEXT NOT NULL,
        account_label TEXT NOT NULL,
        notes TEXT,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS agent_usage_events (
        event_id INTEGER PRIMARY KEY AUTOINCREMENT,
        agent_id TEXT NOT NULL REFERENCES agents(agent_id),
        event_type TEXT NOT NULL,
        calls_count INTEGER NOT NULL DEFAULT 1,
        usage_estimate TEXT,
        source TEXT NOT NULL DEFAULT 'manual',
        note TEXT,
        recorded_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );

      CREATE INDEX IF NOT EXISTS idx_agents_priority
      ON agents(routing_priority, usage_tier);

      CREATE INDEX IF NOT EXISTS idx_usage_agent
      ON agent_usage_events(agent_id, recorded_at);
    `);

    const insertPool = db.prepare(`
      INSERT INTO quota_pools (pool_id, provider, account_label, notes)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(pool_id) DO UPDATE SET
        provider = excluded.provider,
        account_label = excluded.account_label,
        notes = excluded.notes,
        updated_at = CURRENT_TIMESTAMP
    `);

    const pools = [
      ["google-pro-01", "Google", "Antigravity Pro #1", "Gemini Flash #1"],
      ["google-pro-02", "Google", "Antigravity Pro #2", "Gemini Flash #2"],
      ["gemini-web-01", "Google", "Gemini Web #1", "Argon #1, scarce quota"],
      ["gemini-web-02", "Google", "Gemini Web #2", "Argon #2, scarce quota"],
      ["openai-go-shared", "OpenAI", "ChatGPT Go – shared account",
        "ChatGPT Web and Codex share this subscription; do not assume independent allowance."]
    ];

    for (const pool of pools) {
      insertPool.run(...pool);
    }

    // Update the five existing agents.
    const update = db.prepare(`
      UPDATE agents SET
        status = 'configured',
        usage_tier = ?,
        routing_priority = ?,
        quota_pool = ?,
        reasoning_level = ?,
        reasoning_verified = 0,
        model_verified = 0,
        model = ?,
        invocation_mode = ?,
        auto_invoke = ?,
        requires_approval = ?,
        quota_class = ?,
        updated_at = CURRENT_TIMESTAMP
      WHERE agent_id = ?
    `);

    const existingAgents = [
      ["high", 1, "google-pro-01", "high",
        "Gemini 3.8 Flash", "automatic", 1, 0, "normal", "flash-01"],

      ["high", 1, "google-pro-02", "high",
        "Gemini 3.8 Flash", "automatic", 1, 0, "normal", "flash-02"],

      ["low", 3, "gemini-web-01", "high",
        "Gemini 4 Argon", "manual", 0, 1, "scarce", "argon-01"],

      ["low", 3, "gemini-web-02", "high",
        "Gemini 4 Argon", "manual", 0, 1, "scarce", "argon-02"],

      ["high", 1, "openai-go-shared", "think",
        "ChatGPT Go Web", "manual", 0, 1, "normal", "chatgpt-01"]
    ];

    for (const agent of existingAgents) {
      const result = update.run(...agent);
      if (result.changes !== 1) {
        throw new Error(`Could not update agent: ${agent[9]}`);
      }
    }

    // Register Codex as a sixth, independent agent.
    db.prepare(`
      INSERT INTO agents (
        agent_id, display_name, model, platform,
        role, department, status, capabilities_json,
        invocation_mode, auto_invoke, requires_approval,
        quota_class, usage_tier, routing_priority,
        quota_pool, reasoning_level,
        reasoning_verified, model_verified
      )
      VALUES (
        'codex-01',
        'Codex',
        'Codex model - pending UI verification',
        'Codex Desktop - ChatGPT Go',
        'Software Implementation Engineer',
        'Engineering',
        'configured',
        '["mcp","coding","repository-analysis","implementation","testing"]',
        'manual',
        0,
        1,
        'normal',
        'medium',
        2,
        'openai-go-shared',
        'high',
        0,
        0
      )
      ON CONFLICT(agent_id) DO UPDATE SET
        model = excluded.model,
        platform = excluded.platform,
        role = excluded.role,
        department = excluded.department,
        status = 'configured',
        capabilities_json = excluded.capabilities_json,
        usage_tier = 'medium',
        routing_priority = 2,
        quota_pool = 'openai-go-shared',
        invocation_mode = 'manual',
        auto_invoke = 0,
        requires_approval = 1,
        reasoning_level = 'high',
        updated_at = CURRENT_TIMESTAMP
    `).run();

    db.exec("COMMIT;");
    console.log("\nAICO AGENT REGISTRY V0.3.0 UPDATED");

  } catch (error) {
    db.exec("ROLLBACK;");
    throw error;
  }

  const agents = db.prepare(`
    SELECT
      agent_id,
      display_name,
      status,
      usage_tier,
      routing_priority,
      quota_pool,
      reasoning_level,
      reasoning_verified,
      invocation_mode,
      auto_invoke
    FROM agents
    ORDER BY routing_priority, agent_id
  `).all();

  console.table(agents);

  console.log("Total agents:", agents.length);
  console.log("Quota pools:",
    db.prepare("SELECT COUNT(*) AS count FROM quota_pools").get()
  );

} finally {
  db.close();
}
