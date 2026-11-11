import { z } from "zod";
import {
  RiskClassSchema,
  PrioritySchema,
  TaskExecutionStatusSchema,
  TaskDispatchStatusSchema,
  IsoTimestampSchema
} from "../common.js";
import { noSecretText, redactPublicString, redactPublicStringArray } from "../sanitization.js";

export const ProjectTaskV3Schema = z.object({
  task_id: z.string().min(1),
  project_id: z.string().min(1),
  parent_task_id: z.string().nullable().default(null),
  title: noSecretText(z.string().min(1).max(300), "title"),
  objective: noSecretText(z.string().min(1), "objective"),
  risk_class: RiskClassSchema.default("medium"),
  priority: PrioritySchema.default("medium"),
  execution_status: TaskExecutionStatusSchema.default("draft"),
  dispatch_status: TaskDispatchStatusSchema.default("not_dispatched"),
  assigned_agent_id: z.string().nullable().default(null),
  reviewer_agent_id: z.string().nullable().default(null),
  version: z.number().int().positive().default(1),
  token_budget: z.number().int().positive().default(100000),
  token_used: z.number().int().nonnegative().default(0),
  acceptance_criteria: z.array(noSecretText(z.string(), "acceptance_criteria[]")).default([]),
  internal_evaluation_notes: z.string().nullable().default(null), // private QA/eval notes
  created_at: IsoTimestampSchema,
  updated_at: IsoTimestampSchema
});

export type ProjectTaskV3 = z.infer<typeof ProjectTaskV3Schema>;

export const PublicProjectTaskV3DTOSchema = ProjectTaskV3Schema.omit({
  internal_evaluation_notes: true
});

export type PublicProjectTaskV3DTO = z.infer<typeof PublicProjectTaskV3DTOSchema>;

export function toPublicProjectTaskV3DTO(task: ProjectTaskV3): PublicProjectTaskV3DTO {
  const { internal_evaluation_notes, ...publicData } = task;
  return PublicProjectTaskV3DTOSchema.parse({
    ...publicData,
    title: redactPublicString(publicData.title),
    objective: redactPublicString(publicData.objective),
    acceptance_criteria: redactPublicStringArray(publicData.acceptance_criteria)
  });
}
