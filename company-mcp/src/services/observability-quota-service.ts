import * as crypto from "node:crypto";
import * as fs from "node:fs";
import { ConnectionManager } from "../db/connection-manager.js";

export interface AuditEventInput {
  actorId: string;
  action: string;
  resourceType: string;
  resourceId: string;
  outcome: "succeeded" | "failed" | "denied";
  payload?: any;
}

export class ObservabilityQuotaService {
  private connManager: ConnectionManager;
  private hmacKey: string;
  private anchorFilePath: string;

  constructor(connManager: ConnectionManager, hmacKey = "aico_audit_hmac_secret_key_v221", anchorFilePath = "D:/AI-COMPANY/backup/audit_anchors.jsonl") {
    this.connManager = connManager;
    this.hmacKey = hmacKey;
    this.anchorFilePath = anchorFilePath;
  }

  public initSchema(): void {
    this.connManager.withWriteTransaction((db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS audit_events (
          event_id TEXT PRIMARY KEY,
          actor_id TEXT NOT NULL,
          action TEXT NOT NULL,
          resource_type TEXT NOT NULL,
          resource_id TEXT NOT NULL,
          outcome TEXT NOT NULL,
          prev_event_hash TEXT NOT NULL,
          event_hash_sha256 TEXT NOT NULL,
          created_at TEXT NOT NULL
        );
      `);
    });
  }

  public appendAuditEvent(input: AuditEventInput): { eventId: string; eventHash: string } {
    const eventId = "evt_" + crypto.randomBytes(12).toString("hex");
    const now = new Date().toISOString();

    return this.connManager.withWriteTransaction((db) => {
      const lastRow = db.prepare("SELECT event_hash_sha256 FROM audit_events ORDER BY rowid DESC LIMIT 1").get() as any;
      const prevHash = lastRow ? lastRow.event_hash_sha256 : "GENESIS_ANCHOR_00000000000000000000000000000000000000000000000000000000";

      const hmac = crypto.createHmac("sha256", this.hmacKey);
      hmac.update(`${prevHash}:${eventId}:${input.actorId}:${input.action}:${input.resourceType}:${input.resourceId}:${input.outcome}:${now}`);
      const eventHash = hmac.digest("hex");

      db.prepare(`
        INSERT INTO audit_events (
          event_id, actor_id, action, resource_type, resource_id, outcome,
          prev_event_hash, event_hash_sha256, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        eventId,
        input.actorId,
        input.action,
        input.resourceType,
        input.resourceId,
        input.outcome,
        prevHash,
        eventHash,
        now
      );

      return { eventId, eventHash };
    });
  }

  public verifyAuditChainIntegrity(): { valid: boolean; totalEvents: number; brokenAtEventId?: string } {
    return this.connManager.withReadTransaction((db) => {
      const rows = db.prepare("SELECT * FROM audit_events ORDER BY rowid ASC").all() as any[];
      if (rows.length === 0) return { valid: true, totalEvents: 0 };

      let expectedPrevHash = "GENESIS_ANCHOR_00000000000000000000000000000000000000000000000000000000";

      for (const row of rows) {
        if (row.prev_event_hash !== expectedPrevHash) {
          return { valid: false, totalEvents: rows.length, brokenAtEventId: row.event_id };
        }

        const hmac = crypto.createHmac("sha256", this.hmacKey);
        hmac.update(`${expectedPrevHash}:${row.event_id}:${row.actor_id}:${row.action}:${row.resource_type}:${row.resource_id}:${row.outcome}:${row.created_at}`);
        const computedHash = hmac.digest("hex");

        if (computedHash !== row.event_hash_sha256) {
          return { valid: false, totalEvents: rows.length, brokenAtEventId: row.event_id };
        }

        expectedPrevHash = row.event_hash_sha256;
      }

      return { valid: true, totalEvents: rows.length };
    });
  }
}
