# AICO V3 — PHASE 1 MIGRATION & ROLLBACK DESIGN (V3-G2)

**Document ID:** AICO-V3-P1-DOC-02  
**Author:** `flash-02` (Engineering & QA Lead)  
**Recipient:** `chatgpt-01` (CEO & Main Orchestrator)  
**Governance Authority:** Founder  
**Date:** 2026-11-11  
**Status:** DELIVERED & VERIFIED (P1 & P2 HARDENING APPLIED)  

---

## 1. MIGRATION ARCHITECTURE OVERVIEW

The AICO V3 Foundation Schema Migration (`v0.5.0`) translates the 24 canonical domain entities into a production-grade SQLite schema while strictly confining operations to sandbox and temporary test databases.

### Migration Identifiers
- **Migration ID:** `20261110_003_v050_v3_foundation`
- **Migration Name:** `v0.5.0 V3 Foundation — 24 Domain Tables, Constraints, and FTS5`
- **Up Script:** `company-mcp/src/db/migrations/v0.5.0-v3-foundation.sql`
- **Down Script:** `company-mcp/src/db/migrations/v0.5.0-down.sql`
- **TypeScript Runner Wrapper:** `company-mcp/src/db/migrations/v050-v3-foundation.ts`

---

## 2. FORWARD MIGRATION SPECIFICATION (UP)

The UP script executes inside an atomic write transaction (`withWriteTransaction`) with `PRAGMA foreign_keys = ON;`.

### Relational Table Design & Constraints

#### 1. Core Collaboration (7 Tables)
- `chat_rooms`: Primary key `room_id`, unique constraint on `slug`, CHECK constraint on `room_type` (6 canonical types), `is_archived` (0 or 1). Indexes on `slug`, `room_type`, `project_id`.
- `chat_members`: Primary key `membership_id`, foreign key `room_id REFERENCES chat_rooms(room_id) ON DELETE CASCADE`, unique constraint `UNIQUE(room_id, principal_id)`, CHECK constraints on `principal_type` and `role`.
- `chat_messages`: Primary key `message_id`, foreign key `room_id REFERENCES chat_rooms(room_id) ON DELETE CASCADE`, foreign key `reply_to_id REFERENCES chat_messages(message_id) ON DELETE SET NULL`, JSON persistence columns `mentions_json`, `metadata_json`, and `internal_metadata_json` (plus private `raw_token_trace`), CHECK constraints on `message_type`, non-empty `content`, and `is_edited`. Composite index on `(room_id, created_at)`.
- `message_attachments`: Primary key `attachment_id`, foreign key `message_id REFERENCES chat_messages(message_id) ON DELETE CASCADE`, CHECK constraints on `file_size_bytes >= 0` and `length(sha256_hash) = 64`.
- `message_reactions`: Primary key `reaction_id`, foreign key `message_id REFERENCES chat_messages(message_id) ON DELETE CASCADE`, unique constraint `UNIQUE(message_id, principal_id, reaction_code)`.
- `room_invites`: Primary key `invite_id`, foreign key `room_id REFERENCES chat_rooms(room_id) ON DELETE CASCADE`, CHECK constraint on `status` (`pending`, `accepted`, `declined`, `expired`).
- `room_audit_logs`: Primary key `audit_id`, foreign key `room_id REFERENCES chat_rooms(room_id) ON DELETE CASCADE`, JSON persistence columns `details_json` and `internal_details_json` (plus private `security_context_snapshot`), CHECK constraint on `action` (`room_created`, `member_added`, `member_removed`, `role_updated`, `room_archived`, `room_restored`).

#### 2. Reliable Messaging & Outbox (4 Tables)
- `event_outbox`: Primary key `event_id`, status check (`pending`, `processing`, `published`, `failed`, `dead_letter`), retry checks `retry_count >= 0`, `max_retries > 0`. Composite index on `(status, scheduled_for)`.
- `event_subscriptions`: Primary key `subscription_id`, active flag check, pattern index on `event_pattern`.
- `dead_letter_queue`: Primary key `dlq_id`, non-empty failure reason, resolution flag check.
- `delivery_attempts`: Primary key `attempt_id`, foreign key `outbox_event_id REFERENCES event_outbox(event_id) ON DELETE CASCADE`, `attempt_number > 0`, `latency_ms >= 0`.

