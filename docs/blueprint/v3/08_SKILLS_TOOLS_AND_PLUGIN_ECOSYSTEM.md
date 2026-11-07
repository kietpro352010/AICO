# AICO V3 MASTER BLUEPRINT — SKILLS, TOOLS & PLUGIN ECOSYSTEM

**Document ID:** `BP-V3-08`  
**Version:** `3.1.0-reconciled`  
**Date:** 2026-11-07  
**Author:** `flash-02` — Engineering & QA Lead  
**Design Phase:** Architecture & Contracts Design Only (No Implementation Authorized)  
**Baseline Git Reference:** Branch `feat/v2.2.1-implementation`, Commit `cd749107c4b34e26f61e14a238336e414f78779d`  
**Actual HEAD:** `21f3aad16911eb076e2245a791bde51178a0d222`  
**Target Workspace:** `D:\AI-COMPANY`

---

## 1. CAPABILITY ECOSYSTEM TAXONOMY

AICO V3 establishes clear structural boundaries between four distinct extension concepts that were previously conflated:

```mermaid
flowchart TD
    subgraph Ecosystem ["AICO Capability Ecosystem"]
        Skills["📚 Skills\n(Domain Knowledge & Rules)\n.agents/skills/"]
        Tools["🔧 Tools\n(Executable MCP Endpoints - 28 Tools)\ncompany-mcp/src/"]
        Plugins["📦 Plugins\n(Packaged Bundles)\nPlugin Marketplace"]
        Adapters["🔌 Runtime Adapters\n(Execution Environments)\nAntigravity / Codex / Workers"]
    end

    Plugins --> Skills
    Plugins --> Tools
    Adapters --> Tools
    Skills -. "Injected into Context via JIT Profiler" .-> Adapters
```

### 1.1 Structural Definitions
1. **Skill:** A structured directory containing a declarative `SKILL.md` with YAML frontmatter, engineering guidelines, and scripts.
2. **Tool:** An executable JSON-RPC function exposed over the Model Context Protocol (MCP) implementing a typed schema, ABAC authorization, and stateful side-effects (`REQ-V3-003`).
3. **Plugin:** A deployable package bundling skills, tools, rules, and configuration hooks that can be enabled or disabled as an atomic unit.
4. **Runtime Adapter:** A software bridge allowing different agent execution harnesses to communicate with the AICO MCP gateway (`IRuntimeAdapter`).

---

## 2. THE 12 CANONICAL AICO SKILLS & CAPABILITY TAXONOMY

The repository `D:\AI-COMPANY\.agents\skills\` hosts 12 production-grade skills indexed in the `skills` and `capabilities` database tables (`REQ-V3-026`):

| # | Skill Directory | Domain / Core Purpose | Primary Roles | Target Capabilities |
| :---: | :--- | :--- | :--- | :--- |
| **1** | `aico-architecture-patterns` | Hexagonal, Clean, DDD, boundary separation, seam design. | `argon-01`, `flash-01` | `arch.hexagonal`, `arch.ddd` |
| **2** | `aico-api-design-principles` | REST & JSON-RPC schema contracts, idempotency, versioning. | `flash-01`, `codex-01` | `api.mcp.design`, `api.jsonrpc` |
| **3** | `aico-nodejs-backend-patterns` | Express, TypeScript, async patterns, process management. | `codex-01`, `flash-02` | `dev.nodejs`, `dev.typescript` |
| **4** | `aico-error-handling-patterns` | Result types, error classification, graceful degradation. | `codex-01`, `flash-02` | `eng.resilience`, `eng.errors` |
| **5** | `aico-security-audit` | Vulnerability assessment, threat modeling, injection defense. | `argon-02`, `flash-01` | `sec.audit`, `sec.threat_model` |
| **6** | `aico-tdd` | Test-driven development, red-green-refactor loop. | `codex-01`, `flash-02` | `qa.tdd`, `qa.unit_tests` |
| **7** | `aico-e2e-testing-patterns` | Integration test harnesses, multi-agent end-to-end tests. | `flash-02` (QA Lead) | `qa.e2e`, `qa.blackbox` |
| **8** | `aico-code-review-excellence` | Constructive technical review, anti-self-approval standards. | `flash-01` (CTO) | `eng.review`, `gov.sod` |
| **9** | `aico-git-workflow` | Branching strategy, atomic commits, worktree isolation. | All Agents | `git.workflow`, `git.mediation` |
| **10**| `aico-secrets-management` | Zero-hardcoded credentials, safe environment injection. | `flash-01`, `argon-02` | `sec.secrets`, `sec.dpapi` |
| **11**| `aico-token-optimization` | Context compression, prompt diet, observation masking. | All Agents | `perf.token_diet`, `perf.caching` |
| **12**| `aico-diagnosing-bugs` | Root-cause analysis, reproduction scripts, evidence-first. | `flash-02`, `codex-01` | `qa.diagnosis`, `qa.root_cause` |

---

## 3. DYNAMIC CAPABILITY DISCOVERY & TOKEN DIET (`REQ-V3-026`)

### 3.1 Prompt Overhead Problem
Loading all 12 skills statically into agent system prompts consumes over 45,000 prompt tokens per turn.

### 3.2 Just-In-Time (JIT) Skill Activation Algorithm
1. When a task is claimed (`company_claim_task`), the orchestrator inspects `task.task_type`, `task.title`, and `task.description`.
2. The capability profiler computes an overlap score against the `capabilities` taxonomy.
3. Exactly **1 to 2** skills are dynamically loaded into the prompt context.
4. **Token Diet Result:** Prompt overhead drops from >45,000 tokens to under 3,500 tokens per turn (>92% reduction).

---

## 4. SANDBOXING, TRUST LEVELS & EXECUTION SAFETY

```mermaid
flowchart TD
    subgraph Level1 ["Level 1: Core Builtin (Trusted)"]
        L1["company-mcp Server Tools\n(Full SQLite DB Access, Audit Logging)"]
    end
    subgraph Level2 ["Level 2: Audited Skills (Read-Only)"]
        L2[".agents/skills/ Instructions\n(Markdown Guidelines, No Direct Shell Access)"]
    end
    subgraph Level3 ["Level 3: Restricted Plugins (Sandboxed)"]
        L3["Third-Party Extensions\n(Isolated Process, Strict Path Whitelist, No Network)"]
    end

    Level1 --> Level2 --> Level3
```

- **Path Whitelisting (`REQ-V3-001`):** All file reads and writes are restricted to `D:\AI-COMPANY`. Traversal attempts trigger `E_SECURITY_PATH_TRAVERSAL`.
- **Network Isolation (`REQ-V3-004`):** Local loopback binding only. No unauthorized outbound HTTP requests.
- **Cryptographic Hash Sealing:** On registration, the SHA-256 hash of `SKILL.md` is recorded in `skills.instructions_md_hash`. Modified skills must pass QA re-audit before activation.
