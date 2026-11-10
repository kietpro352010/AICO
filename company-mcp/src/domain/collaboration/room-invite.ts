import { z } from "zod";
import { IsoTimestampSchema } from "../common.js";

export const InviteStatusSchema = z.enum(["pending", "accepted", "declined", "expired"]);
export type InviteStatus = z.infer<typeof InviteStatusSchema>;

export const RoomInviteSchema = z.object({
  invite_id: z.string().min(1),
  room_id: z.string().min(1),
  inviter_id: z.string().min(1),
  invitee_id: z.string().min(1),
  status: InviteStatusSchema.default("pending"),
  invite_token_hash: z.string().nullable().default(null), // private invitation secret hash
  expires_at: IsoTimestampSchema,
  created_at: IsoTimestampSchema
});

export type RoomInvite = z.infer<typeof RoomInviteSchema>;

export const PublicRoomInviteDTOSchema = RoomInviteSchema.omit({
  invite_token_hash: true
});

export type PublicRoomInviteDTO = z.infer<typeof PublicRoomInviteDTOSchema>;

export function toPublicRoomInviteDTO(invite: RoomInvite): PublicRoomInviteDTO {
  const { invite_token_hash, ...publicData } = invite;
  return PublicRoomInviteDTOSchema.parse(publicData);
}
