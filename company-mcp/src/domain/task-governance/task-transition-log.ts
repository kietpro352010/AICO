import { z } from "zod";
import {
  TaskExecutionStatusSchema,
  TaskDispatchStatusSchema,
  IsoTimestampSchema
} from "../common.js";
import { noSecretText, redactPublicString } from "../sanitization.js";

export const TaskTransitionLogSchema = z.object({
  transition_id: z.string().min(1),
  task_id: z.string().min(1),
  transition_seq: z.number().int().positive(),
  from_execution_status: TaskExecutionStatusSchema,
  to_execution_status: TaskExecutionStatusSchema,
  from_dispatch_status: TaskDispatchStatusSchema,
  to_dispatch_status: TaskDispatchStatusSchema,
  transition_code: z.string().min(1),
  triggered_by: z.string().min(1),
  reason: noSecretText(z.string().min(1), "reason"),
  internal_diagnostic_payload: z.string().nullable().default(null),
  created_at: IsoTimestampSchema
});

export type TaskTransitionLog = z.infer<typeof TaskTransitionLogSchema>;

export const PublicTaskTransitionLogDTOSchema = TaskTransitionLogSchema.omit({
  internal_diagnostic_payload: true
});

export type PublicTaskTransitionLogDTO = z.infer<typeof PublicTaskTransitionLogDTOSchema>;

export function toPublicTaskTransitionLogDTO(log: TaskTransitionLog): PublicTaskTransitionLogDTO {
  const { internal_diagnostic_payload, ...publicData } = log;
  return PublicTaskTransitionLogDTOSchema.parse({
    ...publicData,
    reason: redactPublicString(publicData.reason)
  });
}
