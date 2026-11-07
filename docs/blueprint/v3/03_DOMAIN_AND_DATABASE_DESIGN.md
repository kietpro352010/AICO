# AICO V3 MASTER BLUEPRINT — DOMAIN MODEL & DATABASE ARCHITECTURE

**Document ID:** `BP-V3-03`  
**Version:** `3.1.0-reconciled`  
**Date:** 2026-11-07  
**Author:** `flash-02` — Engineering & QA Lead  
**Design Phase:** Architecture & Contracts Design Only (No Implementation Authorized)  
**Baseline Git Reference:** Branch `feat/v2.2.1-implementation`, Commit `cd749107c4b34e26f61e14a238336e414f78779d`  
**Actual HEAD:** `21f3aad16911eb076e2245a791bde51178a0d222`  
**Target Workspace:** `D:\AI-COMPANY`

---

## 1. DOMAIN MODEL OVERVIEW & CANONICAL INVENTORY

The AICO V3 Domain Model encapsulates the complete lifecycle of an autonomous AI software company (`REQ-V3-006`). It models corporate organization, agent identities, collaborative group rooms, multi-tier persistent memory, hierarchical task orchestration, capability discovery, token budget telemetry, cryptographic governance, and immutable audit logging.

### 1.1 Canonical Schema Counts & Inventory
To ensure exact agreement between documentation, ER diagrams, and target DDL scripts, the canonical schema metrics are established as:

- **Core Domain Entities:** Exactly **24** Entities.
- **Physical SQLite Base Tables:** Exactly **27** Tables.
- **Virtual Tables:** Exactly **1** Virtual Table (`memory_fts` via SQLite FTS5).
- **Database Synchronization Triggers:** Exactly **3** Triggers (`trg_memory_entries_ai`, `trg_memory_entries_ad`, `trg_memory_entries_au`).
- **Backward-Compatible Legacy Views:** Exactly **4** Views (`v_tasks_legacy`, `v_agents_legacy`, `v_quota_legacy`, `v_approvals_legacy`).
- **Performance & Integrity Indexes:** Exactly **16** Indexes.

### 1.2 Entity-Relationship Diagram

```mermaid
erDiagram
    DEPARTMENT ||--o{ AGENT : "employs"
    DEPARTMENT ||--o{ PROJECT : "owns"
    PROJECT ||--o{ TASK : "contains"
    PROJECT ||--o{ CHAT_ROOM : "hosts"
    PROJECT ||--o{ KNOWLEDGE_DOCUMENT : "owns"

    AGENT ||--o{ ROOM_MEMBERSHIP : "participates"
    AGENT ||--o{ MESSAGE : "authors"
    AGENT ||--o{ TASK : "assigned_or_owns"
    AGENT ||--o{ TASK_EXECUTION : "executes"
    AGENT ||--o{ TASK_LEASE : "holds"
    AGENT ||--o{ MEMORY_ENTRY : "owns_private"
    AGENT ||--o{ AGENT_SESSION : "runs"
    AGENT ||--o{ TOKEN_USAGE : "consumes"
    AGENT ||--o{ APPROVAL : "requests"
    AGENT ||--o{ CAPABILITY_MAPPING : "possesses"
    AGENT ||--o{ NOTIFICATIONS_INBOX : "receives"

    PRINCIPAL ||--o{ APPROVAL : "authorizes_human"
    PRINCIPAL ||--o| AGENT : "binds_agent"

    CHAT_ROOM ||--o{ ROOM_MEMBERSHIP : "contains"
    CHAT_ROOM ||--o{ MESSAGE : "contains"
    CHAT_ROOM ||--o{ THREAD : "contains"
    MESSAGE ||--o{ MESSAGE : "replies_to"
    MESSAGE ||--o{ ARTIFACT : "attaches"
    MESSAGE ||--o{ CONTEXT_SNAPSHOT : "captures"

    TASK ||--o{ TASK_DEPENDENCY : "depends_on"
    TASK ||--o{ TASK_EXECUTION : "tracks"
    TASK ||--o{ TASK_LEASE : "locks"
    TASK ||--o{ ARTIFACT : "produces"
    TASK ||--o{ APPROVAL : "gates"
    TASK ||--o{ TOKEN_USAGE : "costs"
    TASK ||--o{ CHAT_ROOM : "spawns_workspace"

    SKILL ||--o{ CAPABILITY_MAPPING : "provides"
    PLUGIN ||--o{ SKILL : "bundles"

    AGENT_SESSION ||--o{ RUNTIME_OBSERVATION : "records"
    AGENT_SESSION ||--o{ TOKEN_USAGE : "measures"

    APPROVAL ||--o{ AUDIT_EVENT : "triggers"
    TASK ||--o{ AUDIT_EVENT : "logs"
    MESSAGE ||--o{ AUDIT_EVENT : "logs"
    TASK ||--o{ EVENT_OUTBOX : "enqueues"
```

---

## 2. DETAILED SPECIFICATION OF THE 24 CORE DOMAIN ENTITIES

### 2.1 Entity Groupings by Bounded Context
1. **Organization & Identity Context:** `DEPARTMENT`, `AGENT`, `PRINCIPAL`, `CAPABILITY`, `AGENT_CAPABILITY`
2. **Project & Collaboration Context:** `PROJECT`, `CHAT_ROOM`, `ROOM_MEMBERSHIP`, `MESSAGE`, `THREAD`, `NOTIFICATIONS_INBOX`
3. **Task & Workflow Context:** `TASK`, `TASK_DEPENDENCY`, `TASK_EXECUTION`, `TASK_LEASE`
4. **Context, Memory & Knowledge Context:** `CONTEXT_SNAPSHOT`, `MEMORY_ENTRY`, `KNOWLEDGE_DOCUMENT`, `ARTIFACT`
5. **Skills & Ecosystem Context:** `SKILL`, `PLUGIN`
6. **Telemetry & Runtime Context:** `AGENT_SESSION`, `RUNTIME_OBSERVATION`, `TOKEN_USAGE`
7. **Governance, Events & Audit Context:** `APPROVAL`, `AUDIT_EVENT`, `EVENT_OUTBOX`

---

### 2.2 Domain Entities Specification

#### 1. Entity: `DEPARTMENT`
- **Purpose:** Represents functional corporate units (Executive, Engineering, Quality Assurance, Architecture, Research).
- **Attributes:**
  - `department_id` (TEXT, PK, UUIDv4)
  - `department_code` (TEXT, UNIQUE, NOT NULL): e.g., `EXEC`, `ENG`, `QA`, `ARCH`
  - `name` (TEXT, NOT NULL): e.g., "Engineering & Implementation"
  - `lead_agent_id` (TEXT, NULL, FK -> `agents.agent_id`)
  - `description` (TEXT, NULL)
  - `created_at` (INTEGER, NOT NULL, Unix Epoch ms)
  - `updated_at` (INTEGER, NOT NULL, Unix Epoch ms)
