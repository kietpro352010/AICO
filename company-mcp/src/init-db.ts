import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";

const DB_PATH = "D:/AI-COMPANY/data/aico.db";

mkdirSync(dirname(DB_PATH), { recursive: true });

const db = new DatabaseSync(DB_PATH);

try {
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec("PRAGMA foreign_keys = ON;");
  db.exec("PRAGMA busy_timeout = 5000;");

  db.exec(`
    CREATE TABLE IF NOT EXISTS agents (
      agent_id TEXT PRIMARY KEY,
      display_name TEXT NOT NULL,
      model TEXT NOT NULL,
      platform TEXT NOT NULL,
      role TEXT NOT NULL,
      department TEXT NOT NULL,
      status TEXT NOT NULL
        CHECK(status IN ('planned', 'configured', 'active', 'offline')),
      capabilities_json TEXT NOT NULL DEFAULT '[]',
      last_seen_at TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_agents_status
    ON agents(status);

    CREATE INDEX IF NOT EXISTS idx_agents_department
    ON agents(department);
  `);

  const agents = [
    {
      id: "flash-01",
      name: "Gemini Flash #1",
      model: "Gemini 3.8 Flash",
      platform: "Antigravity Pro Account 1",
      role: "Chief Technology Officer",
      department: "Engineering",
      status: "configured",
      capabilities: ["mcp", "engineering", "architecture", "planning"]
    },
    {
      id: "flash-02",
      name: "Gemini Flash #2",
      model: "Gemini 3.8 Flash",
      platform: "Antigravity Pro Account 2",
      role: "Engineering and QA Lead",
      department: "Engineering",
      status: "configured",
      capabilities: ["mcp", "engineering", "qa", "testing"]
    },
    {
      id: "argon-01",
      name: "Gemini Argon #1",
      model: "Gemini 4 Argon",
      platform: "Gemini Web Account 1",
      role: "Principal Software Architect",
      department: "Architecture",
      status: "planned",
      capabilities: ["research", "architecture", "technical-design"]
    },
    {
      id: "argon-02",
      name: "Gemini Argon #2",
      model: "Gemini 4 Argon",
      platform: "Gemini Web Account 2",
      role: "Independent Technical Auditor",
      department: "Quality",
      status: "planned",
      capabilities: ["audit", "security-review", "quality-assurance"]
    },
    {
      id: "chatgpt-01",
      name: "ChatGPT Go",
      model: "ChatGPT",
      platform: "ChatGPT Web",
      role: "Product and Strategy Advisor",
      department: "Product",
      status: "planned",
      capabilities: ["product", "strategy", "analysis"]
    }
  ];

  const insert = db.prepare(`
    INSERT INTO agents (
      agent_id, display_name, model, platform,
      role, department, status, capabilities_json
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(agent_id) DO NOTHING
  `);

  // Native SQLite transaction.
  db.exec("BEGIN IMMEDIATE");

  try {
    for (const agent of agents) {
      insert.run(
        agent.id,
        agent.name,
        agent.model,
        agent.platform,
        agent.role,
        agent.department,
        agent.status,
        JSON.stringify(agent.capabilities)
      );
    }

    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }

  const rows = db.prepare(`
    SELECT agent_id, display_name, role, status
    FROM agents
    ORDER BY agent_id
  `).all();

  console.log("AICO DATABASE INITIALIZED");
  console.log("Database:", DB_PATH);
  console.log("Agent count:", rows.length);
  console.table(rows);

} finally {
  db.close();
}
