# AICO v2.2.1 — TEST EVIDENCE RECORD

**Date:** 2026-11-06  
**Auditor:** `flash-02` (Engineering & QA Lead)  
**Harness:** `node --import tsx --test`

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
