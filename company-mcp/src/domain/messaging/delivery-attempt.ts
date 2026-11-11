import { z } from "zod";
import { IsoTimestampSchema } from "../common.js";
import { redactPublicString } from "../sanitization.js";

export const DeliveryAttemptStatusSchema = z.enum(["success", "failed"]);
export type DeliveryAttemptStatus = z.infer<typeof DeliveryAttemptStatusSchema>;

export const DeliveryAttemptSchema = z.object({
  attempt_id: z.string().min(1),
  outbox_event_id: z.string().min(1),
  attempt_number: z.number().int().positive(),
  status: DeliveryAttemptStatusSchema,
  response_code: z.number().int().nullable().default(null),
  error_message: z.string().nullable().default(null),
  internal_worker_id: z.string().nullable().default(null), // private daemon worker ID
  latency_ms: z.number().nonnegative(),
  attempted_at: IsoTimestampSchema
});

export type DeliveryAttempt = z.infer<typeof DeliveryAttemptSchema>;

export const PublicDeliveryAttemptDTOSchema = DeliveryAttemptSchema.omit({
  internal_worker_id: true
});

export type PublicDeliveryAttemptDTO = z.infer<typeof PublicDeliveryAttemptDTOSchema>;

export function toPublicDeliveryAttemptDTO(attempt: DeliveryAttempt): PublicDeliveryAttemptDTO {
  const { internal_worker_id, ...publicData } = attempt;
  return PublicDeliveryAttemptDTOSchema.parse({
    ...publicData,
    error_message: redactPublicString(publicData.error_message)
  });
}
