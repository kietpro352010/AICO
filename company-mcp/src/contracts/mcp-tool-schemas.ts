import { z } from "zod";

// Shared Enums & Constants
export const PrincipalIdSchema = z.enum([
  "founder-01",
  "chatgpt-01",
  "flash-01",
  "flash-02",
  "codex-01",
  "argon-01",
  "argon-02"
]);

export const AgentIdSchema = z.enum([
  "chatgpt-01",
  "flash-01",
  "flash-02",
  "codex-01",
  "argon-01",
  "argon-02"
]);

// M01: company_ping
export const CompanyPingInputSchema = z.object({
  message: z.string().default("Hello AICO")
});

export const CompanyPingOutputSchema = z.object({
  success: z.boolean(),
  server: z.string(),
  version: z.string(),
  received: z.string(),
  timestamp: z.string()
});

// M02: company_get_info
export const CompanyGetInfoInputSchema = z.object({});

export const CompanyGetInfoOutputSchema = z.object({
  company_name: z.string(),
  full_name: z.string(),
  version: z.string(),
  operating_mode: z.string(),
  principal_agents: z.number(),
  quota_pools: z.number(),
  current_stage: z.string(),
  timestamp: z.string(),
  storage_mode: z.string().optional()
});

// M03: company_list_agents
export const CompanyListAgentsInputSchema = z.object({});

export const PublicAgentViewSchema = z.object({
  agent_id: z.string(),
  name: z.string(),
  model: z.string(),
  platform: z.string(),
  role: z.string(),
  department: z.string(),
  status: z.string(),
  capabilities: z.array(z.string()),
  invocation_policy: z.object({
    mode: z.string(),
    auto_invoke: z.boolean(),
    requires_approval: z.boolean(),
    quota_class: z.string()
  }),
  resource_policy: z.object({
    usage_tier: z.string().optional(),
    routing_priority: z.number().optional(),
    quota_pool: z.string().optional()
  }).optional(),
  reasoning: z.object({
    target_level: z.string().optional(),
    model_verified: z.boolean().optional(),
    reasoning_verified: z.boolean().optional()
  }).optional(),
  last_seen_at: z.string().nullable().optional()
});

export const CompanyListAgentsOutputSchema = z.object({
  success: z.boolean(),
  count: z.number(),
  agents: z.array(PublicAgentViewSchema)
});

// M04: company_get_agent
export const CompanyGetAgentInputSchema = z.object({
  agent_id: z.string().min(1)
});

export const CompanyGetAgentOutputSchema = z.object({
  success: z.boolean(),
  agent: PublicAgentViewSchema
});

// M05: company_list_quota_pools
export const CompanyListQuotaPoolsInputSchema = z.object({});

export const QuotaPoolViewSchema = z.object({
  pool_id: z.string(),
  provider: z.string(),
  account_label: z.string(),
  notes: z.string().nullable().optional(),
  agent_count: z.number().optional(),
  agent_ids: z.string().optional()
});

export const CompanyListQuotaPoolsOutputSchema = z.object({
  success: z.boolean(),
  count: z.number(),
  quota_pools: z.array(QuotaPoolViewSchema)
});

// M06: company_get_manifest
export const CompanyGetManifestInputSchema = z.object({});

export const PublicManifestViewSchema = z.object({
  manifest_version: z.string(),
  company_name: z.string(),
  operating_mode: z.string(),
  agent_count: z.number(),
  quota_pool_count: z.number(),
  timestamp: z.string()
});

// M07: company_get_my_identity
export const CompanyGetMyIdentityInputSchema = z.object({});

export const CallerIdentityViewSchema = z.object({
  success: z.boolean(),
  principal_id: z.string(),
  principal_type: z.enum(["human", "agent", "service"]),
  display_name: z.string(),
  scopes: z.array(z.string()),
  allow_public_gateway: z.boolean(),
  authenticated_at: z.string()
});

// M08: company_check_permission
export const CompanyCheckPermissionInputSchema = z.object({
  required_scope: z.string().min(1),
  resource_id: z.string().optional()
});

export const PermissionCheckViewSchema = z.object({
  allowed: z.boolean(),
  principal_id: z.string(),
  scope_evaluated: z.string(),
  reason: z.string().optional()
});

// M09: company_list_credentials (Local/STDIO only)
export const CompanyListCredentialsInputSchema = z.object({
  principal_id: z.string().optional()
});

export const CredentialMetadataSchema = z.object({
  credential_id: z.string(),
  principal_id: z.string(),
  key_prefix: z.string(),
  status: z.string(),
  expires_at: z.string(),
  last_used_at: z.string().nullable().optional()
});

