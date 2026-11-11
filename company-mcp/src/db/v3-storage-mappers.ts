import { DatabaseSync } from "node:sqlite";
import {
  AgentCapability,
  AgentCapabilitySchema,
  ChatMessage,
  ChatMessageSchema,
  ChatRoom,
  ChatRoomSchema,
  DeadLetterQueue,
  DeadLetterQueueSchema,
  EventSubscription,
  EventSubscriptionSchema,
  OutboxEvent,
  OutboxEventSchema,
  ProjectTaskV3,
  ProjectTaskV3Schema,
  RoomAuditLog,
  RoomAuditLogSchema
} from "../domain/index.js";

export interface JsonColumnMapping {
  readonly domainField: string;
  readonly dbColumn: string;
  readonly valueKind: "string_array" | "plain_object";
}

export interface BooleanColumnMapping {
  readonly domainField: string;
  readonly dbColumn: string;
}

export interface InternalColumnMapping {
  readonly domainField: string;
  readonly dbColumn: string;
  readonly dbTable?: string;
}

export interface SplitColumnMapping {
  readonly domainField: string;
  readonly dbTable: string;
  readonly dbColumn: string;
  readonly serialization: "direct" | "fts5_text";
}

export interface EntityStorageMapping {
  readonly entity: string;
  readonly group:
    | "core_collaboration"
    | "reliable_messaging"
    | "agent_coordination"
    | "task_governance"
    | "knowledge_memory";
  readonly tables: readonly string[];
  readonly primaryKey: string;
  readonly storageModel: "single_table" | "split_meta_and_fts5";
  readonly jsonColumns: readonly JsonColumnMapping[];
  readonly booleanColumns: readonly BooleanColumnMapping[];
  readonly internalColumns: readonly InternalColumnMapping[];
  readonly splitColumns?: readonly SplitColumnMapping[];
  readonly notes?: string;
}

