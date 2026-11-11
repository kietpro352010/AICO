import { z } from "zod";
import { ChatMessageTypeSchema, PrincipalTypeSchema, IsoTimestampSchema } from "../common.js";
import { projectPublicAllowlistedRecord } from "../sanitization.js";

export const PUBLIC_CHAT_MESSAGE_METADATA_KEYS = [
  "thread_title",
  "topic",
  "priority_label",
  "ui_display_mode",
  "related_task_id",
  "tags",
  "reply_preview",
  "format_version"
] as const;

export const PublicChatMessageMetadataSchema = z
  .object({
    thread_title: z.string().max(200).optional(),
    topic: z.string().max(120).optional(),
    priority_label: z.enum(["low", "normal", "high", "urgent"]).optional(),
    ui_display_mode: z.enum(["standard", "compact", "banner", "code"]).optional(),
    related_task_id: z.string().max(100).optional(),
    tags: z.array(z.string().max(50)).max(20).optional(),
    reply_preview: z.string().max(300).optional(),
    format_version: z.string().max(20).optional()
  })
  .strict();

export type PublicChatMessageMetadata = z.infer<typeof PublicChatMessageMetadataSchema>;

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
  internal_metadata: z.record(z.string(), z.unknown()).default({}),
  raw_token_trace: z.string().nullable().default(null), // private telemetry
  is_edited: z.boolean().default(false),
  created_at: IsoTimestampSchema,
  updated_at: IsoTimestampSchema
});

export type ChatMessage = z.infer<typeof ChatMessageSchema>;

export const PublicChatMessageDTOSchema = ChatMessageSchema.omit({
  raw_token_trace: true,
  internal_metadata: true
}).extend({
  metadata: PublicChatMessageMetadataSchema.default({})
});

export type PublicChatMessageDTO = z.infer<typeof PublicChatMessageDTOSchema>;

export function toPublicChatMessageDTO(message: ChatMessage): PublicChatMessageDTO {
  const { raw_token_trace, internal_metadata, metadata, ...publicData } = message;
  return PublicChatMessageDTOSchema.parse({
    ...publicData,
    metadata: projectPublicAllowlistedRecord(metadata, PUBLIC_CHAT_MESSAGE_METADATA_KEYS)
  });
}
