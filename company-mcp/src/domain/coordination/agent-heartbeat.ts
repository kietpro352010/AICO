import { z } from "zod";
import { IsoTimestampSchema } from "../common.js";

export const AgentLifecycleStatusSchema = z.enum(["online", "busy", "idle", "draining", "offline"]);
export type AgentLifecycleStatus = z.infer<typeof AgentLifecycleStatusSchema>;

export const AgentHeartbeatSchema = z.object({
  heartbeat_id: z.string().min(1),
  agent_id: z.string().min(1),
  status: AgentLifecycleStatusSchema,
  current_task_id: z.string().nullable().default(null),
  memory_usage_mb: z.number().nonnegative(),
  cpu_percent: z.number().min(0).max(100),
  host_process_pid: z.number().int().positive().nullable().default(null), // private runtime PID
  recorded_at: IsoTimestampSchema
});

export type AgentHeartbeat = z.infer<typeof AgentHeartbeatSchema>;

export const PublicAgentHeartbeatDTOSchema = AgentHeartbeatSchema.omit({
  host_process_pid: true
});

export type PublicAgentHeartbeatDTO = z.infer<typeof PublicAgentHeartbeatDTOSchema>;

export function toPublicAgentHeartbeatDTO(heartbeat: AgentHeartbeat): PublicAgentHeartbeatDTO {
  const { host_process_pid, ...publicData } = heartbeat;
  return PublicAgentHeartbeatDTOSchema.parse(publicData);
}
