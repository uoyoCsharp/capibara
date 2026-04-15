import { z } from 'zod';

// ─── IPC Channel Definitions ────────────────────────────────────────
export const IPC_CHANNELS = {
  // Global
  loadSnapshot: 'capibara:snapshot:load',
  rendererEvent: 'capibara:event',

  // Organization
  getOrganizations: 'capibara:org:get-all',
  getOrganization: 'capibara:org:get',
  createOrganization: 'capibara:org:create',
  updateOrganization: 'capibara:org:update',
  deleteOrganization: 'capibara:org:delete',

  // Roles
  getRolesByOrgId: 'capibara:role:get-by-org',
  getRole: 'capibara:role:get',
  createRole: 'capibara:role:create',
  updateRole: 'capibara:role:update',
  deleteRole: 'capibara:role:delete',

  // Skills
  getSkills: 'capibara:skill:get-all',
  getSkill: 'capibara:skill:get',
  createSkill: 'capibara:skill:create',
  updateSkill: 'capibara:skill:update',
  deleteSkill: 'capibara:skill:delete',
  searchSkills: 'capibara:skill:search',

  // Dialogs
  selectFolder: 'capibara:dialog:select-folder',

  // Shell
  openFolder: 'capibara:shell:open-folder',

  // Templates
  getTemplates: 'capibara:template:get-all',
  loadTemplate: 'capibara:template:load',

  // Tasks
  getTasksByOrgId: 'capibara:task:get-by-org',
  getTask: 'capibara:task:get',
  getTaskChildren: 'capibara:task:get-children',
  createTask: 'capibara:task:create',
  updateTaskStatus: 'capibara:task:update-status',
  deleteTask: 'capibara:task:delete',

  // Discussion
  getDiscussionGroupsByOrgId: 'capibara:discussion:get-by-org',
  getDiscussionGroupByTaskNodeId: 'capibara:discussion:get-by-task',
  getDiscussionMessages: 'capibara:discussion:get-messages',
  getDiscussionVoteStats: 'capibara:discussion:get-vote-stats',
  postDiscussionMessage: 'capibara:discussion:post-message',
  getDiscussionSummary: 'capibara:discussion:get-summary',

  // Narrative
  getNarrative: 'capibara:narrative:get',
  generateNarrative: 'capibara:narrative:generate',
  getApprovalSummary: 'capibara:narrative:approval-summary',

  // Cost
  getCostSummary: 'capibara:cost:get-summary',
  getCostEntries: 'capibara:cost:get-entries',

  // Approval
  applyApprovalPreset: 'capibara:approval:apply-preset',
  getPendingApprovals: 'capibara:approval:get-pending',

  // Budget
  resumeOrgRoles: 'capibara:budget:resume-roles',

  // Runs
  getRunsByOrgId: 'capibara:run:get-by-org',
  getRun: 'capibara:run:get',
  getRunsByTaskId: 'capibara:run:get-by-task',
  getRunLog: 'capibara:run:get-log',
  openRunLogFolder: 'capibara:run:open-log-folder',
  startRun: 'capibara:run:start',
  cancelRun: 'capibara:run:cancel',

  // Settings
  getSetting: 'capibara:settings:get',
  updateSetting: 'capibara:settings:update',
  getLocale: 'capibara:settings:get-locale',

  // Workflow Schema
  getActiveSchema: 'capibara:schema:get-active',
  saveSchema: 'capibara:schema:save',
  validateSchema: 'capibara:schema:validate',
  schemaImpactAnalysis: 'capibara:schema:impact-analysis',
  getWorkflowTemplates: 'capibara:schema:get-workflow-templates',

  // System
  checkSystemDeps: 'capibara:system:check-deps',

  // Session
  openSessionLogFolder: 'capibara:session:open-log-folder',
  startSession: 'capibara:session:start',
  sendSessionMessage: 'capibara:session:send-message',
  getActiveSession: 'capibara:session:get-active',
  getSessionMessages: 'capibara:session:get-messages',
  cancelSession: 'capibara:session:cancel',
  switchSessionRole: 'capibara:session:switch-role',

  // Planning
  startPlanningRun: 'capibara:planning:start',
  getActivePlanningSession: 'capibara:planning:get-active',
  discardPlanningSession: 'capibara:planning:discard',
  getPendingPlan: 'capibara:planning:get-pending-plan',
  batchCreateTasks: 'capibara:planning:batch-create',
  getAvailablePlanningRoles: 'capibara:planning:get-roles',
  switchPlanningRole: 'capibara:planning:switch-role',

  // Conversation
  getActiveConversations: 'capibara:conversation:list-active',
  getGroupedConversations: 'capibara:conversation:list-grouped',
  getConversationHistory: 'capibara:conversation:get-history',
  cancelConversation: 'capibara:conversation:cancel',
  resolveConversation: 'capibara:conversation:resolve',
  getConversationMetrics: 'capibara:conversation:get-metrics',
  getConversationEvents: 'capibara:conversation:get-events',
  getConversationAnalytics: 'capibara:conversation:get-analytics',
  replyToConversation: 'capibara:conversation:reply',
  getResolvedConversations: 'capibara:conversation:list-resolved',
} as const;

