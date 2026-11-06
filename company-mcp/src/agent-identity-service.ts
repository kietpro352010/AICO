import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { DatabaseSync } from "node:sqlite";

export type AgentIdentity = {
  agent_id: string;
  display_name: string;
  role: string;
  department: string;
  scopes: string[];
  credential_id: string;
  access_profile: string;
  workspace_id: string;
};

export class AgentIdentityService {
  constructor(private db: DatabaseSync) {}

  /**
   * Hashes a raw token with SHA-256 in hexadecimal format.
   */
  public hashToken(rawToken: string): string {
    return createHash("sha256").update(rawToken.trim()).digest("hex");
  }

  /**
   * Generates a new secure random credential token for an agent.
   * Format: aico_<agentId>_<randomBytesHex>
   */
  public generateToken(
    agentId: string,
    scopes: string[] = ["workspace:read", "workspace:write:self"],
    expiresInHours?: number
  ): { credentialId: string; rawToken: string; keyPrefix: string } {
    const randomHex = randomBytes(24).toString("hex");
    const rawToken = `aico_${agentId}_${randomHex}`;
    const keyPrefix = rawToken.slice(0, 16);
    const secretHash = this.hashToken(rawToken);
    const credentialId = `cred_${randomBytes(8).toString("hex")}`;

    let expiresAt: string | null = null;
    if (expiresInHours) {
      const exp = new Date(Date.now() + expiresInHours * 3600 * 1000);
      expiresAt = exp.toISOString();
    }

    this.db.prepare(`
      INSERT INTO agent_credentials (credential_id, agent_id, key_prefix, secret_hash, scopes_json, status, expires_at)
      VALUES (?, ?, ?, ?, ?, 'active', ?)
    `).run(credentialId, agentId, keyPrefix, secretHash, JSON.stringify(scopes), expiresAt);

    return { credentialId, rawToken, keyPrefix };
  }

  /**
   * Validates a raw Bearer token, performs timing-safe hash lookup, and returns the verified AgentIdentity.
   * Never trusts any client-provided agent_id header or payload.
   */
  public authenticateToken(rawToken: string): AgentIdentity | null {
    if (!rawToken || typeof rawToken !== "string" || !rawToken.startsWith("aico_")) {
      return null;
    }

    const targetHash = this.hashToken(rawToken);
    const targetBuffer = Buffer.from(targetHash, "hex");

    // Fetch active candidates
    const rows = this.db.prepare(`
      SELECT 
        c.credential_id,
        c.agent_id,
        c.secret_hash,
        c.scopes_json,
        c.status,
        c.expires_at,
        a.display_name,
        a.role,
        a.department,
        w.workspace_id,
        w.access_profile
      FROM agent_credentials c
      JOIN agents a ON a.agent_id = c.agent_id
      LEFT JOIN agent_workspaces w ON w.agent_id = c.agent_id
      WHERE c.status = 'active'
    `).all() as Array<{
      credential_id: string;
      agent_id: string;
      secret_hash: string;
      scopes_json: string;
      status: string;
      expires_at: string | null;
      display_name: string;
      role: string;
      department: string;
      workspace_id: string | null;
      access_profile: string | null;
    }>;

    for (const row of rows) {
      const candidateBuffer = Buffer.from(row.secret_hash, "hex");
      if (candidateBuffer.length === targetBuffer.length && timingSafeEqual(candidateBuffer, targetBuffer)) {
        // Check expiration
        if (row.expires_at && new Date(row.expires_at).getTime() < Date.now()) {
          this.revokeCredential(row.credential_id, "expired");
          return null;
        }

        // Update last_used_at
        this.db.prepare(`
          UPDATE agent_credentials SET last_used_at = CURRENT_TIMESTAMP WHERE credential_id = ?
        `).run(row.credential_id);

        return {
          agent_id: row.agent_id,
          display_name: row.display_name,
          role: row.role,
          department: row.department,
          scopes: JSON.parse(row.scopes_json),
          credential_id: row.credential_id,
          access_profile: row.access_profile || "standard",
          workspace_id: row.workspace_id || `ws_${row.agent_id}`
        };
      }
    }

    return null;
  }

  /**
   * Revokes a specific credential.
   */
  public revokeCredential(credentialId: string, status: "revoked" | "expired" = "revoked"): boolean {
    const res = this.db.prepare(`
      UPDATE agent_credentials SET status = ? WHERE credential_id = ?
    `).run(status, credentialId);
    return res.changes > 0;
  }

  /**
   * Rotates a credential: creates a new one and immediately revokes the old one.
   */
  public rotateCredential(oldCredentialId: string): { credentialId: string; rawToken: string; keyPrefix: string } | null {
    const row = this.db.prepare(`
      SELECT agent_id, scopes_json FROM agent_credentials WHERE credential_id = ?
    `).get(oldCredentialId) as { agent_id: string; scopes_json: string } | undefined;

    if (!row) return null;

    const scopes = JSON.parse(row.scopes_json);
    const newCred = this.generateToken(row.agent_id, scopes);
    this.revokeCredential(oldCredentialId, "revoked");

    return newCred;
  }
}
