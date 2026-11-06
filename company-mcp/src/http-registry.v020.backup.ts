import { DatabaseSync } from "node:sqlite";
import { createMcpExpressApp } from "@modelcontextprotocol/express";
import { toNodeHandler } from "@modelcontextprotocol/node";
import { createMcpHandler, McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";

const DB_PATH = "D:/AI-COMPANY/data/aico.db";
const HOST = "127.0.0.1";
const PORT = 3334;

type AgentRow = {
  agent_id: string;
  display_name: string;
  model: string;
  platform: string;
  role: string;
  department: string;
  status: string;
  capabilities_json: string;
  last_seen_at: string | null;
  invocation_mode: string;
  auto_invoke: number;
  requires_approval: number;
  quota_class: string;
};

function queryAgents(agentId?: string): AgentRow[] {
  const db = new DatabaseSync(DB_PATH);

  try {
    db.exec("PRAGMA busy_timeout = 5000;");

    if (agentId) {
      const row = db.prepare(`
        SELECT *
        FROM agents
        WHERE agent_id = ?
      `).get(agentId) as AgentRow | undefined;

      return row ? [row] : [];
    }

    return db.prepare(`
      SELECT *
      FROM agents
      ORDER BY agent_id
    `).all() as AgentRow[];
  } finally {
    db.close();
  }
}

function formatAgent(row: AgentRow) {
  return {
    agent_id: row.agent_id,
    name: row.display_name,
    model: row.model,
    platform: row.platform,
    role: row.role,
    department: row.department,
    status: row.status,
    capabilities: JSON.parse(row.capabilities_json),
    invocation_policy: {
      mode: row.invocation_mode,
      auto_invoke: row.auto_invoke === 1,
      requires_approval: row.requires_approval === 1,
      quota_class: row.quota_class
    },
    last_seen_at: row.last_seen_at
  };
}

function createServer(): McpServer {
  const server = new McpServer({
    name: "aico-company-mcp",
    version: "0.2.0"
  });

  // Tool 1: Ping
  server.registerTool(
    "company_ping",
    {
      title: "Company Ping",
      description: "Check whether AICO Company MCP is working.",
      inputSchema: z.object({
        message: z.string().default("Hello AICO")
      })
    },
    async ({ message }) => ({
      content: [{
        type: "text",
        text: JSON.stringify({
          success: true,
          server: "AICO Company MCP",
          version: "0.2.0",
          received: message,
          timestamp: new Date().toISOString()
        }, null, 2)
      }]
    })
  );

  // Tool 2: Company information
  server.registerTool(
    "company_get_info",
    {
      title: "Company Information",
      description: "Get basic information about AICO.",
      inputSchema: z.object({})
    },
    async () => {
      const agents = queryAgents();

      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            company_name: "AICO",
            full_name: "Personal AI Software Company",
            version: "0.2.0",
            operating_mode: "Hybrid Local-first",
            principal_agents: agents.length,
            current_stage: "Agent Registry",
            database: "SQLite",
            timestamp: new Date().toISOString()
          }, null, 2)
        }]
      };
    }
  );

  // Tool 3: List all registered agents
  server.registerTool(
    "company_list_agents",
    {
      title: "List AICO Agents",
      description: "Retrieve all registered AICO agents and their invocation policies.",
      inputSchema: z.object({})
    },
    async () => {
      const agents = queryAgents();

      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            success: true,
            count: agents.length,
            agents: agents.map(formatAgent)
          }, null, 2)
        }]
      };
    }
  );

  // Tool 4: Get one agent from the database
  server.registerTool(
    "company_get_agent",
    {
      title: "Get Agent Profile",
      description: "Retrieve one agent profile directly from the AICO database.",
      inputSchema: z.object({
        agent_id: z.string().min(1)
      })
    },
    async ({ agent_id }) => {
      const results = queryAgents(agent_id);
      const agent = results[0];

      if (!agent) {
        return {
          isError: true,
          content: [{
            type: "text",
            text: `Agent not found: ${agent_id}`
          }]
        };
      }

      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            success: true,
            agent: formatAgent(agent)
          }, null, 2)
        }]
      };
    }
  );

  return server;
}

const handler = createMcpHandler(createServer);
const app = createMcpExpressApp();
const nodeHandler = toNodeHandler(handler);

app.get("/health", (_req, res) => {
  try {
    const agents = queryAgents();

    res.json({
      success: true,
      server: "AICO Company MCP",
      version: "0.2.0",
      transport: "Streamable HTTP",
      status: "running",
      database: "connected",
      registered_agents: agents.length
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
  console.log("AICO Company MCP HTTP Server v0.2.0 started.");
  console.log(`Health: http://${HOST}:${PORT}/health`);
  console.log(`MCP:    http://${HOST}:${PORT}/mcp`);
});

httpServer.on("error", (error) => {
  console.error("AICO HTTP Server error:", error);
  process.exitCode = 1;
});
