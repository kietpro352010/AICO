# AICO — SYSTEM ARCHITECTURE OVERVIEW

**Version:** 1.0.0  
**Status:** Living Architectural Specification  
**Canonical Source:** `D:\AI-COMPANY\company-manifest.json`

---

## 1. High-Level Architecture

AICO is built on a hybrid local-first, multi-agent architecture. It integrates local development agents (operating directly on Windows physical filesystems) with cloud-based executive and strategic agents via the Model Context Protocol (MCP).

```
                      ┌────────────────────────────┐
                      │    External Cloud Agents   │
                      │ (ChatGPT Web, Gemini Web)  │
                      └─────────────┬──────────────┘
                                    │ HTTPS (Bearer Token Auth)
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│                   AICO WORKSTATION (DESKTOP-TII92VD)                   │
│                                                                        │
│   ┌───────────────────────────┐    ┌───────────────────────────────┐   │
│   │   Public Gateway (3335)   │    │     Local Gateway (3334)      │   │
│   │    (Bearer Auth / Edge)   │    │   (Loopback / Fast Stdio)     │   │
│   └─────────────┬─────────────┘    └───────────────┬───────────────┘   │
│                 │                                  │                   │
│                 └─────────────────┬────────────────┘                   │
│                                   │                                    │
│                     ┌─────────────▼─────────────┐                      │
│                     │     MCP REGISTRY CORE     │                      │
│                     │    (registry-core.ts)     │                      │
│                     └─────────────┬─────────────┘                      │
│                                   │                                    │
│         ┌─────────────────────────┼─────────────────────────┐          │
│         │                         │                         │          │
│   ┌─────▼───────┐           ┌─────▼─────────┐         ┌─────▼──────┐   │
│   │   SQLite    │           │ AgentIdentity │         │  Workspace │   │
│   │   aico.db   │           │    Service    │         │  Manager   │   │
│   │ (WAL mode)  │           │(SHA-256 Auth) │         │(Traversal) │   │
│   └─────────────┘           └───────────────┘         └────────────┘   │
│                                                                        │
│   ┌────────────────────────────────────────────────────────────────┐   │
│   │                 Local Physical Agent Workspaces                │   │
│   │            Flash #1 (CTO)  •  Flash #2 (QA Lead)               │   │
│   └────────────────────────────────────────────────────────────────┘   │
└────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Core Architectural Components

### 2.1. Dual Gateway Pattern
To ensure robust security without compromising local agent throughput, AICO utilizes a dual-gateway pattern:
1. **Local Gateway (`http-registry.ts` - Port 3334):**
   - Strictly bound to loopback `127.0.0.1`.
   - Protected by `localhostHostValidation()` from `@modelcontextprotocol/express`.
   - Optimized for local development agents (Flash #1, Flash #2, Codex) without token negotiation latency.
2. **Public Gateway (`http-public.ts` - Port 3335):**
   - Bound to an isolated port for external tunneling.
   - Enforces Bearer token authentication via `AICO_MCP_PUBLIC_TOKEN` or multi-agent identity tokens.
   - Configured with custom `allowedHosts` compatible with reverse proxies (e.g., ngrok, Cloudflare Tunnels).
   - Prevents external actors from accessing unauthenticated internal MCP endpoints.

### 2.2. Registry Core (`registry-core.ts`)
Acts as the single source of truth for MCP tool definitions and database query execution. Both the STDIO transport (`index.ts`) and HTTP transports rely on `registry-core.ts`, ensuring zero divergence in tool implementations.

Currently implements 5 foundational tools:
- `company_ping`: Health and version check.
- `company_get_info`: High-level company metadata.
- `company_list_agents`: Formatted profile list of all 6 registered agents.
- `company_get_agent`: Lookup of individual agent by `agent_id`.
- `company_list_quota_pools`: List 5 provider quota pools and agent allocations.

### 2.3. Production Database (`aico.db`)
- Engine: SQLite via Node.js built-in `node:sqlite` (`DatabaseSync`).
- Mode: Write-Ahead Logging (`PRAGMA journal_mode = WAL`) and full foreign key enforcement (`PRAGMA foreign_keys = ON`).
- Current Schema: v0.3.0 (`agents`, `quota_pools`, `agent_usage_events`).

### 2.4. Agent Identity & Workspace Foundation (Task 04.4)
Located on the remediation/feature branch:
- **`AgentIdentityService`:** Cryptographic token generation (`aico_<agent_id>_<hex>`), SHA-256 storage, and constant-time authentication (`crypto.timingSafeEqual`).
- **`WorkspaceManager`:** Boundary enforcement blocking path traversal attacks (`..`), absolute drive paths, and symlink escapes.
- **Migration v0.4.0 Blueprint:** Tables for `agent_credentials`, `agent_workspaces`, and `agent_workspace_activities`.

---

## 3. Security Boundaries & Threat Model

1. **OS Boundary:** Enforced by Windows NTFS permissions. User `aico_flash2` cannot inspect or tamper with files in `C:\Users\kietp`.
2. **Network Perimeter:** Port 3334 is loopback-only. External tunneling is restricted to authenticated endpoints.
3. **Identity Boundary:** Agents are authenticated by cryptographic token hashes; self-declared `agent_id` payloads in HTTP headers are rejected.
