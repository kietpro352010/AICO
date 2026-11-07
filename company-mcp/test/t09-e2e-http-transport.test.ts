import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import express from "express";
import { createSandboxTestContext } from "./helpers/test-context.js";
import { ConnectionManager } from "../src/db/connection-manager.js";
import { MigrationRunner } from "../src/db/migration-runner.js";
import { migrationV040 } from "../src/db/migrations/v040-agent-columns.js";
import { migrationV050Schema } from "../src/db/migrations/v050-target-schema.js";
import { IdentityAccessService } from "../src/services/identity-access-service.js";
import { createFullMcpServer } from "../src/registry-core.js";
import {
  HttpSecurityPipeline,
  LOCAL_GATEWAY_PROFILE,
  PUBLIC_GATEWAY_PROFILE
} from "../src/security/http-security-pipeline.js";
import { toNodeHandler } from "@modelcontextprotocol/node";
import { createMcpHandler } from "@modelcontextprotocol/server";
import { requestContextStore } from "../src/security/context-store.js";

function startTestServer(app: express.Express): Promise<{ server: http.Server; port: number; close: () => Promise<void> }> {
  return new Promise((resolve) => {
    const server = http.createServer(app);
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address() as any;
      resolve({
        server,
        port: addr.port,
        close: () => new Promise<void>((res) => server.close(() => res()))
      });
    });
  });
}

function parseMcpResponseBody(body: string): any {
  const line = body.split("\n").find((l) => l.startsWith("data: "));
  if (line) {
    return JSON.parse(line.slice(6));
  }
  return JSON.parse(body);
}

function sendHttpRequest(options: {
  port: number;
  path: string;
  method?: string;
  headers?: Record<string, string>;
  body?: string | Buffer;
}): Promise<{ status: number; headers: http.IncomingHttpHeaders; body: string }> {
  return new Promise((resolve, reject) => {
    const headers = options.headers || {};
    const method = options.method || "POST";
    const port = options.port;
    if (!headers["Host"] && !headers["host"]) {
      headers["Host"] = `127.0.0.1:${port}`;
    }
    if (!headers["Accept"] && !headers["accept"]) {
      headers["Accept"] = "application/json, text/event-stream";
    }

    const req = http.request(
      {
        hostname: "127.0.0.1",
        port,
        path: options.path,
        method,
        headers
      },
      (res) => {
        let data = "";
        res.on("data", (chunk) => {
          data += chunk;
        });
        res.on("end", () => {
          resolve({ status: res.statusCode || 0, headers: res.headers, body: data });
        });
      }
    );

    req.on("error", reject);
    if (options.body) {
      req.write(options.body);
    }
    req.end();
  });
}

