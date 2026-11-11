import { DatabaseSync, SQLInputValue } from "node:sqlite";
import {
  AgentCapability,
  AgentCapabilitySchema,
  AgentExecutionLock,
  AgentExecutionLockSchema,
  AgentHeartbeat,
  AgentHeartbeatSchema,
  AgentLease,
  AgentLeaseSchema,
  AgentQuotaAllocation,
  AgentQuotaAllocationSchema,
  ArtifactAttestation,
  ArtifactAttestationSchema,
  ChatMember,
  ChatMemberSchema,
  ChatMessage,
  ChatMessageSchema,
  ChatRoom,
  ChatRoomSchema,
  ContextSnapshot,
  ContextSnapshotSchema,
  DeadLetterQueue,
  DeadLetterQueueSchema,
  DeliveryAttempt,
  DeliveryAttemptSchema,
  EventSubscription,
  EventSubscriptionSchema,
  KnowledgeChunkFTS,
  KnowledgeChunkFTSSchema,
  MemoryRecordV3,
  MemoryRecordV3Schema,
  MessageAttachment,
  MessageAttachmentSchema,
  MessageReaction,
  MessageReactionSchema,
  OutboxEvent,
  OutboxEventSchema,
  ProjectTaskV3,
  ProjectTaskV3Schema,
  ReviewAssignment,
  ReviewAssignmentSchema,
  RoomAuditLog,
  RoomAuditLogSchema,
  RoomInvite,
  RoomInviteSchema,
  TaskApprovalBinding,
  TaskApprovalBindingSchema,
  TaskTransitionLog,
  TaskTransitionLogSchema
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
      {
        domainField: "tags",
        dbTable: "knowledge_chunks_fts",
        dbColumn: "tags",
        serialization: "fts5_text"
      },
      { domainField: "created_at", dbTable: "knowledge_chunks_fts", dbColumn: "created_at", serialization: "direct" }
    ],
    notes:
      "1-to-2 split across knowledge_chunks_meta (relational FK to memory_records_v3 + internal embedding_vector_ref) and knowledge_chunks_fts (FTS5 full-text virtual table indexing title, chunk_content, and JSON-encoded tags for lossless round-trip)."
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
// Typed SQLite Row Contracts & Bidirectional Mappers (All 24 Entities)
// ============================================================================

// 1. ChatRoom
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

// 2. ChatMember
export interface ChatMemberDbRow {
  membership_id: string;
  room_id: string;
  principal_id: string;
  principal_type: string;
  role: string;
  last_read_message_id: string | null;
  internal_cursor: string | null;
  joined_at: string;
}

export function toChatMemberDbRow(member: ChatMember): ChatMemberDbRow {
  return ChatMemberSchema.parse(member);
}

export function fromChatMemberDbRow(row: ChatMemberDbRow): ChatMember {
  return ChatMemberSchema.parse(row);
}

// 3. ChatMessage
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

// 4. MessageAttachment
export interface MessageAttachmentDbRow {
  attachment_id: string;
  message_id: string;
  file_name: string;
  file_path: string;
  file_size_bytes: number;
  mime_type: string;
  sha256_hash: string;
  storage_driver_token: string | null;
  uploaded_at: string;
}

export function toMessageAttachmentDbRow(attachment: MessageAttachment): MessageAttachmentDbRow {
  return MessageAttachmentSchema.parse(attachment);
}

export function fromMessageAttachmentDbRow(row: MessageAttachmentDbRow): MessageAttachment {
  return MessageAttachmentSchema.parse(row);
}

// 5. MessageReaction
export interface MessageReactionDbRow {
  reaction_id: string;
  message_id: string;
  principal_id: string;
  reaction_code: string;
  internal_client_ip: string | null;
  created_at: string;
}

export function toMessageReactionDbRow(reaction: MessageReaction): MessageReactionDbRow {
  return MessageReactionSchema.parse(reaction);
}

export function fromMessageReactionDbRow(row: MessageReactionDbRow): MessageReaction {
  return MessageReactionSchema.parse(row);
}

// 6. RoomInvite
export interface RoomInviteDbRow {
  invite_id: string;
  room_id: string;
  inviter_id: string;
  invitee_id: string;
  status: string;
  invite_token_hash: string | null;
  expires_at: string;
  created_at: string;
}

export function toRoomInviteDbRow(invite: RoomInvite): RoomInviteDbRow {
  return RoomInviteSchema.parse(invite);
}

export function fromRoomInviteDbRow(row: RoomInviteDbRow): RoomInvite {
  return RoomInviteSchema.parse(row);
}

// 7. RoomAuditLog
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

// 8. OutboxEvent
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

// 9. EventSubscription
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

// 10. DeadLetterQueue
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

// 11. DeliveryAttempt
export interface DeliveryAttemptDbRow {
  attempt_id: string;
  outbox_event_id: string;
  attempt_number: number;
  status: string;
  response_code: number | null;
  error_message: string | null;
  internal_worker_id: string | null;
  latency_ms: number;
  attempted_at: string;
}

export function toDeliveryAttemptDbRow(attempt: DeliveryAttempt): DeliveryAttemptDbRow {
  return DeliveryAttemptSchema.parse(attempt);
}

export function fromDeliveryAttemptDbRow(row: DeliveryAttemptDbRow): DeliveryAttempt {
  return DeliveryAttemptSchema.parse(row);
}

// 12. AgentLease
export interface AgentLeaseDbRow {
  lease_id: string;
  task_id: string;
  agent_id: string;
  lease_nonce: string;
  status: string;
  heartbeat_at: string;
  expires_at: string;
  acquired_at: string;
}

export function toAgentLeaseDbRow(lease: AgentLease): AgentLeaseDbRow {
  return AgentLeaseSchema.parse(lease);
}

export function fromAgentLeaseDbRow(row: AgentLeaseDbRow): AgentLease {
  return AgentLeaseSchema.parse(row);
}

// 13. AgentHeartbeat
export interface AgentHeartbeatDbRow {
  heartbeat_id: string;
  agent_id: string;
  status: string;
  current_task_id: string | null;
  memory_usage_mb: number;
  cpu_percent: number;
  host_process_pid: number | null;
  recorded_at: string;
}

export function toAgentHeartbeatDbRow(heartbeat: AgentHeartbeat): AgentHeartbeatDbRow {
  return AgentHeartbeatSchema.parse(heartbeat);
}