// ─── IPC Response Wrapper ───────────────────────────────────────────
export type DesktopResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: { code: string; message: string } };

// ─── Desktop Events (Main → Renderer) ──────────────────────────────
export type DesktopEvent =
  | { type: 'snapshot:updated' }
  | { type: 'org:changed'; orgId: string }
  | { type: 'role:changed'; orgId: string }
  | { type: 'skill:changed' }
  | { type: 'task:changed'; orgId: string }
  | { type: 'discussion:changed'; orgId: string }
  | { type: 'discussion:message-added'; groupId: string }
  | { type: 'run:changed'; orgId: string }
  | { type: 'run:log'; runId: string; stream: 'stdout' | 'stderr'; chunk: string }
  | { type: 'run:assistant-text'; runId: string; text: string }
  | { type: 'run:status'; runId: string; status: string }
  | { type: 'run:output'; runId: string; chunk: string }
  | { type: 'run:completed'; runId: string; orgId: string; taskNodeId: string | null; roleId: string; status: 'succeeded' | 'failed' | 'cancelled'; tokenCount: number }
  | { type: 'notification'; title: string; body: string }
  | { type: 'approval:required'; taskId: string; taskTitle: string; orgId: string; roleId: string; roleName: string; groupId: string }
  | { type: 'budget:roles-paused'; orgId: string; totalTokens: number; budgetLimit: number }
  | { type: 'settings:locale-changed'; locale: string }
  | { type: 'schema:updated'; orgId: string }
  | { type: 'conversation:question-posted'; orgId: string; workflowId: string; askingRoleName: string; questionPreview: string; urgency: 'normal' | 'urgent'; respondentType: 'ai' | 'human' }
  | { type: 'conversation:resolved'; orgId: string; workflowId: string }
  | { type: 'conversation:cancelled'; orgId: string; workflowId: string }
  | { type: 'conversation:timed-out'; orgId: string; workflowId: string }
  | { type: 'conversation:escalated'; orgId: string; workflowId: string }
  | { type: 'conversation:reply-posted'; orgId: string; workflowId: string }
  | { type: 'discussion-summary:updated'; groupId: string; summary: string }
  | { type: 'planning:plan-ready'; orgId: string; taskCount: number }
  | { type: 'session:message-added'; sessionId: string; authorType: 'human' | 'ai' | 'system' }
  | { type: 'session:run-completed'; sessionId: string; status: string }
  | { type: 'session:completed'; sessionId: string; orgId: string }
  | { type: 'session:cancelled'; sessionId: string; orgId: string };

// ─── Zod Schemas for IPC Payload Validation ─────────────────────────
export const createOrganizationSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(500).default(''),
  customInstructions: z.string().max(5000).default(''),
  budgetLimit: z.number().min(0).default(50.0),
  orgTemplateId: z.string().nullable().default(null),
  workflowTemplateId: z.string().nullable().default(null),
  workspacePath: z.string().min(1),
});

export const updateOrganizationSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1).max(100).optional(),
  description: z.string().max(500).optional(),
  customInstructions: z.string().max(5000).optional(),
  status: z.enum(['active', 'paused', 'archived']).optional(),
  budgetLimit: z.number().min(0).optional(),
  workspacePath: z.string().min(1).optional(),
});

export const deleteOrganizationSchema = z.object({
  orgId: z.string().min(1),
  confirmName: z.string().min(1),
});

export const createRoleSchema = z.object({
  orgId: z.string().min(1),
  name: z.string().min(1).max(100),
  parentId: z.string().nullable().default(null),
  persona: z.string().max(5000).default(''),
  knowledgeBaseRefs: z.array(z.string()).default([]),
  skillIds: z.array(z.string()).default([]),
  canApprove: z.boolean().default(false),
  canDelegate: z.boolean().default(false),
  requiresHumanApproval: z.boolean().default(false),
});

export const updateRoleSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1).max(100).optional(),
  persona: z.string().max(5000).optional(),
  knowledgeBaseRefs: z.array(z.string()).optional(),
  skillIds: z.array(z.string()).optional(),
  canApprove: z.boolean().optional(),
  canDelegate: z.boolean().optional(),
  requiresHumanApproval: z.boolean().optional(),
  status: z.enum(['active', 'paused', 'idle']).optional(),
});

export const createSkillSchema = z.object({
  name: z.string().min(1).max(100),
  command: z.string().min(1).max(200),
  description: z.string().max(2000).default(''),
  category: z.enum(['analysis', 'design', 'implementation', 'review', 'test', 'general']),
  source: z.enum(['builtin', 'template', 'custom']).default('custom'),
  orgTemplateId: z.string().nullable().default(null),
  customPromptContent: z.string().nullable().default(null),
});

