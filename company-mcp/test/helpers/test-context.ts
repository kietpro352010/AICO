import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import * as crypto from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const CANONICAL_V030_BACKUP_HASH = "2F73A9602DBBC50DA68B323FA00D2D7808855DF7A21FAA3DBEE64EC3EFD1477A";

export interface TestContext {
  tempDir: string;
  dbPath: string;
  anchorPath: string;
  cleanup: () => void;
}

export function createSandboxTestContext(prefix = "aico-test-"): TestContext {
  process.env.NODE_ENV = "test";
  process.env.AICO_AUDIT_HMAC_KEY = process.env.AICO_AUDIT_HMAC_KEY || "test_hmac_secret_key_v221_32bytes_long";
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  const dbPath = path.join(tempDir, "sandbox.db");
  const anchorPath = path.join(tempDir, "audit_anchors.jsonl");

  const candidates = [
    path.resolve(__dirname, "../fixtures/aico_v030_pre_v221.db"),
    path.resolve(__dirname, "../../../backup/aico_v030_pre_v221.db")
  ];

  let baseDb: string | null = null;
  for (const c of candidates) {
    if (fs.existsSync(c)) {
      baseDb = c;
      break;
    }
  }

  if (!baseDb) {
    throw new Error(`BASELINE_FIXTURE_MISSING: Canonical baseline backup 'aico_v030_pre_v221.db' not found in repo.`);
  }

  const baseBytes = fs.readFileSync(baseDb);
  const hash = crypto.createHash("sha256").update(baseBytes).digest("hex").toUpperCase();
  if (hash !== CANONICAL_V030_BACKUP_HASH) {
    throw new Error(`BASELINE_FIXTURE_CORRUPTED: Expected hash ${CANONICAL_V030_BACKUP_HASH}, got ${hash}`);
  }

  fs.copyFileSync(baseDb, dbPath);

  const cleanup = () => {
    try {
      if (fs.existsSync(tempDir)) {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    } catch {
      // Ignore temporary cleanup errors on Windows locks
    }
  };

  return { tempDir, dbPath, anchorPath, cleanup };
}
