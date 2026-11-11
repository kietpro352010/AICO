import test from "node:test";
import assert from "node:assert/strict";
import { ZodError } from "zod";

// Domain Model Index
import {
  projectPublicAllowlistedRecord,

  // Collaboration
  ChatRoomSchema,
  toPublicChatRoomDTO,
  ChatMemberSchema,
  toPublicChatMemberDTO,
  ChatMessageSchema,
  PublicChatMessageDTOSchema,
  PUBLIC_CHAT_MESSAGE_METADATA_KEYS,
  toPublicChatMessageDTO,
  MessageAttachmentSchema,
  toPublicMessageAttachmentDTO,
  MessageReactionSchema,
  toPublicMessageReactionDTO,
  RoomInviteSchema,
  toPublicRoomInviteDTO,
  RoomAuditLogSchema,
  PublicRoomAuditLogDTOSchema,
  PUBLIC_ROOM_AUDIT_DETAILS_KEYS,
  toPublicRoomAuditLogDTO,

  // Messaging
  OutboxEventSchema,
  toPublicOutboxEventDTO,
  EventSubscriptionSchema,
  toPublicEventSubscriptionDTO,
  DeadLetterQueueSchema,
  toPublicDeadLetterQueueDTO,
  DeliveryAttemptSchema,
  toPublicDeliveryAttemptDTO,

  // Coordination
  AgentLeaseSchema,
  toPublicAgentLeaseDTO,
  AgentHeartbeatSchema,
  toPublicAgentHeartbeatDTO,
  AgentCapabilitySchema,
  toPublicAgentCapabilityDTO,
  AgentQuotaAllocationSchema,
  toPublicAgentQuotaAllocationDTO,
  AgentExecutionLockSchema,
  toPublicAgentExecutionLockDTO,

  // Task Governance
  ProjectTaskV3Schema,
  toPublicProjectTaskV3DTO,
  TaskTransitionLogSchema,
  toPublicTaskTransitionLogDTO,
  TaskApprovalBindingSchema,
  toPublicTaskApprovalBindingDTO,
  ReviewAssignmentSchema,
  toPublicReviewAssignmentDTO,
  ArtifactAttestationSchema,
  toPublicArtifactAttestationDTO,

  // Memory
  MemoryRecordV3Schema,
  toPublicMemoryRecordV3DTO,
  KnowledgeChunkFTSSchema,
  toPublicKnowledgeChunkFTSDTO,
  ContextSnapshotSchema,
  toPublicContextSnapshotDTO
} from "../src/domain/index.js";

const VALID_ISO = "2026-11-10T12:00:00.000Z";
const VALID_SHA256 = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";

