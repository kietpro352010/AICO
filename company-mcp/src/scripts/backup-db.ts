import * as fs from "node:fs";
import * as path from "node:path";
import * as crypto from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { RuntimeConfig } from "../config/runtime-config.js";

export function performBackup(sourceDbPath?: string, backupDir?: string): { backupPath: string; checksumSha256: string; integrity: string } {
  const src = sourceDbPath || RuntimeConfig.getDbPath();
  const dir = backupDir || path.resolve("D:/AI-COMPANY/backup");

  if (!fs.existsSync(src)) {
    throw new Error(`Source database does not exist: ${src}`);
  }

  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupFileName = `aico_backup_${timestamp}.db`;
  const backupPath = path.join(dir, backupFileName);

  const db = new DatabaseSync(src);
  try {
    db.exec(`VACUUM INTO '${backupPath.replace(/\\/g, "/")}'`);
  } finally {
    db.close();
  }

  // Calculate SHA256 checksum
  const buffer = fs.readFileSync(backupPath);
  const checksum = crypto.createHash("sha256").update(buffer).digest("hex");
  fs.writeFileSync(`${backupPath}.sha256`, `${checksum}  ${backupFileName}\n`, "utf8");

  // Verify backup integrity
  const backupDb = new DatabaseSync(backupPath);
  let integrity = "unknown";
  try {
    const row = backupDb.prepare("PRAGMA integrity_check;").get() as any;
    integrity = row ? Object.values(row)[0] as string : "unknown";
  } finally {
    backupDb.close();
  }

  // Append to audit anchors
  const anchorPath = path.join(dir, "audit_anchors.jsonl");
  const anchorEntry = JSON.stringify({
    timestamp: new Date().toISOString(),
    source_db: src,
    backup_file: backupFileName,
    checksum_sha256: checksum,
    integrity_check: integrity
  }) + "\n";
  fs.appendFileSync(anchorPath, anchorEntry, "utf8");

  return { backupPath, checksumSha256: checksum, integrity };
}

if (process.argv[1]?.endsWith("backup-db.ts") || process.argv[1]?.endsWith("backup-db.js")) {
  console.log("Starting AICO Database Backup...");
  const result = performBackup();
  console.log(`Backup completed: ${result.backupPath}`);
  console.log(`SHA256: ${result.checksumSha256}`);
  console.log(`Integrity Check: ${result.integrity}`);
}
