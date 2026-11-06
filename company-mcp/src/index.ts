import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { createBaseMcpServer, REGISTRY_VERSION } from "./registry-core.js";

function createServer() {
  return createBaseMcpServer();
}

// Start MCP server via STDIO
void serveStdio(createServer);

console.error(`AICO Company MCP Server v${REGISTRY_VERSION} (STDIO) started.`);
