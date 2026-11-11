# AICO V3 Runtime Integration Audit — Security & Failure Analysis (Workstreams C & D)

**Document ID:** AICO-V3-AUDIT-SEC-FAIL  
**Repository:** `https://github.com/kietpro352010/AICO`  
**Audited Baseline Commit:** `09962781306dec8f25737c058437210d32e6da8f`  
**Author:** `flash-02` (Engineering & QA Lead)  
**Reporting To:** `chatgpt-01` (CEO & Main Orchestrator)  
**Audit Date:** 2026-11-11  

---

## 1. Executive Summary of Security & Failure Posture

While individual defensive modules exist in isolation (`MigrationRunner` canonical path guard, RFC 8785 payload hashing, 20-rule [`SecretScanner`](file:///D:/AI-COMPANY/company-mcp/src/security/secret-scanner.ts), G1 `toPublic*DTO()` wrappers), active runtime execution in `company-mcp/src/` contains **critical authentication, agent isolation, governance, and transaction-integrity gaps**:

- **P0 Confirmed Runtime Vulnerabilities (4):** Cross-agent workspace filesystem traversal (`../<agent>/...`), read-only scope (`workspace:read:any`) authorizing cross-agent writes, task state-machine approval & lease hijack bypasses (`TR-04`, `TR-12`, `TR-18`, plus Public Gateway `M31` bypassing `M33` review restrictions), and direct-service default-identity spoofing paired with `founder-01 -> flash-01` attribution fallback.
- **P1 Confirmed Integrity & Security Failures (9):** Total disconnection of V3 DTOs & adapters (`0/24`), two-transaction non-atomic MCP audit commits + post-commit anchor write failure, `backup-db.ts` colliding with `audit_anchors.jsonl`, `decideApproval` rolling back `'expired'` updates, unredacted secrets & missing project/task ACLs in `KnowledgeMemoryService` & `MessagingService`, empty `allowedOrigins` fail-open on Public Gateway HTTP pipeline, missing WAL & spin-wait/self-locking `ConnectionManager`, stubbed knowledge proposals + DDL drift, and `M38 record_model_usage` silent input stripping.

---

## 2. Workstream D — Agent Isolation, Auth & Security Boundaries

### 2.1 Authentication & Transport Pipeline Analysis
- **STDIO Transport ([`src/index.ts`](file:///D:/AI-COMPANY/company-mcp/src/index.ts#L1-L35), [`stdio-security-pipeline.ts`](file:///D:/AI-COMPANY/company-mcp/src/security/stdio-security-pipeline.ts#L22-L94)):**
  - `bootstrap()` authenticates once at startup (`enterprise` `.dpapi`, plaintext `.token`, or `AICO_STDIO_TOKEN`), and binds `requestContextStore.enterWith(sessionPrincipal)`.
  - **Findings:** `revalidateLivePrincipal()` (`L78-L94`) and `validateMessageFrame()` (`L72-L76`) are never called in `src/index.ts` (though `registry-core.ts:367-382` `resolvePrincipal()` performs per-tool DB credential checks). STDIO bypasses HTTP Step 10 `SecretScanner.scan()`, enabling unscanned plaintext secrets to reach workspace writes (`M20`), task evidence (`M32`), and `KnowledgeMemoryService.writeMemory` (`M38`).
- **HTTP Pipelines ([`http-registry.ts`](file:///D:/AI-COMPANY/company-mcp/src/http-registry.ts), [`http-public.ts`](file:///D:/AI-COMPANY/company-mcp/src/http-public.ts#L36-L39), [`http-security-pipeline.ts`](file:///D:/AI-COMPANY/company-mcp/src/security/http-security-pipeline.ts#L30-L44,L215-L244)):**
  - `PUBLIC_GATEWAY_PROFILE` defaults `allowedOrigins` to `[]` (`L38-L41`), and Step 5 checks `if (!isOriginAllowed && this.profile.allowedOrigins.length > 0)` (`L235`). When `allowedOrigins` is empty, **any cross-origin browser `Origin` is accepted** (verified live in `Extra Probe`: `Origin: https://evil-attacker.example` passed Step 5 and reached Step 7 HTTP 401 rather than Step 5 HTTP 403 `AUTH_FORBIDDEN_ORIGIN`). `http-public.ts` also omits `allowedOrigins` and `jsonLimit` when calling `createMcpExpressApp`, whereas `http-registry.ts:26-31` passes both.
  - Step 5 host validation (`L218`: `host.startsWith(\`${allowed}:\`)`) fails to validate that the suffix after `:` is a numeric port matching `profile.port`.
- **Credential Verification (`IdentityAccessService` — [`identity-access-service.ts`](file:///D:/AI-COMPANY/company-mcp/src/services/identity-access-service.ts#L80-L107,L345-L606)):**
  - `getPrincipalById(principalId)` (`L80-L107`) synthesizes `authenticated: true` contexts without verifying credentials (injecting fake `credentialId: "cred_internal"`).
  - `authenticateToken()` scans all active `human_credentials` and `agent_credentials` linearly rather than indexing by `key_prefix`; never checks `agents.status` (revoked/suspended agents keep authenticating if credential rows are active); never updates `last_used_at`.
  - `hasScope()` (`L539-L552`) grants wildcard prefix access (e.g. `tasks:*` satisfies `tasks:manage`), while `checkPermission()` (`L588-L606`, backing `M08 company_check_permission`) checks only exact `!ctx.scopes.has(scope)` (`Extra Probe`: `hasScope=true`, `checkPermission=false`).

### 2.2 Agent Isolation, RBAC/ABAC & Privilege Escalation Paths

| Security Domain | Enforcement Intended | Verified Vulnerability / Bypass Path | Confirmed Evidence |
| :--- | :--- | :--- | :--- |
| **Workspace Filesystem Isolation** | Agents may only access `workspaces/<agentId>/...` unless granted explicit `workspace:read:any` | **P0-01 Traversal:** `readArtifact`, `writeArtifact`, and `listFiles` (`L221, L239, L273`) join `path.join(agentId, relativePath)` and call `validateAndResolveSafePath(..., "workspaces")` (`L42-L53`), validating containment within `workspaces/` instead of `workspaces/<agentId>/`. Keeping `target_agent_id` unset passes `checkOwnershipOrScope`, allowing `relative_path: "../flash-02/..."` to read/overwrite/list peer workspaces. | **E2E Scenario 5:** `relativePathEscapeToFlash02Succeeded: true` |
| **Workspace Read vs Write Separation** | `workspace:read:any` and `workspace:audit:read` grant read-only audit visibility | **P0-02 Escalation:** `checkOwnershipOrScope` (`L117-L119`) returns early on `workspace:read:any` or `workspace:audit:read`, and `safeWriteArtifact` (`L133`) delegates authorization to `checkOwnershipOrScope`. Any holder of read-only cross-agent scope can overwrite any peer agent's workspace (`M20`). Plus `listActivities` (`L435`) takes no `ctx`, and `service` principals (`agentId: null`) bypass `L120`. | **E2E Scenario 5:** `readOnlyScopeAllowedCrossAgentWrite: true` |
| **Task State Machine & Governance** | `waiting_approval`, active leases, and Public Gateway task review must be restricted | **P0-03 Bypass:** Inside [`transitionTask`](file:///D:/AI-COMPANY/company-mcp/src/services/project-task-service.ts#L589-L940), **TR-04** (`waiting_approval->queued`) & **TR-18** (`waiting_approval->in_progress`) skip `verifyAndConsumeTaskApproval` for `low`/`medium`/`high` tasks and enforce zero caller ABAC; **TR-12** (`claimed->assigned`) lets any unrelated agent drop an active lease; **TR-01** ignores `P0` priority; **TR-06/08/16/20** enforce zero ownership checks; **TR-22/25** via `M31` run on **Public Gateway** (`http-security-pipeline.ts:70`) even though `M33` was blocked from public exposure! | **E2E Scenario 3 & Extra Probe:** `bypassedHighRiskWaitingApprovalWithoutApprovalId: "queued"`, `unrelatedAgentDroppedActiveLeaseViaTR12: true`, `publicM31CompletedTaskWithoutM33: "completed"` |
| **Identity Attribution & Service Calls** | Every service mutation must require an authenticated principal and preserve real caller ID | **P0-04 Spoofing / Impersonation:** Omitting `ctx` in `MessagingService.sendMessage` defaults to `"founder-01"`; `createTask` defaults `"chatgpt-01"`; `createProject` ignores `ctx` completely (`approved_by_human_id='founder-01'`); `OrchestrationService` trusts spoofable `params.actorPrincipalId`; `GitMediationService.syncAgentBranch` fails open without `ctx`. Furthermore, [`registry-core.ts`](file:///D:/AI-COMPANY/company-mcp/src/registry-core.ts#L832) falls back `ctx.agentId \|\| "flash-01"` on M17–M21, M23, and M38 — misattributing `founder-01` writes to `"flash-01"`. | **E2E Scenario 2 & Scenario 5:** `spoofedFrom: "founder-01"`, `founderWriteMemoryAttributedTo.owner_agent_id: "flash-01"` |
| **Cross-Scope Memory & Unredacted Secrets** | Memory must enforce project/task/room boundaries and prevent credential persistence | **P1-05:** `KnowledgeMemoryService.searchMemory` (`L198-L202`) checks no project membership or task assignment ACLs (`codex-01` read `proj_other_secret` memory), ignores `status`/`expires_at` on `agent_private`/`project`/`task_context`, and `writeMemory` (`L223-L271`) performs zero `SecretScanner` checks while hardcoding `status='verified'`. | **E2E Scenario 5:** `crossProjectMemoryReadableByUnassignedAgent: 1`, `secretStoredUnblockedInCompanyMemory: true` |

### 2.3 Public DTO Boundaries, Metadata Exposure & Secret Scanning
- **G1 Public DTOs Completely Unexecuted at Runtime:** `toPublic*DTO()`, `PublicChatMessageMetadataSchema`, `internal_metadata` / `internal_details` isolation, and `raw_token_trace` stripping exist strictly in `src/domain/*` and `test/t17`/`t18`. Zero MCP responses pass through G1 DTO sanitizers or outbound `SecretScanner.redact()`.
- **Active Unredacted Secret Paths:**
  1. `KnowledgeMemoryService.writeMemory` / `searchMemory` persist and return raw API keys (`sk-live-...`) without calling `SecretScanner`.
  2. `MessagingService.listInbox` (`L137-L169`) returns stored secrets unredacted (`S2_EVIDENCE`: `readPathReturnedUnredactedSecret: true`); `sendMessage` & `ackMessage` error throws (`L80, L87`) expose matched rule regex strings.
  3. `WorkspaceArtifactService.writeArtifact` (`L232`) and `shareArtifact` (`L394`) never scan file content (STDIO callers can persist secrets directly to disk artifacts).
  4. `GitMediationService.scanCommitFiles` (`L31-L184`) checks `.env`/key filenames and diffs with `git status --porcelain` (without `-z`, mis-handling renames/octal paths, reading binaries as UTF-8, and without verifying symlink targets inside git clones).

---

## 3. Workstream C — Transaction Safety, Concurrency, Idempotency & Recovery

### 3.1 SQLite Transaction & Concurrency Analysis ([`ConnectionManager`](file:///D:/AI-COMPANY/company-mcp/src/db/connection-manager.ts#L19-L80))
- **Missing WAL & Synchronous Pragmas:** Both `getConnection()` (`L19-L34`) and `getDatabase()` (`L36-L41`) execute only `PRAGMA busy_timeout = 5000;` and `PRAGMA foreign_keys = ON;`. Neither sets `PRAGMA journal_mode = WAL;` or `PRAGMA synchronous = NORMAL;` (contradicting hardcoded UI string `"SQLite WAL with Foreign Keys"` in `CompanyRegistryService`).
- **Synchronous Event-Loop Blocking & Case-Sensitive Retry (`L68-L73`):** `withWriteTransaction` opens a brand-new `DatabaseSync` handle per transaction, retries only if `err.message.includes("busy")` (lowercase `"busy"`, missing uppercase SQLite `SQLITE_BUSY` phrasing), and spins synchronously (`while (Date.now() < end) {}`), blocking the Node.js event loop under contention.
- **No Nested Transaction / `SAVEPOINT` Support:** Calling `withWriteTransaction` inside an active `withWriteTransaction` opens a second `DatabaseSync` connection and attempts a second `BEGIN IMMEDIATE`, immediately self-locking (`nestedWithWriteTransactionError: "database is locked"` after 5s busy timeout in E2E Scenario 6).
- **Connection Handle Leaks ([`CompanyRegistryService`](file:///D:/AI-COMPANY/company-mcp/src/services/company-registry-service.ts#L90,L111)):** `listAgents()` (`L90`) and `listQuotaPools()` (`L111`) call `this.connManager.getDatabase()` and never invoke `.close()`. Calling `M02`, `M03`, `M04`, `M05`, or `M06` leaks live SQLite file descriptors until garbage collection.

### 3.2 Atomicity, Rollback & Anchor Integrity Defects
1. **Split Two-Transaction MCP Audit + Post-Commit Anchor Failure (`P1-02`):**
   - Across 12 MCP write handlers (`M10–M13, M16, M24, M26, M29, M31–M34` in `registry-core.ts`), the domain mutation commits in `withWriteTransaction` #1, and `obsService.appendAuditEvent()` opens `withWriteTransaction` #2.
   - Inside [`appendAuditEvent`](file:///D:/AI-COMPANY/company-mcp/src/services/observability-quota-service.ts#L195-L226), SQLite `COMMIT` completes at `L213` *before* `writeAnchorRecord()` writes to `audit_anchors.jsonl` (`L219`).
   - **Live E2E Scenario 6 Proof:** Invoking `M26` with an unwritable anchor path (`sandbox.tempDir` -> `EISDIR`) returned `isError: true` (`AUDIT_ANCHOR_WRITE_FAILURE`), yet left **both** `tasks` (`task_partial_orphan`) and `audit_events` (`audit_id = 1`) permanently committed in SQLite with 0 anchor records.
2. **Backup Script Corrupts Live Audit Anchor Chain (`P1-03`):**
   - [`performBackup`](file:///D:/AI-COMPANY/company-mcp/src/scripts/backup-db.ts#L46-L54) writes backup manifests into `D:/AI-COMPANY/backup/audit_anchors.jsonl`, colliding with [`ObservabilityQuotaService`'s default `anchorFilePath`](file:///D:/AI-COMPANY/company-mcp/src/services/observability-quota-service.ts#L76).
   - **Live E2E Scenario 4 Proof:** Running one backup immediately causes `reconcileUnanchoredEvents()` to abort with `SAFE_RECONCILIATION_REFUSED: Malformed anchor record structure at line 2. Fail-closed.`.
3. **Expired Approval State Rolled Back on Throw (`P1-04`):**
   - `ApprovalService.decideApproval` (`L277-L280`) runs `UPDATE approval_requests SET status = 'expired'` then throws `APPROVAL_EXPIRED` inside `withWriteTransaction`, triggering `ROLLBACK;` and reverting the row to `'pending'` (`Extra Probe`: `expiredDecideApprovalDbStatusAfterRollback: "pending"`). The same rollback pattern occurs when `ProjectTaskService.verifyAndConsumeTaskApproval` throws after `consumeApproval` updates `status = 'expired'`.

### 3.3 Idempotency, Crash Recovery & Outbox Consistency
- **Broken Task Idempotency (`P2-02`):** [`ProjectTaskService.createTask`](file:///D:/AI-COMPANY/company-mcp/src/services/project-task-service.ts#L321,L355) accepts `idempotencyKey`, yet attempts an unconditional `INSERT` and throws `UNIQUE constraint failed: tasks.idempotency_key` on retry (`S7_EVIDENCE_IDEMPOTENCY`) instead of returning the existing task cleanly. `ApprovalService.createApprovalRequest` and `MessagingService.sendMessage` allocate fresh random IDs on every retry, producing duplicates.
- **Unwired Lease Recovery & Stale `dispatch_status` (`P2-04`):** `ProjectTaskService.recoverStaleLeases()` (`L942-L1031`) implements clean CAS recovery with retry exhaustion and Argon fail-closed blocking, **but has zero callers anywhere in `company-mcp/src/`**, and omits resetting `tasks.dispatch_status` (leaving `external_running` stale on recovered tasks). Meanwhile, `heartbeatTask` (`L481-L510`) never verifies `lease_expires_at > now`, allowing resurrection of expired leases without incrementing `version`.
- **Unimplemented Outbox Consistency:** Zero transactional outbox writes occur alongside any domain mutation (`event_outbox = 0`, `delivery_attempts = 0`, `dead_letter_queue = 0`). Eventual delivery guarantees designed in V3 Phase 1/Blueprint do not execute at runtime.
