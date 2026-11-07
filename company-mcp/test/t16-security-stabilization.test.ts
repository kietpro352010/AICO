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
    // Part 1: RFC 8785 JCS Canonicalization, Test Vectors & Model Boundaries
    // ------------------------------------------------------------------------
    await t.test("1.1 RFC 8785 JCS deterministic serialization and nested hashing", () => {
      // Differences in nested target
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
      assert.throws(() => rfc8785Canonicalize(-Infinity), /Non-finite numbers/);

      // Circular structure rejection
      const circularObj: any = { a: 1 };
      circularObj.self = circularObj;
      assert.throws(() => rfc8785Canonicalize(circularObj), /Circular reference detected/);
    });

    await t.test("1.2 Official RFC 8785 Test Vectors (arrays, structures, french, values)", () => {
      // 1. arrays.json vector: array order preserved, inner object keys sorted
      const vectorArrays = [56, { d: true, "10": null, "1": [] }];
      assert.equal(rfc8785Canonicalize(vectorArrays), '[56,{"1":[],"10":null,"d":true}]');

      // 2. structures.json vector
      const vectorStructures = {
        "1": { f: { f: "hi", F: 5 }, "\n": 56.0 },
        "10": {},
        "": "empty",
        a: {},
        "111": [{ e: "yes", E: "no" }],
        A: {}
      };
      assert.equal(
        rfc8785Canonicalize(vectorStructures),
        '{"":"empty","1":{"\\n":56,"f":{"F":5,"f":"hi"}},"10":{},"111":[{"E":"no","e":"yes"}],"A":{},"a":{}}'
      );

      // 3. french.json vector: strict UTF-16 code unit order, ignoring locale
      const vectorFrench = {
        peach: "This sorting order",
        "péché": "is wrong according to French",
        "pêche": "but canonicalization MUST",
        sin: "ignore locale"
      };
      assert.equal(
        rfc8785Canonicalize(vectorFrench),
        '{"peach":"This sorting order","péché":"is wrong according to French","pêche":"but canonicalization MUST","sin":"ignore locale"}'
      );

      // 4. values.json vector: numbers formatting, string escapes, literals
      const vectorValues = {
        numbers: [333333333.33333329, 1e30, 4.5, 2e-3, 1e-27],
        string: "\u20ac$\u000f\nA'B\"\\\\\"/",
        literals: [null, true, false]
      };
      assert.equal(
        rfc8785Canonicalize(vectorValues),
        '{"literals":[null,true,false],"numbers":[333333333.3333333,1e+30,4.5,0.002,1e-27],"string":"€$\\u000f\\nA\'B\\"\\\\\\\\\\"/"}'
      );
    });

    await t.test("1.3 Sparse array handling and holes canonicalization", () => {
      // JavaScript sparse arrays with holes
      const sparseArr = [1, , 3]; // index 1 is a hole
      assert.equal(rfc8785Canonicalize(sparseArr), "[1,null,3]");

      const emptySlots = new Array(3);
      assert.equal(rfc8785Canonicalize(emptySlots), "[null,null,null]");

      const trailingHole = [42];
      trailingHole.length = 3;
      assert.equal(rfc8785Canonicalize(trailingHole), "[42,null,null]");
    });

    await t.test("1.4 Strict rejection of data outside JSON data model", () => {
      // Top-level unsupported types
      assert.throws(() => rfc8785Canonicalize(undefined), /Unsupported data type 'undefined'/);
      assert.throws(() => rfc8785Canonicalize(Symbol("id")), /Unsupported data type 'symbol'/);
      assert.throws(() => rfc8785Canonicalize(() => {}), /Unsupported data type 'function'/);
      assert.throws(() => rfc8785Canonicalize(10n), /Unsupported data type 'bigint'/);

      // Non-plain objects
      assert.throws(() => rfc8785Canonicalize(new Date()), /outside JSON data model/);
      assert.throws(() => rfc8785Canonicalize(new RegExp("abc")), /outside JSON data model/);
      assert.throws(() => rfc8785Canonicalize(new Map()), /outside JSON data model/);
      assert.throws(() => rfc8785Canonicalize(new Set([1, 2])), /outside JSON data model/);
      assert.throws(() => rfc8785Canonicalize(new Error("boom")), /outside JSON data model/);

      // Object properties outside JSON data model
      assert.throws(() => rfc8785Canonicalize({ a: undefined }), /outside JSON data model/);
      assert.throws(() => rfc8785Canonicalize({ fn: () => {} }), /outside JSON data model/);
      assert.throws(() => rfc8785Canonicalize({ sym: Symbol() }), /outside JSON data model/);
      assert.throws(() => rfc8785Canonicalize({ big: 100n }), /outside JSON data model/);

      // Array elements outside JSON data model
      assert.throws(() => rfc8785Canonicalize([() => {}]), /outside JSON data model/);
      assert.throws(() => rfc8785Canonicalize([Symbol()]), /outside JSON data model/);
      assert.throws(() => rfc8785Canonicalize([10n]), /outside JSON data model/);
    });

    // ------------------------------------------------------------------------
    // Part 2: Approval Security — Authentication, Expiration & Loose Fallback
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

      // 3. Exact payload succeeds
      const resValid = appService.consumeApproval({
        approvalId: appr.approval_id,
        expectedActionType: "argon_invocation",
        canonicalPayload: { taskId: "task_argon_001", targetAgentId: "argon-01" }
      });
      assert.equal(resValid.valid, true);

      // 4. Double consume (replay) must fail closed
      const resReplay = appService.consumeApproval({
        approvalId: appr.approval_id,
        expectedActionType: "argon_invocation",
        canonicalPayload: { taskId: "task_argon_001", targetAgentId: "argon-01" }
      });
      assert.equal(resReplay.valid, false, "Replay of consumed approval MUST be rejected");
    });

    await t.test("2.2 Expiration and invalid expires_at enforcement", () => {
      // 1. Approval with negative expiration (already expired)
      assert.throws(
        () => appService.createApprovalRequest({
          ctx: flash1Ctx,
          action_type: "project_approval",
          target_resource: "proj:test",
          canonical_payload: { scope: "v3" },
          approval_tier: "founder",
          expiresInHours: -1
        }),
        /INVALID_EXPIRATION/
      );

      // 2. Valid creation then artificially expiring in DB
      const appr2 = appService.createApprovalRequest({
        ctx: flash1Ctx,
        action_type: "project_approval",
        target_resource: "proj:test",
        canonical_payload: { scope: "v3_pass" },
        approval_tier: "founder",
        expiresInHours: 24
      });

      appService.decideApproval({ ctx: founderCtx, approval_id: appr2.approval_id, decision: "approved" });

      // Artificially expire the approval in DB
      conn.withWriteTransaction((db) => {
        db.prepare("UPDATE approval_requests SET expires_at = ? WHERE approval_id = ?").run(
          new Date(Date.now() - 1000).toISOString(),
          appr2.approval_id
        );
      });

      const resConsumeExpired = appService.consumeApproval({
        approvalId: appr2.approval_id,
        expectedActionType: "project_approval",
        canonicalPayload: { scope: "v3_pass" }
      });
      assert.equal(resConsumeExpired.valid, false);
      assert.match(resConsumeExpired.error!, /APPROVAL_EXPIRED/);

      // 3. Null or invalid expires_at in DB fails closed
      const apprNullExp = appService.createApprovalRequest({
        ctx: flash1Ctx,
        action_type: "project_approval",
        target_resource: "proj:test",
        canonical_payload: { scope: "null_exp" },
        approval_tier: "founder"
      });

      conn.withWriteTransaction((db) => {
        db.prepare("UPDATE approval_requests SET expires_at = 'invalid-date' WHERE approval_id = ?").run(apprNullExp.approval_id);
      });

      assert.throws(
        () => appService.decideApproval({ ctx: founderCtx, approval_id: apprNullExp.approval_id, decision: "approved" }),
        /APPROVAL_INVALID_EXPIRATION/
      );

      // Now set status to approved and verify consumeApproval also fails closed on invalid expiration
      conn.withWriteTransaction((db) => {
        db.prepare("UPDATE approval_requests SET status = 'approved', expires_at = 'invalid-date' WHERE approval_id = ?").run(apprNullExp.approval_id);
      });

      const resConsumeInvalid = appService.consumeApproval({
        approvalId: apprNullExp.approval_id,
        expectedActionType: "project_approval",
        canonicalPayload: { scope: "null_exp" }
      });
      assert.equal(resConsumeInvalid.valid, false);
      assert.match(resConsumeInvalid.error!, /APPROVAL_INVALID_EXPIRATION/);
    });

    await t.test("2.3 Authenticated PrincipalContext required; zero deciderId default", () => {
      const apprFounder = appService.createApprovalRequest({
        ctx: flash1Ctx,
        action_type: "db_migration",
        target_resource: "db:v0.5.0",
        canonical_payload: { migration: "v0.5.0" },
        approval_tier: "founder"
      });

      // Missing ctx must fail closed with AUTHENTICATION_REQUIRED
      assert.throws(
        () => (appService as any).decideApproval({ approval_id: apprFounder.approval_id, decision: "approved" }),
        /AUTHENTICATION_REQUIRED/
      );

      // AI Agent cannot approve founder-tier
      assert.throws(
        () => appService.decideApproval({ ctx: flash1Ctx, approval_id: apprFounder.approval_id, decision: "approved" }),
        /PERMISSION_DENIED: Founder tier approvals can ONLY be decided by human founder-01/
      );

      // Separation of duties
      const selfReqAppr = appService.createApprovalRequest({
        ctx: founderCtx,
        action_type: "architecture_review",
        target_resource: "doc:arch",
        canonical_payload: { reason: "test" },
        approval_tier: "founder"
      });

      assert.throws(
        () => appService.decideApproval({ ctx: founderCtx, approval_id: selfReqAppr.approval_id, decision: "approved" }),
        /SOD_VIOLATION: Approver cannot be the same entity that requested approval/
      );
    });

    // ------------------------------------------------------------------------
    // Part 3: Task Authorization & Rejection of Fallback Payload
    // ------------------------------------------------------------------------
    await t.test("3.1 Critical tasks require exact full payload; loose taskId fallback rejected", () => {
      const critTask = taskService.createTask({
        ctx: flash1Ctx,
        title: "Critical Database Restructuring",
        riskClass: "critical",
        priority: "P0",
        assignedAgentId: "codex-01"
      });

      assert.equal(critTask.execution_status, "waiting_approval");

      // Attempt transition without approval must throw
      assert.throws(
        () => taskService.transitionTask({ ctx: flash1Ctx, taskId: critTask.task_id, expectedVersion: 1, toStatus: "queued" }),
        /CRITICAL_TASK_APPROVAL_REQUIRED/
      );

      // Create an approval with ONLY { taskId } (the old loose fallback payload)
      const looseAppr = appService.createApprovalRequest({
        ctx: flash1Ctx,
        action_type: "critical_task_approval",
        target_resource: `task:${critTask.task_id}`,
        canonical_payload: { taskId: critTask.task_id }, // Missing riskClass and priority!
        approval_tier: "founder"
      });
      appService.decideApproval({ ctx: founderCtx, approval_id: looseAppr.approval_id, decision: "approved" });

      // Loose approval MUST BE REJECTED because fallback was eliminated
      assert.throws(
        () => taskService.transitionTask({
          ctx: flash1Ctx,
          taskId: critTask.task_id,
          expectedVersion: 1,
          toStatus: "queued",
          approvalId: looseAppr.approval_id
        }),
        /CRITICAL_TASK_APPROVAL_REQUIRED/
      );

      // Create valid, strictly bound approval with exact task, riskClass, and priority
      const exactAppr = appService.createApprovalRequest({
        ctx: flash1Ctx,
        action_type: "critical_task_approval",
        target_resource: `task:${critTask.task_id}`,
        canonical_payload: { taskId: critTask.task_id, riskClass: "critical", priority: "P0" },
        approval_tier: "founder"
      });
      appService.decideApproval({ ctx: founderCtx, approval_id: exactAppr.approval_id, decision: "approved" });

      // Now TR-04 succeeds
      const queued = taskService.transitionTask({
        ctx: flash1Ctx,
        taskId: critTask.task_id,
        expectedVersion: 1,
        toStatus: "queued",
        approvalId: exactAppr.approval_id
      });
      assert.equal(queued.execution_status, "queued");
    });

    await t.test("3.2 TR-25 Designated Reviewer & Anti-Self-Approval enforcement", () => {
      const task = taskService.createTask({
        ctx: flash1Ctx,
        title: "Standard Feature Task",
        riskClass: "medium",
        priority: "P2",
        assignedAgentId: "codex-01",
        reviewerAgentId: "flash-02"
      });

      // draft -> queued -> assigned -> claimed -> in_progress -> review_required
      taskService.transitionTask({ ctx: flash1Ctx, taskId: task.task_id, expectedVersion: 1, toStatus: "queued" });
      taskService.transitionTask({ ctx: flash1Ctx, taskId: task.task_id, expectedVersion: 2, toStatus: "assigned" });
      taskService.transitionTask({ ctx: codexCtx, taskId: task.task_id, expectedVersion: 3, toStatus: "claimed" });
      taskService.transitionTask({ ctx: codexCtx, taskId: task.task_id, expectedVersion: 4, toStatus: "in_progress" });
      const inReview = taskService.transitionTask({
        ctx: codexCtx,
        taskId: task.task_id,
        expectedVersion: 5,
        toStatus: "review_required"
      });
      assert.equal(inReview.execution_status, "review_required");

      // 1. Anti-self-approval: Assigned agent codex-01 cannot approve
      assert.throws(
        () => taskService.transitionTask({ ctx: codexCtx, taskId: task.task_id, expectedVersion: 6, toStatus: "completed" }),
        /Agent cannot approve own task as completed/
      );

      // 2. Unauthorized third agent
      const otherEngineerCtx = {
        authenticated: true,
        principalType: "agent",
        principalId: "other-engineer-01",
        displayName: "Other Engineer",
        agentId: "other-engineer-01",
        credentialId: "cred_other",
        role: "engineer",
        department: "engineering",
        scopes: new Set(["tasks:review", "tasks:transition"]),
        accessProfile: "local_agent_physical",
        workspaceId: null,
        allowPublicGateway: false,
        sourceGateway: "local",
        requestId: "req_test",
        authenticatedAt: new Date().toISOString()
      } as any;
      assert.throws(
        () => taskService.transitionTask({ ctx: otherEngineerCtx, taskId: task.task_id, expectedVersion: 6, toStatus: "completed" }),
        /Only designated reviewer/
      );

      // 3. Designated reviewer flash-02 succeeds
      const completed = taskService.transitionTask({ ctx: flash2Ctx, taskId: task.task_id, expectedVersion: 6, toStatus: "completed" });
      assert.equal(completed.execution_status, "completed");
    });

    // ------------------------------------------------------------------------
    // Part 4: Stale Lease Recovery & Partitioned Concurrency Control
    // ------------------------------------------------------------------------
    await t.test("4.1 Stale lease recovery respects retry limits and isolates Argon", () => {
      // 1. Non-Argon task with remaining retries returns to assigned (or retry)
      const tNorm = taskService.createTask({
        ctx: flash1Ctx,
        title: "Recoverable Task",
        assignedAgentId: "codex-01"
      });
      // draft -> queued -> assigned -> claimed -> in_progress
      taskService.transitionTask({ ctx: flash1Ctx, taskId: tNorm.task_id, expectedVersion: 1, toStatus: "queued" });
      taskService.transitionTask({ ctx: flash1Ctx, taskId: tNorm.task_id, expectedVersion: 2, toStatus: "assigned" });
      taskService.transitionTask({ ctx: codexCtx, taskId: tNorm.task_id, expectedVersion: 3, toStatus: "claimed" });
      taskService.transitionTask({ ctx: codexCtx, taskId: tNorm.task_id, expectedVersion: 4, toStatus: "in_progress" });

      // Expire lease
      conn.withWriteTransaction((db) => {
        db.prepare("UPDATE tasks SET lease_expires_at = ? WHERE task_id = ?").run(
          new Date(Date.now() - 1000).toISOString(),
          tNorm.task_id
        );
      });

      const sweep1 = taskService.recoverStaleLeases();
      assert.equal(sweep1.recovered, 1);
      assert.ok(sweep1.details.some(d => d.includes("Requeued to assigned")));

      const refreshedNorm = taskService.getTask(tNorm.task_id)!;
      assert.ok(refreshedNorm, "Refreshed normal task exists");
      assert.equal(refreshedNorm.execution_status, "assigned");
      assert.equal(refreshedNorm.retry_count, 1);

      // 2. Non-Argon task with exhausted retries transitions to blocked
      conn.withWriteTransaction((db) => {
        db.prepare("UPDATE tasks SET retry_count = 2, max_retries = 2, execution_status = 'in_progress', lease_owner_agent_id = 'codex-01', lease_expires_at = ? WHERE task_id = ?").run(
          new Date(Date.now() - 1000).toISOString(),
          tNorm.task_id
        );
      });

      const sweepExhausted = taskService.recoverStaleLeases();
      assert.equal(sweepExhausted.recovered, 1);
      assert.ok(sweepExhausted.details.some(d => d.includes("RETRY_EXHAUSTED")));
      const blockedTask = taskService.getTask(tNorm.task_id)!;
      assert.ok(blockedTask, "Blocked task exists");
      assert.equal(blockedTask.execution_status, "blocked");

      // 3. Argon task unconditionally isolates to blocked manual intervention
      const tArgon = taskService.createTask({
        ctx: flash1Ctx,
        title: "Argon Architecture Evaluation",
        assignedAgentId: "argon-01"
      });

      const argonAppr = appService.createApprovalRequest({
        ctx: flash1Ctx,
        action_type: "argon_invocation",
        target_agent_id: "argon-01",
        target_resource: `task:${tArgon.task_id}`,
        canonical_payload: { taskId: tArgon.task_id, targetAgentId: "argon-01" },
        approval_tier: "founder"
      });
      appService.decideApproval({ ctx: founderCtx, approval_id: argonAppr.approval_id, decision: "approved" });
      taskService.transitionTask({ ctx: flash1Ctx, taskId: tArgon.task_id, expectedVersion: 1, toStatus: "queued", approvalId: argonAppr.approval_id });
      taskService.transitionTask({ ctx: flash1Ctx, taskId: tArgon.task_id, expectedVersion: 2, toStatus: "assigned" });
      taskService.transitionTask({ ctx: founderCtx, taskId: tArgon.task_id, expectedVersion: 3, toStatus: "claimed" });
      taskService.transitionTask({ ctx: founderCtx, taskId: tArgon.task_id, expectedVersion: 4, toStatus: "in_progress" });

      conn.withWriteTransaction((db) => {
        db.prepare("UPDATE tasks SET lease_expires_at = ? WHERE task_id = ?").run(
          new Date(Date.now() - 1000).toISOString(),
          tArgon.task_id
        );
      });

      const sweepArgon = taskService.recoverStaleLeases();
      assert.equal(sweepArgon.recovered, 1);
      assert.ok(sweepArgon.details.some(d => d.includes("BLOCKED_MANUAL_INTERVENTION")));
      const refreshedArgon = taskService.getTask(tArgon.task_id)!;
      assert.ok(refreshedArgon, "Refreshed argon task exists");
      assert.equal(refreshedArgon.execution_status, "blocked");
    });

    // ------------------------------------------------------------------------
    // Part 5: Audit HMAC Canonical Serialization & Multi-Position Truncation
    // ------------------------------------------------------------------------
    await t.test("5.1 Audit HMAC unambiguous canonical serialization and multi-position truncation", () => {
      // Create 5 audit events with colon characters in details and action names
      const events: any[] = [];
      for (let i = 1; i <= 5; i++) {
        const ev = obsService.appendAuditEvent({
          ctx: flash1Ctx,
          sourceGateway: "local",
          principalType: "agent",
          principalId: "flash-01",
          credentialId: "cred_01",
          eventCategory: "task",
          actionName: `company_claim_task:step_${i}`,
          targetResource: `task:task_test:${i}`,
          outcome: "succeeded",
          errorCode: null,
          sanitizedDetails: { note: `step:${i}:with:colons:and"quotes"`, count: i }
        });
        events.push(ev);
      }

      // Initial integrity verification passes
      const verifyInitial = obsService.verifyAuditChainIntegrity();
      assert.equal(verifyInitial.valid, true);
      assert.equal(verifyInitial.totalEvents, 5);

      // Verify anchor file exists and has 5 anchor records
      assert.equal(fs.existsSync(ctx.anchorPath), true);
      const anchorContent = fs.readFileSync(ctx.anchorPath, "utf8");
      const anchorLines = anchorContent.split("\n").filter((l) => l.trim().length > 0);
      assert.equal(anchorLines.length, 5);

      // Drop DB triggers to simulate out-of-band tampering / corruption drills
      conn.withWriteTransaction((db) => {
        db.exec("DROP TRIGGER IF EXISTS trg_audit_events_no_update; DROP TRIGGER IF EXISTS trg_audit_events_no_delete;");
      });

      // 1. Test Middle Truncation: Delete event 3 (middle of chain)
      conn.withWriteTransaction((db) => {
        db.prepare("DELETE FROM audit_events WHERE audit_id = ?").run(events[2].audit_id);
      });
      const verifyMiddleTruncation = obsService.verifyAuditChainIntegrity();
      assert.equal(verifyMiddleTruncation.valid, false, "Middle truncation must be detected");

      // Restore event 3
      conn.withWriteTransaction((db) => {
        const ev3 = events[2];
        db.prepare(`
          INSERT INTO audit_events (
            audit_id, event_id, request_id, source_gateway, principal_type, principal_id, credential_id,
            event_category, action_name, target_resource, outcome, error_code,
            sanitized_details_json, prev_event_hash, event_hash_sha256, event_hash_hmac_sha256, recorded_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          ev3.audit_id, ev3.event_id, ev3.request_id, ev3.source_gateway, ev3.principal_type, ev3.principal_id,
          ev3.credential_id, ev3.event_category, ev3.action_name, ev3.target_resource, ev3.outcome,
          ev3.error_code, JSON.stringify({ note: `step:3:with:colons:and"quotes"`, count: 3 }),
          ev3.prev_event_hash, ev3.event_hash_hmac_sha256, ev3.event_hash_hmac_sha256, ev3.recorded_at
        );
      });

      // 2. Test Tail Truncation: Delete event 5 (tail of chain)
      conn.withWriteTransaction((db) => {
        db.prepare("DELETE FROM audit_events WHERE audit_id = ?").run(events[4].audit_id);
      });
      const verifyTailTruncation = obsService.verifyAuditChainIntegrity();
      assert.equal(verifyTailTruncation.valid, false, "Tail truncation after anchor must be detected");
      assert.match(
        String(verifyTailTruncation.brokenAtEventId),
        /TAIL_TRUNCATION_DETECTED|anchor_rollback_detected/,
        "Must flag tail truncation or anchor rollback"
      );

      // 3. Test Head Truncation: Delete event 1 (head of chain)
      conn.withWriteTransaction((db) => {
        db.prepare("DELETE FROM audit_events WHERE audit_id = ?").run(events[0].audit_id);
      });
      const verifyHeadTruncation = obsService.verifyAuditChainIntegrity();
      assert.equal(verifyHeadTruncation.valid, false, "Head truncation must be detected");

      // 4. Test Complete Table Truncation while anchor file exists
      conn.withWriteTransaction((db) => {
        db.exec("DELETE FROM audit_events");
      });
      const verifyTotalTruncation = obsService.verifyAuditChainIntegrity();
      assert.equal(verifyTotalTruncation.valid, false);
      assert.equal(verifyTotalTruncation.brokenAtEventId, "AUDIT_LOG_MISSING_OR_TRUNCATED");
    });

    // ------------------------------------------------------------------------
    // Part 6: Git Working Tree Content & History Secret Scanning
    // ------------------------------------------------------------------------
    await t.test("6.1 Full divergence and working tree secret scanning", () => {
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

        // Commit a secret: sk-12345678901234567890abcdef
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

        // 1. Full branch divergence scan: catches secret deleted 56 commits ago
        const scanRes = gitService.scanCommitFiles(tempRepoDir, headSha, { baseRef: "master" });
        assert.equal(scanRes.valid, false, "Historical deleted secret 56 commits ago MUST be detected");
        assert.ok(scanRes.secretPattern, "Must report secretPattern matched");

        // 2. Untracked file secret detection (even in plain .txt file without sensitive extension)
        const untrackedTxtPath = path.join(tempRepoDir, "notes.txt");
        fs.writeFileSync(untrackedTxtPath, "Here is an untracked OpenAI key: sk-proj-12345678901234567890abcdef");
        const scanUntrackedTxt = gitService.scanCommitFiles(tempRepoDir, headSha, { baseRef: "master" });
        assert.equal(scanUntrackedTxt.valid, false, "Untracked .txt file containing secret MUST be rejected");
        assert.ok(scanUntrackedTxt.forbiddenFiles.includes("notes.txt"), "notes.txt must be listed in forbiddenFiles");
        fs.unlinkSync(untrackedTxtPath);

        // 3. Modified tracked file containing secret
        fs.writeFileSync(path.join(tempRepoDir, "file_55.txt"), "Modified with aico token: aico_live_secrettoken1234567890");
        const scanModified = gitService.scanCommitFiles(tempRepoDir, headSha, { baseRef: "master" });
        assert.equal(scanModified.valid, false, "Modified file containing secret MUST be rejected");
        assert.ok(scanModified.forbiddenFiles.includes("file_55.txt") || scanModified.secretPattern);
        execFileSync("git", ["checkout", "file_55.txt"], { cwd: tempRepoDir });

        // 4. Untracked forbidden file (.env) rejection
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
