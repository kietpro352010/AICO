import crypto from "node:crypto";
import { ConnectionManager } from "../db/connection-manager.js";
import { SecretScanner } from "../security/secret-scanner.js";

export interface SendMessageParams {
  fromPrincipalId: string;
  toPrincipalId: string;
  subject: string;
  bodyMarkdown: string;
  threadId?: string;
  taskId?: string;
  priority?: "low" | "normal" | "urgent";
}

export interface MessageView {
  message_id: string;
  from_principal_id: string;
  to_principal_id: string;
  subject: string;
  body_markdown: string;
  thread_id?: string;
  task_id?: string;
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

  public initSchema(): void {
    this.connManager.withWriteTransaction((db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS messages (
          message_id TEXT PRIMARY KEY,
          from_principal_id TEXT NOT NULL,
          subject TEXT NOT NULL,
          body_markdown TEXT NOT NULL,
          thread_id TEXT,
          task_id TEXT,
          priority TEXT NOT NULL DEFAULT 'normal',
          created_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS message_recipients (
          recipient_row_id INTEGER PRIMARY KEY AUTOINCREMENT,
          message_id TEXT NOT NULL,
          to_principal_id TEXT NOT NULL,
          delivery_status TEXT NOT NULL DEFAULT 'stored_in_inbox',
          inbox_file_ref TEXT,
          acknowledged_at TEXT,
          created_at TEXT NOT NULL,
          FOREIGN KEY (message_id) REFERENCES messages(message_id) ON DELETE CASCADE
        );
      `);
    });
  }

  public sendMessage(params: SendMessageParams): MessageView {
    // Secret scanning
    const scan = SecretScanner.scan(params.bodyMarkdown);
    if (scan.hasSecret) {
      throw new Error("SECRET_LEAK_PREVENTED: Sensitive token or key detected in message body");
    }

    const messageId = `msg_${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`;
    const now = new Date().toISOString();

    const isWebAgent =
      params.toPrincipalId === "chatgpt-01" ||
      params.toPrincipalId === "argon-01" ||
      params.toPrincipalId === "argon-02";

    const deliveryStatus = isWebAgent ? "awaiting_operator_delivery" : "stored_in_inbox";
    const inboxFileRef = `MSG_${messageId}.md`;

    return this.connManager.withWriteTransaction((db) => {
      db.prepare(`
        INSERT INTO messages (
          message_id, from_principal_id, subject, body_markdown,
          thread_id, task_id, priority, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        messageId,
        params.fromPrincipalId,
        params.subject,
        params.bodyMarkdown,
        params.threadId || null,
        params.taskId || null,
        params.priority || "normal",
        now
      );

      db.prepare(`
        INSERT INTO message_recipients (
          message_id, to_principal_id, delivery_status, inbox_file_ref, created_at
        ) VALUES (?, ?, ?, ?, ?)
      `).run(messageId, params.toPrincipalId, deliveryStatus, inboxFileRef, now);

      return {
        message_id: messageId,
        from_principal_id: params.fromPrincipalId,
        to_principal_id: params.toPrincipalId,
        subject: params.subject,
        body_markdown: params.bodyMarkdown,
        thread_id: params.threadId,
        task_id: params.taskId,
        delivery_status: deliveryStatus,
        created_at: now
      };
    });
  }

  public listInbox(principalId: string): MessageView[] {
    const db = this.connManager.getDatabase();
    const rows = db.prepare(`
      SELECT
        m.message_id,
        m.from_principal_id,
        mr.to_principal_id,
        m.subject,
        m.body_markdown,
        m.thread_id,
        m.task_id,
        mr.delivery_status,
        m.created_at
      FROM message_recipients mr
      JOIN messages m ON mr.message_id = m.message_id
      WHERE mr.to_principal_id = ? OR ? = 'founder-01'
      ORDER BY m.created_at DESC
    `).all(principalId, principalId) as any[];

    return rows.map((r) => ({
      message_id: r.message_id,
      from_principal_id: r.from_principal_id,
      to_principal_id: r.to_principal_id,
      subject: r.subject,
      body_markdown: r.body_markdown,
      thread_id: r.thread_id || undefined,
      task_id: r.task_id || undefined,
      delivery_status: r.delivery_status,
      created_at: r.created_at
    }));
  }

  public ackMessage(params: { messageId: string; principalId: string }): MessageAckOutput {
    const now = new Date().toISOString();

    return this.connManager.withWriteTransaction((db) => {
      const recipient = db.prepare(`
        SELECT * FROM message_recipients
        WHERE message_id = ? AND to_principal_id = ?
      `).get(params.messageId, params.principalId) as any;

      if (!recipient) {
        throw new Error("ABAC_OWNERSHIP_OR_SOD_VIOLATION: Message recipient not found or not addressed to caller");
      }

      if (recipient.delivery_status === "acknowledged") {
        return {
          success: true,
          message_id: params.messageId,
          recipient_id: params.principalId,
          delivery_status: "acknowledged",
          acknowledged_at: recipient.acknowledged_at || now
        };
      }

      db.prepare(`
        UPDATE message_recipients
        SET delivery_status = 'acknowledged', acknowledged_at = ?
        WHERE message_id = ? AND to_principal_id = ?
      `).run(now, params.messageId, params.principalId);

      return {
        success: true,
        message_id: params.messageId,
        recipient_id: params.principalId,
        delivery_status: "acknowledged",
        acknowledged_at: now
      };
    });
  }
}
