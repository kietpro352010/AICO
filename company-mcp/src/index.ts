import { McpServer } from "@modelcontextprotocol/server";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import * as z from "zod/v4";

function createServer(): McpServer {
  const server = new McpServer({
    name: "aico-company-mcp",
    version: "0.1.0"
  });

  // Tool 1: Check server connectivity
  server.registerTool(
    "company_ping",
    {
      title: "Company Ping",
      description: "Check whether AICO Company MCP is working.",
      inputSchema: z.object({
        message: z.string().default("Hello AICO")
      })
    },
    async ({ message }) => {
      const result = {
        success: true,
        server: "AICO Company MCP",
        version: "0.1.0",
        received: message,
        timestamp: new Date().toISOString()
      };

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(result, null, 2)
          }
        ]
      };
    }
  );

  // Tool 2: Get company information
  server.registerTool(
    "company_get_info",
    {
      title: "Company Information",
      description: "Get basic information about AICO.",
      inputSchema: z.object({})
    },
    async () => {
      const result = {
        company_name: "AICO",
        full_name: "Personal AI Software Company",
        version: "0.1.0",
        operating_mode: "Hybrid Local-first",
        principal_agents: 5,
        description: "A personal AI company for software development and collaboration.",
        current_stage: "MCP Foundation"
      };

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(result, null, 2)
          }
        ]
      };
    }
  );

  // Tool 3: Get principal agent profile
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

      const result = {
        agent_id,
        profile: agents[agent_id],
        registry_status: "planned"
      };

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(result, null, 2)
          }
        ]
      };
    }
  );

  return server;
}

// Start MCP server
void serveStdio(createServer);

console.error("AICO Company MCP Server v0.1.0 started.");
