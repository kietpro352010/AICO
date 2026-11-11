import { ConnectionManager } from "../db/connection-manager.js";
import { type PrincipalContext } from "./identity-access-service.js";
import type { TaskDispatchStatus, TaskExecutionStatus } from "./project-task-service.js";

export type ExternalMilestone =
  | "operator_delivered"
  | "external_invocation_confirmed"
  | "delivery_failed";

export interface RecordExternalDispatchParams {
  taskId: string;
  milestone: ExternalMilestone;
  actorPrincipalId: string;
  expectedVersion?: number;
  notes?: string;
}

export interface ExternalDispatchResult {
  success: boolean;
  task_id: string;
  milestone: ExternalMilestone;
  dispatch_status: TaskDispatchStatus;
  version: number;
  idempotent_replay: boolean;
  recorded_at: string;
}

const DISPATCH_TARGET_STATUS: Record<ExternalMilestone, TaskDispatchStatus> = {
  operator_delivered: "operator_delivered",
  external_invocation_confirmed: "external_running",
  delivery_failed: "delivery_failed"
};

const ALLOWED_DISPATCH_EXECUTION_STATUSES: ReadonlySet<TaskExecutionStatus> = new Set([
  "assigned",
  "claimed",
  "in_progress"
]);

const DISPATCH_ALLOWED_FROM: Record<ExternalMilestone, ReadonlySet<TaskDispatchStatus>> = {
  operator_delivered: new Set([
    "awaiting_operator_delivery",
    "queued_for_client_pull",
    "handoff_ready",
    "delivery_failed",
    "not_dispatched"
  ]),
  external_invocation_confirmed: new Set([
    "operator_delivered",
    "awaiting_operator_delivery",
    "queued_for_client_pull"
  ]),
  delivery_failed: new Set([
    "awaiting_operator_delivery",
    "queued_for_client_pull",
    "operator_delivered"
  ])
};

export class OrchestrationService {
  private connManager: ConnectionManager;

  constructor(connManager: ConnectionManager) {
    this.connManager = connManager;
  }

