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
import { ApprovalService } from "../src/services/approval-service.js";
import { WorkspaceArtifactService } from "../src/services/workspace-artifact-service.js";
import { ProjectTaskService } from "../src/services/project-task-service.js";
import { ObservabilityQuotaService } from "../src/services/observability-quota-service.js";
import { createFullMcpServer } from "../src/registry-core.js";
import { requestContextStore } from "../src/security/context-store.js";

test("T07: End-to-End Integration, Fail-Closed RBAC/ABAC & Negative Security Test Suite", async () => {
  process.env.AICO_AUDIT_HMAC_KEY = "test_hmac_secret_key_v221";
  const ctx = createSandboxTestContext("aico-sec-test-");

  try {
    const connManager = new ConnectionManager(ctx.dbPath);
    const runner = new MigrationRunner(connManager);
    runner.runMigrations([migrationV040, migrationV050Schema]);

    const idService = new IdentityAccessService(connManager);
    const appService = new ApprovalService(connManager);
    const wsService = new WorkspaceArtifactService(ctx.tempDir, connManager);
    const taskService = new ProjectTaskService(connManager, appService);
    const obsService = new ObservabilityQuotaService(connManager, undefined, ctx.anchorPath);

    // Initialize full MCP server with sandbox connection, sandbox workspace root, and sandbox anchor file
    const server = createFullMcpServer({
      isPublicGateway: false,
      connManager,
      workspaceRoot: ctx.tempDir,
      anchorFilePath: ctx.anchorPath
    });
    const registeredTools = (server as any)._registeredTools;

    // Issue tokens
    const founderTokenData = idService.issueCredential({
      principal_id: "founder-01",
      scopes: ["*"]
    });
    const founderCtx = idService.authenticateToken(founderTokenData.token, "local", "req_founder_test");
    assert.equal(founderCtx.authenticated, true);
    assert.equal(founderCtx.principalType, "human");

    const flash1TokenData = idService.issueCredential({
      principal_id: "flash-01",
      scopes: ["company:read", "tasks:manage", "workspace:read:self", "workspace:write:self", "approvals:request", "approvals:decide"]
    });
    const flash1Ctx = idService.authenticateToken(flash1TokenData.token, "local", "req_flash1_test");
    assert.equal(flash1Ctx.authenticated, true);
    assert.equal(flash1Ctx.agentId, "flash-01");

    const flash2TokenData = idService.issueCredential({
      principal_id: "flash-02",
      scopes: ["company:read", "workspace:read:self", "workspace:write:self", "tasks:claim", "tasks:heartbeat", "tasks:transition", "tasks:submit", "tasks:review"]
    });
    const flash2Ctx = idService.authenticateToken(flash2TokenData.token, "local", "req_flash2_test");
    assert.equal(flash2Ctx.authenticated, true);
    assert.equal(flash2Ctx.agentId, "flash-02");

    // ------------------------------------------------------------------------
    // 1. Fail-Closed Authentication: Calling tool without context must fail
    // ------------------------------------------------------------------------
    const identityTool = registeredTools["company_get_my_identity"];
    assert.ok(identityTool, "company_get_my_identity tool must be registered");

    const unauthCall = await identityTool.handler({}, {});
    assert.equal(unauthCall.isError, true);
    assert.match(unauthCall.content[0].text, /AUTH_MISSING_OR_INVALID_TOKEN/);

    // Context-propagated call: runs within requestContextStore
    const authCall = await requestContextStore.run(flash1Ctx, async () => {
      return await identityTool.handler({}, {});
    });
    assert.equal(authCall.isError, undefined);
    const myId = JSON.parse(authCall.content[0].text);
    assert.equal(myId.principal_id, "flash-01");
    assert.equal(myId.agent_id, "flash-01");
    assert.equal(myId.role, "Chief Technology Officer");

    // ------------------------------------------------------------------------
    // 2. Privilege Escalation Defense: Agent cannot issue credentials (M10)
    // ------------------------------------------------------------------------
    const issueCredTool = registeredTools["company_issue_credential"];
    assert.ok(issueCredTool);

    const agentIssueAttempt = await requestContextStore.run(flash1Ctx, async () => {
      return await issueCredTool.handler({
        principal_id: "flash-01",
        scopes: ["*"]
      }, {});
    });
    assert.equal(agentIssueAttempt.isError, true);
    assert.match(agentIssueAttempt.content[0].text, /PERMISSION_DENIED/);

    // Founder can issue credentials
    const founderIssue = await requestContextStore.run(founderCtx, async () => {
      return await issueCredTool.handler({
        principal_id: "codex-01",
        scopes: ["code:write", "test:run"]
      }, {});
    });
    assert.equal(founderIssue.isError, undefined);
    const issued = JSON.parse(founderIssue.content[0].text);
    assert.equal(issued.success, true);
    assert.ok(issued.token.startsWith("aico_live_"));

    // ------------------------------------------------------------------------
    // 3. Forged Identity Defense on Approval Request (M13)
    // ------------------------------------------------------------------------
    const reqApprovalTool = registeredTools["company_request_approval"];
    assert.ok(reqApprovalTool);

    // Flash-01 attempts to claim the request was made by founder-01
    const spoofAttempt = await requestContextStore.run(flash1Ctx, async () => {
      return await reqApprovalTool.handler({
        action_type: "architecture_review",
        requested_by: "founder-01", // spoof attempt in body
        canonical_payload: { review: "new_architecture" }
      }, {});
    });
    assert.equal(spoofAttempt.isError, undefined);
    const apprRes = JSON.parse(spoofAttempt.content[0].text);
    // Identity must be anchored to authenticated flash1Ctx, NOT the spoofed body
    assert.equal(apprRes.requested_by, "flash-01");

    // ------------------------------------------------------------------------
    // 4. Separation of Duties: Requester cannot approve their own request (M16)
    // ------------------------------------------------------------------------
    const decideApprovalTool = registeredTools["company_decide_approval"];
    assert.ok(decideApprovalTool);

    const selfApproveAttempt = await requestContextStore.run(flash1Ctx, async () => {
      return await decideApprovalTool.handler({
        approval_id: apprRes.approval_id,
        decision: "approved"
      }, {});
    });
    assert.equal(selfApproveAttempt.isError, true);
    assert.match(selfApproveAttempt.content[0].text, /SOD_VIOLATION.*Approver cannot be the same entity/);

    // Founder approves legitimately
    const founderApprove = await requestContextStore.run(founderCtx, async () => {
      return await decideApprovalTool.handler({
        approval_id: apprRes.approval_id,
        decision: "approved"
      }, {});
    });
    assert.equal(founderApprove.isError, undefined);
    const approved = JSON.parse(founderApprove.content[0].text);
    assert.equal(approved.status, "approved");

    // ------------------------------------------------------------------------
    // 5. Workspace Isolation & Overwrite Protection (M19, M20, M22)
    // ------------------------------------------------------------------------
    const writeWsTool = registeredTools["company_write_workspace_file"];
    const readWsTool = registeredTools["company_read_workspace_file"];
    const activityWsTool = registeredTools["company_get_workspace_activity"];

    // Flash-01 writes an artifact to their workspace
    const writeRes = await requestContextStore.run(flash1Ctx, async () => {
      return await writeWsTool.handler({
        relative_path: "reports/audit-summary.txt",
        content: "Audit passed cleanly",
        overwrite: true
      }, {});
    });
    assert.equal(writeRes.isError, undefined);

    // Overwrite=false on existing file must throw FILE_ALREADY_EXISTS
    const noOverwriteAttempt = await requestContextStore.run(flash1Ctx, async () => {
      return await writeWsTool.handler({
        relative_path: "reports/audit-summary.txt",
        content: "Malicious override attempt",
        overwrite: false
      }, {});
    });
    assert.equal(noOverwriteAttempt.isError, true);
    assert.match(noOverwriteAttempt.content[0].text, /FILE_ALREADY_EXISTS/);

    // Cross-workspace tamper defense: Flash-02 cannot read/write Flash-01 workspace
    const crossAgentRead = await requestContextStore.run(flash2Ctx, async () => {
      return await readWsTool.handler({
        target_agent_id: "flash-01",
        relative_path: "reports/audit-summary.txt"
      }, {});
    });
    assert.equal(crossAgentRead.isError, true);
    assert.match(crossAgentRead.content[0].text, /PERMISSION_DENIED/);

    // Activities log (M22) reflects operations
    const activitiesRes = await requestContextStore.run(founderCtx, async () => {
      return await activityWsTool.handler({ agent_id: "flash-01" }, {});
    });
    assert.equal(activitiesRes.isError, undefined);
    const actData = JSON.parse(activitiesRes.content[0].text);
    assert.ok(actData.count > 0, "Activities must be recorded in agent_workspace_activities");

    // ------------------------------------------------------------------------
    // 6. Argon Governance Constraints: max_retries = 0 & Founder Gate
    // ------------------------------------------------------------------------
    const createTaskTool = registeredTools["company_create_task"];
    const transitionTaskTool = registeredTools["company_transition_task"];

    const createArgon = await requestContextStore.run(flash1Ctx, async () => {
      return await createTaskTool.handler({
        task_id: "task_argon_test_01",
        project_id: "proj_aico_v221",
        title: "Deep Architectural Audit",
        assigned_agent_id: "argon-01",
        risk_class: "critical"
      }, {});
    });
    assert.equal(createArgon.isError, undefined);
    const argonTask = JSON.parse(createArgon.content[0].text);

    // Invariants enforced
    assert.equal(argonTask.execution_status, "waiting_approval");
    assert.equal(argonTask.dispatch_status, "approval_pending");
    assert.equal(argonTask.max_retries, 0);

    // Attempting auto-retry on Argon task must fail
    connManager.withWriteTransaction((db) => {
      db.prepare("UPDATE tasks SET execution_status = 'failed' WHERE task_id = 'task_argon_test_01'").run();
    });

    const argonRetryAttempt = await requestContextStore.run(flash1Ctx, async () => {
      return await transitionTaskTool.handler({
        task_id: "task_argon_test_01",
        to_status: "queued",
        expected_version: 1
      }, {});
    });
    assert.equal(argonRetryAttempt.isError, true);
    assert.match(argonRetryAttempt.content[0].text, /Argon tasks cannot auto-retry/);

    // ------------------------------------------------------------------------
    // 7. Complete Task Lifecycle & Separation of Duties Review
    // ------------------------------------------------------------------------
    const claimTaskTool = registeredTools["company_claim_task"];
    const heartbeatTaskTool = registeredTools["company_heartbeat_task"];
    const submitResultTool = registeredTools["company_submit_task_result"];
    const reviewTaskTool = registeredTools["company_review_task"];

    // Create standard engineering task
    const createDevTask = await requestContextStore.run(flash1Ctx, async () => {
      return await createTaskTool.handler({
        task_id: "task_dev_100",
        project_id: "proj_aico_v221",
        title: "Implement Security Hardening",
        assigned_agent_id: "flash-02",
        risk_class: "medium"
      }, {});
    });
    assert.equal(createDevTask.isError, undefined);

    // Transition to queued (TR-01) -> assigned (TR-06)
    await requestContextStore.run(flash1Ctx, async () => {
      await transitionTaskTool.handler({ task_id: "task_dev_100", to_status: "queued", expected_version: 1 }, {});
      await transitionTaskTool.handler({ task_id: "task_dev_100", to_status: "assigned", expected_version: 2 }, {});
    });

    // Claim task by Flash-02 (TR-10)
    const claimRes = await requestContextStore.run(flash2Ctx, async () => {
      return await claimTaskTool.handler({ task_id: "task_dev_100", expected_version: 3 }, {});
    });
    assert.equal(claimRes.isError, undefined);

    // Heartbeat lease renewal (M30)
    const hbRes = await requestContextStore.run(flash2Ctx, async () => {
      return await heartbeatTaskTool.handler({ task_id: "task_dev_100" }, {});
    });
    assert.equal(hbRes.isError, undefined);

    // Move to in_progress (TR-11)
    await requestContextStore.run(flash2Ctx, async () => {
      await transitionTaskTool.handler({ task_id: "task_dev_100", to_status: "in_progress", expected_version: 4 }, {});
    });

    // Flash-02 submits result (TR-22)
    const submitRes = await requestContextStore.run(flash2Ctx, async () => {
      return await submitResultTool.handler({
        task_id: "task_dev_100",
        expected_version: 5,
        output_artifact_ids: ["art_sec_report_01"],
        verification_evidence: "100% test pass on sandbox"
      }, {});
    });
    assert.equal(submitRes.isError, undefined);

    // SoD Review: Flash-02 attempts to approve their own work -> REJECTED
    const selfReview = await requestContextStore.run(flash2Ctx, async () => {
      return await reviewTaskTool.handler({
        task_id: "task_dev_100",
        expected_version: 6,
        decision: "completed"
      }, {});
    });
    assert.equal(selfReview.isError, true);
    assert.match(selfReview.content[0].text, /ABAC_OWNERSHIP_OR_SOD_VIOLATION.*Agent cannot approve own task/);

    // Independent CTO (Flash-01) reviews and completes task -> SUCCESS
    const ctoReview = await requestContextStore.run(flash1Ctx, async () => {
      return await reviewTaskTool.handler({
        task_id: "task_dev_100",
        expected_version: 6,
        decision: "completed",
        reason: "Technical review approved with verification evidence"
      }, {});
    });
    assert.equal(ctoReview.isError, undefined);

    // ------------------------------------------------------------------------
    // 7b. M38 Operation-Level Scopes (Negative & Positive Enforcement)
    // ------------------------------------------------------------------------
    const m38Tool = registeredTools["company_knowledge_memory_ops"];
    assert.ok(m38Tool);

    // Negative: flash-02 lacks observability:read/admin -> FAILS
    const obsDeny = await requestContextStore.run(flash2Ctx, async () => {
      return await m38Tool.handler({ operation: "get_system_observability" }, {});
    });
    assert.equal(obsDeny.isError, true);
    assert.match(obsDeny.content[0].text, /PERMISSION_DENIED.*observability/);

    // Negative: flash-02 lacks memory:write/manage -> FAILS
    const memDeny = await requestContextStore.run(flash2Ctx, async () => {
      return await m38Tool.handler({ operation: "write_memory", content: "Unauthorized note" }, {});
    });
    assert.equal(memDeny.isError, true);
    assert.match(memDeny.content[0].text, /PERMISSION_DENIED.*memory/);

    // Positive: founder-01 with * wildcard -> SUCCEEDS
    const obsFounder = await requestContextStore.run(founderCtx, async () => {
      return await m38Tool.handler({ operation: "get_system_observability" }, {});
    });
    assert.equal(obsFounder.isError, undefined);
    assert.match(obsFounder.content[0].text, /"success":\s*true/);

    // ------------------------------------------------------------------------
    // 7c. Re-Audit Remediations: ABAC on Dispatches, Approvals, and Task Scopes
    // ------------------------------------------------------------------------
    const dispatchTool = registeredTools["company_record_external_dispatch"];
    const listApprovalsTool = registeredTools["company_list_approval_requests"];
    const getApprovalTool = registeredTools["company_get_approval_request"];
    const listTasksTool = registeredTools["company_list_tasks"];
    const getTaskTool = registeredTools["company_get_task"];

    // Issue a restricted credential for codex-01 with only tasks:read:assigned and tasks:submit
    const codexAssignedTokenData = idService.issueCredential({
      principal_id: "codex-01",
      scopes: ["tasks:read:assigned", "tasks:submit", "tasks:transition"]
    });
    const codexCtx = idService.authenticateToken(codexAssignedTokenData.token, "local", "req_codex_test");

    // 1) M34: codex-01 without tasks:manage cannot call tool -> rejected at scope level
    const scopeDeniedDispatch = await requestContextStore.run(codexCtx, async () => {
      return await dispatchTool.handler({
        task_id: "task_dev_100",
        milestone: "execution_started"
      }, {});
    });
    assert.equal(scopeDeniedDispatch.isError, true);
    assert.match(scopeDeniedDispatch.content[0].text, /PERMISSION_DENIED.*Missing one of required scopes/);

    // codex-01 with tasks:manage attempting to record milestone on task_dev_100 (assigned to flash-02) -> rejected by ABAC
    const codexManageTokenData = idService.issueCredential({
      principal_id: "codex-01",
      scopes: ["tasks:manage"]
    });
    const codexManageCtx = idService.authenticateToken(codexManageTokenData.token, "local", "req_codex_manage");
    const unauthorizedDispatch = await requestContextStore.run(codexManageCtx, async () => {
      return await dispatchTool.handler({
        task_id: "task_dev_100",
        milestone: "operator_delivered"
      }, {});
    });
    assert.equal(unauthorizedDispatch.isError, true);
    assert.match(unauthorizedDispatch.content[0].text, /PERMISSION_DENIED.*not authorized to update dispatch status/);

    // 2) M14 & M15: Approval isolation
    // flash-02 lists approvals: must NOT see flash-01's approval (apprRes.approval_id)
    const flash2ListAppr = await requestContextStore.run(flash2Ctx, async () => {
      return await listApprovalsTool.handler({}, {});
    });
    assert.equal(flash2ListAppr.isError, undefined);
    const flash2Apprs = JSON.parse(flash2ListAppr.content[0].text);
    const foundOtherAppr = flash2Apprs.approvals.some((a: any) => a.approval_id === apprRes.approval_id);
    assert.equal(foundOtherAppr, false, "flash-02 must NOT see approvals requested by flash-01");

    // flash-02 attempts to get flash-01's approval by ID -> PERMISSION_DENIED
    const flash2GetAppr = await requestContextStore.run(flash2Ctx, async () => {
      return await getApprovalTool.handler({ approval_id: apprRes.approval_id }, {});
    });
    assert.equal(flash2GetAppr.isError, true);
    assert.match(flash2GetAppr.content[0].text, /PERMISSION_DENIED.*approval/);

    // 3) M27 & M28: tasks:read:assigned isolation
    // codex-01 lists tasks: must only receive 0 tasks because none are assigned to codex-01
    const codexListTasks = await requestContextStore.run(codexCtx, async () => {
      return await listTasksTool.handler({}, {});
    });
    assert.equal(codexListTasks.isError, undefined);
    const codexTasks = JSON.parse(codexListTasks.content[0].text);
    assert.equal(codexTasks.tasks.length, 0, "codex-01 with tasks:read:assigned must only see own tasks");

    // codex-01 attempts to get task_dev_100 (assigned to flash-02) -> PERMISSION_DENIED
    const codexGetOtherTask = await requestContextStore.run(codexCtx, async () => {
      return await getTaskTool.handler({ task_id: "task_dev_100" }, {});
    });
    assert.equal(codexGetOtherTask.isError, true);
    assert.match(codexGetOtherTask.content[0].text, /PERMISSION_DENIED/);

    // 4) M32: codex-01 attempts to submit result for flash-02's task -> PERMISSION_DENIED
    // Create task_dev_200 assigned to flash-02 and advance to in_progress
    await requestContextStore.run(flash1Ctx, async () => {
      await createTaskTool.handler({
        task_id: "task_dev_200",
        project_id: "proj_aico_v221",
        title: "Flash-02 Task",
        assigned_agent_id: "flash-02",
        risk_class: "low"
      }, {});
      await transitionTaskTool.handler({ task_id: "task_dev_200", to_status: "queued", expected_version: 1 }, {});
      await transitionTaskTool.handler({ task_id: "task_dev_200", to_status: "assigned", expected_version: 2 }, {});
    });
    await requestContextStore.run(flash2Ctx, async () => {
      await claimTaskTool.handler({ task_id: "task_dev_200", expected_version: 3 }, {});
      await transitionTaskTool.handler({ task_id: "task_dev_200", to_status: "in_progress", expected_version: 4 }, {});
    });

    const codexSubmitOther = await requestContextStore.run(codexCtx, async () => {
      return await submitResultTool.handler({
        task_id: "task_dev_200",
        expected_version: 5,
        verification_evidence: "fake test evidence",
        output_artifact_ids: ["art_hack"]
      }, {});
    });
    assert.equal(codexSubmitOther.isError, true);
    assert.match(codexSubmitOther.content[0].text, /ABAC_OWNERSHIP_OR_SOD_VIOLATION.*assigned/);

    // ------------------------------------------------------------------------
    // 8. HMAC Audit Chain Integrity Verification
    // ------------------------------------------------------------------------
    const chainIntegrity = obsService.verifyAuditChainIntegrity();
    assert.equal(chainIntegrity.valid, true, "HMAC-SHA256 audit chain must be 100% valid");
    assert.ok(chainIntegrity.totalEvents >= 6, "All mutating MCP operations must append audit events");

    // Verify tests never contaminated repo backup directory
    assert.equal(
      fs.existsSync("D:/AI-COMPANY/backup/audit_anchors.jsonl"),
      false,
      "Test execution must never contaminate production backup directory"
    );
  } finally {
    ctx.cleanup();
  }
});