- **Lifecycle:** Persistent static data configured via `company-manifest.json`.

#### 2. Entity: `AGENT`
- **Purpose:** Represents an artificial intelligence persona within AICO. Strictly AI agents; the Founder is modeled separately as a human security principal (`REQ-V3-029`).
- **Attributes:**
  - `agent_id` (TEXT, PK): Canonical slug: `chatgpt-01`, `flash-01`, `flash-02`, `codex-01`, `argon-01`, `argon-02`.
  - `display_name` (TEXT, NOT NULL)
  - `role_title` (TEXT, NOT NULL): e.g., "Chief Technology Officer"
  - `department_id` (TEXT, NOT NULL, FK -> `departments.department_id`)
  - `system_prompt_ref` (TEXT, NOT NULL): Path to markdown system prompt.
  - `default_model` (TEXT, NOT NULL): Primary LLM engine.
  - `quota_pool_id` (TEXT, NOT NULL): Quota allocation pool identifier.
  - `is_autonomous` (INTEGER, NOT NULL, 0 or 1): 0 for Argon (manual only); 1 for primary workers.
  - `requires_approval` (INTEGER, NOT NULL, 0 or 1): 1 for specialist actions.
  - `status` (TEXT, NOT NULL): `ACTIVE`, `BUSY`, `DRAINING`, `DISABLED`
  - `created_at` (INTEGER, NOT NULL, Unix Epoch ms)
  - `updated_at` (INTEGER, NOT NULL, Unix Epoch ms)
- **Constraints:** Exactly 6 registered AI agents.

#### 3. Entity: `PRINCIPAL` (Security Principal)
- **Purpose:** Authentication credential and authorization identity binding. Discriminates between human principals (Founder) and AI agent principals (`REQ-V3-029`).
- **Attributes:**
  - `principal_id` (TEXT, PK, UUIDv4)
  - `principal_type` (TEXT, NOT NULL CHECK(`principal_type` IN ('HUMAN', 'AGENT')))
  - `agent_id` (TEXT, UNIQUE, NULL, FK -> `agents.agent_id`): Set for agent principals; NULL for human principals.
  - `human_identifier` (TEXT, UNIQUE, NULL): e.g. `founder-human`. Set for human principals.
  - `auth_credential_hash` (TEXT, NOT NULL): HMAC-SHA256, Argon2id, or Ed25519 public key.
  - `role` (TEXT, NOT NULL): `FOUNDER`, `EXECUTIVE`, `LEAD`, `ENGINEER`, `AUDITOR`, `SYSTEM`
  - `allowed_scopes` (TEXT, NOT NULL): JSON Array of MCP scopes.
  - `is_revoked` (INTEGER, NOT NULL, DEFAULT 0)
  - `created_at` (INTEGER, NOT NULL, Unix Epoch ms)

#### 4. Entity: `PROJECT`
- **Purpose:** High-level project workspace container grouping tasks, chat rooms, artifacts, and knowledge.
- **Attributes:**
  - `project_id` (TEXT, PK, UUIDv4)
  - `slug` (TEXT, UNIQUE, NOT NULL): e.g., `aico-v3-core`, `company-mcp`
  - `name` (TEXT, NOT NULL)
  - `department_id` (TEXT, NOT NULL, FK -> `departments.department_id`)
  - `lead_agent_id` (TEXT, NOT NULL, FK -> `agents.agent_id`)
  - `status` (TEXT, NOT NULL): `PLANNING`, `ACTIVE`, `MAINTENANCE`, `ARCHIVED`, `SUSPENDED`
  - `root_path` (TEXT, NOT NULL): Canonical absolute Windows path.
  - `created_at` (INTEGER, NOT NULL, Unix Epoch ms)
  - `updated_at` (INTEGER, NOT NULL, Unix Epoch ms)

#### 5. Entity: `TASK`
- **Purpose:** Fundamental unit of work with DAG parent-child relationships, states, and verification gates.
- **Attributes:**
  - `task_id` (TEXT, PK, UUIDv4)
  - `parent_task_id` (TEXT, NULL, FK -> `tasks.task_id`)
  - `project_id` (TEXT, NOT NULL, FK -> `projects.project_id`)
  - `title` (TEXT, NOT NULL)
  - `description` (TEXT, NOT NULL)
  - `task_type` (TEXT, NOT NULL): `ARCHITECTURE`, `CODE_MODIFICATION`, `TEST_RUN`, `AUDIT`, `MAINTENANCE`
  - `priority` (TEXT, NOT NULL): `CRITICAL`, `HIGH`, `MEDIUM`, `LOW`
  - `status` (TEXT, NOT NULL): State machine status (23 states; see BP-V3-07)
  - `assigned_agent_id` (TEXT, NULL, FK -> `agents.agent_id`)
  - `creator_agent_id` (TEXT, NOT NULL, FK -> `agents.agent_id`)
  - `reviewer_agent_id` (TEXT, NULL, FK -> `agents.agent_id`)
  - `qa_agent_id` (TEXT, NULL, FK -> `agents.agent_id`)
  - `room_id` (TEXT, NULL, FK -> `chat_rooms.room_id`)
  - `token_budget` (INTEGER, NOT NULL, DEFAULT 100000)
  - `requires_founder_gate` (INTEGER, NOT NULL, DEFAULT 0)
  - `version` (INTEGER, NOT NULL, DEFAULT 1): Optimistic concurrency version lock.
  - `created_at` (INTEGER, NOT NULL, Unix Epoch ms)
  - `updated_at` (INTEGER, NOT NULL, Unix Epoch ms)
  - `completed_at` (INTEGER, NULL, Unix Epoch ms)

#### 6. Entity: `TASK_DEPENDENCY`
- **Purpose:** Models Directed Acyclic Graph (DAG) dependencies between tasks (`REQ-V3-022`).
- **Attributes:**
  - `dependency_id` (TEXT, PK, UUIDv4)
  - `task_id` (TEXT, NOT NULL, FK -> `tasks.task_id` ON DELETE CASCADE)
  - `depends_on_task_id` (TEXT, NOT NULL, FK -> `tasks.task_id` ON DELETE CASCADE)
  - `dependency_type` (TEXT, NOT NULL DEFAULT 'FINISH_TO_START')
  - `is_blocking` (INTEGER, NOT NULL DEFAULT 1)
  - `created_at` (INTEGER, NOT NULL, Unix Epoch ms)
- **Constraints:** `UNIQUE(task_id, depends_on_task_id)`, `CHECK(task_id != depends_on_task_id)`

