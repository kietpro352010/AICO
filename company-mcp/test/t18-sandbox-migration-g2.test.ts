import test from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { DatabaseSync } from "node:sqlite";
import { createSandboxTestContext } from "./helpers/test-context.js";
import { ConnectionManager } from "../src/db/connection-manager.js";
import { MigrationRunner, Migration } from "../src/db/migration-runner.js";
import { migrationV040 } from "../src/db/migrations/v040-agent-columns.js";
import { migrationV050Schema } from "../src/db/migrations/v050-target-schema.js";
import { migrationV050V3Foundation } from "../src/db/migrations/v050-v3-foundation.js";

const EXPECTED_24_ENTITIES_TABLES = [
  "chat_rooms",
  "chat_members",
  "chat_messages",
  "message_attachments",
  "message_reactions",
  "room_invites",
  "room_audit_logs",
  "event_outbox",
  "event_subscriptions",
  "dead_letter_queue",
  "delivery_attempts",
  "agent_leases",
  "agent_heartbeats",
  "agent_capabilities",
  "agent_quota_allocations",
  "agent_execution_locks",
  "project_tasks_v3",
  "task_transition_logs",
  "task_approval_bindings",
  "review_assignments",
  "artifact_attestations",
  "memory_records_v3",
  "knowledge_chunks_fts",
  "context_snapshots"
];

