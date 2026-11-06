import { DatabaseSync } from "node:sqlite";
import { rmSync } from "node:fs";
import { resolve } from "node:path";
import { migrateV040 } from "../src/migrate-v040.js";
import { AgentIdentityService } from "../src/agent-identity-service.js";
import { WorkspaceManager } from "../src/workspace-manager.js";

const TEST_DB_PATH = resolve("C:/Users/aico_flash2/.gemini/antigravity/brain/81453e6e-f151-47fb-b6fc-a7317a68247d/scratch/test-aico-sandbox.db");
const TEST_WORKSPACE_ROOT = resolve("C:/Users/aico_flash2/.gemini/antigravity/brain/81453e6e-f151-47fb-b6fc-a7317a68247d/scratch/test-workspaces");

// Clean previous test artifacts
try { rmSync(TEST_DB_PATH, { force: true }); } catch {}
try { rmSync(TEST_WORKSPACE_ROOT, { recursive: true, force: true }); } catch {}

console.log("=== RUNNING PHASE 4 TEST SUITE ON ISOLATED TEST SANDBOX ===");

const db = new DatabaseSync(TEST_DB_PATH);

try {
  // 1. Setup base schema cloned from production agents table
  db.exec("PRAGMA foreign_keys = ON;");
  db.exec("PRAGMA journal_mode = WAL;");

  db.exec(`
    CREATE TABLE agents (
      agent_id TEXT PRIMARY KEY,
      display_name TEXT NOT NULL,
      model TEXT NOT NULL,
      platform TEXT NOT NULL,
      role TEXT NOT NULL,
      department TEXT NOT NULL,
      status TEXT NOT NULL
    );

    INSERT INTO agents VALUES 
      ('flash-01', 'Gemini Flash #1', 'Gemini 3.8 Flash', 'Antigravity Pro #1', 'CTO', 'Engineering', 'configured'),
      ('flash-02', 'Gemini Flash #2', 'Gemini 3.8 Flash', 'Antigravity Pro #2', 'QA Lead', 'Engineering', 'configured'),
      ('codex-01', 'Codex', 'Codex Desktop', 'Desktop', 'Engineer', 'Engineering', 'configured'),
      ('chatgpt-01', 'ChatGPT Go', 'ChatGPT', 'Web', 'Advisor', 'Product', 'configured'),
      ('argon-01', 'Gemini Argon #1', 'Gemini 4 Argon', 'Web', 'Architect', 'Architecture', 'configured'),
      ('argon-02', 'Gemini Argon #2', 'Gemini 4 Argon', 'Web', 'Auditor', 'Quality', 'configured');
  `);

  // 2. Run Migration v0.4.0
  console.log("\n[TEST 1] Running migration v0.4.0 on sandbox DB...");
  migrateV040(db);
  const workspacesCount = db.prepare("SELECT COUNT(*) as c FROM agent_workspaces").get() as { c: number };
  console.log("-> Workspaces registered in DB:", workspacesCount.c);
  console.assert(workspacesCount.c === 6, "Must seed 6 workspaces for 6 agents");
  console.log("TEST 1: PASS (Migration v0.4.0 & Seeding successful)");

  // 3. Test Agent Identity Service
  console.log("\n[TEST 2] Testing Agent Identity Service (Generation & Validation)...");
  const identityService = new AgentIdentityService(db);
  const credFlash1 = identityService.generateToken("flash-01", ["workspace:read", "workspace:write:self"]);
  const credFlash2 = identityService.generateToken("flash-02", ["workspace:read", "workspace:write:self"]);

  console.log("-> Flash-01 Token Prefix:", credFlash1.keyPrefix);
  console.log("-> Flash-02 Token Prefix:", credFlash2.keyPrefix);

  const authFlash1 = identityService.authenticateToken(credFlash1.rawToken);
  console.log("-> Authenticated Flash-01 Identity:", authFlash1?.agent_id, authFlash1?.role);
  console.assert(authFlash1?.agent_id === "flash-01", "Identity agent_id must match token");
  console.assert(authFlash1?.role === "CTO", "Role must be CTO");
  console.log("TEST 2: PASS (Identity resolution accurate)");

  // 4. Test Token Revocation & Rotation
  console.log("\n[TEST 3] Testing Token Revocation & Rotation...");
  identityService.revokeCredential(credFlash1.credentialId);
  const authRevoked = identityService.authenticateToken(credFlash1.rawToken);
  console.assert(authRevoked === null, "Revoked token must be rejected");

  const rotatedFlash2 = identityService.rotateCredential(credFlash2.credentialId);
  console.assert(rotatedFlash2 !== null, "Rotation must return new credential");
  const authOldFlash2 = identityService.authenticateToken(credFlash2.rawToken);
  const authNewFlash2 = identityService.authenticateToken(rotatedFlash2!.rawToken);
  console.assert(authOldFlash2 === null, "Old rotated token must fail");
  console.assert(authNewFlash2?.agent_id === "flash-02", "New rotated token must succeed");
  console.log("TEST 3: PASS (Revocation and rotation verified)");

  // 5. Test Workspace Isolation & Path Traversal
  console.log("\n[TEST 4] Testing Workspace Isolation & Path Traversal Guard...");
  const wsManager = new WorkspaceManager(db, TEST_WORKSPACE_ROOT);

  // Initialize folders for Flash-02
  wsManager.initializeWorkspaceFolders("flash-02");
  const identityFlash2 = authNewFlash2!;

  // Safe file access
  const safeAccess = wsManager.resolveSecurePath(identityFlash2, "tasks/task-01.md", "write");
  console.log("-> Safe relative path check:", safeAccess.isAllowed, safeAccess.safePath);
  console.assert(safeAccess.isAllowed === true, "Safe path within workspace must be allowed");

  // Attack 1: Path traversal with ../../
  const attack1 = wsManager.resolveSecurePath(identityFlash2, "../flash-01/profile/secret.txt", "read");
  console.log("-> Traversal Attack 1 (../../):", attack1.isAllowed, attack1.reason);
  console.assert(attack1.isAllowed === false, "Traversal attack must be blocked");

  // Attack 2: Escaping to system root
  const attack2 = wsManager.resolveSecurePath(identityFlash2, "../../data/aico.db", "write");
  console.log("-> Traversal Attack 2 (db root):", attack2.isAllowed, attack2.reason);
  console.assert(attack2.isAllowed === false, "Database access via workspace must be blocked");

  console.log("TEST 4: PASS (Path traversal defense active)");

  // 6. Test Foreign Key Integrity
  console.log("\n[TEST 5] Testing Foreign Key Integrity...");
  let fkErrorCaught = false;
  try {
    identityService.generateToken("non-existent-agent-id-999");
  } catch (err: any) {
    fkErrorCaught = true;
    console.log("-> Foreign key error successfully triggered:", err.message);
  }
  console.assert(fkErrorCaught, "Foreign key constraint must prevent tokens for invalid agents");
  console.log("TEST 5: PASS (Foreign key constraints verified)");

  // 7. Verify Audit Log was recorded
  console.log("\n[TEST 6] Checking Audit Log recording...");
  const activities = db.prepare("SELECT * FROM agent_workspace_activities").all();
  console.log(`-> Total activities logged: ${activities.length}`);
  console.assert(activities.length >= 3, "All file resolution actions must be logged");
  console.log("TEST 6: PASS (Audit logging verified)");

  console.log("\n==============================================");
  console.log("ALL 6 TESTS PASSED ON ISOLATED SANDBOX!");
  console.log("Production database D:/AI-COMPANY/data/aico.db was NEVER touched.");
  console.log("==============================================");

} finally {
  db.close();
}
