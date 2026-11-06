# AICO v2.2.1 — PHASE 0 BASELINE REPORT

**Date:** 2026-11-06  
**Auditor / Lead:** `flash-02` (Engineering & QA Lead) — Gemini 3.8 Flash High  
**Branch:** `feat/v2.2.1-implementation` (created from `remediate/task-04-6-baseline` at commit `9bd0f2c`)  
**Specification Reference:** `D:\AICO_V2_2_1_IMPLEMENTATION_PACK\` (15 verified files, SHA-256 matched with `PACK_MANIFEST.json`)

---

## 1. REPOSITORY & BRANCH STATUS

- **Git Status:** Working tree clean prior to Phase 0 deliverables.
- **Current Branch:** `feat/v2.2.1-implementation`
- **Baseline Commit:** `9bd0f2c` (`feat(remediation): establish canonical company manifest, synchronize documentation and configure quality baseline`)
- **Git Safety Configuration:** `safe.directory D:/AI-COMPANY` registered to prevent cross-account Windows SID ownership warnings.
- **Untracked / Preserved Files:**
  - `backup/aico-before-v03-2026-11-05T09-22-39-250Z.db` (v0.3.0 pre-migration baseline)
  - `backup/before-http-20261105-135140/` (archive)

---

## 2. RUNTIME, NETWORK & PROCESS QUARANTINE

- **Listening Ports:**
  - `3334`: Inactive (no production process listening).
  - `3335`: Inactive (public gateway disabled).
  - `4040`: Inactive (no ngrok tunnel running).
- **Active Processes:**
  - Background Codex node workers (`node.exe` under `C:\Users\kietp\AppData\Local\OpenAI\Codex\...`) are active.
  - No unauthorized `ngrok.exe` processes found.
- **Network Tunnel Quarantine:**
  - Inspecting `company-mcp/ngrok-policy.yml`: contains legacy `host: localhost` rewrite. Kept quarantined and offline. Public gateway remains strictly disabled.

---

## 3. DATABASE BASELINE & SAFETY VERIFICATION

- **Production Database Path:** `D:\AI-COMPANY\data\aico.db`
- **Production DB Hash (SHA-256):** `17BD93214291E33260DF4A3D0B7DAD417BCA05C137770443D4D3FA965595E416`
- **Last Modified Timestamp:** `2026-11-05 16:22:39`
- **Current Production Schema:**
  - Tables present: `agents`, `quota_pools`, `agent_usage_events`, `sqlite_sequence` (Schema v0.3.0 / interim v0.4.0 baseline).
  - Schema gap vs v2.2.1: Target schema (`AICO_DATABASE_SCHEMA_V0.5.0_RC2.sql`) requires 22 regular tables (`T01`–`T22`), 1 FTS5 virtual table (`V01`), and 12 triggers.
- **Consistent Backup Executed:**
  - Command: `VACUUM INTO 'D:/AI-COMPANY/backup/aico_v030_pre_v221.db'`
  - Backup SHA-256: `2F73A9602DBBC50DA68B323FA00D2D7808855DF7A21FAA3DBEE64EC3EFD1477A`
  - Integrity Check: `PRAGMA integrity_check` -> `ok`.
- **NTFS ACL Export:**
  - Exported to: `D:\AI-COMPANY\backup\acl_pre_v221.txt` (421 files processed, 0 errors).

---

## 4. BASELINE TEST EXECUTION EVIDENCE

- **Command:** `Push-Location D:\AI-COMPANY\company-mcp; npm.cmd test`
- **Package Installation:** Fresh dependencies verified (`77 packages audited, 0 vulnerabilities`).
- **Test Output:**
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
  ℹ cancelled 0
  ℹ skipped 0
  ℹ duration_ms 13313.5184
  ```
- **Exit Code:** `0` (PASS).

---

## 5. REPOSITORY CODE STRUCTURE & GAPS IDENTIFIED

1. **Legacy quarantine required:**
   - Redundant files in `company-mcp/src/`: `http-registry.v020.backup.ts`, `http.before-registry.ts`, `http.ts`, `update-agent-status.mjs`.
2. **Database migration framework:**
   - Currently, standalone scripts exist (`migrate-agent-policy.ts`, `migrate-v03.ts`, `migrate-v040.ts`, `migrate-v041-manifest-sync.ts`), but there is no unified `migration-runner.ts` tracking applied migration checksums in `schema_migrations`.
3. **Services to implement:**
   - `CompanyRegistryService` (`S01`)
   - `IdentityAccessService` (`S02`)
   - `ApprovalService` (`S03`)
   - `WorkspaceArtifactService` (`S04`)
   - `TaskStateMachineService` (`S05`)
   - `KnowledgeIndexService` (`S06`)
4. **Target Schema RC2:**
   - 22 tables (`T01`–`T22`), 1 FTS5 table (`V01`), 12 triggers must be migrated via incremental forward migrations tested in disposable test sandboxes before G4.

---

## 6. PHASE 0 CONCLUSION & NEXT ACTIONS

- **Phase 0 Status:** **COMPLETE** (Gate `G0` criteria met: clean branch, backups validated, ACL exported, ports checked, baseline tests passing, zero changes to production database `aico.db`).
- **Next Phase:** **Phase 1 — Company Governance & Canonical Manifest v1.1**.
