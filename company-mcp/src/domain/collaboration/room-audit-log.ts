import { z } from "zod";
import { IsoTimestampSchema } from "../common.js";
import { projectPublicAllowlistedRecord } from "../sanitization.js";

export const PUBLIC_ROOM_AUDIT_DETAILS_KEYS = [
  "target",
  "target_principal_id",
  "previous_role",
  "new_role",
  "reason",
  "summary"
] as const;

export const PublicRoomAuditDetailsSchema = z
  .object({
    target: z.string().max(200).optional(),
    target_principal_id: z.string().max(120).optional(),
    previous_role: z.string().max(50).optional(),
    new_role: z.string().max(50).optional(),
    reason: z.string().max(300).optional(),
    summary: z.string().max(300).optional()
  })
  .strict();

export type PublicRoomAuditDetails = z.infer<typeof PublicRoomAuditDetailsSchema>;

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
  internal_details: z.record(z.string(), z.unknown()).default({}),
  security_context_snapshot: z.string().nullable().default(null), // private auth payload
  created_at: IsoTimestampSchema
});

export type RoomAuditLog = z.infer<typeof RoomAuditLogSchema>;

export const PublicRoomAuditLogDTOSchema = RoomAuditLogSchema.omit({
  security_context_snapshot: true,
  internal_details: true
}).extend({
  details: PublicRoomAuditDetailsSchema.default({})
});

export type PublicRoomAuditLogDTO = z.infer<typeof PublicRoomAuditLogDTOSchema>;

export function toPublicRoomAuditLogDTO(log: RoomAuditLog): PublicRoomAuditLogDTO {
  const { security_context_snapshot, internal_details, details, ...publicData } = log;
  return PublicRoomAuditLogDTOSchema.parse({
    ...publicData,
    details: projectPublicAllowlistedRecord(details, PUBLIC_ROOM_AUDIT_DETAILS_KEYS)
  });
}
