import { createMcpExpressApp } from "@modelcontextprotocol/express";
import { toNodeHandler } from "@modelcontextprotocol/node";
import { createMcpHandler } from "@modelcontextprotocol/server";
import { createFullMcpServer } from "./registry-core.js";
import { ConnectionManager } from "./db/connection-manager.js";
import { RuntimeConfig } from "./config/runtime-config.js";
import { IdentityAccessService } from "./services/identity-access-service.js";
import {
  HttpSecurityPipeline,
  PUBLIC_GATEWAY_PROFILE,
  configureGatewayHttpServer
} from "./security/http-security-pipeline.js";
import { requestContextStore } from "./security/context-store.js";

// FDR-06: Public Gateway (:3335) is strictly DISABLED by default
const IS_ENABLED = process.env.AICO_PUBLIC_GATEWAY_ENABLED === "true";

if (!IS_ENABLED) {
  console.log("AICO MCP Public Gateway (:3335) is DISABLED by policy (FDR-06 / Gate G7 pending).");
  console.log("To enable under Founder authorization, set AICO_PUBLIC_GATEWAY_ENABLED=true.");
  process.exit(0);
}

const HOST = "127.0.0.1";
const PORT = 3335;

const conn = new ConnectionManager(RuntimeConfig.getDbPath());
const identityService = new IdentityAccessService(conn);
const pipeline = new HttpSecurityPipeline(PUBLIC_GATEWAY_PROFILE, identityService);

function createServer() {
  // Public Gateway only registers 29 allowlisted tools; 9 admin/physical tools are strictly blocked
  return createFullMcpServer({ isPublicGateway: true, connManager: conn });
}

const handler = createMcpHandler(createServer);
const app = createMcpExpressApp({
  host: HOST,
  allowedHosts: PUBLIC_GATEWAY_PROFILE.allowedHosts
});
const nodeHandler = toNodeHandler(handler);

// Attach 10-step security pipeline (enforcing body size 256 KiB, 15s timeout, Bearer token, agent-only)
app.use(pipeline.middleware());

app.all("/mcp", (req, res) => {
  const principal = (req as any).principalContext;
  if (principal) {
    requestContextStore.run(principal, () => {
      void nodeHandler(req, res, req.body);
    });
  } else {
    void nodeHandler(req, res, req.body);
  }
});

export const httpServer = configureGatewayHttpServer(
  app.listen(PORT, HOST, () => {
    console.log(`AICO Company MCP Public Gateway v2.2.1 started on http://${HOST}:${PORT}`);
    console.log(`Health: http://${HOST}:${PORT}/health`);
    console.log(`MCP:    http://${HOST}:${PORT}/mcp`);
  }),
  PUBLIC_GATEWAY_PROFILE
);

httpServer.on("error", (error) => {
  console.error("AICO Public Gateway error:", error);
  process.exitCode = 1;
});
