import { contextBridge, ipcRenderer } from 'electron';
import { IPC_CHANNELS } from '@shared/contracts';
import type { CapibaraApi, DesktopEvent } from '@shared/contracts';

const api: CapibaraApi = {
  loadSnapshot: () => ipcRenderer.invoke(IPC_CHANNELS.loadSnapshot),

  // Dialogs
  selectFolder: () => ipcRenderer.invoke(IPC_CHANNELS.selectFolder),

  // Shell
  openFolder: (folderPath) => ipcRenderer.invoke(IPC_CHANNELS.openFolder, folderPath),

  // Organization
  getOrganizations: () => ipcRenderer.invoke(IPC_CHANNELS.getOrganizations),
  getOrganization: (id) => ipcRenderer.invoke(IPC_CHANNELS.getOrganization, id),
  createOrganization: (input) => ipcRenderer.invoke(IPC_CHANNELS.createOrganization, input),
  updateOrganization: (input) => ipcRenderer.invoke(IPC_CHANNELS.updateOrganization, input),
  deleteOrganization: (input) => ipcRenderer.invoke(IPC_CHANNELS.deleteOrganization, input),

  // Roles
  getRolesByOrgId: (orgId) => ipcRenderer.invoke(IPC_CHANNELS.getRolesByOrgId, orgId),
  getRole: (id) => ipcRenderer.invoke(IPC_CHANNELS.getRole, id),
  createRole: (input) => ipcRenderer.invoke(IPC_CHANNELS.createRole, input),
  updateRole: (input) => ipcRenderer.invoke(IPC_CHANNELS.updateRole, input),
  deleteRole: (id) => ipcRenderer.invoke(IPC_CHANNELS.deleteRole, id),

  // Skills
  getSkills: () => ipcRenderer.invoke(IPC_CHANNELS.getSkills),
  getSkill: (id) => ipcRenderer.invoke(IPC_CHANNELS.getSkill, id),
  createSkill: (input) => ipcRenderer.invoke(IPC_CHANNELS.createSkill, input),
  updateSkill: (input) => ipcRenderer.invoke(IPC_CHANNELS.updateSkill, input),
  deleteSkill: (id) => ipcRenderer.invoke(IPC_CHANNELS.deleteSkill, id),
  searchSkills: (input) => ipcRenderer.invoke(IPC_CHANNELS.searchSkills, input),

  // Templates
  getTemplates: () => ipcRenderer.invoke(IPC_CHANNELS.getTemplates),
  loadTemplate: (input) => ipcRenderer.invoke(IPC_CHANNELS.loadTemplate, input),

  // Tasks
  getTasksByOrgId: (orgId) => ipcRenderer.invoke(IPC_CHANNELS.getTasksByOrgId, orgId),
  getTask: (id) => ipcRenderer.invoke(IPC_CHANNELS.getTask, id),
  getTaskChildren: (parentId) => ipcRenderer.invoke(IPC_CHANNELS.getTaskChildren, parentId),
  createTask: (input) => ipcRenderer.invoke(IPC_CHANNELS.createTask, input),
  updateTaskStatus: (input) => ipcRenderer.invoke(IPC_CHANNELS.updateTaskStatus, input),
  deleteTask: (id) => ipcRenderer.invoke(IPC_CHANNELS.deleteTask, id),

  // Narrative
  getNarrative: (orgId) => ipcRenderer.invoke(IPC_CHANNELS.getNarrative, orgId),
  generateNarrative: (orgId) => ipcRenderer.invoke(IPC_CHANNELS.generateNarrative, orgId),
  getApprovalSummary: (taskId) => ipcRenderer.invoke(IPC_CHANNELS.getApprovalSummary, taskId),

  // Cost
  getCostSummary: (orgId) => ipcRenderer.invoke(IPC_CHANNELS.getCostSummary, orgId),
  getCostEntries: (orgId) => ipcRenderer.invoke(IPC_CHANNELS.getCostEntries, orgId),

  // Approval
  applyApprovalPreset: (input) => ipcRenderer.invoke(IPC_CHANNELS.applyApprovalPreset, input),
  getPendingApprovals: (orgId) => ipcRenderer.invoke(IPC_CHANNELS.getPendingApprovals, orgId),

  // Discussion
  getDiscussionGroupsByOrgId: (orgId) => ipcRenderer.invoke(IPC_CHANNELS.getDiscussionGroupsByOrgId, orgId),
  getDiscussionGroupByTaskNodeId: (taskNodeId) => ipcRenderer.invoke(IPC_CHANNELS.getDiscussionGroupByTaskNodeId, taskNodeId),
  getDiscussionMessages: (groupId) => ipcRenderer.invoke(IPC_CHANNELS.getDiscussionMessages, groupId),
  getDiscussionVoteStats: (groupId) => ipcRenderer.invoke(IPC_CHANNELS.getDiscussionVoteStats, groupId),
  postDiscussionMessage: (input) => ipcRenderer.invoke(IPC_CHANNELS.postDiscussionMessage, input),

  // Runs
  getRunsByOrgId: (orgId) => ipcRenderer.invoke(IPC_CHANNELS.getRunsByOrgId, orgId),
  getRun: (id) => ipcRenderer.invoke(IPC_CHANNELS.getRun, id),
  getRunsByTaskId: (taskNodeId) => ipcRenderer.invoke(IPC_CHANNELS.getRunsByTaskId, taskNodeId),
  getRunLog: (input) => ipcRenderer.invoke(IPC_CHANNELS.getRunLog, input),
  openRunLogFolder: (runId) => ipcRenderer.invoke(IPC_CHANNELS.openRunLogFolder, runId),
  startRun: (input) => ipcRenderer.invoke(IPC_CHANNELS.startRun, input),
  cancelRun: (id) => ipcRenderer.invoke(IPC_CHANNELS.cancelRun, id),

  // Budget
  resumeOrgRoles: (orgId) => ipcRenderer.invoke(IPC_CHANNELS.resumeOrgRoles, orgId),

  // Settings
  getSetting: (key) => ipcRenderer.invoke(IPC_CHANNELS.getSetting, key),
  updateSetting: (input) => ipcRenderer.invoke(IPC_CHANNELS.updateSetting, input),
  getLocale: () => ipcRenderer.invoke(IPC_CHANNELS.getLocale),

  // Conversation
  getActiveConversations: (orgId) => ipcRenderer.invoke(IPC_CHANNELS.getActiveConversations, orgId),
  getConversationHistory: (workflowId) => ipcRenderer.invoke(IPC_CHANNELS.getConversationHistory, workflowId),
  cancelConversation: (input) => ipcRenderer.invoke(IPC_CHANNELS.cancelConversation, input),
  getConversationMetrics: (orgId) => ipcRenderer.invoke(IPC_CHANNELS.getConversationMetrics, orgId),
  getConversationEvents: (workflowId) => ipcRenderer.invoke(IPC_CHANNELS.getConversationEvents, workflowId),
  getConversationAnalytics: (orgId, timeRange) => ipcRenderer.invoke(IPC_CHANNELS.getConversationAnalytics, orgId, timeRange),

  // Subscription
  subscribe: (callback: (event: DesktopEvent) => void) => {
    const listener = (
      _event: Electron.IpcRendererEvent,
      payload: DesktopEvent,
    ) => callback(payload);
    ipcRenderer.on(IPC_CHANNELS.rendererEvent, listener);
    return () => {
      ipcRenderer.removeListener(IPC_CHANNELS.rendererEvent, listener);
    };
  },
};

contextBridge.exposeInMainWorld('capibara', api);
