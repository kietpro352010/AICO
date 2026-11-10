import { z } from "zod";
import { IsoTimestampSchema } from "../common.js";

export const AgentQuotaAllocationSchema = z.object({
  allocation_id: z.string().min(1),
  agent_id: z.string().min(1),
  quota_pool_id: z.string().min(1),
  allocated_tokens: z.number().int().nonnegative(),
  used_tokens: z.number().int().nonnegative().default(0),
  daily_limit: z.number().int().positive(),
  billing_account_ref: z.string().nullable().default(null), // private financial/billing ID
  reset_at: IsoTimestampSchema,
  updated_at: IsoTimestampSchema
});

export type AgentQuotaAllocation = z.infer<typeof AgentQuotaAllocationSchema>;

export const PublicAgentQuotaAllocationDTOSchema = AgentQuotaAllocationSchema.omit({
  billing_account_ref: true
});

export type PublicAgentQuotaAllocationDTO = z.infer<typeof PublicAgentQuotaAllocationDTOSchema>;

export function toPublicAgentQuotaAllocationDTO(allocation: AgentQuotaAllocation): PublicAgentQuotaAllocationDTO {
  const { billing_account_ref, ...publicData } = allocation;
  return PublicAgentQuotaAllocationDTOSchema.parse(publicData);
}
