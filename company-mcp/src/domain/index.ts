/**
 * AICO V3 Domain Model Index
 * Exports 24 canonical domain entities with Zod schemas, TypeScript types,
 * Public DTO boundaries, and sanitizing projection functions.
 */

// Common
export * from "./common.js";
export * from "./sanitization.js";

// Core Collaboration (7 entities)
export * from "./collaboration/chat-room.js";
export * from "./collaboration/chat-member.js";
export * from "./collaboration/chat-message.js";
export * from "./collaboration/message-attachment.js";
export * from "./collaboration/message-reaction.js";
export * from "./collaboration/room-invite.js";
export * from "./collaboration/room-audit-log.js";

// Reliable Messaging & Outbox (4 entities)
export * from "./messaging/outbox-event.js";
export * from "./messaging/event-subscription.js";
export * from "./messaging/dead-letter-queue.js";
export * from "./messaging/delivery-attempt.js";

// Agent Coordination & Lifecycle (5 entities)
export * from "./coordination/agent-lease.js";
export * from "./coordination/agent-heartbeat.js";
export * from "./coordination/agent-capability.js";
export * from "./coordination/agent-quota-allocation.js";
export * from "./coordination/agent-execution-lock.js";

// Task Orchestration & Governance (5 entities)
export * from "./task-governance/project-task-v3.js";
export * from "./task-governance/task-transition-log.js";
export * from "./task-governance/task-approval-binding.js";
export * from "./task-governance/review-assignment.js";
export * from "./task-governance/artifact-attestation.js";

// Knowledge & Memory (3 entities)
export * from "./memory/memory-record-v3.js";
export * from "./memory/knowledge-chunk-fts.js";
export * from "./memory/context-snapshot.js";
