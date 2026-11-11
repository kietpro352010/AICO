import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import express from "express";
import { createMcpHandler } from "@modelcontextprotocol/server";
import { toNodeHandler } from "@modelcontextprotocol/node";
import { createSandboxTestContext } from "./helpers/test-context.js";
import { ConnectionManager } from "../src/db/connection-manager.js";
import { MigrationRunner } from "../src/db/migration-runner.js";
import { migrationV040 } from "../src/db/migrations/v040-agent-columns.js";
import { migrationV050Schema } from "../src/db/migrations/v050-target-schema.js";
import { IdentityAccessService } from "../src/services/identity-access-service.js";
import { ApprovalService } from "../src/services/approval-service.js";
import { WorkspaceArtifactService } from "../src/services/workspace-artifact-service.js";
import { ProjectTaskService } from "../src/services/project-task-service.js";
import { MessagingService } from "../src/services/messaging-service.js";
import { OrchestrationService } from "../src/services/orchestration-service.js";
import { createFullMcpServer } from "../src/registry-core.js";
import { HttpSecurityPipeline, LOCAL_GATEWAY_PROFILE } from "../src/security/http-security-pipeline.js";
import { requestContextStore } from "../src/security/context-store.js";
import {
  CompanyClaimTaskInputSchema,
  CompanyGetWorkspaceActivityInputSchema,
  CompanyListInboxInputSchema,
  CompanyReviewTaskInputSchema
} from "../src/contracts/mcp-tool-schemas.js";

function startLocalApp(app: express.Express): Promise<{ port: number; close: () => Promise<void> }> {
  return new Promise((resolve) => {
    const server = http.createServer(app);
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address() as any;
      resolve({
        port: addr.port,
        close: () => new Promise<void>((res) => server.close(() => res()))
      });
    });
  });
}

function parseJsonRpcOrSse(body: string): any {
  const sseLine = body.split("\n").find((line) => line.startsWith("data: "));
  if (sseLine) {
    return JSON.parse(sseLine.slice(6));
  }
  return JSON.parse(body);
}

function postMcpJsonRpc(port: number, token: string, payload: unknown): Promise<{ status: number; json: any }> {
  const bodyStr = JSON.stringify(payload);
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: "127.0.0.1",
        port,
        path: "/mcp",
        method: "POST",
        headers: {
          Host: `127.0.0.1:${port}`,
          "Content-Type": "application/json",
          Accept: "application/json, text/event-stream",
          "Content-Length": String(Buffer.byteLength(bodyStr)),
          Authorization: `Bearer ${token}`
        }
      },
      (res) => {
        let raw = "";
        res.on("data", (chunk) => {
          raw += chunk;
        });
        res.on("end", () => {
          try {
            resolve({ status: res.statusCode || 0, json: parseJsonRpcOrSse(raw) });
          } catch (err) {
            reject(new Error(`Failed to parse response (${res.statusCode}): ${raw} — ${(err as Error).message}`));
          }
        });
      }
    );
    req.on("error", reject);
    req.write(bodyStr);
    req.end();
  });
}

