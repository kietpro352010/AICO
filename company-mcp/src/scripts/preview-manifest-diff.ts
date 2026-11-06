import { DatabaseSync } from "node:sqlite";
import { loadRuntimeConfig } from "../config/runtime-config.js";
import { parseAndValidateManifest } from "../config/manifest-validator.js";

async function main() {
  const config = loadRuntimeConfig();
  console.log("=== AICO Manifest vs Live DB Comparison (Read-Only) ===");
  console.log(`Manifest Path: ${config.manifestPath}`);
  console.log(`Database Path: ${config.dbPath}`);

  const manifestResult = parseAndValidateManifest(config.manifestPath);
  if (!manifestResult.valid || !manifestResult.manifest) {
    console.error("Manifest validation failed:", manifestResult.errors);
    process.exit(1);
  }

  const db = new DatabaseSync(config.dbPath);
  try {
    const dbAgents = db.prepare("SELECT * FROM agents").all() as any[];
    console.log(`\nManifest Agents Count: ${manifestResult.manifest.agents.length}`);
    console.log(`Database Agents Count: ${dbAgents.length}`);

    for (const mAgent of manifestResult.manifest.agents) {
      const match = dbAgents.find((a) => a.agent_id === mAgent.agent_id);
      if (!match) {
        console.log(`[DIFF] Agent in manifest but missing in DB: ${mAgent.agent_id}`);
      } else {
        const roleDiff = match.role !== mAgent.canonical_role ? ` (DB role: '${match.role}' vs Manifest: '${mAgent.canonical_role}')` : "";
        console.log(`[OK] Agent ${mAgent.agent_id} verified.${roleDiff}`);
      }
    }
  } finally {
    db.close();
  }
}

void main();
