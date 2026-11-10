import { z } from "zod";
import { IsoTimestampSchema } from "../common.js";

export const AgentLeaseStatusSchema = z.enum(["active", "released", "expired", "revoked"]);
export type AgentLeaseStatus = z.infer<typeof AgentLeaseStatusSchema>;

export const AgentLeaseSchema = z.object({
  lease_id: z.string().min(1),
  task_id: z.string().min(1),
  agent_id: z.string().min(1),
  lease_nonce: z.string().min(1), // cryptographic lease token
  status: AgentLeaseStatusSchema.default("active"),
  heartbeat_at: IsoTimestampSchema,
  expires_at: IsoTimestampSchema,
  acquired_at: IsoTimestampSchema
});

export type AgentLease = z.infer<typeof AgentLeaseSchema>;

export const PublicAgentLeaseDTOSchema = AgentLeaseSchema.omit({
  lease_nonce: true // Never leak cryptographic lease nonce in public DTO
});

export type PublicAgentLeaseDTO = z.infer<typeof PublicAgentLeaseDTOSchema>;

export function toPublicAgentLeaseDTO(lease: AgentLease): PublicAgentLeaseDTO {
  const { lease_nonce, ...publicData } = lease;
  return PublicAgentLeaseDTOSchema.parse(publicData);
}
