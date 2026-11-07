import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { ConnectionManager } from "../db/connection-manager.js";
import type { PrincipalContext } from "../security/context-store.js";

export interface AppendAuditEventInput {
  requestId?: string;
  sourceGateway?: "local" | "public" | "stdio" | "system";
  principalType?: "human" | "agent" | "service" | "unauthenticated";
  principalId?: string;
  actorId?: string;
  credentialId?: string | null;
  eventCategory?: "auth" | "policy" | "approval" | "credential" | "workspace" | "git" | "task" | "migration" | "system";
  actionName?: string;
  action?: string;
  targetResource?: string;
  resourceType?: string;
  resourceId?: string;
  outcome: "succeeded" | "denied" | "failed";
  errorCode?: string | null;
  sanitizedDetails?: Record<string, unknown>;
  ctx?: PrincipalContext | null;
}

export interface AuditEventRecord {
  audit_id: number;
  event_id?: string;
  eventId?: string;
  eventHash?: string;
  request_id: string;
  source_gateway: string;
  principal_type: string;
  principal_id: string;
  credential_id: string | null;
  event_category: string;
  action_name: string;
  target_resource: string;
  outcome: string;
  error_code: string | null;
  prev_event_hash: string;
  event_hash_hmac_sha256: string;
  recorded_at: string;
}

export const GENESIS_ANCHOR = "GENESIS_ANCHOR_00000000000000000000000000000000000000000000000000000000";

export class ObservabilityQuotaService {
  private connManager: ConnectionManager;
  private hmacKey: string;
  private anchorFilePath: string;

  constructor(
    connManager: ConnectionManager,
    hmacKey?: string,
    anchorFilePath = "D:/AI-COMPANY/backup/audit_anchors.jsonl"
  ) {
    this.connManager = connManager;
    this.hmacKey = process.env.AICO_AUDIT_HMAC_KEY || hmacKey || "aico_audit_hmac_secret_key_v221";
    this.anchorFilePath = anchorFilePath;
  }

  public initSchema(): void {
    this.connManager.withWriteTransaction((db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS audit_events (
          audit_id INTEGER PRIMARY KEY AUTOINCREMENT,
          event_id TEXT UNIQUE,
          request_id TEXT NOT NULL DEFAULT 'req_init',
          source_gateway TEXT NOT NULL DEFAULT 'local',
          principal_type TEXT NOT NULL DEFAULT 'agent',
          principal_id TEXT NOT NULL DEFAULT 'system',
          credential_id TEXT,
          event_category TEXT NOT NULL DEFAULT 'system',
          action_name TEXT NOT NULL,
          target_resource TEXT NOT NULL,
          outcome TEXT NOT NULL,
          error_code TEXT,
          sanitized_details_json TEXT NOT NULL DEFAULT '{}',
          prev_event_hash TEXT NOT NULL,
          event_hash_sha256 TEXT,
          event_hash_hmac_sha256 TEXT NOT NULL UNIQUE,
          recorded_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
        );
      `);
    });
  }

  private writeAnchorRecord(auditId: number, eventHash: string, recordedAt: string): void {
    try {
      const anchorDir = path.dirname(this.anchorFilePath);
      if (!fs.existsSync(anchorDir)) {
        fs.mkdirSync(anchorDir, { recursive: true });
      }
      const record = JSON.stringify({
        last_audit_id: auditId,
        event_hash_sha256: eventHash,
        timestamp: recordedAt
      }) + "\n";
      fs.appendFileSync(this.anchorFilePath, record, "utf8");
    } catch {
      // Best-effort anchor file logging
    }
  }

  public appendAuditEvent(input: AppendAuditEventInput): AuditEventRecord {
    const requestId = input.ctx?.requestId || input.requestId || "req_audit_" + crypto.randomBytes(6).toString("hex");
    const eventId = "evt_" + crypto.randomBytes(12).toString("hex");
    const sourceGateway = input.ctx?.sourceGateway || input.sourceGateway || "system";
    const principalId = input.ctx?.principalId || input.principalId || input.actorId || "system";
    const principalType = input.ctx?.principalType || input.principalType || (principalId === "founder-01" ? "human" : "agent");
    const credentialId = input.ctx?.credentialId || input.credentialId || null;
    const actionName = input.actionName || input.action || "general_action";
    const targetResource = input.targetResource || (input.resourceType ? `${input.resourceType}:${input.resourceId || ""}` : "default_resource");
    const eventCategory = input.eventCategory || (input.resourceType === "branch" ? "git" : input.resourceType === "approval_request" ? "approval" : "system");
    const nowIso = new Date().toISOString();

    return this.connManager.withWriteTransaction((db) => {
      const lastRow = db.prepare("SELECT event_hash_hmac_sha256 FROM audit_events ORDER BY audit_id DESC LIMIT 1").get() as any;
      const prevHash = lastRow ? lastRow.event_hash_hmac_sha256 : GENESIS_ANCHOR;

      const detailsJson = JSON.stringify(input.sanitizedDetails || {});

      // HMAC-SHA256 calculation
      const hmac = crypto.createHmac("sha256", this.hmacKey);
      hmac.update(`${prevHash}:${requestId}:${principalId}:${eventCategory}:${actionName}:${targetResource}:${input.outcome}:${nowIso}`);
      const eventHash = hmac.digest("hex");

      const res = db.prepare(`
        INSERT INTO audit_events (
          event_id, request_id, source_gateway, principal_type, principal_id, credential_id,
          event_category, action_name, target_resource, outcome, error_code,
          sanitized_details_json, prev_event_hash, event_hash_sha256, event_hash_hmac_sha256, recorded_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        eventId,
        requestId,
        sourceGateway,
        principalType,
        principalId,
        credentialId,
        eventCategory,
        actionName,
        targetResource,
        input.outcome,
        input.errorCode || null,
        detailsJson,
        prevHash,
        eventHash,
        eventHash,
        nowIso
      );

      const auditId = Number(res.lastInsertRowid);

      if (auditId % 50 === 0 || auditId === 1) {
        this.writeAnchorRecord(auditId, eventHash, nowIso);
      }

      return {
        audit_id: auditId,
        event_id: eventId,
        eventId,
        eventHash,
        request_id: requestId,
        source_gateway: sourceGateway,
        principal_type: principalType,
        principal_id: principalId,
        credential_id: credentialId,
        event_category: eventCategory,
        action_name: actionName,
        target_resource: targetResource,
        outcome: input.outcome,
        error_code: input.errorCode || null,
        prev_event_hash: prevHash,
        event_hash_hmac_sha256: eventHash,
        recorded_at: nowIso
      };
    });
  }