test("T09: Black-Box E2E HTTP Transport & Security Pipeline Verification", async () => {
  const ctx = createSandboxTestContext("aico-t09-http-");

  try {
    const conn = new ConnectionManager(ctx.dbPath);
    const runner = new MigrationRunner(conn);
    runner.runMigrations([migrationV040, migrationV050Schema]);

    const idService = new IdentityAccessService(conn);

    // Issue tokens for test principals
    const founderToken = idService.issueCredential({
      principal_id: "founder-01",
      scopes: ["*"]
    }).token;

    const flash1Token = idService.issueCredential({
      principal_id: "flash-01",
      scopes: ["company:read", "workspace:read:self", "workspace:write:self"]
    }).token;

    // --- Build Local Gateway App ---
    const localProfile = {
      ...LOCAL_GATEWAY_PROFILE,
      allowedHosts: ["127.0.0.1"] // will match 127.0.0.1:<port>
    };
    const localPipeline = new HttpSecurityPipeline(localProfile, idService);
    const localMcpServer = createFullMcpServer({
      isPublicGateway: false,
      connManager: conn,
      workspaceRoot: ctx.tempDir,
      anchorFilePath: ctx.anchorPath
    });
    const localNodeHandler = toNodeHandler(createMcpHandler(() => localMcpServer));

    const localApp = express();
    localApp.use(express.json({ limit: "2mb" }));
    localApp.use(localPipeline.middleware());
    localApp.post("/mcp", (req, res) => {
      const principal = (req as any).principalContext;
      requestContextStore.run(principal, () => {
        localNodeHandler(req, res, req.body);
      });
    });

    const localServer = await startTestServer(localApp);

    try {
      // 1. GET /health -> 200
      const healthRes = await sendHttpRequest({
        port: localServer.port,
        path: "/health",
        method: "GET"
      });
      assert.equal(healthRes.status, 200);
      assert.match(healthRes.body, /"status":"healthy"/);

      // 2. Missing token on /mcp -> 401
      const unauthRes = await sendHttpRequest({
        port: localServer.port,
        path: "/mcp",
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", method: "tools/list", id: 1 })
      });
      assert.equal(unauthRes.status, 401);
      assert.match(unauthRes.body, /AUTH_MISSING_OR_INVALID_TOKEN/);

      // 3. Invalid Content-Type -> 415
      const badCtRes = await sendHttpRequest({
        port: localServer.port,
        path: "/mcp",
        method: "POST",
        headers: {
          "Content-Type": "text/plain",
          "Authorization": `Bearer ${flash1Token}`
        },
        body: "Hello"
      });
      assert.equal(badCtRes.status, 415);
      assert.match(badCtRes.body, /UNSUPPORTED_MEDIA_TYPE/);

      // 4. Oversized body exceeding maxBodySizeBytes -> 413
      const largePayload = JSON.stringify({
        jsonrpc: "2.0",
        method: "tools/call",
        params: { name: "company_ping", arguments: { message: "x".repeat(1024 * 1024 + 100) } },
        id: 2
      });
      const oversizedRes = await sendHttpRequest({
        port: localServer.port,
        path: "/mcp",
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": String(Buffer.byteLength(largePayload)),
          "Authorization": `Bearer ${flash1Token}`
        },
        body: largePayload
      });
      assert.equal(oversizedRes.status, 413);
      assert.match(oversizedRes.body, /PAYLOAD_TOO_LARGE/);

      // 5. Valid call to company_ping with flash1Token -> 200
      const pingPayload = JSON.stringify({
        jsonrpc: "2.0",
        method: "tools/call",
        params: { name: "company_ping", arguments: { message: "E2E HTTP Test" } },
        id: 3
      });
      const pingRes = await sendHttpRequest({
        port: localServer.port,
        path: "/mcp",
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${flash1Token}`
        },
        body: pingPayload
      });
      assert.equal(pingRes.status, 200);
      const pingData = parseMcpResponseBody(pingRes.body);
      assert.equal(pingData.result.isError, undefined);
      assert.match(pingData.result.content[0].text, /"success":\s*true/);

      // 6. Central Scope Enforcement (P0-01):
      // flash-01 attempts to call company_list_credentials (requires credentials:manage)
      const credsPayload = JSON.stringify({
        jsonrpc: "2.0",
        method: "tools/call",
        params: { name: "company_list_credentials", arguments: {} },
        id: 4
      });
      const deniedRes = await sendHttpRequest({
        port: localServer.port,
        path: "/mcp",
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${flash1Token}`
        },
        body: credsPayload
      });
      assert.equal(deniedRes.status, 200);
      const deniedData = parseMcpResponseBody(deniedRes.body);
      assert.equal(deniedData.result.isError, true);
      assert.match(deniedData.result.content[0].text, /PERMISSION_DENIED/);

      // 7. Founder calls company_list_credentials (wildcard *) -> SUCCEEDS
      const founderCredsRes = await sendHttpRequest({
        port: localServer.port,
        path: "/mcp",
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${founderToken}`
        },
        body: credsPayload
      });
      assert.equal(founderCredsRes.status, 200);
      const founderData = parseMcpResponseBody(founderCredsRes.body);
      assert.equal(founderData.result.isError, undefined);
    } finally {
      await localServer.close();
    }

    // --- Build Public Gateway App (FDR-06 Verification) ---
    const publicProfile = {
      ...PUBLIC_GATEWAY_PROFILE,
      allowedHosts: ["127.0.0.1"]
    };
    const publicPipeline = new HttpSecurityPipeline(publicProfile, idService);
    const publicApp = express();
    publicApp.use(express.json({ limit: "512kb" }));
    publicApp.use(publicPipeline.middleware());
    const publicServer = await startTestServer(publicApp);

    try {
      // 8. Human principal (founder-01) forbidden on Public Gateway -> 403
      const humanBlocked = await sendHttpRequest({
        port: publicServer.port,
        path: "/mcp",
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${founderToken}`
        },
        body: JSON.stringify({ jsonrpc: "2.0", method: "tools/list", id: 5 })
      });
      assert.equal(humanBlocked.status, 403);
      assert.match(humanBlocked.body, /AUTH_HUMAN_FORBIDDEN_ON_PUBLIC_GATEWAY/);
    } finally {
      await publicServer.close();
    }
  } finally {
    ctx.cleanup();
  }
});
