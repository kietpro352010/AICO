import * as crypto from "node:crypto";
import { ConnectionManager } from "../db/connection-manager.js";
import { assertAuthenticatedContext, isFounderHuman, type PrincipalContext } from "../security/context-store.js";

export function normalizeSearchTextV1(text: string): string {
  if (!text) return "";
  return text
    .normalize("NFC")
    .replace(/Đ/g, "D")
    .replace(/đ/g, "d");
}

export interface KnowledgeDocument {
  doc_id: string;
  relative_path?: string;
  category: "company" | "architecture" | "adr" | "runbook" | "standard" | "project" | "skill" | string;
  title: string;
  summary: string;
  body_markdown: string;
  tags_json?: string;
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
          relative_path TEXT UNIQUE,
          category TEXT NOT NULL,
          title TEXT NOT NULL,
          summary TEXT NOT NULL,
          body_markdown TEXT NOT NULL,
          tags_json TEXT NOT NULL DEFAULT '[]',
          source_sha256 TEXT NOT NULL,
          version INTEGER NOT NULL DEFAULT 1,
          created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
          updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
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
          title TEXT NOT NULL DEFAULT '',
          content_markdown TEXT NOT NULL,
          summary TEXT NOT NULL DEFAULT '',
          tags_json TEXT NOT NULL DEFAULT '[]',
          provenance_source TEXT NOT NULL DEFAULT 'operator',
          status TEXT NOT NULL DEFAULT 'verified',
          sensitivity TEXT NOT NULL DEFAULT 'internal',
          approved_by_principal_id TEXT,
          expires_at TEXT,
          created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
          updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
        );
      `);
    });
  }

  public indexDocument(doc: KnowledgeDocument): void {
    const normTitle = normalizeSearchTextV1(doc.title);
    const normSummary = normalizeSearchTextV1(doc.summary);
    const normBody = normalizeSearchTextV1(doc.body_markdown);
    const normTags = normalizeSearchTextV1(doc.tags_json || "[]");
    const relativePath = doc.relative_path || `docs/${doc.category}/${doc.doc_id}.md`;
    const sourceSha256 = crypto.createHash("sha256").update(doc.body_markdown).digest("hex");
    const nowIso = new Date().toISOString();

    this.connManager.withWriteTransaction((db) => {
      db.prepare(`
        INSERT OR REPLACE INTO knowledge_documents (
          doc_id, relative_path, category, title, summary,
          body_markdown, tags_json, source_sha256, version, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
      `).run(
        doc.doc_id,
        relativePath,
        doc.category,
        normTitle,
        normSummary,
        normBody,
        normTags,
        sourceSha256,
        nowIso,
        nowIso
      );

      // Explicitly update knowledge_fts in case triggers are not installed in ad-hoc schema
      try {
        db.prepare("DELETE FROM knowledge_fts WHERE doc_id = ?").run(doc.doc_id);
        db.prepare(`
          INSERT INTO knowledge_fts (doc_id, title, category, summary, body_markdown, tags)
          VALUES (?, ?, ?, ?, ?, ?)
        `).run(doc.doc_id, normTitle, doc.category, normSummary, normBody, normTags);
      } catch {
        // Triggers might handle this
      }
    });
  }

  public getKnowledgeDoc(docId: string): KnowledgeDocument | null {
    return this.connManager.withReadTransaction((db) => {
      const row = db.prepare("SELECT * FROM knowledge_documents WHERE doc_id = ?").get(docId) as any;
      if (!row) return null;
      return {
        doc_id: row.doc_id,
        relative_path: row.relative_path,
        category: row.category,
        title: row.title,
        summary: row.summary,
        body_markdown: row.body_markdown,
        tags_json: row.tags_json
      };
    });
  }

  public proposeKnowledgeChange(params: {
    ctx?: PrincipalContext;
    docId: string;
    proposedMarkdown: string;
    rationale: string;
    proposerId?: string;
  }): { proposal_id: string; doc_id: string; status: string } {
    assertAuthenticatedContext(params.ctx, "proposeKnowledgeChange", { allowedPrincipalTypes: ["human", "agent"] });
    const proposalId = "prop_" + crypto.randomBytes(8).toString("hex");
    return {
      proposal_id: proposalId,
      doc_id: params.docId,
      status: "pending_review"
    };
  }

  public approveKnowledgeProposal(params: {
    ctx?: PrincipalContext;
    proposalId: string;
    decision: "approved" | "rejected";
    deciderId?: string;
  }): { proposal_id: string; decision: string; status: string } {
    assertAuthenticatedContext(params.ctx, "approveKnowledgeProposal", { allowedPrincipalTypes: ["human", "agent"] });
    const isAuthorized =
      isFounderHuman(params.ctx) ||
      (params.ctx.principalType === "agent" && params.ctx.agentId === "flash-01" && params.ctx.principalId === "flash-01");
    if (!isAuthorized) {
      throw new Error("PERMISSION_DENIED: Only Founder or CTO can approve knowledge proposals");
    }
    return {
      proposal_id: params.proposalId,
      decision: params.decision,
      status: params.decision === "approved" ? "applied" : "rejected"
    };
  }

  public searchKnowledge(query: string, limit = 10): any[] {
    const normQuery = normalizeSearchTextV1(query);

    return this.connManager.withReadTransaction((db) => {
      try {
        return db.prepare(`
          SELECT k.doc_id, k.title, k.category, k.summary, rank
          FROM knowledge_fts f
          JOIN knowledge_documents k ON k.doc_id = f.doc_id
          WHERE knowledge_fts MATCH ?
          ORDER BY rank
          LIMIT ?
        `).all(normQuery, limit);
      } catch {
        return db.prepare(`
          SELECT doc_id, title, category, summary, 0 as rank
          FROM knowledge_documents
          WHERE title LIKE ? OR summary LIKE ? OR body_markdown LIKE ?
          LIMIT ?
        `).all(`%${normQuery}%`, `%${normQuery}%`, `%${normQuery}%`, limit);
      }
    });
  }

  public searchMemory(params: {
    ctx?: PrincipalContext;
    callerAgentId?: string;
    query?: string;
    scope?: string;
    projectId?: string;
    taskId?: string;
    limit?: number;
  }): any[] {
    assertAuthenticatedContext(params.ctx, "searchMemory", { allowedPrincipalTypes: ["human", "agent"] });
    const effectiveAgentId = params.ctx.principalType === "agent" ? params.ctx.agentId : "__human_no_agent_private__";

    return this.connManager.withReadTransaction((db) => {
      let sql = `
        SELECT * FROM memory_entries
        WHERE (
          (memory_scope = 'company' AND status = 'verified') OR
          (memory_scope = 'agent_private' AND owner_agent_id = ?) OR
          (memory_scope = 'project' AND project_id = ?) OR
          (memory_scope = 'task_context' AND task_id = ?)
        )
      `;
      const sqlParams: any[] = [effectiveAgentId, params.projectId || null, params.taskId || null];

      if (params.scope) {
        sql += " AND memory_scope = ?";
        sqlParams.push(params.scope);
      }
      if (params.query) {
        sql += " AND (content_markdown LIKE ? OR title LIKE ? OR summary LIKE ?)";
        const pattern = `%${params.query}%`;
        sqlParams.push(pattern, pattern, pattern);
      }

      sql += " ORDER BY created_at DESC LIMIT ?";
      sqlParams.push(params.limit || 20);

      return db.prepare(sql).all(...sqlParams);
    });
  }

  public writeMemory(entry: {
    ctx?: PrincipalContext;
    memoryId?: string;
    scope: "company" | "project" | "agent_private" | "task_context" | string;
    callerAgentId?: string;
    ownerAgentId?: string;
    projectId?: string;
    taskId?: string;
    title?: string;
    summary?: string;
    content: string;
    provenanceSource?: string;
  }): { memory_id: string; scope: string; status: string } {
    assertAuthenticatedContext(entry.ctx, "writeMemory", { allowedPrincipalTypes: ["human", "agent"] });

    let ownerId: string | null;
    if (entry.scope === "agent_private") {
      if (isFounderHuman(entry.ctx)) {
        if (!entry.ownerAgentId) {
          throw new Error("VALIDATION_ERROR: ownerAgentId is required when human principal writes agent_private memory");
        }
        ownerId = entry.ownerAgentId;
      } else {
        if (!entry.ctx.agentId) {
          throw new Error("PERMISSION_DENIED: Agent identity required to write agent_private memory");
        }
        if (entry.ownerAgentId && entry.ownerAgentId !== entry.ctx.agentId) {
          throw new Error(
            `PERMISSION_DENIED: Principal '${entry.ctx.principalId}' cannot write agent_private memory for '${entry.ownerAgentId}'`
          );
        }
        ownerId = entry.ctx.agentId;
      }
    } else {
      ownerId = entry.ownerAgentId || entry.ctx.agentId || null;
    }

    const memoryId = entry.memoryId || "mem_" + crypto.randomBytes(12).toString("hex");
    const projectId = entry.scope === "project" ? (entry.projectId || "proj_aico_v221") : (entry.projectId || null);
    const taskId = entry.scope === "task_context" ? (entry.taskId || "task_default") : (entry.taskId || null);
    const title = entry.title || "Memory Entry " + memoryId.slice(0, 8);
    const summary = entry.summary || entry.content.slice(0, 100);
    const provenance = entry.provenanceSource || `${entry.ctx.principalType}:${entry.ctx.principalId}`;
    const nowIso = new Date().toISOString();

    return this.connManager.withWriteTransaction((db) => {
      db.prepare(`
        INSERT INTO memory_entries (
          memory_id, memory_scope, owner_agent_id, project_id, task_id,
          title, content_markdown, summary, tags_json, provenance_source,
          status, sensitivity, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, '[]', ?, 'verified', 'internal', ?, ?)
      `).run(
        memoryId,
        entry.scope,
        ownerId,
        projectId,
        taskId,
        title,
        entry.content,
        summary,
        provenance,
        nowIso,
        nowIso
      );

      return {
        memory_id: memoryId,
        scope: entry.scope,
        status: "verified"
      };
    });
  }
}
