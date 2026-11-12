import * as crypto from "node:crypto";
import { ConnectionManager } from "../db/connection-manager.js";
import {
  assertAuthenticatedContext,
  hasPrincipalScope,
  isArchiveLeadership,
  isExecutiveLeadership,
  isFounderHuman,
  isReviewLeadership,
  type PrincipalContext
} from "../security/context-store.js";
import { ApprovalService } from "./approval-service.js";

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

export interface ProjectRecord {
  project_id: string;
  name: string;
  description: string;
  status: string;
  owner_agent_id: string;
  priority: string;
  risk_class: string;
  created_at: string;
  updated_at: string;
}

export interface TaskRecord {
  task_id: string;
  idempotency_key: string;
  project_id: string;
  parent_task_id: string | null;
  title: string;
  objective: string;
  description: string;
  created_by_principal_type: string;
  created_by_principal_id: string;
  assigned_agent_id: string | null;
  reviewer_agent_id: string | null;
  priority: string;
  risk_class: string;
  execution_status: TaskExecutionStatus;
  dispatch_status: TaskDispatchStatus;
  acceptance_criteria_json: string;
  input_artifact_ids_json: string;
  output_artifact_ids_json: string;
  verification_evidence: string | null;
  workspace_id: string | null;
  branch_name: string | null;
  approval_request_id: string | null;
  lease_owner_agent_id: string | null;
  lease_expires_at: string | null;
  retry_count: number;
  max_retries: number;
  version: number;
  handoff_file_path: string | null;
  operator_delivered_at: string | null;
  external_invoked_at: string | null;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface TransitionInput {
  ctx?: PrincipalContext;
  taskId: string;
  expectedVersion: number;
  toStatus: TaskExecutionStatus;
  reason?: string;
  note?: string;
  approvalId?: string;
  outputArtifactIds?: string[];
  verificationEvidence?: string;
  metadata?: Record<string, unknown>;
  allowReviewAndAdminTransitions?: boolean;
}

function isArgonAgent(assignedAgentId: string | null | undefined): boolean {
  return assignedAgentId === "argon-01" || assignedAgentId === "argon-02";
}

function isCriticalGovernanceTask(task: { risk_class: string; priority: string }): boolean {
  return task.risk_class === "critical" || task.priority === "P0";
}

function requiresInitialFounderApproval(task: {
  assigned_agent_id: string | null;
  risk_class: string;
  priority: string;
}): boolean {
  return isArgonAgent(task.assigned_agent_id) || isCriticalGovernanceTask(task);
}

export class ProjectTaskService {
  private connManager: ConnectionManager;
  private approvalService?: ApprovalService;

  constructor(connManager: ConnectionManager, approvalService?: ApprovalService) {
    this.connManager = connManager;
    this.approvalService = approvalService;
  }

  private verifyAndConsumeTaskApproval(
    db: any,
    task: { task_id: string; assigned_agent_id: string | null; risk_class: string; priority: string },
    approvalId?: string
  ): void {
    const isArgon = task.assigned_agent_id === "argon-01" || task.assigned_agent_id === "argon-02";
    const isCritical = isCriticalGovernanceTask(task);
    if (!approvalId) {
      if (isArgon) {
        throw new Error(`ARGON_FOUNDER_APPROVAL_REQUIRED: Argon agent '${task.assigned_agent_id}' task execution/dispatch requires an explicit Founder approval ID`);
      } else if (isCritical) {
        throw new Error(`CRITICAL_TASK_APPROVAL_REQUIRED: Critical task '${task.task_id}' (risk: ${task.risk_class}, priority: ${task.priority}) requires explicit Founder approval ID`);
      } else {
        throw new Error(`TASK_APPROVAL_REQUIRED: Transitioning task '${task.task_id}' out of waiting_approval requires an explicit approval ID`);
      }
    }

    if (!this.approvalService) {
      throw new Error(`APPROVAL_SERVICE_UNAVAILABLE: Cannot verify approval for task '${task.task_id}' without active ApprovalService`);
    }

    let actionType: "argon_invocation" | "critical_task_approval" | "architecture_review";
    if (isArgon) {
      actionType = "argon_invocation";
    } else if (isCritical) {
      actionType = "critical_task_approval";
    } else {
      const existingRow = db
        .prepare("SELECT action_type FROM approval_requests WHERE approval_id = ?")
        .get(approvalId) as { action_type?: string } | undefined;
      actionType = existingRow?.action_type === "architecture_review"
        ? "architecture_review"
        : "critical_task_approval";
    }

    const payload = isArgon
      ? { taskId: task.task_id, targetAgentId: task.assigned_agent_id }
      : { taskId: task.task_id, riskClass: task.risk_class, priority: task.priority };

    const expectedTargetResource = `task:${task.task_id}`;
    const expectedTargetAgentId = isArgon
      ? task.assigned_agent_id
      : (task.assigned_agent_id || undefined);

    const res = this.approvalService.consumeApproval({
      approvalId,
      expectedActionType: actionType,
      expectedTargetAgentId: expectedTargetAgentId || undefined,
      expectedTargetResource,
      canonicalPayload: payload,
      requestId: `req_${isArgon ? "argon" : isCritical ? "crit" : "task"}_${task.task_id}`
    }, db);

    if (!res.valid) {
      if (isArgon) {
        throw new Error(`ARGON_FOUNDER_APPROVAL_REQUIRED: Argon Founder approval verification failed: ${res.error}`);
      } else if (isCritical) {
        throw new Error(`CRITICAL_TASK_APPROVAL_REQUIRED: Critical task approval verification failed: ${res.error}`);
      } else {
        throw new Error(`TASK_APPROVAL_REQUIRED: Task approval verification failed: ${res.error}`);
      }
    }
  }

  private verifyAndConsumeArgonApproval(
    db: any,
    taskId: string,
    targetAgentId: string,
    approvalId?: string
  ): void {
    return this.verifyAndConsumeTaskApproval(
      db,
      { task_id: taskId, assigned_agent_id: targetAgentId, risk_class: "critical", priority: "P0" },
      approvalId
    );
  }

