-- ============================================================================
-- AICO_DATABASE_SCHEMA_V0.5.0_RC2.sql
-- Target Schema DDL for SQLite (node:sqlite DatabaseSync); NOT a v0.3.0 migration
-- Schema Version: 0.5.0 RC2
-- Total Objects: 22 Regular Tables (T01..T22) + 1 FTS5 Virtual Table (V01)
--                + 30 Explicit Indexes + 12 Triggers (2 agent invariants, 3 FTS sync, 2 append-only task events, 2 append-only audit, 3 artifact scan/immutability)
-- ============================================================================

-- Connection settings are intentionally NOT executed in this DDL file.
-- ConnectionManager must apply/verify journal_mode=WAL before opening a migration
-- transaction, and set synchronous, foreign_keys, busy_timeout and
-- wal_autocheckpoint on every DatabaseSync connection. Never run journal_mode
-- changes inside BEGIN/COMMIT migration transactions.

-- ----------------------------------------------------------------------------
-- T01: schema_migrations (Tracks atomic migration execution history)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS schema_migrations (
  version TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  checksum_sha256 TEXT NOT NULL,
  backup_file_path TEXT NOT NULL,
  applied_by_principal TEXT NOT NULL,
  execution_ms INTEGER NOT NULL CHECK (execution_ms >= 0),
  applied_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- ----------------------------------------------------------------------------
-- T02: quota_pools (Preserves existing v0.3.0 columns + adds quota governance)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS quota_pools (
  pool_id TEXT PRIMARY KEY
    CHECK (pool_id IN ('google-pro-01', 'google-pro-02', 'gemini-web-01', 'gemini-web-02', 'openai-go-shared')),
  provider TEXT NOT NULL,
  account_label TEXT NOT NULL,
  quota_class TEXT NOT NULL DEFAULT 'normal'
    CHECK (quota_class IN ('normal', 'scarce')),
  max_concurrent_tasks INTEGER NOT NULL DEFAULT 2
    CHECK (max_concurrent_tasks >= 1),
  cooldown_seconds INTEGER NOT NULL DEFAULT 0
    CHECK (cooldown_seconds >= 0),
  pool_status TEXT NOT NULL DEFAULT 'active'
    CHECK (pool_status IN ('active', 'throttled', 'exhausted', 'locked')),
  notes TEXT,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- ----------------------------------------------------------------------------
-- T03: agents (Preserves v0.3.0 columns + separates Desired vs Runtime State)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS agents (
  agent_id TEXT PRIMARY KEY
    CHECK (agent_id IN ('chatgpt-01', 'flash-01', 'flash-02', 'codex-01', 'argon-01', 'argon-02')),
  display_name TEXT NOT NULL,
  model TEXT NOT NULL,
  platform TEXT NOT NULL,
  role TEXT NOT NULL,
  department TEXT NOT NULL,
  -- Legacy 'status' column retained for backward compatibility with v0.3.0 tools;
  -- New code reads desired_config_status and runtime_status explicitly:
  status TEXT NOT NULL DEFAULT 'configured'
    CHECK (status IN ('planned', 'configured', 'active', 'offline')),
  desired_config_status TEXT NOT NULL DEFAULT 'configured'
    CHECK (desired_config_status IN ('configured', 'active', 'disabled')),
  runtime_status TEXT NOT NULL DEFAULT 'unknown'
    CHECK (runtime_status IN ('unknown', 'online', 'busy', 'offline', 'blocked')),
  capabilities_json TEXT NOT NULL DEFAULT '[]',
  invocation_mode TEXT NOT NULL DEFAULT 'manual'
    CHECK (invocation_mode IN ('automatic', 'manual')),
  auto_invoke INTEGER NOT NULL DEFAULT 0
    CHECK (auto_invoke IN (0, 1)),
  requires_approval INTEGER NOT NULL DEFAULT 1
    CHECK (requires_approval IN (0, 1)),
  session_mode TEXT NOT NULL DEFAULT 'web_interactive'
    CHECK (session_mode IN ('web_interactive', 'ide_interactive', 'desktop_interactive', 'api_headless')),
  dispatch_mode TEXT NOT NULL DEFAULT 'operator_handoff'
    CHECK (dispatch_mode IN ('operator_handoff', 'ide_workspace_queue', 'desktop_workspace_queue', 'manual_founder_gate', 'automatic_api')),
  invocation_approval_policy TEXT NOT NULL DEFAULT 'none_within_policy'
    CHECK (invocation_approval_policy IN ('none_within_policy', 'founder_every_invocation')),
  action_approval_policy TEXT NOT NULL DEFAULT 'by_action_risk_matrix'
    CHECK (action_approval_policy IN ('by_action_risk_matrix', 'always_require_founder')),
  quota_class TEXT NOT NULL DEFAULT 'normal'
    CHECK (quota_class IN ('normal', 'scarce')),
  usage_tier TEXT NOT NULL DEFAULT 'high'
    CHECK (usage_tier IN ('high', 'medium', 'low')),
  routing_priority INTEGER NOT NULL DEFAULT 1
    CHECK (routing_priority IN (1, 2, 3)),
  quota_pool TEXT NOT NULL
    REFERENCES quota_pools(pool_id) ON DELETE RESTRICT,
  reasoning_level TEXT NOT NULL DEFAULT 'high'
    CHECK (reasoning_level IN ('high', 'think', 'pending')),
  reasoning_verified INTEGER NOT NULL DEFAULT 0
    CHECK (reasoning_verified IN (0, 1)),
  model_verified INTEGER NOT NULL DEFAULT 0
    CHECK (model_verified IN (0, 1)),
  verified_runtime_model TEXT,
  access_profile TEXT NOT NULL DEFAULT 'web_agent_logical'
    CHECK (access_profile IN ('local_agent_physical', 'web_agent_logical')),
  permission_policy_json TEXT NOT NULL DEFAULT '{}',
  last_seen_at TEXT,
  last_verified_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  -- Hard constraint: Argon agents MUST always have manual_founder_gate and founder_every_invocation
  CHECK (
    (agent_id NOT IN ('argon-01', 'argon-02')) OR
    (invocation_mode = 'manual' AND auto_invoke = 0 AND requires_approval = 1
     AND dispatch_mode = 'manual_founder_gate'
     AND invocation_approval_policy = 'founder_every_invocation'
     AND quota_class = 'scarce')
  )
);

CREATE INDEX IF NOT EXISTS idx_agents_status ON agents(status);
CREATE INDEX IF NOT EXISTS idx_agents_runtime_status ON agents(runtime_status);
CREATE INDEX IF NOT EXISTS idx_agents_department ON agents(department);
CREATE INDEX IF NOT EXISTS idx_agents_priority ON agents(routing_priority, usage_tier);

-- Invariant Trigger 1: Prevent inserting a 7th agent
CREATE TRIGGER IF NOT EXISTS trg_agents_max_six_insert
BEFORE INSERT ON agents
WHEN (SELECT COUNT(*) FROM agents) >= 6
BEGIN
  SELECT RAISE(ABORT, 'INVARIANT_VIOLATION: AICO permits at most 6 registered AI agents.');
END;

-- Invariant Trigger 2: Prevent deleting any of the 6 canonical agents
CREATE TRIGGER IF NOT EXISTS trg_agents_no_delete
BEFORE DELETE ON agents
BEGIN
  SELECT RAISE(ABORT, 'INVARIANT_VIOLATION: Deleting registered AI agents is forbidden.');
END;

-- ----------------------------------------------------------------------------
-- T04: agent_runtime_observations (Layer 3: Verified Runtime Evidence)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS agent_runtime_observations (
  observation_id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL REFERENCES agents(agent_id) ON DELETE RESTRICT,
  observed_via TEXT NOT NULL
    CHECK (observed_via IN ('mcp_handshake', 'stdio_boot', 'operator_verified', 'git_mediation')),
  source_gateway TEXT NOT NULL
    CHECK (source_gateway IN ('local', 'public', 'stdio')),
  observed_os_user TEXT,
  client_info_json TEXT NOT NULL DEFAULT '{}',
  observed_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_observations_agent_time
  ON agent_runtime_observations(agent_id, observed_at DESC);

-- ----------------------------------------------------------------------------
-- T05: human_principals (Dedicated Human Owner model — NOT an AI agent)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS human_principals (
  human_id TEXT PRIMARY KEY CHECK (human_id = 'founder-01'),
  display_name TEXT NOT NULL,
  official_title TEXT NOT NULL,
  windows_account TEXT NOT NULL,
  scopes_json TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'locked')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- ----------------------------------------------------------------------------
-- T06: human_credentials (Cryptographic tokens for Founder local CLI/MCP)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS human_credentials (
  credential_id TEXT PRIMARY KEY,
  human_id TEXT NOT NULL REFERENCES human_principals(human_id) ON DELETE RESTRICT,
  key_prefix TEXT NOT NULL UNIQUE,
  secret_hash TEXT NOT NULL UNIQUE,
  scopes_json TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'revoked', 'expired')),
  expires_at TEXT NOT NULL,
  last_used_at TEXT,
  revoked_at TEXT,
  revoked_reason TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- ----------------------------------------------------------------------------
-- T07: agent_credentials (Reconciles v0.4.0 key_prefix/secret_hash + O(1) lookup)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS agent_credentials (
  credential_id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL REFERENCES agents(agent_id) ON DELETE RESTRICT,
  key_prefix TEXT NOT NULL UNIQUE,
  secret_hash TEXT NOT NULL UNIQUE,
  scopes_json TEXT NOT NULL DEFAULT '["company:read","workspace:read:self","workspace:write:self"]',
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'revoked', 'expired')),
  allow_public_gateway INTEGER NOT NULL DEFAULT 0
    CHECK (allow_public_gateway IN (0, 1)),
  issued_by_human_id TEXT NOT NULL DEFAULT 'founder-01'
    REFERENCES human_principals(human_id) ON DELETE RESTRICT,
  approval_id TEXT,
  description TEXT,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  last_used_at TEXT,
  revoked_at TEXT,
  revoked_reason TEXT
);

