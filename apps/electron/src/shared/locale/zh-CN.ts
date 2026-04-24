import type { LocaleMessages } from './types.js';

export const zhCN: LocaleMessages = {
  sections: {
    dashboard: '仪表盘',
    tasks: '任务',
    inbox: '收件箱',
    planning: '规划',
    team: '团队',
    settings: '设置',
  },

  workspace: {
    switchWorkspace: '切换工作空间',
    createNewSpace: '创建新空间',
    userPreferences: '用户偏好',
  },

  status: {
    active: '运行中',
    paused: '已暂停',
    archived: '已归档',
    idle: '空闲',
  },

  common: {
    loading: '加载中...',
    save: '保存',
    cancel: '取消',
    delete: '删除',
    collapse: '收起',
    expand: '展开',
    close: '关闭',
    browse: '浏览',
  },

  createOrg: {
    workspaceLabel: '工作目录',
    workspacePlaceholder: '选择一个文件夹...',
  },

  organization: {
    failedToCreateRole: '创建角色失败',
    failedToUpdateRole: '更新角色失败',
    failedToDeleteRole: '删除角色失败',
  },

  roleDrawer: {
    title: '配置角色',
    subtitle: '编辑角色配置和权限',
    nameLabel: '名称',
    nameRequired: '名称为必填项',
    statusLabel: '状态',
    parentRoleLabel: '上级角色',
    noneRoot: '无（根角色）',
    personaLabel: '人设',
    personaPlaceholder: '描述角色的人设、职责和行为...',
    skillsLabel: '技能',
    knowledgeBaseLabel: '知识库引用',
    knowledgePlaceholder: '每行一个引用...',
    permissionsLabel: '权限',
    canApprove: '可以审批',
    canDelegate: '可以委派',
    requiresHumanApproval: '需要人工审批',
    deleteWithChildren: '删除角色及其子角色？',
    deleteWithChildrenMessage: '该角色有子角色。删除后，子角色将变为孤立角色（移至根级别）。',
    deleteAnyway: '仍然删除',
  },

  skillSelector: {
    closeSelector: '关闭技能选择器',
    selectSkills: '选择技能',
    searchPlaceholder: '搜索技能...',
    noSkillsFound: '未找到技能',
  },

  taskCreate: {
    createChild: '创建子任务',
    createNew: '新建任务',
    titleLabel: '标题',
    titlePlaceholder: '输入任务标题...',
    titleRequired: '标题为必填项',
    typeLabel: '类型',
    descriptionLabel: '描述',
    descriptionPlaceholder: '描述任务...',
    assigneeLabel: '指派角色',
    assigneeRequired: '负责人为必填项',
    createTask: '创建任务',
  },

  taskDetail: {
    actions: '操作',
    assignee: '指派',
    created: '创建时间',
    description: '描述',
    start: '启动',
    unassigned: '未分配',
    updated: '更新时间',
    deleteConfirmTitle: '删除任务？',
    deleteConfirmMessage: '此操作不可撤销。任务及其数据将被永久删除。',
  },

  runs: {
    completed: '运行已完成',
    failed: '运行失败 — 点击"执行"查看详情',
    cancelled: '运行已取消',
  },

  conversations: {
    humanReplyNotification: '需要人工回复',
    goToConversations: '前往对话管理',
  },

  onboarding: {
    healthCheck: '环境自检',
    healthCheckDesc: '确保一切就绪，享受流畅体验。',
    nodejs: 'Node.js',
    claudeCli: 'Claude Code CLI',
    network: '网络连通性',
    installed: '已安装',
    notInstalled: '未安装',
    connected: '已连接',
    disconnected: '未连接',
    installCommand: 'npm install -g @anthropic-ai/claude-code',
    copied: '已复制！',
    retryCheck: '重新检测',
    continueAnyway: '跳过继续',
    continueNext: '继续',
    allPassed: '所有检测通过！',
    namingTitle: '为你的空间命名',
    namingSubtitle: '为你的项目创建一个家，并选择工作流模版。',
    spaceName: '空间名称',
    spaceNamePlaceholder: '例如：新一代 MVP 项目',
    chooseTemplate: '选择工作流模版',
    recommended: '推荐',
    agents: '智能体',
    letsGo: '开始吧',
    creating: '创建中...',
  },

  workspacePage: {
    title: '工作空间设置',
  },

  teamPage: {
    title: '团队',
    subtitle: '你的 AI 团队组织结构与角色配置。',
    noOrgSelected: '未选择工作空间',
    noOrgHint: '选择或创建一个工作空间以管理你的 AI 团队。',
    addAgent: '添加智能体',
    reportsTo: '汇报给',
    humanApprovalBadge: '需人工审批',
    noRoles: '暂无角色',
    noRolesHint: '添加你的第一个智能体以开始。',
    rolesCount: '个智能体',
  },

  executionControl: {
    pauseAll: '暂停全部',
    resumeAll: '恢复全部',
    pausedToast: '执行已暂停 — 所有运行已停止',
    resumedToast: '执行已恢复',
  },
};