export function fromAgentHeartbeatDbRow(row: AgentHeartbeatDbRow): AgentHeartbeat {
  return AgentHeartbeatSchema.parse(row);
}

// 14. AgentCapability
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

// 15. AgentQuotaAllocation
export interface AgentQuotaAllocationDbRow {
  allocation_id: string;
  agent_id: string;
  quota_pool_id: string;
  allocated_tokens: number;
  used_tokens: number;
  daily_limit: number;
  billing_account_ref: string | null;
  reset_at: string;
  updated_at: string;
}

export function toAgentQuotaAllocationDbRow(
  allocation: AgentQuotaAllocation
): AgentQuotaAllocationDbRow {
  return AgentQuotaAllocationSchema.parse(allocation);
}

export function fromAgentQuotaAllocationDbRow(
  row: AgentQuotaAllocationDbRow
): AgentQuotaAllocation {
  return AgentQuotaAllocationSchema.parse(row);
}

// 16. AgentExecutionLock
export interface AgentExecutionLockDbRow {
  lock_id: string;
  resource_uri: string;
  holder_agent_id: string;
  lock_nonce: string;
  purpose: string;
  acquired_at: string;
  expires_at: string;
}

export function toAgentExecutionLockDbRow(lock: AgentExecutionLock): AgentExecutionLockDbRow {
  return AgentExecutionLockSchema.parse(lock);
}

export function fromAgentExecutionLockDbRow(row: AgentExecutionLockDbRow): AgentExecutionLock {
  return AgentExecutionLockSchema.parse(row);
}

// 17. ProjectTaskV3
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

// 18. TaskTransitionLog
export interface TaskTransitionLogDbRow {
  transition_id: string;
  task_id: string;
  transition_seq: number;
  from_execution_status: string;
  to_execution_status: string;
  from_dispatch_status: string;
  to_dispatch_status: string;
  transition_code: string;
  triggered_by: string;
  reason: string;
  internal_diagnostic_payload: string | null;
  created_at: string;
}

export function toTaskTransitionLogDbRow(log: TaskTransitionLog): TaskTransitionLogDbRow {
  return TaskTransitionLogSchema.parse(log);
}

export function fromTaskTransitionLogDbRow(row: TaskTransitionLogDbRow): TaskTransitionLog {
  return TaskTransitionLogSchema.parse(row);
}

// 19. TaskApprovalBinding
export interface TaskApprovalBindingDbRow {
  binding_id: string;
  task_id: string;
  approval_tier: string;
  required_role: string;
  status: string;
  approver_principal_id: string | null;
  canonical_payload_hash: string;
  signature_nonce: string;
  decision_reason: string | null;
  decided_at: string | null;
  created_at: string;
}

export function toTaskApprovalBindingDbRow(
  binding: TaskApprovalBinding
): TaskApprovalBindingDbRow {
  return TaskApprovalBindingSchema.parse(binding);
}

export function fromTaskApprovalBindingDbRow(
  row: TaskApprovalBindingDbRow
): TaskApprovalBinding {
  return TaskApprovalBindingSchema.parse(row);
}

// 20. ReviewAssignment
export interface ReviewAssignmentDbRow {
  review_id: string;
  task_id: string;
  reviewer_agent_id: string;
  assigned_by: string;
  review_status: string;
  verdict: string | null;
  public_feedback: string | null;
  internal_reviewer_notes: string | null;
  created_at: string;
  completed_at: string | null;
}

export function toReviewAssignmentDbRow(review: ReviewAssignment): ReviewAssignmentDbRow {
  return ReviewAssignmentSchema.parse(review);
}

export function fromReviewAssignmentDbRow(row: ReviewAssignmentDbRow): ReviewAssignment {
  return ReviewAssignmentSchema.parse(row);
}

// 21. ArtifactAttestation
export interface ArtifactAttestationDbRow {
  attestation_id: string;
  task_id: string;
  artifact_path: string;
  artifact_sha256: string;
  byte_size: number;
  attested_by_agent_id: string;
  attestation_type: string;
  verification_signature: string;
  internal_audit_trail: string | null;
  created_at: string;
}

export function toArtifactAttestationDbRow(
  attestation: ArtifactAttestation
): ArtifactAttestationDbRow {
  return ArtifactAttestationSchema.parse(attestation);
}

export function fromArtifactAttestationDbRow(
  row: ArtifactAttestationDbRow
): ArtifactAttestation {
  return ArtifactAttestationSchema.parse(row);
}

// 22. MemoryRecordV3
export interface MemoryRecordV3DbRow {
  memory_id: string;
  owner_agent_id: string | null;
  scope: string;
  category: string;
  key: string;
  content: string;
  raw_context_bytes: string | null;
  access_count: number;
  confidence_score: number;
  created_at: string;
  updated_at: string;
}

export function toMemoryRecordV3DbRow(memory: MemoryRecordV3): MemoryRecordV3DbRow {
  return MemoryRecordV3Schema.parse(memory);
}

export function fromMemoryRecordV3DbRow(row: MemoryRecordV3DbRow): MemoryRecordV3 {
  return MemoryRecordV3Schema.parse(row);
}

// 23. KnowledgeChunkFTS (1-to-2 split across knowledge_chunks_meta + knowledge_chunks_fts)
export interface KnowledgeChunkMetaDbRow {
  chunk_id: string;
  memory_id: string;
  embedding_vector_ref: string | null;
  created_at: string;
}

export interface KnowledgeChunkFtsDbRow {
  chunk_id: string;
  memory_id: string;
  title: string;
  chunk_content: string;
  tags: string;
  created_at: string;
}

export interface KnowledgeChunkFTSDbRow {
  meta: KnowledgeChunkMetaDbRow;
  fts: KnowledgeChunkFtsDbRow;
}

export function toKnowledgeChunkFTSDbRow(chunk: KnowledgeChunkFTS): KnowledgeChunkFTSDbRow {
  const valid = KnowledgeChunkFTSSchema.parse(chunk);
  return {
    meta: {
      chunk_id: valid.chunk_id,
      memory_id: valid.memory_id,
      embedding_vector_ref: valid.embedding_vector_ref,
      created_at: valid.created_at
    },
    fts: {
      chunk_id: valid.chunk_id,
      memory_id: valid.memory_id,
      title: valid.title,
      chunk_content: valid.chunk_content,
      tags: JSON.stringify(valid.tags),
      created_at: valid.created_at
    }
  };
}

