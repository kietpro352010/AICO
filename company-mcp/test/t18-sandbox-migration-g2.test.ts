import test from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { createSandboxTestContext } from "./helpers/test-context.js";
import { ConnectionManager } from "../src/db/connection-manager.js";
import {
  MigrationRunner,
  Migration,
  MigrationRunnerOptions,
  PathGuardOptions,
  CanonicalPathFs,
  assertSafeNonProductionDbPath,
  normalizeSqlDatabasePath,
  resolveCanonicalFilesystemPath
} from "../src/db/migration-runner.js";
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

const __testDir = path.dirname(fileURLToPath(import.meta.url));
const DIR_SYMLINK_TYPE: "junction" | "dir" = process.platform === "win32" ? "junction" : "dir";

function assertRunnerBlocksAllOperations(
  dbPath: string,
  expectedError: RegExp,
  label: string,
  options?: MigrationRunnerOptions
): void {
  const conn = new ConnectionManager(dbPath);
  const runner = new MigrationRunner(conn, options);

  assert.throws(
    () => runner.assertNonProductionDatabase(),
    expectedError,
    `assertNonProductionDatabase must throw ${expectedError} on ${label}`
  );

  assert.throws(
    () => runner.runMigrations([migrationV050V3Foundation]),
    expectedError,
    `runMigrations must throw ${expectedError} on ${label}`
  );

  assert.throws(
    () => runner.rollbackMigration(migrationV050V3Foundation),
    expectedError,
    `rollbackMigration must throw ${expectedError} on ${label}`
  );
}

function assertPathGuardRejectsWithFsOps(
  dbPath: string,
  expectedError: RegExp,
  label: string,
  options: PathGuardOptions
): void {
  assert.throws(
    () => assertSafeNonProductionDbPath(dbPath, options),
    expectedError,
    `assertSafeNonProductionDbPath must throw ${expectedError} on ${label}`
  );
}

interface MockCanonicalFsSpec {
  directories?: string[];
  files?: string[];
  symlinks?: Array<{ linkPath: string; target: string }>;
  realpathErrors?: Array<{ targetPath: string; code: string }>;
  lstatErrors?: Array<{ targetPath: string; code: string }>;
  readlinkErrors?: Array<{ targetPath: string; code: string }>;
  statErrors?: Array<{ targetPath: string; code: string }>;
}

