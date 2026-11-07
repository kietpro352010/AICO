# AICO v2.2.1 — TEST EVIDENCE RECORD

**Date:** 2026-11-07  
**Auditor:** `flash-02` (Engineering & QA Lead)  
**Harness:** `node --import tsx --test "test/**/*.test.ts"` + `tsc --noEmit`

---

## 1. Test Runs

### Test Run TR-001 (Phase 0 Baseline)
- **Timestamp:** 2026-11-06 23:08:28 +07:00
- **Target Suite:** `company-mcp/test/baseline.test.ts`
- **Command:** `Push-Location D:\AI-COMPANY\company-mcp; npm.cmd test`
- **Exit Code:** `0` (Success)
- **Raw Summary:**
  ```text
  ▶ AICO Quality Baseline Test Suite
    ✔ 1. Canonical Manifest Integrity (1.8401ms)
    ✔ 2. AgentIdentityService Token Lifecycle & Timing-Safe Auth (22.5474ms)
    ✔ 3. WorkspaceManager Path Traversal Defense (33.7307ms)
    ✔ 4. Registry Core Tools Verification (2.4582ms)
    ✔ 5. Migration v0.4.1 Manifest Sync Blueprint (6.6716ms)
  ✔ AICO Quality Baseline Test Suite (172.0765ms)
  ℹ tests 5
  ℹ suites 1
  ℹ pass 5
  ℹ fail 0
  ```
- **Integrity Verification:**
  - Production DB `D:\AI-COMPANY\data\aico.db` SHA-256 before & after:
    `17BD93214291E33260DF4A3D0B7DAD417BCA05C137770443D4D3FA965595E416` (Unchanged).

---

### Test Run TR-002 (Static TypeScript Verification)
- **Timestamp:** 2026-11-07 07:28:40 +07:00
- **Command:** `Push-Location D:\AI-COMPANY\company-mcp; npm.cmd run typecheck`
- **Exit Code:** `0` (Success)
- **Output:**
  ```text
  > company-mcp@1.0.0 typecheck
  > tsc --noEmit
  ```
- **Verification Evidence:** All 10 Core Services (`S01`–`S10`), 38 MCP Tool Contracts (`M01`–`M38`), Security Pipelines (`HttpSecurityPipeline`, `StdioSecurityPipeline`), and Operational Scripts compile with zero TypeScript errors under NodeNext ESM.

---

### Test Run TR-003 (Full End-to-End Test Suite Execution)
- **Timestamp:** 2026-11-07 10:01:17 +07:00
- **Command:** `Push-Location D:\AI-COMPANY\company-mcp; npx.cmd tsc --noEmit; npm.cmd test`
- **Exit Code:** `0` (Success)
- **Raw Summary:**
  ```text
  ▶ AICO Quality Baseline Test Suite
    ✔ 1. Canonical Manifest Integrity (1.1559ms)
    ✔ 2. AgentIdentityService Token Lifecycle & Timing-Safe Auth (28.059ms)
    ✔ 3. WorkspaceManager Path Traversal Defense (43.2232ms)
    ✔ 4. Registry Core Tools Verification (2.4811ms)
    ✔ 5. Migration v0.4.1 Manifest Sync Blueprint (5.7363ms)
  ✔ AICO Quality Baseline Test Suite (246.5602ms)
  ✔ T01: MigrationRunner and Schema Migrations on Sandbox DB (111.5984ms)
  ✔ T02: Core Services — Identity, Approvals and Workspace Artifact Guard (240.2145ms)
  ✔ T03: MCP Tool Contracts and Public DTO Leakage Prevention (5.8368ms)
  ✔ T04-T08 Comprehensive Verification: Git, Knowledge FTS5, Task State Machine & HMAC Audit Chain (295.604ms)
  ✔ T05: Complete 38 MCP Tools & Gateway Allowlist Verification (9.2017ms)
  ✔ T06: Backup and Safe Restore Drills on Sandbox Database (64.1205ms)
  ✔ T07: End-to-End Integration, Fail-Closed RBAC/ABAC & Negative Security Test Suite (882.0076ms)
  ℹ tests 12
  ℹ suites 1
  ℹ pass 12
  ℹ fail 0
  ℹ cancelled 0
  ℹ skipped 0
  ℹ todo 0
  ℹ duration_ms 1648.4291
  ```
### Test Run TR-004 (Post-Audit Full Verification: 15 Suites, DPAPI, Black-box HTTP & 26 Transitions)
- **Timestamp:** 2026-11-07 11:55:56 +07:00
- **Command:** `Push-Location D:\AI-COMPANY\company-mcp; npm.cmd run typecheck; npm.cmd test`
- **Exit Code:** `0` (Success)
- **Typecheck Result:** `tsc --noEmit` exited with code 0 (zero errors).
- **Raw Summary:**
  ```text
  ▶ AICO Quality Baseline Test Suite
    ✔ 1. Canonical Manifest Integrity (1.7629ms)
    ✔ 2. AgentIdentityService Token Lifecycle & Timing-Safe Auth (51.6281ms)
    ✔ 3. WorkspaceManager Path Traversal Defense (72.0555ms)
    ✔ 4. Registry Core Tools Verification (2.9104ms)
    ✔ 5. Migration v0.4.1 Manifest Sync Blueprint (8.0217ms)
  ✔ AICO Quality Baseline Test Suite (317.6555ms)
  ✔ T01: MigrationRunner and Schema Migrations on Sandbox DB (115.526ms)
  ✔ T02: Core Services — Identity, Approvals and Workspace Artifact Guard (325.5383ms)
  ✔ T03: MCP Tool Contracts and Public DTO Leakage Prevention (7.2602ms)
  ✔ T04-T08 Comprehensive Verification: Git, Knowledge FTS5, Task State Machine & HMAC Audit Chain (426.2146ms)
  ✔ T05: Complete 38 MCP Tools & Gateway Allowlist Verification (7.6408ms)
  ✔ T06: Backup and Safe Restore Drills on Sandbox Database (68.7483ms)
  ✔ T07: End-to-End Integration, Fail-Closed RBAC/ABAC & Negative Security Test Suite (1566.9195ms)
  ✔ T08: Comprehensive 26-State Transition Matrix (TR-01 to TR-26) & Argon Gate Verification (2224.4462ms)
  ✔ T09: Black-Box E2E HTTP Transport & Security Pipeline Verification (468.2574ms)
  ✔ T10: Windows DPAPI Protection, STDIO Frame Limits & Live Token Revocation (2439.7217ms)
  ℹ tests 15
  ℹ suites 1
  ℹ pass 15
  ℹ fail 0
  ℹ cancelled 0
  ℹ skipped 0
  ℹ todo 0
  ℹ duration_ms 2856.2593
  ```
- **Integrity Verification:**
  - Production DB `D:\AI-COMPANY\data\aico.db` SHA-256 before & after:
    `17BD93214291E33260DF4A3D0B7DAD417BCA05C137770443D4D3FA965595E416` (100% Unchanged).
  - Backup Anchor Directory Cleanliness: `D:\AI-COMPANY\backup\audit_anchors.jsonl` does NOT exist (all tests strictly write to temporary sandbox paths).
