import * as crypto from "node:crypto";
import { ConnectionManager } from "../db/connection-manager.js";
import type { PrincipalContext } from "../security/context-store.js";

export type { PrincipalContext };

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
  key_prefix: string;
  status: string;
  scopes: string[];
  allow_public_gateway: boolean;
  created_at: string;
  expires_at: string;
  last_used_at: string | null;
}

export interface IssueCredentialInput {
  principal_id: string;
  scopes?: string[];
  allow_public_gateway?: boolean;
  expires_in_days?: number;
  description?: string;
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
        name: "Company Founder",
        role: "Founder",
        department: "Executive",
        is_human: true,
        status: "active",
        capabilities: ["all", "destructive", "migration", "governance", "security:admin"]
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

    const scopesSet = new Set<string>(
      p.is_human
        ? ["*"]
        : ["company:read", "workspace:read:self", "workspace:write:self", "tasks:read:assigned", "tasks:update:assigned"]
    );

    return {
      authenticated: true,
      principalId: p.principal_id,
      principalType: p.is_human ? "human" : "agent",
      displayName: p.name,
      agentId: p.is_human ? null : p.principal_id,
      scopes: scopesSet,
      credentialId: "cred_internal",
      role: p.role,
      department: p.department,
      accessProfile: p.is_human ? "human_owner" : "local_agent_physical",
      workspaceId: p.is_human ? null : `ws_${p.principal_id}`,
      allowPublicGateway: !p.is_human,
      sourceGateway: "local",
      requestId: "req_internal",
      authenticatedAt: new Date().toISOString()
    };
  }

  public issueCredential(
    arg1: string | IssueCredentialInput,
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
    let description: string | undefined;

    if (typeof arg1 === "object") {
      principalId = arg1.principal_id;
      scopes = arg1.scopes || [];
      allowPublicGateway = arg1.allow_public_gateway || false;
      expiresInDays = arg1.expires_in_days || 90;
      description = arg1.description;
    } else {
      principalId = arg1;
      scopes = arg2 || [];
      allowPublicGateway = arg3 || false;
      expiresInDays = arg4 || 90;
    }

    const rawToken = "aico_live_" + crypto.randomBytes(32).toString("hex");
    const secretHash = crypto.createHash("sha256").update(rawToken).digest("hex");
    const credentialId = "cred_" + crypto.randomBytes(12).toString("hex");
    const keyPrefix = rawToken.slice(0, 16);

    const now = new Date();
    const expiresAt = new Date(now.getTime() + expiresInDays * 24 * 60 * 60 * 1000).toISOString();

    this.connManager.withWriteTransaction((db) => {
      if (principalId === "founder-01") {
        db.prepare(`
          INSERT INTO human_credentials (
            credential_id, human_id, key_prefix, secret_hash, scopes_json,
            status, expires_at, created_at
          ) VALUES (?, ?, ?, ?, ?, 'active', ?, ?)
        `).run(
          credentialId,
          "founder-01",
          keyPrefix,
          secretHash,
          JSON.stringify(scopes.length > 0 ? scopes : ["*"]),
          expiresAt,
          now.toISOString()
        );
      } else {
        const agent = db.prepare("SELECT * FROM agents WHERE agent_id = ?").get(principalId) as any;
        if (!agent) {
          throw new Error(`RESOURCE_NOT_FOUND: Agent ${principalId} not found`);
        }

        db.prepare(`
          INSERT INTO agent_credentials (
            credential_id, agent_id, key_prefix, secret_hash, scopes_json,
            status, allow_public_gateway, issued_by_human_id, description,
            expires_at, created_at
          ) VALUES (?, ?, ?, ?, ?, 'active', ?, 'founder-01', ?, ?, ?)
        `).run(
          credentialId,
          principalId,
          keyPrefix,
          secretHash,
          JSON.stringify(scopes),
          allowPublicGateway ? 1 : 0,
          description || `Credential for ${principalId}`,
          expiresAt,
          now.toISOString()
        );
      }
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
          key_prefix: r.key_prefix || "aico_live_...",
          status: r.status || (r.is_revoked === 1 ? "revoked" : "active"),
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
    const secretHash = crypto.createHash("sha256").update(rawToken).digest("hex");
    const newCredentialId = "cred_" + crypto.randomBytes(12).toString("hex");
    const keyPrefix = rawToken.slice(0, 16);
    const now = new Date();
    const expiresAt = new Date(now.getTime() + expiresInDays * 24 * 60 * 60 * 1000).toISOString();

    return this.connManager.withWriteTransaction((db) => {
      // Check human_credentials first
      const humanRow = db.prepare("SELECT * FROM human_credentials WHERE credential_id = ?").get(oldCredentialId) as any;
      if (humanRow) {
        if (humanRow.status === "revoked") {
          throw new Error("CREDENTIAL_ALREADY_REVOKED: Cannot rotate a revoked credential");
        }
        db.prepare("UPDATE human_credentials SET status = 'revoked', revoked_at = ?, revoked_reason = 'rotated' WHERE credential_id = ?").run(now.toISOString(), oldCredentialId);
        db.prepare(`
          INSERT INTO human_credentials (
            credential_id, human_id, key_prefix, secret_hash, scopes_json,
            status, expires_at, created_at
          ) VALUES (?, ?, ?, ?, ?, 'active', ?, ?)
        `).run(
          newCredentialId,
          humanRow.human_id,
          keyPrefix,
          secretHash,
          humanRow.scopes_json,
          expiresAt,
          now.toISOString()
        );
        return {
          new_credential_id: newCredentialId,
          old_credential_id: oldCredentialId,
          raw_token_display_once: rawToken,
          key_prefix: keyPrefix,
          expires_at: expiresAt
        };
      }

      // Check agent_credentials
      const agentRow = db.prepare("SELECT * FROM agent_credentials WHERE credential_id = ?").get(oldCredentialId) as any;
      if (!agentRow) {
        throw new Error(`RESOURCE_NOT_FOUND: Credential ${oldCredentialId} not found`);
      }
      if (agentRow.status === "revoked") {
        throw new Error("CREDENTIAL_ALREADY_REVOKED: Cannot rotate a revoked credential");
      }

      db.prepare("UPDATE agent_credentials SET status = 'revoked', revoked_at = ?, revoked_reason = 'rotated' WHERE credential_id = ?").run(now.toISOString(), oldCredentialId);
      db.prepare(`
        INSERT INTO agent_credentials (
          credential_id, agent_id, key_prefix, secret_hash, scopes_json,
          status, allow_public_gateway, issued_by_human_id, description,
          expires_at, created_at
        ) VALUES (?, ?, ?, ?, ?, 'active', ?, 'founder-01', ?, ?, ?)
      `).run(
        newCredentialId,
        agentRow.agent_id,
        keyPrefix,
        secretHash,
        agentRow.scopes_json,
        agentRow.allow_public_gateway,
        agentRow.description,
        expiresAt,
        now.toISOString()
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

  public revokeCredential(credentialId: string, reason = "administrative_revocation"): void {
    const now = new Date().toISOString();
    this.connManager.withWriteTransaction((db) => {
      db.prepare("UPDATE human_credentials SET status = 'revoked', revoked_at = ?, revoked_reason = ? WHERE credential_id = ?").run(now, reason, credentialId);
      db.prepare("UPDATE agent_credentials SET status = 'revoked', revoked_at = ?, revoked_reason = ? WHERE credential_id = ?").run(now, reason, credentialId);
    });
  }

  public authenticateToken(
    rawToken: string,
    sourceGateway: "local" | "public" | "stdio" = "local",
    requestId = "req_auth"
  ): PrincipalContext {
    if (!rawToken || typeof rawToken !== "string") {
      return {
        authenticated: false,
        principalId: "",
        principalType: "agent",
        displayName: "",
        agentId: null,
        credentialId: "",
        role: "",
        department: "",
        scopes: new Set<string>(),
        accessProfile: "local_agent_physical",
        workspaceId: null,
        allowPublicGateway: false,
        sourceGateway,
        requestId,
        authenticatedAt: new Date().toISOString(),
        error: "Missing or invalid token"
      };
    }

    const tokenHash = crypto.createHash("sha256").update(rawToken).digest("hex");
    const candBuf = Buffer.from(tokenHash, "hex");

    return this.connManager.withReadTransaction((db) => {
      // Check human_credentials
      const humanRows = db.prepare("SELECT * FROM human_credentials WHERE status = 'active'").all() as any[];
      for (const row of humanRows) {
        const rowBuf = Buffer.from(row.secret_hash, "hex");
        if (rowBuf.length === candBuf.length && crypto.timingSafeEqual(rowBuf, candBuf)) {
          if (new Date(row.expires_at) <= new Date()) {
            return {
              authenticated: false,
              principalId: "founder-01",
              principalType: "human",
              displayName: "Company Founder",
              agentId: null,
              credentialId: row.credential_id,
              role: "Founder",
              department: "Executive",
              scopes: new Set<string>(),
              accessProfile: "human_owner",
              workspaceId: null,
              allowPublicGateway: false,
              sourceGateway,
              requestId,
              authenticatedAt: new Date().toISOString(),
              error: "Credential has expired"
            };
          }

          let scopes: string[] = ["*"];
          try {
            scopes = JSON.parse(row.scopes_json || '["*"]');
          } catch {
            scopes = ["*"];
          }
          Object.defineProperty(scopes, "has", {
            value: (item: string) => scopes.includes(item) || scopes.includes("*"),
            enumerable: false,
            configurable: true
          });

          return {
            authenticated: true,
            principalId: "founder-01",
            principalType: "human",
            displayName: "Company Founder",
            agentId: null,
            credentialId: row.credential_id,
            role: "Founder",
            department: "Executive",
            scopes: scopes as any,
            accessProfile: "human_owner",
            workspaceId: null,
            allowPublicGateway: true,
            sourceGateway,
            requestId,
            authenticatedAt: new Date().toISOString()
          };
        }
      }

      // Check agent_credentials
      const agentRows = db.prepare(`
        SELECT c.*, a.display_name, a.role, a.department
        FROM agent_credentials c
        JOIN agents a ON c.agent_id = a.agent_id
        WHERE c.status = 'active'
      `).all() as any[];

      for (const row of agentRows) {
        const rowBuf = Buffer.from(row.secret_hash, "hex");
        if (rowBuf.length === candBuf.length && crypto.timingSafeEqual(rowBuf, candBuf)) {
          if (new Date(row.expires_at) <= new Date()) {
            return {
              authenticated: false,
              principalId: row.agent_id,
              principalType: "agent",
              displayName: row.display_name || row.agent_id,
              agentId: row.agent_id,
              credentialId: row.credential_id,
              role: row.role || "Agent",
              department: row.department || "Engineering",
              scopes: new Set<string>(),
              accessProfile: "local_agent_physical",
              workspaceId: `ws_${row.agent_id}`,
              allowPublicGateway: row.allow_public_gateway === 1,
              sourceGateway,
              requestId,
              authenticatedAt: new Date().toISOString(),
              error: "Credential has expired"
            };
          }

          if (sourceGateway === "public" && row.allow_public_gateway !== 1) {
            return {
              authenticated: false,
              principalId: row.agent_id,
              principalType: "agent",
              displayName: row.display_name || row.agent_id,
              agentId: row.agent_id,
              credentialId: row.credential_id,
              role: row.role || "Agent",
              department: row.department || "Engineering",
              scopes: new Set<string>(),
              accessProfile: "local_agent_physical",
              workspaceId: `ws_${row.agent_id}`,
              allowPublicGateway: false,
              sourceGateway,
              requestId,
              authenticatedAt: new Date().toISOString(),
              error: "Public gateway access not permitted for this credential"
            };
          }

          let scopes: string[] = [];
          try {
            scopes = JSON.parse(row.scopes_json || "[]");
          } catch {
            scopes = [];
          }
          Object.defineProperty(scopes, "has", {
            value: (item: string) => scopes.includes(item) || scopes.includes("*"),
            enumerable: false,
            configurable: true
          });

          return {
            authenticated: true,
            principalId: row.agent_id,
            principalType: "agent",
            displayName: row.display_name || row.agent_id,
            agentId: row.agent_id,
            credentialId: row.credential_id,
            role: row.role || "Agent",
            department: row.department || "Engineering",
            scopes: scopes as any,
            accessProfile: row.agent_id.startsWith("argon") || row.agent_id === "chatgpt-01" ? "web_agent_logical" : "local_agent_physical",
            workspaceId: `ws_${row.agent_id}`,
            allowPublicGateway: row.allow_public_gateway === 1,
            sourceGateway,
            requestId,
            authenticatedAt: new Date().toISOString()
          };
        }
      }

      return {
        authenticated: false,
        principalId: "",
        principalType: "agent",
        displayName: "",
        agentId: null,
        credentialId: "",
        role: "",
        department: "",
        scopes: new Set<string>(),
        accessProfile: "local_agent_physical",
        workspaceId: null,
        allowPublicGateway: false,
        sourceGateway,
        requestId,
        authenticatedAt: new Date().toISOString(),
        error: "Invalid token"
      };
    });
  }

  public assertAuthorized(
    ctx: PrincipalContext,
    requiredScopes: string[],
    abacCheck?: (ctx: PrincipalContext) => void
  ): void {
    if (!ctx.authenticated) {
      throw new Error("AUTH_MISSING_OR_INVALID_TOKEN: Unauthenticated request");
    }

    // Founder has full wildcard
    if (ctx.scopes.has("*") || (ctx.principalType === "human" && ctx.principalId === "founder-01")) {
      if (abacCheck) abacCheck(ctx);
      return;
    }

    for (const req of requiredScopes) {
      if (!ctx.scopes.has(req)) {
        throw new Error(`PERMISSION_DENIED: Missing required scope '${req}'`);
      }
    }

    if (abacCheck) {
      abacCheck(ctx);
    }
  }

  public checkPermission(
    ctx: PrincipalContext,
    scope: string,
    targetResource?: string
  ): { allowed: boolean; reason: string } {
    if (!ctx.authenticated) {
      return { allowed: false, reason: "Unauthenticated request" };
    }

    if (ctx.scopes.has("*") || (ctx.principalType === "human" && ctx.principalId === "founder-01")) {
      return { allowed: true, reason: "Founder full authorization" };
    }

    if (!ctx.scopes.has(scope)) {
      return { allowed: false, reason: `Missing scope '${scope}'` };
    }

    return { allowed: true, reason: "Authorized" };
  }

  public getMyIdentity(ctx: PrincipalContext): {
    principal_id: string;
    principal_type: string;
    display_name: string;
    agent_id: string | null;
    role: string;
    department: string;
    scopes: string[];
    workspace_id: string | null;
    source_gateway: string;
    authenticated_at: string;
  } {
    return {
      principal_id: ctx.principalId,
      principal_type: ctx.principalType,
      display_name: ctx.displayName,
      agent_id: ctx.agentId,
      role: ctx.role,
      department: ctx.department,
      scopes: Array.from(ctx.scopes),
      workspace_id: ctx.workspaceId,
      source_gateway: ctx.sourceGateway,
      authenticated_at: ctx.authenticatedAt
    };
  }
}
