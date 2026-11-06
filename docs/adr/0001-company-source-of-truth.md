# ADR 0001: ESTABLISHMENT OF CANONICAL COMPANY MANIFEST & DOCUMENTATION SYNCHRONIZATION

- **Status:** Accepted
- **Date:** 2026-11-06
- **Deciders:** Founder, ChatGPT (CEO), Flash #1 (CTO), Flash #2 (QA Lead)
- **Technical Story:** Task 04.5 & Task 04.6 Baseline Remediation

---

## 1. Context & Problem Statement

During the comprehensive Company-Wide Infrastructure Audit (Task 04.5), severe discrepancies and fragmentation were discovered across AICO's operational configuration:

1. **Role Inconsistencies:** The SQLite database `aico.db` listed `chatgpt-01` as *"Product and Strategy Advisor"* under the *"Product"* department, whereas approved organizational strategy designates `chatgpt-01` as the **Chief Executive Officer (CEO) and Main Orchestrator** leading executive operations.
2. **Empty Knowledge Base:** Operating rules in `AGENTS.md` repeatedly cited `docs/` and `memory/` as canonical "sources of truth", yet both directories were physically empty (0 files).
3. **Configuration Drift:** The active Antigravity client configuration specified port `3333`, while the active production server listened on port `3334`.
4. **Ad-hoc Policy Spread:** Policies were scattered between hardcoded JavaScript objects (STDIO legacy backup), SQL insert scripts (`migrate-v03.ts`), and unstructured prompt text.

Without a single authoritative source of truth, autonomous agents risked diverging in execution authority, tool capabilities, and security boundaries.

---

## 2. Decision Drivers

- **Zero Ambiguity:** Every agent and process must reference the exact same definition of roles, permissions, and quota pools.
- **Machine & Human Readability:** The source of truth must be easily parseable by automated TypeScript services (`JSON`) and clearly intelligible to human engineers and auditors (`Markdown`).
- **Auditability:** All role or policy updates must be tracked via Git version control.
- **Production Safety:** Remediation must not destabilize running services or corrupt production database tables.

---

## 3. Considered Options

1. **Option 1: Database as Sole Source of Truth.** Store all configuration solely in SQLite tables.
   - *Downside:* Inflexible for external web agents that lack direct SQL access; difficult to track changes via Git diffs; schema migrations are required for every minor textual adjustment.
2. **Option 2: Plain Markdown Documents as Source of Truth.**
   - *Downside:* Fragile to parse programmatically; high risk of regex or parsing errors in backend code.
3. **Option 3 (Selected): Canonical Machine-Readable Manifest (`company-manifest.json`) paired with Synchronized Architectural Markdown Documentation.**
   - *Benefit:* Combines the structured rigor of a validated JSON schema with human-readable markdown guides. Services can ingest `company-manifest.json` directly, while agents read synchronized markdown.

---

## 4. Decision Outcome

We decided to establish `D:\AI-COMPANY\company-manifest.json` as the **Single Canonical Source of Truth** for AICO Company.

### Key Aspects of the Decision:
1. **Canonical Manifest Created:** Defines company metadata, Founder sovereign authority, exactly six registered agents, quota pools, and permission policies.
2. **Organizational Synchronization:**
   - `chatgpt-01` is formally designated as **CEO / Main Orchestrator** (Department: Executive & Product Strategy).
   - `flash-01` is designated as **Chief Technology Officer** (Department: Engineering Leadership).
   - `flash-02` is designated as **Engineering & QA Lead** (Department: Engineering).
   - `codex-01` is designated as **Software Implementation Engineer** (Department: Engineering).
   - `argon-01` is designated as **Principal Software Architect** (Department: Architecture, Manual / Founder Approval only).
   - `argon-02` is designated as **Independent Technical Auditor** (Department: Quality & Audit, Manual / Founder Approval only).
3. **Documentation Realignment:** Created `docs/company/ORGANIZATION.md`, `docs/company/AGENT_CATALOG.md`, `docs/company/OPERATING_POLICIES.md`, `docs/architecture/README.md`, and updated `AGENTS.md` to reference `company-manifest.json`.
4. **Database Alignment Strategy:** Drafted a safe migration plan (`migrate-v041`) to synchronize `aico.db` with the canonical manifest without mutating production data during this task.
5. **Client Configuration Correction:** Updated `mcp_config.json` for Flash #2 to point to verified port `3334`.

---

## 5. Consequences

### Positive:
- Single point of definition for all company roles, models, and quotas.
- Clean separation between configured models and verified runtime models.
- Transparent, version-controlled architecture decisions.
- Gated escalation procedures for scarce resources (Argon #1 and #2).

### Negative / Trade-offs:
- Requires discipline to update `company-manifest.json` whenever organizational or technical policies change.
- SQLite database must periodically be reconciled with the manifest via safe migrations.
