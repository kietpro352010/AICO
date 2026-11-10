import { rfc8785Canonicalize } from "../security/rfc8785-canonicalize.js";
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
    anchorFilePath?: string
  ) {
    this.connManager = connManager;
    const resolvedKey = process.env.AICO_AUDIT_HMAC_KEY || hmacKey;
    if (!resolvedKey) {
      if (process.env.NODE_ENV !== "test") {
        throw new Error("CONFIGURATION_ERROR: AICO_AUDIT_HMAC_KEY environment variable is mandatory outside NODE_ENV=test");
      }
      this.hmacKey = "aico_audit_hmac_test_key_v221_min32bytes!";
    } else {
      if (resolvedKey.length < 32 && process.env.NODE_ENV !== "test") {
        throw new Error("CONFIGURATION_ERROR: AICO_AUDIT_HMAC_KEY must be at least 32 characters in production");
      }
      if (resolvedKey.length < 16) {
        throw new Error("CONFIGURATION_ERROR: AICO_AUDIT_HMAC_KEY must be at least 16 characters");
      }
      this.hmacKey = resolvedKey;
    }

    this.anchorFilePath = anchorFilePath || process.env.AICO_AUDIT_ANCHOR_FILE || path.join(process.cwd(), "backup", "audit_anchors.jsonl");
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
    const anchorDir = path.dirname(this.anchorFilePath);
    if (!fs.existsSync(anchorDir)) {
      fs.mkdirSync(anchorDir, { recursive: true });
    }
    const record = JSON.stringify({
      last_audit_id: auditId,
      event_hash_sha256: eventHash,
      timestamp: recordedAt
    }) + "\n";
    try {
      fs.appendFileSync(this.anchorFilePath, record, "utf8");
    } catch (err: any) {
      throw new Error(`AUDIT_ANCHOR_WRITE_FAILURE: Could not write anchor record to '${this.anchorFilePath}': ${err.message}`);
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

    let anchorToRecord: { auditId: number; eventHash: string; nowIso: string } | null = null;

    const result = this.connManager.withWriteTransaction((db) => {
      const lastRow = db.prepare("SELECT event_hash_hmac_sha256 FROM audit_events ORDER BY audit_id DESC LIMIT 1").get() as any;
      const prevHash = lastRow ? lastRow.event_hash_hmac_sha256 : GENESIS_ANCHOR;

      const detailsJson = JSON.stringify(input.sanitizedDetails || {});

      // Canonical payload for unambiguous RFC 8785 HMAC serialization
      const canonicalPayload = {
        action_name: actionName,
        credential_id: credentialId || "",
        details: input.sanitizedDetails || {},
        error_code: input.errorCode || "",
        event_category: eventCategory,
        event_id: eventId,
        outcome: input.outcome,
        prev_event_hash: prevHash,
        principal_id: principalId,
        principal_type: principalType,
        recorded_at: nowIso,
        request_id: requestId,
        source_gateway: sourceGateway,
        target_resource: targetResource
      };
      const payloadToSign = rfc8785Canonicalize(canonicalPayload);
      const hmac = crypto.createHmac("sha256", this.hmacKey);
      hmac.update(payloadToSign, "utf8");
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

      // Record every event in anchor log to support precise tail truncation detection
      anchorToRecord = { auditId, eventHash, nowIso };

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

    // Write anchor after transaction commits
    const anchor = anchorToRecord as { auditId: number; eventHash: string; nowIso: string } | null;
    if (anchor) {
      try {
        this.writeAnchorRecord(anchor.auditId, anchor.eventHash, anchor.nowIso);
      } catch (err: any) {
        throw new Error(`AUDIT_ANCHOR_WRITE_FAILURE: Event ${anchor.auditId} committed to DB, but failed writing anchor: ${err.message}`);
      }
    }

    return result;
  }

  public verifyAuditChainIntegrity(): { valid: boolean; totalEvents: number; brokenAtEventId?: string | number } {
    return this.connManager.withReadTransaction((db) => {
      const rows = db.prepare("SELECT * FROM audit_events ORDER BY audit_id ASC").all() as any[];

      // Truncation defense: if database table is empty, check whether external anchor file or sequence metadata contains recorded events
      if (rows.length === 0) {
        if (fs.existsSync(this.anchorFilePath)) {
          try {
            const content = fs.readFileSync(this.anchorFilePath, "utf8");
            const lines = content.split(/\r?\n/).map((l) => l.trim()).filter((l) => l.length > 0);
            if (lines.length > 0) {
              return {
                valid: false,
                totalEvents: 0,
                brokenAtEventId: "AUDIT_LOG_MISSING_OR_TRUNCATED"
              };
            }
          } catch (err: any) {
            // Unreadable anchor file must NEVER produce a valid integrity result (P0/P1-B)
            return {
              valid: false,
              totalEvents: 0,
              brokenAtEventId: `UNREADABLE_AUDIT_ANCHOR_FILE: ${err.message}`
            };
          }
        }

        // Even if anchor file is missing or empty, check sqlite_sequence for historical evidence of truncation
        try {
          const seqRow = db.prepare("SELECT seq FROM sqlite_sequence WHERE name = 'audit_events'").get() as any;
          if (seqRow && Number(seqRow.seq) > 0) {
            return {
              valid: false,
              totalEvents: 0,
              brokenAtEventId: `TAIL_TRUNCATION_DETECTED: sqlite_sequence indicates historical audit events existed (seq=${seqRow.seq}) but audit_events table is empty`
            };
          }
        } catch {
          // sqlite_sequence may not exist in mock environments
        }

        return { valid: true, totalEvents: 0 };
      }

      let expectedPrevHash = GENESIS_ANCHOR;
      const rowByAuditId = new Map<number, any>();

      for (const row of rows) {
        rowByAuditId.set(row.audit_id, row);

        if (row.prev_event_hash !== expectedPrevHash) {
          return { valid: false, totalEvents: rows.length, brokenAtEventId: row.event_id || row.audit_id };
        }

        let detailsParsed: any = {};
        try {
          detailsParsed = JSON.parse(row.sanitized_details_json || "{}");
        } catch {
          detailsParsed = {};
        }

        const canonicalPayload = {
          action_name: row.action_name,
          credential_id: row.credential_id || "",
          details: detailsParsed,
          error_code: row.error_code || "",
          event_category: row.event_category,
          event_id: row.event_id || "",
          outcome: row.outcome,
          prev_event_hash: expectedPrevHash,
          principal_id: row.principal_id,
          principal_type: row.principal_type,
          recorded_at: row.recorded_at,
          request_id: row.request_id,
          source_gateway: row.source_gateway,
          target_resource: row.target_resource
        };
        const payloadToSign = rfc8785Canonicalize(canonicalPayload);
        const hmac = crypto.createHmac("sha256", this.hmacKey);
        hmac.update(payloadToSign, "utf8");
        const computedHash = hmac.digest("hex");

        if (computedHash !== row.event_hash_hmac_sha256) {
          return { valid: false, totalEvents: rows.length, brokenAtEventId: row.event_id || row.audit_id };
        }

        expectedPrevHash = row.event_hash_hmac_sha256;
      }

      // Cross-media verification against anchor file: mandatory if audit events exist
      if (rows.length >= 1) {
        if (!fs.existsSync(this.anchorFilePath)) {
          return {
            valid: false,
            totalEvents: rows.length,
            brokenAtEventId: "MISSING_AUDIT_ANCHOR_FILE"
          };
        }

        try {
          const content = fs.readFileSync(this.anchorFilePath, "utf8");
          const lines = content.split(/\r?\n/).map((l) => l.trim()).filter((l) => l.length > 0);
          if (lines.length === 0) {
            return {
              valid: false,
              totalEvents: rows.length,
              brokenAtEventId: "EMPTY_AUDIT_ANCHOR_FILE"
            };
          }

          // Strict coverage check: anchor records must match the DB events count
          if (lines.length < rows.length) {
            return {
              valid: false,
              totalEvents: rows.length,
              brokenAtEventId: `ANCHOR_COVERAGE_DEFICIT: Expected ${rows.length} anchor record(s) for ${rows.length} DB events, but found ${lines.length} (truncation/deletion detected)`
            };
          }
          if (lines.length > rows.length) {
            return {
              valid: false,
              totalEvents: rows.length,
              brokenAtEventId: `ANCHOR_COVERAGE_EXCESS: Found ${lines.length} anchor record(s) but database only has ${rows.length} events (potential DB rollback/truncation)`
            };
          }

          let prevAnchorId = 0;
          for (let i = 0; i < lines.length; i++) {
            let anchor: any;
            try {
              anchor = JSON.parse(lines[i]);
            } catch (err: any) {
              return {
                valid: false,
                totalEvents: rows.length,
                brokenAtEventId: `MALFORMED_ANCHOR_RECORD: line ${i + 1} is not valid JSON (${err.message})`
              };
            }

            if (!anchor || typeof anchor.last_audit_id !== "number" || !anchor.event_hash_sha256) {
              return {
                valid: false,
                totalEvents: rows.length,
                brokenAtEventId: `MALFORMED_ANCHOR_RECORD: line ${i + 1} has invalid structure`
              };
            }

            // Check strictly increasing sequence / duplicate / reordering
            if (anchor.last_audit_id <= prevAnchorId) {
              return {
                valid: false,
                totalEvents: rows.length,
                brokenAtEventId: `DUPLICATE_OR_REORDERED_ANCHOR: line ${i + 1} has audit_id ${anchor.last_audit_id} <= previous ${prevAnchorId}`
              };
            }

            // Exact 1-to-1 matching with rows[i]
            const expectedRow = rows[i];
            if (anchor.last_audit_id !== expectedRow.audit_id) {
              return {
                valid: false,
                totalEvents: rows.length,
                brokenAtEventId: `ANCHOR_SEQUENCE_MISMATCH: line ${i + 1} has audit_id ${anchor.last_audit_id}, but expected DB audit_id is ${expectedRow.audit_id}`
              };
            }

            const expectedHash = expectedRow.event_hash_hmac_sha256 || expectedRow.event_hash_sha256;
            if (anchor.event_hash_sha256 !== expectedHash) {
              return {
                valid: false,
                totalEvents: rows.length,
                brokenAtEventId: `ANCHOR_HASH_MISMATCH: line ${i + 1} (audit_id ${anchor.last_audit_id}) hash does not match DB hash`
              };
            }

            prevAnchorId = anchor.last_audit_id;
          }

          // Tail truncation check via sqlite_sequence
          try {
            const seqRow = db.prepare("SELECT seq FROM sqlite_sequence WHERE name = 'audit_events'").get() as any;
            if (seqRow && Number(seqRow.seq) > rows[rows.length - 1].audit_id) {
              return {
                valid: false,
                totalEvents: rows.length,
                brokenAtEventId: `TAIL_TRUNCATION_DETECTED: sqlite_sequence indicates tail deletion (seq=${seqRow.seq}, max_id=${rows[rows.length - 1].audit_id})`
              };
            }
          } catch {
            // sqlite_sequence may not exist in mock environments
          }
        } catch (err: any) {
          return {
            valid: false,
            totalEvents: rows.length,
            brokenAtEventId: `CORRUPT_AUDIT_ANCHOR_FILE: ${err.message}`
          };
        }
      }

      return { valid: true, totalEvents: rows.length };
    });
  }

  public reconcileUnanchoredEvents(): { reconciledCount: number; latestAnchorAuditId: number } {
    return this.connManager.withWriteTransaction((db) => {
      const rows = db.prepare("SELECT * FROM audit_events ORDER BY audit_id ASC").all() as any[];
      if (rows.length === 0) {
        if (fs.existsSync(this.anchorFilePath)) {
          let lines: string[] = [];
          try {
            const content = fs.readFileSync(this.anchorFilePath, "utf8");
            lines = content.split(/\r?\n/).map((l) => l.trim()).filter((l) => l.length > 0);
          } catch (err: any) {
            throw new Error(`SAFE_RECONCILIATION_REFUSED: Unreadable anchor file: ${err.message}`);
          }
          if (lines.length > 0) {
            throw new Error(`SAFE_RECONCILIATION_REFUSED: Database has 0 events but historical anchor file contains ${lines.length} record(s). Truncation/data loss detected. Fail-closed: manual intervention required.`);
          }
        }

        try {
          const seqRow = db.prepare("SELECT seq FROM sqlite_sequence WHERE name = 'audit_events'").get() as any;
          if (seqRow && Number(seqRow.seq) > 0) {
            throw new Error(`SAFE_RECONCILIATION_REFUSED: Database has 0 events but sqlite_sequence indicates historical records existed (seq=${seqRow.seq}). Truncation/data loss detected. Fail-closed: manual intervention required.`);
          }
        } catch (err: any) {
          if (err.message && err.message.startsWith("SAFE_RECONCILIATION_REFUSED")) throw err;
        }

        return { reconciledCount: 0, latestAnchorAuditId: 0 };
      }

      // 1. STEP 1: Verify HMAC chain integrity for all events in DB
      let expectedPrevHash = GENESIS_ANCHOR;
      for (const row of rows) {
        if (row.prev_event_hash !== expectedPrevHash) {
          throw new Error(`SAFE_RECONCILIATION_REFUSED: Database HMAC chain is corrupted at audit_id ${row.audit_id}. Cannot reconcile unanchored events on invalid DB state.`);
        }

        let detailsParsed: any = {};
        try {
          detailsParsed = JSON.parse(row.sanitized_details_json || "{}");
        } catch {
          detailsParsed = {};
        }

        const canonicalPayload = {
          action_name: row.action_name,
          credential_id: row.credential_id || "",
          details: detailsParsed,
          error_code: row.error_code || "",
          event_category: row.event_category,
          event_id: row.event_id || "",
          outcome: row.outcome,
          prev_event_hash: expectedPrevHash,
          principal_id: row.principal_id,
          principal_type: row.principal_type,
          recorded_at: row.recorded_at,
          request_id: row.request_id,
          source_gateway: row.source_gateway,
          target_resource: row.target_resource
        };
        const payloadToSign = rfc8785Canonicalize(canonicalPayload);
        const hmac = crypto.createHmac("sha256", this.hmacKey);
        hmac.update(payloadToSign, "utf8");
        const computedHash = hmac.digest("hex");

        if (computedHash !== row.event_hash_hmac_sha256) {
          throw new Error(`SAFE_RECONCILIATION_REFUSED: Database HMAC hash mismatch at audit_id ${row.audit_id}. Cannot reconcile unanchored events on tampered DB.`);
        }

        expectedPrevHash = row.event_hash_hmac_sha256;
      }

      // 2. STEP 2: Validate existing anchor file (fail-closed if missing, empty, malformed, corrupted, or tampered)
      // P0/P1-A: Missing or empty anchor file with existing audit records MUST fail closed!
      if (!fs.existsSync(this.anchorFilePath)) {
        throw new Error(`SAFE_RECONCILIATION_REFUSED: Anchor file is completely missing while database contains ${rows.length} audit event(s). Cannot silently reconstruct anchor history. Manual intervention required.`);
      }

      let content = "";
      try {
        content = fs.readFileSync(this.anchorFilePath, "utf8");
      } catch (err: any) {
        throw new Error(`SAFE_RECONCILIATION_REFUSED: Unreadable anchor file: ${err.message}. Fail-closed: manual intervention required.`);
      }

      const lines = content.split(/\r?\n/).map((l) => l.trim()).filter((l) => l.length > 0);
      if (lines.length === 0) {
        throw new Error(`SAFE_RECONCILIATION_REFUSED: Anchor file is empty while database contains ${rows.length} audit event(s). Cannot silently reconstruct anchor history. Manual intervention required.`);
      }

      let latestAnchorAuditId = 0;
      const rowByAuditId = new Map<number, any>();
      for (const r of rows) {
        rowByAuditId.set(r.audit_id, r);
      }

      let prevAnchorId = 0;
      for (let i = 0; i < lines.length; i++) {
        let anchor: any;
        try {
          anchor = JSON.parse(lines[i]);
        } catch (err: any) {
          throw new Error(`SAFE_RECONCILIATION_REFUSED: Malformed anchor JSON at line ${i + 1}: ${err.message}. Fail-closed: manual intervention required.`);
        }

        if (!anchor || typeof anchor.last_audit_id !== "number" || !anchor.event_hash_sha256) {
          throw new Error(`SAFE_RECONCILIATION_REFUSED: Malformed anchor record structure at line ${i + 1}. Fail-closed.`);
        }

        if (anchor.last_audit_id <= prevAnchorId) {
          throw new Error(`SAFE_RECONCILIATION_REFUSED: Anchor file contains duplicate or out-of-order audit_id ${anchor.last_audit_id} at line ${i + 1}. Fail-closed.`);
        }

        if (i >= rows.length) {
          throw new Error(`SAFE_RECONCILIATION_REFUSED: Anchor file contains ${lines.length} records, exceeding database event count of ${rows.length} (database rollback/truncation detected). Fail-closed.`);
        }

        const matchingRow = rowByAuditId.get(anchor.last_audit_id);
        if (!matchingRow) {
          throw new Error(`SAFE_RECONCILIATION_REFUSED: Anchor audit_id ${anchor.last_audit_id} does not exist in database (rollback detected). Fail-closed.`);
        }

        const expectedHash = matchingRow.event_hash_hmac_sha256 || matchingRow.event_hash_sha256;
        if (anchor.event_hash_sha256 !== expectedHash) {
          throw new Error(`SAFE_RECONCILIATION_REFUSED: Anchor hash mismatch at audit_id ${anchor.last_audit_id}. Fail-closed.`);
        }

        // Check continuity: anchor i must match row i
        if (anchor.last_audit_id !== rows[i].audit_id) {
          throw new Error(`SAFE_RECONCILIATION_REFUSED: Anchor file has gap at line ${i + 1}: expected audit_id ${rows[i].audit_id}, found ${anchor.last_audit_id}. Fail-closed.`);
        }

        prevAnchorId = anchor.last_audit_id;
        latestAnchorAuditId = anchor.last_audit_id;
      }

      // 3. STEP 3: Only recover strictly unanchored events (audit_id > latestAnchorAuditId)
      const unanchoredRows = db.prepare(
        "SELECT * FROM audit_events WHERE audit_id > ? ORDER BY audit_id ASC"
      ).all(latestAnchorAuditId) as any[];

      if (unanchoredRows.length === 0) {
        return { reconciledCount: 0, latestAnchorAuditId };
      }

      let reconciledCount = 0;
      for (const row of unanchoredRows) {
        const hash = row.event_hash_hmac_sha256 || row.event_hash_sha256;
        this.writeAnchorRecord(row.audit_id, hash, row.recorded_at);
        reconciledCount++;
        latestAnchorAuditId = row.audit_id;
      }

      return { reconciledCount, latestAnchorAuditId };
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
