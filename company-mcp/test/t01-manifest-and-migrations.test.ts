import test from "node:test";
import assert from "node:assert/strict";
import { createSandboxTestContext } from "./helpers/test-context.js";
import { ConnectionManager } from "../src/db/connection-manager.js";
import { MigrationRunner } from "../src/db/migration-runner.js";
import { migrationV040 } from "../src/db/migrations/v040-agent-columns.js";
import { migrationV050Schema } from "../src/db/migrations/v050-target-schema.js";

test("T01: MigrationRunner and Schema Migrations on Sandbox DB", () => {
  const ctx = createSandboxTestContext("aico-m01-test-");

  try {
    const connManager = new ConnectionManager(ctx.dbPath);
    const runner = new MigrationRunner(connManager);

    // Initial run
    const result1 = runner.runMigrations([migrationV040, migrationV050Schema]);
    assert.equal(result1.applied.length, 2);
    assert.equal(result1.skipped.length, 0);

    // Idempotent secondary run
    const result2 = runner.runMigrations([migrationV040, migrationV050Schema]);
    assert.equal(result2.applied.length, 0);
    assert.equal(result2.skipped.length, 2);

    // Verify schema_migrations table
    const applied = runner.getAppliedMigrations();
    assert.deepEqual(applied, [
      "20261106_001_v040_agent_columns",
      "20261106_002_v050_target_tables"
    ]);

    // Verify new tables created
    connManager.withReadTransaction((db) => {
      const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as any[];
      const names = new Set(tables.map((t) => t.name));
      assert.ok(names.has("credentials"), "credentials table exists");
      assert.ok(names.has("approval_requests"), "approval_requests table exists");
      assert.ok(names.has("projects"), "projects table exists");
      assert.ok(names.has("tasks"), "tasks table exists");
      assert.ok(names.has("audit_events"), "audit_events table exists");
    });
  } finally {
    ctx.cleanup();
  }
});
