import test from "node:test";
import assert from "node:assert/strict";
import { createSandboxTestContext } from "./helpers/test-context.js";
import { ConnectionManager } from "../src/db/connection-manager.js";
import { MigrationRunner } from "../src/db/migration-runner.js";
import { migrationV040 } from "../src/db/migrations/v040-agent-columns.js";
import { migrationV050Schema } from "../src/db/migrations/v050-target-schema.js";
import { IdentityAccessService } from "../src/services/identity-access-service.js";
import { ApprovalService } from "../src/services/approval-service.js";
import { WorkspaceArtifactService } from "../src/services/workspace-artifact-service.js";

test("T02: Core Services — Identity, Approvals and Workspace Artifact Guard", () => {
  const ctx = createSandboxTestContext("aico-core-services-");

  try {
    const connManager = new ConnectionManager(ctx.dbPath);
    const runner = new MigrationRunner(connManager);
    runner.runMigrations([migrationV040, migrationV050Schema]);

    // 1. IdentityAccessService verification
    const idService = new IdentityAccessService(connManager);
    const founder = idService.getPrincipal("founder-01");
    assert.ok(founder, "Founder principal exists");
    assert.equal(founder.is_human, true);

    const flash = idService.getPrincipal("flash-01");
    assert.ok(flash, "Flash-01 exists");
    assert.equal(flash.is_human, false);

    const { token, credentialId } = idService.issueCredential("flash-01", ["tools:execute", "workspace:read"]);
    assert.ok(token.startsWith("aico_live_"), "Token format prefix is valid");

    const authResult = idService.authenticateToken(token);
    assert.equal(authResult.authenticated, true);
    assert.equal(authResult.principalId, "flash-01");
    assert.deepEqual(authResult.scopes, ["tools:execute", "workspace:read"]);

    // Test timing-safe failure on bad token
    const badAuth = idService.authenticateToken(token + "_tampered");
    assert.equal(badAuth.authenticated, false);

    // 2. ApprovalService verification (One-time payload-bound approval)
    const appService = new ApprovalService(connManager);
    const payload = { action: "deploy", target: "staging", version: "1.0.0" };

    const { approvalId, payloadHashSha256 } = appService.createApprovalRequest({
      actionType: "deploy_action",
      requestedBy: "flash-01",
      requiredApprover: "founder-01",
      canonicalPayload: payload
    });
    assert.ok(approvalId.startsWith("appr_"));

    // Approve by founder
    const decResult = appService.decideApproval({
      approvalId,
      decidedBy: "founder-01",
      decision: "approved"
    });
    assert.equal(decResult.success, true);
    assert.equal(decResult.status, "approved");

    // Consume approval once
    const consume1 = appService.consumeApproval({
      approvalId,
      expectedActionType: "deploy_action",
      canonicalPayload: payload
    });
    assert.equal(consume1.valid, true);

    // Ensure cannot be re-consumed (Replay attack defense)
    const consume2 = appService.consumeApproval({
      approvalId,
      expectedActionType: "deploy_action",
      canonicalPayload: payload
    });
    assert.equal(consume2.valid, false);
    assert.ok(consume2.error?.includes("not in approved state"));

    // 3. WorkspaceArtifactService verification
    const wsService = new WorkspaceArtifactService(ctx.tempDir);

    const writeRes = wsService.safeWriteArtifact("test-doc.txt", "Hello AICO v2.2.1", "workspace");
    assert.ok(writeRes.bytesWritten > 0);

    const readContent = wsService.safeReadArtifact("test-doc.txt", "workspace");
    assert.equal(readContent, "Hello AICO v2.2.1");

    // Enforce path traversal failure
    assert.throws(
      () => wsService.validateAndResolveSafePath("../../../outside.txt", "workspace"),
      /Path traversal denied/
    );

    // Enforce null-byte injection failure
    assert.throws(
      () => wsService.validateAndResolveSafePath("safe.txt\0.js", "workspace"),
      /null byte/
    );
  } finally {
    ctx.cleanup();
  }
});