  public initSchema(): void {
    this.connManager.withWriteTransaction((db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS projects (
          project_id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          description TEXT NOT NULL DEFAULT '',
          status TEXT NOT NULL DEFAULT 'active',
          owner_agent_id TEXT NOT NULL DEFAULT 'flash-01',
          approved_by_human_id TEXT DEFAULT 'founder-01',
          priority TEXT NOT NULL DEFAULT 'P1',
          risk_class TEXT NOT NULL DEFAULT 'medium',
          created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
          updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
        );

        CREATE TABLE IF NOT EXISTS tasks (
          task_id TEXT PRIMARY KEY,
          idempotency_key TEXT UNIQUE,
          project_id TEXT NOT NULL DEFAULT 'proj_default',
          parent_task_id TEXT,
          title TEXT NOT NULL,
          objective TEXT NOT NULL DEFAULT '',
          description TEXT NOT NULL DEFAULT '',
          created_by_principal_type TEXT NOT NULL DEFAULT 'agent',
          created_by_principal_id TEXT NOT NULL DEFAULT 'chatgpt-01',
          assigned_agent_id TEXT,
          reviewer_agent_id TEXT,
          priority TEXT NOT NULL DEFAULT 'P1',
          risk_class TEXT NOT NULL DEFAULT 'medium',
          execution_status TEXT NOT NULL DEFAULT 'draft',
          dispatch_status TEXT NOT NULL DEFAULT 'not_dispatched',
          acceptance_criteria_json TEXT NOT NULL DEFAULT '[]',
          input_artifact_ids_json TEXT NOT NULL DEFAULT '[]',
          output_artifact_ids_json TEXT NOT NULL DEFAULT '[]',
          verification_evidence TEXT,
          workspace_id TEXT,
          branch_name TEXT,
          approval_request_id TEXT,
          lease_owner_agent_id TEXT,
          lease_expires_at TEXT,
          retry_count INTEGER NOT NULL DEFAULT 0,
          max_retries INTEGER NOT NULL DEFAULT 2,
          version INTEGER NOT NULL DEFAULT 1,
          handoff_file_path TEXT,
          operator_delivered_at TEXT,
          external_invoked_at TEXT,
          started_at TEXT,
          completed_at TEXT,
          created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
          updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
        );

        CREATE TABLE IF NOT EXISTS task_events (
          event_id INTEGER PRIMARY KEY AUTOINCREMENT,
          task_id TEXT NOT NULL,
          actor_principal_type TEXT NOT NULL DEFAULT 'agent',
          actor_principal_id TEXT NOT NULL DEFAULT 'system',
          event_type TEXT NOT NULL,
          from_execution_status TEXT,
          to_execution_status TEXT,
          from_dispatch_status TEXT,
          to_dispatch_status TEXT,
          task_version INTEGER NOT NULL DEFAULT 1,
          approval_id TEXT,
          note TEXT,
          metadata_json TEXT NOT NULL DEFAULT '{}',
          recorded_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
        );
      `);
    });
  }

  public createProject(params: {
    ctx?: PrincipalContext;
    projectId?: string;
    project_id?: string;
    name: string;
    description: string;
    ownerAgentId?: string;
    owner_agent_id?: string;
    priority?: "P0" | "P1" | "P2" | "P3";
    riskClass?: "low" | "medium" | "high" | "critical";
    risk_class?: "low" | "medium" | "high" | "critical";
  }): ProjectRecord {
    assertAuthenticatedContext(params.ctx, "createProject", { allowedPrincipalTypes: ["human", "agent"] });
    if (!isExecutiveLeadership(params.ctx) && !hasPrincipalScope(params.ctx, "tasks:manage")) {
      throw new Error(
        `PERMISSION_DENIED: Principal '${params.ctx.principalId}' is not authorized to create projects`
      );
    }

    const projectId = params.projectId || params.project_id || "proj_" + crypto.randomBytes(8).toString("hex");
    const ownerAgentId = params.ownerAgentId || params.owner_agent_id || params.ctx.agentId;
    if (!ownerAgentId) {
      throw new Error("VALIDATION_ERROR: ownerAgentId is required when creating a project without a bound agent_id");
    }
    const approvedByHumanId = isFounderHuman(params.ctx) ? params.ctx.principalId : null;
    const priority = params.priority || "P1";
    const riskClass = params.riskClass || params.risk_class || "medium";
    const now = new Date().toISOString();

    return this.connManager.withWriteTransaction((db) => {
      db.prepare(`
        INSERT INTO projects (
          project_id, name, description, status, owner_agent_id,
          approved_by_human_id, priority, risk_class, created_at, updated_at
        ) VALUES (?, ?, ?, 'active', ?, ?, ?, ?, ?, ?)
      `).run(projectId, params.name, params.description, ownerAgentId, approvedByHumanId, priority, riskClass, now, now);

      return {
        project_id: projectId,
        name: params.name,
        description: params.description,
        status: "active",
        owner_agent_id: ownerAgentId,
        priority,
        risk_class: riskClass,
        created_at: now,
        updated_at: now
      };
    });
  }

  public listProjects(status?: string): ProjectRecord[] {
    return this.connManager.withReadTransaction((db) => {
      let query = "SELECT * FROM projects";
      const params: any[] = [];
      if (status) {
        query += " WHERE status = ?";
        params.push(status);
      }
      query += " ORDER BY created_at DESC";
      return db.prepare(query).all(...params) as unknown as ProjectRecord[];
    });
  }

  public getProject(projectId: string): ProjectRecord | null {
    return this.connManager.withReadTransaction((db) => {
      const row = db.prepare("SELECT * FROM projects WHERE project_id = ?").get(projectId);
      return (row as unknown as ProjectRecord) || null;
    });
  }

  public createTask(params: {
    ctx?: PrincipalContext;
    taskId?: string;
    task_id?: string;
    idempotencyKey?: string;
    idempotency_key?: string;
    projectId?: string;
    project_id?: string;
    title: string;
    objective?: string;
    description?: string;
    assignedAgentId?: string;
    assigned_agent_id?: string;
    reviewerAgentId?: string;
    reviewer_agent_id?: string;
    priority?: "P0" | "P1" | "P2" | "P3";
    riskClass?: "low" | "medium" | "high" | "critical";
    risk_class?: "low" | "medium" | "high" | "critical";
    acceptanceCriteria?: string[];
    acceptance_criteria?: string[];
    createdBy?: string;
    created_by?: string;
  }): TaskRecord {
    assertAuthenticatedContext(params.ctx, "createTask", { allowedPrincipalTypes: ["human", "agent"] });
    if (!isExecutiveLeadership(params.ctx) && !hasPrincipalScope(params.ctx, "tasks:manage")) {
      throw new Error(
        `PERMISSION_DENIED: Principal '${params.ctx.principalId}' is not authorized to create tasks`
      );
    }

    const taskId = params.taskId || params.task_id || "task_" + crypto.randomBytes(8).toString("hex");
    const idempotencyKey = params.idempotencyKey || params.idempotency_key || "idemp_" + crypto.randomBytes(12).toString("hex");
    const projectId = params.projectId || params.project_id || "proj_aico_v221";
    const title = params.title;
    const objective = params.objective || title;
    const description = params.description || title;
    const assignedAgentId = params.assignedAgentId || params.assigned_agent_id || null;
    const reviewerAgentId = params.reviewerAgentId || params.reviewer_agent_id || null;
    const priority = params.priority || "P1";
    const riskClass = params.riskClass || params.risk_class || "medium";
    const criteria = params.acceptanceCriteria || params.acceptance_criteria || ["Deliver verification evidence"];
    const createdById = params.ctx.principalId;
    const createdByType = params.ctx.principalType;

    // Invariant: Critical, P0, and Argon tasks start in waiting_approval; Argon tasks cannot retry
    const isArgon = isArgonAgent(assignedAgentId);
    const maxRetries = isArgon ? 0 : 2;
    const needsInitialApproval = requiresInitialFounderApproval({
      assigned_agent_id: assignedAgentId,
      risk_class: riskClass,
      priority
    });
    const initialExecutionStatus: TaskExecutionStatus =
      needsInitialApproval ? "waiting_approval" : "draft";
    const initialDispatchStatus: TaskDispatchStatus =
      needsInitialApproval ? "approval_pending" : "not_dispatched";

    const now = new Date().toISOString();

    return this.connManager.withWriteTransaction((db) => {
      // Check existing project
      const proj = db.prepare("SELECT * FROM projects WHERE project_id = ?").get(projectId);
      if (!proj) {
        const fallbackOwner = params.ctx!.agentId || assignedAgentId;
        if (!fallbackOwner) {
          throw new Error(`RESOURCE_NOT_FOUND: Project '${projectId}' not found and no valid owner agent was provided`);
        }
        const approvedByHuman = isFounderHuman(params.ctx) ? params.ctx!.principalId : null;
        db.prepare(`
          INSERT OR IGNORE INTO projects (project_id, name, description, owner_agent_id, approved_by_human_id)
          VALUES (?, ?, 'Auto-created project container', ?, ?)
        `).run(projectId, `Project ${projectId}`, fallbackOwner, approvedByHuman);
      }

      db.prepare(`
        INSERT INTO tasks (
          task_id, idempotency_key, project_id, parent_task_id, title, objective,
          description, created_by_principal_type, created_by_principal_id,
          assigned_agent_id, reviewer_agent_id, priority, risk_class,
          execution_status, dispatch_status, acceptance_criteria_json,
          input_artifact_ids_json, output_artifact_ids_json, verification_evidence,
          workspace_id, branch_name, approval_request_id, lease_owner_agent_id,
          lease_expires_at, retry_count, max_retries, version, handoff_file_path,
          created_at, updated_at
        ) VALUES (
          ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '[]', '[]', NULL,
          NULL, NULL, NULL, NULL, NULL, 0, ?, 1, NULL, ?, ?
        )
      `).run(
        taskId,
        idempotencyKey,
        projectId,
        title,
        objective,
        description,
        createdByType,
        createdById,
        assignedAgentId,
        reviewerAgentId,
        priority,
        riskClass,
        initialExecutionStatus,
        initialDispatchStatus,
        JSON.stringify(criteria),
        maxRetries,
        now,
        now
      );

      // Record task creation event in task_events
      db.prepare(`
        INSERT INTO task_events (
          task_id, actor_principal_type, actor_principal_id, event_type,
          from_execution_status, to_execution_status, from_dispatch_status,
          to_dispatch_status, task_version, note, metadata_json, recorded_at
        ) VALUES (?, ?, ?, 'task_created', NULL, ?, NULL, ?, 1, 'Task initial creation', '{}', ?)
      `).run(
        taskId,
        createdByType,
        createdById,
        initialExecutionStatus,
        initialDispatchStatus,
        now
      );

      return db.prepare("SELECT * FROM tasks WHERE task_id = ?").get(taskId) as unknown as TaskRecord;
    });
  }

  public listTasks(
    filter?: {
      assignedAgentId?: string;
      executionStatus?: string;
      projectId?: string;
      priority?: string;
    },
    callerCtx?: PrincipalContext
  ): TaskRecord[] {
    assertAuthenticatedContext(callerCtx, "listTasks");

    return this.connManager.withReadTransaction((db) => {
      let query = "SELECT * FROM tasks WHERE 1=1";
      const params: any[] = [];

      const hasBroadRead =
        isFounderHuman(callerCtx) ||
        (callerCtx.principalType === "agent" && callerCtx.principalId === "flash-01") ||
        hasPrincipalScope(callerCtx, "tasks:read") ||
        hasPrincipalScope(callerCtx, "tasks:manage");

      let effectiveAssignedAgentId = filter?.assignedAgentId;
      if (!hasBroadRead) {
        if (!callerCtx.agentId) {
          return [];
        }
        effectiveAssignedAgentId = callerCtx.agentId;
      }

      if (effectiveAssignedAgentId) {
        query += " AND assigned_agent_id = ?";
        params.push(effectiveAssignedAgentId);
      }
      if (filter?.executionStatus) {
        query += " AND execution_status = ?";
        params.push(filter.executionStatus);
      }
      if (filter?.projectId) {
        query += " AND project_id = ?";
        params.push(filter.projectId);
      }
      if (filter?.priority) {
        query += " AND priority = ?";
        params.push(filter.priority);
      }

      query += " ORDER BY created_at DESC";
      return db.prepare(query).all(...params) as unknown as TaskRecord[];
    });
  }

  public getTask(taskId: string, callerCtx?: PrincipalContext): TaskRecord | null {
    assertAuthenticatedContext(callerCtx, "getTask");

    return this.connManager.withReadTransaction((db) => {
      const row = db.prepare("SELECT * FROM tasks WHERE task_id = ?").get(taskId) as any;
      if (!row) return null;

      const hasBroadRead =
        isFounderHuman(callerCtx) ||
        (callerCtx.principalType === "agent" && callerCtx.principalId === "flash-01") ||
        hasPrincipalScope(callerCtx, "tasks:read") ||
        hasPrincipalScope(callerCtx, "tasks:manage");

      if (!hasBroadRead) {
        const isAssignedCaller = Boolean(callerCtx.agentId && row.assigned_agent_id === callerCtx.agentId);
        const isCreatorCaller = Boolean(
          row.created_by_principal_id === callerCtx.principalId &&
          row.created_by_principal_type === callerCtx.principalType
        );
        if (!isAssignedCaller && !isCreatorCaller) {
          throw new Error(`PERMISSION_DENIED: Access to task '${taskId}' denied (not assigned to caller)`);
        }
      }

      return (row as unknown as TaskRecord) || null;
    });
  }

  public heartbeatTask(params: {
    ctx?: PrincipalContext;
    taskId: string;
    agentId?: string;
    expectedVersion?: number;
  }): TaskRecord {
    assertAuthenticatedContext(params.ctx, "heartbeatTask", { allowedPrincipalTypes: ["human", "agent"] });
    if (
      params.expectedVersion !== undefined &&
      (typeof params.expectedVersion !== "number" ||
        !Number.isInteger(params.expectedVersion) ||
        params.expectedVersion < 1)
    ) {
      throw new Error("VALIDATION_ERROR: heartbeatTask expectedVersion must be a positive integer");
    }

    const callerAgentId = params.ctx.agentId;
    const isFounder = isFounderHuman(params.ctx);
    const now = new Date();
    const nowIso = now.toISOString();
    const newExpiresAt = new Date(now.getTime() + 30 * 60 * 1000).toISOString();

    return this.connManager.withWriteTransaction((db) => {
      const task = db.prepare("SELECT * FROM tasks WHERE task_id = ?").get(params.taskId) as any;
      if (!task) throw new Error(`RESOURCE_NOT_FOUND: Task ${params.taskId} not found`);

      if (task.execution_status !== "claimed" && task.execution_status !== "in_progress") {
        throw new Error(`TASK_INVALID_STATE_TRANSITION: Heartbeat only valid for claimed or in_progress tasks (current: ${task.execution_status})`);
      }

      if (params.expectedVersion !== undefined && task.version !== params.expectedVersion) {
        throw new Error(`TASK_VERSION_CONFLICT: Optimistic lock failure: expected version ${params.expectedVersion}, but found ${task.version}`);
      }

      if (!task.lease_owner_agent_id || (task.lease_owner_agent_id !== callerAgentId && !isFounder)) {
        throw new Error(`ABAC_OWNERSHIP_OR_SOD_VIOLATION: Only current lease owner '${task.lease_owner_agent_id}' can heartbeat task`);
      }

      const leaseExpiresMs = task.lease_expires_at ? Date.parse(task.lease_expires_at) : Number.NaN;
      if (!task.lease_expires_at || Number.isNaN(leaseExpiresMs) || leaseExpiresMs <= now.getTime()) {
        throw new Error(
          `TASK_LEASE_EXPIRED: Cannot heartbeat task '${params.taskId}'; lease expired at '${task.lease_expires_at ?? "null"}'`
        );
      }

      const upd = db.prepare(`
        UPDATE tasks
        SET lease_expires_at = ?, updated_at = ?
        WHERE task_id = ?
          AND version = ?
          AND execution_status = ?
          AND lease_owner_agent_id = ?
          AND lease_expires_at = ?
      `).run(
        newExpiresAt,
        nowIso,
        params.taskId,
        task.version,
        task.execution_status,
        task.lease_owner_agent_id,
        task.lease_expires_at
      );

      if (upd.changes === 0) {
        throw new Error(
          `TASK_LEASE_CONFLICT: Lease renewal conflicted with concurrent state or lease update on task '${params.taskId}'`
        );
      }

      return db.prepare("SELECT * FROM tasks WHERE task_id = ?").get(params.taskId) as unknown as TaskRecord;
    });
  }

  private assertValidExpectedVersion(expectedVersion: unknown, message: string): asserts expectedVersion is number {
    if (
      typeof expectedVersion !== "number" ||
      !Number.isInteger(expectedVersion) ||
      expectedVersion < 1
    ) {
      throw new Error(message);
    }
  }

  public claimTask(params: {
    ctx?: PrincipalContext;
    taskId: string;
    agentId?: string;
    expectedVersion: number;
  }): TaskRecord {
    assertAuthenticatedContext(params.ctx, "claimTask", { allowedPrincipalTypes: ["human", "agent"] });
    const claimerId = params.ctx.agentId || (isFounderHuman(params.ctx) ? params.ctx.principalId : null);
    if (!claimerId) {
      throw new Error("VALIDATION_ERROR: Agent ID or Founder principal required to claim task");
    }
    this.assertValidExpectedVersion(
      params.expectedVersion,
      "VALIDATION_ERROR: claimTask requires a positive integer expectedVersion"
    );

    return this.transitionTask({
      ctx: params.ctx,
      taskId: params.taskId,
      expectedVersion: params.expectedVersion,
      toStatus: "claimed",
      note: `Task claimed by ${claimerId}`
    });
  }

  public submitTaskResult(params: {
    ctx?: PrincipalContext;
    taskId: string;
    expectedVersion: number;
    outputArtifactIds: string[];
    verificationEvidence: string;
  }): TaskRecord {
    assertAuthenticatedContext(params.ctx, "submitTaskResult", { allowedPrincipalTypes: ["human", "agent"] });
    this.assertValidExpectedVersion(
      params.expectedVersion,
      "VALIDATION_ERROR: submitTaskResult requires a positive integer expectedVersion"
    );
    if (!params.outputArtifactIds || params.outputArtifactIds.length === 0) {
      throw new Error("INVALID_ARGUMENT: submitTaskResult requires at least one output artifact ID");
    }
    if (!params.verificationEvidence || params.verificationEvidence.trim().length === 0) {
      throw new Error("INVALID_ARGUMENT: submitTaskResult requires verification evidence");
    }

    return this.transitionTask({
      ctx: params.ctx,
      taskId: params.taskId,
      expectedVersion: params.expectedVersion,
      toStatus: "review_required",
      outputArtifactIds: params.outputArtifactIds,
      verificationEvidence: params.verificationEvidence,
      note: "Task result submitted for review (TR-22)"
    });
  }

  public reviewTask(params: {
    ctx?: PrincipalContext;
    taskId: string;
    expectedVersion: number;
    decision: "completed" | "rework";
    reason?: string;
    reviewerId?: string;
  }): TaskRecord {
    if (!params.ctx) {
      throw new Error("AUTHENTICATION_REQUIRED: reviewTask requires an authenticated PrincipalContext");
    }
    if (params.ctx.authenticated !== true) {
      throw new Error("AUTHENTICATION_REQUIRED: reviewTask requires an authenticated PrincipalContext (ctx.authenticated must be true)");
    }
    if (!params.ctx.principalId || typeof params.ctx.principalId !== "string" || params.ctx.principalId.trim().length === 0) {
      throw new Error("AUTHENTICATION_REQUIRED: reviewTask requires a valid principalId in PrincipalContext");
    }
    if (!params.ctx.principalType || (params.ctx.principalType !== "human" && params.ctx.principalType !== "agent")) {
      throw new Error("AUTHENTICATION_REQUIRED: reviewTask requires a valid principalType ('human' | 'agent') in PrincipalContext");
    }

    this.assertValidExpectedVersion(
      params.expectedVersion,
      "VALIDATION_ERROR: reviewTask expectedVersion must be a positive integer"
    );

    const reviewerId = params.ctx.principalId;
    const toStatus: TaskExecutionStatus = params.decision === "completed" ? "completed" : "rework";

    return this.transitionTask({
      ctx: params.ctx,
      taskId: params.taskId,
      expectedVersion: params.expectedVersion,
      toStatus,
      reason: params.reason,
      note: `Task review decision: ${params.decision} by ${reviewerId}`
    });
  }

  public transitionTask(input: TransitionInput): TaskRecord {
    assertAuthenticatedContext(input.ctx, "transitionTask", { allowedPrincipalTypes: ["human", "agent"] });
    this.assertValidExpectedVersion(
      input.expectedVersion,
      "VALIDATION_ERROR: transitionTask requires a positive integer expectedVersion"
    );
    const now = new Date();
    const nowIso = now.toISOString();
    const actorId = input.ctx.principalId;
    const actorType = input.ctx.principalType;
    const callerAgentId = input.ctx.principalType === "agent" ? input.ctx.agentId : null;
    const isFounder = isFounderHuman(input.ctx);
    const isExecutive = isExecutiveLeadership(input.ctx);
    const isReviewerLead = isReviewLeadership(input.ctx);
    const isArchiveLead = isArchiveLeadership(input.ctx);

    return this.connManager.withWriteTransaction((db) => {
      const task = db.prepare("SELECT * FROM tasks WHERE task_id = ?").get(input.taskId) as any;
      if (!task) throw new Error(`RESOURCE_NOT_FOUND: Task ${input.taskId} not found`);

      // Mandatory optimistic locking (CAS)
      if (task.version !== input.expectedVersion) {
        throw new Error(`TASK_VERSION_CONFLICT: Optimistic lock failure: expected version ${input.expectedVersion}, but found ${task.version}`);
      }

      const fromStatus: TaskExecutionStatus = task.execution_status;
      const toStatus: TaskExecutionStatus = input.toStatus;

      if (input.allowReviewAndAdminTransitions === false) {
        const isReviewDecision =
          (fromStatus === "review_required" && (toStatus === "completed" || toStatus === "rework")) ||
          (fromStatus === toStatus && (toStatus === "completed" || toStatus === "rework"));
        const isArchiveTransition = toStatus === "archived";
        const isApprovalGateResolution =
          fromStatus === "waiting_approval" && (toStatus === "queued" || toStatus === "in_progress");
        if (isReviewDecision || isArchiveTransition || isApprovalGateResolution) {
          throw new Error(
            `PERMISSION_DENIED: TOOL_NOT_EXPOSED_ON_PUBLIC_GATEWAY: Transition '${fromStatus}' -> '${toStatus}' is forbidden on Public Gateway`
          );
        }
      }

      const isCreator =
        task.created_by_principal_id === actorId && task.created_by_principal_type === actorType;
      const isAssigned = Boolean(task.assigned_agent_id && callerAgentId && callerAgentId === task.assigned_agent_id);
      const isLeaseOwner = Boolean(
        task.lease_owner_agent_id && callerAgentId && callerAgentId === task.lease_owner_agent_id
      );
      const isDesignatedReviewer = Boolean(
        task.reviewer_agent_id && callerAgentId && callerAgentId === task.reviewer_agent_id
      );
      const leaseExpiresMs = task.lease_expires_at ? Date.parse(task.lease_expires_at) : Number.NaN;
      const isLeaseExpired = Boolean(task.lease_expires_at && (Number.isNaN(leaseExpiresMs) || leaseExpiresMs <= now.getTime()));

      // Authorize even when fromStatus === toStatus so idempotent replays cannot bypass ABAC/SoD/role checks
      if (fromStatus === toStatus) {
        if (toStatus === "archived") {
          if (!isArchiveLead) {
            throw new Error("PERMISSION_DENIED: Only executive leadership (founder-01 or flash-01) can archive tasks");
          }
        } else if (toStatus === "completed" || toStatus === "rework") {
          if (isAssigned && !isFounder) {
            throw new Error("ABAC_OWNERSHIP_OR_SOD_VIOLATION: Agent cannot review own task (Separation of Duties)");
          }
          if (task.reviewer_agent_id) {
            if (!isDesignatedReviewer && !isReviewerLead) {
              throw new Error(
                `ABAC_OWNERSHIP_OR_SOD_VIOLATION: Only designated reviewer '${task.reviewer_agent_id}' or executive leadership can review task`
              );
            }
          } else if (!isReviewerLead) {
            throw new Error("ABAC_OWNERSHIP_OR_SOD_VIOLATION: Tasks without designated reviewer can only be reviewed by executive leadership");
          }
        } else if (toStatus === "draft" || toStatus === "waiting_approval" || toStatus === "cancelled") {
          if (!isExecutive && !isCreator) {
            throw new Error(`ABAC_OWNERSHIP_OR_SOD_VIOLATION: Caller '${actorId}' is not authorized to transition task in '${fromStatus}' state`);
          }
        } else {
          if (!isExecutive && !isCreator && !isAssigned && !isLeaseOwner) {
            throw new Error(`ABAC_OWNERSHIP_OR_SOD_VIOLATION: Caller '${actorId}' is not authorized to transition task '${input.taskId}'`);
          }
          if (task.lease_owner_agent_id && !isLeaseOwner && !isExecutive) {
            throw new Error(
              `ABAC_OWNERSHIP_OR_SOD_VIOLATION: Task lease is held by '${task.lease_owner_agent_id}', not '${callerAgentId || actorId}'`
            );
          }
        }
        return task as TaskRecord;
      }

      // Authorization guard for task cancellation across all cancel transitions
      if (toStatus === "cancelled") {
        if (!isExecutive && !isCreator) {
          throw new Error(`ABAC_OWNERSHIP_OR_SOD_VIOLATION: Caller '${actorId}' is not authorized to cancel this task`);
        }
      }

      let newDispatchStatus: TaskDispatchStatus = task.dispatch_status;
      let newLeaseOwner: string | null = task.lease_owner_agent_id;
      let newLeaseExpiresAt: string | null = task.lease_expires_at;
      let newRetryCount = task.retry_count;
      let newStartedAt = task.started_at;
      let newCompletedAt = task.completed_at;
      let newApprovalRequestId = task.approval_request_id;

      const isArgon = isArgonAgent(task.assigned_agent_id);
      const isCritical = isCriticalGovernanceTask(task);

      // Match and validate across TR-01 to TR-26
      if (fromStatus === "draft" && toStatus === "queued") {
        // TR-01
        if (!isExecutive && !isCreator) {
          throw new Error(`ABAC_OWNERSHIP_OR_SOD_VIOLATION: Caller '${actorId}' is not authorized to queue draft task`);
        }
        if (requiresInitialFounderApproval(task)) {
          throw new Error(
            "TASK_INVALID_STATE_TRANSITION: Critical, P0, or Argon task in draft must go to waiting_approval via TR-03"
          );
        }
        newDispatchStatus = "not_dispatched";
      } else if (fromStatus === "draft" && toStatus === "cancelled") {
        // TR-02
        newDispatchStatus = "not_dispatched";
      } else if (fromStatus === "draft" && toStatus === "waiting_approval") {
        // TR-03
        if (!isExecutive && !isCreator) {
          throw new Error(`ABAC_OWNERSHIP_OR_SOD_VIOLATION: Caller '${actorId}' is not authorized to submit draft task for approval`);
        }
        newDispatchStatus = "approval_pending";
      } else if (fromStatus === "waiting_approval" && toStatus === "queued") {
        // TR-04
        if (!isExecutive) {
          throw new Error(`ABAC_OWNERSHIP_OR_SOD_VIOLATION: Only executive leadership can approve queued dispatch from waiting_approval`);
        }
        if (isAssigned && !isFounder) {
          throw new Error("ABAC_OWNERSHIP_OR_SOD_VIOLATION: Assigned agent cannot self-approve waiting_approval transition");
        }
        this.verifyAndConsumeTaskApproval(db, task, input.approvalId);
        newApprovalRequestId = input.approvalId!;
        newDispatchStatus = "handoff_ready";
      } else if (fromStatus === "waiting_approval" && toStatus === "cancelled") {
        // TR-05
        newDispatchStatus = "not_dispatched";
      } else if (fromStatus === "queued" && toStatus === "assigned") {
        // TR-06
        if (!isExecutive) {
          throw new Error(`ABAC_OWNERSHIP_OR_SOD_VIOLATION: Only executive leadership can assign queued tasks`);
        }
        if (!task.assigned_agent_id) {
          throw new Error("TASK_INVALID_STATE_TRANSITION: Cannot assign task without assigned_agent_id");
        }
        if (isArgon) {
          if (!task.approval_request_id && !input.approvalId) {
            throw new Error("ARGON_FOUNDER_APPROVAL_REQUIRED: Assigning Argon task requires explicit Founder approval");
          }
          if (input.approvalId) {
            this.verifyAndConsumeArgonApproval(db, task.task_id, task.assigned_agent_id, input.approvalId);
            newApprovalRequestId = input.approvalId;
          }
          newDispatchStatus = "awaiting_operator_delivery";
        } else {
          if (isCritical && !task.approval_request_id && !input.approvalId) {
            throw new Error(
              `CRITICAL_TASK_APPROVAL_REQUIRED: Assigning critical task '${task.task_id}' requires explicit Founder approval`
            );
          }
          if (isCritical && input.approvalId) {
            this.verifyAndConsumeTaskApproval(db, task, input.approvalId);
            newApprovalRequestId = input.approvalId;
          }
          newDispatchStatus = "queued_for_client_pull";
        }
      } else if (fromStatus === "queued" && toStatus === "cancelled") {
        // TR-07
        newDispatchStatus = "not_dispatched";
      } else if (fromStatus === "assigned" && toStatus === "queued") {
        // TR-08
        if (!isExecutive) {
          throw new Error(`ABAC_OWNERSHIP_OR_SOD_VIOLATION: Only executive leadership can re-queue an assigned task`);
        }
        if (isArgon && task.approval_request_id) {
          throw new Error("TASK_INVALID_STATE_TRANSITION: Cannot auto-reassign Argon task after approval");
        }
        newDispatchStatus = "not_dispatched";
        newLeaseOwner = null;
        newLeaseExpiresAt = null;
      } else if (fromStatus === "assigned" && toStatus === "cancelled") {
        // TR-09
        newLeaseOwner = null;
        newLeaseExpiresAt = null;
      } else if (fromStatus === "assigned" && toStatus === "claimed") {
        // TR-10
        if (task.assigned_agent_id) {
          if (!isAssigned && !isFounder) {
            throw new Error(`ABAC_OWNERSHIP_OR_SOD_VIOLATION: Only assigned agent '${task.assigned_agent_id}' can claim task`);
          }
        } else if (!callerAgentId) {
          throw new Error("ABAC_OWNERSHIP_OR_SOD_VIOLATION: An agent identity is required to claim an unassigned task");
        }
        if (isArgon) {
          if (!task.approval_request_id && !input.approvalId) {
            throw new Error("ARGON_FOUNDER_APPROVAL_REQUIRED: Claiming Argon task requires explicit Founder approval");
          }
          if (input.approvalId) {
            this.verifyAndConsumeArgonApproval(db, task.task_id, task.assigned_agent_id, input.approvalId);
            newApprovalRequestId = input.approvalId;
          }
        } else if (isCritical && !task.approval_request_id && !input.approvalId) {
          throw new Error(
            `CRITICAL_TASK_APPROVAL_REQUIRED: Claiming critical task '${task.task_id}' requires explicit Founder approval`
          );
        }
        newLeaseOwner = task.assigned_agent_id || callerAgentId;
        newLeaseExpiresAt = new Date(now.getTime() + 30 * 60 * 1000).toISOString();
      } else if (fromStatus === "claimed" && toStatus === "in_progress") {
        // TR-11
        if (task.assigned_agent_id && !isAssigned && !isFounder) {
          throw new Error(`ABAC_OWNERSHIP_OR_SOD_VIOLATION: Only assigned agent '${task.assigned_agent_id}' can move task to in_progress`);
        }
        if (task.lease_owner_agent_id && !isLeaseOwner && !isFounder) {
          throw new Error(`ABAC_OWNERSHIP_OR_SOD_VIOLATION: Task lease is held by '${task.lease_owner_agent_id}', not '${callerAgentId || actorId}'`);
        }
        if (!task.lease_expires_at || isLeaseExpired) {
          throw new Error("TASK_LEASE_EXPIRED: Cannot move missing or expired lease to in_progress");
        }
        if (isArgon || isCritical) {
          if (!task.approval_request_id && !input.approvalId) {
            throw new Error(isArgon
              ? "ARGON_FOUNDER_APPROVAL_REQUIRED: Moving Argon task to in_progress requires explicit Founder approval"
              : `CRITICAL_TASK_APPROVAL_REQUIRED: Moving critical task '${task.task_id}' to in_progress requires explicit Founder approval`
            );
          }
          if (input.approvalId) {
            this.verifyAndConsumeTaskApproval(db, task, input.approvalId);
            newApprovalRequestId = input.approvalId;
          }
        }
        newStartedAt = newStartedAt || nowIso;
        if (isArgon || task.assigned_agent_id === "chatgpt-01") {
          newDispatchStatus = "external_running";
        }
      } else if (fromStatus === "claimed" && toStatus === "assigned") {
        // TR-12: Stale lease recovery or explicit release for local agents
        if (isArgon) {
          throw new Error("TASK_INVALID_STATE_TRANSITION: Argon tasks cannot revert to assigned on lease expiry; must go to blocked (TR-15)");
        }
        const canReleaseClaim = isLeaseOwner || isExecutive || (isLeaseExpired && isAssigned);
        if (!canReleaseClaim) {
          throw new Error(
            `ABAC_OWNERSHIP_OR_SOD_VIOLATION: Caller '${actorId}' cannot release active task lease held by '${task.lease_owner_agent_id}'`
          );
        }
        newLeaseOwner = null;
        newLeaseExpiresAt = null;
      } else if ((fromStatus === "claimed" || fromStatus === "in_progress") && toStatus === "blocked" && isArgon) {
        // TR-15: Argon lease expiry or block -> blocked (evaluated before TR-13 so both states reach TR-15)
        if (!isExecutive && !isAssigned && !isLeaseOwner) {
          throw new Error(`ABAC_OWNERSHIP_OR_SOD_VIOLATION: Caller '${actorId}' cannot block Argon task`);
        }
        newLeaseOwner = null;
        newLeaseExpiresAt = null;
      } else if (fromStatus === "in_progress" && toStatus === "blocked") {
        // TR-13
        if (task.assigned_agent_id && !isAssigned && !isExecutive) {
          throw new Error(`ABAC_OWNERSHIP_OR_SOD_VIOLATION: Only assigned agent '${task.assigned_agent_id}' or leadership can block task`);
        }
        if (task.lease_owner_agent_id && !isLeaseOwner && !isExecutive) {
          throw new Error(`ABAC_OWNERSHIP_OR_SOD_VIOLATION: Task lease is held by '${task.lease_owner_agent_id}', not '${callerAgentId || actorId}'`);
        }
        newLeaseOwner = null;
        newLeaseExpiresAt = null;
      } else if (fromStatus === "in_progress" && toStatus === "waiting_approval") {
        // TR-14
        if (task.assigned_agent_id && !isAssigned && !isExecutive) {
          throw new Error(`ABAC_OWNERSHIP_OR_SOD_VIOLATION: Only assigned agent '${task.assigned_agent_id}' or leadership can submit task for approval`);
        }
        if (task.lease_owner_agent_id && !isLeaseOwner && !isExecutive) {
          throw new Error(`ABAC_OWNERSHIP_OR_SOD_VIOLATION: Task lease is held by '${task.lease_owner_agent_id}', not '${callerAgentId || actorId}'`);
        }
        newLeaseOwner = null;
        newLeaseExpiresAt = null;
        newDispatchStatus = "approval_pending";
      } else if (fromStatus === "blocked" && toStatus === "in_progress") {
        // TR-16
        if (!task.assigned_agent_id) {
          throw new Error("TASK_INVALID_STATE_TRANSITION: Cannot resume blocked task without assigned_agent_id");
        }
        if (isArgon) {
          if (!isExecutive) {
            throw new Error(`ABAC_OWNERSHIP_OR_SOD_VIOLATION: Only leadership can unblock Argon task '${task.task_id}'`);
          }
        } else if (!isAssigned && !isExecutive) {
          throw new Error(`ABAC_OWNERSHIP_OR_SOD_VIOLATION: Only assigned agent '${task.assigned_agent_id}' or leadership can unblock task`);
        }
        if (isArgon || isCritical) {
          this.verifyAndConsumeTaskApproval(db, task, input.approvalId);
          newApprovalRequestId = input.approvalId!;
          if (isArgon) newDispatchStatus = "external_running";
        }
        newLeaseOwner = task.assigned_agent_id;
        newLeaseExpiresAt = new Date(now.getTime() + 30 * 60 * 1000).toISOString();
      } else if (fromStatus === "blocked" && toStatus === "cancelled") {
        // TR-17
      } else if (fromStatus === "waiting_approval" && toStatus === "in_progress") {
        // TR-18
        if (!task.assigned_agent_id) {
          throw new Error("TASK_INVALID_STATE_TRANSITION: Cannot move waiting_approval task to in_progress without assigned_agent_id");
        }
        if (!isExecutive) {
          throw new Error(`ABAC_OWNERSHIP_OR_SOD_VIOLATION: Only executive leadership can resume task directly from waiting_approval`);
        }
        if (isAssigned && !isFounder) {
          throw new Error("ABAC_OWNERSHIP_OR_SOD_VIOLATION: Assigned agent cannot self-approve waiting_approval transition");
        }
        this.verifyAndConsumeTaskApproval(db, task, input.approvalId);
        newApprovalRequestId = input.approvalId!;
        if (isArgon) newDispatchStatus = "external_running";
        newLeaseOwner = task.assigned_agent_id;
        newLeaseExpiresAt = new Date(now.getTime() + 30 * 60 * 1000).toISOString();
      } else if (fromStatus === "in_progress" && toStatus === "failed") {
        // TR-19
        if (task.assigned_agent_id && !isAssigned && !isExecutive) {
          throw new Error(`ABAC_OWNERSHIP_OR_SOD_VIOLATION: Only assigned agent '${task.assigned_agent_id}' or leadership can mark task as failed`);
        }
        if (task.lease_owner_agent_id && !isLeaseOwner && !isExecutive) {
          throw new Error(`ABAC_OWNERSHIP_OR_SOD_VIOLATION: Task lease is held by '${task.lease_owner_agent_id}', not '${callerAgentId || actorId}'`);
        }
        newLeaseOwner = null;
        newLeaseExpiresAt = null;
      } else if (fromStatus === "failed" && toStatus === "queued") {
        // TR-20: Retry
        if (!isExecutive && !isCreator) {
          throw new Error(`ABAC_OWNERSHIP_OR_SOD_VIOLATION: Caller '${actorId}' is not authorized to retry failed task`);
        }
        if (isArgon) {
          throw new Error("TASK_INVALID_STATE_TRANSITION: Argon tasks cannot auto-retry. Create follow-up task with Founder approval");
        }
        if (task.retry_count >= task.max_retries) {
          throw new Error(`TASK_RETRY_EXHAUSTED: Retry limit reached (${task.retry_count}/${task.max_retries})`);
        }
        newRetryCount += 1;
        newDispatchStatus = "not_dispatched";
      } else if (fromStatus === "failed" && toStatus === "cancelled") {
        // TR-21
      } else if (fromStatus === "in_progress" && toStatus === "review_required") {
        // TR-22
        if (task.assigned_agent_id && !isAssigned && !isFounder) {
          throw new Error(`ABAC_OWNERSHIP_OR_SOD_VIOLATION: Only assigned agent '${task.assigned_agent_id}' can submit task result for review`);
        }
        if (task.lease_owner_agent_id && !isLeaseOwner && !isFounder) {
          throw new Error(`ABAC_OWNERSHIP_OR_SOD_VIOLATION: Task lease is held by '${task.lease_owner_agent_id}', not '${callerAgentId || actorId}'`);
        }
        if (isLeaseExpired && !isFounder) {
          throw new Error("TASK_LEASE_EXPIRED: Cannot submit expired lease for review");
        }
        newDispatchStatus = "result_received";
        newLeaseOwner = null;
        newLeaseExpiresAt = null;
      } else if (fromStatus === "review_required" && toStatus === "rework") {
        // TR-23
        if (isAssigned && !isFounder) {
          throw new Error("ABAC_OWNERSHIP_OR_SOD_VIOLATION: Agent cannot review own task for rework");
        }
        if (task.reviewer_agent_id) {
          const isDesignatedReviewer = callerAgentId === task.reviewer_agent_id;
          if (!isDesignatedReviewer && !isReviewerLead) {
            throw new Error(`ABAC_OWNERSHIP_OR_SOD_VIOLATION: Only designated reviewer '${task.reviewer_agent_id}' or executive leadership can request rework`);
          }
        } else if (!isReviewerLead) {
          throw new Error("ABAC_OWNERSHIP_OR_SOD_VIOLATION: Tasks without designated reviewer can only be reviewed for rework by executive leadership");
        }
      } else if (fromStatus === "rework" && toStatus === "in_progress") {
        // TR-24
        if (isArgon) {
          throw new Error("TASK_INVALID_STATE_TRANSITION: Argon tasks cannot be re-invoked for rework in same task");
        }
        if (task.assigned_agent_id && !isAssigned && !isFounder) {
          throw new Error(`ABAC_OWNERSHIP_OR_SOD_VIOLATION: Only assigned agent '${task.assigned_agent_id}' can resume rework in_progress`);
        }
        newLeaseOwner = task.assigned_agent_id;
        newLeaseExpiresAt = new Date(now.getTime() + 30 * 60 * 1000).toISOString();
      } else if (fromStatus === "review_required" && toStatus === "completed") {
        // TR-25
        if (isAssigned && !isFounder) {
          throw new Error("ABAC_OWNERSHIP_OR_SOD_VIOLATION: Agent cannot approve own task as completed (Separation of Duties)");
        }
        if (task.reviewer_agent_id) {
          const isDesignatedReviewer = callerAgentId === task.reviewer_agent_id;
          if (!isDesignatedReviewer && !isReviewerLead) {
            throw new Error(`ABAC_OWNERSHIP_OR_SOD_VIOLATION: Only designated reviewer '${task.reviewer_agent_id}' or executive leadership can approve task completion`);
          }
        } else if (!isReviewerLead) {
          throw new Error("ABAC_OWNERSHIP_OR_SOD_VIOLATION: Tasks without designated reviewer can only be approved by executive leadership");
        }
        newCompletedAt = nowIso;
        newLeaseOwner = null;
        newLeaseExpiresAt = null;
      } else if ((fromStatus === "completed" || fromStatus === "cancelled") && toStatus === "archived") {
        // TR-26
        if (!isArchiveLead) {
          throw new Error("PERMISSION_DENIED: Only executive leadership (founder-01 or flash-01) can archive tasks");
        }
      } else {
        throw new Error(`TASK_INVALID_STATE_TRANSITION: Illegal transition from '${fromStatus}' to '${toStatus}'`);
      }

      const outputArtifactsJson = input.outputArtifactIds
        ? JSON.stringify(input.outputArtifactIds)
        : task.output_artifact_ids_json;

      const verificationEvidence = input.verificationEvidence !== undefined
        ? input.verificationEvidence
        : task.verification_evidence;

      const updateResult = db.prepare(`
        UPDATE tasks
        SET execution_status = ?, dispatch_status = ?, lease_owner_agent_id = ?,
            lease_expires_at = ?, retry_count = ?, started_at = ?, completed_at = ?,
            output_artifact_ids_json = ?, verification_evidence = ?,
            approval_request_id = ?,
            version = version + 1, updated_at = ?
        WHERE task_id = ? AND version = ? AND execution_status = ?
      `).run(
        toStatus,
        newDispatchStatus,
        newLeaseOwner,
        newLeaseExpiresAt,
        newRetryCount,
        newStartedAt,
        newCompletedAt,
        outputArtifactsJson,
        verificationEvidence,
        newApprovalRequestId,
        nowIso,
        input.taskId,
        input.expectedVersion,
        fromStatus
      );
      if (updateResult.changes !== 1) {
        throw new Error(
          `TASK_VERSION_CONFLICT: Concurrent state modification detected for task ${input.taskId} at expected version ${input.expectedVersion}`
        );
      }

      // Append immutable task_events record
      db.prepare(`
        INSERT INTO task_events (
          task_id, actor_principal_type, actor_principal_id, event_type,
          from_execution_status, to_execution_status, from_dispatch_status,
          to_dispatch_status, task_version, approval_id, note, metadata_json, recorded_at
        ) VALUES (?, ?, ?, 'state_transition', ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        input.taskId,
        actorType,
        actorId,
        fromStatus,
        toStatus,
        task.dispatch_status,
        newDispatchStatus,
        task.version + 1,
        input.approvalId || null,
        input.note || input.reason || `Transitioned to ${toStatus}`,
        JSON.stringify(input.metadata || {}),
        nowIso
      );

      return db.prepare("SELECT * FROM tasks WHERE task_id = ?").get(input.taskId) as unknown as TaskRecord;
    });
  }

