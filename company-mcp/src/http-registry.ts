import { createMcpExpressApp } from "@modelcontextprotocol/express";
import { toNodeHandler } from "@modelcontextprotocol/node";
import { createMcpHandler } from "@modelcontextprotocol/server";
import {
  createBaseMcpServer,
  readAgents,
  readQuotaPools,
  REGISTRY_VERSION,
  SERVER_NAME
} from "./registry-core.js";

const HOST = "127.0.0.1";
const PORT = 3334;

function createServer() {
  return createBaseMcpServer();
}

// A fresh MCP server instance is created for each HTTP request.
const handler = createMcpHandler(createServer);
const app = createMcpExpressApp();
const nodeHandler = toNodeHandler(handler);

app.get("/health", (_req, res) => {
  try {
    const agents = readAgents();
    const pools = readQuotaPools();

    res.json({
      success: true,
      server: SERVER_NAME,
      version: REGISTRY_VERSION,
      transport: "Streamable HTTP",
      status: "running",
      database: "connected",
      registered_agents: agents.length,
      quota_pools: pools.length
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      status: "error",
      error: error instanceof Error ? error.message : String(error)
    });
  }
});

app.all("/mcp", (req, res) => {
  void nodeHandler(req, res, req.body);
});

const httpServer = app.listen(PORT, HOST, () => {
  console.log(`AICO Company MCP HTTP Server v${REGISTRY_VERSION} started.`);
  console.log(`Health: http://${HOST}:${PORT}/health`);
  console.log(`MCP:    http://${HOST}:${PORT}/mcp`);
});

httpServer.on("error", (error) => {
  console.error("AICO HTTP Server error:", error);
  process.exitCode = 1;
});
