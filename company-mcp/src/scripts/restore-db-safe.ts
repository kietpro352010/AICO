import * as fs from "node:fs";
import * as path from "node:path";
import * as crypto from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { RuntimeConfig } from "../config/runtime-config.js";

export function restoreDatabase(backupFilePath: string, targetDbPath?: string): { restored: boolean; quarantinedFile?: string; integrity: string } {
  const target = targetDbPath || RuntimeConfig.getDbPath();

  if (!fs.existsSync(backupFilePath)) {
    throw new Error(`Backup file does not exist: ${backupFilePath}`);
  }

  // Verify backup integrity before doing anything
  const backupDb = new DatabaseSync(backupFilePath);
  let integrity = "unknown";
  try {
    const row = backupDb.prepare("PRAGMA integrity_check;").get() as any;
    integrity = row ? Object.values(row)[0] as string : "failed";
  } finally {
    backupDb.close();
  }

  if (integrity !== "ok") {
    throw new Error(`Backup integrity check failed: ${integrity}`);
  }

  // Quarantine current database if it exists
  let quarantinedFile: string | undefined;
  if (fs.existsSync(target)) {
    const quarantineDir = path.resolve("D:/AI-COMPANY/backup/quarantine");
    if (!fs.existsSync(quarantineDir)) {
      fs.mkdirSync(quarantineDir, { recursive: true });
    }
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    quarantinedFile = path.join(quarantineDir, `aico_pre_restore_${timestamp}.db`);
    fs.copyFileSync(target, quarantinedFile);
  }

  // Copy backup to target
  fs.copyFileSync(backupFilePath, target);

  return {
    restored: true,
    quarantinedFile,
    integrity
  };
}

if (process.argv[1]?.endsWith("restore-db-safe.ts") || process.argv[1]?.endsWith("restore-db.js")) {
  const backupFile = process.argv[2];
  if (!backupFile) {
    console.error("Usage: node restore-db-safe.ts <path_to_backup.db>");
    process.exit(1);
  }
  console.log(`Restoring database from ${backupFile}...`);
  const res = restoreDatabase(backupFile);
  console.log(`Restore completed successfully. Quarantined original: ${res.quarantinedFile || "none"}`);
}
