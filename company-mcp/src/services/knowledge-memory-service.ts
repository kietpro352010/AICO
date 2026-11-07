import { DatabaseSync } from "node:sqlite";
import { ConnectionManager } from "../db/connection-manager.js";

export function normalizeSearchTextV1(text: string): string {
  if (!text) return "";
  return text
    .normalize("NFC")
    .replace(/Đ/g, "D")
    .replace(/đ/g, "d");
}

export interface KnowledgeDocument {
  doc_id: string;
  title: string;
  category: string;
  summary: string;
  body_markdown: string;
  tags_json: string;
}

export class KnowledgeMemoryService {
  private connManager: ConnectionManager;

  constructor(connManager: ConnectionManager) {
    this.connManager = connManager;
  }

  public initSchema(): void {
    this.connManager.withWriteTransaction((db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS knowledge_documents (
          doc_id TEXT PRIMARY KEY,
          title TEXT NOT NULL,
          category TEXT NOT NULL,
          summary TEXT NOT NULL,
          body_markdown TEXT NOT NULL,
          tags_json TEXT NOT NULL DEFAULT '[]',
          version INTEGER NOT NULL DEFAULT 1,
          updated_at TEXT NOT NULL
        );

        CREATE VIRTUAL TABLE IF NOT EXISTS knowledge_fts USING fts5(
          doc_id UNINDEXED,
          title,
          category,
          summary,
          body_markdown,
          tags,
          tokenize = "unicode61 remove_diacritics 2 tokenchars '-_'"
        );

        CREATE TABLE IF NOT EXISTS memory_entries (
          memory_id TEXT PRIMARY KEY,
          memory_scope TEXT NOT NULL,
          owner_agent_id TEXT,
          project_id TEXT,
          task_id TEXT,
          status TEXT NOT NULL DEFAULT 'verified',
          content_markdown TEXT NOT NULL,
          created_at TEXT NOT NULL
        );
      `);
    });
  }

  public indexDocument(doc: KnowledgeDocument): void {
    const normTitle = normalizeSearchTextV1(doc.title);
    const normSummary = normalizeSearchTextV1(doc.summary);
    const normBody = normalizeSearchTextV1(doc.body_markdown);
    const normTags = normalizeSearchTextV1(doc.tags_json);

    this.connManager.withWriteTransaction((db) => {
      db.prepare(`
        INSERT OR REPLACE INTO knowledge_documents (
          doc_id, title, category, summary, body_markdown, tags_json, version, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, 1, ?)
      `).run(doc.doc_id, doc.title, doc.category, doc.summary, doc.body_markdown, doc.tags_json, new Date().toISOString());

      // Update FTS
      db.prepare("DELETE FROM knowledge_fts WHERE doc_id = ?").run(doc.doc_id);
      db.prepare(`
        INSERT INTO knowledge_fts (doc_id, title, category, summary, body_markdown, tags)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(doc.doc_id, normTitle, doc.category, normSummary, normBody, normTags);
    });
  }

  public searchKnowledge(query: string, limit = 10): any[] {
    const normQuery = normalizeSearchTextV1(query);

    return this.connManager.withReadTransaction((db) => {
      return db.prepare(`
        SELECT k.doc_id, k.title, k.category, k.summary, rank
        FROM knowledge_fts f
        JOIN knowledge_documents k ON k.doc_id = f.doc_id
        WHERE knowledge_fts MATCH ?
        ORDER BY rank
        LIMIT ?
      `).all(normQuery, limit);
    });
  }

  public searchMemory(params: {
    callerAgentId: string;
    scope?: string;
    projectId?: string;
    taskId?: string;
  }): any[] {
    return this.connManager.withReadTransaction((db) => {
      return db.prepare(`
        SELECT * FROM memory_entries
        WHERE (
          (memory_scope = 'company' AND status = 'verified') OR
          (memory_scope = 'agent_private' AND owner_agent_id = ?) OR
          (memory_scope = 'project' AND project_id = ?) OR
          (memory_scope = 'task_context' AND task_id = ?)
        )
      `).all(params.callerAgentId, params.projectId || null, params.taskId || null);
    });
  }

  public writeMemory(entry: {
    memoryId: string;
    scope: "company" | "agent_private" | "project" | "task_context";
    ownerAgentId?: string;
    projectId?: string;
    taskId?: string;
    content: string;
  }): void {
    const status = entry.scope === "company" ? "proposed" : "verified";

    this.connManager.withWriteTransaction((db) => {
      db.prepare(`
        INSERT INTO memory_entries (
          memory_id, memory_scope, owner_agent_id, project_id, task_id, status, content_markdown, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        entry.memoryId,
        entry.scope,
        entry.ownerAgentId || null,
        entry.projectId || null,
        entry.taskId || null,
        status,
        entry.content,
        new Date().toISOString()
      );
    });
  }
}
