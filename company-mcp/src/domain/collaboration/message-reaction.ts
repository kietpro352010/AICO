import { z } from "zod";
import { IsoTimestampSchema } from "../common.js";

export const MessageReactionSchema = z.object({
  reaction_id: z.string().min(1),
  message_id: z.string().min(1),
  principal_id: z.string().min(1),
  reaction_code: z.string().min(1).max(50),
  internal_client_ip: z.string().nullable().default(null), // private network metadata
  created_at: IsoTimestampSchema
});

export type MessageReaction = z.infer<typeof MessageReactionSchema>;

export const PublicMessageReactionDTOSchema = MessageReactionSchema.omit({
  internal_client_ip: true
});

export type PublicMessageReactionDTO = z.infer<typeof PublicMessageReactionDTOSchema>;

export function toPublicMessageReactionDTO(reaction: MessageReaction): PublicMessageReactionDTO {
  const { internal_client_ip, ...publicData } = reaction;
  return PublicMessageReactionDTOSchema.parse(publicData);
}
