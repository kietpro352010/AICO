import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import express from "express";
import { DatabaseSync } from "node:sqlite";
import { createMcpHandler } from "@modelcontextprotocol/server";
import { toNodeHandler } from "@modelcontextprotocol/node";
import { createSandboxTestContext, issueTestPrincipalContext } from "./helpers/test-context.js";
import { ConnectionManager } from "../src/db/connection-manager.js";
import { MigrationRunner } from "../src/db/migration-runner.js";
import { migrationV040 } from "../src/db/migrations/v040-agent-columns.js";
import { migrationV050Schema } from "../src/db/migrations/v050-target-schema.js";
import { IdentityAccessService } from "../src/services/identity-access-service.js";
import { ApprovalService } from "../src/services/approval-service.js";
import { WorkspaceArtifactService } from "../src/services/workspace-artifact-service.js";
import { ProjectTaskService } from "../src/services/project-task-service.js";
import { MessagingService } from "../src/services/messaging-service.js";
import { KnowledgeMemoryService } from "../src/services/knowledge-memory-service.js";
import { ObservabilityQuotaService } from "../src/services/observability-quota-service.js";
import { GitMediationService } from "../src/services/git-mediation-service.js";
import { AgentIdentityService } from "../src/agent-identity-service.js";
import { WorkspaceManager } from "../src/workspace-manager.js";
import { createBaseMcpServer, createFullMcpServer } from "../src/registry-core.js";
import {
  CompanyTransitionTaskInputSchema,
  CompanySubmitTaskResultInputSchema
} from "../src/contracts/mcp-tool-schemas.js";
import {
  HttpSecurityPipeline,
  LOCAL_GATEWAY_PROFILE,
  PUBLIC_GATEWAY_PROFILE,
  configureGatewayHttpServer,
  type GatewaySecurityProfile
} from "../src/security/http-security-pipeline.js";
import { requestContextStore, type PrincipalContext } from "../src/security/context-store.js";
import {
  resolveContainedAbsoluteRootPath,
  resolveContainedWorkspacePath
} from "../src/security/path-containment.js";

