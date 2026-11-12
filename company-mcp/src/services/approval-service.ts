import * as crypto from "node:crypto";
import { ConnectionManager } from "../db/connection-manager.js";
import { assertAuthenticatedContext, type PrincipalContext } from "../security/context-store.js";
import { rfc8785Canonicalize } from "../security/rfc8785-canonicalize.js";

export interface ApprovalRequestRecord {
  approval_id: string;
  requested_by_principal_type: "human" | "agent";
  requested_by_principal_id: string;
  target_agent_id: string | null;
  approval_tier: "founder" | "technical";
  action_type: string;
  target_resource: string;
  payload_canonical_json: string;
  payload_hash_sha256: string;
  reason: string;
  risk_level: "low" | "medium" | "high" | "critical";
  status: "pending" | "approved" | "rejected" | "expired" | "consumed";
  requested_at: string;
  expires_at: string;
  decided_by_human_id: string | null;
  decided_by_agent_id: string | null;
  decided_at: string | null;
  decision_note: string | null;
  consumed_at: string | null;
  consumed_by_request_id: string | null;
}

export class ApprovalService {
  private connManager: ConnectionManager;

  constructor(connManager: ConnectionManager) {
    this.connManager = connManager;
  }

  public computeCanonicalPayloadHash(payload: unknown): { canonicalJson: string; sha256: string } {
    if (payload === undefined || payload === null) {
      throw new TypeError("RFC 8785: Payload cannot be undefined or null for canonical hashing");
    }
    const canonicalJson = rfc8785Canonicalize(payload);
    const sha256 = crypto.createHash("sha256").update(canonicalJson, "utf8").digest("hex");
    return { canonicalJson, sha256 };
  }

  public createApprovalRequest(params: {
    ctx?: PrincipalContext;
    actionType?: string;
    action_type?: string;
    requestedBy?: string;
    requested_by?: string;
    targetAgentId?: string;
    target_agent_id?: string;
    targetResource?: string;
    target_resource?: string;
    reason?: string;
    riskLevel?: "low" | "medium" | "high" | "critical";
    risk_level?: "low" | "medium" | "high" | "critical";
    approvalTier?: "founder" | "technical";
    approval_tier?: "founder" | "technical";
    canonicalPayload?: any;
    canonical_payload?: any;
    expiresInHours?: number;
    expires_in_hours?: number;
    requiredApprover?: string;
  }): {
    approvalId: string;
    approval_id: string;
    action_type: string;
    requested_by: string;
    required_approver: string;
    payloadHashSha256: string;
    payload_hash_sha256: string;
    status: string;
    expires_at: string;
  } {
    assertAuthenticatedContext(params.ctx, "createApprovalRequest", { allowedPrincipalTypes: ["human", "agent"] });
    const actionType = params.actionType || params.action_type || "architecture_review";
    const requestedById = params.ctx.principalId;
    const requestedByType: "human" | "agent" = params.ctx.principalType;
    const targetAgentId = params.targetAgentId || params.target_agent_id || null;
    const targetResource = params.targetResource || params.target_resource || "default_resource";
    const reason = params.reason || "Operational approval request";
    const riskLevel = params.riskLevel || params.risk_level || "medium";
    const rawPayload = params.canonicalPayload !== undefined
      ? params.canonicalPayload
      : (params.canonical_payload !== undefined ? params.canonical_payload : null);
    if (rawPayload === null || rawPayload === undefined) {
      throw new Error("CANONICAL_PAYLOAD_MANDATORY: canonicalPayload is required to create an approval request");
    }
    const expiresInHours = params.expiresInHours ?? params.expires_in_hours ?? 24;
    if (typeof expiresInHours !== "number" || !Number.isFinite(expiresInHours) || expiresInHours <= 0) {
      throw new Error("INVALID_EXPIRATION: expiresInHours must be a positive finite number");
    }

    // Determine tier
    const isArgon = targetAgentId === "argon-01" || targetAgentId === "argon-02" || actionType === "argon_invocation";
    let approvalTier: "founder" | "technical" = params.approvalTier || params.approval_tier || "technical";

    if (
      isArgon ||
      actionType === "argon_invocation" ||
      actionType === "project_approval" ||
      actionType === "critical_task_approval" ||
      actionType === "credential_issue" ||
      actionType === "db_migration" ||
      actionType === "public_gateway_release" ||
      riskLevel === "critical"
    ) {
      approvalTier = "founder";
    }

    const { canonicalJson, sha256: payloadHash } = this.computeCanonicalPayloadHash(rawPayload);
    const approvalId = "appr_" + crypto.randomBytes(12).toString("hex");

    const now = new Date();
    const expiresAt = new Date(now.getTime() + expiresInHours * 60 * 60 * 1000).toISOString();

    this.connManager.withWriteTransaction((db) => {
      db.prepare(`
        INSERT INTO approval_requests (
          approval_id, requested_by_principal_type, requested_by_principal_id,
          target_agent_id, approval_tier, action_type, target_resource,
          payload_canonical_json, payload_hash_sha256, reason, risk_level,
          status, requested_at, expires_at, decided_by_human_id, decided_by_agent_id,
          decided_at, decision_note, consumed_at, consumed_by_request_id
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, NULL, NULL, NULL, NULL, NULL, NULL)
      `).run(
        approvalId,
        requestedByType,
        requestedById,
        targetAgentId,
        approvalTier,
        actionType,
        targetResource,
        canonicalJson,
        payloadHash,
        reason,
        riskLevel,
        now.toISOString(),
        expiresAt
      );
    });

    const requiredApprover = approvalTier === "founder" ? "founder-01" : "flash-01";

    return {
      approvalId,
      approval_id: approvalId,
      action_type: actionType,
      requested_by: requestedById,
      required_approver: requiredApprover,
      payloadHashSha256: payloadHash,
      payload_hash_sha256: payloadHash,
      status: "pending",
      expires_at: expiresAt
    };
  }

