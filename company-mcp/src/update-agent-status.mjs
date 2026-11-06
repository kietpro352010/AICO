import { DatabaseSync } from "node:sqlite";

const db = new DatabaseSync("D:/AI-COMPANY/data/aico.db");

try {
  const result = db.prepare(`
    UPDATE agents
    SET status = 'configured',
        updated_at = CURRENT_TIMESTAMP
    WHERE agent_id = ?
  `).run("argon-02");

  console.log("Updated rows:", result.changes);

  const agent = db.prepare(`
    SELECT agent_id, status, invocation_mode,
           auto_invoke, requires_approval, quota_class
    FROM agents
    WHERE agent_id = ?
  `).get("argon-02");

  console.log("\nARGON-02 REGISTRY:");
  console.table([agent]);

} finally {
  db.close();
}