test("T19: Runtime Stabilization Regressions (F-02 to F-06)", async (t) => {
  const sandbox = createSandboxTestContext("aico-t19-stab-");
  const conn = new ConnectionManager(sandbox.dbPath);

  try {
    const runner = new MigrationRunner(conn);
    runner.runMigrations([migrationV040, migrationV050Schema]);

    const idService = new IdentityAccessService(conn);
    const appService = new ApprovalService(conn);
    const wsService = new WorkspaceArtifactService(sandbox.tempDir, conn);
    const taskService = new ProjectTaskService(conn, appService);
    const msgService = new MessagingService(conn);
    const orchService = new OrchestrationService(conn);

    const founderToken = idService.issueCredential({ principal_id: "founder-01", scopes: ["*"] }).token;
    const flash1Token = idService.issueCredential({
      principal_id: "flash-01",
      scopes: [
        "company:read",
        "tasks:manage",
        "tasks:transition",
        "tasks:review",
        "approvals:request",
        "workspace:read:self",
        "workspace:write:self",
        "workspace:audit:read",
        "messages:send",
        "messages:read"
      ]
    }).token;
    const flash2Token = idService.issueCredential({
      principal_id: "flash-02",
      scopes: [
        "company:read",
        "tasks:claim",
        "tasks:heartbeat",
        "tasks:transition",
        "tasks:submit",
        "tasks:review",
        "messages:send",
        "messages:read",
        "workspace:read:self",
        "workspace:write:self"
      ]
    }).token;
    const codexToken = idService.issueCredential({
      principal_id: "codex-01",
      scopes: ["tasks:claim", "tasks:heartbeat", "tasks:transition", "tasks:submit", "tasks:manage"]
    }).token;

    const founderCtx = idService.authenticateToken(founderToken, "local", "t19_founder");
    const flash1Ctx = idService.authenticateToken(flash1Token, "local", "t19_flash1");
    const flash2Ctx = idService.authenticateToken(flash2Token, "local", "t19_flash2");
    const codexCtx = idService.authenticateToken(codexToken, "local", "t19_codex");

    const localMcpServer = createFullMcpServer({
      isPublicGateway: false,
      connManager: conn,
      workspaceRoot: sandbox.tempDir,
      anchorFilePath: sandbox.anchorPath
    });
    const registeredTools = (localMcpServer as any)._registeredTools;

    const localProfile = {
      ...LOCAL_GATEWAY_PROFILE,
      allowedHosts: ["127.0.0.1"]
    };
    const localPipeline = new HttpSecurityPipeline(localProfile, idService);
    const nodeHandler = toNodeHandler(createMcpHandler(() => localMcpServer));
    const app = express();
    app.use(localPipeline.middleware());
    app.use(express.json({ limit: `${localProfile.maxBodySizeBytes}b` }));
    app.post("/mcp", (req, res) => {
      const principal = (req as any).principalContext;
      requestContextStore.run(principal, () => {
        nodeHandler(req, res, req.body);
      });
    });

    const httpSrv = await startLocalApp(app);

    try {
      // =====================================================================
      // 1. F-02: expected_version mandatory on M29 & M33 + claimTask/reviewTask
      // =====================================================================
      await t.test("F-02: M29 & M33 reject omitted expected_version instead of defaulting to 1", async () => {
        // Contract schemas reject omitted / non-positive / fractional expected_version
        assert.equal(CompanyClaimTaskInputSchema.safeParse({ task_id: "task_x" }).success, false);
        assert.equal(CompanyClaimTaskInputSchema.safeParse({ task_id: "task_x", expected_version: 0 }).success, false);
        assert.equal(CompanyClaimTaskInputSchema.safeParse({ task_id: "task_x", expected_version: 1.5 }).success, false);
        assert.equal(CompanyReviewTaskInputSchema.safeParse({ task_id: "task_x", decision: "completed" }).success, false);
        assert.equal(
          CompanyReviewTaskInputSchema.safeParse({ task_id: "task_x", expected_version: 0, decision: "completed" }).success,
          false
        );

        const task = taskService.createTask({
          ctx: flash1Ctx,
          title: "F-02 Optimistic Lock Task",
          assignedAgentId: "flash-02",
          riskClass: "low"
        });
        assert.equal(task.version, 1);

        // Advance draft(v1) -> queued(v2) -> assigned(v3)
        taskService.transitionTask({ ctx: flash1Ctx, taskId: task.task_id, expectedVersion: 1, toStatus: "queued" });
        taskService.transitionTask({ ctx: flash1Ctx, taskId: task.task_id, expectedVersion: 2, toStatus: "assigned" });

        // Direct service claimTask without expectedVersion throws VALIDATION_ERROR
        assert.throws(
          () => (taskService as any).claimTask({ ctx: flash2Ctx, taskId: task.task_id }),
          /VALIDATION_ERROR: claimTask requires a positive integer expectedVersion/
        );

        // Direct service reviewTask with invalid expectedVersion throws VALIDATION_ERROR
        assert.throws(
          () => taskService.reviewTask({ ctx: flash1Ctx, taskId: task.task_id, expectedVersion: 0, decision: "completed" }),
          /VALIDATION_ERROR: reviewTask expectedVersion must be a positive integer/
        );

        // Wire MCP JSON-RPC M29 without expected_version -> rejected at Zod schema layer
        const claimMissingVer = await postMcpJsonRpc(httpSrv.port, flash2Token, {
          jsonrpc: "2.0",
          method: "tools/call",
          params: {
            name: "company_claim_task",
            arguments: { task_id: task.task_id }
          },
          id: 101
        });
        assert.equal(claimMissingVer.status, 200);
        assert.ok(
          claimMissingVer.json.error || claimMissingVer.json.result?.isError === true,
          "M29 omitting expected_version must be rejected by MCP schema/handler"
        );

        // Direct M29 .handler without expected_version also fails
        const directMissingClaim = await requestContextStore.run(flash2Ctx, () =>
          registeredTools["company_claim_task"].handler({ task_id: task.task_id }, {})
        );
        assert.equal(directMissingClaim.isError, true);

        // Stale expected_version: 1 on M29 -> TASK_VERSION_CONFLICT
        const claimStaleVer = await postMcpJsonRpc(httpSrv.port, flash2Token, {
          jsonrpc: "2.0",
          method: "tools/call",
          params: {
            name: "company_claim_task",
            arguments: { task_id: task.task_id, expected_version: 1 }
          },
          id: 102
        });
        assert.equal(claimStaleVer.json.result?.isError, true);
        assert.match(claimStaleVer.json.result.content[0].text, /TASK_VERSION_CONFLICT/);

        // Real version 3 succeeds on M29 -> version 4
        const claimValid = await postMcpJsonRpc(httpSrv.port, flash2Token, {
          jsonrpc: "2.0",
          method: "tools/call",
          params: {
            name: "company_claim_task",
            arguments: { task_id: task.task_id, expected_version: 3 }
          },
          id: 103
        });
        assert.equal(claimValid.json.result?.isError, undefined);
        const claimedPayload = JSON.parse(claimValid.json.result.content[0].text);
        assert.equal(claimedPayload.execution_status, "claimed");
        assert.equal(claimedPayload.version, 4);

        // Move claimed(v4) -> in_progress(v5) -> review_required(v6)
        taskService.transitionTask({ ctx: flash2Ctx, taskId: task.task_id, expectedVersion: 4, toStatus: "in_progress" });
        taskService.submitTaskResult({
          ctx: flash2Ctx,
          taskId: task.task_id,
          expectedVersion: 5,
          outputArtifactIds: ["art_f02"],
          verificationEvidence: "verified F-02 flow"
        });

        // Wire MCP JSON-RPC M33 without expected_version -> rejected
        const reviewMissingVer = await postMcpJsonRpc(httpSrv.port, flash1Token, {
          jsonrpc: "2.0",
          method: "tools/call",
          params: {
            name: "company_review_task",
            arguments: { task_id: task.task_id, decision: "completed" }
          },
          id: 104
        });
        assert.ok(
          reviewMissingVer.json.error || reviewMissingVer.json.result?.isError === true,
          "M33 omitting expected_version must be rejected by MCP schema/handler"
        );

        // Direct M33 .handler without expected_version also fails
        const directMissingReview = await requestContextStore.run(flash1Ctx, () =>
          registeredTools["company_review_task"].handler({ task_id: task.task_id, decision: "completed" }, {})
        );
        assert.equal(directMissingReview.isError, true);
        assert.match(directMissingReview.content[0].text, /VALIDATION_ERROR.*expected_version/);

        // Stale expected_version: 1 on M33 -> TASK_VERSION_CONFLICT
        const reviewStaleVer = await postMcpJsonRpc(httpSrv.port, flash1Token, {
          jsonrpc: "2.0",
          method: "tools/call",
          params: {
            name: "company_review_task",
            arguments: { task_id: task.task_id, expected_version: 1, decision: "completed" }
          },
          id: 105
        });
        assert.equal(reviewStaleVer.json.result?.isError, true);
        assert.match(reviewStaleVer.json.result.content[0].text, /TASK_VERSION_CONFLICT/);

        // Real version 6 succeeds on M33 -> completed(v7)
        const reviewValid = await postMcpJsonRpc(httpSrv.port, flash1Token, {
          jsonrpc: "2.0",
          method: "tools/call",
          params: {
            name: "company_review_task",
            arguments: { task_id: task.task_id, expected_version: 6, decision: "completed" }
          },
          id: 106
        });
        assert.equal(reviewValid.json.result?.isError, undefined);
        const reviewedPayload = JSON.parse(reviewValid.json.result.content[0].text);
        assert.equal(reviewedPayload.execution_status, "completed");
        assert.equal(reviewedPayload.version, 7);
      });

      // =====================================================================
      // 2. F-03: heartbeatTask() expiry check, auth, CAS & recoverStaleLeases race
      // =====================================================================
      await t.test("F-03: heartbeatTask rejects expired leases & coordinates safely with recoverStaleLeases", async () => {
        const hbTask = taskService.createTask({
          ctx: flash1Ctx,
          title: "F-03 Heartbeat Lease Task",
          assignedAgentId: "flash-02",
          riskClass: "low"
        });

        // Reject heartbeat in draft state
        assert.throws(
          () => taskService.heartbeatTask({ ctx: flash2Ctx, taskId: hbTask.task_id }),
          /TASK_INVALID_STATE_TRANSITION/
        );

        // Advance to claimed(v4)
        taskService.transitionTask({ ctx: flash1Ctx, taskId: hbTask.task_id, expectedVersion: 1, toStatus: "queued" });
        taskService.transitionTask({ ctx: flash1Ctx, taskId: hbTask.task_id, expectedVersion: 2, toStatus: "assigned" });
        const claimed = taskService.claimTask({ ctx: flash2Ctx, taskId: hbTask.task_id, expectedVersion: 3 });
        assert.equal(claimed.version, 4);

        // Reject unauthenticated call
        assert.throws(
          () => taskService.heartbeatTask({ taskId: hbTask.task_id }),
          /AUTHENTICATION_REQUIRED/
        );

        // Reject wrong lease owner (codex-01 trying to heartbeat flash-02's lease)
        assert.throws(
          () => taskService.heartbeatTask({ ctx: codexCtx, taskId: hbTask.task_id }),
          /ABAC_OWNERSHIP_OR_SOD_VIOLATION/
        );

        // Reject expectedVersion mismatch
        assert.throws(
          () => taskService.heartbeatTask({ ctx: flash2Ctx, taskId: hbTask.task_id, expectedVersion: 99 }),
          /TASK_VERSION_CONFLICT/
        );

        // Valid heartbeat while active extends lease without bumping version
        const renewed = taskService.heartbeatTask({ ctx: flash2Ctx, taskId: hbTask.task_id, expectedVersion: 4 });
        assert.equal(renewed.version, 4);
        assert.ok(renewed.lease_expires_at && Date.parse(renewed.lease_expires_at) > Date.now());

        // Move to in_progress(v5), expire lease, then attempt heartbeat before recovery
        taskService.transitionTask({ ctx: flash2Ctx, taskId: hbTask.task_id, expectedVersion: 4, toStatus: "in_progress" });
        const expiredIso = new Date(Date.now() - 5_000).toISOString();
        conn.withWriteTransaction((db) => {
          db.prepare("UPDATE tasks SET lease_expires_at = ? WHERE task_id = ?").run(expiredIso, hbTask.task_id);
        });

        // Expired lease MUST be rejected with TASK_LEASE_EXPIRED and remain unchanged in DB
        assert.throws(
          () => taskService.heartbeatTask({ ctx: flash2Ctx, taskId: hbTask.task_id }),
          /TASK_LEASE_EXPIRED/
        );
        const stillExpired = taskService.getTask(hbTask.task_id)!;
        assert.equal(stillExpired.lease_expires_at, expiredIso);
        assert.equal(stillExpired.execution_status, "in_progress");

        // Second independent ConnectionManager simulates recovery daemon winning/completing sweep
        const recoveryConn = new ConnectionManager(sandbox.dbPath);
        const recoveryTaskService = new ProjectTaskService(recoveryConn, new ApprovalService(recoveryConn));

        // Concurrent/overlapping operations across two DB connections on the same sandbox DB
        const raceResults = await Promise.all([
          Promise.resolve().then(() => {
            try {
              taskService.heartbeatTask({ ctx: flash2Ctx, taskId: hbTask.task_id });
              return { kind: "heartbeat_ok" as const };
            } catch (err: any) {
              return { kind: "heartbeat_err" as const, msg: err.message as string };
            }
          }),
          Promise.resolve().then(() => recoveryTaskService.recoverStaleLeases())
        ]);

        const hbOutcome = raceResults[0];
        const recOutcome = raceResults[1];
        assert.equal(hbOutcome.kind, "heartbeat_err");
        assert.match(hbOutcome.msg, /(TASK_LEASE_EXPIRED|TASK_INVALID_STATE_TRANSITION)/);
        assert.equal(recOutcome.recovered, 1);

        // After recovery, heartbeat cannot resurrect task back into active lease
        assert.throws(
          () => taskService.heartbeatTask({ ctx: flash2Ctx, taskId: hbTask.task_id }),
          /TASK_INVALID_STATE_TRANSITION/
        );

        const afterRecovery = taskService.getTask(hbTask.task_id)!;
        assert.equal(afterRecovery.execution_status, "assigned");
        assert.equal(afterRecovery.lease_owner_agent_id, null);
        assert.equal(afterRecovery.lease_expires_at, null);
        assert.equal(afterRecovery.retry_count, 1);

        // Active lease renewed -> recoverStaleLeases sees 0 stale tasks
        const reclaimed = taskService.claimTask({
          ctx: flash2Ctx,
          taskId: hbTask.task_id,
          expectedVersion: afterRecovery.version
        });
        taskService.heartbeatTask({ ctx: flash2Ctx, taskId: hbTask.task_id, expectedVersion: reclaimed.version });
        const noRecovery = recoveryTaskService.recoverStaleLeases();
        assert.equal(noRecovery.recovered, 0);

        // Wire MCP M30 (company_heartbeat_task) checks over HTTP JSON-RPC
        const wireHbValid = await postMcpJsonRpc(httpSrv.port, flash2Token, {
          jsonrpc: "2.0",
          method: "tools/call",
          params: {
            name: "company_heartbeat_task",
            arguments: { task_id: hbTask.task_id, expected_version: reclaimed.version }
          },
          id: 301
        });
        assert.equal(wireHbValid.json.result?.isError, undefined);
        const wireHbPayload = JSON.parse(wireHbValid.json.result.content[0].text);
        assert.equal(wireHbPayload.success, true);
        assert.equal(wireHbPayload.task_id, hbTask.task_id);
        assert.ok(wireHbPayload.lease_expires_at);

        // Wire M30 rejects stale expected_version
        const wireHbConflict = await postMcpJsonRpc(httpSrv.port, flash2Token, {
          jsonrpc: "2.0",
          method: "tools/call",
          params: {
            name: "company_heartbeat_task",
            arguments: { task_id: hbTask.task_id, expected_version: 99 }
          },
          id: 302
        });
        assert.equal(wireHbConflict.json.result?.isError, true);
        assert.match(wireHbConflict.json.result.content[0].text, /TASK_VERSION_CONFLICT/);

        // Wire M30 rejects expired lease
        conn.withWriteTransaction((db) => {
          db.prepare("UPDATE tasks SET lease_expires_at = ? WHERE task_id = ?").run(
            new Date(Date.now() - 5_000).toISOString(),
            hbTask.task_id
          );
        });
        const wireHbExpired = await postMcpJsonRpc(httpSrv.port, flash2Token, {
          jsonrpc: "2.0",
          method: "tools/call",
          params: {
            name: "company_heartbeat_task",
            arguments: { task_id: hbTask.task_id }
          },
          id: 303
        });
        assert.equal(wireHbExpired.json.result?.isError, true);
        assert.match(wireHbExpired.json.result.content[0].text, /TASK_LEASE_EXPIRED/);
      });

      // =====================================================================
      // 3. F-04: Bounded limits in listInbox(), listActivities(), M36 & M22
      // =====================================================================
      await t.test("F-04: listInbox & listActivities enforce integer limits 1..100 (default 50)", async () => {
        // Schema checks on M22 & M36
        assert.equal(CompanyListInboxInputSchema.safeParse({}).success, true);
        assert.equal(CompanyListInboxInputSchema.parse({}).limit, 50);
        assert.equal(CompanyListInboxInputSchema.safeParse({ limit: 0 }).success, false);
        assert.equal(CompanyListInboxInputSchema.safeParse({ limit: -1 }).success, false);
        assert.equal(CompanyListInboxInputSchema.safeParse({ limit: 101 }).success, false);
        assert.equal(CompanyListInboxInputSchema.safeParse({ limit: 1.5 }).success, false);

        assert.equal(CompanyGetWorkspaceActivityInputSchema.parse({}).limit, 50);
        assert.equal(CompanyGetWorkspaceActivityInputSchema.safeParse({ limit: 0 }).success, false);
        assert.equal(CompanyGetWorkspaceActivityInputSchema.safeParse({ limit: -1 }).success, false);
        assert.equal(CompanyGetWorkspaceActivityInputSchema.safeParse({ limit: 101 }).success, false);

        // Seed 60 inbox messages for flash-02 & 60 workspace activities for flash-01
        for (let i = 0; i < 60; i++) {
          msgService.sendMessage({
            ctx: flash1Ctx,
            fromPrincipalId: "flash-01",
            toPrincipalId: "flash-02",
            subject: `Msg ${i}`,
            bodyMarkdown: `Body ${i}`
          });
        }
        conn.withWriteTransaction((db) => {
          const wsRow = db
            .prepare("SELECT workspace_id FROM agent_workspaces WHERE agent_id = 'flash-01' LIMIT 1")
            .get() as { workspace_id: string } | undefined;
          const workspaceId = wsRow?.workspace_id || "ws_flash1";
          const nowIso = new Date().toISOString();
          for (let i = 0; i < 60; i++) {
            db.prepare(`
              INSERT INTO agent_workspace_activities
                (request_id, agent_id, workspace_id, action_type, target_path, status, bytes_count, recorded_at)
              VALUES (?, 'flash-01', ?, 'read', ?, 'succeeded', 12, ?)
            `).run(`req_f04_${i}`, workspaceId, `reports/item_${i}.txt`, nowIso);
          }
        });

        // Service default limit (50) and custom bounds (1, 100)
        assert.equal(msgService.listInbox("flash-02").length, 50);
        assert.equal(msgService.listInbox("flash-02", { limit: 1 }).length, 1);
        assert.equal(msgService.listInbox("flash-02", { limit: 100 }).length, 60);

        assert.equal(wsService.listActivities({ agentId: "flash-01" }).length, 50);
        assert.equal(wsService.listActivities({ agentId: "flash-01", limit: 7 }).length, 7);
        assert.equal(wsService.listActivities({ agentId: "flash-01", limit: 100 }).length >= 60, true);

        // Invalid limits rejected at service layer (cannot bypass via 0, -1, >100, float)
        for (const badLimit of [0, -1, -50, 101, 1.5, Number.NaN]) {
          assert.throws(
            () => msgService.listInbox("flash-02", { limit: badLimit }),
            /VALIDATION_ERROR: limit must be an integer between 1 and 100/
          );
          assert.throws(
            () => wsService.listActivities({ agentId: "flash-01", limit: badLimit }),
            /VALIDATION_ERROR: limit must be an integer between 1 and 100/
          );
        }

        // Wire MCP JSON-RPC tests for M36 and M22
        const m36Bad = await postMcpJsonRpc(httpSrv.port, flash2Token, {
          jsonrpc: "2.0",
          method: "tools/call",
          params: { name: "company_list_inbox", arguments: { limit: -1 } },
          id: 201
        });
        assert.ok(m36Bad.json.error || m36Bad.json.result?.isError === true);

        const m36Valid = await postMcpJsonRpc(httpSrv.port, flash2Token, {
          jsonrpc: "2.0",
          method: "tools/call",
          params: { name: "company_list_inbox", arguments: { limit: 5 } },
          id: 202
        });
        assert.equal(m36Valid.json.result?.isError, undefined);
        assert.equal(JSON.parse(m36Valid.json.result.content[0].text).count, 5);

        const m22Bad = await postMcpJsonRpc(httpSrv.port, founderToken, {
          jsonrpc: "2.0",
          method: "tools/call",
          params: { name: "company_get_workspace_activity", arguments: { agent_id: "flash-01", limit: 101 } },
          id: 203
        });
        assert.ok(m22Bad.json.error || m22Bad.json.result?.isError === true);

        const m22Valid = await postMcpJsonRpc(httpSrv.port, founderToken, {
          jsonrpc: "2.0",
          method: "tools/call",
          params: { name: "company_get_workspace_activity", arguments: { agent_id: "flash-01", limit: 10 } },
          id: 204
        });
        assert.equal(m22Valid.json.result?.isError, undefined);
        assert.equal(JSON.parse(m22Valid.json.result.content[0].text).count, 10);
      });

      // =====================================================================
      // 4. F-05: OrchestrationService external dispatch state matrix, CAS & idempotency
      // =====================================================================
      await t.test("F-05: recordExternalDispatchMilestone enforces transition matrix, CAS & idempotent retry", async () => {
        const extTask = taskService.createTask({
          ctx: flash1Ctx,
          title: "F-05 External Dispatch Task",
          assignedAgentId: "chatgpt-01",
          riskClass: "medium"
        });

        // Unauthenticated fails
        assert.throws(
          () => orchService.recordExternalDispatchMilestone({
            taskId: extTask.task_id,
            milestone: "operator_delivered",
            actorPrincipalId: "flash-01"
          }),
          /AUTHENTICATION_REQUIRED/
        );

        // Disallowed in draft execution_status
        assert.throws(
          () => orchService.recordExternalDispatchMilestone({
            taskId: extTask.task_id,
            milestone: "operator_delivered",
            actorPrincipalId: "flash-01"
          }, flash1Ctx),
          /DISPATCH_INVALID_STATE_TRANSITION/
        );

        // Advance draft(v1) -> queued(v2) -> assigned(v3, queued_for_client_pull)
        taskService.transitionTask({ ctx: flash1Ctx, taskId: extTask.task_id, expectedVersion: 1, toStatus: "queued" });
        taskService.transitionTask({ ctx: flash1Ctx, taskId: extTask.task_id, expectedVersion: 2, toStatus: "assigned" });

        // Unauthorized agent fails ABAC
        assert.throws(
          () => orchService.recordExternalDispatchMilestone({
            taskId: extTask.task_id,
            milestone: "operator_delivered",
            actorPrincipalId: "codex-01"
          }, codexCtx),
          /PERMISSION_DENIED/
        );

        // Simulate delivery_failed -> version 4
        const failStep = orchService.recordExternalDispatchMilestone({
          taskId: extTask.task_id,
          milestone: "delivery_failed",
          actorPrincipalId: "flash-01",
          expectedVersion: 3,
          notes: "Transient operator handoff failure"
        }, flash1Ctx);
        assert.equal(failStep.dispatch_status, "delivery_failed");
        assert.equal(failStep.version, 4);
        assert.equal(failStep.idempotent_replay, false);

        // Cannot jump directly from delivery_failed -> external_invocation_confirmed
        assert.throws(
          () => orchService.recordExternalDispatchMilestone({
            taskId: extTask.task_id,
            milestone: "external_invocation_confirmed",
            actorPrincipalId: "flash-01"
          }, flash1Ctx),
          /DISPATCH_INVALID_STATE_TRANSITION/
        );

        // Retry operator_delivered from delivery_failed -> operator_delivered (version 5)
        const deliveredStep = orchService.recordExternalDispatchMilestone({
          taskId: extTask.task_id,
          milestone: "operator_delivered",
          actorPrincipalId: "flash-01",
          expectedVersion: 4,
          notes: "Retry succeeded"
        }, flash1Ctx);
        assert.equal(deliveredStep.dispatch_status, "operator_delivered");
        assert.equal(deliveredStep.version, 5);
        assert.equal(deliveredStep.idempotent_replay, false);

        // Confirm invocation -> external_running (version 6)
        const confirmedStep = orchService.recordExternalDispatchMilestone({
          taskId: extTask.task_id,
          milestone: "external_invocation_confirmed",
          actorPrincipalId: "flash-01",
          expectedVersion: 5
        }, flash1Ctx);
        assert.equal(confirmedStep.dispatch_status, "external_running");
        assert.equal(confirmedStep.version, 6);
        assert.equal(confirmedStep.idempotent_replay, false);

        // Stale backward milestones must NEVER overwrite external_running
        assert.throws(
          () => orchService.recordExternalDispatchMilestone({
            taskId: extTask.task_id,
            milestone: "operator_delivered",
            actorPrincipalId: "flash-01"
          }, flash1Ctx),
          /DISPATCH_INVALID_STATE_TRANSITION/
        );
        assert.throws(
          () => orchService.recordExternalDispatchMilestone({
            taskId: extTask.task_id,
            milestone: "delivery_failed",
            actorPrincipalId: "flash-01"
          }, flash1Ctx),
          /DISPATCH_INVALID_STATE_TRANSITION/
        );

        // Stale expectedVersion fails CAS
        assert.throws(
          () => orchService.recordExternalDispatchMilestone({
            taskId: extTask.task_id,
            milestone: "external_invocation_confirmed",
            actorPrincipalId: "flash-01",
            expectedVersion: 4
          }, flash1Ctx),
          /TASK_VERSION_CONFLICT/
        );

        // Idempotent replay of current milestone returns idempotent_replay: true without version bump
        const replay = orchService.recordExternalDispatchMilestone({
          taskId: extTask.task_id,
          milestone: "external_invocation_confirmed",
          actorPrincipalId: "flash-01",
          expectedVersion: 6
        }, flash1Ctx);
        assert.equal(replay.dispatch_status, "external_running");
        assert.equal(replay.version, 6);
        assert.equal(replay.idempotent_replay, true);

        // Persisted timestamps & task_events audit trail verified
        const persistedTask = taskService.getTask(extTask.task_id)!;
        assert.equal(persistedTask.dispatch_status, "external_running");
        assert.ok(persistedTask.operator_delivered_at);
        assert.ok(persistedTask.external_invoked_at);

        const dispatchEvents = conn.withReadTransaction((db) =>
          db
            .prepare("SELECT * FROM task_events WHERE task_id = ? AND event_type = 'external_dispatch_milestone' ORDER BY event_id ASC")
            .all(extTask.task_id) as any[]
        );
        assert.equal(dispatchEvents.length, 3);
        assert.deepEqual(
          dispatchEvents.map((e) => `${e.from_dispatch_status}->${e.to_dispatch_status}`),
          [
            "queued_for_client_pull->delivery_failed",
            "delivery_failed->operator_delivered",
            "operator_delivered->external_running"
          ]
        );

        // Wire MCP M34 (company_record_external_dispatch) checks over HTTP JSON-RPC
        const wireExtTask = taskService.createTask({
          ctx: flash1Ctx,
          title: "F-05 Wire M34 Dispatch Task",
          assignedAgentId: "chatgpt-01",
          riskClass: "medium"
        });
        taskService.transitionTask({ ctx: flash1Ctx, taskId: wireExtTask.task_id, expectedVersion: 1, toStatus: "queued" });
        taskService.transitionTask({ ctx: flash1Ctx, taskId: wireExtTask.task_id, expectedVersion: 2, toStatus: "assigned" });

        // M34: operator_delivered (v3 -> v4)
        const wireM34Delivered = await postMcpJsonRpc(httpSrv.port, flash1Token, {
          jsonrpc: "2.0",
          method: "tools/call",
          params: {
            name: "company_record_external_dispatch",
            arguments: { task_id: wireExtTask.task_id, milestone: "operator_delivered", expected_version: 3 }
          },
          id: 401
        });
        assert.equal(wireM34Delivered.json.result?.isError, undefined);
        const m34DeliveredPayload = JSON.parse(wireM34Delivered.json.result.content[0].text);
        assert.equal(m34DeliveredPayload.dispatch_status, "operator_delivered");
        assert.equal(m34DeliveredPayload.version, 4);

        // M34: external_invocation_confirmed (v4 -> v5)
        const wireM34Confirmed = await postMcpJsonRpc(httpSrv.port, flash1Token, {
          jsonrpc: "2.0",
          method: "tools/call",
          params: {
            name: "company_record_external_dispatch",
            arguments: { task_id: wireExtTask.task_id, milestone: "external_invocation_confirmed", expected_version: 4 }
          },
          id: 402
        });
        assert.equal(wireM34Confirmed.json.result?.isError, undefined);
        const m34ConfirmedPayload = JSON.parse(wireM34Confirmed.json.result.content[0].text);
        assert.equal(m34ConfirmedPayload.dispatch_status, "external_running");
        assert.equal(m34ConfirmedPayload.version, 5);
        assert.equal(m34ConfirmedPayload.idempotent_replay, false);

        // M34 rejects stale backward transition (operator_delivered after external_running)
        const wireM34StaleBack = await postMcpJsonRpc(httpSrv.port, flash1Token, {
          jsonrpc: "2.0",
          method: "tools/call",
          params: {
            name: "company_record_external_dispatch",
            arguments: { task_id: wireExtTask.task_id, milestone: "operator_delivered" }
          },
          id: 403
        });
        assert.equal(wireM34StaleBack.json.result?.isError, true);
        assert.match(wireM34StaleBack.json.result.content[0].text, /DISPATCH_INVALID_STATE_TRANSITION/);

        // M34 idempotent replay returns idempotent_replay: true without version bump
        const wireM34Replay = await postMcpJsonRpc(httpSrv.port, flash1Token, {
          jsonrpc: "2.0",
          method: "tools/call",
          params: {
            name: "company_record_external_dispatch",
            arguments: { task_id: wireExtTask.task_id, milestone: "external_invocation_confirmed", expected_version: 5 }
          },
          id: 404
        });
        assert.equal(wireM34Replay.json.result?.isError, undefined);
        const m34ReplayPayload = JSON.parse(wireM34Replay.json.result.content[0].text);
        assert.equal(m34ReplayPayload.dispatch_status, "external_running");
        assert.equal(m34ReplayPayload.version, 5);
        assert.equal(m34ReplayPayload.idempotent_replay, true);
      });

      // =====================================================================
      // 5. F-06: Consistent P0 / critical initial governance & transitions
      // =====================================================================
      await t.test("F-06: P0 tasks require initial waiting_approval & cannot skip TR-01 even with medium/low risk", () => {
        const p0MedTask = taskService.createTask({
          ctx: flash1Ctx,
          title: "F-06 P0 Medium Risk Task",
          assignedAgentId: "flash-02",
          priority: "P0",
          riskClass: "medium"
        });
        assert.equal(p0MedTask.execution_status, "waiting_approval");
        assert.equal(p0MedTask.dispatch_status, "approval_pending");

        const p0LowTask = taskService.createTask({
          ctx: flash1Ctx,
          title: "F-06 P0 Low Risk Task",
          assignedAgentId: "flash-02",
          priority: "P0",
          riskClass: "low"
        });
        assert.equal(p0LowTask.execution_status, "waiting_approval");
        assert.equal(p0LowTask.dispatch_status, "approval_pending");

        // Legacy/tampered P0 row sitting in draft cannot skip waiting_approval via TR-01
        conn.withWriteTransaction((db) => {
          db.prepare("UPDATE tasks SET execution_status = 'draft', dispatch_status = 'not_dispatched' WHERE task_id = ?")
            .run(p0LowTask.task_id);
        });
        assert.throws(
          () => taskService.transitionTask({ ctx: flash1Ctx, taskId: p0LowTask.task_id, expectedVersion: 1, toStatus: "queued" }),
          /TASK_INVALID_STATE_TRANSITION: Critical, P0, or Argon task in draft must go to waiting_approval/
        );

        // P0 task in waiting_approval requires Founder critical_task_approval before TR-04
        assert.throws(
          () => taskService.transitionTask({ ctx: flash1Ctx, taskId: p0MedTask.task_id, expectedVersion: 1, toStatus: "queued" }),
          /CRITICAL_TASK_APPROVAL_REQUIRED/
        );

        const appr = appService.createApprovalRequest({
          ctx: flash1Ctx,
          action_type: "critical_task_approval",
          target_agent_id: "flash-02",
          target_resource: `task:${p0MedTask.task_id}`,
          canonical_payload: { taskId: p0MedTask.task_id, riskClass: "medium", priority: "P0" },
          approval_tier: "founder",
          reason: "Authorize P0 medium-risk task execution"
        });
        appService.decideApproval({ ctx: founderCtx, approval_id: appr.approval_id, decision: "approved" });

        // Complete end-to-end lifecycle for approved P0 task
        const queued = taskService.transitionTask({
          ctx: flash1Ctx,
          taskId: p0MedTask.task_id,
          expectedVersion: 1,
          toStatus: "queued",
          approvalId: appr.approval_id
        });
        assert.equal(queued.execution_status, "queued");

        const assigned = taskService.transitionTask({
          ctx: flash1Ctx,
          taskId: p0MedTask.task_id,
          expectedVersion: 2,
          toStatus: "assigned"
        });
        const claimed = taskService.claimTask({ ctx: flash2Ctx, taskId: p0MedTask.task_id, expectedVersion: assigned.version });
        const inProg = taskService.transitionTask({
          ctx: flash2Ctx,
          taskId: p0MedTask.task_id,
          expectedVersion: claimed.version,
          toStatus: "in_progress"
        });
        const submitted = taskService.submitTaskResult({
          ctx: flash2Ctx,
          taskId: p0MedTask.task_id,
          expectedVersion: inProg.version,
          outputArtifactIds: ["art_p0_ok"],
          verificationEvidence: "P0 regression passed"
        });
        const reviewed = taskService.reviewTask({
          ctx: flash1Ctx,
          taskId: p0MedTask.task_id,
          expectedVersion: submitted.version,
          decision: "completed"
        });
        assert.equal(reviewed.execution_status, "completed");
      });
    } finally {
      await httpSrv.close();
    }
  } finally {
    sandbox.cleanup();
  }
});