export const CompanyListCredentialsOutputSchema = z.object({
  success: z.boolean(),
  count: z.number(),
  credentials: z.array(CredentialMetadataSchema)
});

// M10: company_issue_credential (Local/STDIO only)
export const CompanyIssueCredentialInputSchema = z.object({
  principal_id: z.string().min(1),
  scopes: z.array(z.string()).default([]),
  allow_public_gateway: z.boolean().default(false),
  expires_in_days: z.number().default(90)
});

export const CredentialIssueOutputSchema = z.object({
  success: z.boolean(),
  credential_id: z.string(),
  key_prefix: z.string(),
  raw_token_display_once: z.string(),
  expires_at: z.string()
});

// M11: company_rotate_credential (Local/STDIO only)
export const CompanyRotateCredentialInputSchema = z.object({
  old_credential_id: z.string().min(1),
  expires_in_days: z.number().default(90)
});

export const CredentialRotateOutputSchema = z.object({
  success: z.boolean(),
  new_credential_id: z.string(),
  old_credential_id: z.string(),
  key_prefix: z.string(),
  raw_token_display_once: z.string(),
  expires_at: z.string()
});

// M12: company_revoke_credential (Local/STDIO only)
export const CompanyRevokeCredentialInputSchema = z.object({
  credential_id: z.string().min(1),
  reason: z.string().optional()
});

export const CredentialRevokeOutputSchema = z.object({
  success: z.boolean(),
  credential_id: z.string(),
  status: z.literal("revoked"),
  revoked_at: z.string()
});

// M13: company_request_approval
export const ApprovalRequestCreateInputSchema = z.object({
  action_type: z.string().min(1),
  requested_by: z.string().min(1),
  required_approver: z.string().default("founder-01"),
  canonical_payload: z.record(z.string(), z.any()),
  expires_in_hours: z.number().default(24)
});

export const ApprovalRequestCreatedViewSchema = z.object({
  success: z.boolean(),
  approval_id: z.string(),
  action_type: z.string(),
  requested_by: z.string(),
  required_approver: z.string(),
  payload_hash_sha256: z.string(),
  status: z.string(),
  expires_at: z.string()
});

// M14: company_list_approval_requests
export const CompanyListApprovalRequestsInputSchema = z.object({
  status: z.string().optional(),
  action_type: z.string().optional()
});

export const CompanyListApprovalRequestsOutputSchema = z.object({
  success: z.boolean(),
  count: z.number(),
  approvals: z.array(ApprovalRequestCreatedViewSchema)
});

// M15: company_get_approval_request
export const CompanyGetApprovalRequestInputSchema = z.object({
  approval_id: z.string().min(1)
});

export const CompanyGetApprovalRequestOutputSchema = z.object({
  success: z.boolean(),
  approval: ApprovalRequestCreatedViewSchema
});

// M16: company_decide_approval (Local/STDIO only)
export const CompanyDecideApprovalInputSchema = z.object({
  approval_id: z.string().min(1),
  decision: z.enum(["approved", "rejected"]),
  reason: z.string().optional()
});

export const CompanyDecideApprovalOutputSchema = z.object({
  success: z.boolean(),
  approval_id: z.string(),
  decision: z.string(),
  decided_by: z.string(),
  decided_at: z.string()
});

// M17: company_get_workspace
export const CompanyGetWorkspaceInputSchema = z.object({
  target_agent_id: z.string().optional()
});

export const WorkspaceViewSchema = z.object({
  success: z.boolean(),
  agent_id: z.string(),
  workspace_mode: z.string(),
  allowed_relative_paths: z.array(z.string())
});

// M18: company_list_workspace_files
export const CompanyListWorkspaceFilesInputSchema = z.object({
  subpath: z.string().optional().default(""),
  target_agent_id: z.string().optional()
});

export const WorkspaceFileEntrySchema = z.object({
  name: z.string(),
  size_bytes: z.number(),
  is_directory: z.boolean(),
  modified_at: z.string()
});

export const CompanyListWorkspaceFilesOutputSchema = z.object({
  success: z.boolean(),
  relative_dir: z.string(),
  files: z.array(WorkspaceFileEntrySchema)
});

// M19: company_read_workspace_file
export const CompanyReadWorkspaceFileInputSchema = z.object({
  relative_path: z.string().min(1),
  target_agent_id: z.string().optional()
});

export const WorkspaceFileContentSchema = z.object({
  success: z.boolean(),
  relative_path: z.string(),
  content: z.string(),
  encoding: z.enum(["utf8", "base64"]),
  checksum_sha256: z.string()
});

