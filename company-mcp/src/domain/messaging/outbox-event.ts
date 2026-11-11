import { z } from "zod";
import { OutboxStatusSchema, IsoTimestampSchema } from "../common.js";
import { redactPublicString } from "../sanitization.js";

export const OutboxEventSchema = z.object({
  event_id: z.string().min(1),
  aggregate_type: z.string().min(1),
  aggregate_id: z.string().min(1),
  event_type: z.string().min(1),
  payload: z.record(z.string(), z.unknown()),
  status: OutboxStatusSchema.default("pending"),
  retry_count: z.number().int().nonnegative().default(0),
  max_retries: z.number().int().positive().default(5),
  last_error: z.string().nullable().default(null),
  internal_routing_key: z.string().nullable().default(null), // private broker routing key
  scheduled_for: IsoTimestampSchema,
  processed_at: IsoTimestampSchema.nullable().default(null),
  created_at: IsoTimestampSchema
});

export type OutboxEvent = z.infer<typeof OutboxEventSchema>;

export const PublicOutboxEventDTOSchema = OutboxEventSchema.omit({
  payload: true,
  internal_routing_key: true
});

export type PublicOutboxEventDTO = z.infer<typeof PublicOutboxEventDTOSchema>;

export function toPublicOutboxEventDTO(event: OutboxEvent): PublicOutboxEventDTO {
  const { payload, internal_routing_key, ...publicData } = event;
  return PublicOutboxEventDTOSchema.parse({
    ...publicData,
    last_error: redactPublicString(publicData.last_error)
  });
}
