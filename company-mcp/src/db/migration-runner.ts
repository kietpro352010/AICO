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

  public getAppliedMigrationVersions(): string[] {
    return Array.from(this.getAppliedMigrations().keys());
  }

  public getAppliedMigrations(): Map<string, { name: string; checksum: string }> {
    return this.connManager.withReadTransaction((db) => {
      const rows = db.prepare("SELECT version, name, checksum FROM schema_migrations ORDER BY version ASC").all() as any[];
      const map = new Map<string, { name: string; checksum: string }>();
      for (const r of rows) {
        map.set(r.version, { name: r.name, checksum: r.checksum });
      }
      return map;
    });
  }

  public runMigrations(migrations: Migration[]): { applied: string[]; skipped: string[] } {
    this.ensureSchemaMigrationsTable();
    const appliedList: string[] = [];
    const skippedList: string[] = [];

    const existingMap = this.getAppliedMigrations();

    for (const m of migrations) {
      const checksum = m.checksum || crypto.createHash("sha256").update(m.up.toString()).digest("hex");

      if (existingMap.has(m.id)) {
        const stored = existingMap.get(m.id)!;
        if (stored.checksum !== checksum) {
          throw new Error(
            `MIGRATION_DRIFT_DETECTED: Migration '${m.id}' has been modified after execution! Stored checksum: ${stored.checksum}, Current checksum: ${checksum}`
          );
        }
        skippedList.push(m.id);
        continue;
      }

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
