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
import {
  V3_ENTITY_STORAGE_MAPPINGS,
  V3_ENTITY_PERSISTENCE_ADAPTERS,
  EntityPersistenceAdapter,
  V3EntityTypeMap,
  V3DbRowTypeMap,
  booleanToSqlInt,
  sqlIntToBoolean,
  parseJsonStringArray,
  parseJsonPlainObject,
  toChatRoomDbRow,
  fromChatRoomDbRow,
  toChatMemberDbRow,
  fromChatMemberDbRow,
  toChatMessageDbRow,
  fromChatMessageDbRow,
  toMessageAttachmentDbRow,
  fromMessageAttachmentDbRow,
  toMessageReactionDbRow,
  fromMessageReactionDbRow,
  toRoomInviteDbRow,
  fromRoomInviteDbRow,
  toRoomAuditLogDbRow,
  fromRoomAuditLogDbRow,
  toOutboxEventDbRow,
  fromOutboxEventDbRow,
  toEventSubscriptionDbRow,
  fromEventSubscriptionDbRow,
  toDeadLetterQueueDbRow,
  fromDeadLetterQueueDbRow,
  toDeliveryAttemptDbRow,
  fromDeliveryAttemptDbRow,
  toAgentLeaseDbRow,
  fromAgentLeaseDbRow,
  toAgentHeartbeatDbRow,
  fromAgentHeartbeatDbRow,
  toAgentCapabilityDbRow,
  fromAgentCapabilityDbRow,
  toAgentQuotaAllocationDbRow,
  fromAgentQuotaAllocationDbRow,
  toAgentExecutionLockDbRow,
  fromAgentExecutionLockDbRow,
  toProjectTaskV3DbRow,
  fromProjectTaskV3DbRow,
  toTaskTransitionLogDbRow,
  fromTaskTransitionLogDbRow,
  toTaskApprovalBindingDbRow,
  fromTaskApprovalBindingDbRow,
  toReviewAssignmentDbRow,
  fromReviewAssignmentDbRow,
  toArtifactAttestationDbRow,
  fromArtifactAttestationDbRow,
  toMemoryRecordV3DbRow,
  fromMemoryRecordV3DbRow,
  toKnowledgeChunkFTSDbRow,
  fromKnowledgeChunkFTSDbRow,
  toContextSnapshotDbRow,
  fromContextSnapshotDbRow,
  insertChatRoom,
  getChatRoomById,
  insertChatMember,
  getChatMemberById,
  insertChatMessage,
  getChatMessageById,
  insertMessageAttachment,
  getMessageAttachmentById,
  insertMessageReaction,
  getMessageReactionById,
  insertRoomInvite,
  getRoomInviteById,
  insertRoomAuditLog,
  getRoomAuditLogById,
  insertOutboxEvent,
  getOutboxEventById,
  insertEventSubscription,
  getEventSubscriptionById,
  insertDeadLetterQueue,
  getDeadLetterQueueById,
  insertDeliveryAttempt,
  getDeliveryAttemptById,
  insertAgentLease,
  getAgentLeaseById,
  insertAgentHeartbeat,
  getAgentHeartbeatById,
  insertAgentCapability,
  getAgentCapabilityById,
  insertAgentQuotaAllocation,
  getAgentQuotaAllocationById,
  insertAgentExecutionLock,
  getAgentExecutionLockById,
  insertProjectTaskV3,
  getProjectTaskV3ById,
  insertTaskTransitionLog,
  getTaskTransitionLogById,
  insertTaskApprovalBinding,
  getTaskApprovalBindingById,
  insertReviewAssignment,
  getReviewAssignmentById,
  insertArtifactAttestation,
  getArtifactAttestationById,
  insertMemoryRecordV3,
  getMemoryRecordV3ById,
  insertKnowledgeChunkFTS,
  getKnowledgeChunkFTSById,
  insertContextSnapshot,
  getContextSnapshotById
} from "../src/db/v3-storage-mappers.js";
import {
  AgentCapability,
  AgentExecutionLock,
  AgentHeartbeat,
  AgentLease,
  AgentQuotaAllocation,
  ArtifactAttestation,
  ChatMember,
  ChatMessage,
  ChatRoom,
  ContextSnapshot,
  DeadLetterQueue,
  DeliveryAttempt,
  EventSubscription,
  KnowledgeChunkFTS,
  MemoryRecordV3,
  MessageAttachment,
  MessageReaction,
  OutboxEvent,
  ProjectTaskV3,
  ReviewAssignment,
  RoomAuditLog,
  RoomInvite,
  TaskApprovalBinding,
  TaskTransitionLog,
  toPublicAgentCapabilityDTO,
  toPublicAgentExecutionLockDTO,
  toPublicAgentHeartbeatDTO,
  toPublicAgentLeaseDTO,
  toPublicAgentQuotaAllocationDTO,
  toPublicArtifactAttestationDTO,
  toPublicChatMemberDTO,
  toPublicChatMessageDTO,
  toPublicChatRoomDTO,
  toPublicContextSnapshotDTO,
  toPublicDeadLetterQueueDTO,
  toPublicDeliveryAttemptDTO,
  toPublicEventSubscriptionDTO,
  toPublicKnowledgeChunkFTSDTO,
  toPublicMemoryRecordV3DTO,
  toPublicMessageAttachmentDTO,
  toPublicMessageReactionDTO,
  toPublicOutboxEventDTO,
  toPublicProjectTaskV3DTO,
  toPublicReviewAssignmentDTO,
  toPublicRoomAuditLogDTO,
  toPublicRoomInviteDTO,
  toPublicTaskApprovalBindingDTO,
  toPublicTaskTransitionLogDTO
} from "../src/domain/index.js";
import { SecretScanner } from "../src/security/secret-scanner.js";

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

interface SqlitePragmaColumnInfo {
  name: string;
  type: string;
  notnull: number;
  dflt_value: string | null;
}

function getTableColumnsMap(db: DatabaseSync, tableName: string): Map<string, SqlitePragmaColumnInfo> {
  const rows = db.prepare(`PRAGMA table_info(${tableName})`).all() as unknown as SqlitePragmaColumnInfo[];
  return new Map(rows.map((r) => [r.name, r]));
}

