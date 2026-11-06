import { DatabaseSync } from "node:sqlite";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Migration v0.4.1 Blueprint: Canonical Manifest Database Synchronization
 * 
 * Safely updates agent roles, departments, access profiles, and permission policies
 * to strictly match company-manifest.json.
 * 
 * NOTE: DO NOT EXECUTE ON PRODUCTION aico.db WITHOUT FOUNDER APPROVAL.
 */
export function migrateV041(db: DatabaseSync, manifestPath = "D:/AI-COMPANY/company-manifest.json"): { success: boolean; updatedCount: number } {
  if (!existsSync(manifestPath)) {
    throw new Error(`Manifest not found at ${manifestPath}`);
  }

  const manifest = JSON.parse(readFileSync(manifestPath, "utf-8"));
  const agents = manifest.agents;

  db.exec("BEGIN TRANSACTION;");

  try {
    // 1. Ensure optional metadata columns exist
    const tableInfo = db.prepare("PRAGMA table_info(agents);").all() as Array<{ name: string }>;
    const columnNames = new Set(tableInfo.map(c => c.name));

    if (!columnNames.has("access_profile")) {
      db.exec("ALTER TABLE agents ADD COLUMN access_profile TEXT DEFAULT 'standard';");
    }
    if (!columnNames.has("permission_policy_json")) {
      db.exec("ALTER TABLE agents ADD COLUMN permission_policy_json TEXT DEFAULT '{}';");
    }

    // 2. Synchronize all 6 agents from manifest
    const updateStmt = db.prepare(`
      UPDATE agents
      SET 
        role = ?,
        department = ?,
        status = ?,
        access_profile = ?,
        permission_policy_json = ?,
        updated_at = CURRENT_TIMESTAMP
      WHERE agent_id = ?;
    `);

    let updatedCount = 0;
    for (const agent of agents) {
      const res = updateStmt.run(
        agent.canonical_role,
        agent.department,
        agent.status,
        agent.access_profile,
        JSON.stringify(agent.permission_policy),
        agent.agent_id
      );
      updatedCount += Number(res.changes);
    }

    db.exec("COMMIT;");
    return { success: true, updatedCount };
  } catch (error) {
    db.exec("ROLLBACK;");
    throw error;
  }
}
