import test from "node:test";
import assert from "node:assert/strict";
import {
  CompanyPingInputSchema,
  CompanyPingOutputSchema,
  CompanyListAgentsOutputSchema,
  PublicManifestViewSchema,
  ApprovalRequestCreatedViewSchema
} from "../src/contracts/mcp-tool-schemas.js";

test("T03: MCP Tool Contracts and Public DTO Leakage Prevention", () => {
  // 1. Validate M01 ping contract
  const pingIn = CompanyPingInputSchema.parse({});
  assert.equal(pingIn.message, "Hello AICO");

  const pingOut = CompanyPingOutputSchema.parse({
    success: true,
    server: "aico-company-mcp",
    version: "0.3.0",
    received: "Hello",
    timestamp: new Date().toISOString()
  });
  assert.equal(pingOut.success, true);

  // 2. Validate M06 Public Manifest DTO - Prohibit raw manifest and secrets leakage
  const safeManifest = PublicManifestViewSchema.parse({
    manifest_version: "1.1",
    company_name: "AICO",
    operating_mode: "Hybrid Local-First",
    agent_count: 6,
    quota_pool_count: 5,
    timestamp: new Date().toISOString()
  });
  assert.equal(safeManifest.agent_count, 6);

  // Negative test: verify prohibited internal fields are not part of PublicManifestViewSchema
  const rawWithSecrets = {
    ...safeManifest,
    internal_secrets: "secret_token_123",
    db_connection_string: "postgres://..."
  };
  const parsed = PublicManifestViewSchema.safeParse(rawWithSecrets);
  // Zod default strips extra keys unless passthrough() is enabled, proving no field exposure
  assert.ok(parsed.success);
  assert.equal((parsed.data as any).internal_secrets, undefined);

  // 3. Validate M13 Approval Created View
  const appCreated = ApprovalRequestCreatedViewSchema.parse({
    success: true,
    approval_id: "appr_12345",
    action_type: "deploy_action",
    requested_by: "flash-01",
    required_approver: "founder-01",
    payload_hash_sha256: "abc123def456",
    status: "pending",
    expires_at: new Date().toISOString()
  });
  assert.equal(appCreated.approval_id, "appr_12345");
  // Ensure raw canonical payload is omitted from created view as per v2.2.1 contract
  assert.equal((appCreated as any).canonical_payload, undefined);
});
