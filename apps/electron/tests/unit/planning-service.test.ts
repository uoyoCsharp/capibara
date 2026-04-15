import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('tsyringe', () => ({
  injectable: () => (target: any) => target,
  inject: () => () => undefined,
}));

vi.mock('@main/core/tokens.js', () => ({
  ROLE_REPO_TOKEN: Symbol('ROLE_REPO_TOKEN'),
  SKILL_REPO_TOKEN: Symbol('SKILL_REPO_TOKEN'),
  TASK_REPO_TOKEN: Symbol('TASK_REPO_TOKEN'),
  ORGANIZATION_REPO_TOKEN: Symbol('ORGANIZATION_REPO_TOKEN'),
  LOGGER_TOKEN: Symbol('LOGGER_TOKEN'),
  SESSION_SERVICE_TOKEN: Symbol('SESSION_SERVICE_TOKEN'),
  SESSION_RUN_COORDINATOR_TOKEN: Symbol('SESSION_RUN_COORDINATOR_TOKEN'),
}));

vi.mock('@main/core/errors/capibara.errors.js', () => ({
  ValidationError: class ValidationError extends Error {
    constructor(msg: string) { super(msg); this.name = 'ValidationError'; }
  },
}));

vi.mock('@main/core/constants/planning.constants.js', () => ({
  PLANNING_TASK_TYPE: 'plan',
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
    findByOrgId: vi.fn().mockResolvedValue([]),
    findByParentId: vi.fn(),
    create: vi.fn(),
    delete: vi.fn(),
    setArtifactPaths: vi.fn(),
    updateAssignee: vi.fn(),
    updateStatus: vi.fn(),
  };
  const orgRepo = {
    findById: vi.fn(),
  };
  const logger = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  };
  const sessionService = {
    startSession: vi.fn().mockResolvedValue({ id: 'session-1', roleId: 'role-1', orgId: 'org-1', status: 'active' }),
    getActiveSession: vi.fn().mockResolvedValue(null),
    getSession: vi.fn(),
    cancelSession: vi.fn(),
    switchRole: vi.fn(),
  };
  const sessionRunCoordinator = {
    executeInSession: vi.fn().mockResolvedValue({ status: 'succeeded' }),
  };
  const workflowEngine = {
    isTerminalStatus: vi.fn().mockResolvedValue(false),
  };

  return { roleRepo, skillRepo, taskRepo, orgRepo, logger, sessionService, sessionRunCoordinator, workflowEngine };
}

function createService(mocks: ReturnType<typeof createMocks>) {
  const service = new PlanningService(
    mocks.roleRepo as any,
    mocks.skillRepo as any,
    mocks.taskRepo as any,
    mocks.orgRepo as any,
    mocks.logger as any,
    mocks.sessionService as any,
    mocks.sessionRunCoordinator as any,
  );
  service.setWorkflowEngine(mocks.workflowEngine as any);
  return service;
}

// ─── Tests ─────────────────────────────────────────────────────

