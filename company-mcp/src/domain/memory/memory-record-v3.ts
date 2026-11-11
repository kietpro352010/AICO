import { z } from "zod";
import { MemoryScopeSchema, MemoryCategorySchema, IsoTimestampSchema } from "../common.js";
import { noSecretText, redactPublicString } from "../sanitization.js";

export const MemoryRecordV3Schema = z.object({
  memory_id: z.string().min(1),
  owner_agent_id: z.string().nullable().default(null),
  scope: MemoryScopeSchema.default("COMPANY"),
  category: MemoryCategorySchema.default("FACT"),
  key: noSecretText(z.string().min(1).max(250), "key"),
  content: noSecretText(z.string().min(1), "content"),
  raw_context_bytes: z.string().nullable().default(null),
  access_count: z.number().int().nonnegative().default(0),
  confidence_score: z.number().min(0).max(1).default(1.0),
  created_at: IsoTimestampSchema,
  updated_at: IsoTimestampSchema
});

export type MemoryRecordV3 = z.infer<typeof MemoryRecordV3Schema>;

export const PublicMemoryRecordV3DTOSchema = MemoryRecordV3Schema.omit({
  raw_context_bytes: true
});

export type PublicMemoryRecordV3DTO = z.infer<typeof PublicMemoryRecordV3DTOSchema>;

export function toPublicMemoryRecordV3DTO(memory: MemoryRecordV3): PublicMemoryRecordV3DTO {
  const { raw_context_bytes, ...publicData } = memory;
  return PublicMemoryRecordV3DTOSchema.parse({
    ...publicData,
    key: redactPublicString(publicData.key),
    content: redactPublicString(publicData.content)
  });
}
