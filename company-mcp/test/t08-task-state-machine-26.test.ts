import test from "node:test";
import assert from "node:assert/strict";
import { createSandboxTestContext } from "./helpers/test-context.js";
import { ConnectionManager } from "../src/db/connection-manager.js";
import { MigrationRunner } from "../src/db/migration-runner.js";
import { migrationV040 } from "../src/db/migrations/v040-agent-columns.js";
import { migrationV050Schema } from "../src/db/migrations/v050-target-schema.js";
import { ProjectTaskService, type TaskExecutionStatus } from "../src/services/project-task-service.js";
import { ApprovalService } from "../src/services/approval-service.js";
import { IdentityAccessService } from "../src/services/identity-access-service.js";

test("T08: Comprehensive 26-State Transition Matrix (TR-01 to TR-26) & Argon Gate Verification", async () => {
  const ctx = createSandboxTestContext("aico-t08-matrix-");

  try {
    const conn = new ConnectionManager(ctx.dbPath);
    const runner = new MigrationRunner(conn);
    runner.runMigrations([migrationV040, migrationV050Schema]);

    const idService = new IdentityAccessService(conn);
    const appService = new ApprovalService(conn);
    const taskService = new ProjectTaskService(conn, appService);

    const founderCtx = idService.getPrincipalById("founder-01")!;
    const flash1Ctx = idService.getPrincipalById("flash-01")!;
    const flash2Ctx = idService.getPrincipalById("flash-02")!;
    const codexCtx = idService.getPrincipalById("codex-01")!;

    const executedTransitions = new Set<string>();

    // Helper to create task
    let taskSeq = 0;
    function createTask(assignedAgentId: string, riskClass: "low" | "medium" | "high" | "critical" = "medium") {
      taskSeq++;
      return taskService.createTask({
        ctx: flash1Ctx,
        taskId: `task_test_${taskSeq}`,
        projectId: "proj_aico_v221",
        title: `Task #${taskSeq}`,
        assignedAgentId,
        riskClass
      });
    }

    // ------------------------------------------------------------------------
    // Part 1: Standard Lifecycle Transitions (TR-01, TR-06, TR-10, TR-11, TR-22, TR-25, TR-26)
    // ------------------------------------------------------------------------
    const tStandard = createTask("codex-01");
    assert.equal(tStandard.execution_status, "draft");

    // TR-01: draft -> queued
    const tr01 = taskService.transitionTask({ ctx: flash1Ctx, taskId: tStandard.task_id, expectedVersion: 1, toStatus: "queued" });
    assert.equal(tr01.execution_status, "queued");
    assert.equal(tr01.version, 2);
    executedTransitions.add("TR-01");

    // TR-06: queued -> assigned
    const tr06 = taskService.transitionTask({ ctx: flash1Ctx, taskId: tStandard.task_id, expectedVersion: 2, toStatus: "assigned" });
    assert.equal(tr06.execution_status, "assigned");
    assert.equal(tr06.dispatch_status, "queued_for_client_pull");
    assert.equal(tr06.version, 3);
    executedTransitions.add("TR-06");

    // TR-10: assigned -> claimed
    const tr10 = taskService.transitionTask({ ctx: codexCtx, taskId: tStandard.task_id, expectedVersion: 3, toStatus: "claimed" });
    assert.equal(tr10.execution_status, "claimed");
    assert.equal(tr10.lease_owner_agent_id, "codex-01");
    assert.ok(tr10.lease_expires_at);
    executedTransitions.add("TR-10");

    // TR-11: claimed -> in_progress
    const tr11 = taskService.transitionTask({ ctx: codexCtx, taskId: tStandard.task_id, expectedVersion: 4, toStatus: "in_progress" });
    assert.equal(tr11.execution_status, "in_progress");
    executedTransitions.add("TR-11");

    // TR-22: in_progress -> review_required
    const tr22 = taskService.transitionTask({ ctx: codexCtx, taskId: tStandard.task_id, expectedVersion: 5, toStatus: "review_required" });
    assert.equal(tr22.execution_status, "review_required");
    assert.equal(tr22.dispatch_status, "result_received");
    executedTransitions.add("TR-22");

    // Separation of Duties test on TR-25: codex-01 cannot approve their own task
    assert.throws(
      () => taskService.transitionTask({ ctx: codexCtx, taskId: tStandard.task_id, expectedVersion: 6, toStatus: "completed" }),
      /ABAC_OWNERSHIP_OR_SOD_VIOLATION/
    );

    // TR-25: review_required -> completed (reviewed by flash-02)
    const tr25 = taskService.transitionTask({ ctx: flash2Ctx, taskId: tStandard.task_id, expectedVersion: 6, toStatus: "completed" });
    assert.equal(tr25.execution_status, "completed");
    assert.ok(tr25.completed_at);
    executedTransitions.add("TR-25");

    // TR-26: completed -> archived
    const tr26 = taskService.transitionTask({ ctx: founderCtx, taskId: tStandard.task_id, expectedVersion: 7, toStatus: "archived" });
    assert.equal(tr26.execution_status, "archived");
    executedTransitions.add("TR-26");

    // ------------------------------------------------------------------------
    // Part 2: Rework, Failure and Retries (TR-02, TR-03, TR-05, TR-07, TR-08, TR-09, TR-12, TR-13, TR-14, TR-16, TR-17, TR-18, TR-19, TR-20, TR-21, TR-23, TR-24)
    // ------------------------------------------------------------------------
    // TR-02: draft -> cancelled
    const tCancelDraft = createTask("codex-01");
    const tr02 = taskService.transitionTask({ ctx: flash1Ctx, taskId: tCancelDraft.task_id, expectedVersion: 1, toStatus: "cancelled" });
    assert.equal(tr02.execution_status, "cancelled");
    executedTransitions.add("TR-02");

    // TR-03: draft -> waiting_approval (explicit transition from draft)
    const tDraftToAppr = createTask("codex-01", "medium");
    assert.equal(tDraftToAppr.execution_status, "draft");
    const tr03 = taskService.transitionTask({ ctx: flash1Ctx, taskId: tDraftToAppr.task_id, expectedVersion: 1, toStatus: "waiting_approval" });
    assert.equal(tr03.execution_status, "waiting_approval");
    assert.equal(tr03.dispatch_status, "approval_pending");
    executedTransitions.add("TR-03");

    // TR-05: waiting_approval -> cancelled
    const tr05 = taskService.transitionTask({ ctx: flash1Ctx, taskId: tDraftToAppr.task_id, expectedVersion: 2, toStatus: "cancelled" });
    assert.equal(tr05.execution_status, "cancelled");
    executedTransitions.add("TR-05");

    // TR-07: queued -> cancelled
    const tCancelQueued = createTask("codex-01");
    taskService.transitionTask({ ctx: flash1Ctx, taskId: tCancelQueued.task_id, expectedVersion: 1, toStatus: "queued" });
    const tr07 = taskService.transitionTask({ ctx: flash1Ctx, taskId: tCancelQueued.task_id, expectedVersion: 2, toStatus: "cancelled" });
    assert.equal(tr07.execution_status, "cancelled");
    executedTransitions.add("TR-07");

    // TR-08: assigned -> queued (re-queue)
    const tRequeue = createTask("codex-01");
    taskService.transitionTask({ ctx: flash1Ctx, taskId: tRequeue.task_id, expectedVersion: 1, toStatus: "queued" });
    taskService.transitionTask({ ctx: flash1Ctx, taskId: tRequeue.task_id, expectedVersion: 2, toStatus: "assigned" });
    const tr08 = taskService.transitionTask({ ctx: flash1Ctx, taskId: tRequeue.task_id, expectedVersion: 3, toStatus: "queued" });
    assert.equal(tr08.execution_status, "queued");
    executedTransitions.add("TR-08");

    // TR-09: assigned -> cancelled
    const tCancelAssigned = createTask("codex-01");
    taskService.transitionTask({ ctx: flash1Ctx, taskId: tCancelAssigned.task_id, expectedVersion: 1, toStatus: "queued" });
    taskService.transitionTask({ ctx: flash1Ctx, taskId: tCancelAssigned.task_id, expectedVersion: 2, toStatus: "assigned" });
    const tr09 = taskService.transitionTask({ ctx: flash1Ctx, taskId: tCancelAssigned.task_id, expectedVersion: 3, toStatus: "cancelled" });
    assert.equal(tr09.execution_status, "cancelled");
    executedTransitions.add("TR-09");

    // TR-12: claimed -> assigned (stale lease recovery for non-Argon task)
    const tStaleClaim = createTask("codex-01");
    taskService.transitionTask({ ctx: flash1Ctx, taskId: tStaleClaim.task_id, expectedVersion: 1, toStatus: "queued" });
    taskService.transitionTask({ ctx: flash1Ctx, taskId: tStaleClaim.task_id, expectedVersion: 2, toStatus: "assigned" });
    taskService.transitionTask({ ctx: codexCtx, taskId: tStaleClaim.task_id, expectedVersion: 3, toStatus: "claimed" });
    const tr12 = taskService.transitionTask({ ctx: flash1Ctx, taskId: tStaleClaim.task_id, expectedVersion: 4, toStatus: "assigned" });
    assert.equal(tr12.execution_status, "assigned");
    executedTransitions.add("TR-12");

    // TR-13, TR-16, TR-17: in_progress -> blocked -> in_progress / cancelled
    const tBlock = createTask("codex-01");
    taskService.transitionTask({ ctx: flash1Ctx, taskId: tBlock.task_id, expectedVersion: 1, toStatus: "queued" });
    taskService.transitionTask({ ctx: flash1Ctx, taskId: tBlock.task_id, expectedVersion: 2, toStatus: "assigned" });
    taskService.transitionTask({ ctx: codexCtx, taskId: tBlock.task_id, expectedVersion: 3, toStatus: "claimed" });
    taskService.transitionTask({ ctx: codexCtx, taskId: tBlock.task_id, expectedVersion: 4, toStatus: "in_progress" });
    const tr13 = taskService.transitionTask({ ctx: codexCtx, taskId: tBlock.task_id, expectedVersion: 5, toStatus: "blocked" });
    assert.equal(tr13.execution_status, "blocked");
    executedTransitions.add("TR-13");

    const tr16 = taskService.transitionTask({ ctx: codexCtx, taskId: tBlock.task_id, expectedVersion: 6, toStatus: "in_progress" });
    assert.equal(tr16.execution_status, "in_progress");
    executedTransitions.add("TR-16");

    taskService.transitionTask({ ctx: codexCtx, taskId: tBlock.task_id, expectedVersion: 7, toStatus: "blocked" });
    const tr17 = taskService.transitionTask({ ctx: flash1Ctx, taskId: tBlock.task_id, expectedVersion: 8, toStatus: "cancelled" });
    assert.equal(tr17.execution_status, "cancelled");
    executedTransitions.add("TR-17");

    // TR-14: in_progress -> waiting_approval
    const tWaitAppr = createTask("codex-01");
    taskService.transitionTask({ ctx: flash1Ctx, taskId: tWaitAppr.task_id, expectedVersion: 1, toStatus: "queued" });
    taskService.transitionTask({ ctx: flash1Ctx, taskId: tWaitAppr.task_id, expectedVersion: 2, toStatus: "assigned" });
    taskService.transitionTask({ ctx: codexCtx, taskId: tWaitAppr.task_id, expectedVersion: 3, toStatus: "claimed" });
    taskService.transitionTask({ ctx: codexCtx, taskId: tWaitAppr.task_id, expectedVersion: 4, toStatus: "in_progress" });
    const tr14 = taskService.transitionTask({ ctx: codexCtx, taskId: tWaitAppr.task_id, expectedVersion: 5, toStatus: "waiting_approval" });
    assert.equal(tr14.execution_status, "waiting_approval");
    executedTransitions.add("TR-14");

    // TR-18: waiting_approval -> in_progress (for non-Argon)
    const tr18 = taskService.transitionTask({ ctx: flash1Ctx, taskId: tWaitAppr.task_id, expectedVersion: 6, toStatus: "in_progress" });
    assert.equal(tr18.execution_status, "in_progress");
    executedTransitions.add("TR-18");

    // TR-19, TR-20, TR-21: in_progress -> failed -> queued (retry) / cancelled
    const tFail = createTask("codex-01");
    taskService.transitionTask({ ctx: flash1Ctx, taskId: tFail.task_id, expectedVersion: 1, toStatus: "queued" });
    taskService.transitionTask({ ctx: flash1Ctx, taskId: tFail.task_id, expectedVersion: 2, toStatus: "assigned" });
    taskService.transitionTask({ ctx: codexCtx, taskId: tFail.task_id, expectedVersion: 3, toStatus: "claimed" });
    taskService.transitionTask({ ctx: codexCtx, taskId: tFail.task_id, expectedVersion: 4, toStatus: "in_progress" });
    const tr19 = taskService.transitionTask({ ctx: codexCtx, taskId: tFail.task_id, expectedVersion: 5, toStatus: "failed" });
    assert.equal(tr19.execution_status, "failed");
    executedTransitions.add("TR-19");

    // TR-20: failed -> queued (retry count increments)
    const tr20 = taskService.transitionTask({ ctx: flash1Ctx, taskId: tFail.task_id, expectedVersion: 6, toStatus: "queued" });
    assert.equal(tr20.execution_status, "queued");
    assert.equal(tr20.retry_count, 1);
    executedTransitions.add("TR-20");

    // Move to failed again and test TR-21
    taskService.transitionTask({ ctx: flash1Ctx, taskId: tFail.task_id, expectedVersion: 7, toStatus: "assigned" });
    taskService.transitionTask({ ctx: codexCtx, taskId: tFail.task_id, expectedVersion: 8, toStatus: "claimed" });
    taskService.transitionTask({ ctx: codexCtx, taskId: tFail.task_id, expectedVersion: 9, toStatus: "in_progress" });
    taskService.transitionTask({ ctx: codexCtx, taskId: tFail.task_id, expectedVersion: 10, toStatus: "failed" });
    const tr21 = taskService.transitionTask({ ctx: flash1Ctx, taskId: tFail.task_id, expectedVersion: 11, toStatus: "cancelled" });
    assert.equal(tr21.execution_status, "cancelled");
    executedTransitions.add("TR-21");

    // TR-23, TR-24: review_required -> rework -> in_progress
    const tRework = createTask("codex-01");
    taskService.transitionTask({ ctx: flash1Ctx, taskId: tRework.task_id, expectedVersion: 1, toStatus: "queued" });
    taskService.transitionTask({ ctx: flash1Ctx, taskId: tRework.task_id, expectedVersion: 2, toStatus: "assigned" });
    taskService.transitionTask({ ctx: codexCtx, taskId: tRework.task_id, expectedVersion: 3, toStatus: "claimed" });
    taskService.transitionTask({ ctx: codexCtx, taskId: tRework.task_id, expectedVersion: 4, toStatus: "in_progress" });
    taskService.transitionTask({ ctx: codexCtx, taskId: tRework.task_id, expectedVersion: 5, toStatus: "review_required" });

    // SoD check on rework: author cannot review own task for rework
    assert.throws(
      () => taskService.transitionTask({ ctx: codexCtx, taskId: tRework.task_id, expectedVersion: 6, toStatus: "rework" }),
      /ABAC_OWNERSHIP_OR_SOD_VIOLATION/
    );
    const tr23 = taskService.transitionTask({ ctx: flash2Ctx, taskId: tRework.task_id, expectedVersion: 6, toStatus: "rework" });
    assert.equal(tr23.execution_status, "rework");
    executedTransitions.add("TR-23");

    const tr24 = taskService.transitionTask({ ctx: codexCtx, taskId: tRework.task_id, expectedVersion: 7, toStatus: "in_progress" });
    assert.equal(tr24.execution_status, "in_progress");
    executedTransitions.add("TR-24");

    // ------------------------------------------------------------------------
    // Part 3: Argon Invariants, Strict Approvals & TR-15 (Argon Lease Expiry)
    // ------------------------------------------------------------------------
    const tArgon = createTask("argon-01");
    assert.equal(tArgon.execution_status, "waiting_approval", "Argon task MUST start in waiting_approval");
    assert.equal(tArgon.max_retries, 0, "Argon max_retries MUST be 0");

    // Bypass attempt 1: transition waiting_approval -> queued without approval MUST FAIL
    assert.throws(
      () => taskService.transitionTask({ ctx: flash1Ctx, taskId: tArgon.task_id, expectedVersion: 1, toStatus: "queued" }),
      /ARGON_FOUNDER_APPROVAL_REQUIRED/
    );

    // Bypass attempt 2: with forged approval ID MUST FAIL
    assert.throws(
      () => taskService.transitionTask({
        ctx: flash1Ctx,
        taskId: tArgon.task_id,
        expectedVersion: 1,
        toStatus: "queued",
        approvalId: "appr_fake_forged_9999"
      }),
      /ARGON_FOUNDER_APPROVAL_REQUIRED/
    );

    // Bypass attempt 3: direct waiting_approval -> in_progress without approval MUST FAIL
    assert.throws(
      () => taskService.transitionTask({ ctx: flash1Ctx, taskId: tArgon.task_id, expectedVersion: 1, toStatus: "in_progress" }),
      /ARGON_FOUNDER_APPROVAL_REQUIRED/
    );

    // Re-Audit P0 Finding: Reject approval when action_type is "critical_task_approval" instead of "argon_invocation"
    const genericTransitionAppr = appService.createApprovalRequest({
      ctx: flash1Ctx,
      action_type: "critical_task_approval",
      target_agent_id: "argon-01",
      target_resource: `task:${tArgon.task_id}`,
      canonical_payload: { taskId: tArgon.task_id, targetAgentId: "argon-01" },
      approval_tier: "founder",
      reason: "Critical task approval attempt reused on Argon invocation"
    });
    appService.decideApproval({ ctx: founderCtx, approval_id: genericTransitionAppr.approval_id, decision: "approved" });

    assert.throws(
      () => taskService.transitionTask({
        ctx: flash1Ctx,
        taskId: tArgon.task_id,
        expectedVersion: 1,
        toStatus: "queued",
        approvalId: genericTransitionAppr.approval_id
      }),
      /ARGON_FOUNDER_APPROVAL_REQUIRED.*Action type mismatch/i
    );

    // Re-Audit P0 Finding: Reject approval when payload has different targetAgentId (e.g. argon-02 vs argon-01)
    const mismatchedPayloadAppr = appService.createApprovalRequest({
      ctx: flash1Ctx,
      action_type: "argon_invocation",
      target_agent_id: "argon-02",
      target_resource: `task:${tArgon.task_id}`,
      canonical_payload: { taskId: tArgon.task_id, targetAgentId: "argon-02" },
      approval_tier: "founder",
      reason: "Mismatched targetAgentId approval"
    });
    appService.decideApproval({ ctx: founderCtx, approval_id: mismatchedPayloadAppr.approval_id, decision: "approved" });

    assert.throws(
      () => taskService.transitionTask({
        ctx: flash1Ctx,
        taskId: tArgon.task_id,
        expectedVersion: 1,
        toStatus: "queued",
        approvalId: mismatchedPayloadAppr.approval_id
      }),
      /ARGON_FOUNDER_APPROVAL_REQUIRED.*(Payload hash mismatch|TARGET_AGENT_MISMATCH)/i
    );

    // Legitimate Founder Approval Flow:
    // 1. Request approval with exact action_type: "argon_invocation" and matching payload
    const apprReq = appService.createApprovalRequest({
      ctx: flash1Ctx,
      action_type: "argon_invocation",
      target_agent_id: "argon-01",
      target_resource: `task:${tArgon.task_id}`,
      canonical_payload: { taskId: tArgon.task_id, targetAgentId: "argon-01" },
      approval_tier: "founder",
      reason: "Authorize Argon Deep Architecture Audit"
    });
    assert.equal(apprReq.status, "pending");

    // 2. Founder approves
    const apprDecided = appService.decideApproval({
      ctx: founderCtx,
      approval_id: apprReq.approval_id,
      decision: "approved"
    });
    assert.equal(apprDecided.status, "approved");

    // 3. Legitimate TR-04 transition with verified Founder approval succeeds and consumes approval
    const tr04Argon = taskService.transitionTask({
      ctx: flash1Ctx,
      taskId: tArgon.task_id,
      expectedVersion: 1,
      toStatus: "queued",
      approvalId: apprReq.approval_id
    });
    assert.equal(tr04Argon.execution_status, "queued");
    executedTransitions.add("TR-04");

    // 4. Reuse attempt: Try using the SAME approval ID again on another transition MUST FAIL
    assert.throws(
      () => taskService.transitionTask({
        ctx: flash1Ctx,
        taskId: tArgon.task_id,
        expectedVersion: 2,
        toStatus: "assigned",
        approvalId: apprReq.approval_id
      }),
      /ARGON_FOUNDER_APPROVAL_REQUIRED/
    );

    // Move Argon task forward: queued -> assigned -> claimed -> in_progress
    taskService.transitionTask({ ctx: flash1Ctx, taskId: tArgon.task_id, expectedVersion: 2, toStatus: "assigned" });
    taskService.transitionTask({ ctx: founderCtx, taskId: tArgon.task_id, expectedVersion: 3, toStatus: "claimed" });

    // Attempting TR-12 on Argon task (claimed -> assigned) MUST FAIL: Argon cannot revert to assigned
    assert.throws(
      () => taskService.transitionTask({ ctx: flash1Ctx, taskId: tArgon.task_id, expectedVersion: 4, toStatus: "assigned" }),
      /Argon tasks cannot revert to assigned on lease expiry; must go to blocked \(TR-15\)/
    );

    // TR-15: Argon task claimed -> blocked on lease expiry
    const tr15 = taskService.transitionTask({
      ctx: flash1Ctx,
      taskId: tArgon.task_id,
      expectedVersion: 4,
      toStatus: "blocked"
    });
    assert.equal(tr15.execution_status, "blocked");
    assert.equal(tr15.lease_owner_agent_id, null);
    assert.equal(tr15.lease_expires_at, null);
    executedTransitions.add("TR-15");

    // Re-verify TR-16 on Argon: Founder unblocks -> in_progress (requires Founder approval for Argon)
    const apprResume = appService.createApprovalRequest({
      ctx: flash1Ctx,
      action_type: "argon_invocation",
      target_agent_id: "argon-01",
      target_resource: `task:${tArgon.task_id}`,
      canonical_payload: { taskId: tArgon.task_id, targetAgentId: "argon-01" },
      approval_tier: "founder",
      reason: "Authorize Argon Task Resume From Blocked"
    });
    appService.decideApproval({
      ctx: founderCtx,
      approval_id: apprResume.approval_id,
      decision: "approved"
    });
    const tr16Argon = taskService.transitionTask({
      ctx: founderCtx,
      taskId: tArgon.task_id,
      expectedVersion: 5,
      toStatus: "in_progress",
      approvalId: apprResume.approval_id
    });
    assert.equal(tr16Argon.execution_status, "in_progress");

    // Move Argon task to failed (TR-19)
    const tr19Argon = taskService.transitionTask({ ctx: founderCtx, taskId: tArgon.task_id, expectedVersion: 6, toStatus: "failed" });
    assert.equal(tr19Argon.execution_status, "failed");

    // Attempt auto-retry TR-20 for Argon MUST FAIL
    assert.throws(
      () => taskService.transitionTask({ ctx: flash1Ctx, taskId: tArgon.task_id, expectedVersion: 7, toStatus: "queued" }),
      /TASK_INVALID_STATE_TRANSITION/
    );

    // ------------------------------------------------------------------------
    // Part 4: Complete Canonical 26-Transition Coverage Assertion
    // ------------------------------------------------------------------------
    const canonical26 = [
      "TR-01", "TR-02", "TR-03", "TR-04", "TR-05", "TR-06", "TR-07", "TR-08", "TR-09", "TR-10",
      "TR-11", "TR-12", "TR-13", "TR-14", "TR-15", "TR-16", "TR-17", "TR-18", "TR-19", "TR-20",
      "TR-21", "TR-22", "TR-23", "TR-24", "TR-25", "TR-26"
    ];
    for (const trCode of canonical26) {
      assert.ok(executedTransitions.has(trCode), `Canonical transition ${trCode} MUST be exercised in test suite`);
    }
    assert.equal(executedTransitions.size, 26, `All 26 state transitions must be covered, got ${executedTransitions.size}`);
  } finally {
    ctx.cleanup();
  }
});
