import { z } from "zod";
import { IsoTimestampSchema } from "../common.js";
import { noSecretText, redactPublicString } from "../sanitization.js";

export const AttestationTypeSchema = z.enum([
  "source_code",
  "test_evidence",
  "report",
  "database_dump",
  "schema_migration"
]);
export type AttestationType = z.infer<typeof AttestationTypeSchema>;

export const ArtifactAttestationSchema = z.object({
  attestation_id: z.string().min(1),
  task_id: z.string().min(1),
  artifact_path: noSecretText(z.string().min(1), "artifact_path"),
  artifact_sha256: z.string().regex(/^[a-fA-F0-9]{64}$/, "Must be valid 64-character SHA-256 hash"),
  byte_size: z.number().int().nonnegative(),
  attested_by_agent_id: z.string().min(1),
  attestation_type: AttestationTypeSchema,
  verification_signature: z.string().min(1),
  internal_audit_trail: z.string().nullable().default(null),
  created_at: IsoTimestampSchema
});

export type ArtifactAttestation = z.infer<typeof ArtifactAttestationSchema>;

export const PublicArtifactAttestationDTOSchema = ArtifactAttestationSchema.omit({
  verification_signature: true,
  internal_audit_trail: true
});

export type PublicArtifactAttestationDTO = z.infer<typeof PublicArtifactAttestationDTOSchema>;

export function toPublicArtifactAttestationDTO(attestation: ArtifactAttestation): PublicArtifactAttestationDTO {
  const { verification_signature, internal_audit_trail, ...publicData } = attestation;
  return PublicArtifactAttestationDTOSchema.parse({
    ...publicData,
    artifact_path: redactPublicString(publicData.artifact_path)
  });
}
