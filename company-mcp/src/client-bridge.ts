import * as fs from "node:fs";
import * as path from "node:path";
import * as readline from "node:readline";
import * as http from "node:http";
import { DpapiManager } from "./security/dpapi-manager.js";

interface ClientBridgeConfig {
  agentId: string;
  gatewayUrl: string;
  tokenFilePath?: string;
  maxFrameBytes: number;
  timeoutMs: number;
}

export function resolveToken(agentId: string, customFilePath?: string): string {
  // 1. Check custom file path or environment file path
  const explicitPath = customFilePath || process.env.AICO_STDIO_TOKEN_FILE;
  if (explicitPath && fs.existsSync(explicitPath)) {
    return explicitPath.endsWith(".dpapi")
      ? DpapiManager.unprotect(explicitPath)
      : fs.readFileSync(explicitPath, "utf8").trim();
  }

  // 2. Check %LOCALAPPDATA%\AICO\credentials\<agentId>.dpapi
  const localAppData = process.env.LOCALAPPDATA || process.env.USERPROFILE || "";
  if (localAppData) {
    const dpapiPath = path.join(localAppData, "AICO", "credentials", `${agentId}.dpapi`);
    if (fs.existsSync(dpapiPath)) {
      return DpapiManager.unprotect(dpapiPath);
    }
    const tokenPath = path.join(localAppData, "AICO", "credentials", `${agentId}.token`);
    if (fs.existsSync(tokenPath)) {
      return fs.readFileSync(tokenPath, "utf8").trim();
    }
  }

  // 3. Fallback to process.env.AICO_STDIO_TOKEN
  if (process.env.AICO_STDIO_TOKEN) {
    return process.env.AICO_STDIO_TOKEN.trim();
  }

  throw new Error(`AUTH_BOOTSTRAP_FAILED: No token file found for agent '${agentId}'. Raw CLI tokens are prohibited.`);
}

export function parseArgs(args: string[]): ClientBridgeConfig {
  let agentId = "flash-02";
  let gatewayUrl = "http://127.0.0.1:3334/mcp";
  let tokenFilePath: string | undefined;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--agent" && args[i + 1]) {
      agentId = args[i + 1];
      i++;
    } else if (args[i] === "--gateway" && args[i + 1]) {
      gatewayUrl = args[i + 1];
      i++;
    } else if (args[i] === "--token-file" && args[i + 1]) {
      tokenFilePath = args[i + 1];
      i++;
    } else if (args[i] === "--token") {
      console.error("SECURITY_WARNING: Passing --token via CLI arguments is strictly forbidden. Use --token-file or AICO_STDIO_TOKEN_FILE.");
      process.exit(1);
    }
  }

  return {
    agentId,
    gatewayUrl,
    tokenFilePath,
    maxFrameBytes: 2 * 1024 * 1024, // 2 MiB
    timeoutMs: 30000 // 30s
  };
}

export async function forwardJsonRpc(
  gatewayUrl: string,
  token: string,
  requestJson: any,
  timeoutMs = 30000
): Promise<any> {
  return new Promise((resolve, reject) => {
    const url = new URL(gatewayUrl);
    const bodyStr = JSON.stringify(requestJson);

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "Content-Length": Buffer.byteLength(bodyStr).toString(),
      "Authorization": `Bearer ${token}`,
      "Connection": "close"
    };

    const req = http.request(
      {
        hostname: url.hostname,
        port: url.port,
        path: url.pathname,
        method: "POST",
        headers,
        agent: false,
        timeout: timeoutMs
      },
      (res) => {
        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => {
          try {
            const parsed = JSON.parse(data);
            resolve(parsed);
          } catch {
            resolve({ jsonrpc: "2.0", id: requestJson.id, error: { code: -32603, message: data || "Internal error" } });
          }
        });
      }
    );

    req.on("timeout", () => {
      req.destroy();
      resolve({
        jsonrpc: "2.0",
        id: requestJson.id,
        error: { code: -32000, message: `Bridge request timeout after ${timeoutMs}ms` }
      });
    });

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
  let token = "";

  try {
    token = resolveToken(config.agentId, config.tokenFilePath);
  } catch (err: any) {
    console.error("ClientBridge token error:", err.message);
    process.exit(1);
  }

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: false
  });

  rl.on("line", async (line) => {
    if (!line.trim()) return;

    if (Buffer.byteLength(line, "utf8") > config.maxFrameBytes) {
      console.error(`PAYLOAD_TOO_LARGE: Line exceeds limit ${config.maxFrameBytes} bytes`);
      return;
    }

    try {
      const jsonRpc = JSON.parse(line);
      const response = await forwardJsonRpc(config.gatewayUrl, token, jsonRpc, config.timeoutMs);
      console.log(JSON.stringify(response));
    } catch (err: any) {
      console.error("ClientBridge JSON parse error:", err.message);
    }
  });
}

if (process.argv[1]?.endsWith("client-bridge.ts") || process.argv[1]?.endsWith("client-bridge.js")) {
  startBridge();
}
