import * as fs from "node:fs";
import * as path from "node:path";
import * as crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { Migration } from "../migration-runner.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function computeFoundationChecksum(): string {
  const localSql = path.join(__dirname, "v0.5.0-v3-foundation.sql");
  let sqlBytes = Buffer.alloc(0);
  if (fs.existsSync(localSql)) {
    sqlBytes = fs.readFileSync(localSql);
  }
  return crypto.createHash("sha256")
    .update("20261110_003_v050_v3_foundation")
    .update(sqlBytes)
    .digest("hex");
}

export const migrationV050V3Foundation: Migration = {
  id: "20261110_003_v050_v3_foundation",
  name: "v0.5.0 V3 Foundation — 24 Domain Tables, Constraints, and FTS5",
  checksum: computeFoundationChecksum(),
  up: (db: DatabaseSync) => {
    const localSql = path.join(__dirname, "v0.5.0-v3-foundation.sql");
    if (!fs.existsSync(localSql)) {
      throw new Error("Canonical migration file v0.5.0-v3-foundation.sql not found");
    }
    const sqlContent = fs.readFileSync(localSql, "utf8");
    db.exec(sqlContent);
  },
  down: (db: DatabaseSync) => {
    const downSql = path.join(__dirname, "v0.5.0-down.sql");
    if (!fs.existsSync(downSql)) {
      throw new Error("Rollback migration file v0.5.0-down.sql not found");
    }
    const sqlContent = fs.readFileSync(downSql, "utf8");
    db.exec(sqlContent);
  }
};