CREATE INDEX IF NOT EXISTS idx_credentials_agent_status
  ON agent_credentials(agent_id, status);
CREATE INDEX IF NOT EXISTS idx_credentials_hash
  ON agent_credentials(secret_hash);

-- ----------------------------------------------------------------------------
-- T08: approval_requests (One-time, payload-bound Founder & Technical approvals)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS approval_requests (
  approval_id TEXT PRIMARY KEY,
  requested_by_principal_type TEXT NOT NULL
    CHECK (requested_by_principal_type IN ('human', 'agent')),
  requested_by_principal_id TEXT NOT NULL,
  target_agent_id TEXT REFERENCES agents(agent_id) ON DELETE RESTRICT,
  approval_tier TEXT NOT NULL
    CHECK (approval_tier IN ('founder', 'technical')),
  action_type TEXT NOT NULL
    CHECK (action_type IN (
      'argon_invocation',
      'project_approval',
      'critical_task_approval',
      'credential_issue',
      'credential_rotate',
      'db_migration',
      'acl_or_service_change',
      'public_gateway_release',
      'high_risk_merge',
      'architecture_review'
    )),
  target_resource TEXT NOT NULL,
  payload_canonical_json TEXT NOT NULL,
  payload_hash_sha256 TEXT NOT NULL,
  reason TEXT NOT NULL,
  risk_level TEXT NOT NULL
    CHECK (risk_level IN ('low', 'medium', 'high', 'critical')),
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'rejected', 'expired', 'consumed')),
  requested_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  expires_at TEXT NOT NULL,
  decided_by_human_id TEXT REFERENCES human_principals(human_id) ON DELETE RESTRICT,
  decided_by_agent_id TEXT REFERENCES agents(agent_id) ON DELETE RESTRICT,
  decided_at TEXT,
  decision_note TEXT,
  consumed_at TEXT,
  consumed_by_request_id TEXT,
  -- Hard rule: Founder-tier approvals can ONLY be approved by human_principals ('founder-01')
  CHECK (
    status != 'approved' OR
    (approval_tier = 'founder' AND decided_by_human_id = 'founder-01' AND decided_by_agent_id IS NULL) OR
    (approval_tier = 'technical' AND (decided_by_human_id = 'founder-01' OR decided_by_agent_id = 'flash-01'))
  ),
  -- Hard rule: Argon invocations MUST always be 'founder' tier
  CHECK (
    action_type != 'argon_invocation' OR
    (approval_tier = 'founder' AND target_agent_id IN ('argon-01', 'argon-02'))
  ),
  CHECK (
    action_type NOT IN ('project_approval', 'critical_task_approval') OR
    approval_tier = 'founder'
  )
);