function startGatewayServer(
  app: express.Express,
  profile: GatewaySecurityProfile
): Promise<{ port: number; close: () => Promise<void> }> {
  return new Promise((resolve) => {
    const server = configureGatewayHttpServer(http.createServer(app), profile);
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address() as { port: number };
      resolve({
        port: addr.port,
        close: () =>
          new Promise<void>((res) => {
            server.closeIdleConnections?.();
            server.close(() => res());
          })
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

function postJsonRpc(
  port: number,
  token: string | null,
  payload: unknown
): Promise<{ status: number; json: any }> {
  const bodyStr = JSON.stringify(payload);
  const headers: Record<string, string> = {
    Host: `127.0.0.1:${port}`,
    "Content-Type": "application/json",
    Accept: "application/json, text/event-stream",
    "Content-Length": String(Buffer.byteLength(bodyStr)),
    Connection: "close"
  };
  if (token !== null) {
    headers.Authorization = `Bearer ${token}`;
  }

  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: "127.0.0.1",
        port,
        path: "/mcp",
        method: "POST",
        agent: false,
        headers
      },
      (res) => {
        let raw = "";
        res.on("data", (chunk) => {
          raw += chunk;
        });
        res.on("end", () => {
          resolve({ status: res.statusCode || 0, json: parseJsonRpcOrSse(raw) });
        });
      }
    );
    req.on("error", reject);
    req.write(bodyStr);
    req.end();
  });
}

function buildGatewayHttpApp(params: {
  isPublicGateway: boolean;
  conn: ConnectionManager;
  idService: IdentityAccessService;
  workspaceRoot: string;
  anchorFilePath: string;
  hmacKey: string;
}): express.Express {
  const profile = params.isPublicGateway
    ? { ...PUBLIC_GATEWAY_PROFILE, allowedHosts: ["127.0.0.1"] }
    : { ...LOCAL_GATEWAY_PROFILE, allowedHosts: ["127.0.0.1"] };
  const pipeline = new HttpSecurityPipeline(profile, params.idService);
  const mcpServer = createFullMcpServer({
    isPublicGateway: params.isPublicGateway,
    connManager: params.conn,
    workspaceRoot: params.workspaceRoot,
    anchorFilePath: params.anchorFilePath,
    hmacKey: params.hmacKey
  });
  const nodeHandler = toNodeHandler(createMcpHandler(() => mcpServer));
  const app = express();
  app.use(express.json({ limit: `${profile.maxBodySizeBytes}b` }));
  app.use(pipeline.middleware());
  app.post("/mcp", (req, res) => {
    const principal = (req as any).principalContext as PrincipalContext;
    requestContextStore.run(principal, () => {
      nodeHandler(req, res, req.body);
    });
  });
  return app;
}

const TEST_HMAC_KEY = "t20_p0_remediation_hmac_secret_32bytes!";

test("T20: P0 Security Remediation Suite (P0-01 to P0-04)", async (t) => {
  await t.test("P0-01: Per-agent workspace containment, Win32 artifact defense & symlink/junction escape blocking", () => {
    const sandbox = createSandboxTestContext("aico-t20-p01-");
    const conn = new ConnectionManager(sandbox.dbPath);
    const runner = new MigrationRunner(conn);
    runner.runMigrations([migrationV040, migrationV050Schema]);

    const idService = new IdentityAccessService(conn);
    const flash1Ctx = issueTestPrincipalContext(idService, "flash-01", [
      "workspace:read:self",
      "workspace:write:self"
    ]);
    const flash2Ctx = issueTestPrincipalContext(idService, "flash-02", [
      "workspace:read:self",
      "workspace:write:self"
    ]);

    const wsRoot = path.join(sandbox.tempDir, "ws-root");
    const outsideDir = path.join(sandbox.tempDir, "outside-secret");
    fs.mkdirSync(outsideDir, { recursive: true });
    fs.writeFileSync(path.join(outsideDir, "vault.txt"), "top-secret-outside", "utf8");

    const wsService = new WorkspaceArtifactService(wsRoot, conn);

    try {
      // Positive isolated write & read
      const written = wsService.writeArtifact({
        agentId: "flash-01",
        relativePath: "notes/clean-note.md",
        content: "Isolated content",
        ctx: flash1Ctx
      });
      assert.ok(written.bytes_written > 0);
      assert.equal(wsService.readArtifact("flash-01", "notes/clean-note.md", flash1Ctx).content, "Isolated content");

      // Traversal, Win32 artifacts, UNC, drive letters, null bytes, invalid agentId
      const badRelativePaths = [
        "../codex-01/secret.txt",
        "..\\codex-01\\secret.txt",
        "dir/../../outside.txt",
        "../outside/..",
        ".../secret.txt",
        "notes/file.",
        "notes/file ",
        "notes/file.txt::$DATA",
        "notes/file.txt:altstream",
        "\\\\127.0.0.1\\c$\\secret.txt",
        "//server/share/secret.txt",
        "\\??\\C:\\secret.txt",
        "C:\\Windows\\win.ini",
        "D:relative.txt",
        "notes/safe.txt\0.js",
        "notes/safe%00.txt"
      ];

      for (const badPath of badRelativePaths) {
        assert.throws(
          () => wsService.writeArtifact({ agentId: "flash-01", relativePath: badPath, content: "x", ctx: flash1Ctx }),
          /WORKSPACE_PATH_SECURITY_VIOLATION/,
          `writeArtifact must block '${badPath}'`
        );
        assert.throws(
          () => wsService.readArtifact("flash-01", badPath, flash1Ctx),
          /WORKSPACE_PATH_SECURITY_VIOLATION/,
          `readArtifact must block '${badPath}'`
        );
      }

      for (const badAgent of ["../codex-01", "flash-01.", "flash-01 ", "flash-01:ads", "a/b"]) {
        assert.throws(
          () => wsService.writeArtifact({ agentId: badAgent, relativePath: "notes/ok.txt", content: "x", ctx: flash1Ctx }),
          /WORKSPACE_PATH_SECURITY_VIOLATION/,
          `Must reject malformed agentId '${badAgent}'`
        );
      }

      // Real OS directory junction inside agent workspace -> outsideDir
      const innerEscapeJunction = path.join(wsRoot, "workspaces", "flash-01", "escape_dir");
      fs.symlinkSync(outsideDir, innerEscapeJunction, "junction");

      assert.throws(
        () => wsService.readArtifact("flash-01", "escape_dir/vault.txt", flash1Ctx),
        /WORKSPACE_PATH_SECURITY_VIOLATION: Symlink escape denied/
      );
      assert.throws(
        () =>
          wsService.writeArtifact({
            agentId: "flash-01",
            relativePath: "escape_dir/dangling_sub/payload.txt",
            content: "pwned",
            ctx: flash1Ctx
          }),
        /WORKSPACE_PATH_SECURITY_VIOLATION: Symlink escape denied/
      );
      assert.throws(
        () =>
          wsService.shareArtifact({
            fromAgentId: "flash-01",
            toAgentId: "flash-02",
            sourceRelativePath: "escape_dir/vault.txt",
            ctx: flash1Ctx
          }),
        /WORKSPACE_PATH_SECURITY_VIOLATION: Symlink escape denied/
      );

      const listed = wsService.listFiles({ agentId: "flash-01", recursive: true, ctx: flash1Ctx });
      assert.equal(listed.files.some((f) => f.relative_path.includes("escape_dir") || f.relative_path.includes("vault.txt")), false);

      // Real OS directory junction replacing agent workspace root itself (codex-01 -> outsideDir)
      const codexCtx = issueTestPrincipalContext(idService, "codex-01", [
        "workspace:read:self",
        "workspace:write:self"
      ]);
      const codexRootJunction = path.join(wsRoot, "workspaces", "codex-01");
      fs.symlinkSync(outsideDir, codexRootJunction, "junction");

      assert.throws(
        () => wsService.writeArtifact({ agentId: "codex-01", relativePath: "evil.txt", content: "x", ctx: codexCtx }),
        /WORKSPACE_PATH_SECURITY_VIOLATION: Symlink or junction escape denied on agent workspace 'codex-01'/
      );
      assert.throws(
        () => wsService.readArtifact("codex-01", "vault.txt", codexCtx),
        /WORKSPACE_PATH_SECURITY_VIOLATION: Symlink or junction escape denied on agent workspace 'codex-01'/
      );

      // Synthetic fsOps tests for dangling/nested symlinks
      const syntheticRoot = path.resolve(sandbox.tempDir, "syn");
      const outsideSyn = path.resolve(sandbox.tempDir, "outside-secret");
      const existingPaths = new Set([
        syntheticRoot,
        path.join(syntheticRoot, "workspaces"),
        path.join(syntheticRoot, "workspaces", "flash-01"),
        path.join(syntheticRoot, "workspaces", "flash-01", "evil-link"),
        path.join(syntheticRoot, "evil-link")
      ]);
      const fakeFs = {
        existsSync: (p: string) => existingPaths.has(path.resolve(p)),
        lstatSync: (p: string) => {
          const resolved = path.resolve(p);
          if (!existingPaths.has(resolved)) {
            throw Object.assign(new Error(`ENOENT: ${resolved}`), { code: "ENOENT" });
          }
          return {
            isSymbolicLink: () => path.basename(resolved) === "evil-link"
          };
        },
        realpathSync: (p: string) => {
          const resolved = path.resolve(p);
          if (!existingPaths.has(resolved)) {
            throw Object.assign(new Error(`ENOENT: ${resolved}`), { code: "ENOENT" });
          }
          if (path.basename(resolved) === "evil-link") return outsideSyn;
          return resolved;
        },
        readlinkSync: () => outsideSyn
      };
      assert.throws(
        () =>
          resolveContainedWorkspacePath({
            baseDir: syntheticRoot,
            subfolder: "workspaces",
            agentId: "flash-01",
            relativePath: "evil-link/missing-child/file.txt",
            ensureRootExists: false,
            fsOps: fakeFs
          }),
        /WORKSPACE_PATH_SECURITY_VIOLATION: Symlink escape denied/
      );
      assert.throws(
        () =>
          resolveContainedAbsoluteRootPath({
            workspaceRoot: syntheticRoot,
            relativePath: "evil-link/missing.txt",
            fsOps: fakeFs
          }),
        /WORKSPACE_PATH_SECURITY_VIOLATION: Symlink escape denied/
      );

      // WorkspaceManager P0-01 verification (lexical, Win32 artifacts, junction root escape)
      const rawDb = new DatabaseSync(sandbox.dbPath);
      try {
        rawDb.exec("PRAGMA foreign_keys = ON;");
        const agentIdSvc = new AgentIdentityService(rawDb);
        const flash2Token = agentIdSvc.generateToken("flash-02", ["workspace:read:self", "workspace:write:self"], 24).rawToken;
        const flash2Identity = agentIdSvc.authenticateToken(flash2Token)!;

        const wmRoot = path.join(sandbox.tempDir, "wm-root");
        const wsManager = new WorkspaceManager(rawDb, wmRoot);
        wsManager.initializeWorkspaceFolders("flash-02");

        const wmOk = wsManager.resolveSecurePath(flash2Identity, "reports/summary.md", "write");
        assert.equal(wmOk.isAllowed, true);
        assert.ok(wmOk.safePath.endsWith(path.join("reports", "summary.md")));

        for (const attack of ["../flash-01/x.txt", "notes/file.", "notes/a.txt:ads", "C:\\temp\\a.txt", "\\\\host\\share\\a", "x\0y.txt"]) {
          const denied = wsManager.resolveSecurePath(flash2Identity, attack, "read");
          assert.equal(denied.isAllowed, false, `WorkspaceManager must block '${attack}'`);
          assert.match(denied.reason || "", /WORKSPACE_PATH_SECURITY_VIOLATION|Path traversal|forbidden|null byte/i);
        }

        const wmFlash1Token = agentIdSvc.generateToken("flash-01", ["workspace:read:self", "workspace:write:self"], 24).rawToken;
        const wmFlash1Identity = agentIdSvc.authenticateToken(wmFlash1Token)!;
        const wmFlash1Ws = wsManager.getWorkspace("flash-01")!;
        fs.mkdirSync(path.dirname(wmFlash1Ws.absolute_root), { recursive: true });
        fs.symlinkSync(outsideDir, wmFlash1Ws.absolute_root, "junction");

        const wmRootEscape = wsManager.resolveSecurePath(wmFlash1Identity, "vault.txt", "read");
        assert.equal(wmRootEscape.isAllowed, false);
        assert.match(wmRootEscape.reason || "", /Symlink or junction escape/);
      } finally {
        rawDb.close();
      }
    } finally {
      sandbox.cleanup();
    }
  });

  await t.test("P0-02: Separate read/audit/write scopes & authenticated M01-M05 / M17-M22", async () => {
    const sandbox = createSandboxTestContext("aico-t20-p02-");
    const conn = new ConnectionManager(sandbox.dbPath);
    const runner = new MigrationRunner(conn);
    runner.runMigrations([migrationV040, migrationV050Schema]);

    const idService = new IdentityAccessService(conn);
    const wsService = new WorkspaceArtifactService(sandbox.tempDir, conn);

    const flash1Ctx = issueTestPrincipalContext(idService, "flash-01", [
      "company:read",
      "workspace:read:self",
      "workspace:write:self",
      "workspace:share"
    ]);
    const flash2Token = idService.issueCredential("flash-02", [
      "company:read",
      "workspace:read:self",
      "workspace:read:any",
      "workspace:write:self"
    ]).token;
    const codexToken = idService.issueCredential("codex-01", [
      "company:read",
      "workspace:audit:read"
    ]).token;

    // 1. Direct unauthenticated failures
    for (const badCtx of [undefined, { ...flash1Ctx, authenticated: false } as PrincipalContext]) {
      assert.throws(() => wsService.safeWriteArtifact("a.txt", "x", "workspaces", true, badCtx), /AUTHENTICATION_REQUIRED/);
      assert.throws(() => wsService.safeReadArtifact("a.txt", "workspaces", badCtx), /AUTHENTICATION_REQUIRED/);
      assert.throws(() => wsService.writeArtifact({ agentId: "flash-01", relativePath: "a.txt", content: "x", ctx: badCtx }), /AUTHENTICATION_REQUIRED/);
      assert.throws(() => wsService.readArtifact("flash-01", "a.txt", badCtx), /AUTHENTICATION_REQUIRED/);
      assert.throws(() => wsService.listFiles({ agentId: "flash-01", ctx: badCtx }), /AUTHENTICATION_REQUIRED/);
      assert.throws(() => wsService.getWorkspaceMeta("flash-01", badCtx), /AUTHENTICATION_REQUIRED/);
      assert.throws(() => wsService.shareArtifact({ fromAgentId: "flash-01", toAgentId: "flash-02", sourceRelativePath: "a.txt", ctx: badCtx }), /AUTHENTICATION_REQUIRED/);
      assert.throws(() => wsService.listActivities({ agentId: "flash-01" }, badCtx), /AUTHENTICATION_REQUIRED/);
    }

    // 2. Base 5-tool MCP server M01-M05 fail-closed check
    const baseServer = createBaseMcpServer({ dbPath: sandbox.dbPath });
    const baseTools = (baseServer as any)._registeredTools;
    for (const toolName of ["company_ping", "company_get_info", "company_list_agents", "company_get_agent", "company_list_quota_pools"]) {
      const handler = baseTools[toolName].handler;
      const args = toolName === "company_get_agent" ? { agent_id: "flash-01" } : toolName === "company_ping" ? { message: "hi" } : {};
      await assert.rejects(() => handler(args), /AUTH_MISSING_OR_INVALID_TOKEN/);
    }
    const noReadCtx = issueTestPrincipalContext(idService, "codex-01", ["tasks:read:assigned"]);
    await requestContextStore.run(noReadCtx, async () => {
      await assert.rejects(() => baseTools.company_get_info.handler({}), /PERMISSION_DENIED/);
      await assert.rejects(() => baseTools.company_list_agents.handler({}), /PERMISSION_DENIED/);
      await assert.rejects(() => baseTools.company_get_agent.handler({ agent_id: "flash-01" }), /PERMISSION_DENIED/);
      await assert.rejects(() => baseTools.company_list_quota_pools.handler({}), /PERMISSION_DENIED/);
    });
    await requestContextStore.run(flash1Ctx, async () => {
      const okInfo = await baseTools.company_get_info.handler({});
      assert.match(okInfo.content[0].text, /"company_name": "AICO"/);
    });

    // Seed workspace artifact & activity under flash-01
    wsService.writeArtifact({
      agentId: "flash-01",
      relativePath: "reports/q4.md",
      content: "Flash-01 Q4 report",
      ctx: flash1Ctx
    });

    // Share artifact cross-agent source prevention + positive sanitized delivery
    const shareOk = wsService.shareArtifact({
      fromAgentId: "flash-01",
      toAgentId: "codex-01",
      sourceRelativePath: "reports/q4.md",
      ctx: flash1Ctx
    });
    assert.match(shareOk.recipient_inbox_ref, /^inbox\/art_[a-f0-9]+_q4\.md$/);
    const codexReadCtx = issueTestPrincipalContext(idService, "codex-01", ["workspace:read:self"]);
    assert.equal(
      wsService.readArtifact("codex-01", shareOk.recipient_inbox_ref, codexReadCtx).content,
      "Flash-01 Q4 report"
    );

    const flash2Ctx = idService.authenticateToken(flash2Token, "local", "t20_f2_read");
    assert.throws(
      () =>
        wsService.shareArtifact({
          fromAgentId: "flash-01",
          toAgentId: "codex-01",
          sourceRelativePath: "reports/q4.md",
          ctx: flash2Ctx
        }),
      /PERMISSION_DENIED: Cross-agent write access/
    );

    // 3. HTTP JSON-RPC scope separation across M17-M22
    const app = buildGatewayHttpApp({
      isPublicGateway: false,
      conn,
      idService,
      workspaceRoot: sandbox.tempDir,
      anchorFilePath: sandbox.anchorPath,
      hmacKey: TEST_HMAC_KEY
    });
    const srv = await startGatewayServer(app, { ...LOCAL_GATEWAY_PROFILE, allowedHosts: ["127.0.0.1"] });

    try {
      // flash-02 has workspace:read:any + workspace:write:self -> CAN M17/M18/M19 on flash-01, CANNOT M20 on flash-01, CANNOT M22
      const f2Meta = await postJsonRpc(srv.port, flash2Token, {
        jsonrpc: "2.0",
        method: "tools/call",
        params: { name: "company_get_workspace", arguments: { target_agent_id: "flash-01" } },
        id: 1
      });
      assert.equal(f2Meta.json.result?.isError, undefined);

      const f2Read = await postJsonRpc(srv.port, flash2Token, {
        jsonrpc: "2.0",
        method: "tools/call",
        params: { name: "company_read_workspace_file", arguments: { target_agent_id: "flash-01", relative_path: "reports/q4.md" } },
        id: 2
      });
      assert.equal(f2Read.json.result?.isError, undefined);
      assert.equal(JSON.parse(f2Read.json.result.content[0].text).content, "Flash-01 Q4 report");

      const f2WriteCross = await postJsonRpc(srv.port, flash2Token, {
        jsonrpc: "2.0",
        method: "tools/call",
        params: {
          name: "company_write_workspace_file",
          arguments: { target_agent_id: "flash-01", relative_path: "reports/q4.md", content: "OVERWRITTEN" }
        },
        id: 3
      });
      assert.equal(f2WriteCross.json.result?.isError, true);
      assert.match(f2WriteCross.json.result.content[0].text, /PERMISSION_DENIED/);

      const f2AuditDenied = await postJsonRpc(srv.port, flash2Token, {
        jsonrpc: "2.0",
        method: "tools/call",
        params: { name: "company_get_workspace_activity", arguments: { agent_id: "flash-01" } },
        id: 4
      });
      assert.equal(f2AuditDenied.json.result?.isError, true);
      assert.match(f2AuditDenied.json.result.content[0].text, /PERMISSION_DENIED/);

      // codex-01 has ONLY workspace:audit:read -> CAN M22, CANNOT M17/M18/M19/M20
      const codexAuditOk = await postJsonRpc(srv.port, codexToken, {
        jsonrpc: "2.0",
        method: "tools/call",
        params: { name: "company_get_workspace_activity", arguments: { agent_id: "flash-01", limit: 10 } },
        id: 5
      });
      assert.equal(codexAuditOk.json.result?.isError, undefined);
      assert.ok(JSON.parse(codexAuditOk.json.result.content[0].text).count >= 1);

      for (const [idx, call] of [
        { name: "company_get_workspace", arguments: { target_agent_id: "flash-01" } },
        { name: "company_list_workspace_files", arguments: { target_agent_id: "flash-01" } },
        { name: "company_read_workspace_file", arguments: { target_agent_id: "flash-01", relative_path: "reports/q4.md" } },
        { name: "company_write_workspace_file", arguments: { relative_path: "hack.txt", content: "x" } }
      ].entries()) {
        const deniedRes = await postJsonRpc(srv.port, codexToken, {
          jsonrpc: "2.0",
          method: "tools/call",
          params: call,
          id: 10 + idx
        });
        assert.equal(deniedRes.json.result?.isError, true);
        assert.match(deniedRes.json.result.content[0].text, /PERMISSION_DENIED/);
      }
    } finally {
      await srv.close();
      sandbox.cleanup();
    }
  });

  await t.test("P0-03: Task ownership, active lease protection, TR-04/TR-18 approvals, CAS & Public Gateway M31 blocking", async () => {
    const sandbox = createSandboxTestContext("aico-t20-p03-");
    const conn = new ConnectionManager(sandbox.dbPath);
    const runner = new MigrationRunner(conn);
    runner.runMigrations([migrationV040, migrationV050Schema]);

    const idService = new IdentityAccessService(conn);
    const appService = new ApprovalService(conn);
    const taskService = new ProjectTaskService(conn, appService);

    const founderCtx = issueTestPrincipalContext(idService, "founder-01", ["*"]);
    const flash1Ctx = issueTestPrincipalContext(idService, "flash-01", [
      "company:read",
      "tasks:manage",
      "tasks:transition",
      "tasks:review",
      "approvals:request",
      "approvals:decide"
    ]);
    const flash2Ctx = issueTestPrincipalContext(idService, "flash-02", [
      "company:read",
      "tasks:claim",
      "tasks:transition",
      "tasks:review",
      "tasks:update:assigned"
    ]);
    const codexCtx = issueTestPrincipalContext(idService, "codex-01", [
      "company:read",
      "tasks:claim",
      "tasks:transition",
      "tasks:submit",
      "tasks:update:assigned",
      "approvals:request"
    ]);
    const chatgptPublicToken = idService.issueCredential({
      principal_id: "chatgpt-01",
      scopes: ["company:read", "tasks:manage", "tasks:transition", "tasks:review", "tasks:claim", "tasks:update:assigned"],
      allow_public_gateway: true
    }).token;

    // 1. Worker authorization, cross-agent lease protection (TR-12), SoD & CAS race
    const task = taskService.createTask({
      ctx: flash1Ctx,
      title: "P0-03 Lifecycle & Lease Task",
      assignedAgentId: "codex-01",
      reviewerAgentId: "flash-02",
      riskClass: "medium"
    });

    // codex-01 (worker) cannot TR-01 draft -> queued
    assert.throws(
      () => taskService.transitionTask({ ctx: codexCtx, taskId: task.task_id, expectedVersion: 1, toStatus: "queued" }),
      /ABAC_OWNERSHIP_OR_SOD_VIOLATION/
    );

    taskService.transitionTask({ ctx: flash1Ctx, taskId: task.task_id, expectedVersion: 1, toStatus: "queued" });
    taskService.transitionTask({ ctx: flash1Ctx, taskId: task.task_id, expectedVersion: 2, toStatus: "assigned" });

    // Cross-agent claim denied
    assert.throws(
      () => taskService.claimTask({ ctx: flash2Ctx, taskId: task.task_id, expectedVersion: 3 }),
      /ABAC_OWNERSHIP_OR_SOD_VIOLATION/
    );

    const claimed = taskService.claimTask({ ctx: codexCtx, taskId: task.task_id, expectedVersion: 3 });
    assert.equal(claimed.version, 4);

    // Active unexpired lease cannot be stolen via TR-12 by flash-02
    assert.throws(
      () => taskService.transitionTask({ ctx: flash2Ctx, taskId: task.task_id, expectedVersion: 4, toStatus: "assigned" }),
      /ABAC_OWNERSHIP_OR_SOD_VIOLATION/
    );

    // Concurrency CAS test: two concurrent TR-11 (claimed -> in_progress) at version 4 -> 1 succeeds, 1 conflicts
    const casResults = await Promise.allSettled([
      Promise.resolve().then(() => taskService.transitionTask({ ctx: codexCtx, taskId: task.task_id, expectedVersion: 4, toStatus: "in_progress" })),
      Promise.resolve().then(() => taskService.transitionTask({ ctx: codexCtx, taskId: task.task_id, expectedVersion: 4, toStatus: "in_progress" }))
    ]);
    assert.equal(casResults.filter((r) => r.status === "fulfilled").length, 1);
    assert.equal(casResults.filter((r) => r.status === "rejected" && /TASK_VERSION_CONFLICT/.test(String(r.reason))).length, 1);

    // waiting_approval -> in_progress (TR-18) requires explicit approval & consumes once
    taskService.transitionTask({ ctx: codexCtx, taskId: task.task_id, expectedVersion: 5, toStatus: "waiting_approval" });
    assert.throws(
      () => taskService.transitionTask({ ctx: flash1Ctx, taskId: task.task_id, expectedVersion: 6, toStatus: "in_progress" }),
      /TASK_APPROVAL_REQUIRED/
    );
    const tr18Appr = appService.createApprovalRequest({
      ctx: codexCtx,
      action_type: "architecture_review",
      target_agent_id: "codex-01",
      target_resource: `task:${task.task_id}`,
      canonical_payload: { taskId: task.task_id, riskClass: "medium", priority: "P1" },
      approval_tier: "technical"
    });
    appService.decideApproval({ ctx: flash1Ctx, approval_id: tr18Appr.approval_id, decision: "approved" });

    const inProg = taskService.transitionTask({
      ctx: flash1Ctx,
      taskId: task.task_id,
      expectedVersion: 6,
      toStatus: "in_progress",
      approvalId: tr18Appr.approval_id
    });
    assert.equal(inProg.version, 7);

    // Replay same approval fails on TR-18 again
    taskService.transitionTask({ ctx: codexCtx, taskId: task.task_id, expectedVersion: 7, toStatus: "waiting_approval" });
    assert.throws(
      () =>
        taskService.transitionTask({
          ctx: flash1Ctx,
          taskId: task.task_id,
          expectedVersion: 8,
          toStatus: "in_progress",
          approvalId: tr18Appr.approval_id
        }),
      /TASK_APPROVAL_REQUIRED/
    );

    // Complete via TR-04 & review SoD
    const tr04Appr = appService.createApprovalRequest({
      ctx: codexCtx,
      action_type: "architecture_review",
      target_agent_id: "codex-01",
      target_resource: `task:${task.task_id}`,
      canonical_payload: { taskId: task.task_id, riskClass: "medium", priority: "P1" },
      approval_tier: "technical"
    });
    appService.decideApproval({ ctx: flash1Ctx, approval_id: tr04Appr.approval_id, decision: "approved" });
    taskService.transitionTask({ ctx: flash1Ctx, taskId: task.task_id, expectedVersion: 8, toStatus: "queued", approvalId: tr04Appr.approval_id });
    taskService.transitionTask({ ctx: flash1Ctx, taskId: task.task_id, expectedVersion: 9, toStatus: "assigned" });
    taskService.claimTask({ ctx: codexCtx, taskId: task.task_id, expectedVersion: 10 });
    taskService.transitionTask({ ctx: codexCtx, taskId: task.task_id, expectedVersion: 11, toStatus: "in_progress" });
    taskService.transitionTask({ ctx: codexCtx, taskId: task.task_id, expectedVersion: 12, toStatus: "review_required" });

    // Assigned worker cannot self-approve completion (TR-25)
    assert.throws(
      () => taskService.transitionTask({ ctx: codexCtx, taskId: task.task_id, expectedVersion: 13, toStatus: "completed" }),
      /ABAC_OWNERSHIP_OR_SOD_VIOLATION/
    );
    const done = taskService.transitionTask({ ctx: flash2Ctx, taskId: task.task_id, expectedVersion: 13, toStatus: "completed" });
    assert.equal(done.execution_status, "completed");

    // TR-12: Expired lease release succeeds for executive / assigned agent
    const leaseTask = taskService.createTask({
      ctx: flash1Ctx,
      title: "P0-03 TR-12 Lease Expiry Release",
      assignedAgentId: "codex-01",
      riskClass: "low"
    });
    taskService.transitionTask({ ctx: flash1Ctx, taskId: leaseTask.task_id, expectedVersion: 1, toStatus: "queued" });
    taskService.transitionTask({ ctx: flash1Ctx, taskId: leaseTask.task_id, expectedVersion: 2, toStatus: "assigned" });
    taskService.claimTask({ ctx: codexCtx, taskId: leaseTask.task_id, expectedVersion: 3 });
    conn.withWriteTransaction((db) => {
      db.prepare("UPDATE tasks SET lease_expires_at = ? WHERE task_id = ?").run(
        new Date(Date.now() - 10_000).toISOString(),
        leaseTask.task_id
      );
    });
    const released = taskService.transitionTask({
      ctx: codexCtx,
      taskId: leaseTask.task_id,
      expectedVersion: 4,
      toStatus: "assigned"
    });
    assert.equal(released.execution_status, "assigned");
    assert.equal(released.lease_owner_agent_id, null);

    // 2. TR-15 reachability on Argon + TR-12 / TR-18 block for Argon (only Founder can claim/start Argon)
    const argonTask = taskService.createTask({
      ctx: flash1Ctx,
      title: "P0-03 Argon TR-15 Task",
      assignedAgentId: "argon-01",
      riskClass: "critical",
      priority: "P0"
    });
    const argonAppr = appService.createApprovalRequest({
      ctx: flash1Ctx,
      action_type: "argon_invocation",
      target_agent_id: "argon-01",
      target_resource: `task:${argonTask.task_id}`,
      canonical_payload: { taskId: argonTask.task_id, targetAgentId: "argon-01" },
      approval_tier: "founder"
    });
    appService.decideApproval({ ctx: founderCtx, approval_id: argonAppr.approval_id, decision: "approved" });
    taskService.transitionTask({ ctx: flash1Ctx, taskId: argonTask.task_id, expectedVersion: 1, toStatus: "queued", approvalId: argonAppr.approval_id });
    taskService.transitionTask({ ctx: flash1Ctx, taskId: argonTask.task_id, expectedVersion: 2, toStatus: "assigned" });
    assert.throws(
      () => taskService.transitionTask({ ctx: flash1Ctx, taskId: argonTask.task_id, expectedVersion: 3, toStatus: "claimed" }),
      /ABAC_OWNERSHIP_OR_SOD_VIOLATION/
    );
    taskService.transitionTask({ ctx: founderCtx, taskId: argonTask.task_id, expectedVersion: 3, toStatus: "claimed" });
    assert.throws(
      () => taskService.transitionTask({ ctx: flash1Ctx, taskId: argonTask.task_id, expectedVersion: 4, toStatus: "assigned" }),
      /TASK_INVALID_STATE_TRANSITION/
    );
    taskService.transitionTask({ ctx: founderCtx, taskId: argonTask.task_id, expectedVersion: 4, toStatus: "in_progress" });
    const argonBlocked = taskService.transitionTask({
      ctx: flash1Ctx,
      taskId: argonTask.task_id,
      expectedVersion: 5,
      toStatus: "blocked",
      reason: "Argon rate cap hit"
    });
    assert.equal(argonBlocked.execution_status, "blocked");

    // 3. Public Gateway M31 blocking for TR-04, TR-18, TR-23, TR-25, TR-26
    const pubApp = buildGatewayHttpApp({
      isPublicGateway: true,
      conn,
      idService,
      workspaceRoot: sandbox.tempDir,
      anchorFilePath: sandbox.anchorPath,
      hmacKey: TEST_HMAC_KEY
    });
    const pubSrv = await startGatewayServer(pubApp, { ...PUBLIC_GATEWAY_PROFILE, allowedHosts: ["127.0.0.1"] });

    try {
      const chatgptCtx = idService.authenticateToken(chatgptPublicToken, "public", "t20_pub");

      // Safe TR-01 allowed on Public Gateway
      const pubDraft = taskService.createTask({ ctx: chatgptCtx, title: "Public Draft", assignedAgentId: "codex-01", riskClass: "low" });
      const pubTr01 = await postJsonRpc(pubSrv.port, chatgptPublicToken, {
        jsonrpc: "2.0",
        method: "tools/call",
        params: {
          name: "company_transition_task",
          arguments: { task_id: pubDraft.task_id, expected_version: 1, to_status: "queued" }
        },
        id: 21
      });
      assert.equal(pubTr01.json.result?.isError, undefined);

      // Prepare tasks in waiting_approval, review_required, completed
      const waitTask = taskService.createTask({ ctx: chatgptCtx, title: "Pub Wait", assignedAgentId: "codex-01", riskClass: "medium" });
      taskService.transitionTask({ ctx: chatgptCtx, taskId: waitTask.task_id, expectedVersion: 1, toStatus: "queued" });
      taskService.transitionTask({ ctx: chatgptCtx, taskId: waitTask.task_id, expectedVersion: 2, toStatus: "assigned" });
      taskService.claimTask({ ctx: codexCtx, taskId: waitTask.task_id, expectedVersion: 3 });
      taskService.transitionTask({ ctx: codexCtx, taskId: waitTask.task_id, expectedVersion: 4, toStatus: "in_progress" });
      taskService.transitionTask({ ctx: codexCtx, taskId: waitTask.task_id, expectedVersion: 5, toStatus: "waiting_approval" });

      const revTask = taskService.createTask({ ctx: chatgptCtx, title: "Pub Rev", assignedAgentId: "codex-01", riskClass: "low" });
      taskService.transitionTask({ ctx: chatgptCtx, taskId: revTask.task_id, expectedVersion: 1, toStatus: "queued" });
      taskService.transitionTask({ ctx: chatgptCtx, taskId: revTask.task_id, expectedVersion: 2, toStatus: "assigned" });
      taskService.claimTask({ ctx: codexCtx, taskId: revTask.task_id, expectedVersion: 3 });
      taskService.transitionTask({ ctx: codexCtx, taskId: revTask.task_id, expectedVersion: 4, toStatus: "in_progress" });
      taskService.transitionTask({ ctx: codexCtx, taskId: revTask.task_id, expectedVersion: 5, toStatus: "review_required" });

      const doneTask = taskService.createTask({ ctx: chatgptCtx, title: "Pub Done", assignedAgentId: "codex-01", riskClass: "low" });
      taskService.transitionTask({ ctx: chatgptCtx, taskId: doneTask.task_id, expectedVersion: 1, toStatus: "queued" });
      taskService.transitionTask({ ctx: chatgptCtx, taskId: doneTask.task_id, expectedVersion: 2, toStatus: "assigned" });
      taskService.claimTask({ ctx: codexCtx, taskId: doneTask.task_id, expectedVersion: 3 });
      taskService.transitionTask({ ctx: codexCtx, taskId: doneTask.task_id, expectedVersion: 4, toStatus: "in_progress" });
      taskService.transitionTask({ ctx: codexCtx, taskId: doneTask.task_id, expectedVersion: 5, toStatus: "review_required" });
      taskService.transitionTask({ ctx: flash1Ctx, taskId: doneTask.task_id, expectedVersion: 6, toStatus: "completed" });

      const blockedPublicCalls = [
        { task_id: waitTask.task_id, expected_version: 6, to_status: "queued" }, // TR-04
        { task_id: waitTask.task_id, expected_version: 6, to_status: "in_progress" }, // TR-18
        { task_id: revTask.task_id, expected_version: 6, to_status: "rework" }, // TR-23
        { task_id: revTask.task_id, expected_version: 6, to_status: "completed" }, // TR-25
        { task_id: doneTask.task_id, expected_version: 7, to_status: "archived" } // TR-26
      ];

      for (const [idx, args] of blockedPublicCalls.entries()) {
        const res = await postJsonRpc(pubSrv.port, chatgptPublicToken, {
          jsonrpc: "2.0",
          method: "tools/call",
          params: { name: "company_transition_task", arguments: args },
          id: 30 + idx
        });
        assert.equal(res.json.result?.isError, true);
        assert.match(res.json.result.content[0].text, /TOOL_NOT_EXPOSED_ON_PUBLIC_GATEWAY/);
      }
    } finally {
      await pubSrv.close();
      sandbox.cleanup();
    }
  });

  await t.test("P0-04: Zero fallback identity synthesis, verified human/agent audit chain & rate-limiter burst separation", async () => {
    const sandbox = createSandboxTestContext("aico-t20-p04-");
    const conn = new ConnectionManager(sandbox.dbPath);
    const runner = new MigrationRunner(conn);
    runner.runMigrations([migrationV040, migrationV050Schema]);

    const idService = new IdentityAccessService(conn);
    const appService = new ApprovalService(conn);
    const taskService = new ProjectTaskService(conn, appService);
    const msgService = new MessagingService(conn);
    const knowService = new KnowledgeMemoryService(conn);
    const obsService = new ObservabilityQuotaService(conn, TEST_HMAC_KEY, sandbox.anchorPath);
    const gitService = new GitMediationService(sandbox.tempDir, sandbox.tempDir);

    // 1. getPrincipalById permanently disabled
    assert.throws(() => idService.getPrincipalById("founder-01"), /SECURITY_VIOLATION/);

    // 2. Direct service mutations/reads reject missing ctx with AUTHENTICATION_REQUIRED
    assert.throws(() => taskService.createProject({ name: "P", description: "D" }), /AUTHENTICATION_REQUIRED/);
    assert.throws(() => taskService.createTask({ title: "T" }), /AUTHENTICATION_REQUIRED/);
    assert.throws(() => taskService.listTasks({}), /AUTHENTICATION_REQUIRED/);
    assert.throws(() => taskService.getTask("task_missing"), /AUTHENTICATION_REQUIRED/);
    assert.throws(() => taskService.claimTask({ taskId: "x", expectedVersion: 1 }), /AUTHENTICATION_REQUIRED/);
    assert.throws(() => taskService.transitionTask({ taskId: "x", expectedVersion: 1, toStatus: "queued" }), /AUTHENTICATION_REQUIRED/);
    assert.throws(() => taskService.reviewTask({ taskId: "x", expectedVersion: 1, decision: "completed" }), /AUTHENTICATION_REQUIRED/);
    assert.throws(() => taskService.heartbeatTask({ taskId: "x" }), /AUTHENTICATION_REQUIRED/);
    assert.throws(() => msgService.sendMessage({ toPrincipalId: "flash-02", subject: "S", bodyMarkdown: "B" }), /AUTHENTICATION_REQUIRED/);
    assert.throws(() => appService.createApprovalRequest({ target_resource: "task:x", canonical_payload: { a: 1 } }), /AUTHENTICATION_REQUIRED/);
    assert.throws(() => (appService as any).decideApproval({ approval_id: "appr_1", decision: "approved" }), /AUTHENTICATION_REQUIRED/);
    assert.throws(() => knowService.writeMemory({ scope: "company", content: "C" }), /AUTHENTICATION_REQUIRED/);
    assert.throws(() => knowService.searchMemory({ query: "C" }), /AUTHENTICATION_REQUIRED/);
    assert.throws(() => knowService.proposeKnowledgeChange({ docId: "doc_1", proposedMarkdown: "M", rationale: "R" }), /AUTHENTICATION_REQUIRED/);
    assert.throws(() => knowService.approveKnowledgeProposal({ proposalId: "prop_1", decision: "approved" }), /AUTHENTICATION_REQUIRED/);
    assert.throws(() => obsService.recordModelUsage({ agentId: "flash-01", inputTokens: 1, outputTokens: 1 }), /AUTHENTICATION_REQUIRED/);
    assert.throws(() => gitService.syncAgentBranch({ agentId: "flash-01", branchName: "agent/flash-01/x", direction: "pull_master" }), /AUTHENTICATION_REQUIRED/);

    // 3. Audit & usage event integrity
    assert.throws(
      () =>
        obsService.appendAuditEvent({
          eventCategory: "policy",
          actionName: "unattributed",
          targetResource: "test",
          outcome: "denied"
        }),
      /AUTHENTICATION_REQUIRED/
    );

    const flash2Ctx = issueTestPrincipalContext(idService, "flash-02", ["*"]);
    const attributedEvt = obsService.appendAuditEvent({
      ctx: flash2Ctx,
      actorId: "founder-01", // Spoof attempt ignored when verified ctx exists
      eventCategory: "policy",
      actionName: "spoof_check",
      targetResource: "test:spoof",
      outcome: "succeeded"
    });
    assert.equal(attributedEvt.principal_id, "flash-02");
    assert.equal(attributedEvt.principal_type, "agent");

    // Human founder-01 & null ctx do NOT insert forged 'founder-01' into agent_usage_events
    const founderToken = idService.issueCredential("founder-01", ["*"]).token;
    const founderCtx = idService.authenticateToken(founderToken, "local", "t20_founder");
    obsService.recordMcpActivity({ ctx: founderCtx, toolName: "company_get_info", durationMs: 5, outcome: "succeeded" });
    obsService.recordMcpActivity({ ctx: null, toolName: "company_ping", durationMs: 2, outcome: "denied" });

    const forgedRows = conn.withReadTransaction((db) =>
      db.prepare("SELECT COUNT(*) AS cnt FROM agent_usage_events WHERE agent_id = 'founder-01'").get() as { cnt: number }
    );
    assert.equal(forgedRows.cnt, 0);

    // 4. Local Gateway HTTP JSON-RPC founder-01 & agent calls (M17, M20, M24, M26, M31, M35, M38) + burst rate test
    const localApp = buildGatewayHttpApp({
      isPublicGateway: false,
      conn,
      idService,
      workspaceRoot: sandbox.tempDir,
      anchorFilePath: sandbox.anchorPath,
      hmacKey: TEST_HMAC_KEY
    });
    const localSrv = await startGatewayServer(localApp, { ...LOCAL_GATEWAY_PROFILE, allowedHosts: ["127.0.0.1"] });

    try {
      // founder-01 omitting target_agent_id fails VALIDATION_ERROR (no fallback to flash-01)
      const founderNoTargetWs = await postJsonRpc(localSrv.port, founderToken, {
        jsonrpc: "2.0",
        method: "tools/call",
        params: { name: "company_get_workspace", arguments: {} },
        id: 101
      });
      assert.equal(founderNoTargetWs.json.result?.isError, true);
      assert.match(founderNoTargetWs.json.result.content[0].text, /VALIDATION_ERROR/);

      // founder-01 explicit M20, M24, M26, M31, M35, M38
      const founderWrite = await postJsonRpc(localSrv.port, founderToken, {
        jsonrpc: "2.0",
        method: "tools/call",
        params: {
          name: "company_write_workspace_file",
          arguments: { target_agent_id: "flash-01", relative_path: "reports/founder-note.txt", content: "Approved by Founder" }
        },
        id: 102
      });
      assert.equal(founderWrite.json.result?.isError, undefined);

      const founderProj = await postJsonRpc(localSrv.port, founderToken, {
        jsonrpc: "2.0",
        method: "tools/call",
        params: {
          name: "company_create_project",
          arguments: { project_id: "proj_t20", name: "T20 Project", owner_agent_id: "flash-01" }
        },
        id: 103
      });
      assert.equal(founderProj.json.result?.isError, undefined);

      const founderTask = await postJsonRpc(localSrv.port, founderToken, {
        jsonrpc: "2.0",
        method: "tools/call",
        params: {
          name: "company_create_task",
          arguments: { task_id: "task_t20_http", project_id: "proj_t20", title: "HTTP Auth Task", assigned_agent_id: "codex-01", risk_class: "low" }
        },
        id: 104
      });
      assert.equal(founderTask.json.result?.isError, undefined);

      const founderMsg = await postJsonRpc(localSrv.port, founderToken, {
        jsonrpc: "2.0",
        method: "tools/call",
        params: {
          name: "company_send_message",
          arguments: { to_principal_id: "flash-01", subject: "T20 Attribution", body_markdown: "Founder signed message." }
        },
        id: 105
      });
      assert.equal(founderMsg.json.result?.isError, undefined);

      const founderMem = await postJsonRpc(localSrv.port, founderToken, {
        jsonrpc: "2.0",
        method: "tools/call",
        params: {
          name: "company_knowledge_memory_ops",
          arguments: { operation: "write_memory", scope: "company", content: "Company wide rule" }
        },
        id: 106
      });
      assert.equal(founderMem.json.result?.isError, undefined);

      // Verify audit attribution recorded as human founder-01 & chain intact
      const humanAudits = conn.withReadTransaction((db) =>
        db.prepare("SELECT COUNT(*) AS cnt FROM audit_events WHERE principal_id = 'founder-01' AND principal_type = 'human'").get() as { cnt: number }
      );
      assert.ok(humanAudits.cnt >= 2);
      const chainRes = obsService.verifyAuditChainIntegrity();
      assert.equal(chainRes.valid, true);

      // 20 rapid authenticated requests from 127.0.0.1 succeed without hitting unauthenticatedRateLimit (burst 15)
      for (let i = 0; i < 20; i++) {
        const res = await postJsonRpc(localSrv.port, founderToken, {
          jsonrpc: "2.0",
          method: "tools/call",
          params: { name: "company_list_projects", arguments: {} },
          id: 200 + i
        });
        assert.equal(res.status, 200, `Authenticated burst #${i + 1} failed with status ${res.status}`);
        assert.equal(res.json.result?.isError, undefined);
      }

      // Cross-agent getTask & listTasks isolation when lacking tasks:read / tasks:manage
      const codexAssignedOnlyCtx = issueTestPrincipalContext(idService, "codex-01", ["tasks:read:assigned"]);
      const f2TaskCtx = issueTestPrincipalContext(idService, "flash-02", ["tasks:read:assigned"]);
      assert.equal(taskService.getTask("task_t20_http", codexAssignedOnlyCtx)?.task_id, "task_t20_http");
      assert.throws(() => taskService.getTask("task_t20_http", f2TaskCtx), /PERMISSION_DENIED/);
      assert.equal(taskService.listTasks({}, f2TaskCtx).some((r) => r.task_id === "task_t20_http"), false);

      // Unauthenticated flood exceeds unauthenticatedRateLimit (burst 15) -> 429 RATE_LIMIT_EXCEEDED
      let saw429 = false;
      for (let i = 0; i < 18; i++) {
        const res = await postJsonRpc(localSrv.port, null, {
          jsonrpc: "2.0",
          method: "tools/call",
          params: { name: "company_ping", arguments: {} },
          id: 300 + i
        });
        if (res.status === 429) {
          assert.equal(res.json.error_code, "RATE_LIMIT_EXCEEDED");
          saw429 = true;
          break;
        }
        assert.equal(res.status, 401);
      }
      assert.equal(saw429, true, "Unauthenticated flood must still trigger 429 RATE_LIMIT_EXCEEDED");

      // Invalid Bearer brute force on separate gateway also triggers 429 after unauthenticated burst
      const bruteApp = buildGatewayHttpApp({
        isPublicGateway: false,
        conn,
        idService,
        workspaceRoot: sandbox.tempDir,
        anchorFilePath: sandbox.anchorPath,
        hmacKey: TEST_HMAC_KEY
      });
      const bruteSrv = await startGatewayServer(bruteApp, { ...LOCAL_GATEWAY_PROFILE, allowedHosts: ["127.0.0.1"] });
      try {
        let sawBrute429 = false;
        for (let i = 0; i < 18; i++) {
          const res = await postJsonRpc(bruteSrv.port, "aico_live_forged_invalid_token_000", {
            jsonrpc: "2.0",
            method: "tools/call",
            params: { name: "company_ping", arguments: {} },
            id: 400 + i
          });
          if (res.status === 429) {
            assert.equal(res.json.error_code, "RATE_LIMIT_EXCEEDED");
            sawBrute429 = true;
            break;
          }
          assert.equal(res.status, 401);
        }
        assert.equal(sawBrute429, true, "Invalid Bearer flood must trigger 429 RATE_LIMIT_EXCEEDED");
      } finally {
        await bruteSrv.close();
      }
    } finally {
      await localSrv.close();
      sandbox.cleanup();
    }
  });

  await t.test("P0-01b: TOCTOU symlink/junction defense during read/write/share & concurrent race stress", async () => {
    const sandbox = createSandboxTestContext("aico-t20-toctou-");
    const conn = new ConnectionManager(sandbox.dbPath);
    const runner = new MigrationRunner(conn);
    runner.runMigrations([migrationV040, migrationV050Schema]);

    const idService = new IdentityAccessService(conn);
    const flash1Ctx = issueTestPrincipalContext(idService, "flash-01", [
      "workspace:read:self",
      "workspace:write:self"
    ]);
    const flash2Ctx = issueTestPrincipalContext(idService, "flash-02", [
      "workspace:read:self",
      "workspace:write:self"
    ]);

    const wsRoot = path.join(sandbox.tempDir, "ws-toctou");
    const outsideDir = path.join(sandbox.tempDir, "outside-vault");
    fs.mkdirSync(outsideDir, { recursive: true });
    fs.writeFileSync(path.join(outsideDir, "secret.txt"), "OUTSIDE-SECRET-LEAK", "utf8");

    try {
      // 1. Deterministic write TOCTOU: parent dir swapped to external junction right before commit rename
      let armedWriteSwap = false;
      const writeSwapSvc = new WorkspaceArtifactService(wsRoot, conn, {
        onBeforeIoStage: (stage, targetPath) => {
          if (armedWriteSwap && stage === "pre_write_commit" && targetPath.endsWith("payload.txt")) {
            armedWriteSwap = false;
            const parent = path.dirname(targetPath);
            fs.rmSync(parent, { recursive: true, force: true });
            fs.symlinkSync(outsideDir, parent, "junction");
          }
        }
      });
      writeSwapSvc.writeArtifact({
        agentId: "flash-01",
        relativePath: "toctou-w/seed.txt",
        content: "seed",
        ctx: flash1Ctx
      });
      armedWriteSwap = true;
      assert.throws(
        () =>
          writeSwapSvc.writeArtifact({
            agentId: "flash-01",
            relativePath: "toctou-w/payload.txt",
            content: "pwned-outside",
            overwrite: true,
            ctx: flash1Ctx
          }),
        /WORKSPACE_PATH_SECURITY_VIOLATION/
      );
      assert.equal(fs.existsSync(path.join(outsideDir, "payload.txt")), false);

      // 2. Deterministic overwrite=false TOCTOU: parent swapped at pre_write_open + exclusive create race
      let armedExclJunction = false;
      const exclSwapSvc = new WorkspaceArtifactService(wsRoot, conn, {
        onBeforeIoStage: (stage, targetPath) => {
          if (armedExclJunction && stage === "pre_write_open" && targetPath.endsWith("excl.txt")) {
            armedExclJunction = false;
            const parent = path.dirname(targetPath);
            fs.rmSync(parent, { recursive: true, force: true });
            fs.symlinkSync(outsideDir, parent, "junction");
          }
        }
      });
      exclSwapSvc.writeArtifact({
        agentId: "flash-01",
        relativePath: "toctou-excl/seed.txt",
        content: "seed",
        ctx: flash1Ctx
      });
      armedExclJunction = true;
      assert.throws(
        () =>
          exclSwapSvc.writeArtifact({
            agentId: "flash-01",
            relativePath: "toctou-excl/excl.txt",
            content: "should-not-write",
            overwrite: false,
            ctx: flash1Ctx
          }),
        /WORKSPACE_PATH_SECURITY_VIOLATION/
      );
      assert.equal(fs.existsSync(path.join(outsideDir, "excl.txt")), false);

      let armedExclFileRace = false;
      const exclRaceSvc = new WorkspaceArtifactService(wsRoot, conn, {
        onBeforeIoStage: (stage, targetPath) => {
          if (armedExclFileRace && stage === "pre_write_commit" && targetPath.endsWith("race.txt")) {
            armedExclFileRace = false;
            fs.writeFileSync(targetPath, "winner-content", "utf8");
          }
        }
      });
      armedExclFileRace = true;
      assert.throws(
        () =>
          exclRaceSvc.writeArtifact({
            agentId: "flash-01",
            relativePath: "toctou-race/race.txt",
            content: "loser-overwrite",
            overwrite: false,
            ctx: flash1Ctx
          }),
        /FILE_ALREADY_EXISTS/
      );
      assert.equal(
        exclRaceSvc.readArtifact("flash-01", "toctou-race/race.txt", flash1Ctx).content,
        "winner-content"
      );

      // 3. Deterministic read TOCTOU: swap before openSync and before return
      for (const hookStage of ["pre_read_open", "post_read_verify"] as const) {
        let armedReadSwap = false;
        const dirName = `toctou-r-${hookStage}`;
        const readSwapSvc = new WorkspaceArtifactService(wsRoot, conn, {
          onBeforeIoStage: (stage, targetPath) => {
            if (armedReadSwap && stage === hookStage && targetPath.endsWith("secret.txt")) {
              armedReadSwap = false;
              const parent = path.dirname(targetPath);
              fs.rmSync(parent, { recursive: true, force: true });
              fs.symlinkSync(outsideDir, parent, "junction");
            }
          }
        });
        readSwapSvc.writeArtifact({
          agentId: "flash-01",
          relativePath: `${dirName}/secret.txt`,
          content: "SAFE-INTERNAL",
          ctx: flash1Ctx
        });
        armedReadSwap = true;
        assert.throws(
          () => readSwapSvc.readArtifact("flash-01", `${dirName}/secret.txt`, flash1Ctx),
          /WORKSPACE_PATH_SECURITY_VIOLATION/
        );
      }

      // 4. Deterministic shareArtifact TOCTOU: recipient inbox swapped to external junction mid-write
      let armedShareSwap = false;
      const shareSwapSvc = new WorkspaceArtifactService(wsRoot, conn, {
        onBeforeIoStage: (stage, targetPath) => {
          if (armedShareSwap && stage === "pre_write_commit" && targetPath.endsWith("_shared.md")) {
            armedShareSwap = false;
            const recipientInbox = path.dirname(targetPath);
            fs.rmSync(recipientInbox, { recursive: true, force: true });
            fs.symlinkSync(outsideDir, recipientInbox, "junction");
          }
        }
      });
      shareSwapSvc.writeArtifact({
        agentId: "flash-01",
        relativePath: "artifacts/shared.md",
        content: "INTERNAL-SHARE",
        ctx: flash1Ctx
      });
      shareSwapSvc.writeArtifact({
        agentId: "flash-02",
        relativePath: "inbox/placeholder.txt",
        content: "placeholder",
        ctx: flash2Ctx
      });
      armedShareSwap = true;
      assert.throws(
        () =>
          shareSwapSvc.shareArtifact({
            fromAgentId: "flash-01",
            toAgentId: "flash-02",
            sourceRelativePath: "artifacts/shared.md",
            ctx: flash1Ctx
          }),
        /WORKSPACE_PATH_SECURITY_VIOLATION/
      );
      assert.equal(
        fs.readdirSync(outsideDir).some((f) => f.endsWith("_shared.md")),
        false
      );

      // 5. Concurrent async junction-swap stress test
      const plainSvc = new WorkspaceArtifactService(wsRoot, conn);
      const raceFolder = path.join(wsRoot, "workspaces", "flash-01", "concurrent-race");
      fs.mkdirSync(raceFolder, { recursive: true });
      fs.writeFileSync(path.join(raceFolder, "secret.txt"), "SAFE-CONCURRENT-INTERNAL", "utf8");

      let stopSwapping = false;
      const swapperPromise = (async () => {
        for (let i = 0; i < 60 && !stopSwapping; i++) {
          try {
            fs.rmSync(raceFolder, { recursive: true, force: true });
            if (i % 2 === 0) {
              fs.symlinkSync(outsideDir, raceFolder, "junction");
            } else {
              fs.mkdirSync(raceFolder, { recursive: true });
              fs.writeFileSync(path.join(raceFolder, "secret.txt"), "SAFE-CONCURRENT-INTERNAL", "utf8");
            }
          } catch {
            // Ignore transient OS handle contention during concurrent swap
          }
          await new Promise((r) => setTimeout(r, 1));
        }
      })();

      const ops: Array<Promise<void>> = [];
      for (let i = 0; i < 30; i++) {
        ops.push(
          (async () => {
            await new Promise((r) => setTimeout(r, i % 4));
            try {
              plainSvc.writeArtifact({
                agentId: "flash-01",
                relativePath: `concurrent-race/write-${i}.txt`,
                content: `race-payload-${i}`,
                ctx: flash1Ctx
              });
            } catch (err: any) {
              const msg = String(err?.message || err);
              assert.ok(
                msg.includes("WORKSPACE_PATH_SECURITY_VIOLATION") ||
                  ["ENOENT", "EEXIST", "EPERM", "EBUSY", "ENOTDIR"].includes(err?.code),
                `Unexpected write error during race: ${msg}`
              );
            }
          })()
        );
        ops.push(
          (async () => {
            await new Promise((r) => setTimeout(r, (i + 1) % 4));
            try {
              const res = plainSvc.readArtifact("flash-01", "concurrent-race/secret.txt", flash1Ctx);
              assert.equal(res.content, "SAFE-CONCURRENT-INTERNAL");
              assert.equal(res.content.includes("OUTSIDE-SECRET-LEAK"), false);
            } catch (err: any) {
              const msg = String(err?.message || err);
              assert.ok(
                msg.includes("WORKSPACE_PATH_SECURITY_VIOLATION") ||
                  msg.includes("RESOURCE_NOT_FOUND") ||
                  ["ENOENT", "EPERM", "EBUSY"].includes(err?.code),
                `Unexpected read error during race: ${msg}`
              );
            }
          })()
        );
      }

      await Promise.all(ops);
      stopSwapping = true;
      await swapperPromise;

      const outsideFiles = fs.readdirSync(outsideDir);
      assert.equal(
        outsideFiles.some((f) => f.startsWith("write-") || f.endsWith(".tmp")),
        false,
        `External directory leaked files during TOCTOU race: ${outsideFiles.join(", ")}`
      );
      assert.equal(fs.readFileSync(path.join(outsideDir, "secret.txt"), "utf8"), "OUTSIDE-SECRET-LEAK");
    } finally {
      sandbox.cleanup();
    }
  });

  await t.test("P0-03b: Mandatory service-layer expectedVersion CAS & M31/M32 JSON-RPC schema enforcement", async () => {
    const sandbox = createSandboxTestContext("aico-t20-cas-");
    const conn = new ConnectionManager(sandbox.dbPath);
    const runner = new MigrationRunner(conn);
    runner.runMigrations([migrationV040, migrationV050Schema]);

    const idService = new IdentityAccessService(conn);
    const appService = new ApprovalService(conn);
    const taskService = new ProjectTaskService(conn, appService);

    const flash1Ctx = issueTestPrincipalContext(idService, "flash-01", [
      "company:read",
      "tasks:manage",
      "tasks:transition",
      "tasks:review"
    ]);
    const flash2Ctx = issueTestPrincipalContext(idService, "flash-02", [
      "company:read",
      "tasks:claim",
      "tasks:transition",
      "tasks:submit",
      "tasks:review"
    ]);
    const flash1Token = idService.issueCredential({
      principal_id: "flash-01",
      scopes: ["company:read", "tasks:manage", "tasks:transition", "tasks:review"],
      allow_public_gateway: false
    }).token;
    const flash2Token = idService.issueCredential({
      principal_id: "flash-02",
      scopes: ["company:read", "tasks:claim", "tasks:transition", "tasks:submit"],
      allow_public_gateway: false
    }).token;

    // 1. Contract schema enforcement for M31 & M32
    assert.equal(
      CompanyTransitionTaskInputSchema.safeParse({ task_id: "t_1", to_status: "queued" }).success,
      false
    );
    assert.equal(
      CompanyTransitionTaskInputSchema.safeParse({ task_id: "t_1", to_status: "queued", expected_version: 0 }).success,
      false
    );
    assert.equal(
      CompanyTransitionTaskInputSchema.safeParse({ task_id: "t_1", to_status: "queued", expected_version: 1.5 }).success,
      false
    );
    assert.equal(
      CompanySubmitTaskResultInputSchema.safeParse({ task_id: "t_1", summary: "done" }).success,
      false
    );
    assert.equal(
      CompanySubmitTaskResultInputSchema.safeParse({ task_id: "t_1", expected_version: -1, summary: "done" }).success,
      false
    );

    const localApp = buildGatewayHttpApp({
      isPublicGateway: false,
      conn,
      idService,
      workspaceRoot: sandbox.tempDir,
      anchorFilePath: sandbox.anchorPath,
      hmacKey: TEST_HMAC_KEY
    });
    const localSrv = await startGatewayServer(localApp, { ...LOCAL_GATEWAY_PROFILE, allowedHosts: ["127.0.0.1"] });

    try {
      const task = taskService.createTask({
        ctx: flash1Ctx,
        taskId: "task_cas_p03b",
        title: "Mandatory Service CAS Task",
        assignedAgentId: "flash-02",
        riskClass: "low"
      });
      assert.equal(task.version, 1);

      // 2. Service layer rejects missing/invalid expectedVersion on ALL state-changing methods
      for (const badVer of [undefined, 0, -1, 1.5, NaN]) {
        assert.throws(
          () =>
            (taskService as any).transitionTask({
              ctx: flash1Ctx,
              taskId: task.task_id,
              expectedVersion: badVer,
              toStatus: "queued"
            }),
          /VALIDATION_ERROR: transitionTask requires a positive integer expectedVersion/
        );
        assert.throws(
          () =>
            (taskService as any).claimTask({
              ctx: flash2Ctx,
              taskId: task.task_id,
              expectedVersion: badVer
            }),
          /VALIDATION_ERROR: claimTask requires a positive integer expectedVersion/
        );
        assert.throws(
          () =>
            (taskService as any).submitTaskResult({
              ctx: flash2Ctx,
              taskId: task.task_id,
              expectedVersion: badVer,
              outputArtifactIds: ["art_1"],
              verificationEvidence: "ok"
            }),
          /VALIDATION_ERROR: submitTaskResult requires a positive integer expectedVersion/
        );
        assert.throws(
          () =>
            (taskService as any).reviewTask({
              ctx: flash1Ctx,
              taskId: task.task_id,
              expectedVersion: badVer,
              decision: "completed"
            }),
          /VALIDATION_ERROR: reviewTask expectedVersion must be a positive integer/
        );
      }

      // Advance draft(1) -> queued(2)
      const q = taskService.transitionTask({
        ctx: flash1Ctx,
        taskId: task.task_id,
        expectedVersion: 1,
        toStatus: "queued"
      });
      assert.equal(q.version, 2);

      // Same-status call with stale version must still fail with TASK_VERSION_CONFLICT
      assert.throws(
        () =>
          taskService.transitionTask({
            ctx: flash1Ctx,
            taskId: task.task_id,
            expectedVersion: 1,
            toStatus: "queued"
          }),
        /TASK_VERSION_CONFLICT/
      );

      // 3. HTTP JSON-RPC M31 missing/invalid/stale expected_version
      const m31Missing = await postJsonRpc(localSrv.port, flash1Token, {
        jsonrpc: "2.0",
        method: "tools/call",
        params: { name: "company_transition_task", arguments: { task_id: task.task_id, to_status: "assigned" } },
        id: 501
      });
      assert.equal(m31Missing.json.result?.isError, true);

      const m31Zero = await postJsonRpc(localSrv.port, flash1Token, {
        jsonrpc: "2.0",
        method: "tools/call",
        params: {
          name: "company_transition_task",
          arguments: { task_id: task.task_id, to_status: "assigned", expected_version: 0 }
        },
        id: 502
      });
      assert.equal(m31Zero.json.result?.isError, true);

      const m31Stale = await postJsonRpc(localSrv.port, flash1Token, {
        jsonrpc: "2.0",
        method: "tools/call",
        params: {
          name: "company_transition_task",
          arguments: { task_id: task.task_id, to_status: "assigned", expected_version: 1 }
        },
        id: 503
      });
      assert.equal(m31Stale.json.result?.isError, true);
      assert.match(m31Stale.json.result.content[0].text, /TASK_VERSION_CONFLICT/);

      // Move queued(2) -> assigned(3) -> claimed(4) -> in_progress(5)
      taskService.transitionTask({ ctx: flash1Ctx, taskId: task.task_id, expectedVersion: 2, toStatus: "assigned" });
      taskService.claimTask({ ctx: flash2Ctx, taskId: task.task_id, expectedVersion: 3 });
      taskService.transitionTask({ ctx: flash2Ctx, taskId: task.task_id, expectedVersion: 4, toStatus: "in_progress" });

      // 4. HTTP JSON-RPC M32 missing/invalid/stale expected_version, then valid expected_version=5
      const m32Missing = await postJsonRpc(localSrv.port, flash2Token, {
        jsonrpc: "2.0",
        method: "tools/call",
        params: {
          name: "company_submit_task_result",
          arguments: { task_id: task.task_id, verification_evidence: "tests pass", output_artifact_ids: ["art_1"] }
        },
        id: 504
      });
      assert.equal(m32Missing.json.result?.isError, true);

      const m32Stale = await postJsonRpc(localSrv.port, flash2Token, {
        jsonrpc: "2.0",
        method: "tools/call",
        params: {
          name: "company_submit_task_result",
          arguments: {
            task_id: task.task_id,
            expected_version: 4,
            verification_evidence: "tests pass",
            output_artifact_ids: ["art_1"]
          }
        },
        id: 505
      });
      assert.equal(m32Stale.json.result?.isError, true);
      assert.match(m32Stale.json.result.content[0].text, /TASK_VERSION_CONFLICT/);

      const m32Valid = await postJsonRpc(localSrv.port, flash2Token, {
        jsonrpc: "2.0",
        method: "tools/call",
        params: {
          name: "company_submit_task_result",
          arguments: {
            task_id: task.task_id,
            expected_version: 5,
            verification_evidence: "tests pass",
            output_artifact_ids: ["art_1"]
          }
        },
        id: 506
      });
      assert.equal(m32Valid.json.result?.isError, undefined);
      const m32Parsed = JSON.parse(m32Valid.json.result.content[0].text);
      assert.equal(m32Parsed.execution_status, "review_required");
      assert.equal(m32Parsed.version, 6);

      // 5. reviewTask requires exact version 6 (stale 5 rejected, 6 succeeds -> version 7)
      assert.throws(
        () =>
          taskService.reviewTask({
            ctx: flash1Ctx,
            taskId: task.task_id,
            expectedVersion: 5,
            decision: "completed"
          }),
        /TASK_VERSION_CONFLICT/
      );
      const reviewed = taskService.reviewTask({
        ctx: flash1Ctx,
        taskId: task.task_id,
        expectedVersion: 6,
        decision: "completed"
      });
      assert.equal(reviewed.execution_status, "completed");
      assert.equal(reviewed.version, 7);
    } finally {
      await localSrv.close();
      sandbox.cleanup();
    }
  });
});
