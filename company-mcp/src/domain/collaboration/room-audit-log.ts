import { z } from "zod";
import { IsoTimestampSchema } from "../common.js";
import { noSecretText, projectPublicAllowlistedRecord } from "../sanitization.js";

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
    target: noSecretText(z.string().max(200), "details.target").optional(),
    target_principal_id: noSecretText(z.string().max(120), "details.target_principal_id").optional(),
    previous_role: noSecretText(z.string().max(50), "details.previous_role").optional(),
    new_role: noSecretText(z.string().max(50), "details.new_role").optional(),
    reason: noSecretText(z.string().max(300), "details.reason").optional(),
    summary: noSecretText(z.string().max(300), "details.summary").optional()
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
