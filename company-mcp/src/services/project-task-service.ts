import { ConnectionManager } from "../db/connection-manager.js";

export type TaskExecutionStatus =
  | "draft"
  | "queued"
  | "assigned"
  | "claimed"
  | "in_progress"
  | "blocked"
  | "waiting_approval"
  | "review_required"
  | "rework"
  | "completed"
  | "failed"
  | "cancelled"
  | "archived";

export type TaskDispatchStatus =
  | "not_dispatched"
  | "approval_pending"
  | "handoff_ready"
  | "queued_for_client_pull"
  | "awaiting_operator_delivery"
  | "operator_delivered"
  | "external_running"
  | "delivery_failed"
  | "result_received";

export interface TaskRecord {
  task_id: string;
  project_id: string;
  title: string;
  execution_status: TaskExecutionStatus;
  dispatch_status: TaskDispatchStatus;
  assigned_agent_id: string | null;
  lease_owner_agent_id: string | null;
  lease_expires_at: string | null;
  version: number;
  max_retries: number;
  retry_count: number;
  created_by: string;
}

export class ProjectTaskService {
  private connManager: ConnectionManager;

  constructor(connManager: ConnectionManager) {
    this.connManager = connManager;
  }

  public initSchema(): void {
    this.connManager.withWriteTransaction((db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS tasks (
          task_id TEXT PRIMARY KEY,
          project_id TEXT NOT NULL,
          title TEXT NOT NULL,
          execution_status TEXT NOT NULL DEFAULT 'draft',
          dispatch_status TEXT NOT NULL DEFAULT 'not_dispatched',
          assigned_agent_id TEXT,
          lease_owner_agent_id TEXT,
          lease_expires_at TEXT,
          version INTEGER NOT NULL DEFAULT 1,
          max_retries INTEGER NOT NULL DEFAULT 3,
          retry_count INTEGER NOT NULL DEFAULT 0,
          created_by TEXT NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS task_events (
          event_id TEXT PRIMARY KEY,
          task_id TEXT NOT NULL,
          from_status TEXT,
          to_status TEXT NOT NULL,
          actor_id TEXT NOT NULL,
          reason TEXT,
          created_at TEXT NOT NULL
        );
      `);
    });
  }

  public createTask(params: {
    taskId: string;
    projectId: string;
    title: string;
    assignedAgentId?: string;
    createdBy: string;
    riskClass?: "low" | "medium" | "high" | "critical";
  }): TaskRecord {
    const isArgon = params.assignedAgentId === "argon-01" || params.assignedAgentId === "argon-02";
    const initialExecutionStatus: TaskExecutionStatus =
      params.riskClass === "critical" || isArgon ? "waiting_approval" : "draft";
    const initialDispatchStatus: TaskDispatchStatus =
      params.riskClass === "critical" || isArgon ? "approval_pending" : "not_dispatched";
    const maxRetries = isArgon ? 0 : 3;

    const now = new Date().toISOString();

    return this.connManager.withWriteTransaction((db) => {
      db.prepare(`
        INSERT INTO tasks (
          task_id, project_id, title, execution_status, dispatch_status,
          assigned_agent_id, lease_owner_agent_id, lease_expires_at,
          version, max_retries, retry_count, created_by, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, NULL, NULL, 1, ?, 0, ?, ?, ?)
      `).run(
        params.taskId,
        params.projectId,
        params.title,
        initialExecutionStatus,
        initialDispatchStatus,
        params.assignedAgentId || null,
        maxRetries,
        params.createdBy,
        now,
        now
      );

      return {
        task_id: params.taskId,
        project_id: params.projectId,
        title: params.title,
        execution_status: initialExecutionStatus,
        dispatch_status: initialDispatchStatus,
        assigned_agent_id: params.assignedAgentId || null,
        lease_owner_agent_id: null,
        lease_expires_at: null,
        version: 1,
        max_retries: maxRetries,
        retry_count: 0,
        created_by: params.createdBy
      };
    });
  }

  public claimTask(params: { taskId: string; agentId: string; expectedVersion: number }): TaskRecord {
    const now = new Date();
    const leaseExpires = new Date(now.getTime() + 30 * 60 * 1000).toISOString();

    return this.connManager.withWriteTransaction((db) => {
      const task = db.prepare("SELECT * FROM tasks WHERE task_id = ?").get(params.taskId) as any;
      if (!task) throw new Error("Task not found");

      if (task.assigned_agent_id !== params.agentId) {
        throw new Error("ABAC_OWNERSHIP_OR_SOD_VIOLATION: Only assigned agent can claim task");
      }

      if (task.execution_status !== "assigned") {
        throw new Error(`TASK_INVALID_STATE_TRANSITION: Cannot claim task in state: ${task.execution_status}`);
      }

      if (task.version !== params.expectedVersion) {
        throw new Error("TASK_VERSION_CONFLICT: Optimistic lock mismatch");
      }

      db.prepare(`
        UPDATE tasks
        SET execution_status = 'claimed', lease_owner_agent_id = ?, lease_expires_at = ?,
            version = version + 1, updated_at = ?
        WHERE task_id = ?
      `).run(params.agentId, leaseExpires, now.toISOString(), params.taskId);

      return {
        ...task,
        execution_status: "claimed",
        lease_owner_agent_id: params.agentId,
        lease_expires_at: leaseExpires,
        version: task.version + 1
      };
    });
  }

  public reviewTask(params: {
    taskId: string;
    reviewerId: string;
    decision: "completed" | "rework";
    reason?: string;
  }): TaskRecord {
    const now = new Date().toISOString();

    return this.connManager.withWriteTransaction((db) => {
      const task = db.prepare("SELECT * FROM tasks WHERE task_id = ?").get(params.taskId) as any;
      if (!task) throw new Error("Task not found");

      // Strict Separation of Duties
      if (task.assigned_agent_id === params.reviewerId && params.reviewerId !== "founder-01") {
        throw new Error("ABAC_OWNERSHIP_OR_SOD_VIOLATION: Agent cannot review their own task");
      }

      if (task.execution_status !== "review_required") {
        throw new Error(`TASK_INVALID_STATE_TRANSITION: Task not in review_required state (current: ${task.execution_status})`);
      }

      db.prepare(`
        UPDATE tasks
        SET execution_status = ?, version = version + 1, updated_at = ?
        WHERE task_id = ?
      `).run(params.decision, now, params.taskId);

      return {
        ...task,
        execution_status: params.decision,
        version: task.version + 1
      };
    });
  }
}
