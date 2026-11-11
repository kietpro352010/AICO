import { z } from "zod";
import { IsoTimestampSchema } from "../common.js";
import { redactPublicString } from "../sanitization.js";

export const DeadLetterQueueSchema = z.object({
  dlq_id: z.string().min(1),
  original_event_id: z.string().min(1),
  event_type: z.string().min(1),
  payload: z.record(z.string(), z.unknown()),
  failure_reason: z.string().min(1),
  stack_trace: z.string().nullable().default(null), // private debug trace
  resolved: z.boolean().default(false),
  resolved_by: z.string().nullable().default(null),
  resolved_at: IsoTimestampSchema.nullable().default(null),
  failed_at: IsoTimestampSchema
});

export type DeadLetterQueue = z.infer<typeof DeadLetterQueueSchema>;

export const PublicDeadLetterQueueDTOSchema = DeadLetterQueueSchema.omit({
  payload: true,
  stack_trace: true
});

export type PublicDeadLetterQueueDTO = z.infer<typeof PublicDeadLetterQueueDTOSchema>;

export function toPublicDeadLetterQueueDTO(dlq: DeadLetterQueue): PublicDeadLetterQueueDTO {
  const { payload, stack_trace, ...publicData } = dlq;
  return PublicDeadLetterQueueDTOSchema.parse({
    ...publicData,
    failure_reason: redactPublicString(publicData.failure_reason)
  });
}
