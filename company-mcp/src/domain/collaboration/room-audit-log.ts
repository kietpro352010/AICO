import { z } from "zod";
import { IsoTimestampSchema } from "../common.js";

export const RoomAuditActionSchema = z.enum([
  "room_created",
  "member_added",
  "member_removed",
  "role_updated",
  "room_archived",
  "room_restored"
]);
export type RoomAuditAction = z.infer<typeof RoomAuditActionSchema>;

export const RoomAuditLogSchema = z.object({
  audit_id: z.string().min(1),
  room_id: z.string().min(1),
  action: RoomAuditActionSchema,
  actor_id: z.string().min(1),
  details: z.record(z.string(), z.unknown()).default({}),
  security_context_snapshot: z.string().nullable().default(null), // private auth payload
  created_at: IsoTimestampSchema
});

export type RoomAuditLog = z.infer<typeof RoomAuditLogSchema>;

export const PublicRoomAuditLogDTOSchema = RoomAuditLogSchema.omit({
  security_context_snapshot: true
});

export type PublicRoomAuditLogDTO = z.infer<typeof PublicRoomAuditLogDTOSchema>;

export function toPublicRoomAuditLogDTO(log: RoomAuditLog): PublicRoomAuditLogDTO {
  const { security_context_snapshot, ...publicData } = log;
  return PublicRoomAuditLogDTOSchema.parse(publicData);
}