export const V3_ENTITY_STORAGE_MAPPINGS = {
  // Group 1: Core Collaboration (7 entities)
  ChatRoom: {
    entity: "ChatRoom",
    group: "core_collaboration",
    tables: ["chat_rooms"],
    primaryKey: "room_id",
    storageModel: "single_table",
    jsonColumns: [],
    booleanColumns: [{ domainField: "is_archived", dbColumn: "is_archived" }],
    internalColumns: [{ domainField: "internal_notes", dbColumn: "internal_notes" }]
  },
  ChatMember: {
    entity: "ChatMember",
    group: "core_collaboration",
    tables: ["chat_members"],
    primaryKey: "membership_id",
    storageModel: "single_table",
    jsonColumns: [],
    booleanColumns: [],
    internalColumns: [{ domainField: "internal_cursor", dbColumn: "internal_cursor" }]
  },
  ChatMessage: {
    entity: "ChatMessage",
    group: "core_collaboration",
    tables: ["chat_messages"],
    primaryKey: "message_id",
    storageModel: "single_table",
    jsonColumns: [
      { domainField: "mentions", dbColumn: "mentions_json", valueKind: "string_array" },
      { domainField: "metadata", dbColumn: "metadata_json", valueKind: "plain_object" },
      { domainField: "internal_metadata", dbColumn: "internal_metadata_json", valueKind: "plain_object" }
    ],
    booleanColumns: [{ domainField: "is_edited", dbColumn: "is_edited" }],
    internalColumns: [
      { domainField: "internal_metadata", dbColumn: "internal_metadata_json" },
      { domainField: "raw_token_trace", dbColumn: "raw_token_trace" }
    ]
  },
  MessageAttachment: {
    entity: "MessageAttachment",
    group: "core_collaboration",
    tables: ["message_attachments"],
    primaryKey: "attachment_id",
    storageModel: "single_table",
    jsonColumns: [],
    booleanColumns: [],
    internalColumns: [{ domainField: "storage_driver_token", dbColumn: "storage_driver_token" }]
  },
  MessageReaction: {
    entity: "MessageReaction",
    group: "core_collaboration",
    tables: ["message_reactions"],
    primaryKey: "reaction_id",
    storageModel: "single_table",
    jsonColumns: [],
    booleanColumns: [],
    internalColumns: [{ domainField: "internal_client_ip", dbColumn: "internal_client_ip" }]
  },
  RoomInvite: {
    entity: "RoomInvite",
    group: "core_collaboration",
    tables: ["room_invites"],
    primaryKey: "invite_id",
    storageModel: "single_table",
    jsonColumns: [],
    booleanColumns: [],
    internalColumns: [{ domainField: "invite_token_hash", dbColumn: "invite_token_hash" }]
  },
  RoomAuditLog: {
    entity: "RoomAuditLog",
    group: "core_collaboration",
    tables: ["room_audit_logs"],
    primaryKey: "audit_id",
    storageModel: "single_table",
    jsonColumns: [
      { domainField: "details", dbColumn: "details_json", valueKind: "plain_object" },
      { domainField: "internal_details", dbColumn: "internal_details_json", valueKind: "plain_object" }
    ],
    booleanColumns: [],
    internalColumns: [
      { domainField: "internal_details", dbColumn: "internal_details_json" },
      { domainField: "security_context_snapshot", dbColumn: "security_context_snapshot" }
    ]
  },

  // Group 2: Reliable Messaging & Outbox (4 entities)
  OutboxEvent: {
    entity: "OutboxEvent",
    group: "reliable_messaging",
    tables: ["event_outbox"],
    primaryKey: "event_id",
    storageModel: "single_table",
    jsonColumns: [{ domainField: "payload", dbColumn: "payload_json", valueKind: "plain_object" }],
    booleanColumns: [],
    internalColumns: [{ domainField: "internal_routing_key", dbColumn: "internal_routing_key" }]
  },
  EventSubscription: {
    entity: "EventSubscription",
    group: "reliable_messaging",
    tables: ["event_subscriptions"],
    primaryKey: "subscription_id",
    storageModel: "single_table",
    jsonColumns: [],
    booleanColumns: [{ domainField: "is_active", dbColumn: "is_active" }],
    internalColumns: [{ domainField: "auth_secret_hash", dbColumn: "auth_secret_hash" }]
  },
  DeadLetterQueue: {
    entity: "DeadLetterQueue",
    group: "reliable_messaging",
    tables: ["dead_letter_queue"],
    primaryKey: "dlq_id",
    storageModel: "single_table",
    jsonColumns: [{ domainField: "payload", dbColumn: "payload_json", valueKind: "plain_object" }],
    booleanColumns: [{ domainField: "resolved", dbColumn: "resolved" }],
    internalColumns: [{ domainField: "stack_trace", dbColumn: "stack_trace" }]
  },
  DeliveryAttempt: {
    entity: "DeliveryAttempt",
    group: "reliable_messaging",
    tables: ["delivery_attempts"],
    primaryKey: "attempt_id",
    storageModel: "single_table",
    jsonColumns: [],
    booleanColumns: [],
    internalColumns: [{ domainField: "internal_worker_id", dbColumn: "internal_worker_id" }]
  },

  // Group 3: Agent Coordination & Lifecycle (5 entities)
  AgentLease: {
    entity: "AgentLease",
    group: "agent_coordination",
    tables: ["agent_leases"],
    primaryKey: "lease_id",
    storageModel: "single_table",
    jsonColumns: [],
    booleanColumns: [],
    internalColumns: [{ domainField: "lease_nonce", dbColumn: "lease_nonce" }]
  },
  AgentHeartbeat: {
    entity: "AgentHeartbeat",
    group: "agent_coordination",
    tables: ["agent_heartbeats"],
    primaryKey: "heartbeat_id",
    storageModel: "single_table",
    jsonColumns: [],
    booleanColumns: [],
    internalColumns: [{ domainField: "host_process_pid", dbColumn: "host_process_pid" }]
  },
  AgentCapability: {
    entity: "AgentCapability",
    group: "agent_coordination",
    tables: ["agent_capabilities"],
    primaryKey: "capability_id",
    storageModel: "single_table",
    jsonColumns: [],
    booleanColumns: [{ domainField: "is_enabled", dbColumn: "is_enabled" }],
    internalColumns: [{ domainField: "internal_evaluation_score", dbColumn: "internal_evaluation_score" }]
  },
  AgentQuotaAllocation: {
    entity: "AgentQuotaAllocation",
    group: "agent_coordination",
    tables: ["agent_quota_allocations"],
    primaryKey: "allocation_id",
    storageModel: "single_table",
    jsonColumns: [],
    booleanColumns: [],
    internalColumns: [{ domainField: "billing_account_ref", dbColumn: "billing_account_ref" }]
  },
  AgentExecutionLock: {
    entity: "AgentExecutionLock",
    group: "agent_coordination",
    tables: ["agent_execution_locks"],
    primaryKey: "lock_id",
    storageModel: "single_table",
    jsonColumns: [],
    booleanColumns: [],
    internalColumns: [{ domainField: "lock_nonce", dbColumn: "lock_nonce" }]
  },

  // Group 4: Task Orchestration & Governance (5 entities)
  ProjectTaskV3: {
    entity: "ProjectTaskV3",
    group: "task_governance",
    tables: ["project_tasks_v3"],
    primaryKey: "task_id",
    storageModel: "single_table",
    jsonColumns: [
      { domainField: "acceptance_criteria", dbColumn: "acceptance_criteria_json", valueKind: "string_array" }
    ],
    booleanColumns: [],
    internalColumns: [{ domainField: "internal_evaluation_notes", dbColumn: "internal_evaluation_notes" }]
  },
  TaskTransitionLog: {
    entity: "TaskTransitionLog",
    group: "task_governance",
    tables: ["task_transition_logs"],
    primaryKey: "transition_id",
    storageModel: "single_table",
    jsonColumns: [],
    booleanColumns: [],
    internalColumns: [{ domainField: "internal_diagnostic_payload", dbColumn: "internal_diagnostic_payload" }]
  },
  TaskApprovalBinding: {
    entity: "TaskApprovalBinding",
    group: "task_governance",
    tables: ["task_approval_bindings"],
    primaryKey: "binding_id",
    storageModel: "single_table",
    jsonColumns: [],
    booleanColumns: [],
    internalColumns: [
      { domainField: "canonical_payload_hash", dbColumn: "canonical_payload_hash" },
      { domainField: "signature_nonce", dbColumn: "signature_nonce" }
    ]
  },
  ReviewAssignment: {
    entity: "ReviewAssignment",
    group: "task_governance",
    tables: ["review_assignments"],
    primaryKey: "review_id",
    storageModel: "single_table",
    jsonColumns: [],
    booleanColumns: [],
    internalColumns: [{ domainField: "internal_reviewer_notes", dbColumn: "internal_reviewer_notes" }]
  },
  ArtifactAttestation: {
    entity: "ArtifactAttestation",
    group: "task_governance",
    tables: ["artifact_attestations"],
    primaryKey: "attestation_id",
    storageModel: "single_table",
    jsonColumns: [],
    booleanColumns: [],
    internalColumns: [
      { domainField: "verification_signature", dbColumn: "verification_signature" },
      { domainField: "internal_audit_trail", dbColumn: "internal_audit_trail" }
    ]
  },

  // Group 5: Knowledge & Memory (3 entities)
  MemoryRecordV3: {
    entity: "MemoryRecordV3",
    group: "knowledge_memory",
    tables: ["memory_records_v3"],
    primaryKey: "memory_id",
    storageModel: "single_table",
    jsonColumns: [],
    booleanColumns: [],
    internalColumns: [{ domainField: "raw_context_bytes", dbColumn: "raw_context_bytes" }]
  },
  KnowledgeChunkFTS: {
    entity: "KnowledgeChunkFTS",
    group: "knowledge_memory",
    tables: ["knowledge_chunks_meta", "knowledge_chunks_fts"],
    primaryKey: "chunk_id",
    storageModel: "split_meta_and_fts5",
    jsonColumns: [],
    booleanColumns: [],
    internalColumns: [
      {
        domainField: "embedding_vector_ref",
        dbColumn: "embedding_vector_ref",
        dbTable: "knowledge_chunks_meta"
      }
    ],
    splitColumns: [
      { domainField: "chunk_id", dbTable: "knowledge_chunks_meta", dbColumn: "chunk_id", serialization: "direct" },
      { domainField: "memory_id", dbTable: "knowledge_chunks_meta", dbColumn: "memory_id", serialization: "direct" },
      {
        domainField: "embedding_vector_ref",
        dbTable: "knowledge_chunks_meta",
        dbColumn: "embedding_vector_ref",
        serialization: "direct"
      },
      { domainField: "created_at", dbTable: "knowledge_chunks_meta", dbColumn: "created_at", serialization: "direct" },
      { domainField: "chunk_id", dbTable: "knowledge_chunks_fts", dbColumn: "chunk_id", serialization: "direct" },
      { domainField: "memory_id", dbTable: "knowledge_chunks_fts", dbColumn: "memory_id", serialization: "direct" },
      { domainField: "title", dbTable: "knowledge_chunks_fts", dbColumn: "title", serialization: "direct" },
      {
        domainField: "chunk_content",
        dbTable: "knowledge_chunks_fts",
        dbColumn: "chunk_content",
        serialization: "direct"
      },
      { domainField: "tags", dbTable: "knowledge_chunks_fts", dbColumn: "tags", serialization: "fts5_text" },
      { domainField: "created_at", dbTable: "knowledge_chunks_fts", dbColumn: "created_at", serialization: "direct" }
    ],
    notes:
      "1-to-2 split across knowledge_chunks_meta (relational FK to memory_records_v3 + internal embedding_vector_ref) and knowledge_chunks_fts (FTS5 full-text virtual table indexing title, chunk_content, and serialized tags)."
  },
  ContextSnapshot: {
    entity: "ContextSnapshot",
    group: "knowledge_memory",
    tables: ["context_snapshots"],
    primaryKey: "snapshot_id",
    storageModel: "single_table",
    jsonColumns: [],
    booleanColumns: [],
    internalColumns: [
      { domainField: "snapshot_data", dbColumn: "snapshot_data" },
      { domainField: "encryption_iv", dbColumn: "encryption_iv" }
    ]
  }
} as const satisfies Record<string, EntityStorageMapping>;

