import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { DatabaseSync } from "node:sqlite";

export interface TestContext {
  tempDir: string;
  dbPath: string;
  cleanup: () => void;
}

export function createSandboxTestContext(prefix = "aico-test-"): TestContext {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  const dbPath = path.join(tempDir, "sandbox.db");

  const baseDb = "D:/AI-COMPANY/backup/aico_v030_pre_v221.db";
  if (fs.existsSync(baseDb)) {
    fs.copyFileSync(baseDb, dbPath);
  } else {
    const db = new DatabaseSync(dbPath);
    db.exec(`
      CREATE TABLE agents (
        agent_id TEXT PRIMARY KEY,
        display_name TEXT,
        model TEXT,
        platform TEXT,
        role TEXT,
        department TEXT,
        status TEXT,
        capabilities_json TEXT,
        last_seen_at TEXT,
        invocation_mode TEXT,
        auto_invoke INTEGER,
        requires_approval INTEGER,
        quota_class TEXT,
        usage_tier TEXT,
        routing_priority INTEGER,
        quota_pool TEXT,
        reasoning_level TEXT,
        reasoning_verified INTEGER,
        model_verified INTEGER
      );
      CREATE TABLE quota_pools (
        pool_id TEXT PRIMARY KEY,
        provider TEXT,
        account_label TEXT,
        notes TEXT
      );
    `);
    db.close();
  }

  const cleanup = () => {
    try {
      if (fs.existsSync(tempDir)) {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    } catch {
      // Ignore temporary cleanup errors on Windows locks
    }
  };

  return { tempDir, dbPath, cleanup };
}