  public getApprovalRequest(approvalId: string, callerCtx?: PrincipalContext): ApprovalRequestRecord | null {
    return this.connManager.withReadTransaction((db) => {
      const row = db.prepare("SELECT * FROM approval_requests WHERE approval_id = ?").get(approvalId) as any;
      if (!row) return null;

      // ABAC filtering: ordinary callers can only view requests they created or where they are the target agent
      if (callerCtx && callerCtx.principalId !== "founder-01" && callerCtx.principalId !== "flash-01" && !callerCtx.scopes.has("*") && !callerCtx.scopes.has("approvals:read:any")) {
        const isRequester = row.requested_by_principal_id === callerCtx.principalId;
        const isTarget = callerCtx.agentId && row.target_agent_id === callerCtx.agentId;
        if (!isRequester && !isTarget) {
          throw new Error(`PERMISSION_DENIED: Access to approval request '${approvalId}' denied (not requester or target agent)`);
        }
      }

      return row as ApprovalRequestRecord;
    });
  }

  public listApprovalRequests(
    filter?: {
      status?: string;
      tier?: string;
      action_type?: string;
      limit?: number;
    },
    callerCtx?: PrincipalContext
  ): ApprovalRequestRecord[] {
    return this.connManager.withReadTransaction((db) => {
      let query = "SELECT * FROM approval_requests WHERE 1=1";
      const params: any[] = [];

      // ABAC filtering: ordinary callers can only list requests they created or where they are the target agent
      if (callerCtx && callerCtx.principalId !== "founder-01" && callerCtx.principalId !== "flash-01" && !callerCtx.scopes.has("*") && !callerCtx.scopes.has("approvals:read:any")) {
        query += " AND (requested_by_principal_id = ? OR target_agent_id = ?)";
        params.push(callerCtx.principalId, callerCtx.agentId || "");
      }

      if (filter?.status) {
        query += " AND status = ?";
        params.push(filter.status);
      }
      if (filter?.tier) {
        query += " AND approval_tier = ?";
        params.push(filter.tier);
      }
      if (filter?.action_type) {
        query += " AND action_type = ?";
        params.push(filter.action_type);
      }

      query += " ORDER BY requested_at DESC";
      if (filter?.limit) {
        query += " LIMIT ?";
        params.push(filter.limit);
      }

      const rows = db.prepare(query).all(...params) as any[];
      return rows as ApprovalRequestRecord[];
    });
  }

