-- AICO V3 Foundation Schema Down Migration (v0.5.0 Rollback)
-- Drops all 24 foundation tables and virtual tables in reverse dependency order.

PRAGMA foreign_keys = OFF;

-- Knowledge & Memory
DROP TABLE IF EXISTS context_snapshots;
DROP TABLE IF EXISTS knowledge_chunks_fts;
DROP TABLE IF EXISTS knowledge_chunks_meta;
DROP TABLE IF EXISTS memory_records_v3;

-- Task Orchestration & Governance
DROP TABLE IF EXISTS artifact_attestations;
DROP TABLE IF EXISTS review_assignments;
DROP TABLE IF EXISTS task_approval_bindings;
DROP TABLE IF EXISTS task_transition_logs;
DROP TABLE IF EXISTS project_tasks_v3;

-- Agent Coordination & Lifecycle
DROP TABLE IF EXISTS agent_execution_locks;
DROP TABLE IF EXISTS agent_quota_allocations;
DROP TABLE IF EXISTS agent_capabilities;
DROP TABLE IF EXISTS agent_heartbeats;
DROP TABLE IF EXISTS agent_leases;

-- Reliable Messaging & Outbox
DROP TABLE IF EXISTS delivery_attempts;
DROP TABLE IF EXISTS dead_letter_queue;
DROP TABLE IF EXISTS event_subscriptions;
DROP TABLE IF EXISTS event_outbox;

-- Core Collaboration
DROP TABLE IF EXISTS room_audit_logs;
DROP TABLE IF EXISTS room_invites;
DROP TABLE IF EXISTS message_reactions;
DROP TABLE IF EXISTS message_attachments;
DROP TABLE IF EXISTS chat_messages;
DROP TABLE IF EXISTS chat_members;
DROP TABLE IF EXISTS chat_rooms;

PRAGMA foreign_keys = ON;
