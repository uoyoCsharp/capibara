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

  // Skills
  getSkills: () => ipcRenderer.invoke('capibara:skill:list'),
  getSkill: (id: string) => ipcRenderer.invoke('capibara:skill:get', id),
  createSkill: (input: unknown) => ipcRenderer.invoke('capibara:skill:create', input),

  // Templates
  getTemplates: () => ipcRenderer.invoke('capibara:template:list'),
  loadTemplate: (templateId: string, orgName: string, workspacePath: string) =>
    ipcRenderer.invoke('capibara:template:load', templateId, orgName, workspacePath),

  // Tasks
  getTasksByOrgId: (orgId: string) => ipcRenderer.invoke('capibara:task:list', orgId),
  getTask: (id: string) => ipcRenderer.invoke('capibara:task:get', id),
  getTaskChildren: (parentId: string) => ipcRenderer.invoke('capibara:task:children', parentId),
  createTask: (input: unknown) => ipcRenderer.invoke('capibara:task:create', input),
  updateTaskStatus: (taskId: string, status: string) => ipcRenderer.invoke('capibara:task:transition', taskId, status),
  startTask: (taskId: string) => ipcRenderer.invoke('capibara:task:start', taskId),
  cancelTask: (taskId: string) => ipcRenderer.invoke('capibara:task:cancel', taskId),
  deleteTask: (id: string) => ipcRenderer.invoke('capibara:task:delete', id),

  // Approval
  confirmApproval: (taskId: string, nextStatus: string) => ipcRenderer.invoke('capibara:approval:confirm', taskId, nextStatus),
  rejectApproval: (taskId: string, revertStatus: string) => ipcRenderer.invoke('capibara:approval:reject', taskId, revertStatus),

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
  createInquiry: (orgId: string, roleId: string, taskId: string, question: string) =>
    ipcRenderer.invoke('capibara:conversation:create-inquiry', orgId, roleId, taskId, question),
  createAdhocConversation: (orgId: string, roleId: string, message: string) =>
    ipcRenderer.invoke('capibara:conversation:create-adhoc', orgId, roleId, message),

  // Runs
  getRunsByOrgId: (orgId: string) => ipcRenderer.invoke('capibara:run:list', orgId),
  getRun: (id: string) => ipcRenderer.invoke('capibara:run:get', id),
  getRunsByTaskId: (taskId: string) => ipcRenderer.invoke('capibara:run:by-task', taskId),
  getRunLogs: (runId: string) => ipcRenderer.invoke('capibara:run:logs', runId),
  getRunLogDir: (runId: string) => ipcRenderer.invoke('capibara:run:log-dir', runId),
  cancelRun: (runId: string) => ipcRenderer.invoke('capibara:run:cancel', runId),

  // Logs
  getLogStats: () => ipcRenderer.invoke('capibara:logs:stats'),
  clearAllLogs: () => ipcRenderer.invoke('capibara:logs:clear-all'),
  clearLogsBefore: (cutoffMonth: string) => ipcRenderer.invoke('capibara:logs:clear-before', cutoffMonth),

  // Cost
  getCostSummary: (orgId: string) => ipcRenderer.invoke('capibara:cost:summary', orgId),

  // Planning
  startPlanning: (orgId: string, roleId: string, message: string) =>
    ipcRenderer.invoke('capibara:planning:start', orgId, roleId, message),
  sendPlanningMessage: (conversationId: string, message: string) =>
    ipcRenderer.invoke('capibara:planning:send-message', conversationId, message),
  getPendingPlan: (conversationId: string) => ipcRenderer.invoke('capibara:planning:get-pending', conversationId),
  confirmPlan: (conversationId: string, orgId: string, parentTaskId: string | null) =>
    ipcRenderer.invoke('capibara:planning:confirm', conversationId, orgId, parentTaskId),
  discardPlan: (conversationId: string) => ipcRenderer.invoke('capibara:planning:discard', conversationId),

  // Settings
  getSetting: (key: string) => ipcRenderer.invoke('capibara:settings:get', key),
  setSetting: (key: string, value: string) => ipcRenderer.invoke('capibara:settings:set', key, value),

  // System
  getSystemHealth: () => ipcRenderer.invoke('capibara:system:health'),
  checkSystemDeps: () => ipcRenderer.invoke('capibara:system:check-deps'),

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
};

contextBridge.exposeInMainWorld('capibara', api);
