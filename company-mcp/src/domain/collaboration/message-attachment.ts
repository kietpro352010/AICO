import { z } from "zod";
import { IsoTimestampSchema } from "../common.js";

export const MessageAttachmentSchema = z.object({
  attachment_id: z.string().min(1),
  message_id: z.string().min(1),
  file_name: z.string().min(1),
  file_path: z.string().min(1),
  file_size_bytes: z.number().int().nonnegative(),
  mime_type: z.string().min(1),
  sha256_hash: z.string().length(64, "sha256_hash must be exactly 64 hex characters"),
  storage_driver_token: z.string().nullable().default(null), // private storage credentials
  uploaded_at: IsoTimestampSchema
});

export type MessageAttachment = z.infer<typeof MessageAttachmentSchema>;

export const PublicMessageAttachmentDTOSchema = MessageAttachmentSchema.omit({
  storage_driver_token: true
});

export type PublicMessageAttachmentDTO = z.infer<typeof PublicMessageAttachmentDTOSchema>;

export function toPublicMessageAttachmentDTO(attachment: MessageAttachment): PublicMessageAttachmentDTO {
  const { storage_driver_token, ...publicData } = attachment;
  return PublicMessageAttachmentDTOSchema.parse(publicData);
}
