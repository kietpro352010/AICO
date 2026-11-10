import { z } from "zod";
import { IsoTimestampSchema } from "../common.js";

export const AgentExecutionLockSchema = z.object({
  lock_id: z.string().min(1),
  resource_uri: z.string().min(1),
  holder_agent_id: z.string().min(1),
  lock_nonce: z.string().min(1), // cryptographic secret lock nonce
  purpose: z.string().min(1),
  acquired_at: IsoTimestampSchema,
  expires_at: IsoTimestampSchema
});

export type AgentExecutionLock = z.infer<typeof AgentExecutionLockSchema>;

export const PublicAgentExecutionLockDTOSchema = AgentExecutionLockSchema.omit({
  lock_nonce: true // Never expose cryptographic lock nonce in public DTO
});

export type PublicAgentExecutionLockDTO = z.infer<typeof PublicAgentExecutionLockDTOSchema>;

export function toPublicAgentExecutionLockDTO(lock: AgentExecutionLock): PublicAgentExecutionLockDTO {
  const { lock_nonce, ...publicData } = lock;
  return PublicAgentExecutionLockDTOSchema.parse(publicData);
}
