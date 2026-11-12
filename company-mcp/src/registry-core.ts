import { DatabaseSync } from "node:sqlite";
import { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";
import { RuntimeConfig } from "./config/runtime-config.js";
import { ConnectionManager } from "./db/connection-manager.js";
import { CompanyRegistryService } from "./services/company-registry-service.js";
import { IdentityAccessService, type PrincipalContext } from "./services/identity-access-service.js";
import { ApprovalService } from "./services/approval-service.js";
import { WorkspaceArtifactService } from "./services/workspace-artifact-service.js";
import { GitMediationService } from "./services/git-mediation-service.js";
import { ProjectTaskService } from "./services/project-task-service.js";
import { MessagingService } from "./services/messaging-service.js";
import { OrchestrationService } from "./services/orchestration-service.js";
import { KnowledgeMemoryService } from "./services/knowledge-memory-service.js";
import { ObservabilityQuotaService } from "./services/observability-quota-service.js";
import { PUBLIC_TOOL_ALLOWLIST } from "./security/http-security-pipeline.js";
import { getRequestContext, hasPrincipalScope, isFounderHuman, requireRequestContext } from "./security/context-store.js";
import { CompanyKnowledgeMemoryOpsInputSchema } from "./contracts/mcp-tool-schemas.js";
import { DEFAULT_QUERY_LIMIT, MAX_QUERY_LIMIT, MIN_QUERY_LIMIT } from "./contracts/query-limits.js";

export const DB_PATH = RuntimeConfig.getDbPath();
export const REGISTRY_VERSION = "0.3.0";
export const SERVER_NAME = "aico-company-mcp";

export type AgentRow = {
  agent_id: string;
  display_name: string;
  model: string;
  platform: string;
  role: string;
  department: string;
  status: string;
  capabilities_json: string;
  last_seen_at: string | null;
  invocation_mode: string;
  auto_invoke: number;
  requires_approval: number;
  quota_class: string;
  usage_tier: string;
  routing_priority: number;
  quota_pool: string;
  reasoning_level: string;
  reasoning_verified: number;
  model_verified: number;
};

export type QuotaPoolRow = {
  pool_id: string;
  provider: string;
  account_label: string;
  notes: string | null;
  agent_count: number;
  agent_ids: string;
};

export function readAgents(agentId?: string): AgentRow[] {
  const db = new DatabaseSync(RuntimeConfig.getDbPath());
  try {
    db.exec("PRAGMA busy_timeout = 5000;");
    if (agentId) {
      const row = db.prepare("SELECT * FROM agents WHERE agent_id = ?").get(agentId) as AgentRow | undefined;
      return row ? [row] : [];
    }
    return db.prepare("SELECT * FROM agents ORDER BY routing_priority ASC, agent_id ASC").all() as AgentRow[];
  } finally {
    db.close();
  }
}

export function readQuotaPools(): QuotaPoolRow[] {
  const db = new DatabaseSync(RuntimeConfig.getDbPath());
  try {
    db.exec("PRAGMA busy_timeout = 5000;");
    return db.prepare(`
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
    `).all() as QuotaPoolRow[];
  } finally {
    db.close();
  }
}

export function formatAgent(row: AgentRow) {
  let capabilities: string[] = [];
  try {
    capabilities = JSON.parse(row.capabilities_json || "[]");
  } catch {
    capabilities = [];
  }

  return {
    agent_id: row.agent_id,
    display_name: row.display_name,
    model: row.model,
    platform: row.platform,
    role: row.role,
    department: row.department,
    status: row.status,
    capabilities,
    invocation_policy: {
      mode: row.invocation_mode,
      auto_invoke: row.auto_invoke === 1,
      requires_approval: row.requires_approval === 1,
      quota_class: row.quota_class
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
    last_seen_at: row.last_seen_at
  };
}

// Legacy 5-tool registration for base server compatibility (authenticated fail-closed)
export function registerCompanyTools(server: McpServer): void {
  // M01
  server.registerTool(
    "company_ping",
    {
      title: "Company Ping",
      description: "Check AICO MCP connectivity and version.",
      inputSchema: z.object({ message: z.string().default("Hello AICO") })
    },
    async ({ message }) => {
      requireRequestContext();
      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            success: true,
            server: SERVER_NAME,
            version: "2.2.1",
            received: message,
            timestamp: new Date().toISOString()
          }, null, 2)
        }]
      };
    }
  );

  // M02
  server.registerTool(
    "company_get_info",
    {
      title: "Company Information",
      description: "Get AICO company information.",
      inputSchema: z.object({})
    },
    async () => {
      const ctx = requireRequestContext();
      if (!hasPrincipalScope(ctx, "company:read")) {
        throw new Error("PERMISSION_DENIED: Missing required scope 'company:read'");
      }
      const agents = readAgents();
      const pools = readQuotaPools();
      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            company_name: "AICO",
            full_name: "Personal AI Software Company",
            version: "2.2.1",
            operating_mode: "Hybrid Local-first Multi-Agent Architecture",
            principal_agents: agents.length,
            quota_pools: pools.length,
            current_stage: "Stage 3",
            storage_mode: "SQLite WAL with Foreign Keys",
            timestamp: new Date().toISOString()
          }, null, 2)
        }]
      };
    }
  );

  // M03
  server.registerTool(
    "company_list_agents",
    {
      title: "List Agents",
      description: "List registered agents with invocation, quota and reasoning policies.",
      inputSchema: z.object({})
    },
    async () => {
      const ctx = requireRequestContext();
      if (!hasPrincipalScope(ctx, "company:read")) {
        throw new Error("PERMISSION_DENIED: Missing required scope 'company:read'");
      }
      const rows = readAgents();
      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            success: true,
            count: rows.length,
            agents: rows.map(formatAgent)
          }, null, 2)
        }]
      };
    }
  );

  // M04
  server.registerTool(
    "company_get_agent",
    {
      title: "Get Agent Profile",
      description: "Retrieve one agent profile from the AICO database.",
      inputSchema: z.object({
        agent_id: z.string().min(1)
      })
    },
    async ({ agent_id }) => {
      const ctx = requireRequestContext();
      if (!hasPrincipalScope(ctx, "company:read")) {
        throw new Error("PERMISSION_DENIED: Missing required scope 'company:read'");
      }
      const rows = readAgents(agent_id);
      if (rows.length === 0) {
        return {
          isError: true,
          content: [{ type: "text", text: `Agent not found: ${agent_id}` }]
        };
      }
      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            success: true,
            agent: formatAgent(rows[0])
          }, null, 2)
        }]
      };
    }
  );

  // M05
  server.registerTool(
    "company_list_quota_pools",
    {
      title: "List Quota Pools",
      description: "List provider quota pools and their associated AICO agents.",
      inputSchema: z.object({})
    },
    async () => {
      const ctx = requireRequestContext();
      if (!hasPrincipalScope(ctx, "company:read")) {
        throw new Error("PERMISSION_DENIED: Missing required scope 'company:read'");
      }
      const pools = readQuotaPools();
      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            success: true,
            count: pools.length,
            quota_pools: pools
          }, null, 2)
        }]
      };
    }
  );
}

