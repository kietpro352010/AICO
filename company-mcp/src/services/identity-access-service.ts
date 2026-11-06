import * as crypto from "node:crypto";
import { ConnectionManager } from "../db/connection-manager.js";

export interface PrincipalIdentity {
  principal_id: string;
  name: string;
  role: string;
  department: string;
  is_human: boolean;
  status: string;
  capabilities: string[];
}

export interface CredentialRecord {
  credential_id: string;
  principal_id: string;
  scopes: string[];
  allow_public_gateway: boolean;
  is_revoked: boolean;
  created_at: string;
  expires_at: string | null;
  last_used_at: string | null;
}

export class IdentityAccessService {
  private connManager: ConnectionManager;
  private tokenCache: Map<string, { principalId: string; scopes: string[]; allowPublic: boolean; lastUsedAt: number }> = new Map();

  constructor(connManager: ConnectionManager) {
    this.connManager = connManager;
  }

  public getPrincipal(principalId: string): PrincipalIdentity | null {
    if (principalId === "founder-01") {
      return {
        principal_id: "founder-01",
        name: "Founder & Owner",
        role: "Founder",
        department: "Executive",
        is_human: true,
        status: "active",
        capabilities: ["all", "destructive", "migration", "governance"]
      };
    }

    return this.connManager.withReadTransaction((db) => {
      const row = db.prepare("SELECT * FROM agents WHERE agent_id = ?").get(principalId) as any;
      if (!row) return null;

      let caps: string[] = [];
      try {
        caps = JSON.parse(row.capabilities_json || "[]");
      } catch {
        caps = [];
      }

      return {
        principal_id: row.agent_id,
        name: row.display_name,
        role: row.role,
        department: row.department,
        is_human: false,
        status: row.status,
        capabilities: caps
      };
    });
  }

  public issueCredential(principalId: string, scopes: string[] = [], allowPublicGateway = false, expiresInDays = 30): { token: string; credentialId: string } {
    const rawToken = "aico_live_" + crypto.randomBytes(32).toString("hex");
    const tokenHash = crypto.createHash("sha256").update(rawToken).digest("hex");
    const credentialId = "cred_" + crypto.randomBytes(12).toString("hex");

    const now = new Date();
    const expiresAt = new Date(now.getTime() + expiresInDays * 24 * 60 * 60 * 1000).toISOString();

    this.connManager.withWriteTransaction((db) => {
      db.prepare(`
        INSERT INTO credentials (
          credential_id, principal_id, token_hash, scopes_json,
          allow_public_gateway, is_revoked, created_at, expires_at, last_used_at
        ) VALUES (?, ?, ?, ?, ?, 0, ?, ?, NULL)
      `).run(
        credentialId,
        principalId,
        tokenHash,
        JSON.stringify(scopes),
        allowPublicGateway ? 1 : 0,
        now.toISOString(),
        expiresAt
      );
    });

    return { token: rawToken, credentialId };
  }

  public authenticateToken(rawToken: string, isPublicGateway = false): { authenticated: boolean; principalId?: string; scopes?: string[]; error?: string } {
    if (!rawToken || typeof rawToken !== "string") {
      return { authenticated: false, error: "Missing or invalid token" };
    }

    const tokenHash = crypto.createHash("sha256").update(rawToken).digest("hex");

    return this.connManager.withReadTransaction((db) => {
      const rows = db.prepare("SELECT * FROM credentials WHERE is_revoked = 0").all() as any[];

      let matchedRow: any = null;
      for (const row of rows) {
        const rowBuf = Buffer.from(row.token_hash, "hex");
        const candBuf = Buffer.from(tokenHash, "hex");

        if (rowBuf.length === candBuf.length && crypto.timingSafeEqual(rowBuf, candBuf)) {
          matchedRow = row;
          break;
        }
      }

      if (!matchedRow) {
        return { authenticated: false, error: "Invalid token" };
      }

      if (matchedRow.expires_at && new Date(matchedRow.expires_at).getTime() < Date.now()) {
        return { authenticated: false, error: "Token expired" };
      }

      if (isPublicGateway && matchedRow.allow_public_gateway !== 1) {
        return { authenticated: false, error: "Token not authorized for public gateway" };
      }

      let scopes: string[] = [];
      try {
        scopes = JSON.parse(matchedRow.scopes_json || "[]");
      } catch {
        scopes = [];
      }

      return {
        authenticated: true,
        principalId: matchedRow.principal_id,
        scopes
      };
    });
  }

  public authorizeAction(principalId: string, requiredScope: string, tokenScopes?: string[]): boolean {
    if (principalId === "founder-01") return true;

    if (tokenScopes && !tokenScopes.includes(requiredScope) && !tokenScopes.includes("*")) {
      return false;
    }

    const principal = this.getPrincipal(principalId);
    if (!principal || principal.status !== "configured" && principal.status !== "active") {
      return false;
    }

    return true;
  }
}
