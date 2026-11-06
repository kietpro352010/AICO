import { createMcpExpressApp } from "@modelcontextprotocol/express";
import { toNodeHandler } from "@modelcontextprotocol/node";
import { createMcpHandler, McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";

function createServer(): McpServer {
  const server = new McpServer({
    name: "aico-company-mcp",
    version: "0.1.0"
  });

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
          version: "0.1.0",
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
      description: "Get basic information about AICO.",
      inputSchema: z.object({})
    },
    async () => ({
      content: [{
        type: "text",
        text: JSON.stringify({
          company_name: "AICO",
          full_name: "Personal AI Software Company",
          version: "0.1.0",
          operating_mode: "Hybrid Local-first",
          principal_agents: 5,
          description: "A personal AI company for software development and collaboration.",
          current_stage: "MCP Foundation"
        }, null, 2)
      }]
    })
  );

  server.registerTool(
    "company_get_agent",
    {
      title: "Get Agent Profile",
      description: "Retrieve one principal AICO agent profile.",
      inputSchema: z.object({
        agent_id: z.enum([
          "flash-01",
          "flash-02",
          "argon-01",
          "argon-02",
          "chatgpt-01"
        ])
      })
    },
    async ({ agent_id }) => {
      const agents = {
        "flash-01": {
          name: "Gemini Flash #1",
          model: "Gemini 3.8 Flash",
          platform: "Antigravity Account 1",
          role: "Chief Technology Officer",
          department: "Engineering"
        },
        "flash-02": {
          name: "Gemini Flash #2",
          model: "Gemini 3.8 Flash",
          platform: "Antigravity Account 2",
          role: "Engineering and QA Lead",
          department: "Engineering"
        },
        "argon-01": {
          name: "Gemini Argon #1",
          model: "Gemini 4 Argon",
          platform: "Gemini Web Account 1",
          role: "Principal Software Architect",
          department: "Architecture"
        },
        "argon-02": {
          name: "Gemini Argon #2",
          model: "Gemini 4 Argon",
          platform: "Gemini Web Account 2",
          role: "Independent Technical Auditor",
          department: "Quality"
        },
        "chatgpt-01": {
          name: "ChatGPT Go",
          model: "ChatGPT",
          platform: "ChatGPT Web",
          role: "Product and Strategy Advisor",
          department: "Product"
        }
      };

      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            agent_id,
            profile: agents[agent_id],
            registry_status: "planned"
          }, null, 2)
        }]
      };
    }
  );

  return server;
}

// A fresh MCP server instance is created for each HTTP request.
const handler = createMcpHandler(createServer);

// Express app with JSON parsing and localhost DNS-rebinding protection.
const app = createMcpExpressApp();

const nodeHandler = toNodeHandler(handler);

app.get("/health", (_req, res) => {
  res.json({
    success: true,
    server: "AICO Company MCP",
    transport: "Streamable HTTP",
    status: "running"
  });
});

app.all("/mcp", (req, res) => {
  void nodeHandler(req, res, req.body);
});

const HOST = "127.0.0.1";
const PORT = 3333;

const httpServer = app.listen(PORT, HOST, () => {
  console.log("AICO Company MCP HTTP Server v0.1.0 started.");
  console.log(`Health: http://${HOST}:${PORT}/health`);
  console.log(`MCP:    http://${HOST}:${PORT}/mcp`);
});

httpServer.on("error", (error) => {
  console.error("AICO HTTP Server error:", error);
  process.exitCode = 1;
});