export const updateSkillSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1).max(100).optional(),
  command: z.string().min(1).max(200).optional(),
  description: z.string().max(2000).optional(),
  category: z.enum(['analysis', 'design', 'implementation', 'review', 'test', 'general']).optional(),
  customPromptContent: z.string().nullable().optional(),
});

export const searchSkillsSchema = z.object({
  query: z.string().default(''),
  category: z.enum(['analysis', 'design', 'implementation', 'review', 'test', 'general']).nullable().default(null),
  source: z.enum(['builtin', 'template', 'custom']).nullable().default(null),
});

export const loadTemplateSchema = z.object({
  templateId: z.string().min(1),
  orgName: z.string().min(1).max(100),
  orgDescription: z.string().max(500).default(''),
  budgetLimit: z.number().min(0).default(50.0),
  workspacePath: z.string().min(1),
  workflowTemplateId: z.string().nullable().default(null),
});

export const createTaskSchema = z.object({
  orgId: z.string().min(1),
  parentId: z.string().nullable().default(null),
  type: z.string().min(1),
  title: z.string().min(1).max(300),
  description: z.string().max(10000).default(''),
  assigneeRoleId: z.string().nullable().default(null),
});

export const updateTaskStatusSchema = z.object({
  id: z.string().min(1),
  status: z.string().min(1),
});

export const postDiscussionMessageSchema = z.object({
  groupId: z.string().min(1),
  authorRoleId: z.string().nullable().default(null),
  authorType: z.enum(['ai', 'human', 'system']),
  content: z.string().min(1).max(50000),
  voteTag: z.enum(['APPROVE', 'REVISE', 'CONCERN', 'DELEGATE']).nullable().default(null),
  metadata: z.record(z.unknown()).nullable().optional(),
  intent: z.enum(['question', 'reply', 'escalation', 'resolution', 'vote', 'general']).optional(),
  inReplyToMessageId: z.string().nullable().optional(),
});

export const applyApprovalPresetSchema = z.object({
  orgId: z.string().min(1),
  preset: z.enum(['all_auto', 'top_level_human', 'custom']),
});

export const getRunLogSchema = z.object({
  runId: z.string().min(1),
  mode: z.enum(['parsed', 'raw']),
  offset: z.number().int().min(0).default(0),
  limit: z.number().int().min(1).max(2000).default(500),
});

export const startRunSchema = z.object({
  orgId: z.string().min(1),
  taskNodeId: z.string().min(1),
  roleId: z.string().min(1),
  trigger: z.enum([
    'task_assigned', 'task_completed', 'review_approve', 'review_revise',
    'review_delegate', 'delegation_completed', 'retry_failed', 'dispute_detected',
    'discussion_reply', 'conversation_escalation',
  ]).default('task_assigned'),
});

export const updateSettingSchema = z.object({
  key: z.string().min(1),
  value: z.string(),
});

export const cancelConversationSchema = z.object({
  workflowId: z.string().min(1),
});

export const resolveConversationSchema = z.object({
  conversationWorkflowId: z.string().min(1),
});

export const replyToConversationSchema = z.object({
  workflowId: z.string().min(1),
  content: z.string().min(1).max(50000),
});

// ─── Session Zod Schemas ─────────────────────────────────────────────
export const startSessionSchema = z.object({
  orgId: z.string().min(1),
  type: z.enum(['planning', 'adhoc']),
  roleId: z.string().min(1),
  initialMessage: z.string().min(1).max(10000),
});

export const sendSessionMessageSchema = z.object({
  sessionId: z.string().min(1),
  message: z.string().min(1).max(10000),
});

export const cancelSessionSchema = z.object({
  sessionId: z.string().min(1),
});

export const switchSessionRoleSchema = z.object({
  sessionId: z.string().min(1),
  newRoleId: z.string().min(1),
});

export type StartSessionInput = z.infer<typeof startSessionSchema>;
export type SendSessionMessageInput = z.infer<typeof sendSessionMessageSchema>;
export type CancelSessionInput = z.infer<typeof cancelSessionSchema>;
export type SwitchSessionRoleInput = z.infer<typeof switchSessionRoleSchema>;

// ─── Planning Zod Schemas ────────────────────────────────────────────
export const startPlanningRunSchema = z.object({
  orgId: z.string().min(1),
  initialMessage: z.string().min(1).max(10000),
  roleId: z.string().min(1).optional(),
});

export const discardPlanningSessionSchema = z.object({
  /** Accepts either a sessionId or legacy taskId */
  id: z.string().min(1),
});

export const switchPlanningRoleSchema = z.object({
  sessionId: z.string().min(1),
  newRoleId: z.string().min(1),
});

