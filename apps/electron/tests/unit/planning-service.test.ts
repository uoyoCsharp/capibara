import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('tsyringe', () => ({
  injectable: () => (target: any) => target,
  inject: () => () => undefined,
}));

vi.mock('@main/core/tokens.js', () => ({
  ROLE_REPO_TOKEN: Symbol('ROLE_REPO_TOKEN'),
  SKILL_REPO_TOKEN: Symbol('SKILL_REPO_TOKEN'),
  TASK_REPO_TOKEN: Symbol('TASK_REPO_TOKEN'),
  LOGGER_TOKEN: Symbol('LOGGER_TOKEN'),
}));

vi.mock('@main/core/errors/capibara.errors.js', () => ({
  ValidationError: class ValidationError extends Error {
    constructor(msg: string) { super(msg); this.name = 'ValidationError'; }
  },
}));

import { PlanningService } from '../../src/main/application/planning/planning.service.js';
import { PendingPlanStore } from '../../src/main/application/planning/pending-plan.store.js';

// ─── Mock factories ────────────────────────────────────────────
function createRole(overrides: Record<string, unknown> = {}) {
  return {
    id: 'role-1',
    orgId: 'org-1',
    name: 'Test Role',
    parentId: null,
    persona: '',
    knowledgeBaseRefs: [],
    skillIds: [],
    canApprove: false,
    canDelegate: false,
    requiresHumanApproval: false,
    consecutiveWakeCount: 0,
    isSystemRole: false,
    status: 'active' as const,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

function createSkill(overrides: Record<string, unknown> = {}) {
  return {
    id: 'skill-1',
    name: 'Test Skill',
    command: '/test',
    description: 'A test skill',
    category: 'general' as const,
    source: 'builtin' as const,
    orgTemplateId: null,
    customPromptContent: null,
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

function createMocks() {
  const roleRepo = {
    findByOrgId: vi.fn(),
    findById: vi.fn(),
    findByIds: vi.fn(),
    findChildren: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  };
  const skillRepo = {
    findById: vi.fn(),
    findAll: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    search: vi.fn(),
  };
  const taskRepo = {
    findById: vi.fn(),
    findByOrgId: vi.fn(),
    findByParentId: vi.fn(),
    create: vi.fn(),
    delete: vi.fn(),
    setArtifactPaths: vi.fn(),
    updateAssignee: vi.fn(),
  };
  const logger = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  };
  const executionEngine = {
    startRun: vi.fn(),
  };
  const taskService = {
    create: vi.fn(),
    updateStatus: vi.fn(),
    delete: vi.fn(),
  };
  const workflowEngine = {
    getRootTypes: vi.fn(),
    isTerminalStatus: vi.fn(),
    getFirstTerminalStatus: vi.fn(),
  };
  const conversationWorkflowRepo = {
    findActiveByRoleAndTask: vi.fn(),
    updateState: vi.fn(),
  };
  const orgRepo = {
    findById: vi.fn(),
  };
  const discussionRepo = {
    findGroupByTaskNodeId: vi.fn(),
    postMessage: vi.fn(),
  };

  return { roleRepo, skillRepo, taskRepo, logger, executionEngine, taskService, workflowEngine, conversationWorkflowRepo, orgRepo, discussionRepo };
}

function createService(mocks: ReturnType<typeof createMocks>) {
  const service = new PlanningService(
    mocks.roleRepo as any,
    mocks.skillRepo as any,
    mocks.taskRepo as any,
    mocks.logger as any,
  );
  service.setExecutionEngine(mocks.executionEngine as any);
  service.setTaskService(mocks.taskService as any);
  service.setWorkflowEngine(mocks.workflowEngine as any);
  service.setConversationWorkflowRepo(mocks.conversationWorkflowRepo as any);
  service.setOrgRepo(mocks.orgRepo as any);
  service.setDiscussionRepo(mocks.discussionRepo as any);
  return service;
}

// ─── Tests ─────────────────────────────────────────────────────

describe('PlanningService', () => {
  describe('selectPlanningRole', () => {
    it('should select a role with PM-related skills', async () => {
      const mocks = createMocks();
      const pmRole = createRole({ id: 'pm-role', name: 'Product Manager', skillIds: ['skill-prd'] });
      const devRole = createRole({ id: 'dev-role', name: 'Developer', skillIds: ['skill-impl'] });
      mocks.roleRepo.findByOrgId.mockResolvedValue([devRole, pmRole]);
      mocks.skillRepo.findById.mockImplementation(async (id: string) => {
        if (id === 'skill-prd') return createSkill({ id: 'skill-prd', command: '/bmad-create-prd' });
        if (id === 'skill-impl') return createSkill({ id: 'skill-impl', command: '/implement' });
        return null;
      });

      const service = createService(mocks);
      const role = await service.selectPlanningRole('org-1');

      expect(role.id).toBe('pm-role');
    });

    it('should fall back to root role when no PM skills found', async () => {
      const mocks = createMocks();
      const rootRole = createRole({ id: 'root', name: 'Root', parentId: null, skillIds: [] });
      const childRole = createRole({ id: 'child', name: 'Child', parentId: 'root', skillIds: [] });
      mocks.roleRepo.findByOrgId.mockResolvedValue([childRole, rootRole]);

      const service = createService(mocks);
      const role = await service.selectPlanningRole('org-1');

      expect(role.id).toBe('root');
    });

    it('should throw when org has no roles', async () => {
      const mocks = createMocks();
      mocks.roleRepo.findByOrgId.mockResolvedValue([]);

      const service = createService(mocks);

      await expect(service.selectPlanningRole('org-1')).rejects.toThrow(
        /no roles/i,
      );
    });

    it('should skip paused roles and only consider active ones', async () => {
      const mocks = createMocks();
      const pausedPm = createRole({ id: 'pm', name: 'PM', status: 'paused', skillIds: ['s1'] });
      const activeRoot = createRole({ id: 'root', name: 'Root', parentId: null });
      mocks.roleRepo.findByOrgId.mockResolvedValue([pausedPm, activeRoot]);

      const service = createService(mocks);
      const role = await service.selectPlanningRole('org-1');

      expect(role.id).toBe('root');
    });

    it('should use first active role as last resort when no PM or root', async () => {
      const mocks = createMocks();
      const child1 = createRole({ id: 'c1', name: 'Dev', parentId: 'some-parent', skillIds: [] });
      const child2 = createRole({ id: 'c2', name: 'QA', parentId: 'some-parent', skillIds: [], status: 'paused' });
      mocks.roleRepo.findByOrgId.mockResolvedValue([child2, child1]);

      const service = createService(mocks);
      const role = await service.selectPlanningRole('org-1');

      expect(role.id).toBe('c1');
    });

    it('should throw when all roles are paused', async () => {
      const mocks = createMocks();
      const paused1 = createRole({ id: 'p1', status: 'paused' });
      const paused2 = createRole({ id: 'p2', status: 'paused' });
      mocks.roleRepo.findByOrgId.mockResolvedValue([paused1, paused2]);

      const service = createService(mocks);

      await expect(service.selectPlanningRole('org-1')).rejects.toThrow(/no active roles/i);
    });
  });

  describe('buildPlanningContext', () => {
    it('should return org roles with skill descriptions', async () => {
      const mocks = createMocks();
      const role = createRole({ id: 'r1', name: 'Architect', skillIds: ['s1', 's2'] });
      mocks.roleRepo.findByOrgId.mockResolvedValue([role]);
      mocks.skillRepo.findById.mockImplementation(async (id: string) => {
        if (id === 's1') return createSkill({ description: 'System design' });
        if (id === 's2') return createSkill({ description: 'API design' });
        return null;
      });

      const service = createService(mocks);
      const ctx = await service.buildPlanningContext('org-1');

      expect(ctx.orgRoles).toHaveLength(1);
      expect(ctx.orgRoles[0].name).toBe('Architect');
      expect(ctx.orgRoles[0].skillDescriptions).toEqual(['System design', 'API design']);
    });

    it('should skip paused roles in planning context', async () => {
      const mocks = createMocks();
      const active = createRole({ id: 'r1', name: 'Active', status: 'active' });
      const paused = createRole({ id: 'r2', name: 'Paused', status: 'paused' });
      mocks.roleRepo.findByOrgId.mockResolvedValue([active, paused]);

      const service = createService(mocks);
      const ctx = await service.buildPlanningContext('org-1');

      expect(ctx.orgRoles).toHaveLength(1);
      expect(ctx.orgRoles[0].name).toBe('Active');
    });

    it('should use skill name as fallback when description is empty', async () => {
      const mocks = createMocks();
      const role = createRole({ id: 'r1', name: 'Dev', skillIds: ['s1'] });
      mocks.roleRepo.findByOrgId.mockResolvedValue([role]);
      mocks.skillRepo.findById.mockResolvedValue(createSkill({ name: 'Code Review', description: '' }));

      const service = createService(mocks);
      const ctx = await service.buildPlanningContext('org-1');

      expect(ctx.orgRoles[0].skillDescriptions).toEqual(['Code Review']);
    });
  });

  describe('startPlanningRun', () => {
    it('should create a planning task with plan type and start a run', async () => {
      const mocks = createMocks();
      const pmRole = createRole({ id: 'pm', name: 'PM', skillIds: ['s1'] });
      mocks.roleRepo.findByOrgId.mockResolvedValue([pmRole]);
      mocks.taskRepo.findByOrgId.mockResolvedValue([]);
      mocks.skillRepo.findById.mockResolvedValue(
        createSkill({ command: '/bmad-product-brief' }),
      );
      mocks.taskService.create.mockResolvedValue({
        id: 'task-1',
        orgId: 'org-1',
        title: 'Planning: Build a todo app',
      });
      mocks.executionEngine.startRun.mockResolvedValue({ id: 'run-1' });

      const service = createService(mocks);
      const result = await service.startPlanningRun('org-1', 'Build a todo app');

      expect(result.runId).toBe('run-1');
      expect(result.taskId).toBe('task-1');
      expect(result.roleId).toBe('pm');

      expect(mocks.taskService.create).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Planning: Build a todo app',
          type: 'plan',
          assigneeRoleId: 'pm',
        }),
      );
    });

    it('should truncate long initial messages in task title', async () => {
      const mocks = createMocks();
      const rootRole = createRole({ id: 'root', parentId: null });
      mocks.roleRepo.findByOrgId.mockResolvedValue([rootRole]);
      mocks.taskRepo.findByOrgId.mockResolvedValue([]);
      mocks.taskService.create.mockResolvedValue({ id: 't1', orgId: 'org-1' });
      mocks.executionEngine.startRun.mockResolvedValue({ id: 'r1' });

      const service = createService(mocks);
      const longMessage = 'A'.repeat(100);
      await service.startPlanningRun('org-1', longMessage);

      const createCall = mocks.taskService.create.mock.calls[0][0];
      expect(createCall.title.length).toBeLessThanOrEqual(64); // "Planning: " (10) + 50 + "..." (3) = 63
    });

    it('should use explicit roleId when provided', async () => {
      const mocks = createMocks();
      const explicitRole = createRole({ id: 'explicit-role', name: 'CTO' });
      mocks.roleRepo.findById.mockResolvedValue(explicitRole);
      mocks.taskRepo.findByOrgId.mockResolvedValue([]);
      mocks.taskService.create.mockResolvedValue({ id: 't1', orgId: 'org-1' });
      mocks.executionEngine.startRun.mockResolvedValue({ id: 'r1' });

      const service = createService(mocks);
      const result = await service.startPlanningRun('org-1', 'my idea', 'explicit-role');

      expect(result.roleId).toBe('explicit-role');
      expect(mocks.taskService.create).toHaveBeenCalledWith(
        expect.objectContaining({ assigneeRoleId: 'explicit-role' }),
      );
      // Should NOT call findByOrgId (auto-select path)
      expect(mocks.roleRepo.findByOrgId).not.toHaveBeenCalled();
    });

    it('should throw when explicit roleId does not exist', async () => {
      const mocks = createMocks();
      mocks.roleRepo.findById.mockResolvedValue(null);
      mocks.taskRepo.findByOrgId.mockResolvedValue([]);

      const service = createService(mocks);

      await expect(service.startPlanningRun('org-1', 'idea', 'nonexistent'))
        .rejects.toThrow(/not found/i);
    });

    it('should reject concurrent planning sessions', async () => {
      const mocks = createMocks();
      // Existing active planning session
      mocks.taskRepo.findByOrgId.mockResolvedValue([{
        id: 'existing-task', type: 'plan', title: 'Planning: old', parentId: null,
        status: 'in_progress', assigneeRoleId: 'role-1', orgId: 'org-1',
      }]);
      mocks.conversationWorkflowRepo.findActiveByRoleAndTask.mockResolvedValue(null);
      mocks.roleRepo.findById.mockResolvedValue(createRole());

      const service = createService(mocks);

      await expect(service.startPlanningRun('org-1', 'new idea'))
        .rejects.toThrow(/already active/i);
    });
  });

  describe('getActivePlanningSession', () => {
    it('should return null when no planning tasks exist', async () => {
      const mocks = createMocks();
      mocks.taskRepo.findByOrgId.mockResolvedValue([]);

      const service = createService(mocks);
      const session = await service.getActivePlanningSession('org-1');

      expect(session).toBeNull();
    });

    it('should return active planning session with conversation workflow', async () => {
      const mocks = createMocks();
      const planningTask = {
        id: 'task-1', type: 'plan', title: 'Planning: My idea',
        parentId: null, status: 'in_progress', assigneeRoleId: 'role-1', orgId: 'org-1',
      };
      mocks.taskRepo.findByOrgId.mockResolvedValue([planningTask]);
      mocks.conversationWorkflowRepo.findActiveByRoleAndTask.mockResolvedValue({
        id: 'wf-1', discussionGroupId: 'grp-1', state: 'waiting_for_reply',
      });
      mocks.roleRepo.findById.mockResolvedValue(createRole({ id: 'role-1', name: 'PM' }));

      const service = createService(mocks);
      const session = await service.getActivePlanningSession('org-1');

      expect(session).not.toBeNull();
      expect(session!.taskId).toBe('task-1');
      expect(session!.workflowId).toBe('wf-1');
      expect(session!.workflowState).toBe('waiting_for_reply');
    });

    it('should skip terminal planning tasks (done status)', async () => {
      const mocks = createMocks();
      mocks.taskRepo.findByOrgId.mockResolvedValue([{
        id: 'task-1', type: 'plan', title: 'Planning: Done',
        parentId: null, status: 'done', assigneeRoleId: 'role-1', orgId: 'org-1',
      }]);

      const service = createService(mocks);
      const session = await service.getActivePlanningSession('org-1');

      expect(session).toBeNull();
    });

    it('should detect legacy epic-type planning tasks by title prefix', async () => {
      const mocks = createMocks();
      const legacyTask = {
        id: 'task-legacy', type: 'epic', title: 'Project Planning: old idea',
        parentId: null, status: 'in_progress', assigneeRoleId: 'role-1', orgId: 'org-1',
      };
      mocks.taskRepo.findByOrgId.mockResolvedValue([legacyTask]);
      mocks.workflowEngine.isTerminalStatus.mockResolvedValue(false);
      mocks.conversationWorkflowRepo.findActiveByRoleAndTask.mockResolvedValue(null);
      mocks.roleRepo.findById.mockResolvedValue(createRole({ id: 'role-1', name: 'PM' }));

      const service = createService(mocks);
      const session = await service.getActivePlanningSession('org-1');

      expect(session).not.toBeNull();
      expect(session!.taskId).toBe('task-legacy');
    });

    it('should skip legacy tasks that are in terminal status', async () => {
      const mocks = createMocks();
      mocks.taskRepo.findByOrgId.mockResolvedValue([{
        id: 'task-legacy', type: 'epic', title: 'Project Planning: done',
        parentId: null, status: 'done', assigneeRoleId: 'role-1', orgId: 'org-1',
      }]);
      mocks.workflowEngine.isTerminalStatus.mockResolvedValue(true);

      const service = createService(mocks);
      const session = await service.getActivePlanningSession('org-1');

      expect(session).toBeNull();
    });

    it('should return session even without active conversation workflow', async () => {
      const mocks = createMocks();
      mocks.taskRepo.findByOrgId.mockResolvedValue([{
        id: 'task-1', type: 'plan', title: 'Planning: idea',
        parentId: null, status: 'in_progress', assigneeRoleId: 'role-1', orgId: 'org-1',
      }]);
      mocks.conversationWorkflowRepo.findActiveByRoleAndTask.mockResolvedValue(null);
      mocks.roleRepo.findById.mockResolvedValue(createRole({ id: 'role-1' }));

      const service = createService(mocks);
      const session = await service.getActivePlanningSession('org-1');

      expect(session).not.toBeNull();
      expect(session!.workflowId).toBeNull();
      expect(session!.workflowState).toBeNull();
    });

    it('should return null when conversationWorkflowRepo is not set', async () => {
      const mocks = createMocks();
      const service = new PlanningService(
        mocks.roleRepo as any, mocks.skillRepo as any,
        mocks.taskRepo as any, mocks.logger as any,
      );
      // Do NOT call setConversationWorkflowRepo

      const session = await service.getActivePlanningSession('org-1');
      expect(session).toBeNull();
    });

    it('should skip tasks without assignee', async () => {
      const mocks = createMocks();
      mocks.taskRepo.findByOrgId.mockResolvedValue([{
        id: 'task-1', type: 'plan', title: 'Planning: idea',
        parentId: null, status: 'in_progress', assigneeRoleId: null, orgId: 'org-1',
      }]);

      const service = createService(mocks);
      const session = await service.getActivePlanningSession('org-1');

      expect(session).toBeNull();
    });

    it('should ignore non-root planning tasks (with parentId)', async () => {
      const mocks = createMocks();
      mocks.taskRepo.findByOrgId.mockResolvedValue([{
        id: 'task-1', type: 'plan', title: 'Planning: idea',
        parentId: 'some-parent', status: 'in_progress', assigneeRoleId: 'role-1', orgId: 'org-1',
      }]);

      const service = createService(mocks);
      const session = await service.getActivePlanningSession('org-1');

      expect(session).toBeNull();
    });
  });

  describe('discardPlanningSession', () => {
    it('should cancel active conversation and transition task to done', async () => {
      const mocks = createMocks();
      mocks.taskRepo.findById.mockResolvedValue({
        id: 'task-1', orgId: 'org-1', assigneeRoleId: 'role-1',
      });
      mocks.conversationWorkflowRepo.findActiveByRoleAndTask.mockResolvedValue({
        id: 'wf-1', state: 'waiting_for_reply',
      });
      mocks.taskService.updateStatus.mockResolvedValue(undefined);

      const service = createService(mocks);
      await service.discardPlanningSession('task-1');

      expect(mocks.conversationWorkflowRepo.updateState).toHaveBeenCalledWith('wf-1', 'cancelled');
      expect(mocks.taskService.updateStatus).toHaveBeenCalledWith('task-1', 'done');
    });

    it('should silently return when task does not exist', async () => {
      const mocks = createMocks();
      mocks.taskRepo.findById.mockResolvedValue(null);

      const service = createService(mocks);
      await service.discardPlanningSession('nonexistent');

      expect(mocks.conversationWorkflowRepo.updateState).not.toHaveBeenCalled();
      expect(mocks.taskService.updateStatus).not.toHaveBeenCalled();
    });

    it('should skip workflow cancel when no active workflow exists', async () => {
      const mocks = createMocks();
      mocks.taskRepo.findById.mockResolvedValue({
        id: 'task-1', orgId: 'org-1', assigneeRoleId: 'role-1',
      });
      mocks.conversationWorkflowRepo.findActiveByRoleAndTask.mockResolvedValue(null);
      mocks.taskService.updateStatus.mockResolvedValue(undefined);

      const service = createService(mocks);
      await service.discardPlanningSession('task-1');

      expect(mocks.conversationWorkflowRepo.updateState).not.toHaveBeenCalled();
      expect(mocks.taskService.updateStatus).toHaveBeenCalledWith('task-1', 'done');
    });

    it('should handle workflow cancel failure gracefully', async () => {
      const mocks = createMocks();
      mocks.taskRepo.findById.mockResolvedValue({
        id: 'task-1', orgId: 'org-1', assigneeRoleId: 'role-1',
      });
      mocks.conversationWorkflowRepo.findActiveByRoleAndTask.mockRejectedValue(new Error('DB error'));
      mocks.taskService.updateStatus.mockResolvedValue(undefined);

      const service = createService(mocks);
      await service.discardPlanningSession('task-1');

      // Should still transition task to done
      expect(mocks.taskService.updateStatus).toHaveBeenCalledWith('task-1', 'done');
      expect(mocks.logger.warn).toHaveBeenCalled();
    });
  });

  describe('getAvailablePlanningRoles', () => {
    it('should return system and template planning roles', async () => {
      const mocks = createMocks();
      const systemRole = createRole({ id: 'sys', name: 'Plan Assistant', isSystemRole: true });
      const pmRole = createRole({ id: 'pm', name: 'Product Manager' });
      const devRole = createRole({ id: 'dev', name: 'Developer' });
      mocks.roleRepo.findByOrgId.mockResolvedValue([systemRole, pmRole, devRole]);
      mocks.orgRepo.findById.mockResolvedValue({ id: 'org-1', planningRoleId: 'pm' });

      const service = createService(mocks);
      const roles = await service.getAvailablePlanningRoles('org-1');

      expect(roles).toHaveLength(2);
      expect(roles[0]).toEqual({ roleId: 'sys', roleName: 'Plan Assistant', source: 'system' });
      expect(roles[1]).toEqual({ roleId: 'pm', roleName: 'Product Manager', source: 'template' });
    });

    it('should return only system role when no template planning role configured', async () => {
      const mocks = createMocks();
      const systemRole = createRole({ id: 'sys', name: 'Plan Assistant', isSystemRole: true });
      mocks.roleRepo.findByOrgId.mockResolvedValue([systemRole]);
      mocks.orgRepo.findById.mockResolvedValue({ id: 'org-1', planningRoleId: null });

      const service = createService(mocks);
      const roles = await service.getAvailablePlanningRoles('org-1');

      expect(roles).toHaveLength(1);
      expect(roles[0].source).toBe('system');
    });

    it('should skip paused system role', async () => {
      const mocks = createMocks();
      const pausedSystem = createRole({ id: 'sys', name: 'Plan Assistant', isSystemRole: true, status: 'paused' });
      mocks.roleRepo.findByOrgId.mockResolvedValue([pausedSystem]);
      mocks.orgRepo.findById.mockResolvedValue({ id: 'org-1', planningRoleId: null });

      const service = createService(mocks);
      const roles = await service.getAvailablePlanningRoles('org-1');

      // Falls back to selectPlanningRole which will throw (no active roles), so empty
      expect(roles).toHaveLength(0);
    });

    it('should fallback to selectPlanningRole for old orgs without system role', async () => {
      const mocks = createMocks();
      const rootRole = createRole({ id: 'root', name: 'CTO', parentId: null });
      mocks.roleRepo.findByOrgId.mockResolvedValue([rootRole]);
      mocks.orgRepo.findById.mockResolvedValue({ id: 'org-1', planningRoleId: null });

      const service = createService(mocks);
      const roles = await service.getAvailablePlanningRoles('org-1');

      expect(roles).toHaveLength(1);
      expect(roles[0]).toEqual({ roleId: 'root', roleName: 'CTO', source: 'template' });
    });

    it('should skip template role that is paused', async () => {
      const mocks = createMocks();
      const systemRole = createRole({ id: 'sys', name: 'Plan Assistant', isSystemRole: true });
      const pausedPm = createRole({ id: 'pm', name: 'PM', status: 'paused' });
      mocks.roleRepo.findByOrgId.mockResolvedValue([systemRole, pausedPm]);
      mocks.orgRepo.findById.mockResolvedValue({ id: 'org-1', planningRoleId: 'pm' });

      const service = createService(mocks);
      const roles = await service.getAvailablePlanningRoles('org-1');

      expect(roles).toHaveLength(1);
      expect(roles[0].source).toBe('system');
    });
  });

  describe('switchPlanningRole', () => {
    it('should switch role and post system message', async () => {
      const mocks = createMocks();
      mocks.taskRepo.findById.mockResolvedValue({
        id: 'task-1', type: 'plan', assigneeRoleId: 'old-role', orgId: 'org-1',
      });
      mocks.roleRepo.findById.mockResolvedValue(createRole({ id: 'new-role', name: 'CTO' }));
      mocks.conversationWorkflowRepo.findActiveByRoleAndTask.mockResolvedValue({
        id: 'wf-1', state: 'waiting_for_reply',
      });
      mocks.discussionRepo.findGroupByTaskNodeId.mockResolvedValue({ id: 'grp-1' });
      mocks.discussionRepo.postMessage.mockResolvedValue({});
      mocks.taskRepo.updateAssignee.mockResolvedValue(undefined);

      const service = createService(mocks);
      const result = await service.switchPlanningRole('task-1', 'new-role');

      expect(result).toEqual({ previousRoleId: 'old-role', newRoleId: 'new-role' });
      expect(mocks.taskRepo.updateAssignee).toHaveBeenCalledWith('task-1', 'new-role');
      expect(mocks.discussionRepo.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          groupId: 'grp-1',
          authorType: 'system',
          content: 'Planning role switched to CTO',
        }),
      );
    });

    it('should no-op when switching to the same role', async () => {
      const mocks = createMocks();
      mocks.taskRepo.findById.mockResolvedValue({
        id: 'task-1', type: 'plan', assigneeRoleId: 'role-1', orgId: 'org-1',
      });

      const service = createService(mocks);
      const result = await service.switchPlanningRole('task-1', 'role-1');

      expect(result).toEqual({ previousRoleId: 'role-1', newRoleId: 'role-1' });
      expect(mocks.taskRepo.updateAssignee).not.toHaveBeenCalled();
    });

    it('should reject when task is not a plan type', async () => {
      const mocks = createMocks();
      mocks.taskRepo.findById.mockResolvedValue({
        id: 'task-1', type: 'epic', assigneeRoleId: 'role-1', orgId: 'org-1',
      });

      const service = createService(mocks);

      await expect(service.switchPlanningRole('task-1', 'new-role'))
        .rejects.toThrow(/not a planning session/i);
    });

    it('should reject when task does not exist', async () => {
      const mocks = createMocks();
      mocks.taskRepo.findById.mockResolvedValue(null);

      const service = createService(mocks);

      await expect(service.switchPlanningRole('nonexistent', 'new-role'))
        .rejects.toThrow(/not found/i);
    });

    it('should reject when target role does not exist', async () => {
      const mocks = createMocks();
      mocks.taskRepo.findById.mockResolvedValue({
        id: 'task-1', type: 'plan', assigneeRoleId: 'old-role', orgId: 'org-1',
      });
      mocks.roleRepo.findById.mockResolvedValue(null);

      const service = createService(mocks);

      await expect(service.switchPlanningRole('task-1', 'nonexistent'))
        .rejects.toThrow(/not found/i);
    });

    it('should reject when AI is not in waiting_for_reply state', async () => {
      const mocks = createMocks();
      mocks.taskRepo.findById.mockResolvedValue({
        id: 'task-1', type: 'plan', assigneeRoleId: 'old-role', orgId: 'org-1',
      });
      mocks.roleRepo.findById.mockResolvedValue(createRole({ id: 'new-role' }));
      mocks.conversationWorkflowRepo.findActiveByRoleAndTask.mockResolvedValue({
        id: 'wf-1', state: 'resumed', // AI is running
      });

      const service = createService(mocks);

      await expect(service.switchPlanningRole('task-1', 'new-role'))
        .rejects.toThrow(/waiting for your reply/i);
    });

    it('should reject when task has no assignee', async () => {
      const mocks = createMocks();
      mocks.taskRepo.findById.mockResolvedValue({
        id: 'task-1', type: 'plan', assigneeRoleId: null, orgId: 'org-1',
      });

      const service = createService(mocks);

      await expect(service.switchPlanningRole('task-1', 'new-role'))
        .rejects.toThrow(/no assignee/i);
    });

    it('should handle discussion group not found gracefully', async () => {
      const mocks = createMocks();
      mocks.taskRepo.findById.mockResolvedValue({
        id: 'task-1', type: 'plan', assigneeRoleId: 'old-role', orgId: 'org-1',
      });
      mocks.roleRepo.findById.mockResolvedValue(createRole({ id: 'new-role', name: 'CTO' }));
      mocks.conversationWorkflowRepo.findActiveByRoleAndTask.mockResolvedValue(null);
      mocks.discussionRepo.findGroupByTaskNodeId.mockResolvedValue(null);
      mocks.taskRepo.updateAssignee.mockResolvedValue(undefined);

      const service = createService(mocks);
      const result = await service.switchPlanningRole('task-1', 'new-role');

      // Should succeed without posting message
      expect(result.newRoleId).toBe('new-role');
      expect(mocks.discussionRepo.postMessage).not.toHaveBeenCalled();
    });
  });
});

