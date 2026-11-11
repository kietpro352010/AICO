import * as fs from "node:fs";
import * as path from "node:path";
import * as crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { ConnectionManager } from "./connection-manager.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_PROD_DB_PATH = path.resolve(__dirname, "../../../data/aico.db");
const MAX_SYMLINK_DEPTH = 32;

export interface Migration {
  id: string;
  name: string;
  up: (db: DatabaseSync) => void;
  down?: (db: DatabaseSync) => void;
  checksum?: string;
}

export interface CanonicalPathFs {
  realpathSync: (p: string) => string;
  lstatSync: (p: string) => { isSymbolicLink: () => boolean };
  readlinkSync: (p: string) => string;
  statSync?: (p: string, opts: { bigint: true }) => { dev: bigint; ino: bigint };
}

export interface MigrationRunnerOptions {
  additionalProtectedPaths?: string[];
}

export interface PathGuardOptions {
  fsOps?: CanonicalPathFs;
  additionalProtectedPaths?: string[];
}

export const DEFAULT_CANONICAL_PATH_FS: CanonicalPathFs = {
  realpathSync: (p: string) =>
    typeof fs.realpathSync.native === "function" ? fs.realpathSync.native(p) : fs.realpathSync(p),
  lstatSync: (p: string) => fs.lstatSync(p),
  readlinkSync: (p: string) => fs.readlinkSync(p),
  statSync: (p: string, opts: { bigint: true }) => fs.statSync(p, opts)
};

function stripWindowsDevicePrefix(target: string): string {
  if (/^(?:\\\\\?|\\\?\?)\\UNC\\/i.test(target)) {
    return "\\\\" + target.slice(8);
  }
  if (target.startsWith("\\\\?\\") || target.startsWith("\\??\\")) {
    return target.slice(4);
  }
  return target;
}

function normalizeSegmentWin32Artifacts(segment: string, isDriveRoot: boolean): string {
  if (isDriveRoot || segment.length === 0) {
    return segment;
  }
  // Strip NTFS Alternate Data Stream suffixes (e.g., aico.db::$DATA, aico.db:evil, data::$INDEX_ALLOCATION)
  const colonIdx = segment.indexOf(":");
  const withoutAds = colonIdx > 0 ? segment.slice(0, colonIdx) : segment;
  // Win32 APIs strip trailing spaces and periods from path components
  return withoutAds.replace(/[. ]+$/, "");
}

function normalizePathForComparison(pathCandidate: string, forceLowerCase = false): string {
  const withoutDevicePrefix = stripWindowsDevicePrefix(pathCandidate);
  const slashNormalized = withoutDevicePrefix.replace(/\\/g, "/");
  const segments = slashNormalized.split("/");
  const cleaned = segments.map((seg, idx) => {
    const isDrive =
      /^[a-zA-Z]:$/.test(seg) &&
      (idx === 0 ||
        (idx === 3 && segments[0] === "" && segments[1] === "" && (segments[2] === "?" || segments[2] === ".")));
    return normalizeSegmentWin32Artifacts(seg, isDrive);
  });
  const rejoined = cleaned.join("/");
  return forceLowerCase || process.platform === "win32" ? rejoined.toLowerCase() : rejoined;
}

function stripWindowsAliasFromPath(fsPath: string): string {
  const parsed = path.parse(fsPath);
  const tail = fsPath.slice(parsed.root.length);
  const rawSegments = tail.split(/[\\/]+/).filter(Boolean);
  if (rawSegments.length === 0) {
    return fsPath;
  }
  const cleanedSegments = rawSegments.map((seg) => normalizeSegmentWin32Artifacts(seg, false));
  return path.join(parsed.root, ...cleanedSegments);
}

