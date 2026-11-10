import { z } from "zod";
import { PrincipalTypeSchema, IsoTimestampSchema } from "../common.js";

export const ChatMemberRoleSchema = z.enum(["owner", "moderator", "member", "observer"]);
export type ChatMemberRole = z.infer<typeof ChatMemberRoleSchema>;

export const ChatMemberSchema = z.object({
  membership_id: z.string().min(1),
  room_id: z.string().min(1),
  principal_id: z.string().min(1),
  principal_type: PrincipalTypeSchema,
  role: ChatMemberRoleSchema.default("member"),
  last_read_message_id: z.string().nullable().default(null),
  internal_cursor: z.string().nullable().default(null), // private read cursor
  joined_at: IsoTimestampSchema
});

export type ChatMember = z.infer<typeof ChatMemberSchema>;

export const PublicChatMemberDTOSchema = ChatMemberSchema.omit({
  internal_cursor: true
});

export type PublicChatMemberDTO = z.infer<typeof PublicChatMemberDTOSchema>;

export function toPublicChatMemberDTO(member: ChatMember): PublicChatMemberDTO {
  const { internal_cursor, ...publicData } = member;
  return PublicChatMemberDTOSchema.parse(publicData);
}