  public decideApproval(params: {
    ctx?: PrincipalContext;
    approvalId?: string;
    approval_id?: string;
    decision: "approved" | "rejected";
    decidedBy?: string;
    decided_by?: string;
    reason?: string;
    decision_note?: string;
    signature?: string;
    credentialId?: string;
    keyId?: string;
  }): {
    success: boolean;
    approval_id: string;
    status: "approved" | "rejected";
    decided_by: string;
    decided_at: string;
  } {
    const approvalId = params.approvalId || params.approval_id;
    if (!approvalId) throw new Error("Approval ID required");

    if (!params.ctx) {
      throw new Error("AUTHENTICATION_REQUIRED: Authenticated PrincipalContext is mandatory to decide approval");
    }
    if (params.ctx.authenticated !== true) {
      throw new Error("AUTHENTICATION_REQUIRED: Authenticated PrincipalContext is mandatory to decide approval (ctx.authenticated must be true)");
    }
    if (!params.ctx.principalId || typeof params.ctx.principalId !== "string" || params.ctx.principalId.trim().length === 0) {
      throw new Error("AUTHENTICATION_REQUIRED: Valid principalId is required in PrincipalContext to decide approval");
    }
    if (!params.ctx.principalType || (params.ctx.principalType !== "human" && params.ctx.principalType !== "agent")) {
      throw new Error("AUTHENTICATION_REQUIRED: Valid principalType ('human' | 'agent') is required in PrincipalContext to decide approval");
    }
    const deciderId = params.ctx.principalId;
    const deciderType = params.ctx.principalType;
    const note = params.decision_note || params.reason || `Decision: ${params.decision}`;
    const now = new Date();
    const nowIso = now.toISOString();

    return this.connManager.withWriteTransaction((db) => {
      const row = db.prepare("SELECT * FROM approval_requests WHERE approval_id = ?").get(approvalId) as any;
      if (!row) {
        throw new Error(`RESOURCE_NOT_FOUND: Approval request ${approvalId} not found`);
      }

      if (row.status !== "pending") {
        throw new Error(`APPROVAL_ALREADY_DECIDED: Request is already ${row.status}`);
      }

      // Mandatory Expiration Check (Fail-closed if missing, null, or invalid)
      if (!row.expires_at) {
        throw new Error(`APPROVAL_INVALID_EXPIRATION: Approval request ${approvalId} lacks mandatory expires_at timestamp`);
      }
      const expiresAtMs = new Date(row.expires_at).getTime();
      if (Number.isNaN(expiresAtMs)) {
        throw new Error(`APPROVAL_INVALID_EXPIRATION: Approval request ${approvalId} has invalid expires_at timestamp`);
      }
      if (expiresAtMs <= now.getTime()) {
        db.prepare("UPDATE approval_requests SET status = 'expired' WHERE approval_id = ?").run(approvalId);
        throw new Error(`APPROVAL_EXPIRED: Cannot decide expired approval request ${approvalId}`);
      }

      // Check tier authorization & Principal verification
      let decidedByHumanId: string | null = null;
      let decidedByAgentId: string | null = null;

      if (row.approval_tier === "founder") {
        if (deciderId !== "founder-01" || deciderType !== "human") {
          throw new Error("PERMISSION_DENIED: Founder tier approvals can ONLY be decided by human founder-01");
        }
        decidedByHumanId = "founder-01";
      } else {
        // Technical tier: must be authenticated human founder-01 or authenticated agent flash-01
        if (deciderId === "founder-01" && deciderType === "human") {
          decidedByHumanId = "founder-01";
        } else if (deciderId === "flash-01" && deciderType === "agent") {
          decidedByAgentId = "flash-01";
        } else {
          throw new Error("PERMISSION_DENIED: Technical tier approvals can only be decided by authenticated founder-01 (human) or flash-01 (agent)");
        }
      }

      // Strict Separation of Duties: Requester cannot decide own approval
      if (row.requested_by_principal_id === deciderId) {
        throw new Error("SOD_VIOLATION: Approver cannot be the same entity that requested approval");
      }

      // Compare-and-Swap (CAS) update on status = 'pending'
      const updateResult = db.prepare(`
        UPDATE approval_requests
        SET status = ?, decided_by_human_id = ?, decided_by_agent_id = ?,
            decided_at = ?, decision_note = ?
        WHERE approval_id = ? AND status = 'pending'
      `).run(params.decision, decidedByHumanId, decidedByAgentId, nowIso, note, approvalId);

      if (updateResult.changes === 0) {
        throw new Error("APPROVAL_CONCURRENT_MODIFICATION: Approval request status was modified concurrently");
      }

      return {
        success: true,
        approval_id: approvalId,
        status: params.decision,
        decided_by: deciderId,
        decided_at: nowIso
      };
    });
  }

