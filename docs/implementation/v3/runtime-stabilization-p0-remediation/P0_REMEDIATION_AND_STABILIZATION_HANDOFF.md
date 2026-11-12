# AICO Runtime Stabilization & P0 Security Remediation — Review & Handoff Report

**Document ID:** AICO-RUNTIME-STAB-P0-HANDOFF  
**Assigned Agent:** `flash-02` (Engineering & QA Lead)  
**Reporting To:** `chatgpt-01` (CEO & Main Orchestrator) & **Founder**  
**Branch:** `fix/runtime-stabilization-p0-remediation`  
**Baseline Audited:** `98938a2de45788ff8b5a5522713ee979d789b03f`  
**Commit Part 1 (Project Code & Regression Tests):** `afbc906` (`fix(security): stabilize HTTP keep-alive/rate-limiting and remediate P0-01 to P0-04`)  
**Commit Part 2 (Deliverables & Notes):** This report (`docs/implementation/v3/runtime-stabilization-p0-remediation/P0_REMEDIATION_AND_STABILIZATION_HANDOFF.md`)

> **Governance Note:** Per AICO directives, `flash-02` cannot self-approve its own security remediation. `main` and `master` have **not** been modified, pushed, or merged; this branch is ready for independent review by `chatgpt-01` and Founder approval.

---

## 1. Root-Cause Report — CI Failure (`T19 F-04 ECONNRESET`) & Rate-Limit Finding

### 1.1 Observed CI Failure on `main` & `master` (`98938a2`)
- **Failed Suite:** `T19: Runtime Stabilization Regressions (F-02 to F-06)` -> `✖ F-04: listInbox & listActivities enforce integer limits 1..100 (default 50) (9564.7214ms)`
- **Observed Error:** `Error: read ECONNRESET` at `TCP.onStreamRead (node:internal/stream_base_commons:221:20)` (`errno: -4077`, `syscall: 'read'`), causing `tests 127 | pass 125 | fail 2`.
- **Execution-Path & Request Analysis:**
  - In baseline `98938a2` (`8c0d5b7`), `test/t19-runtime-stabilization-regressions.test.ts` (`postMcpJsonRpc()`) and `company-mcp/src/client-bridge.ts` (`forwardJsonRpc()`) called `http.request(...)` without `agent: false` or `Connection: "close"`, causing Node.js 24's default global agent to keep idle loopback TCP sockets open after `F-03`'s `M30` (`company_heartbeat_task`, `id: 301..302`) calls.
  - Neither `company-mcp/src/http-registry.ts`, `company-mcp/src/http-public.ts`, nor `T19`'s `startLocalApp()` configured HTTP server timeouts, leaving Node's default `server.keepAliveTimeout` at **`5000ms`**.
  - Inside `F-04`, synchronous SQLite setup (`60` `msgService.sendMessage` transactions + `60` `agent_workspace_activities` inserts + read/error checks) ran over `5s` on the `windows-latest` CI runner (`9564.7214ms` total test runtime). Because the CI traceback ends at `TCP.onStreamRead` without an inner `t19` line number, **execution order and timing indicate the stalled keep-alive socket was reused by `F-04`'s first HTTP JSON-RPC request (`m36Bad`: `POST /mcp`, `tools/call` `company_list_inbox` `{ limit: -1 }`, JSON-RPC `id: 201`)** (or an immediately subsequent `F-04` request `id: 201..204`), racing with the server's `5000ms` idle socket close and raising `read ECONNRESET`.
  - Additionally, `T19` previously mounted `localPipeline.middleware()` before `express.json(...)`.

### 1.2 Root Fixes Implemented (Phase A)
1. **[`http-security-pipeline.ts`](../../../../company-mcp/src/security/http-security-pipeline.ts):** Added `configureGatewayHttpServer(server, profile)` setting:
   - `server.keepAliveTimeout = Math.max(profile.requestTimeoutMs + 35_000, 65_000)` (`>= 65s`)
   - `server.headersTimeout = keepAliveTimeoutMs + 5_000`
   - `server.requestTimeout = Math.max(profile.requestTimeoutMs + 5_000, 35_000)`
   Wired into [`http-registry.ts`](../../../../company-mcp/src/http-registry.ts), [`http-public.ts`](../../../../company-mcp/src/http-public.ts), and `T19` `startLocalApp()`.