  public recoverStaleLeases(): { recovered: number; details: string[] } {
    const nowIso = new Date().toISOString();
    return this.connManager.withWriteTransaction((db) => {
      const staleTasks = db.prepare(`
        SELECT * FROM tasks
        WHERE execution_status IN ('claimed', 'in_progress')
          AND lease_expires_at IS NOT NULL
          AND lease_expires_at <= ?
      `).all(nowIso) as any[];

      const details: string[] = [];
      let recoveredCount = 0;

      for (const t of staleTasks) {
        const isArgon = t.assigned_agent_id === "argon-01" || t.assigned_agent_id === "argon-02";
        let targetStatus: TaskExecutionStatus;
        let newRetryCount = t.retry_count;
        let recoveryNote: string;

        if (isArgon) {
          // Argon tasks NEVER auto-retry, auto-requeue, or auto-dispatch
          targetStatus = "blocked";
          recoveryNote = "BLOCKED_MANUAL_INTERVENTION: Argon lease expired. Requires manual Founder approval and intervention to re-assign or restart.";
        } else {
          // Standard tasks: verify retry limit
          if (t.retry_count >= t.max_retries) {
            targetStatus = "blocked";
            recoveryNote = `RETRY_EXHAUSTED: Stale lease recovery reached max retries (${t.retry_count}/${t.max_retries}). Moved to blocked.`;
          } else {
            targetStatus = "assigned";
            newRetryCount = t.retry_count + 1;
            recoveryNote = `Stale lease expired. Requeued to assigned (retry ${newRetryCount}/${t.max_retries}).`;
          }
        }

        // Compare-And-Swap (CAS) update on task_id, version, execution_status, lease_expires_at
        const res = db.prepare(`
          UPDATE tasks
          SET execution_status = ?,
              lease_owner_agent_id = NULL,
              lease_expires_at = NULL,
              retry_count = ?,
              version = version + 1,
              updated_at = ?
          WHERE task_id = ?
            AND version = ?
            AND execution_status = ?
            AND lease_expires_at = ?
        `).run(
          targetStatus,
          newRetryCount,
          nowIso,
          t.task_id,
          t.version,
          t.execution_status,
          t.lease_expires_at
        );

        if (res.changes === 0) {
          // CAS conflict: another process updated or renewed this task lease
          continue;
        }

        recoveredCount++;

        // Transactionally insert task event
        db.prepare(`
          INSERT INTO task_events (
            task_id, actor_principal_type, actor_principal_id, event_type,
            from_execution_status, to_execution_status, from_dispatch_status,
            to_dispatch_status, task_version, note, metadata_json, recorded_at
          ) VALUES (?, 'service', 'lease_recovery_daemon', ?, ?, ?, ?, ?, ?, ?, '{}', ?)
        `).run(
          t.task_id,
          isArgon ? "argon_lease_expired_blocked" : (targetStatus === "blocked" ? "lease_recovery_exhausted" : "stale_lease_recovery"),
          t.execution_status,
          targetStatus,
          t.dispatch_status,
          t.dispatch_status,
          t.version + 1,
          recoveryNote,
          nowIso
        );

        details.push(`Task ${t.task_id} transitioned from ${t.execution_status} to ${targetStatus}: ${recoveryNote}`);
      }

      return { recovered: recoveredCount, details };
    });
  }
}
