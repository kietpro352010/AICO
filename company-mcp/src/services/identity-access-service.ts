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

export interface PrincipalContext {
  authenticated: boolean;
  principalId: string;
  principalType: "human" | "agent" | "service";
  displayName: string;
  agentId?: string;
  scopes: string[];
  credentialId: string;
  allowPublicGateway: boolean;
  error?: string;
}

export interface CredentialRecord {
  credential_id: string;
  principal_id: string;
  key_prefix: string;
  status: string;
  scopes: string[];
  allow_public_gateway: boolean;
  created_at: string;
  expires_at: string;
  last_used_at: string | null;
}

export class IdentityAccessService {
  private connManager: ConnectionManager;

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

  public getPrincipalById(principalId: string): PrincipalContext | null {
    const p = this.getPrincipal(principalId);
    if (!p) return null;

    return {
      authenticated: true,
      principalId: p.principal_id,
      principalType: p.is_human ? "human" : "agent",
      displayName: p.name,
      agentId: p.is_human ? undefined : p.principal_id,
      scopes: p.is_human ? ["*"] : ["company:read", "tasks:read:assigned", "tasks:update:assigned"],
      credentialId: "cred_internal",
      allowPublicGateway: !p.is_human
    };
  }

  public issueCredential(
    arg1: string | { principal_id: string; scopes?: string[]; allow_public_gateway?: boolean; expires_in_days?: number },
    arg2?: string[],
    arg3?: boolean,
    arg4?: number
  ): {
    token: string;
    raw_token_display_once: string;
    credentialId: string;
    credential_id: string;
    key_prefix: string;
    expires_at: string;
  } {
    let principalId: string;
    let scopes: string[] = [];
    let allowPublicGateway = false;
    let expiresInDays = 90;

    if (typeof arg1 === "object") {
      principalId = arg1.principal_id;
      scopes = arg1.scopes || [];
      allowPublicGateway = arg1.allow_public_gateway || false;
      expiresInDays = arg1.expires_in_days || 90;
    } else {
      principalId = arg1;
      scopes = arg2 || [];
      allowPublicGateway = arg3 || false;
      expiresInDays = arg4 || 90;
    }

    const rawToken = "aico_live_" + crypto.randomBytes(32).toString("hex");
    const tokenHash = crypto.createHash("sha256").update(rawToken).digest("hex");
    const credentialId = "cred_" + crypto.randomBytes(12).toString("hex");
    const keyPrefix = rawToken.slice(0, 16);

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

    return {
      token: rawToken,
      raw_token_display_once: rawToken,
      credentialId,
      credential_id: credentialId,
      key_prefix: keyPrefix,
      expires_at: expiresAt
    };
  }

  public listCredentials(principalId?: string): CredentialRecord[] {
    return this.connManager.withReadTransaction((db) => {
      const query = principalId
        ? "SELECT * FROM credentials WHERE principal_id = ? ORDER BY created_at DESC"
        : "SELECT * FROM credentials ORDER BY created_at DESC";
      const rows = (principalId ? db.prepare(query).all(principalId) : db.prepare(query).all()) as any[];

      return rows.map((r) => {
        let scopes: string[] = [];
        try {
          scopes = JSON.parse(r.scopes_json || "[]");
        } catch {
          scopes = [];
        }
        return {
          credential_id: r.credential_id,
          principal_id: r.principal_id,
          key_prefix: "aico_live_...",
          status: r.is_revoked === 1 ? "revoked" : "active",
          scopes,
          allow_public_gateway: r.allow_public_gateway === 1,
          created_at: r.created_at,
          expires_at: r.expires_at,
          last_used_at: r.last_used_at
        };
      });
    });
  }

