import { z } from "zod";
import { ChatRoomTypeSchema, IsoTimestampSchema } from "../common.js";

export const ChatRoomSchema = z.object({
  room_id: z.string().min(1, "room_id is required"),
  slug: z.string().min(1).regex(/^[a-z0-9-_]+$/, "slug must be lowercase alphanumeric with hyphens/underscores"),
  name: z.string().min(1, "name is required").max(200),
  room_type: ChatRoomTypeSchema,
  project_id: z.string().nullable().default(null),
  task_id: z.string().nullable().default(null),
  created_by: z.string().min(1),
  is_archived: z.boolean().default(false),
  internal_notes: z.string().nullable().default(null), // private metadata
  created_at: IsoTimestampSchema,
  updated_at: IsoTimestampSchema
});

export type ChatRoom = z.infer<typeof ChatRoomSchema>;

export const PublicChatRoomDTOSchema = ChatRoomSchema.omit({
  internal_notes: true
});

export type PublicChatRoomDTO = z.infer<typeof PublicChatRoomDTOSchema>;

export function toPublicChatRoomDTO(room: ChatRoom): PublicChatRoomDTO {
  const { internal_notes, ...publicData } = room;
  return PublicChatRoomDTOSchema.parse(publicData);
}