describe('PendingPlanStore', () => {
  it('should store, retrieve, and remove plans', () => {
    const store = new PendingPlanStore();

    expect(store.get('org-1')).toBeNull();
    expect(store.has('org-1')).toBe(false);

    const plan = { summary: 'test', tasks: [], createdAt: new Date().toISOString() };
    store.set('org-1', plan);

    expect(store.get('org-1')).toEqual(plan);
    expect(store.has('org-1')).toBe(true);

    store.remove('org-1');
    expect(store.get('org-1')).toBeNull();
  });

  it('should auto-expire plans older than 24 hours', () => {
    const store = new PendingPlanStore();
    const oldDate = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString(); // 25 hours ago
    const plan = { summary: 'old', tasks: [], createdAt: oldDate };
    store.set('org-1', plan);

    expect(store.get('org-1')).toBeNull();
    expect(store.has('org-1')).toBe(false);
  });

  it('should not expire plans within 24 hours', () => {
    const store = new PendingPlanStore();
    const recentDate = new Date(Date.now() - 23 * 60 * 60 * 1000).toISOString(); // 23 hours ago
    const plan = { summary: 'recent', tasks: [], createdAt: recentDate };
    store.set('org-1', plan);

    expect(store.get('org-1')).toEqual(plan);
    expect(store.has('org-1')).toBe(true);
  });

  it('should handle multiple orgs independently', () => {
    const store = new PendingPlanStore();
    const plan1 = { summary: 'org1', tasks: [], createdAt: new Date().toISOString() };
    const plan2 = { summary: 'org2', tasks: [], createdAt: new Date().toISOString() };
    store.set('org-1', plan1);
    store.set('org-2', plan2);

    store.remove('org-1');

    expect(store.get('org-1')).toBeNull();
    expect(store.get('org-2')).toEqual(plan2);
  });

  it('should overwrite existing plan for same org', () => {
    const store = new PendingPlanStore();
    const plan1 = { summary: 'first', tasks: [], createdAt: new Date().toISOString() };
    const plan2 = { summary: 'second', tasks: [], createdAt: new Date().toISOString() };
    store.set('org-1', plan1);
    store.set('org-1', plan2);

    expect(store.get('org-1')!.summary).toBe('second');
  });
});