#### 7. Entity: `TASK_EXECUTION`
- **Purpose:** Run history of an agent working on a specific task lease.
- **Attributes:**
  - `execution_id` (TEXT, PK, UUIDv4)
  - `task_id` (TEXT, NOT NULL, FK -> `tasks.task_id`)
  - `agent_id` (TEXT, NOT NULL, FK -> `agents.agent_id`)
  - `session_id` (TEXT, NOT NULL, FK -> `agent_sessions.session_id`)
  - `status` (TEXT, NOT NULL): `RUNNING`, `SUCCEEDED`, `FAILED`, `ABORTED`
  - `git_base_commit` (TEXT, NULL)
  - `git_head_commit` (TEXT, NULL)
  - `exit_code` (INTEGER, NULL)
  - `error_message` (TEXT, NULL)
  - `started_at` (INTEGER, NOT NULL, Unix Epoch ms)
  - `ended_at` (INTEGER, NULL, Unix Epoch ms)

#### 8. Entity: `TASK_LEASE`
- **Purpose:** Exclusive distributed mutex preventing duplicate concurrent execution (`REQ-V3-023`).
- **Attributes:**
  - `lease_id` (TEXT, PK, UUIDv4)
  - `task_id` (TEXT, UNIQUE, NOT NULL, FK -> `tasks.task_id` ON DELETE CASCADE)
  - `agent_id` (TEXT, NOT NULL, FK -> `agents.agent_id`)
  - `lease_nonce` (TEXT, NOT NULL)
  - `heartbeat_at` (INTEGER, NOT NULL, Unix Epoch ms)
  - `expires_at` (INTEGER, NOT NULL, Unix Epoch ms)
  - `acquired_at` (INTEGER, NOT NULL, Unix Epoch ms)

#### 9. Entity: `CHAT_ROOM`
- **Purpose:** Persistent collaboration workspace across 6 canonical room types (`REQ-V3-011`).
- **Attributes:**
  - `room_id` (TEXT, PK, UUIDv4)
  - `slug` (TEXT, UNIQUE, NOT NULL)
  - `title` (TEXT, NOT NULL)
  - `room_type` (TEXT, NOT NULL CHECK(`room_type` IN ('EXECUTIVE_BOARDROOM', 'ANNOUNCEMENTS', 'DEPARTMENT_OFFICE', 'PROJECT_ROOM', 'TASK_ROOM', 'DIRECT_MESSAGE')))
  - `project_id` (TEXT, NULL, FK -> `projects.project_id`)
  - `task_id` (TEXT, NULL, FK -> `tasks.task_id`)
  - `is_archived` (INTEGER, NOT NULL DEFAULT 0)
  - `created_by_agent_id` (TEXT, NOT NULL, FK -> `agents.agent_id`)
  - `created_at` (INTEGER, NOT NULL, Unix Epoch ms)
  - `updated_at` (INTEGER, NOT NULL, Unix Epoch ms)

#### 10. Entity: `ROOM_MEMBERSHIP`
- **Purpose:** Tracks agent participation and unread cursors in chat rooms.
- **Attributes:**
  - `membership_id` (TEXT, PK, UUIDv4)
  - `room_id` (TEXT, NOT NULL, FK -> `chat_rooms.room_id` ON DELETE CASCADE)
  - `agent_id` (TEXT, NOT NULL, FK -> `agents.agent_id`)
  - `member_role` (TEXT, NOT NULL DEFAULT 'MEMBER')
  - `last_read_message_id` (TEXT, NULL)
  - `last_read_at` (INTEGER, NOT NULL, Unix Epoch ms)
  - `joined_at` (INTEGER, NOT NULL, Unix Epoch ms)
- **Constraints:** `UNIQUE(room_id, agent_id)`

#### 11. Entity: `MESSAGE`
- **Purpose:** Structured communication artifact within a chat room (`REQ-V3-012`).
- **Attributes:**
  - `message_id` (TEXT, PK, UUIDv4)
  - `room_id` (TEXT, NOT NULL, FK -> `chat_rooms.room_id` ON DELETE CASCADE)
  - `thread_id` (TEXT, NULL, FK -> `threads.thread_id`)
  - `sender_agent_id` (TEXT, NOT NULL, FK -> `agents.agent_id`)
  - `reply_to_message_id` (TEXT, NULL, FK -> `messages.message_id`)
  - `message_type` (TEXT, NOT NULL DEFAULT 'TEXT' CHECK(`message_type` IN ('TEXT', 'DIRECTIVE', 'PROPOSAL', 'REVIEW_FEEDBACK', 'GATE_STATUS', 'SYSTEM_NOTICE')))
  - `content` (TEXT, NOT NULL)
  - `mentions` (TEXT, NULL): JSON Array of agent_ids.
  - `metadata` (TEXT, NULL): JSON Object.
  - `is_edited` (INTEGER, NOT NULL DEFAULT 0)
  - `created_at` (INTEGER, NOT NULL, Unix Epoch ms)
  - `updated_at` (INTEGER, NOT NULL, Unix Epoch ms)

#### 12. Entity: `THREAD`
- **Purpose:** Focuses discussion around a specific problem with lifecycle tracking (`REQ-V3-013`).
- **Attributes:**
  - `thread_id` (TEXT, PK, UUIDv4)
  - `room_id` (TEXT, NOT NULL, FK -> `chat_rooms.room_id` ON DELETE CASCADE)
  - `root_message_id` (TEXT, UNIQUE, NOT NULL, FK -> `messages.message_id`)
  - `title` (TEXT, NOT NULL)
  - `status` (TEXT, NOT NULL DEFAULT 'OPEN' CHECK(`status` IN ('OPEN', 'RESOLVED', 'CLOSED')))
  - `resolved_by_agent_id` (TEXT, NULL, FK -> `agents.agent_id`)
  - `resolved_at` (INTEGER, NULL, Unix Epoch ms)
  - `created_at` (INTEGER, NOT NULL, Unix Epoch ms)

#### 13. Entity: `NOTIFICATIONS_INBOX`
- **Purpose:** Stores pending agent mentions, task assignments, and review requests (`REQ-V3-014`).
- **Attributes:**
  - `notification_id` (TEXT, PK, UUIDv4)
  - `target_agent_id` (TEXT, NOT NULL, FK -> `agents.agent_id`)
  - `source_type` (TEXT, NOT NULL CHECK(`source_type` IN ('MENTION', 'ASSIGNMENT', 'REVIEW_REQUEST', 'QA_REQUEST', 'APPROVAL_ALERT', 'SYSTEM')))
  - `source_id` (TEXT, NOT NULL)
  - `title` (TEXT, NOT NULL)
  - `content` (TEXT, NOT NULL)
  - `is_read` (INTEGER, NOT NULL DEFAULT 0)
  - `created_at` (INTEGER, NOT NULL, Unix Epoch ms)
  - `read_at` (INTEGER, NULL, Unix Epoch ms)

