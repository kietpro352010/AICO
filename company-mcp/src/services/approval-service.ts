import * as crypto from "node:crypto";
import { ConnectionManager } from "../db/connection-manager.js";

export interface ApprovalRequest {
  approval_id: string;
  action_type: string;
  requested_by: string;
  required_approver: string;
  payload_hash_sha256: string;
  status: "pending" | "approved" | "rejected" | "consumed" | "expired";
  created_at: string;
  expires_at: string;
  decided_at?: string | null;
  decided_by?: string | null;
  reason?: string | null;
}

export class ApprovalService {
  private connManager: ConnectionManager;

  constructor(connManager: ConnectionManager) {
    this.connManager = connManager;
  }

  public createApprovalRequest(params: {
    actionType?: string;
    action_type?: string;
    requestedBy?: string;
    requested_by?: string;
    requiredApprover?: string;
    required_approver?: string;
    canonicalPayload?: any;
    canonical_payload?: any;
    expiresInHours?: number;
    expires_in_hours?: number;
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
    const actionType = params.actionType || params.action_type || "general";
    const requestedBy = params.requestedBy || params.requested_by || "chatgpt-01";
    const requiredApprover = params.requiredApprover || params.required_approver || "founder-01";
    const canonicalPayload = params.canonicalPayload || params.canonical_payload || {};
    const expiresInHours = params.expiresInHours || params.expires_in_hours || 24;

    const approvalId = "appr_" + crypto.randomBytes(12).toString("hex");
    const canonicalJson = JSON.stringify(canonicalPayload);
    const payloadHash = crypto.createHash("sha256").update(canonicalJson).digest("hex");

    const now = new Date();
    const expiresAt = new Date(now.getTime() + expiresInHours * 60 * 60 * 1000).toISOString();

    this.connManager.withWriteTransaction((db) => {
      db.prepare(`
        INSERT INTO approval_requests (
          approval_id, action_type, requested_by, required_approver,
          payload_hash_sha256, canonical_payload_json, status,
          created_at, expires_at, decided_at, decided_by, reason
        ) VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?, NULL, NULL, NULL)
      `).run(
        approvalId,
        actionType,
        requestedBy,
        requiredApprover,
        payloadHash,
        canonicalJson,
        now.toISOString(),
        expiresAt
      );
    });

    return {
      approvalId,
      approval_id: approvalId,
      action_type: actionType,
      requested_by: requestedBy,
      required_approver: requiredApprover,
      payloadHashSha256: payloadHash,
      payload_hash_sha256: payloadHash,
      status: "pending",
      expires_at: expiresAt
    };
  }

  public getApprovalRequest(approvalId: string): ApprovalRequest | null {
    return this.connManager.withReadTransaction((db) => {
      const row = db.prepare("SELECT * FROM approval_requests WHERE approval_id = ?").get(approvalId) as any;
      if (!row) return null;
      return {
        approval_id: row.approval_id,
        action_type: row.action_type,
        requested_by: row.requested_by,
        required_approver: row.required_approver,
        payload_hash_sha256: row.payload_hash_sha256,
        status: row.status,
        created_at: row.created_at,
        expires_at: row.expires_at,
        decided_at: row.decided_at,
        decided_by: row.decided_by,
        reason: row.reason
      };
    });
  }

  public listApprovalRequests(filter?: { status?: string; action_type?: string }): ApprovalRequest[] {
    return this.connManager.withReadTransaction((db) => {
      let query = "SELECT * FROM approval_requests";
      const conditions: string[] = [];
      const params: any[] = [];

      if (filter?.status) {
        conditions.push("status = ?");
        params.push(filter.status);
      }
      if (filter?.action_type) {
        conditions.push("action_type = ?");
        params.push(filter.action_type);
      }

      if (conditions.length > 0) {
        query += " WHERE " + conditions.join(" AND ");
      }
      query += " ORDER BY created_at DESC";

      const rows = db.prepare(query).all(...params) as any[];
      return rows.map((row) => ({
        approval_id: row.approval_id,
        action_type: row.action_type,
        requested_by: row.requested_by,
        required_approver: row.required_approver,
        payload_hash_sha256: row.payload_hash_sha256,
        status: row.status,
        created_at: row.created_at,
        expires_at: row.expires_at,
        decided_at: row.decided_at,
        decided_by: row.decided_by,
        reason: row.reason
      }));
    });
  }

  public decideApproval(params: {
    approvalId: string;
    decidedBy: string;
    decision: "approved" | "rejected";
    reason?: string;
  }): { success: boolean; status: string; approval_id?: string; decision?: string; decided_by?: string; decided_at?: string; error?: string } {
    return this.connManager.withWriteTransaction((db) => {
      const row = db.prepare("SELECT * FROM approval_requests WHERE approval_id = ?").get(params.approvalId) as any;
      if (!row) {
        return { success: false, status: "not_found", error: "Approval request not found" };
      }

      if (row.status !== "pending") {
        return { success: false, status: row.status, error: `Cannot decide request in state: ${row.status}` };
      }

      if (new Date(row.expires_at).getTime() < Date.now()) {
        db.prepare("UPDATE approval_requests SET status = 'expired' WHERE approval_id = ?").run(params.approvalId);
        return { success: false, status: "expired", error: "Approval request has expired" };
      }

      if (row.required_approver !== "any" && row.required_approver !== params.decidedBy && params.decidedBy !== "founder-01") {
        return { success: false, status: "unauthorized", error: `Only ${row.required_approver} can decide this request` };
      }

      const now = new Date().toISOString();
      db.prepare(`
        UPDATE approval_requests
        SET status = ?, decided_by = ?, decided_at = ?, reason = ?
        WHERE approval_id = ?
      `).run(params.decision, params.decidedBy, now, params.reason || null, params.approvalId);

      return {
        success: true,
        status: params.decision,
        approval_id: params.approvalId,
        decision: params.decision,
        decided_by: params.decidedBy,
        decided_at: now
      };
    });
  }

  public consumeApproval(params: {
    approvalId: string;
    expectedActionType: string;
    canonicalPayload: any;
  }): { valid: boolean; error?: string } {
    const canonicalJson = JSON.stringify(params.canonicalPayload);
    const expectedHash = crypto.createHash("sha256").update(canonicalJson).digest("hex");

    return this.connManager.withWriteTransaction((db) => {
      const row = db.prepare("SELECT * FROM approval_requests WHERE approval_id = ?").get(params.approvalId) as any;
      if (!row) return { valid: false, error: "Approval not found" };

      if (row.status !== "approved") {
        return { valid: false, error: `Request not in approved state (status: ${row.status})` };
      }

      if (new Date(row.expires_at).getTime() < Date.now()) {
        db.prepare("UPDATE approval_requests SET status = 'expired' WHERE approval_id = ?").run(params.approvalId);
        return { valid: false, error: "Approval has expired" };
      }

      if (row.action_type !== params.expectedActionType) {
        return { valid: false, error: `Action type mismatch: expected ${params.expectedActionType}, got ${row.action_type}` };
      }

      if (row.payload_hash_sha256 !== expectedHash) {
        return { valid: false, error: "Payload hash mismatch: canonical payload differs from approved payload" };
      }

      // Exactly-once consumption
      db.prepare("UPDATE approval_requests SET status = 'consumed' WHERE approval_id = ?").run(params.approvalId);

      return { valid: true };
    });
  }
}
