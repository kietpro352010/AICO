import { ConnectionManager } from "../db/connection-manager.js";

export type ExternalMilestone =
  | "operator_delivered"
  | "external_invocation_confirmed"
  | "delivery_failed";

export interface RecordExternalDispatchParams {
  taskId: string;
  milestone: ExternalMilestone;
  actorPrincipalId: string;
  notes?: string;
}

export interface ExternalDispatchResult {
  success: boolean;
  task_id: string;
  milestone: ExternalMilestone;
  dispatch_status: string;
  recorded_at: string;
}

export class OrchestrationService {
  private connManager: ConnectionManager;

  constructor(connManager: ConnectionManager) {
    this.connManager = connManager;
  }

  public recordExternalDispatchMilestone(params: RecordExternalDispatchParams): ExternalDispatchResult {
    const validMilestones: ExternalMilestone[] = [
      "operator_delivered",
      "external_invocation_confirmed",
      "delivery_failed"
    ];

    if (!validMilestones.includes(params.milestone)) {
      throw new Error(`VALIDATION_ERROR: Invalid milestone '${params.milestone}'. Must be one of: ${validMilestones.join(", ")}`);
    }

    const now = new Date().toISOString();

    let newDispatchStatus: string;
    switch (params.milestone) {
      case "operator_delivered":
        newDispatchStatus = "operator_delivered";
        break;
      case "external_invocation_confirmed":
        newDispatchStatus = "external_running";
        break;
      case "delivery_failed":
        newDispatchStatus = "delivery_failed";
        break;
    }

    return this.connManager.withWriteTransaction((db) => {
      const task = db.prepare("SELECT * FROM tasks WHERE task_id = ?").get(params.taskId) as any;
      if (!task) {
        throw new Error(`RESOURCE_NOT_FOUND: Task ${params.taskId} not found`);
      }

      db.prepare(`
        UPDATE tasks
        SET dispatch_status = ?, updated_at = ?
        WHERE task_id = ?
      `).run(newDispatchStatus, now, params.taskId);

      return {
        success: true,
        task_id: params.taskId,
        milestone: params.milestone,
        dispatch_status: newDispatchStatus,
        recorded_at: now
      };
    });
  }
}