#### 3. Agent Coordination & Lifecycle (5 Tables)
- `agent_leases`: Primary key `lease_id`, status check (`active`, `released`, `expired`, `revoked`). Indexes on `task_id` and `agent_id`.
- `agent_heartbeats`: Primary key `heartbeat_id`, status check (`online`, `busy`, `idle`, `draining`, `offline`), `cpu_percent BETWEEN 0 AND 100`, `memory_usage_mb >= 0`.
- `agent_capabilities`: Primary key `capability_id`, unique constraint `UNIQUE(agent_id, capability_name, version)`, proficiency check (`core`, `supporting`, `specialist`).
- `agent_quota_allocations`: Primary key `allocation_id`, unique constraint `UNIQUE(agent_id, quota_pool_id)`, `allocated_tokens >= 0`, `used_tokens >= 0`, `daily_limit > 0`.
- `agent_execution_locks`: Primary key `lock_id`, unique constraint on `resource_uri`.

#### 4. Task Orchestration & Governance (5 Tables)
- `project_tasks_v3`: Primary key `task_id`, self-referencing foreign key `parent_task_id REFERENCES project_tasks_v3(task_id) ON DELETE SET NULL`, 13-state `execution_status` check, 9-state `dispatch_status` check, `risk_class` check, `priority` check, `version > 0`, `token_budget > 0`, `token_used >= 0`. Indexes on status, assigned agent, and project.
- `task_transition_logs`: Primary key `transition_id`, foreign key `task_id REFERENCES project_tasks_v3(task_id) ON DELETE CASCADE`, unique constraint `UNIQUE(task_id, transition_seq)`, `transition_seq > 0`.
- `task_approval_bindings`: Primary key `binding_id`, foreign key `task_id REFERENCES project_tasks_v3(task_id) ON DELETE CASCADE`, `approval_tier` check (`founder`, `technical`), `length(canonical_payload_hash) = 64`.
- `review_assignments`: Primary key `review_id`, foreign key `task_id REFERENCES project_tasks_v3(task_id) ON DELETE CASCADE`, review status and verdict checks.
- `artifact_attestations`: Primary key `attestation_id`, foreign key `task_id REFERENCES project_tasks_v3(task_id) ON DELETE CASCADE`, `length(artifact_sha256) = 64`, `byte_size >= 0`.

#### 5. Knowledge & Memory (3 Tables/Virtual Tables)
- `memory_records_v3`: Primary key `memory_id`, `scope` check (`COMPANY`, `PROJECT`, `TASK`, `ROOM`, `AGENT_PRIVATE`), `category` check (`ARCHITECTURAL_DECISION`, `INCIDENT_LEARNING`, `PERFORMANCE_PATTERN`, `FACT`), `confidence_score BETWEEN 0.0 AND 1.0`.
- `knowledge_chunks_meta`: Primary key `chunk_id`, foreign key `memory_id REFERENCES memory_records_v3(memory_id) ON DELETE CASCADE`.
- `knowledge_chunks_fts`: SQLite FTS5 virtual table for lexical and full-text search:
  `CREATE VIRTUAL TABLE IF NOT EXISTS knowledge_chunks_fts USING fts5(chunk_id UNINDEXED, memory_id UNINDEXED, title, chunk_content, tags, created_at UNINDEXED);`
- `context_snapshots`: Primary key `snapshot_id`, foreign key `task_id REFERENCES project_tasks_v3(task_id) ON DELETE SET NULL`, `token_count >= 0`.

### Domain-to-SQLite Storage Mapping Contract (`company-mcp/src/db/v3-storage-mappers.ts`)
- **`V3_ENTITY_STORAGE_MAPPINGS`:** Declarative mapping specification across all 24 domain entities defining SQLite table targets, `<field>` <-> `<field>_json` columns (`mentions_json`, `metadata_json`, `internal_metadata_json`, `details_json`, `internal_details_json`, `payload_json`, `acceptance_criteria_json`), `boolean` <-> `INTEGER (0 | 1)` columns (`is_archived`, `is_edited`, `is_active`, `resolved`, `is_enabled`), internal/private persisted columns, and the 1-to-2 split for `KnowledgeChunkFTS` (`knowledge_chunks_meta` + FTS5 `knowledge_chunks_fts`).
- **Complete 24/24 Bidirectional Row Mappers & Synchronous Persistence Adapters:** Every single one of the 24 domain entities exposes typed `<Entity>DbRow` contracts, Zod-validated bidirectional `to<Entity>DbRow` / `from<Entity>DbRow` mappers, synchronous `DatabaseSync` helpers (`insert<Entity>` / `get<Entity>ById`) backed by DRY single-table SQL helpers (`insertSingleTableRow` / `getSingleTableRowById` with `SQL_IDENT_REGEX` validation), and the compile-time & runtime `V3_ENTITY_PERSISTENCE_ADAPTERS` (`24/24`) registry.
- **`KnowledgeChunkFTS` 1-to-2 Split Adapter:** Uses unique SQLite `SAVEPOINT` transactions across `knowledge_chunks_meta` and `knowledge_chunks_fts`, lossless `JSON.stringify` / `parseJsonStringArray` encoding in `fts.tags` (supporting FTS5 `MATCH` queries plus empty/special-character arrays), and fail-closed integrity checks rejecting mismatched `chunk_id`/`memory_id`/`created_at`, orphan half-rows, or duplicate `knowledge_chunks_fts` entries.

