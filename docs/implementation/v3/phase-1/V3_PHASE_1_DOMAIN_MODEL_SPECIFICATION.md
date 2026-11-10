# AICO V3 — PHASE 1 DOMAIN MODEL SPECIFICATION (V3-G1)

**Document ID:** AICO-V3-P1-DOC-01  
**Author:** `flash-02` (Engineering & QA Lead)  
**Recipient:** `chatgpt-01` (CEO & Main Orchestrator)  
**Governance Authority:** Founder  
**Date:** 2026-11-10  
**Status:** DELIVERED & VERIFIED  

---

## 1. EXECUTIVE SUMMARY

Under Phase 1 Directive (V3-G1), this specification establishes the canonical TypeScript domain model and runtime validation contracts for AICO V3.

The domain model comprises exactly **24 core entities** distributed across 5 functional domains:
1. **Core Collaboration** (7 entities)
2. **Reliable Messaging & Outbox** (4 entities)
3. **Agent Coordination & Lifecycle** (5 entities)
4. **Task Orchestration & Governance** (5 entities)
5. **Knowledge & Memory** (3 entities)

Every entity is implemented with:
- Strict TypeScript interface definitions.
- 1:1 runtime validation schemas via Zod (`z.object({...})`).
- Invariant enforcement (regex patterns, bounds, timestamps, valid enums).
- Explicit Public DTO projections (`toPublic<Entity>DTO()`) that guarantee internal tokens, cryptographic nonces, private evaluation notes, and credentials cannot leak to untrusted consumers.

---

## 2. DOMAIN ENTITIES INVENTORY & SCHEMA SPECIFICATIONS

### Group 1: Core Collaboration (7 Entities)

| Entity Name | Source File | Primary Key | Description | Public DTO Stripped Fields |
| :--- | :--- | :--- | :--- | :--- |
| **ChatRoom** | `src/domain/collaboration/chat-room.ts` | `room_id` | Top-level communication channels (Executive Boardroom, Announcements, Projects, Tasks). | `internal_notes` |
| **ChatMember** | `src/domain/collaboration/chat-member.ts` | `membership_id` | Association between a principal (human/agent/system) and a chat room with defined role. | `internal_cursor` |
| **ChatMessage** | `src/domain/collaboration/chat-message.ts` | `message_id` | Chronological communication records with thread support, mentions, and message types. | `raw_token_trace` |
| **MessageAttachment** | `src/domain/collaboration/message-attachment.ts` | `attachment_id` | File attachments bound to messages with SHA-256 verification and storage driver references. | `storage_driver_token` |
| **MessageReaction** | `src/domain/collaboration/message-reaction.ts` | `reaction_id` | Emoji reactions attached to messages by principals. | `internal_client_ip` |
| **RoomInvite** | `src/domain/collaboration/room-invite.ts` | `invite_id` | Room invitation workflow records with status lifecycle (`pending`, `accepted`, `declined`, `expired`). | `invite_token_hash` |
| **RoomAuditLog** | `src/domain/collaboration/room-audit-log.ts` | `audit_id` | Security audit trail for membership, role, and configuration changes within a chat room. | `security_context_snapshot` |

---

### Group 2: Reliable Messaging & Outbox (4 Entities)

| Entity Name | Source File | Primary Key | Description | Public DTO Stripped Fields |
| :--- | :--- | :--- | :--- | :--- |
| **OutboxEvent** | `src/domain/messaging/outbox-event.ts` | `event_id` | Transactional outbox records ensuring at-least-once cross-boundary event delivery. | `internal_routing_key` |
| **EventSubscription** | `src/domain/messaging/event-subscription.ts` | `subscription_id` | Registered consumers with wildcard topic subscriptions and target delivery endpoints. | `auth_secret_hash` |
| **DeadLetterQueue** | `src/domain/messaging/dead-letter-queue.ts` | `dlq_id` | Poison and permanently failed messages quarantined after exhausting retry policies. | `stack_trace` |
| **DeliveryAttempt** | `src/domain/messaging/delivery-attempt.ts` | `attempt_id` | Individual dispatch attempts against subscribed endpoints with latency and error tracking. | `internal_worker_id` |

---

### Group 3: Agent Coordination & Lifecycle (5 Entities)

| Entity Name | Source File | Primary Key | Description | Public DTO Stripped Fields |
| :--- | :--- | :--- | :--- | :--- |
| **AgentLease** | `src/domain/coordination/agent-lease.ts` | `lease_id` | Exclusive task execution leases with heartbeat tracking and cryptographic lease nonces. | `lease_nonce` |
| **AgentHeartbeat** | `src/domain/coordination/agent-heartbeat.ts` | `heartbeat_id` | Periodic health telemetry from running agents (CPU%, memory MB, lifecycle status). | `host_process_pid` |
| **AgentCapability** | `src/domain/coordination/agent-capability.ts` | `capability_id` | Registered agent skill proficiencies and tool capabilities. | `internal_evaluation_score` |
| **AgentQuotaAllocation**| `src/domain/coordination/agent-quota-allocation.ts`| `allocation_id` | Token and resource quotas allocated to agents per quota pool. | `billing_account_ref` |
| **AgentExecutionLock** | `src/domain/coordination/agent-execution-lock.ts` | `lock_id` | Distributed mutual exclusion locks on shared resources with cryptographic tokens. | `lock_nonce` |

---

### Group 4: Task Orchestration & Governance (5 Entities)

