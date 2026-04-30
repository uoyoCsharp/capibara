import type { LocaleMessages } from './types.js';

export const enUS: LocaleMessages = {
  sections: {
    dashboard: 'Dashboard',
    tasks: 'Tasks',
    inbox: 'Inbox',
    team: 'Team',
    settings: 'Settings',
  },

  workspace: {
    switchWorkspace: 'Switch Workspace',
    createNewSpace: 'Create New Space',
    userPreferences: 'User Preferences',
  },

  status: {
    active: 'Active',
    paused: 'Paused',
    archived: 'Archived',
    idle: 'Idle',
  },

  common: {
    loading: 'Loading...',
    save: 'Save',
    cancel: 'Cancel',
    delete: 'Delete',
    collapse: 'Collapse',
    expand: 'Expand',
    close: 'Close',
    browse: 'Browse',
    back: 'Back',
  },

  createOrg: {
    workspaceLabel: 'Workspace Folder',
    workspacePlaceholder: 'Select a folder...',
  },

  organization: {
    failedToCreateRole: 'Failed to create role',
    failedToUpdateRole: 'Failed to update role',
    failedToDeleteRole: 'Failed to delete role',
  },

  roleDrawer: {
    title: 'Configure Role',
    subtitle: 'Edit role configuration and permissions',
    nameLabel: 'Name',
    nameRequired: 'Name is required',
    statusLabel: 'Status',
    parentRoleLabel: 'Parent Role',
    noneRoot: 'None (Root)',
    personaLabel: 'Persona',
    personaPlaceholder: "Describe the role's persona, responsibilities, and behavior...",
    skillsLabel: 'Skills',
    knowledgeBaseLabel: 'Knowledge Base References',
    knowledgePlaceholder: 'One reference per line...',
    permissionsLabel: 'Permissions',
    canApprove: 'Can Approve',
    canDelegate: 'Can Delegate',
    requiresHumanApproval: 'Requires Human Approval',
    deleteWithChildren: 'Delete Role with Children?',
    deleteWithChildrenMessage: 'This role has child roles. They will become orphaned (moved to root level) after deletion.',
    deleteAnyway: 'Delete Anyway',
  },

  skillSelector: {
    closeSelector: 'Close skill selector',
    selectSkills: 'Select skills',
    searchPlaceholder: 'Search skills...',
    noSkillsFound: 'No skills found',
  },

  taskCreate: {
    createChild: 'Create Child Task',
    createNew: 'Create New Task',
    titleLabel: 'Title',
    titlePlaceholder: 'Enter task title...',
    titleRequired: 'Title is required',
    typeLabel: 'Type',
    descriptionLabel: 'Description',
    descriptionPlaceholder: 'Describe the task...',
    assigneeLabel: 'Assignee Role',
    assigneeRequired: 'Assignee role is required',
    createTask: 'Create Task',
  },

  taskDetail: {
    actions: 'Actions',
    assignee: 'Assignee',
    created: 'Created',
    description: 'Description',
    start: 'Start',
    unassigned: 'Unassigned',
    updated: 'Updated',
    deleteConfirmTitle: 'Delete Task?',
    deleteConfirmMessage: 'This action cannot be undone. The task and its data will be permanently removed.',
  },

  runs: {
    completed: 'Run completed',
    failed: 'Run failed — click Execution to see details',
    cancelled: 'Run cancelled',
  },

  conversations: {
    humanReplyNotification: 'Human reply needed',
    goToConversations: 'Go to Conversations',
  },

  onboarding: {
    healthCheck: 'Environment Health Check',
    healthCheckDesc: "Let's make sure everything is ready for a smooth experience.",
    nodejs: 'Node.js',
    claudeCli: 'Claude Code CLI',
    network: 'Network Connectivity',
    installed: 'Installed',
    notInstalled: 'Not installed',
    connected: 'Connected',
    disconnected: 'Disconnected',
    installCommand: 'npm install -g @anthropic-ai/claude-code',
    copied: 'Copied!',
    retryCheck: 'Retry Check',
    continueAnyway: 'Continue anyway',
    continueNext: 'Continue',
    allPassed: 'All checks passed!',
    namingTitle: 'Name Your Space',
    namingSubtitle: 'Give your project a home and pick a workflow template.',
    spaceName: 'Space Name',
    spaceNamePlaceholder: 'e.g., Acme Corp Next-Gen MVP',
    chooseTemplate: 'Choose a Workflow Template',
    recommended: 'Recommended',
    agents: 'Agents',
    letsGo: "Let's Go",
    creating: 'Creating...',
  },

  workspacePage: {
    title: 'Workspace Settings',
  },

  teamPage: {
    title: 'Team',
    subtitle: 'Your AI workforce hierarchy and role configuration.',
    noOrgSelected: 'No workspace selected',
    noOrgHint: 'Select or create a workspace to manage your AI team.',
    addAgent: 'Add Agent',
    reportsTo: 'Reports to',
    humanApprovalBadge: 'Human Approval',
    noRoles: 'No roles yet',
    noRolesHint: 'Add your first agent to get started.',
    rolesCount: 'agents',
  },

  executionControl: {
    pauseAll: 'Pause All',
    resumeAll: 'Resume All',
    pausedToast: 'Execution paused — all runs stopped',
    resumedToast: 'Execution resumed',
  },
};