// Central Tool Scope Requirements Policy (P0-01) - Canonical 38 MCP tools
export const TOOL_REQUIRED_SCOPES: Record<string, (string | string[])[]> = {
  // M01
  company_ping: [],
  // M02
  company_get_info: ["company:read"],
  // M03
  company_list_agents: ["company:read"],
  // M04
  company_get_agent: ["company:read"],
  // M05
  company_list_quota_pools: ["company:read"],
  // M06
  company_get_manifest: ["company:read"],
  // M07
  company_get_my_identity: [],
  // M08
  company_check_permission: ["company:read"],
  // M09
  company_list_credentials: ["credentials:manage"],
  // M10
  company_issue_credential: ["credentials:manage"],
  // M11
  company_rotate_credential: ["credentials:manage"],
  // M12
  company_revoke_credential: ["credentials:manage"],
  // M13
  company_request_approval: [["approvals:request", "tasks:manage", "company:write"]],
  // M14
  company_list_approval_requests: [["approvals:read", "tasks:manage", "company:read"]],
  // M15
  company_get_approval_request: [["approvals:read", "tasks:manage", "company:read"]],
  // M16
  company_decide_approval: ["approvals:decide"],
  // M17
  company_get_workspace: [["workspace:read:self", "workspace:read:any"]],
  // M18
  company_list_workspace_files: [["workspace:read:self", "workspace:read:any"]],
  // M19
  company_read_workspace_file: [["workspace:read:self", "workspace:read:any"]],
  // M20
  company_write_workspace_file: ["workspace:write:self"],
  // M21
  company_share_workspace_artifact: [["workspace:write:self", "workspace:share"]],
  // M22
  company_get_workspace_activity: [["workspace:audit:read", "workspace:audit"]],
  // M23
  company_git_sync_branch: ["git:mediate"],
  // M24
  company_create_project: ["tasks:manage"],
  // M25
  company_list_projects: ["company:read"],
  // M26
  company_create_task: ["tasks:manage"],
  // M27
  company_list_tasks: [["tasks:read", "tasks:read:assigned", "tasks:manage"]],
  // M28
  company_get_task: [["tasks:read", "tasks:read:assigned", "tasks:manage"]],
  // M29
  company_claim_task: [["tasks:claim", "tasks:manage", "tasks:update:assigned"]],
  // M30
  company_heartbeat_task: [["tasks:heartbeat", "tasks:update:assigned", "tasks:manage"]],
  // M31
  company_transition_task: [["tasks:transition", "tasks:manage", "tasks:update:assigned"]],
  // M32
  company_submit_task_result: [["tasks:update:assigned", "tasks:submit", "tasks:manage"]],
  // M33
  company_review_task: [["tasks:review", "tasks:manage"]],
  // M34
  company_record_external_dispatch: [["tasks:manage", "orchestration:manage"]],
  // M35
  company_send_message: ["messages:send"],
  // M36
  company_list_inbox: ["messages:read"],
  // M37
  company_ack_message: ["messages:read"],
  // M38
  company_knowledge_memory_ops: [["company:read", "knowledge:read", "observability:read", "memory:read", "memory:write"]]
};

