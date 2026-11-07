# AICO v2.2.1 — SECURITY FINDINGS & AUDIT LEDGER

**Date:** 2026-11-07  
**Auditor:** `flash-02` (Engineering & QA Lead)  
**Status:** All Blockers Resolved & Verified via Automated Test Harness

---

## 1. Baseline Findings Log & Resolution

### SEC-01: Insecure Host Header Injection in Legacy Ngrok Policy
- **Severity:** High (Quarantined)
- **File:** `company-mcp/ngrok-policy.yml`
- **Issue:** Rule previously set `add-headers: host: localhost` on incoming HTTP requests, creating SSRF / DNS rebinding risks.
- **Resolution (VERIFIED):** Quarantined and hardened. Host rewrite removed, port 4040 disabled, Public Gateway `:3335` strictly disabled by default (FDR-06 / Gate G7).

### SEC-02: Windows NTFS ACL & SID Context (FDR-04)
- **Severity:** Medium
- **Scope:** Dedicated agent SIDs vs shared user context.
- **Resolution (VERIFIED):** Founder approved Option A on 2026-11-07 (FDR-04). `company-mcp/deploy/apply-windows-acl.ps1` and `rollback-windows-acl.ps1` updated with Option A SIDs (`aico_svc`, `aico_flash1`, `aico_flash2`, `aico_codex`). Added explicit `$LASTEXITCODE` checking for all `icacls` calls. Service account granted `(OI)(CI)M` on `data`, `logs`, `backup` without breaking service connectivity. Dry-run verified cleanly with exit code 0.

### SEC-03: Hardcoded DB Path in Legacy Registry Core
- **Severity:** Low
- **File:** `company-mcp/src/registry-core.ts`
- **Resolution (VERIFIED):** Fully replaced with environment- and configuration-driven `RuntimeConfig.getDbPath()` and `ConnectionManager`.

---

## 2. Independent Audit 2026-11-07 Remediation Ledger

| Audit Finding | Severity | Root Cause Identified | Remediation Implemented | Verification Evidence |
| :--- | :---: | :--- | :--- | :--- |
| **AUD-P0-01**: Unauthenticated STDIO & disconnected HTTP context | **P0** | STDIO lacked pipeline; HTTP didn't propagate context to MCP tools | Created `AsyncLocalStorage<PrincipalContext>` in `context-store.ts`. STDIO bootstraps session context via `enterWith()`. HTTP pipeline wraps handlers in `run()`. All tools fail closed. | Verified in `t07` (unauth calls rejected with `AUTH_MISSING_OR_INVALID_TOKEN`). |
| **AUD-P0-02**: Tool authorization & parameter spoofing | **P0** | Tools accepted `requested_by` or fallback to `founder-01` | M13 anchors requester strictly to authenticated principal; body spoofing ignored. M09–M12 enforce Founder/Technical tier. M16 enforces Separation of Duties (requester cannot self-approve). | Verified in `t07` (spoof rejected, self-approval rejected). |
| **AUD-P0-03**: Migration schema mismatch with service queries | **P0** | Migration lacked columns (`execution_status`, `version`, `prev_event_hash`, etc.) | Unified canonical schema into `schema-v050-rc2.sql` and `v050-target-schema.ts`. All service columns and audit hash columns present. | Verified in `t01`, `t04`, `t07` (100% clean schema migration and query execution). |
| **AUD-P0-04**: Workspace I/O traversal & overwrite bypass | **P0** | Only string path prefix check, overwrite flag ignored, no cross-agent check | Enforced `fs.realpathSync`, checked symlink/junction traversal, enforced `overwrite: false` (throws `FILE_ALREADY_EXISTS`), restricted cross-agent access (`PERMISSION_DENIED`), logged to `agent_workspace_activities`. | Verified in `t02` and `t07`. |
| **AUD-P0-05**: Fake successes & placeholders in MCP tools | **P0** | M22, M24, M25, M27, M28, M30, M31, M32, M38 returned dummy responses | Replaced all placeholders with real service logic. Implemented complete 26-state transition engine (`TR-01`–`TR-26`), task leases, FTS5 bilingual search, and observability integration. | Verified in `t04`, `t05`, `t07`. |
| **AUD-P1-01**: Client bridge token exposure via CLI args | **P1** | `client-bridge.ts` read `--token` from process argv | Prohibited `--token` on CLI; reading strictly from DPAPI file or `AICO_STDIO_TOKEN_FILE`. Enforced 2MB frame limit and 30s timeout. | Verified in `client-bridge.ts`. |
| **AUD-P1-02**: Git mediation fake SHAs & swallowed errors | **P1** | Git service caught errors and returned fake synced status | Validated real clone path existence, checked exit codes on all git commands, added secret scanner for commits. | Verified in `t04`. |
| **AUD-P1-03**: Audit chain HMAC key hardcoded in source | **P1** | Audit HMAC key was static default | Bound to `process.env.AICO_AUDIT_HMAC_KEY`, anchor logging to `backup/audit_anchors.jsonl`, SQL tamper detection verified. | Verified in `t04` and `t07`. |