export type V3MappedEntityName = keyof typeof V3_ENTITY_STORAGE_MAPPINGS;

function parseJsonRaw(rawJson: string, fieldName: string): unknown {
  if (typeof rawJson !== "string") {
    throw new Error(`Invalid JSON string for '${fieldName}': expected string, got ${typeof rawJson}`);
  }
  try {
    return JSON.parse(rawJson);
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    throw new Error(`Invalid JSON for '${fieldName}': ${detail}`);
  }
}

/**
 * Converts a strict boolean to SQLite integer representation (0 | 1).
 */
export function booleanToSqlInt(val: boolean): 0 | 1 {
  if (typeof val !== "boolean") {
    throw new TypeError(`Invalid boolean value: expected boolean, got ${typeof val}`);
  }
  return val ? 1 : 0;
}

/**
 * Converts a SQLite integer/boolean representation strictly to boolean, failing closed on invalid values.
 */
export function sqlIntToBoolean(val: number | boolean, fieldName: string): boolean {
  if (typeof val === "boolean") {
    return val;
  }
  if (val === 1) {
    return true;
  }
  if (val === 0) {
    return false;
  }
  throw new Error(
    `Invalid SQL boolean value for '${fieldName}': expected 0, 1, or boolean, got ${String(val)}`
  );
}

