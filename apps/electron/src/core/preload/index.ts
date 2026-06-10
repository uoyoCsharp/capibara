import { contextBridge, ipcRenderer } from 'electron';

const api = {
  // Organization
  getOrganizations: () => ipcRenderer.invoke('capibara:org:list'),
  getOrganization: (id: string) => ipcRenderer.invoke('capibara:org:get', id),
  createOrganization: (input: unknown) => ipcRenderer.invoke('capibara:org:create', input),
  updateOrganization: (input: unknown) => ipcRenderer.invoke('capibara:org:update', input),
  deleteOrganization: (id: string) => ipcRenderer.invoke('capibara:org:delete', id),

  // Roles
  getRolesByOrgId: (orgId: string) => ipcRenderer.invoke('capibara:role:list', orgId),
  getRole: (id: string) => ipcRenderer.invoke('capibara:role:get', id),
  createRole: (input: unknown) => ipcRenderer.invoke('capibara:role:create', input),
  updateRole: (input: unknown) => ipcRenderer.invoke('capibara:role:update', input),
  deleteRole: (id: string) => ipcRenderer.invoke('capibara:role:delete', id),

  // Role Avatars
  uploadAvatar: (roleId: string, imageBuffer: ArrayBuffer, mimeType: string) =>
    ipcRenderer.invoke('capibara:role:upload-avatar', roleId, imageBuffer, mimeType),
  removeAvatar: (roleId: string) =>
    ipcRenderer.invoke('capibara:role:remove-avatar', roleId),
  getAvatar: async (roleId: string) => {
    const result = await ipcRenderer.invoke('capibara:role:get-avatar', roleId);
    if (result.ok && result.data) {
      const { avatar, mimeType } = result.data;
      const binaryString = atob(avatar);
      const bytes = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }
      return { ok: true, data: { avatar: bytes.buffer, mimeType } };
    }
    return result;
  },

  // Skills
  getSkills: () => ipcRenderer.invoke('capibara:skill:list'),
  getSkill: (id: string) => ipcRenderer.invoke('capibara:skill:get', id),
  createSkill: (input: unknown) => ipcRenderer.invoke('capibara:skill:create', input),
  deleteSkill: (id: string) => ipcRenderer.invoke('capibara:skill:delete', id),

  // Templates
  getTemplates: () => ipcRenderer.invoke('capibara:template:list'),
  loadTemplate: (
    templateId: string,
    orgName: string,
    workspacePath: string,
    processTemplateId?: string | null,
    locale?: string,
  ) =>
    ipcRenderer.invoke(
      'capibara:template:load',
      templateId,
      orgName,
      workspacePath,
      processTemplateId ?? null,
      locale ?? 'en-US',
    ),

  // Tasks
  getTasksByOrgId: (orgId: string) => ipcRenderer.invoke('capibara:task:list', orgId),
  getTask: (id: string) => ipcRenderer.invoke('capibara:task:get', id),
  getTaskChildren: (parentId: string) => ipcRenderer.invoke('capibara:task:children', parentId),
  createTask: (input: unknown) => ipcRenderer.invoke('capibara:task:create', input),
  updateTaskStatus: (taskId: string, status: string) => ipcRenderer.invoke('capibara:task:transition', taskId, status),
  cancelTask: (taskId: string) => ipcRenderer.invoke('capibara:task:cancel', taskId),
  deleteTask: (id: string) => ipcRenderer.invoke('capibara:task:delete', id),

  // Approval (modeled as Task state transitions)
  confirmApproval: (taskId: string, nextStatus: string) => ipcRenderer.invoke('capibara:task:approve', taskId, nextStatus),
  rejectApproval: (taskId: string, revertStatus: string) => ipcRenderer.invoke('capibara:task:reject', taskId, revertStatus),

  // Process Schema
  getProcessSchema: (orgId: string) => ipcRenderer.invoke('capibara:process:get-schema', orgId),
  saveProcessSchema: (orgId: string, schema: unknown) => ipcRenderer.invoke('capibara:process:save-schema', orgId, schema),
  getProcessTemplates: () => ipcRenderer.invoke('capibara:process:templates'),

  // Conversations
  getConversations: (orgId: string) => ipcRenderer.invoke('capibara:conversation:list', orgId),
  getActiveConversations: (orgId: string) => ipcRenderer.invoke('capibara:conversation:active', orgId),
  getConversation: (id: string) => ipcRenderer.invoke('capibara:conversation:get', id),
  getConversationMessages: (id: string) => ipcRenderer.invoke('capibara:conversation:messages', id),
  addConversationMessage: (input: unknown) => ipcRenderer.invoke('capibara:conversation:add-message', input),
  resolveConversation: (id: string) => ipcRenderer.invoke('capibara:conversation:resolve', id),
  cancelConversation: (id: string) => ipcRenderer.invoke('capibara:conversation:cancel', id),
  deleteConversation: (id: string) => ipcRenderer.invoke('capibara:conversation:delete', id),
  createInquiry: (orgId: string, roleId: string, taskId: string, question: string) =>
    ipcRenderer.invoke('capibara:conversation:create-inquiry', orgId, roleId, taskId, question),
  createAdhocConversation: (orgId: string, roleId: string, message: string) =>
    ipcRenderer.invoke('capibara:conversation:create-adhoc', orgId, roleId, message),

  // Conversational Planning
  startPlanning: (orgId: string, agentRoleId: string, firstMessage: string) =>
    ipcRenderer.invoke('capibara:planning:start', orgId, agentRoleId, firstMessage),
  getActivePlanning: (orgId: string) =>
    ipcRenderer.invoke('capibara:planning:active', orgId),
  getPlanningHistory: (orgId: string) =>
    ipcRenderer.invoke('capibara:planning:history', orgId),
  getPlanTreeByConversation: (conversationId: string) =>
    ipcRenderer.invoke('capibara:plan-tree:get-by-conversation', conversationId),
  approvePlanTreeByConversation: (conversationId: string, expectedVersion?: number) =>
    ipcRenderer.invoke('capibara:plan-tree:approve-by-conversation', conversationId, expectedVersion),
  discardPlanTreeByConversation: (conversationId: string, reason?: string) =>
    ipcRenderer.invoke('capibara:plan-tree:discard-by-conversation', conversationId, reason),
  refinePlanTreeByConversation: (conversationId: string, feedback: string) =>
    ipcRenderer.invoke('capibara:plan-tree:refine-by-conversation', conversationId, feedback),

  // Runs
  getRunsByOrgId: (orgId: string) => ipcRenderer.invoke('capibara:run:list', orgId),
  getRun: (id: string) => ipcRenderer.invoke('capibara:run:get', id),
  getRunsByTaskId: (taskId: string) => ipcRenderer.invoke('capibara:run:by-task', taskId),
  getRunLogs: (runId: string) => ipcRenderer.invoke('capibara:run:logs', runId),
  getRunLogDir: (runId: string) => ipcRenderer.invoke('capibara:run:log-dir', runId),
  cancelRun: (runId: string) => ipcRenderer.invoke('capibara:run:cancel', runId),
  getInterruptedCount: (orgId: string) => ipcRenderer.invoke('capibara:run:interrupted-count', orgId),
  resumeInterrupted: (orgId: string) => ipcRenderer.invoke('capibara:run:resume-interrupted', orgId),

  // Logs
  getLogStats: () => ipcRenderer.invoke('capibara:logs:stats'),
  clearAllLogs: () => ipcRenderer.invoke('capibara:logs:clear-all'),
  clearLogsBefore: (cutoffMonth: string) => ipcRenderer.invoke('capibara:logs:clear-before', cutoffMonth),

  // Cost
  getCostSummary: (orgId: string) => ipcRenderer.invoke('capibara:cost:summary', orgId),

  // Audit
  getToolCallsByRunId: (runId: string) => ipcRenderer.invoke('capibara:audit:tool-calls', runId),
  getToolCallsByOrgId: (orgId: string, limit?: number) => ipcRenderer.invoke('capibara:audit:tool-calls-by-org', orgId, limit),
  getFileAccessByRunId: (runId: string) => ipcRenderer.invoke('capibara:audit:file-access', runId),
  getFileAccessByOrgId: (orgId: string, limit?: number) => ipcRenderer.invoke('capibara:audit:file-access-by-org', orgId, limit),

  // Suspensions
  getActiveSuspensions: (orgId: string) => ipcRenderer.invoke('capibara:suspension:active', orgId),

  // Plan tree (task-scoped preview/eager decomposition)
  getPlanTree: (rootTaskId: string) => ipcRenderer.invoke('capibara:plan-tree:get', rootTaskId),
  approvePlanTree: (rootTaskId: string, expectedVersion?: number) =>
    ipcRenderer.invoke('capibara:plan-tree:approve', rootTaskId, expectedVersion),
  discardPlanTree: (rootTaskId: string, reason?: string) =>
    ipcRenderer.invoke('capibara:plan-tree:discard', rootTaskId, reason),
  refinePlanTree: (rootTaskId: string, feedback: string) =>
    ipcRenderer.invoke('capibara:plan-tree:refine', rootTaskId, feedback),

  // Settings
  getSetting: (key: string) => ipcRenderer.invoke('capibara:settings:get', key),
  setSetting: (key: string, value: string) => ipcRenderer.invoke('capibara:settings:set', key, value),

  // System
  getSystemHealth: () => ipcRenderer.invoke('capibara:system:health'),
  checkSystemDeps: () => ipcRenderer.invoke('capibara:system:check-deps'),
  getAgentConfig: () => ipcRenderer.invoke('capibara:system:agent-config'),
  setDefaultAgent: (agentId: string) => ipcRenderer.invoke('capibara:system:set-default-agent', agentId),

  // ACP Model Selection
  getModelState: () => ipcRenderer.invoke('capibara:acp:model-state'),
  setSelectedModel: (modelId: string) => ipcRenderer.invoke('capibara:acp:set-model', modelId),
  probeModels: () => ipcRenderer.invoke('capibara:acp:probe-models'),

  // Scheduler (execution control)
  getExecutionState: () => ipcRenderer.invoke('capibara:scheduler:get-state'),
  pauseExecution: () => ipcRenderer.invoke('capibara:scheduler:pause'),
  resumeExecution: () => ipcRenderer.invoke('capibara:scheduler:resume'),

  // Dialogs
  selectFolder: () => ipcRenderer.invoke('capibara:dialog:select-folder'),
  openFolder: (path: string) => ipcRenderer.invoke('capibara:shell:open-folder', path),

  // Event subscription
  subscribe: (callback: (event: unknown) => void) => {
    const handler = (_event: unknown, data: unknown) => callback(data);
    ipcRenderer.on('capibara:desktop-event', handler);
    return () => ipcRenderer.removeListener('capibara:desktop-event', handler);
  },

  // Auto-update events (main → renderer one-way push; no invoke surface yet)
  onUpdateEvent: (callback: (payload: { channel: string; payload?: unknown }) => void) => {
    const handler = (_event: unknown, data: { channel: string; payload?: unknown }) => callback(data);
    ipcRenderer.on('capibara:auto-update', handler);
    return () => ipcRenderer.removeListener('capibara:auto-update', handler);
  },

  // Dev Diagnostics
  devDiagnose: () => ipcRenderer.invoke('capibara:dev:diagnose'),
  devRestartAgent: (agentId: string) => ipcRenderer.invoke('capibara:dev:restart-agent', agentId),
  devCloseSession: (sessionId: string) => ipcRenderer.invoke('capibara:dev:close-session', sessionId),
  devRestartMcp: () => ipcRenderer.invoke('capibara:dev:restart-mcp'),
};

contextBridge.exposeInMainWorld('capibara', api);
