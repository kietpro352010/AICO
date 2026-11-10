import { z } from "zod";
import { ChatMessageTypeSchema, PrincipalTypeSchema, IsoTimestampSchema } from "../common.js";

export const ChatMessageSchema = z.object({
  message_id: z.string().min(1),
  room_id: z.string().min(1),
  sender_id: z.string().min(1),
  sender_type: PrincipalTypeSchema,
  message_type: ChatMessageTypeSchema.default("TEXT"),
  content: z.string().min(1, "content cannot be empty"),
  reply_to_id: z.string().nullable().default(null),
  mentions: z.array(z.string()).default([]),
  metadata: z.record(z.string(), z.unknown()).default({}),
  raw_token_trace: z.string().nullable().default(null), // private telemetry
  is_edited: z.boolean().default(false),
  created_at: IsoTimestampSchema,
  updated_at: IsoTimestampSchema
});

export type ChatMessage = z.infer<typeof ChatMessageSchema>;

export const PublicChatMessageDTOSchema = ChatMessageSchema.omit({
  raw_token_trace: true
});

export type PublicChatMessageDTO = z.infer<typeof PublicChatMessageDTOSchema>;

export function toPublicChatMessageDTO(message: ChatMessage): PublicChatMessageDTO {
  const { raw_token_trace, ...publicData } = message;
  return PublicChatMessageDTOSchema.parse(publicData);
}
