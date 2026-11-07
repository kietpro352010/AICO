import crypto from "node:crypto";
import type { Request, Response, NextFunction } from "express";
import { TokenBucketRateLimiter } from "./rate-limiter.js";
import { IdentityAccessService, type PrincipalContext } from "../services/identity-access-service.js";
import { SecretScanner } from "./secret-scanner.js";
import { requestContextStore } from "./context-store.js";

export interface GatewaySecurityProfile {
  gatewayType: "local" | "public";
  port: number;
  maxBodySizeBytes: number;
  requestTimeoutMs: number;
  allowedHosts: string[];
  allowedOrigins: string[];
  credentialRateLimit: { refillRatePerMinute: number; burstCapacity: number };
  unauthenticatedRateLimit: { refillRatePerMinute: number; burstCapacity: number };
}

export const LOCAL_GATEWAY_PROFILE: GatewaySecurityProfile = {
  gatewayType: "local",
  port: 3334,
  maxBodySizeBytes: 1024 * 1024, // 1 MiB
  requestTimeoutMs: 30000, // 30s
  allowedHosts: ["127.0.0.1:3334", "localhost:3334", "127.0.0.1", "localhost"],
  allowedOrigins: ["http://127.0.0.1:3334", "http://localhost:3334", "http://127.0.0.1", "http://localhost"],
  credentialRateLimit: { refillRatePerMinute: 120, burstCapacity: 30 },
  unauthenticatedRateLimit: { refillRatePerMinute: 60, burstCapacity: 15 }
};

export const PUBLIC_GATEWAY_PROFILE: GatewaySecurityProfile = {
  gatewayType: "public",
  port: 3335,
  maxBodySizeBytes: 256 * 1024, // 256 KiB
  requestTimeoutMs: 15000, // 15s
  allowedHosts: (process.env.AICO_PUBLIC_ALLOWED_HOSTS || "127.0.0.1:3335,localhost:3335")
    .split(",")
    .map((h) => h.trim()),
  allowedOrigins: (process.env.AICO_PUBLIC_ALLOWED_ORIGINS || "")
    .split(",")
    .map((o) => o.trim())
    .filter(Boolean),
  credentialRateLimit: { refillRatePerMinute: 60, burstCapacity: 15 },
  unauthenticatedRateLimit: { refillRatePerMinute: 30, burstCapacity: 10 }
};

export const PUBLIC_TOOL_ALLOWLIST = new Set([
  "company_ping",
  "company_get_info",
  "company_list_agents",
  "company_get_agent",
  "company_list_quota_pools",
  "company_get_manifest",
  "company_get_my_identity",
  "company_check_permission",
  "company_request_approval",
  "company_list_approval_requests",
  "company_get_approval_request",
  "company_get_workspace",
  "company_list_workspace_files",
  "company_read_workspace_file",
  "company_write_workspace_file",
  "company_share_workspace_artifact",
  "company_create_project",
  "company_list_projects",
  "company_create_task",
  "company_list_tasks",
  "company_get_task",
  "company_claim_task",
  "company_heartbeat_task",
  "company_transition_task",
  "company_submit_task_result",
  "company_send_message",
  "company_list_inbox",
  "company_ack_message",
  "company_knowledge_memory_ops"
]);

export interface AuthenticatedRequest extends Request {
  requestId: string;
  principalContext?: PrincipalContext;
}

export class HttpSecurityPipeline {
  private profile: GatewaySecurityProfile;
  private identityService: IdentityAccessService;
  private credLimiter: TokenBucketRateLimiter;
  private ipLimiter: TokenBucketRateLimiter;

  constructor(profile: GatewaySecurityProfile, identityService: IdentityAccessService) {
    this.profile = profile;
    this.identityService = identityService;
    this.credLimiter = new TokenBucketRateLimiter(profile.credentialRateLimit);
    this.ipLimiter = new TokenBucketRateLimiter(profile.unauthenticatedRateLimit);
  }