export function fromKnowledgeChunkFTSDbRow(row: KnowledgeChunkFTSDbRow): KnowledgeChunkFTS {
  if (row.meta.chunk_id !== row.fts.chunk_id) {
    throw new Error(
      `KnowledgeChunkFTS integrity violation: chunk_id mismatch ('${row.meta.chunk_id}' vs '${row.fts.chunk_id}')`
    );
  }
  if (row.meta.memory_id !== row.fts.memory_id) {
    throw new Error(
      `KnowledgeChunkFTS integrity violation for '${row.meta.chunk_id}': memory_id mismatch ('${row.meta.memory_id}' vs '${row.fts.memory_id}')`
    );
  }
  if (row.meta.created_at !== row.fts.created_at) {
    throw new Error(
      `KnowledgeChunkFTS integrity violation for '${row.meta.chunk_id}': created_at mismatch ('${row.meta.created_at}' vs '${row.fts.created_at}')`
    );
  }
  return KnowledgeChunkFTSSchema.parse({
    chunk_id: row.meta.chunk_id,
    memory_id: row.meta.memory_id,
    title: row.fts.title,
    chunk_content: row.fts.chunk_content,
    tags: parseJsonStringArray(row.fts.tags, "knowledge_chunks_fts.tags"),
    embedding_vector_ref: row.meta.embedding_vector_ref,
    created_at: row.meta.created_at
  });
}

// 24. ContextSnapshot
export interface ContextSnapshotDbRow {
  snapshot_id: string;
  task_id: string | null;
  agent_id: string;
  summary: string;
  token_count: number;
  snapshot_data: string;
  encryption_iv: string | null;
  created_at: string;
}

export function toContextSnapshotDbRow(snapshot: ContextSnapshot): ContextSnapshotDbRow {
  return ContextSnapshotSchema.parse(snapshot);
}

export function fromContextSnapshotDbRow(row: ContextSnapshotDbRow): ContextSnapshot {
  return ContextSnapshotSchema.parse(row);
}

// ============================================================================
// DRY Single-Table SQL Persistence Helpers & Identifier Validation
// ============================================================================

const SQL_IDENT_REGEX = /^[a-z][a-z0-9_]*$/;
let savepointSeq = 0;

function assertValidSqlIdentifier(identifier: string, context: string): void {
  if (!SQL_IDENT_REGEX.test(identifier)) {
    throw new Error(`Invalid SQL identifier '${identifier}' in ${context}`);
  }
}

interface TableSqlSpec<TRow extends object> {
  readonly table: string;
  readonly primaryKey: string;
  readonly columns: readonly (keyof TRow & string)[];
}

function validateTableSqlSpec<TRow extends object>(spec: TableSqlSpec<TRow>): void {
  assertValidSqlIdentifier(spec.table, "table name");
  assertValidSqlIdentifier(spec.primaryKey, `primaryKey for '${spec.table}'`);
  if (spec.columns.length === 0) {
    throw new Error(`Empty column list for table '${spec.table}'`);
  }
  const seen = new Set<string>();
  for (const col of spec.columns) {
    assertValidSqlIdentifier(col, `column for '${spec.table}'`);
    if (seen.has(col)) {
      throw new Error(`Duplicate column '${col}' in table spec for '${spec.table}'`);
    }
    seen.add(col);
  }
  if (!seen.has(spec.primaryKey)) {
    throw new Error(`Primary key '${spec.primaryKey}' missing from columns for '${spec.table}'`);
  }
}

function insertSingleTableRowRaw<TRow extends object>(
  db: DatabaseSync,
  spec: TableSqlSpec<TRow>,
  row: TRow
): void {
  const columnList = spec.columns.join(", ");
  const placeholders = spec.columns.map(() => "?").join(", ");
  const sql = `INSERT INTO ${spec.table} (${columnList}) VALUES (${placeholders})`;
  const record = row as Record<string, unknown>;
  const values: SQLInputValue[] = spec.columns.map((col) => {
    const val = record[col];
    if (val === undefined) {
      throw new Error(`Missing SQL column value for '${spec.table}.${col}'`);
    }
    if (val !== null && typeof val !== "string" && typeof val !== "number") {
      throw new Error(
        `Unsupported SQL column value type for '${spec.table}.${col}': ${typeof val}`
      );
    }
    return val;
  });
  db.prepare(sql).run(...values);
}

function getSingleTableRowsRawById<TRow extends object>(
  db: DatabaseSync,
  spec: TableSqlSpec<TRow>,
  id: string
): TRow[] {
  const columnList = spec.columns.join(", ");
  const sql = `SELECT ${columnList} FROM ${spec.table} WHERE ${spec.primaryKey} = ?`;
  return db.prepare(sql).all(id) as TRow[];
}

function getSingleTableRowRawById<TRow extends object>(
  db: DatabaseSync,
  spec: TableSqlSpec<TRow>,
  id: string
): TRow | null {
  const columnList = spec.columns.join(", ");
  const sql = `SELECT ${columnList} FROM ${spec.table} WHERE ${spec.primaryKey} = ?`;
  const row = db.prepare(sql).get(id) as TRow | undefined;
  return row ?? null;
}

interface SingleTablePersistenceSpec<TEntity, TRow extends object> extends TableSqlSpec<TRow> {
  readonly toDbRow: (entity: TEntity) => TRow;
  readonly fromDbRow: (row: TRow) => TEntity;
}

function insertSingleTableRow<TEntity, TRow extends object>(
  db: DatabaseSync,
  spec: SingleTablePersistenceSpec<TEntity, TRow>,
  entity: TEntity
): void {
  const row = spec.toDbRow(entity);
  insertSingleTableRowRaw(db, spec, row);
}

function getSingleTableRowById<TEntity, TRow extends object>(
  db: DatabaseSync,
  spec: SingleTablePersistenceSpec<TEntity, TRow>,
  id: string
): TEntity | null {
  const row = getSingleTableRowRawById(db, spec, id);
  return row ? spec.fromDbRow(row) : null;
}

export interface EntityPersistenceAdapter<TEntity, TRow> {
  readonly mapping: EntityStorageMapping;
  readonly toDbRow: (entity: TEntity) => TRow;
  readonly fromDbRow: (row: TRow) => TEntity;
  readonly insert: (db: DatabaseSync, entity: TEntity) => void;
  readonly getById: (db: DatabaseSync, id: string) => TEntity | null;
}

