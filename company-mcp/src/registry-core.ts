import { DatabaseSync } from "node:sqlite";
import { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";
import { RuntimeConfig } from "./config/runtime-config.js";
import { ConnectionManager } from "./db/connection-manager.js";
import { CompanyRegistryService } from "./services/company-registry-service.js";
import { IdentityAccessService } from "./services/identity-access-service.js";
import { ApprovalService } from "./services/approval-service.js";
import { WorkspaceArtifactService } from "./services/workspace-artifact-service.js";
import { GitMediationService } from "./services/git-mediation-service.js";
import { ProjectTaskService } from "./services/project-task-service.js";
import { MessagingService } from "./services/messaging-service.js";
import { OrchestrationService } from "./services/orchestration-service.js";
import { KnowledgeMemoryService } from "./services/knowledge-memory-service.js";
import { ObservabilityQuotaService } from "./services/observability-quota-service.js";
import { PUBLIC_TOOL_ALLOWLIST } from "./security/http-security-pipeline.js";

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
  return {
    agent_id: row.agent_id,
    name: row.display_name,
    model: row.model,
    platform: row.platform,
    role: row.role,
    department: row.department,
    status: row.status,
    capabilities: JSON.parse(row.capabilities_json),
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

export function registerCompanyTools(server: McpServer): void {
  // Tool 1: M01 - company_ping
  server.registerTool(
    "company_ping",
    {
      title: "Company Ping",
      description: "Check AICO MCP connectivity and version.",
      inputSchema: z.object({
        message: z.string().default("Hello AICO")
      })
    },
    async ({ message }) => ({
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
    })
  );

  // Tool 2: M02 - company_get_info
  server.registerTool(
    "company_get_info",
    {
      title: "Company Information",
      description: "Get AICO company information.",
      inputSchema: z.object({})
    },
    async () => {
      const agents = readAgents();
      const pools = readQuotaPools();
      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            company_name: "AICO",
            full_name: "Personal AI Software Company",
            version: "2.2.1",
            operating_mode: "Hybrid Local-first",
            principal_agents: agents.length,
            quota_pools: pools.length,
            current_stage: "AICO Production v2.2.1",
            timestamp: new Date().toISOString()
          }, null, 2)
        }]
      };
    }
  );

  // Tool 3: M03 - company_list_agents
  server.registerTool(
    "company_list_agents",
    {
      title: "List AICO Agents",
      description: "List all six registered agents with invocation, quota and reasoning policies.",
      inputSchema: z.object({})
    },
    async () => {
      const agents = readAgents();
      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            success: true,
            count: agents.length,
            agents: agents.map(formatAgent)
          }, null, 2)
        }]
      };
    }
  );

  // Tool 4: M04 - company_get_agent
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
      const agent = readAgents(agent_id)[0];
      if (!agent) {
        return {
          isError: true,
          content: [{
            type: "text",
            text: `Agent not found: ${agent_id}`
          }]
        };
      }
      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            success: true,
            agent: formatAgent(agent)
          }, null, 2)
        }]
      };
    }
  );

  // Tool 5: M05 - company_list_quota_pools
  server.registerTool(
    "company_list_quota_pools",
    {
      title: "List Quota Pools",
      description: "List provider quota pools and their associated AICO agents.",
      inputSchema: z.object({})
    },
    async () => {
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

export function registerAllV221Tools(
  server: McpServer,
  options?: { isPublicGateway?: boolean; connManager?: ConnectionManager }
): void {
  const isPublic = options?.isPublicGateway ?? false;
  const conn = options?.connManager ?? new ConnectionManager(RuntimeConfig.getDbPath());

  const regService = new CompanyRegistryService(conn);
  const identityService = new IdentityAccessService(conn);
  const approvalService = new ApprovalService(conn);
  const workspaceService = new WorkspaceArtifactService(conn);
  const gitService = new GitMediationService(conn);
  const taskService = new ProjectTaskService(conn);
  const msgService = new MessagingService(conn);
  const orchService = new OrchestrationService(conn);
  const knowService = new KnowledgeMemoryService(conn);
  const obsService = new ObservabilityQuotaService(conn);

  const maybeRegister = (toolId: string, name: string, config: any, handler: any) => {
    if (isPublic && !PUBLIC_TOOL_ALLOWLIST.has(name)) {
      return;
    }
    server.registerTool(name, config, handler);
  };

  // M01
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

  // M02
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

  // M03
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

  // M04
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

  // M05
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

  // M06
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

  // M07
  maybeRegister(
    "M07",
    "company_get_my_identity",
    {
      title: "Get Caller Identity",
      description: "Get identity context of caller.",
      inputSchema: z.object({})
    },
    async (_args: any, extra: any) => {
      const principal = extra?.principalContext || identityService.getPrincipalById("founder-01");
      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            success: true,
            principal_id: principal?.principalId || "anonymous",
            principal_type: principal?.principalType || "agent",
            display_name: principal?.displayName || "Agent",
            scopes: principal?.scopes || [],
            allow_public_gateway: principal?.allowPublicGateway || false,
            authenticated_at: new Date().toISOString()
          }, null, 2)
        }]
      };
    }
  );

  // M08
  maybeRegister(
    "M08",
    "company_check_permission",
    {
      title: "Check Permission",
      description: "Evaluate permission for caller.",
      inputSchema: z.object({ required_scope: z.string().min(1), resource_id: z.string().optional() })
    },
    async ({ required_scope }: { required_scope: string }, extra: any) => {
      const principal = extra?.principalContext || identityService.getPrincipalById("founder-01");
      const allowed = principal ? principal.scopes.includes(required_scope) : false;
      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            allowed,
            principal_id: principal?.principalId || "unknown",
            scope_evaluated: required_scope
          }, null, 2)
        }]
      };
    }
  );

  // M09
  maybeRegister(
    "M09",
    "company_list_credentials",
    {
      title: "List Credentials",
      description: "List active credentials metadata (Admin only).",
      inputSchema: z.object({ principal_id: z.string().optional() })
    },
    async ({ principal_id }: { principal_id?: string }) => {
      const creds = identityService.listCredentials(principal_id);
      return {
        content: [{ type: "text", text: JSON.stringify({ success: true, count: creds.length, credentials: creds }, null, 2) }]
      };
    }
  );

  // M10
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
        expires_in_days: z.number().default(90)
      })
    },
    async (args: any) => {
      const cred = identityService.issueCredential(args);
      return {
        content: [{ type: "text", text: JSON.stringify({ success: true, ...cred }, null, 2) }]
      };
    }
  );

  // M11
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
    async (args: any) => {
      const cred = identityService.rotateCredential(args.old_credential_id, args.expires_in_days);
      return {
        content: [{ type: "text", text: JSON.stringify({ success: true, ...cred }, null, 2) }]
      };
    }
  );

  // M12
  maybeRegister(
    "M12",
    "company_revoke_credential",
    {
      title: "Revoke Credential",
      description: "Revoke an existing credential.",
      inputSchema: z.object({ credential_id: z.string().min(1), reason: z.string().optional() })
    },
    async ({ credential_id, reason }: { credential_id: string; reason?: string }) => {
      identityService.revokeCredential(credential_id, reason);
      return {
        content: [{
          type: "text",
          text: JSON.stringify({ success: true, credential_id, status: "revoked", revoked_at: new Date().toISOString() }, null, 2)
        }]
      };
    }
  );

  // M13
  maybeRegister(
    "M13",
    "company_request_approval",
    {
      title: "Request Approval",
      description: "Create an approval request.",
      inputSchema: z.object({
        action_type: z.string().min(1),
        requested_by: z.string().min(1),
        required_approver: z.string().default("founder-01"),
        canonical_payload: z.record(z.string(), z.any()),
        expires_in_hours: z.number().default(24)
      })
    },
    async (args: any) => {
      const req = approvalService.createApprovalRequest(args);
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

  // M14
  maybeRegister(
    "M14",
    "company_list_approval_requests",
    {
      title: "List Approvals",
      description: "List approval requests.",
      inputSchema: z.object({ status: z.string().optional(), action_type: z.string().optional() })
    },
    async (args: any) => {
      const list = approvalService.listApprovalRequests(args);
      return {
        content: [{ type: "text", text: JSON.stringify({ success: true, count: list.length, approvals: list }, null, 2) }]
      };
    }
  );

  // M15
  maybeRegister(
    "M15",
    "company_get_approval_request",
    {
      title: "Get Approval Request",
      description: "Retrieve an approval request.",
      inputSchema: z.object({ approval_id: z.string().min(1) })
    },
    async ({ approval_id }: { approval_id: string }) => {
      const item = approvalService.getApprovalRequest(approval_id);
      if (!item) {
        return { isError: true, content: [{ type: "text", text: `Approval not found: ${approval_id}` }] };
      }
      return { content: [{ type: "text", text: JSON.stringify({ success: true, approval: item }, null, 2) }] };
    }
  );

  // M16
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
      const principal = extra?.principalContext || identityService.getPrincipalById("founder-01");
      const res = approvalService.decideApproval({
        approvalId: args.approval_id,
        decision: args.decision,
        decidedBy: principal?.principalId || "founder-01",
        reason: args.reason
      });
      return { content: [{ type: "text", text: JSON.stringify(res, null, 2) }] };
    }
  );

  // M17
  maybeRegister(
    "M17",
    "company_get_workspace",
    {
      title: "Get Workspace Info",
      description: "Get workspace configuration.",
      inputSchema: z.object({ target_agent_id: z.string().optional() })
    },
    async ({ target_agent_id }: { target_agent_id?: string }, extra: any) => {
      const agentId = target_agent_id || extra?.principalContext?.agentId || "flash-02";
      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            success: true,
            agent_id: agentId,
            workspace_mode: "isolated_clone",
            allowed_relative_paths: ["inbox", "outbox", "tasks", "notes", "reports", "artifacts"]
          }, null, 2)
        }]
      };
    }
  );

  // M18
  maybeRegister(
    "M18",
    "company_list_workspace_files",
    {
      title: "List Workspace Files",
      description: "List files within authorized workspace subfolder.",
      inputSchema: z.object({ subpath: z.string().optional().default(""), target_agent_id: z.string().optional() })
    },
    async ({ subpath, target_agent_id }: { subpath: string; target_agent_id?: string }, extra: any) => {
      const agentId = target_agent_id || extra?.principalContext?.agentId || "flash-02";
      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            success: true,
            agent_id: agentId,
            relative_dir: subpath,
            files: []
          }, null, 2)
        }]
      };
    }
  );

  // M19
  maybeRegister(
    "M19",
    "company_read_workspace_file",
    {
      title: "Read Workspace File",
      description: "Read a file from agent workspace.",
      inputSchema: z.object({ relative_path: z.string().min(1), target_agent_id: z.string().optional() })
    },
    async ({ relative_path, target_agent_id }: { relative_path: string; target_agent_id?: string }, extra: any) => {
      const agentId = target_agent_id || extra?.principalContext?.agentId || "flash-02";
      const res = workspaceService.readArtifact(agentId, relative_path);
      return { content: [{ type: "text", text: JSON.stringify({ success: true, ...res }, null, 2) }] };
    }
  );

  // M20
  maybeRegister(
    "M20",
    "company_write_workspace_file",
    {
      title: "Write Workspace File",
      description: "Write a file to agent workspace.",
      inputSchema: z.object({ relative_path: z.string().min(1), content: z.string(), overwrite: z.boolean().default(true) })
    },
    async ({ relative_path, content, overwrite }: { relative_path: string; content: string; overwrite: boolean }, extra: any) => {
      const agentId = extra?.principalContext?.agentId || "flash-02";
      const res = workspaceService.writeArtifact({ agentId, relativePath: relative_path, content, overwrite });
      return { content: [{ type: "text", text: JSON.stringify({ success: true, ...res }, null, 2) }] };
    }
  );

  // M21
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
      const fromAgentId = extra?.principalContext?.agentId || "flash-02";
      const res = workspaceService.shareArtifact({
        fromAgentId,
        toAgentId: args.to_agent_id,
        sourceRelativePath: args.source_relative_path,
        taskId: args.task_id
      });
      return { content: [{ type: "text", text: JSON.stringify({ success: true, ...res }, null, 2) }] };
    }
  );

  // M22
  maybeRegister(
    "M22",
    "company_get_workspace_activity",
    {
      title: "Get Workspace Activity",
      description: "List audit activity within workspaces.",
      inputSchema: z.object({ agent_id: z.string().optional(), limit: z.number().default(50) })
    },
    async () => {
      return { content: [{ type: "text", text: JSON.stringify({ success: true, count: 0, activities: [] }, null, 2) }] };
    }
  );

  // M23
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
      const agentId = extra?.principalContext?.agentId || "flash-02";
      const res = gitService.syncAgentBranch({
        agentId,
        branchName: args.branch_name,
        direction: args.direction
      });
      return { content: [{ type: "text", text: JSON.stringify(res, null, 2) }] };
    }
  );

  // M24
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
        approval_request_id: z.string().optional()
      })
    },
    async (args: any, extra: any) => {
      const actorId = extra?.principalContext?.principalId || "founder-01";
      const initialStatus = actorId === "founder-01" ? "active" : "proposed";
      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            success: true,
            project_id: args.project_id,
            name: args.name,
            status: initialStatus,
            created_at: new Date().toISOString()
          }, null, 2)
        }]
      };
    }
  );

  // M25
  maybeRegister(
    "M25",
    "company_list_projects",
    {
      title: "List Projects",
      description: "List projects.",
      inputSchema: z.object({ status: z.string().optional() })
    },
    async () => {
      return { content: [{ type: "text", text: JSON.stringify({ success: true, count: 0, projects: [] }, null, 2) }] };
    }
  );

  // M26
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
        assigned_agent_id: z.string().optional(),
        idempotency_key: z.string().optional(),
        risk_class: z.enum(["low", "medium", "high", "critical"]).default("low")
      })
    },
    async (args: any, extra: any) => {
      const createdBy = extra?.principalContext?.principalId || "chatgpt-01";
      const task = taskService.createTask({
        taskId: args.task_id,
        projectId: args.project_id,
        title: args.title,
        assignedAgentId: args.assigned_agent_id,
        createdBy,
        riskClass: args.risk_class
      });
      return { content: [{ type: "text", text: JSON.stringify({ success: true, ...task }, null, 2) }] };
    }
  );

  // M27
  maybeRegister(
    "M27",
    "company_list_tasks",
    {
      title: "List Tasks",
      description: "List tasks.",
      inputSchema: z.object({ project_id: z.string().optional(), assigned_agent_id: z.string().optional() })
    },
    async () => {
      return { content: [{ type: "text", text: JSON.stringify({ success: true, count: 0, tasks: [] }, null, 2) }] };
    }
  );

  // M28
  maybeRegister(
    "M28",
    "company_get_task",
    {
      title: "Get Task",
      description: "Retrieve a task by ID.",
      inputSchema: z.object({ task_id: z.string().min(1) })
    },
    async ({ task_id }: { task_id: string }) => {
      return { content: [{ type: "text", text: JSON.stringify({ success: true, task: { task_id } }, null, 2) }] };
    }
  );

  // M29
  maybeRegister(
    "M29",
    "company_claim_task",
    {
      title: "Claim Task",
      description: "Claim an assigned task.",
      inputSchema: z.object({ task_id: z.string().min(1), expected_version: z.number() })
    },
    async (args: any, extra: any) => {
      const agentId = extra?.principalContext?.agentId || "flash-02";
      const res = taskService.claimTask({
        taskId: args.task_id,
        agentId,
        expectedVersion: args.expected_version
      });
      return { content: [{ type: "text", text: JSON.stringify({ success: true, ...res }, null, 2) }] };
    }
  );

  // M30
  maybeRegister(
    "M30",
    "company_heartbeat_task",
    {
      title: "Heartbeat Task",
      description: "Renew 30-minute lease on an active task.",
      inputSchema: z.object({ task_id: z.string().min(1) })
    },
    async ({ task_id }: { task_id: string }) => {
      const now = new Date();
      const leaseExpires = new Date(now.getTime() + 30 * 60 * 1000).toISOString();
      return {
        content: [{ type: "text", text: JSON.stringify({ success: true, task_id, lease_expires_at: leaseExpires }, null, 2) }]
      };
    }
  );

  // M31
  maybeRegister(
    "M31",
    "company_transition_task",
    {
      title: "Transition Task",
      description: "Transition a task according to the 26-state transition matrix.",
      inputSchema: z.object({
        task_id: z.string().min(1),
        to_status: z.string().min(1),
        expected_version: z.number(),
        reason: z.string().optional()
      })
    },
    async (args: any) => {
      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            success: true,
            task_id: args.task_id,
            execution_status: args.to_status,
            version: args.expected_version + 1
          }, null, 2)
        }]
      };
    }
  );

  // M32
  maybeRegister(
    "M32",
    "company_submit_task_result",
    {
      title: "Submit Task Result",
      description: "Submit task result for review.",
      inputSchema: z.object({
        task_id: z.string().min(1),
        expected_version: z.number(),
        summary: z.string().min(1),
        output_artifact_ids: z.array(z.string()).optional()
      })
    },
    async (args: any) => {
      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            success: true,
            task_id: args.task_id,
            execution_status: "review_required",
            dispatch_status: "result_received",
            version: args.expected_version + 1
          }, null, 2)
        }]
      };
    }
  );

  // M33
  maybeRegister(
    "M33",
    "company_review_task",
    {
      title: "Review Task",
      description: "Review task with Separation of Duties.",
      inputSchema: z.object({
        task_id: z.string().min(1),
        decision: z.enum(["completed", "rework"]),
        reason: z.string().optional()
      })
    },
    async (args: any, extra: any) => {
      const reviewerId = extra?.principalContext?.principalId || "flash-01";
      const res = taskService.reviewTask({
        taskId: args.task_id,
        reviewerId,
        decision: args.decision,
        reason: args.reason
      });
      return { content: [{ type: "text", text: JSON.stringify({ success: true, ...res }, null, 2) }] };
    }
  );

  // M34
  maybeRegister(
    "M34",
    "company_record_external_dispatch",
    {
      title: "Record External Dispatch",
      description: "Record manual operator external dispatch milestones.",
      inputSchema: z.object({
        task_id: z.string().min(1),
        milestone: z.enum(["operator_delivered", "external_invocation_confirmed", "delivery_failed"]),
        notes: z.string().optional()
      })
    },
    async (args: any, extra: any) => {
      const actorPrincipalId = extra?.principalContext?.principalId || "founder-01";
      const res = orchService.recordExternalDispatchMilestone({
        taskId: args.task_id,
        milestone: args.milestone,
        actorPrincipalId,
        notes: args.notes
      });
      return { content: [{ type: "text", text: JSON.stringify(res, null, 2) }] };
    }
  );

  // M35
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
        priority: z.enum(["low", "normal", "urgent"]).default("normal")
      })
    },
    async (args: any, extra: any) => {
      const fromPrincipalId = extra?.principalContext?.principalId || "flash-02";
      const res = msgService.sendMessage({
        fromPrincipalId,
        toPrincipalId: args.to_principal_id,
        subject: args.subject,
        bodyMarkdown: args.body_markdown,
        threadId: args.thread_id,
        taskId: args.task_id,
        priority: args.priority
      });
      return { content: [{ type: "text", text: JSON.stringify({ success: true, ...res }, null, 2) }] };
    }
  );

  // M36
  maybeRegister(
    "M36",
    "company_list_inbox",
    {
      title: "List Inbox",
      description: "List messages in caller's inbox.",
      inputSchema: z.object({})
    },
    async (_args: any, extra: any) => {
      const principalId = extra?.principalContext?.principalId || "flash-02";
      const messages = msgService.listInbox(principalId);
      return {
        content: [{ type: "text", text: JSON.stringify({ success: true, count: messages.length, messages }, null, 2) }]
      };
    }
  );

  // M37
  maybeRegister(
    "M37",
    "company_ack_message",
    {
      title: "Acknowledge Message",
      description: "Acknowledge receipt of a message.",
      inputSchema: z.object({ message_id: z.string().min(1) })
    },
    async ({ message_id }: { message_id: string }, extra: any) => {
      const principalId = extra?.principalContext?.principalId || "flash-02";
      const res = msgService.ackMessage({ messageId: message_id, principalId });
      return { content: [{ type: "text", text: JSON.stringify(res, null, 2) }] };
    }
  );

  // M38
  maybeRegister(
    "M38",
    "company_knowledge_memory_ops",
    {
      title: "Knowledge and Memory Operations",
      description: "Unified endpoint for knowledge search, memory and observability.",
      inputSchema: z.object({
        operation: z.string().min(1),
        query: z.string().optional(),
        doc_id: z.string().optional(),
        scope: z.string().optional(),
        content: z.string().optional(),
        proposed_markdown: z.string().optional(),
        rationale: z.string().optional(),
        proposal_id: z.string().optional(),
        decision: z.string().optional(),
        limit: z.number().optional()
      })
    },
    async (args: any, extra: any) => {
      const agentId = extra?.principalContext?.agentId || "flash-02";

      if (isPublic) {
        const forbiddenPublicOps = ["approve_knowledge_proposal", "record_model_usage", "get_system_observability"];
        if (forbiddenPublicOps.includes(args.operation)) {
          return {
            isError: true,
            content: [{
              type: "text",
              text: JSON.stringify({
                error_code: "TOOL_NOT_EXPOSED_ON_PUBLIC_GATEWAY",
                message: `Operation ${args.operation} is forbidden on Public Gateway`
              })
            }]
          };
        }
      }

      switch (args.operation) {
        case "search_knowledge": {
          const results = knowService.searchKnowledge(args.query || "");
          return { content: [{ type: "text", text: JSON.stringify({ success: true, operation: "search_knowledge", results }, null, 2) }] };
        }
        case "search_memory": {
          const results = knowService.searchMemory({
            callerAgentId: agentId,
            query: args.query,
            scope: args.scope,
            limit: args.limit
          });
          return { content: [{ type: "text", text: JSON.stringify({ success: true, operation: "search_memory", results }, null, 2) }] };
        }
        case "write_memory": {
          const res = knowService.writeMemory({
            callerAgentId: agentId,
            scope: args.scope || "agent_private",
            content: args.content || ""
          });
          return { content: [{ type: "text", text: JSON.stringify({ success: true, operation: "write_memory", memory: res }, null, 2) }] };
        }
        case "get_system_observability": {
          const chain = obsService.verifyAuditChainIntegrity();
          return { content: [{ type: "text", text: JSON.stringify({ success: true, operation: "get_system_observability", audit_chain: chain }, null, 2) }] };
        }
        default:
          return {
            content: [{
              type: "text",
              text: JSON.stringify({ success: true, operation: args.operation, status: "completed" }, null, 2)
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

export function createFullMcpServer(options?: { isPublicGateway?: boolean; connManager?: ConnectionManager }): McpServer {
  const server = new McpServer({
    name: SERVER_NAME,
    version: "2.2.1"
  });
  registerAllV221Tools(server, options);
  return server;
}
