import type {
  DesktopResult,
  OrganizationRecord,
  RoleRecord,
  SkillRecord,
  TaskRecord,
  RunRecord,
  ConversationRecord,
  ConversationMessageRecord,
  PlanningHistoryRecord,
  CostSummaryRecord,
  PendingTreeRecord,
  DesktopEvent,
  ToolCallLogRecord,
  FileAccessLogRecord,
  SuspensionRecord,
  SuspensionAwaitingRecord,
  AgentConfigSummary,
  ModelStateSummary,
  DiagnosticSnapshot,
} from './types';

/**
 * Renderer-facing IPC contract.
 *
 * Every method here must have a matching entry in `src/core/preload/index.ts`,
 * and every preload method must be listed here. The parity test
 * `tests/unit/preload-api-parity.test.ts` enforces this invariant at CI time.
 *
 * Signatures mirror preload call shapes (positional args, not wrapped in
 * input objects), so renderer callers get type checking aligned to the
 * actual wire surface.
 */
export interface CapibaraApi {
  // ─── Organization ────────────────────────────────────────────────
  getOrganizations: () => Promise<DesktopResult<OrganizationRecord[]>>;
  getOrganization: (id: string) => Promise<DesktopResult<OrganizationRecord | null>>;
  createOrganization: (input: unknown) => Promise<DesktopResult<OrganizationRecord>>;
  updateOrganization: (input: unknown) => Promise<DesktopResult<OrganizationRecord>>;
  deleteOrganization: (id: string) => Promise<DesktopResult<null>>;

  // ─── Roles ───────────────────────────────────────────────────────
  getRolesByOrgId: (orgId: string) => Promise<DesktopResult<RoleRecord[]>>;
  getRole: (id: string) => Promise<DesktopResult<RoleRecord | null>>;
  createRole: (input: unknown) => Promise<DesktopResult<RoleRecord>>;
  updateRole: (input: unknown) => Promise<DesktopResult<RoleRecord>>;
  deleteRole: (id: string) => Promise<DesktopResult<null>>;

  // ─── Skills ──────────────────────────────────────────────────────
  getSkills: () => Promise<DesktopResult<SkillRecord[]>>;
  getSkill: (id: string) => Promise<DesktopResult<SkillRecord | null>>;
  createSkill: (input: unknown) => Promise<DesktopResult<SkillRecord>>;
  deleteSkill: (id: string) => Promise<DesktopResult<null>>;

  // ─── Templates ───────────────────────────────────────────────────
  getTemplates: () => Promise<DesktopResult<unknown[]>>;
  loadTemplate: (
    templateId: string,
    orgName: string,
    workspacePath: string,
    processTemplateId?: string | null,
    locale?: string,
  ) => Promise<DesktopResult<OrganizationRecord>>;

  // ─── Tasks ───────────────────────────────────────────────────────
  getTasksByOrgId: (orgId: string) => Promise<DesktopResult<TaskRecord[]>>;
  getTask: (id: string) => Promise<DesktopResult<TaskRecord | null>>;
  getTaskChildren: (parentId: string) => Promise<DesktopResult<TaskRecord[]>>;
  createTask: (input: unknown) => Promise<DesktopResult<TaskRecord>>;
  updateTaskStatus: (taskId: string, status: string) => Promise<DesktopResult<TaskRecord>>;
  cancelTask: (taskId: string) => Promise<DesktopResult<TaskRecord>>;
  deleteTask: (id: string) => Promise<DesktopResult<null>>;

  // ─── Approval (Task state transitions) ───────────────────────────
  confirmApproval: (taskId: string, nextStatus: string) => Promise<DesktopResult<TaskRecord>>;
  rejectApproval: (taskId: string, revertStatus: string) => Promise<DesktopResult<TaskRecord>>;

  // ─── Process Schema ──────────────────────────────────────────────
  getProcessSchema: (orgId: string) => Promise<DesktopResult<unknown>>;
  saveProcessSchema: (orgId: string, schema: unknown) => Promise<DesktopResult<null>>;
  getProcessTemplates: () => Promise<DesktopResult<unknown[]>>;

  // ─── Conversations ───────────────────────────────────────────────
  getConversations: (orgId: string) => Promise<DesktopResult<ConversationRecord[]>>;
  getActiveConversations: (orgId: string) => Promise<DesktopResult<ConversationRecord[]>>;
  getConversation: (id: string) => Promise<DesktopResult<ConversationRecord | null>>;
  getConversationMessages: (id: string) => Promise<DesktopResult<ConversationMessageRecord[]>>;
  addConversationMessage: (input: unknown) => Promise<DesktopResult<ConversationMessageRecord>>;
  resolveConversation: (id: string) => Promise<DesktopResult<null>>;
  cancelConversation: (id: string) => Promise<DesktopResult<null>>;
  deleteConversation: (id: string) => Promise<DesktopResult<null>>;
  createInquiry: (
    orgId: string,
    roleId: string,
    taskId: string,
    question: string,
  ) => Promise<DesktopResult<ConversationRecord>>;
  createAdhocConversation: (
    orgId: string,
    roleId: string,
    message: string,
  ) => Promise<DesktopResult<ConversationRecord>>;