function createSingleTableAdapter<TEntity, TRow extends object>(
  mapping: EntityStorageMapping,
  spec: SingleTablePersistenceSpec<TEntity, TRow>
): EntityPersistenceAdapter<TEntity, TRow> {
  validateTableSqlSpec(spec);
  if (mapping.tables.length !== 1 || mapping.tables[0] !== spec.table) {
    throw new Error(
      `Mapping table mismatch for '${mapping.entity}': expected '${mapping.tables.join(",")}', got '${spec.table}'`
    );
  }
  if (mapping.primaryKey !== spec.primaryKey) {
    throw new Error(
      `Mapping primaryKey mismatch for '${mapping.entity}': expected '${mapping.primaryKey}', got '${spec.primaryKey}'`
    );
  }
  return {
    mapping,
    toDbRow: spec.toDbRow,
    fromDbRow: spec.fromDbRow,
    insert: (db, entity) => insertSingleTableRow(db, spec, entity),
    getById: (db, id) => getSingleTableRowById(db, spec, id)
  };
}

// ============================================================================
// Single-Table Adapters + KnowledgeChunkFTS Split-Table Adapter
// ============================================================================

const chatRoomAdapter = createSingleTableAdapter<ChatRoom, ChatRoomDbRow>(
  V3_ENTITY_STORAGE_MAPPINGS.ChatRoom,
  {
    table: "chat_rooms",
    primaryKey: "room_id",
    columns: [
      "room_id",
      "slug",
      "name",
      "room_type",
      "project_id",
      "task_id",
      "created_by",
      "is_archived",
      "internal_notes",
      "created_at",
      "updated_at"
    ],
    toDbRow: toChatRoomDbRow,
    fromDbRow: fromChatRoomDbRow
  }
);

const chatMemberAdapter = createSingleTableAdapter<ChatMember, ChatMemberDbRow>(
  V3_ENTITY_STORAGE_MAPPINGS.ChatMember,
  {
    table: "chat_members",
    primaryKey: "membership_id",
    columns: [
      "membership_id",
      "room_id",
      "principal_id",
      "principal_type",
      "role",
      "last_read_message_id",
      "internal_cursor",
      "joined_at"
    ],
    toDbRow: toChatMemberDbRow,
    fromDbRow: fromChatMemberDbRow
  }
);

const chatMessageAdapter = createSingleTableAdapter<ChatMessage, ChatMessageDbRow>(
  V3_ENTITY_STORAGE_MAPPINGS.ChatMessage,
  {
    table: "chat_messages",
    primaryKey: "message_id",
    columns: [
      "message_id",
      "room_id",
      "sender_id",
      "sender_type",
      "message_type",
      "content",
      "reply_to_id",
      "mentions_json",
      "metadata_json",
      "internal_metadata_json",
      "raw_token_trace",
      "is_edited",
      "created_at",
      "updated_at"
    ],
    toDbRow: toChatMessageDbRow,
    fromDbRow: fromChatMessageDbRow
  }
);

const messageAttachmentAdapter = createSingleTableAdapter<
  MessageAttachment,
  MessageAttachmentDbRow
>(V3_ENTITY_STORAGE_MAPPINGS.MessageAttachment, {
  table: "message_attachments",
  primaryKey: "attachment_id",
  columns: [
    "attachment_id",
    "message_id",
    "file_name",
    "file_path",
    "file_size_bytes",
    "mime_type",
    "sha256_hash",
    "storage_driver_token",
    "uploaded_at"
  ],
  toDbRow: toMessageAttachmentDbRow,
  fromDbRow: fromMessageAttachmentDbRow
});

const messageReactionAdapter = createSingleTableAdapter<MessageReaction, MessageReactionDbRow>(
  V3_ENTITY_STORAGE_MAPPINGS.MessageReaction,
  {
    table: "message_reactions",
    primaryKey: "reaction_id",
    columns: [
      "reaction_id",
      "message_id",
      "principal_id",
      "reaction_code",
      "internal_client_ip",
      "created_at"
    ],
    toDbRow: toMessageReactionDbRow,
    fromDbRow: fromMessageReactionDbRow
  }
);

const roomInviteAdapter = createSingleTableAdapter<RoomInvite, RoomInviteDbRow>(
  V3_ENTITY_STORAGE_MAPPINGS.RoomInvite,
  {
    table: "room_invites",
    primaryKey: "invite_id",
    columns: [
      "invite_id",
      "room_id",
      "inviter_id",
      "invitee_id",
      "status",
      "invite_token_hash",
      "expires_at",
      "created_at"
    ],
    toDbRow: toRoomInviteDbRow,
    fromDbRow: fromRoomInviteDbRow
  }
);

const roomAuditLogAdapter = createSingleTableAdapter<RoomAuditLog, RoomAuditLogDbRow>(
  V3_ENTITY_STORAGE_MAPPINGS.RoomAuditLog,
  {
    table: "room_audit_logs",
    primaryKey: "audit_id",
    columns: [
      "audit_id",
      "room_id",
      "action",
      "actor_id",
      "details_json",
      "internal_details_json",
      "security_context_snapshot",
      "created_at"
    ],
    toDbRow: toRoomAuditLogDbRow,
    fromDbRow: fromRoomAuditLogDbRow
  }
);

const outboxEventAdapter = createSingleTableAdapter<OutboxEvent, OutboxEventDbRow>(
  V3_ENTITY_STORAGE_MAPPINGS.OutboxEvent,
  {
    table: "event_outbox",
    primaryKey: "event_id",
    columns: [
      "event_id",
      "aggregate_type",
      "aggregate_id",
      "event_type",
      "payload_json",
      "status",
      "retry_count",
      "max_retries",
      "last_error",
      "internal_routing_key",
      "scheduled_for",
      "processed_at",
      "created_at"
    ],
    toDbRow: toOutboxEventDbRow,
    fromDbRow: fromOutboxEventDbRow
  }
);

const eventSubscriptionAdapter = createSingleTableAdapter<
  EventSubscription,
  EventSubscriptionDbRow