export function normalizeSqlDatabasePath(rawInput: string): { isMemory: boolean; fsPath: string } {
  if (!rawInput || typeof rawInput !== "string" || rawInput.trim().length === 0) {
    throw new Error("INVALID_DB_PATH: Database path must be a non-empty string.");
  }
  if (rawInput.includes("\0")) {
    throw new Error("PRODUCTION_DB_MIGRATION_PROHIBITED: Null byte detected in database path.");
  }

  const trimmed = rawInput.trim();
  const lower = trimmed.toLowerCase();

  if (lower === ":memory:") {
    return { isMemory: true, fsPath: trimmed };
  }

  // Handle SQLite file: URIs (e.g., file:./data/aico.db?mode=rwc or file:///D:/AI-COMPANY/data/aico.db)
  if (lower.startsWith("file:")) {
    const afterScheme = trimmed.slice(5);
    const delimiterIndices = [afterScheme.indexOf("?"), afterScheme.indexOf("#")].filter((i) => i !== -1);
    const firstDelimiter = delimiterIndices.length > 0 ? Math.min(...delimiterIndices) : -1;
    let uriBody = firstDelimiter !== -1 ? afterScheme.slice(0, firstDelimiter) : afterScheme;

    try {
      uriBody = decodeURIComponent(uriBody);
    } catch {
      throw new Error("INVALID_DB_PATH: Malformed percent-encoding in SQLite file URI.");
    }

    if (uriBody.includes("\0")) {
      throw new Error("PRODUCTION_DB_MIGRATION_PROHIBITED: Null byte detected in database path.");
    }

    // Only pure file::memory: (optionally with ?query/#fragment) is treated as an in-memory DB.
    // Lookalikes such as file::memory:/../../data/aico.db fall through to filesystem path resolution.
    if (uriBody.toLowerCase() === ":memory:") {
      return { isMemory: true, fsPath: trimmed };
    }

    if (/^\/\/localhost\//i.test(uriBody)) {
      uriBody = uriBody.slice("//localhost".length);
    } else if (uriBody.startsWith("///")) {
      uriBody = uriBody.slice(2);
    } else if (/^\/\/[^/]/.test(uriBody)) {
      uriBody = "\\\\" + uriBody.slice(2).replace(/\//g, "\\");
    }

    if (/^\/[a-zA-Z]:/.test(uriBody)) {
      uriBody = uriBody.slice(1);
    }
    if (uriBody.trim().length === 0) {
      throw new Error("INVALID_DB_PATH: SQLite file URI resolved to an empty path.");
    }
    return { isMemory: false, fsPath: path.resolve(uriBody) };
  }

  return { isMemory: false, fsPath: path.resolve(trimmed) };
}

/**
 * Resolves the canonical filesystem path for targetPath, resolving symlinks/junctions
 * across existing targets, missing tail files/subdirectories, and dangling symlinks.
 */
export function resolveCanonicalFilesystemPath(
  targetPath: string,
  fsOps: CanonicalPathFs = DEFAULT_CANONICAL_PATH_FS,
  depth = 0
): string {
  if (depth > MAX_SYMLINK_DEPTH) {
    throw new Error(
      "CANONICAL_PATH_RESOLUTION_FAILED: Maximum symlink recursion depth exceeded while verifying database path."
    );
  }

  const resolved = path.resolve(targetPath);

  try {
    return fsOps.realpathSync(resolved);
  } catch (err: any) {
    if (err?.code !== "ENOENT" && err?.code !== "ENOTDIR") {
      throw new Error(
        `CANONICAL_PATH_RESOLUTION_FAILED: Unable to resolve canonical database path (${err?.code || "UNKNOWN"}): ${err?.message || err}`
      );
    }
  }

  const remainderSegments: string[] = [];
  let cursor = resolved;

  while (true) {
    let lstat: { isSymbolicLink: () => boolean } | null = null;
    try {
      lstat = fsOps.lstatSync(cursor);
    } catch (lstatErr: any) {
      if (lstatErr?.code !== "ENOENT" && lstatErr?.code !== "ENOTDIR") {
        throw new Error(
          `CANONICAL_PATH_RESOLUTION_FAILED: lstat failed while resolving path (${lstatErr?.code || "UNKNOWN"}): ${lstatErr?.message || lstatErr}`
        );
      }
    }

    if (lstat) {
      if (lstat.isSymbolicLink()) {
        let linkTarget: string;
        try {
          linkTarget = stripWindowsDevicePrefix(fsOps.readlinkSync(cursor));
        } catch (rlErr: any) {
          throw new Error(
            `CANONICAL_PATH_RESOLUTION_FAILED: readlink failed while resolving path (${rlErr?.code || "UNKNOWN"}): ${rlErr?.message || rlErr}`
          );
        }
        const parentDir = path.dirname(cursor);
        const canonicalParent =
          parentDir !== cursor
            ? resolveCanonicalFilesystemPath(parentDir, fsOps, depth + 1)
            : parentDir;
        const nextBase = path.isAbsolute(linkTarget)
          ? path.resolve(linkTarget)
          : path.resolve(canonicalParent, linkTarget);
        const recombined =
          remainderSegments.length > 0
            ? path.resolve(nextBase, ...[...remainderSegments].reverse())
            : nextBase;
        return resolveCanonicalFilesystemPath(recombined, fsOps, depth + 1);
      }

      try {
        const realBase = fsOps.realpathSync(cursor);
        return remainderSegments.length > 0
          ? path.resolve(realBase, ...[...remainderSegments].reverse())
          : realBase;
      } catch (rpErr: any) {
        throw new Error(
          `CANONICAL_PATH_RESOLUTION_FAILED: realpath failed on existing ancestor (${rpErr?.code || "UNKNOWN"}): ${rpErr?.message || rpErr}`
        );
      }
    }

    const parent = path.dirname(cursor);
    if (parent === cursor) {
      return resolved;
    }

    remainderSegments.push(path.basename(cursor));
    cursor = parent;
  }
}

export function isProhibitedProductionDbPath(pathCandidate: string): boolean {
  // Case-insensitive match is intentionally strict across all platforms to block Case/Win32 aliasing
  const normalized = normalizePathForComparison(pathCandidate, true);
  return (
    normalized === "data/aico.db" ||
    /(?:^|\/)data\/aico\.db(?:$|\/|-(?:wal|shm|journal)$)/.test(normalized)
  );
}

interface ProtectedTargetInfo {
  canonicalKey: string;
  stat: { dev: bigint; ino: bigint } | null;
}

function safeStatOptional(
  targetPath: string,
  fsOps: CanonicalPathFs
): { dev: bigint; ino: bigint } | null {
  if (!fsOps.statSync) {
    return null;
  }
  try {
    return fsOps.statSync(targetPath, { bigint: true });
  } catch (err: any) {
    if (err?.code === "ENOENT" || err?.code === "ENOTDIR") {
      return null;
    }
    throw new Error(
      `CANONICAL_PATH_RESOLUTION_FAILED: stat failed while verifying database path (${err?.code || "UNKNOWN"}): ${err?.message || err}`
    );
  }
}

function assertSingleFilesystemCandidateSafe(
  candidateFsPath: string,
  fsOps: CanonicalPathFs,
  protectedTargets: ProtectedTargetInfo[]
): void {
  if (isProhibitedProductionDbPath(candidateFsPath)) {
    throw new Error(
      "PRODUCTION_DB_MIGRATION_PROHIBITED: Migration execution against production database data/aico.db is strictly forbidden. Gate V3-G3 remains LOCKED."
    );
  }

  const pathsToResolve = [candidateFsPath];
  const strippedAliasPath = stripWindowsAliasFromPath(candidateFsPath);
  if (strippedAliasPath !== candidateFsPath) {
    pathsToResolve.push(strippedAliasPath);
  }

  for (const rawCandidate of pathsToResolve) {
    const canonicalPath = resolveCanonicalFilesystemPath(rawCandidate, fsOps);
    if (isProhibitedProductionDbPath(canonicalPath)) {
      throw new Error(
        "PRODUCTION_DB_MIGRATION_PROHIBITED: Migration execution against canonical production database path data/aico.db (via symlink/junction) is strictly forbidden. Gate V3-G3 remains LOCKED."
      );
    }

    const canonicalKey = normalizePathForComparison(canonicalPath);
    const targetStat = safeStatOptional(canonicalPath, fsOps);

    for (const protectedTarget of protectedTargets) {
      if (canonicalKey === protectedTarget.canonicalKey) {
        throw new Error(
          "PRODUCTION_DB_MIGRATION_PROHIBITED: Target database resolves to a protected production database path. Gate V3-G3 remains LOCKED."
        );
      }
      if (
        targetStat &&
        protectedTarget.stat &&
        targetStat.dev === protectedTarget.stat.dev &&
        targetStat.ino === protectedTarget.stat.ino
      ) {
        throw new Error(
          "PRODUCTION_DB_MIGRATION_PROHIBITED: Target database shares filesystem inode (hard link) with protected production database. Gate V3-G3 remains LOCKED."
        );
      }
    }
  }
}

export function assertSafeNonProductionDbPath(rawPath: string, options?: PathGuardOptions): void {
  const normalizedInput = normalizeSqlDatabasePath(rawPath);
  if (normalizedInput.isMemory) {
    return;
  }

  const fsOps = options?.fsOps ?? DEFAULT_CANONICAL_PATH_FS;
  const baseProtectedPaths = [
    REPO_PROD_DB_PATH,
    ...(options?.additionalProtectedPaths ?? [])
  ];
  const protectedPathList: string[] = [];
  for (const basePath of baseProtectedPaths) {
    protectedPathList.push(basePath);
    if (!/-(?:wal|shm|journal)$/i.test(basePath)) {
      protectedPathList.push(`${basePath}-wal`, `${basePath}-shm`, `${basePath}-journal`);
    }
  }

  // Collect canonical path + inode metadata for protected targets fail-closed
  const protectedTargets: ProtectedTargetInfo[] = [];
  for (const prodCandidate of protectedPathList) {
    if (isProhibitedProductionDbPath(normalizedInput.fsPath)) {
      break;
    }
    const prodCanonical = resolveCanonicalFilesystemPath(prodCandidate, fsOps);
    const prodKey = normalizePathForComparison(prodCanonical);
    const prodStat = safeStatOptional(prodCanonical, fsOps);
    protectedTargets.push({ canonicalKey: prodKey, stat: prodStat });
  }

  assertSingleFilesystemCandidateSafe(normalizedInput.fsPath, fsOps, protectedTargets);

  // Guard SQLite companion files (-wal, -shm, -journal) against symlink/hardlink aliasing
  const comparableMain = normalizePathForComparison(normalizedInput.fsPath, true);
  if (!/-(?:wal|shm|journal)$/.test(comparableMain)) {
    const baseWithoutAds = stripWindowsAliasFromPath(normalizedInput.fsPath);
    for (const suffix of ["-wal", "-shm", "-journal"]) {
      assertSingleFilesystemCandidateSafe(`${baseWithoutAds}${suffix}`, fsOps, protectedTargets);
    }
  }
}

export class MigrationRunner {
  private connManager: ConnectionManager;
  private additionalProtectedPaths: string[];

  constructor(connManager: ConnectionManager, options?: MigrationRunnerOptions) {
    this.connManager = connManager;
    this.additionalProtectedPaths = options?.additionalProtectedPaths ?? [];
  }

  /**
   * Hardened Production Database Path Guard
   * Resolves canonical filesystem path (including symlinks/junctions and non-existent
   * leaf targets) plus inode matching against hard links.
   * Throws unconditionally if the target resolves to a production database path.
   */
  public assertNonProductionDatabase(): void {
    assertSafeNonProductionDbPath(this.connManager.getDbPath(), {
      additionalProtectedPaths: this.additionalProtectedPaths
    });
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