test("T17: V3-G1 Domain Model & Contract Verification Suite (24 Entities)", async (suite) => {

  await suite.test("Group 1: Core Collaboration Entities (7 Entities)", async (t) => {
    // 1. ChatRoom
    await t.test("1. ChatRoom: validates correctly and strips internal_notes in public DTO", () => {
      const valid = ChatRoomSchema.parse({
        room_id: "room_exec_01",
        slug: "exec-boardroom",
        name: "Executive Boardroom",
        room_type: "EXECUTIVE_BOARDROOM",
        project_id: "proj_aico_v3",
        task_id: null,
        created_by: "chatgpt-01",
        is_archived: false,
        internal_notes: "CONFIDENTIAL: Executive deliberations only",
        created_at: VALID_ISO,
        updated_at: VALID_ISO
      });
      assert.equal(valid.room_id, "room_exec_01");
      assert.equal(valid.internal_notes, "CONFIDENTIAL: Executive deliberations only");

      const publicDto = toPublicChatRoomDTO(valid);
      assert.equal(publicDto.room_id, "room_exec_01");
      assert.equal("internal_notes" in publicDto, false);

      // Rejection check: invalid room type
      assert.throws(() => {
        ChatRoomSchema.parse({ ...valid, room_type: "INVALID_ROOM_TYPE" as any });
      });
    });

    // 2. ChatMember
    await t.test("2. ChatMember: validates correctly and strips internal_cursor in public DTO", () => {
      const valid = ChatMemberSchema.parse({
        membership_id: "mem_flash_01",
        room_id: "room_exec_01",
        principal_id: "flash-01",
        principal_type: "agent",
        role: "moderator",
        last_read_message_id: null,
        internal_cursor: "pos_12345_sensitive",
        joined_at: VALID_ISO
      });
      assert.equal(valid.role, "moderator");

      const publicDto = toPublicChatMemberDTO(valid);
      assert.equal("internal_cursor" in publicDto, false);

      // Rejection check: invalid role
      assert.throws(() => {
        ChatMemberSchema.parse({ ...valid, role: "superuser" as any });
      });
    });

    // 3. ChatMessage
    await t.test("3. ChatMessage: validates correctly and strips raw_token_trace in public DTO", () => {
      const valid = ChatMessageSchema.parse({
        message_id: "msg_001",
        room_id: "room_exec_01",
        sender_id: "chatgpt-01",
        sender_type: "agent",
        message_type: "DIRECTIVE",
        content: "Initiate Phase 1 migration",
        reply_to_id: null,
        mentions: ["flash-02"],
        metadata: {},
        raw_token_trace: "prompt_tokens: 1500, completion_tokens: 200",
        is_edited: false,
        created_at: VALID_ISO,
        updated_at: VALID_ISO
      });
      assert.equal(valid.message_type, "DIRECTIVE");

      const publicDto = toPublicChatMessageDTO(valid);
      assert.equal("raw_token_trace" in publicDto, false);

      // Rejection check: empty message content
      assert.throws(() => {
        ChatMessageSchema.parse({ ...valid, content: "" });
      });
    });

    // 4. MessageAttachment
    await t.test("4. MessageAttachment: validates correctly and strips storage_driver_token in public DTO", () => {
      const valid = MessageAttachmentSchema.parse({
        attachment_id: "att_001",
        message_id: "msg_001",
        file_name: "architecture-v3.pdf",
        file_path: "artifacts/architecture-v3.pdf",
        file_size_bytes: 1048576,
        mime_type: "application/pdf",
        sha256_hash: VALID_SHA256,
        storage_driver_token: "s3_signed_secret_token_xyz",
        uploaded_at: VALID_ISO
      });

      const publicDto = toPublicMessageAttachmentDTO(valid);
      assert.equal("storage_driver_token" in publicDto, false);

      // Rejection check: invalid sha256
      assert.throws(() => {
        MessageAttachmentSchema.parse({ ...valid, sha256_hash: "invalid_hash" });
      });
    });

    // 5. MessageReaction
    await t.test("5. MessageReaction: validates correctly and strips internal_client_ip in public DTO", () => {
      const valid = MessageReactionSchema.parse({
        reaction_id: "rxn_001",
        message_id: "msg_001",
        principal_id: "flash-02",
        reaction_code: "rocket",
        internal_client_ip: "10.0.0.42",
        created_at: VALID_ISO
      });

      const publicDto = toPublicMessageReactionDTO(valid);
      assert.equal("internal_client_ip" in publicDto, false);

      // Rejection check: empty reaction_code
      assert.throws(() => {
        MessageReactionSchema.parse({ ...valid, reaction_code: "" });
      });
    });

    // 6. RoomInvite
    await t.test("6. RoomInvite: validates correctly and strips invite_token_hash in public DTO", () => {
      const valid = RoomInviteSchema.parse({
        invite_id: "inv_001",
        room_id: "room_exec_01",
        inviter_id: "chatgpt-01",
        invitee_id: "codex-01",
        status: "pending",
        invite_token_hash: VALID_SHA256,
        expires_at: VALID_ISO,
        created_at: VALID_ISO
      });

      const publicDto = toPublicRoomInviteDTO(valid);
      assert.equal("invite_token_hash" in publicDto, false);

      // Rejection check: invalid invite status
      assert.throws(() => {
        RoomInviteSchema.parse({ ...valid, status: "used" as any });
      });
    });

    // 7. RoomAuditLog
    await t.test("7. RoomAuditLog: validates correctly and strips security_context_snapshot in public DTO", () => {
      const valid = RoomAuditLogSchema.parse({
        audit_id: "ral_001",
        room_id: "room_exec_01",
        action: "member_added",
        actor_id: "chatgpt-01",
        details: { target: "codex-01" },
        security_context_snapshot: "auth_token_hash: deadbeef, ip: 127.0.0.1",
        created_at: VALID_ISO
      });

      const publicDto = toPublicRoomAuditLogDTO(valid);
      assert.equal("security_context_snapshot" in publicDto, false);

      // Rejection check: invalid action
      assert.throws(() => {
        RoomAuditLogSchema.parse({ ...valid, action: "unauthorized_action" as any });
      });
    });
  });

  await suite.test("Group 2: Reliable Messaging & Outbox Entities (4 Entities)", async (t) => {
    // 8. OutboxEvent
    await t.test("8. OutboxEvent: validates correctly and strips internal_routing_key in public DTO", () => {
      const valid = OutboxEventSchema.parse({
        event_id: "evt_001",
        aggregate_type: "PROJECT_TASK",
        aggregate_id: "task_001",
        event_type: "TASK_CREATED",
        payload: { title: "Build V3" },
        status: "pending",
        retry_count: 0,
        max_retries: 5,
        last_error: null,
        internal_routing_key: "internal.queue.high_priority.secret",
        scheduled_for: VALID_ISO,
        processed_at: null,
        created_at: VALID_ISO
      });

      const publicDto = toPublicOutboxEventDTO(valid);
      assert.equal("internal_routing_key" in publicDto, false);

      // Rejection check: negative retry_count
      assert.throws(() => {
        OutboxEventSchema.parse({ ...valid, retry_count: -1 });
      });
    });

    // 9. EventSubscription
    await t.test("9. EventSubscription: validates correctly and strips auth_secret_hash in public DTO", () => {
      const valid = EventSubscriptionSchema.parse({
        subscription_id: "sub_001",
        subscriber_id: "audit-worker",
        event_pattern: "TASK_*",
        endpoint: "mcp://audit-service",
        auth_secret_hash: VALID_SHA256,
        is_active: true,
        created_at: VALID_ISO,
        updated_at: VALID_ISO
      });

      const publicDto = toPublicEventSubscriptionDTO(valid);
      assert.equal("auth_secret_hash" in publicDto, false);

      // Rejection check: empty pattern
      assert.throws(() => {
        EventSubscriptionSchema.parse({ ...valid, event_pattern: "" });
      });
    });

    // 10. DeadLetterQueue
    await t.test("10. DeadLetterQueue: validates correctly and strips stack_trace in public DTO", () => {
      const valid = DeadLetterQueueSchema.parse({
        dlq_id: "dlq_001",
        original_event_id: "evt_001",
        event_type: "TASK_CREATED",
        payload: { attempt: 5 },
        failure_reason: "Network timeout connecting to worker",
        stack_trace: "Error at Worker.deliver (src/worker.ts:123:45)\n    at processTicks",
        resolved: false,
        resolved_by: null,
        resolved_at: null,
        failed_at: VALID_ISO
      });

      const publicDto = toPublicDeadLetterQueueDTO(valid);
      assert.equal("stack_trace" in publicDto, false);

      // Rejection check: empty failure_reason
      assert.throws(() => {
        DeadLetterQueueSchema.parse({ ...valid, failure_reason: "" });
      });
    });

    // 11. DeliveryAttempt
    await t.test("11. DeliveryAttempt: validates correctly and strips internal_worker_id in public DTO", () => {
      const valid = DeliveryAttemptSchema.parse({
        attempt_id: "att_001",
        outbox_event_id: "evt_001",
        attempt_number: 1,
        status: "failed",
        response_code: 504,
        error_message: "Gateway Timeout",
        internal_worker_id: "worker-proc-node-7821",
        latency_ms: 5002.5,
        attempted_at: VALID_ISO
      });

      const publicDto = toPublicDeliveryAttemptDTO(valid);
      assert.equal("internal_worker_id" in publicDto, false);

      // Rejection check: attempt_number < 1
      assert.throws(() => {
        DeliveryAttemptSchema.parse({ ...valid, attempt_number: 0 });
      });
    });
  });

  await suite.test("Group 3: Agent Coordination & Lifecycle Entities (5 Entities)", async (t) => {
    // 12. AgentLease
    await t.test("12. AgentLease: validates correctly and strips lease_nonce in public DTO", () => {
      const valid = AgentLeaseSchema.parse({
        lease_id: "lease_001",
        task_id: "task_001",
        agent_id: "flash-02",
        lease_nonce: "crypto_nonce_8823194a",
        status: "active",
        heartbeat_at: VALID_ISO,
        expires_at: VALID_ISO,
        acquired_at: VALID_ISO
      });

      const publicDto = toPublicAgentLeaseDTO(valid);
      assert.equal("lease_nonce" in publicDto, false);

      // Rejection check: invalid lease status
      assert.throws(() => {
        AgentLeaseSchema.parse({ ...valid, status: "terminated" as any });
      });
    });

    // 13. AgentHeartbeat
    await t.test("13. AgentHeartbeat: validates correctly and strips host_process_pid in public DTO", () => {
      const valid = AgentHeartbeatSchema.parse({
        heartbeat_id: "hb_001",
        agent_id: "flash-02",
        status: "busy",
        current_task_id: "task_001",
        memory_usage_mb: 245.8,
        cpu_percent: 42.5,
        host_process_pid: 14280,
        recorded_at: VALID_ISO
      });

      const publicDto = toPublicAgentHeartbeatDTO(valid);
      assert.equal("host_process_pid" in publicDto, false);

      // Rejection check: cpu_percent > 100
      assert.throws(() => {
        AgentHeartbeatSchema.parse({ ...valid, cpu_percent: 105 });
      });
    });

    // 14. AgentCapability
    await t.test("14. AgentCapability: validates correctly and strips internal_evaluation_score in public DTO", () => {
      const valid = AgentCapabilitySchema.parse({
        capability_id: "cap_001",
        agent_id: "flash-02",
        capability_name: "typescript_compiler",
        version: "5.5.0",
        is_enabled: true,
        proficiency: "core",
        internal_evaluation_score: 0.98,
        granted_at: VALID_ISO
      });

      const publicDto = toPublicAgentCapabilityDTO(valid);
      assert.equal("internal_evaluation_score" in publicDto, false);

      // Rejection check: empty capability_name
      assert.throws(() => {
        AgentCapabilitySchema.parse({ ...valid, capability_name: "" });
      });
    });

    // 15. AgentQuotaAllocation
    await t.test("15. AgentQuotaAllocation: validates correctly and strips billing_account_ref in public DTO", () => {
      const valid = AgentQuotaAllocationSchema.parse({
        allocation_id: "alloc_001",
        agent_id: "flash-02",
        quota_pool_id: "gemini-pro-shared",
        allocated_tokens: 500000,
        used_tokens: 12000,
        daily_limit: 1000000,
        billing_account_ref: "acct_corp_master_stripe_secret",
        reset_at: VALID_ISO,
        updated_at: VALID_ISO
      });

      const publicDto = toPublicAgentQuotaAllocationDTO(valid);
      assert.equal("billing_account_ref" in publicDto, false);

      // Rejection check: negative allocated_tokens
      assert.throws(() => {
        AgentQuotaAllocationSchema.parse({ ...valid, allocated_tokens: -100 });
      });
    });

    // 16. AgentExecutionLock
    await t.test("16. AgentExecutionLock: validates correctly and strips lock_nonce in public DTO", () => {
      const valid = AgentExecutionLockSchema.parse({
        lock_id: "lock_001",
        resource_uri: "git_repo_main",
        holder_agent_id: "flash-02",
        lock_nonce: "secret_lock_nonce_991823",
        purpose: "Phase 1 migration execution",
        acquired_at: VALID_ISO,
        expires_at: VALID_ISO
      });

      const publicDto = toPublicAgentExecutionLockDTO(valid);
      assert.equal("lock_nonce" in publicDto, false);

      // Rejection check: missing resource_uri
      assert.throws(() => {
        AgentExecutionLockSchema.parse({ ...valid, resource_uri: "" });
      });
    });
  });

  await suite.test("Group 4: Task Orchestration & Governance Entities (5 Entities)", async (t) => {
    // 17. ProjectTaskV3
    await t.test("17. ProjectTaskV3: validates correctly and strips internal_evaluation_notes in public DTO", () => {
      const valid = ProjectTaskV3Schema.parse({
        task_id: "task_v3_001",
        project_id: "proj_aico_v3",
        parent_task_id: null,
        title: "Phase 1 Domain Modeling",
        objective: "Define 24 domain entities and sandbox migration",
        risk_class: "high",
        priority: "critical",
        execution_status: "in_progress",
        dispatch_status: "handoff_ready",
        assigned_agent_id: "flash-02",
        reviewer_agent_id: "flash-01",
        version: 1,
        token_budget: 150000,
        token_used: 25000,
        acceptance_criteria: ["Pass all 24 entities", "Pass sandbox migration"],
        internal_evaluation_notes: "Internal QA: Ensure zero data leak on DTOs",
        created_at: VALID_ISO,
        updated_at: VALID_ISO
      });

      const publicDto = toPublicProjectTaskV3DTO(valid);
      assert.equal("internal_evaluation_notes" in publicDto, false);

      // Rejection check: invalid execution_status
      assert.throws(() => {
        ProjectTaskV3Schema.parse({ ...valid, execution_status: "unknown_status" as any });
      });
    });

    // 18. TaskTransitionLog
    await t.test("18. TaskTransitionLog: validates correctly and strips internal_diagnostic_payload in public DTO", () => {
      const valid = TaskTransitionLogSchema.parse({
        transition_id: "trans_001",
        task_id: "task_v3_001",
        transition_seq: 1,
        from_execution_status: "draft",
        to_execution_status: "queued",
        from_dispatch_status: "not_dispatched",
        to_dispatch_status: "handoff_ready",
        transition_code: "TR-01",
        triggered_by: "chatgpt-01",
        reason: "CEO approved task for execution",
        internal_diagnostic_payload: "trace_id=xyz-123; memory_usage=45MB",
        created_at: VALID_ISO
      });

      const publicDto = toPublicTaskTransitionLogDTO(valid);
      assert.equal("internal_diagnostic_payload" in publicDto, false);

      // Rejection check: transition_seq <= 0
      assert.throws(() => {
        TaskTransitionLogSchema.parse({ ...valid, transition_seq: 0 });
      });
    });

    // 19. TaskApprovalBinding
    await t.test("19. TaskApprovalBinding: validates correctly and strips canonical_payload_hash & signature_nonce", () => {
      const valid = TaskApprovalBindingSchema.parse({
        binding_id: "appr_001",
        task_id: "task_v3_001",
        approval_tier: "founder",
        required_role: "FOUNDER",
        status: "approved",
        approver_principal_id: "founder-01",
        canonical_payload_hash: VALID_SHA256,
        signature_nonce: "hmac_signature_nonce_9984712",
        decision_reason: "Founder explicitly authorized Phase 1 execution",
        decided_at: VALID_ISO,
        created_at: VALID_ISO
      });

      const publicDto = toPublicTaskApprovalBindingDTO(valid);
      assert.equal("canonical_payload_hash" in publicDto, false);
      assert.equal("signature_nonce" in publicDto, false);
      assert.equal(publicDto.status, "approved");

      // Rejection check: invalid sha256
      assert.throws(() => {
        TaskApprovalBindingSchema.parse({ ...valid, canonical_payload_hash: "invalid-hash" });
      });
    });

    // 20. ReviewAssignment
    await t.test("20. ReviewAssignment: validates correctly and strips internal_reviewer_notes in public DTO", () => {
      const valid = ReviewAssignmentSchema.parse({
        review_id: "rev_001",
        task_id: "task_v3_001",
        reviewer_agent_id: "flash-01",
        assigned_by: "chatgpt-01",
        review_status: "approved",
        verdict: "pass",
        public_feedback: "Architecture satisfies modularity requirements",
        internal_reviewer_notes: "CTO private remark: verify rollback handling in G2",
        created_at: VALID_ISO,
        completed_at: VALID_ISO
      });

      const publicDto = toPublicReviewAssignmentDTO(valid);
      assert.equal("internal_reviewer_notes" in publicDto, false);

      // Rejection check: invalid verdict
      assert.throws(() => {
        ReviewAssignmentSchema.parse({ ...valid, verdict: "outstanding" as any });
      });
    });

    // 21. ArtifactAttestation
    await t.test("21. ArtifactAttestation: validates correctly and strips verification_signature & internal_audit_trail", () => {
      const valid = ArtifactAttestationSchema.parse({
        attestation_id: "attest_001",
        task_id: "task_v3_001",
        artifact_path: "docs/implementation/v3/phase-1/SPEC.md",
        artifact_sha256: VALID_SHA256,
        byte_size: 4500,
        attested_by_agent_id: "flash-02",
        attestation_type: "report",
        verification_signature: "ed25519_sig_secret_token_abc123",
        internal_audit_trail: "Computed with Node crypto sha256 at host-01",
        created_at: VALID_ISO
      });

      const publicDto = toPublicArtifactAttestationDTO(valid);
      assert.equal("verification_signature" in publicDto, false);
      assert.equal("internal_audit_trail" in publicDto, false);

      // Rejection check: invalid attestation_type
      assert.throws(() => {
        ArtifactAttestationSchema.parse({ ...valid, attestation_type: "binary_executable" as any });
      });
    });
  });

  await suite.test("Group 5: Knowledge & Memory Entities (3 Entities)", async (t) => {
    // 22. MemoryRecordV3
    await t.test("22. MemoryRecordV3: validates correctly and strips raw_context_bytes in public DTO", () => {
      const valid = MemoryRecordV3Schema.parse({
        memory_id: "mem_001",
        owner_agent_id: "flash-02",
        scope: "PROJECT",
        category: "ARCHITECTURAL_DECISION",
        key: "sandbox_migration_policy",
        content: "Never allow migrations on production DB data/aico.db",
        raw_context_bytes: "base64:H4sIC...binary_stream",
        access_count: 3,
        confidence_score: 0.95,
        created_at: VALID_ISO,
        updated_at: VALID_ISO
      });

      const publicDto = toPublicMemoryRecordV3DTO(valid);
      assert.equal("raw_context_bytes" in publicDto, false);

      // Rejection check: confidence_score > 1.0
      assert.throws(() => {
        MemoryRecordV3Schema.parse({ ...valid, confidence_score: 1.2 });
      });
    });

    // 23. KnowledgeChunkFTS
    await t.test("23. KnowledgeChunkFTS: validates correctly and strips embedding_vector_ref in public DTO", () => {
      const valid = KnowledgeChunkFTSSchema.parse({
        chunk_id: "chunk_001",
        memory_id: "mem_001",
        title: "Database Safety Gate",
        chunk_content: "All migrations must verify database path before running DDL.",
        tags: ["database", "safety", "v3"],
        embedding_vector_ref: "vec_idx_chroma_secret_ptr_441",
        created_at: VALID_ISO
      });

      const publicDto = toPublicKnowledgeChunkFTSDTO(valid);
      assert.equal("embedding_vector_ref" in publicDto, false);

      // Rejection check: empty title
      assert.throws(() => {
        KnowledgeChunkFTSSchema.parse({ ...valid, title: "" });
      });
    });

    // 24. ContextSnapshot
    await t.test("24. ContextSnapshot: validates correctly and strips snapshot_data & encryption_iv in public DTO", () => {
      const valid = ContextSnapshotSchema.parse({
        snapshot_id: "snap_001",
        task_id: "task_v3_001",
        agent_id: "flash-02",
        summary: "Context snapshot before G2 migration execution",
        token_count: 35000,
        snapshot_data: '{"messages":[{"role":"user","content":"start"}]}',
        encryption_iv: "aes_gcm_iv_deadbeef_12bytes",
        created_at: VALID_ISO
      });

      const publicDto = toPublicContextSnapshotDTO(valid);
      assert.equal("snapshot_data" in publicDto, false);
      assert.equal("encryption_iv" in publicDto, false);
      assert.equal(publicDto.token_count, 35000);

      // Rejection check: negative token_count
      assert.throws(() => {
        ContextSnapshotSchema.parse({ ...valid, token_count: -1 });
      });
    });
  });
});