>(V3_ENTITY_STORAGE_MAPPINGS.EventSubscription, {
  table: "event_subscriptions",
  primaryKey: "subscription_id",
  columns: [
    "subscription_id",
    "subscriber_id",
    "event_pattern",
    "endpoint",
    "is_active",
    "auth_secret_hash",
    "created_at",
    "updated_at"
  ],
  toDbRow: toEventSubscriptionDbRow,
  fromDbRow: fromEventSubscriptionDbRow
});

const deadLetterQueueAdapter = createSingleTableAdapter<DeadLetterQueue, DeadLetterQueueDbRow>(
  V3_ENTITY_STORAGE_MAPPINGS.DeadLetterQueue,
  {
    table: "dead_letter_queue",
    primaryKey: "dlq_id",
    columns: [
      "dlq_id",
      "original_event_id",
      "event_type",
      "payload_json",
      "failure_reason",
      "stack_trace",
      "resolved",
      "resolved_by",
      "resolved_at",
      "failed_at"
    ],
    toDbRow: toDeadLetterQueueDbRow,
    fromDbRow: fromDeadLetterQueueDbRow
  }
);

const deliveryAttemptAdapter = createSingleTableAdapter<DeliveryAttempt, DeliveryAttemptDbRow>(
  V3_ENTITY_STORAGE_MAPPINGS.DeliveryAttempt,
  {
    table: "delivery_attempts",
    primaryKey: "attempt_id",
    columns: [
      "attempt_id",
      "outbox_event_id",
      "attempt_number",
      "status",
      "response_code",
      "error_message",
      "internal_worker_id",
      "latency_ms",
      "attempted_at"
    ],
    toDbRow: toDeliveryAttemptDbRow,
    fromDbRow: fromDeliveryAttemptDbRow
  }
);

const agentLeaseAdapter = createSingleTableAdapter<AgentLease, AgentLeaseDbRow>(
  V3_ENTITY_STORAGE_MAPPINGS.AgentLease,
  {
    table: "agent_leases",
    primaryKey: "lease_id",
    columns: [
      "lease_id",
      "task_id",
      "agent_id",
      "lease_nonce",
      "status",
      "heartbeat_at",
      "expires_at",
      "acquired_at"
    ],
    toDbRow: toAgentLeaseDbRow,
    fromDbRow: fromAgentLeaseDbRow
  }
);

const agentHeartbeatAdapter = createSingleTableAdapter<AgentHeartbeat, AgentHeartbeatDbRow>(
  V3_ENTITY_STORAGE_MAPPINGS.AgentHeartbeat,
  {
    table: "agent_heartbeats",
    primaryKey: "heartbeat_id",
    columns: [
      "heartbeat_id",
      "agent_id",
      "status",
      "current_task_id",
      "memory_usage_mb",
      "cpu_percent",
      "host_process_pid",
      "recorded_at"
    ],
    toDbRow: toAgentHeartbeatDbRow,
    fromDbRow: fromAgentHeartbeatDbRow
  }
);

const agentCapabilityAdapter = createSingleTableAdapter<AgentCapability, AgentCapabilityDbRow>(
  V3_ENTITY_STORAGE_MAPPINGS.AgentCapability,
  {
    table: "agent_capabilities",
    primaryKey: "capability_id",
    columns: [
      "capability_id",
      "agent_id",
      "capability_name",
      "version",
      "is_enabled",
      "proficiency",
      "internal_evaluation_score",
      "granted_at"
    ],
    toDbRow: toAgentCapabilityDbRow,
    fromDbRow: fromAgentCapabilityDbRow
  }
);

const agentQuotaAllocationAdapter = createSingleTableAdapter<
  AgentQuotaAllocation,
  AgentQuotaAllocationDbRow
>(V3_ENTITY_STORAGE_MAPPINGS.AgentQuotaAllocation, {
  table: "agent_quota_allocations",
  primaryKey: "allocation_id",
  columns: [
    "allocation_id",
    "agent_id",
    "quota_pool_id",
    "allocated_tokens",
    "used_tokens",
    "daily_limit",
    "billing_account_ref",
    "reset_at",
    "updated_at"
  ],
  toDbRow: toAgentQuotaAllocationDbRow,
  fromDbRow: fromAgentQuotaAllocationDbRow
});

const agentExecutionLockAdapter = createSingleTableAdapter<
  AgentExecutionLock,
  AgentExecutionLockDbRow
>(V3_ENTITY_STORAGE_MAPPINGS.AgentExecutionLock, {
  table: "agent_execution_locks",
  primaryKey: "lock_id",
  columns: [
    "lock_id",
    "resource_uri",
    "holder_agent_id",
    "lock_nonce",
    "purpose",
    "acquired_at",
    "expires_at"
  ],
  toDbRow: toAgentExecutionLockDbRow,
  fromDbRow: fromAgentExecutionLockDbRow
});

const projectTaskV3Adapter = createSingleTableAdapter<ProjectTaskV3, ProjectTaskV3DbRow>(
  V3_ENTITY_STORAGE_MAPPINGS.ProjectTaskV3,
  {
    table: "project_tasks_v3",
    primaryKey: "task_id",
    columns: [
      "task_id",
      "project_id",
      "parent_task_id",
      "title",
      "objective",
      "risk_class",
      "priority",
      "execution_status",
      "dispatch_status",
      "assigned_agent_id",
      "reviewer_agent_id",
      "version",
      "token_budget",
      "token_used",
      "acceptance_criteria_json",
      "internal_evaluation_notes",
      "created_at",
      "updated_at"
    ],
    toDbRow: toProjectTaskV3DbRow,
    fromDbRow: fromProjectTaskV3DbRow
  }
);

const taskTransitionLogAdapter = createSingleTableAdapter<
  TaskTransitionLog,
  TaskTransitionLogDbRow
>(V3_ENTITY_STORAGE_MAPPINGS.TaskTransitionLog, {
  table: "task_transition_logs",
  primaryKey: "transition_id",
  columns: [
    "transition_id",
    "task_id",
    "transition_seq",
    "from_execution_status",
    "to_execution_status",
    "from_dispatch_status",
    "to_dispatch_status",
    "transition_code",
    "triggered_by",
    "reason",
    "internal_diagnostic_payload",
    "created_at"
  ],
  toDbRow: toTaskTransitionLogDbRow,
  fromDbRow: fromTaskTransitionLogDbRow
});

const taskApprovalBindingAdapter = createSingleTableAdapter<
  TaskApprovalBinding,
  TaskApprovalBindingDbRow
