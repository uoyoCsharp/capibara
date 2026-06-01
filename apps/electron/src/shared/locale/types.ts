export type SupportedLocale = 'en-US' | 'zh-CN';

/**
 * Locale-keyed text bag used by data files (templates, workflows, etc.).
 * Open-ended Record so future locales can be added without code changes;
 * `resolveLocalized()` falls back to en-US, then any first available value.
 */
export type LocalizedText = Record<string, string>;

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
    toolPolicyLabel: string;
    toolPolicyPermissive: string;
    toolPolicyRestrictive: string;
    toolPolicyAskUser: string;
    fileAccessLabel: string;
    fileAccessPlaceholder: string;
    fileAccessHint: string;
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

  tasks: {
    title: string;
    countLabel: string;
    createBtn: string;
    noOrgSelected: string;
    empty: string;
    approve: string;
    reject: string;
    cancelHint: string;
    approveFailed: string;
    approveNoTransition: string;
    rejectFailed: string;
    rejectNoTransition: string;
    cancelSuccess: string;
    cancelFailed: string;
    createSuccess: string;
    createFailed: string;
    createFailedWith: string;
    deleteSuccess: string;
    deleteFailed: string;
    defaultTypeLabel: string;
    blockedBannerOne: string;
    blockedBannerMany: string;
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
    assigneePlaceholder: string;
    assigneeRequired: string;
    createTask: string;
    planningMode: {
      label: string;
      previewTitle: string;
      previewHint: string;
      eagerTitle: string;
      eagerHint: string;
    };
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
    srDescription: string;
    tabs: {
      details: string;
      runOutput: string;
    };
  };

  runOutput: {
    noRuns: string;
    runNumber: string;
    tokensLabel: string;
    summary: string;
    error: string;
    aiOutput: string;
    executionLog: string;
    linesSuffix: string;
    openLogs: string;
    openLogsTitle: string;
    loading: string;
    truncated: string;
    noLogsRecorded: string;
    waitingForOutput: string;
    statusLabels: {
      succeeded: string;
      failed: string;
      running: string;
      cancelled: string;
      suspended: string;
      interrupted: string;
    };
  };

  toolCalls: {
    title: string;
    noToolCalls: string;
    status: {
      running: string;
      completed: string;
      failed: string;
    };
    permission: {
      allowed: string;
      rejected: string;
      notRequested: string;
    };
  };

  collaboration: {
    title: string;
    noActiveSuspensions: string;
    suspendedSince: string;
    waitingFor: string;
    chainDepth: string;
    awaitingStatus: {
      pending: string;
      resolved: string;
    };
  };

  auditLog: {
    title: string;
    noEntries: string;
    tabs: {
      toolCalls: string;
      fileAccess: string;
    };
    columns: {
      time: string;
      tool: string;
      permission: string;
      path: string;
      operation: string;
      allowed: string;
    };
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
    acpAgent: string;
    network: string;
    installed: string;
    notInstalled: string;
    connected: string;
    disconnected: string;
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
    chooseRoleTemplate: string;
    chooseWorkflowTemplate: string;
    viewDetails: string;
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
    skillsBadge: string;
    reportsBadge: string;
  };

  executionControl: {
    pauseAll: string;
    resumeAll: string;
    pausedToast: string;
    resumedToast: string;
    statusPaused: string;
    statusAwaitingReview: string;
    statusAwaitingReviewN: string;
    statusRunning: string;
    statusIdle: string;
    idleHint: string;
    resumeInterrupted: string;
    resumeInterruptedN: string;
    resumeInterruptedTooltip: string;
    resumeInterruptedToast: string;
    resumeInterruptedNoneToast: string;
  };

  settings: {
    title: string;
    save: string;
    saving: string;
    language: {
      title: string;
      english: string;
      chinese: string;
    };
    system: {
      title: string;
      checkHealth: string;
      healthOk: string;
    };
    modelSelector: {
      title: string;
      unsupported: string;
      unsupportedHint: string;
      placeholder: string;
      active: string;
      hint: string;
      saveError: string;
      detect: string;
      detecting: string;
      detectError: string;
    };
    agentConfig: {
      title: string;
      description: string;
      agentName: string;
      agentCommand: string;
      agentStatus: string;
      defaultAgent: string;
      denyPatterns: string;
      collaborationTitle: string;
      collaborationDescription: string;
      maxChainDepth: string;
      maxBroadcastTargets: string;
      maxResumeCount: string;
      inquiryTimeoutMs: string;
    };
    devMode: {
      title: string;
      description: string;
      enabled: string;
      disabled: string;
    };
    logs: {
      title: string;
      description: string;
      totalSize: string;
      fileCount: string;
      oldest: string;
      newest: string;
      clearOld: string;
      clearAll: string;
      confirmClearOld: string;
      confirmClearAll: string;
      confirm: string;
      deleteResult: string;
    };
  };

  dashboard: {
    title: string;
    noOrgSelected: string;
    startPlanning: {
      title: string;
      description: string;
      cta: string;
    };
    stats: {
      activeTasks: string;
      aiRoles: string;
      activeConversations: string;
      activeRuns: string;
    };
  };

  planning: {
    noOrgSelected: string;
    loading: string;
    preparingSession: string;
    withAgent: string;
    defaultAgent: string;
    backToDashboard: string;
    cancelSession: string;
    discardTitle: string;
    discardMessage: string;
    keepChatting: string;
    discard: string;
    sessionDiscarded: string;
    failedToStart: string;
    failedToCancel: string;
    tasksCreated: string;
    firstMessage: {
      title: string;
      subtitle: string;
      placeholder: string;
      submit: string;
      starting: string;
      shortcutHint: string;
    };
    history: {
      title: string;
      newSession: string;
      empty: string;
      untitled: string;
      backToHistory: string;
      notFound: string;
      deleteTitle: string;
      deleteMessage: string;
      deleteFailed: string;
    };
  };

  planningChat: {
    startingConversation: string;
    aiBusyLabel: string;
    thinking: string;
    thinkingWithTime: string;
    inputPlaceholder: string;
    thinkingPlaceholder: string;
    you: string;
    system: string;
    failedResponse: string;
    cancelled: string;
    readOnlyNotice: string;
    progressToolCallStatus: {
      running: string;
      completed: string;
      failed: string;
    };
  };

  planPreview: {
    title: string;
    loading: string;
    waitingTitle: string;
    waitingDescription: string;
    summaryVersion: string;
    summaryNodes: string;
    summaryDepth: string;
    summaryByType: string;
    approve: string;
    approving: string;
    discardBtn: string;
    discarding: string;
    refine: string;
    refineTitle: string;
    refinePlaceholder: string;
    refineSend: string;
    refineSending: string;
    refineClose: string;
    toastApproved: string;
    toastDiscarded: string;
    toastRefineSent: string;
    errorApprove: string;
    errorDiscard: string;
    errorRefine: string;
  };

  planAgentPicker: {
    title: string;
    description: string;
    noRoles: string;
    continue: string;
  };

  inbox: {
    title: string;
    noOrgSelected: string;
    noConversationSelected: string;
    summary: string;
    blockedSection: string;
    monitoringSection: string;
    resolvedSection: string;
    resolve: string;
    cancelConversation: string;
    replyPlaceholder: string;
    waitingForAIPlaceholder: string;
    aiProcessing: string;
    humanFallback: string;
    systemAuthor: string;
    types: {
      inquiry: string;
      planning: string;
      adhoc: string;
      planReview: string;
    };
    planReviewMissingRoot: string;
    planReviewLoading: string;
    planReviewCompleted: string;
    planReviewNoTree: string;
  };

  planTreeReview: {
    title: string;
    previewModeHint: string;
    eagerModeHint: string;
    nodes: string;
    depth: string;
    roleDistribution: string;
    refineTitle: string;
    refinePlaceholder: string;
    refineClose: string;
    refineSend: string;
    refineWaiting: string;
    refineBtn: string;
    discardReason: string;
    discardPlaceholder: string;
    discardBtn: string;
    discardPlan: string;
    approveBtn: string;
    approveCommitting: string;
    cancelBtn: string;
    closeBtn: string;
  };

  orgSettings: {
    title: string;
    noOrgSelected: string;
    nameLabel: string;
    descriptionLabel: string;
    customInstructionsLabel: string;
    customInstructionsHelpTitle: string;
    customInstructionsHelpBody: string;
    statusLabel: string;
    statusActive: string;
    statusPaused: string;
    statusArchived: string;
    autoStartLabel: string;
    autoStartDescription: string;
    workspacePathLabel: string;
    workspacePathNotSet: string;
    save: string;
    saving: string;
    deleteBtn: string;
    deleteTitle: string;
    deleteMessage: string;
  };

  autoUpdate: {
    availableWithVersion: string;  // contains {version}
    availableNoVersion: string;
    readyToInstall: string;
    dialogTitle: string;
    dialogMessage: string;  // contains {version}
    dialogDetail: string;
    restartNow: string;
    later: string;
  };

  narrative: {
    sections: {
      whereWeAre: string;
      team: string;
      attention: string;
      usage: string;
    };
    whereWeAre: {
      noActiveWork: string;
      inProgress: string;
      blocked: string;
      awaitingReview: string;
      activeRuns: string;
      quietMoment: string;
    };
    team: {
      noRoles: string;
      multipleRoles: string;
      singleRole: string;
    };
    attention: {
      inquiriesWaiting: string;
      tasksAwaitingApproval: string;
      body: string;
      separator: string;
    };
    usage: {
      summary: string;
      failedRuns: string;
    };
    headline: {
      needsAttention: string;
      activeProgress: string;
      allClear: string;
      readyToStart: string;
    };
  };

  devPanel: {
    title: string;
    checkConnections: string;
    scanning: string;
    noData: string;
    errorPrefix: string;
    agents: {
      title: string;
      processAlive: string;
      processDead: string;
      pid: string;
      connected: string;
      disconnected: string;
      transport: string;
      sessions: string;
      restart: string;
      restartConfirm: string;
      restartSuccess: string;
      restartError: string;
    };
    mcp: {
      title: string;
      listening: string;
      notListening: string;
      port: string;
      sseConnected: string;
      sseDisconnected: string;
      httpReady: string;
      httpNotReady: string;
      reconnect: string;
      reconnectConfirm: string;
      reconnectSuccess: string;
      reconnectError: string;
    };
    sessions: {
      title: string;
      empty: string;
      id: string;
      agent: string;
      status: string;
      suspendReason: string;
      liveConnection: string;
      lastActivity: string;
      close: string;
      closeConfirm: string;
      closeSuccess: string;
      closeError: string;
    };
  };
}
