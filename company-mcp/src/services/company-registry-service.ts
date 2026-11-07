import { ConnectionManager } from "../db/connection-manager.js";
import { RuntimeConfig } from "../config/runtime-config.js";

export interface PublicManifestView {
  manifest_version: string;
  company_name: string;
  operating_mode: string;
  agent_count: number;
  quota_pool_count: number;
  timestamp: string;
}

export interface AgentRecord {
  agent_id: string;
  name: string;
  model: string;
  platform: string;
  role: string;
  department: string;
  status: string;
  capabilities: string[];
  invocation_policy: {
    mode: string;
    auto_invoke: boolean;
    requires_approval: boolean;
    quota_class: string;
  };
  resource_policy?: {
    usage_tier?: string;
    routing_priority?: number;
    quota_pool?: string;
  };
  reasoning?: {
    target_level?: string;
    model_verified?: boolean;
    reasoning_verified?: boolean;
  };
  last_seen_at?: string | null;
}

export interface QuotaPoolRecord {
  pool_id: string;
  provider: string;
  account_label: string;
  notes?: string | null;
  agent_count?: number;
  agent_ids?: string;
}

export class CompanyRegistryService {
  private connManager: ConnectionManager;

  constructor(connManager?: ConnectionManager) {
    this.connManager = connManager || new ConnectionManager(RuntimeConfig.getDbPath());
  }

  public ping(message: string = "Hello AICO") {
    return {
      success: true,
      server: "aico-company-mcp",
      version: "2.2.1",
      received: message,
      timestamp: new Date().toISOString()
    };
  }

  public getCompanyInfo(isPublic: boolean = false) {
    const agents = this.listAgents();
    const pools = this.listQuotaPools();

    const info: Record<string, any> = {
      company_name: "AICO",
      full_name: "Personal AI Software Company",
      version: "2.2.1",
      operating_mode: "Hybrid Local-first",
      principal_agents: agents.length,
      quota_pools: pools.length,
      current_stage: "AICO Production v2.2.1",
      timestamp: new Date().toISOString()
    };

    if (!isPublic) {
      info.storage_mode = "SQLite WAL with Foreign Keys";
    }

    return info;
  }

  public listAgents(agentId?: string): AgentRecord[] {
    const db = this.connManager.getDatabase();

    if (agentId) {
      const row = db.prepare("SELECT * FROM agents WHERE agent_id = ?").get(agentId) as any;
      return row ? [this.formatAgent(row)] : [];
    }

    const rows = db.prepare(`
      SELECT * FROM agents
      ORDER BY routing_priority ASC, agent_id ASC
    `).all() as any[];

    return rows.map((r) => this.formatAgent(r));
  }

  public getAgent(agentId: string): AgentRecord | null {
    const agents = this.listAgents(agentId);
    return agents.length > 0 ? agents[0] : null;
  }

  public listQuotaPools(): QuotaPoolRecord[] {
    const db = this.connManager.getDatabase();
    const rows = db.prepare(`
      SELECT
        qp.pool_id,
        qp.provider,
        qp.account_label,
        qp.notes,
        COUNT(a.agent_id) AS agent_count,
        COALESCE(GROUP_CONCAT(a.agent_id, ', '), '') AS agent_ids
      FROM quota_pools qp
      LEFT JOIN agents a ON a.quota_pool = qp.pool_id
      GROUP BY qp.pool_id, qp.provider, qp.account_label, qp.notes
      ORDER BY qp.pool_id
    `).all() as any[];

    return rows.map((r) => ({
      pool_id: r.pool_id,
      provider: r.provider,
      account_label: r.account_label,
      notes: r.notes,
      agent_count: Number(r.agent_count),
      agent_ids: r.agent_ids
    }));
  }

  public getCanonicalManifest(): PublicManifestView {
    const agents = this.listAgents();
    const pools = this.listQuotaPools();

    return {
      manifest_version: "1.1",
      company_name: "AICO",
      operating_mode: "Hybrid Local-first",
      agent_count: agents.length,
      quota_pool_count: pools.length,
      timestamp: new Date().toISOString()
    };
  }

  private formatAgent(row: any): AgentRecord {
    let capabilities: string[] = [];
    try {
      capabilities = typeof row.capabilities_json === "string" ? JSON.parse(row.capabilities_json) : [];
    } catch {
      capabilities = [];
    }

    return {
      agent_id: row.agent_id,
      name: row.display_name || row.agent_id,
      model: row.model,
      platform: row.platform,
      role: row.role,
      department: row.department,
      status: row.status,
      capabilities,
      invocation_policy: {
        mode: row.invocation_mode || "manual",
        auto_invoke: row.auto_invoke === 1,
        requires_approval: row.requires_approval === 1,
        quota_class: row.quota_class || "standard"
      },
      resource_policy: {
        usage_tier: row.usage_tier,
        routing_priority: row.routing_priority,
        quota_pool: row.quota_pool
      },
      reasoning: {
        target_level: row.reasoning_level,
        model_verified: row.model_verified === 1,
        reasoning_verified: row.reasoning_verified === 1
      },
      last_seen_at: row.last_seen_at || null
    };
  }
}