const planTaskNodeSchema: z.ZodType<PlanTaskNode> = z.lazy(() =>
  z.object({
    title: z.string().min(1),
    type: z.string().min(1),
    description: z.string(),
    assigneeRoleName: z.string().nullable(),
    children: z.array(planTaskNodeSchema),
  }),
) as z.ZodType<PlanTaskNode>;

export const batchCreateTasksSchema = z.object({
  orgId: z.string().min(1),
  plan: z.object({
    summary: z.string(),
    tasks: z.array(planTaskNodeSchema).min(1),
  }),
});

export type StartPlanningRunInput = z.infer<typeof startPlanningRunSchema>;
export type DiscardPlanningSessionInput = z.infer<typeof discardPlanningSessionSchema>;
export type SwitchPlanningRoleInput = z.infer<typeof switchPlanningRoleSchema>;
export type BatchCreateTasksInput = z.infer<typeof batchCreateTasksSchema>;

// ─── Workflow Schema Zod Schemas ─────────────────────────────────────
export const saveSchemaSchema = z.object({
  orgId: z.string().min(1),
  schema: z.object({
    workItemTypes: z.array(z.object({
      name: z.string().min(1).regex(/^[a-z][a-z0-9]*(-[a-z0-9]+)*$/, 'Type name must be kebab-case'),
      label: z.string().min(1),
      icon: z.string().optional(),
      color: z.string().optional(),
      isLeaf: z.boolean(),
      allowedChildren: z.array(z.string()),
      allowedAtRoot: z.boolean(),
      canDecompose: z.boolean(),
      hasDiscussionGroup: z.boolean(),
    })),
    statuses: z.array(z.object({
      name: z.string().min(1),
      label: z.string().min(1),
      category: z.enum(['initial', 'active', 'review', 'terminal']),
    })),
    transitions: z.array(z.object({
      from: z.string().min(1),
      to: z.string().min(1),
      trigger: z.enum(['manual', 'auto', 'system']),
    })),
    behaviorRules: z.array(z.object({
      id: z.string().min(1),
      name: z.string().min(1),
      priority: z.number().int(),
      trigger: z.discriminatedUnion('type', [
        z.object({ type: z.literal('on_status_enter'), status: z.string().min(1) }),
        z.object({ type: z.literal('on_task_created') }),
        z.object({ type: z.literal('on_all_children_terminal') }),
        z.object({ type: z.literal('on_children_of_type_terminal'), childTypes: z.array(z.string().min(1)) }),
      ]),
      condition: z.object({ type: z.string().min(1) }).passthrough(),
      action: z.discriminatedUnion('type', [
        z.object({ type: z.literal('auto_transition'), targetStatus: z.string().min(1) }),
        z.object({ type: z.literal('wake_assignee'), trigger: z.string().min(1) }),
        z.object({ type: z.literal('wake_parent_assignee'), trigger: z.string().min(1) }),
        z.object({ type: z.literal('skip_propagation') }),
        z.object({ type: z.literal('create_discussion_group') }),
      ]),
    })),
  }),
});

export type SaveSchemaInput = z.infer<typeof saveSchemaSchema>;

export type CancelConversationInput = z.infer<typeof cancelConversationSchema>;
export type ResolveConversationInput = z.infer<typeof resolveConversationSchema>;
export type ReplyToConversationInput = z.infer<typeof replyToConversationSchema>;

export type UpdateSettingInput = z.infer<typeof updateSettingSchema>;

export type CreateOrganizationInput = z.infer<typeof createOrganizationSchema>;
export type UpdateOrganizationInput = z.infer<typeof updateOrganizationSchema>;
export type DeleteOrganizationInput = z.infer<typeof deleteOrganizationSchema>;
export type CreateRoleInput = z.infer<typeof createRoleSchema>;
export type UpdateRoleInput = z.infer<typeof updateRoleSchema>;
export type CreateSkillInput = z.infer<typeof createSkillSchema>;
export type UpdateSkillInput = z.infer<typeof updateSkillSchema>;
export type SearchSkillsInput = z.infer<typeof searchSkillsSchema>;
export type LoadTemplateInput = z.infer<typeof loadTemplateSchema>;
export type CreateTaskInput = z.infer<typeof createTaskSchema>;
export type UpdateTaskStatusInput = z.infer<typeof updateTaskStatusSchema>;
export type PostDiscussionMessageInput = z.infer<typeof postDiscussionMessageSchema>;
export type ApplyApprovalPresetInput = z.infer<typeof applyApprovalPresetSchema>;
export type StartRunInput = z.infer<typeof startRunSchema>;

// ─── System Check Types ─────────────────────────────────────────────
export interface DepCheckItem {
  ok: boolean;
  version: string | null;
}
export interface SystemCheckResult {
  nodejs: DepCheckItem;
  claudeCli: DepCheckItem;
  network: DepCheckItem;
}

