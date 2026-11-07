import test from "node:test";
import assert from "node:assert/strict";
import * as path from "node:path";
import * as fs from "node:fs";
import { createSandboxTestContext } from "./helpers/test-context.js";
import { ConnectionManager } from "../src/db/connection-manager.js";
import { MigrationRunner } from "../src/db/migration-runner.js";
import { migrationV040 } from "../src/db/migrations/v040-agent-columns.js";
import { migrationV050Schema } from "../src/db/migrations/v050-target-schema.js";
import { IdentityAccessService } from "../src/services/identity-access-service.js";
import { StdioSecurityPipeline } from "../src/security/stdio-security-pipeline.js";
import { DpapiManager } from "../src/security/dpapi-manager.js";
import { resolveToken } from "../src/client-bridge.js";

test("T10: Windows DPAPI Protection, STDIO Frame Limits & Live Token Revocation", async () => {
  const ctx = createSandboxTestContext("aico-t10-dpapi-");

  try {
    const conn = new ConnectionManager(ctx.dbPath);
    const runner = new MigrationRunner(conn);
    runner.runMigrations([migrationV040, migrationV050Schema]);

    const idService = new IdentityAccessService(conn);

    // ------------------------------------------------------------------------
    // Part 1: Windows DPAPI Protect & Unprotect Round-Trip
    // ------------------------------------------------------------------------
    const testSecretToken = "aico_live_test_dpapi_secret_key_999";
    const dpapiFilePath = path.join(ctx.tempDir, "flash-01.dpapi");

    // Encrypt to DPAPI file
    DpapiManager.protect(testSecretToken, dpapiFilePath);
    assert.ok(fs.existsSync(dpapiFilePath), "DPAPI file must be written to disk");

    // Verify unprotect
    const decryptedToken = DpapiManager.unprotect(dpapiFilePath);
    assert.equal(decryptedToken, testSecretToken, "DPAPI unprotect must recover exact original plaintext token");

    // On Windows, verify file content is real DPAPI binary ciphertext, NEVER plaintext UTF-8
    if (process.platform === "win32") {
      const rawBytes = fs.readFileSync(dpapiFilePath);
      const rawStr = rawBytes.toString("utf8");
      assert.strictEqual(
        rawStr.includes("aico_live_"),
        false,
        "DPAPI protected file on Windows must contain binary ciphertext, never plaintext token"
      );
      assert.ok(rawBytes.length > testSecretToken.length, "Encrypted DPAPI blob must include cryptographic headers");
    }

    // Verify client-bridge resolveToken with DPAPI file
    const resolvedViaBridge = resolveToken("flash-01", dpapiFilePath);
    assert.equal(resolvedViaBridge, testSecretToken, "client-bridge resolveToken must decrypt .dpapi files");

    // ------------------------------------------------------------------------
    // Part 2: STDIO Frame Size Enforcement (Helper and Stream Guard)
    // ------------------------------------------------------------------------
    const stdioPipeline = new StdioSecurityPipeline(idService, {
      maxFrameSizeBytes: 2 * 1024 * 1024 // 2 MiB
    });

    // 1. Frame within limit (1 MiB) -> passes
    assert.doesNotThrow(() => stdioPipeline.validateMessageFrame(1024 * 1024));

    // 2. Frame exceeding limit (3 MiB) -> throws PAYLOAD_TOO_LARGE
    assert.throws(
      () => stdioPipeline.validateMessageFrame(3 * 1024 * 1024),
      /PAYLOAD_TOO_LARGE/
    );

    // 3. Raw stream frame guard inspection
    const { PassThrough } = await import("node:stream");
    const testStream = new PassThrough();
    stdioPipeline.installStdinFrameGuard(testStream);

    let streamError: any = null;
    testStream.on("error", (err) => {
      streamError = err;
    });

    // Write oversized data (> 2 MiB)
    testStream.write(Buffer.alloc(2 * 1024 * 1024 + 500, 65));
    await new Promise((r) => setTimeout(r, 20));
    assert.ok(streamError, "installStdinFrameGuard must emit error when raw frame exceeds 2 MiB");
    assert.match(streamError.message, /PAYLOAD_TOO_LARGE/);

    // ------------------------------------------------------------------------
    // Part 3: STDIO Bootstrap & Live Credential Revocation (P1-02)
    // ------------------------------------------------------------------------
    const credData = idService.issueCredential({
      principal_id: "flash-02",
      scopes: ["company:read", "workspace:read:self"]
    });

    const tokenFilePath = path.join(ctx.tempDir, "flash-02.dpapi");
    DpapiManager.protect(credData.token, tokenFilePath);

    // Bootstrap STDIO session
    const sessionPrincipal = stdioPipeline.bootstrap(tokenFilePath);
    assert.equal(sessionPrincipal.authenticated, true);
    assert.equal(sessionPrincipal.principalId, "flash-02");

    // Live revalidation while active -> passes
    const revalActive = stdioPipeline.revalidateLivePrincipal();
    assert.equal(revalActive.authenticated, true);

    // Admin revokes credential in database during active session
    idService.revokeCredential(credData.credential_id, "administrative_security_lockout");

    // Live revalidation during active session must now FAIL closed
    assert.throws(
      () => stdioPipeline.revalidateLivePrincipal(),
      /AUTH_CREDENTIAL_REVOKED/,
      "Must reject active session when credential has been revoked in DB"
    );
  } finally {
    ctx.cleanup();
  }
});