>(V3_ENTITY_STORAGE_MAPPINGS.TaskApprovalBinding, {
  table: "task_approval_bindings",
  primaryKey: "binding_id",
  columns: [
    "binding_id",
    "task_id",
    "approval_tier",
    "required_role",
    "status",
    "approver_principal_id",
    "canonical_payload_hash",
    "signature_nonce",
    "decision_reason",
    "decided_at",
    "created_at"
  ],
  toDbRow: toTaskApprovalBindingDbRow,
  fromDbRow: fromTaskApprovalBindingDbRow
});

const reviewAssignmentAdapter = createSingleTableAdapter<
  ReviewAssignment,
  ReviewAssignmentDbRow
>(V3_ENTITY_STORAGE_MAPPINGS.ReviewAssignment, {
  table: "review_assignments",
  primaryKey: "review_id",
  columns: [
    "review_id",
    "task_id",
    "reviewer_agent_id",
    "assigned_by",
    "review_status",
    "verdict",
    "public_feedback",
    "internal_reviewer_notes",
    "created_at",
    "completed_at"
  ],
  toDbRow: toReviewAssignmentDbRow,
  fromDbRow: fromReviewAssignmentDbRow
});

const artifactAttestationAdapter = createSingleTableAdapter<
  ArtifactAttestation,
  ArtifactAttestationDbRow
>(V3_ENTITY_STORAGE_MAPPINGS.ArtifactAttestation, {
  table: "artifact_attestations",
  primaryKey: "attestation_id",
  columns: [
    "attestation_id",
    "task_id",
    "artifact_path",
    "artifact_sha256",
    "byte_size",
    "attested_by_agent_id",
    "attestation_type",
    "verification_signature",
    "internal_audit_trail",
    "created_at"
  ],
  toDbRow: toArtifactAttestationDbRow,
  fromDbRow: fromArtifactAttestationDbRow
});

const memoryRecordV3Adapter = createSingleTableAdapter<MemoryRecordV3, MemoryRecordV3DbRow>(
  V3_ENTITY_STORAGE_MAPPINGS.MemoryRecordV3,
  {
    table: "memory_records_v3",
    primaryKey: "memory_id",
    columns: [
      "memory_id",
      "owner_agent_id",
      "scope",
      "category",
      "key",
      "content",
      "raw_context_bytes",
      "access_count",
      "confidence_score",
      "created_at",
      "updated_at"
    ],
    toDbRow: toMemoryRecordV3DbRow,
    fromDbRow: fromMemoryRecordV3DbRow
  }
);

const KNOWLEDGE_CHUNKS_META_SPEC: TableSqlSpec<KnowledgeChunkMetaDbRow> = {
  table: "knowledge_chunks_meta",
  primaryKey: "chunk_id",
  columns: ["chunk_id", "memory_id", "embedding_vector_ref", "created_at"]
};

const KNOWLEDGE_CHUNKS_FTS_SPEC: TableSqlSpec<KnowledgeChunkFtsDbRow> = {
  table: "knowledge_chunks_fts",
  primaryKey: "chunk_id",
  columns: ["chunk_id", "memory_id", "title", "chunk_content", "tags", "created_at"]
};

validateTableSqlSpec(KNOWLEDGE_CHUNKS_META_SPEC);
validateTableSqlSpec(KNOWLEDGE_CHUNKS_FTS_SPEC);

const knowledgeChunkFTSAdapter: EntityPersistenceAdapter<KnowledgeChunkFTS, KnowledgeChunkFTSDbRow> = {
  mapping: V3_ENTITY_STORAGE_MAPPINGS.KnowledgeChunkFTS,
  toDbRow: toKnowledgeChunkFTSDbRow,
  fromDbRow: fromKnowledgeChunkFTSDbRow,
  insert: (db, chunk) => {
    const row = toKnowledgeChunkFTSDbRow(chunk);
    const savepoint = `sp_insert_knowledge_chunk_${++savepointSeq}`;
    db.exec(`SAVEPOINT ${savepoint};`);
    try {
      insertSingleTableRowRaw(db, KNOWLEDGE_CHUNKS_META_SPEC, row.meta);
      insertSingleTableRowRaw(db, KNOWLEDGE_CHUNKS_FTS_SPEC, row.fts);
      db.exec(`RELEASE SAVEPOINT ${savepoint};`);
    } catch (err) {
      try {
        db.exec(`ROLLBACK TO SAVEPOINT ${savepoint};`);
        db.exec(`RELEASE SAVEPOINT ${savepoint};`);
      } catch {
        // Outer transaction already aborted or rolled back
      }
      throw err;
    }
  },
  getById: (db, chunkId) => {
    const metaRow = getSingleTableRowRawById(db, KNOWLEDGE_CHUNKS_META_SPEC, chunkId);
    const ftsRows = getSingleTableRowsRawById(db, KNOWLEDGE_CHUNKS_FTS_SPEC, chunkId);

    if (ftsRows.length > 1) {
      throw new Error(
        `KnowledgeChunkFTS integrity violation for '${chunkId}': expected at most 1 row in knowledge_chunks_fts, found ${ftsRows.length}`
      );
    }

    const ftsRow = ftsRows[0];
    if (!metaRow && !ftsRow) {
      return null;
    }
    if (!metaRow) {
      throw new Error(
        `KnowledgeChunkFTS integrity violation for '${chunkId}': row exists in knowledge_chunks_fts without matching row in knowledge_chunks_meta`
      );
    }
    if (!ftsRow) {
      throw new Error(
        `KnowledgeChunkFTS integrity violation for '${chunkId}': row exists in knowledge_chunks_meta without matching row in knowledge_chunks_fts`
      );
    }

    return fromKnowledgeChunkFTSDbRow({ meta: metaRow, fts: ftsRow });
  }
};

const contextSnapshotAdapter = createSingleTableAdapter<ContextSnapshot, ContextSnapshotDbRow>(
  V3_ENTITY_STORAGE_MAPPINGS.ContextSnapshot,
  {
    table: "context_snapshots",
    primaryKey: "snapshot_id",
    columns: [
      "snapshot_id",
      "task_id",
      "agent_id",
      "summary",
      "token_count",
      "snapshot_data",
      "encryption_iv",
      "created_at"
    ],
    toDbRow: toContextSnapshotDbRow,
    fromDbRow: fromContextSnapshotDbRow
  }
);

