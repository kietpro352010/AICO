import * as fs from "node:fs";
import * as readline from "node:readline";
import * as http from "node:http";

interface ClientBridgeConfig {
  agentId: string;
  gatewayUrl: string;
  token?: string;
}

export function parseArgs(args: string[]): ClientBridgeConfig {
  let agentId = "flash-02";
  let gatewayUrl = "http://127.0.0.1:3334/mcp";
  let token: string | undefined;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--agent" && args[i + 1]) {
      agentId = args[i + 1];
      i++;
    } else if (args[i] === "--gateway" && args[i + 1]) {
      gatewayUrl = args[i + 1];
      i++;
    } else if (args[i] === "--token" && args[i + 1]) {
      token = args[i + 1];
      i++;
    }
  }

  return { agentId, gatewayUrl, token };
}

export async function forwardJsonRpc(
  gatewayUrl: string,
  token: string | undefined,
  requestJson: any
): Promise<any> {
  return new Promise((resolve, reject) => {
    const url = new URL(gatewayUrl);
    const bodyStr = JSON.stringify(requestJson);

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "Content-Length": Buffer.byteLength(bodyStr).toString()
    };

    if (token) {
      headers["Authorization"] = `Bearer ${token}`;
    }

    const req = http.request(
      {
        hostname: url.hostname,
        port: url.port,
        path: url.pathname,
        method: "POST",
        headers
      },
      (res) => {
        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => {
          try {
            const parsed = JSON.parse(data);
            resolve(parsed);
          } catch (err) {
            resolve({ jsonrpc: "2.0", id: requestJson.id, error: { code: -32603, message: data || "Internal error" } });
          }
        });
      }
    );

    req.on("error", (err) => {
      resolve({
        jsonrpc: "2.0",
        id: requestJson.id,
        error: { code: -32000, message: `Bridge connection error: ${err.message}` }
      });
    });

    req.write(bodyStr);
    req.end();
  });
}

export function startBridge() {
  const config = parseArgs(process.argv.slice(2));

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: false
  });

  rl.on("line", async (line) => {
    if (!line.trim()) return;

    try {
      const jsonRpc = JSON.parse(line);
      const response = await forwardJsonRpc(config.gatewayUrl, config.token, jsonRpc);
      console.log(JSON.stringify(response));
    } catch (err: any) {
      console.error("ClientBridge parse error:", err.message);
    }
  });
}

if (process.argv[1]?.endsWith("client-bridge.ts") || process.argv[1]?.endsWith("client-bridge.js")) {
  startBridge();
}
