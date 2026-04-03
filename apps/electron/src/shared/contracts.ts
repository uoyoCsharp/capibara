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
  | { type: 'run:output'; runId: string; chunk: string }
  | { type: 'run:completed'; runId: string; orgId: string; taskNodeId: string; roleId: string; status: 'succeeded' | 'failed' | 'cancelled'; costUsd: number; tokenCount: number }
  | { type: 'notification'; title: string; body: string }
  | { type: 'approval:required'; taskId: string; taskTitle: string; orgId: string; roleId: string; roleName: string; groupId: string }
  | { type: 'budget:roles-paused'; orgId: string; totalCost: number; budgetLimit: number }
  | { type: 'settings:locale-changed'; locale: string };

// ─── Zod Schemas for IPC Payload Validation ─────────────────────────
export const createOrganizationSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(500).default(''),
  budgetLimit: z.number().min(0).default(50.0),
  orgTemplateId: z.string().nullable().default(null),
  workspacePath: z.string().min(1),
});

export const updateOrganizationSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1).max(100).optional(),
  description: z.string().max(500).optional(),
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
});

export const createTaskSchema = z.object({
  orgId: z.string().min(1),
  parentId: z.string().nullable().default(null),
  type: z.enum(['epic', 'story', 'task', 'subtask', 'spike', 'bug', 'chore']),
  title: z.string().min(1).max(300),
  description: z.string().max(10000).default(''),
  assigneeRoleId: z.string().nullable().default(null),
});

export const updateTaskStatusSchema = z.object({
  id: z.string().min(1),
  status: z.enum(['pending', 'in_progress', 'awaiting_review', 'revision', 'approved', 'done', 'blocked', 'cancelled']),
});

export const postDiscussionMessageSchema = z.object({
  groupId: z.string().min(1),
  authorRoleId: z.string().nullable().default(null),
  authorType: z.enum(['ai', 'human', 'system']),
  content: z.string().min(1).max(50000),
  voteTag: z.enum(['APPROVE', 'REVISE', 'CONCERN', 'DELEGATE']).nullable().default(null),
  metadata: z.record(z.unknown()).nullable().optional(),
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
  ]).default('task_assigned'),
});

export const updateSettingSchema = z.object({
  key: z.string().min(1),
  value: z.string(),
});

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

// ─── Capibara API (exposed via contextBridge) ───────────────────────
export interface CapibaraApi {
  loadSnapshot: () => Promise<DesktopResult<AppSnapshot>>;

  // Dialogs
  selectFolder: () => Promise<DesktopResult<string | null>>;

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

  // Events subscription
  subscribe: (callback: (event: DesktopEvent) => void) => () => void;
}

// ─── Shared Record Types ────────────────────────────────────────────
export type OrgStatus = 'active' | 'paused' | 'archived';
export type RoleStatus = 'active' | 'paused' | 'idle';
export type SkillCategory = 'analysis' | 'design' | 'implementation' | 'review' | 'test' | 'general';
export type SkillSource = 'builtin' | 'template' | 'custom';
export type TaskType = 'epic' | 'story' | 'task' | 'subtask' | 'spike' | 'bug' | 'chore';
export type TaskStatus =
  | 'pending'
  | 'in_progress'
  | 'awaiting_review'
  | 'revision'
  | 'approved'
  | 'done'
  | 'blocked'
  | 'cancelled';

export interface OrganizationRecord {
  id: string;
  name: string;
  description: string;
  status: OrgStatus;
  budgetLimit: number;
  orgTemplateId: string | null;
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
  status: RoleStatus;
  createdAt: string;
  updatedAt: string;
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
  | 'dispute_detected';

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
}

export interface DiscussionMessageRecord {
  id: string;
  groupId: string;
  authorRoleId: string | null;
  authorType: AuthorType;
  content: string;
  voteTag: VoteTag;
  reviewRound: number;
  metadata: Record<string, unknown> | null;
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
  taskNodeId: string;
  roleId: string;
  status: RunStatus;
  trigger: WakeTrigger;
  startedAt: string | null;
  finishedAt: string | null;
  costUsd: number;
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
  totalCost: number;
  totalTokens: number;
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
  costUsd: number;
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

// ─── Navigation ─────────────────────────────────────────────────────
export type SectionId =
  | 'dashboard'
  | 'organization'
  | 'skills'
  | 'execution'
  | 'discussion';