  // ─── Conversational Planning ─────────────────────────────────────
  startPlanning: (
    orgId: string,
    agentRoleId: string,
    firstMessage: string,
  ) => Promise<DesktopResult<ConversationRecord>>;
  getActivePlanning: (orgId: string) => Promise<DesktopResult<ConversationRecord | null>>;
  getPlanningHistory: (orgId: string) => Promise<DesktopResult<PlanningHistoryRecord[]>>;
  getPlanTreeByConversation: (
    conversationId: string,
  ) => Promise<DesktopResult<PendingTreeRecord | null>>;
  approvePlanTreeByConversation: (
    conversationId: string,
    expectedVersion?: number,
  ) => Promise<DesktopResult<null>>;
  discardPlanTreeByConversation: (
    conversationId: string,
    reason?: string,
  ) => Promise<DesktopResult<null>>;
  refinePlanTreeByConversation: (
    conversationId: string,
    feedback: string,
  ) => Promise<DesktopResult<null>>;

  // ─── Runs ────────────────────────────────────────────────────────
  getRunsByOrgId: (orgId: string) => Promise<DesktopResult<RunRecord[]>>;
  getRun: (id: string) => Promise<DesktopResult<RunRecord | null>>;
  getRunsByTaskId: (taskId: string) => Promise<DesktopResult<RunRecord[]>>;
  getRunLogs: (runId: string) => Promise<DesktopResult<string[]>>;
  getRunLogDir: (runId: string) => Promise<DesktopResult<string>>;
  cancelRun: (runId: string) => Promise<DesktopResult<null>>;
  getInterruptedCount: (orgId: string) => Promise<DesktopResult<{ count: number }>>;
  resumeInterrupted: (orgId: string) => Promise<DesktopResult<{ resumed: number }>>;

  // ─── Logs ────────────────────────────────────────────────────────
  getLogStats: () => Promise<DesktopResult<{
    totalSizeMB: number;
    fileCount: number;
    oldestMonth: string | null;
    newestMonth: string | null;
  }>>;
  clearAllLogs: () => Promise<DesktopResult<{ deletedFiles: number; freedMB: number }>>;
  clearLogsBefore: (cutoffMonth: string) => Promise<DesktopResult<{ deletedFiles: number; freedMB: number }>>;

  // ─── Cost ────────────────────────────────────────────────────────
  getCostSummary: (orgId: string) => Promise<DesktopResult<CostSummaryRecord>>;

  // ─── Audit ───────────────────────────────────────────────────────
  getToolCallsByRunId: (runId: string) => Promise<DesktopResult<ToolCallLogRecord[]>>;
  getToolCallsByOrgId: (orgId: string, limit?: number) => Promise<DesktopResult<ToolCallLogRecord[]>>;
  getFileAccessByRunId: (runId: string) => Promise<DesktopResult<FileAccessLogRecord[]>>;
  getFileAccessByOrgId: (orgId: string, limit?: number) => Promise<DesktopResult<FileAccessLogRecord[]>>;

  // ─── Suspensions ─────────────────────────────────────────────────
  getActiveSuspensions: (orgId: string) => Promise<DesktopResult<Array<SuspensionRecord & { awaiting: SuspensionAwaitingRecord[] }>>>;

  // ─── Plan tree (task-scoped preview/eager decomposition) ─────────
  getPlanTree: (rootTaskId: string) => Promise<DesktopResult<PendingTreeRecord | null>>;
  approvePlanTree: (
    rootTaskId: string,
    expectedVersion?: number,
  ) => Promise<DesktopResult<null>>;
  discardPlanTree: (
    rootTaskId: string,
    reason?: string,
  ) => Promise<DesktopResult<null>>;
  refinePlanTree: (
    rootTaskId: string,
    feedback: string,
  ) => Promise<DesktopResult<null>>;

  // ─── Settings ────────────────────────────────────────────────────
  getSetting: (key: string) => Promise<DesktopResult<string | null>>;
  setSetting: (key: string, value: string) => Promise<DesktopResult<null>>;

  // ─── System ──────────────────────────────────────────────────────
  getSystemHealth: () => Promise<DesktopResult<{ status: string; timestamp: string }>>;
  checkSystemDeps: () => Promise<DesktopResult<unknown>>;
  getAgentConfig: () => Promise<DesktopResult<AgentConfigSummary>>;
  setDefaultAgent: (agentId: string) => Promise<DesktopResult<{ defaultAgent: string }>>;

  // ─── ACP Model Selection ─────────────────────────────────────────
  getModelState: () => Promise<DesktopResult<ModelStateSummary>>;
  setSelectedModel: (modelId: string) => Promise<DesktopResult<ModelStateSummary>>;
  probeModels: () => Promise<DesktopResult<ModelStateSummary>>;

  // ─── Scheduler (execution control) ───────────────────────────────
  getExecutionState: () => Promise<DesktopResult<{ paused: boolean }>>;
  pauseExecution: () => Promise<DesktopResult<{ cancelledRunCount: number }>>;
  resumeExecution: () => Promise<DesktopResult<null>>;

  // ─── Dialogs / Shell ─────────────────────────────────────────────
  selectFolder: () => Promise<DesktopResult<string | null>>;
  openFolder: (path: string) => Promise<DesktopResult<null>>;

  // ─── Events ──────────────────────────────────────────────────────
  subscribe: (callback: (event: DesktopEvent) => void) => () => void;

  // ─── Auto-update (main-pushed events only) ───────────────────────
  onUpdateEvent: (
    callback: (payload: { channel: string; payload?: unknown }) => void,
  ) => () => void;

  // ─── Dev Diagnostics ──────────────────────────────────────────────
  devDiagnose: () => Promise<DesktopResult<DiagnosticSnapshot>>;
  devRestartAgent: (agentId: string) => Promise<DesktopResult<{ expiredSessionCount: number }>>;
  devCloseSession: (sessionId: string) => Promise<DesktopResult<null>>;
  devRestartMcp: () => Promise<DesktopResult<{ newPort: number }>>;
}
