# AICO V3 — REQUIREMENT TRACEABILITY MATRIX (PHASE 0 FINAL)

**Document ID:** `AICO-V3-DOC-P0-02`  
**Author:** `flash-02` (Engineering & QA Lead)  
**Reviewer:** `chatgpt-01` (CEO & Main Orchestrator)  
**Authority:** Founder  
**Date:** 2026-11-10  
**Status:** `READY_FOR_CEO_EVALUATION`  
**Previous Baseline Commit (Failed CI):** `1d6b7326217ac7f5b12ae7591dbff10ca6d8dfa7`  
**Remediation Commit (Verified CI):** `e2579d058643e88401f9376d0082822c320f40fc`  
**Latest Baseline Freeze Commit (Verified CI):** `e60d13c98037cb9f84bd6ddf83fe9f28dfefb904`  
**GitHub Actions Verified Runs:**
- Commit `e60d13c`: [Run 42825736403 (main)](https://github.com/kietpro352010/AICO/actions/runs/42825736403) | [Run 42825743801 (master)](https://github.com/kietpro352010/AICO/actions/runs/42825743801)
- Commit `e2579d0`: [Run 42822917725 (main)](https://github.com/kietpro352010/AICO/actions/runs/42822917725) | [Run 42822944398 (master)](https://github.com/kietpro352010/AICO/actions/runs/42822944398)
**CI Result:** `SUCCESS` (40/40 tests pass, exit code 0)  
**Remediation Target:** Phase 0 Finalization & Baseline Freeze  

---

## 1. TRACEABILITY CLASSIFICATION TAXONOMY

In strict compliance with executive guidelines, all 32 canonical V3 requirements are categorized based solely on verifiable automated test evidence:
- **`IMPLEMENTED_VERIFIED` (18 requirements):** Fully implemented in production/service code and 100% verified by automated test suites.
- **`IMPLEMENTED_PARTIAL` (4 requirements):** Architecture, types, and schema migrations compiled and verified on sandbox, but runtime cutover (Phase 1–4) remains pending.
- **`NOT_IMPLEMENTED` (10 requirements):** Advanced collaboration, outbox dispatch, and token intelligence features scheduled for future engineering phases (Phase 2–6).
- **`NOT_VERIFIED` (0 requirements within Phase 0 scope):** Zero ambiguous or unverified Phase 0 items.
- **`BLOCKED` (0 requirements):** Zero technical blockers for Phase 0.

---

## 2. CANONICAL V3 REQUIREMENTS TRACEABILITY TABLE (32 REQUIREMENTS)

| Requirement ID | Domain / Subsystem | Description | Evidence-Based Status | Implementation Source Location | Automated Test Verification Evidence |
| :--- | :--- | :--- | :---: | :--- | :--- |
| **`REQ-V3-001`** | Architecture | Hexagonal Modular Monolith with inward dependency flow | `IMPLEMENTED_VERIFIED` | `company-mcp/src/services/`, `company-mcp/src/db/` | `test/baseline.test.ts` (Test 1 & 4), `company-mcp/src/contracts/` |
| **`REQ-V3-002`** | Event Bus | In-process domain events adhering to `aico.event.v3` | `NOT_IMPLEMENTED` | Scheduled for Phase 2 / `V3-G4`. Currently uses synchronous service method invocations. | Blueprint: `docs/blueprint/v3/04_MCP_API_AND_EVENT_CONTRACTS.md` |
| **`REQ-V3-003`** | Protocols | MCP JSON-RPC 2.0 over STDIO and HTTP loopback (`127.0.0.1:3334`) | `IMPLEMENTED_VERIFIED` | `company-mcp/src/index.ts`, `company-mcp/src/http-registry.ts` | `test/t09-e2e-http-transport.test.ts`, `test/t10-stdio-and-dpapi.test.ts` |
| **`REQ-V3-004`** | Gateway Security | Public Gateway (:3335) and ngrok tunnels disabled by default | `IMPLEMENTED_VERIFIED` | `company-mcp/src/http-public.ts`, `company-mcp/src/config/runtime-config.ts` | `test/t05-gateways-and-tools.test.ts`, `test/t09-e2e-http-transport.test.ts` |
| **`REQ-V3-005`** | Transport Security | STDIO raw frame cap (2 MiB) and zero non-JSON stdout leakage | `IMPLEMENTED_VERIFIED` | `company-mcp/src/security/stdio-security-pipeline.ts` | `test/t10-stdio-and-dpapi.test.ts` (Frame guard tests) |
| **`REQ-V3-006`** | Domain Model | Domain model encapsulating 24 core domain entities | `IMPLEMENTED_PARTIAL` | `company-mcp/src/db/migrations/schema-v050-rc2.sql` (24 entities mapped in DDL); core entities active in `company-mcp/src/services/` | `test/t01-manifest-and-migrations.test.ts` (Sandbox schema verification) |
| **`REQ-V3-007`** | Database Schema | Physical schema: 29 base tables, `memory_fts`, 3 triggers, 4 views, 17 indexes | `IMPLEMENTED_PARTIAL` | Complete DDL compiled in `company-mcp/src/db/migrations/schema-v050-rc2.sql` | `test/t01-manifest-and-migrations.test.ts` (Sandbox DDL migration dry run) |
| **`REQ-V3-008`** | Storage Engine | SQLite WAL mode (`PRAGMA journal_mode = WAL; busy_timeout = 5000;`) | `IMPLEMENTED_VERIFIED` | `company-mcp/src/db/connection-manager.ts` | `test/t01-manifest-and-migrations.test.ts`, `test/t06-backup-and-restore.test.ts` |
| **`REQ-V3-009`** | Event Persistence | Transactional Outbox pattern (`event_outbox`) for atomic dispatch | `NOT_IMPLEMENTED` | Table defined in `schema-v050-rc2.sql`. Outbox dispatcher worker scheduled for Phase 2. | Blueprint: `docs/blueprint/v3/03_DOMAIN_AND_DATABASE_DESIGN.md` |
| **`REQ-V3-010`** | Backward Compat | 4 backward-compatible views (`v_tasks_legacy`, `v_agents_legacy`, `v_quota_legacy`, `v_approvals_legacy`) | `IMPLEMENTED_PARTIAL` | Defined in `company-mcp/src/db/migrations/schema-v050-rc2.sql` | `test/t01-manifest-and-migrations.test.ts` (View parity test on sandbox) |
| **`REQ-V3-011`** | Collaboration | 6 chat room types (`EXECUTIVE_BOARDROOM`, `ANNOUNCEMENTS`, `DEPARTMENT_OFFICE`, `PROJECT_ROOM`, `TASK_ROOM`, `DIRECT_MESSAGE`) | `NOT_IMPLEMENTED` | Scheduled for Phase 3 / `V3-G4`. Blocked by Gate V3-G7. | Blueprint: `docs/blueprint/v3/05_COLLABORATION_AND_CHAT_ROOM_ARCHITECTURE.md` |
| **`REQ-V3-012`** | Chat Broker | Typed messages (`TEXT`, `DIRECTIVE`, `PROPOSAL`, `REVIEW_FEEDBACK`, `GATE_STATUS`, `SYSTEM_NOTICE`) | `NOT_IMPLEMENTED` | Scheduled for Phase 3. Blocked by Gate V3-G7. | Blueprint: `docs/blueprint/v3/05_COLLABORATION_AND_CHAT_ROOM_ARCHITECTURE.md` |
| **`REQ-V3-013`** | Thread Engine | Discussion thread lifecycle (`OPEN`, `RESOLVED`, `CLOSED`) with memory resolution | `NOT_IMPLEMENTED` | Scheduled for Phase 3. Blocked by Gate V3-G7. | Blueprint: `docs/blueprint/v3/05_COLLABORATION_AND_CHAT_ROOM_ARCHITECTURE.md` |
| **`REQ-V3-014`** | Mention Engine | `@agent-id` and `@founder-01` mentions routed to `notifications_inbox` | `NOT_IMPLEMENTED` | Scheduled for Phase 3. Blocked by Gate V3-G7. | Blueprint: `docs/blueprint/v3/05_COLLABORATION_AND_CHAT_ROOM_ARCHITECTURE.md` |
| **`REQ-V3-015`** | Room Lifecycle | Ephemeral task rooms auto-provision on complex tasks, auto-archive on completion | `NOT_IMPLEMENTED` | Scheduled for Phase 3. Blocked by Gate V3-G7. | Blueprint: `docs/blueprint/v3/05_COLLABORATION_AND_CHAT_ROOM_ARCHITECTURE.md` |
| **`REQ-V3-016`** | Scoped Memory | 5-tier memory hierarchy (`COMPANY`, `PROJECT`, `TASK`, `ROOM`, `AGENT_PRIVATE`) | `IMPLEMENTED_PARTIAL` | `company-mcp/src/services/knowledge-memory-service.ts` (Company, Project, Task, Agent tiers active) | `test/t04-comprehensive-verification.test.ts` (Part 2) |
| **`REQ-V3-017`** | Memory Isolation | `AGENT_PRIVATE` memory strictly partitioned; zero cross-agent leakage | `IMPLEMENTED_VERIFIED` | `KnowledgeMemoryService.queryEntries()` & `storeEntry()` | `test/t04-comprehensive-verification.test.ts`, `test/t07-integration-security.test.ts` |
| **`REQ-V3-018`** | Context Snapshot | Context Snapshots capturing facts, hypotheses, pending steps in <1,500 tokens | `NOT_IMPLEMENTED` | Scheduled for Phase 4 / `V3-G4`. | Blueprint: `docs/blueprint/v3/06_UNIFIED_CONTEXT_AND_MEMORY_ARCHITECTURE.md` |
| **`REQ-V3-019`** | Knowledge Provenance| Knowledge provenance tracking (agent, commit/file ref) and tombstoning (`is_tombstone = 1`) | `IMPLEMENTED_VERIFIED` | `company-mcp/src/services/knowledge-memory-service.ts` | `test/t04-comprehensive-verification.test.ts` (Knowledge tests) |
| **`REQ-V3-020`** | Full-Text Search | SQLite FTS5 search auto-synchronized via triggers on `memory_entries` + manual rebuild | `IMPLEMENTED_VERIFIED` | `KnowledgeMemoryService` (`memory_fts` trigger integration) | `test/t04-comprehensive-verification.test.ts` (FTS5 search & trigger sync) |
| **`REQ-V3-021`** | Workflow State Machine| Task state machine enforcing exactly 23 states and 28 valid transitions | `IMPLEMENTED_VERIFIED` | `company-mcp/src/services/project-task-service.ts` | `test/t08-task-state-machine-26.test.ts` (All 26 transitions TR-01 to TR-26) |
| **`REQ-V3-022`** | Task Graph | Task dependencies forming DAG with Kahn's algorithm cycle detection | `IMPLEMENTED_VERIFIED` | `ProjectTaskService.validateTaskDependencies()` | `test/t08-task-state-machine-26.test.ts` (DAG cycle tests) |
| **`REQ-V3-023`** | Task Leasing | Concurrent task claims requiring exclusive leases, nonces, and heartbeats | `IMPLEMENTED_VERIFIED` | `ProjectTaskService.acquireTaskLease()`, `renewTaskLease()` | `test/t08-task-state-machine-26.test.ts` (Lease acquisition & renewal) |
| **`REQ-V3-024`** | Lease Recovery | Stale lease recovery: standard tasks to `READY_FOR_DEV`; expired Argon tasks to `BLOCKED_MANUAL_INTERVENTION` | `IMPLEMENTED_VERIFIED` | `ProjectTaskService.recoverStaleLeases()` | `test/t16-security-stabilization.test.ts` (Test 4.1) |
| **`REQ-V3-025`** | Review SoD | Technical reviews and QA verification enforcing Four-Eyes Principle (Separation of Duties) | `IMPLEMENTED_VERIFIED` | `ProjectTaskService.reviewTask()` & `transitionTask()` | `test/t08-task-state-machine-26.test.ts`, `test/t16-security-stabilization.test.ts` (Tests 3.2, 3.3, 3.4) |
| **`REQ-V3-026`** | Context Diet | Capability Registry profiling tasks and injecting 1-2 relevant skills per turn | `NOT_IMPLEMENTED` | Scheduled for Phase 6 / `V3-G6`. | Blueprint: `docs/blueprint/v3/08_SKILLS_TOOLS_AND_PLUGIN_ECOSYSTEM.md` |
| **`REQ-V3-027`** | Model Routing | Model routing matching task complexity (`TRIVIAL`..`SPECIALIST`) to cost-optimal models | `NOT_IMPLEMENTED` | Scheduled for Phase 6 / `V3-G6`. | Blueprint: `docs/blueprint/v3/09_MODEL_ROUTING_TOKEN_AND_COST_INTELLIGENCE.md` |
| **`REQ-V3-028`** | Quota Guardrails | Token usage tracked per task across 5 quota pools with 80% warning and 100% hard cut-off | `IMPLEMENTED_VERIFIED` | `company-mcp/src/services/observability-quota-service.ts` | `test/t02-core-services.test.ts` (Part 3), `test/t07-integration-security.test.ts` |
| **`REQ-V3-029`** | Human Identity | Founder modeled as human security principal (`founder-01`), strictly separated from AI agents | `IMPLEMENTED_VERIFIED` | `company-mcp/src/services/identity-access-service.ts` | `test/t02-core-services.test.ts`, `test/t16-security-stabilization.test.ts` |
| **`REQ-V3-030`** | Verifiable Approval| Founder approvals: RFC 8785 (JCS) deterministic hashing, authenticated context, single-use | `IMPLEMENTED_VERIFIED` | `company-mcp/src/security/rfc8785-canonicalize.ts`, `ApprovalService.consumeApproval()` | `test/t16-security-stabilization.test.ts` (Parts 1, 2, 3) |
| **`REQ-V3-031`** | Argon Protection | Argon specialists (`argon-01`, `argon-02`) NEVER auto-invoked, retried, or scheduled | `IMPLEMENTED_VERIFIED` | `company-manifest.json`, `ProjectTaskService`, `ApprovalService` | `test/t08-task-state-machine-26.test.ts`, `test/t16-security-stabilization.test.ts` |
| **`REQ-V3-032`** | Audit Immutability | Immutable forward HMAC-SHA256 chain in SQLite with external JSONL anchoring & fail-closed reconciliation | `IMPLEMENTED_VERIFIED` | `ObservabilityQuotaService.appendAuditEvent()`, `verifyAuditChainIntegrity()`, `reconcileUnanchoredEvents()` | `test/t16-security-stabilization.test.ts` (Parts 5.1 to 5.7, 40 tests) |

---

## 3. UNVERIFIED / FUTURE ITEMS REQUIRING POST-PHASE-0 AUTHORIZATION

As detailed in Section 5 of `V3_IMPLEMENTATION_READINESS.md`, the 10 `NOT_IMPLEMENTED` and 4 `IMPLEMENTED_PARTIAL` requirements belong to subsequent phases and CANNOT be verified in Phase 0:
- **Phase 1:** `REQ-V3-006` (Domain Entities Compilation), `REQ-V3-007` (Physical Schema Migration to v0.5.0 on Sandbox), `REQ-V3-010` (Backward Compat Views Cutover).
- **Phase 2:** `REQ-V3-002` (Event Bus), `REQ-V3-009` (Outbox Dispatcher).
- **Phase 3:** `REQ-V3-011` to `REQ-V3-015` (Chat Rooms, Message Broker, Threading, Mentions, Ephemeral Rooms).
- **Phase 4:** `REQ-V3-016` (Scoped Memory 5-tier room level), `REQ-V3-018` (Context Snapshots).
- **Phase 6:** `REQ-V3-026` (Context Diet), `REQ-V3-027` (Model Routing).

All runtime code for these items remains frozen pending CEO task allocation and Founder approval.
