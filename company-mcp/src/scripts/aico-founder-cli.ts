import readline from "node:readline";
import { ConnectionManager } from "../db/connection-manager.js";
import { RuntimeConfig } from "../config/runtime-config.js";
import { CompanyRegistryService } from "../services/company-registry-service.js";
import { IdentityAccessService } from "../services/identity-access-service.js";
import { ApprovalService } from "../services/approval-service.js";
import { ObservabilityQuotaService } from "../services/observability-quota-service.js";

async function readLineFromStdin(prompt: string): Promise<string> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  return new Promise((resolve) => {
    rl.question(prompt, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

export async function showDashboard(): Promise<void> {
  const conn = new ConnectionManager(RuntimeConfig.getDbPath());
  const regService = new CompanyRegistryService(conn);
  const appService = new ApprovalService(conn);
  const obsService = new ObservabilityQuotaService(conn);

  console.log("================================================================================");
  console.log("                     AICO FOUNDER OPERATOR DASHBOARD (v2.2.1)                   ");
  console.log("================================================================================");

  // 1. Agents Overview
  console.log("\n[1] PRINCIPAL AGENTS (6 REGISTERED)");
  console.log("--------------------------------------------------------------------------------");
  const agents = regService.listAgents();
  console.log(
    "Agent ID".padEnd(14) +
    "Role".padEnd(30) +
    "Platform".padEnd(16) +
    "Status".padEnd(12) +
    "Auto-Invoke"
  );
  console.log("-".repeat(80));
  for (const a of agents) {
    console.log(
      a.agent_id.padEnd(14) +
      a.role.slice(0, 28).padEnd(30) +
      a.platform.padEnd(16) +
      a.status.padEnd(12) +
      (a.invocation_policy.auto_invoke ? "ENABLED" : "MANUAL")
    );
  }

  // 2. Quota Pools
  console.log("\n[2] QUOTA POOLS (5 CONFIGURED)");
  console.log("--------------------------------------------------------------------------------");
  const pools = regService.listQuotaPools();
  for (const p of pools) {
    console.log(`- ${p.pool_id.padEnd(20)} [${p.provider}] Account: ${p.account_label} (Agents: ${p.agent_count})`);
  }

  // 3. Pending Approvals
  console.log("\n[3] PENDING APPROVAL REQUESTS (GATES)");
  console.log("--------------------------------------------------------------------------------");
  try {
    const pending = appService.listApprovalRequests({ status: "pending" });
    if (pending.length === 0) {
      console.log("  No pending approvals.");
    } else {
      for (const ap of pending) {
        console.log(`- ID: ${ap.approval_id} | Type: ${ap.action_type} | Requested By: ${ap.requested_by_principal_id} | Tier: ${ap.approval_tier}`);
      }
    }
  } catch (err: any) {
    console.log(`  (Table 'approval_requests' not present in current DB; awaiting Gate G4 migration)`);
  }

  // 4. Audit Chain Integrity
  console.log("\n[4] AUDIT CHAIN INTEGRITY");
  console.log("--------------------------------------------------------------------------------");
  try {
    const chain = obsService.verifyAuditChainIntegrity();
    console.log(`  Audit Chain Valid: ${chain.valid ? "YES (Tamper-evident)" : "TAMPERED / BROKEN"}`);
    console.log(`  Total Events:      ${chain.totalEvents}`);
    if (chain.brokenAtEventId) {
      console.log(`  Broken at Event ID: ${chain.brokenAtEventId}`);
    }
  } catch (err: any) {
    console.log(`  Audit status unavailable: ${err.message}`);
  }

  console.log("\n================================================================================");
}

export async function issueCredentialSecure(): Promise<void> {
  const conn = new ConnectionManager(RuntimeConfig.getDbPath());
  const idService = new IdentityAccessService(conn);

  console.log("=== AICO SECURE CREDENTIAL PROVISIONING (STDIN PIPE) ===");
  const principalId = await readLineFromStdin("Enter Principal ID (e.g. founder-01, flash-01, flash-02, codex-01): ");
  if (!principalId) {
    console.error("Principal ID required.");
    return;
  }

  const scopesInput = await readLineFromStdin("Enter comma-separated scopes (or '*' for founder): ");
  const scopes = scopesInput.split(",").map((s) => s.trim()).filter(Boolean);

  const allowPublic = await readLineFromStdin("Allow Public Gateway? (y/N): ");
  const isPublic = allowPublic.toLowerCase() === "y";

  const result = idService.issueCredential({
    principal_id: principalId,
    scopes,
    allow_public_gateway: isPublic,
    expires_in_days: 90
  });

  console.log("\n--- CREDENTIAL ISSUED SUCCESSFULLY ---");
  console.log(`Credential ID:   ${result.credential_id}`);
  console.log(`Key Prefix:      ${result.key_prefix}`);
  console.log(`Expires At:      ${result.expires_at}`);
  console.log(`RAW TOKEN (SHOW ONCE):`);
  console.log(`\n  ${result.raw_token_display_once}\n`);
  console.log("Save this token to your DPAPI credential store or client environment. It cannot be recovered from the database.");
}

async function main() {
  const cmd = process.argv[2] || "dashboard";

  switch (cmd) {
    case "dashboard":
      await showDashboard();
      break;
    case "issue-token":
      await issueCredentialSecure();
      break;
    default:
      console.log("Usage: node aico-founder-cli.ts [dashboard | issue-token]");
  }
}

if (process.argv[1]?.endsWith("aico-founder-cli.ts") || process.argv[1]?.endsWith("aico-founder-cli.js")) {
  void main();
}