// ─── Capibara API (exposed via contextBridge) ───────────────────────
export interface CapibaraApi {
  loadSnapshot: () => Promise<DesktopResult<AppSnapshot>>;

  // System
  checkSystemDeps: () => Promise<DesktopResult<SystemCheckResult>>;

  // Dialogs
  selectFolder: () => Promise<DesktopResult<string | null>>;

  // Shell
  openFolder: (folderPath: string) => Promise<DesktopResult<void>>;

  // Organization
  getOrganizations: () => Promise<DesktopResult<OrganizationRecord[]>>;
  getOrganization: (id: string) => Promise<DesktopResult<OrganizationRecord | null>>;
  createOrganization: (input: CreateOrganizationInput) => Promise<DesktopResult<OrganizationRecord>>;
  updateOrganization: (input: UpdateOrganizationInput) => Promise<DesktopResult<OrganizationRecord>>;
  deleteOrganization: (input: DeleteOrganizationInput) => Promise<DesktopResult<void>>;

  // Roles
  getRolesByOrgId: (orgId: string) => Promise<DesktopResult<RoleRecord[]>>;
  getRole: (id: string) => Promise<DesktopResult<RoleRecord | null>>;
  createRole: (input: CreateRoleInput) => Promise<DesktopResult<RoleRecord>>;
  updateRole: (input: UpdateRoleInput) => Promise<DesktopResult<RoleRecord>>;
  deleteRole: (id: string) => Promise<DesktopResult<void>>;

  // Skills
  getSkills: () => Promise<DesktopResult<SkillRecord[]>>;
  getSkill: (id: string) => Promise<DesktopResult<SkillRecord | null>>;
  createSkill: (input: CreateSkillInput) => Promise<DesktopResult<SkillRecord>>;
  updateSkill: (input: UpdateSkillInput) => Promise<DesktopResult<SkillRecord>>;
  deleteSkill: (id: string) => Promise<DesktopResult<void>>;
  searchSkills: (input: SearchSkillsInput) => Promise<DesktopResult<SkillRecord[]>>;

  // Templates
  getTemplates: () => Promise<DesktopResult<TemplateRecord[]>>;
  loadTemplate: (input: LoadTemplateInput) => Promise<DesktopResult<OrganizationRecord>>;

  // Tasks
  getTasksByOrgId: (orgId: string) => Promise<DesktopResult<TaskRecord[]>>;
  getTask: (id: string) => Promise<DesktopResult<TaskRecord | null>>;
  getTaskChildren: (parentId: string) => Promise<DesktopResult<TaskRecord[]>>;
  createTask: (input: CreateTaskInput) => Promise<DesktopResult<TaskRecord>>;
  updateTaskStatus: (input: UpdateTaskStatusInput) => Promise<DesktopResult<void>>;
  deleteTask: (id: string) => Promise<DesktopResult<void>>;

  // Narrative
  getNarrative: (orgId: string) => Promise<DesktopResult<NarrativeRecord | null>>;
  generateNarrative: (orgId: string) => Promise<DesktopResult<NarrativeRecord>>;
  getApprovalSummary: (taskId: string) => Promise<DesktopResult<string>>;

  // Cost
  getCostSummary: (orgId: string) => Promise<DesktopResult<CostSummaryRecord>>;
  getCostEntries: (orgId: string) => Promise<DesktopResult<CostEntryRecord[]>>;

  // Approval
  applyApprovalPreset: (input: ApplyApprovalPresetInput) => Promise<DesktopResult<void>>;
  getPendingApprovals: (orgId: string) => Promise<DesktopResult<PendingApprovalRecord[]>>;

  // Budget
  resumeOrgRoles: (orgId: string) => Promise<DesktopResult<{ resumedCount: number }>>;

  // Discussion
  getDiscussionGroupsByOrgId: (orgId: string) => Promise<DesktopResult<DiscussionGroupRecord[]>>;
  getDiscussionGroupByTaskNodeId: (taskNodeId: string) => Promise<DesktopResult<DiscussionGroupRecord | null>>;
  getDiscussionMessages: (groupId: string) => Promise<DesktopResult<DiscussionMessageRecord[]>>;
  getDiscussionVoteStats: (groupId: string) => Promise<DesktopResult<VoteStatsRecord>>;
  postDiscussionMessage: (input: PostDiscussionMessageInput) => Promise<DesktopResult<DiscussionMessageRecord>>;
  getDiscussionSummary: (groupId: string) => Promise<DesktopResult<string | null>>;

  // Runs
  getRunsByOrgId: (orgId: string) => Promise<DesktopResult<RunRecord[]>>;
  getRun: (id: string) => Promise<DesktopResult<RunRecord | null>>;
  getRunsByTaskId: (taskNodeId: string) => Promise<DesktopResult<RunRecord[]>>;
  getRunLog: (input: GetRunLogInput) => Promise<DesktopResult<RunLogResult>>;
  openRunLogFolder: (runId: string) => Promise<DesktopResult<void>>;
  startRun: (input: StartRunInput) => Promise<DesktopResult<RunRecord>>;
  cancelRun: (id: string) => Promise<DesktopResult<void>>;