function createMockCanonicalFs(spec: MockCanonicalFsSpec): CanonicalPathFs {
  const normKey = (p: string): string => {
    const resolved = path.resolve(p);
    return process.platform === "win32" ? resolved.toLowerCase() : resolved;
  };

  const makeFsError = (code: string, targetPath: string): NodeJS.ErrnoException => {
    const err = new Error(`${code}: mock fs error at ${targetPath}`) as NodeJS.ErrnoException;
    err.code = code;
    return err;
  };

  const symlinkMap = new Map<string, { canonicalLinkPath: string; target: string }>();
  const dirMap = new Map<string, string>();
  const fileMap = new Map<string, string>();
  const realpathErrMap = new Map<string, string>();
  const lstatErrMap = new Map<string, string>();
  const readlinkErrMap = new Map<string, string>();
  const statErrMap = new Map<string, string>();

  const registerAncestors = (targetPath: string, includeSelfAsDir: boolean): void => {
    let curr = includeSelfAsDir ? path.resolve(targetPath) : path.dirname(path.resolve(targetPath));
    while (true) {
      const k = normKey(curr);
      if (!symlinkMap.has(k) && !dirMap.has(k)) {
        dirMap.set(k, curr);
      }
      const parent = path.dirname(curr);
      if (parent === curr) break;
      curr = parent;
    }
  };

  for (const s of spec.symlinks ?? []) {
    const canonicalLinkPath = path.resolve(s.linkPath);
    symlinkMap.set(normKey(canonicalLinkPath), { canonicalLinkPath, target: s.target });
  }
  for (const s of spec.symlinks ?? []) {
    registerAncestors(s.linkPath, false);
  }
  for (const d of spec.directories ?? []) {
    registerAncestors(d, true);
  }
  for (const f of spec.files ?? []) {
    const resolved = path.resolve(f);
    fileMap.set(normKey(resolved), resolved);
    registerAncestors(resolved, false);
  }
  for (const e of spec.realpathErrors ?? []) {
    realpathErrMap.set(normKey(e.targetPath), e.code);
  }
  for (const e of spec.lstatErrors ?? []) {
    lstatErrMap.set(normKey(e.targetPath), e.code);
  }
  for (const e of spec.readlinkErrors ?? []) {
    readlinkErrMap.set(normKey(e.targetPath), e.code);
  }
  for (const e of spec.statErrors ?? []) {
    statErrMap.set(normKey(e.targetPath), e.code);
  }

  const walk = (
    inputPath: string,
    followLast: boolean,
    hops = 0
  ): { canonicalPath: string; isSymlink: boolean; rawLinkTarget?: string } => {
    if (hops > 40) {
      throw makeFsError("ELOOP", inputPath);
    }

    const abs = path.resolve(inputPath);
    const root = path.parse(abs).root;
    const rel = abs.slice(root.length);
    const parts = rel.split(path.sep).filter(Boolean);

    let curr = root;
    if (parts.length === 0) {
      const rootKey = normKey(curr);
      if (followLast && realpathErrMap.has(rootKey)) {
        throw makeFsError(realpathErrMap.get(rootKey)!, curr);
      }
      if (!followLast && lstatErrMap.has(rootKey)) {
        throw makeFsError(lstatErrMap.get(rootKey)!, curr);
      }
      return { canonicalPath: curr, isSymlink: false };
    }

    for (let i = 0; i < parts.length; i++) {
      curr = path.join(curr, parts[i]);
      const k = normKey(curr);
      const isLast = i === parts.length - 1;

      if ((followLast || !isLast) && realpathErrMap.has(k)) {
        throw makeFsError(realpathErrMap.get(k)!, curr);
      }
      if (!followLast && isLast && lstatErrMap.has(k)) {
        throw makeFsError(lstatErrMap.get(k)!, curr);
      }

      const symlinkEntry = symlinkMap.get(k);
      if (symlinkEntry) {
        if (followLast || !isLast) {
          const nextBase = path.isAbsolute(symlinkEntry.target)
            ? path.resolve(symlinkEntry.target)
            : path.resolve(path.dirname(curr), symlinkEntry.target);
          const remaining = parts.slice(i + 1);
          const nextPath = remaining.length > 0 ? path.join(nextBase, ...remaining) : nextBase;
          return walk(nextPath, followLast, hops + 1);
        }
        return {
          canonicalPath: symlinkEntry.canonicalLinkPath,
          isSymlink: true,
          rawLinkTarget: symlinkEntry.target
        };
      }

      if (!isLast) {
        if (dirMap.has(k)) {
          curr = dirMap.get(k)!;
          continue;
        }
        if (fileMap.has(k)) {
          throw makeFsError("ENOTDIR", curr);
        }
        throw makeFsError("ENOENT", curr);
      }

      if (dirMap.has(k)) {
        return { canonicalPath: dirMap.get(k)!, isSymlink: false };
      }
      if (fileMap.has(k)) {
        return { canonicalPath: fileMap.get(k)!, isSymlink: false };
      }
      throw makeFsError("ENOENT", curr);
    }

    return { canonicalPath: curr, isSymlink: false };
  };

  const fsObj: CanonicalPathFs = {
    realpathSync: (p: string) => walk(p, true).canonicalPath,
    lstatSync: (p: string) => {
      const res = walk(p, false);
      return { isSymbolicLink: () => res.isSymlink };
    },
    readlinkSync: (p: string) => {
      const res = walk(p, false);
      if (!res.isSymlink || res.rawLinkTarget === undefined) {
        throw makeFsError("EINVAL", p);
      }
      if (readlinkErrMap.has(normKey(res.canonicalPath))) {
        throw makeFsError(readlinkErrMap.get(normKey(res.canonicalPath))!, res.canonicalPath);
      }
      return res.rawLinkTarget;
    }
  };

  if (spec.statErrors && spec.statErrors.length > 0) {
    let nextIno = 100n;
    const inodeByPath = new Map<string, bigint>();
    fsObj.statSync = (p: string) => {
      const canonical = walk(p, true).canonicalPath;
      const k = normKey(canonical);
      if (statErrMap.has(k)) {
        throw makeFsError(statErrMap.get(k)!, canonical);
      }
      if (!inodeByPath.has(k)) {
        inodeByPath.set(k, nextIno++);
      }
      return { dev: 1n, ino: inodeByPath.get(k)! };
    };
  }

  return fsObj;
}

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

  // Scenario 11: Production DB Path Guard (direct, relative, URI, lookalikes, Win32 dot/space, and NTFS ADS variants)
  await suite.test("11. Production DB Path Guard unconditionally throws on direct, relative, URI, Win32 dot/space, and ADS paths to data/aico.db", () => {
    const prodPaths = [
      "data/aico.db",
      "data\\aico.db",
      "D:\\AI-COMPANY\\data\\aico.db",
      "d:/ai-company/data/aico.db",
      "./data/aico.db",
      "file:./data/aico.db?mode=rwc",
      "file:///D:/AI-COMPANY/data/aico.db",
      "file://localhost/D:/AI-COMPANY/data/aico.db",
      "file://LOCALHOST/D:/AI-COMPANY/data/aico.db",
      "file:./data/aico%2edb?mode=rwc",
      "file:///D:/AI-COMPANY/data/aico.db#section",
      "data/aico.db-wal",
      "file::memory:/../../data/aico.db",
      "file::memory:/../../data/aico.db?cache=shared",
      "data/aico.db.",
      "data/aico.db ",
      "file:./data/aico.db%20",
      "file:./data/aico.db%2e",
      "data/aico.db::$DATA",
      "data/aico.db:evil",
      "data::$INDEX_ALLOCATION/aico.db"
    ];

    for (const lookalike of [
      "file::memory:/../../data/aico.db",
      "file::memory:/../../data/aico.db?cache=shared"
    ]) {
      assert.equal(
        normalizeSqlDatabasePath(lookalike).isMemory,
        false,
        `Lookalike URI ${lookalike} must not be classified as :memory:`
      );
    }

    for (const prodPath of prodPaths) {
      assertRunnerBlocksAllOperations(prodPath, /PRODUCTION_DB_MIGRATION_PROHIBITED/, prodPath);
    }
  });

  // Scenario 12: Real OS directory junction / symlink to existing mock data/aico.db
  await suite.test("12. Production DB Path Guard blocks real OS directory junction/symlink to mock data/aico.db (including Win32 dot and ADS aliases)", () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "aico-prod-guard-junction-"));

    try {
      const mockDataDir = path.join(tempDir, "mock_repo", "data");
      fs.mkdirSync(mockDataDir, { recursive: true });
      const mockProdDb = path.join(mockDataDir, "aico.db");
      fs.writeFileSync(mockProdDb, "");

      const sneakyAliasDir = path.join(tempDir, "sneaky_sandbox_dir");
      fs.symlinkSync(mockDataDir, sneakyAliasDir, DIR_SYMLINK_TYPE);

      const sneakyDbPath = path.join(sneakyAliasDir, "aico.db");
      assert.ok(
        !sneakyDbPath.toLowerCase().replace(/\\/g, "/").includes("/data/"),
        "Lexical path must not contain /data/ so canonical resolution is exercised"
      );

      assert.equal(
        resolveCanonicalFilesystemPath(sneakyDbPath),
        fs.realpathSync.native(mockProdDb)
      );

      assertRunnerBlocksAllOperations(
        sneakyDbPath,
        /PRODUCTION_DB_MIGRATION_PROHIBITED/,
        "junction path to mock data/aico.db"
      );
      assertRunnerBlocksAllOperations(
        pathToFileURL(sneakyDbPath).href,
        /PRODUCTION_DB_MIGRATION_PROHIBITED/,
        "file: URI over junction path to mock data/aico.db"
      );
      assertRunnerBlocksAllOperations(
        path.join(sneakyAliasDir, "aico.db."),
        /PRODUCTION_DB_MIGRATION_PROHIBITED/,
        "junction path with trailing dot to mock data/aico.db"
      );
      assertRunnerBlocksAllOperations(
        path.join(sneakyAliasDir, "aico.db::$DATA"),
        /PRODUCTION_DB_MIGRATION_PROHIBITED/,
        "junction path with ::$DATA ADS to mock data/aico.db"
      );
      assertRunnerBlocksAllOperations(
        path.join(sneakyAliasDir, "aico.db:evil"),
        /PRODUCTION_DB_MIGRATION_PROHIBITED/,
        "junction path with :evil ADS to mock data/aico.db"
      );
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  // Scenario 13: Real OS directory junction / symlink where leaf aico.db does not exist yet
  await suite.test("13. Production DB Path Guard blocks junction/symlink to mock_empty/data even when aico.db leaf is missing", () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "aico-prod-guard-missing-leaf-"));

    try {
      const mockEmptyDataDir = path.join(tempDir, "mock_empty", "data");
      fs.mkdirSync(mockEmptyDataDir, { recursive: true });

      const sneakyMissingAlias = path.join(tempDir, "sneaky_missing_alias");
      fs.symlinkSync(mockEmptyDataDir, sneakyMissingAlias, DIR_SYMLINK_TYPE);

      const sneakyMissingDbPath = path.join(sneakyMissingAlias, "aico.db");
      assert.ok(
        !sneakyMissingDbPath.toLowerCase().replace(/\\/g, "/").includes("/data/"),
        "Lexical path must not contain /data/"
      );
      assert.equal(
        resolveCanonicalFilesystemPath(sneakyMissingDbPath),
        path.join(fs.realpathSync.native(mockEmptyDataDir), "aico.db")
      );

      assertRunnerBlocksAllOperations(
        sneakyMissingDbPath,
        /PRODUCTION_DB_MIGRATION_PROHIBITED/,
        "junction path to non-existent mock_empty/data/aico.db"
      );
      assertRunnerBlocksAllOperations(
        path.join(sneakyMissingAlias, "aico.db."),
        /PRODUCTION_DB_MIGRATION_PROHIBITED/,
        "junction path with trailing dot to non-existent mock_empty/data/aico.db"
      );
      assertRunnerBlocksAllOperations(
        path.join(sneakyMissingAlias, "aico.db::$DATA"),
        /PRODUCTION_DB_MIGRATION_PROHIBITED/,
        "junction path with ::$DATA ADS to non-existent mock_empty/data/aico.db"
      );
      assert.equal(
        fs.existsSync(path.join(mockEmptyDataDir, "aico.db")),
        false,
        "Blocked guard check must never create aico.db"
      );
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  // Scenario 14: Multi-level missing ancestor subdirectories inside symlinked parent, chained junctions, and non-existent additionalProtectedPaths
  await suite.test("14. Production DB Path Guard resolves and blocks multi-level missing descendants, chained junctions, and non-existent protected paths", () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "aico-prod-guard-chained-"));

    try {
      // 14.1 Multi-level non-existent ancestor subdirectories inside symlinked parent
      const mockRoot = path.join(tempDir, "mock_workspace_root");
      fs.mkdirSync(mockRoot, { recursive: true });
      const rootAlias = path.join(tempDir, "workspace_alias");
      fs.symlinkSync(mockRoot, rootAlias, DIR_SYMLINK_TYPE);

      const multiMissingPath = path.join(rootAlias, "data", "aico.db");
      assert.equal(
        resolveCanonicalFilesystemPath(multiMissingPath),
        path.join(fs.realpathSync.native(mockRoot), "data", "aico.db"),
        "Canonical resolver must resolve multi-level missing data/aico.db through symlinked parent"
      );
      assertRunnerBlocksAllOperations(
        multiMissingPath,
        /PRODUCTION_DB_MIGRATION_PROHIBITED/,
        "multi-level missing data/aico.db inside symlinked parent"
      );

      // 14.2 Chained directory junctions (junc2 -> junc1 -> mockDataDir)
      const mockDataDir = path.join(tempDir, "chained_repo", "data");
      fs.mkdirSync(mockDataDir, { recursive: true });
      const chainedDummyDb = path.join(mockDataDir, "aico.db");
      fs.writeFileSync(chainedDummyDb, "");

      const junc1 = path.join(tempDir, "junc_hop_1");
      const junc2 = path.join(tempDir, "junc_hop_2");
      fs.symlinkSync(mockDataDir, junc1, DIR_SYMLINK_TYPE);
      fs.symlinkSync(junc1, junc2, DIR_SYMLINK_TYPE);

      const chainedDbPath = path.join(junc2, "aico.db");
      assert.ok(!chainedDbPath.toLowerCase().replace(/\\/g, "/").includes("/data/"));
      assert.equal(
        resolveCanonicalFilesystemPath(chainedDbPath),
        fs.realpathSync.native(chainedDummyDb)
      );
      assertRunnerBlocksAllOperations(
        chainedDbPath,
        /PRODUCTION_DB_MIGRATION_PROHIBITED/,
        "chained directory junctions to mock data/aico.db"
      );

      // 14.3 Chained junctions where leaf aico.db is also missing
      const mockMissingChainDataDir = path.join(tempDir, "chained_empty_repo", "data");
      fs.mkdirSync(mockMissingChainDataDir, { recursive: true });
      const missingJunc1 = path.join(tempDir, "missing_junc_1");
      const missingJunc2 = path.join(tempDir, "missing_junc_2");
      fs.symlinkSync(mockMissingChainDataDir, missingJunc1, DIR_SYMLINK_TYPE);
      fs.symlinkSync(missingJunc1, missingJunc2, DIR_SYMLINK_TYPE);

      const chainedMissingLeaf = path.join(missingJunc2, "aico.db");
      assert.equal(
        resolveCanonicalFilesystemPath(chainedMissingLeaf),
        path.join(fs.realpathSync.native(mockMissingChainDataDir), "aico.db")
      );
      assertRunnerBlocksAllOperations(
        chainedMissingLeaf,
        /PRODUCTION_DB_MIGRATION_PROHIBITED/,
        "chained directory junctions to missing mock data/aico.db"
      );

      // 14.4 Canonical string match blocks non-existent additionalProtectedPaths target via junction without statSync inode
      const futureProtectedDir = path.join(tempDir, "future_protected");
      fs.mkdirSync(futureProtectedDir, { recursive: true });
      const futureCustomProd = path.join(futureProtectedDir, "custom_vault.db");
      const vaultAlias = path.join(tempDir, "vault_alias");
      fs.symlinkSync(futureProtectedDir, vaultAlias, DIR_SYMLINK_TYPE);

      assert.equal(fs.existsSync(futureCustomProd), false, "Protected target must not exist on disk yet");
      assertRunnerBlocksAllOperations(
        path.join(vaultAlias, "custom_vault.db"),
        /PRODUCTION_DB_MIGRATION_PROHIBITED/,
        "junction resolving to non-existent additionalProtectedPaths entry",
        { additionalProtectedPaths: [futureCustomProd] }
      );
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  // Scenario 15: Real OS NTFS/POSIX hardlink & companion (-wal/-shm/-journal) hardlink protection
  await suite.test("15. Production DB Path Guard blocks NTFS/POSIX hardlinks (including ADS/dot aliases and companion -wal/-shm/-journal files)", () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "aico-prod-guard-hardlink-"));

    try {
      const fakeEnvDir = path.join(tempDir, "fake_env");
      fs.mkdirSync(fakeEnvDir, { recursive: true });
      const fakeProdDb = path.join(fakeEnvDir, "custom_prod.db");
      fs.writeFileSync(fakeProdDb, "synthetic-protected-db-bytes");

      const sneakyHardlink = path.join(tempDir, "completely_different.db");
      fs.linkSync(fakeProdDb, sneakyHardlink);

      const prodStat = fs.statSync(fakeProdDb, { bigint: true });
      const linkStat = fs.statSync(sneakyHardlink, { bigint: true });
      assert.equal(linkStat.dev, prodStat.dev, "Hardlink must share device ID");
      assert.equal(linkStat.ino, prodStat.ino, "Hardlink must share filesystem inode");

      assertRunnerBlocksAllOperations(
        sneakyHardlink,
        /PRODUCTION_DB_MIGRATION_PROHIBITED/,
        "hardlink sharing inode with protected DB",
        { additionalProtectedPaths: [fakeProdDb] }
      );
      assertRunnerBlocksAllOperations(
        `${sneakyHardlink}::$DATA`,
        /PRODUCTION_DB_MIGRATION_PROHIBITED/,
        "hardlink with ::$DATA ADS alias",
        { additionalProtectedPaths: [fakeProdDb] }
      );
      assertRunnerBlocksAllOperations(
        `${sneakyHardlink}.`,
        /PRODUCTION_DB_MIGRATION_PROHIBITED/,
        "hardlink with trailing dot alias",
        { additionalProtectedPaths: [fakeProdDb] }
      );

      // Positive control: separate non-hardlinked DB is permitted even with additionalProtectedPaths
      const unrelatedDb = path.join(tempDir, "unrelated_sandbox.db");
      fs.writeFileSync(unrelatedDb, "");
      const controlRunner = new MigrationRunner(new ConnectionManager(unrelatedDb), {
        additionalProtectedPaths: [fakeProdDb]
      });
      assert.doesNotThrow(() => controlRunner.assertNonProductionDatabase());

      // Companion file hardlink protection: hardlinking unrelated_sandbox.db-wal (or -shm / -journal) to fakeProdDb blocks migrating the main DB
      for (const suffix of ["-wal", "-shm", "-journal"]) {
        const guardedBaseDb = path.join(tempDir, `companion_test_${suffix.slice(1)}.db`);
        fs.writeFileSync(guardedBaseDb, "");
        fs.linkSync(fakeProdDb, `${guardedBaseDb}${suffix}`);

        assertRunnerBlocksAllOperations(
          guardedBaseDb,
          /PRODUCTION_DB_MIGRATION_PROHIBITED/,
          `main DB whose companion ${suffix} is hardlinked to protected DB`,
          { additionalProtectedPaths: [fakeProdDb] }
        );
      }

      // Also verify directly on unrelatedDb once its -wal companion is hardlinked
      fs.linkSync(fakeProdDb, `${unrelatedDb}-wal`);
      assertRunnerBlocksAllOperations(
        unrelatedDb,
        /PRODUCTION_DB_MIGRATION_PROHIBITED/,
        "unrelated_sandbox.db once unrelated_sandbox.db-wal is hardlinked to fakeProdDb",
        { additionalProtectedPaths: [fakeProdDb] }
      );

      // Companion-to-companion hardlink: sandbox_companion.db-wal -> fakeProdDb-wal (only fakeProdDb passed in additionalProtectedPaths)
      const fakeProdWal = `${fakeProdDb}-wal`;
      fs.writeFileSync(fakeProdWal, "synthetic-protected-wal-bytes");
      const sandboxCompanionDb = path.join(tempDir, "sandbox_companion.db");
      fs.writeFileSync(sandboxCompanionDb, "");
      fs.linkSync(fakeProdWal, `${sandboxCompanionDb}-wal`);

      assertRunnerBlocksAllOperations(
        sandboxCompanionDb,
        /PRODUCTION_DB_MIGRATION_PROHIBITED/,
        "sandbox_companion.db whose -wal is hardlinked to fakeProdDb-wal",
        { additionalProtectedPaths: [fakeProdDb] }
      );
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  // Scenario 16: Unit tests on resolveCanonicalFilesystemPath + assertSafeNonProductionDbPath with injected fsOps
  await suite.test("16. Canonical path resolver & assertSafeNonProductionDbPath handle injected fsOps symlinks, companion files, and fail-closed errors", () => {
    const virtualTempDir = path.join(os.tmpdir(), "aico-virtual-fsops");
    const resolvedRepoProd = path.resolve("/repo/data/aico.db");

    // 16.1 Existing file symlink: tempDir/benign_sandbox.db -> /repo/data/aico.db
    const benignSymlink = path.join(virtualTempDir, "benign_sandbox.db");
    const existingSymlinkFs = createMockCanonicalFs({
      directories: [virtualTempDir],
      files: [resolvedRepoProd],
      symlinks: [{ linkPath: benignSymlink, target: "/repo/data/aico.db" }]
    });

    assert.equal(
      resolveCanonicalFilesystemPath(benignSymlink, existingSymlinkFs),
      resolvedRepoProd
    );
    assertPathGuardRejectsWithFsOps(
      benignSymlink,
      /PRODUCTION_DB_MIGRATION_PROHIBITED/,
      "injected file symlink to /repo/data/aico.db",
      { fsOps: existingSymlinkFs }
    );

    // 16.2 Dangling/broken file symlink: tempDir/broken.db -> /future_repo/data/aico.db
    const brokenSymlink = path.join(virtualTempDir, "broken.db");
    const resolvedFutureProd = path.resolve("/future_repo/data/aico.db");

    const brokenSymlinkFs = createMockCanonicalFs({
      directories: [virtualTempDir],
      symlinks: [{ linkPath: brokenSymlink, target: "/future_repo/data/aico.db" }]
    });

    assert.equal(
      resolveCanonicalFilesystemPath(brokenSymlink, brokenSymlinkFs),
      resolvedFutureProd
    );
    assertPathGuardRejectsWithFsOps(
      brokenSymlink,
      /PRODUCTION_DB_MIGRATION_PROHIBITED/,
      "injected dangling file symlink to /future_repo/data/aico.db",
      { fsOps: brokenSymlinkFs }
    );

    // 16.3 Relative symlink inside symlinked parent directory (must resolve relative to canonical parent, not lexical parent)
    const lexicalParentAlias = path.resolve("/sandbox/alias_dir");
    const canonicalParentReal = path.resolve("/repo/data/nested");
    const relLinkInCanonicalParent = path.join(canonicalParentReal, "rel_alias.db");
    const lexicalAccessPath = path.join(lexicalParentAlias, "rel_alias.db");

    const relativeSymlinkFs = createMockCanonicalFs({
      directories: [path.resolve("/sandbox"), canonicalParentReal],
      symlinks: [
        { linkPath: lexicalParentAlias, target: canonicalParentReal },
        { linkPath: relLinkInCanonicalParent, target: "../aico.db" }
      ]
    });

    assert.equal(
      resolveCanonicalFilesystemPath(lexicalAccessPath, relativeSymlinkFs),
      resolvedRepoProd,
      "Relative symlink ../aico.db must resolve relative to canonical parent /repo/data/nested, not lexical /sandbox/alias_dir"
    );
    assertPathGuardRejectsWithFsOps(
      lexicalAccessPath,
      /PRODUCTION_DB_MIGRATION_PROHIBITED/,
      "relative symlink inside symlinked parent resolving to /repo/data/aico.db",
      { fsOps: relativeSymlinkFs }
    );

    // 16.4 Canonical path match blocks non-existent additionalProtectedPaths entry via injected file symlink without statSync
    const missingCustomProd = path.resolve("/future_vault/secret_prod.db");
    const benignVaultAlias = path.join(virtualTempDir, "benign_vault_alias.db");
    const nonExistentProtectedFs = createMockCanonicalFs({
      directories: [virtualTempDir],
      symlinks: [{ linkPath: benignVaultAlias, target: missingCustomProd }]
    });
    assertPathGuardRejectsWithFsOps(
      benignVaultAlias,
      /PRODUCTION_DB_MIGRATION_PROHIBITED/,
      "dangling file symlink to non-existent additionalProtectedPaths entry",
      { fsOps: nonExistentProtectedFs, additionalProtectedPaths: [missingCustomProd] }
    );

    // 16.5 Companion -wal / -journal symlink blocks migrating sandbox.db
    const companionMainDb = path.join(virtualTempDir, "sandbox.db");
    const companionWalLink = path.join(virtualTempDir, "sandbox.db-wal");
    const companionWalFs = createMockCanonicalFs({
      directories: [virtualTempDir],
      files: [companionMainDb],
      symlinks: [{ linkPath: companionWalLink, target: "/repo/data/aico.db-wal" }]
    });
    assertPathGuardRejectsWithFsOps(
      companionMainDb,
      /PRODUCTION_DB_MIGRATION_PROHIBITED/,
      "sandbox.db whose companion sandbox.db-wal symlinks to /repo/data/aico.db-wal",
      { fsOps: companionWalFs }
    );

    // 16.6 Unexpected FS errors (ELOOP / EACCES / readlink EACCES / statSync EACCES / max recursion depth) fail closed with CANONICAL_PATH_RESOLUTION_FAILED
    const eloopPath = path.resolve("/err/eloop.db");
    const eaccesPath = path.resolve("/err/eacces.db");
    const lockedAncestorChildPath = path.resolve("/err/locked_dir/missing.db");
    const readlinkFailPath = path.resolve("/err/unreadable_link.db");
    const statFailPath = path.resolve("/err/stat_eacces.db");

    const errorFs = createMockCanonicalFs({
      directories: [path.resolve("/err/locked_dir")],
      files: [statFailPath],
      symlinks: [
        { linkPath: readlinkFailPath, target: "/err/nonexistent_target.db" }
      ],
      realpathErrors: [
        { targetPath: eloopPath, code: "ELOOP" },
        { targetPath: eaccesPath, code: "EACCES" }
      ],
      lstatErrors: [
        { targetPath: path.resolve("/err/locked_dir"), code: "EACCES" }
      ],
      readlinkErrors: [
        { targetPath: readlinkFailPath, code: "EACCES" }
      ],
      statErrors: [
        { targetPath: statFailPath, code: "EACCES" }
      ]
    });

    for (const [errPath, codePattern] of [
      [eloopPath, /ELOOP/],
      [eaccesPath, /EACCES/],
      [lockedAncestorChildPath, /EACCES/],
      [readlinkFailPath, /EACCES/]
    ] as const) {
      assert.throws(
        () => resolveCanonicalFilesystemPath(errPath, errorFs),
        (err: Error) =>
          /CANONICAL_PATH_RESOLUTION_FAILED/.test(err.message) && codePattern.test(err.message),
        `resolveCanonicalFilesystemPath must fail closed with CANONICAL_PATH_RESOLUTION_FAILED on ${errPath}`
      );
      assertPathGuardRejectsWithFsOps(
        errPath,
        /CANONICAL_PATH_RESOLUTION_FAILED/,
        `fail-closed FS error at ${errPath}`,
        { fsOps: errorFs }
      );
    }

    assertPathGuardRejectsWithFsOps(
      statFailPath,
      /CANONICAL_PATH_RESOLUTION_FAILED/,
      "fail-closed statSync EACCES error",
      { fsOps: errorFs }
    );

    // Symlink recursion depth overflow (> MAX_SYMLINK_DEPTH)
    const loopLinkA = path.resolve("/depth_loop/a");
    const loopLinkB = path.resolve("/depth_loop/b");
    const enoentErr = (): never => {
      const e = new Error("ENOENT") as NodeJS.ErrnoException;
      e.code = "ENOENT";
      throw e;
    };
    const depthOverflowFs: CanonicalPathFs = {
      realpathSync: (p: string) => {
        const rp = path.resolve(p);
        if (rp === path.resolve("/depth_loop")) return rp;
        return enoentErr();
      },
      lstatSync: (p: string) => {
        const rp = path.resolve(p);
        if (rp === loopLinkA || rp === loopLinkB) return { isSymbolicLink: () => true };
        if (rp === path.resolve("/depth_loop") || rp === path.parse(rp).root) {
          return { isSymbolicLink: () => false };
        }
        return enoentErr();
      },
      readlinkSync: (p: string) => {
        const rp = path.resolve(p);
        if (rp === loopLinkA) return path.join(loopLinkB, "tail");
        if (rp === loopLinkB) return path.join(loopLinkA, "tail");
        throw new Error("EINVAL");
      }
    };
    assert.throws(
      () => resolveCanonicalFilesystemPath(path.join(loopLinkA, "aico.db"), depthOverflowFs),
      /CANONICAL_PATH_RESOLUTION_FAILED/
    );
  });

  // Scenario 17: Negative false-positive checks and malformed/null-byte/empty path rejection
  await suite.test("17. Allows :memory: and sandbox.db paths while rejecting raw & encoded null bytes and empty/malformed paths", () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "aico-prod-guard-negative-"));

    try {
      // 17.1 In-memory SQLite paths must succeed
      for (const memPath of [":memory:", "file::memory:?cache=shared"]) {
        const parsed = normalizeSqlDatabasePath(memPath);
        assert.equal(parsed.isMemory, true, `${memPath} must normalize with isMemory=true`);
        assert.doesNotThrow(
          () => assertSafeNonProductionDbPath(memPath),
          `assertSafeNonProductionDbPath must allow in-memory path ${memPath}`
        );
        const runner = new MigrationRunner(new ConnectionManager(memPath));
        assert.doesNotThrow(
          () => runner.assertNonProductionDatabase(),
          `In-memory path ${memPath} must not be blocked`
        );
      }

      const memApplied = new MigrationRunner(new ConnectionManager(":memory:")).getAppliedMigrations();
      assert.equal(memApplied.size, 0);

      // 17.2 Allowed sandbox.db paths (company-mcp/data/sandbox.db and temp sandbox.db)
      const companyMcpSandboxPath = path.resolve(__testDir, "../data/sandbox.db");
      const allowedSandboxPaths = [
        "company-mcp/data/sandbox.db",
        companyMcpSandboxPath,
        "data/sandbox.db",
        path.join(tempDir, "data", "sandbox.db"),
        path.join(tempDir, "sandbox.db")
      ];
      for (const safePath of allowedSandboxPaths) {
        const runner = new MigrationRunner(new ConnectionManager(safePath));
        assert.doesNotThrow(
          () => runner.assertNonProductionDatabase(),
          `Allowed sandbox path ${safePath} must not throw`
        );
      }

      // Temp sandbox.db executes full migration cleanly
      const tempSandboxDb = path.join(tempDir, "sandbox.db");
      const tempRunner = new MigrationRunner(new ConnectionManager(tempSandboxDb));
      const migrationRes = tempRunner.runMigrations([migrationV050V3Foundation]);
      assert.equal(migrationRes.applied.length, 1);

      // 17.3 Raw & percent-encoded null byte injection must throw cleanly
      for (const nullPath of [
        "sandbox.db\0data/aico.db",
        "data/aico.db\0.sqlite",
        "\0",
        "file:./data/aico.db%00",
        "file:./sandbox.db%00.sqlite"
      ]) {
        assert.throws(() => normalizeSqlDatabasePath(nullPath), /PRODUCTION_DB_MIGRATION_PROHIBITED/);
        assert.throws(() => assertSafeNonProductionDbPath(nullPath), /PRODUCTION_DB_MIGRATION_PROHIBITED/);
        assertRunnerBlocksAllOperations(
          nullPath,
          /PRODUCTION_DB_MIGRATION_PROHIBITED/,
          `null byte path ${JSON.stringify(nullPath)}`
        );
      }

      // 17.4 Empty / whitespace / malformed file URI paths must throw cleanly
      for (const invalidPath of ["", "   ", "\t\n", "file:?mode=rwc", "file:./sandbox%ZZ.db"]) {
        assert.throws(() => normalizeSqlDatabasePath(invalidPath), /INVALID_DB_PATH/);
        assertRunnerBlocksAllOperations(
          invalidPath,
          /INVALID_DB_PATH/,
          `invalid path ${JSON.stringify(invalidPath)}`
        );
      }
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