describe('prompt-scenario — planning', () => {
  it('should resolve to planning when planningContext is present and trigger is task_assigned', async () => {
    const { resolveScenario } = await vi.importActual<typeof import('../../src/main/application/skills/prompt-scenario.js')>('../../src/main/application/skills/prompt-scenario.js');

    const ctx = {
      planningContext: { orgRoles: [] },
      trigger: 'task_assigned',
      role: { requiresHumanApproval: false },
      taskTypeDef: null,
      discussionSummary: null,
      childrenAwaitingReview: [],
    } as any;

    expect(resolveScenario(ctx)).toBe('planning');
  });

  it('should resolve to conversation_resume when trigger is discussion_reply even with planningContext', async () => {
    const { resolveScenario } = await vi.importActual<typeof import('../../src/main/application/skills/prompt-scenario.js')>('../../src/main/application/skills/prompt-scenario.js');

    const ctx = {
      planningContext: { orgRoles: [] },
      trigger: 'discussion_reply',
      role: { requiresHumanApproval: false },
      taskTypeDef: null,
      discussionSummary: null,
      childrenAwaitingReview: [],
    } as any;

    expect(resolveScenario(ctx)).toBe('conversation_resume');
  });

  it('should resolve to escalation_reply when trigger is conversation_escalation with planningContext', async () => {
    const { resolveScenario } = await vi.importActual<typeof import('../../src/main/application/skills/prompt-scenario.js')>('../../src/main/application/skills/prompt-scenario.js');

    const ctx = {
      planningContext: { orgRoles: [] },
      trigger: 'conversation_escalation',
      role: { requiresHumanApproval: false },
      taskTypeDef: null,
      discussionSummary: null,
      childrenAwaitingReview: [],
    } as any;

    expect(resolveScenario(ctx)).toBe('escalation_reply');
  });
});
