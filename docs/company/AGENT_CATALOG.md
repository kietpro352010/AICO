# AICO — PRINCIPAL AGENT CATALOG

**Document Version:** 1.0.0  
**Effective Date:** 2026-11-06  
**Canonical Source:** `D:\AI-COMPANY\company-manifest.json`

---

## 1. Overview of Registered Agents

AICO maintains exactly six authorized agent identities across three departments.

| Agent ID | Display Name | Canonical Role | Department | Provider | Configured Model | Quota Pool | Mode |
| :--- | :--- | :--- | :--- | :---: | :--- | :--- | :---: |
| `chatgpt-01` | ChatGPT | CEO / Main Orchestrator | Executive & Strategy | OpenAI | `ChatGPT Go Web` | `openai-go-shared` | Manual |
| `flash-01` | Gemini Flash #1 | Chief Technology Officer | Engineering Leadership| Google | `Gemini 3.8 Flash` | `google-pro-01` | Auto |
| `flash-02` | Gemini Flash #2 | Engineering & QA Lead | Engineering | Google | `Gemini 3.8 Flash` | `google-pro-02` | Auto |
| `codex-01` | Codex | Software Implementation Engineer | Engineering | OpenAI | `Codex model (pending UI)` | `openai-go-shared` | Manual |
| `argon-01` | Gemini Argon #1 | Principal Software Architect | Architecture | Google | `Gemini 4 Argon` | `gemini-web-01` | Manual |
| `argon-02` | Gemini Argon #2 | Independent Technical Auditor | Quality & Audit | Google | `Gemini 4 Argon` | `gemini-web-02` | Manual |

---

## 2. Detailed Agent Profiles

### 2.1. `chatgpt-01` (CEO / Main Orchestrator)
- **Official Name:** ChatGPT
- **Department:** Executive & Product Strategy
- **Platform:** ChatGPT Web (`openai-go-shared`)
- **Reasoning Tier:** `think`
- **Invocation Policy:** `mode: manual`, `auto_invoke: 0`, `requires_approval: 1`, `quota_class: normal`, `routing_priority: 1`.
- **Access Profile:** `web_agent_logical` (Logical workspace; restricted direct filesystem modification).
- **Permissions:** `company:read`, `tasks:manage`, `strategy:write`, `workspace:read`.
- **Verified Runtime State:** Standby / Web browser session.
- **Quota Constraints:** Shares subscription with `codex-01`.

### 2.2. `flash-01` (Chief Technology Officer)
- **Official Name:** Gemini Flash #1
- **Department:** Engineering Leadership
- **Platform:** Antigravity Pro Account 1 (`google-pro-01`)
- **Reasoning Tier:** `high`
- **Invocation Policy:** `mode: automatic`, `auto_invoke: 1`, `requires_approval: 0`, `quota_class: normal`, `routing_priority: 1`.
- **Access Profile:** `local_agent_physical` (Direct filesystem access on host; git operations).
- **Permissions:** `company:read`, `company:write`, `architecture:review`, `code:review`, `code:approve`, `workspace:write:self`.
- **Verified Runtime State:** Configured in `aico.db`; runs under Administrator Windows account `kietp`.

### 2.3. `flash-02` (Engineering & QA Lead)
- **Official Name:** Gemini Flash #2
- **Department:** Engineering
- **Platform:** Antigravity Pro Account 2 (`google-pro-02`)
- **Reasoning Tier:** `high`
- **Invocation Policy:** `mode: automatic`, `auto_invoke: 1`, `requires_approval: 0`, `quota_class: normal`, `routing_priority: 1`.
- **Access Profile:** `local_agent_physical` (Direct filesystem access on host; git operations, test execution).
- **Permissions:** `company:read`, `company:write`, `qa:verify`, `audit:inspect`, `test:execute`, `workspace:write:self`.
- **Verified Runtime State:** **ACTIVE RUNTIME SESSION** on Windows user `DESKTOP-TII92VD\aico_flash2`.

### 2.4. `codex-01` (Software Implementation Engineer)
- **Official Name:** Codex
- **Department:** Engineering
- **Platform:** Codex Desktop - ChatGPT Go (`openai-go-shared`)
- **Reasoning Tier:** `high`
- **Invocation Policy:** `mode: manual`, `auto_invoke: 0`, `requires_approval: 1`, `quota_class: normal`, `routing_priority: 2`.
- **Access Profile:** `local_agent_physical`.
- **Permissions:** `company:read`, `code:write`, `test:run`, `workspace:write:self`.
- **Verified Runtime State:** Process `codex.exe` (PID 21372) and sandbox service active on host.

### 2.5. `argon-01` (Principal Software Architect)
- **Official Name:** Gemini Argon #1
- **Department:** Architecture
- **Platform:** Gemini Web Account 1 (`gemini-web-01`)
- **Reasoning Tier:** `high` (Deep reasoning)
- **Invocation Policy:** `mode: manual`, `auto_invoke: 0`, `requires_approval: 1`, `quota_class: scarce`, `routing_priority: 3`.
- **Access Profile:** `web_agent_logical`.
- **Permissions:** `company:read`, `architecture:design`, `system:spec`.
- **Verified Runtime State:** Standby. Invocations strictly gated by Founder approval.

### 2.6. `argon-02` (Independent Technical Auditor)
- **Official Name:** Gemini Argon #2
- **Department:** Quality & Audit
- **Platform:** Gemini Web Account 2 (`gemini-web-02`)
- **Reasoning Tier:** `high` (Deep reasoning)
- **Invocation Policy:** `mode: manual`, `auto_invoke: 0`, `requires_approval: 1`, `quota_class: scarce`, `routing_priority: 3`.
- **Access Profile:** `web_agent_logical`.
- **Permissions:** `company:read`, `audit:report`, `independent-verification`.
- **Verified Runtime State:** Standby. Invocations strictly gated by Founder approval.

---

## 3. Quota Pool Mapping

1. **`google-pro-01`**: Assigned to `flash-01` (Antigravity Pro Account 1).
2. **`google-pro-02`**: Assigned to `flash-02` (Antigravity Pro Account 2).
3. **`gemini-web-01`**: Assigned to `argon-01` (Gemini Web Account 1, Scarce).
4. **`gemini-web-02`**: Assigned to `argon-02` (Gemini Web Account 2, Scarce).
5. **`openai-go-shared`**: Shared between `chatgpt-01` and `codex-01`.
