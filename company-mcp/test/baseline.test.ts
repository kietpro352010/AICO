import { test, describe, before, after } from "node:test";
import assert from "node:assert";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, rmSync, readFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";

import { AgentIdentityService } from "../src/agent-identity-service.js";
import { WorkspaceManager } from "../src/workspace-manager.js";
import { migrateV040 } from "../src/migrate-v040.js";
import { migrateV041 } from "../src/migrate-v041-manifest-sync.js";
import { createBaseMcpServer, SERVER_NAME, REGISTRY_VERSION } from "../src/registry-core.js";

describe("AICO Quality Baseline Test Suite", () => {
  let tempDir: string;
  let testDbPath: string;
  let testWorkspaceRoot: string;
  let db: DatabaseSync;

  before(() => {
    tempDir = mkdtempSync(join(tmpdir(), "aico-test-"));
    testDbPath = join(tempDir, "test-aico.db");
    testWorkspaceRoot = join(tempDir, "workspaces");

    db = new DatabaseSync(testDbPath);
    db.exec("PRAGMA foreign_keys = ON;");
    db.exec("PRAGMA journal_mode = WAL;");

    // Base schema matching production agents table
    db.exec(`
      CREATE TABLE agents (
        agent_id TEXT PRIMARY KEY,
        display_name TEXT NOT NULL,
        model TEXT NOT NULL,
        platform TEXT NOT NULL,
        role TEXT NOT NULL,
        department TEXT NOT NULL,
        status TEXT NOT NULL,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP
      );

      INSERT INTO agents (agent_id, display_name, model, platform, role, department, status) VALUES 
        ('chatgpt-01', 'ChatGPT', 'ChatGPT Go Web', 'ChatGPT Web', 'CEO / Main Orchestrator', 'Executive & Strategy', 'configured'),
        ('flash-01', 'Gemini Flash #1', 'Gemini 3.8 Flash', 'Antigravity Pro #1', 'CTO', 'Engineering', 'configured'),
        ('flash-02', 'Gemini Flash #2', 'Gemini 3.8 Flash', 'Antigravity Pro #2', 'QA Lead', 'Engineering', 'configured'),
        ('codex-01', 'Codex', 'Codex model', 'Codex Desktop', 'Engineer', 'Engineering', 'configured'),
        ('argon-01', 'Gemini Argon #1', 'Gemini 4 Argon', 'Web', 'Architect', 'Architecture', 'configured'),
        ('argon-02', 'Gemini Argon #2', 'Gemini 4 Argon', 'Web', 'Auditor', 'Quality', 'configured');
    `);

    // Run migration v0.4.0
    migrateV040(db);
  });

  after(() => {
    try {
      db.close();
    } catch {}
    try {
      rmSync(tempDir, { recursive: true, force: true });
    } catch {}
  });

  test("1. Canonical Manifest Integrity", () => {
    const manifestPath = resolve("../company-manifest.json");
    assert.ok(existsSync(manifestPath), "company-manifest.json must exist at repository root");

    const manifest = JSON.parse(readFileSync(manifestPath, "utf-8"));
    assert.strictEqual(manifest.manifest_version, "1.0.0");
    assert.strictEqual(manifest.company.id, "AICO");
    assert.strictEqual(manifest.agents.length, 6, "Exactly 6 agents must be registered");
    assert.strictEqual(manifest.quota_pools.length, 5, "Exactly 5 quota pools must be configured");

    const chatgpt = manifest.agents.find((a: any) => a.agent_id === "chatgpt-01");
    assert.ok(chatgpt, "chatgpt-01 must exist in manifest");
    assert.strictEqual(chatgpt.canonical_role, "CEO / Main Orchestrator");

    const flash01 = manifest.agents.find((a: any) => a.agent_id === "flash-01");
    assert.ok(flash01, "flash-01 must exist in manifest");
    assert.strictEqual(flash01.canonical_role, "Chief Technology Officer");

    const argon01 = manifest.agents.find((a: any) => a.agent_id === "argon-01");
    assert.ok(argon01, "argon-01 must exist in manifest");
    assert.strictEqual(argon01.invocation_policy.auto_invoke, false);
    assert.strictEqual(argon01.invocation_policy.requires_approval, true);
    assert.strictEqual(argon01.invocation_policy.quota_class, "scarce");
  });

  test("2. AgentIdentityService Token Lifecycle & Timing-Safe Auth", () => {
    const identitySvc = new AgentIdentityService(db);

    // Generate token
    const tokenData = identitySvc.generateToken("flash-02", ["workspace:read", "workspace:write:self"]);
    assert.ok(tokenData.rawToken.startsWith("aico_flash-02_"));
    assert.strictEqual(tokenData.keyPrefix, tokenData.rawToken.slice(0, 16));

    // Verify stored in DB as SHA-256 hash (never plaintext)
    const stored = db.prepare("SELECT * FROM agent_credentials WHERE credential_id = ?").get(tokenData.credentialId) as any;
    assert.notStrictEqual(stored.secret_hash, tokenData.rawToken);
    assert.strictEqual(stored.secret_hash, identitySvc.hashToken(tokenData.rawToken));

    // Authenticate token
    const authenticated = identitySvc.authenticateToken(tokenData.rawToken);
    assert.ok(authenticated, "Valid token must authenticate");
    assert.strictEqual(authenticated.agent_id, "flash-02");
    assert.strictEqual(authenticated.display_name, "Gemini Flash #2");

    // Rejection of invalid tokens
    assert.strictEqual(identitySvc.authenticateToken("aico_flash-02_invalidtoken1234567890"), null);
    assert.strictEqual(identitySvc.authenticateToken("malformed_token"), null);

    // Rotation
    const rotated = identitySvc.rotateCredential(tokenData.credentialId);
    assert.ok(rotated, "Token rotation should succeed");
    assert.strictEqual(identitySvc.authenticateToken(tokenData.rawToken), null, "Old token must be revoked");
    assert.ok(identitySvc.authenticateToken(rotated.rawToken), "New token must authenticate");
  });

  test("3. WorkspaceManager Path Traversal Defense", () => {
    const identitySvc = new AgentIdentityService(db);
    const tokenData = identitySvc.generateToken("flash-02");
    const caller = identitySvc.authenticateToken(tokenData.rawToken);
    assert.ok(caller, "Caller must authenticate");

    const wsManager = new WorkspaceManager(db, testWorkspaceRoot);
    wsManager.initializeWorkspaceFolders("flash-02");

    // Normal path within workspace
    const safeAccess = wsManager.resolveSecurePath(caller, "src/index.ts", "read");
    assert.strictEqual(safeAccess.isAllowed, true);
    assert.ok(safeAccess.safePath.includes("flash-02"));

    // Attack 1: Path traversal with ..
    const attack1 = wsManager.resolveSecurePath(caller, "../flash-01/secret.txt", "read");
    assert.strictEqual(attack1.isAllowed, false);
    assert.match(attack1.reason!, /Path traversal/);

    // Attack 2: Escaping to database root with ../../
    const attack2 = wsManager.resolveSecurePath(caller, "../../data/aico.db", "write");
    assert.strictEqual(attack2.isAllowed, false);
    assert.match(attack2.reason!, /Path traversal/);

    // Attack 3: Absolute Windows path
    const attack3 = wsManager.resolveSecurePath(caller, "C:\\Windows\\System32", "read");
    assert.strictEqual(attack3.isAllowed, false);
    assert.match(attack3.reason!, /Absolute or drive-qualified/);
  });

  test("4. Registry Core Tools Verification", () => {
    const server = createBaseMcpServer();
    assert.ok(server, "McpServer instance should be created");
    assert.strictEqual(server.server["_serverInfo"].name, SERVER_NAME);
    assert.strictEqual(server.server["_serverInfo"].version, REGISTRY_VERSION);

    const registeredTools = Object.keys((server as any)._registeredTools);
    assert.deepStrictEqual(registeredTools, [
      "company_ping",
      "company_get_info",
      "company_list_agents",
      "company_get_agent",
      "company_list_quota_pools"
    ]);
  });

  test("5. Migration v0.4.1 Manifest Sync Blueprint", () => {
    const manifestPath = resolve("../company-manifest.json");
    const result = migrateV041(db, manifestPath);
    assert.strictEqual(result.success, true);
    assert.strictEqual(result.updatedCount, 6, "All 6 registered agents must be updated");

    const chatgpt = db.prepare("SELECT * FROM agents WHERE agent_id = 'chatgpt-01'").get() as any;
    assert.strictEqual(chatgpt.role, "CEO / Main Orchestrator");
    assert.strictEqual(chatgpt.department, "Executive & Product Strategy");
    assert.strictEqual(chatgpt.access_profile, "web_agent_logical");
  });
});