/**
 * Parses a JSON-encoded string array column and fails closed if not an array of strings.
 */
export function parseJsonStringArray(rawJson: string, fieldName: string): string[] {
  const parsed = parseJsonRaw(rawJson, fieldName);
  if (!Array.isArray(parsed)) {
    throw new Error(`Invalid JSON array for '${fieldName}': expected array`);
  }
  for (let i = 0; i < parsed.length; i++) {
    if (typeof parsed[i] !== "string") {
      throw new Error(`Invalid JSON string array item for '${fieldName}[${i}]': expected string`);
    }
  }
  return parsed as string[];
}

/**
 * Parses a JSON-encoded plain object column and fails closed on null, primitives, or arrays.
 */
export function parseJsonPlainObject(rawJson: string, fieldName: string): Record<string, unknown> {
  const parsed = parseJsonRaw(rawJson, fieldName);
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`Invalid JSON object for '${fieldName}': expected plain object`);
  }
  return parsed as Record<string, unknown>;
}

// ============================================================================
// Typed SQLite Row Contracts & Bidirectional Mappers
// ============================================================================

export interface ChatRoomDbRow {
  room_id: string;
  slug: string;
  name: string;
  room_type: string;
  project_id: string | null;
  task_id: string | null;
  created_by: string;
  is_archived: number;
  internal_notes: string | null;
  created_at: string;
  updated_at: string;
}

