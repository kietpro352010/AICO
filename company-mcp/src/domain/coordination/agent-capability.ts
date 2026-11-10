import { z } from "zod";
import { IsoTimestampSchema } from "../common.js";

export const CapabilityProficiencySchema = z.enum(["core", "supporting", "specialist"]);
export type CapabilityProficiency = z.infer<typeof CapabilityProficiencySchema>;

export const AgentCapabilitySchema = z.object({
  capability_id: z.string().min(1),
  agent_id: z.string().min(1),
  capability_name: z.string().min(1),
  version: z.string().min(1),
  is_enabled: z.boolean().default(true),
  proficiency: CapabilityProficiencySchema.default("supporting"),
  internal_evaluation_score: z.number().nullable().default(null), // private QA evaluation score
  granted_at: IsoTimestampSchema
});

export type AgentCapability = z.infer<typeof AgentCapabilitySchema>;

export const PublicAgentCapabilityDTOSchema = AgentCapabilitySchema.omit({
  internal_evaluation_score: true
});

export type PublicAgentCapabilityDTO = z.infer<typeof PublicAgentCapabilityDTOSchema>;

export function toPublicAgentCapabilityDTO(capability: AgentCapability): PublicAgentCapabilityDTO {
  const { internal_evaluation_score, ...publicData } = capability;
  return PublicAgentCapabilityDTOSchema.parse(publicData);
}