  // Settings
  getSetting: (key: string) => Promise<DesktopResult<string | null>>;
  updateSetting: (input: UpdateSettingInput) => Promise<DesktopResult<void>>;
  getLocale: () => Promise<DesktopResult<string>>;

  // Workflow Schema
  getActiveSchema: (orgId: string) => Promise<DesktopResult<WorkflowSchemaRecord>>;
  saveSchema: (input: SaveSchemaInput) => Promise<DesktopResult<SchemaImpactReportRecord | null>>;
  validateSchema: (input: SaveSchemaInput) => Promise<DesktopResult<string[]>>;
  schemaImpactAnalysis: (input: SaveSchemaInput) => Promise<DesktopResult<SchemaImpactReportRecord | null>>;
  getWorkflowTemplates: () => Promise<DesktopResult<WorkflowTemplateRecord[]>>;

  // Session
  openSessionLogFolder: (sessionId: string) => Promise<DesktopResult<void>>;
  startSession: (input: StartSessionInput) => Promise<DesktopResult<SessionRecord>>;
  sendSessionMessage: (input: SendSessionMessageInput) => Promise<DesktopResult<{ status: string; sessionId: string }>>;
  getActiveSession: (orgId: string, type: SessionType) => Promise<DesktopResult<SessionRecord | null>>;
  getSessionMessages: (sessionId: string) => Promise<DesktopResult<SessionMessageRecord[]>>;
  cancelSession: (input: CancelSessionInput) => Promise<DesktopResult<void>>;
  switchSessionRole: (input: SwitchSessionRoleInput) => Promise<DesktopResult<void>>;

  // Planning
  startPlanningRun: (input: StartPlanningRunInput) => Promise<DesktopResult<StartPlanningRunResult>>;
  getActivePlanningSession: (orgId: string) => Promise<DesktopResult<ActivePlanningSessionRecord | null>>;
  discardPlanningSession: (input: DiscardPlanningSessionInput) => Promise<DesktopResult<void>>;
  getPendingPlan: (orgId: string) => Promise<DesktopResult<PendingPlanRecord | null>>;
  batchCreateTasks: (input: BatchCreateTasksInput) => Promise<DesktopResult<{ createdCount: number }>>;
  getAvailablePlanningRoles: (orgId: string) => Promise<DesktopResult<PlanningRoleOption[]>>;
  switchPlanningRole: (input: SwitchPlanningRoleInput) => Promise<DesktopResult<{ previousRoleId: string; newRoleId: string }>>;

  // Conversation
  getActiveConversations: (orgId: string) => Promise<DesktopResult<ConversationWorkflowRecord[]>>;
  getGroupedConversations: (orgId: string) => Promise<DesktopResult<GroupedConversationsResult>>;
  getConversationHistory: (workflowId: string) => Promise<DesktopResult<DiscussionMessageRecord[]>>;
  cancelConversation: (input: CancelConversationInput) => Promise<DesktopResult<void>>;
  resolveConversation: (input: ResolveConversationInput) => Promise<DesktopResult<void>>;
  getConversationMetrics: (orgId: string) => Promise<DesktopResult<ConversationMetricsRecord>>;
  getConversationEvents: (workflowId: string) => Promise<DesktopResult<ConversationEventRecord[]>>;
  getConversationAnalytics: (orgId: string, timeRange: ConversationTimeRange) => Promise<DesktopResult<ConversationAnalyticsRecord>>;
  replyToConversation: (input: ReplyToConversationInput) => Promise<DesktopResult<void>>;
  getResolvedConversations: (orgId: string) => Promise<DesktopResult<ConversationInboxItem[]>>;

  // Events subscription
  subscribe: (callback: (event: DesktopEvent) => void) => () => void;
}

// ─── Shared Record Types ────────────────────────────────────────────
export type OrgStatus = 'active' | 'paused' | 'archived';
export type RoleStatus = 'active' | 'paused' | 'idle';
export type SkillCategory = 'analysis' | 'design' | 'implementation' | 'review' | 'test' | 'general';
export type SkillSource = 'builtin' | 'template' | 'custom';
// Schema-driven: validated at runtime by WorkflowEngine
export type TaskType = string;
export type TaskStatus = string;

export interface OrganizationRecord {
  id: string;
  name: string;
  description: string;
  customInstructions: string;
  status: OrgStatus;
  budgetLimit: number;
  orgTemplateId: string | null;
  planningRoleId: string | null;
  workspacePath: string;
  createdAt: string;
  updatedAt: string;
}