#### 14. Entity: `CONTEXT_SNAPSHOT`
- **Purpose:** Compact, structured point-in-time state of agent working memory (<1,500 tokens, `REQ-V3-018`).
- **Attributes:**
  - `snapshot_id` (TEXT, PK, UUIDv4)
  - `task_id` (TEXT, NOT NULL, FK -> `tasks.task_id` ON DELETE CASCADE)
  - `agent_id` (TEXT, NOT NULL, FK -> `agents.agent_id`)
  - `summary` (TEXT, NOT NULL)
  - `active_hypotheses` (TEXT, NULL): JSON Array.
  - `verified_facts` (TEXT, NOT NULL): JSON Array.
  - `pending_steps` (TEXT, NOT NULL): JSON Array.
  - `total_tokens` (INTEGER, NOT NULL)
  - `created_at` (INTEGER, NOT NULL, Unix Epoch ms)

#### 15. Entity: `MEMORY_ENTRY`
- **Purpose:** Long-term episodic and declarative memory entries with 5-tier scoping (`REQ-V3-016`).
- **Attributes:**
  - `memory_id` (TEXT, PK, UUIDv4)
  - `scope` (TEXT, NOT NULL CHECK(`scope` IN ('COMPANY', 'PROJECT', 'TASK', 'ROOM', 'AGENT_PRIVATE')))
  - `scope_id` (TEXT, NOT NULL)
  - `category` (TEXT, NOT NULL CHECK(`category` IN ('ARCHITECTURAL_DECISION', 'INCIDENT_LEARNING', 'PERFORMANCE_PATTERN', 'FACT')))
  - `key` (TEXT, NOT NULL)
  - `content` (TEXT, NOT NULL)
  - `provenance_agent_id` (TEXT, NOT NULL, FK -> `agents.agent_id`)
  - `provenance_ref` (TEXT, NULL)
  - `confidence_score` (REAL, NOT NULL DEFAULT 1.0)
  - `is_tombstoned` (INTEGER, NOT NULL DEFAULT 0)
  - `tombstone_reason` (TEXT, NULL)
  - `created_at` (INTEGER, NOT NULL, Unix Epoch ms)
  - `updated_at` (INTEGER, NOT NULL, Unix Epoch ms)

#### 16. Entity: `KNOWLEDGE_DOCUMENT`
- **Purpose:** Curated company documentation, standards, and Architecture Decision Records (ADRs).
- **Attributes:**
  - `doc_id` (TEXT, PK, UUIDv4)
  - `project_id` (TEXT, NULL, FK -> `projects.project_id`)
  - `file_path` (TEXT, UNIQUE, NOT NULL)
  - `title` (TEXT, NOT NULL)
  - `content_sha256` (TEXT, NOT NULL)
  - `classification` (TEXT, NOT NULL)
  - `author_agent_id` (TEXT, NOT NULL, FK -> `agents.agent_id`)
  - `last_indexed_at` (INTEGER, NOT NULL, Unix Epoch ms)
  - `created_at` (INTEGER, NOT NULL, Unix Epoch ms)

#### 17. Entity: `ARTIFACT`
- **Purpose:** Structured deliverable produced by an agent during task execution.
- **Attributes:**
  - `artifact_id` (TEXT, PK, UUIDv4)
  - `task_id` (TEXT, NOT NULL, FK -> `tasks.task_id` ON DELETE CASCADE)
  - `creator_agent_id` (TEXT, NOT NULL, FK -> `agents.agent_id`)
  - `name` (TEXT, NOT NULL)
  - `file_path` (TEXT, NOT NULL)
  - `file_sha256` (TEXT, NOT NULL)
  - `mime_type` (TEXT, NOT NULL)
  - `size_bytes` (INTEGER, NOT NULL)
  - `is_verified` (INTEGER, NOT NULL DEFAULT 0)
  - `created_at` (INTEGER, NOT NULL, Unix Epoch ms)

#### 18. Entity: `SKILL`
- **Purpose:** Specialized domain knowledge folder in `.agents/skills/` (`REQ-V3-026`).
- **Attributes:**
  - `skill_id` (TEXT, PK)
  - `name` (TEXT, NOT NULL)
  - `description` (TEXT, NOT NULL)
  - `skill_path` (TEXT, NOT NULL)
  - `instructions_md_hash` (TEXT, NOT NULL)
  - `is_active` (INTEGER, NOT NULL DEFAULT 1)
  - `plugin_id` (TEXT, NULL, FK -> `plugins.plugin_id`)
  - `created_at` (INTEGER, NOT NULL, Unix Epoch ms)
  - `updated_at` (INTEGER, NOT NULL, Unix Epoch ms)

#### 19. Entity: `CAPABILITY` & `AGENT_CAPABILITY`
- **Purpose:** Capability taxonomy mapped to agents and skills.
- **Attributes (`capabilities`):**
  - `capability_id` (TEXT, PK)
  - `category` (TEXT, NOT NULL)
  - `description` (TEXT, NOT NULL)
- **Attributes (`agent_capabilities`):**
  - `agent_id` (TEXT, NOT NULL, FK -> `agents.agent_id`)
  - `capability_id` (TEXT, NOT NULL, FK -> `capabilities.capability_id`)
  - `proficiency_level` (TEXT, NOT NULL DEFAULT 'COMPETENT')
  - `PRIMARY KEY (agent_id, capability_id)`

#### 20. Entity: `PLUGIN`
- **Purpose:** Packaged extensions providing tools, skills, and agents.
- **Attributes:**
  - `plugin_id` (TEXT, PK)
  - `version` (TEXT, NOT NULL)
  - `install_path` (TEXT, NOT NULL)
  - `status` (TEXT, NOT NULL DEFAULT 'ENABLED')
  - `created_at` (INTEGER, NOT NULL, Unix Epoch ms)

#### 21. Entity: `AGENT_SESSION`
- **Purpose:** Continuous operational execution window of an agent connection.
- **Attributes:**
  - `session_id` (TEXT, PK, UUIDv4)
  - `agent_id` (TEXT, NOT NULL, FK -> `agents.agent_id`)
  - `runtime_adapter` (TEXT, NOT NULL)
  - `ip_address` (TEXT, NOT NULL)
  - `started_at` (INTEGER, NOT NULL, Unix Epoch ms)
  - `ended_at` (INTEGER, NULL, Unix Epoch ms)
  - `is_active` (INTEGER, NOT NULL DEFAULT 1)