export function toChatRoomDbRow(room: ChatRoom): ChatRoomDbRow {
  const valid = ChatRoomSchema.parse(room);
  return {
    room_id: valid.room_id,
    slug: valid.slug,
    name: valid.name,
    room_type: valid.room_type,
    project_id: valid.project_id,
    task_id: valid.task_id,
    created_by: valid.created_by,
    is_archived: booleanToSqlInt(valid.is_archived),
    internal_notes: valid.internal_notes,
    created_at: valid.created_at,
    updated_at: valid.updated_at
  };
}

export function fromChatRoomDbRow(row: ChatRoomDbRow): ChatRoom {
  return ChatRoomSchema.parse({
    room_id: row.room_id,
    slug: row.slug,
    name: row.name,
    room_type: row.room_type,
    project_id: row.project_id,
    task_id: row.task_id,
    created_by: row.created_by,
    is_archived: sqlIntToBoolean(row.is_archived, "chat_rooms.is_archived"),
    internal_notes: row.internal_notes,
    created_at: row.created_at,
    updated_at: row.updated_at
  });
}

export interface ChatMessageDbRow {
  message_id: string;
  room_id: string;
  sender_id: string;
  sender_type: string;
  message_type: string;
  content: string;
  reply_to_id: string | null;
  mentions_json: string;
  metadata_json: string;
  internal_metadata_json: string;
  raw_token_trace: string | null;
  is_edited: number;
  created_at: string;
  updated_at: string;
}

export function toChatMessageDbRow(message: ChatMessage): ChatMessageDbRow {
  const valid = ChatMessageSchema.parse(message);
  return {
    message_id: valid.message_id,
    room_id: valid.room_id,
    sender_id: valid.sender_id,
    sender_type: valid.sender_type,
    message_type: valid.message_type,
    content: valid.content,
    reply_to_id: valid.reply_to_id,
    mentions_json: JSON.stringify(valid.mentions),
    metadata_json: JSON.stringify(valid.metadata),
    internal_metadata_json: JSON.stringify(valid.internal_metadata),
    raw_token_trace: valid.raw_token_trace,
    is_edited: booleanToSqlInt(valid.is_edited),
    created_at: valid.created_at,
    updated_at: valid.updated_at
  };
}

export function fromChatMessageDbRow(row: ChatMessageDbRow): ChatMessage {
  return ChatMessageSchema.parse({
    message_id: row.message_id,
    room_id: row.room_id,
    sender_id: row.sender_id,
    sender_type: row.sender_type,
    message_type: row.message_type,
    content: row.content,
    reply_to_id: row.reply_to_id,
    mentions: parseJsonStringArray(row.mentions_json, "chat_messages.mentions_json"),
    metadata: parseJsonPlainObject(row.metadata_json, "chat_messages.metadata_json"),
    internal_metadata: parseJsonPlainObject(
      row.internal_metadata_json,
      "chat_messages.internal_metadata_json"
    ),
    raw_token_trace: row.raw_token_trace,
    is_edited: sqlIntToBoolean(row.is_edited, "chat_messages.is_edited"),
    created_at: row.created_at,
    updated_at: row.updated_at
  });
}

export interface RoomAuditLogDbRow {
  audit_id: string;
  room_id: string;
  action: string;
  actor_id: string;
  details_json: string;
  internal_details_json: string;
  security_context_snapshot: string | null;
  created_at: string;
}