export interface RoleRecord {
  id: string;
  orgId: string;
  name: string;
  parentId: string | null;
  persona: string;
  knowledgeBaseRefs: string[];
  skillIds: string[];
  canApprove: boolean;
  canDelegate: boolean;
  requiresHumanApproval: boolean;
  consecutiveWakeCount: number;
  isSystemRole: boolean;
  status: RoleStatus;
  createdAt: string;
  updatedAt: string;
}

export interface PlanningRoleOption {
  roleId: string;
  roleName: string;
  source: 'system' | 'template';
}

export interface SkillRecord {
  id: string;
  name: string;
  command: string;
  description: string;
  category: SkillCategory;
  source: SkillSource;
  orgTemplateId: string | null;
  customPromptContent: string | null;
  createdAt: string;
}

export interface TaskRecord {
  id: string;
  orgId: string;
  parentId: string | null;
  type: TaskType;
  title: string;
  description: string;
  status: TaskStatus;
  assigneeRoleId: string | null;
  depth: number;
  artifactPaths: string[] | null;
  createdAt: string;
  updatedAt: string;
}

export type VoteTag = 'APPROVE' | 'REVISE' | 'CONCERN' | 'DELEGATE' | null;
export type AuthorType = 'ai' | 'human' | 'system';
export type DiscussionStatus = 'active' | 'archived';
export type RunStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled' | 'interrupted';
export type WakeTrigger =
  | 'task_assigned'
  | 'task_completed'
  | 'review_approve'
  | 'review_revise'
  | 'review_delegate'
  | 'delegation_completed'
  | 'retry_failed'
  | 'dispute_detected'
  | 'discussion_reply'
  | 'conversation_escalation';

export interface DiscussionGroupRecord {
  id: string;
  taskNodeId: string;
  orgId: string;
  status: DiscussionStatus;
  summary: string | null;
  lastSummaryAt: string | null;
  currentRound: number;
  reviseCount: number;
  createdAt: string;
  lastMessageAt: string | null;
}

export type MessageIntent = 'question' | 'reply' | 'escalation' | 'resolution' | 'vote' | 'general';

export interface DiscussionMessageRecord {
  id: string;
  groupId: string;
  authorRoleId: string | null;
  authorType: AuthorType;
  content: string;
  voteTag: VoteTag;
  reviewRound: number;
  metadata: Record<string, unknown> | null;
  intent: MessageIntent;
  inReplyToMessageId: string | null;
  createdAt: string;
}

export interface VoteStatsRecord {
  APPROVE: number;
  REVISE: number;
  CONCERN: number;
  DELEGATE: number;
}

export interface RunRecord {
  id: string;
  orgId: string;
  taskNodeId: string | null;
  roleId: string;
  status: RunStatus;
  trigger: WakeTrigger;
  startedAt: string | null;
  finishedAt: string | null;
  tokenCount: number;
  createdAt: string;
}

export interface RunLogEntry {
  ts: string | null;
  kind: string;
  text: string;
}

export interface GetRunLogInput {
  runId: string;
  mode: 'parsed' | 'raw';
  offset?: number;
  limit?: number;
}

export interface RunLogResult {
  entries: RunLogEntry[];
  rawLines: string[];
}

export interface NarrativeRecord {
  id: string;
  orgId: string;
  templateData: Record<string, unknown>;
  renderedText: string;
  generatedAt: string;
}

export interface CostSummaryRecord {
  orgId: string;
  totalTokens: number;
  totalCostUsd: number;
  budgetLimit: number;
  budgetPercent: number;
  entries: CostEntryRecord[];
}

export interface CostEntryRecord {
  id: string;
  runId: string;
  roleId: string;
  orgId: string;
  tokenCount: number;
  createdAt: string;
}

export interface PendingApprovalRecord {
  taskId: string;
  taskTitle: string;
  orgId: string;
  roleId: string;
  roleName: string;
  groupId: string | null;
  status: TaskStatus;
}

export interface TemplateRoleDefinition {
  name: string;
  persona: string;
  skillCommands: string[];
  knowledgeBaseRefs: string[];
  canApprove: boolean;
  canDelegate: boolean;
  requiresHumanApproval: boolean;
  children: TemplateRoleDefinition[];
}

export interface TemplateRecord {
  id: string;
  name: string;
  description: string;
  rootRoles: TemplateRoleDefinition[];
}

// ─── Snapshot Types ─────────────────────────────────────────────────
export interface AppSnapshot {
  organizations: OrganizationRecord[];
  currentOrgId: string | null;
}

// ─── Planning Types ─────────────────────────────────────────────────
export interface PlanTaskNode {
  title: string;
  type: string;
  description: string;
  assigneeRoleName: string | null;
  children: PlanTaskNode[];
}

export interface PendingPlanRecord {
  summary: string;
  tasks: PlanTaskNode[];
  createdAt: string;
}

export interface StartPlanningRunResult {
  sessionId: string;
  roleId: string;
}

