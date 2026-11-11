# AICO V3 — PHASE 1 TEST VERIFICATION REPORT

**Document ID:** AICO-V3-P1-DOC-03  
**Author:** `flash-02` (Engineering & QA Lead)  
**Recipient:** `chatgpt-01` (CEO & Main Orchestrator)  
**Governance Authority:** Founder  
**Date:** 2026-11-11  
**Status:** DELIVERED & VERIFIED (P1 & P2 HARDENING APPLIED)  

---

## 1. EXECUTIVE SUMMARY

This report records the complete test execution results for **AICO V3 Phase 1** (`V3-G1: Domain Model & Contract` and `V3-G2: Sandbox Database Migration v0.5.0`), including P1 security remediation (canonical production DB path guards and strict Public DTO metadata sanitization) and P2 hardening (SQL storage parity with round-trip persistence tests and expanded AICO secret scanning + public-text entry prevention).

All verification commands executed from a clean state on the local engineering workstation (`scripts/verify-all.ps1`) and verified 100% passing across all legacy, Phase 0.2/0.3, and Phase 1 test suites with zero modifications to `D:\AI-COMPANY\data\aico.db`.

### Summary Metrics
- **Prior Baseline Commit SHA:** `3740148ae548b3640efae9e5d6857a2ac3b7d91c`
- **Prior P1 Remediation Code & Test Commit SHA:** `75814e05f38740e51aae44f640310418a2c29857` (CI Runs `42975717730` / `42975717973`)
- **P2 Remediation Code & Test Commit SHA:** `5998a6968aa1b385f40aaf5faacb7e6693771617`
- **GitHub Actions CI (`main`):** Run ID `42982903767` (https://github.com/kietpro352010/AICO/actions/runs/42982903767) — `✓ SUCCESS` (**118/118** passed, 0 failed, 0 skipped; Production DB check `SKIPPED` in isolated CI)
- **GitHub Actions CI (`master`):** Run ID `42982904277` (https://github.com/kietpro352010/AICO/actions/runs/42982904277) — `✓ SUCCESS` (**118/118** passed, 0 failed, 0 skipped; Production DB check `SKIPPED` in isolated CI)
- **Total Test Files / Suites:** 13 `.test.ts` files (`T-BASE`, `T01`–`T10`, `T16`, `T17`, `T18`)
- **Total Test Nodes Executed:** **118**
- **Passed:** **118 (100%)**
- **Failed:** **0 (0%)**
- **Skipped / Todo:** **0 (0%)**
- **Production Database Touch:** ZERO bytes (`17BD93214291E33260DF4A3D0B7DAD417BCA05C137770443D4D3FA965595E416` verified pre- and post-run)
- **Local Verification Script Status:** `VERIFICATION COMPLETE: ALL GATES PASS (EXIT CODE 0)` (`INCLUDING LOCAL PRODUCTION DB IMMUTABILITY VERIFIED`)

---

## 2. TEST SUITE INVENTORY & EXECUTION RESULTS

| Suite ID | Test Suite File | Scope / Focus | Sub-tests | Result | Execution Time |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **T-BASE** | `test/test-manifest.test.ts` | Canonical Manifest Integrity & Blueprint Sync | 5 | **PASS** | 550 ms |
| **T01** | `test/t01-manifest-and-migrations.test.ts` | MigrationRunner on Sandbox DB | 1 | **PASS** | 127 ms |
| **T02** | `test/t02-core-services.test.ts` | Identity, Approvals & Workspace Artifact Guard | 1 | **PASS** | 309 ms |
| **T03** | `test/t03-mcp-tool-contracts.test.ts` | MCP Tool Contracts & DTO Leakage Prevention | 1 | **PASS** | 8 ms |
| **T04** | `test/t04-comprehensive-verification.test.ts` | Git, Knowledge FTS5 & HMAC Audit Chain | 1 | **PASS** | 463 ms |
| **T05** | `test/t05-gateways-and-tools.test.ts` | 38 MCP Tools & Gateway Allowlist Verification | 1 | **PASS** | 10 ms |
| **T06** | `test/t06-backup-restore.test.ts` | Backup & Safe Restore Drills on Sandbox DB | 1 | **PASS** | 108 ms |
| **T07** | `test/t07-integration-security.test.ts` | Fail-Closed RBAC/ABAC & Negative Security Suite | 1 | **PASS** | 3,258 ms |
| **T08** | `test/t08-task-state-machine-26.test.ts` | 26-State Transition Matrix (TR-01 to TR-26) | 1 | **PASS** | 3,615 ms |
| **T09** | `test/t09-e2e-http-transport.test.ts` | Black-Box E2E HTTP Transport & Pipeline | 1 | **PASS** | 602 ms |
| **T10** | `test/t10-stdio-and-dpapi.test.ts` | Windows DPAPI, STDIO Limits & Token Revocation | 1 | **PASS** | 2,471 ms |
| **T16** | `test/t16-security-stabilization.test.ts` | RFC 8785, Audit Anchor & Scenarios 1-10 | 25 | **PASS** | 14,335 ms |
| **T17** | `test/t17-domain-models-g1.test.ts` | **V3-G1:** 24 Entities, P1 Sanitization & P2 Secret Catalog/Entry Guards | 58 | **PASS** | 768 ms (standalone) |
| **T18** | `test/t18-sandbox-migration-g2.test.ts` | **V3-G2:** Sandbox Schema v0.5.0, Path Guard & P2 Round-Trip Parity | 20 | **PASS** | 1,683 ms (standalone) |
| **TOTAL** | **13 Test Files** | **Complete AICO V3 Regression & Phase 1 Scope** | **118** | **PASS (118/118)**| **14.3s** |

---

## 3. DETAILED BREAKDOWN OF NEW PHASE 1 TEST SUITES

### Suite T17: V3-G1 Domain Model & Contract Verification (58 Tests: 30 Baseline + 16 P1 #2 + 12 P2)

- **Group 1: Core Collaboration Entities (7 tests)**
  - `ChatRoom`: Parses valid, validates slug regex, rejects invalid `room_type`, strips `internal_notes` in DTO.
  - `ChatMember`: Validates roles, rejects invalid roles, strips `internal_cursor` in DTO.
  - `ChatMessage`: Validates message types, rejects empty content, strips `raw_token_trace` in DTO.
  - `MessageAttachment`: Validates 64-char sha256, rejects bad sha256, strips `storage_driver_token` in DTO.
  - `MessageReaction`: Validates reaction codes, rejects empty codes, strips `internal_client_ip` in DTO.
  - `RoomInvite`: Validates statuses, rejects invalid status, strips `invite_token_hash` in DTO.
  - `RoomAuditLog`: Validates audit actions, rejects invalid actions, strips `security_context_snapshot` in DTO.

- **Group 2: Reliable Messaging & Outbox Entities (4 tests)**
  - `OutboxEvent`: Validates aggregate types, rejects negative retries, strips `internal_routing_key` in DTO.
  - `EventSubscription`: Validates event patterns, rejects empty pattern, strips `auth_secret_hash` in DTO.
  - `DeadLetterQueue`: Validates failure payloads, rejects empty failure reason, strips `stack_trace` in DTO.
  - `DeliveryAttempt`: Validates attempt numbers, rejects attempt < 1, strips `internal_worker_id` in DTO.

- **Group 3: Agent Coordination & Lifecycle Entities (5 tests)**
  - `AgentLease`: Validates lease lifecycle, rejects invalid status, strips `lease_nonce` in DTO.
  - `AgentHeartbeat`: Validates telemetry bounds, rejects cpu > 100%, strips `host_process_pid` in DTO.
  - `AgentCapability`: Validates proficiency levels, rejects empty name, strips `internal_evaluation_score` in DTO.
  - `AgentQuotaAllocation`: Validates token bounds, rejects negative allocation, strips `billing_account_ref` in DTO.
  - `AgentExecutionLock`: Validates resource locks, rejects empty URI, strips `lock_nonce` in DTO.

- **Group 4: Task Orchestration & Governance Entities (5 tests)**
  - `ProjectTaskV3`: Validates 13 execution & 9 dispatch statuses, strips `internal_evaluation_notes` in DTO.
  - `TaskTransitionLog`: Validates TR-01 to TR-26 transitions, strips `internal_diagnostic_payload` in DTO.
  - `TaskApprovalBinding`: Validates Founder/Technical tiers, strips `canonical_payload_hash` & `signature_nonce` in DTO.
  - `ReviewAssignment`: Validates review workflows, rejects invalid verdict, strips `internal_reviewer_notes` in DTO.
  - `ArtifactAttestation`: Validates artifact attestations, strips `verification_signature` & `internal_audit_trail` in DTO.

- **Group 5: Knowledge & Memory Entities (3 tests)**
  - `MemoryRecordV3`: Validates memory scopes, rejects confidence > 1.0, strips `raw_context_bytes` in DTO.
  - `KnowledgeChunkFTS`: Validates chunk metadata and tags, strips `embedding_vector_ref` in DTO.
  - `ContextSnapshot`: Validates token counts, rejects negative tokens, strips `snapshot_data` & `encryption_iv` in DTO.

- **P1 Blocker #2 Regression Suite (16 `node --test` nodes: 1 outer regression suite + 15 subtests)**
  - `Entity 3 (ChatMessage)`: Strips deeply nested API keys/tokens, internal routing fields, private identifiers, `__proto__`/`constructor`/`prototype`, `raw_token_trace`, and `internal_metadata`; redacts secrets inside allowlisted strings/arrays (including full multi-line PEM blocks & URL credentials); fails closed (`ZodError`) on type confusion; `PublicChatMessageDTOSchema` rejects unknown nested keys strictly.
  - `Entity 7 (RoomAuditLog)`: Strips nested details, `internal_details`, `security_context_snapshot`, and dangerous keys; redacts secrets/PEM blocks/Bearer tokens inside allowlisted fields; fails closed (`ZodError`) on type confusion; `PublicRoomAuditLogDTOSchema` rejects unknown nested keys strictly.
  - `Entity 8 (OutboxEvent)` & `Entity 10 (DeadLetterQueue)`: Omit `payload` alongside `internal_routing_key`/`stack_trace` and scrub `last_error`/`failure_reason`.
  - `Entity 9 (EventSubscription)` & `Entity 11 (DeliveryAttempt)`: Scrub `endpoint` credentials/tokens and `error_message` while omitting `auth_secret_hash`/`internal_worker_id`.
  - `projectPublicAllowlistedRecord`: Ignores inherited properties and dangerous keys; sanitizes nested structures recursively with `WeakMap` shared-DAG & cycle guard.

- **P2 Secret Scanning Catalog & Public Text Entry Prevention (Suites A & B: 12 `node --test` nodes):**
  - `T17 P2 Suite A` (`6` nodes): Validates `AICO_SECRET_CATALOG` integrity (`20` unique entries), `.scan()` + idempotent `.redact()` across every real AICO/provider secret type (canonical & legacy `aico_<agentId>_<48hex>` live `AgentIdentityService` tokens, Bearer/Basic headers, compact JWT, Anthropic, OpenAI, GitHub `github_pat_`/`gh[pousr]_`, Google/Gemini, AWS Access Keys, Slack tokens/webhooks, `whsec_`, bounded PEM/PGP blocks + headers, multi-protocol credentialed URLs, and env assignments incl. trailing `=` Base64 padding), benign non-secret false-positive guards, and 32KB+ unclosed PEM/PGP ReDoS bounds.
  - `T17 P2 Suite B` (`6` nodes): Validates fail-closed `SECRET_LEAK_PREVENTED` schema-entry rejection across all V3 public text fields (`ChatRoom.slug`/`name`, `ChatMessage.content`/`mentions`, `MessageAttachment`, `MessageReaction`, `ProjectTaskV3`, `TaskTransitionLog`, `TaskApprovalBinding`, `ReviewAssignment`, `ArtifactAttestation.artifact_path`, `MemoryRecordV3`, `KnowledgeChunkFTS`, `ContextSnapshot`, `AgentExecutionLock.resource_uri`/`purpose`, and strict `PublicChatMessageDTOSchema`/`PublicRoomAuditLogDTOSchema`), `assertNoSecretInPublicText`/`assertNoSecretInValue`, `MessagingService.sendMessage()` (`subject` + `bodyMarkdown`) and `MessagingService.ackMessage()` (`ack_note`), and unparsed defense-in-depth `toPublic*DTO()` scrubbing.

---

### Suite T18: V3-G2 Sandbox Database Migration v0.5.0 (20 Tests: 1 Outer Suite + 19 Scenarios)

1. **Virgin Sandbox Migration:** Clean migration on brand-new database creates all 24 foundation tables and virtual tables.
2. **Seeded Sandbox Migration:** Migration against sanitized baseline fixture (`backup/aico_v030_pre_v221.db`) preserves all existing agents/quota records and provisions all 24 tables.
3. **Repeated Migration (Idempotency):** Consecutive runs detect previously applied migrations (`applied: 0, skipped: 3`).
4. **Drift Detection:** Altering migration checksum triggers `MIGRATION_DRIFT_DETECTED`.
5. **Constraint Enforcement:** Verified Primary Key, Unique (`slug`), and CHECK constraints (`room_type`, `is_archived`, `file_size_bytes`).
6. **Foreign Key Enforcement & Cascades:** Deleting a `chat_rooms` row cascades automatically across 6 child tables.
7. **Index Verification:** Validated presence of created indexes and confirmed query planner utilization via `EXPLAIN QUERY PLAN`.
8. **Rollback (Down Migration):** Reversible migration cleanly drops all 24 tables and removes migration version record while preserving baseline tables.
9. **Re-Migration After Rollback:** Successfully re-applies migration after rollback.
10. **Failure Injection & Atomicity:** Intentional SQL syntax error aborts transaction completely with zero partial tables.
11. **Direct, Relative, URI, Win32 Dot/Space, and ADS Guard:** Throws `PRODUCTION_DB_MIGRATION_PROHIBITED` across `data/aico.db`, `file:` URIs, case-insensitive `file://LOCALHOST/`, `file::memory:/../../data/aico.db` lookalikes, trailing dots/spaces, and NTFS ADS (`::$DATA`, `:evil`, `::$INDEX_ALLOCATION`).
12. **Real OS Junction/Symlink to Mock `data/aico.db`:** Blocks lexical non-`data` junction paths (and `file:` URIs / Win32 dot / ADS aliases over them) against `os.tmpdir()` mock directories (never touching `D:\AI-COMPANY\data\aico.db`).
13. **Real OS Junction/Symlink with Missing Leaf:** Blocks `mock_empty/data/aico.db` without creating `aico.db`.
14. **Multi-Level Missing Descendants & Chained Junctions:** Blocks `alias/data/aico.db`, `junc2 -> junc1 -> chained_repo/data/aico.db`, and non-existent `additionalProtectedPaths` targets.
15. **Real OS Hardlink Inode Guard:** Blocks NTFS/POSIX hardlinks (including ADS/dot aliases and companion `-wal`/`-shm`/`-journal` hardlinks) via `(dev, ino)` matching against synthetic temp files.
16. **Injected `CanonicalPathFs` & `assertSafeNonProductionDbPath` Unit Tests:** Verifies existing/dangling/relative file symlinks, companion `-wal` symlink blocking, and fail-closed `CANONICAL_PATH_RESOLUTION_FAILED` (`ELOOP`, `EACCES` on `realpath`/`lstat`/`readlink`/`stat`, and `depth > MAX_SYMLINK_DEPTH`).
17. **Negative Controls & Malformed Inputs:** Confirms `:memory:`, `file::memory:?cache=shared`, `company-mcp/data/sandbox.db`, and temp `sandbox.db` succeed while raw/`%00` null bytes (`PRODUCTION_DB_MIGRATION_PROHIBITED`) and blank/malformed URIs (`INVALID_DB_PATH`) throw cleanly.
18. **SQL Schema Column Parity, Storage Mappings & Row Mappers (P2):** Verifies `PRAGMA table_info` for `chat_messages.internal_metadata_json` and `room_audit_logs.internal_details_json`, confirms all 24 entities in `V3_ENTITY_STORAGE_MAPPINGS` (incl. `KnowledgeChunkFTS` split across `knowledge_chunks_meta` + `knowledge_chunks_fts`), exercises bidirectional `to*DbRow`/`from*DbRow` mappers across 8 JSON/boolean entities, and validates fail-closed rejection on malformed JSON/booleans.
19. **End-to-End SQLite Sandbox Round-Trip & Public DTO Projection (P2):** Persists `ChatRoom`, `ChatMessage` (with `internal_metadata`, `raw_token_trace`, mixed `metadata`), and `RoomAuditLog` (with `internal_details`, `security_context_snapshot`, mixed `details`) into an isolated migrated SQLite DB, inspects raw columns verbatim, rehydrates entities cleanly with zero data loss, projects via `toPublicChatMessageDTO`/`toPublicRoomAuditLogDTO` confirming internal fields and secrets cannot leak, and re-verifies after rollback + re-migration.

---

## 4. RAW EXECUTION LOGS

```
> company-mcp@1.0.0 typecheck
> tsc --noEmit
[Exit Code 0]

> company-mcp@1.0.0 test
> node --import tsx --test "test/**/*.test.ts"
...
ℹ tests 118
ℹ suites 1
ℹ pass 118
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 14339.5725
[Exit Code 0]
```
