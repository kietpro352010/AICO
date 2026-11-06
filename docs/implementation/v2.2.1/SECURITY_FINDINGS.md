# AICO v2.2.1 — SECURITY FINDINGS & AUDIT LEDGER

**Date:** 2026-11-06  
**Auditor:** `flash-02` (Engineering & QA Lead)  
**Status:** Monitored

---

## Findings Log

### SEC-01: Insecure Host Header Injection in Legacy Ngrok Policy
- **Severity:** High (Quarantined)
- **File:** `company-mcp/ngrok-policy.yml:6`
- **Issue:** Rule sets `add-headers: host: localhost` on incoming HTTP requests. If exposed via tunnel, this bypasses local host checks and could facilitate SSRF / DNS rebinding.
- **Status:** Quarantined. Ngrok tunnel is completely inactive (`Get-NetTCPConnection` confirmed port 4040 closed).
- **Remediation Plan:** Disable / comment out rewrite; maintain Public Gateway strictly disabled.

### SEC-02: Shared Windows SID Context
- **Severity:** Medium (Architectural Limitation)
- **Scope:** Local agents running under user account `kietp`.
- **Finding:** In accordance with FDR-04 Option B, multiple local agents currently share user SID context. We do NOT make false claims of OS-level process isolation. Isolation is strictly enforced at logical, workspace path, and token/credential layer until Founder approves FDR-04 Option A.
- **Status:** Documented.

### SEC-03: Hardcoded DB Path in Legacy Registry Core
- **Severity:** Low
- **File:** `company-mcp/src/registry-core.ts:5`
- **Issue:** Hardcoded `const DB_PATH = "D:/AI-COMPANY/data/aico.db"`.
- **Remediation Plan:** Replace with environment/configuration-driven `runtime-config.ts` in Phase 1 / Phase 4A.
