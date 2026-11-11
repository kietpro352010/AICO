import { z } from "zod";
import { IsoTimestampSchema } from "../common.js";
import { noSecretText, redactPublicString, redactPublicStringArray } from "../sanitization.js";

export const KnowledgeChunkFTSSchema = z.object({
  chunk_id: z.string().min(1),
  memory_id: z.string().min(1),
  title: noSecretText(z.string().min(1).max(250), "title"),
  chunk_content: noSecretText(z.string().min(1), "chunk_content"),
  tags: z.array(noSecretText(z.string(), "tags[]")).default([]),
  embedding_vector_ref: z.string().nullable().default(null),
  created_at: IsoTimestampSchema
});

export type KnowledgeChunkFTS = z.infer<typeof KnowledgeChunkFTSSchema>;

export const PublicKnowledgeChunkFTSDTOSchema = KnowledgeChunkFTSSchema.omit({
  embedding_vector_ref: true
});

export type PublicKnowledgeChunkFTSDTO = z.infer<typeof PublicKnowledgeChunkFTSDTOSchema>;

export function toPublicKnowledgeChunkFTSDTO(chunk: KnowledgeChunkFTS): PublicKnowledgeChunkFTSDTO {
  const { embedding_vector_ref, ...publicData } = chunk;
  return PublicKnowledgeChunkFTSDTOSchema.parse({
    ...publicData,
    title: redactPublicString(publicData.title),
    chunk_content: redactPublicString(publicData.chunk_content),
    tags: redactPublicStringArray(publicData.tags)
  });
}
