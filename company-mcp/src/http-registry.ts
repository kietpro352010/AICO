import { createMcpExpressApp } from "@modelcontextprotocol/express";
import { toNodeHandler } from "@modelcontextprotocol/node";
import { createMcpHandler } from "@modelcontextprotocol/server";
import { createFullMcpServer, REGISTRY_VERSION, SERVER_NAME } from "./registry-core.js";
import { ConnectionManager } from "./db/connection-manager.js";
import { RuntimeConfig } from "./config/runtime-config.js";
import { IdentityAccessService } from "./services/identity-access-service.js";
import {
  HttpSecurityPipeline,
  LOCAL_GATEWAY_PROFILE
} from "./security/http-security-pipeline.js";
import { requestContextStore } from "./security/context-store.js";

const HOST = "127.0.0.1";
const PORT = 3334;

const conn = new ConnectionManager(RuntimeConfig.getDbPath());
const identityService = new IdentityAccessService(conn);
const pipeline = new HttpSecurityPipeline(LOCAL_GATEWAY_PROFILE, identityService);

function createServer() {
  return createFullMcpServer({ isPublicGateway: false, connManager: conn });
}

const handler = createMcpHandler(createServer);
const app = createMcpExpressApp({
  host: HOST,
  allowedHosts: LOCAL_GATEWAY_PROFILE.allowedHosts,
  allowedOrigins: LOCAL_GATEWAY_PROFILE.allowedOrigins,
  jsonLimit: `${LOCAL_GATEWAY_PROFILE.maxBodySizeBytes}b`
});
const nodeHandler = toNodeHandler(handler);

// Attach 10-step security pipeline
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

export const httpServer = app.listen(PORT, HOST, () => {
  console.log(`AICO Company MCP Local HTTP Server v2.2.1 started.`);
  console.log(`Health: http://${HOST}:${PORT}/health`);
  console.log(`MCP:    http://${HOST}:${PORT}/mcp`);
});

httpServer.on("error", (error) => {
  console.error("AICO HTTP Server error:", error);
  process.exitCode = 1;
});