2. **[`client-bridge.ts`](../../../../company-mcp/src/client-bridge.ts) & [`t19-runtime-stabilization-regressions.test.ts`](../../../../company-mcp/test/t19-runtime-stabilization-regressions.test.ts):** `forwardJsonRpc()` and `postMcpJsonRpc()` default to `agent: false` + `Connection: "close"` for stateless calls, fixed middleware ordering (`express.json(...)` before `localPipeline.middleware()`), and added `T19 Phase A` regression verifying persistent `http.Agent({ keepAlive: true, maxSockets: 1 })` reuse survives past `5200ms`.
3. **Secondary Stabilization Finding (`HttpSecurityPipeline` + `TokenBucketRateLimiter`):** During full-suite bursts (`<2s` on `127.0.0.1`), Step 6 in `HttpSecurityPipeline.middleware()` previously called `this.ipLimiter.consume(clientIp)` even on valid Bearer requests, depleting `unauthenticatedRateLimit.burstCapacity` (`15` on `LOCAL_GATEWAY_PROFILE`) and triggering intermittent `429 RATE_LIMIT_EXCEEDED` at request #17 (`T19 F-05 wireM34Replay`). Added read-only `check()` to [`rate-limiter.ts`](../../../../company-mcp/src/security/rate-limiter.ts); Step 6 now calls `check(clientIp)` when an `Authorization: Bearer ...` header is present and only calls `consume(clientIp)` when the header is missing or `authenticateToken()` fails in Step 7, leaving authenticated traffic governed by `credLimiter` (`120/min`, burst `30` local; `60/min`, burst `15` public).

---

## 2. P0 Remediation Matrix (`P0-01` to `P0-04`)