  public middleware() {
    return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
      const authReq = req as AuthenticatedRequest;
      authReq.requestId = crypto.randomUUID();

      // Step 1: Execution Deadline Timer
      const timeoutHandle = setTimeout(() => {
        if (!res.headersSent) {
          res.status(504).json({
            error_code: "GATEWAY_TIMEOUT",
            message: `Request exceeded ${this.profile.requestTimeoutMs}ms execution timeout`,
            request_id: authReq.requestId
          });
        }
      }, this.profile.requestTimeoutMs);

      res.on("finish", () => clearTimeout(timeoutHandle));
      res.on("close", () => clearTimeout(timeoutHandle));

      // Step 2: Request Body Size Enforcement
      const contentLengthHeader = req.headers["content-length"];
      if (contentLengthHeader) {
        const contentLength = parseInt(contentLengthHeader, 10);
        if (!isNaN(contentLength) && contentLength > this.profile.maxBodySizeBytes) {
          clearTimeout(timeoutHandle);
          res.status(413).json({
            error_code: "PAYLOAD_TOO_LARGE",
            message: `Request body size ${contentLength} bytes exceeds gateway limit of ${this.profile.maxBodySizeBytes} bytes`,
            request_id: authReq.requestId
          });
          return;
        }
      }

      // Stream size monitor for chunked transfers without content-length
      let receivedBytes = 0;
      let limitExceeded = false;
      req.on("data", (chunk: Buffer) => {
        receivedBytes += chunk.length;
        if (receivedBytes > this.profile.maxBodySizeBytes && !limitExceeded) {
          limitExceeded = true;
          clearTimeout(timeoutHandle);
          res.status(413).json({
            error_code: "PAYLOAD_TOO_LARGE",
            message: `Request stream exceeded maximum allowed size of ${this.profile.maxBodySizeBytes} bytes`,
            request_id: authReq.requestId
          });
          req.destroy();
        }
      });

      // Step 3: Endpoint Path Allowlist
      if (req.path !== "/health" && req.path !== "/mcp") {
        clearTimeout(timeoutHandle);
        res.status(404).json({
          error_code: "RESOURCE_NOT_FOUND",
          message: `Endpoint '${req.path}' is not exposed on this gateway`,
          request_id: authReq.requestId
        });
        return;
      }

      // Step 4: Content-Type & HTTP Method Validation
      if (req.path === "/health") {
        if (req.method !== "GET") {
          clearTimeout(timeoutHandle);
          res.status(405).json({
            error_code: "METHOD_NOT_ALLOWED",
            message: "Only GET allowed on /health",
            request_id: authReq.requestId
          });
          return;
        }

        const ip = req.ip || req.socket.remoteAddress || "unknown";
        const rate = this.ipLimiter.consume(ip);
        if (!rate.allowed) {
          clearTimeout(timeoutHandle);
          res.setHeader("Retry-After", String(rate.retryAfterSeconds));
          res.status(429).json({
            error_code: "RATE_LIMIT_EXCEEDED",
            message: "Rate limit exceeded on unauthenticated endpoint",
            request_id: authReq.requestId
          });
          return;
        }

        clearTimeout(timeoutHandle);
        res.status(200).json({
          status: "healthy",
          gateway: this.profile.gatewayType,
          timestamp: new Date().toISOString()
        });
        return;
      }

      // For /mcp endpoint
      if (req.method !== "POST") {
        clearTimeout(timeoutHandle);
        res.status(405).json({
          error_code: "METHOD_NOT_ALLOWED",
          message: "Only POST allowed on /mcp",
          request_id: authReq.requestId
        });
        return;
      }

      const contentType = req.headers["content-type"] || "";
      if (!contentType.includes("application/json")) {
        clearTimeout(timeoutHandle);
        res.status(415).json({
          error_code: "UNSUPPORTED_MEDIA_TYPE",
          message: "Content-Type must be application/json",
          request_id: authReq.requestId
        });
        return;
      }

      // Step 5: Host & Origin Header Verification (DNS Rebinding Defense)
      const host = req.headers.host || "";
      const isHostAllowed = this.profile.allowedHosts.some(
        (allowed) => host === allowed || host.startsWith(`${allowed}:`)
      );
      if (!isHostAllowed) {
        clearTimeout(timeoutHandle);
        res.status(403).json({
          error_code: "AUTH_FORBIDDEN_HOST",
          message: `Invalid Host header: ${host}`,
          request_id: authReq.requestId
        });
        return;
      }

      const origin = req.headers.origin;
      if (origin) {
        const isOriginAllowed = this.profile.allowedOrigins.some(
          (allowed) => origin === allowed || allowed === "*"
        );
        if (!isOriginAllowed && this.profile.allowedOrigins.length > 0) {
          clearTimeout(timeoutHandle);
          res.status(403).json({
            error_code: "AUTH_FORBIDDEN_ORIGIN",
            message: `Invalid Origin header: ${origin}`,
            request_id: authReq.requestId
          });
          return;
        }
      }

      // Step 6: Unauthenticated IP Rate Limiting
      const clientIp = req.ip || req.socket.remoteAddress || "127.0.0.1";
      const ipCheck = this.ipLimiter.consume(clientIp);
      if (!ipCheck.allowed) {
        clearTimeout(timeoutHandle);
        res.setHeader("Retry-After", String(ipCheck.retryAfterSeconds));
        res.status(429).json({
          error_code: "RATE_LIMIT_EXCEEDED",
          message: `Unauthenticated rate limit exceeded. Retry in ${ipCheck.retryAfterSeconds}s`,
          request_id: authReq.requestId
        });
        return;
      }

      // Step 7: Bearer Token Extraction & Timing-Safe Verification
      const authHeader = req.headers.authorization;
      if (!authHeader || !authHeader.startsWith("Bearer ")) {
        clearTimeout(timeoutHandle);
        await new Promise((r) => setTimeout(r, 20 + Math.random() * 30));
        res.status(401).json({
          error_code: "AUTH_MISSING_OR_INVALID_TOKEN",
          message: "Authorization Bearer token required",
          request_id: authReq.requestId
        });
        return;
      }

      const rawToken = authHeader.substring(7).trim();
      const principal = this.identityService.authenticateToken(
        rawToken,
        this.profile.gatewayType as "local" | "public",
        authReq.requestId
      );

      if (!principal || !principal.authenticated) {
        clearTimeout(timeoutHandle);
        await new Promise((r) => setTimeout(r, 20 + Math.random() * 30));
        res.status(401).json({
          error_code: "AUTH_MISSING_OR_INVALID_TOKEN",
          message: principal?.error || "Bearer token invalid, expired or revoked",
          request_id: authReq.requestId
        });
        return;
      }

      // Step 8: Gateway Profile Restrictions
      if (this.profile.gatewayType === "public") {
        if (principal.principalType === "human") {
          clearTimeout(timeoutHandle);
          res.status(403).json({
            error_code: "AUTH_HUMAN_FORBIDDEN_ON_PUBLIC_GATEWAY",
            message: "Human principal founder-01 is forbidden on Public Gateway",
            request_id: authReq.requestId
          });
          return;
        }

        if (!principal.allowPublicGateway) {
          clearTimeout(timeoutHandle);
          res.status(403).json({
            error_code: "AUTH_PUBLIC_GATEWAY_DISALLOWED",
            message: `Principal ${principal.principalId} is not permitted on Public Gateway`,
            request_id: authReq.requestId
          });
          return;
        }
      }

      // Step 9: Authenticated Credential Rate Limiting
      const credCheck = this.credLimiter.consume(principal.credentialId);
      if (!credCheck.allowed) {
        clearTimeout(timeoutHandle);
        res.setHeader("Retry-After", String(credCheck.retryAfterSeconds));
        res.status(429).json({
          error_code: "RATE_LIMIT_EXCEEDED",
          message: `Credential rate limit exceeded. Retry in ${credCheck.retryAfterSeconds}s`,
          request_id: authReq.requestId
        });
        return;
      }

      // Step 10: Secret Scanning on Payload & Request Context Propagation
      if (req.body && typeof req.body === "object") {
        const bodyStr = JSON.stringify(req.body);
        const scan = SecretScanner.scan(bodyStr);
        if (scan.hasSecret) {
          clearTimeout(timeoutHandle);
          res.status(400).json({
            error_code: "SECRET_LEAK_PREVENTED",
            message: `Request payload contains sensitive secret pattern: ${scan.patternMatched}`,
            request_id: authReq.requestId
          });
          return;
        }
      }

      authReq.principalContext = principal;
      requestContextStore.run(principal, () => {
        next();
      });
    };
  }
}
