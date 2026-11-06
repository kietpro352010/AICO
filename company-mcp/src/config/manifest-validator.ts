import * as fs from "node:fs";
import * as z from "zod/v4";

export const AgentManifestSchema = z.object({
  agent_id: z.string().min(1),
  display_name: z.string().min(1),
  canonical_role: z.string().min(1),
  department: z.string().min(1),
  status: z.string().default("configured"),
  ai_provider: z.string().optional(),
  configured_model: z.string().optional(),
  account_assignment: z.string().optional(),
  quota_pool: z.string().optional(),
  reasoning_tier: z.string().optional(),
  session_mode: z.string().optional(),
  dispatch_mode: z.string().optional(),
  invocation_approval_policy: z.string().optional(),
  action_approval_policy: z.string().optional(),
  capabilities: z.array(z.string()).default([]),
  invocation_policy: z.object({
    mode: z.string(),
    auto_invoke: z.boolean(),
    requires_approval: z.boolean(),
    quota_class: z.string(),
    usage_tier: z.string().optional(),
    routing_priority: z.number().optional()
  }).optional(),
  permission_policy: z.object({
    scopes: z.array(z.string())
  }).passthrough().optional()
}).passthrough();

export const QuotaPoolSchema = z.object({
  pool_id: z.string().min(1),
  provider: z.string().min(1),
  account_label: z.string().min(1),
  notes: z.string().nullable().optional()
}).passthrough();

export const CompanyManifestSchema = z.object({
  manifest_version: z.string(),
  company: z.object({
    id: z.string(),
    name: z.string(),
    description: z.string().optional(),
    operating_mode: z.string(),
    founder: z.union([
      z.string(),
      z.object({
        title: z.string().optional(),
        identity: z.string().optional(),
        authority: z.string().optional()
      }).passthrough()
    ])
  }).passthrough(),
  agents: z.array(AgentManifestSchema),
  quota_pools: z.array(QuotaPoolSchema)
}).passthrough();

export type CompanyManifest = z.infer<typeof CompanyManifestSchema>;

export function parseAndValidateManifest(filePath: string): { valid: boolean; manifest?: CompanyManifest; errors?: string[] } {
  try {
    if (!fs.existsSync(filePath)) {
      return { valid: false, errors: [`Manifest file not found: ${filePath}`] };
    }
    const raw = fs.readFileSync(filePath, "utf8");
    const json = JSON.parse(raw);
    const parsed = CompanyManifestSchema.safeParse(json);
    if (!parsed.success) {
      return {
        valid: false,
        errors: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`)
      };
    }
    return { valid: true, manifest: parsed.data };
  } catch (err) {
    return { valid: false, errors: [err instanceof Error ? err.message : String(err)] };
  }
}
