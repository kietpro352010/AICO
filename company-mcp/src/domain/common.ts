import { z } from "zod";

/**
 * Common Domain Types and Invariants
 */

export const IsoTimestampSchema = z.string().datetime({ offset: true }).or(
  z.string().regex(/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})?$/, "Invalid ISO/SQL datetime")
);

export const PrincipalTypeSchema = z.enum(["human", "agent", "system"]);
export type PrincipalType = z.infer<typeof PrincipalTypeSchema>;

export const RiskClassSchema = z.enum(["low", "medium", "high", "critical"]);
export type RiskClass = z.infer<typeof RiskClassSchema>;

export const PrioritySchema = z.enum(["low", "medium", "high", "critical"]);
export type Priority = z.infer<typeof PrioritySchema>;

export const ApprovalTierSchema = z.enum(["founder", "technical"]);
export type ApprovalTier = z.infer<typeof ApprovalTierSchema>;

export const MemoryScopeSchema = z.enum([
  "COMPANY",
  "PROJECT",
  "TASK",
  "ROOM",
  "AGENT_PRIVATE"
]);
export type MemoryScope = z.infer<typeof MemoryScopeSchema>;

export const MemoryCategorySchema = z.enum([
  "ARCHITECTURAL_DECISION",
  "INCIDENT_LEARNING",
  "PERFORMANCE_PATTERN",
  "FACT"
]);
export type MemoryCategory = z.infer<typeof MemoryCategorySchema>;

export const ChatRoomTypeSchema = z.enum([
  "EXECUTIVE_BOARDROOM",
  "ANNOUNCEMENTS",
  "DEPARTMENT_OFFICE",
  "PROJECT_ROOM",
  "TASK_ROOM",
  "DIRECT_MESSAGE"
]);
export type ChatRoomType = z.infer<typeof ChatRoomTypeSchema>;

export const ChatMessageTypeSchema = z.enum([
  "TEXT",
  "DIRECTIVE",
  "PROPOSAL",
  "REVIEW_FEEDBACK",
  "GATE_STATUS",
  "SYSTEM_NOTICE"
]);
export type ChatMessageType = z.infer<typeof ChatMessageTypeSchema>;

export const TaskExecutionStatusSchema = z.enum([
  "draft",
  "queued",
  "assigned",
  "claimed",
  "in_progress",
  "blocked",
  "waiting_approval",
  "review_required",
  "rework",
  "completed",
  "failed",
  "cancelled",
  "archived"
]);
export type TaskExecutionStatus = z.infer<typeof TaskExecutionStatusSchema>;

export const TaskDispatchStatusSchema = z.enum([
  "not_dispatched",
  "approval_pending",
  "handoff_ready",
  "queued_for_client_pull",
  "awaiting_operator_delivery",
  "operator_delivered",
  "external_running",
  "delivery_failed",
  "result_received"
]);
export type TaskDispatchStatus = z.infer<typeof TaskDispatchStatusSchema>;

export const OutboxStatusSchema = z.enum([
  "pending",
  "processing",
  "published",
  "failed",
  "dead_letter"
]);
export type OutboxStatus = z.infer<typeof OutboxStatusSchema>;
