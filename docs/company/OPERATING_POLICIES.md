# AICO — COMPANY OPERATING POLICIES

**Document Version:** 1.0.0  
**Effective Date:** 2026-11-06  
**Canonical Source:** `D:\AI-COMPANY\company-manifest.json`

---

## 1. Governance & Escalation Policy

### 1.1. Sovereign Authority
- The Founder has unilateral decision-making authority over corporate strategy, architecture, and resource allocation.
- The CEO (`chatgpt-01`) directs day-to-day operations and orchestrates tasks across agents.
- The CTO (`flash-01`) leads technical decisions and enforces engineering rigor.

### 1.2. Escalation Triggers
Any agent encountering the following situations must stop immediately and request approval:
1. Proposed destructive actions (database drops, branch deletion, git force pushes).
2. Proposed public network exposure (opening ports, reconfiguring tunnels).
3. Invocation of scarce tier resources (`argon-01` or `argon-02`).
4. Secret rotation, credential issuance, or permission changes.

---

## 2. Scarce Resource Management Policy (Argon Rules)

1. **Strict Manual Invocation Only:** `argon-01` and `argon-02` must never be triggered automatically by scripts, orchestrator loops, or automated CI/CD runners.
2. **Zero Automatic Retries:** If an Argon invocation fails or times out, no agent may automatically re-issue the query.
3. **No Automatic Fan-Out:** Fan-out queries across model tiers must exclude Argon by default.
4. **Founder Sign-Off:** Each invocation of Argon requires prior explicit authorization from the Founder.

---

## 3. Engineering Quality & Git Workflow Policy

### 3.1. Branch Management
- **`master`:** Stable production branch. Protected against direct commits.
- **`feat/*`:** Feature development branches for isolated feature implementations.
- **`remediate/*`:** Dedicated branches for baseline synchronization and vulnerability remediation.
- Changes must be merged via reviewed pull requests or verified commits following CTO technical approval.

### 3.2. Worktree Isolation
- Physical execution agents (`flash-01`, `flash-02`, `codex-01`) should operate within dedicated Git worktrees to prevent dirty working tree collisions and conflicting file locks.

### 3.3. Test-Driven Verification
- No feature is considered complete without automated tests.
- Tests must be executed using the official test suite (`npm test`).
- Falsifying test passes or suppressing assertions is strictly prohibited.

---

## 4. Security, Secret Management & Network Boundary Policy

### 4.1. Secret Protection
- Never commit API keys, tokens, session cookies, passwords, or private hashes to Git.
- Tokens must be stored strictly as cryptographic SHA-256 hashes (`secret_hash`) in databases.
- Token comparison must use constant-time algorithms (`crypto.timingSafeEqual`) to prevent timing side-channel attacks.

### 4.2. Network Perimeter Integrity
- The Local Gateway MCP (Port 3334) must remain bound to `127.0.0.1` (loopback only) and never exposed to the LAN or public Internet without authentication.
- Public Gateway prototypes (Port 3335) require strict Bearer token authentication and allowed host validation prior to external routing.
- Reverse proxy tunnels (e.g. ngrok) must not bypass host validation or forward unauthenticated traffic to internal ports.