#### 22. Entity: `RUNTIME_OBSERVATION`
- **Purpose:** Diagnostic events, errors, or telemetry emitted during runtime.
- **Attributes:**
  - `observation_id` (TEXT, PK, UUIDv4)
  - `session_id` (TEXT, NOT NULL, FK -> `agent_sessions.session_id`)
  - `task_id` (TEXT, NULL, FK -> `tasks.task_id`)
  - `severity` (TEXT, NOT NULL CHECK(`severity` IN ('DEBUG', 'INFO', 'WARN', 'ERROR', 'FATAL')))
  - `subsystem` (TEXT, NOT NULL)
  - `message` (TEXT, NOT NULL)
  - `details_json` (TEXT, NULL)
  - `created_at` (INTEGER, NOT NULL, Unix Epoch ms)

#### 23. Entity: `TOKEN_USAGE`
- **Purpose:** Granular token expenditure tracking per task, session, agent, and model (`REQ-V3-028`).
- **Attributes:**
  - `usage_id` (TEXT, PK, UUIDv4)
  - `session_id` (TEXT, NOT NULL, FK -> `agent_sessions.session_id`)
  - `task_id` (TEXT, NULL, FK -> `tasks.task_id`)
  - `agent_id` (TEXT, NOT NULL, FK -> `agents.agent_id`)
  - `quota_pool_id` (TEXT, NOT NULL)
  - `model_name` (TEXT, NOT NULL)
  - `prompt_tokens` (INTEGER, NOT NULL)
  - `completion_tokens` (INTEGER, NOT NULL)
  - `total_tokens` (INTEGER, NOT NULL)
  - `estimated_cost_usd` (REAL, NOT NULL DEFAULT 0.0)
  - `created_at` (INTEGER, NOT NULL, Unix Epoch ms)

#### 24. Entity: `APPROVAL` (Verifiable Human Authorization)
- **Purpose:** Cryptographic, immutable authorization token gating restricted actions (`REQ-V3-030`).
- **Attributes:**
  - `approval_id` (TEXT, PK, UUIDv4)
  - `approval_type` (TEXT, NOT NULL CHECK(`approval_type` IN ('ARGON_INVOCATION', 'PRODUCTION_DEPLOY', 'SCHEMA_MIGRATION', 'ACL_APPLY')))
  - `target_resource` (TEXT, NOT NULL)
  - `requestor_agent_id` (TEXT, NOT NULL, FK -> `agents.agent_id`)
  - `payload_sha256` (TEXT, NOT NULL)
  - `status` (TEXT, NOT NULL DEFAULT 'PENDING' CHECK(`status` IN ('PENDING', 'APPROVED', 'REJECTED', 'EXPIRED', 'CONSUMED')))
  - `founder_principal_id` (TEXT, NULL, FK -> `principals.principal_id`)
  - `human_signature` (TEXT, NULL): Ed25519 signature by Founder over canonical payload.
  - `decision_reason` (TEXT, NULL)
  - `expires_at` (INTEGER, NOT NULL, Unix Epoch ms)
  - `consumed_at` (INTEGER, NULL, Unix Epoch ms)
  - `consumed_by_agent_id` (TEXT, NULL, FK -> `agents.agent_id`)
  - `created_at` (INTEGER, NOT NULL, Unix Epoch ms)
  - `updated_at` (INTEGER, NOT NULL, Unix Epoch ms)

#### 25. Entity: `AUDIT_EVENT`
- **Purpose:** Tamper-evident, forward-hash-chained log of every security-sensitive action (`REQ-V3-032`).
- **Attributes:**
  - `event_id` (TEXT, PK, UUIDv4)
  - `sequence_number` (INTEGER, UNIQUE, NOT NULL)
  - `actor_agent_id` (TEXT, NOT NULL)
  - `action` (TEXT, NOT NULL)
  - `target_type` (TEXT, NOT NULL)
  - `target_id` (TEXT, NOT NULL)
  - `payload_hash` (TEXT, NOT NULL)
  - `previous_event_hash` (TEXT, NOT NULL)
  - `current_event_hash` (TEXT, NOT NULL)
  - `created_at` (INTEGER, NOT NULL, Unix Epoch ms)

#### 26. Entity: `EVENT_OUTBOX`
- **Purpose:** Transactional Outbox pattern for reliable domain event publishing (`REQ-V3-009`).
- **Attributes:**
  - `outbox_id` (TEXT, PK, UUIDv4)
  - `event_id` (TEXT, UNIQUE, NOT NULL)
  - `event_type` (TEXT, NOT NULL)
  - `correlation_id` (TEXT, NOT NULL)
  - `payload_json` (TEXT, NOT NULL)
  - `status` (TEXT, NOT NULL DEFAULT 'PENDING' CHECK(`status` IN ('PENDING', 'PUBLISHED', 'FAILED')))
  - `retry_count` (INTEGER, NOT NULL DEFAULT 0)
  - `error_message` (TEXT, NULL)
  - `created_at` (INTEGER, NOT NULL, Unix Epoch ms)
  - `published_at` (INTEGER, NULL, Unix Epoch ms)

---

## 3. DATABASE CONFIGURATION & RUNTIME SETTINGS

### 3.1 SQLite PRAGMA Standards (`REQ-V3-008`)

```sql
PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;
PRAGMA foreign_keys = ON;
PRAGMA busy_timeout = 5000;
PRAGMA cache_size = -64000; -- 64MB memory cache
PRAGMA temp_store = MEMORY;
PRAGMA mmap_size = 268435456; -- 256MB memory-mapped I/O
```

---

## 4. SCHEMA MIGRATION & BACKWARD COMPATIBILITY

### 4.1 Migration Path: v0.3.0 -> v0.5.0 RC2 -> V3 Target Schema

```mermaid
flowchart LR
    V030["Production Baseline\nv0.3.0 (FROZEN)\nGate G4 LOCKED"]
    RC2["Staging Sandbox\nv0.5.0 RC2\n(Validated in v2.2.1)"]
    V3["V3 Sandbox Target Schema\nv3.0.0\n(27 Tables, 1 FTS5, 3 Triggers, 4 Views)"]

    V030 -. "Independent Human Directive (Gate G4)" .-> RC2
    RC2 -->|"Sandbox Migration 002_v300_schema.sql"| V3
```

---

## 5. COMPLETE DDL TARGET SCHEMA SCRIPT (DRAFT SPECIFICATION)

