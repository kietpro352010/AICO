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
    actionType: string;
    requestedBy: string;
    requiredApprover?: string;
    canonicalPayload: any;
    expiresInHours?: number;
  }): { approvalId: string; payloadHashSha256: string } {
    const approvalId = "appr_" + crypto.randomBytes(12).toString("hex");
    const canonicalJson = JSON.stringify(params.canonicalPayload);
    const payloadHash = crypto.createHash("sha256").update(canonicalJson).digest("hex");

    const now = new Date();
    const expiresInHours = params.expiresInHours || 24;
    const expiresAt = new Date(now.getTime() + expiresInHours * 60 * 60 * 1000).toISOString();
    const requiredApprover = params.requiredApprover || "founder-01";

    this.connManager.withWriteTransaction((db) => {
      db.prepare(`
        INSERT INTO approval_requests (
          approval_id, action_type, requested_by, required_approver,
          payload_hash_sha256, canonical_payload_json, status,
          created_at, expires_at, decided_at, decided_by, reason
        ) VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?, NULL, NULL, NULL)
      `).run(
        approvalId,
        params.actionType,
        params.requestedBy,
        requiredApprover,
        payloadHash,
        canonicalJson,
        now.toISOString(),
        expiresAt
      );
    });

    return { approvalId, payloadHashSha256: payloadHash };
  }

  public decideApproval(params: {
    approvalId: string;
    decidedBy: string;
    decision: "approved" | "rejected";
    reason?: string;
  }): { success: boolean; status: string; error?: string } {
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

      return { success: true, status: params.decision };
    });
  }

  public consumeApproval(params: {
    approvalId: string;
    expectedActionType: string;
    canonicalPayload: any;
  }): { valid: boolean; error?: string } {
    const canonicalJson = JSON.stringify(params.canonicalPayload);
    const payloadHash = crypto.createHash("sha256").update(canonicalJson).digest("hex");

    return this.connManager.withWriteTransaction((db) => {
      const row = db.prepare("SELECT * FROM approval_requests WHERE approval_id = ?").get(params.approvalId) as any;
      if (!row) {
        return { valid: false, error: "Approval not found" };
      }

      if (row.status !== "approved") {
        return { valid: false, error: `Approval is not in approved state (current: ${row.status})` };
      }

      if (row.action_type !== params.expectedActionType) {
        return { valid: false, error: `Action type mismatch: expected ${params.expectedActionType}, found ${row.action_type}` };
      }

      if (row.payload_hash_sha256 !== payloadHash) {
        return { valid: false, error: "Payload hash mismatch: canonical payload does not match approved request" };
      }

      if (new Date(row.expires_at).getTime() < Date.now()) {
        db.prepare("UPDATE approval_requests SET status = 'expired' WHERE approval_id = ?").run(params.approvalId);
        return { valid: false, error: "Approval request has expired" };
      }

      // Exactly-once consumption
      db.prepare("UPDATE approval_requests SET status = 'consumed' WHERE approval_id = ?").run(params.approvalId);

      return { valid: true };
    });
  }
}