describe('PlanningService', () => {
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
    it('should create a session and start first execution using system role', async () => {
      const mocks = createMocks();
      const systemRole = createRole({ id: 'sys-role', name: 'Plan Assistant', isSystemRole: true });
      mocks.roleRepo.findByOrgId.mockResolvedValue([systemRole]);
      mocks.sessionService.startSession.mockResolvedValue({ id: 'session-1', roleId: 'sys-role', orgId: 'org-1', status: 'active' });

      const service = createService(mocks);
      const result = await service.startPlanningRun('org-1', 'Build a todo app');

      expect(result.sessionId).toBe('session-1');
      expect(result.roleId).toBe('sys-role');
      expect(mocks.sessionService.startSession).toHaveBeenCalledWith('org-1', 'planning', 'sys-role', 'Build a todo app');
      expect(mocks.sessionRunCoordinator.executeInSession).toHaveBeenCalledWith('session-1', 'Build a todo app', true);
    });

    it('should use explicit roleId when provided', async () => {
      const mocks = createMocks();
      const explicitRole = createRole({ id: 'explicit-role', name: 'CTO' });
      mocks.roleRepo.findById.mockResolvedValue(explicitRole);
      mocks.sessionService.startSession.mockResolvedValue({ id: 'session-1', roleId: 'explicit-role', orgId: 'org-1', status: 'active' });

      const service = createService(mocks);
      const result = await service.startPlanningRun('org-1', 'my idea', 'explicit-role');

      expect(result.roleId).toBe('explicit-role');
      expect(mocks.sessionService.startSession).toHaveBeenCalledWith('org-1', 'planning', 'explicit-role', 'my idea');
    });

    it('should throw when explicit roleId does not exist', async () => {
      const mocks = createMocks();
      mocks.roleRepo.findById.mockResolvedValue(null);

      const service = createService(mocks);

      await expect(service.startPlanningRun('org-1', 'idea', 'nonexistent'))
        .rejects.toThrow(/not found/i);
    });

    it('should reject concurrent planning sessions', async () => {
      const mocks = createMocks();
      mocks.sessionService.getActiveSession.mockResolvedValue({ id: 'existing-session', roleId: 'role-1', orgId: 'org-1', status: 'active' });
      mocks.roleRepo.findById.mockResolvedValue(createRole());

      const service = createService(mocks);

      await expect(service.startPlanningRun('org-1', 'new idea'))
        .rejects.toThrow(/already active/i);
    });

    it('should throw when no system planning role found', async () => {
      const mocks = createMocks();
      mocks.roleRepo.findByOrgId.mockResolvedValue([createRole({ isSystemRole: false })]);

      const service = createService(mocks);

      await expect(service.startPlanningRun('org-1', 'idea'))
        .rejects.toThrow(/no system planning role/i);
    });
  });

  describe('getActivePlanningSession', () => {
    it('should return null when no active sessions or tasks exist', async () => {
      const mocks = createMocks();

      const service = createService(mocks);
      const session = await service.getActivePlanningSession('org-1');

      expect(session).toBeNull();
    });

    it('should return active session-based planning session', async () => {
      const mocks = createMocks();
      mocks.sessionService.getActiveSession.mockResolvedValue({ id: 'session-1', roleId: 'role-1', orgId: 'org-1', status: 'active' });
      mocks.roleRepo.findById.mockResolvedValue(createRole({ id: 'role-1', name: 'PM' }));

      const service = createService(mocks);
      const session = await service.getActivePlanningSession('org-1');

      expect(session).not.toBeNull();
      expect(session!.sessionId).toBe('session-1');
      expect(session!.taskId).toBeNull();
      expect(session!.roleName).toBe('PM');
    });

    it('should fallback to legacy task-based detection when no active session', async () => {
      const mocks = createMocks();
      mocks.taskRepo.findByOrgId.mockResolvedValue([{
        id: 'task-1', type: 'plan', title: 'Planning: idea',
        parentId: null, status: 'in_progress', assigneeRoleId: 'role-1', orgId: 'org-1',
      }]);
      mocks.roleRepo.findById.mockResolvedValue(createRole({ id: 'role-1', name: 'PM' }));

      const service = createService(mocks);
      const session = await service.getActivePlanningSession('org-1');

      expect(session).not.toBeNull();
      expect(session!.sessionId).toBeNull();
      expect(session!.taskId).toBe('task-1');
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
      mocks.roleRepo.findById.mockResolvedValue(createRole({ id: 'role-1', name: 'PM' }));

      const service = createService(mocks);
      const session = await service.getActivePlanningSession('org-1');

      expect(session).not.toBeNull();
      expect(session!.taskId).toBe('task-legacy');
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
    it('should cancel session-based planning session', async () => {
      const mocks = createMocks();
      mocks.sessionService.getSession.mockResolvedValue({ id: 'session-1', status: 'active' });

      const service = createService(mocks);
      await service.discardPlanningSession('session-1');

      expect(mocks.sessionService.cancelSession).toHaveBeenCalledWith('session-1');
    });

    it('should fallback to legacy task-based discard', async () => {
      const mocks = createMocks();
      mocks.sessionService.getSession.mockResolvedValue(null);
      mocks.taskRepo.findById.mockResolvedValue({ id: 'task-1', orgId: 'org-1' });

      const service = createService(mocks);
      await service.discardPlanningSession('task-1');

      expect(mocks.taskRepo.updateStatus).toHaveBeenCalledWith('task-1', 'done');
    });

    it('should silently return when neither session nor task exists', async () => {
      const mocks = createMocks();
      mocks.sessionService.getSession.mockResolvedValue(null);
      mocks.taskRepo.findById.mockResolvedValue(null);

      const service = createService(mocks);
      await service.discardPlanningSession('nonexistent');

      expect(mocks.taskRepo.updateStatus).not.toHaveBeenCalled();
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

    it('should return empty when no system role and no template role', async () => {
      const mocks = createMocks();
      mocks.roleRepo.findByOrgId.mockResolvedValue([createRole({ isSystemRole: false })]);
      mocks.orgRepo.findById.mockResolvedValue({ id: 'org-1', planningRoleId: null });

      const service = createService(mocks);
      const roles = await service.getAvailablePlanningRoles('org-1');

      expect(roles).toHaveLength(0);
    });

    it('should skip paused system role', async () => {
      const mocks = createMocks();
      const pausedSystem = createRole({ id: 'sys', name: 'Plan Assistant', isSystemRole: true, status: 'paused' });
      mocks.roleRepo.findByOrgId.mockResolvedValue([pausedSystem]);
      mocks.orgRepo.findById.mockResolvedValue({ id: 'org-1', planningRoleId: null });

      const service = createService(mocks);
      const roles = await service.getAvailablePlanningRoles('org-1');

      expect(roles).toHaveLength(0);
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
    it('should switch role for active session', async () => {
      const mocks = createMocks();
      mocks.sessionService.getSession.mockResolvedValue({ id: 'session-1', roleId: 'old-role', status: 'active' });
      mocks.roleRepo.findById.mockResolvedValue(createRole({ id: 'new-role', name: 'CTO' }));

      const service = createService(mocks);
      const result = await service.switchPlanningRole('session-1', 'new-role');

      expect(result).toEqual({ previousRoleId: 'old-role', newRoleId: 'new-role' });
      expect(mocks.sessionService.switchRole).toHaveBeenCalledWith('session-1', 'new-role');
    });

    it('should no-op when switching to the same role', async () => {
      const mocks = createMocks();
      mocks.sessionService.getSession.mockResolvedValue({ id: 'session-1', roleId: 'role-1', status: 'active' });

      const service = createService(mocks);
      const result = await service.switchPlanningRole('session-1', 'role-1');

      expect(result).toEqual({ previousRoleId: 'role-1', newRoleId: 'role-1' });
      expect(mocks.sessionService.switchRole).not.toHaveBeenCalled();
    });

    it('should reject when session does not exist', async () => {
      const mocks = createMocks();
      mocks.sessionService.getSession.mockResolvedValue(null);

      const service = createService(mocks);

      await expect(service.switchPlanningRole('nonexistent', 'new-role'))
        .rejects.toThrow(/not found/i);
    });

    it('should reject when session is not active', async () => {
      const mocks = createMocks();
      mocks.sessionService.getSession.mockResolvedValue({ id: 'session-1', roleId: 'role-1', status: 'cancelled' });

      const service = createService(mocks);

      await expect(service.switchPlanningRole('session-1', 'new-role'))
        .rejects.toThrow(/not active/i);
    });

    it('should reject when target role does not exist', async () => {
      const mocks = createMocks();
      mocks.sessionService.getSession.mockResolvedValue({ id: 'session-1', roleId: 'old-role', status: 'active' });
      mocks.roleRepo.findById.mockResolvedValue(null);

      const service = createService(mocks);

      await expect(service.switchPlanningRole('session-1', 'nonexistent'))
        .rejects.toThrow(/not found/i);
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
    const oldDate = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString();
    const plan = { summary: 'old', tasks: [], createdAt: oldDate };
    store.set('org-1', plan);

    expect(store.get('org-1')).toBeNull();
    expect(store.has('org-1')).toBe(false);
  });

  it('should not expire plans within 24 hours', () => {
    const store = new PendingPlanStore();
    const recentDate = new Date(Date.now() - 23 * 60 * 60 * 1000).toISOString();
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
    const { resolveScenario } = await vi.importActual<typeof import('../../src/main/application/prompt/prompt-scenario.js')>('../../src/main/application/prompt/prompt-scenario.js');

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
    const { resolveScenario } = await vi.importActual<typeof import('../../src/main/application/prompt/prompt-scenario.js')>('../../src/main/application/prompt/prompt-scenario.js');

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
    const { resolveScenario } = await vi.importActual<typeof import('../../src/main/application/prompt/prompt-scenario.js')>('../../src/main/application/prompt/prompt-scenario.js');

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