// ============================================================================
// Synchronous node:sqlite (DatabaseSync) Persistence Helpers (All 24 Entities)
// ============================================================================

export function insertChatRoom(db: DatabaseSync, room: ChatRoom): void {
  chatRoomAdapter.insert(db, room);
}

export function getChatRoomById(db: DatabaseSync, roomId: string): ChatRoom | null {
  return chatRoomAdapter.getById(db, roomId);
}

export function insertChatMember(db: DatabaseSync, member: ChatMember): void {
  chatMemberAdapter.insert(db, member);
}

export function getChatMemberById(db: DatabaseSync, membershipId: string): ChatMember | null {
  return chatMemberAdapter.getById(db, membershipId);
}

export function insertChatMessage(db: DatabaseSync, message: ChatMessage): void {
  chatMessageAdapter.insert(db, message);
}

export function getChatMessageById(db: DatabaseSync, messageId: string): ChatMessage | null {
  return chatMessageAdapter.getById(db, messageId);
}

export function insertMessageAttachment(db: DatabaseSync, attachment: MessageAttachment): void {
  messageAttachmentAdapter.insert(db, attachment);
}

export function getMessageAttachmentById(
  db: DatabaseSync,
  attachmentId: string
): MessageAttachment | null {
  return messageAttachmentAdapter.getById(db, attachmentId);
}

export function insertMessageReaction(db: DatabaseSync, reaction: MessageReaction): void {
  messageReactionAdapter.insert(db, reaction);
}

export function getMessageReactionById(
  db: DatabaseSync,
  reactionId: string
): MessageReaction | null {
  return messageReactionAdapter.getById(db, reactionId);
}

export function insertRoomInvite(db: DatabaseSync, invite: RoomInvite): void {
  roomInviteAdapter.insert(db, invite);
}

export function getRoomInviteById(db: DatabaseSync, inviteId: string): RoomInvite | null {
  return roomInviteAdapter.getById(db, inviteId);
}

export function insertRoomAuditLog(db: DatabaseSync, log: RoomAuditLog): void {
  roomAuditLogAdapter.insert(db, log);
}

export function getRoomAuditLogById(db: DatabaseSync, auditId: string): RoomAuditLog | null {
  return roomAuditLogAdapter.getById(db, auditId);
}

export function insertOutboxEvent(db: DatabaseSync, event: OutboxEvent): void {
  outboxEventAdapter.insert(db, event);
}

export function getOutboxEventById(db: DatabaseSync, eventId: string): OutboxEvent | null {
  return outboxEventAdapter.getById(db, eventId);
}

export function insertEventSubscription(db: DatabaseSync, sub: EventSubscription): void {
  eventSubscriptionAdapter.insert(db, sub);
}

export function getEventSubscriptionById(
  db: DatabaseSync,
  subscriptionId: string
): EventSubscription | null {
  return eventSubscriptionAdapter.getById(db, subscriptionId);
}

export function insertDeadLetterQueue(db: DatabaseSync, dlq: DeadLetterQueue): void {
  deadLetterQueueAdapter.insert(db, dlq);
}

export function getDeadLetterQueueById(db: DatabaseSync, dlqId: string): DeadLetterQueue | null {
  return deadLetterQueueAdapter.getById(db, dlqId);
}

export function insertDeliveryAttempt(db: DatabaseSync, attempt: DeliveryAttempt): void {
  deliveryAttemptAdapter.insert(db, attempt);
}

export function getDeliveryAttemptById(
  db: DatabaseSync,
  attemptId: string
): DeliveryAttempt | null {
  return deliveryAttemptAdapter.getById(db, attemptId);
}

export function insertAgentLease(db: DatabaseSync, lease: AgentLease): void {
  agentLeaseAdapter.insert(db, lease);
}

export function getAgentLeaseById(db: DatabaseSync, leaseId: string): AgentLease | null {
  return agentLeaseAdapter.getById(db, leaseId);
}

export function insertAgentHeartbeat(db: DatabaseSync, heartbeat: AgentHeartbeat): void {
  agentHeartbeatAdapter.insert(db, heartbeat);
}

export function getAgentHeartbeatById(
  db: DatabaseSync,
  heartbeatId: string
): AgentHeartbeat | null {
  return agentHeartbeatAdapter.getById(db, heartbeatId);
}

export function insertAgentCapability(db: DatabaseSync, capability: AgentCapability): void {
  agentCapabilityAdapter.insert(db, capability);
}

export function getAgentCapabilityById(
  db: DatabaseSync,
  capabilityId: string
): AgentCapability | null {
  return agentCapabilityAdapter.getById(db, capabilityId);
}

export function insertAgentQuotaAllocation(
  db: DatabaseSync,
  allocation: AgentQuotaAllocation
): void {
  agentQuotaAllocationAdapter.insert(db, allocation);
}

export function getAgentQuotaAllocationById(
  db: DatabaseSync,
  allocationId: string
): AgentQuotaAllocation | null {
  return agentQuotaAllocationAdapter.getById(db, allocationId);
}

export function insertAgentExecutionLock(db: DatabaseSync, lock: AgentExecutionLock): void {
  agentExecutionLockAdapter.insert(db, lock);
}

export function getAgentExecutionLockById(
  db: DatabaseSync,
  lockId: string
): AgentExecutionLock | null {
  return agentExecutionLockAdapter.getById(db, lockId);
}

export function insertProjectTaskV3(db: DatabaseSync, task: ProjectTaskV3): void {
  projectTaskV3Adapter.insert(db, task);
}

export function getProjectTaskV3ById(db: DatabaseSync, taskId: string): ProjectTaskV3 | null {
  return projectTaskV3Adapter.getById(db, taskId);
}

export function insertTaskTransitionLog(db: DatabaseSync, log: TaskTransitionLog): void {
  taskTransitionLogAdapter.insert(db, log);
}

export function getTaskTransitionLogById(
  db: DatabaseSync,
  transitionId: string
): TaskTransitionLog | null {
  return taskTransitionLogAdapter.getById(db, transitionId);
}

export function insertTaskApprovalBinding(
  db: DatabaseSync,
  binding: TaskApprovalBinding
): void {
  taskApprovalBindingAdapter.insert(db, binding);
}

export function getTaskApprovalBindingById(
  db: DatabaseSync,
  bindingId: string
): TaskApprovalBinding | null {
  return taskApprovalBindingAdapter.getById(db, bindingId);
}

