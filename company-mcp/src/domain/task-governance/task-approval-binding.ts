import { z } from "zod";
import { ApprovalTierSchema, IsoTimestampSchema } from "../common.js";
import { noSecretText, redactPublicString } from "../sanitization.js";

export const ApprovalStatusSchema = z.enum(["pending", "approved", "rejected", "revoked"]);
export type ApprovalStatus = z.infer<typeof ApprovalStatusSchema>;

export const TaskApprovalBindingSchema = z.object({
  binding_id: z.string().min(1),
  task_id: z.string().min(1),
  approval_tier: ApprovalTierSchema,
  required_role: z.string().min(1),
  status: ApprovalStatusSchema.default("pending"),
  approver_principal_id: z.string().nullable().default(null),
  canonical_payload_hash: z.string().regex(/^[a-fA-F0-9]{64}$/, "Must be valid 64-character SHA-256 hash"),
  signature_nonce: z.string().min(1),
  decision_reason: noSecretText(z.string(), "decision_reason").nullable().default(null),
  decided_at: IsoTimestampSchema.nullable().default(null),
  created_at: IsoTimestampSchema
});

export type TaskApprovalBinding = z.infer<typeof TaskApprovalBindingSchema>;

export const PublicTaskApprovalBindingDTOSchema = TaskApprovalBindingSchema.omit({
  canonical_payload_hash: true,
  signature_nonce: true
});

export type PublicTaskApprovalBindingDTO = z.infer<typeof PublicTaskApprovalBindingDTOSchema>;

export function toPublicTaskApprovalBindingDTO(binding: TaskApprovalBinding): PublicTaskApprovalBindingDTO {
  const { canonical_payload_hash, signature_nonce, ...publicData } = binding;
  return PublicTaskApprovalBindingDTOSchema.parse({
    ...publicData,
    decision_reason: redactPublicString(publicData.decision_reason)
  });
}
