-- AICO V3 Foundation Schema Migration (v0.5.0)
-- Strict G1/G2 boundaries: 24 Domain Tables & Virtual Tables
-- Foreign keys, check constraints, unique constraints, and indexes.

PRAGMA foreign_keys = ON;

-- ============================================================================
-- Group 1: Core Collaboration (7 Tables)
-- ============================================================================

CREATE TABLE IF NOT EXISTS chat_rooms (
  room_id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  room_type TEXT NOT NULL CHECK(room_type IN ('EXECUTIVE_BOARDROOM','ANNOUNCEMENTS','DEPARTMENT_OFFICE','PROJECT_ROOM','TASK_ROOM','DIRECT_MESSAGE')),
  project_id TEXT,
  task_id TEXT,
  created_by TEXT NOT NULL,
  is_archived INTEGER NOT NULL DEFAULT 0 CHECK(is_archived IN (0, 1)),
  internal_notes TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_chat_rooms_slug ON chat_rooms(slug);
CREATE INDEX IF NOT EXISTS idx_chat_rooms_type ON chat_rooms(room_type);
CREATE INDEX IF NOT EXISTS idx_chat_rooms_project ON chat_rooms(project_id);

CREATE TABLE IF NOT EXISTS chat_members (
  membership_id TEXT PRIMARY KEY,
  room_id TEXT NOT NULL REFERENCES chat_rooms(room_id) ON DELETE CASCADE,
  principal_id TEXT NOT NULL,
  principal_type TEXT NOT NULL CHECK(principal_type IN ('human','agent','system')),
  role TEXT NOT NULL DEFAULT 'member' CHECK(role IN ('owner','moderator','member','observer')),
  last_read_message_id TEXT,
  internal_cursor TEXT,
  joined_at TEXT NOT NULL,
  UNIQUE(room_id, principal_id)
);

CREATE INDEX IF NOT EXISTS idx_chat_members_room ON chat_members(room_id);
CREATE INDEX IF NOT EXISTS idx_chat_members_principal ON chat_members(principal_id);

CREATE TABLE IF NOT EXISTS chat_messages (
  message_id TEXT PRIMARY KEY,
  room_id TEXT NOT NULL REFERENCES chat_rooms(room_id) ON DELETE CASCADE,
  sender_id TEXT NOT NULL,
  sender_type TEXT NOT NULL CHECK(sender_type IN ('human','agent','system')),
  message_type TEXT NOT NULL DEFAULT 'TEXT' CHECK(message_type IN ('TEXT','DIRECTIVE','PROPOSAL','REVIEW_FEEDBACK','GATE_STATUS','SYSTEM_NOTICE')),
  content TEXT NOT NULL CHECK(length(content) > 0),
  reply_to_id TEXT REFERENCES chat_messages(message_id) ON DELETE SET NULL,
  mentions_json TEXT NOT NULL DEFAULT '[]',
  metadata_json TEXT NOT NULL DEFAULT '{}',
  raw_token_trace TEXT,
  is_edited INTEGER NOT NULL DEFAULT 0 CHECK(is_edited IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_chat_messages_room_created ON chat_messages(room_id, created_at);
CREATE INDEX IF NOT EXISTS idx_chat_messages_sender ON chat_messages(sender_id);

CREATE TABLE IF NOT EXISTS message_attachments (
  attachment_id TEXT PRIMARY KEY,
  message_id TEXT NOT NULL REFERENCES chat_messages(message_id) ON DELETE CASCADE,
  file_name TEXT NOT NULL,
  file_path TEXT NOT NULL,
  file_size_bytes INTEGER NOT NULL CHECK(file_size_bytes >= 0),
  mime_type TEXT NOT NULL,
  sha256_hash TEXT NOT NULL CHECK(length(sha256_hash) = 64),
  storage_driver_token TEXT,
  uploaded_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_msg_attachments_msg ON message_attachments(message_id);

CREATE TABLE IF NOT EXISTS message_reactions (
  reaction_id TEXT PRIMARY KEY,
  message_id TEXT NOT NULL REFERENCES chat_messages(message_id) ON DELETE CASCADE,
  principal_id TEXT NOT NULL,
  reaction_code TEXT NOT NULL CHECK(length(reaction_code) > 0),
  internal_client_ip TEXT,
  created_at TEXT NOT NULL,
  UNIQUE(message_id, principal_id, reaction_code)
);

CREATE INDEX IF NOT EXISTS idx_msg_reactions_msg ON message_reactions(message_id);

CREATE TABLE IF NOT EXISTS room_invites (
  invite_id TEXT PRIMARY KEY,
  room_id TEXT NOT NULL REFERENCES chat_rooms(room_id) ON DELETE CASCADE,
  inviter_id TEXT NOT NULL,
  invitee_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','accepted','declined','expired')),
  invite_token_hash TEXT,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_room_invites_room ON room_invites(room_id);
CREATE INDEX IF NOT EXISTS idx_room_invites_invitee ON room_invites(invitee_id);

CREATE TABLE IF NOT EXISTS room_audit_logs (
  audit_id TEXT PRIMARY KEY,
  room_id TEXT NOT NULL REFERENCES chat_rooms(room_id) ON DELETE CASCADE,
  action TEXT NOT NULL CHECK(action IN ('room_created','member_added','member_removed','role_updated','room_archived','room_restored')),
  actor_id TEXT NOT NULL,
  details_json TEXT NOT NULL DEFAULT '{}',
  security_context_snapshot TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_room_audit_room ON room_audit_logs(room_id);

-- ============================================================================
-- Group 2: Reliable Messaging & Outbox (4 Tables)
-- ============================================================================

CREATE TABLE IF NOT EXISTS event_outbox (
  event_id TEXT PRIMARY KEY,
  aggregate_type TEXT NOT NULL,
  aggregate_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','processing','published','failed','dead_letter')),
  retry_count INTEGER NOT NULL DEFAULT 0 CHECK(retry_count >= 0),
  max_retries INTEGER NOT NULL DEFAULT 5 CHECK(max_retries > 0),
  last_error TEXT,
  internal_routing_key TEXT,
  scheduled_for TEXT NOT NULL,
  processed_at TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_event_outbox_status_sched ON event_outbox(status, scheduled_for);

CREATE TABLE IF NOT EXISTS event_subscriptions (
  subscription_id TEXT PRIMARY KEY,
  subscriber_id TEXT NOT NULL,
  event_pattern TEXT NOT NULL,
  endpoint TEXT NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 1 CHECK(is_active IN (0, 1)),
  auth_secret_hash TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_event_subs_pattern ON event_subscriptions(event_pattern);

CREATE TABLE IF NOT EXISTS dead_letter_queue (
  dlq_id TEXT PRIMARY KEY,
  original_event_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  failure_reason TEXT NOT NULL,
  stack_trace TEXT,
  resolved INTEGER NOT NULL DEFAULT 0 CHECK(resolved IN (0, 1)),
  resolved_by TEXT,
  resolved_at TEXT,
  failed_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_dlq_resolved ON dead_letter_queue(resolved, failed_at);

CREATE TABLE IF NOT EXISTS delivery_attempts (
  attempt_id TEXT PRIMARY KEY,
  outbox_event_id TEXT NOT NULL REFERENCES event_outbox(event_id) ON DELETE CASCADE,
  attempt_number INTEGER NOT NULL CHECK(attempt_number > 0),
  status TEXT NOT NULL CHECK(status IN ('success','failed')),
  response_code INTEGER,
  error_message TEXT,
  internal_worker_id TEXT,
  latency_ms REAL NOT NULL CHECK(latency_ms >= 0),
  attempted_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_delivery_attempts_event ON delivery_attempts(outbox_event_id);

-- ============================================================================
-- Group 3: Agent Coordination & Lifecycle (5 Tables)
-- ============================================================================

CREATE TABLE IF NOT EXISTS agent_leases (
  lease_id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  lease_nonce TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','released','expired','revoked')),
  heartbeat_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  acquired_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_agent_leases_task ON agent_leases(task_id);
CREATE INDEX IF NOT EXISTS idx_agent_leases_agent ON agent_leases(agent_id);

CREATE TABLE IF NOT EXISTS agent_heartbeats (
  heartbeat_id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('online','busy','idle','draining','offline')),
  current_task_id TEXT,
  memory_usage_mb REAL NOT NULL CHECK(memory_usage_mb >= 0),
  cpu_percent REAL NOT NULL CHECK(cpu_percent >= 0 AND cpu_percent <= 100),
  host_process_pid INTEGER,
  recorded_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_agent_heartbeats_agent_time ON agent_heartbeats(agent_id, recorded_at);

CREATE TABLE IF NOT EXISTS agent_capabilities (
  capability_id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL,
  capability_name TEXT NOT NULL,
  version TEXT NOT NULL,
  is_enabled INTEGER NOT NULL DEFAULT 1 CHECK(is_enabled IN (0, 1)),
  proficiency TEXT NOT NULL DEFAULT 'supporting' CHECK(proficiency IN ('core','supporting','specialist')),
  internal_evaluation_score REAL,
  granted_at TEXT NOT NULL,
  UNIQUE(agent_id, capability_name, version)
);

CREATE INDEX IF NOT EXISTS idx_agent_capabilities_agent ON agent_capabilities(agent_id);

CREATE TABLE IF NOT EXISTS agent_quota_allocations (
  allocation_id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL,
  quota_pool_id TEXT NOT NULL,
  allocated_tokens INTEGER NOT NULL CHECK(allocated_tokens >= 0),
  used_tokens INTEGER NOT NULL DEFAULT 0 CHECK(used_tokens >= 0),
  daily_limit INTEGER NOT NULL CHECK(daily_limit > 0),
  billing_account_ref TEXT,
  reset_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(agent_id, quota_pool_id)
);

CREATE INDEX IF NOT EXISTS idx_agent_quota_agent ON agent_quota_allocations(agent_id);

CREATE TABLE IF NOT EXISTS agent_execution_locks (
  lock_id TEXT PRIMARY KEY,
  resource_uri TEXT NOT NULL UNIQUE,
  holder_agent_id TEXT NOT NULL,
  lock_nonce TEXT NOT NULL,
  purpose TEXT NOT NULL,
  acquired_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_agent_locks_holder ON agent_execution_locks(holder_agent_id);

-- ============================================================================
-- Group 4: Task Orchestration & Governance (5 Tables)
-- ============================================================================

CREATE TABLE IF NOT EXISTS project_tasks_v3 (
  task_id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  parent_task_id TEXT REFERENCES project_tasks_v3(task_id) ON DELETE SET NULL,
  title TEXT NOT NULL CHECK(length(title) > 0),
  objective TEXT NOT NULL CHECK(length(objective) > 0),
  risk_class TEXT NOT NULL DEFAULT 'medium' CHECK(risk_class IN ('low','medium','high','critical')),
  priority TEXT NOT NULL DEFAULT 'medium' CHECK(priority IN ('low','medium','high','critical')),
  execution_status TEXT NOT NULL DEFAULT 'draft' CHECK(execution_status IN ('draft','queued','assigned','claimed','in_progress','blocked','waiting_approval','review_required','rework','completed','failed','cancelled','archived')),
  dispatch_status TEXT NOT NULL DEFAULT 'not_dispatched' CHECK(dispatch_status IN ('not_dispatched','approval_pending','handoff_ready','queued_for_client_pull','awaiting_operator_delivery','operator_delivered','external_running','delivery_failed','result_received')),
  assigned_agent_id TEXT,
  reviewer_agent_id TEXT,
  version INTEGER NOT NULL DEFAULT 1 CHECK(version > 0),
  token_budget INTEGER NOT NULL DEFAULT 100000 CHECK(token_budget > 0),
  token_used INTEGER NOT NULL DEFAULT 0 CHECK(token_used >= 0),
  acceptance_criteria_json TEXT NOT NULL DEFAULT '[]',
  internal_evaluation_notes TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_tasks_v3_status ON project_tasks_v3(execution_status, dispatch_status);
CREATE INDEX IF NOT EXISTS idx_tasks_v3_assigned ON project_tasks_v3(assigned_agent_id);
CREATE INDEX IF NOT EXISTS idx_tasks_v3_project ON project_tasks_v3(project_id);

CREATE TABLE IF NOT EXISTS task_transition_logs (
  transition_id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES project_tasks_v3(task_id) ON DELETE CASCADE,
  transition_seq INTEGER NOT NULL CHECK(transition_seq > 0),
  from_execution_status TEXT NOT NULL,
  to_execution_status TEXT NOT NULL,
  from_dispatch_status TEXT NOT NULL,
  to_dispatch_status TEXT NOT NULL,
  transition_code TEXT NOT NULL,
  triggered_by TEXT NOT NULL,
  reason TEXT NOT NULL,
  internal_diagnostic_payload TEXT,
  created_at TEXT NOT NULL,
  UNIQUE(task_id, transition_seq)
);

CREATE INDEX IF NOT EXISTS idx_task_trans_task ON task_transition_logs(task_id);

CREATE TABLE IF NOT EXISTS task_approval_bindings (
  binding_id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES project_tasks_v3(task_id) ON DELETE CASCADE,
  approval_tier TEXT NOT NULL CHECK(approval_tier IN ('founder','technical')),
  required_role TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected','revoked')),
  approver_principal_id TEXT,
  canonical_payload_hash TEXT NOT NULL CHECK(length(canonical_payload_hash) = 64),
  signature_nonce TEXT NOT NULL,
  decision_reason TEXT,
  decided_at TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_task_approvals_task ON task_approval_bindings(task_id);
CREATE INDEX IF NOT EXISTS idx_task_approvals_status ON task_approval_bindings(status);

CREATE TABLE IF NOT EXISTS review_assignments (
  review_id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES project_tasks_v3(task_id) ON DELETE CASCADE,
  reviewer_agent_id TEXT NOT NULL,
  assigned_by TEXT NOT NULL,
  review_status TEXT NOT NULL DEFAULT 'assigned' CHECK(review_status IN ('assigned','in_review','approved','changes_requested','waived')),
  verdict TEXT CHECK(verdict IN ('pass','fail','conditional') OR verdict IS NULL),
  public_feedback TEXT,
  internal_reviewer_notes TEXT,
  created_at TEXT NOT NULL,
  completed_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_reviews_task ON review_assignments(task_id);
CREATE INDEX IF NOT EXISTS idx_reviews_reviewer ON review_assignments(reviewer_agent_id);

CREATE TABLE IF NOT EXISTS artifact_attestations (
  attestation_id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES project_tasks_v3(task_id) ON DELETE CASCADE,
  artifact_path TEXT NOT NULL,
  artifact_sha256 TEXT NOT NULL CHECK(length(artifact_sha256) = 64),
  byte_size INTEGER NOT NULL CHECK(byte_size >= 0),
  attested_by_agent_id TEXT NOT NULL,
  attestation_type TEXT NOT NULL CHECK(attestation_type IN ('source_code','test_evidence','report','database_dump','schema_migration')),
  verification_signature TEXT NOT NULL,
  internal_audit_trail TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_artifact_attest_task ON artifact_attestations(task_id);
CREATE INDEX IF NOT EXISTS idx_artifact_attest_sha ON artifact_attestations(artifact_sha256);

-- ============================================================================
-- Group 5: Knowledge & Memory (3 Tables/Virtual Tables)
-- ============================================================================

CREATE TABLE IF NOT EXISTS memory_records_v3 (
  memory_id TEXT PRIMARY KEY,
  owner_agent_id TEXT,
  scope TEXT NOT NULL DEFAULT 'COMPANY' CHECK(scope IN ('COMPANY','PROJECT','TASK','ROOM','AGENT_PRIVATE')),
  category TEXT NOT NULL DEFAULT 'FACT' CHECK(category IN ('ARCHITECTURAL_DECISION','INCIDENT_LEARNING','PERFORMANCE_PATTERN','FACT')),
  key TEXT NOT NULL,
  content TEXT NOT NULL,
  raw_context_bytes TEXT,
  access_count INTEGER NOT NULL DEFAULT 0 CHECK(access_count >= 0),
  confidence_score REAL NOT NULL DEFAULT 1.0 CHECK(confidence_score >= 0.0 AND confidence_score <= 1.0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_memory_v3_scope_key ON memory_records_v3(scope, key);
CREATE INDEX IF NOT EXISTS idx_memory_v3_category ON memory_records_v3(category);

-- Metadata table for FTS5 chunk tracking
CREATE TABLE IF NOT EXISTS knowledge_chunks_meta (
  chunk_id TEXT PRIMARY KEY,
  memory_id TEXT NOT NULL REFERENCES memory_records_v3(memory_id) ON DELETE CASCADE,
  embedding_vector_ref TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_knowledge_chunks_memory ON knowledge_chunks_meta(memory_id);

-- FTS5 Full-Text Search virtual table
CREATE VIRTUAL TABLE IF NOT EXISTS knowledge_chunks_fts USING fts5(
  chunk_id UNINDEXED,
  memory_id UNINDEXED,
  title,
  chunk_content,
  tags,
  created_at UNINDEXED
);

CREATE TABLE IF NOT EXISTS context_snapshots (
  snapshot_id TEXT PRIMARY KEY,
  task_id TEXT REFERENCES project_tasks_v3(task_id) ON DELETE SET NULL,
  agent_id TEXT NOT NULL,
  summary TEXT NOT NULL,
  token_count INTEGER NOT NULL DEFAULT 0 CHECK(token_count >= 0),
  snapshot_data TEXT NOT NULL,
  encryption_iv TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_snapshots_agent ON context_snapshots(agent_id);
CREATE INDEX IF NOT EXISTS idx_snapshots_task ON context_snapshots(task_id);