export function toRoomAuditLogDbRow(log: RoomAuditLog): RoomAuditLogDbRow {
  const valid = RoomAuditLogSchema.parse(log);
  return {
    audit_id: valid.audit_id,
    room_id: valid.room_id,
    action: valid.action,
    actor_id: valid.actor_id,
    details_json: JSON.stringify(valid.details),
    internal_details_json: JSON.stringify(valid.internal_details),
    security_context_snapshot: valid.security_context_snapshot,
    created_at: valid.created_at
  };
}

export function fromRoomAuditLogDbRow(row: RoomAuditLogDbRow): RoomAuditLog {
  return RoomAuditLogSchema.parse({
    audit_id: row.audit_id,
    room_id: row.room_id,
    action: row.action,
    actor_id: row.actor_id,
    details: parseJsonPlainObject(row.details_json, "room_audit_logs.details_json"),
    internal_details: parseJsonPlainObject(
      row.internal_details_json,
      "room_audit_logs.internal_details_json"
    ),
    security_context_snapshot: row.security_context_snapshot,
    created_at: row.created_at
  });
}

export interface OutboxEventDbRow {
  event_id: string;
  aggregate_type: string;
  aggregate_id: string;
  event_type: string;
  payload_json: string;
  status: string;
  retry_count: number;
  max_retries: number;
  last_error: string | null;
  internal_routing_key: string | null;
  scheduled_for: string;
  processed_at: string | null;
  created_at: string;
}

export function toOutboxEventDbRow(event: OutboxEvent): OutboxEventDbRow {
  const valid = OutboxEventSchema.parse(event);
  return {
    event_id: valid.event_id,
    aggregate_type: valid.aggregate_type,
    aggregate_id: valid.aggregate_id,
    event_type: valid.event_type,
    payload_json: JSON.stringify(valid.payload),
    status: valid.status,
    retry_count: valid.retry_count,
    max_retries: valid.max_retries,
    last_error: valid.last_error,
    internal_routing_key: valid.internal_routing_key,
    scheduled_for: valid.scheduled_for,
    processed_at: valid.processed_at,
    created_at: valid.created_at
  };
}

export function fromOutboxEventDbRow(row: OutboxEventDbRow): OutboxEvent {
  return OutboxEventSchema.parse({
    event_id: row.event_id,
    aggregate_type: row.aggregate_type,
    aggregate_id: row.aggregate_id,
    event_type: row.event_type,
    payload: parseJsonPlainObject(row.payload_json, "event_outbox.payload_json"),
    status: row.status,
    retry_count: row.retry_count,
    max_retries: row.max_retries,
    last_error: row.last_error,
    internal_routing_key: row.internal_routing_key,
    scheduled_for: row.scheduled_for,
    processed_at: row.processed_at,
    created_at: row.created_at
  });
}

export interface EventSubscriptionDbRow {
  subscription_id: string;
  subscriber_id: string;
  event_pattern: string;
  endpoint: string;
  is_active: number;
  auth_secret_hash: string | null;
  created_at: string;
  updated_at: string;
}

export function toEventSubscriptionDbRow(sub: EventSubscription): EventSubscriptionDbRow {
  const valid = EventSubscriptionSchema.parse(sub);
  return {
    subscription_id: valid.subscription_id,
    subscriber_id: valid.subscriber_id,
    event_pattern: valid.event_pattern,
    endpoint: valid.endpoint,
    is_active: booleanToSqlInt(valid.is_active),
    auth_secret_hash: valid.auth_secret_hash,
    created_at: valid.created_at,
    updated_at: valid.updated_at
  };
}

export function fromEventSubscriptionDbRow(row: EventSubscriptionDbRow): EventSubscription {
  return EventSubscriptionSchema.parse({
    subscription_id: row.subscription_id,
    subscriber_id: row.subscriber_id,
    event_pattern: row.event_pattern,
    endpoint: row.endpoint,
    is_active: sqlIntToBoolean(row.is_active, "event_subscriptions.is_active"),
    auth_secret_hash: row.auth_secret_hash,
    created_at: row.created_at,
    updated_at: row.updated_at
  });
}

export interface DeadLetterQueueDbRow {
  dlq_id: string;
  original_event_id: string;
  event_type: string;
  payload_json: string;
  failure_reason: string;
  stack_trace: string | null;
  resolved: number;
  resolved_by: string | null;
  resolved_at: string | null;
  failed_at: string;
}

