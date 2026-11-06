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
  usage_tier: string;
  routing_priority: number;
  quota_pool: string;
  reasoning_level: string;
  reasoning_verified: number;
  model_verified: number;
};

function readAgents(agentId?: string): AgentRow[] {
  const db = new DatabaseSync(DB_PATH);

  try {
    db.exec("PRAGMA busy_timeout = 5000;");

    if (agentId) {
      const row = db.prepare(`
        SELECT * FROM agents WHERE agent_id = ?
      `).get(agentId) as AgentRow | undefined;

      return row ? [row] : [];
    }

    return db.prepare(`
      SELECT * FROM agents
      ORDER BY routing_priority ASC, agent_id ASC
    `).all() as AgentRow[];
  } finally {
    db.close();
  }
}

function readQuotaPools() {
  const db = new DatabaseSync(DB_PATH);

  try {
    db.exec("PRAGMA busy_timeout = 5000;");

    return db.prepare(`
      SELECT
        qp.pool_id,
        qp.provider,
        qp.account_label,
        qp.notes,
        COUNT(a.agent_id) AS agent_count,
        COALESCE(GROUP_CONCAT(a.agent_id, ', '), '') AS agent_ids
      FROM quota_pools qp
      LEFT JOIN agents a ON a.quota_pool = qp.pool_id
      GROUP BY
        qp.pool_id,
        qp.provider,
        qp.account_label,
        qp.notes
      ORDER BY qp.pool_id
    `).all();
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

    resource_policy: {
      usage_tier: row.usage_tier,
      routing_priority: row.routing_priority,
      quota_pool: row.quota_pool
    },

    reasoning: {
      target_level: row.reasoning_level,
      model_verified: row.model_verified === 1,
      reasoning_verified: row.reasoning_verified === 1
    },

    last_seen_at: row.last_seen_at
  };
}

function createServer(): McpServer {
  const server = new McpServer({
    name: "aico-company-mcp",
    version: "0.3.0"
  });

  server.registerTool(
    "company_ping",
    {
      title: "Company Ping",
      description: "Check AICO MCP connectivity and version.",
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
          version: "0.3.0",
          received: message,
          timestamp: new Date().toISOString()
        }, null, 2)
      }]
    })
  );

  server.registerTool(
    "company_get_info",
    {
      title: "Company Information",
      description: "Get AICO company information.",
      inputSchema: z.object({})
    },
    async () => {
      const agents = readAgents();
      const pools = readQuotaPools();

      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            company_name: "AICO",
            full_name: "Personal AI Software Company",
            version: "0.3.0",
            operating_mode: "Hybrid Local-first",
            principal_agents: agents.length,
            quota_pools: pools.length,
            current_stage: "Agent Registry v0.3.0",
            timestamp: new Date().toISOString()
          }, null, 2)
        }]
      };
    }
  );

  server.registerTool(
    "company_list_agents",
    {
      title: "List AICO Agents",
      description: "List all six registered agents with invocation, quota and reasoning policies.",
      inputSchema: z.object({})
    },
    async () => {
      const agents = readAgents();

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

  server.registerTool(
    "company_get_agent",
    {
      title: "Get Agent Profile",
      description: "Retrieve one agent profile from the AICO database.",
      inputSchema: z.object({
        agent_id: z.string().min(1)
      })
    },
    async ({ agent_id }) => {
      const agent = readAgents(agent_id)[0];

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

  server.registerTool(
    "company_list_quota_pools",
    {
      title: "List Quota Pools",
      description: "List provider quota pools and their associated AICO agents.",
      inputSchema: z.object({})
    },
    async () => {
      const pools = readQuotaPools();

      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            success: true,
            count: pools.length,
            quota_pools: pools
          }, null, 2)
        }]
      };
    }
  );

  return server;
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
      server: "AICO Company MCP",
      version: "0.3.0",
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
  console.log("AICO Company MCP HTTP Server v0.3.0 started.");
  console.log(`Health: http://${HOST}:${PORT}/health`);
  console.log(`MCP:    http://${HOST}:${PORT}/mcp`);
});

httpServer.on("error", (error) => {
  console.error("AICO HTTP Server error:", error);
  process.exitCode = 1;
});