// Complete 38-tool implementation for v2.2.1
export function registerAllV221Tools(
  server: McpServer,
  options?: {
    isPublicGateway?: boolean;
    connManager?: ConnectionManager;
    workspaceRoot?: string;
    anchorFilePath?: string;
    hmacKey?: string;
  }
): void {
  const isPublic = options?.isPublicGateway ?? false;
  const conn = options?.connManager ?? new ConnectionManager(RuntimeConfig.getDbPath());

  const regService = new CompanyRegistryService(conn);
  const identityService = new IdentityAccessService(conn);
  const approvalService = new ApprovalService(conn);
  const workspaceService = options?.workspaceRoot
    ? new WorkspaceArtifactService(options.workspaceRoot, conn)
    : new WorkspaceArtifactService(conn);
  const gitService = new GitMediationService(conn);
  const taskService = new ProjectTaskService(conn, approvalService);
  const msgService = new MessagingService(conn);
  const orchService = new OrchestrationService(conn);
  const knowService = new KnowledgeMemoryService(conn);
  const obsService = new ObservabilityQuotaService(conn, options?.hmacKey, options?.anchorFilePath);

  // Helper to resolve authenticated PrincipalContext fail-closed with live credential revalidation
  function resolvePrincipal(extra?: any): PrincipalContext {
    const storeCtx = getRequestContext() || extra?.principalContext;
    if (!storeCtx || !storeCtx.authenticated) {
      throw new Error("AUTH_MISSING_OR_INVALID_TOKEN: Request is unauthenticated or missing security context");
    }

    // Live DB verification: check if credential is still active and not revoked/expired
    if (storeCtx.credentialId) {
      const cred = identityService.getCredentialById(storeCtx.credentialId);
      if (!cred || cred.status === "revoked" || (cred.expires_at && new Date(cred.expires_at) <= new Date())) {
        throw new Error("AUTH_CREDENTIAL_REVOKED: Credential has been revoked or expired during active session");
      }
    }

    return storeCtx;
  }

  const maybeRegister = (toolId: string, name: string, config: any, handler: any) => {
    // Fail-Closed verification: ensure all registered tools have an explicit policy entry
    const requiredScopes = TOOL_REQUIRED_SCOPES[name];
    if (requiredScopes === undefined) {
      throw new Error(`SECURITY_CONFIGURATION_ERROR: Unmapped tool '${name}' (${toolId}) in TOOL_REQUIRED_SCOPES policy`);
    }

    if (isPublic && !PUBLIC_TOOL_ALLOWLIST.has(name)) {
      return;
    }
    server.registerTool(name, config, async (args: any, extra: any) => {
      const startTime = Date.now();
      try {
        const principal = resolvePrincipal(extra);
        identityService.assertAuthorized(principal, requiredScopes);
        const result = await handler(args, extra);
        obsService.recordMcpActivity({
          ctx: principal,
          toolName: name,
          durationMs: Date.now() - startTime,
          outcome: "succeeded"
        });
        return result;
      } catch (err: any) {
        obsService.recordMcpActivity({
          ctx: getRequestContext() || extra?.principalContext || null,
          toolName: name,
          durationMs: Date.now() - startTime,
          outcome: "failed",
          errorCode: err.message?.split(":")[0] || "ERROR"
        });
        return {
          isError: true,
          content: [{
            type: "text",
            text: JSON.stringify({
              error_code: err.message?.split(":")[0] || "INTERNAL_ERROR",
              message: err.message || "An unexpected error occurred"
            }, null, 2)
          }]
        };
      }
    });
  };

  // M01: company_ping
  maybeRegister(
    "M01",
    "company_ping",
    {
      title: "Company Ping",
      description: "Check AICO MCP connectivity and version.",
      inputSchema: z.object({ message: z.string().default("Hello AICO") })
    },
    async ({ message }: { message: string }) => ({
      content: [{ type: "text", text: JSON.stringify(regService.ping(message), null, 2) }]
    })
  );

  // M02: company_get_info
  maybeRegister(
    "M02",
    "company_get_info",
    {
      title: "Company Info",
      description: "Get AICO company information.",
      inputSchema: z.object({})
    },
    async () => ({
      content: [{ type: "text", text: JSON.stringify(regService.getCompanyInfo(isPublic), null, 2) }]
    })
  );

  // M03: company_list_agents
  maybeRegister(
    "M03",
    "company_list_agents",
    {
      title: "List Agents",
      description: "List registered agents with invocation, quota and reasoning policies.",
      inputSchema: z.object({})
    },
    async () => {
      const agents = regService.listAgents();
      return {
        content: [{ type: "text", text: JSON.stringify({ success: true, count: agents.length, agents }, null, 2) }]
      };
    }
  );

  // M04: company_get_agent
  maybeRegister(
    "M04",
    "company_get_agent",
    {
      title: "Get Agent Profile",
      description: "Retrieve one agent profile from the AICO database.",
      inputSchema: z.object({ agent_id: z.string().min(1) })
    },
    async ({ agent_id }: { agent_id: string }) => {
      const agent = regService.getAgent(agent_id);
      if (!agent) {
        return { isError: true, content: [{ type: "text", text: `Agent not found: ${agent_id}` }] };
      }
      return { content: [{ type: "text", text: JSON.stringify({ success: true, agent }, null, 2) }] };
    }
  );

  // M05: company_list_quota_pools
  maybeRegister(
    "M05",
    "company_list_quota_pools",
    {
      title: "List Quota Pools",
      description: "List provider quota pools and their associated AICO agents.",
      inputSchema: z.object({})
    },
    async () => {
      const pools = regService.listQuotaPools();
      return {
        content: [{ type: "text", text: JSON.stringify({ success: true, count: pools.length, quota_pools: pools }, null, 2) }]
      };
    }
  );

  // M06: company_get_manifest
  maybeRegister(
    "M06",
    "company_get_manifest",
    {
      title: "Get Manifest Projection",
      description: "Get canonical manifest projection.",
      inputSchema: z.object({})
    },
    async () => ({
      content: [{ type: "text", text: JSON.stringify(regService.getCanonicalManifest(), null, 2) }]
    })
  );

  // M07: company_get_my_identity
  maybeRegister(
    "M07",
    "company_get_my_identity",
    {
      title: "Get Caller Identity",
      description: "Get identity context of caller.",
      inputSchema: z.object({})
    },
    async (_args: any, extra: any) => {
      const ctx = resolvePrincipal(extra);
      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            success: true,
            ...identityService.getMyIdentity(ctx)
          }, null, 2)
        }]
      };
    }
  );

  // M08: company_check_permission
  maybeRegister(
    "M08",
    "company_check_permission",
    {
      title: "Check Permission",
      description: "Evaluate permission for caller.",
      inputSchema: z.object({ required_scope: z.string().min(1), resource_id: z.string().optional() })
    },
    async ({ required_scope, resource_id }: { required_scope: string; resource_id?: string }, extra: any) => {
      const ctx = resolvePrincipal(extra);
      const perm = identityService.checkPermission(ctx, required_scope, resource_id);
      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            ...perm,
            principal_id: ctx.principalId,
            scope_evaluated: required_scope
          }, null, 2)
        }]
      };
    }
  );

  // M09: company_list_credentials (Founder only)
  maybeRegister(
    "M09",
    "company_list_credentials",
    {
      title: "List Credentials",
      description: "List active credentials metadata (Founder only).",
      inputSchema: z.object({ principal_id: z.string().optional() })
    },
    async ({ principal_id }: { principal_id?: string }, extra: any) => {
      const ctx = resolvePrincipal(extra);
      if (ctx.principalType !== "human" || ctx.principalId !== "founder-01") {
        throw new Error("PERMISSION_DENIED: Only Founder (founder-01) can list credentials");
      }
      const creds = identityService.listCredentials(principal_id);
      return {
        content: [{ type: "text", text: JSON.stringify({ success: true, count: creds.length, credentials: creds }, null, 2) }]
      };
    }
  );

  // M10: company_issue_credential (Founder only)
  maybeRegister(
    "M10",
    "company_issue_credential",
    {
      title: "Issue Credential",
      description: "Issue a new credential (Founder only).",
      inputSchema: z.object({
        principal_id: z.string().min(1),
        scopes: z.array(z.string()).default([]),
        allow_public_gateway: z.boolean().default(false),
        expires_in_days: z.number().default(90),
        description: z.string().optional()
      })
    },
    async (args: any, extra: any) => {
      const ctx = resolvePrincipal(extra);
      if (ctx.principalType !== "human" || ctx.principalId !== "founder-01") {
        throw new Error("PERMISSION_DENIED: Only Founder (founder-01) can issue credentials");
      }
      const cred = identityService.issueCredential(args);

      obsService.appendAuditEvent({
        ctx,
        eventCategory: "credential",
        actionName: "issue_credential",
        targetResource: `cred:${cred.credentialId}:${args.principal_id}`,
        outcome: "succeeded"
      });

      return {
        content: [{ type: "text", text: JSON.stringify({ success: true, ...cred }, null, 2) }]
      };
    }
  );

  // M11: company_rotate_credential (Founder only)
  maybeRegister(
    "M11",
    "company_rotate_credential",
    {
      title: "Rotate Credential",
      description: "Rotate an existing credential (Founder only).",
      inputSchema: z.object({
        old_credential_id: z.string().min(1),
        expires_in_days: z.number().default(90)
      })
    },
    async (args: any, extra: any) => {
      const ctx = resolvePrincipal(extra);
      if (ctx.principalType !== "human" || ctx.principalId !== "founder-01") {
        throw new Error("PERMISSION_DENIED: Only Founder (founder-01) can rotate credentials");
      }
      const cred = identityService.rotateCredential(args.old_credential_id, args.expires_in_days);

      obsService.appendAuditEvent({
        ctx,
        eventCategory: "credential",
        actionName: "rotate_credential",
        targetResource: `cred:${cred.new_credential_id}:${args.old_credential_id}`,
        outcome: "succeeded"
      });

      return {
        content: [{ type: "text", text: JSON.stringify({ success: true, ...cred }, null, 2) }]
      };
    }
  );

  // M12: company_revoke_credential (Founder only)
  maybeRegister(
    "M12",
    "company_revoke_credential",
    {
      title: "Revoke Credential",
      description: "Revoke an existing credential (Founder only).",
      inputSchema: z.object({ credential_id: z.string().min(1), reason: z.string().optional() })
    },
    async ({ credential_id, reason }: { credential_id: string; reason?: string }, extra: any) => {
      const ctx = resolvePrincipal(extra);
      if (ctx.principalType !== "human" || ctx.principalId !== "founder-01") {
        throw new Error("PERMISSION_DENIED: Only Founder (founder-01) can revoke credentials");
      }
      identityService.revokeCredential(credential_id, reason);

      obsService.appendAuditEvent({
        ctx,
        eventCategory: "credential",
        actionName: "revoke_credential",
        targetResource: `cred:${credential_id}`,
        outcome: "succeeded"
      });

      return {
        content: [{
          type: "text",
          text: JSON.stringify({ success: true, credential_id, status: "revoked", revoked_at: new Date().toISOString() }, null, 2)
        }]
      };
    }
  );

  // M13: company_request_approval
  maybeRegister(
    "M13",
    "company_request_approval",
    {
      title: "Request Approval",
      description: "Create an approval request.",
      inputSchema: z.object({
        action_type: z.string().min(1),
        target_agent_id: z.string().optional(),
        target_resource: z.string().optional(),
        reason: z.string().optional(),
        risk_level: z.enum(["low", "medium", "high", "critical"]).default("medium"),
        canonical_payload: z.record(z.string(), z.any()),
        expires_in_hours: z.number().default(24)
      })
    },
    async (args: any, extra: any) => {
      const ctx = resolvePrincipal(extra);
      const req = approvalService.createApprovalRequest({
        ctx,
        actionType: args.action_type,
        targetAgentId: args.target_agent_id,
        targetResource: args.target_resource,
        reason: args.reason,
        riskLevel: args.risk_level,
        canonicalPayload: args.canonical_payload,
        expiresInHours: args.expires_in_hours
      });

      obsService.appendAuditEvent({
        ctx,
        eventCategory: "approval",
        actionName: "create_approval_request",
        targetResource: `approval:${req.approval_id}:${args.action_type}`,
        outcome: "succeeded"
      });

      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            success: true,
            approval_id: req.approval_id,
            action_type: req.action_type,
            requested_by: req.requested_by,
            required_approver: req.required_approver,
            payload_hash_sha256: req.payload_hash_sha256,
            status: req.status,
            expires_at: req.expires_at
          }, null, 2)
        }]
      };
    }
  );

  // M14: company_list_approval_requests
  maybeRegister(
    "M14",
    "company_list_approval_requests",
    {
      title: "List Approvals",
      description: "List approval requests.",
      inputSchema: z.object({ status: z.string().optional(), action_type: z.string().optional(), tier: z.string().optional() })
    },
    async (args: any, extra: any) => {
      const ctx = resolvePrincipal(extra);
      const list = approvalService.listApprovalRequests(args, ctx);
      return {
        content: [{ type: "text", text: JSON.stringify({ success: true, count: list.length, approvals: list }, null, 2) }]
      };
    }
  );

  // M15: company_get_approval_request
  maybeRegister(
    "M15",
    "company_get_approval_request",
    {
      title: "Get Approval Request",
      description: "Retrieve an approval request.",
      inputSchema: z.object({ approval_id: z.string().min(1) })
    },
    async ({ approval_id }: { approval_id: string }, extra: any) => {
      const ctx = resolvePrincipal(extra);
      const item = approvalService.getApprovalRequest(approval_id, ctx);
      if (!item) {
        return { isError: true, content: [{ type: "text", text: `Approval not found: ${approval_id}` }] };
      }
      return { content: [{ type: "text", text: JSON.stringify({ success: true, approval: item }, null, 2) }] };
    }
  );

  // M16: company_decide_approval
  maybeRegister(
    "M16",
    "company_decide_approval",
    {
      title: "Decide Approval",
      description: "Approve or reject a pending request.",
      inputSchema: z.object({
        approval_id: z.string().min(1),
        decision: z.enum(["approved", "rejected"]),
        reason: z.string().optional()
      })
    },
    async (args: any, extra: any) => {
      const ctx = resolvePrincipal(extra);
      const res = approvalService.decideApproval({
        ctx,
        approvalId: args.approval_id,
        decision: args.decision,
        reason: args.reason
      });

      obsService.appendAuditEvent({
        ctx,
        eventCategory: "approval",
        actionName: `decide_${args.decision}`,
        targetResource: `approval:${args.approval_id}`,
        outcome: "succeeded"
      });

      return { content: [{ type: "text", text: JSON.stringify(res, null, 2) }] };
    }
  );

  // M17: company_get_workspace
  maybeRegister(
    "M17",
    "company_get_workspace",
    {
      title: "Get Workspace Info",
      description: "Get workspace configuration and disk status.",
      inputSchema: z.object({ target_agent_id: z.string().optional() })
    },
    async ({ target_agent_id }: { target_agent_id?: string }, extra: any) => {
      const ctx = resolvePrincipal(extra);
      const agentId = target_agent_id || ctx.agentId;
      if (!agentId) {
        throw new Error("VALIDATION_ERROR: target_agent_id is required when caller has no bound agent workspace");
      }
      const meta = workspaceService.getWorkspaceMeta(agentId, ctx);
      return {
        content: [{ type: "text", text: JSON.stringify({ success: true, ...meta }, null, 2) }]
      };
    }
  );

  // M18: company_list_workspace_files
  maybeRegister(
    "M18",
    "company_list_workspace_files",
    {
      title: "List Workspace Files",
      description: "List real files within authorized workspace subfolder.",
      inputSchema: z.object({
        subpath: z.string().optional().default(""),
        target_agent_id: z.string().optional(),
        recursive: z.boolean().optional().default(true),
        include_hidden: z.boolean().optional().default(false)
      })
    },
    async (
      {
        subpath,
        target_agent_id,
        recursive = true,
        include_hidden = false
      }: {
        subpath?: string;
        target_agent_id?: string;
        recursive?: boolean;
        include_hidden?: boolean;
      },
      extra: any
    ) => {
      const ctx = resolvePrincipal(extra);
      const agentId = target_agent_id || ctx.agentId;
      if (!agentId) {
        throw new Error("VALIDATION_ERROR: target_agent_id is required when caller has no bound agent workspace");
      }
      const listed = workspaceService.listFiles({
        agentId,
        relativeDir: subpath || "",
        recursive,
        includeHidden: include_hidden,
        ctx
      });

      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            success: true,
            agent_id: agentId,
            relative_dir: subpath || "",
            total_files: listed.total_files,
            total_bytes: listed.total_bytes,
            files: listed.files
          }, null, 2)
        }]
      };
    }
  );

  // M19: company_read_workspace_file
  maybeRegister(
    "M19",
    "company_read_workspace_file",
    {
      title: "Read Workspace File",
      description: "Read a file from agent workspace.",
      inputSchema: z.object({ relative_path: z.string().min(1), target_agent_id: z.string().optional() })
    },
    async ({ relative_path, target_agent_id }: { relative_path: string; target_agent_id?: string }, extra: any) => {
      const ctx = resolvePrincipal(extra);
      const agentId = target_agent_id || ctx.agentId;
      if (!agentId) {
        throw new Error("VALIDATION_ERROR: target_agent_id is required when caller has no bound agent workspace");
      }
      const res = workspaceService.readArtifact(agentId, relative_path, ctx);
      return { content: [{ type: "text", text: JSON.stringify({ success: true, ...res }, null, 2) }] };
    }
  );

  // M20: company_write_workspace_file
  maybeRegister(
    "M20",
    "company_write_workspace_file",
    {
      title: "Write Workspace File",
      description: "Write a file to agent workspace.",
      inputSchema: z.object({
        relative_path: z.string().min(1),
        content: z.string(),
        target_agent_id: z.string().optional(),
        overwrite: z.boolean().default(true)
      })
    },
    async ({ relative_path, content, target_agent_id, overwrite }: { relative_path: string; content: string; target_agent_id?: string; overwrite: boolean }, extra: any) => {
      const ctx = resolvePrincipal(extra);
      const agentId = target_agent_id || ctx.agentId;
      if (!agentId) {
        throw new Error("VALIDATION_ERROR: target_agent_id is required when caller has no bound agent workspace");
      }
      const res = workspaceService.writeArtifact({ agentId, relativePath: relative_path, content, overwrite, ctx });
      return { content: [{ type: "text", text: JSON.stringify({ success: true, ...res }, null, 2) }] };
    }
  );

  // M21: company_share_workspace_artifact
  maybeRegister(
    "M21",
    "company_share_workspace_artifact",
    {
      title: "Share Workspace Artifact",
      description: "Share an artifact with another agent.",
      inputSchema: z.object({
        source_relative_path: z.string().min(1),
        to_agent_id: z.string().min(1),
        task_id: z.string().optional(),
        description: z.string().optional()
      })
    },
    async (args: any, extra: any) => {
      const ctx = resolvePrincipal(extra);
      const fromAgentId = ctx.agentId;
      if (!fromAgentId) {
        throw new Error("VALIDATION_ERROR: Source workspace agent identity required when caller has no bound agent_id");
      }
      const res = workspaceService.shareArtifact({
        fromAgentId,
        toAgentId: args.to_agent_id,
        sourceRelativePath: args.source_relative_path,
        taskId: args.task_id,
        ctx
      });
      return { content: [{ type: "text", text: JSON.stringify({ success: true, ...res }, null, 2) }] };
    }
  );

  // M22: company_get_workspace_activity
  maybeRegister(
    "M22",
    "company_get_workspace_activity",
    {
      title: "Get Workspace Activity",
      description: "List audit activity within workspaces.",
      inputSchema: z.object({
        agent_id: z.string().optional(),
        limit: z.number().int().min(MIN_QUERY_LIMIT).max(MAX_QUERY_LIMIT).default(DEFAULT_QUERY_LIMIT)
      })
    },
    async ({ agent_id, limit }: { agent_id?: string; limit: number }, extra: any) => {
      const ctx = resolvePrincipal(extra);
      const activities = workspaceService.listActivities({ agentId: agent_id, limit }, ctx);
      return {
        content: [{ type: "text", text: JSON.stringify({ success: true, count: activities.length, activities }, null, 2) }]
      };
    }
  );

  // M23: company_git_sync_branch
  maybeRegister(
    "M23",
    "company_git_sync_branch",
    {
      title: "Git Sync Branch",
      description: "Sync branch via Git mediation service.",
      inputSchema: z.object({
        branch_name: z.string().min(1),
        direction: z.enum(["pull_master", "push_agent_branch"])
      })
    },
    async (args: any, extra: any) => {
      const ctx = resolvePrincipal(extra);
      const agentId = ctx.agentId;
      if (!agentId) {
        throw new Error("VALIDATION_ERROR: Git branch sync requires a bound agent identity");
      }
      const res = gitService.syncAgentBranch({
        ctx,
        agentId,
        branchName: args.branch_name,
        direction: args.direction
      });
      return { content: [{ type: "text", text: JSON.stringify(res, null, 2) }] };
    }
  );

  // M24: company_create_project
  maybeRegister(
    "M24",
    "company_create_project",
    {
      title: "Create Project",
      description: "Create an AICO project.",
      inputSchema: z.object({
        project_id: z.string().min(1),
        name: z.string().min(1),
        description: z.string().optional(),
        owner_agent_id: z.string().optional(),
        priority: z.enum(["P0", "P1", "P2", "P3"]).default("P1"),
        risk_class: z.enum(["low", "medium", "high", "critical"]).default("medium")
      })
    },
    async (args: any, extra: any) => {
      const ctx = resolvePrincipal(extra);
      const res = taskService.createProject({
        ctx,
        projectId: args.project_id,
        name: args.name,
        description: args.description || args.name,
        ownerAgentId: args.owner_agent_id,
        priority: args.priority,
        riskClass: args.risk_class
      });

      obsService.appendAuditEvent({
        ctx,
        eventCategory: "task",
        actionName: "create_project",
        targetResource: `proj:${res.project_id}`,
        outcome: "succeeded"
      });

      return { content: [{ type: "text", text: JSON.stringify({ success: true, ...res }, null, 2) }] };
    }
  );

  // M25: company_list_projects
  maybeRegister(
    "M25",
    "company_list_projects",
    {
      title: "List Projects",
      description: "List projects.",
      inputSchema: z.object({ status: z.string().optional() })
    },
    async ({ status }: { status?: string }) => {
      const projects = taskService.listProjects(status);
      return {
        content: [{ type: "text", text: JSON.stringify({ success: true, count: projects.length, projects }, null, 2) }]
      };
    }
  );

  // M26: company_create_task
  maybeRegister(
    "M26",
    "company_create_task",
    {
      title: "Create Task",
      description: "Create a task with state machine rules.",
      inputSchema: z.object({
        task_id: z.string().min(1),
        project_id: z.string().min(1),
        title: z.string().min(1),
        objective: z.string().optional(),
        description: z.string().optional(),
        assigned_agent_id: z.string().optional(),
        idempotency_key: z.string().optional(),
        risk_class: z.enum(["low", "medium", "high", "critical"]).default("low")
      })
    },
    async (args: any, extra: any) => {
      const ctx = resolvePrincipal(extra);
      const task = taskService.createTask({
        ctx,
        taskId: args.task_id,
        projectId: args.project_id,
        title: args.title,
        objective: args.objective,
        description: args.description,
        assignedAgentId: args.assigned_agent_id,
        idempotencyKey: args.idempotency_key,
        riskClass: args.risk_class
      });

      obsService.appendAuditEvent({
        ctx,
        eventCategory: "task",
        actionName: "create_task",
        targetResource: `task:${task.task_id}`,
        outcome: "succeeded"
      });

      return { content: [{ type: "text", text: JSON.stringify({ success: true, ...task }, null, 2) }] };
    }
  );

  // M27: company_list_tasks
  maybeRegister(
    "M27",
    "company_list_tasks",
    {
      title: "List Tasks",
      description: "List tasks.",
      inputSchema: z.object({
        project_id: z.string().optional(),
        assigned_agent_id: z.string().optional(),
        execution_status: z.string().optional()
      })
    },
    async (args: any, extra: any) => {
      const ctx = resolvePrincipal(extra);
      const tasks = taskService.listTasks({
        projectId: args.project_id,
        assignedAgentId: args.assigned_agent_id,
        executionStatus: args.execution_status
      }, ctx);
      return {
        content: [{ type: "text", text: JSON.stringify({ success: true, count: tasks.length, tasks }, null, 2) }]
      };
    }
  );

  // M28: company_get_task
  maybeRegister(
    "M28",
    "company_get_task",
    {
      title: "Get Task",
      description: "Retrieve a task by ID.",
      inputSchema: z.object({ task_id: z.string().min(1) })
    },
    async ({ task_id }: { task_id: string }, extra: any) => {
      const ctx = resolvePrincipal(extra);
      const task = taskService.getTask(task_id, ctx);
      if (!task) {
        return { isError: true, content: [{ type: "text", text: `Task not found: ${task_id}` }] };
      }
      return { content: [{ type: "text", text: JSON.stringify({ success: true, task }, null, 2) }] };
    }
  );

  // M29: company_claim_task
  maybeRegister(
    "M29",
    "company_claim_task",
    {
      title: "Claim Task",
      description: "Claim an assigned task.",
      inputSchema: z.object({ task_id: z.string().min(1), expected_version: z.number().int().min(1) })
    },
    async (args: any, extra: any) => {
      const ctx = resolvePrincipal(extra);
      const res = taskService.claimTask({
        ctx,
        taskId: args.task_id,
        expectedVersion: args.expected_version
      });

      obsService.appendAuditEvent({
        ctx,
        eventCategory: "task",
        actionName: "claim_task",
        targetResource: `task:${args.task_id}`,
        outcome: "succeeded"
      });

      return { content: [{ type: "text", text: JSON.stringify({ success: true, ...res }, null, 2) }] };
    }
  );

  // M30: company_heartbeat_task
  maybeRegister(
    "M30",
    "company_heartbeat_task",
    {
      title: "Heartbeat Task",
      description: "Renew 30-minute lease on an active task.",
      inputSchema: z.object({
        task_id: z.string().min(1),
        expected_version: z.number().int().min(1).optional()
      })
    },
    async ({ task_id, expected_version }: { task_id: string; expected_version?: number }, extra: any) => {
      const ctx = resolvePrincipal(extra);
      const res = taskService.heartbeatTask({
        ctx,
        taskId: task_id,
        expectedVersion: expected_version
      });
      return {
        content: [{ type: "text", text: JSON.stringify({ success: true, task_id, lease_expires_at: res.lease_expires_at }, null, 2) }]
      };
    }
  );

  // M31: company_transition_task
  maybeRegister(
    "M31",
    "company_transition_task",
    {
      title: "Transition Task",
      description: "Transition a task according to the 26-state transition matrix.",
      inputSchema: z.object({
        task_id: z.string().min(1),
        to_status: z.string().min(1),
        expected_version: z.number().int().min(1),
        reason: z.string().optional(),
        approval_id: z.string().optional()
      })
    },
    async (args: any, extra: any) => {
      const ctx = resolvePrincipal(extra);
      const res = taskService.transitionTask({
        ctx,
        taskId: args.task_id,
        expectedVersion: args.expected_version,
        toStatus: args.to_status,
        reason: args.reason,
        approvalId: args.approval_id,
        allowReviewAndAdminTransitions: !isPublic
      });

      obsService.appendAuditEvent({
        ctx,
        eventCategory: "task",
        actionName: `transition_${args.to_status}`,
        targetResource: `task:${args.task_id}`,
        outcome: "succeeded"
      });

      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            success: true,
            task_id: res.task_id,
            execution_status: res.execution_status,
            dispatch_status: res.dispatch_status,
            version: res.version
          }, null, 2)
        }]
      };
    }
  );

  // M32: company_submit_task_result
  maybeRegister(
    "M32",
    "company_submit_task_result",
    {
      title: "Submit Task Result",
      description: "Submit task result for review.",
      inputSchema: z.object({
        task_id: z.string().min(1),
        expected_version: z.number().int().min(1),
        verification_evidence: z.string().min(1),
        output_artifact_ids: z.array(z.string()).min(1)
      })
    },
    async (args: any, extra: any) => {
      const ctx = resolvePrincipal(extra);
      const res = taskService.submitTaskResult({
        ctx,
        taskId: args.task_id,
        expectedVersion: args.expected_version,
        outputArtifactIds: args.output_artifact_ids,
        verificationEvidence: args.verification_evidence
      });

      obsService.appendAuditEvent({
        ctx,
        eventCategory: "task",
        actionName: "submit_result",
        targetResource: `task:${args.task_id}`,
        outcome: "succeeded"
      });

      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            success: true,
            task_id: res.task_id,
            execution_status: res.execution_status,
            dispatch_status: res.dispatch_status,
            version: res.version
          }, null, 2)
        }]
      };
    }
  );

  // M33: company_review_task
  maybeRegister(
    "M33",
    "company_review_task",
    {
      title: "Review Task",
      description: "Review task with Separation of Duties.",
      inputSchema: z.object({
        task_id: z.string().min(1),
        expected_version: z.number().int().min(1),
        decision: z.enum(["completed", "rework"]),
        reason: z.string().optional()
      })
    },
    async (args: any, extra: any) => {
      const ctx = resolvePrincipal(extra);
      if (typeof args.expected_version !== "number" || !Number.isInteger(args.expected_version) || args.expected_version < 1) {
        throw new Error("VALIDATION_ERROR: company_review_task requires a positive integer expected_version");
      }
      const res = taskService.reviewTask({
        ctx,
        taskId: args.task_id,
        expectedVersion: args.expected_version,
        decision: args.decision,
        reason: args.reason
      });

      obsService.appendAuditEvent({
        ctx,
        eventCategory: "task",
        actionName: `review_${args.decision}`,
        targetResource: `task:${args.task_id}`,
        outcome: "succeeded"
      });

      return { content: [{ type: "text", text: JSON.stringify({ success: true, ...res }, null, 2) }] };
    }
  );

  // M34: company_record_external_dispatch
  maybeRegister(
    "M34",
    "company_record_external_dispatch",
    {
      title: "Record External Dispatch",
      description: "Record manual operator external dispatch milestones.",
      inputSchema: z.object({
        task_id: z.string().min(1),
        milestone: z.enum(["operator_delivered", "external_invocation_confirmed", "delivery_failed"]),
        expected_version: z.number().int().min(1).optional(),
        notes: z.string().optional()
      })
    },
    async (args: any, extra: any) => {
      const ctx = resolvePrincipal(extra);
      const res = orchService.recordExternalDispatchMilestone({
        taskId: args.task_id,
        milestone: args.milestone,
        actorPrincipalId: ctx.principalId,
        expectedVersion: args.expected_version,
        notes: args.notes
      }, ctx);

      obsService.appendAuditEvent({
        ctx,
        eventCategory: "task",
        actionName: `dispatch_milestone_${args.milestone}`,
        targetResource: `task:${args.task_id}`,
        outcome: "succeeded"
      });

      return { content: [{ type: "text", text: JSON.stringify(res, null, 2) }] };
    }
  );

  // M35: company_send_message
  maybeRegister(
    "M35",
    "company_send_message",
    {
      title: "Send Message",
      description: "Send a message to another agent or founder.",
      inputSchema: z.object({
        to_principal_id: z.string().min(1),
        subject: z.string().min(1),
        body_markdown: z.string().min(1),
        thread_id: z.string().optional(),
        task_id: z.string().optional(),
        message_type: z.enum(["task_handoff", "question", "review_request", "result", "approval_request", "alert"]).default("question")
      })
    },
    async (args: any, extra: any) => {
      const ctx = resolvePrincipal(extra);
      const res = msgService.sendMessage({
        ctx,
        fromPrincipalId: ctx.principalId,
        toPrincipalId: args.to_principal_id,
        subject: args.subject,
        bodyMarkdown: args.body_markdown,
        threadId: args.thread_id,
        taskId: args.task_id,
        messageType: args.message_type
      });
      return { content: [{ type: "text", text: JSON.stringify({ success: true, ...res }, null, 2) }] };
    }
  );

  // M36: company_list_inbox
  maybeRegister(
    "M36",
    "company_list_inbox",
    {
      title: "List Inbox",
      description: "List messages in caller's inbox.",
      inputSchema: z.object({
        status: z.string().optional(),
        limit: z.number().int().min(MIN_QUERY_LIMIT).max(MAX_QUERY_LIMIT).default(DEFAULT_QUERY_LIMIT)
      })
    },
    async (args: any, extra: any) => {
      const ctx = resolvePrincipal(extra);
      const messages = msgService.listInbox(ctx.principalId, args);
      return {
        content: [{ type: "text", text: JSON.stringify({ success: true, count: messages.length, messages }, null, 2) }]
      };
    }
  );

  // M37: company_ack_message
  maybeRegister(
    "M37",
    "company_ack_message",
    {
      title: "Acknowledge Message",
      description: "Acknowledge receipt of a message.",
      inputSchema: z.object({ message_id: z.string().min(1), note: z.string().optional() })
    },
    async ({ message_id, note }: { message_id: string; note?: string }, extra: any) => {
      const ctx = resolvePrincipal(extra);
      const res = msgService.ackMessage(message_id, ctx.principalId, note);
      return { content: [{ type: "text", text: JSON.stringify(res, null, 2) }] };
    }
  );

  // M38: company_knowledge_memory_ops (Canonical 8-operation discriminated union)
  maybeRegister(
    "M38",
    "company_knowledge_memory_ops",
    {
      title: "Knowledge and Memory Operations",
      description: "Unified endpoint for knowledge search, memory and observability.",
      inputSchema: CompanyKnowledgeMemoryOpsInputSchema
    },
    async (args: any, extra: any) => {
      const ctx = resolvePrincipal(extra);

      if (isPublic) {
        const forbiddenPublicOps = [
          "get_system_observability",
          "record_model_usage",
          "propose_knowledge_change",
          "approve_knowledge_proposal"
        ];
        if (forbiddenPublicOps.includes(args.operation)) {
          return {
            isError: true,
            content: [{
              type: "text",
              text: JSON.stringify({
                error_code: "TOOL_NOT_EXPOSED_ON_PUBLIC_GATEWAY",
                message: `Operation '${args.operation}' is forbidden on Public Gateway`
              })
            }]
          };
        }
      }

      switch (args.operation) {
        case "search_knowledge": {
          identityService.assertAuthorized(ctx, [["knowledge:read", "company:read"]]);
          const results = knowService.searchKnowledge(args.query || "", args.limit || 10);
          return { content: [{ type: "text", text: JSON.stringify({ success: true, operation: "search_knowledge", results }, null, 2) }] };
        }
        case "get_knowledge_doc": {
          identityService.assertAuthorized(ctx, [["knowledge:read", "company:read"]]);
          const doc = knowService.getKnowledgeDoc(args.doc_id);
          if (!doc) {
            throw new Error(`RESOURCE_NOT_FOUND: Knowledge document '${args.doc_id}' not found`);
          }
          return { content: [{ type: "text", text: JSON.stringify({ success: true, operation: "get_knowledge_doc", document: doc }, null, 2) }] };
        }
        case "propose_knowledge_change": {
          identityService.assertAuthorized(ctx, [["knowledge:propose", "knowledge:write", "company:write"]]);
          const proposal = knowService.proposeKnowledgeChange({
            ctx,
            docId: args.doc_id,
            proposedMarkdown: args.proposed_markdown,
            rationale: args.rationale
          });
          return { content: [{ type: "text", text: JSON.stringify({ success: true, operation: "propose_knowledge_change", ...proposal }, null, 2) }] };
        }
        case "approve_knowledge_proposal": {
          identityService.assertAuthorized(ctx, [["knowledge:approve", "approvals:decide"]]);
          if (!isFounderHuman(ctx) && !(ctx.principalType === "agent" && ctx.agentId === "flash-01" && ctx.principalId === "flash-01")) {
            throw new Error("PERMISSION_DENIED: Only Founder or CTO can approve knowledge proposals");
          }
          const app = knowService.approveKnowledgeProposal({
            ctx,
            proposalId: args.proposal_id,
            decision: args.decision
          });
          return { content: [{ type: "text", text: JSON.stringify({ success: true, operation: "approve_knowledge_proposal", ...app }, null, 2) }] };
        }
        case "search_memory": {
          identityService.assertAuthorized(ctx, [["memory:read", "company:read"]]);
          const results = knowService.searchMemory({
            ctx,
            callerAgentId: ctx.agentId ?? undefined,
            query: args.query,
            scope: args.scope,
            projectId: args.project_id,
            taskId: args.task_id,
            limit: args.limit
          });
          return { content: [{ type: "text", text: JSON.stringify({ success: true, operation: "search_memory", results }, null, 2) }] };
        }
        case "write_memory": {
          identityService.assertAuthorized(ctx, [["memory:write", "memory:manage"]]);
          if (!args.content) {
            throw new Error("INVALID_ARGUMENT: write_memory requires 'content'");
          }
          const res = knowService.writeMemory({
            ctx,
            callerAgentId: ctx.agentId ?? undefined,
            ownerAgentId: args.owner_agent_id,
            scope: args.scope || "agent_private",
            title: args.title,
            content: args.content,
            projectId: args.project_id,
            taskId: args.task_id
          });
          return { content: [{ type: "text", text: JSON.stringify({ success: true, operation: "write_memory", memory: res }, null, 2) }] };
        }
        case "get_system_observability": {
          identityService.assertAuthorized(ctx, [["observability:read", "observability:admin"]]);
          const obs = obsService.getSystemStatusAndUsage();
          return { content: [{ type: "text", text: JSON.stringify({ success: true, operation: "get_system_observability", ...obs }, null, 2) }] };
        }
        case "record_model_usage": {
          identityService.assertAuthorized(ctx, [["quota:record", "observability:write", "observability:admin"]]);
          if (!ctx.agentId) {
            throw new Error("VALIDATION_ERROR: record_model_usage requires an authenticated caller with a bound agent_id");
          }
          obsService.recordModelUsage({
            ctx,
            agentId: ctx.agentId,
            taskId: args.task_id,
            inputTokens: args.input_tokens || args.prompt_tokens || 0,
            outputTokens: args.output_tokens || args.completion_tokens || 0,
            cachedTokens: args.cached_tokens || 0
          });
          return { content: [{ type: "text", text: JSON.stringify({ success: true, operation: "record_model_usage", recorded: true }, null, 2) }] };
        }
        default:
          return {
            isError: true,
            content: [{
              type: "text",
              text: JSON.stringify({
                error_code: "INVALID_OPERATION",
                message: `Unknown or unhandled operation '${(args as any).operation}' for M38`
              }, null, 2)
            }]
          };
      }
    }
  );
}

export function createBaseMcpServer(): McpServer {
  const server = new McpServer({
    name: SERVER_NAME,
    version: REGISTRY_VERSION
  });
  registerCompanyTools(server);
  return server;
}

export function createFullMcpServer(options?: {
  isPublicGateway?: boolean;
  connManager?: ConnectionManager;
  workspaceRoot?: string;
  anchorFilePath?: string;
  hmacKey?: string;
}): McpServer {
  const server = new McpServer({
    name: SERVER_NAME,
    version: "2.2.1"
  });
  registerAllV221Tools(server, options);
  return server;
}