  public consumeApproval(
    params: {
      approvalId: string;
      expectedActionType: string;
      canonicalPayload: any;
      requestId?: string;
      expectedTargetAgentId?: string;
      expectedTargetResource?: string;
    },
    existingDb?: any
  ): { valid: boolean; error?: string } {
    const runInDb = (db: any) => {
      // 1. Mandatory Canonical Payload Check (Fail-closed)
      if (params.canonicalPayload === undefined || params.canonicalPayload === null) {
        return { valid: false, error: "CANONICAL_PAYLOAD_MANDATORY: Canonical payload is mandatory for approval consumption" };
      }

      // 2. Load Approval Record
      const row = db.prepare("SELECT * FROM approval_requests WHERE approval_id = ?").get(params.approvalId) as any;
      if (!row) {
        return { valid: false, error: "Approval request not found" };
      }

      // 3. Status must be exactly 'approved'
      if (row.status !== "approved") {
        return { valid: false, error: `Request not in approved state (status: ${row.status})` };
      }

      const now = new Date();

      // 4. Expiration Check (Fail-closed if missing, null, or invalid)
      if (!row.expires_at) {
        return { valid: false, error: "APPROVAL_INVALID_EXPIRATION: Approval request lacks mandatory expires_at" };
      }
      const expiresAtMs = new Date(row.expires_at).getTime();
      if (Number.isNaN(expiresAtMs)) {
        return { valid: false, error: "APPROVAL_INVALID_EXPIRATION: Approval request has invalid expires_at" };
      }
      if (expiresAtMs <= now.getTime()) {
        db.prepare("UPDATE approval_requests SET status = 'expired' WHERE approval_id = ?").run(params.approvalId);
        return { valid: false, error: "APPROVAL_EXPIRED: Cannot consume an expired approval request" };
      }

      // 5. Strict action type binding
      if (params.expectedActionType === "argon_invocation") {
        if (row.action_type !== "argon_invocation") {
          return { valid: false, error: `Action type mismatch: expected argon_invocation, found ${row.action_type}` };
        }
        if (row.approval_tier !== "founder" || row.decided_by_human_id !== "founder-01") {
          return { valid: false, error: "Argon task approvals must be approved by founder-01 (founder tier)" };
        }
      } else {
        if (row.action_type !== params.expectedActionType) {
          return { valid: false, error: `Action type mismatch: expected ${params.expectedActionType}, found ${row.action_type}` };
        }
        if (row.approval_tier === "founder" && row.decided_by_human_id !== "founder-01") {
          return { valid: false, error: "Founder tier approvals must be approved by human founder-01" };
        }
      }

      // 6. Target Agent binding: exact matching, no null target bypass
      if (params.expectedTargetAgentId !== undefined && params.expectedTargetAgentId !== null) {
        if (!row.target_agent_id || row.target_agent_id !== params.expectedTargetAgentId) {
          return {
            valid: false,
            error: `TARGET_AGENT_MISMATCH: expected target agent '${params.expectedTargetAgentId}', but approval record has '${row.target_agent_id || "null"}'`
          };
        }
      }

      // 6.1. Target Resource binding: exact matching, no null target bypass
      if (params.expectedTargetResource !== undefined && params.expectedTargetResource !== null) {
        if (!row.target_resource || row.target_resource !== params.expectedTargetResource) {
          return {
            valid: false,
            error: `TARGET_RESOURCE_MISMATCH: expected target resource '${params.expectedTargetResource}', but approval record has '${row.target_resource || "null"}'`
          };
        }
      }

      // 7. Mandatory payload hash validation: recompute RFC 8785 canonical hash
      if (!row.payload_hash_sha256) {
        return { valid: false, error: "Approval request lacks required payload hash" };
      }

      const { sha256: computedHash } = this.computeCanonicalPayloadHash(params.canonicalPayload);
      if (computedHash !== row.payload_hash_sha256) {
        return { valid: false, error: "Payload hash mismatch: payload differs from approved content" };
      }

      // 8. Atomic compare-and-swap consumption (Single-use enforcement)
      const nowIso = now.toISOString();
      const updateRes = db.prepare(`
        UPDATE approval_requests
        SET status = 'consumed', consumed_at = ?, consumed_by_request_id = ?
        WHERE approval_id = ? AND status = 'approved'
      `).run(nowIso, params.requestId || "req_consume", params.approvalId);

      if (updateRes.changes === 0) {
        return { valid: false, error: "CONCURRENT_CONSUME_CONFLICT: Approval already consumed or modified" };
      }

      return { valid: true };
    };

    if (existingDb) {
      return runInDb(existingDb);
    }
    return this.connManager.withWriteTransaction((db) => runInDb(db));
  }
}
