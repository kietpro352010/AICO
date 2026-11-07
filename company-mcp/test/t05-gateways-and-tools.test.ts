import test from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { createFullMcpServer, createBaseMcpServer } from "../src/registry-core.js";
import { PUBLIC_TOOL_ALLOWLIST } from "../src/security/http-security-pipeline.js";
import { performBackup } from "../src/scripts/backup-db.js";
import { restoreDatabase } from "../src/scripts/restore-db-safe.js";
import { createSandboxTestContext } from "./helpers/test-context.js";

test("T05: Complete 38 MCP Tools & Gateway Allowlist Verification", async () => {
  // 1. Verify Full Local/STDIO MCP Server registers all 38 tools
  const localServer = createFullMcpServer({ isPublicGateway: false });
  const localTools = Object.keys((localServer as any)._registeredTools);

  assert.equal(localTools.length, 38, `Local server must register exactly 38 tools, got ${localTools.length}`);

  const requiredLocalOnlyTools = [
    "company_list_credentials",      // M09
    "company_issue_credential",     // M10
    "company_rotate_credential",    // M11
    "company_revoke_credential",    // M12
    "company_decide_approval",      // M16
    "company_get_workspace_activity", // M22
    "company_git_sync_branch",      // M23
    "company_review_task",          // M33
    "company_record_external_dispatch" // M34
  ];

  for (const tool of requiredLocalOnlyTools) {
    assert.ok(localTools.includes(tool), `Local server must include ${tool}`);
  }

  // 2. Verify Public Gateway registers strictly 29 tools (9 admin/physical tools absent)
  const publicServer = createFullMcpServer({ isPublicGateway: true });
  const publicTools = Object.keys((publicServer as any)._registeredTools);

  assert.equal(publicTools.length, 29, `Public server must register exactly 29 tools, got ${publicTools.length}`);

  for (const tool of requiredLocalOnlyTools) {
    assert.strictEqual(
      publicTools.includes(tool),
      false,
      `Public gateway must NEVER expose administrative or physical tool: ${tool}`
    );
  }

  // Verify all public tools belong to PUBLIC_TOOL_ALLOWLIST
  for (const tool of publicTools) {
    assert.ok(PUBLIC_TOOL_ALLOWLIST.has(tool), `Registered public tool ${tool} must be in allowlist`);
  }

  // 3. Verify Base MCP Server backward compatibility (5 tools)
  const baseServer = createBaseMcpServer();
  const baseTools = Object.keys((baseServer as any)._registeredTools);
  assert.equal(baseTools.length, 5, "Base MCP server must register exactly 5 legacy tools");
});

test("T06: Backup and Safe Restore Drills on Sandbox Database", async () => {
  const fixture = createSandboxTestContext();
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "aico-drill-"));

  try {
    // Perform backup
    const backupResult = performBackup(fixture.dbPath, tempDir);
    assert.ok(fs.existsSync(backupResult.backupPath), "Backup file exists");
    assert.ok(fs.existsSync(`${backupResult.backupPath}.sha256`), "SHA256 checksum file exists");
    assert.equal(backupResult.integrity, "ok", "Backup integrity check is ok");

    // Perform safe restore drill into new target
    const targetRestoreDb = path.join(tempDir, "aico_restored.db");
    const restoreResult = restoreDatabase(backupResult.backupPath, targetRestoreDb);
    assert.equal(restoreResult.restored, true);
    assert.equal(restoreResult.integrity, "ok");
    assert.ok(fs.existsSync(targetRestoreDb), "Restored DB file exists");
  } finally {
    fixture.cleanup();
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