---

## 3. BACKWARD ROLLBACK SPECIFICATION (DOWN)

To support complete reversibility, `v0.5.0-down.sql` drops all newly introduced tables in strict reverse-dependency order:

```sql
PRAGMA foreign_keys = OFF;

-- Knowledge & Memory
DROP TABLE IF EXISTS context_snapshots;
DROP TABLE IF EXISTS knowledge_chunks_fts;
DROP TABLE IF EXISTS knowledge_chunks_meta;
DROP TABLE IF EXISTS memory_records_v3;

-- Task Orchestration & Governance
DROP TABLE IF EXISTS artifact_attestations;
DROP TABLE IF EXISTS review_assignments;
DROP TABLE IF EXISTS task_approval_bindings;
DROP TABLE IF EXISTS task_transition_logs;
DROP TABLE IF EXISTS project_tasks_v3;

-- Agent Coordination & Lifecycle
DROP TABLE IF EXISTS agent_execution_locks;
DROP TABLE IF EXISTS agent_quota_allocations;
DROP TABLE IF EXISTS agent_capabilities;
DROP TABLE IF EXISTS agent_heartbeats;
DROP TABLE IF EXISTS agent_leases;

-- Reliable Messaging & Outbox
DROP TABLE IF EXISTS delivery_attempts;
DROP TABLE IF EXISTS dead_letter_queue;
DROP TABLE IF EXISTS event_subscriptions;
DROP TABLE IF EXISTS event_outbox;

-- Core Collaboration
DROP TABLE IF EXISTS room_audit_logs;
DROP TABLE IF EXISTS room_invites;
DROP TABLE IF EXISTS message_reactions;
DROP TABLE IF EXISTS message_attachments;
DROP TABLE IF EXISTS chat_messages;
DROP TABLE IF EXISTS chat_members;
DROP TABLE IF EXISTS chat_rooms;

PRAGMA foreign_keys = ON;
```

When `runner.rollbackMigration(migrationV050V3Foundation)` is invoked:
1. `assertNonProductionDatabase()` verifies non-production target.
2. An atomic write transaction executes `down()`.
3. The record `20261110_003_v050_v3_foundation` is deleted from `schema_migrations`.
4. Prior applied migrations (`20261106_001_v040_agent_columns` and `20261106_002_v050_target_tables`) remain 100% intact.

---

## 4. ATOMICITY & SAFETY INVARIANTS

1. **Transactional Atomicity:**
   Each migration step executes within `ConnectionManager.withWriteTransaction()`. If any SQL statement fails midway, the entire transaction is rolled back immediately, leaving zero partial tables, zero altered schemas, and zero uncommitted migration records.
2. **Deterministic Checksum Drift Protection:**
   The runner calculates SHA-256 over migration identifiers and SQL contents. Tampered or modified migration files trigger an instant `MIGRATION_DRIFT_DETECTED` exception.
3. **Idempotency Guarantee:**
   Re-running already-applied migrations produces `applied: []`, skipping previously executed versions without side effects.
4. **Cascading Referential Integrity:**
   Deleting parent entities (e.g., `chat_rooms`, `chat_messages`, `project_tasks_v3`) cleanly cascades across all subordinate tables, preventing orphan records.

---

## 5. VERIFICATION EVIDENCE

The migration and rollback engine is verified by `company-mcp/test/t18-sandbox-migration-g2.test.ts`:
- **21 verification scenarios** (`22` `node --test` items total: 1 outer suite + 21 subtests) covering virgin sandbox migration, seeded migration, idempotency, checksum drift, constraints, cascading FK deletes, index usage, rollback, re-migration, failure injection, canonical/symlink/junction/hardlink/ADS/URI/companion-file production DB path guards (against synthetic `os.tmpdir()` fixtures and mock `CanonicalPathFs`, never touching `data/aico.db`), P2 schema column parity + 24-entity mapping contracts + fail-closed row mappers (Scenarios 18–19), complete **24/24** bidirectional mappers + `V3_ENTITY_PERSISTENCE_ADAPTERS` parity + `KnowledgeChunkFTS` fail-closed cross-table/tags validation (Scenario 20), and live SQLite sandbox round-trip across **all 24 entities** (FK-ordered inserts, 24/24 `toPublic*DTO()` secret stripping, FTS5 `MATCH`, lossless special-char `tags`, orphan/duplicate FTS5 integrity errors, and standalone + nested `SAVEPOINT` atomicity in Scenario 21).
- Result: **22/22 passed, 0 failures, 0 skipped**.