  public recordExternalDispatchMilestone(
    params: RecordExternalDispatchParams,
    callerCtx?: PrincipalContext
  ): ExternalDispatchResult {
    if (!callerCtx || callerCtx.authenticated !== true || !callerCtx.principalId) {
      throw new Error(
        "AUTHENTICATION_REQUIRED: recordExternalDispatchMilestone requires an authenticated PrincipalContext"
      );
    }

    if (
      params.expectedVersion !== undefined &&
      (typeof params.expectedVersion !== "number" ||
        !Number.isInteger(params.expectedVersion) ||
        params.expectedVersion < 1)
    ) {
      throw new Error("VALIDATION_ERROR: expectedVersion must be a positive integer");
    }

    const validMilestones: ExternalMilestone[] = [
      "operator_delivered",
      "external_invocation_confirmed",
      "delivery_failed"
    ];

    if (!validMilestones.includes(params.milestone)) {
      throw new Error(
        `VALIDATION_ERROR: Invalid milestone '${params.milestone}'. Must be one of: ${validMilestones.join(", ")}`
      );
    }

    const now = new Date().toISOString();
    const newDispatchStatus = DISPATCH_TARGET_STATUS[params.milestone];

    return this.connManager.withWriteTransaction((db) => {
      const task = db.prepare("SELECT * FROM tasks WHERE task_id = ?").get(params.taskId) as any;
      if (!task) {
        throw new Error(`RESOURCE_NOT_FOUND: Task ${params.taskId} not found`);
      }

      // ABAC Authorization first: Founder, CEO, CTO, wildcard, or task's assigned agent
      const callerId = callerCtx.principalId;
      const callerAgentId = callerCtx.agentId || callerCtx.principalId;
      const isAuthorized =
        callerId === "founder-01" ||
        callerId === "chatgpt-01" ||
        callerId === "flash-01" ||
        (task.assigned_agent_id !== null && task.assigned_agent_id === callerAgentId) ||
        callerCtx.scopes.has("*");

      if (!isAuthorized) {
        throw new Error(
          `PERMISSION_DENIED: Caller '${callerId}' is not authorized to update dispatch status for task ${params.taskId}`
        );
      }

      if (params.expectedVersion !== undefined && task.version !== params.expectedVersion) {
        throw new Error(
          `TASK_VERSION_CONFLICT: Optimistic lock failure: expected version ${params.expectedVersion}, but found ${task.version}`
        );
      }

      const currentExecutionStatus = task.execution_status as TaskExecutionStatus;
      const currentDispatchStatus = task.dispatch_status as TaskDispatchStatus;

      if (!ALLOWED_DISPATCH_EXECUTION_STATUSES.has(currentExecutionStatus)) {
        throw new Error(
          `DISPATCH_INVALID_STATE_TRANSITION: Cannot record milestone '${params.milestone}' while task execution_status is '${currentExecutionStatus}'`
        );
      }

      // Idempotent retry when already at target dispatch_status
      if (currentDispatchStatus === newDispatchStatus) {
        return {
          success: true,
          task_id: params.taskId,
          milestone: params.milestone,
          dispatch_status: currentDispatchStatus,
          version: task.version,
          idempotent_replay: true,
          recorded_at: now
        };
      }

      const allowedSourceStatuses = DISPATCH_ALLOWED_FROM[params.milestone];
      if (!allowedSourceStatuses.has(currentDispatchStatus)) {
        throw new Error(
          `DISPATCH_INVALID_STATE_TRANSITION: Illegal dispatch transition for milestone '${params.milestone}' from '${currentDispatchStatus}' to '${newDispatchStatus}'`
        );
      }

      const operatorDeliveredAt =
        params.milestone === "operator_delivered"
          ? task.operator_delivered_at || now
          : task.operator_delivered_at;
      const externalInvokedAt =
        params.milestone === "external_invocation_confirmed"
          ? task.external_invoked_at || now
          : task.external_invoked_at;

      const upd = db
        .prepare(`
          UPDATE tasks
          SET dispatch_status = ?,
              operator_delivered_at = ?,
              external_invoked_at = ?,
              version = version + 1,
              updated_at = ?
          WHERE task_id = ?
            AND version = ?
            AND execution_status = ?
            AND dispatch_status = ?
        `)
        .run(
          newDispatchStatus,
          operatorDeliveredAt,
          externalInvokedAt,
          now,
          params.taskId,
          task.version,
          currentExecutionStatus,
          currentDispatchStatus
        );

      if (upd.changes === 0) {
        throw new Error(
          `TASK_VERSION_CONFLICT: Concurrent state change prevented recording dispatch milestone '${params.milestone}' on task '${params.taskId}'`
        );
      }

      const nextVersion = task.version + 1;
      db.prepare(`
        INSERT INTO task_events (
          task_id, actor_principal_type, actor_principal_id, event_type,
          from_execution_status, to_execution_status, from_dispatch_status,
          to_dispatch_status, task_version, approval_id, note, metadata_json, recorded_at
        ) VALUES (?, ?, ?, 'external_dispatch_milestone', ?, ?, ?, ?, ?, NULL, ?, ?, ?)
      `).run(
        params.taskId,
        callerCtx.principalType,
        callerId,
        currentExecutionStatus,
        currentExecutionStatus,
        currentDispatchStatus,
        newDispatchStatus,
        nextVersion,
        params.notes || `Dispatch milestone recorded: ${params.milestone}`,
        JSON.stringify({ milestone: params.milestone }),
        now
      );

      return {
        success: true,
        task_id: params.taskId,
        milestone: params.milestone,
        dispatch_status: newDispatchStatus,
        version: nextVersion,
        idempotent_replay: false,
        recorded_at: now
      };
    });
  }
}
