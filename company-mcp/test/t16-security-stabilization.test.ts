import test from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import * as crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import { createSandboxTestContext, issueTestPrincipalContext } from "./helpers/test-context.js";
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

  const founderCtx = issueTestPrincipalContext(idService, "founder-01", ["*"]);
  const flash1Ctx = issueTestPrincipalContext(idService, "flash-01", [
    "company:read",
    "tasks:manage",
    "tasks:transition",
    "tasks:review",
    "approvals:request",
    "workspace:read:self",
    "workspace:write:self"
  ]);
  const flash2Ctx = issueTestPrincipalContext(idService, "flash-02", [
    "company:read",
    "tasks:claim",
    "tasks:transition",
    "tasks:review",
    "tasks:read:assigned",
    "tasks:update:assigned"
  ]);
  const codexCtx = issueTestPrincipalContext(idService, "codex-01", [
    "company:read",
    "tasks:claim",
    "tasks:transition",
    "tasks:submit",
    "tasks:read:assigned",
    "tasks:update:assigned"
  ]);

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

    await t.test("1.5 P2 Lone surrogate rejection in strings and object keys", () => {
      // Lone high surrogate in string
      assert.throws(
        () => rfc8785Canonicalize("lone_high_\uD800_end"),
        /Lone surrogate code point detected in string/
      );

      // Lone low surrogate in string
      assert.throws(
        () => rfc8785Canonicalize("lone_low_\uDFFF_end"),
        /Lone surrogate code point detected in string/
      );

      // Lone surrogate in object key
      assert.throws(
        () => rfc8785Canonicalize({ ["invalid_\uD800_key"]: "value" }),
        /Lone surrogate code point detected in object key/
      );

      // Valid surrogate pair succeeds
      const validSurrogatePair = "\uD83D\uDE00"; // 😀
      assert.doesNotThrow(() => rfc8785Canonicalize(validSurrogatePair));
      assert.equal(rfc8785Canonicalize({ emoji: validSurrogatePair }), '{"emoji":"😀"}');
    });

    await t.test("1.6 P2 Unified undefined in array policy: holes serialize as null, explicit undefined rejected", () => {
      // 1. Sparse array with holes: holes (!(i in data)) serialize to null
      const sparseArr = [10, , 30];
      assert.equal(rfc8785Canonicalize(sparseArr), "[10,null,30]");

      // 2. Explicit undefined in array: rejected outside JSON data model
      assert.throws(
        () => rfc8785Canonicalize([10, undefined, 30]),
        /Element at index 1 is undefined, which is outside JSON data model/
      );
      assert.throws(
        () => rfc8785Canonicalize([undefined]),
        /Element at index 0 is undefined, which is outside JSON data model/
      );

      // 3. Explicit null in array: valid JSON data model
      assert.equal(rfc8785Canonicalize([10, null, 30]), "[10,null,30]");
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

      // Requirement 3: decideApproval with ctx authenticated=false
      assert.throws(
        () => appService.decideApproval({
          ctx: { authenticated: false, principalId: "founder-01", principalType: "human" } as any,
          approval_id: apprFounder.approval_id,
          decision: "approved"
        }),
        /AUTHENTICATION_REQUIRED.*ctx\.authenticated must be true/
      );

      // Requirement 4: decideApproval with ctx missing authenticated
      assert.throws(
        () => appService.decideApproval({
          ctx: { principalId: "founder-01", principalType: "human" } as any,
          approval_id: apprFounder.approval_id,
          decision: "approved"
        }),
        /AUTHENTICATION_REQUIRED.*ctx\.authenticated must be true/
      );

      // Malformed context: empty principalId or invalid principalType
      assert.throws(
        () => appService.decideApproval({
          ctx: { authenticated: true, principalId: "", principalType: "human" } as any,
          approval_id: apprFounder.approval_id,
          decision: "approved"
        }),
        /AUTHENTICATION_REQUIRED.*Valid principalId is required/
      );
      assert.throws(
        () => appService.decideApproval({
          ctx: { authenticated: true, principalId: "founder-01", principalType: "invalid_type" } as any,
          approval_id: apprFounder.approval_id,
          decision: "approved"
        }),
        /AUTHENTICATION_REQUIRED.*Valid principalType/
      );
    });

    await t.test("2.4 P1-02 Approval target binding — expectedTargetAgentId & expectedTargetResource negative tests", () => {
      // Create approval specifically bound to target_agent_id = 'argon-01' and target_resource = 'task:target_01'
      const apprTargeted = appService.createApprovalRequest({
        ctx: flash1Ctx,
        action_type: "argon_invocation",
        target_agent_id: "argon-01",
        target_resource: "task:target_01",
        canonical_payload: { taskId: "task_target_01", target: "argon-01" },
        approval_tier: "founder"
      });
      appService.decideApproval({ ctx: founderCtx, approval_id: apprTargeted.approval_id, decision: "approved" });

      // 1. Target Agent Mismatch: consumer expects argon-02
      const resMismatchAgent = appService.consumeApproval({
        approvalId: apprTargeted.approval_id,
        expectedActionType: "argon_invocation",
        expectedTargetAgentId: "argon-02",
        canonicalPayload: { taskId: "task_target_01", target: "argon-01" }
      });
      assert.equal(resMismatchAgent.valid, false);
      assert.match(resMismatchAgent.error!, /TARGET_AGENT_MISMATCH/);

      // 2. Null Target Bypass Prevention: Create approval with target_agent_id = null
      const apprNullTarget = appService.createApprovalRequest({
        ctx: flash1Ctx,
        action_type: "argon_invocation",
        target_agent_id: null as any,
        target_resource: "task:target_01",
        canonical_payload: { taskId: "task_target_01", bypass: true },
        approval_tier: "founder"
      });
      appService.decideApproval({ ctx: founderCtx, approval_id: apprNullTarget.approval_id, decision: "approved" });

      // Consumer specifies expectedTargetAgentId: 'argon-01', but approval record has target_agent_id: null
      const resNullTargetBypass = appService.consumeApproval({
        approvalId: apprNullTarget.approval_id,
        expectedActionType: "argon_invocation",
        expectedTargetAgentId: "argon-01",
        canonicalPayload: { taskId: "task_target_01", bypass: true }
      });
      assert.equal(resNullTargetBypass.valid, false, "Null target in approval record MUST NOT bypass expectedTargetAgentId");
      assert.match(resNullTargetBypass.error!, /TARGET_AGENT_MISMATCH/);

      // 3. Target Resource Mismatch: consumer expects task:target_different
      const resMismatchResource = appService.consumeApproval({
        approvalId: apprTargeted.approval_id,
        expectedActionType: "argon_invocation",
        expectedTargetAgentId: "argon-01",
        expectedTargetResource: "task:target_different",
        canonicalPayload: { taskId: "task_target_01", target: "argon-01" }
      });
      assert.equal(resMismatchResource.valid, false);
      assert.match(resMismatchResource.error!, /TARGET_RESOURCE_MISMATCH/);

      // 4. Exact target agent and resource match succeeds
      const resExactMatch = appService.consumeApproval({
        approvalId: apprTargeted.approval_id,
        expectedActionType: "argon_invocation",
        expectedTargetAgentId: "argon-01",
        expectedTargetResource: "task:target_01",
        canonicalPayload: { taskId: "task_target_01", target: "argon-01" }
      });
      assert.equal(resExactMatch.valid, true);
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
        target_agent_id: critTask.assigned_agent_id || undefined,
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

    await t.test("3.3 P1-03 Task authentication: direct service call without authenticated context rejected", () => {
      const tAuth = taskService.createTask({
        ctx: flash1Ctx,
        title: "Auth Test Task",
        assignedAgentId: "codex-01"
      });

      // 1. Missing ctx throws AUTHENTICATION_REQUIRED (no fallback to founder-01!)
      assert.throws(
        () => (taskService as any).transitionTask({ taskId: tAuth.task_id, expectedVersion: 1, toStatus: "queued" }),
        /AUTHENTICATION_REQUIRED: transitionTask requires an authenticated PrincipalContext/
      );

      // 2. Unauthenticated ctx throws AUTHENTICATION_REQUIRED
      assert.throws(
        () => taskService.transitionTask({
          ctx: { authenticated: false, principalId: "unknown", principalType: "agent" } as any,
          taskId: tAuth.task_id,
          expectedVersion: 1,
          toStatus: "queued"
        }),
        /AUTHENTICATION_REQUIRED: transitionTask requires an authenticated PrincipalContext/
      );

      // 3. Empty principalId throws AUTHENTICATION_REQUIRED
      assert.throws(
        () => taskService.transitionTask({
          ctx: { authenticated: true, principalId: "", principalType: "agent" } as any,
          taskId: tAuth.task_id,
          expectedVersion: 1,
          toStatus: "queued"
        }),
        /AUTHENTICATION_REQUIRED: transitionTask requires an authenticated PrincipalContext/
      );

      // 4. Direct call to reviewTask without ctx throws AUTHENTICATION_REQUIRED
      assert.throws(
        () => (taskService as any).reviewTask({ taskId: tAuth.task_id, decision: "completed" }),
        /AUTHENTICATION_REQUIRED: reviewTask requires an authenticated PrincipalContext/
      );

      // Requirement 1: reviewTask with reviewerId but without ctx throws AUTHENTICATION_REQUIRED
      assert.throws(
        () => (taskService as any).reviewTask({ reviewerId: "flash-01", taskId: tAuth.task_id, decision: "completed" }),
        /AUTHENTICATION_REQUIRED: reviewTask requires an authenticated PrincipalContext/
      );

      // Requirement 2: reviewTask with ctx authenticated=false throws AUTHENTICATION_REQUIRED
      assert.throws(
        () => taskService.reviewTask({
          ctx: { authenticated: false, principalId: "flash-01", principalType: "agent" } as any,
          taskId: tAuth.task_id,
          decision: "completed"
        }),
        /AUTHENTICATION_REQUIRED.*ctx\.authenticated must be true/
      );

      // Malformed reviewTask context: empty principalId or invalid principalType
      assert.throws(
        () => taskService.reviewTask({
          ctx: { authenticated: true, principalId: "", principalType: "agent" } as any,
          taskId: tAuth.task_id,
          decision: "completed"
        }),
        /AUTHENTICATION_REQUIRED.*valid principalId/
      );
      assert.throws(
        () => taskService.reviewTask({
          ctx: { authenticated: true, principalId: "flash-01", principalType: "system" } as any,
          taskId: tAuth.task_id,
          decision: "completed"
        }),
        /AUTHENTICATION_REQUIRED.*valid principalType/
      );
    });

    await t.test("3.4 P1-04 Reviewer authorization: null reviewer_agent_id requires executive leadership", () => {
      // Create task with NO designated reviewer (reviewer_agent_id = null)
      const tNoReviewer = taskService.createTask({
        ctx: flash1Ctx,
        title: "Unassigned Reviewer Task",
        assignedAgentId: "codex-01"
        // reviewerAgentId is omitted -> NULL
      });

      // Advance task: draft -> queued -> assigned -> claimed -> in_progress -> review_required
      taskService.transitionTask({ ctx: flash1Ctx, taskId: tNoReviewer.task_id, expectedVersion: 1, toStatus: "queued" });
      taskService.transitionTask({ ctx: flash1Ctx, taskId: tNoReviewer.task_id, expectedVersion: 2, toStatus: "assigned" });
      taskService.transitionTask({ ctx: codexCtx, taskId: tNoReviewer.task_id, expectedVersion: 3, toStatus: "claimed" });
      taskService.transitionTask({ ctx: codexCtx, taskId: tNoReviewer.task_id, expectedVersion: 4, toStatus: "in_progress" });
      taskService.transitionTask({ ctx: codexCtx, taskId: tNoReviewer.task_id, expectedVersion: 5, toStatus: "review_required" });

      // 1. Anti-self-approval: Assigned agent codex-01 cannot approve
      assert.throws(
        () => taskService.transitionTask({ ctx: codexCtx, taskId: tNoReviewer.task_id, expectedVersion: 6, toStatus: "completed" }),
        /Agent cannot approve own task as completed/
      );

      // 2. Non-executive agent (other-engineer-01) cannot approve task with null reviewer
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
        () => taskService.transitionTask({ ctx: otherEngineerCtx, taskId: tNoReviewer.task_id, expectedVersion: 6, toStatus: "completed" }),
        /Tasks without designated reviewer can only be approved by executive leadership/
      );

      // 3. Executive leadership (flash-01 or founder-01) CAN approve task with null reviewer
      const compByExec = taskService.transitionTask({ ctx: flash1Ctx, taskId: tNoReviewer.task_id, expectedVersion: 6, toStatus: "completed" });
      assert.equal(compByExec.execution_status, "completed");
    });

    await t.test("3.5 P1-03 End-to-end task execution target binding in transitionTask", () => {
      // Create Argon task (Argon tasks strictly start in waiting_approval, version 1)
      const argonTask = taskService.createTask({
        ctx: flash1Ctx,
        title: "Argon Security Audit",
        assignedAgentId: "argon-01",
        riskClass: "critical",
        priority: "P0"
      });
      assert.equal(argonTask.execution_status, "waiting_approval");

      // Requirement 5: Task execution with approval having WRONG TARGET AGENT (argon-02 instead of argon-01)
      const wrongAgentAppr = appService.createApprovalRequest({
        ctx: flash1Ctx,
        action_type: "argon_invocation",
        target_agent_id: "argon-02", // Task assigned to argon-01!
        target_resource: `task:${argonTask.task_id}`,
        canonical_payload: { taskId: argonTask.task_id, targetAgentId: "argon-01" },
        approval_tier: "founder"
      });
      appService.decideApproval({ ctx: founderCtx, approval_id: wrongAgentAppr.approval_id, decision: "approved" });

      assert.throws(
        () => taskService.transitionTask({
          ctx: flash1Ctx,
          taskId: argonTask.task_id,
          expectedVersion: 1,
          toStatus: "queued",
          approvalId: wrongAgentAppr.approval_id
        }),
        /TARGET_AGENT_MISMATCH/
      );

      // Requirement 6: Task execution with approval having WRONG TARGET RESOURCE
      const wrongResourceAppr = appService.createApprovalRequest({
        ctx: flash1Ctx,
        action_type: "argon_invocation",
        target_agent_id: "argon-01",
        target_resource: "task:different_task_999", // Mismatched resource!
        canonical_payload: { taskId: argonTask.task_id, targetAgentId: "argon-01" },
        approval_tier: "founder"
      });
      appService.decideApproval({ ctx: founderCtx, approval_id: wrongResourceAppr.approval_id, decision: "approved" });

      assert.throws(
        () => taskService.transitionTask({
          ctx: flash1Ctx,
          taskId: argonTask.task_id,
          expectedVersion: 1,
          toStatus: "queued",
          approvalId: wrongResourceAppr.approval_id
        }),
        /TARGET_RESOURCE_MISMATCH/
      );

      // Exact match approval succeeds: moves waiting_approval -> queued
      const exactAppr = appService.createApprovalRequest({
        ctx: flash1Ctx,
        action_type: "argon_invocation",
        target_agent_id: "argon-01",
        target_resource: `task:${argonTask.task_id}`,
        canonical_payload: { taskId: argonTask.task_id, targetAgentId: "argon-01" },
        approval_tier: "founder"
      });
      appService.decideApproval({ ctx: founderCtx, approval_id: exactAppr.approval_id, decision: "approved" });

      const queued = taskService.transitionTask({
        ctx: flash1Ctx,
        taskId: argonTask.task_id,
        expectedVersion: 1,
        toStatus: "queued",
        approvalId: exactAppr.approval_id
      });
      assert.equal(queued.execution_status, "queued");
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

      const refreshedNorm = taskService.getTask(tNorm.task_id, flash1Ctx)!;
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
      const blockedTask = taskService.getTask(tNorm.task_id, flash1Ctx)!;
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
      const refreshedArgon = taskService.getTask(tArgon.task_id, flash1Ctx)!;
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
        /TAIL_TRUNCATION_DETECTED|anchor_rollback_detected|ANCHOR_COVERAGE_EXCESS/,
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

    await t.test("5.2 P1-01 Audit Anchor: DB tail matching, unanchored event detection, failure injection & reconciliation", () => {
      // Create fresh anchor path for this test
      const freshAnchorPath = path.join(os.tmpdir(), `aico-anchor-drill-${Date.now()}.jsonl`);
      const drillObs = new ObservabilityQuotaService(conn, "test_hmac_secret_key_v221_32bytes_long", freshAnchorPath);

      // Drop DB triggers to simulate failure/tampering injection
      conn.withWriteTransaction((db) => {
        db.exec("DROP TRIGGER IF EXISTS trg_audit_events_no_update; DROP TRIGGER IF EXISTS trg_audit_events_no_delete;");
        db.exec("DELETE FROM audit_events;");
      });

      // 1. Append 3 legitimate audit events
      const ev1 = drillObs.appendAuditEvent({
        ctx: flash1Ctx,
        sourceGateway: "local",
        principalType: "agent",
        principalId: "flash-01",
        credentialId: "cred_01",
        eventCategory: "task",
        actionName: "drill_event_1",
        targetResource: "res:1",
        outcome: "succeeded",
        errorCode: null,
        sanitizedDetails: { n: 1 }
      });
      const ev2 = drillObs.appendAuditEvent({
        ctx: flash1Ctx,
        sourceGateway: "local",
        principalType: "agent",
        principalId: "flash-01",
        credentialId: "cred_01",
        eventCategory: "task",
        actionName: "drill_event_2",
        targetResource: "res:2",
        outcome: "succeeded",
        errorCode: null,
        sanitizedDetails: { n: 2 }
      });
      const ev3 = drillObs.appendAuditEvent({
        ctx: flash1Ctx,
        sourceGateway: "local",
        principalType: "agent",
        principalId: "flash-01",
        credentialId: "cred_01",
        eventCategory: "task",
        actionName: "drill_event_3",
        targetResource: "res:3",
        outcome: "succeeded",
        errorCode: null,
        sanitizedDetails: { n: 3 }
      });

      // Integrity check passes initially
      const initCheck = drillObs.verifyAuditChainIntegrity();
      assert.equal(initCheck.valid, true);

      // 2. FAILURE INJECTION: Simulate failure between DB commit and anchor write
      // Remove the last anchor record (event 3) from anchor file, leaving event 3 in DB unanchored
      const anchorContent = fs.readFileSync(freshAnchorPath, "utf8");
      const lines = anchorContent.split("\n").filter((l) => l.trim().length > 0);
      assert.equal(lines.length, 3);
      // Keep only first 2 anchor lines
      fs.writeFileSync(freshAnchorPath, lines.slice(0, 2).join("\n") + "\n", "utf8");

      // 3. Verification MUST detect unanchored event at DB tail!
      const unanchoredCheck = drillObs.verifyAuditChainIntegrity();
      assert.equal(unanchoredCheck.valid, false, "Must detect that DB tail is ahead of latest anchor");
      assert.match(String(unanchoredCheck.brokenAtEventId), /ANCHOR_COVERAGE_DEFICIT|UNANCHORED_DB_EVENTS_DETECTED/);

      // 4. In Phase 0.2: Safe reconciliation MUST REFUSE automatic tail recovery without independent evidence!
      const dbCountBeforeRec = (conn.withReadTransaction((db) => db.prepare("SELECT COUNT(*) as c FROM audit_events").get()) as any).c;
      const anchorContentBeforeRec = fs.readFileSync(freshAnchorPath, "utf8");

      assert.throws(
        () => drillObs.reconcileUnanchoredEvents(),
        /SAFE_RECONCILIATION_REFUSED: ANCHOR_RECOVERY_REQUIRES_FOUNDER_REVIEW/
      );

      // Invariants: 0 DB rows modified, 0 anchor bytes modified, no silent reconstruction
      const dbCountAfterRec = (conn.withReadTransaction((db) => db.prepare("SELECT COUNT(*) as c FROM audit_events").get()) as any).c;
      assert.equal(dbCountAfterRec, dbCountBeforeRec, "0 DB rows modified");
      assert.equal(fs.readFileSync(freshAnchorPath, "utf8"), anchorContentBeforeRec, "0 anchor bytes modified");

      // Verification remains fail-closed
      const stillFailingCheck = drillObs.verifyAuditChainIntegrity();
      assert.equal(stillFailingCheck.valid, false, "Integrity verification must remain fail-closed without independent evidence");
      assert.match(String(stillFailingCheck.brokenAtEventId), /ANCHOR_COVERAGE_DEFICIT/);

      // Clean up temp anchor file
      if (fs.existsSync(freshAnchorPath)) {
        fs.unlinkSync(freshAnchorPath);
      }
    });

    // Requirement 7: Xóa anchor ở giữa file (Middle anchor deletion detected)
    await t.test("5.3 P1-04 Coverage verification: middle anchor deletion detection", () => {
      const middleAnchorPath = path.join(os.tmpdir(), `aico-anchor-mid-${Date.now()}.jsonl`);
      const obsMid = new ObservabilityQuotaService(conn, "test_hmac_secret_key_v221_32bytes_long", middleAnchorPath);

      // Clean DB table for clean test environment
      conn.withWriteTransaction((db: any) => {
        db.exec("DELETE FROM audit_events;");
      });

      // Insert 3 audit events
      for (let i = 1; i <= 3; i++) {
        obsMid.appendAuditEvent({
          ctx: flash1Ctx,
          sourceGateway: "local",
          principalType: "agent",
          principalId: "flash-01",
          credentialId: "cred_01",
          eventCategory: "task",
          actionName: `mid_event_${i}`,
          targetResource: `res:${i}`,
          outcome: "succeeded",
          errorCode: null,
          sanitizedDetails: { step: i }
        });
      }

      // Initial integrity check passes
      assert.equal(obsMid.verifyAuditChainIntegrity().valid, true);

      // Delete the middle anchor line (line 2 of 3)
      const content = fs.readFileSync(middleAnchorPath, "utf8");
      const lines = content.split(/\r?\n/).filter(l => l.trim().length > 0);
      assert.equal(lines.length, 3);
      // Write lines [0, 2] omitting line 1
      fs.writeFileSync(middleAnchorPath, lines[0] + "\n" + lines[2] + "\n", "utf8");

      // Verification MUST detect missing middle anchor (coverage deficit or sequence mismatch)
      const midCheck = obsMid.verifyAuditChainIntegrity();
      assert.equal(midCheck.valid, false, "Must detect middle anchor deletion");
      assert.match(String(midCheck.brokenAtEventId), /ANCHOR_COVERAGE_DEFICIT|ANCHOR_SEQUENCE_MISMATCH/);

      if (fs.existsSync(middleAnchorPath)) fs.unlinkSync(middleAnchorPath);
    });

    // Requirement 8: Anchor duplicate / reordered / malformed records detected
    await t.test("5.4 P1-04 Anchor duplicate, reordered, and malformed records detected", () => {
      const dupAnchorPath = path.join(os.tmpdir(), `aico-anchor-dup-${Date.now()}.jsonl`);
      const obsDup = new ObservabilityQuotaService(conn, "test_hmac_secret_key_v221_32bytes_long", dupAnchorPath);

      conn.withWriteTransaction((db: any) => {
        db.exec("DELETE FROM audit_events;");
      });

      for (let i = 1; i <= 3; i++) {
        obsDup.appendAuditEvent({
          ctx: flash1Ctx,
          sourceGateway: "local",
          principalType: "agent",
          principalId: "flash-01",
          credentialId: "cred_01",
          eventCategory: "task",
          actionName: `dup_event_${i}`,
          targetResource: `res:${i}`,
          outcome: "succeeded",
          errorCode: null,
          sanitizedDetails: { step: i }
        });
      }

      const validContent = fs.readFileSync(dupAnchorPath, "utf8");
      const lines = validContent.split(/\r?\n/).filter(l => l.trim().length > 0);
      assert.equal(lines.length, 3);

      // 8a. Malformed JSON line
      fs.writeFileSync(dupAnchorPath, lines[0] + "\n{corrupt_json_line\n" + lines[2] + "\n", "utf8");
      const malformedCheck = obsDup.verifyAuditChainIntegrity();
      assert.equal(malformedCheck.valid, false);
      assert.match(String(malformedCheck.brokenAtEventId), /MALFORMED_ANCHOR_RECORD/);

      // 8b. Duplicate anchor line [lines[0], lines[1], lines[1], lines[2]]
      fs.writeFileSync(dupAnchorPath, lines[0] + "\n" + lines[1] + "\n" + lines[1] + "\n" + lines[2] + "\n", "utf8");
      const duplicateCheck = obsDup.verifyAuditChainIntegrity();
      assert.equal(duplicateCheck.valid, false);
      assert.match(String(duplicateCheck.brokenAtEventId), /ANCHOR_COVERAGE_EXCESS|DUPLICATE_OR_REORDERED_ANCHOR/);

      // 8c. Reordered anchor lines [lines[1], lines[0], lines[2]]
      fs.writeFileSync(dupAnchorPath, lines[1] + "\n" + lines[0] + "\n" + lines[2] + "\n", "utf8");
      const reorderedCheck = obsDup.verifyAuditChainIntegrity();
      assert.equal(reorderedCheck.valid, false);
      assert.match(String(reorderedCheck.brokenAtEventId), /DUPLICATE_OR_REORDERED_ANCHOR|ANCHOR_SEQUENCE_MISMATCH/);

      if (fs.existsSync(dupAnchorPath)) fs.unlinkSync(dupAnchorPath);
    });

    // Requirement 9: Reconcile trên HMAC chain bị sửa (Refuses to reconcile tampered DB)
    await t.test("5.5 P1-05 Safe reconciliation refuses to reconcile on tampered HMAC chain", () => {
      const tamperAnchorPath = path.join(os.tmpdir(), `aico-anchor-tamper-${Date.now()}.jsonl`);
      const obsTamper = new ObservabilityQuotaService(conn, "test_hmac_secret_key_v221_32bytes_long", tamperAnchorPath);

      conn.withWriteTransaction((db: any) => {
        db.exec("DELETE FROM audit_events;");
      });

      for (let i = 1; i <= 3; i++) {
        obsTamper.appendAuditEvent({
          ctx: flash1Ctx,
          sourceGateway: "local",
          principalType: "agent",
          principalId: "flash-01",
          credentialId: "cred_01",
          eventCategory: "task",
          actionName: `tamper_event_${i}`,
          targetResource: `res:${i}`,
          outcome: "succeeded",
          errorCode: null,
          sanitizedDetails: { step: i }
        });
      }

      // Tamper DB row for event 2
      conn.withWriteTransaction((db: any) => {
        db.prepare("UPDATE audit_events SET target_resource = 'tampered:res' WHERE audit_id = (SELECT MAX(audit_id) - 1 FROM audit_events)").run();
      });

      // Safe reconciliation MUST refuse to run and throw fail-closed
      assert.throws(
        () => obsTamper.reconcileUnanchoredEvents(),
        /SAFE_RECONCILIATION_REFUSED: Database HMAC/
      );

      if (fs.existsSync(tamperAnchorPath)) fs.unlinkSync(tamperAnchorPath);
    });

    // Requirement 10: Reconcile khi anchor file bị hỏng (Refuses to reconcile when anchor file is corrupted)
    await t.test("5.6 P1-05 Safe reconciliation refuses to reconcile when anchor file is corrupted", () => {
      const corruptAnchorPath = path.join(os.tmpdir(), `aico-anchor-corrupt-${Date.now()}.jsonl`);
      const obsCorrupt = new ObservabilityQuotaService(conn, "test_hmac_secret_key_v221_32bytes_long", corruptAnchorPath);

      conn.withWriteTransaction((db: any) => {
        db.exec("DELETE FROM audit_events;");
      });

      for (let i = 1; i <= 3; i++) {
        obsCorrupt.appendAuditEvent({
          ctx: flash1Ctx,
          sourceGateway: "local",
          principalType: "agent",
          principalId: "flash-01",
          credentialId: "cred_01",
          eventCategory: "task",
          actionName: `corrupt_event_${i}`,
          targetResource: `res:${i}`,
          outcome: "succeeded",
          errorCode: null,
          sanitizedDetails: { step: i }
        });
      }

      // Corrupt anchor file with invalid JSON
      fs.appendFileSync(corruptAnchorPath, "\n{invalid_json_garbage_data\n", "utf8");

      // Safe reconciliation MUST refuse to run and throw fail-closed
      assert.throws(
        () => obsCorrupt.reconcileUnanchoredEvents(),
        /SAFE_RECONCILIATION_REFUSED: Malformed anchor/
      );

      if (fs.existsSync(corruptAnchorPath)) fs.unlinkSync(corruptAnchorPath);
    });

    // ------------------------------------------------------------------------
    // Part 5.7: Phase 0.2 Required Regression Tests (Scenarios 1-10)
    // ------------------------------------------------------------------------
    await t.test("5.7 Phase 0.2 Required Regression Tests (Scenarios 1-10)", async () => {
      const hmacKey = "test_hmac_secret_key_v221_32bytes_long";

      // Helper to populate N valid audit events
      const populateAuditEvents = (obs: ObservabilityQuotaService, count: number, prefix: string) => {
        conn.withWriteTransaction((db: any) => {
          db.exec("DELETE FROM audit_events;");
          db.prepare("DELETE FROM sqlite_sequence WHERE name = 'audit_events'").run();
        });
        const events: any[] = [];
        for (let i = 1; i <= count; i++) {
          const ev = obs.appendAuditEvent({
            ctx: flash1Ctx,
            sourceGateway: "local",
            principalType: "agent",
            principalId: "flash-01",
            credentialId: "cred_01",
            eventCategory: "task",
            actionName: `${prefix}_ev_${i}`,
            targetResource: `res:${i}`,
            outcome: "succeeded",
            errorCode: null,
            sanitizedDetails: { step: i }
          });
          events.push(ev);
        }
        return events;
      };

      // Scenario 1: DB has 3 events, anchor has 2 complete records -> recovery refused (Founder review required)
      {
        const anchorPath = path.join(os.tmpdir(), `aico-p02-scen1-${Date.now()}-${Math.random()}.jsonl`);
        const obs = new ObservabilityQuotaService(conn, hmacKey, anchorPath);
        populateAuditEvents(obs, 3, "scen1");

        // Keep only first 2 complete anchor records
        const allLines = fs.readFileSync(anchorPath, "utf8").split(/\r?\n/).filter(l => l.trim().length > 0);
        assert.equal(allLines.length, 3);
        fs.writeFileSync(anchorPath, allLines[0] + "\n" + allLines[1] + "\n", "utf8");

        const dbBefore = (conn.withReadTransaction((db) => db.prepare("SELECT COUNT(*) as c FROM audit_events").get()) as any).c;
        const anchorBefore = fs.readFileSync(anchorPath, "utf8");

        // Verification must detect deficit
        const vRes = obs.verifyAuditChainIntegrity();
        assert.equal(vRes.valid, false);
        assert.match(String(vRes.brokenAtEventId), /ANCHOR_COVERAGE_DEFICIT/);

        // Reconcile must refuse tail reconstruction and require Founder review
        assert.throws(
          () => obs.reconcileUnanchoredEvents(),
          /SAFE_RECONCILIATION_REFUSED: ANCHOR_RECOVERY_REQUIRES_FOUNDER_REVIEW/
        );

        // Invariants
        const dbAfter = (conn.withReadTransaction((db) => db.prepare("SELECT COUNT(*) as c FROM audit_events").get()) as any).c;
        assert.equal(dbAfter, dbBefore, "0 DB rows modified");
        assert.equal(fs.readFileSync(anchorPath, "utf8"), anchorBefore, "0 anchor bytes modified");
        assert.equal(obs.verifyAuditChainIntegrity().valid, false, "Verification must remain fail-closed");

        if (fs.existsSync(anchorPath)) fs.unlinkSync(anchorPath);
      }

      // Scenario 2: DB has 3 events, anchor only has 1 complete record -> recovery refused (Founder review required)
      {
        const anchorPath = path.join(os.tmpdir(), `aico-p02-scen2-${Date.now()}-${Math.random()}.jsonl`);
        const obs = new ObservabilityQuotaService(conn, hmacKey, anchorPath);
        populateAuditEvents(obs, 3, "scen2");

        // Keep only 1st anchor record
        const allLines = fs.readFileSync(anchorPath, "utf8").split(/\r?\n/).filter(l => l.trim().length > 0);
        assert.equal(allLines.length, 3);
        fs.writeFileSync(anchorPath, allLines[0] + "\n", "utf8");

        const dbBefore = (conn.withReadTransaction((db) => db.prepare("SELECT COUNT(*) as c FROM audit_events").get()) as any).c;
        const anchorBefore = fs.readFileSync(anchorPath, "utf8");

        // Verification fails closed
        const vRes = obs.verifyAuditChainIntegrity();
        assert.equal(vRes.valid, false);
        assert.match(String(vRes.brokenAtEventId), /ANCHOR_COVERAGE_DEFICIT/);

        // Reconcile refused
        assert.throws(
          () => obs.reconcileUnanchoredEvents(),
          /SAFE_RECONCILIATION_REFUSED: ANCHOR_RECOVERY_REQUIRES_FOUNDER_REVIEW/
        );

        // Invariants
        const dbAfter = (conn.withReadTransaction((db) => db.prepare("SELECT COUNT(*) as c FROM audit_events").get()) as any).c;
        assert.equal(dbAfter, dbBefore, "0 DB rows modified");
        assert.equal(fs.readFileSync(anchorPath, "utf8"), anchorBefore, "0 anchor bytes modified");
        assert.equal(obs.verifyAuditChainIntegrity().valid, false, "Must remain invalid");

        if (fs.existsSync(anchorPath)) fs.unlinkSync(anchorPath);
      }

      // Scenario 3: DB has 3 events, anchor file completely missing / deleted -> recovery refused
      {
        const anchorPath = path.join(os.tmpdir(), `aico-p02-scen3-${Date.now()}-${Math.random()}.jsonl`);
        const obs = new ObservabilityQuotaService(conn, hmacKey, anchorPath);
        populateAuditEvents(obs, 3, "scen3");

        // Delete entire anchor file
        if (fs.existsSync(anchorPath)) fs.unlinkSync(anchorPath);
        assert.equal(fs.existsSync(anchorPath), false);

        const dbBefore = (conn.withReadTransaction((db) => db.prepare("SELECT COUNT(*) as c FROM audit_events").get()) as any).c;

        // Verification fails closed
        const vRes = obs.verifyAuditChainIntegrity();
        assert.equal(vRes.valid, false);
        assert.equal(vRes.brokenAtEventId, "MISSING_AUDIT_ANCHOR_FILE");

        // Reconcile refused
        assert.throws(
          () => obs.reconcileUnanchoredEvents(),
          /SAFE_RECONCILIATION_REFUSED: Anchor file is completely missing while database contains 3 audit event\(s\)/
        );

        // Invariants
        const dbAfter = (conn.withReadTransaction((db) => db.prepare("SELECT COUNT(*) as c FROM audit_events").get()) as any).c;
        assert.equal(dbAfter, dbBefore, "0 DB rows modified");
        assert.equal(fs.existsSync(anchorPath), false, "Missing anchor file must not be silently recreated");
      }

      // Scenario 4: DB has 3 events, anchor truncated midway through JSON record -> recovery refused
      {
        const anchorPath = path.join(os.tmpdir(), `aico-p02-scen4-${Date.now()}-${Math.random()}.jsonl`);
        const obs = new ObservabilityQuotaService(conn, hmacKey, anchorPath);
        populateAuditEvents(obs, 3, "scen4");

        const allLines = fs.readFileSync(anchorPath, "utf8").split(/\r?\n/).filter(l => l.trim().length > 0);
        const corruptedTail = allLines[0] + "\n" + allLines[1] + "\n{\"last_audit_id\": 3, \"event_hash_sha256\n";
        fs.writeFileSync(anchorPath, corruptedTail, "utf8");

        const dbBefore = (conn.withReadTransaction((db) => db.prepare("SELECT COUNT(*) as c FROM audit_events").get()) as any).c;
        const anchorBefore = fs.readFileSync(anchorPath, "utf8");

        // Verification fails closed
        const vRes = obs.verifyAuditChainIntegrity();
        assert.equal(vRes.valid, false);
        assert.match(String(vRes.brokenAtEventId), /MALFORMED_ANCHOR_RECORD/);

        // Reconcile refused
        assert.throws(
          () => obs.reconcileUnanchoredEvents(),
          /SAFE_RECONCILIATION_REFUSED: Malformed anchor JSON/
        );

        // Invariants
        const dbAfter = (conn.withReadTransaction((db) => db.prepare("SELECT COUNT(*) as c FROM audit_events").get()) as any).c;
        assert.equal(dbAfter, dbBefore, "0 DB rows modified");
        assert.equal(fs.readFileSync(anchorPath, "utf8"), anchorBefore, "0 anchor bytes modified");

        if (fs.existsSync(anchorPath)) fs.unlinkSync(anchorPath);
      }

      // Scenario 5: DB has 3 events, anchor last line content modified (hash mismatch) -> recovery refused
      {
        const anchorPath = path.join(os.tmpdir(), `aico-p02-scen5-${Date.now()}-${Math.random()}.jsonl`);
        const obs = new ObservabilityQuotaService(conn, hmacKey, anchorPath);
        populateAuditEvents(obs, 3, "scen5");

        const allLines = fs.readFileSync(anchorPath, "utf8").split(/\r?\n/).filter(l => l.trim().length > 0);
        const alteredLine3 = JSON.stringify({
          last_audit_id: 3,
          event_hash_sha256: "0000000000000000000000000000000000000000000000000000000000000000",
          recorded_at: new Date().toISOString()
        });
        fs.writeFileSync(anchorPath, allLines[0] + "\n" + allLines[1] + "\n" + alteredLine3 + "\n", "utf8");

        const dbBefore = (conn.withReadTransaction((db) => db.prepare("SELECT COUNT(*) as c FROM audit_events").get()) as any).c;
        const anchorBefore = fs.readFileSync(anchorPath, "utf8");

        // Verification fails closed
        const vRes = obs.verifyAuditChainIntegrity();
        assert.equal(vRes.valid, false);
        assert.match(String(vRes.brokenAtEventId), /ANCHOR_HASH_MISMATCH/);

        // Reconcile refused
        assert.throws(
          () => obs.reconcileUnanchoredEvents(),
          /SAFE_RECONCILIATION_REFUSED: Anchor hash mismatch/
        );

        // Invariants
        const dbAfter = (conn.withReadTransaction((db) => db.prepare("SELECT COUNT(*) as c FROM audit_events").get()) as any).c;
        assert.equal(dbAfter, dbBefore, "0 DB rows modified");
        assert.equal(fs.readFileSync(anchorPath, "utf8"), anchorBefore, "0 anchor bytes modified");

        if (fs.existsSync(anchorPath)) fs.unlinkSync(anchorPath);
      }

      // Scenario 6: DB has 3 events, anchor valid & complete -> verification succeeds, reconcile reports 0 unanchored
      {
        const anchorPath = path.join(os.tmpdir(), `aico-p02-scen6-${Date.now()}-${Math.random()}.jsonl`);
        const obs = new ObservabilityQuotaService(conn, hmacKey, anchorPath);
        populateAuditEvents(obs, 3, "scen6");

        const dbBefore = (conn.withReadTransaction((db) => db.prepare("SELECT COUNT(*) as c FROM audit_events").get()) as any).c;
        const anchorBefore = fs.readFileSync(anchorPath, "utf8");

        // Verification passes 100%
        const vRes = obs.verifyAuditChainIntegrity();
        assert.equal(vRes.valid, true);
        assert.equal(vRes.totalEvents, 3);

        // Reconcile returns 0 reconciled (already in sync)
        const recResult = obs.reconcileUnanchoredEvents();
        assert.equal(recResult.reconciledCount, 0);
        assert.equal(recResult.latestAnchorAuditId, 3);

        // Invariants
        const dbAfter = (conn.withReadTransaction((db) => db.prepare("SELECT COUNT(*) as c FROM audit_events").get()) as any).c;
        assert.equal(dbAfter, dbBefore, "0 DB rows modified");
        assert.equal(fs.readFileSync(anchorPath, "utf8"), anchorBefore, "0 anchor bytes modified");

        if (fs.existsSync(anchorPath)) fs.unlinkSync(anchorPath);
      }

      // Scenario 7: DB has 3 events, HMAC tampered in DB -> recovery refused
      {
        const anchorPath = path.join(os.tmpdir(), `aico-p02-scen7-${Date.now()}-${Math.random()}.jsonl`);
        const obs = new ObservabilityQuotaService(conn, hmacKey, anchorPath);
        populateAuditEvents(obs, 3, "scen7");

        // Tamper DB row 2
        conn.withWriteTransaction((db: any) => {
          db.prepare("UPDATE audit_events SET target_resource = 'tampered:resource' WHERE action_name = 'scen7_ev_2'").run();
        });

        const dbBefore = (conn.withReadTransaction((db) => db.prepare("SELECT COUNT(*) as c FROM audit_events").get()) as any).c;
        const anchorBefore = fs.readFileSync(anchorPath, "utf8");

        // Verification fails closed
        const vRes = obs.verifyAuditChainIntegrity();
        assert.equal(vRes.valid, false);

        // Reconcile refused
        assert.throws(
          () => obs.reconcileUnanchoredEvents(),
          /SAFE_RECONCILIATION_REFUSED: Database HMAC/
        );

        // Invariants
        const dbAfter = (conn.withReadTransaction((db) => db.prepare("SELECT COUNT(*) as c FROM audit_events").get()) as any).c;
        assert.equal(dbAfter, dbBefore, "0 DB rows modified");
        assert.equal(fs.readFileSync(anchorPath, "utf8"), anchorBefore, "0 anchor bytes modified");

        if (fs.existsSync(anchorPath)) fs.unlinkSync(anchorPath);
      }

      // Scenario 8: DB empty, anchor has historical records -> fail-closed
      {
        const anchorPath = path.join(os.tmpdir(), `aico-p02-scen8-${Date.now()}-${Math.random()}.jsonl`);
        const obs = new ObservabilityQuotaService(conn, hmacKey, anchorPath);
        populateAuditEvents(obs, 2, "scen8");

        // Wipe DB rows while leaving anchor file intact
        conn.withWriteTransaction((db: any) => {
          db.exec("DELETE FROM audit_events;");
        });

        const anchorBefore = fs.readFileSync(anchorPath, "utf8");

        // Verification fails closed
        const vRes = obs.verifyAuditChainIntegrity();
        assert.equal(vRes.valid, false);
        assert.equal(vRes.brokenAtEventId, "AUDIT_LOG_MISSING_OR_TRUNCATED");

        // Reconcile refused
        assert.throws(
          () => obs.reconcileUnanchoredEvents(),
          /SAFE_RECONCILIATION_REFUSED: Database has 0 events but historical anchor file contains/
        );

        // Invariants
        const dbCount = (conn.withReadTransaction((db) => db.prepare("SELECT COUNT(*) as c FROM audit_events").get()) as any).c;
        assert.equal(dbCount, 0, "DB remains empty");
        assert.equal(fs.readFileSync(anchorPath, "utf8"), anchorBefore, "0 anchor bytes modified");

        if (fs.existsSync(anchorPath)) fs.unlinkSync(anchorPath);
      }

      // Scenario 9: DB empty, sqlite_sequence has historical records -> fail-closed
      {
        const anchorPath = path.join(os.tmpdir(), `aico-p02-scen9-${Date.now()}-${Math.random()}.jsonl`);
        const obs = new ObservabilityQuotaService(conn, hmacKey, anchorPath);

        conn.withWriteTransaction((db: any) => {
          db.exec("DELETE FROM audit_events;");
          db.prepare("INSERT OR REPLACE INTO sqlite_sequence (name, seq) VALUES ('audit_events', 99)").run();
        });

        // Verification fails closed
        const vRes = obs.verifyAuditChainIntegrity();
        assert.equal(vRes.valid, false);
        assert.match(String(vRes.brokenAtEventId), /TAIL_TRUNCATION_DETECTED: sqlite_sequence indicates historical audit events existed/);

        // Reconcile refused
        assert.throws(
          () => obs.reconcileUnanchoredEvents(),
          /SAFE_RECONCILIATION_REFUSED: Database has 0 events but sqlite_sequence indicates historical records existed/
        );

        // Cleanup sqlite_sequence to not leak into subsequent tests
        conn.withWriteTransaction((db: any) => {
          db.prepare("DELETE FROM sqlite_sequence WHERE name = 'audit_events'").run();
        });

        if (fs.existsSync(anchorPath)) fs.unlinkSync(anchorPath);
      }

      // Scenario 10: Recovery without independent evidence -> explicitly requires Founder review
      {
        const anchorPath = path.join(os.tmpdir(), `aico-p02-scen10-${Date.now()}-${Math.random()}.jsonl`);
        const obs = new ObservabilityQuotaService(conn, hmacKey, anchorPath);
        populateAuditEvents(obs, 4, "scen10");

        // Keep only first 2 lines in anchor file (simulating missing trailing anchors without independent witness)
        const allLines = fs.readFileSync(anchorPath, "utf8").split(/\r?\n/).filter(l => l.trim().length > 0);
        assert.equal(allLines.length, 4);
        fs.writeFileSync(anchorPath, allLines[0] + "\n" + allLines[1] + "\n", "utf8");

        const dbBefore = (conn.withReadTransaction((db) => db.prepare("SELECT COUNT(*) as c FROM audit_events").get()) as any).c;
        const anchorBefore = fs.readFileSync(anchorPath, "utf8");

        // Verification must detect deficit
        const vBefore = obs.verifyAuditChainIntegrity();
        assert.equal(vBefore.valid, false);
        assert.match(String(vBefore.brokenAtEventId), /ANCHOR_COVERAGE_DEFICIT/);

        // Reconcile without independent evidence MUST fail closed and require Founder review
        assert.throws(
          () => obs.reconcileUnanchoredEvents(),
          /SAFE_RECONCILIATION_REFUSED: ANCHOR_RECOVERY_REQUIRES_FOUNDER_REVIEW: Anchor file has fewer records \(2\) than database events \(4\)/
        );

        // Invariants: 0 DB rows modified, 0 anchor bytes modified, verification strictly remains fail-closed
        const dbAfter = (conn.withReadTransaction((db) => db.prepare("SELECT COUNT(*) as c FROM audit_events").get()) as any).c;
        assert.equal(dbAfter, dbBefore, "0 DB rows modified");
        assert.equal(fs.readFileSync(anchorPath, "utf8"), anchorBefore, "0 anchor bytes modified");
        assert.equal(obs.verifyAuditChainIntegrity().valid, false, "Verification must never report fake valid state");

        if (fs.existsSync(anchorPath)) fs.unlinkSync(anchorPath);
      }
    });

    // ------------------------------------------------------------------------
    // Part 6: Git Working Tree Content & History Secret Scanning
    // ------------------------------------------------------------------------
    await t.test("6.1 Full divergence and working tree secret scanning", () => {
      const gitService = new GitMediationService(path.resolve(process.cwd(), ".."), path.join(os.tmpdir(), "aico-worktrees"));
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
