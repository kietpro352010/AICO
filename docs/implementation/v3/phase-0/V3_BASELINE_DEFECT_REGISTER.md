# AICO V3 — BASELINE DEFECT REGISTER (PHASE 0 & PHASE 0.1)

**Document ID:** `AICO-V3-DOC-P0-03`  
**Author:** `flash-02` (Engineering & QA Lead)  
**Reviewer:** `chatgpt-01` (CEO & Main Orchestrator)  
**Date:** 2026-11-10  
**Status:** `ALL_DEFECTS_RESOLVED`

---

## 1. DEFECT CLASSIFICATION TAXONOMY

- **P0 (Critical / Blocker):** Architectural vulnerabilities that compromise authorization boundaries, allow silent data loss/corruption, or permit secret leakage.
- **P1 (High):** Bypasses in identity propagation, incomplete verification invariant enforcement, or non-fail-closed error handling.
- **P2 (Medium):** Specification divergence (e.g. edge-case RFC 8785 serialization nuances) or inconsistent operational semantics.

---

## 2. DEFECT LOG & REMEDIATION EVIDENCE

| Defect ID | Severity | Component | Root Cause Analysis | Remediation Implemented | Verification Evidence | Status |
| :--- | :---: | :--- | :--- | :--- | :--- | :---: |
| **`DEF-P0-01`** | P0 | `rfc8785Canonicalize` | Non-deterministic JSON serialization: sparse array holes were serialized inconsistently, lone surrogates were not rejected, and prototype pollution was possible. | Implemented strict RFC 8785 algorithm: lexicographical UTF-16 code unit key sorting, rejection of lone surrogates `[\uD800-\uDFFF]`, conversion of array holes to `null`, rejection of explicit `undefined`. | `test/t16-security-stabilization.test.ts` (Tests 1.1–1.6) | **CLOSED** |
| **`DEF-P0-02`** | P0 | `GitMediationService` | Git secret scanning only inspected the top 50 commits (`git rev-list --max-count=50`), allowing secrets committed further back or in untracked/unstaged working files to bypass detection. | Implemented full divergence analysis (`git merge-base`), scanning 100% of branch commits plus staged/unstaged porcelain working tree files. | `test/t16-security-stabilization.test.ts` (Test 6.1) | **CLOSED** |
| **`DEF-P0-A`** | P0 | `ObservabilityQuotaService` | **Silent Anchor Reconstruction:** In `reconcileUnanchoredEvents()`, if the external anchor file was deleted or missing, the method treated all DB events as unanchored and silently recreated the entire anchor history from scratch. | Enforced strict fail-closed: if the anchor file is missing or empty while DB has events, throws `SAFE_RECONCILIATION_REFUSED`. Reconstructs ONLY when valid prefix is independently verified. | `test/t16-security-stabilization.test.ts` (Test 5.7 Scenarios 1 & 2) | **CLOSED** |
| **`DEF-P0-B`** | P0 | `ObservabilityQuotaService` | **Empty DB Swallowed Verification Error:** In `verifyAuditChainIntegrity()`, when the DB table had 0 rows, anchor file read errors were caught and swallowed, incorrectly returning `valid: true`. Also ignored historical `sqlite_sequence`. | Reading errors now fail closed returning `UNREADABLE_AUDIT_ANCHOR_FILE`. Non-zero `sqlite_sequence` on empty table returns `TAIL_TRUNCATION_DETECTED`. | `test/t16-security-stabilization.test.ts` (Test 5.7 Scenarios 5 & 6) | **CLOSED** |
| **`DEF-P0-C`** | P0 | `ObservabilityQuotaService` | **Empty DB Reconciliation Bypass:** When `rows.length === 0`, `reconcileUnanchoredEvents()` immediately returned success without checking if historical anchors or SQLite sequence existed, masking database wipes. | Inspects both external anchor file and `sqlite_sequence`. If historical evidence remains while table is empty, throws `SAFE_RECONCILIATION_REFUSED`. | `test/t16-security-stabilization.test.ts` (Test 5.7 Scenarios 4 & 6) | **CLOSED** |
| **`DEF-P1-01`** | P1 | `ProjectTaskService` | In `reviewTask()`, callers could pass `reviewerId` string and omit `ctx`, prompting the service to fabricate an `effectiveCtx` with `authenticated: true`, bypassing real authentication. | Removed `reviewerId` fallback and `effectiveCtx`. Strictly mandates `params.ctx && ctx.authenticated === true` with valid `principalId` and `principalType`. | `test/t16-security-stabilization.test.ts` (Tests 3.2, 3.3, 3.4) | **CLOSED** |
| **`DEF-P1-02`** | P1 | `ApprovalService` | In `decideApproval()`, context validation did not check `ctx.authenticated === true`, accepting raw unauthenticated principal contexts. | Mandates `ctx.authenticated === true`. Enforces human `founder-01` for Founder-tier and authenticated `founder-01`/`flash-01` for Technical-tier. | `test/t16-security-stabilization.test.ts` (Test 2.3) | **CLOSED** |
| **`DEF-P1-03`** | P1 | `ProjectTaskService` | `verifyAndConsumeTaskApproval()` did not supply `expectedTargetResource` or `expectedTargetAgentId` to `consumeApproval()`, allowing an approval intended for one task/agent to be reused on another. | Passes `expectedTargetResource = task:${task.task_id}` and `expectedTargetAgentId = task.assigned_agent_id` into `consumeApproval()`. | `test/t16-security-stabilization.test.ts` (Tests 2.4, 3.5) | **CLOSED** |
| **`DEF-P1-04`** | P1 | `ObservabilityQuotaService` | `verifyAuditChainIntegrity()` only checked the latest anchor and DB tail, failing to detect deleted, duplicated, or reordered records in the middle or head of the anchor log. | Implemented 1-to-1 full sequence verification (`lines.length === rows.length`). Flags `ANCHOR_COVERAGE_DEFICIT`, `ANCHOR_COVERAGE_EXCESS`, `MALFORMED_ANCHOR_RECORD`, and `DUPLICATE_OR_REORDERED_ANCHOR`. | `test/t16-security-stabilization.test.ts` (Tests 5.1–5.4, 5.7) | **CLOSED** |
| **`DEF-P1-05`** | P1 | `ObservabilityQuotaService` | `reconcileUnanchoredEvents()` did not verify the existing DB HMAC chain prior to reconciling and ignored gaps in the anchor file. | Verifies complete forward HMAC chain from `GENESIS_ANCHOR` for all DB rows, validates contiguous anchor lines, and fails closed with `SAFE_RECONCILIATION_REFUSED` on any anomaly. | `test/t16-security-stabilization.test.ts` (Tests 5.2, 5.5, 5.6) | **CLOSED** |
| **`DEF-P2-01`** | P2 | `rfc8785Canonicalize` | Non-standard numeric formatting: negative zero (`-0`) and non-finite numbers (`NaN`, `Infinity`) were not strictly normalized or rejected per RFC 8785 Section 3.2.2.3. | Normalizes `-0` to `0` and throws `TypeError` on `NaN` / `Infinity`. | `test/t16-security-stabilization.test.ts` (Tests 1.1, 1.4) | **CLOSED** |
| **`DEF-P2-02`** | P2 | `ProjectTaskService` | Loose fallback payload `{ taskId: task.task_id }` permitted critical task execution approvals to omit risk class and priority bindings. | Eliminated loose fallback. Strictly mandates exact canonical payload `{ taskId, riskClass, priority }` for critical tasks. | `test/t16-security-stabilization.test.ts` (Test 3.1) | **CLOSED** |

---

## 3. OPEN DEFECT INVENTORY

- **Open P0 Defects:** **0**
- **Open P1 Defects:** **0**
- **Open P2 Defects:** **0**
- **Total Open Defects:** **0**

All 12 logged defects across Phase 0 and Phase 0.1 have been resolved with reproducible regression tests permanently integrated into the automated test suite.