export function toDeadLetterQueueDbRow(dlq: DeadLetterQueue): DeadLetterQueueDbRow {
  const valid = DeadLetterQueueSchema.parse(dlq);
  return {
    dlq_id: valid.dlq_id,
    original_event_id: valid.original_event_id,
    event_type: valid.event_type,
    payload_json: JSON.stringify(valid.payload),
    failure_reason: valid.failure_reason,
    stack_trace: valid.stack_trace,
    resolved: booleanToSqlInt(valid.resolved),
    resolved_by: valid.resolved_by,
    resolved_at: valid.resolved_at,
    failed_at: valid.failed_at
  };
}

export function fromDeadLetterQueueDbRow(row: DeadLetterQueueDbRow): DeadLetterQueue {
  return DeadLetterQueueSchema.parse({
    dlq_id: row.dlq_id,
    original_event_id: row.original_event_id,
    event_type: row.event_type,
    payload: parseJsonPlainObject(row.payload_json, "dead_letter_queue.payload_json"),
    failure_reason: row.failure_reason,
    stack_trace: row.stack_trace,
    resolved: sqlIntToBoolean(row.resolved, "dead_letter_queue.resolved"),
    resolved_by: row.resolved_by,
    resolved_at: row.resolved_at,
    failed_at: row.failed_at
  });
}

export interface ProjectTaskV3DbRow {
  task_id: string;
  project_id: string;
  parent_task_id: string | null;
  title: string;
  objective: string;
  risk_class: string;
  priority: string;
  execution_status: string;
  dispatch_status: string;
  assigned_agent_id: string | null;
  reviewer_agent_id: string | null;
  version: number;
  token_budget: number;
  token_used: number;
  acceptance_criteria_json: string;
  internal_evaluation_notes: string | null;
  created_at: string;
  updated_at: string;
}

export function toProjectTaskV3DbRow(task: ProjectTaskV3): ProjectTaskV3DbRow {
  const valid = ProjectTaskV3Schema.parse(task);
  return {
    task_id: valid.task_id,
    project_id: valid.project_id,
    parent_task_id: valid.parent_task_id,
    title: valid.title,
    objective: valid.objective,
    risk_class: valid.risk_class,
    priority: valid.priority,
    execution_status: valid.execution_status,
    dispatch_status: valid.dispatch_status,
    assigned_agent_id: valid.assigned_agent_id,
    reviewer_agent_id: valid.reviewer_agent_id,
    version: valid.version,
    token_budget: valid.token_budget,
    token_used: valid.token_used,
    acceptance_criteria_json: JSON.stringify(valid.acceptance_criteria),
    internal_evaluation_notes: valid.internal_evaluation_notes,
    created_at: valid.created_at,
    updated_at: valid.updated_at
  };
}

export function fromProjectTaskV3DbRow(row: ProjectTaskV3DbRow): ProjectTaskV3 {
  return ProjectTaskV3Schema.parse({
    task_id: row.task_id,
    project_id: row.project_id,
    parent_task_id: row.parent_task_id,
    title: row.title,
    objective: row.objective,
    risk_class: row.risk_class,
    priority: row.priority,
    execution_status: row.execution_status,
    dispatch_status: row.dispatch_status,
    assigned_agent_id: row.assigned_agent_id,
    reviewer_agent_id: row.reviewer_agent_id,
    version: row.version,
    token_budget: row.token_budget,
    token_used: row.token_used,
    acceptance_criteria: parseJsonStringArray(
      row.acceptance_criteria_json,
      "project_tasks_v3.acceptance_criteria_json"
    ),
    internal_evaluation_notes: row.internal_evaluation_notes,
    created_at: row.created_at,
    updated_at: row.updated_at
  });
}

export interface AgentCapabilityDbRow {
  capability_id: string;
  agent_id: string;
  capability_name: string;
  version: string;
  is_enabled: number;
  proficiency: string;
  internal_evaluation_score: number | null;
  granted_at: string;
}