  public verifyAuditChainIntegrity(): { valid: boolean; totalEvents: number; brokenAtEventId?: string | number } {
    return this.connManager.withReadTransaction((db) => {
      const rows = db.prepare("SELECT * FROM audit_events ORDER BY audit_id ASC").all() as any[];
      if (rows.length === 0) return { valid: true, totalEvents: 0 };

      let expectedPrevHash = GENESIS_ANCHOR;

      for (const row of rows) {
        if (row.prev_event_hash !== expectedPrevHash) {
          return { valid: false, totalEvents: rows.length, brokenAtEventId: row.event_id || row.audit_id };
        }

        const hmac = crypto.createHmac("sha256", this.hmacKey);
        hmac.update(`${expectedPrevHash}:${row.request_id}:${row.principal_id}:${row.event_category}:${row.action_name}:${row.target_resource}:${row.outcome}:${row.recorded_at}`);
        const computedHash = hmac.digest("hex");

        if (computedHash !== row.event_hash_hmac_sha256) {
          return { valid: false, totalEvents: rows.length, brokenAtEventId: row.event_id || row.audit_id };
        }

        expectedPrevHash = row.event_hash_hmac_sha256;
      }

      return { valid: true, totalEvents: rows.length };
    });
  }

  public recordMcpActivity(params: {
    ctx: PrincipalContext | null;
    toolName: string;
    durationMs: number;
    outcome: "succeeded" | "failed" | "denied";
    errorCode?: string;
  }): void {
    const agentId = params.ctx?.agentId || "founder-01";
    const requestId = params.ctx?.requestId || "req_mcp";
    const nowIso = new Date().toISOString();

    try {
      this.connManager.withWriteTransaction((db) => {
        db.prepare(`
          INSERT INTO agent_usage_events (
            request_id, task_id, agent_id, quota_pool_id, usage_category,
            event_type, calls_count, duration_ms, source, confidence, recorded_at
          ) VALUES (?, NULL, ?, NULL, 'mcp_tool_activity', ?, 1, ?, 'mcp_metered', 'verified', ?)
        `).run(requestId, agentId, params.toolName, params.durationMs, nowIso);
      });
    } catch {
      // Best-effort usage activity logging
    }
  }

  public recordModelUsage(params: {
    ctx?: PrincipalContext;
    agentId: string;
    quotaPoolId?: string;
    taskId?: string;
    inputTokens: number;
    outputTokens: number;
    cachedTokens?: number;
    source?: "provider_api" | "operator_reported" | "client_estimated" | "manual";
  }): void {
    const nowIso = new Date().toISOString();
    this.connManager.withWriteTransaction((db) => {
      db.prepare(`
        INSERT INTO agent_usage_events (
          request_id, task_id, agent_id, quota_pool_id, usage_category,
          event_type, calls_count, input_tokens, output_tokens, cached_tokens,
          source, confidence, recorded_at
        ) VALUES (?, ?, ?, ?, 'model_inference_usage', 'inference', 1, ?, ?, ?, ?, 'verified', ?)
      `).run(
        params.ctx?.requestId || "req_model",
        params.taskId || null,
        params.agentId,
        params.quotaPoolId || null,
        params.inputTokens,
        params.outputTokens,
        params.cachedTokens || 0,
        params.source || "provider_api",
        nowIso
      );
    });
  }

  public getSystemStatusAndUsage(): {
    database_status: string;
    total_audit_events: number;
    audit_chain_valid: boolean;
    recent_audit_events: AuditEventRecord[];
  } {
    const chainCheck = this.verifyAuditChainIntegrity();
    return this.connManager.withReadTransaction((db) => {
      const recent = db.prepare("SELECT * FROM audit_events ORDER BY audit_id DESC LIMIT 10").all() as unknown as AuditEventRecord[];
      return {
        database_status: "online",
        total_audit_events: chainCheck.totalEvents,
        audit_chain_valid: chainCheck.valid,
        recent_audit_events: recent
      };
    });
  }
}
