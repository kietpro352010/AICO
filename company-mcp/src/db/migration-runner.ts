import * as path from "node:path";
import * as crypto from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { ConnectionManager } from "./connection-manager.js";

export interface Migration {
  id: string;
  name: string;
  up: (db: DatabaseSync) => void;
  down?: (db: DatabaseSync) => void;
  checksum?: string;
}

export class MigrationRunner {
  private connManager: ConnectionManager;

  constructor(connManager: ConnectionManager) {
    this.connManager = connManager;
  }

  /**
   * Hardened Production Database Path Guard
   * Throws unconditionally if the target database resolves to the production database path.
   * A configuration flag or parameter alone CANNOT bypass this protection.
   */
  public assertNonProductionDatabase(): void {
    const rawPath = this.connManager.getDbPath();
    const resolved = path.resolve(rawPath);
    const normalized = resolved.replace(/\\/g, "/").toLowerCase();

    if (
      normalized.endsWith("/data/aico.db") ||
      normalized.includes("/data/aico.db") ||
      normalized.endsWith("data/aico.db")
    ) {
      throw new Error(
        "PRODUCTION_DB_MIGRATION_PROHIBITED: Migration execution against production database data/aico.db is strictly forbidden. Gate V3-G3 remains LOCKED."
      );
    }
  }

  public ensureSchemaMigrationsTable(): void {
    this.assertNonProductionDatabase();
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
    this.assertNonProductionDatabase();
    return this.connManager.withReadTransaction((db) => {
      // Check if schema_migrations table exists
      const tableCheck = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='schema_migrations'").get() as any;
      if (!tableCheck) {
        return new Map<string, { name: string; checksum: string }>();
      }
      const rows = db.prepare("SELECT version, name, checksum FROM schema_migrations ORDER BY version ASC").all() as any[];
      const map = new Map<string, { name: string; checksum: string }>();
      for (const r of rows) {
        map.set(r.version, { name: r.name, checksum: r.checksum });
      }
      return map;
    });
  }

  public runMigrations(migrations: Migration[]): { applied: string[]; skipped: string[] } {
    this.assertNonProductionDatabase();
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

  public rollbackMigration(migration: Migration): { rolledBack: string } {
    this.assertNonProductionDatabase();
    if (!migration.down) {
      throw new Error(`ROLLBACK_NOT_SUPPORTED: Migration '${migration.id}' does not define a down migration.`);
    }

    const existingMap = this.getAppliedMigrations();
    if (!existingMap.has(migration.id)) {
      throw new Error(`MIGRATION_NOT_APPLIED: Migration '${migration.id}' is not currently applied, cannot rollback.`);
    }

    this.connManager.withWriteTransaction((db) => {
      migration.down!(db);
      db.prepare("DELETE FROM schema_migrations WHERE version = ?").run(migration.id);
    });

    return { rolledBack: migration.id };
  }
}