export function toAgentCapabilityDbRow(capability: AgentCapability): AgentCapabilityDbRow {
  const valid = AgentCapabilitySchema.parse(capability);
  return {
    capability_id: valid.capability_id,
    agent_id: valid.agent_id,
    capability_name: valid.capability_name,
    version: valid.version,
    is_enabled: booleanToSqlInt(valid.is_enabled),
    proficiency: valid.proficiency,
    internal_evaluation_score: valid.internal_evaluation_score,
    granted_at: valid.granted_at
  };
}

export function fromAgentCapabilityDbRow(row: AgentCapabilityDbRow): AgentCapability {
  return AgentCapabilitySchema.parse({
    capability_id: row.capability_id,
    agent_id: row.agent_id,
    capability_name: row.capability_name,
    version: row.version,
    is_enabled: sqlIntToBoolean(row.is_enabled, "agent_capabilities.is_enabled"),
    proficiency: row.proficiency,
    internal_evaluation_score: row.internal_evaluation_score,
    granted_at: row.granted_at
  });
}

// ============================================================================
// Synchronous node:sqlite (DatabaseSync) Persistence Helpers
// ============================================================================

export function insertChatRoom(db: DatabaseSync, room: ChatRoom): void {
  const row = toChatRoomDbRow(room);
  db.prepare(`
    INSERT INTO chat_rooms (
      room_id, slug, name, room_type, project_id, task_id,
      created_by, is_archived, internal_notes, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    row.room_id,
    row.slug,
    row.name,
    row.room_type,
    row.project_id,
    row.task_id,
    row.created_by,
    row.is_archived,
    row.internal_notes,
    row.created_at,
    row.updated_at
  );
}

export function getChatRoomById(db: DatabaseSync, roomId: string): ChatRoom | null {
  const row = db
    .prepare(`
      SELECT
        room_id, slug, name, room_type, project_id, task_id,
        created_by, is_archived, internal_notes, created_at, updated_at
      FROM chat_rooms
      WHERE room_id = ?
    `)
    .get(roomId) as ChatRoomDbRow | undefined;

  return row ? fromChatRoomDbRow(row) : null;
}

export function insertChatMessage(db: DatabaseSync, message: ChatMessage): void {
  const row = toChatMessageDbRow(message);
  db.prepare(`
    INSERT INTO chat_messages (
      message_id, room_id, sender_id, sender_type, message_type, content, reply_to_id,
      mentions_json, metadata_json, internal_metadata_json, raw_token_trace,
      is_edited, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    row.message_id,
    row.room_id,
    row.sender_id,
    row.sender_type,
    row.message_type,
    row.content,
    row.reply_to_id,
    row.mentions_json,
    row.metadata_json,
    row.internal_metadata_json,
    row.raw_token_trace,
    row.is_edited,
    row.created_at,
    row.updated_at
  );
}

export function getChatMessageById(db: DatabaseSync, messageId: string): ChatMessage | null {
  const row = db
    .prepare(`
      SELECT
        message_id, room_id, sender_id, sender_type, message_type, content, reply_to_id,
        mentions_json, metadata_json, internal_metadata_json, raw_token_trace,
        is_edited, created_at, updated_at
      FROM chat_messages
      WHERE message_id = ?
    `)
    .get(messageId) as ChatMessageDbRow | undefined;

  return row ? fromChatMessageDbRow(row) : null;
}

export function insertRoomAuditLog(db: DatabaseSync, log: RoomAuditLog): void {
  const row = toRoomAuditLogDbRow(log);
  db.prepare(`
    INSERT INTO room_audit_logs (
      audit_id, room_id, action, actor_id, details_json,
      internal_details_json, security_context_snapshot, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    row.audit_id,
    row.room_id,
    row.action,
    row.actor_id,
    row.details_json,
    row.internal_details_json,
    row.security_context_snapshot,
    row.created_at
  );
}

export function getRoomAuditLogById(db: DatabaseSync, auditId: string): RoomAuditLog | null {
  const row = db
    .prepare(`
      SELECT
        audit_id, room_id, action, actor_id, details_json,
        internal_details_json, security_context_snapshot, created_at
      FROM room_audit_logs
      WHERE audit_id = ?
    `)
    .get(auditId) as RoomAuditLogDbRow | undefined;

  return row ? fromRoomAuditLogDbRow(row) : null;
}
