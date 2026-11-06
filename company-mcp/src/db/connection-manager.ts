import { DatabaseSync } from "node:sqlite";

export interface DatabaseConnection {
  db: DatabaseSync;
  close: () => void;
}

export class ConnectionManager {
  private dbPath: string;

  constructor(dbPath: string) {
    this.dbPath = dbPath;
  }

  public getConnection(): DatabaseConnection {
    const db = new DatabaseSync(this.dbPath);
    db.exec("PRAGMA busy_timeout = 5000;");
    db.exec("PRAGMA foreign_keys = ON;");

    return {
      db,
      close: () => {
        try {
          db.close();
        } catch {
          // Closed handle ignore
        }
      }
    };
  }

  public withReadTransaction<T>(operation: (db: DatabaseSync) => T): T {
    const { db, close } = this.getConnection();
    try {
      return operation(db);
    } finally {
      close();
    }
  }

  public withWriteTransaction<T>(operation: (db: DatabaseSync) => T, retries = 3): T {
    let attempt = 0;
    while (attempt < retries) {
      attempt++;
      const { db, close } = this.getConnection();
      try {
        db.exec("BEGIN IMMEDIATE;");
        const result = operation(db);
        db.exec("COMMIT;");
        return result;
      } catch (err: any) {
        try {
          db.exec("ROLLBACK;");
        } catch {
          // Rollback ignore
        }
        if (err.message && err.message.includes("busy") && attempt < retries) {
          const jitterMs = Math.floor(Math.random() * 50) + 10;
          const end = Date.now() + jitterMs;
          while (Date.now() < end) {}
          continue;
        }
        throw err;
      } finally {
        close();
      }
    }
    throw new Error("Transaction failed after maximum retries");
  }
}
