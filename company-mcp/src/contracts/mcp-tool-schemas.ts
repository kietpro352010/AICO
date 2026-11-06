import { z } from "zod";

// M01: company_ping
export const CompanyPingInputSchema = z.object({
  message: z.string().default("Hello AICO")
});

export const CompanyPingOutputSchema = z.object({
  success: z.boolean(),
  server: z.string(),
  version: z.string(),
  received: z.string(),
  timestamp: z.string()
});

// M02: company_get_info
export const CompanyGetInfoInputSchema = z.object({});

export const CompanyGetInfoOutputSchema = z.object({
  company_name: z.string(),
  full_name: z.string(),
  version: z.string(),
  operating_mode: z.string(),
  principal_agents: z.number(),
  quota_pools: z.number(),
  current_stage: z.string(),
  timestamp: z.string()
});

// M03: company_list_agents
export const CompanyListAgentsInputSchema = z.object({});

export const PublicAgentViewSchema = z.object({
  agent_id: z.string(),
  name: z.string(),
  model: z.string(),
  platform: z.string(),
  role: z.string(),
  department: z.string(),
  status: z.string(),
  capabilities: z.array(z.string()),
  invocation_policy: z.object({
    mode: z.string(),
    auto_invoke: z.boolean(),
    requires_approval: z.boolean(),
    quota_class: z.string()
  }),
  resource_policy: z.object({
    usage_tier: z.string().optional(),
    routing_priority: z.number().optional(),
    quota_pool: z.string().optional()
  }).optional(),
  reasoning: z.object({
    target_level: z.string().optional(),
    model_verified: z.boolean().optional(),
    reasoning_verified: z.boolean().optional()
  }).optional(),
  last_seen_at: z.string().nullable().optional()
});

export const CompanyListAgentsOutputSchema = z.object({
  success: z.boolean(),
  count: z.number(),
  agents: z.array(PublicAgentViewSchema)
});

// M04: company_get_agent
export const CompanyGetAgentInputSchema = z.object({
  agent_id: z.string().min(1)
});

export const CompanyGetAgentOutputSchema = z.object({
  success: z.boolean(),
  agent: PublicAgentViewSchema
});

// M05: company_list_quota_pools
export const CompanyListQuotaPoolsInputSchema = z.object({});

export const QuotaPoolViewSchema = z.object({
  pool_id: z.string(),
  provider: z.string(),
  account_label: z.string(),
  notes: z.string().nullable().optional(),
  agent_count: z.number().optional(),
  agent_ids: z.string().optional()
});

export const CompanyListQuotaPoolsOutputSchema = z.object({
  success: z.boolean(),
  count: z.number(),
  quota_pools: z.array(QuotaPoolViewSchema)
});

// M06: company_get_manifest (Public Manifest View - strictly minimized)
export const CompanyGetManifestInputSchema = z.object({});

export const PublicManifestViewSchema = z.object({
  manifest_version: z.string(),
  company_name: z.string(),
  operating_mode: z.string(),
  agent_count: z.number(),
  quota_pool_count: z.number(),
  timestamp: z.string()
});

// M13: approval_request_create
export const ApprovalRequestCreateInputSchema = z.object({
  action_type: z.string().min(1),
  requested_by: z.string().min(1),
  required_approver: z.string().default("founder-01"),
  canonical_payload: z.record(z.string(), z.any()),
  expires_in_hours: z.number().default(24)
});

export const ApprovalRequestCreatedViewSchema = z.object({
  success: z.boolean(),
  approval_id: z.string(),
  action_type: z.string(),
  requested_by: z.string(),
  required_approver: z.string(),
  payload_hash_sha256: z.string(),
  status: z.string(),
  expires_at: z.string()
});