function assertInternalStorageColumnParity(db: DatabaseSync): void {
  const chatMsgCols = getTableColumnsMap(db, "chat_messages");
  for (const colName of ["metadata_json", "internal_metadata_json"]) {
    const col = chatMsgCols.get(colName);
    assert.ok(col, `chat_messages.${colName} must exist`);
    assert.equal(col.type, "TEXT", `chat_messages.${colName} must be TEXT`);
    assert.equal(col.notnull, 1, `chat_messages.${colName} must be NOT NULL`);
    assert.equal(col.dflt_value, "'{}'", `chat_messages.${colName} default must be '{}'`);
  }
  assert.ok(chatMsgCols.has("mentions_json"), "chat_messages.mentions_json must exist");
  assert.ok(chatMsgCols.has("raw_token_trace"), "chat_messages.raw_token_trace must exist");
  assert.ok(chatMsgCols.has("is_edited"), "chat_messages.is_edited must exist");

  const auditCols = getTableColumnsMap(db, "room_audit_logs");
  for (const colName of ["details_json", "internal_details_json"]) {
    const col = auditCols.get(colName);
    assert.ok(col, `room_audit_logs.${colName} must exist`);
    assert.equal(col.type, "TEXT", `room_audit_logs.${colName} must be TEXT`);
    assert.equal(col.notnull, 1, `room_audit_logs.${colName} must be NOT NULL`);
    assert.equal(col.dflt_value, "'{}'", `room_audit_logs.${colName} default must be '{}'`);
  }
  assert.ok(auditCols.has("security_context_snapshot"), "room_audit_logs.security_context_snapshot must exist");
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

  // Scenario 18: Schema Column Parity, Declarative Storage Mapping Contract & Bidirectional Mappers
  await suite.test("18. Schema column parity, declarative 24-entity storage mappings, bidirectional row mappers & fail-closed validation", () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "aico-schema-parity-"));
    const sandboxDbPath = path.join(tempDir, "schema_parity_sandbox.db");

    try {
      const conn = new ConnectionManager(sandboxDbPath);
      const runner = new MigrationRunner(conn);
      runner.runMigrations([migrationV050V3Foundation]);

      // 18.1 Verify SQLite PRAGMA table_info parity for chat_messages, room_audit_logs, and all 24 domain entities
      conn.withReadTransaction((db) => {
        assertInternalStorageColumnParity(db);

        const mappingKeys = Object.keys(V3_ENTITY_STORAGE_MAPPINGS);
        assert.equal(mappingKeys.length, 24, "V3_ENTITY_STORAGE_MAPPINGS must cover all 24 V3 domain entities");

        const expectedEntities = [
          "ChatRoom",
          "ChatMember",
          "ChatMessage",
          "MessageAttachment",
          "MessageReaction",
          "RoomInvite",
          "RoomAuditLog",
          "OutboxEvent",
          "EventSubscription",
          "DeadLetterQueue",
          "DeliveryAttempt",
          "AgentLease",
          "AgentHeartbeat",
          "AgentCapability",
          "AgentQuotaAllocation",
          "AgentExecutionLock",
          "ProjectTaskV3",
          "TaskTransitionLog",
          "TaskApprovalBinding",
          "ReviewAssignment",
          "ArtifactAttestation",
          "MemoryRecordV3",
          "KnowledgeChunkFTS",
          "ContextSnapshot"
        ];
        assert.deepEqual(
          new Set(mappingKeys),
          new Set(expectedEntities),
          "V3_ENTITY_STORAGE_MAPPINGS keys must match all 24 canonical entities"
        );

        for (const entityKey of expectedEntities) {
          const mapping = V3_ENTITY_STORAGE_MAPPINGS[entityKey as keyof typeof V3_ENTITY_STORAGE_MAPPINGS];
          const tableColumnMaps = new Map<string, Map<string, SqlitePragmaColumnInfo>>();

          for (const tableName of mapping.tables) {
            const cols = getTableColumnsMap(db, tableName);
            assert.ok(cols.size > 0, `Table '${tableName}' for entity '${entityKey}' must exist in migrated SQLite DB`);
            assert.ok(
              cols.has(mapping.primaryKey),
              `Table '${tableName}' for entity '${entityKey}' must contain primaryKey '${mapping.primaryKey}'`
            );
            tableColumnMaps.set(tableName, cols);
          }

          for (const jsonCol of mapping.jsonColumns) {
            const targetTable = mapping.tables[0];
            assert.ok(
              tableColumnMaps.get(targetTable)!.has(jsonCol.dbColumn),
              `${entityKey}.${jsonCol.domainField} -> ${targetTable}.${jsonCol.dbColumn} must exist in SQLite`
            );
          }

          for (const boolCol of mapping.booleanColumns) {
            const targetTable = mapping.tables[0];
            assert.ok(
              tableColumnMaps.get(targetTable)!.has(boolCol.dbColumn),
              `${entityKey}.${boolCol.domainField} -> ${targetTable}.${boolCol.dbColumn} must exist in SQLite`
            );
          }

          for (const internalCol of mapping.internalColumns) {
            const targetTable = ("dbTable" in internalCol && internalCol.dbTable) ? internalCol.dbTable : mapping.tables[0];
            assert.ok(
              tableColumnMaps.get(targetTable)!.has(internalCol.dbColumn),
              `${entityKey} internal column ${targetTable}.${internalCol.dbColumn} must exist in SQLite`
            );
          }
        }

        // Verify KnowledgeChunkFTS 1-to-2 split contract across knowledge_chunks_meta and knowledge_chunks_fts
        const kcMapping = V3_ENTITY_STORAGE_MAPPINGS.KnowledgeChunkFTS;
        assert.equal(kcMapping.storageModel, "split_meta_and_fts5");
        assert.deepEqual([...kcMapping.tables], ["knowledge_chunks_meta", "knowledge_chunks_fts"]);
        for (const splitCol of kcMapping.splitColumns) {
          const cols = getTableColumnsMap(db, splitCol.dbTable);
          assert.ok(
            cols.has(splitCol.dbColumn),
            `KnowledgeChunkFTS split column ${splitCol.dbTable}.${splitCol.dbColumn} must exist in SQLite`
          );
        }
        const tagsSplit = kcMapping.splitColumns.find((c) => c.domainField === "tags");
        assert.equal(tagsSplit?.dbTable, "knowledge_chunks_fts");
        assert.equal(tagsSplit?.serialization, "fts5_text");
      });

      // 18.2 Bidirectional row mappers across all 8 typed row-mapped entities
      const ts = "2026-11-11T07:30:00Z";

      for (const archivedFlag of [true, false]) {
        const room: ChatRoom = {
          room_id: `room-${archivedFlag ? "arch" : "open"}`,
          slug: `room-slug-${archivedFlag ? "arch" : "open"}`,
          name: "Engineering Sync",
          room_type: "PROJECT_ROOM",
          project_id: archivedFlag ? "proj-1" : null,
          task_id: archivedFlag ? "task-1" : null,
          created_by: "flash-01",
          is_archived: archivedFlag,
          internal_notes: archivedFlag ? "private archive note" : null,
          created_at: ts,
          updated_at: ts
        };
        const roomRow = toChatRoomDbRow(room);
        assert.equal(roomRow.is_archived, archivedFlag ? 1 : 0);
        assert.deepEqual(fromChatRoomDbRow(roomRow), room);
      }

      for (const editedFlag of [true, false]) {
        const msg: ChatMessage = {
          message_id: `msg-${editedFlag ? "ed" : "orig"}`,
          room_id: "room-1",
          sender_id: "flash-02",
          sender_type: "agent",
          message_type: "REVIEW_FEEDBACK",
          content: "Schema parity check passed.",
          reply_to_id: editedFlag ? "msg-0" : null,
          mentions: editedFlag ? ["flash-01", "codex-01"] : [],
          metadata: editedFlag ? { thread_title: "Parity", tags: ["v3", "g2"] } : {},
          internal_metadata: editedFlag ? { trace_id: "tr-123", nested: { ok: true } } : {},
          raw_token_trace: editedFlag ? "trace_secret_payload" : null,
          is_edited: editedFlag,
          created_at: ts,
          updated_at: ts
        };
        const msgRow = toChatMessageDbRow(msg);
        assert.equal(msgRow.is_edited, editedFlag ? 1 : 0);
        assert.equal(typeof msgRow.mentions_json, "string");
        assert.equal(typeof msgRow.metadata_json, "string");
        assert.equal(typeof msgRow.internal_metadata_json, "string");
        assert.deepEqual(fromChatMessageDbRow(msgRow), msg);
      }

      const auditLog: RoomAuditLog = {
        audit_id: "audit-1",
        room_id: "room-1",
        action: "role_updated",
        actor_id: "flash-01",
        details: { target: "codex-01", previous_role: "observer", new_role: "member" },
        internal_details: { ip: "127.0.0.1", token_fingerprint: "sha256:abcd" },
        security_context_snapshot: '{"session":"internal"}',
        created_at: ts
      };
      const auditRow = toRoomAuditLogDbRow(auditLog);
      assert.equal(auditRow.details_json, JSON.stringify(auditLog.details));
      assert.equal(auditRow.internal_details_json, JSON.stringify(auditLog.internal_details));
      assert.deepEqual(fromRoomAuditLogDbRow(auditRow), auditLog);

      const outboxEvent: OutboxEvent = {
        event_id: "evt-1",
        aggregate_type: "task",
        aggregate_id: "task-99",
        event_type: "task.completed",
        payload: { status: "completed", nested: { score: 100 } },
        status: "published",
        retry_count: 1,
        max_retries: 5,
        last_error: null,
        internal_routing_key: "rk.internal.tasks.99",
        scheduled_for: ts,
        processed_at: ts,
        created_at: ts
      };
      const outboxRow = toOutboxEventDbRow(outboxEvent);
      assert.equal(outboxRow.payload_json, JSON.stringify(outboxEvent.payload));
      assert.deepEqual(fromOutboxEventDbRow(outboxRow), outboxEvent);

      for (const activeFlag of [true, false]) {
        const sub: EventSubscription = {
          subscription_id: `sub-${activeFlag ? "on" : "off"}`,
          subscriber_id: "worker-01",
          event_pattern: "task.*",
          endpoint: "https://internal.example.local/hooks/events",
          is_active: activeFlag,
          auth_secret_hash: activeFlag ? "hash-abc123" : null,
          created_at: ts,
          updated_at: ts
        };
        const subRow = toEventSubscriptionDbRow(sub);
        assert.equal(subRow.is_active, activeFlag ? 1 : 0);
        assert.deepEqual(fromEventSubscriptionDbRow(subRow), sub);
      }

      for (const resolvedFlag of [true, false]) {
        const dlq: DeadLetterQueue = {
          dlq_id: `dlq-${resolvedFlag ? "res" : "open"}`,
          original_event_id: "evt-fail-1",
          event_type: "task.failed",
          payload: { attempt: 5, reason: "timeout" },
          failure_reason: "Downstream timeout after 5 attempts",
          stack_trace: "Error: timeout\n  at dispatch()",
          resolved: resolvedFlag,
          resolved_by: resolvedFlag ? "flash-02" : null,
          resolved_at: resolvedFlag ? ts : null,
          failed_at: ts
        };
        const dlqRow = toDeadLetterQueueDbRow(dlq);
        assert.equal(dlqRow.resolved, resolvedFlag ? 1 : 0);
        assert.equal(dlqRow.payload_json, JSON.stringify(dlq.payload));
        assert.deepEqual(fromDeadLetterQueueDbRow(dlqRow), dlq);
      }

      const task: ProjectTaskV3 = {
        task_id: "task-v3-1",
        project_id: "proj-v3",
        parent_task_id: "task-v3-0",
        title: "Verify storage mappers",
        objective: "Ensure lossless round-trip mapping",
        risk_class: "high",
        priority: "high",
        execution_status: "in_progress",
        dispatch_status: "external_running",
        assigned_agent_id: "codex-01",
        reviewer_agent_id: "flash-02",
        version: 2,
        token_budget: 50000,
        token_used: 1200,
        acceptance_criteria: ["All 24 mappings verified", "Zero silent coercion"],
        internal_evaluation_notes: "QA trace: strict Zod schema intact",
        created_at: ts,
        updated_at: ts
      };
      const taskRow = toProjectTaskV3DbRow(task);
      assert.equal(taskRow.acceptance_criteria_json, JSON.stringify(task.acceptance_criteria));
      assert.deepEqual(fromProjectTaskV3DbRow(taskRow), task);

      for (const enabledFlag of [true, false]) {
        const cap: AgentCapability = {
          capability_id: `cap-${enabledFlag ? "on" : "off"}`,
          agent_id: "flash-02",
          capability_name: "qa-regression-testing",
          version: "1.2.0",
          is_enabled: enabledFlag,
          proficiency: enabledFlag ? "specialist" : "supporting",
          internal_evaluation_score: enabledFlag ? 0.98 : null,
          granted_at: ts
        };
        const capRow = toAgentCapabilityDbRow(cap);
        assert.equal(capRow.is_enabled, enabledFlag ? 1 : 0);
        assert.deepEqual(fromAgentCapabilityDbRow(capRow), cap);
      }

      // 18.3 Fail-closed primitive & row parser validation
      assert.equal(booleanToSqlInt(true), 1);
      assert.equal(booleanToSqlInt(false), 0);
      assert.throws(() => booleanToSqlInt(1 as unknown as boolean), TypeError);

      assert.equal(sqlIntToBoolean(0, "test_flag"), false);
      assert.equal(sqlIntToBoolean(1, "test_flag"), true);
      assert.equal(sqlIntToBoolean(false, "test_flag"), false);
      assert.equal(sqlIntToBoolean(true, "test_flag"), true);
      for (const badBool of [2, -1, "1", null, undefined]) {
        assert.throws(
          () => sqlIntToBoolean(badBool as unknown as number, "test_flag"),
          /Invalid SQL boolean value/
        );
      }

      assert.deepEqual(parseJsonStringArray('["a","b"]', "arr"), ["a", "b"]);
      assert.throws(() => parseJsonStringArray('["unclosed', "arr"), /Invalid JSON/);
      assert.throws(() => parseJsonStringArray('{"a":1}', "arr"), /Invalid JSON array/);
      assert.throws(() => parseJsonStringArray('null', "arr"), /Invalid JSON array/);
      assert.throws(() => parseJsonStringArray('["ok", 42]', "arr"), /Invalid JSON string array item/);
      assert.throws(() => parseJsonStringArray(null as unknown as string, "arr"), /Invalid JSON string/);

      assert.deepEqual(parseJsonPlainObject('{"k":1}', "obj"), { k: 1 });
      assert.throws(() => parseJsonPlainObject("{bad", "obj"), /Invalid JSON/);
      assert.throws(() => parseJsonPlainObject("[]", "obj"), /Invalid JSON object/);
      assert.throws(() => parseJsonPlainObject("null", "obj"), /Invalid JSON object/);
      assert.throws(() => parseJsonPlainObject('"primitive"', "obj"), /Invalid JSON object/);
      assert.throws(() => parseJsonPlainObject(123 as unknown as string, "obj"), /Invalid JSON string/);

      const validMsgRow = toChatMessageDbRow({
        message_id: "msg-valid-base",
        room_id: "room-1",
        sender_id: "flash-02",
        sender_type: "agent",
        message_type: "TEXT",
        content: "Clean baseline content",
        reply_to_id: null,
        mentions: [],
        metadata: {},
        internal_metadata: {},
        raw_token_trace: null,
        is_edited: false,
        created_at: ts,
        updated_at: ts
      });

      for (const [patch, label] of [
        [{ mentions_json: "{not-json" }, "malformed mentions_json"],
        [{ mentions_json: '{"not":"array"}' }, "non-array mentions_json"],
        [{ mentions_json: '[123]' }, "wrong element type in mentions_json"],
        [{ metadata_json: "[]" }, "non-object array in metadata_json"],
        [{ internal_metadata_json: "[]" }, "non-object array in internal_metadata_json"],
        [{ internal_metadata_json: "{broken" }, "malformed internal_metadata_json"],
        [{ is_edited: 2 }, "invalid SQL boolean is_edited=2"],
        [{ created_at: "not-a-timestamp" }, "invalid created_at timestamp"],
        [{ sender_type: "alien" }, "invalid sender_type enum"],
        [{ message_type: "BOGUS" }, "invalid message_type enum"]
      ] as const) {
        assert.throws(
          () => fromChatMessageDbRow({ ...validMsgRow, ...patch }),
          `fromChatMessageDbRow must fail closed on ${label}`
        );
      }

      const validAuditRow = toRoomAuditLogDbRow(auditLog);
      for (const [patch, label] of [
        [{ details_json: "{bad" }, "malformed details_json"],
        [{ details_json: "[]" }, "non-object array in details_json"],
        [{ internal_details_json: "{bad" }, "malformed internal_details_json"],
        [{ internal_details_json: "[]" }, "non-object array in internal_details_json"],
        [{ action: "unknown_action" }, "invalid RoomAuditLog action enum"],
        [{ created_at: "invalid-date" }, "invalid RoomAuditLog created_at timestamp"]
      ] as const) {
        assert.throws(
          () => fromRoomAuditLogDbRow({ ...validAuditRow, ...patch }),
          `fromRoomAuditLogDbRow must fail closed on ${label}`
        );
      }
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  // Scenario 19: End-to-End SQLite Sandbox DB Round-Trip Persistence & Public DTO Projection
  await suite.test("19. End-to-end SQLite sandbox round-trip preserves internal fields while public DTO projections strip & redact secrets (including after rollback/remigrate)", () => {
    const ctx = createSandboxTestContext("aico-v3-roundtrip-");

    try {
      const conn = new ConnectionManager(ctx.dbPath);
      const runner = new MigrationRunner(conn);
      runner.runMigrations([migrationV050V3Foundation]);

      const ts = "2026-11-11T07:35:00Z";
      const secretOpenAi = "sk-proj-secret1234567890abcdef";
      const secretAllowlistedOpenAi = "sk-proj-allowlisted1234567890abcdef";
      const secretAuditAllowlisted = "sk-proj-auditsecret1234567890abcdef";
      const secretLegacyAgent = "aico_flash-02_0123456789abcdef0123456789abcdef0123456789abcdef";
      const secretJwt =
        "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c";
      const secretGithub = "ghp_1234567890abcdefghij1234567890abcd";
      const secretAnthropic = "sk-ant-api03-secretvalue1234567890abcdef";
      const secretGoogle = "AIzaSyDaGmWKa4JsXZ-HjGw7ISLn_3namBGt2EX";
      const secretSession = "aico_session_0123456789abcdef0123456789";
      const secretHmacEnv = "AICO_AUDIT_HMAC_KEY=super_secret_hmac_key_value_123456";

      const room: ChatRoom = {
        room_id: "room-roundtrip-1",
        slug: "v3-roundtrip-room",
        name: "V3 Roundtrip Verification Room",
        room_type: "PROJECT_ROOM",
        project_id: "proj-v3",
        task_id: "task-v3-g2",
        created_by: "flash-02",
        is_archived: false,
        internal_notes: "Private room orchestration notes",
        created_at: ts,
        updated_at: ts
      };

      const message: ChatMessage = {
        message_id: "msg-roundtrip-1",
        room_id: room.room_id,
        sender_id: "flash-02",
        sender_type: "agent",
        message_type: "DIRECTIVE",
        content: "Execute sandbox round-trip verification.",
        reply_to_id: null,
        mentions: ["flash-01", "codex-01"],
        metadata: {
          thread_title: "Gate V3-G2 Round-Trip",
          topic: `Sanitized allowlisted topic with token ${secretAllowlistedOpenAi}`,
          priority_label: "high",
          ui_display_mode: "standard",
          tags: ["v3", "sqlite-roundtrip"],
          non_allowlisted_headers: { authorization: `Bearer ${secretJwt}` },
          non_allowlisted_token: secretGithub,
          non_allowlisted_nested: { anthropic_key: secretAnthropic }
        },
        internal_metadata: {
          trace: {
            api_key: secretOpenAi,
            agent_token: secretLegacyAgent
          },
          span_id: "span-roundtrip-01"
        },
        raw_token_trace: `raw-auth-header=Bearer ${secretJwt}`,
        is_edited: true,
        created_at: ts,
        updated_at: ts
      };

      const auditLog: RoomAuditLog = {
        audit_id: "audit-roundtrip-1",
        room_id: room.room_id,
        action: "member_added",
        actor_id: "flash-01",
        details: {
          target: "codex-01",
          target_principal_id: "codex-01",
          new_role: "member",
          reason: `Provisioned after stripping ${secretAuditAllowlisted}`,
          summary: "Added implementation engineer",
          non_allowlisted_ip: "10.10.0.5",
          non_allowlisted_cloud: { gcp_key: secretGoogle }
        },
        internal_details: {
          signer: "flash-01",
          hmac_assignment: secretHmacEnv,
          nested_approval: { quorum: 2 }
        },
        security_context_snapshot: JSON.stringify({
          session_token: secretSession,
          mfa: true
        }),
        created_at: ts
      };

      conn.withWriteTransaction((db) => {
        insertChatRoom(db, room);
        insertChatMessage(db, message);
        insertRoomAuditLog(db, auditLog);
      });

      conn.withReadTransaction((db) => {
        // Verify ChatRoom persistence & null lookup
        assert.deepEqual(getChatRoomById(db, room.room_id), room);
        assert.equal(getChatRoomById(db, "non-existent-room"), null);

        // Verify raw SQLite storage columns persisted verbatim for ChatMessage
        const rawMsgCols = db
          .prepare(
            "SELECT internal_metadata_json, raw_token_trace, metadata_json, mentions_json, is_edited FROM chat_messages WHERE message_id = ?"
          )
          .get(message.message_id) as {
          internal_metadata_json: string;
          raw_token_trace: string | null;
          metadata_json: string;
          mentions_json: string;
          is_edited: number;
        };
        assert.equal(rawMsgCols.internal_metadata_json, JSON.stringify(message.internal_metadata));
        assert.deepEqual(JSON.parse(rawMsgCols.internal_metadata_json), message.internal_metadata);
        assert.equal(rawMsgCols.raw_token_trace, message.raw_token_trace);
        assert.equal(rawMsgCols.metadata_json, JSON.stringify(message.metadata));
        assert.equal(rawMsgCols.mentions_json, JSON.stringify(message.mentions));
        assert.equal(rawMsgCols.is_edited, 1);

        // Verify raw SQLite storage columns persisted verbatim for RoomAuditLog
        const rawAuditCols = db
          .prepare(
            "SELECT internal_details_json, security_context_snapshot, details_json FROM room_audit_logs WHERE audit_id = ?"
          )
          .get(auditLog.audit_id) as {
          internal_details_json: string;
          security_context_snapshot: string | null;
          details_json: string;
        };
        assert.equal(rawAuditCols.internal_details_json, JSON.stringify(auditLog.internal_details));
        assert.deepEqual(JSON.parse(rawAuditCols.internal_details_json), auditLog.internal_details);
        assert.equal(rawAuditCols.security_context_snapshot, auditLog.security_context_snapshot);
        assert.equal(rawAuditCols.details_json, JSON.stringify(auditLog.details));

        // Verify hydrated domain objects match originals losslessly
        const hydratedMessage = getChatMessageById(db, message.message_id);
        const hydratedAuditLog = getRoomAuditLogById(db, auditLog.audit_id);
        assert.ok(hydratedMessage !== null);
        assert.ok(hydratedAuditLog !== null);
        assert.deepEqual(hydratedMessage, message);
        assert.deepEqual(hydratedAuditLog, auditLog);
        assert.equal(getChatMessageById(db, "non-existent-msg"), null);
        assert.equal(getRoomAuditLogById(db, "non-existent-audit"), null);

        // Project through public DTO boundaries
        const msgDto = toPublicChatMessageDTO(hydratedMessage);
        const auditDto = toPublicRoomAuditLogDTO(hydratedAuditLog);

        assert.equal("internal_metadata" in msgDto, false, "internal_metadata must be absent from PublicChatMessageDTO");
        assert.equal("raw_token_trace" in msgDto, false, "raw_token_trace must be absent from PublicChatMessageDTO");
        assert.equal("internal_details" in auditDto, false, "internal_details must be absent from PublicRoomAuditLogDTO");
        assert.equal(
          "security_context_snapshot" in auditDto,
          false,
          "security_context_snapshot must be absent from PublicRoomAuditLogDTO"
        );

        // Un-allowlisted metadata & details keys must be stripped
        assert.equal("non_allowlisted_headers" in msgDto.metadata, false);
        assert.equal("non_allowlisted_token" in msgDto.metadata, false);
        assert.equal("non_allowlisted_nested" in msgDto.metadata, false);
        assert.equal("non_allowlisted_ip" in auditDto.details, false);
        assert.equal("non_allowlisted_cloud" in auditDto.details, false);

        // Allowlisted keys remain intact with embedded secrets redacted
        assert.equal(msgDto.metadata.thread_title, "Gate V3-G2 Round-Trip");
        assert.equal(msgDto.metadata.priority_label, "high");
        assert.equal(msgDto.metadata.ui_display_mode, "standard");
        assert.deepEqual(msgDto.metadata.tags, ["v3", "sqlite-roundtrip"]);
        assert.equal(msgDto.metadata.topic, "Sanitized allowlisted topic with token [REDACTED_SECRET]");

        assert.equal(auditDto.details.target, "codex-01");
        assert.equal(auditDto.details.target_principal_id, "codex-01");
        assert.equal(auditDto.details.new_role, "member");
        assert.equal(auditDto.details.summary, "Added implementation engineer");
        assert.equal(auditDto.details.reason, "Provisioned after stripping [REDACTED_SECRET]");

        // Zero secret leakage in serialized DTO JSON
        const serializedMsgDto = JSON.stringify(msgDto);
        const serializedAuditDto = JSON.stringify(auditDto);
        for (const forbiddenSecret of [
          secretOpenAi,
          secretAllowlistedOpenAi,
          secretAuditAllowlisted,
          secretLegacyAgent,
          secretJwt,
          secretGithub,
          secretAnthropic,
          secretGoogle,
          secretSession,
          "super_secret_hmac_key_value_123456"
        ]) {
          assert.equal(
            serializedMsgDto.includes(forbiddenSecret),
            false,
            `PublicChatMessageDTO JSON must not leak secret substring ${forbiddenSecret.slice(0, 12)}`
          );
          assert.equal(
            serializedAuditDto.includes(forbiddenSecret),
            false,
            `PublicRoomAuditLogDTO JSON must not leak secret substring ${forbiddenSecret.slice(0, 12)}`
          );
        }
        assert.equal(SecretScanner.scan(serializedMsgDto).hasSecret, false);
        assert.equal(SecretScanner.scan(serializedAuditDto).hasSecret, false);
      });

      // Verify rollback and re-migration cleanly recreate internal_metadata_json & internal_details_json
      const rollbackResult = runner.rollbackMigration(migrationV050V3Foundation);
      assert.equal(rollbackResult.rolledBack, "20261110_003_v050_v3_foundation");

      conn.withReadTransaction((db) => {
        const remaining = db
          .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name IN ('chat_messages', 'room_audit_logs')")
          .all();
        assert.equal(remaining.length, 0, "chat_messages and room_audit_logs must be dropped on rollback");
      });

      const remigrateResult = runner.runMigrations([migrationV050V3Foundation]);
      assert.deepEqual(remigrateResult.applied, ["20261110_003_v050_v3_foundation"]);

      conn.withReadTransaction((db) => {
        assertInternalStorageColumnParity(db);
      });

      // Confirm fresh inserts & round-trip work identically after re-migration
      conn.withWriteTransaction((db) => {
        insertChatRoom(db, room);
        insertChatMessage(db, message);
        insertRoomAuditLog(db, auditLog);
      });
      conn.withReadTransaction((db) => {
        assert.deepEqual(getChatMessageById(db, message.message_id), message);
        assert.deepEqual(getRoomAuditLogById(db, auditLog.audit_id), auditLog);
      });
    } finally {
      ctx.cleanup();
    }
  });

  type V3EntityKey = keyof V3EntityTypeMap;

  function getPersistenceAdapter<K extends V3EntityKey>(
    entityName: K
  ): EntityPersistenceAdapter<V3EntityTypeMap[K], V3DbRowTypeMap[K]> {
    return V3_ENTITY_PERSISTENCE_ADAPTERS[entityName] as unknown as EntityPersistenceAdapter<
      V3EntityTypeMap[K],
      V3DbRowTypeMap[K]
    >;
  }

  interface Entity24Runner {
    entityName: V3EntityKey;
    id: string;
    verifyMapperRoundTrip: () => void;
    insertPrimary: (db: DatabaseSync) => void;
    verifySqliteAndDtoRoundTrip: (db: DatabaseSync) => void;
  }

  function createEntity24Spec<K extends V3EntityKey>(config: {
    entityName: K;
    id: string;
    primary: V3EntityTypeMap[K];
    alternate: V3EntityTypeMap[K];
    toDbRow: (entity: V3EntityTypeMap[K]) => V3DbRowTypeMap[K];
    fromDbRow: (row: V3DbRowTypeMap[K]) => V3EntityTypeMap[K];
    insert: (db: DatabaseSync, entity: V3EntityTypeMap[K]) => void;
    getById: (db: DatabaseSync, id: string) => V3EntityTypeMap[K] | null;
    toPublicDto: (entity: V3EntityTypeMap[K]) => object;
    omittedFields: readonly string[];
    secretSentinels: readonly string[];
    assertDbRow?: (row: V3DbRowTypeMap[K], variant: "primary" | "alternate") => void;
    assertPublicDto?: (dto: Record<string, unknown>) => void;
  }): Entity24Runner {
    const adapter = getPersistenceAdapter(config.entityName);

    return {
      entityName: config.entityName,
      id: config.id,
      verifyMapperRoundTrip: () => {
        assert.equal(
          adapter.mapping,
          V3_ENTITY_STORAGE_MAPPINGS[config.entityName],
          `Adapter for ${config.entityName} must bind its canonical V3_ENTITY_STORAGE_MAPPINGS entry`
        );

        for (const [variant, entity] of [
          ["primary", config.primary],
          ["alternate", config.alternate]
        ] as const) {
          const namedRow = config.toDbRow(entity);
          config.assertDbRow?.(namedRow, variant);
          assert.deepEqual(
            config.fromDbRow(namedRow),
            entity,
            `Named to/from DbRow round-trip failed for ${config.entityName} (${variant})`
          );

          const adapterRow = adapter.toDbRow(entity);
          assert.deepEqual(adapterRow, namedRow, `Adapter toDbRow mismatch for ${config.entityName} (${variant})`);
          assert.deepEqual(
            adapter.fromDbRow(adapterRow),
            entity,
            `Adapter fromDbRow round-trip failed for ${config.entityName} (${variant})`
          );
        }
      },
      insertPrimary: (db) => {
        config.insert(db, config.primary);
      },
      verifySqliteAndDtoRoundTrip: (db) => {
        const hydrated = config.getById(db, config.id);
        assert.ok(hydrated !== null, `getById returned null for inserted ${config.entityName} '${config.id}'`);
        assert.deepEqual(
          hydrated,
          config.primary,
          `Named SQLite round-trip mismatch for ${config.entityName}`
        );

        assert.equal(
          config.getById(db, `non-existent-${config.entityName}-id`),
          null,
          `Named getById must return null for missing ${config.entityName}`
        );

        const adapterHydrated = adapter.getById(db, config.id);
        assert.deepEqual(
          adapterHydrated,
          config.primary,
          `V3_ENTITY_PERSISTENCE_ADAPTERS['${config.entityName}'].getById mismatch`
        );

        const dto = config.toPublicDto(hydrated) as Record<string, unknown>;
        for (const omitted of config.omittedFields) {
          assert.equal(
            omitted in dto || Object.hasOwn(dto, omitted),
            false,
            `${config.entityName} public DTO must omit internal field '${omitted}'`
          );
        }

        const serializedDto = JSON.stringify(dto);
        for (const sentinel of config.secretSentinels) {
          assert.equal(
            serializedDto.includes(sentinel),
            false,
            `${config.entityName} public DTO JSON leaked secret sentinel '${sentinel.slice(0, 14)}'`
          );
        }
        assert.equal(
          SecretScanner.scan(serializedDto).hasSecret,
          false,
          `${config.entityName} public DTO JSON triggered SecretScanner`
        );

        config.assertPublicDto?.(dto);
      }
    };
  }

  function buildAll24EntityDataset(ts: string): {
    parentRootTask: ProjectTaskV3;
    knowledgeChunkPrimary: KnowledgeChunkFTS;
    specs: Entity24Runner[];
  } {
    const parentRootTask: ProjectTaskV3 = {
      task_id: "task-all24-parent-0",
      project_id: "proj-all24",
      parent_task_id: null,
      title: "Root Governance Parent Task",
      objective: "Anchor FK hierarchy for child ProjectTaskV3",
      risk_class: "low",
      priority: "medium",
      execution_status: "in_progress",
      dispatch_status: "operator_delivered",
      assigned_agent_id: "flash-01",
      reviewer_agent_id: "flash-02",
      version: 1,
      token_budget: 10000,
      token_used: 0,
      acceptance_criteria: [],
      internal_evaluation_notes: null,
      created_at: ts,
      updated_at: ts
    };

    const projectTaskPrimary: ProjectTaskV3 = {
      task_id: "task-all24-1",
      project_id: "proj-all24",
      parent_task_id: parentRootTask.task_id,
      title: "All-24 Persistence Verification Task",
      objective: "Verify lossless 24-entity DB round-trip and DTO stripping",
      risk_class: "high",
      priority: "critical",
      execution_status: "in_progress",
      dispatch_status: "external_running",
      assigned_agent_id: "codex-01",
      reviewer_agent_id: "flash-02",
      version: 3,
      token_budget: 80000,
      token_used: 4200,
      acceptance_criteria: ["24/24 round-trip", "Zero secret leakage"],
      internal_evaluation_notes: "Internal eval sk-proj-taskeval1234567890abcdef",
      created_at: ts,
      updated_at: ts
    };

    const chatRoomPrimary: ChatRoom = {
      room_id: "room-all24-1",
      slug: "all24-verification-room",
      name: "All-24 Verification Room",
      room_type: "PROJECT_ROOM",
      project_id: "proj-all24",
      task_id: projectTaskPrimary.task_id,
      created_by: "flash-02",
      is_archived: true,
      internal_notes: "Private room key sk-proj-roomnotes1234567890abcdef",
      created_at: ts,
      updated_at: ts
    };

    const outboxEventPrimary: OutboxEvent = {
      event_id: "evt-all24-1",
      aggregate_type: "task",
      aggregate_id: projectTaskPrimary.task_id,
      event_type: "task.all24.verified",
      payload: { token: "sk-proj-outboxpayload1234567890abcdef", attempt: 1 },
      status: "published",
      retry_count: 1,
      max_retries: 5,
      last_error: null,
      internal_routing_key: "rk.internal.ghp_1234567890outboxrk1234567890abcd",
      scheduled_for: ts,
      processed_at: ts,
      created_at: ts
    };

    const memoryRecordPrimary: MemoryRecordV3 = {
      memory_id: "mem-all24-1",
      owner_agent_id: "flash-02",
      scope: "PROJECT",
      category: "ARCHITECTURAL_DECISION",
      key: "v3.sqlite.split.persistence",
      content: "KnowledgeChunkFTS persists atomically across meta and FTS5 tables.",
      raw_context_bytes: "raw-context-sk-proj-memraw1234567890abcdef",
      access_count: 5,
      confidence_score: 0.95,
      created_at: ts,
      updated_at: ts
    };

    const chatMessagePrimary: ChatMessage = {
      message_id: "msg-all24-1",
      room_id: chatRoomPrimary.room_id,
      sender_id: "flash-02",
      sender_type: "agent",
      message_type: "DIRECTIVE",
      content: "Verify all 24 domain entities cleanly.",
      reply_to_id: null,
      mentions: ["flash-01", "codex-01"],
      metadata: {
        thread_title: "All-24 Gate",
        topic: "Allowlisted topic sk-proj-msgmeta1234567890abcdef",
        tags: ["v3", "all24"],
        unallowlisted_secret: "sk-proj-msgunallowlisted1234567890abcd"
      },
      internal_metadata: {
        secret_key: "sk-proj-msgintmeta1234567890abcdef",
        span: "span-all24"
      },
      raw_token_trace: "trace=ghp_1234567890msgtrace1234567890abcd",
      is_edited: true,
      created_at: ts,
      updated_at: ts
    };

    const knowledgeChunkPrimary: KnowledgeChunkFTS = {
      chunk_id: "chunk-all24-1",
      memory_id: memoryRecordPrimary.memory_id,
      title: "FTS5 V3 Architecture Sentinelftsalpha",
      chunk_content: "Atomic savepoint protocol with sentinelftsbeta searchability.",
      tags: ["sentinelftsgamma", "space tag", "hyphen-tag", "comma,tag", 'quote"tag'],
      embedding_vector_ref: "vec://private/sk-proj-kcvec1234567890abcdef",
      created_at: ts
    };

    const shaA = "11223344".repeat(8);
    const shaB = "a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90";
    const shaC = "55667788".repeat(8);

    const specs: Entity24Runner[] = [
      createEntity24Spec({
        entityName: "ProjectTaskV3",
        id: projectTaskPrimary.task_id,
        primary: projectTaskPrimary,
        alternate: {
          ...projectTaskPrimary,
          task_id: "task-all24-alt",
          parent_task_id: null,
          assigned_agent_id: null,
          reviewer_agent_id: null,
          acceptance_criteria: [],
          internal_evaluation_notes: null
        },
        toDbRow: toProjectTaskV3DbRow,
        fromDbRow: fromProjectTaskV3DbRow,
        insert: insertProjectTaskV3,
        getById: getProjectTaskV3ById,
        toPublicDto: toPublicProjectTaskV3DTO,
        omittedFields: ["internal_evaluation_notes"],
        secretSentinels: ["sk-proj-taskeval1234567890abcdef"],
        assertDbRow: (row) => {
          assert.equal(typeof row.acceptance_criteria_json, "string");
        }
      }),
      createEntity24Spec({
        entityName: "ChatRoom",
        id: chatRoomPrimary.room_id,
        primary: chatRoomPrimary,
        alternate: {
          ...chatRoomPrimary,
          room_id: "room-all24-alt",
          slug: "all24-alt-slug",
          project_id: null,
          task_id: null,
          is_archived: false,
          internal_notes: null
        },
        toDbRow: toChatRoomDbRow,
        fromDbRow: fromChatRoomDbRow,
        insert: insertChatRoom,
        getById: getChatRoomById,
        toPublicDto: toPublicChatRoomDTO,
        omittedFields: ["internal_notes"],
        secretSentinels: ["sk-proj-roomnotes1234567890abcdef"],
        assertDbRow: (row, variant) => {
          assert.equal(row.is_archived, variant === "primary" ? 1 : 0);
        }
      }),
      createEntity24Spec({
        entityName: "OutboxEvent",
        id: outboxEventPrimary.event_id,
        primary: outboxEventPrimary,
        alternate: {
          ...outboxEventPrimary,
          event_id: "evt-all24-alt",
          payload: {},
          last_error: "transient",
          internal_routing_key: null,
          processed_at: null
        },
        toDbRow: toOutboxEventDbRow,
        fromDbRow: fromOutboxEventDbRow,
        insert: insertOutboxEvent,
        getById: getOutboxEventById,
        toPublicDto: toPublicOutboxEventDTO,
        omittedFields: ["payload", "internal_routing_key"],
        secretSentinels: [
          "sk-proj-outboxpayload1234567890abcdef",
          "ghp_1234567890outboxrk1234567890abcd"
        ],
        assertDbRow: (row) => {
          assert.equal(typeof row.payload_json, "string");
        }
      }),
      createEntity24Spec({
        entityName: "EventSubscription",
        id: "sub-all24-1",
        primary: {
          subscription_id: "sub-all24-1",
          subscriber_id: "worker-all24",
          event_pattern: "task.*",
          endpoint: "https://internal.example.local/events",
          is_active: true,
          auth_secret_hash: "sk-ant-api03-subsecret1234567890abcdef",
          created_at: ts,
          updated_at: ts
        },
        alternate: {
          subscription_id: "sub-all24-alt",
          subscriber_id: "worker-all24",
          event_pattern: "room.*",
          endpoint: "https://internal.example.local/rooms",
          is_active: false,
          auth_secret_hash: null,
          created_at: ts,
          updated_at: ts
        },
        toDbRow: toEventSubscriptionDbRow,
        fromDbRow: fromEventSubscriptionDbRow,
        insert: insertEventSubscription,
        getById: getEventSubscriptionById,
        toPublicDto: toPublicEventSubscriptionDTO,
        omittedFields: ["auth_secret_hash"],
        secretSentinels: ["sk-ant-api03-subsecret1234567890abcdef"],
        assertDbRow: (row, variant) => {
          assert.equal(row.is_active, variant === "primary" ? 1 : 0);
        }
      }),
      createEntity24Spec({
        entityName: "AgentCapability",
        id: "cap-all24-1",
        primary: {
          capability_id: "cap-all24-1",
          agent_id: "flash-02",
          capability_name: "schema-parity-qa",
          version: "2.0.0",
          is_enabled: true,
          proficiency: "specialist",
          internal_evaluation_score: 0.9731,
          granted_at: ts
        },
        alternate: {
          capability_id: "cap-all24-alt",
          agent_id: "flash-02",
          capability_name: "schema-parity-qa",
          version: "1.0.0",
          is_enabled: false,
          proficiency: "supporting",
          internal_evaluation_score: null,
          granted_at: ts
        },
        toDbRow: toAgentCapabilityDbRow,
        fromDbRow: fromAgentCapabilityDbRow,
        insert: insertAgentCapability,
        getById: getAgentCapabilityById,
        toPublicDto: toPublicAgentCapabilityDTO,
        omittedFields: ["internal_evaluation_score"],
        secretSentinels: ["0.9731"],
        assertDbRow: (row, variant) => {
          assert.equal(row.is_enabled, variant === "primary" ? 1 : 0);
        }
      }),
      createEntity24Spec({
        entityName: "AgentQuotaAllocation",
        id: "alloc-all24-1",
        primary: {
          allocation_id: "alloc-all24-1",
          agent_id: "codex-01",
          quota_pool_id: "openai-go-shared",
          allocated_tokens: 100000,
          used_tokens: 2500,
          daily_limit: 500000,
          billing_account_ref: "acct-secret-billing-sk-proj-quota1234567890abcd",
          reset_at: ts,
          updated_at: ts
        },
        alternate: {
          allocation_id: "alloc-all24-alt",
          agent_id: "codex-01",
          quota_pool_id: "openai-go-shared",
          allocated_tokens: 0,
          used_tokens: 0,
          daily_limit: 1000,
          billing_account_ref: null,
          reset_at: ts,
          updated_at: ts
        },
        toDbRow: toAgentQuotaAllocationDbRow,
        fromDbRow: fromAgentQuotaAllocationDbRow,
        insert: insertAgentQuotaAllocation,
        getById: getAgentQuotaAllocationById,
        toPublicDto: toPublicAgentQuotaAllocationDTO,
        omittedFields: ["billing_account_ref"],
        secretSentinels: ["sk-proj-quota1234567890abcd", "acct-secret-billing"]
      }),
      createEntity24Spec({
        entityName: "AgentExecutionLock",
        id: "lock-all24-1",
        primary: {
          lock_id: "lock-all24-1",
          resource_uri: "repo://company-mcp/src/db",
          holder_agent_id: "flash-02",
          lock_nonce: "lock-aico_session_111122223333444455556666",
          purpose: "Verify SQLite sandbox migration locks",
          acquired_at: ts,
          expires_at: "2026-11-11T15:30:00Z"
        },
        alternate: {
          lock_id: "lock-all24-alt",
          resource_uri: "repo://company-mcp/test",
          holder_agent_id: "codex-01",
          lock_nonce: "nonce-alt-0001",
          purpose: "Test suite lock",
          acquired_at: ts,
          expires_at: "2026-11-11T15:30:00Z"
        },
        toDbRow: toAgentExecutionLockDbRow,
        fromDbRow: fromAgentExecutionLockDbRow,
        insert: insertAgentExecutionLock,
        getById: getAgentExecutionLockById,
        toPublicDto: toPublicAgentExecutionLockDTO,
        omittedFields: ["lock_nonce"],
        secretSentinels: ["aico_session_111122223333444455556666"]
      }),
      createEntity24Spec({
        entityName: "MemoryRecordV3",
        id: memoryRecordPrimary.memory_id,
        primary: memoryRecordPrimary,
        alternate: {
          ...memoryRecordPrimary,
          memory_id: "mem-all24-alt",
          owner_agent_id: null,
          raw_context_bytes: null,
          access_count: 0,
          confidence_score: 0.5
        },
        toDbRow: toMemoryRecordV3DbRow,
        fromDbRow: fromMemoryRecordV3DbRow,
        insert: insertMemoryRecordV3,
        getById: getMemoryRecordV3ById,
        toPublicDto: toPublicMemoryRecordV3DTO,
        omittedFields: ["raw_context_bytes"],
        secretSentinels: ["sk-proj-memraw1234567890abcdef"]
      }),
      createEntity24Spec({
        entityName: "ChatMessage",
        id: chatMessagePrimary.message_id,
        primary: chatMessagePrimary,
        alternate: {
          ...chatMessagePrimary,
          message_id: "msg-all24-alt",
          reply_to_id: chatMessagePrimary.message_id,
          mentions: [],
          metadata: {},
          internal_metadata: {},
          raw_token_trace: null,
          is_edited: false
        },
        toDbRow: toChatMessageDbRow,
        fromDbRow: fromChatMessageDbRow,
        insert: insertChatMessage,
        getById: getChatMessageById,
        toPublicDto: toPublicChatMessageDTO,
        omittedFields: ["internal_metadata", "raw_token_trace"],
        secretSentinels: [
          "sk-proj-msgmeta1234567890abcdef",
          "sk-proj-msgunallowlisted1234567890abcd",
          "sk-proj-msgintmeta1234567890abcdef",
          "ghp_1234567890msgtrace1234567890abcd"
        ],
        assertDbRow: (row, variant) => {
          assert.equal(row.is_edited, variant === "primary" ? 1 : 0);
        },
        assertPublicDto: (dto) => {
          const metadata = dto.metadata as Record<string, unknown>;
          assert.equal("unallowlisted_secret" in metadata, false);
          assert.equal(metadata.topic, "Allowlisted topic [REDACTED_SECRET]");
        }
      }),
      createEntity24Spec({
        entityName: "ChatMember",
        id: "member-all24-1",
        primary: {
          membership_id: "member-all24-1",
          room_id: chatRoomPrimary.room_id,
          principal_id: "flash-02",
          principal_type: "agent",
          role: "moderator",
          last_read_message_id: chatMessagePrimary.message_id,
          internal_cursor: "cursor-sk-proj-memcursor1234567890abcdef",
          joined_at: ts
        },
        alternate: {
          membership_id: "member-all24-alt",
          room_id: chatRoomPrimary.room_id,
          principal_id: "founder",
          principal_type: "human",
          role: "owner",
          last_read_message_id: null,
          internal_cursor: null,
          joined_at: ts
        },
        toDbRow: toChatMemberDbRow,
        fromDbRow: fromChatMemberDbRow,
        insert: insertChatMember,
        getById: getChatMemberById,
        toPublicDto: toPublicChatMemberDTO,
        omittedFields: ["internal_cursor"],
        secretSentinels: ["sk-proj-memcursor1234567890abcdef"]
      }),
      createEntity24Spec({
        entityName: "MessageAttachment",
        id: "att-all24-1",
        primary: {
          attachment_id: "att-all24-1",
          message_id: chatMessagePrimary.message_id,
          file_name: "qa-report.json",
          file_path: "reports/qa-report.json",
          file_size_bytes: 2048,
          mime_type: "application/json",
          sha256_hash: shaA,
          storage_driver_token: "drv-sk-proj-attachdrv1234567890abcdef",
          uploaded_at: ts
        },
        alternate: {
          attachment_id: "att-all24-alt",
          message_id: chatMessagePrimary.message_id,
          file_name: "empty.txt",
          file_path: "tmp/empty.txt",
          file_size_bytes: 0,
          mime_type: "text/plain",
          sha256_hash: shaA,
          storage_driver_token: null,
          uploaded_at: ts
        },
        toDbRow: toMessageAttachmentDbRow,
        fromDbRow: fromMessageAttachmentDbRow,
        insert: insertMessageAttachment,
        getById: getMessageAttachmentById,
        toPublicDto: toPublicMessageAttachmentDTO,
        omittedFields: ["storage_driver_token"],
        secretSentinels: ["sk-proj-attachdrv1234567890abcdef"]
      }),
      createEntity24Spec({
        entityName: "MessageReaction",
        id: "react-all24-1",
        primary: {
          reaction_id: "react-all24-1",
          message_id: chatMessagePrimary.message_id,
          principal_id: "flash-01",
          reaction_code: "approved_check",
          internal_client_ip: "198.51.100.77",
          created_at: ts
        },
        alternate: {
          reaction_id: "react-all24-alt",
          message_id: chatMessagePrimary.message_id,
          principal_id: "codex-01",
          reaction_code: "thumbs_up",
          internal_client_ip: null,
          created_at: ts
        },
        toDbRow: toMessageReactionDbRow,
        fromDbRow: fromMessageReactionDbRow,
        insert: insertMessageReaction,
        getById: getMessageReactionById,
        toPublicDto: toPublicMessageReactionDTO,
        omittedFields: ["internal_client_ip"],
        secretSentinels: ["198.51.100.77"]
      }),
      createEntity24Spec({
        entityName: "RoomInvite",
        id: "inv-all24-1",
        primary: {
          invite_id: "inv-all24-1",
          room_id: chatRoomPrimary.room_id,
          inviter_id: "flash-01",
          invitee_id: "codex-01",
          status: "accepted",
          invite_token_hash: "inv-sk-proj-invtoken1234567890abcdef",
          expires_at: "2026-11-12T14:30:00Z",
          created_at: ts
        },
        alternate: {
          invite_id: "inv-all24-alt",
          room_id: chatRoomPrimary.room_id,
          inviter_id: "flash-01",
          invitee_id: "flash-02",
          status: "pending",
          invite_token_hash: null,
          expires_at: "2026-11-12T14:30:00Z",
          created_at: ts
        },
        toDbRow: toRoomInviteDbRow,
        fromDbRow: fromRoomInviteDbRow,
        insert: insertRoomInvite,
        getById: getRoomInviteById,
        toPublicDto: toPublicRoomInviteDTO,
        omittedFields: ["invite_token_hash"],
        secretSentinels: ["sk-proj-invtoken1234567890abcdef"]
      }),
      createEntity24Spec({
        entityName: "RoomAuditLog",
        id: "audit-all24-1",
        primary: {
          audit_id: "audit-all24-1",
          room_id: chatRoomPrimary.room_id,
          action: "member_added",
          actor_id: "flash-01",
          details: {
            target: "codex-01",
            reason: "Clean after sk-proj-auditreason1234567890abcd",
            unallowlisted: "ghp_1234567890auditunallow1234567890ab"
          },
          internal_details: {
            hmac: "AICO_AUDIT_HMAC_KEY=audit_secret_val_9988776655"
          },
          security_context_snapshot: "ctx=aico_session_999988887777666655554444",
          created_at: ts
        },
        alternate: {
          audit_id: "audit-all24-alt",
          room_id: chatRoomPrimary.room_id,
          action: "room_created",
          actor_id: "flash-01",
          details: {},
          internal_details: {},
          security_context_snapshot: null,
          created_at: ts
        },
        toDbRow: toRoomAuditLogDbRow,
        fromDbRow: fromRoomAuditLogDbRow,
        insert: insertRoomAuditLog,
        getById: getRoomAuditLogById,
        toPublicDto: toPublicRoomAuditLogDTO,
        omittedFields: ["internal_details", "security_context_snapshot"],
        secretSentinels: [
          "sk-proj-auditreason1234567890abcd",
          "ghp_1234567890auditunallow1234567890ab",
          "audit_secret_val_9988776655",
          "aico_session_999988887777666655554444"
        ],
        assertPublicDto: (dto) => {
          const details = dto.details as Record<string, unknown>;
          assert.equal("unallowlisted" in details, false);
          assert.equal(details.reason, "Clean after [REDACTED_SECRET]");
        }
      }),
      createEntity24Spec({
        entityName: "DeadLetterQueue",
        id: "dlq-all24-1",
        primary: {
          dlq_id: "dlq-all24-1",
          original_event_id: outboxEventPrimary.event_id,
          event_type: "task.failed",
          payload: { failed_token: "sk-proj-dlqpayload1234567890abcdef" },
          failure_reason: "Downstream timeout",
          stack_trace: "Error: boom with ghp_1234567890dlqstack1234567890abcd\n  at worker()",
          resolved: true,
          resolved_by: "flash-02",
          resolved_at: ts,
          failed_at: ts
        },
        alternate: {
          dlq_id: "dlq-all24-alt",
          original_event_id: outboxEventPrimary.event_id,
          event_type: "task.failed",
          payload: {},
          failure_reason: "Retry exhausted",
          stack_trace: null,
          resolved: false,
          resolved_by: null,
          resolved_at: null,
          failed_at: ts
        },
        toDbRow: toDeadLetterQueueDbRow,
        fromDbRow: fromDeadLetterQueueDbRow,
        insert: insertDeadLetterQueue,
        getById: getDeadLetterQueueById,
        toPublicDto: toPublicDeadLetterQueueDTO,
        omittedFields: ["payload", "stack_trace"],
        secretSentinels: [
          "sk-proj-dlqpayload1234567890abcdef",
          "ghp_1234567890dlqstack1234567890abcd"
        ],
        assertDbRow: (row, variant) => {
          assert.equal(row.resolved, variant === "primary" ? 1 : 0);
        }
      }),
      createEntity24Spec({
        entityName: "DeliveryAttempt",
        id: "attempt-all24-1",
        primary: {
          attempt_id: "attempt-all24-1",
          outbox_event_id: outboxEventPrimary.event_id,
          attempt_number: 1,
          status: "failed",
          response_code: 503,
          error_message: "Gateway error with token sk-proj-delivmsg1234567890abcdef",
          internal_worker_id: "worker-sk-proj-delivwrk1234567890abcdef",
          latency_ms: 142.5,
          attempted_at: ts
        },
        alternate: {
          attempt_id: "attempt-all24-alt",
          outbox_event_id: outboxEventPrimary.event_id,
          attempt_number: 2,
          status: "success",
          response_code: null,
          error_message: null,
          internal_worker_id: null,
          latency_ms: 12,
          attempted_at: ts
        },
        toDbRow: toDeliveryAttemptDbRow,
        fromDbRow: fromDeliveryAttemptDbRow,
        insert: insertDeliveryAttempt,
        getById: getDeliveryAttemptById,
        toPublicDto: toPublicDeliveryAttemptDTO,
        omittedFields: ["internal_worker_id"],
        secretSentinels: [
          "sk-proj-delivmsg1234567890abcdef",
          "sk-proj-delivwrk1234567890abcdef"
        ],
        assertPublicDto: (dto) => {
          assert.equal(dto.error_message, "Gateway error with token [REDACTED_SECRET]");
        }
      }),
      createEntity24Spec({
        entityName: "AgentLease",
        id: "lease-all24-1",
        primary: {
          lease_id: "lease-all24-1",
          task_id: projectTaskPrimary.task_id,
          agent_id: "codex-01",
          lease_nonce: "lease-sk-proj-leasenonce1234567890abc",
          status: "active",
          heartbeat_at: ts,
          expires_at: "2026-11-11T15:30:00Z",
          acquired_at: ts
        },
        alternate: {
          lease_id: "lease-all24-alt",
          task_id: projectTaskPrimary.task_id,
          agent_id: "codex-01",
          lease_nonce: "lease-alt-0001",
          status: "released",
          heartbeat_at: ts,
          expires_at: "2026-11-11T15:30:00Z",
          acquired_at: ts
        },
        toDbRow: toAgentLeaseDbRow,
        fromDbRow: fromAgentLeaseDbRow,
        insert: insertAgentLease,
        getById: getAgentLeaseById,
        toPublicDto: toPublicAgentLeaseDTO,
        omittedFields: ["lease_nonce"],
        secretSentinels: ["sk-proj-leasenonce1234567890abc"]
      }),
      createEntity24Spec({
        entityName: "AgentHeartbeat",
        id: "hb-all24-1",
        primary: {
          heartbeat_id: "hb-all24-1",
          agent_id: "flash-02",
          status: "busy",
          current_task_id: projectTaskPrimary.task_id,
          memory_usage_mb: 256.5,
          cpu_percent: 42.5,
          host_process_pid: 91827364,
          recorded_at: ts
        },
        alternate: {
          heartbeat_id: "hb-all24-alt",
          agent_id: "flash-02",
          status: "idle",
          current_task_id: null,
          memory_usage_mb: 64,
          cpu_percent: 0,
          host_process_pid: null,
          recorded_at: ts
        },
        toDbRow: toAgentHeartbeatDbRow,
        fromDbRow: fromAgentHeartbeatDbRow,
        insert: insertAgentHeartbeat,
        getById: getAgentHeartbeatById,
        toPublicDto: toPublicAgentHeartbeatDTO,
        omittedFields: ["host_process_pid"],
        secretSentinels: ["91827364"]
      }),
      createEntity24Spec({
        entityName: "TaskTransitionLog",
        id: "trans-all24-1",
        primary: {
          transition_id: "trans-all24-1",
          task_id: projectTaskPrimary.task_id,
          transition_seq: 1,
          from_execution_status: "assigned",
          to_execution_status: "in_progress",
          from_dispatch_status: "operator_delivered",
          to_dispatch_status: "external_running",
          transition_code: "EXEC_STARTED",
          triggered_by: "flash-02",
          reason: "Execution started by codex-01",
          internal_diagnostic_payload: "diag=sk-proj-transdiag1234567890abcdef",
          created_at: ts
        },
        alternate: {
          transition_id: "trans-all24-alt",
          task_id: projectTaskPrimary.task_id,
          transition_seq: 2,
          from_execution_status: "in_progress",
          to_execution_status: "review_required",
          from_dispatch_status: "external_running",
          to_dispatch_status: "result_received",
          transition_code: "REVIEW_READY",
          triggered_by: "codex-01",
          reason: "Tests ready",
          internal_diagnostic_payload: null,
          created_at: ts
        },
        toDbRow: toTaskTransitionLogDbRow,
        fromDbRow: fromTaskTransitionLogDbRow,
        insert: insertTaskTransitionLog,
        getById: getTaskTransitionLogById,
        toPublicDto: toPublicTaskTransitionLogDTO,
        omittedFields: ["internal_diagnostic_payload"],
        secretSentinels: ["sk-proj-transdiag1234567890abcdef"]
      }),
      createEntity24Spec({
        entityName: "TaskApprovalBinding",
        id: "bind-all24-1",
        primary: {
          binding_id: "bind-all24-1",
          task_id: projectTaskPrimary.task_id,
          approval_tier: "technical",
          required_role: "flash-01",
          status: "approved",
          approver_principal_id: "flash-01",
          canonical_payload_hash: shaB,
          signature_nonce: "sig-sk-proj-bindsig1234567890abcdef",
          decision_reason: "Schema and tests verified",
          decided_at: ts,
          created_at: ts
        },
        alternate: {
          binding_id: "bind-all24-alt",
          task_id: projectTaskPrimary.task_id,
          approval_tier: "founder",
          required_role: "founder",
          status: "pending",
          approver_principal_id: null,
          canonical_payload_hash: shaB,
          signature_nonce: "sig-alt-0001",
          decision_reason: null,
          decided_at: null,
          created_at: ts
        },
        toDbRow: toTaskApprovalBindingDbRow,
        fromDbRow: fromTaskApprovalBindingDbRow,
        insert: insertTaskApprovalBinding,
        getById: getTaskApprovalBindingById,
        toPublicDto: toPublicTaskApprovalBindingDTO,
        omittedFields: ["canonical_payload_hash", "signature_nonce"],
        secretSentinels: [shaB, "sk-proj-bindsig1234567890abcdef"]
      }),
      createEntity24Spec({
        entityName: "ReviewAssignment",
        id: "rev-all24-1",
        primary: {
          review_id: "rev-all24-1",
          task_id: projectTaskPrimary.task_id,
          reviewer_agent_id: "flash-02",
          assigned_by: "flash-01",
          review_status: "approved",
          verdict: "pass",
          public_feedback: "All 24 entity contracts verified cleanly.",
          internal_reviewer_notes: "notes-sk-proj-revnote1234567890abcd",
          created_at: ts,
          completed_at: ts
        },
        alternate: {
          review_id: "rev-all24-alt",
          task_id: projectTaskPrimary.task_id,
          reviewer_agent_id: "flash-02",
          assigned_by: "flash-01",
          review_status: "assigned",
          verdict: null,
          public_feedback: null,
          internal_reviewer_notes: null,
          created_at: ts,
          completed_at: null
        },
        toDbRow: toReviewAssignmentDbRow,
        fromDbRow: fromReviewAssignmentDbRow,
        insert: insertReviewAssignment,
        getById: getReviewAssignmentById,
        toPublicDto: toPublicReviewAssignmentDTO,
        omittedFields: ["internal_reviewer_notes"],
        secretSentinels: ["sk-proj-revnote1234567890abcd"]
      }),
      createEntity24Spec({
        entityName: "ArtifactAttestation",
        id: "attest-all24-1",
        primary: {
          attestation_id: "attest-all24-1",
          task_id: projectTaskPrimary.task_id,
          artifact_path: "test/t18-sandbox-migration-g2.test.ts",
          artifact_sha256: shaC,
          byte_size: 4096,
          attested_by_agent_id: "flash-02",
          attestation_type: "test_evidence",
          verification_signature: "sig-sk-proj-attsig1234567890abcdef",
          internal_audit_trail: "trail-ghp_1234567890attrail1234567890abcd",
          created_at: ts
        },
        alternate: {
          attestation_id: "attest-all24-alt",
          task_id: projectTaskPrimary.task_id,
          artifact_path: "src/db/v3-storage-mappers.ts",
          artifact_sha256: shaC,
          byte_size: 0,
          attested_by_agent_id: "flash-01",
          attestation_type: "source_code",
          verification_signature: "sig-alt-0001",
          internal_audit_trail: null,
          created_at: ts
        },
        toDbRow: toArtifactAttestationDbRow,
        fromDbRow: fromArtifactAttestationDbRow,
        insert: insertArtifactAttestation,
        getById: getArtifactAttestationById,
        toPublicDto: toPublicArtifactAttestationDTO,
        omittedFields: ["verification_signature", "internal_audit_trail"],
        secretSentinels: [
          "sk-proj-attsig1234567890abcdef",
          "ghp_1234567890attrail1234567890abcd"
        ]
      }),
      createEntity24Spec({
        entityName: "KnowledgeChunkFTS",
        id: knowledgeChunkPrimary.chunk_id,
        primary: knowledgeChunkPrimary,
        alternate: {
          ...knowledgeChunkPrimary,
          chunk_id: "chunk-all24-alt",
          tags: [],
          embedding_vector_ref: null
        },
        toDbRow: toKnowledgeChunkFTSDbRow,
        fromDbRow: fromKnowledgeChunkFTSDbRow,
        insert: insertKnowledgeChunkFTS,
        getById: getKnowledgeChunkFTSById,
        toPublicDto: toPublicKnowledgeChunkFTSDTO,
        omittedFields: ["embedding_vector_ref"],
        secretSentinels: ["sk-proj-kcvec1234567890abcdef"],
        assertDbRow: (row, variant) => {
          assert.equal(row.meta.chunk_id, row.fts.chunk_id);
          assert.equal(row.meta.memory_id, row.fts.memory_id);
          assert.equal(row.meta.created_at, row.fts.created_at);
          assert.equal(row.fts.tags, variant === "primary" ? JSON.stringify(knowledgeChunkPrimary.tags) : "[]");
        }
      }),
      createEntity24Spec({
        entityName: "ContextSnapshot",
        id: "snap-all24-1",
        primary: {
          snapshot_id: "snap-all24-1",
          task_id: projectTaskPrimary.task_id,
          agent_id: "flash-02",
          summary: "QA checkpoint after 24-entity verification",
          token_count: 1850,
          snapshot_data: "snap-sk-proj-snapdata1234567890abcdef",
          encryption_iv: "iv-ghp_1234567890snapiv1234567890abcd",
          created_at: ts
        },
        alternate: {
          snapshot_id: "snap-all24-alt",
          task_id: null,
          agent_id: "flash-02",
          summary: "Empty snapshot",
          token_count: 0,
          snapshot_data: "opaque-snapshot-blob",
          encryption_iv: null,
          created_at: ts
        },
        toDbRow: toContextSnapshotDbRow,
        fromDbRow: fromContextSnapshotDbRow,
        insert: insertContextSnapshot,
        getById: getContextSnapshotById,
        toPublicDto: toPublicContextSnapshotDTO,
        omittedFields: ["snapshot_data", "encryption_iv"],
        secretSentinels: [
          "sk-proj-snapdata1234567890abcdef",
          "ghp_1234567890snapiv1234567890abcd"
        ]
      })
    ];

    return { parentRootTask, knowledgeChunkPrimary, specs };
  }

  // Scenario 20: Complete 24/24 Entity Bidirectional Mappers, Persistence Adapter Registry Parity & Fail-Closed Validation
  await suite.test("20. Complete 24/24 bidirectional row mappers, V3_ENTITY_PERSISTENCE_ADAPTERS registry parity & KnowledgeChunkFTS fail-closed validation", () => {
    const mappingKeys = Object.keys(V3_ENTITY_STORAGE_MAPPINGS).sort();
    const adapterKeys = Object.keys(V3_ENTITY_PERSISTENCE_ADAPTERS).sort();
    assert.equal(mappingKeys.length, 24, "V3_ENTITY_STORAGE_MAPPINGS must contain 24 entities");
    assert.equal(adapterKeys.length, 24, "V3_ENTITY_PERSISTENCE_ADAPTERS must contain 24 entities");
    assert.deepEqual(
      adapterKeys,
      mappingKeys,
      "V3_ENTITY_PERSISTENCE_ADAPTERS keys must match V3_ENTITY_STORAGE_MAPPINGS keys 1-to-1"
    );

    const { knowledgeChunkPrimary, specs } = buildAll24EntityDataset("2026-11-11T14:30:00Z");
    assert.equal(specs.length, 24, "Test dataset must include all 24 domain entities");
    assert.deepEqual(
      specs.map((s) => s.entityName).sort(),
      mappingKeys,
      "Test dataset entities must match all 24 canonical keys"
    );

    for (const spec of specs) {
      spec.verifyMapperRoundTrip();
    }

    // Fail-closed KnowledgeChunkFTS cross-table mismatch & tags JSON validation
    const validKcRow = toKnowledgeChunkFTSDbRow(knowledgeChunkPrimary);
    assert.throws(
      () =>
        fromKnowledgeChunkFTSDbRow({
          meta: { ...validKcRow.meta, chunk_id: "chunk-mismatch" },
          fts: validKcRow.fts
        }),
      /chunk_id|mismatch/i,
      "fromKnowledgeChunkFTSDbRow must throw on chunk_id mismatch between meta and fts"
    );
    assert.throws(
      () =>
        fromKnowledgeChunkFTSDbRow({
          meta: validKcRow.meta,
          fts: { ...validKcRow.fts, memory_id: "mem-mismatch" }
        }),
      /memory_id|mismatch/i,
      "fromKnowledgeChunkFTSDbRow must throw on memory_id mismatch between meta and fts"
    );
    assert.throws(
      () =>
        fromKnowledgeChunkFTSDbRow({
          meta: validKcRow.meta,
          fts: { ...validKcRow.fts, created_at: "2026-11-11T00:00:00Z" }
        }),
      /created_at|mismatch/i,
      "fromKnowledgeChunkFTSDbRow must throw on created_at mismatch between meta and fts"
    );
    for (const badTags of ["{not-json", '{"not":"array"}', "[123]"] as const) {
      assert.throws(
        () =>
          fromKnowledgeChunkFTSDbRow({
            meta: validKcRow.meta,
            fts: { ...validKcRow.fts, tags: badTags }
          }),
        Error,
        `fromKnowledgeChunkFTSDbRow must throw on invalid tags JSON '${badTags}'`
      );
    }
    assert.throws(
      () =>
        fromKnowledgeChunkFTSDbRow({
          meta: { ...validKcRow.meta, created_at: "not-a-timestamp" },
          fts: { ...validKcRow.fts, created_at: "not-a-timestamp" }
        }),
      Error,
      "fromKnowledgeChunkFTSDbRow must throw on invalid ISO timestamp"
    );

    // Fail-closed SQL boolean & JSON validation across remaining typed entities
    const baseSub = toEventSubscriptionDbRow({
      subscription_id: "sub-fail-check",
      subscriber_id: "worker-1",
      event_pattern: "task.*",
      endpoint: "https://internal.example.local/sub",
      is_active: true,
      auth_secret_hash: null,
      created_at: "2026-11-11T14:30:00Z",
      updated_at: "2026-11-11T14:30:00Z"
    });
    assert.throws(() => fromEventSubscriptionDbRow({ ...baseSub, is_active: 2 }), /Invalid SQL boolean value/);

    const baseDlq = toDeadLetterQueueDbRow({
      dlq_id: "dlq-fail-check",
      original_event_id: "evt-1",
      event_type: "task.failed",
      payload: { ok: true },
      failure_reason: "timeout",
      stack_trace: null,
      resolved: false,
      resolved_by: null,
      resolved_at: null,
      failed_at: "2026-11-11T14:30:00Z"
    });
    assert.throws(() => fromDeadLetterQueueDbRow({ ...baseDlq, resolved: -1 }), /Invalid SQL boolean value/);
    assert.throws(() => fromDeadLetterQueueDbRow({ ...baseDlq, payload_json: "[]" }), /Invalid JSON object/);

    const baseOutbox = toOutboxEventDbRow({
      event_id: "evt-fail-check",
      aggregate_type: "task",
      aggregate_id: "task-1",
      event_type: "task.created",
      payload: { id: "task-1" },
      status: "pending",
      retry_count: 0,
      max_retries: 3,
      last_error: null,
      internal_routing_key: null,
      scheduled_for: "2026-11-11T14:30:00Z",
      processed_at: null,
      created_at: "2026-11-11T14:30:00Z"
    });
    assert.throws(() => fromOutboxEventDbRow({ ...baseOutbox, payload_json: "{broken" }), /Invalid JSON/);

    const baseCap = toAgentCapabilityDbRow({
      capability_id: "cap-fail-check",
      agent_id: "flash-02",
      capability_name: "qa",
      version: "1.0.0",
      is_enabled: true,
      proficiency: "specialist",
      internal_evaluation_score: null,
      granted_at: "2026-11-11T14:30:00Z"
    });
    assert.throws(() => fromAgentCapabilityDbRow({ ...baseCap, is_enabled: 2 }), /Invalid SQL boolean value/);

    const baseTask = toProjectTaskV3DbRow({
      task_id: "task-fail-check",
      project_id: "proj-1",
      parent_task_id: null,
      title: "Check",
      objective: "Fail closed",
      risk_class: "low",
      priority: "low",
      execution_status: "queued",
      dispatch_status: "not_dispatched",
      assigned_agent_id: null,
      reviewer_agent_id: null,
      version: 1,
      token_budget: 1000,
      token_used: 0,
      acceptance_criteria: ["One"],
      internal_evaluation_notes: null,
      created_at: "2026-11-11T14:30:00Z",
      updated_at: "2026-11-11T14:30:00Z"
    });
    assert.throws(
      () => fromProjectTaskV3DbRow({ ...baseTask, acceptance_criteria_json: '{"not":"array"}' }),
      /Invalid JSON array/
    );
  });

  // Scenario 21: Complete 24/24 Live SQLite Sandbox Round-Trip, Public DTO Secret Stripping & KnowledgeChunkFTS 1-to-2 Split Verification
  await suite.test("21. Live SQLite sandbox round-trip across ALL 24 entities, 24/24 public DTO secret stripping & KnowledgeChunkFTS 1-to-2 split persistence", () => {
    const ctx = createSandboxTestContext("aico-v3-all24-sqlite-");

    try {
      const conn = new ConnectionManager(ctx.dbPath);
      const runner = new MigrationRunner(conn);
      runner.runMigrations([migrationV050V3Foundation]);

      const ts = "2026-11-11T14:35:00Z";
      const { parentRootTask, knowledgeChunkPrimary, specs } = buildAll24EntityDataset(ts);

      // Insert parent task + all 24 domain entities inside a foreign-key-enforced write transaction
      conn.withWriteTransaction((db) => {
        const fkState = db.prepare("PRAGMA foreign_keys").get() as { foreign_keys: number };
        assert.equal(fkState.foreign_keys, 1, "ConnectionManager must keep PRAGMA foreign_keys = ON");

        insertProjectTaskV3(db, parentRootTask);
        for (const spec of specs) {
          spec.insertPrimary(db);
        }
      });

      // Read back all 24 entities via both named helpers & V3_ENTITY_PERSISTENCE_ADAPTERS, and test all 24 DTO projections
      conn.withReadTransaction((db) => {
        for (const spec of specs) {
          spec.verifySqliteAndDtoRoundTrip(db);
        }

        // Verify KnowledgeChunkFTS 1-to-2 physical split in SQLite + FTS5 MATCH queries
        const metaRow = db
          .prepare("SELECT chunk_id, memory_id, embedding_vector_ref, created_at FROM knowledge_chunks_meta WHERE chunk_id = ?")
          .get(knowledgeChunkPrimary.chunk_id) as Record<string, unknown> | undefined;
        assert.ok(metaRow !== undefined, "knowledge_chunks_meta row must exist");
        assert.equal(metaRow.chunk_id, knowledgeChunkPrimary.chunk_id);
        assert.equal(metaRow.memory_id, knowledgeChunkPrimary.memory_id);
        assert.equal(metaRow.embedding_vector_ref, knowledgeChunkPrimary.embedding_vector_ref);
        assert.equal(metaRow.created_at, knowledgeChunkPrimary.created_at);

        const ftsRow = db
          .prepare("SELECT chunk_id, memory_id, title, chunk_content, tags, created_at FROM knowledge_chunks_fts WHERE chunk_id = ?")
          .get(knowledgeChunkPrimary.chunk_id) as Record<string, unknown> | undefined;
        assert.ok(ftsRow !== undefined, "knowledge_chunks_fts row must exist");
        assert.equal(ftsRow.title, knowledgeChunkPrimary.title);
        assert.equal(ftsRow.chunk_content, knowledgeChunkPrimary.chunk_content);
        assert.equal(ftsRow.tags, JSON.stringify(knowledgeChunkPrimary.tags));

        // Search via SQLite FTS5 MATCH across title, chunk_content, and tags columns
        for (const [colQuery, label] of [
          ["title : Sentinelftsalpha", "title"],
          ["chunk_content : sentinelftsbeta", "chunk_content"],
          ["tags : sentinelftsgamma", "tags"]
        ] as const) {
          const hits = db
            .prepare("SELECT chunk_id FROM knowledge_chunks_fts WHERE knowledge_chunks_fts MATCH ?")
            .all(colQuery) as Array<{ chunk_id: string }>;
          assert.deepEqual(
            hits.map((h) => h.chunk_id),
            [knowledgeChunkPrimary.chunk_id],
            `FTS5 MATCH by ${label} ('${colQuery}') must locate chunk`
          );
        }
      });

      // Verify KnowledgeChunkFTS empty tags [] round-trip AND fail-closed split integrity when either table row is missing or FTS row is duplicated
      const chunkEmptyTags: KnowledgeChunkFTS = {
        chunk_id: "chunk-all24-empty-tags",
        memory_id: "mem-all24-1",
        title: "Empty Tags Chunk",
        chunk_content: "Chunk verifying empty tags serialization.",
        tags: [],
        embedding_vector_ref: null,
        created_at: ts
      };
      const chunkMissingFts: KnowledgeChunkFTS = {
        chunk_id: "chunk-all24-orphan-meta",
        memory_id: "mem-all24-1",
        title: "Missing FTS Half",
        chunk_content: "Will delete FTS row to prove fail-closed read.",
        tags: ["orphan-check"],
        embedding_vector_ref: null,
        created_at: ts
      };
      const chunkMissingMeta: KnowledgeChunkFTS = {
        chunk_id: "chunk-all24-orphan-fts",
        memory_id: "mem-all24-1",
        title: "Missing Meta Half",
        chunk_content: "Will delete meta row to prove fail-closed read.",
        tags: ["orphan-check"],
        embedding_vector_ref: "vec://orphan",
        created_at: ts
      };
      const chunkDuplicateFts: KnowledgeChunkFTS = {
        chunk_id: "chunk-all24-duplicate-fts",
        memory_id: "mem-all24-1",
        title: "Duplicate FTS Half",
        chunk_content: "Will duplicate FTS row to prove fail-closed multi-row guard.",
        tags: ["duplicate-fts-check"],
        embedding_vector_ref: "vec://duplicate",
        created_at: ts
      };

      conn.withWriteTransaction((db) => {
        insertKnowledgeChunkFTS(db, chunkEmptyTags);
        insertKnowledgeChunkFTS(db, chunkMissingFts);
        insertKnowledgeChunkFTS(db, chunkMissingMeta);
        insertKnowledgeChunkFTS(db, chunkDuplicateFts);

        db.prepare("DELETE FROM knowledge_chunks_fts WHERE chunk_id = ?").run(chunkMissingFts.chunk_id);
        db.prepare("DELETE FROM knowledge_chunks_meta WHERE chunk_id = ?").run(chunkMissingMeta.chunk_id);
        db.prepare(
          "INSERT INTO knowledge_chunks_fts (chunk_id, memory_id, title, chunk_content, tags, created_at) VALUES (?, ?, ?, ?, ?, ?)"
        ).run(
          chunkDuplicateFts.chunk_id,
          chunkDuplicateFts.memory_id,
          chunkDuplicateFts.title,
          chunkDuplicateFts.chunk_content,
          JSON.stringify(chunkDuplicateFts.tags),
          chunkDuplicateFts.created_at
        );
      });

      conn.withReadTransaction((db) => {
        assert.deepEqual(
          getKnowledgeChunkFTSById(db, chunkEmptyTags.chunk_id),
          chunkEmptyTags,
          "KnowledgeChunkFTS must preserve empty tags [] and null embedding_vector_ref losslessly"
        );
        assert.throws(
          () => getKnowledgeChunkFTSById(db, chunkMissingFts.chunk_id),
          /KnowledgeChunkFTS integrity violation.*without matching row in knowledge_chunks_fts/,
          "getKnowledgeChunkFTSById must fail closed when FTS half is missing"
        );
        assert.throws(
          () => getKnowledgeChunkFTSById(db, chunkMissingMeta.chunk_id),
          /KnowledgeChunkFTS integrity violation.*without matching row in knowledge_chunks_meta/,
          "getKnowledgeChunkFTSById must fail closed when meta half is missing"
        );
        assert.throws(
          () => getKnowledgeChunkFTSById(db, chunkDuplicateFts.chunk_id),
          /KnowledgeChunkFTS integrity violation.*expected at most 1 row/,
          "getKnowledgeChunkFTSById must fail closed when duplicate chunk_id rows exist in knowledge_chunks_fts"
        );
      });

      // Verify atomic SAVEPOINT rollback in insertKnowledgeChunkFTS (standalone DatabaseSync connection)
      const standaloneBadChunk: KnowledgeChunkFTS = {
        chunk_id: "chunk-savepoint-standalone-fail",
        memory_id: "nonexistent-memory-standalone",
        title: "Should Rollback Standalone",
        chunk_content: "Standalone FK failure must roll back cleanly.",
        tags: ["savepoint"],
        embedding_vector_ref: "vec://rollback",
        created_at: ts
      };

      const rawDb = new DatabaseSync(ctx.dbPath);
      try {
        rawDb.exec("PRAGMA foreign_keys = ON;");
        assert.throws(
          () => insertKnowledgeChunkFTS(rawDb, standaloneBadChunk),
          /FOREIGN KEY/i,
          "Standalone insertKnowledgeChunkFTS must fail on nonexistent memory_id FK"
        );
        assert.equal(
          rawDb.prepare("SELECT chunk_id FROM knowledge_chunks_meta WHERE chunk_id = ?").get(standaloneBadChunk.chunk_id),
          undefined,
          "Standalone failed insert must leave zero rows in knowledge_chunks_meta"
        );
        assert.equal(
          rawDb.prepare("SELECT chunk_id FROM knowledge_chunks_fts WHERE chunk_id = ?").get(standaloneBadChunk.chunk_id),
          undefined,
          "Standalone failed insert must leave zero rows in knowledge_chunks_fts"
        );
      } finally {
        rawDb.close();
      }

      // Verify SAVEPOINT rollback works cleanly when nested inside conn.withWriteTransaction
      const canaryMemory: MemoryRecordV3 = {
        memory_id: "mem-all24-savepoint-canary",
        owner_agent_id: "flash-02",
        scope: "TASK",
        category: "INCIDENT_LEARNING",
        key: "savepoint.nested.canary",
        content: "Outer transaction sibling row survives inner SAVEPOINT rollback.",
        raw_context_bytes: null,
        access_count: 1,
        confidence_score: 1.0,
        created_at: ts,
        updated_at: ts
      };
      const nestedBadChunk: KnowledgeChunkFTS = {
        chunk_id: "chunk-savepoint-nested-fail",
        memory_id: "nonexistent-memory-nested",
        title: "Should Rollback Nested",
        chunk_content: "Nested FK failure must only roll back inner SAVEPOINT.",
        tags: ["nested-savepoint"],
        embedding_vector_ref: null,
        created_at: ts
      };
      const validCanaryChunk: KnowledgeChunkFTS = {
        chunk_id: "chunk-savepoint-nested-ok",
        memory_id: canaryMemory.memory_id,
        title: "Nested Survivor Chunk",
        chunk_content: "Inserted in same outer transaction after inner SAVEPOINT rollback.",
        tags: ["nested-ok"],
        embedding_vector_ref: null,
        created_at: ts
      };

      conn.withWriteTransaction((db) => {
        insertMemoryRecordV3(db, canaryMemory);
        assert.throws(
          () => insertKnowledgeChunkFTS(db, nestedBadChunk),
          /FOREIGN KEY/i,
          "Nested insertKnowledgeChunkFTS must throw on nonexistent memory_id"
        );
        insertKnowledgeChunkFTS(db, validCanaryChunk);
      });

      conn.withReadTransaction((db) => {
        assert.deepEqual(getMemoryRecordV3ById(db, canaryMemory.memory_id), canaryMemory);
        assert.deepEqual(getKnowledgeChunkFTSById(db, validCanaryChunk.chunk_id), validCanaryChunk);
        assert.equal(getKnowledgeChunkFTSById(db, nestedBadChunk.chunk_id), null);
        assert.equal(
          db.prepare("SELECT chunk_id FROM knowledge_chunks_meta WHERE chunk_id = ?").get(nestedBadChunk.chunk_id),
          undefined
        );
        assert.equal(
          db.prepare("SELECT chunk_id FROM knowledge_chunks_fts WHERE chunk_id = ?").get(nestedBadChunk.chunk_id),
          undefined
        );
      });
    } finally {
      ctx.cleanup();
    }
  });
});
