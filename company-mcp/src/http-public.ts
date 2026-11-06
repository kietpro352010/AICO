import { createMcpExpressApp } from "@modelcontextprotocol/express";
import { toNodeHandler } from "@modelcontextprotocol/node";
import { createMcpHandler } from "@modelcontextprotocol/server";
import type { Request, Response, NextFunction } from "express";
import {
  createBaseMcpServer,
  REGISTRY_VERSION,
  SERVER_NAME
} from "./registry-core.js";

const REQUIRED_TOKEN = process.env.AICO_MCP_PUBLIC_TOKEN;

if (!REQUIRED_TOKEN || REQUIRED_TOKEN.trim().length === 0) {
  console.error("FATAL: AICO_MCP_PUBLIC_TOKEN is not configured in environment. Public gateway startup aborted.");
  process.exit(1);
}

const HOST = "127.0.0.1";
const PORT = 3335;

// Allowed hostnames for the public prototype: localhost loopback and the designated ngrok domain
const ALLOWED_HOSTS = [
  "localhost",
  "127.0.0.1",
  "[::1]",
  "scribble-boundless-treble.ngrok-free.dev"
];

function createServer() {
  return createBaseMcpServer();
}

const handler = createMcpHandler(createServer);
const nodeHandler = toNodeHandler(handler);

// Independent Express app with explicitly configured allowedHosts
const app = createMcpExpressApp({
  host: HOST,
  allowedHosts: ALLOWED_HOSTS
});

// Bearer Token authentication middleware
function requireBearerToken(req: Request, res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;

  if (!authHeader) {
    res.status(401).json({
      jsonrpc: "2.0",
      error: {
        code: -32001,
        message: "Unauthorized: Missing Authorization header. Bearer token required."
      },
      id: null
    });
    return;
  }

  const parts = authHeader.split(" ");
  if (parts.length !== 2 || parts[0].toLowerCase() !== "bearer") {
    res.status(401).json({
      jsonrpc: "2.0",
      error: {
        code: -32001,
        message: "Unauthorized: Invalid Authorization header format. Expected 'Bearer <token>'."
      },
      id: null
    });
    return;
  }

  const token = parts[1];
  if (token !== REQUIRED_TOKEN) {
    res.status(401).json({
      jsonrpc: "2.0",
      error: {
        code: -32001,
        message: "Unauthorized: Invalid Bearer token."
      },
      id: null
    });
    return;
  }

  next();
}

// Public health endpoint: DOES NOT expose metadata or agent lists without auth
app.get("/health", (req, res) => {
  const authHeader = req.headers.authorization;
  const isAuth = authHeader && authHeader === `Bearer ${REQUIRED_TOKEN}`;

  if (!isAuth) {
    // Unauthenticated health response: returns strictly minimal status without internal topology
    res.json({
      status: "online",
      gateway: "AICO MCP Public Gateway Prototype"
    });
    return;
  }

  // Authenticated health response: includes version and service info
  res.json({
    status: "online",
    gateway: "AICO MCP Public Gateway Prototype",
    server: SERVER_NAME,
    version: REGISTRY_VERSION,
    auth: "verified"
  });
});

// Protected MCP endpoint: Authentication middleware MUST run before nodeHandler
app.all("/mcp", requireBearerToken, (req, res) => {
  void nodeHandler(req, res, req.body);
});

const httpServer = app.listen(PORT, HOST, () => {
  console.log(`[AICO Public Gateway] Server listening on http://${HOST}:${PORT}`);
  console.log(`[AICO Public Gateway] Allowed hosts: ${ALLOWED_HOSTS.join(", ")}`);
  console.log(`[AICO Public Gateway] MCP endpoint: http://${HOST}:${PORT}/mcp (Bearer Auth required)`);
});

httpServer.on("error", (error) => {
  console.error("[AICO Public Gateway] Server error:", error);
  process.exitCode = 1;
});