  public rotateCredential(oldCredentialId: string, expiresInDays = 90): {
    new_credential_id: string;
    old_credential_id: string;
    raw_token_display_once: string;
    key_prefix: string;
    expires_at: string;
  } {
    const rawToken = "aico_live_" + crypto.randomBytes(32).toString("hex");
    const tokenHash = crypto.createHash("sha256").update(rawToken).digest("hex");
    const newCredentialId = "cred_" + crypto.randomBytes(12).toString("hex");
    const keyPrefix = rawToken.slice(0, 16);
    const now = new Date();
    const expiresAt = new Date(now.getTime() + expiresInDays * 24 * 60 * 60 * 1000).toISOString();

    return this.connManager.withWriteTransaction((db) => {
      const oldRow = db.prepare("SELECT * FROM credentials WHERE credential_id = ?").get(oldCredentialId) as any;
      if (!oldRow) {
        throw new Error(`RESOURCE_NOT_FOUND: Credential ${oldCredentialId} not found`);
      }
      if (oldRow.is_revoked === 1) {
        throw new Error("CREDENTIAL_ALREADY_REVOKED: Cannot rotate a revoked credential");
      }

      // Revoke old credential
      db.prepare("UPDATE credentials SET is_revoked = 1 WHERE credential_id = ?").run(oldCredentialId);

      // Insert new credential inheriting properties
      db.prepare(`
        INSERT INTO credentials (
          credential_id, principal_id, token_hash, scopes_json,
          allow_public_gateway, is_revoked, created_at, expires_at, last_used_at
        ) VALUES (?, ?, ?, ?, ?, 0, ?, ?, NULL)
      `).run(
        newCredentialId,
        oldRow.principal_id,
        tokenHash,
        oldRow.scopes_json,
        oldRow.allow_public_gateway,
        now.toISOString(),
        expiresAt
      );

      return {
        new_credential_id: newCredentialId,
        old_credential_id: oldCredentialId,
        raw_token_display_once: rawToken,
        key_prefix: keyPrefix,
        expires_at: expiresAt
      };
    });
  }

  public revokeCredential(credentialId: string, reason?: string): void {
    this.connManager.withWriteTransaction((db) => {
      db.prepare("UPDATE credentials SET is_revoked = 1 WHERE credential_id = ?").run(credentialId);
    });
  }

  public authenticateToken(rawToken: string, isPublicGateway = false): PrincipalContext {
    if (!rawToken || typeof rawToken !== "string") {
      return {
        authenticated: false,
        principalId: "",
        principalType: "agent",
        displayName: "",
        scopes: [],
        credentialId: "",
        allowPublicGateway: false,
        error: "Missing or invalid token"
      };
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
        return {
          authenticated: false,
          principalId: "",
          principalType: "agent",
          displayName: "",
          scopes: [],
          credentialId: "",
          allowPublicGateway: false,
          error: "Invalid token"
        };
      }

      if (matchedRow.expires_at && new Date(matchedRow.expires_at).getTime() < Date.now()) {
        return {
          authenticated: false,
          principalId: matchedRow.principal_id,
          principalType: "agent",
          displayName: "",
          scopes: [],
          credentialId: matchedRow.credential_id,
          allowPublicGateway: false,
          error: "Token expired"
        };
      }

      if (isPublicGateway && matchedRow.allow_public_gateway !== 1) {
        return {
          authenticated: false,
          principalId: matchedRow.principal_id,
          principalType: "agent",
          displayName: "",
          scopes: [],
          credentialId: matchedRow.credential_id,
          allowPublicGateway: false,
          error: "Token not authorized for public gateway"
        };
      }

      let scopes: string[] = [];
      try {
        scopes = JSON.parse(matchedRow.scopes_json || "[]");
      } catch {
        scopes = [];
      }

      const isHuman = matchedRow.principal_id === "founder-01";

      return {
        authenticated: true,
        principalId: matchedRow.principal_id,
        principalType: isHuman ? "human" : "agent",
        displayName: isHuman ? "Founder" : matchedRow.principal_id,
        agentId: isHuman ? undefined : matchedRow.principal_id,
        scopes,
        credentialId: matchedRow.credential_id,
        allowPublicGateway: matchedRow.allow_public_gateway === 1
      };
    });
  }

  public authorizeAction(principalId: string, requiredScope: string, tokenScopes?: string[]): boolean {
    if (principalId === "founder-01") return true;

    if (tokenScopes && !tokenScopes.includes(requiredScope) && !tokenScopes.includes("*")) {
      return false;
    }

    const principal = this.getPrincipal(principalId);
    if (!principal || (principal.status !== "configured" && principal.status !== "active")) {
      return false;
    }

    return true;
  }
}
