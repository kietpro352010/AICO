import fs from "node:fs";
import { IdentityAccessService, type PrincipalContext } from "../services/identity-access-service.js";

export interface StdioPipelineConfig {
  maxFrameSizeBytes?: number;
  messageTimeoutMs?: number;
}

export class StdioSecurityPipeline {
  private identityService: IdentityAccessService;
  private maxFrameSizeBytes: number;
  private messageTimeoutMs: number;
  private sessionPrincipal: PrincipalContext | null = null;

  constructor(identityService: IdentityAccessService, config?: StdioPipelineConfig) {
    this.identityService = identityService;
    this.maxFrameSizeBytes = config?.maxFrameSizeBytes ?? 2 * 1024 * 1024; // 2 MiB
    this.messageTimeoutMs = config?.messageTimeoutMs ?? 60000; // 60s
  }

  public bootstrap(tokenFilePath?: string): PrincipalContext {
    const filePath = tokenFilePath || process.env.AICO_STDIO_TOKEN_FILE;
    let rawToken: string | null = null;

    if (filePath && fs.existsSync(filePath)) {
      rawToken = fs.readFileSync(filePath, "utf8").trim();
    } else if (process.env.AICO_STDIO_TOKEN) {
      rawToken = process.env.AICO_STDIO_TOKEN.trim();
    }

    if (!rawToken) {
      throw new Error("AUTH_MISSING_OR_INVALID_TOKEN: No token file found for STDIO bootstrap");
    }

    const principal = this.identityService.authenticateToken(rawToken);
    if (!principal) {
      throw new Error("AUTH_MISSING_OR_INVALID_TOKEN: STDIO bootstrap token is invalid or expired");
    }

    this.sessionPrincipal = principal;
    return principal;
  }

  public validateMessageFrame(payloadSize: number): void {
    if (payloadSize > this.maxFrameSizeBytes) {
      throw new Error(`PAYLOAD_TOO_LARGE: Frame size ${payloadSize} exceeds limit ${this.maxFrameSizeBytes}`);
    }
  }

  public revalidateLivePrincipal(): PrincipalContext {
    if (!this.sessionPrincipal) {
      throw new Error("AUTH_NOT_BOOTSTRAPPED: STDIO session not initialized");
    }

    // Live DB verification: check if credential is still active
    const principal = this.identityService.getPrincipalById(this.sessionPrincipal.principalId);
    if (!principal) {
      throw new Error("AUTH_CREDENTIAL_REVOKED: Principal or credential revoked during active STDIO session");
    }

    return this.sessionPrincipal;
  }
}