// M20: company_write_workspace_file
export const CompanyWriteWorkspaceFileInputSchema = z.object({
  relative_path: z.string().min(1),
  content: z.string(),
  overwrite: z.boolean().default(true)
});

export const WorkspaceWriteResultSchema = z.object({
  success: z.boolean(),
  relative_path: z.string(),
  bytes_written: z.number(),
  checksum_sha256: z.string()
});

// M21: company_share_workspace_artifact
export const CompanyShareWorkspaceArtifactInputSchema = z.object({
  source_relative_path: z.string().min(1),
  to_agent_id: z.string().min(1),
  task_id: z.string().optional(),
  description: z.string().optional()
});

export const ArtifactShareResultSchema = z.object({
  success: z.boolean(),
  artifact_id: z.string(),
  checksum_sha256: z.string(),
  recipient_inbox_ref: z.string()
});

// M22: company_get_workspace_activity (Local/STDIO only)
export const CompanyGetWorkspaceActivityInputSchema = z.object({
  agent_id: z.string().optional(),
  limit: z.number().default(50)
});

export const WorkspaceActivityItemSchema = z.object({
  activity_id: z.string(),
  agent_id: z.string(),
  action_type: z.string(),
  path_accessed: z.string(),
  status: z.string(),
  created_at: z.string()
});

export const CompanyGetWorkspaceActivityOutputSchema = z.object({
  success: z.boolean(),
  count: z.number(),
  activities: z.array(WorkspaceActivityItemSchema)
});

// M23: company_git_sync_branch (Local/STDIO only)
export const CompanyGitSyncBranchInputSchema = z.object({
  branch_name: z.string().min(1),
  direction: z.enum(["pull_master", "push_agent_branch"])
});

export const GitSyncResultSchema = z.object({
  success: z.boolean(),
  branch_name: z.string(),
  direction: z.string(),
  commit_sha: z.string(),
  status: z.string()
});

// M24: company_create_project
export const CompanyCreateProjectInputSchema = z.object({
  project_id: z.string().min(1),
  name: z.string().min(1),
  description: z.string().optional(),
  approval_request_id: z.string().optional()
});

export const ProjectViewSchema = z.object({
  success: z.boolean(),
  project_id: z.string(),
  name: z.string(),
  status: z.string(),
  created_at: z.string()
});

// M25: company_list_projects
export const CompanyListProjectsInputSchema = z.object({
  status: z.string().optional()
});

export const CompanyListProjectsOutputSchema = z.object({
  success: z.boolean(),
  count: z.number(),
  projects: z.array(ProjectViewSchema)
});

// M26: company_create_task
export const CompanyCreateTaskInputSchema = z.object({
  task_id: z.string().min(1),
  project_id: z.string().min(1),
  title: z.string().min(1),
  assigned_agent_id: z.string().optional(),
  idempotency_key: z.string().optional(),
  risk_class: z.enum(["low", "medium", "high", "critical"]).default("low")
});

export const TaskViewSchema = z.object({
  success: z.boolean(),
  task_id: z.string(),
  project_id: z.string(),
  title: z.string(),
  execution_status: z.string(),
  dispatch_status: z.string(),
  assigned_agent_id: z.string().nullable().optional(),
  version: z.number()
});

// M27: company_list_tasks
export const CompanyListTasksInputSchema = z.object({
  project_id: z.string().optional(),
  assigned_agent_id: z.string().optional(),
  execution_status: z.string().optional()
});

export const CompanyListTasksOutputSchema = z.object({
  success: z.boolean(),
  count: z.number(),
  tasks: z.array(TaskViewSchema)
});

// M28: company_get_task
export const CompanyGetTaskInputSchema = z.object({
  task_id: z.string().min(1)
});

export const CompanyGetTaskOutputSchema = z.object({
  success: z.boolean(),
  task: TaskViewSchema
});

// M29: company_claim_task
export const CompanyClaimTaskInputSchema = z.object({
  task_id: z.string().min(1),
  expected_version: z.number()
});

export const TaskClaimResultSchema = z.object({
  success: z.boolean(),
  task_id: z.string(),
  execution_status: z.literal("claimed"),
  lease_expires_at: z.string(),
  version: z.number()
});

// M30: company_heartbeat_task
export const CompanyHeartbeatTaskInputSchema = z.object({
  task_id: z.string().min(1)
});

export const TaskHeartbeatResultSchema = z.object({
  success: z.boolean(),
  task_id: z.string(),
  lease_expires_at: z.string()
});

// M31: company_transition_task
export const CompanyTransitionTaskInputSchema = z.object({
  task_id: z.string().min(1),
  to_status: z.string().min(1),
  expected_version: z.number(),
  reason: z.string().optional(),
  approval_request_id: z.string().optional()
});