test("T18: V3-G2 Sandbox Database Migration v0.5.0 Suite", async (suite) => {

  // Scenario 1: Virgin Sandbox Migration
  await suite.test("1. Virgin sandbox migration creates all 24 foundation tables and virtual tables", () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "aico-virgin-test-"));
    const virginDbPath = path.join(tempDir, "virgin_sandbox.db");

    try {
      const conn = new ConnectionManager(virginDbPath);
      const runner = new MigrationRunner(conn);

      const result = runner.runMigrations([
        migrationV050V3Foundation
      ]);

      assert.equal(result.applied.length, 1);
      assert.equal(result.skipped.length, 0);

      // Verify all 24 tables exist
      conn.withReadTransaction((db) => {
        const objects = db.prepare("SELECT name FROM sqlite_master WHERE type IN ('table', 'view')").all() as any[];
        const tableNames = new Set(objects.map((o) => o.name));

        for (const expectedTable of EXPECTED_24_ENTITIES_TABLES) {
          assert.ok(tableNames.has(expectedTable), `Table/view '${expectedTable}' must exist in migrated schema`);
        }
      });
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  // Scenario 2: Seeded Sandbox Migration (from baseline backup)
  await suite.test("2. Seeded sandbox migration preserves baseline data and adds foundation tables", () => {
    const ctx = createSandboxTestContext("aico-seeded-test-");

    try {
      const conn = new ConnectionManager(ctx.dbPath);
      const runner = new MigrationRunner(conn);

      // Check baseline before migration
      const agentCountPre = conn.withReadTransaction((db) => {
        return (db.prepare("SELECT COUNT(*) as cnt FROM agents").get() as any).cnt;
      });
      assert.ok(agentCountPre > 0, "Baseline agents must exist");

      const result = runner.runMigrations([
        migrationV040,
        migrationV050Schema,
        migrationV050V3Foundation
      ]);

      assert.equal(result.applied.length, 3);

      // Verify baseline agents are preserved
      const agentCountPost = conn.withReadTransaction((db) => {
        return (db.prepare("SELECT COUNT(*) as cnt FROM agents").get() as any).cnt;
      });
      assert.equal(agentCountPost, agentCountPre, "Agent count must remain unchanged after migration");

      // Verify new foundation tables exist
      conn.withReadTransaction((db) => {
        const objects = db.prepare("SELECT name FROM sqlite_master WHERE type IN ('table', 'view')").all() as any[];
        const tableNames = new Set(objects.map((o) => o.name));

        for (const expectedTable of EXPECTED_24_ENTITIES_TABLES) {
          assert.ok(tableNames.has(expectedTable), `Table '${expectedTable}' must exist after seeded migration`);
        }
      });
    } finally {
      ctx.cleanup();
    }
  });

  // Scenario 3: Repeated Migration (Idempotency)
  await suite.test("3. Repeated migration is idempotent (0 applied, all skipped)", () => {
    const ctx = createSandboxTestContext("aico-idempotency-test-");

    try {
      const conn = new ConnectionManager(ctx.dbPath);
      const runner = new MigrationRunner(conn);

      runner.runMigrations([migrationV040, migrationV050Schema, migrationV050V3Foundation]);

      // Rerun immediately
      const rerun = runner.runMigrations([migrationV040, migrationV050Schema, migrationV050V3Foundation]);
      assert.equal(rerun.applied.length, 0);
      assert.equal(rerun.skipped.length, 3);
    } finally {
      ctx.cleanup();
    }
  });

  // Scenario 4: Drift Detection / Invalid Checksum
  await suite.test("4. Migration drift detection throws on altered checksum", () => {
    const ctx = createSandboxTestContext("aico-drift-test-");

    try {
      const conn = new ConnectionManager(ctx.dbPath);
      const runner = new MigrationRunner(conn);

      runner.runMigrations([migrationV050V3Foundation]);

      // Tampered checksum
      const tampered: Migration = {
        ...migrationV050V3Foundation,
        checksum: "tampered_checksum_deadbeef12345678"
      };

      assert.throws(
        () => runner.runMigrations([tampered]),
        /MIGRATION_DRIFT_DETECTED/,
        "Must throw MIGRATION_DRIFT_DETECTED when checksum mismatches"
      );
    } finally {
      ctx.cleanup();
    }
  });

  // Scenario 5: Constraint Violations (PK, UNIQUE, CHECK)
  await suite.test("5. Enforces PK, UNIQUE, and CHECK constraints", () => {
    const ctx = createSandboxTestContext("aico-constraints-test-");

    try {
      const conn = new ConnectionManager(ctx.dbPath);
      const runner = new MigrationRunner(conn);
      runner.runMigrations([migrationV050V3Foundation]);

      conn.withWriteTransaction((db) => {
        // Insert valid room
        db.prepare(`
          INSERT INTO chat_rooms (room_id, slug, name, room_type, created_by, is_archived, created_at, updated_at)
          VALUES ('room_1', 'general-slug', 'General', 'DEPARTMENT_OFFICE', 'founder-01', 0, '2026-11-10T12:00:00Z', '2026-11-10T12:00:00Z')
        `).run();

        // 5.1 Primary Key violation
        assert.throws(() => {
          db.prepare(`
            INSERT INTO chat_rooms (room_id, slug, name, room_type, created_by, is_archived, created_at, updated_at)
            VALUES ('room_1', 'different-slug', 'Duplicate Room', 'DEPARTMENT_OFFICE', 'founder-01', 0, '2026-11-10T12:00:00Z', '2026-11-10T12:00:00Z')
          `).run();
        }, /UNIQUE constraint failed: chat_rooms\.room_id/, "Duplicate room_id must throw PRIMARY KEY violation");

        // 5.2 Unique constraint violation
        assert.throws(() => {
          db.prepare(`
            INSERT INTO chat_rooms (room_id, slug, name, room_type, created_by, is_archived, created_at, updated_at)
            VALUES ('room_2', 'general-slug', 'Another Room', 'DEPARTMENT_OFFICE', 'founder-01', 0, '2026-11-10T12:00:00Z', '2026-11-10T12:00:00Z')
          `).run();
        }, /UNIQUE/, "Duplicate slug must throw UNIQUE constraint violation");

        // 5.3 CHECK constraint violation: room_type
        assert.throws(() => {
          db.prepare(`
            INSERT INTO chat_rooms (room_id, slug, name, room_type, created_by, is_archived, created_at, updated_at)
            VALUES ('room_3', 'slug-3', 'Bad Type', 'NON_EXISTENT_TYPE', 'founder-01', 0, '2026-11-10T12:00:00Z', '2026-11-10T12:00:00Z')
          `).run();
        }, /CHECK constraint failed/, "Invalid room_type must fail CHECK constraint");

        // 5.4 CHECK constraint violation: is_archived must be 0 or 1
        assert.throws(() => {
          db.prepare(`
            INSERT INTO chat_rooms (room_id, slug, name, room_type, created_by, is_archived, created_at, updated_at)
            VALUES ('room_4', 'slug-4', 'Bad Bool', 'DEPARTMENT_OFFICE', 'founder-01', 5, '2026-11-10T12:00:00Z', '2026-11-10T12:00:00Z')
          `).run();
        }, /CHECK constraint failed/, "is_archived outside 0/1 must fail CHECK constraint");

        // 5.5 CHECK constraint violation: file_size_bytes >= 0
        db.prepare(`
          INSERT INTO chat_messages (message_id, room_id, sender_id, sender_type, content, created_at, updated_at)
          VALUES ('msg_1', 'room_1', 'founder-01', 'human', 'Hello', '2026-11-10T12:00:00Z', '2026-11-10T12:00:00Z')
        `).run();

        assert.throws(() => {
          db.prepare(`
            INSERT INTO message_attachments (attachment_id, message_id, file_name, file_path, file_size_bytes, mime_type, sha256_hash, uploaded_at)
            VALUES ('att_1', 'msg_1', 'bad.txt', '/tmp/bad.txt', -50, 'text/plain', 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855', '2026-11-10T12:00:00Z')
          `).run();
        }, /CHECK constraint failed/, "Negative file_size_bytes must fail CHECK constraint");
      });
    } finally {
      ctx.cleanup();
    }
  });

  // Scenario 6: Foreign Key Enforcement & Cascading Deletes
  await suite.test("6. Foreign keys are enforced and cascading deletes remove related child records", () => {
    const ctx = createSandboxTestContext("aico-fk-test-");

    try {
      const conn = new ConnectionManager(ctx.dbPath);
      const runner = new MigrationRunner(conn);
      runner.runMigrations([migrationV050V3Foundation]);

      conn.withWriteTransaction((db) => {
        db.exec("PRAGMA foreign_keys = ON;");

        // 6.1 Foreign key rejection on invalid room_id
        assert.throws(() => {
          db.prepare(`
            INSERT INTO chat_members (membership_id, room_id, principal_id, principal_type, role, joined_at)
            VALUES ('mem_fail', 'non_existent_room', 'flash-01', 'agent', 'member', '2026-11-10T12:00:00Z')
          `).run();
        }, /FOREIGN KEY constraint failed/, "Orphan chat member must fail foreign key constraint");

        // 6.2 Setup room with full cascade tree
        db.prepare(`
          INSERT INTO chat_rooms (room_id, slug, name, room_type, created_by, is_archived, created_at, updated_at)
          VALUES ('room_cascade', 'cascade-room', 'Cascade Room', 'PROJECT_ROOM', 'flash-01', 0, '2026-11-10T12:00:00Z', '2026-11-10T12:00:00Z')
        `).run();

        db.prepare(`
          INSERT INTO chat_members (membership_id, room_id, principal_id, principal_type, role, joined_at)
          VALUES ('mem_c1', 'room_cascade', 'flash-01', 'agent', 'owner', '2026-11-10T12:00:00Z')
        `).run();

        db.prepare(`
          INSERT INTO chat_messages (message_id, room_id, sender_id, sender_type, content, created_at, updated_at)
          VALUES ('msg_c1', 'room_cascade', 'flash-01', 'agent', 'Cascade test message', '2026-11-10T12:00:00Z', '2026-11-10T12:00:00Z')
        `).run();

        db.prepare(`
          INSERT INTO message_attachments (attachment_id, message_id, file_name, file_path, file_size_bytes, mime_type, sha256_hash, uploaded_at)
          VALUES ('att_c1', 'msg_c1', 'spec.md', 'docs/spec.md', 100, 'text/markdown', 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855', '2026-11-10T12:00:00Z')
        `).run();

        db.prepare(`
          INSERT INTO message_reactions (reaction_id, message_id, principal_id, reaction_code, created_at)
          VALUES ('rxn_c1', 'msg_c1', 'flash-02', 'thumbsup', '2026-11-10T12:00:00Z')
        `).run();

        db.prepare(`
          INSERT INTO room_invites (invite_id, room_id, inviter_id, invitee_id, expires_at, created_at)
          VALUES ('inv_c1', 'room_cascade', 'flash-01', 'codex-01', '2026-11-11T12:00:00Z', '2026-11-10T12:00:00Z')
        `).run();

        db.prepare(`
          INSERT INTO room_audit_logs (audit_id, room_id, action, actor_id, created_at)
          VALUES ('aud_c1', 'room_cascade', 'room_created', 'flash-01', '2026-11-10T12:00:00Z')
        `).run();

        // 6.3 Execute deletion on parent room
        db.prepare("DELETE FROM chat_rooms WHERE room_id = 'room_cascade'").run();

        // 6.4 Assert all child tables are cascaded to 0
        const mCount = (db.prepare("SELECT COUNT(*) as c FROM chat_members WHERE room_id = 'room_cascade'").get() as any).c;
        const msgCount = (db.prepare("SELECT COUNT(*) as c FROM chat_messages WHERE room_id = 'room_cascade'").get() as any).c;
        const attCount = (db.prepare("SELECT COUNT(*) as c FROM message_attachments WHERE attachment_id = 'att_c1'").get() as any).c;
        const rxnCount = (db.prepare("SELECT COUNT(*) as c FROM message_reactions WHERE reaction_id = 'rxn_c1'").get() as any).c;
        const invCount = (db.prepare("SELECT COUNT(*) as c FROM room_invites WHERE room_id = 'room_cascade'").get() as any).c;
        const audCount = (db.prepare("SELECT COUNT(*) as c FROM room_audit_logs WHERE room_id = 'room_cascade'").get() as any).c;

        assert.equal(mCount, 0, "chat_members must cascade on room deletion");
        assert.equal(msgCount, 0, "chat_messages must cascade on room deletion");
        assert.equal(attCount, 0, "message_attachments must cascade on message deletion");
        assert.equal(rxnCount, 0, "message_reactions must cascade on message deletion");
        assert.equal(invCount, 0, "room_invites must cascade on room deletion");
        assert.equal(audCount, 0, "room_audit_logs must cascade on room deletion");
      });
    } finally {
      ctx.cleanup();
    }
  });

  // Scenario 7: Index Verification
  await suite.test("7. Indexes exist and query planner utilizes them", () => {
    const ctx = createSandboxTestContext("aico-indexes-test-");

    try {
      const conn = new ConnectionManager(ctx.dbPath);
      const runner = new MigrationRunner(conn);
      runner.runMigrations([migrationV050V3Foundation]);

      conn.withReadTransaction((db) => {
        const indexRows = db.prepare("SELECT name FROM sqlite_master WHERE type = 'index'").all() as any[];
        const indexNames = new Set(indexRows.map((r) => r.name));

        assert.ok(indexNames.has("idx_chat_rooms_slug"), "idx_chat_rooms_slug index exists");
        assert.ok(indexNames.has("idx_chat_messages_room_created"), "idx_chat_messages_room_created index exists");
        assert.ok(indexNames.has("idx_tasks_v3_status"), "idx_tasks_v3_status index exists");
        assert.ok(indexNames.has("idx_event_outbox_status_sched"), "idx_event_outbox_status_sched index exists");

        // Verify EXPLAIN QUERY PLAN uses index
        const plan = db.prepare("EXPLAIN QUERY PLAN SELECT * FROM chat_rooms WHERE slug = 'test'").all() as any[];
        const planDetail = plan.map((p) => p.detail).join(" ");
        assert.ok(planDetail.includes("USING INDEX") || planDetail.includes("USING COVERING INDEX"), `Query plan must use index: ${planDetail}`);
      });
    } finally {
      ctx.cleanup();
    }
  });

  // Scenario 8: Rollback to previous schema (Down Migration)
  await suite.test("8. Rollback drops all 24 foundation tables cleanly and removes migration record", () => {
    const ctx = createSandboxTestContext("aico-rollback-test-");

    try {
      const conn = new ConnectionManager(ctx.dbPath);
      const runner = new MigrationRunner(conn);

      runner.runMigrations([migrationV040, migrationV050Schema, migrationV050V3Foundation]);
      assert.ok(runner.getAppliedMigrationVersions().includes("20261110_003_v050_v3_foundation"));

      // Execute rollback
      const rollbackResult = runner.rollbackMigration(migrationV050V3Foundation);
      assert.equal(rollbackResult.rolledBack, "20261110_003_v050_v3_foundation");

      // Verify migration record removed from schema_migrations
      const currentApplied = runner.getAppliedMigrationVersions();
      assert.ok(!currentApplied.includes("20261110_003_v050_v3_foundation"));
      assert.ok(currentApplied.includes("20261106_001_v040_agent_columns"));
      assert.ok(currentApplied.includes("20261106_002_v050_target_tables"));

      // Verify 24 tables are dropped
      conn.withReadTransaction((db) => {
        const objects = db.prepare("SELECT name FROM sqlite_master WHERE type IN ('table', 'view')").all() as any[];
        const tableNames = new Set(objects.map((o) => o.name));

        for (const expectedTable of EXPECTED_24_ENTITIES_TABLES) {
          assert.ok(!tableNames.has(expectedTable), `Table '${expectedTable}' must be dropped after rollback`);
        }

        // Verify previous schema tables are still intact
        assert.ok(tableNames.has("agents"), "Baseline agents table still exists");
        assert.ok(tableNames.has("quota_pools"), "Baseline quota_pools table still exists");
        assert.ok(tableNames.has("human_credentials"), "v0.5.0 RC2 human_credentials table still exists");
      });
    } finally {
      ctx.cleanup();
    }
  });

  // Scenario 9: Re-migration after Rollback
  await suite.test("9. Re-migration succeeds cleanly after rollback", () => {
    const ctx = createSandboxTestContext("aico-remigrate-test-");

    try {
      const conn = new ConnectionManager(ctx.dbPath);
      const runner = new MigrationRunner(conn);

      runner.runMigrations([migrationV040, migrationV050Schema, migrationV050V3Foundation]);
      runner.rollbackMigration(migrationV050V3Foundation);

      // Re-migrate
      const remigrateResult = runner.runMigrations([migrationV050V3Foundation]);
      assert.equal(remigrateResult.applied.length, 1);
      assert.equal(remigrateResult.applied[0], "20261110_003_v050_v3_foundation");

      // Verify tables restored
      conn.withReadTransaction((db) => {
        const objects = db.prepare("SELECT name FROM sqlite_master WHERE type IN ('table', 'view')").all() as any[];
        const tableNames = new Set(objects.map((o) => o.name));

        for (const expectedTable of EXPECTED_24_ENTITIES_TABLES) {
          assert.ok(tableNames.has(expectedTable), `Table '${expectedTable}' must be recreated after re-migration`);
        }
      });
    } finally {
      ctx.cleanup();
    }
  });

  // Scenario 10: Failure Injection / Atomic Transaction Rollback
  await suite.test("10. Failure injection aborts transaction leaving zero partial tables", () => {
    const ctx = createSandboxTestContext("aico-atomic-test-");

    try {
      const conn = new ConnectionManager(ctx.dbPath);
      const runner = new MigrationRunner(conn);

      const faultyMigration: Migration = {
        id: "20261110_faulty_test_migration",
        name: "Faulty Test Migration",
        up: (db: DatabaseSync) => {
          db.exec("CREATE TABLE temp_partial_table_should_abort (id TEXT PRIMARY KEY);");
          // Deliberate syntax error to trigger failure midway
          db.exec("INVALID SQL STATEMENT SYNTAX ERROR TRIGGERING ROLLBACK;");
        }
      };

      assert.throws(() => {
        runner.runMigrations([faultyMigration]);
      }, /syntax error/i);

      // Verify temp table was rolled back completely
      conn.withReadTransaction((db) => {
        const tableCheck = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='temp_partial_table_should_abort'").get();
        assert.equal(tableCheck, undefined, "Partial table must not exist due to atomic transaction rollback");
      });

      // Verify migration record was NOT recorded
      const applied = runner.getAppliedMigrationVersions();
      assert.ok(!applied.includes("20261110_faulty_test_migration"));
    } finally {
      ctx.cleanup();
    }
  });

  // Scenario 11: Production DB Path Guard
  await suite.test("11. Production DB Path Guard unconditionally throws on data/aico.db", () => {
    const prodPaths = [
      "data/aico.db",
      "data\\aico.db",
      "D:\\AI-COMPANY\\data\\aico.db",
      "d:/ai-company/data/aico.db",
      "./data/aico.db"
    ];

    for (const prodPath of prodPaths) {
      const mockConn = new ConnectionManager(prodPath);
      const runner = new MigrationRunner(mockConn);

      assert.throws(
        () => runner.assertNonProductionDatabase(),
        /PRODUCTION_DB_MIGRATION_PROHIBITED/,
        `assertNonProductionDatabase must throw on ${prodPath}`
      );

      assert.throws(
        () => runner.runMigrations([migrationV050V3Foundation]),
        /PRODUCTION_DB_MIGRATION_PROHIBITED/,
        `runMigrations must throw on ${prodPath}`
      );

      assert.throws(
        () => runner.rollbackMigration(migrationV050V3Foundation),
        /PRODUCTION_DB_MIGRATION_PROHIBITED/,
        `rollbackMigration must throw on ${prodPath}`
      );
    }
  });
});
