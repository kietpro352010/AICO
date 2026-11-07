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
- **Timestamp:** 2026-11-07 07:28:35 +07:00
- **Command:** `Push-Location D:\AI-COMPANY\company-mcp; npm.cmd test`
- **Exit Code:** `0` (Success)
- **Raw Summary:**
  ```text
  ▶ AICO Quality Baseline Test Suite
    ✔ 1. Canonical Manifest Integrity (1.532ms)
    ✔ 2. AgentIdentityService Token Lifecycle & Timing-Safe Auth (23.8561ms)
    ✔ 3. WorkspaceManager Path Traversal Defense (43.0825ms)
    ✔ 4. Registry Core Tools Verification (2.3074ms)
    ✔ 5. Migration v0.4.1 Manifest Sync Blueprint (5.3803ms)
  ✔ AICO Quality Baseline Test Suite (186.3153ms)
  ✔ T01: MigrationRunner and Schema Migrations on Sandbox DB (100.9069ms)
  ✔ T02: Core Services — Identity, Approvals and Workspace Artifact Guard (205.0048ms)
  ✔ T03: MCP Tool Contracts and Public DTO Leakage Prevention (5.685ms)
  ✔ T04-T08 Comprehensive Verification: Git, Knowledge FTS5, Task State Machine & HMAC Audit Chain (263.6826ms)
  ✔ T05: Complete 38 MCP Tools & Gateway Allowlist Verification (8.5657ms)
  ✔ T06: Backup and Safe Restore Drills on Sandbox Database (44.6036ms)
  ℹ tests 11
  ℹ suites 1
  ℹ pass 11
  ℹ fail 0
  ℹ cancelled 0
  ℹ skipped 0
  ℹ todo 0
  ℹ duration_ms 751.2868
  ```
- **Integrity Verification:**
  - Production DB `D:\AI-COMPANY\data\aico.db` SHA-256 before & after:
    `17BD93214291E33260DF4A3D0B7DAD417BCA05C137770443D4D3FA965595E416` (100% Unchanged).
