import { z } from "zod";
import { IsoTimestampSchema } from "../common.js";
import { noSecretText, redactPublicString } from "../sanitization.js";

export const ReviewStatusSchema = z.enum([
  "assigned",
  "in_review",
  "approved",
  "changes_requested",
  "waived"
]);
export type ReviewStatus = z.infer<typeof ReviewStatusSchema>;

export const ReviewVerdictSchema = z.enum(["pass", "fail", "conditional"]);
export type ReviewVerdict = z.infer<typeof ReviewVerdictSchema>;

export const ReviewAssignmentSchema = z.object({
  review_id: z.string().min(1),
  task_id: z.string().min(1),
  reviewer_agent_id: z.string().min(1),
  assigned_by: z.string().min(1),
  review_status: ReviewStatusSchema.default("assigned"),
  verdict: ReviewVerdictSchema.nullable().default(null),
  public_feedback: noSecretText(z.string(), "public_feedback").nullable().default(null),
  internal_reviewer_notes: z.string().nullable().default(null),
  created_at: IsoTimestampSchema,
  completed_at: IsoTimestampSchema.nullable().default(null)
});

export type ReviewAssignment = z.infer<typeof ReviewAssignmentSchema>;

export const PublicReviewAssignmentDTOSchema = ReviewAssignmentSchema.omit({
  internal_reviewer_notes: true
});

export type PublicReviewAssignmentDTO = z.infer<typeof PublicReviewAssignmentDTOSchema>;

export function toPublicReviewAssignmentDTO(review: ReviewAssignment): PublicReviewAssignmentDTO {
  const { internal_reviewer_notes, ...publicData } = review;
  return PublicReviewAssignmentDTOSchema.parse({
    ...publicData,
    public_feedback: redactPublicString(publicData.public_feedback)
  });
}
