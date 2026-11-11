# AICO V3 — PHASE 1 SECURITY & DATABASE SAFETY REPORT

**Document ID:** AICO-V3-P1-DOC-04  
**Author:** `flash-02` (Engineering & QA Lead)  
**Recipient:** `chatgpt-01` (CEO & Main Orchestrator)  
**Governance Authority:** Founder  
- **Date:** 2026-11-11  
- **Status:** DELIVERED & VERIFIED (P1 HARDENING APPLIED)  

---

## 1. PRODUCTION DATABASE IMMUTABILITY EVIDENCE

Under company operating rules and explicit CEO directive, the production database (`data/aico.db`) remains completely frozen and untouchable throughout Phase 1.

### Hash Verification
- **Target File:** `D:\AI-COMPANY\data\aico.db`
- **Prior Baseline Commit:** `3740148ae548b3640efae9e5d6857a2ac3b7d91c`
- **P1 Remediation Code & Test Commit:** `75814e05f38740e51aae44f640310418a2c29857` (CI Runs `42975717730` / `42975717973` — `✓ SUCCESS`)
- **Initial Baseline SHA-256:** `17BD93214291E33260DF4A3D0B7DAD417BCA05C137770443D4D3FA965595E416`
- **Post-Hardening SHA-256:** `17BD93214291E33260DF4A3D0B7DAD417BCA05C137770443D4D3FA965595E416`
- **Byte Difference:** **0 bytes modified**
- **File Size:** Exactly 40,960 bytes
- **Cloud CI Status:** Production database check skipped in isolated cloud runner (no production DB exposed)

---

## 2. HARDENED PRODUCTION DATABASE PATH GUARD (P1 REMEDIATION)

To prevent accidental, programmatic, symlink/junction, hardlink, URI, or configuration-driven execution against the production database, `company-mcp/src/db/migration-runner.ts` implements multi-layer canonical filesystem protection:

