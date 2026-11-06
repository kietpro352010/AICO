# 01 — COMPANY INVARIANTS

1. **Canonical Manifest Authority:**
   `company-manifest.json` is the sole authoritative definition of company identity, roles, quota pools, and permission policies.
2. **Founder Final Authority:**
   The Founder (`founder-01` / `kietp`) has sole authority over company direction, production database migrations, destructive file operations, and external network exposures.
3. **Agent Role Preservation:**
   No agent may modify its own or other agents' identities, permissions, or assignments without explicit Founder approval.
4. **Argon Invariants:**
   - `argon-01` (Principal Software Architect) and `argon-02` (Independent Technical Auditor) are scarce advisory agents.
   - They MUST only be invoked manually with explicit Founder approval for each invocation.
   - Automatic invocation, automatic retries, and inclusion in automated agent fan-out loops are strictly prohibited.
