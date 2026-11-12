import * as crypto from "node:crypto";
import { ConnectionManager } from "../db/connection-manager.js";
import { SecretScanner } from "../security/secret-scanner.js";
import { assertAuthenticatedContext, type PrincipalContext } from "../security/context-store.js";
import { normalizeBoundedLimit } from "../contracts/query-limits.js";

export interface SendMessageParams {
  ctx?: PrincipalContext;
  fromPrincipalId?: string;
  from_principal_id?: string;
  toPrincipalId?: string;
  to_principal_id?: string;
  subject: string;
  bodyMarkdown?: string;
  body_markdown?: string;
  threadId?: string;
  thread_id?: string;
  taskId?: string;
  task_id?: string;
  messageType?: "task_handoff" | "question" | "review_request" | "result" | "approval_request" | "alert";
  message_type?: "task_handoff" | "question" | "review_request" | "result" | "approval_request" | "alert";
  sensitivity?: "public" | "internal" | "confidential";
  artifactIds?: string[];
  artifact_ids?: string[];
}

export interface MessageView {
  message_id: string;
  thread_id: string;
  from_principal_id: string;
  to_principal_id: string;
  message_type: string;
  subject: string;
  body_markdown: string;
  task_id?: string | null;
  delivery_status: string;
  created_at: string;
}

export interface MessageAckOutput {
  success: boolean;
  message_id: string;
  recipient_id: string;
  delivery_status: "acknowledged";
  acknowledged_at: string;
}

export class MessagingService {
  private connManager: ConnectionManager;

  constructor(connManager: ConnectionManager) {
    this.connManager = connManager;
  }

  // Idempotent schema init (database migration is authoritative)
  public initSchema(): void {
    // No-op - schema-v050-rc2.sql is the single source of truth
  }

  public sendMessage(params: SendMessageParams): MessageView {
    assertAuthenticatedContext(params.ctx, "sendMessage", { allowedPrincipalTypes: ["human", "agent"] });
    const fromPrincipalId = params.ctx.principalId;
    const fromPrincipalType = params.ctx.principalType;
    const toPrincipalId = params.toPrincipalId || params.to_principal_id;
    if (!toPrincipalId) {
      throw new Error("INVALID_ARGUMENT: toPrincipalId is required");
    }
    const toPrincipalType = toPrincipalId === "founder-01" ? "human" : "agent";

    const bodyMarkdown = params.bodyMarkdown || params.body_markdown || "";
    const subject = params.subject;
    const threadId = params.threadId || params.thread_id || "thread_" + crypto.randomBytes(8).toString("hex");
    const taskId = params.taskId || params.task_id || null;
    const messageType = params.messageType || params.message_type || "question";
    const sensitivity = params.sensitivity || "internal";
    const artifactIds = params.artifactIds || params.artifact_ids || [];

    // Pre-flight Secret Scanner (subject + bodyMarkdown)
    const subjectScan = SecretScanner.scan(subject);
    if (subjectScan.hasSecret) {
      throw new Error(
        `SECRET_LEAK_PREVENTED: Message subject contains sensitive credential pattern (${subjectScan.secretId ?? subjectScan.patternMatched}): ${subjectScan.patternMatched}`
      );
    }

    const bodyScan = SecretScanner.scan(bodyMarkdown);
    if (bodyScan.hasSecret) {
      throw new Error(
        `SECRET_LEAK_PREVENTED: Message contains sensitive credential pattern (${bodyScan.secretId ?? bodyScan.patternMatched}): ${bodyScan.patternMatched}`
      );
    }

    const messageId = "msg_" + crypto.randomBytes(12).toString("hex");
    const nowIso = new Date().toISOString();

    return this.connManager.withWriteTransaction((db) => {
      db.prepare(`
        INSERT INTO messages (
          message_id, thread_id, task_id, from_principal_type, from_principal_id,
          message_type, subject, body_markdown, artifact_ids_json, sensitivity, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        messageId,
        threadId,
        taskId,
        fromPrincipalType,
        fromPrincipalId,
        messageType,
        subject,
        bodyMarkdown,
        JSON.stringify(artifactIds),
        sensitivity,
        nowIso
      );

      db.prepare(`
        INSERT INTO message_recipients (
          message_id, to_principal_type, to_principal_id, delivery_status,
          inbox_file_path, delivered_at
        ) VALUES (?, ?, ?, 'stored_in_inbox', NULL, ?)
      `).run(
        messageId,
        toPrincipalType,
        toPrincipalId,
        nowIso
      );

      return {
        message_id: messageId,
        thread_id: threadId,
        from_principal_id: fromPrincipalId,
        to_principal_id: toPrincipalId,
        message_type: messageType,
        subject,
        body_markdown: bodyMarkdown,
        task_id: taskId,
        delivery_status: "stored_in_inbox",
        created_at: nowIso
      };
    });
  }

  public listInbox(principalId: string, filter?: { status?: string; limit?: number }): MessageView[] {
    const limit = normalizeBoundedLimit(filter?.limit);
    return this.connManager.withReadTransaction((db) => {
      let query = `
        SELECT m.*, r.to_principal_id, r.delivery_status
        FROM messages m
        JOIN message_recipients r ON m.message_id = r.message_id
        WHERE r.to_principal_id = ?
      `;
      const params: any[] = [principalId];

      if (filter?.status) {
        query += " AND r.delivery_status = ?";
        params.push(filter.status);
      }

      query += " ORDER BY m.created_at DESC LIMIT ?";
      params.push(limit);

      const rows = db.prepare(query).all(...params) as any[];
      return rows.map((r) => ({
        message_id: r.message_id,
        thread_id: r.thread_id,
        from_principal_id: r.from_principal_id,
        to_principal_id: r.to_principal_id,
        message_type: r.message_type,
        subject: r.subject,
        body_markdown: r.body_markdown,
        task_id: r.task_id,
        delivery_status: r.delivery_status,
        created_at: r.created_at
      }));
    });
  }

  public ackMessage(messageId: string, recipientId: string, note?: string): MessageAckOutput {
    if (note) {
      const noteScan = SecretScanner.scan(note);
      if (noteScan.hasSecret) {
        throw new Error(
          `SECRET_LEAK_PREVENTED: Message acknowledgment note contains sensitive credential pattern (${noteScan.secretId ?? noteScan.patternMatched}): ${noteScan.patternMatched}`
        );
      }
    }

    const nowIso = new Date().toISOString();
    return this.connManager.withWriteTransaction((db) => {
      const rec = db.prepare("SELECT * FROM message_recipients WHERE message_id = ? AND to_principal_id = ?").get(messageId, recipientId) as any;
      if (!rec) {
        throw new Error(`RESOURCE_NOT_FOUND: Message recipient entry not found for message ${messageId} and recipient ${recipientId}`);
      }

      db.prepare(`
        UPDATE message_recipients
        SET delivery_status = 'acknowledged', acknowledged_at = ?, ack_note = ?
        WHERE message_id = ? AND to_principal_id = ?
      `).run(nowIso, note || null, messageId, recipientId);

      return {
        success: true,
        message_id: messageId,
        recipient_id: recipientId,
        delivery_status: "acknowledged",
        acknowledged_at: nowIso
      };
    });
  }
}