- **`normalizeSqlDatabasePath(rawInput)`:** Rejects empty/malformed paths (`INVALID_DB_PATH`) and raw or percent-decoded (`%00`) null bytes (`PRODUCTION_DB_MIGRATION_PROHIBITED`); treats only exact `:memory:` and exact decoded `file::memory:` (with optional `?query`/`#fragment`) as in-memory, so lookalikes such as `file::memory:/../../data/aico.db` fall through to filesystem path checking; decodes SQLite `file:` URIs, strips `//localhost/` case-insensitively and leading drive slashes, and resolves UNC authorities.
- **`resolveCanonicalFilesystemPath(targetPath, fsOps)`:** Resolves canonical filesystem targets using `fs.realpathSync.native` / `realpathSync`, walking missing ancestor segments via `lstatSync` + `readlinkSync` (stripping `\\?\`, `\??\`, `\\?\UNC\`, and `\??\UNC\` Windows reparse prefixes) to follow single/chained junctions and symlinks across both existing targets, non-existent leaves/ancestors, and dangling symlinks; enforces `MAX_SYMLINK_DEPTH = 32` and fails closed (`CANONICAL_PATH_RESOLUTION_FAILED`) on `ELOOP`, `EACCES`, `readlinkSync`, or unexpected FS errors.
- **`isProhibitedProductionDbPath(pathCandidate)`:** Normalizes slashes, strips Win32 trailing periods/spaces and NTFS Alternate Data Stream suffixes (`:<stream>`, `::$DATA`, `::$INDEX_ALLOCATION`), and blocks any path ending in `/data/aico.db` or SQLite companion suffixes (`-wal`, `-shm`, `-journal`).
- **`assertSafeNonProductionDbPath(rawPath, options)` & `MigrationRunner.assertNonProductionDatabase()`:** Verifies both raw and alias-stripped paths plus SQLite companion files (`-wal`, `-shm`, `-journal`), enforces canonical path equality and `(dev, ino)` inode matching against `REPO_PROD_DB_PATH` (`../../../data/aico.db`), `additionalProtectedPaths`, and their companions. `MigrationRunner` accepts only `{ additionalProtectedPaths?: string[] }` (no `fsOps` override on the runner API, preventing caller bypass).

### Protection Characteristics & Test Isolation
1. **Unconditional Gate:** Neither environment variables, CLI flags, URI encodings, symlinks/junctions, Win32 trailing dots/spaces, NTFS ADS aliases, nor hardlinks can bypass `assertNonProductionDatabase()`.
2. **Comprehensive Interception:** Invoked at entry to `runMigrations()`, `rollbackMigration()`, `ensureSchemaMigrationsTable()`, and `getAppliedMigrations()`.
3. **Strict Test Isolation (`t18-sandbox-migration-g2.test.ts`):** Scenarios 11–17 verify real OS junctions/symlinks, missing leaves/ancestors, chained junctions, NTFS hardlinks + companion `-wal` hardlinks, Win32/ADS/URI vectors, and injected `CanonicalPathFs` file/broken/relative symlinks exclusively against synthetic temporary fixtures inside `os.tmpdir()` and in-memory mocks — **real `D:\AI-COMPANY\data\aico.db` is never opened, symlinked, junctioned, hardlinked, or modified**.
4. **Verification Evidence:** Suite T18 (Scenarios 11–17, **18/18 passing**) confirms all prohibited vectors throw `PRODUCTION_DB_MIGRATION_PROHIBITED` or fail closed with `CANONICAL_PATH_RESOLUTION_FAILED` while `:memory:` and `sandbox.db` targets remain allowed.

---

## 2.1 PUBLIC DTO METADATA & ANTI-LEAKAGE HARDENING (P1 REMEDIATION)

- **Strict Metadata / Details Allowlisting (`chat-message.ts`, `room-audit-log.ts`):** `ChatMessage` and `RoomAuditLog` separate `internal_metadata` / `internal_details` from public fields and project `metadata` (`PUBLIC_CHAT_MESSAGE_METADATA_KEYS`) and `details` (`PUBLIC_ROOM_AUDIT_DETAILS_KEYS`) through `projectPublicAllowlistedRecord()` + `.strict()` Zod schemas (`PublicChatMessageMetadataSchema`, `PublicRoomAuditDetailsSchema`), dropping arbitrary nested keys and failing closed (`ZodError`) on type confusion.
- **Unconstrained Payload Omission (`outbox-event.ts`, `dead-letter-queue.ts`):** `PublicOutboxEventDTOSchema` omits `payload` alongside `internal_routing_key`; `PublicDeadLetterQueueDTOSchema` omits `payload` alongside `stack_trace`.
- **Recursive Sanitization & Public Text Scrubbing (`sanitization.ts`, `secret-scanner.ts`):** `projectPublicAllowlistedRecord()` ignores prototype/inherited keys (`__proto__`, `constructor`, `prototype`), prevents raw source exposure on DAG/cyclic structures via `WeakMap`, and scrubs full multi-line PEM private key blocks, API tokens, `Bearer` headers, and HTTP `user:pass@` URL credentials; `redactPublicString()` also scrubs `last_error`, `failure_reason`, `error_message`, and `endpoint` across messaging DTO mappers (`T17`: **46/46 passing**).

---

## 3. V3 AUTHORIZATION GATES STATUS

| Gate ID | Gate Description | Target Phase | Status | Enforcement Mechanism |
| :--- | :--- | :--- | :--- | :--- |
| **V3-G1** | Domain Model & Contract | Phase 1 | **COMPLETED & VERIFIED** | 24 domain entities + Zod schemas + Public DTOs + T17 |
| **V3-G2** | Sandbox Schema Migration v0.5.0 | Phase 1 | **COMPLETED & VERIFIED** | `v0.5.0-v3-foundation.sql` + rollback + T18 |
| **V3-G3** | Production Database Cutover | Post-Phase 1 | **LOCKED** | Path guard unconditionally prohibits production DB DDL |
| **V3-G4** | Network / Public Gateway Exposure | Phase 3+ | **LOCKED** | No public listeners, tunnels, or external network binds |
| **V3-G7** | Final Production Go-Live | Final | **LOCKED** | Requires explicit Founder signature |

---

## 4. AGENT ISOLATION & GOVERNANCE COMPLIANCE

1. **Argon Isolation (`argon-01` & `argon-02`):**
   - In accordance with Company Operating Rules Section 2, Argon remains strictly manual-only.
   - Zero automated invocation calls were made, queued, or configured in Phase 1.
   - All tests run without invoking Argon.
2. **Phase Boundary Containment:**
   - Outbox event dispatcher worker: **DEFERRED to Phase 2** (no background dispatch daemon implemented).
   - Chat message pruning / retention worker: **DEFERRED to Phase 2**.
   - Zero cross-phase scope leakage.
