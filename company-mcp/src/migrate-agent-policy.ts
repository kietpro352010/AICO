import { DatabaseSync } from "node:sqlite";

const DB_PATH = "D:/AI-COMPANY/data/aico.db";
const db = new DatabaseSync(DB_PATH);

try {
  db.exec("PRAGMA busy_timeout = 5000;");

  const migrations = [
    {
      name: "invocation_mode",
      sql: `ALTER TABLE agents ADD COLUMN invocation_mode
            TEXT NOT NULL DEFAULT 'automatic'
            CHECK(invocation_mode IN ('automatic', 'manual'))`
    },
    {
      name: "auto_invoke",
      sql: `ALTER TABLE agents ADD COLUMN auto_invoke
            INTEGER NOT NULL DEFAULT 1
            CHECK(auto_invoke IN (0, 1))`
    },
    {
      name: "requires_approval",
      sql: `ALTER TABLE agents ADD COLUMN requires_approval
            INTEGER NOT NULL DEFAULT 0
            CHECK(requires_approval IN (0, 1))`
    },
    {
      name: "quota_class",
      sql: `ALTER TABLE agents ADD COLUMN quota_class
            TEXT NOT NULL DEFAULT 'normal'
            CHECK(quota_class IN ('normal', 'scarce'))`
    }
  ];

  db.exec("BEGIN IMMEDIATE;");

  try {
    const existing = new Set(
      (db.prepare("PRAGMA table_info(agents)").all() as Array<{name: string}>)
        .map(column => column.name)
    );

    for (const migration of migrations) {
      if (!existing.has(migration.name)) {
        db.exec(migration.sql);
        console.log("Added column:", migration.name);
      } else {
        console.log("Already exists:", migration.name);
      }
    }

    // Two Flash agents: eligible for automatic routing.
    db.prepare(`
      UPDATE agents
      SET invocation_mode = 'automatic',
          auto_invoke = 1,
          requires_approval = 0,
          quota_class = 'normal',
          updated_at = CURRENT_TIMESTAMP
      WHERE agent_id IN ('flash-01', 'flash-02')
    `).run();

    // Gemini Argon: manual invocation only.
    db.prepare(`
      UPDATE agents
      SET invocation_mode = 'manual',
          auto_invoke = 0,
          requires_approval = 1,
          quota_class = 'scarce',
          updated_at = CURRENT_TIMESTAMP
      WHERE agent_id IN ('argon-01', 'argon-02')
    `).run();

    // ChatGPT: manual until its bridge is implemented.
    db.prepare(`
      UPDATE agents
      SET invocation_mode = 'manual',
          auto_invoke = 0,
          requires_approval = 1,
          quota_class = 'normal',
          updated_at = CURRENT_TIMESTAMP
      WHERE agent_id = 'chatgpt-01'
    `).run();

    db.exec("COMMIT;");
  } catch (error) {
    db.exec("ROLLBACK;");
    throw error;
  }

  const rows = db.prepare(`
    SELECT agent_id, status, invocation_mode,
           auto_invoke, requires_approval, quota_class
    FROM agents
    ORDER BY agent_id
  `).all();

  console.log("\nAICO AGENT POLICIES UPDATED");
  console.table(rows);

} finally {
  db.close();
}