export const TaskTransitionResultSchema = z.object({
  success: z.boolean(),
  task_id: z.string(),
  execution_status: z.string(),
  version: z.number()
});

// M32: company_submit_task_result
export const CompanySubmitTaskResultInputSchema = z.object({
  task_id: z.string().min(1),
  expected_version: z.number(),
  summary: z.string().min(1),
  output_artifact_ids: z.array(z.string()).optional()
});

export const TaskSubmitResultSchema = z.object({
  success: z.boolean(),
  task_id: z.string(),
  execution_status: z.literal("review_required"),
  dispatch_status: z.literal("result_received"),
  version: z.number()
});

// M33: company_review_task (Local/STDIO only)
export const CompanyReviewTaskInputSchema = z.object({
  task_id: z.string().min(1),
  decision: z.enum(["completed", "rework"]),
  reason: z.string().optional()
});

export const TaskReviewResultSchema = z.object({
  success: z.boolean(),
  task_id: z.string(),
  execution_status: z.string(),
  version: z.number()
});

// M34: company_record_external_dispatch (Local/STDIO only)
export const CompanyRecordExternalDispatchInputSchema = z.object({
  task_id: z.string().min(1),
  milestone: z.enum([
    "operator_delivered",
    "external_invocation_confirmed",
    "delivery_failed"
  ]),
  notes: z.string().optional()
});

export const ExternalDispatchResultSchema = z.object({
  success: z.boolean(),
  task_id: z.string(),
  milestone: z.string(),
  dispatch_status: z.string(),
  recorded_at: z.string()
});

// M35: company_send_message
export const CompanySendMessageInputSchema = z.object({
  to_principal_id: z.string().min(1),
  subject: z.string().min(1),
  body_markdown: z.string().min(1),
  thread_id: z.string().optional(),
  task_id: z.string().optional(),
  priority: z.enum(["low", "normal", "urgent"]).default("normal")
});

export const MessageViewSchema = z.object({
  success: z.boolean(),
  message_id: z.string(),
  from_principal_id: z.string(),
  to_principal_id: z.string(),
  subject: z.string(),
  body_markdown: z.string(),
  thread_id: z.string().optional(),
  task_id: z.string().optional(),
  delivery_status: z.string(),
  created_at: z.string()
});

// M36: company_list_inbox
export const CompanyListInboxInputSchema = z.object({});

export const CompanyListInboxOutputSchema = z.object({
  success: z.boolean(),
  count: z.number(),
  messages: z.array(MessageViewSchema)
});

// M37: company_ack_message
export const CompanyAckMessageInputSchema = z.object({
  message_id: z.string().min(1)
});

export const MessageAckOutputSchema = z.object({
  success: z.boolean(),
  message_id: z.string(),
  recipient_id: z.string(),
  delivery_status: z.literal("acknowledged"),
  acknowledged_at: z.string()
});

// M38: company_knowledge_memory_ops
export const CompanyKnowledgeMemoryOpsInputSchema = z.discriminatedUnion("operation", [
  z.object({
    operation: z.literal("search_knowledge"),
    query: z.string().min(1),
    limit: z.number().default(10)
  }),
  z.object({
    operation: z.literal("get_knowledge_doc"),
    doc_id: z.string().min(1)
  }),
  z.object({
    operation: z.literal("propose_knowledge_change"),
    doc_id: z.string().min(1),
    proposed_markdown: z.string().min(1),
    rationale: z.string().min(1)
  }),
  z.object({
    operation: z.literal("approve_knowledge_proposal"),
    proposal_id: z.string().min(1),
    decision: z.enum(["approved", "rejected"])
  }),
  z.object({
    operation: z.literal("search_memory"),
    query: z.string().min(1),
    scope: z.enum(["company", "project", "task_context", "agent_private"]).optional(),
    limit: z.number().default(10)
  }),
  z.object({
    operation: z.literal("write_memory"),
    scope: z.enum(["company", "project", "task_context", "agent_private"]),
    content: z.string().min(1),
    project_id: z.string().optional(),
    task_id: z.string().optional()
  }),
  z.object({
    operation: z.literal("record_model_usage"),
    model_name: z.string().min(1),
    prompt_tokens: z.number().optional(),
    completion_tokens: z.number().optional()
  }),
  z.object({
    operation: z.literal("get_system_observability")
  })
]);

export const CompanyKnowledgeMemoryOpsOutputSchema = z.object({
  success: z.boolean(),
  operation: z.string(),
  result: z.any()
});