export interface ActivePlanningSessionRecord {
  sessionId: string | null;
  taskId: string | null;
  roleId: string;
  roleName: string;
}

// ─── Session Record Types ────────────────────────────────────────────
export type SessionType = 'planning' | 'adhoc';
export type SessionStatus = 'active' | 'completed' | 'cancelled';
export type SessionMessageAuthorType = 'human' | 'ai' | 'system';

export interface SessionRecord {
  id: string;
  orgId: string;
  roleId: string;
  type: SessionType;
  status: SessionStatus;
  cliSessionId: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface SessionMessageRecord {
  id: string;
  sessionId: string;
  authorType: SessionMessageAuthorType;
  content: string;
  createdAt: string;
}

// ─── Navigation ─────────────────────────────────────────────────────
export type SectionId =
  | 'dashboard'
  | 'tasks'
  | 'inbox'
  | 'team'
  | 'settings'
  | 'workspace'
  | 'planning';

// ─── Conversation Records ──────────────────────────────────────────
export type ConversationWorkflowState =
  | 'waiting_for_reply'
  | 'reply_received'
  | 'resumed'
  | 'resolved'
  | 'escalated'
  | 'timed_out'
  | 'cancelled';

export interface ConversationWorkflowRecord {
  id: string;
  orgId: string;
  taskNodeId: string;
  discussionGroupId: string;
  askingRoleId: string;
  askingRunId: string;
  respondentRoleId: string | null;
  respondentType: 'ai' | 'human';
  state: ConversationWorkflowState;
  depth: number;
  parentWorkflowId: string | null;
  priority: number;
  timeoutAt: string | null;
  resolvedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ConversationMetricsRecord {
  totalConversations: number;
  activeConversations: number;
  resolvedConversations: number;
  escalatedConversations: number;
  timedOutConversations: number;
  cancelledConversations: number;
  averageResolutionTimeMs: number | null;
  avgResponseTimeMs: number | null;
  escalationRate: number;
  timeoutRate: number;
  humanInterventionRate: number;
  avgDepth: number;
  cycleDetectionCount: number;
}

export interface ConversationEventRecord {
  id: string;
  workflowId: string;
  eventType: string;
  eventPayload: Record<string, unknown>;
  createdAt: string;
}

export interface ConversationInboxItem {
  workflowId: string;
  taskNodeId: string;
  taskTitle: string;
  discussionGroupId: string;
  askingRoleId: string;
  askingRoleName: string;
  respondentRoleId: string | null;
  respondentRoleName: string | null;
  respondentType: 'ai' | 'human';
  questionPreview: string;
  waitingSince: string;
  priority: number;
  depth: number;
  /** Number of resolved workflows aggregated under this task (history only) */
  conversationCount?: number;
}

export interface GroupedConversationsResult {
  blocked: ConversationInboxItem[];
  monitoring: ConversationInboxItem[];
}

// ─── Conversation Analytics ────────────────────────────────────────
export type ConversationTimeRange = '7d' | '30d' | 'all';

export interface RoleQuestionCount {
  roleId: string;
  roleName: string;
  count: number;
}

export interface EscalationHotspot {
  fromRoleId: string;
  fromRoleName: string;
  toRoleId: string;
  toRoleName: string;
  count: number;
}

export interface DepthBucket {
  depth: number;
  count: number;
}

// ─── Workflow Schema Records ─────────────────────────────────────────
export interface WorkflowSchemaRecord {
  workItemTypes: Array<{
    name: string;
    label: string;
    icon?: string;
    color?: string;
    isLeaf: boolean;
    allowedChildren: string[];
    allowedAtRoot: boolean;
    canDecompose: boolean;
    hasDiscussionGroup: boolean;
  }>;
  statuses: Array<{
    name: string;
    label: string;
    category: 'initial' | 'active' | 'review' | 'terminal';
  }>;
  transitions: Array<{
    from: string;
    to: string;
    trigger: 'manual' | 'auto' | 'system';
  }>;
  behaviorRules: Array<{
    id: string;
    name: string;
    priority: number;
    trigger: Record<string, unknown>;
    condition: Record<string, unknown>;
    action: Record<string, unknown>;
  }>;
}

export interface SchemaImpactReportRecord {
  affectedTaskCount: number;
  details: Array<{ taskId: string; type: string; status: string }>;
}

export interface WorkflowTemplateRecord {
  id: string;
  name: string;
  description: string;
  schema: WorkflowSchemaRecord;
}

export interface ConversationAnalyticsRecord {
  mostAskedRoles: RoleQuestionCount[];
  slowestResponders: Array<{ roleId: string; roleName: string; avgResponseTimeMs: number }>;
  escalationHotspots: EscalationHotspot[];
  humanInterventionCount: number;
  depthDistribution: DepthBucket[];
  timeRange: ConversationTimeRange;
}