CREATE INDEX IF NOT EXISTS idx_approvals_status_tier
  ON approval_requests(status, approval_tier, expires_at);
CREATE INDEX IF NOT EXISTS idx_approvals_target
  ON approval_requests(action_type, target_resource);

-- ----------------------------------------------------------------------------
-- T09: agent_workspaces (Per-agent physical or logical workspace metadata)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS agent_workspaces (
  workspace_id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL UNIQUE REFERENCES agents(agent_id) ON DELETE RESTRICT,
  relative_root TEXT NOT NULL UNIQUE,
  git_clone_path TEXT,
  workspace_status TEXT NOT NULL DEFAULT 'active'
    CHECK (workspace_status IN ('initializing', 'active', 'suspended', 'archived')),
  access_profile TEXT NOT NULL DEFAULT 'standard'
    CHECK (access_profile IN ('standard', 'restricted', 'logical_only')),
  logical_only INTEGER NOT NULL DEFAULT 0
    CHECK (logical_only IN (0, 1)),
  allowed_paths_json TEXT NOT NULL
    DEFAULT '["profile","inbox","outbox","tasks","notes","reports","artifacts"]',
  writable_paths_json TEXT NOT NULL
    DEFAULT '["outbox","tasks","notes","reports","artifacts"]',
  max_file_bytes INTEGER NOT NULL DEFAULT 5242880
    CHECK (max_file_bytes > 0 AND max_file_bytes <= 20971520),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_workspaces_agent ON agent_workspaces(agent_id);

-- ----------------------------------------------------------------------------
-- T10: agent_workspace_activities (Post-I/O audit log; ON DELETE RESTRICT)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS agent_workspace_activities (
  activity_id INTEGER PRIMARY KEY AUTOINCREMENT,
  request_id TEXT NOT NULL,
  agent_id TEXT NOT NULL REFERENCES agents(agent_id) ON DELETE RESTRICT,
  workspace_id TEXT NOT NULL REFERENCES agent_workspaces(workspace_id) ON DELETE RESTRICT,
  action_type TEXT NOT NULL
    CHECK (action_type IN ('list', 'read', 'write', 'delete', 'share_artifact', 'git_sync')),
  target_path TEXT NOT NULL,
  status TEXT NOT NULL
    CHECK (status IN ('succeeded', 'denied', 'failed')),
  bytes_count INTEGER NOT NULL DEFAULT 0,
  error_code TEXT,
  details_json TEXT NOT NULL DEFAULT '{}',
  recorded_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_activities_agent_time
  ON agent_workspace_activities(agent_id, recorded_at DESC);
CREATE INDEX IF NOT EXISTS idx_activities_workspace_status
  ON agent_workspace_activities(workspace_id, status);

-- ----------------------------------------------------------------------------
-- T11: projects (Company Project Registry)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS projects (
  project_id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  description TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'proposed'
    CHECK (status IN ('proposed', 'approved', 'active', 'paused', 'blocked', 'completed', 'archived')),
  owner_agent_id TEXT NOT NULL REFERENCES agents(agent_id) ON DELETE RESTRICT,
  approved_by_human_id TEXT REFERENCES human_principals(human_id) ON DELETE RESTRICT,
  approval_request_id TEXT REFERENCES approval_requests(approval_id) ON DELETE RESTRICT,
  repository_path TEXT NOT NULL DEFAULT 'D:/AI-COMPANY',
  default_branch TEXT NOT NULL DEFAULT 'master',
  team_agent_ids_json TEXT NOT NULL DEFAULT '[]',
  priority TEXT NOT NULL DEFAULT 'P1'
    CHECK (priority IN ('P0', 'P1', 'P2', 'P3')),
  risk_class TEXT NOT NULL DEFAULT 'medium'
    CHECK (risk_class IN ('low', 'medium', 'high', 'critical')),
  docs_path TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_projects_status ON projects(status, priority);

-- ----------------------------------------------------------------------------
-- T12: tasks (Dual Status Model: execution_status + dispatch_status + Leases)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS tasks (
  task_id TEXT PRIMARY KEY,
  idempotency_key TEXT NOT NULL UNIQUE,
  project_id TEXT NOT NULL REFERENCES projects(project_id) ON DELETE RESTRICT,
  parent_task_id TEXT REFERENCES tasks(task_id) ON DELETE RESTRICT,
  title TEXT NOT NULL,
  objective TEXT NOT NULL,
  description TEXT NOT NULL,
  created_by_principal_type TEXT NOT NULL
    CHECK (created_by_principal_type IN ('human', 'agent')),
  created_by_principal_id TEXT NOT NULL,
  assigned_agent_id TEXT REFERENCES agents(agent_id) ON DELETE RESTRICT,
  reviewer_agent_id TEXT REFERENCES agents(agent_id) ON DELETE RESTRICT,
  priority TEXT NOT NULL DEFAULT 'P1'
    CHECK (priority IN ('P0', 'P1', 'P2', 'P3')),
  risk_class TEXT NOT NULL DEFAULT 'medium'
    CHECK (risk_class IN ('low', 'medium', 'high', 'critical')),
  execution_status TEXT NOT NULL DEFAULT 'draft'
    CHECK (execution_status IN (
      'draft', 'queued', 'assigned', 'claimed', 'in_progress',
      'blocked', 'waiting_approval', 'review_required', 'rework',
      'completed', 'failed', 'cancelled', 'archived'
    )),
  dispatch_status TEXT NOT NULL DEFAULT 'not_dispatched'
    CHECK (dispatch_status IN (
      'not_dispatched', 'approval_pending', 'handoff_ready',
      'queued_for_client_pull', 'awaiting_operator_delivery',
      'operator_delivered', 'external_running', 'delivery_failed', 'result_received'
    )),
  acceptance_criteria_json TEXT NOT NULL DEFAULT '[]',
  input_artifact_ids_json TEXT NOT NULL DEFAULT '[]',
  output_artifact_ids_json TEXT NOT NULL DEFAULT '[]',
  verification_evidence TEXT,
  workspace_id TEXT REFERENCES agent_workspaces(workspace_id) ON DELETE RESTRICT,
  branch_name TEXT,
  approval_request_id TEXT REFERENCES approval_requests(approval_id) ON DELETE RESTRICT,
  lease_owner_agent_id TEXT REFERENCES agents(agent_id) ON DELETE RESTRICT,
  lease_expires_at TEXT,
  retry_count INTEGER NOT NULL DEFAULT 0 CHECK (retry_count >= 0),
  max_retries INTEGER NOT NULL DEFAULT 2 CHECK (max_retries >= 0),
  version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  handoff_file_path TEXT,
  operator_delivered_at TEXT,
  external_invoked_at TEXT,
  started_at TEXT,
  completed_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  -- Hard rule: Argon tasks can NEVER have max_retries > 0
  CHECK (
    assigned_agent_id IS NULL OR
    assigned_agent_id NOT IN ('argon-01', 'argon-02') OR
    max_retries = 0
  )
);

CREATE INDEX IF NOT EXISTS idx_tasks_agent_exec_status
  ON tasks(assigned_agent_id, execution_status, priority);
CREATE INDEX IF NOT EXISTS idx_tasks_project_status
  ON tasks(project_id, execution_status);
CREATE INDEX IF NOT EXISTS idx_tasks_lease_expiry
  ON tasks(execution_status, lease_expires_at);

-- ----------------------------------------------------------------------------
-- T13: task_events (Immutable append-only state transition & milestone log)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS task_events (
  event_id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id TEXT NOT NULL REFERENCES tasks(task_id) ON DELETE RESTRICT,
  actor_principal_type TEXT NOT NULL CHECK (actor_principal_type IN ('human', 'agent', 'service')),
  actor_principal_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  from_execution_status TEXT,
  to_execution_status TEXT,
  from_dispatch_status TEXT,
  to_dispatch_status TEXT,
  task_version INTEGER NOT NULL,
  approval_id TEXT REFERENCES approval_requests(approval_id) ON DELETE RESTRICT,
  note TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  recorded_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_task_events_task_time
  ON task_events(task_id, recorded_at ASC);

-- ----------------------------------------------------------------------------
-- T14: messages (Persistent inter-agent / Founder messaging outbox)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS messages (
  message_id TEXT PRIMARY KEY,
  thread_id TEXT NOT NULL,
  task_id TEXT REFERENCES tasks(task_id) ON DELETE RESTRICT,
  from_principal_type TEXT NOT NULL CHECK (from_principal_type IN ('human', 'agent', 'service')),
  from_principal_id TEXT NOT NULL,
  message_type TEXT NOT NULL
    CHECK (message_type IN ('task_handoff', 'question', 'review_request', 'result', 'approval_request', 'alert')),
  subject TEXT NOT NULL,
  body_markdown TEXT NOT NULL,
  artifact_ids_json TEXT NOT NULL DEFAULT '[]',
  sensitivity TEXT NOT NULL DEFAULT 'internal'
    CHECK (sensitivity IN ('public', 'internal', 'confidential')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_messages_thread ON messages(thread_id, created_at ASC);
CREATE INDEX IF NOT EXISTS idx_messages_task ON messages(task_id);

-- ----------------------------------------------------------------------------
-- T15: message_recipients (Per-recipient inbox pointer & delivery truth state)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS message_recipients (
  recipient_row_id INTEGER PRIMARY KEY AUTOINCREMENT,
  message_id TEXT NOT NULL REFERENCES messages(message_id) ON DELETE RESTRICT,
  to_principal_type TEXT NOT NULL CHECK (to_principal_type IN ('human', 'agent')),
  to_principal_id TEXT NOT NULL,
  delivery_status TEXT NOT NULL
    CHECK (delivery_status IN ('stored_in_inbox', 'awaiting_operator_delivery', 'operator_delivered', 'read', 'acknowledged')),
  inbox_file_path TEXT,
  delivered_at TEXT,
  acknowledged_at TEXT,
  ack_note TEXT,
  UNIQUE(message_id, to_principal_type, to_principal_id)
);

CREATE INDEX IF NOT EXISTS idx_recipients_inbox
  ON message_recipients(to_principal_type, to_principal_id, delivery_status);

-- ----------------------------------------------------------------------------
-- T16: artifacts (Immutable checksummed deliverable metadata)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS artifacts (
  artifact_id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES agent_workspaces(workspace_id) ON DELETE RESTRICT,
  creator_agent_id TEXT NOT NULL REFERENCES agents(agent_id) ON DELETE RESTRICT,
  task_id TEXT REFERENCES tasks(task_id) ON DELETE RESTRICT,
  file_name TEXT NOT NULL,
  relative_path TEXT NOT NULL,
  content_type TEXT NOT NULL DEFAULT 'text/markdown',
  size_bytes INTEGER NOT NULL CHECK (size_bytes >= 0),
  checksum_sha256 TEXT NOT NULL,
  classification TEXT NOT NULL DEFAULT 'internal'
    CHECK (classification IN ('public', 'internal', 'restricted')),
  secret_scan_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (secret_scan_status IN ('pending', 'clean', 'blocked')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_artifacts_task ON artifacts(task_id);
CREATE INDEX IF NOT EXISTS idx_artifacts_creator ON artifacts(creator_agent_id, created_at DESC);

-- ----------------------------------------------------------------------------
-- T17: artifact_shares (Controlled cross-workspace artifact distribution)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS artifact_shares (
  share_id TEXT PRIMARY KEY,
  artifact_id TEXT NOT NULL REFERENCES artifacts(artifact_id) ON DELETE RESTRICT,
  from_agent_id TEXT NOT NULL REFERENCES agents(agent_id) ON DELETE RESTRICT,
  to_agent_id TEXT NOT NULL REFERENCES agents(agent_id) ON DELETE RESTRICT,
  task_id TEXT REFERENCES tasks(task_id) ON DELETE RESTRICT,
  recipient_inbox_path TEXT NOT NULL,
  shared_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_artifact_shares_recipient
  ON artifact_shares(to_agent_id, shared_at DESC);

-- ----------------------------------------------------------------------------
-- T18: knowledge_documents (Shared company/architecture/runbook docs index)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS knowledge_documents (
  doc_id TEXT PRIMARY KEY,
  relative_path TEXT NOT NULL UNIQUE,
  category TEXT NOT NULL
    CHECK (category IN ('company', 'architecture', 'adr', 'runbook', 'standard', 'project', 'skill')),
  title TEXT NOT NULL,
  summary TEXT NOT NULL,
  body_markdown TEXT NOT NULL,
  tags_json TEXT NOT NULL DEFAULT '[]',
  checksum_sha256 TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  last_indexed_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_knowledge_category ON knowledge_documents(category);

-- ----------------------------------------------------------------------------
-- V01: knowledge_fts (FTS5 Virtual Table with Vietnamese/English support)
-- ----------------------------------------------------------------------------
CREATE VIRTUAL TABLE IF NOT EXISTS knowledge_fts USING fts5(
  doc_id UNINDEXED,
  category UNINDEXED,
  title,
  summary,
  body_markdown,
  tags_text,
  tokenize = "unicode61 remove_diacritics 2 tokenchars '-_'"
);

-- FTS synchronization: fold Vietnamese đ/Đ to d/D in the FTS shadow copy;
-- original source text in knowledge_documents remains unchanged. Query text must
-- use the identical versioned application normalizer (NFC + Đ/đ fold).
CREATE TRIGGER IF NOT EXISTS trg_knowledge_fts_ai
AFTER INSERT ON knowledge_documents
BEGIN
  INSERT INTO knowledge_fts(rowid, doc_id, category, title, summary, body_markdown, tags_text)
  VALUES (new.rowid, new.doc_id, new.category, replace(replace(new.title, 'đ', 'd'), 'Đ', 'D'), replace(replace(new.summary, 'đ', 'd'), 'Đ', 'D'), replace(replace(new.body_markdown, 'đ', 'd'), 'Đ', 'D'), replace(replace(new.tags_json, 'đ', 'd'), 'Đ', 'D'));
END;

CREATE TRIGGER IF NOT EXISTS trg_knowledge_fts_au
AFTER UPDATE ON knowledge_documents
BEGIN
  DELETE FROM knowledge_fts WHERE rowid = old.rowid;
  INSERT INTO knowledge_fts(rowid, doc_id, category, title, summary, body_markdown, tags_text)
  VALUES (new.rowid, new.doc_id, new.category, replace(replace(new.title, 'đ', 'd'), 'Đ', 'D'), replace(replace(new.summary, 'đ', 'd'), 'Đ', 'D'), replace(replace(new.body_markdown, 'đ', 'd'), 'Đ', 'D'), replace(replace(new.tags_json, 'đ', 'd'), 'Đ', 'D'));
END;

CREATE TRIGGER IF NOT EXISTS trg_knowledge_fts_ad
AFTER DELETE ON knowledge_documents
BEGIN
  DELETE FROM knowledge_fts WHERE rowid = old.rowid;
END;

-- ----------------------------------------------------------------------------
-- T19: knowledge_change_proposals (Controlled promotion to Shared Knowledge)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS knowledge_change_proposals (
  proposal_id TEXT PRIMARY KEY,
  proposer_agent_id TEXT NOT NULL REFERENCES agents(agent_id) ON DELETE RESTRICT,
  target_relative_path TEXT NOT NULL,
  category TEXT NOT NULL
    CHECK (category IN ('company', 'architecture', 'adr', 'runbook', 'standard', 'project')),
  proposed_title TEXT NOT NULL,
  proposed_markdown TEXT NOT NULL,
  rationale TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'rejected')),
  reviewed_by_principal_id TEXT,
  reviewed_at TEXT,
  review_note TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- ----------------------------------------------------------------------------
-- T20: memory_entries (Four-Tier Memory: company, project, agent_private, task_context)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS memory_entries (
  memory_id TEXT PRIMARY KEY,
  memory_scope TEXT NOT NULL
    CHECK (memory_scope IN ('company', 'project', 'agent_private', 'task_context')),
  owner_agent_id TEXT REFERENCES agents(agent_id) ON DELETE RESTRICT,
  project_id TEXT REFERENCES projects(project_id) ON DELETE RESTRICT,
  task_id TEXT REFERENCES tasks(task_id) ON DELETE RESTRICT,
  title TEXT NOT NULL,
  content_markdown TEXT NOT NULL,
  summary TEXT NOT NULL,
  tags_json TEXT NOT NULL DEFAULT '[]',
  provenance_source TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'proposed'
    CHECK (status IN ('proposed', 'verified', 'superseded', 'stale', 'archived')),
  sensitivity TEXT NOT NULL DEFAULT 'internal'
    CHECK (sensitivity IN ('public', 'internal', 'private')),
  approved_by_principal_id TEXT,
  expires_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  CHECK (
    (memory_scope != 'agent_private' OR owner_agent_id IS NOT NULL) AND
    (memory_scope != 'project' OR project_id IS NOT NULL) AND
    (memory_scope != 'task_context' OR task_id IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_memory_scope_owner
  ON memory_entries(memory_scope, owner_agent_id, status);
CREATE INDEX IF NOT EXISTS idx_memory_project
  ON memory_entries(project_id, status);

-- ----------------------------------------------------------------------------
-- T21: agent_usage_events (Separates MCP tool activity from Model Token Usage)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS agent_usage_events (
  event_id INTEGER PRIMARY KEY AUTOINCREMENT,
  request_id TEXT,
  task_id TEXT REFERENCES tasks(task_id) ON DELETE RESTRICT,
  agent_id TEXT NOT NULL REFERENCES agents(agent_id) ON DELETE RESTRICT,
  quota_pool_id TEXT REFERENCES quota_pools(pool_id) ON DELETE RESTRICT,
  usage_category TEXT NOT NULL DEFAULT 'mcp_tool_activity'
    CHECK (usage_category IN ('mcp_tool_activity', 'model_inference_usage')),
  event_type TEXT NOT NULL,
  calls_count INTEGER NOT NULL DEFAULT 1 CHECK (calls_count >= 1),
  duration_ms INTEGER CHECK (duration_ms >= 0),
  request_bytes INTEGER CHECK (request_bytes >= 0),
  response_bytes INTEGER CHECK (response_bytes >= 0),
  input_tokens INTEGER CHECK (input_tokens >= 0),
  output_tokens INTEGER CHECK (output_tokens >= 0),
  cached_tokens INTEGER CHECK (cached_tokens >= 0),
  usage_estimate TEXT,
  source TEXT NOT NULL DEFAULT 'mcp_metered'
    CHECK (source IN ('mcp_metered', 'provider_api', 'operator_reported', 'client_estimated', 'manual')),
  confidence TEXT NOT NULL DEFAULT 'verified'
    CHECK (confidence IN ('verified', 'high', 'medium', 'low', 'unknown')),
  note TEXT,
  recorded_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  CHECK (usage_category != 'mcp_tool_activity' OR (input_tokens IS NULL AND output_tokens IS NULL AND cached_tokens IS NULL)),
  CHECK (usage_category != 'mcp_tool_activity' OR source = 'mcp_metered'),
  CHECK (usage_category != 'model_inference_usage' OR source != 'mcp_metered')
);

CREATE INDEX IF NOT EXISTS idx_usage_agent
  ON agent_usage_events(agent_id, recorded_at DESC);
CREATE INDEX IF NOT EXISTS idx_usage_pool_category
  ON agent_usage_events(quota_pool_id, usage_category, recorded_at DESC);

-- ----------------------------------------------------------------------------
-- T22: audit_events (HMAC-SHA256 Hash-Chained Security & Governance Log)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS audit_events (
  audit_id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id TEXT UNIQUE,
  request_id TEXT NOT NULL,
  source_gateway TEXT NOT NULL
    CHECK (source_gateway IN ('local', 'public', 'stdio', 'system')),
  principal_type TEXT NOT NULL
    CHECK (principal_type IN ('human', 'agent', 'service', 'unauthenticated')),
  principal_id TEXT NOT NULL,
  credential_id TEXT,
  event_category TEXT NOT NULL
    CHECK (event_category IN ('auth', 'policy', 'approval', 'credential', 'workspace', 'git', 'task', 'migration', 'system')),
  action_name TEXT NOT NULL,
  target_resource TEXT NOT NULL,
  outcome TEXT NOT NULL
    CHECK (outcome IN ('succeeded', 'denied', 'failed')),
  error_code TEXT,
  sanitized_details_json TEXT NOT NULL DEFAULT '{}',
  prev_event_hash TEXT NOT NULL,
  event_hash_sha256 TEXT,
  event_hash_hmac_sha256 TEXT NOT NULL UNIQUE,
  recorded_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_audit_time
  ON audit_events(recorded_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_principal_outcome
  ON audit_events(principal_id, outcome, recorded_at DESC);

-- Append-only guarantees for audit and task history.
CREATE TRIGGER IF NOT EXISTS trg_task_events_no_update
BEFORE UPDATE ON task_events
BEGIN
  SELECT RAISE(ABORT, 'INVARIANT_VIOLATION: task_events is append-only.');
END;

CREATE TRIGGER IF NOT EXISTS trg_task_events_no_delete
BEFORE DELETE ON task_events
BEGIN
  SELECT RAISE(ABORT, 'INVARIANT_VIOLATION: task_events is append-only.');
END;

CREATE TRIGGER IF NOT EXISTS trg_audit_events_no_update
BEFORE UPDATE ON audit_events
BEGIN
  SELECT RAISE(ABORT, 'INVARIANT_VIOLATION: audit_events is append-only.');
END;

CREATE TRIGGER IF NOT EXISTS trg_audit_events_no_delete
BEFORE DELETE ON audit_events
BEGIN
  SELECT RAISE(ABORT, 'INVARIANT_VIOLATION: audit_events is append-only.');
END;

-- Artifacts must be inserted as pending. This DDL restricts the only allowed
-- state transition to pending -> clean|blocked; the application service must
-- authenticate/authorize the scanner principal before issuing that UPDATE.
-- SQLite does not authenticate the OS process or MCP principal by itself.
CREATE TRIGGER IF NOT EXISTS trg_artifacts_must_start_pending
BEFORE INSERT ON artifacts
WHEN NEW.secret_scan_status != 'pending'
BEGIN
  SELECT RAISE(ABORT, 'INVARIANT_VIOLATION: artifacts must start with pending secret scan status.');
END;

-- Artifact metadata is immutable after registration. The only allowed update is
-- the scanner's one-way transition pending -> clean|blocked. Submission/sharing
-- must require secret_scan_status='clean'.
CREATE TRIGGER IF NOT EXISTS trg_artifacts_immutable_update
BEFORE UPDATE ON artifacts
WHEN NOT (
  OLD.secret_scan_status = 'pending' AND
  NEW.secret_scan_status IN ('clean', 'blocked') AND
  NEW.artifact_id IS OLD.artifact_id AND
  NEW.workspace_id IS OLD.workspace_id AND
  NEW.creator_agent_id IS OLD.creator_agent_id AND
  NEW.task_id IS OLD.task_id AND
  NEW.file_name IS OLD.file_name AND
  NEW.relative_path IS OLD.relative_path AND
  NEW.content_type IS OLD.content_type AND
  NEW.size_bytes IS OLD.size_bytes AND
  NEW.checksum_sha256 IS OLD.checksum_sha256 AND
  NEW.classification IS OLD.classification AND
  NEW.created_at IS OLD.created_at
)
BEGIN
  SELECT RAISE(ABORT, 'INVARIANT_VIOLATION: artifact metadata is immutable; only pending scan status may transition.');
END;

CREATE TRIGGER IF NOT EXISTS trg_artifacts_no_delete
BEFORE DELETE ON artifacts
BEGIN
  SELECT RAISE(ABORT, 'INVARIANT_VIOLATION: artifacts are immutable; use retention tombstones.');
END;
