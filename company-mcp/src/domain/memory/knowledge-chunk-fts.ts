import { z } from "zod";
import { IsoTimestampSchema } from "../common.js";

export const KnowledgeChunkFTSSchema = z.object({
  chunk_id: z.string().min(1),
  memory_id: z.string().min(1),
  title: z.string().min(1).max(250),
  chunk_content: z.string().min(1),
  tags: z.array(z.string()).default([]),
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
  return PublicKnowledgeChunkFTSDTOSchema.parse(publicData);
}
