export type SupportedLocale = 'en-US' | 'zh-CN';

/**
 * Strictly typed locale message shape.
 *
 * Every key here is statically referenced by renderer code (verified via
 * the phase-13 audit). Adding new UI strings: extend this interface, add
 * the key to both en-US.ts and zh-CN.ts. The `locale-symmetry.test.ts`
 * test catches drift.
 */
export interface LocaleMessages {
  sections: {
    dashboard: string;
    tasks: string;
    inbox: string;
    team: string;
    settings: string;
  };

  workspace: {
    switchWorkspace: string;
    createNewSpace: string;
    userPreferences: string;
  };

  status: {
    active: string;
    paused: string;
    archived: string;
    idle: string;
  };

  common: {
    loading: string;
    save: string;
    cancel: string;
    delete: string;
    collapse: string;
    expand: string;
    close: string;
    browse: string;
    back: string;
  };

  createOrg: {
    workspaceLabel: string;
    workspacePlaceholder: string;
  };

  organization: {
    failedToCreateRole: string;
    failedToUpdateRole: string;
    failedToDeleteRole: string;
  };

  roleDrawer: {
    title: string;
    subtitle: string;
    nameLabel: string;
    nameRequired: string;
    statusLabel: string;
    parentRoleLabel: string;
    noneRoot: string;
    personaLabel: string;
    personaPlaceholder: string;
    skillsLabel: string;
    knowledgeBaseLabel: string;
    knowledgePlaceholder: string;
    permissionsLabel: string;
    canApprove: string;
    canDelegate: string;
    requiresHumanApproval: string;
    deleteWithChildren: string;
    deleteWithChildrenMessage: string;
    deleteAnyway: string;
  };

  skillSelector: {
    closeSelector: string;
    selectSkills: string;
    searchPlaceholder: string;
    noSkillsFound: string;
  };

  taskCreate: {
    createChild: string;
    createNew: string;
    titleLabel: string;
    titlePlaceholder: string;
    titleRequired: string;
    typeLabel: string;
    descriptionLabel: string;
    descriptionPlaceholder: string;
    assigneeLabel: string;
    assigneeRequired: string;
    createTask: string;
  };

  taskDetail: {
    actions: string;
    assignee: string;
    created: string;
    description: string;
    start: string;
    unassigned: string;
    updated: string;
    deleteConfirmTitle: string;
    deleteConfirmMessage: string;
  };

  runs: {
    completed: string;
    failed: string;
    cancelled: string;
  };

  conversations: {
    humanReplyNotification: string;
    goToConversations: string;
  };

  planReview: {
    title: string;
    previewHint: string;
    eagerHint: string;
    noTree: string;
    completed: string;
    missingRootTaskId: string;
  };

  onboarding: {
    healthCheck: string;
    healthCheckDesc: string;
    nodejs: string;
    claudeCli: string;
    network: string;
    installed: string;
    notInstalled: string;
    connected: string;
    disconnected: string;
    installCommand: string;
    copied: string;
    retryCheck: string;
    continueAnyway: string;
    continueNext: string;
    allPassed: string;
    namingTitle: string;
    namingSubtitle: string;
    spaceName: string;
    spaceNamePlaceholder: string;
    chooseTemplate: string;
    recommended: string;
    agents: string;
    letsGo: string;
    creating: string;
  };

  workspacePage: {
    title: string;
  };

  teamPage: {
    title: string;
    subtitle: string;
    noOrgSelected: string;
    noOrgHint: string;
    addAgent: string;
    reportsTo: string;
    humanApprovalBadge: string;
    noRoles: string;
    noRolesHint: string;
    rolesCount: string;
  };

  executionControl: {
    pauseAll: string;
    resumeAll: string;
    pausedToast: string;
    resumedToast: string;
  };
}