| Entity Name | Source File | Primary Key | Description | Public DTO Stripped Fields |
| :--- | :--- | :--- | :--- | :--- |
| **ProjectTaskV3** | `src/domain/task-governance/project-task-v3.ts` | `task_id` | Canonical task aggregate representing V3 tasks with 13-state execution & 9-state dispatch matrix. | `internal_evaluation_notes` |
| **TaskTransitionLog** | `src/domain/task-governance/task-transition-log.ts` | `transition_id` | Immutable audit log of every state transition across TR-01 to TR-26 with sequence numbers. | `internal_diagnostic_payload` |
| **TaskApprovalBinding** | `src/domain/task-governance/task-approval-binding.ts` | `binding_id` | Cryptographic approval binding linking Founder/Executive approvals with canonical payload hashes. | `canonical_payload_hash`, `signature_nonce` |
| **ReviewAssignment** | `src/domain/task-governance/review-assignment.ts` | `review_id` | Independent peer and QA review assignments with verdicts (`pass`, `fail`, `conditional`). | `internal_reviewer_notes` |
| **ArtifactAttestation**| `src/domain/task-governance/artifact-attestation.ts` | `attestation_id` | Cryptographic attestations binding task artifacts to verified SHA-256 hashes and signatures. | `verification_signature`, `internal_audit_trail` |

---

### Group 5: Knowledge & Memory (3 Entities)

| Entity Name | Source File | Primary Key | Description | Public DTO Stripped Fields |
| :--- | :--- | :--- | :--- | :--- |
| **MemoryRecordV3** | `src/domain/memory/memory-record-v3.ts` | `memory_id` | Scoped agent and company knowledge entries (`COMPANY`, `PROJECT`, `TASK`, `ROOM`, `AGENT_PRIVATE`). | `raw_context_bytes` |
| **KnowledgeChunkFTS** | `src/domain/memory/knowledge-chunk-fts.ts` | `chunk_id` | Searchable knowledge chunks indexed in SQLite FTS5 for full-text semantic and lexical search. | `embedding_vector_ref` |
| **ContextSnapshot** | `src/domain/memory/context-snapshot.ts` | `snapshot_id` | Point-in-time serialized context snapshots of conversation and task state. | `snapshot_data`, `encryption_iv` |

---

## 3. PUBLIC DTO BOUNDARY & ANTI-LEAKAGE ARCHITECTURE

### Design Principle
External API consumers, client agents, and UI renderers MUST never receive internal operational secrets.

For each entity, the Public DTO schema is programmatically derived from the full entity schema via Zod `.omit()`:

```typescript
// Example: AgentLease Public DTO Boundary
export const AgentLeaseSchema = z.object({
  lease_id: z.string().min(1),
  task_id: z.string().min(1),
  agent_id: z.string().min(1),
  lease_nonce: z.string().min(1), // Secret lease token
  status: AgentLeaseStatusSchema.default("active"),
  heartbeat_at: IsoTimestampSchema,
  expires_at: IsoTimestampSchema,
  acquired_at: IsoTimestampSchema
});

export const PublicAgentLeaseDTOSchema = AgentLeaseSchema.omit({
  lease_nonce: true // Never leak cryptographic lease nonce in public DTO
});

export function toPublicAgentLeaseDTO(lease: AgentLease): PublicAgentLeaseDTO {
  const { lease_nonce, ...publicData } = lease;
  return PublicAgentLeaseDTOSchema.parse(publicData);
}
```

### Complete Inventory of Omitted Fields
1. `ChatRoom`: `internal_notes` (private executive/admin notes)
2. `ChatMember`: `internal_cursor` (internal database read position)
3. `ChatMessage`: `raw_token_trace` (internal token usage telemetry)
4. `MessageAttachment`: `storage_driver_token` (cloud storage credentials/tokens)
5. `MessageReaction`: `internal_client_ip` (network metadata)
6. `RoomInvite`: `invite_token_hash` (cryptographic invitation secret)
7. `RoomAuditLog`: `security_context_snapshot` (raw authentication context)
8. `OutboxEvent`: `internal_routing_key` (message broker internal routing)
9. `EventSubscription`: `auth_secret_hash` (webhook signature secret)
10. `DeadLetterQueue`: `stack_trace` (internal error stack trace)
11. `DeliveryAttempt`: `internal_worker_id` (process worker ID)
12. `AgentLease`: `lease_nonce` (cryptographic lease token)
13. `AgentHeartbeat`: `host_process_pid` (runtime operating system PID)
14. `AgentCapability`: `internal_evaluation_score` (internal QA benchmark scores)
15. `AgentQuotaAllocation`: `billing_account_ref` (corporate billing account tokens)
16. `AgentExecutionLock`: `lock_nonce` (cryptographic lock release token)
17. `ProjectTaskV3`: `internal_evaluation_notes` (private QA notes)
18. `TaskTransitionLog`: `internal_diagnostic_payload` (internal diagnostic payload)
19. `TaskApprovalBinding`: `canonical_payload_hash`, `signature_nonce` (cryptographic proof nonces)
20. `ReviewAssignment`: `internal_reviewer_notes` (confidential reviewer commentary)
21. `ArtifactAttestation`: `verification_signature`, `internal_audit_trail` (cryptographic signature)
22. `MemoryRecordV3`: `raw_context_bytes` (raw binary context payload)
23. `KnowledgeChunkFTS`: `embedding_vector_ref` (vector database storage key)
24. `ContextSnapshot`: `snapshot_data`, `encryption_iv` (serialized state payload & AES IV)

---

## 4. VERIFICATION EVIDENCE

The entire domain model is verified by `company-mcp/test/t17-domain-models-g1.test.ts`:
- **30 test cases** executed.
- Valid parsing verified across all 24 entities.
- Rejection of invalid types, missing required fields, bad regexes, and out-of-bounds numbers verified.
- Public DTO boundary projection verified: 100% of sensitive fields are confirmed omitted and unreachable in DTO objects.
- Result: **30/30 passed, 0 failures, 0 skipped**.