| ID | Risk Closed | Key Files & Functions Changed | Verification Focus (`T20` & Existing Suites) |
| :--- | :--- | :--- | :--- |
| **`P0-01`** | Per-agent workspace path traversal, Win32 filename/ADS/UNC aliases, root/ancestor junction & dangling symlink escapes | - [`path-containment.ts`](../../../../company-mcp/src/security/path-containment.ts): `assertValidSingleSegment()`, `isPathWithinBoundary()`, `assertLexicalRelativePathSafe()`, `resolveContainedWorkspacePath()`, `resolveContainedAbsoluteRootPath()`<br>- [`migration-runner.ts`](../../../../company-mcp/src/db/migration-runner.ts): exported `resolveCanonicalFilesystemPath()`, Win32 normalization helpers<br>- [`workspace-artifact-service.ts`](../../../../company-mcp/src/services/workspace-artifact-service.ts): `validateAndResolveSafePath()`, `resolveScopedWorkspaceTarget()`, `writeFileAtomically()`, `readArtifact()`, `writeArtifact()`, `listFiles()`, `getWorkspaceMeta()`, `shareArtifact()`<br>- [`workspace-manager.ts`](../../../../company-mcp/src/workspace-manager.ts): `resolveSecurePath()` | Blocks `../other-agent/...`, null bytes/`%00`, trailing dots/spaces (`file.`), ADS (`:`), drive/UNC/`\??\`, agent-root/subdir NTFS junctions (`fs.symlinkSync(..., "junction")`), and synthetic dangling/nested symlinks (`fakeFs` `ENOENT`). |
| **`P0-02`** | Scope conflation (`workspace:read:any` / `workspace:audit:read` able to write/share), unauthenticated `M01`–`M05` and broad task reads | - [`context-store.ts`](../../../../company-mcp/src/security/context-store.ts): `assertAuthenticatedContext()`, `isFounderHuman()`, `isExecutiveLeadership()`, `isReviewLeadership()`, `isArchiveLeadership()`, `hasPrincipalScope()`<br>- [`workspace-artifact-service.ts`](../../../../company-mcp/src/services/workspace-artifact-service.ts): `authorizeWorkspaceAccess(ctx, targetAgentId, "read"\|"write"\|"audit")`, `checkOwnershipOrScope()`, all artifact/listing/meta/share/activity methods<br>- [`registry-core.ts`](../../../../company-mcp/src/registry-core.ts): `registerCompanyTools()` (`M01`–`M05` require context + `company:read` on `M02`–`M05`), `TOOL_REQUIRED_SCOPES` (`M17`–`M19` `read:self\|read:any`; `M22` `audit:read\|audit` only)<br>- [`project-task-service.ts`](../../../../company-mcp/src/services/project-task-service.ts): `listTasks()`, `getTask()` unconditionally call `assertAuthenticatedContext()` and remove `!callerCtx` broad-read bypass | Unauthenticated service & HTTP `M01`–`M05`/`M17`–`M22`/`listTasks`/`getTask` fail closed; `workspace:read:any` reads cross-agent files but cannot write or read audit logs; `workspace:audit:read` reads audit logs via `M22` but cannot read/write files. |
| **`P0-03`** | Bypassed approvals (`TR-04`/`TR-18` on non-critical tasks, `TR-06`/`TR-10` on critical tasks), cross-agent active lease hijack (`TR-12`), missing state/ABAC guards, Public Gateway `M31` escalation | - [`project-task-service.ts`](../../../../company-mcp/src/services/project-task-service.ts): `verifyAndConsumeTaskApproval()`, `transitionTask()` (`TR-01`..`TR-26`), `TransitionInput.allowReviewAndAdminTransitions`<br>- [`registry-core.ts`](../../../../company-mcp/src/registry-core.ts): `M31` (`company_transition_task`) passes `allowReviewAndAdminTransitions: !isPublic` | `TR-04`/`TR-18` require valid approval + non-self-approval + executive role across all priorities/risks; `TR-12` rejects breaking another agent's active non-expired lease; `TR-11`/`TR-22` block expired leases; `TR-15` evaluates before `TR-13` for both `claimed`/`in_progress`; Public Gateway `M31` blocks `TR-04`, `TR-18`, `TR-23`, `TR-25`, `TR-26`. |
| **`P0-04`** | Implicit `"founder-01"`, `"chatgpt-01"`, `"flash-01"` identity fallbacks & unauthenticated principal synthesis | - [`identity-access-service.ts`](../../../../company-mcp/src/services/identity-access-service.ts): disabled `getPrincipalById()` (`SECURITY_VIOLATION`)<br>- [`messaging-service.ts`](../../../../company-mcp/src/services/messaging-service.ts): `sendMessage()`<br>- [`approval-service.ts`](../../../../company-mcp/src/services/approval-service.ts): `createApprovalRequest()`<br>- [`project-task-service.ts`](../../../../company-mcp/src/services/project-task-service.ts): `createProject()`, `createTask()`, `heartbeatTask()`, `claimTask()`, `transitionTask()`<br>- [`git-mediation-service.ts`](../../../../company-mcp/src/services/git-mediation-service.ts): `syncAgentBranch()`<br>- [`knowledge-memory-service.ts`](../../../../company-mcp/src/services/knowledge-memory-service.ts): `proposeKnowledgeChange()`, `approveKnowledgeProposal()`, `searchMemory()`, `writeMemory()`<br>- [`observability-quota-service.ts`](../../../../company-mcp/src/services/observability-quota-service.ts): `appendAuditEvent()`, `recordMcpActivity()`, `recordModelUsage()`<br>- [`registry-core.ts`](../../../../company-mcp/src/registry-core.ts): removed `"flash-01"` fallbacks on `M17`–`M21`, `M23`, `company_knowledge_memory_ops` (`search_memory`, `write_memory`, `record_model_usage`) | `getPrincipalById()` throws unconditionally; spoofed `actorId`/`from_principal_id`/`created_by` cannot override verified `PrincipalContext`; human `recordMcpActivity()` does not forge `"founder-01"`; audit chain records authentic `principal_id`/`principal_type`; fail-closed `VALIDATION_ERROR` for human callers without `target_agent_id` / `ownerAgentId` / bound `agent_id`. |

---

## 3. Regression Test & Verification Evidence

### 3.1 Full Test Suite (`D:\AI-COMPANY\company-mcp`)
Command executed after the final code and test edit (on isolated temporary sandbox SQLite databases; production DB untouched):
```powershell
Set-Location d:\AI-COMPANY\company-mcp
npm.cmd test   # node --import tsx --test "test/**/*.test.ts"
```
Observed output:
- **Exit code:** `0`
- **Total assertions/cases:** **`tests 133` | `suites 1` | `pass 133` | `fail 0` | `cancelled 0` | `skipped 0` | `todo 0`** (`duration_ms 21597.488`)
- Covers all **15 test files** (`baseline.test.ts`, `t01`–`t05`, `t07`–`t10`, `t16`–`t20`), including:
  - [`t19-runtime-stabilization-regressions.test.ts`](../../../../company-mcp/test/t19-runtime-stabilization-regressions.test.ts): `F-02`..`F-06` + `Phase A: configureGatewayHttpServer prevents idle keep-alive ECONNRESET past 5s` (**6 subtests + parent suite PASS**).
  - [`t20-p0-security-remediation.test.ts`](../../../../company-mcp/test/t20-p0-security-remediation.test.ts): **`P0-01`..`P0-04` (4 subtests + parent suite: `tests 5`, `pass 5`, `fail 0`**, `duration_ms 8288.8379` inside full run; `4633.9043ms` standalone).

### 3.2 TypeScript Typecheck Status (Honest Local Block Observation)
- Attempted bounded local verification of `tsc --noEmit` (`node node_modules/typescript/bin/tsc --noEmit`, using TypeScript `^7.0.2` native binary `@typescript/typescript-win32-x64\lib\tsc.exe`).
- **Observed result:** Process stalled on the Windows workstation (`TIMEOUT_15S`, exited `124` at 15s and terminated cleanly) while Windows SmartScreen (`smartscreen.exe`) previously activated during `tsc.exe` startup. No SmartScreen/host control was bypassed; therefore local `tsc --noEmit` completion remains **unverified locally** and awaits GitHub Actions `windows-latest` CI after approval/merge.

### 3.3 Production & Policy Guardrails Verified
- `D:\AI-COMPANY\data\aico.db` checked untouched (`Length: 45056`, `LastWriteTime: 11/5/2026 4:22:39 PM`, git-ignored).
- Zero migrations run against production; `G3`, `G4`, `G7` remain locked; Public Gateway / ngrok not enabled; `argon-01`/`argon-02` not invoked; V3 24-entity runtime integration (`F-01`) not implemented.

---

## 4. CI Links (`main` & `master`)

Because `.github/workflows/ci.yml` triggers only on pushes/PRs targeting `[main, master]` and AICO rules forbid merging or pushing to `main`/`master` without Founder/`chatgpt-01` approval, CI has **not** yet run for branch `fix/runtime-stabilization-p0-remediation` (`afbc906`).

Latest observed CI runs at baseline `98938a2de45788ff8b5a5522713ee979d789b03f` (showing the `T19 F-04 ECONNRESET` failure remediated in `afbc906`):
- **`main`:** https://github.com/kietpro352010/AICO/actions/runs/43055969943 (job: https://github.com/kietpro352010/AICO/actions/runs/43055969943/job/130645389741) — `failure`
- **`master`:** https://github.com/kietpro352010/AICO/actions/runs/43055969854 (job: https://github.com/kietpro352010/AICO/actions/runs/43055969854/job/130645389864) — `failure`

---

## 5. Remaining Risks & Unaddressed Findings

Per the Task Directive scope (Phase A CI fix + P0 remediation only; V3 integration & P1–P3 out of scope unless noted), the following pre-existing and newly observed items remain open for subsequent phases:

1. **V3 Runtime Integration Gap (`F-01`):** `0/24` V3 entities wired into production services/tools (explicitly deferred by restriction).
2. **`P1-02` to `P1-09` (from Audit `0996278`):**
   - `P1-02` / `P1-03`: Separate mutation/audit transactions + post-commit anchor file writes (`AUDIT_ANCHOR_WRITE_FAILURE`); `backup-db.ts` writing incompatible records into `audit_anchors.jsonl`.
   - `P1-04`: `decideApproval()` / `consumeApproval()` writing `status = 'expired'` inside a throwing transaction that rolls back.
   - `P1-05`: `KnowledgeMemoryService.writeMemory()` secret check before storage, `searchMemory()` project/task ACL & expiry filters, and `listInbox` defense-in-depth redaction.
   - `P1-06`: `PUBLIC_GATEWAY_PROFILE` fail-open `Origin` behavior when `allowedOrigins` is empty.
   - `P1-07`: `ConnectionManager` SQLite WAL mode / retry busy-wait / nested write transaction deadlock.
   - `P1-08` / `P1-09`: Stateless `proposeKnowledgeChange`/`approveKnowledgeProposal` stubs, `initSchema()` DDL drift, and `M38` Zod schema field stripping in `mcp-tool-schemas.ts`.
3. **`P2-02` to `P2-07` & `P3-01` to `P3-04`:** Idempotent `createTask` crash on duplicate `idempotency_key`, Ed25519 approval signatures, automated `recoverStaleLeases()` scheduler, `GitMediationService` wiring & `CompanyRegistryService` handle cleanup, `M08`/`M26` contract drift cleanup.
4. **Legacy Helper Observations Surfaced During `T20`:**
   - `WorkspaceManager.logActivity()` (`src/workspace-manager.ts:138`) inserts into `agent_workspace_activities` without `request_id`, triggering caught console errors (`NOT NULL constraint failed: agent_workspace_activities.request_id`) during standalone `WorkspaceManager` unit calls (`WorkspaceArtifactService` already provides `request_id`).
   - `AgentIdentityService.generateToken()` (`src/agent-identity-service.ts:29`) leaves `expiresInHours` optional (`null`), which violates `agent_credentials.expires_at NOT NULL` unless callers explicitly supply an expiry (as updated in `T20`).
5. **Local Workstation Typecheck:** Native TypeScript `7.0.2` (`tsc.exe`) blocked on Windows host (`SmartScreen`); CI `windows-latest` verification needed after branch approval/merge.

---

## 6. Final Handoff to `chatgpt-01` & Founder

- **Recommended Next Step 1:** `chatgpt-01` (with `flash-01` CTO review) inspects commit `afbc906` and this report on branch `fix/runtime-stabilization-p0-remediation`.
- **Recommended Next Step 2:** Upon Founder/`chatgpt-01` approval, fast-forward/merge `fix/runtime-stabilization-p0-remediation` to `main` and `master` so GitHub Actions CI executes `npm run typecheck` + `npm test` (`133/133`) across both primary branches.
- **Recommended Next Step 3:** Keep `V3-G3`, `V3-G4`, and `V3-G7` locked until Phase 1B resolves `P1-02`..`P1-09` and `P1-06`.