```sql
-- ============================================================================
-- AICO V3 TARGET SCHEMA (CANONICAL DDL SPECIFICATION)
-- File: docs/blueprint/v3/03_DOMAIN_AND_DATABASE_DESIGN.md
-- Target: SQLite 3.40+ (WAL Mode)
-- Inventory: 27 Base Tables, 1 Virtual Table, 3 Triggers, 4 Views, 16 Indexes
-- ============================================================================

-- 1. Departments
CREATE TABLE IF NOT EXISTS departments (
    department_id TEXT PRIMARY KEY,
    department_code TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    lead_agent_id TEXT,
    description TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);

-- 2. Agents (Strictly 6 AI Agents)
CREATE TABLE IF NOT EXISTS agents (
    agent_id TEXT PRIMARY KEY,
    display_name TEXT NOT NULL,
    role_title TEXT NOT NULL,
    department_id TEXT NOT NULL REFERENCES departments(department_id),
    system_prompt_ref TEXT NOT NULL,
    default_model TEXT NOT NULL,
    quota_pool_id TEXT NOT NULL,
    is_autonomous INTEGER NOT NULL DEFAULT 1,
    requires_approval INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'ACTIVE',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);

-- 3. Security Principals (Discriminator: HUMAN vs AGENT)
CREATE TABLE IF NOT EXISTS principals (
    principal_id TEXT PRIMARY KEY,
    principal_type TEXT NOT NULL CHECK(principal_type IN ('HUMAN', 'AGENT')),
    agent_id TEXT UNIQUE REFERENCES agents(agent_id),
    human_identifier TEXT UNIQUE,
    auth_credential_hash TEXT NOT NULL,
    role TEXT NOT NULL,
    allowed_scopes TEXT NOT NULL,
    is_revoked INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    CHECK(
        (principal_type = 'AGENT' AND agent_id IS NOT NULL AND human_identifier IS NULL) OR
        (principal_type = 'HUMAN' AND agent_id IS NULL AND human_identifier IS NOT NULL)
    )
);

-- 4. Projects
CREATE TABLE IF NOT EXISTS projects (
    project_id TEXT PRIMARY KEY,
    slug TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    department_id TEXT NOT NULL REFERENCES departments(department_id),
    lead_agent_id TEXT NOT NULL REFERENCES agents(agent_id),
    status TEXT NOT NULL DEFAULT 'ACTIVE',
    root_path TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);

-- 5. Tasks
CREATE TABLE IF NOT EXISTS tasks (
    task_id TEXT PRIMARY KEY,
    parent_task_id TEXT REFERENCES tasks(task_id),
    project_id TEXT NOT NULL REFERENCES projects(project_id),
    title TEXT NOT NULL,
    description TEXT NOT NULL,
    task_type TEXT NOT NULL,
    priority TEXT NOT NULL DEFAULT 'MEDIUM',
    status TEXT NOT NULL DEFAULT 'INTAKE_PENDING',
    assigned_agent_id TEXT REFERENCES agents(agent_id),
    creator_agent_id TEXT NOT NULL REFERENCES agents(agent_id),
    reviewer_agent_id TEXT REFERENCES agents(agent_id),
    qa_agent_id TEXT REFERENCES agents(agent_id),
    room_id TEXT,
    token_budget INTEGER NOT NULL DEFAULT 100000,
    requires_founder_gate INTEGER NOT NULL DEFAULT 0,
    version INTEGER NOT NULL DEFAULT 1,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    completed_at INTEGER
);

-- 6. Task Dependencies
CREATE TABLE IF NOT EXISTS task_dependencies (
    dependency_id TEXT PRIMARY KEY,
    task_id TEXT NOT NULL REFERENCES tasks(task_id) ON DELETE CASCADE,
    depends_on_task_id TEXT NOT NULL REFERENCES tasks(task_id) ON DELETE CASCADE,
    dependency_type TEXT NOT NULL DEFAULT 'FINISH_TO_START',
    is_blocking INTEGER NOT NULL DEFAULT 1,
    created_at INTEGER NOT NULL,
    UNIQUE(task_id, depends_on_task_id),
    CHECK(task_id != depends_on_task_id)
);

-- 7. Task Executions
CREATE TABLE IF NOT EXISTS task_executions (
    execution_id TEXT PRIMARY KEY,
    task_id TEXT NOT NULL REFERENCES tasks(task_id),
    agent_id TEXT NOT NULL REFERENCES agents(agent_id),
    session_id TEXT NOT NULL,
    status TEXT NOT NULL,
    git_base_commit TEXT,
    git_head_commit TEXT,
    exit_code INTEGER,
    error_message TEXT,
    started_at INTEGER NOT NULL,
    ended_at INTEGER
);

-- 8. Task Leases
CREATE TABLE IF NOT EXISTS task_leases (
    lease_id TEXT PRIMARY KEY,
    task_id TEXT UNIQUE NOT NULL REFERENCES tasks(task_id) ON DELETE CASCADE,
    agent_id TEXT NOT NULL REFERENCES agents(agent_id),
    lease_nonce TEXT NOT NULL,
    heartbeat_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL,
    acquired_at INTEGER NOT NULL
);

-- 9. Chat Rooms (6 Canonical Types)
CREATE TABLE IF NOT EXISTS chat_rooms (
    room_id TEXT PRIMARY KEY,
    slug TEXT UNIQUE NOT NULL,
    title TEXT NOT NULL,
    room_type TEXT NOT NULL CHECK(room_type IN ('EXECUTIVE_BOARDROOM', 'ANNOUNCEMENTS', 'DEPARTMENT_OFFICE', 'PROJECT_ROOM', 'TASK_ROOM', 'DIRECT_MESSAGE')),
    project_id TEXT REFERENCES projects(project_id),
    task_id TEXT REFERENCES tasks(task_id),
    is_archived INTEGER NOT NULL DEFAULT 0,
    created_by_agent_id TEXT NOT NULL REFERENCES agents(agent_id),
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);

-- 10. Room Memberships
CREATE TABLE IF NOT EXISTS room_memberships (
    membership_id TEXT PRIMARY KEY,
    room_id TEXT NOT NULL REFERENCES chat_rooms(room_id) ON DELETE CASCADE,
    agent_id TEXT NOT NULL REFERENCES agents(agent_id),
    member_role TEXT NOT NULL DEFAULT 'MEMBER',
    last_read_message_id TEXT,
    last_read_at INTEGER NOT NULL,
    joined_at INTEGER NOT NULL,
    UNIQUE(room_id, agent_id)
);

-- 11. Messages
CREATE TABLE IF NOT EXISTS messages (
    message_id TEXT PRIMARY KEY,
    room_id TEXT NOT NULL REFERENCES chat_rooms(room_id) ON DELETE CASCADE,
    thread_id TEXT,
    sender_agent_id TEXT NOT NULL REFERENCES agents(agent_id),
    reply_to_message_id TEXT REFERENCES messages(message_id),
    message_type TEXT NOT NULL DEFAULT 'TEXT' CHECK(message_type IN ('TEXT', 'DIRECTIVE', 'PROPOSAL', 'REVIEW_FEEDBACK', 'GATE_STATUS', 'SYSTEM_NOTICE')),
    content TEXT NOT NULL,
    mentions TEXT,
    metadata TEXT,
    is_edited INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);

-- 12. Threads
CREATE TABLE IF NOT EXISTS threads (
    thread_id TEXT PRIMARY KEY,
    room_id TEXT NOT NULL REFERENCES chat_rooms(room_id) ON DELETE CASCADE,
    root_message_id TEXT UNIQUE NOT NULL REFERENCES messages(message_id),
    title TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'OPEN' CHECK(status IN ('OPEN', 'RESOLVED', 'CLOSED')),
    resolved_by_agent_id TEXT REFERENCES agents(agent_id),
    resolved_at INTEGER,
    created_at INTEGER NOT NULL
);

-- 13. Notifications Inbox
CREATE TABLE IF NOT EXISTS notifications_inbox (
    notification_id TEXT PRIMARY KEY,
    target_agent_id TEXT NOT NULL REFERENCES agents(agent_id),
    source_type TEXT NOT NULL CHECK(source_type IN ('MENTION', 'ASSIGNMENT', 'REVIEW_REQUEST', 'QA_REQUEST', 'APPROVAL_ALERT', 'SYSTEM')),
    source_id TEXT NOT NULL,
    title TEXT NOT NULL,
    content TEXT NOT NULL,
    is_read INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    read_at INTEGER
);

-- 14. Context Snapshots
CREATE TABLE IF NOT EXISTS context_snapshots (
    snapshot_id TEXT PRIMARY KEY,
    task_id TEXT NOT NULL REFERENCES tasks(task_id) ON DELETE CASCADE,
    agent_id TEXT NOT NULL REFERENCES agents(agent_id),
    summary TEXT NOT NULL,
    active_hypotheses TEXT,
    verified_facts TEXT NOT NULL,
    pending_steps TEXT NOT NULL,
    total_tokens INTEGER NOT NULL,
    created_at INTEGER NOT NULL
);

-- 15. Memory Entries (5-Tier Scoping)
CREATE TABLE IF NOT EXISTS memory_entries (
    memory_id TEXT PRIMARY KEY,
    scope TEXT NOT NULL CHECK(scope IN ('COMPANY', 'PROJECT', 'TASK', 'ROOM', 'AGENT_PRIVATE')),
    scope_id TEXT NOT NULL,
    category TEXT NOT NULL CHECK(category IN ('ARCHITECTURAL_DECISION', 'INCIDENT_LEARNING', 'PERFORMANCE_PATTERN', 'FACT')),
    key TEXT NOT NULL,
    content TEXT NOT NULL,
    provenance_agent_id TEXT NOT NULL REFERENCES agents(agent_id),
    provenance_ref TEXT,
    confidence_score REAL NOT NULL DEFAULT 1.0,
    is_tombstoned INTEGER NOT NULL DEFAULT 0,
    tombstone_reason TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);

-- 16. Knowledge Documents
CREATE TABLE IF NOT EXISTS knowledge_documents (
    doc_id TEXT PRIMARY KEY,
    project_id TEXT REFERENCES projects(project_id),
    file_path TEXT UNIQUE NOT NULL,
    title TEXT NOT NULL,
    content_sha256 TEXT NOT NULL,
    classification TEXT NOT NULL,
    author_agent_id TEXT NOT NULL REFERENCES agents(agent_id),
    last_indexed_at INTEGER NOT NULL,
    created_at INTEGER NOT NULL
);

-- 17. Artifacts
CREATE TABLE IF NOT EXISTS artifacts (
    artifact_id TEXT PRIMARY KEY,
    task_id TEXT NOT NULL REFERENCES tasks(task_id) ON DELETE CASCADE,
    creator_agent_id TEXT NOT NULL REFERENCES agents(agent_id),
    name TEXT NOT NULL,
    file_path TEXT NOT NULL,
    file_sha256 TEXT NOT NULL,
    mime_type TEXT NOT NULL,
    size_bytes INTEGER NOT NULL,
    is_verified INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL
);

-- 18. Skills
CREATE TABLE IF NOT EXISTS skills (
    skill_id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT NOT NULL,
    skill_path TEXT NOT NULL,
    instructions_md_hash TEXT NOT NULL,
    is_active INTEGER NOT NULL DEFAULT 1,
    plugin_id TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);

-- 19. Capabilities Taxonomy
CREATE TABLE IF NOT EXISTS capabilities (
    capability_id TEXT PRIMARY KEY,
    category TEXT NOT NULL,
    description TEXT NOT NULL
);

-- 20. Agent Capabilities Mapping
CREATE TABLE IF NOT EXISTS agent_capabilities (
    agent_id TEXT NOT NULL REFERENCES agents(agent_id),
    capability_id TEXT NOT NULL REFERENCES capabilities(capability_id),
    proficiency_level TEXT NOT NULL DEFAULT 'COMPETENT',
    PRIMARY KEY(agent_id, capability_id)
);

-- 21. Plugins
CREATE TABLE IF NOT EXISTS plugins (
    plugin_id TEXT PRIMARY KEY,
    version TEXT NOT NULL,
    install_path TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'ENABLED',
    created_at INTEGER NOT NULL
);

-- 22. Agent Sessions
CREATE TABLE IF NOT EXISTS agent_sessions (
    session_id TEXT PRIMARY KEY,
    agent_id TEXT NOT NULL REFERENCES agents(agent_id),
    runtime_adapter TEXT NOT NULL,
    ip_address TEXT NOT NULL,
    started_at INTEGER NOT NULL,
    ended_at INTEGER,
    is_active INTEGER NOT NULL DEFAULT 1
);

-- 23. Runtime Observations
CREATE TABLE IF NOT EXISTS runtime_observations (
    observation_id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL REFERENCES agent_sessions(session_id),
    task_id TEXT REFERENCES tasks(task_id),
    severity TEXT NOT NULL CHECK(severity IN ('DEBUG', 'INFO', 'WARN', 'ERROR', 'FATAL')),
    subsystem TEXT NOT NULL,
    message TEXT NOT NULL,
    details_json TEXT,
    created_at INTEGER NOT NULL
);

-- 24. Token Usage
CREATE TABLE IF NOT EXISTS token_usage (
    usage_id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL REFERENCES agent_sessions(session_id),
    task_id TEXT REFERENCES tasks(task_id),
    agent_id TEXT NOT NULL REFERENCES agents(agent_id),
    quota_pool_id TEXT NOT NULL,
    model_name TEXT NOT NULL,
    prompt_tokens INTEGER NOT NULL,
    completion_tokens INTEGER NOT NULL,
    total_tokens INTEGER NOT NULL,
    estimated_cost_usd REAL NOT NULL DEFAULT 0.0,
    created_at INTEGER NOT NULL
);

-- 25. Approvals (Human Verifiable Authorization)
CREATE TABLE IF NOT EXISTS approvals (
    approval_id TEXT PRIMARY KEY,
    approval_type TEXT NOT NULL CHECK(approval_type IN ('ARGON_INVOCATION', 'PRODUCTION_DEPLOY', 'SCHEMA_MIGRATION', 'ACL_APPLY')),
    target_resource TEXT NOT NULL,
    requestor_agent_id TEXT NOT NULL REFERENCES agents(agent_id),
    payload_sha256 TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'PENDING' CHECK(status IN ('PENDING', 'APPROVED', 'REJECTED', 'EXPIRED', 'CONSUMED')),
    founder_principal_id TEXT REFERENCES principals(principal_id),
    human_signature TEXT,
    decision_reason TEXT,
    expires_at INTEGER NOT NULL,
    consumed_at INTEGER,
    consumed_by_agent_id TEXT REFERENCES agents(agent_id),
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);

-- 26. Audit Events (Forward Hash Chain)
CREATE TABLE IF NOT EXISTS audit_events (
    event_id TEXT PRIMARY KEY,
    sequence_number INTEGER UNIQUE NOT NULL,
    actor_agent_id TEXT NOT NULL,
    action TEXT NOT NULL,
    target_type TEXT NOT NULL,
    target_id TEXT NOT NULL,
    payload_hash TEXT NOT NULL,
    previous_event_hash TEXT NOT NULL,
    current_event_hash TEXT NOT NULL,
    created_at INTEGER NOT NULL
);

-- 27. Event Outbox (Transactional Event Publishing)
CREATE TABLE IF NOT EXISTS event_outbox (
    outbox_id TEXT PRIMARY KEY,
    event_id TEXT UNIQUE NOT NULL,
    event_type TEXT NOT NULL,
    correlation_id TEXT NOT NULL,
    payload_json TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'PENDING' CHECK(status IN ('PENDING', 'PUBLISHED', 'FAILED')),
    retry_count INTEGER NOT NULL DEFAULT 0,
    error_message TEXT,
    created_at INTEGER NOT NULL,
    published_at INTEGER
);

-- ============================================================================
-- VIRTUAL TABLES (FTS5) & TRIGGERS
-- ============================================================================

-- Virtual Table: Memory Full-Text Search
CREATE VIRTUAL TABLE IF NOT EXISTS memory_fts USING fts5(
    key,
    content,
    scope,
    category,
    content='memory_entries',
    content_rowid='rowid'
);

-- Trigger: FTS5 Insert Sync
CREATE TRIGGER IF NOT EXISTS trg_memory_entries_ai AFTER INSERT ON memory_entries BEGIN
    INSERT INTO memory_fts(rowid, key, content, scope, category)
    VALUES (new.rowid, new.key, new.content, new.scope, new.category);
END;

-- Trigger: FTS5 Delete Sync
CREATE TRIGGER IF NOT EXISTS trg_memory_entries_ad AFTER DELETE ON memory_entries BEGIN
    INSERT INTO memory_fts(memory_fts, rowid, key, content, scope, category)
    VALUES ('delete', old.rowid, old.key, old.content, old.scope, old.category);
END;

-- Trigger: FTS5 Update Sync
CREATE TRIGGER IF NOT EXISTS trg_memory_entries_au AFTER UPDATE ON memory_entries BEGIN
    INSERT INTO memory_fts(memory_fts, rowid, key, content, scope, category)
    VALUES ('delete', old.rowid, old.key, old.content, old.scope, old.category);
    INSERT INTO memory_fts(rowid, key, content, scope, category)
    VALUES (new.rowid, new.key, new.content, new.scope, new.category);
END;

-- ============================================================================
-- BACKWARD-COMPATIBLE LEGACY VIEWS
-- ============================================================================

-- View 1: Tasks Legacy Compatibility View
CREATE VIEW IF NOT EXISTS v_tasks_legacy AS
SELECT 
    task_id AS id,
    title,
    description,
    status,
    priority,
    assigned_agent_id AS assigned_to,
    creator_agent_id AS created_by,
    created_at,
    updated_at
FROM tasks;

-- View 2: Agents Legacy Compatibility View
CREATE VIEW IF NOT EXISTS v_agents_legacy AS
SELECT 
    agent_id AS id,
    display_name AS name,
    role_title AS role,
    status,
    default_model AS model,
    quota_pool_id AS quota_pool
FROM agents;

-- View 3: Quota Legacy Compatibility View
CREATE VIEW IF NOT EXISTS v_quota_legacy AS
SELECT 
    quota_pool_id,
    SUM(prompt_tokens) AS total_prompt_tokens,
    SUM(completion_tokens) AS total_completion_tokens,
    SUM(total_tokens) AS total_tokens_consumed,
    SUM(estimated_cost_usd) AS total_cost_usd
FROM token_usage
GROUP BY quota_pool_id;

-- View 4: Approvals Legacy Compatibility View
CREATE VIEW IF NOT EXISTS v_approvals_legacy AS
SELECT 
    approval_id AS id,
    approval_type AS action_type,
    target_resource AS resource,
    requestor_agent_id AS requested_by,
    status,
    decision_reason AS reason,
    expires_at,
    created_at
FROM approvals;

-- ============================================================================
-- PERFORMANCE & INTEGRITY INDEXES (16 INDEXES)
-- ============================================================================
CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
CREATE INDEX IF NOT EXISTS idx_tasks_assigned_agent ON tasks(assigned_agent_id);
CREATE INDEX IF NOT EXISTS idx_tasks_project ON tasks(project_id);
CREATE INDEX IF NOT EXISTS idx_messages_room_created ON messages(room_id, created_at);
CREATE INDEX IF NOT EXISTS idx_messages_thread ON messages(thread_id);
CREATE INDEX IF NOT EXISTS idx_notifications_inbox_agent ON notifications_inbox(target_agent_id, is_read);
CREATE INDEX IF NOT EXISTS idx_memory_lookup ON memory_entries(scope, scope_id, key) WHERE is_tombstoned = 0;
CREATE INDEX IF NOT EXISTS idx_token_usage_task ON token_usage(task_id);
CREATE INDEX IF NOT EXISTS idx_token_usage_agent ON token_usage(agent_id);
CREATE INDEX IF NOT EXISTS idx_audit_sequence ON audit_events(sequence_number);
CREATE INDEX IF NOT EXISTS idx_approvals_lookup ON approvals(approval_type, target_resource, payload_sha256, status);
CREATE INDEX IF NOT EXISTS idx_task_leases_expires ON task_leases(expires_at);
CREATE INDEX IF NOT EXISTS idx_event_outbox_status ON event_outbox(status);
CREATE INDEX IF NOT EXISTS idx_task_dependencies_parent ON task_dependencies(task_id);
CREATE INDEX IF NOT EXISTS idx_task_dependencies_child ON task_dependencies(depends_on_task_id);
CREATE INDEX IF NOT EXISTS idx_room_memberships_lookup ON room_memberships(room_id, agent_id);
```