test("T17 Regression: P1 Blocker #2 — Public DTO Metadata & Nested Sensitive Data Sanitization", async (suite) => {
  const SENSITIVE_SECRETS = [
    "sk-proj-secret1234567890abcdef",
    "aico_live_supersecret987654321",
    "ghp_secretTokenValue1234567890",
    "Bearer secret_jwt_token_value_123",
    "Bearer secret+/jwt+token/value==12345",
    "-----BEGIN RSA PRIVATE KEY-----",
    "-----END RSA PRIVATE KEY-----",
    "MIIEpAIBAAKCAQEA_FAKE_PRIVATE_KEY_BODY",
    "https://svc_user:secret_pass@",
    "secret_pass"
  ] as const;

  const INTERNAL_ROUTING_DETAILS = {
    broker_host: "internal-rabbit-01.corp.local",
    internal_queue_url: "amqp://svc_user:internal_pass@mq.internal:5672/v3",
    worker_pid: 48291
  } as const;

  const PRIVATE_IDENTIFIERS = {
    personal_email: "private.person@personal-mail.example",
    ssn_last4: "9876",
    resident_address: "742 Confidential Lane Apt 9B"
  } as const;

  function buildNestedSensitivePayload(
    extraFields: Record<string, unknown> = {}
  ): Record<string, unknown> {
    const payload: Record<string, unknown> = {
      ...extraFields,
      nested_level_1: {
        api_credentials: {
          openai_key: "sk-proj-secret1234567890abcdef",
          aico_key: "aico_live_supersecret987654321",
          github_pat: "ghp_secretTokenValue1234567890",
          auth_header: "Bearer secret_jwt_token_value_123",
          pem_key: "-----BEGIN RSA PRIVATE KEY-----\nMIIEpAIBAAKCAQEA_FAKE_PRIVATE_KEY_BODY"
        },
        routing: {
          broker_host: INTERNAL_ROUTING_DETAILS.broker_host,
          internal_queue_url: INTERNAL_ROUTING_DETAILS.internal_queue_url,
          worker_pid: INTERNAL_ROUTING_DETAILS.worker_pid
        },
        pii: {
          personal_email: PRIVATE_IDENTIFIERS.personal_email,
          ssn_last4: PRIVATE_IDENTIFIERS.ssn_last4,
          resident_address: PRIVATE_IDENTIFIERS.resident_address
        }
      },
      nested_array_secrets: [
        {
          level2: {
            token: "sk-proj-secret1234567890abcdef",
            bearer: "Bearer secret_jwt_token_value_123",
            ssn_last4: PRIVATE_IDENTIFIERS.ssn_last4
          }
        }
      ]
    };

    Object.defineProperty(payload, "__proto__", {
      value: {
        admin: true,
        leaked_token: "sk-proj-secret1234567890abcdef",
        deep: { broker_host: INTERNAL_ROUTING_DETAILS.broker_host }
      },
      enumerable: true,
      writable: true,
      configurable: true
    });
    Object.defineProperty(payload, "constructor", {
      value: {
        prototype: {
          injected_key: "aico_live_supersecret987654321",
          internal_queue_url: INTERNAL_ROUTING_DETAILS.internal_queue_url
        }
      },
      enumerable: true,
      writable: true,
      configurable: true
    });
    Object.defineProperty(payload, "prototype", {
      value: {
        private_key: "-----BEGIN RSA PRIVATE KEY-----\nMIIEpAIBAAKCAQEA_FAKE_PRIVATE_KEY_BODY",
        personal_email: PRIVATE_IDENTIFIERS.personal_email
      },
      enumerable: true,
      writable: true,
      configurable: true
    });

    return payload;
  }

  function assertNoSensitiveLeak(publicDto: unknown): void {
    const serialized = JSON.stringify(publicDto);
    const forbiddenSubstrings = [
      ...SENSITIVE_SECRETS,
      INTERNAL_ROUTING_DETAILS.broker_host,
      INTERNAL_ROUTING_DETAILS.internal_queue_url,
      String(INTERNAL_ROUTING_DETAILS.worker_pid),
      PRIVATE_IDENTIFIERS.personal_email,
      PRIVATE_IDENTIFIERS.ssn_last4,
      PRIVATE_IDENTIFIERS.resident_address,
      "broker_host",
      "internal_queue_url",
      "worker_pid",
      "personal_email",
      "ssn_last4",
      "resident_address"
    ];

    for (const needle of forbiddenSubstrings) {
      assert.equal(
        serialized.includes(needle),
        false,
        `Public DTO serialization must not leak sensitive substring: ${needle}`
      );
    }
  }

  function assertNoOwnDangerousKeys(record: Record<string, unknown>): void {
    for (const key of ["__proto__", "constructor", "prototype"]) {
      assert.equal(
        Object.prototype.hasOwnProperty.call(record, key),
        false,
        `Projected record must not have own dangerous key: ${key}`
      );
    }
  }

  await suite.test("Entity 3 (ChatMessage): strips nested secrets, internal_metadata, raw_token_trace & dangerous keys while preserving allowlist", () => {
    const safeMetadata = {
      thread_title: "Phase 1 Security Hardening",
      topic: "dto-sanitization",
      priority_label: "high" as const,
      ui_display_mode: "code" as const,
      related_task_id: "task_v3_001",
      tags: ["security", "dto", "v3"],
      reply_preview: "Reviewing DTO projection boundaries",
      format_version: "1.0"
    };

    assert.deepEqual(
      [...PUBLIC_CHAT_MESSAGE_METADATA_KEYS].sort(),
      Object.keys(safeMetadata).sort()
    );

    const entity = ChatMessageSchema.parse({
      message_id: "msg_reg_001",
      room_id: "room_exec_01",
      sender_id: "chatgpt-01",
      sender_type: "agent",
      message_type: "DIRECTIVE",
      content: "Verify DTO boundaries",
      reply_to_id: null,
      mentions: ["flash-02"],
      metadata: buildNestedSensitivePayload(safeMetadata),
      internal_metadata: buildNestedSensitivePayload(),
      raw_token_trace: "trace token=sk-proj-secret1234567890abcdef auth=Bearer secret_jwt_token_value_123",
      is_edited: false,
      created_at: VALID_ISO,
      updated_at: VALID_ISO
    });

    const publicDto = toPublicChatMessageDTO(entity);

    assert.equal("raw_token_trace" in publicDto, false);
    assert.equal("internal_metadata" in publicDto, false);
    assert.deepEqual(publicDto.metadata, safeMetadata);
    assertNoOwnDangerousKeys(publicDto.metadata as Record<string, unknown>);
    assertNoSensitiveLeak(publicDto);

    // Also verify raw JSON-parsed input bypassing ChatMessageSchema.parse (with own __proto__ key intact)
    const rawUnparsedMessage = {
      ...entity,
      metadata: buildNestedSensitivePayload(safeMetadata)
    };
    assert.equal(
      Object.prototype.hasOwnProperty.call(rawUnparsedMessage.metadata, "__proto__"),
      true
    );
    const publicFromRaw = toPublicChatMessageDTO(rawUnparsedMessage);
    assert.deepEqual(publicFromRaw.metadata, safeMetadata);
    assertNoOwnDangerousKeys(publicFromRaw.metadata as Record<string, unknown>);
    assertNoSensitiveLeak(publicFromRaw);
  });

  await suite.test("Entity 3 (ChatMessage): redacts secrets inside allowlisted string and array metadata fields", () => {
    const entity = ChatMessageSchema.parse({
      message_id: "msg_reg_002",
      room_id: "room_exec_01",
      sender_id: "flash-02",
      sender_type: "agent",
      message_type: "TEXT",
      content: "Sanitizing allowlisted fields",
      metadata: {
        thread_title: "Incident sk-proj-secret1234567890abcdef rotated",
        topic: "Auth aico_live_supersecret987654321 audit",
        related_task_id: "task_ghp_secretTokenValue1234567890",
        reply_preview:
          "Header Bearer secret+/jwt+token/value==12345 and -----BEGIN RSA PRIVATE KEY-----\nMIIEpAIBAAKCAQEA_FAKE_PRIVATE_KEY_BODY\n-----END RSA PRIVATE KEY-----",
        tags: [
          "clean-tag",
          "openai:sk-proj-secret1234567890abcdef",
          "pat:ghp_secretTokenValue1234567890",
          "auth:Bearer secret_jwt_token_value_123",
          "url:https://svc_user:secret_pass@mq.internal/hook"
        ]
      },
      created_at: VALID_ISO,
      updated_at: VALID_ISO
    });

    const publicDto = toPublicChatMessageDTO(entity);

    assert.equal(publicDto.metadata.thread_title, "Incident [REDACTED_SECRET] rotated");
    assert.equal(publicDto.metadata.topic, "Auth [REDACTED_SECRET] audit");
    assert.equal(publicDto.metadata.related_task_id, "task_[REDACTED_SECRET]");
    assert.equal(
      publicDto.metadata.reply_preview,
      "Header [REDACTED_SECRET] and [REDACTED_SECRET]"
    );
    assert.deepEqual(publicDto.metadata.tags, [
      "clean-tag",
      "openai:[REDACTED_SECRET]",
      "pat:[REDACTED_SECRET]",
      "auth:[REDACTED_SECRET]",
      "url:[REDACTED_SECRET]mq.internal/hook"
    ]);
    assertNoSensitiveLeak(publicDto);
  });

  await suite.test("Entity 3 (ChatMessage): fails closed with ZodError on allowlisted metadata type confusion", () => {
    const base = {
      message_id: "msg_reg_003",
      room_id: "room_exec_01",
      sender_id: "flash-02",
      sender_type: "agent" as const,
      content: "Type confusion check",
      created_at: VALID_ISO,
      updated_at: VALID_ISO
    };

    const confusedPayloads: Record<string, unknown>[] = [
      { topic: { leaked: "sk-proj-secret1234567890abcdef" } },
      { thread_title: ["sk-proj-secret1234567890abcdef"] },
      { tags: [{ secret: "aico_live_supersecret987654321" }] },
      { priority_label: "invalid_tier" },
      { ui_display_mode: { mode: "code" } }
    ];

    for (const metadata of confusedPayloads) {
      const entity = ChatMessageSchema.parse({ ...base, metadata });
      assert.throws(() => toPublicChatMessageDTO(entity), ZodError);
    }
  });

  await suite.test("Entity 3 (ChatMessage): PublicChatMessageDTOSchema strictly rejects un-allowlisted and nested unknown metadata keys", () => {
    const basePublic = {
      message_id: "msg_reg_004",
      room_id: "room_exec_01",
      sender_id: "flash-02",
      sender_type: "agent" as const,
      message_type: "TEXT" as const,
      content: "Strict schema check",
      reply_to_id: null,
      mentions: [],
      is_edited: false,
      created_at: VALID_ISO,
      updated_at: VALID_ISO
    };

    assert.throws(
      () =>
        PublicChatMessageDTOSchema.parse({
          ...basePublic,
          metadata: {
            topic: "ok",
            broker_host: INTERNAL_ROUTING_DETAILS.broker_host
          }
        }),
      ZodError
    );

    assert.throws(
      () =>
        PublicChatMessageDTOSchema.parse({
          ...basePublic,
          metadata: {
            nested: { secret: "sk-proj-secret1234567890abcdef" }
          }
        }),
      ZodError
    );

    assert.throws(
      () =>
        PublicChatMessageDTOSchema.parse({
          ...basePublic,
          metadata: JSON.parse(
            '{"__proto__":{"leaked":"sk-proj-secret1234567890abcdef"},"constructor":{"x":1},"prototype":{"y":2}}'
          )
        }),
      ZodError
    );
  });

  await suite.test("Entity 7 (RoomAuditLog): strips nested details, internal_details, security_context_snapshot & dangerous keys while preserving allowlist", () => {
    const safeDetails = {
      target: "room_exec_01",
      target_principal_id: "codex-01",
      previous_role: "viewer",
      new_role: "member",
      reason: "Approved onboarding for Phase 1",
      summary: "Added codex-01 as room member"
    };

    assert.deepEqual(
      [...PUBLIC_ROOM_AUDIT_DETAILS_KEYS].sort(),
      Object.keys(safeDetails).sort()
    );

    const entity = RoomAuditLogSchema.parse({
      audit_id: "ral_reg_001",
      room_id: "room_exec_01",
      action: "role_updated",
      actor_id: "chatgpt-01",
      details: buildNestedSensitivePayload(safeDetails),
      internal_details: buildNestedSensitivePayload(),
      security_context_snapshot:
        "auth=Bearer secret_jwt_token_value_123; key=aico_live_supersecret987654321; email=private.person@personal-mail.example",
      created_at: VALID_ISO
    });

    const publicDto = toPublicRoomAuditLogDTO(entity);

    assert.equal("security_context_snapshot" in publicDto, false);
    assert.equal("internal_details" in publicDto, false);
    assert.deepEqual(publicDto.details, safeDetails);
    assertNoOwnDangerousKeys(publicDto.details as Record<string, unknown>);
    assertNoSensitiveLeak(publicDto);

    // Also verify raw JSON-parsed input bypassing RoomAuditLogSchema.parse (with own __proto__ key intact)
    const rawUnparsedLog = {
      ...entity,
      details: buildNestedSensitivePayload(safeDetails)
    };
    assert.equal(
      Object.prototype.hasOwnProperty.call(rawUnparsedLog.details, "__proto__"),
      true
    );
    const publicFromRaw = toPublicRoomAuditLogDTO(rawUnparsedLog);
    assert.deepEqual(publicFromRaw.details, safeDetails);
    assertNoOwnDangerousKeys(publicFromRaw.details as Record<string, unknown>);
    assertNoSensitiveLeak(publicFromRaw);
  });

  await suite.test("Entity 7 (RoomAuditLog): redacts secrets inside allowlisted string details fields", () => {
    const entity = RoomAuditLogSchema.parse({
      audit_id: "ral_reg_002",
      room_id: "room_exec_01",
      action: "member_removed",
      actor_id: "flash-01",
      details: {
        target: "token:aico_live_supersecret987654321",
        reason: "Exposed ghp_secretTokenValue1234567890 and Bearer secret+/jwt+token/value==12345",
        summary:
          "Revoked sk-proj-secret1234567890abcdef and -----BEGIN RSA PRIVATE KEY-----\nMIIEpAIBAAKCAQEA_FAKE_PRIVATE_KEY_BODY\n-----END RSA PRIVATE KEY-----"
      },
      created_at: VALID_ISO
    });

    const publicDto = toPublicRoomAuditLogDTO(entity);

    assert.equal(publicDto.details.target, "token:[REDACTED_SECRET]");
    assert.equal(
      publicDto.details.reason,
      "Exposed [REDACTED_SECRET] and [REDACTED_SECRET]"
    );
    assert.equal(
      publicDto.details.summary,
      "Revoked [REDACTED_SECRET] and [REDACTED_SECRET]"
    );
    assertNoSensitiveLeak(publicDto);
  });

  await suite.test("Entity 7 (RoomAuditLog): fails closed with ZodError on allowlisted details type confusion", () => {
    const base = {
      audit_id: "ral_reg_003",
      room_id: "room_exec_01",
      action: "room_archived" as const,
      actor_id: "chatgpt-01",
      created_at: VALID_ISO
    };

    const confusedDetails: Record<string, unknown>[] = [
      { summary: { leaked: "sk-proj-secret1234567890abcdef" } },
      { reason: ["Bearer secret_jwt_token_value_123"] },
      { target: 12345 }
    ];

    for (const details of confusedDetails) {
      const entity = RoomAuditLogSchema.parse({ ...base, details });
      assert.throws(() => toPublicRoomAuditLogDTO(entity), ZodError);
    }
  });

  await suite.test("Entity 7 (RoomAuditLog): PublicRoomAuditLogDTOSchema strictly rejects un-allowlisted and nested unknown details keys", () => {
    const basePublic = {
      audit_id: "ral_reg_004",
      room_id: "room_exec_01",
      action: "member_added" as const,
      actor_id: "chatgpt-01",
      created_at: VALID_ISO
    };

    assert.throws(
      () =>
        PublicRoomAuditLogDTOSchema.parse({
          ...basePublic,
          details: {
            summary: "ok",
            personal_email: PRIVATE_IDENTIFIERS.personal_email
          }
        }),
      ZodError
    );

    assert.throws(
      () =>
        PublicRoomAuditLogDTOSchema.parse({
          ...basePublic,
          details: {
            nested: { broker_host: INTERNAL_ROUTING_DETAILS.broker_host }
          }
        }),
      ZodError
    );

    assert.throws(
      () =>
        PublicRoomAuditLogDTOSchema.parse({
          ...basePublic,
          details: JSON.parse(
            '{"__proto__":{"leaked":"aico_live_supersecret987654321"},"constructor":{"x":1},"prototype":{"y":2}}'
          )
        }),
      ZodError
    );
  });

  await suite.test("Entity 8 (OutboxEvent): omits internal_routing_key and deeply nested sensitive payload cleanly", () => {
    const entity = OutboxEventSchema.parse({
      event_id: "evt_reg_001",
      aggregate_type: "PROJECT_TASK",
      aggregate_id: "task_v3_001",
      event_type: "TASK_DISPATCHED",
      payload: buildNestedSensitivePayload(),
      status: "pending",
      retry_count: 1,
      max_retries: 5,
      last_error: null,
      internal_routing_key:
        "amqp://svc_user:internal_pass@mq.internal:5672/v3#sk-proj-secret1234567890abcdef",
      scheduled_for: VALID_ISO,
      processed_at: null,
      created_at: VALID_ISO
    });

    const publicDto = toPublicOutboxEventDTO(entity);

    assert.equal("internal_routing_key" in publicDto, false);
    assert.equal("payload" in publicDto, false);
    assert.equal(publicDto.event_id, "evt_reg_001");
    assert.equal(publicDto.event_type, "TASK_DISPATCHED");
    assertNoSensitiveLeak(publicDto);
  });

  await suite.test("Entity 8 (OutboxEvent): redacts secret tokens, PEM blocks, and URL credentials in last_error", () => {
    const entity = OutboxEventSchema.parse({
      event_id: "evt_reg_002",
      aggregate_type: "PROJECT_TASK",
      aggregate_id: "task_v3_001",
      event_type: "TASK_DISPATCHED",
      payload: buildNestedSensitivePayload(),
      status: "failed",
      retry_count: 2,
      max_retries: 5,
      last_error:
        "Dispatch failed for https://svc_user:secret_pass@mq.internal/hook with sk-proj-secret1234567890abcdef and Bearer secret+/jwt+token/value==12345",
      internal_routing_key: "internal.secret.route",
      scheduled_for: VALID_ISO,
      processed_at: null,
      created_at: VALID_ISO
    });

    const publicDto = toPublicOutboxEventDTO(entity);

    assert.equal("internal_routing_key" in publicDto, false);
    assert.equal("payload" in publicDto, false);
    assert.equal(
      publicDto.last_error,
      "Dispatch failed for [REDACTED_SECRET]mq.internal/hook with [REDACTED_SECRET] and [REDACTED_SECRET]"
    );
    assertNoSensitiveLeak(publicDto);

    const nullErrDto = toPublicOutboxEventDTO(
      OutboxEventSchema.parse({ ...entity, event_id: "evt_reg_003", last_error: null })
    );
    assert.equal(nullErrDto.last_error, null);
  });

  await suite.test("Entity 9 (EventSubscription): strips auth_secret_hash and redacts URL credentials & tokens in endpoint", () => {
    const entity = EventSubscriptionSchema.parse({
      subscription_id: "sub_reg_001",
      subscriber_id: "audit-worker",
      event_pattern: "TASK_*",
      endpoint: "https://svc_user:secret_pass@mq.internal/hook?token=aico_live_supersecret987654321",
      is_active: true,
      auth_secret_hash: VALID_SHA256,
      created_at: VALID_ISO,
      updated_at: VALID_ISO
    });

    const publicDto = toPublicEventSubscriptionDTO(entity);

    assert.equal("auth_secret_hash" in publicDto, false);
    assert.equal(
      publicDto.endpoint,
      "[REDACTED_SECRET]mq.internal/hook?token=[REDACTED_SECRET]"
    );
    assertNoSensitiveLeak(publicDto);
  });

  await suite.test("Entity 10 (DeadLetterQueue): omits stack_trace and deeply nested sensitive payload cleanly", () => {
    const entity = DeadLetterQueueSchema.parse({
      dlq_id: "dlq_reg_001",
      original_event_id: "evt_reg_001",
      event_type: "TASK_DISPATCHED",
      payload: buildNestedSensitivePayload(),
      failure_reason: "Downstream consumer rejected event after max retries",
      stack_trace:
        "Error: auth failed with Bearer secret_jwt_token_value_123 at internal-rabbit-01.corp.local (pid 48291)\n" +
        "    at DeliveryWorker (aico_live_supersecret987654321)",
      resolved: false,
      resolved_by: null,
      resolved_at: null,
      failed_at: VALID_ISO
    });

    const publicDto = toPublicDeadLetterQueueDTO(entity);

    assert.equal("stack_trace" in publicDto, false);
    assert.equal("payload" in publicDto, false);
    assert.equal(publicDto.dlq_id, "dlq_reg_001");
    assert.equal(publicDto.failure_reason, "Downstream consumer rejected event after max retries");
    assertNoSensitiveLeak(publicDto);
  });

  await suite.test("Entity 10 (DeadLetterQueue): redacts secret tokens, PEM blocks, and URL credentials in failure_reason", () => {
    const entity = DeadLetterQueueSchema.parse({
      dlq_id: "dlq_reg_002",
      original_event_id: "evt_reg_002",
      event_type: "TASK_DISPATCHED",
      payload: buildNestedSensitivePayload(),
      failure_reason:
        "Webhook https://svc_user:secret_pass@mq.internal/hook rejected ghp_secretTokenValue1234567890 key -----BEGIN RSA PRIVATE KEY-----\nMIIEpAIBAAKCAQEA_FAKE_PRIVATE_KEY_BODY\n-----END RSA PRIVATE KEY-----",
      stack_trace: "Error at Worker.deliver",
      resolved: false,
      resolved_by: null,
      resolved_at: null,
      failed_at: VALID_ISO
    });

    const publicDto = toPublicDeadLetterQueueDTO(entity);

    assert.equal("stack_trace" in publicDto, false);
    assert.equal("payload" in publicDto, false);
    assert.equal(
      publicDto.failure_reason,
      "Webhook [REDACTED_SECRET]mq.internal/hook rejected [REDACTED_SECRET] key [REDACTED_SECRET]"
    );
    assertNoSensitiveLeak(publicDto);
  });

  await suite.test("Entity 11 (DeliveryAttempt): strips internal_worker_id and redacts tokens & URL credentials in error_message", () => {
    const entity = DeliveryAttemptSchema.parse({
      attempt_id: "att_reg_001",
      outbox_event_id: "evt_reg_002",
      attempt_number: 1,
      status: "failed",
      response_code: 502,
      error_message:
        "502 from https://svc_user:secret_pass@mq.internal/hook (Bearer secret+/jwt+token/value==12345)",
      internal_worker_id: "worker-proc-node-9912",
      latency_ms: 412.3,
      attempted_at: VALID_ISO
    });

    const publicDto = toPublicDeliveryAttemptDTO(entity);

    assert.equal("internal_worker_id" in publicDto, false);
    assert.equal(
      publicDto.error_message,
      "502 from [REDACTED_SECRET]mq.internal/hook ([REDACTED_SECRET])"
    );
    assertNoSensitiveLeak(publicDto);

    const nullErrDto = toPublicDeliveryAttemptDTO(
      DeliveryAttemptSchema.parse({
        ...entity,
        attempt_id: "att_reg_002",
        status: "success",
        response_code: 200,
        error_message: null
      })
    );
    assert.equal(nullErrDto.error_message, null);
  });

  await suite.test("Sanitization Helper (projectPublicAllowlistedRecord): ignores prototype properties, dangerous keys, invalid sources & handles nested recursion with cycle guard", () => {
    const inheritedSource = Object.create({
      thread_title: "sk-proj-secret1234567890abcdef",
      topic: "inherited-should-not-leak"
    });
    assert.deepEqual(
      projectPublicAllowlistedRecord(inheritedSource, PUBLIC_CHAT_MESSAGE_METADATA_KEYS),
      {}
    );

    assert.deepEqual(
      projectPublicAllowlistedRecord(null, PUBLIC_CHAT_MESSAGE_METADATA_KEYS),
      {}
    );
    assert.deepEqual(
      projectPublicAllowlistedRecord(
        ["sk-proj-secret1234567890abcdef"] as unknown as Record<string, unknown>,
        PUBLIC_CHAT_MESSAGE_METADATA_KEYS
      ),
      {}
    );

    const dangerousSource = JSON.parse(
      '{"__proto__":{"a":1},"constructor":{"b":2},"prototype":{"c":3},"topic":"safe"}'
    ) as Record<string, unknown>;
    const projected = projectPublicAllowlistedRecord(dangerousSource, [
      "__proto__",
      "constructor",
      "prototype",
      "topic"
    ]);
    assert.deepEqual(projected, { topic: "safe" });
    assertNoOwnDangerousKeys(projected);

    // Recursive nested object/array sanitization & dangerous key stripping inside allowlisted structure
    const nestedRecord = JSON.parse(
      '{"nested":{"__proto__":{"x":1},"constructor":{"y":2},"secret":"sk-proj-secret1234567890abcdef","items":[{"url":"https://svc_user:secret_pass@mq.internal/hook"}]}}'
    ) as Record<string, unknown>;
    const sanitizedNested = projectPublicAllowlistedRecord(nestedRecord, ["nested"]);
    assert.deepEqual(sanitizedNested, {
      nested: {
        secret: "[REDACTED_SECRET]",
        items: [{ url: "[REDACTED_SECRET]mq.internal/hook" }]
      }
    });
    assertNoOwnDangerousKeys(sanitizedNested.nested as Record<string, unknown>);
    assertNoSensitiveLeak(sanitizedNested);

    // Cycle & shared DAG guard prevents infinite recursion AND never returns unredacted source refs
    const sharedBranch = ["sk-proj-secret1234567890abcdef"];
    const cyclic: Record<string, unknown> = {
      token: "aico_live_supersecret987654321",
      dag: [sharedBranch, sharedBranch]
    };
    cyclic.self = cyclic;
    const projectedCyclic = projectPublicAllowlistedRecord({ nested: cyclic }, ["nested"]);
    const sanitizedCyclic = projectedCyclic.nested as Record<string, unknown>;
    assert.equal(sanitizedCyclic.token, "[REDACTED_SECRET]");
    assert.equal(sanitizedCyclic.self, sanitizedCyclic);
    assert.deepEqual(sanitizedCyclic.dag, [
      ["[REDACTED_SECRET]"],
      ["[REDACTED_SECRET]"]
    ]);
    assert.equal((sanitizedCyclic.dag as unknown[])[0], (sanitizedCyclic.dag as unknown[])[1]);
    assert.notEqual(sanitizedCyclic.self, cyclic);
  });
});
