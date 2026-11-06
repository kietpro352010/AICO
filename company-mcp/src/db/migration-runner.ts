import * as fs from "node:fs";
import * as crypto from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { ConnectionManager } from "./connection-manager.js";

export interface Migration {
  id: string;
  name: string;
  up: (db: DatabaseSync) => void;
  checksum?: string;
}

export class MigrationRunner {
  private connManager: ConnectionManager;

  constructor(connManager: ConnectionManager) {
    this.connManager = connManager;
  }

  public ensureSchemaMigrationsTable(): void {
    this.connManager.withWriteTransaction((db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS schema_migrations (
          version TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          checksum TEXT NOT NULL,
          applied_at TEXT NOT NULL
        );
      `);
    });
  }

  public getAppliedMigrations(): string[] {
    return this.connManager.withReadTransaction((db) => {
      const rows = db.prepare("SELECT version FROM schema_migrations ORDER BY version ASC").all() as any[];
      return rows.map((r) => r.version);
    });
  }

  public runMigrations(migrations: Migration[]): { applied: string[]; skipped: string[] } {
    this.ensureSchemaMigrationsTable();
    const appliedList: string[] = [];
    const skippedList: string[] = [];

    const existing = new Set(this.getAppliedMigrations());

    for (const m of migrations) {
      if (existing.has(m.id)) {
        skippedList.push(m.id);
        continue;
      }

      const checksum = m.checksum || crypto.createHash("sha256").update(m.up.toString()).digest("hex");

      this.connManager.withWriteTransaction((db) => {
        m.up(db);
        db.prepare(`
          INSERT INTO schema_migrations (version, name, checksum, applied_at)
          VALUES (?, ?, ?, ?)
        `).run(m.id, m.name, checksum, new Date().toISOString());
      });

      appliedList.push(m.id);
    }

    return { applied: appliedList, skipped: skippedList };
  }
}
