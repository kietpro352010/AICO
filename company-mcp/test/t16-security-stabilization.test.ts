import test from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import * as crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import { createSandboxTestContext } from "./helpers/test-context.js";
import { ConnectionManager } from "../src/db/connection-manager.js";
import { MigrationRunner } from "../src/db/migration-runner.js";
import { migrationV040 } from "../src/db/migrations/v040-agent-columns.js";
import { migrationV050Schema } from "../src/db/migrations/v050-target-schema.js";
import { rfc8785Canonicalize } from "../src/security/rfc8785-canonicalize.js";
import { ApprovalService } from "../src/services/approval-service.js";
import { IdentityAccessService } from "../src/services/identity-access-service.js";
import { ProjectTaskService } from "../src/services/project-task-service.js";
import { ObservabilityQuotaService, GENESIS_ANCHOR } from "../src/services/observability-quota-service.js";
import { GitMediationService } from "../src/services/git-mediation-service.js";

test("T16: Critical Security Stabilization & P0/P1 Remediation Suite", async (t) => {
  const ctx = createSandboxTestContext("aico-t16-security-");
  const conn = new ConnectionManager(ctx.dbPath);
  const runner = new MigrationRunner(conn);
  runner.runMigrations([migrationV040, migrationV050Schema]);

  const idService = new IdentityAccessService(conn);
  const appService = new ApprovalService(conn);
  const taskService = new ProjectTaskService(conn, appService);
  const obsService = new ObservabilityQuotaService(conn, "test_hmac_secret_key_v221_32bytes_long", ctx.anchorPath);

  const founderCtx = idService.getPrincipalById("founder-01")!;
  const flash1Ctx = idService.getPrincipalById("flash-01")!;
  const flash2Ctx = idService.getPrincipalById("flash-02")!;
  const codexCtx = idService.getPrincipalById("codex-01")!;

  try {
    // ------------------------------------------------------------------------
    // Part 1: RFC 8785 JCS Canonicalization Test Vectors
    // ------------------------------------------------------------------------
    await t.test("1.1 RFC 8785 JCS deterministic serialization and nested hashing", () => {
      // Prompt required test vector: differences in nested target
      const p1 = { task: { action: "invoke", target: "argon-01" }, limits: { files: 3 } };
      const p2 = { task: { action: "invoke", target: "argon-02" }, limits: { files: 3 } };

      const h1 = appService.computeCanonicalPayloadHash(p1);
      const h2 = appService.computeCanonicalPayloadHash(p2);

      assert.notEqual(h1.canonicalJson, h2.canonicalJson);
      assert.notEqual(h1.sha256, h2.sha256, "Nested target differences MUST produce distinct hashes");
      assert.equal(h1.canonicalJson, '{"limits":{"files":3},"task":{"action":"invoke","target":"argon-01"}}');
      assert.equal(h2.canonicalJson, '{"limits":{"files":3},"task":{"action":"invoke","target":"argon-02"}}');

      // Key sorting independence across nested structures
      const unorderedA = { b: { d: 1, c: 2 }, a: 3 };
      const unorderedB = { a: 3, b: { c: 2, d: 1 } };
      const cA = rfc8785Canonicalize(unorderedA);
      const cB = rfc8785Canonicalize(unorderedB);
      assert.equal(cA, cB, "Recursive JCS key sorting must be deterministic");
      assert.equal(cA, '{"a":3,"b":{"c":2,"d":1}}');

      // Number formatting: -0 becomes 0, finite check
      assert.equal(rfc8785Canonicalize(-0), "0");
      assert.equal(rfc8785Canonicalize(0), "0");
      assert.throws(() => rfc8785Canonicalize(NaN), /Non-finite numbers/);
      assert.throws(() => rfc8785Canonicalize(Infinity), /Non-finite numbers/);

      // Circular structure rejection
      const circularObj: any = { a: 1 };
      circularObj.self = circularObj;
      assert.throws(() => rfc8785Canonicalize(circularObj), /Circular reference detected/);
    });

    // ------------------------------------------------------------------------
    // Part 2: Approval Security — Mandatory Payload, Expiration, Identity & Single-Use
    // ------------------------------------------------------------------------
    await t.test("2.1 Mandatory canonical payload and hash validation in consumeApproval()", () => {
      const appr = appService.createApprovalRequest({
        ctx: flash1Ctx,
        action_type: "argon_invocation",
        target_agent_id: "argon-01",
        target_resource: "task:task_argon_001",
        canonical_payload: { taskId: "task_argon_001", targetAgentId: "argon-01" },
        approval_tier: "founder"
      });

      appService.decideApproval({
        ctx: founderCtx,
        approval_id: appr.approval_id,
        decision: "approved"
      });

      // 1. Missing payload must fail closed
      const resMissing = appService.consumeApproval({
        approvalId: appr.approval_id,
        expectedActionType: "argon_invocation",
        canonicalPayload: undefined as any
      });
      assert.equal(resMissing.valid, false);
      assert.match(resMissing.error!, /CANONICAL_PAYLOAD_MANDATORY/);

      // 2. Tampered payload must fail closed
      const resTampered = appService.consumeApproval({
        approvalId: appr.approval_id,
        expectedActionType: "argon_invocation",
        canonicalPayload: { taskId: "task_argon_001", targetAgentId: "argon-02" } // Changed target
      });
      assert.equal(resTampered.valid, false);
      assert.match(resTampered.error!, /Payload hash mismatch/);

      // 3. Exact approved payload succeeds
      const resValid = appService.consumeApproval({
        approvalId: appr.approval_id,
        expectedActionType: "argon_invocation",
        canonicalPayload: { taskId: "task_argon_001", targetAgentId: "argon-01" }
      });
      assert.equal(resValid.valid, true);

      // 4. Single-use enforcement: re-consume must fail
      const resReplay = appService.consumeApproval({
        approvalId: appr.approval_id,
        expectedActionType: "argon_invocation",
        canonicalPayload: { taskId: "task_argon_001", targetAgentId: "argon-01" }
      });
      assert.equal(resReplay.valid, false, "Replay of consumed approval MUST be rejected");
    });

    await t.test("2.2 Expiration enforcement on decideApproval() and consumeApproval()", () => {
      // Create approval with negative expiration (already expired)
      const expiredAppr = appService.createApprovalRequest({
        ctx: flash1Ctx,
        action_type: "architecture_review",
        target_resource: "architecture:v3",
        canonical_payload: { scope: "v3" },
        approval_tier: "founder",
        expiresInHours: -1
      });

      // Cannot decide expired approval
      assert.throws(
        () => appService.decideApproval({ ctx: founderCtx, approval_id: expiredAppr.approval_id, decision: "approved" }),
        /APPROVAL_EXPIRED/
      );

      // Verify that an approved request that expires before consumption is rejected
      const appr2 = appService.createApprovalRequest({
        ctx: flash1Ctx,
        action_type: "architecture_review",
        target_resource: "architecture:v3",
        canonical_payload: { scope: "v3_pass" },
        approval_tier: "founder",
        expiresInHours: 24
      });
      appService.decideApproval({ ctx: founderCtx, approval_id: appr2.approval_id, decision: "approved" });

      // Artificially expire the approval in DB
      conn.withWriteTransaction((db) => {
        db.prepare("UPDATE approval_requests SET expires_at = ? WHERE approval_id = ?")
          .run(new Date(Date.now() - 60000).toISOString(), appr2.approval_id);
      });

      const resConsumeExpired = appService.consumeApproval({
        approvalId: appr2.approval_id,
        expectedActionType: "architecture_review",
        canonicalPayload: { scope: "v3_pass" }
      });
      assert.equal(resConsumeExpired.valid, false);
      assert.match(resConsumeExpired.error!, /APPROVAL_EXPIRED/);
    });

    await t.test("2.3 Founder identity binding and separation of duties", () => {
      const apprFounder = appService.createApprovalRequest({
        ctx: codexCtx,
        action_type: "db_migration",
        target_resource: "database:production",
        canonical_payload: { migration: "v0.5.0" },
        approval_tier: "founder"
      });

      // AI agent cannot decide Founder-tier approval
      assert.throws(
        () => appService.decideApproval({ ctx: flash1Ctx, approval_id: apprFounder.approval_id, decision: "approved" }),
        /PERMISSION_DENIED: Founder tier approvals can ONLY be decided by human founder-01/
      );

      // Separation of Duties: Requester cannot approve own request
      const selfReqAppr = appService.createApprovalRequest({
        ctx: founderCtx,
        action_type: "architecture_review",
        target_resource: "policy:waiver",
        canonical_payload: { reason: "test" },
        approval_tier: "founder"
      });
      assert.throws(
        () => appService.decideApproval({ ctx: founderCtx, approval_id: selfReqAppr.approval_id, decision: "approved" }),
        /SOD_VIOLATION: Approver cannot be the same entity that requested approval/
      );
    });

    // ------------------------------------------------------------------------
    // Part 3: Task Authorization — Critical Non-Argon Approvals & Designated Reviewer
    // ------------------------------------------------------------------------
    await t.test("3.1 Critical non-Argon tasks require explicit Founder approval", () => {
      // Create a critical task assigned to codex-01
      const critTask = taskService.createTask({
        ctx: flash1Ctx,
        taskId: "task_crit_deploy_01",
        projectId: "proj_aico_v221",
        title: "Critical Production Deploy",
        assignedAgentId: "codex-01",
        riskClass: "critical",
        priority: "P0"
      });
      assert.equal(critTask.execution_status, "waiting_approval");

      // Attempting TR-04 (waiting_approval -> queued) without approval must fail closed
      assert.throws(
        () => taskService.transitionTask({ ctx: flash1Ctx, taskId: critTask.task_id, expectedVersion: 1, toStatus: "queued" }),
        /CRITICAL_TASK_APPROVAL_REQUIRED/
      );

      // Attempting TR-18 (waiting_approval -> in_progress) without approval must fail closed
      assert.throws(
        () => taskService.transitionTask({ ctx: flash1Ctx, taskId: critTask.task_id, expectedVersion: 1, toStatus: "in_progress" }),
        /CRITICAL_TASK_APPROVAL_REQUIRED/
      );

      // Create and approve Founder approval for critical task
      const critAppr = appService.createApprovalRequest({
        ctx: flash1Ctx,
        action_type: "critical_task_approval",
        target_agent_id: "codex-01",
        target_resource: `task:${critTask.task_id}`,
        canonical_payload: { taskId: critTask.task_id, riskClass: "critical", priority: "P0" },
        approval_tier: "founder"
      });
      appService.decideApproval({ ctx: founderCtx, approval_id: critAppr.approval_id, decision: "approved" });

      // Now TR-04 succeeds with approval
      const tr04 = taskService.transitionTask({
        ctx: flash1Ctx,
        taskId: critTask.task_id,
        expectedVersion: 1,
        toStatus: "queued",
        approvalId: critAppr.approval_id
      });
      assert.equal(tr04.execution_status, "queued");
    });

    await t.test("3.2 TR-25 Designated Reviewer & Anti-Self-Approval enforcement", () => {
      const devTask = taskService.createTask({
        ctx: flash1Ctx,
        taskId: "task_review_test_01",
        projectId: "proj_aico_v221",
        title: "Feature Implementation",
        assignedAgentId: "codex-01",
        reviewerAgentId: "flash-02",
        riskClass: "medium"
      });

      // Advance task: draft -> queued -> assigned -> claimed -> in_progress -> review_required
      taskService.transitionTask({ ctx: flash1Ctx, taskId: devTask.task_id, expectedVersion: 1, toStatus: "queued" });
      taskService.transitionTask({ ctx: flash1Ctx, taskId: devTask.task_id, expectedVersion: 2, toStatus: "assigned" });
      taskService.transitionTask({ ctx: codexCtx, taskId: devTask.task_id, expectedVersion: 3, toStatus: "claimed" });
      taskService.transitionTask({ ctx: codexCtx, taskId: devTask.task_id, expectedVersion: 4, toStatus: "in_progress" });
      taskService.submitTaskResult({
        ctx: codexCtx,
        taskId: devTask.task_id,
        expectedVersion: 5,
        outputArtifactIds: ["art_01"],
        verificationEvidence: "All unit tests passed"
      });

      // 1. Anti-self-approval: Assigned agent (codex-01) CANNOT approve own work
      assert.throws(
        () => taskService.transitionTask({ ctx: codexCtx, taskId: devTask.task_id, expectedVersion: 6, toStatus: "completed" }),
        /ABAC_OWNERSHIP_OR_SOD_VIOLATION: Agent cannot approve own task as completed/
      );

      // 2. Wrong reviewer (e.g. chatgpt-01) CANNOT approve when flash-02 is designated reviewer
      const chatgptCtx = idService.getPrincipalById("chatgpt-01")!;
      assert.throws(
        () => taskService.transitionTask({ ctx: chatgptCtx, taskId: devTask.task_id, expectedVersion: 6, toStatus: "completed" }),
        /Only designated reviewer 'flash-02' or executive leadership can approve task completion/
      );

      // 3. Designated reviewer (flash-02) successfully approves
      const tr25 = taskService.transitionTask({ ctx: flash2Ctx, taskId: devTask.task_id, expectedVersion: 6, toStatus: "completed" });
      assert.equal(tr25.execution_status, "completed");

      // 4. Non-executive cannot archive task (TR-26)
      assert.throws(
        () => taskService.transitionTask({ ctx: codexCtx, taskId: devTask.task_id, expectedVersion: 7, toStatus: "archived" }),
        /PERMISSION_DENIED: Only executive leadership/
      );

      // Leadership archives task
      const tr26 = taskService.transitionTask({ ctx: flash1Ctx, taskId: devTask.task_id, expectedVersion: 7, toStatus: "archived" });
      assert.equal(tr26.execution_status, "archived");
    });

    // ------------------------------------------------------------------------
    // Part 4: Safe Lease Recovery & Argon Isolation
    // ------------------------------------------------------------------------
    await t.test("4.1 Stale lease recovery respects retry limits and isolates Argon", () => {
      // 1. Standard task with retries < max_retries
      const tNorm = taskService.createTask({
        ctx: flash1Ctx,
        taskId: "task_lease_norm_01",
        title: "Normal Lease Task",
        assignedAgentId: "codex-01"
      });
      taskService.transitionTask({ ctx: flash1Ctx, taskId: tNorm.task_id, expectedVersion: 1, toStatus: "queued" });
      taskService.transitionTask({ ctx: flash1Ctx, taskId: tNorm.task_id, expectedVersion: 2, toStatus: "assigned" });
      taskService.transitionTask({ ctx: codexCtx, taskId: tNorm.task_id, expectedVersion: 3, toStatus: "claimed" });
      taskService.transitionTask({ ctx: codexCtx, taskId: tNorm.task_id, expectedVersion: 4, toStatus: "in_progress" });

      // 2. Standard task with retry_count >= max_retries
      const tExhausted = taskService.createTask({
        ctx: flash1Ctx,
        taskId: "task_lease_exh_01",
        title: "Exhausted Retry Task",
        assignedAgentId: "codex-01"
      });
      taskService.transitionTask({ ctx: flash1Ctx, taskId: tExhausted.task_id, expectedVersion: 1, toStatus: "queued" });
      taskService.transitionTask({ ctx: flash1Ctx, taskId: tExhausted.task_id, expectedVersion: 2, toStatus: "assigned" });
      taskService.transitionTask({ ctx: codexCtx, taskId: tExhausted.task_id, expectedVersion: 3, toStatus: "claimed" });
      taskService.transitionTask({ ctx: codexCtx, taskId: tExhausted.task_id, expectedVersion: 4, toStatus: "in_progress" });

      // 3. Argon task
      const tArgon = taskService.createTask({
        ctx: flash1Ctx,
        taskId: "task_lease_argon_01",
        title: "Argon Task",
        assignedAgentId: "argon-01"
      });
      const argonAppr = appService.createApprovalRequest({
        ctx: flash1Ctx,
        action_type: "argon_invocation",
        target_agent_id: "argon-01",
        canonical_payload: { taskId: tArgon.task_id, targetAgentId: "argon-01" },
        approval_tier: "founder"
      });
      appService.decideApproval({ ctx: founderCtx, approval_id: argonAppr.approval_id, decision: "approved" });
      taskService.transitionTask({ ctx: flash1Ctx, taskId: tArgon.task_id, expectedVersion: 1, toStatus: "queued", approvalId: argonAppr.approval_id });
      taskService.transitionTask({ ctx: flash1Ctx, taskId: tArgon.task_id, expectedVersion: 2, toStatus: "assigned" });
      taskService.transitionTask({ ctx: founderCtx, taskId: tArgon.task_id, expectedVersion: 3, toStatus: "claimed" });
      taskService.transitionTask({ ctx: founderCtx, taskId: tArgon.task_id, expectedVersion: 4, toStatus: "in_progress" });

      // Manually expire leases and set retry counts in DB
      conn.withWriteTransaction((db) => {
        const past = new Date(Date.now() - 3600000).toISOString();
        db.prepare("UPDATE tasks SET lease_expires_at = ?, retry_count = 0, max_retries = 2 WHERE task_id = ?").run(past, tNorm.task_id);
        db.prepare("UPDATE tasks SET lease_expires_at = ?, retry_count = 2, max_retries = 2 WHERE task_id = ?").run(past, tExhausted.task_id);
        db.prepare("UPDATE tasks SET lease_expires_at = ?, retry_count = 0, max_retries = 0 WHERE task_id = ?").run(past, tArgon.task_id);
      });

      // Run stale lease recovery
      const rec = taskService.recoverStaleLeases();
      assert.equal(rec.recovered, 3);

      const rNorm = taskService.getTask(tNorm.task_id)!;
      assert.equal(rNorm.execution_status, "assigned");
      assert.equal(rNorm.retry_count, 1, "Standard task under max retries must increment retry_count");

      const rExhausted = taskService.getTask(tExhausted.task_id)!;
      assert.equal(rExhausted.execution_status, "blocked", "Task with max retries must transition to blocked");

      const rArgon = taskService.getTask(tArgon.task_id)!;
      assert.equal(rArgon.execution_status, "blocked", "Expired Argon task MUST transition to blocked (zero auto-retry)");
      assert.equal(rArgon.retry_count, 0, "Argon retry_count must remain 0");
    });

    // ------------------------------------------------------------------------
    // Part 5: Audit HMAC & Truncation Defense
    // ------------------------------------------------------------------------
    await t.test("5.1 Audit HMAC covers all security-relevant fields and detects truncation", () => {
      // Append an audit event
      const ev = obsService.appendAuditEvent({
        requestId: "req_audit_test_01",
        sourceGateway: "local",
        principalType: "agent",
        principalId: "flash-01",
        credentialId: "cred_01",
        eventCategory: "task",
        actionName: "company_claim_task",
        targetResource: "task:task_test",
        outcome: "succeeded",
        errorCode: null,
        sanitizedDetails: { note: "claimed successfully" }
      });

      // Initial integrity check must pass
      const verify1 = obsService.verifyAuditChainIntegrity();
      assert.equal(verify1.valid, true);

      // Tampering with sourceGateway must invalidate HMAC
      conn.withWriteTransaction((db) => {
        db.exec("DROP TRIGGER IF EXISTS trg_audit_events_no_update; DROP TRIGGER IF EXISTS trg_audit_events_no_delete;");
        db.prepare("UPDATE audit_events SET source_gateway = 'public' WHERE event_id = ?").run(ev.event_id || ev.audit_id);
      });
      const verifyTamperGateway = obsService.verifyAuditChainIntegrity();
      assert.equal(verifyTamperGateway.valid, false, "Altering source_gateway must break HMAC chain");

      // Restore sourceGateway
      conn.withWriteTransaction((db) => {
        db.prepare("UPDATE audit_events SET source_gateway = 'local' WHERE event_id = ?").run(ev.event_id || ev.audit_id);
      });

      // Ensure anchor file exists on disk
      fs.writeFileSync(
        ctx.anchorPath,
        JSON.stringify({
          last_audit_id: ev.audit_id,
          last_event_hash: ev.eventHash,
          event_hash_sha256: ev.eventHash,
          recorded_at: ev.recorded_at
        }) + "\n"
      );
      assert.equal(fs.existsSync(ctx.anchorPath), true);

      // Truncate SQLite audit_events table
      conn.withWriteTransaction((db) => {
        db.exec("DELETE FROM audit_events");
      });

      // Verifying truncated table with existing anchor file MUST fail closed
      const verifyTruncated = obsService.verifyAuditChainIntegrity();
      assert.equal(verifyTruncated.valid, false, "Truncated audit table with anchor file present must fail closed");
      assert.equal(verifyTruncated.brokenAtEventId, "AUDIT_LOG_MISSING_OR_TRUNCATED");
    });

    // ------------------------------------------------------------------------
    // Part 6: Git Full-History Divergence Secret Scan
    // ------------------------------------------------------------------------
    await t.test("6.1 Full history branch divergence detects historical deleted secrets", () => {
      const gitService = new GitMediationService("D:/AI-COMPANY", "D:/AICO-WORKTREES/security-stabilization");
      const tempRepoDir = fs.mkdtempSync(path.join(os.tmpdir(), "aico-git-test-"));

      try {
        // Init temp git repo with master branch
        execFileSync("git", ["init", "-b", "master"], { cwd: tempRepoDir });
        execFileSync("git", ["config", "user.name", "Test Agent"], { cwd: tempRepoDir });
        execFileSync("git", ["config", "user.email", "test@aico.local"], { cwd: tempRepoDir });

        fs.writeFileSync(path.join(tempRepoDir, "README.md"), "# Central Repository");
        execFileSync("git", ["add", "README.md"], { cwd: tempRepoDir });
        execFileSync("git", ["commit", "-m", "Initial commit"], { cwd: tempRepoDir });

        // Create feature branch
        execFileSync("git", ["checkout", "-b", "agent/codex-01/feat-test"], { cwd: tempRepoDir });

        // Commit a secret: sk-live_test_secret_1234567890abcdef
        const secretPath = path.join(tempRepoDir, "secret.txt");
        fs.writeFileSync(secretPath, "sk-12345678901234567890abcdef");
        execFileSync("git", ["add", "secret.txt"], { cwd: tempRepoDir });
        execFileSync("git", ["commit", "-m", "Accidental secret commit"], { cwd: tempRepoDir });

        // Delete the secret in subsequent commit
        fs.unlinkSync(secretPath);
        execFileSync("git", ["rm", "secret.txt"], { cwd: tempRepoDir });
        execFileSync("git", ["commit", "-m", "Removed secret file"], { cwd: tempRepoDir });

        // Add 55 benign commits to exceed legacy -n 50 scan window
        for (let i = 1; i <= 55; i++) {
          fs.writeFileSync(path.join(tempRepoDir, `file_${i}.txt`), `Benign change ${i}`);
          execFileSync("git", ["add", `file_${i}.txt`], { cwd: tempRepoDir });
          execFileSync("git", ["commit", "-m", `Benign commit ${i}`], { cwd: tempRepoDir });
        }

        const headSha = execFileSync("git", ["rev-parse", "HEAD"], { cwd: tempRepoDir, encoding: "utf8" }).trim();

        // Run full branch divergence scan
        const scanRes = gitService.scanCommitFiles(tempRepoDir, headSha, { baseRef: "master" });
        assert.equal(scanRes.valid, false, "Historical deleted secret 56 commits ago MUST be detected");
        assert.ok(scanRes.secretPattern, "Must report secretPattern matched");

        // Verify untracked forbidden file rejection
        fs.writeFileSync(path.join(tempRepoDir, ".env"), "API_KEY=123");
        const scanForbidden = gitService.scanCommitFiles(tempRepoDir, headSha, { baseRef: "master" });
        assert.equal(scanForbidden.valid, false);
        assert.ok(scanForbidden.forbiddenFiles.includes(".env"), "Untracked .env file must be flagged");
      } finally {
        fs.rmSync(tempRepoDir, { recursive: true, force: true });
      }
    });

  } finally {
    ctx.cleanup();
  }
});
