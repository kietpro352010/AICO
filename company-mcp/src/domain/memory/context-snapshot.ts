import { z } from "zod";
import { IsoTimestampSchema } from "../common.js";

export const ContextSnapshotSchema = z.object({
  snapshot_id: z.string().min(1),
  task_id: z.string().nullable().default(null),
  agent_id: z.string().min(1),
  summary: z.string().min(1).max(500),
  token_count: z.number().int().nonnegative().default(0),
  snapshot_data: z.string().min(1),
  encryption_iv: z.string().nullable().default(null),
  created_at: IsoTimestampSchema
});

export type ContextSnapshot = z.infer<typeof ContextSnapshotSchema>;

export const PublicContextSnapshotDTOSchema = ContextSnapshotSchema.omit({
  snapshot_data: true,
  encryption_iv: true
});

export type PublicContextSnapshotDTO = z.infer<typeof PublicContextSnapshotDTOSchema>;

export function toPublicContextSnapshotDTO(snapshot: ContextSnapshot): PublicContextSnapshotDTO {
  const { snapshot_data, encryption_iv, ...publicData } = snapshot;
  return PublicContextSnapshotDTOSchema.parse(publicData);
}
