import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { createFullMcpServer } from "./registry-core.js";
import { ConnectionManager } from "./db/connection-manager.js";
import { RuntimeConfig } from "./config/runtime-config.js";
import { IdentityAccessService } from "./services/identity-access-service.js";
import { StdioSecurityPipeline } from "./security/stdio-security-pipeline.js";
import { requestContextStore } from "./security/context-store.js";

const conn = new ConnectionManager(RuntimeConfig.getDbPath());
const identityService = new IdentityAccessService(conn);
const stdioPipeline = new StdioSecurityPipeline(identityService);

// Authenticate session principal during STDIO bootstrap
let sessionPrincipal;
try {
  sessionPrincipal = stdioPipeline.bootstrap();
  requestContextStore.enterWith(sessionPrincipal);
} catch (err: any) {
  console.error("STDIO Bootstrap Security Error:", err.message);
  process.exit(1);
}

function createServer() {
  return createFullMcpServer({ isPublicGateway: false, connManager: conn });
}

// Start MCP server via STDIO
void serveStdio(createServer);

console.error(`AICO Company MCP Server v2.2.1 (STDIO) started for principal: ${sessionPrincipal.principalId}`);
