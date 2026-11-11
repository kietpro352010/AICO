import { z } from "zod";
import { IsoTimestampSchema } from "../common.js";
import { redactPublicString } from "../sanitization.js";

export const EventSubscriptionSchema = z.object({
  subscription_id: z.string().min(1),
  subscriber_id: z.string().min(1),
  event_pattern: z.string().min(1), // e.g., 'task.*', 'approval.*'
  endpoint: z.string().min(1),
  is_active: z.boolean().default(true),
  auth_secret_hash: z.string().nullable().default(null), // private subscription webhook secret
  created_at: IsoTimestampSchema,
  updated_at: IsoTimestampSchema
});

export type EventSubscription = z.infer<typeof EventSubscriptionSchema>;

export const PublicEventSubscriptionDTOSchema = EventSubscriptionSchema.omit({
  auth_secret_hash: true
});

export type PublicEventSubscriptionDTO = z.infer<typeof PublicEventSubscriptionDTOSchema>;

export function toPublicEventSubscriptionDTO(sub: EventSubscription): PublicEventSubscriptionDTO {
  const { auth_secret_hash, ...publicData } = sub;
  return PublicEventSubscriptionDTOSchema.parse({
    ...publicData,
    endpoint: redactPublicString(publicData.endpoint)
  });
}