export function insertReviewAssignment(db: DatabaseSync, review: ReviewAssignment): void {
  reviewAssignmentAdapter.insert(db, review);
}

export function getReviewAssignmentById(
  db: DatabaseSync,
  reviewId: string
): ReviewAssignment | null {
  return reviewAssignmentAdapter.getById(db, reviewId);
}

export function insertArtifactAttestation(
  db: DatabaseSync,
  attestation: ArtifactAttestation
): void {
  artifactAttestationAdapter.insert(db, attestation);
}

export function getArtifactAttestationById(
  db: DatabaseSync,
  attestationId: string
): ArtifactAttestation | null {
  return artifactAttestationAdapter.getById(db, attestationId);
}

export function insertMemoryRecordV3(db: DatabaseSync, memory: MemoryRecordV3): void {
  memoryRecordV3Adapter.insert(db, memory);
}

export function getMemoryRecordV3ById(
  db: DatabaseSync,
  memoryId: string
): MemoryRecordV3 | null {
  return memoryRecordV3Adapter.getById(db, memoryId);
}

export function insertKnowledgeChunkFTS(db: DatabaseSync, chunk: KnowledgeChunkFTS): void {
  knowledgeChunkFTSAdapter.insert(db, chunk);
}

export function getKnowledgeChunkFTSById(
  db: DatabaseSync,
  chunkId: string
): KnowledgeChunkFTS | null {
  return knowledgeChunkFTSAdapter.getById(db, chunkId);
}

export function insertContextSnapshot(db: DatabaseSync, snapshot: ContextSnapshot): void {
  contextSnapshotAdapter.insert(db, snapshot);
}

export function getContextSnapshotById(
  db: DatabaseSync,
  snapshotId: string
): ContextSnapshot | null {
  return contextSnapshotAdapter.getById(db, snapshotId);
}

// ============================================================================
// Complete Compile-Time & Runtime Registry (All 24 Entities)
// ============================================================================

export interface V3EntityTypeMap {
  ChatRoom: ChatRoom;
  ChatMember: ChatMember;
  ChatMessage: ChatMessage;
  MessageAttachment: MessageAttachment;
  MessageReaction: MessageReaction;
  RoomInvite: RoomInvite;
  RoomAuditLog: RoomAuditLog;
  OutboxEvent: OutboxEvent;
  EventSubscription: EventSubscription;
  DeadLetterQueue: DeadLetterQueue;
  DeliveryAttempt: DeliveryAttempt;
  AgentLease: AgentLease;
  AgentHeartbeat: AgentHeartbeat;
  AgentCapability: AgentCapability;
  AgentQuotaAllocation: AgentQuotaAllocation;
  AgentExecutionLock: AgentExecutionLock;
  ProjectTaskV3: ProjectTaskV3;
  TaskTransitionLog: TaskTransitionLog;
  TaskApprovalBinding: TaskApprovalBinding;
  ReviewAssignment: ReviewAssignment;
  ArtifactAttestation: ArtifactAttestation;
  MemoryRecordV3: MemoryRecordV3;
  KnowledgeChunkFTS: KnowledgeChunkFTS;
  ContextSnapshot: ContextSnapshot;
}

export interface V3DbRowTypeMap {
  ChatRoom: ChatRoomDbRow;
  ChatMember: ChatMemberDbRow;
  ChatMessage: ChatMessageDbRow;
  MessageAttachment: MessageAttachmentDbRow;
  MessageReaction: MessageReactionDbRow;
  RoomInvite: RoomInviteDbRow;
  RoomAuditLog: RoomAuditLogDbRow;
  OutboxEvent: OutboxEventDbRow;
  EventSubscription: EventSubscriptionDbRow;
  DeadLetterQueue: DeadLetterQueueDbRow;
  DeliveryAttempt: DeliveryAttemptDbRow;
  AgentLease: AgentLeaseDbRow;
  AgentHeartbeat: AgentHeartbeatDbRow;
  AgentCapability: AgentCapabilityDbRow;
  AgentQuotaAllocation: AgentQuotaAllocationDbRow;
  AgentExecutionLock: AgentExecutionLockDbRow;
  ProjectTaskV3: ProjectTaskV3DbRow;
  TaskTransitionLog: TaskTransitionLogDbRow;
  TaskApprovalBinding: TaskApprovalBindingDbRow;
  ReviewAssignment: ReviewAssignmentDbRow;
  ArtifactAttestation: ArtifactAttestationDbRow;
  MemoryRecordV3: MemoryRecordV3DbRow;
  KnowledgeChunkFTS: KnowledgeChunkFTSDbRow;
  ContextSnapshot: ContextSnapshotDbRow;
}

export const V3_ENTITY_PERSISTENCE_ADAPTERS = {
  ChatRoom: chatRoomAdapter,
  ChatMember: chatMemberAdapter,
  ChatMessage: chatMessageAdapter,
  MessageAttachment: messageAttachmentAdapter,
  MessageReaction: messageReactionAdapter,
  RoomInvite: roomInviteAdapter,
  RoomAuditLog: roomAuditLogAdapter,
  OutboxEvent: outboxEventAdapter,
  EventSubscription: eventSubscriptionAdapter,
  DeadLetterQueue: deadLetterQueueAdapter,
  DeliveryAttempt: deliveryAttemptAdapter,
  AgentLease: agentLeaseAdapter,
  AgentHeartbeat: agentHeartbeatAdapter,
  AgentCapability: agentCapabilityAdapter,
  AgentQuotaAllocation: agentQuotaAllocationAdapter,
  AgentExecutionLock: agentExecutionLockAdapter,
  ProjectTaskV3: projectTaskV3Adapter,
  TaskTransitionLog: taskTransitionLogAdapter,
  TaskApprovalBinding: taskApprovalBindingAdapter,
  ReviewAssignment: reviewAssignmentAdapter,
  ArtifactAttestation: artifactAttestationAdapter,
  MemoryRecordV3: memoryRecordV3Adapter,
  KnowledgeChunkFTS: knowledgeChunkFTSAdapter,
  ContextSnapshot: contextSnapshotAdapter
} as const satisfies {
  [K in V3MappedEntityName]: EntityPersistenceAdapter<V3EntityTypeMap[K], V3DbRowTypeMap[K]>;
};
