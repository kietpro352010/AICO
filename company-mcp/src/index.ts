import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { createFullMcpServer, REGISTRY_VERSION } from "./registry-core.js";

function createServer() {
  return createFullMcpServer({ isPublicGateway: false });
}

// Start MCP server via STDIO
void serveStdio(createServer);

console.error(`AICO Company MCP Server v2.2.1 (STDIO) started.`);
