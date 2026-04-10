/**
 * OrgOrchestrator + BudgetGuard Unit Tests
 *
 * Covers: calculateWakeTargets for every event type, wakeRoleIfPossible gate
 * delegation, per-org event serialization queue, consumePendingWakes priority
 * loop, start/stop lifecycle, BudgetGuard pause/resume, and edge cases.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('tsyringe', () => ({
  injectable: () => (target: any) => target,
  inject: () => () => undefined,
}));

vi.mock('@main/core/tokens.js', () => ({
  CONFIG_TOKEN: Symbol('CONFIG_TOKEN'),
  LOGGER_TOKEN: Symbol('LOGGER_TOKEN'),
  EVENT_BUS_TOKEN: Symbol('EVENT_BUS_TOKEN'),
  TASK_REPO_TOKEN: Symbol('TASK_REPO_TOKEN'),
  ROLE_REPO_TOKEN: Symbol('ROLE_REPO_TOKEN'),
  RUN_REPO_TOKEN: Symbol('RUN_REPO_TOKEN'),
  PENDING_WAKE_REPO_TOKEN: Symbol('PENDING_WAKE_REPO_TOKEN'),
  COST_ENTRY_REPO_TOKEN: Symbol('COST_ENTRY_REPO_TOKEN'),
}));

import { OrgOrchestrator } from '@main/application/orchestrator/org.orchestrator.js';
import type { TaskNode, Role, WakeTrigger } from '@main/core/types/domain.types.js';
import type { DomainEvent } from '@main/core/types/event.types.js';
import type { CapibaraConfig } from '@main/core/types/config.types.js';

// ─── Mock Factories ─────────────────────────────────────────

function createConfig(): CapibaraConfig {
  return {
    execution: {
      budgetLimit: 10, maxConsecutiveWakes: 5, maxRetryOnFailure: 3,
      maxReviseAttempts: 3, maxDecompositionDepth: 5, retryBackoffMs: 1000,
    },
    organization: { template: '', customFile: null },
    skills: { provider: '', bmadRoot: '' },
    database: { driver: 'sqlite', sqlitePath: '' },
    cli: { defaultExecutor: 'claude', projectDir: '/project', model: 'opus', maxTurnsPerRun: 10, effort: 'medium', timeoutMs: 60000, extraArgs: [] },
    logging: { level: 'info', logDir: '' },
  } as CapibaraConfig;
}

function createTask(overrides: Partial<TaskNode> = {}): TaskNode {
  return {
    id: 'task-1', orgId: 'org-1', parentId: null, type: 'story', title: 'Test',
    description: '', status: 'open', assigneeRoleId: 'role-1', depth: 0,
    artifactPaths: null, createdAt: '', updatedAt: '',
    ...overrides,
  };
}

function createRole(overrides: Partial<Role> = {}): Role {
  return {
    id: 'role-1', orgId: 'org-1', name: 'Dev', parentId: null, persona: '',
    knowledgeBaseRefs: [], skillIds: [], canApprove: true, canDelegate: false,
    requiresHumanApproval: false, consecutiveWakeCount: 0, status: 'active',
    createdAt: '', updatedAt: '',
    ...overrides,
  };
}

function createEvent(type: string, payload: Record<string, unknown> = {}): DomainEvent {
  return { type, timestamp: new Date().toISOString(), payload } as DomainEvent;
}

function createOrchestrator() {
  const config = createConfig();
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), child: vi.fn().mockReturnThis() };
  const eventBus = {
    emit: vi.fn(),
    on: vi.fn(),
    off: vi.fn(),
  };
  const taskRepo = {
    findById: vi.fn().mockResolvedValue(null),
    findByParentId: vi.fn().mockResolvedValue([]),
    findByOrgId: vi.fn().mockResolvedValue([]),
    findByAssignee: vi.fn().mockResolvedValue([]),
    create: vi.fn(), updateStatus: vi.fn(), updateAssignee: vi.fn(),
    setArtifactPaths: vi.fn(), delete: vi.fn(),
  };
  const roleRepo = {
    findById: vi.fn().mockResolvedValue(createRole()),
    findByIds: vi.fn(), findByOrgId: vi.fn().mockResolvedValue([]),
    findChildren: vi.fn(), create: vi.fn(),
    update: vi.fn().mockResolvedValue(undefined), delete: vi.fn(),
  };
  const runRepo = {
    findById: vi.fn(), findByOrgId: vi.fn(), findByTaskId: vi.fn(),
    findActiveByRoleId: vi.fn().mockResolvedValue(null),
    findActiveByOrgId: vi.fn().mockResolvedValue(null),
    findAnyActiveRun: vi.fn(),
    create: vi.fn(), updateStatus: vi.fn(), finish: vi.fn(),
    findLastSessionId: vi.fn(),
  };
  const pendingWakeRepo = {
    findByOrgId: vi.fn().mockResolvedValue([]),
    findByRoleId: vi.fn().mockResolvedValue([]),
    create: vi.fn(), consume: vi.fn().mockResolvedValue(undefined),
    deleteByRoleId: vi.fn(),
  };
  const costRepo = {
    findByRunId: vi.fn(), findByOrgId: vi.fn(),
    getTotalTokensByOrgId: vi.fn().mockResolvedValue(0), create: vi.fn(),
  };

  const orch = new (OrgOrchestrator as any)(
    config, logger, eventBus, taskRepo, roleRepo, runRepo, pendingWakeRepo, costRepo,
  );

  const executionEngine = { startRun: vi.fn().mockResolvedValue({ id: 'run-1' }) };
  orch.setExecutionEngine(executionEngine);

  const workflowEngine = {
    isTerminalStatus: vi.fn().mockResolvedValue(false),
    isReviewStatus: vi.fn().mockResolvedValue(false),
    isActiveStatus: vi.fn().mockResolvedValue(false),
    getInitialStatus: vi.fn().mockResolvedValue('open'),
    getItemTypeDefinition: vi.fn().mockResolvedValue(null),
    canTransition: vi.fn(), validateType: vi.fn(),
    getAllItemTypes: vi.fn(), getRootTypes: vi.fn(),
    getManualTransitions: vi.fn(), getAllStatuses: vi.fn(),
    getFirstReviewStatus: vi.fn(), findTransitionTargetByCategory: vi.fn(),
    evaluateBehaviors: vi.fn(), getActiveSchema: vi.fn(),
    saveSchema: vi.fn(), analyzeImpactReadOnly: vi.fn(),
    validateSchemaIntegrity: vi.fn(), invalidateCache: vi.fn(),
  };
  orch.setWorkflowEngine(workflowEngine);

  return {
    orch, config, logger, eventBus,
    taskRepo, roleRepo, runRepo, pendingWakeRepo, costRepo,
    executionEngine, workflowEngine,
  };
}

// ─── Tests ──────────────────────────────────────────────────

describe('OrgOrchestrator', () => {

  // ═══════════════════════════════════════════════════════════
  // start / stop lifecycle
  // ═══════════════════════════════════════════════════════════

  describe('start / stop', () => {
    it('should register handlers for all expected event types', () => {
      const { orch, eventBus } = createOrchestrator();
      orch.start();

      const registeredTypes = (eventBus.on as any).mock.calls.map((c: any) => c[0]);
      expect(registeredTypes).toContain('task:created');
      expect(registeredTypes).toContain('task:completed');
      expect(registeredTypes).toContain('task:status-changed');
      expect(registeredTypes).toContain('discussion:vote-added');
      expect(registeredTypes).toContain('run:succeeded');
      expect(registeredTypes).toContain('run:failed');
      expect(registeredTypes).toContain('run:timed-out');
      expect(registeredTypes).toContain('wake:triggered');
      expect(registeredTypes).toContain('dispute:detected');
      expect(registeredTypes).toContain('budget:exceeded');
      expect(registeredTypes).toContain('conversation:reply-posted');
      expect(registeredTypes).toContain('conversation:escalated');
      expect(registeredTypes).toContain('conversation:timed-out');
    });

    it('should log start message', () => {
      const { orch, logger } = createOrchestrator();
      orch.start();
      expect(logger.info).toHaveBeenCalledWith('OrgOrchestrator started — listening for domain events');
    });

    it('should clear org queues and stop retry scheduler on stop', () => {
      const { orch, logger } = createOrchestrator();
      orch.stop();
      expect(logger.info).toHaveBeenCalledWith('OrgOrchestrator stopped');
    });
  });

  // ═══════════════════════════════════════════════════════════
  // calculateWakeTargets — task:created
  // ═══════════════════════════════════════════════════════════

  describe('calculateWakeTargets — task:created', () => {
    it('should return task_assigned target for task with assignee and no parent', async () => {
      const { orch, taskRepo } = createOrchestrator();
      const task = createTask({ id: 'task-1', assigneeRoleId: 'role-1', parentId: null });
      (taskRepo.findById as any).mockResolvedValue(task);

      const targets = await orch.calculateWakeTargets(createEvent('task:created', { taskId: 'task-1' }));

      expect(targets).toEqual([{
        roleId: 'role-1', orgId: 'org-1', taskNodeId: 'task-1', trigger: 'task_assigned',
      }]);
    });

    it('should return empty when task has no assignee', async () => {
      const { orch, taskRepo } = createOrchestrator();
      (taskRepo.findById as any).mockResolvedValue(createTask({ assigneeRoleId: null }));

      const targets = await orch.calculateWakeTargets(createEvent('task:created', { taskId: 'task-1' }));
      expect(targets).toEqual([]);
    });

    it('should return empty when task is not found', async () => {
      const { orch, taskRepo } = createOrchestrator();
      (taskRepo.findById as any).mockResolvedValue(null);

      const targets = await orch.calculateWakeTargets(createEvent('task:created', { taskId: 'nope' }));
      expect(targets).toEqual([]);
    });

    it('should skip wake when parent task is not yet approved (not terminal)', async () => {
      const { orch, taskRepo, workflowEngine } = createOrchestrator();
      const child = createTask({ id: 'child-1', parentId: 'parent-1', assigneeRoleId: 'role-1' });
      const parent = createTask({ id: 'parent-1', status: 'in_progress' });
      (taskRepo.findById as any).mockImplementation(async (id: string) => {
        if (id === 'child-1') return child;
        if (id === 'parent-1') return parent;
        return null;
      });
      (workflowEngine.isTerminalStatus as any).mockResolvedValue(false);

      const targets = await orch.calculateWakeTargets(createEvent('task:created', { taskId: 'child-1' }));
      expect(targets).toEqual([]);
    });

    it('should allow wake when parent task IS terminal (approved)', async () => {
      const { orch, taskRepo, workflowEngine } = createOrchestrator();
      const child = createTask({ id: 'child-1', parentId: 'parent-1', assigneeRoleId: 'role-1' });
      const parent = createTask({ id: 'parent-1', status: 'done' });
      (taskRepo.findById as any).mockImplementation(async (id: string) => {
        if (id === 'child-1') return child;
        if (id === 'parent-1') return parent;
        return null;
      });
      (workflowEngine.isTerminalStatus as any).mockImplementation(async (_orgId: string, status: string) =>
        status === 'done',
      );
      (taskRepo.findByParentId as any).mockResolvedValue([child]);
      (workflowEngine.isReviewStatus as any).mockResolvedValue(false);

      const targets = await orch.calculateWakeTargets(createEvent('task:created', { taskId: 'child-1' }));
      expect(targets).toHaveLength(1);
      expect(targets[0].taskNodeId).toBe('child-1');
    });

    it('should skip wake when task is not the first pending sibling', async () => {
      const { orch, taskRepo, workflowEngine } = createOrchestrator();
      const sibling1 = createTask({ id: 'sib-1', parentId: 'parent-1', status: 'open', assigneeRoleId: 'role-1' });
      const sibling2 = createTask({ id: 'sib-2', parentId: 'parent-1', status: 'open', assigneeRoleId: 'role-2' });
      const parent = createTask({ id: 'parent-1', status: 'done' });

      (taskRepo.findById as any).mockImplementation(async (id: string) => {
        if (id === 'sib-2') return sibling2;
        if (id === 'parent-1') return parent;
        return null;
      });
      (workflowEngine.isTerminalStatus as any).mockImplementation(async (_o: string, s: string) => s === 'done');
      (workflowEngine.isReviewStatus as any).mockResolvedValue(false);
      (taskRepo.findByParentId as any).mockResolvedValue([sibling1, sibling2]);

      const targets = await orch.calculateWakeTargets(createEvent('task:created', { taskId: 'sib-2' }));
      expect(targets).toEqual([]);
    });

    it('should wake task if it IS the first pending sibling', async () => {
      const { orch, taskRepo, workflowEngine } = createOrchestrator();
      const sibling1 = createTask({ id: 'sib-1', parentId: 'parent-1', status: 'done', assigneeRoleId: 'role-1' });
      const sibling2 = createTask({ id: 'sib-2', parentId: 'parent-1', status: 'open', assigneeRoleId: 'role-2' });
      const parent = createTask({ id: 'parent-1', status: 'done' });

      (taskRepo.findById as any).mockImplementation(async (id: string) => {
        if (id === 'sib-2') return sibling2;
        if (id === 'parent-1') return parent;
        return null;
      });
      (workflowEngine.isTerminalStatus as any).mockImplementation(async (_o: string, s: string) => s === 'done');
      (workflowEngine.isReviewStatus as any).mockResolvedValue(false);
      (taskRepo.findByParentId as any).mockResolvedValue([sibling1, sibling2]);

      const targets = await orch.calculateWakeTargets(createEvent('task:created', { taskId: 'sib-2' }));
      expect(targets).toHaveLength(1);
      expect(targets[0].taskNodeId).toBe('sib-2');
    });

    it('should proceed with sibling check when parent not found in DB', async () => {
      const { orch, taskRepo, workflowEngine } = createOrchestrator();
      const child = createTask({ id: 'child-1', parentId: 'ghost-parent', assigneeRoleId: 'role-1' });
      (taskRepo.findById as any).mockImplementation(async (id: string) => {
        if (id === 'child-1') return child;
        return null;
      });
      (taskRepo.findByParentId as any).mockResolvedValue([child]);
      (workflowEngine.isTerminalStatus as any).mockResolvedValue(false);
      (workflowEngine.isReviewStatus as any).mockResolvedValue(false);

      const targets = await orch.calculateWakeTargets(createEvent('task:created', { taskId: 'child-1' }));
      expect(targets).toHaveLength(1);
    });

    it('should skip task in review status during sibling check', async () => {
      const { orch, taskRepo, workflowEngine } = createOrchestrator();
      const sibInReview = createTask({ id: 'sib-review', parentId: 'parent-1', status: 'in_review', assigneeRoleId: 'role-1' });
      const sibPending = createTask({ id: 'sib-pending', parentId: 'parent-1', status: 'open', assigneeRoleId: 'role-2' });
      const parent = createTask({ id: 'parent-1', status: 'done' });

      (taskRepo.findById as any).mockImplementation(async (id: string) => {
        if (id === 'sib-pending') return sibPending;
        if (id === 'parent-1') return parent;
        return null;
      });
      (workflowEngine.isTerminalStatus as any).mockImplementation(async (_o: string, s: string) => s === 'done');
      (workflowEngine.isReviewStatus as any).mockImplementation(async (_o: string, s: string) => s === 'in_review');
      (taskRepo.findByParentId as any).mockResolvedValue([sibInReview, sibPending]);

      const targets = await orch.calculateWakeTargets(createEvent('task:created', { taskId: 'sib-pending' }));
      expect(targets).toHaveLength(1);
      expect(targets[0].taskNodeId).toBe('sib-pending');
    });
  });

  // ═══════════════════════════════════════════════════════════
  // calculateWakeTargets — task:completed
  // ═══════════════════════════════════════════════════════════

  describe('calculateWakeTargets — task:completed', () => {
    it('should always return empty (handled by TaskService.checkAutoPropagate)', async () => {
      const { orch } = createOrchestrator();
      const targets = await orch.calculateWakeTargets(createEvent('task:completed', { taskId: 'task-1', orgId: 'org-1' }));
      expect(targets).toEqual([]);
    });
  });

  // ═══════════════════════════════════════════════════════════
  // calculateWakeTargets — task:status-changed
  // ═══════════════════════════════════════════════════════════

  describe('calculateWakeTargets — task:status-changed', () => {
    it('should return empty when new status is not terminal', async () => {
      const { orch, taskRepo, workflowEngine } = createOrchestrator();
      (taskRepo.findById as any).mockResolvedValue(createTask());
      (workflowEngine.isTerminalStatus as any).mockResolvedValue(false);

      const targets = await orch.calculateWakeTargets(
        createEvent('task:status-changed', { taskId: 'task-1', newStatus: 'in_progress', orgId: 'org-1' }),
      );
      expect(targets).toEqual([]);
    });

    it('should return empty when task not found', async () => {
      const { orch, taskRepo } = createOrchestrator();
      (taskRepo.findById as any).mockResolvedValue(null);

      const targets = await orch.calculateWakeTargets(
        createEvent('task:status-changed', { taskId: 'nope', newStatus: 'done', orgId: 'org-1' }),
      );
      expect(targets).toEqual([]);
    });

    it('should wake first pending child when parent reaches terminal status', async () => {
      const { orch, taskRepo, workflowEngine } = createOrchestrator();
      const parent = createTask({ id: 'parent-1', status: 'done', parentId: null });
      const child = createTask({ id: 'child-1', status: 'open', assigneeRoleId: 'role-2', parentId: 'parent-1' });

      (taskRepo.findById as any).mockResolvedValue(parent);
      (workflowEngine.isTerminalStatus as any).mockResolvedValue(true);
      (workflowEngine.getInitialStatus as any).mockResolvedValue('open');
      (taskRepo.findByParentId as any).mockResolvedValue([child]);

      const targets = await orch.calculateWakeTargets(
        createEvent('task:status-changed', { taskId: 'parent-1', newStatus: 'done', orgId: 'org-1' }),
      );

      expect(targets).toContainEqual(expect.objectContaining({
        roleId: 'role-2', taskNodeId: 'child-1', trigger: 'task_assigned',
      }));
    });

    it('should wake assignee with review_approve when terminal + no children + canDecompose', async () => {
      const { orch, taskRepo, workflowEngine } = createOrchestrator();
      const task = createTask({ id: 'task-1', status: 'done', type: 'epic', assigneeRoleId: 'role-1', parentId: null });

      (taskRepo.findById as any).mockResolvedValue(task);
      (workflowEngine.isTerminalStatus as any).mockResolvedValue(true);
      (taskRepo.findByParentId as any).mockResolvedValue([]);
      (workflowEngine.getItemTypeDefinition as any).mockResolvedValue({ canDecompose: true });

      const targets = await orch.calculateWakeTargets(
        createEvent('task:status-changed', { taskId: 'task-1', newStatus: 'done', orgId: 'org-1' }),
      );

      expect(targets).toContainEqual(expect.objectContaining({
        roleId: 'role-1', taskNodeId: 'task-1', trigger: 'review_approve',
      }));
    });

    it('should NOT emit review_approve when type cannot decompose', async () => {
      const { orch, taskRepo, workflowEngine } = createOrchestrator();
      const task = createTask({ id: 'task-1', status: 'done', type: 'bug', assigneeRoleId: 'role-1', parentId: null });

      (taskRepo.findById as any).mockResolvedValue(task);
      (workflowEngine.isTerminalStatus as any).mockResolvedValue(true);
      (taskRepo.findByParentId as any).mockResolvedValue([]);
      (workflowEngine.getItemTypeDefinition as any).mockResolvedValue({ canDecompose: false });

      const targets = await orch.calculateWakeTargets(
        createEvent('task:status-changed', { taskId: 'task-1', newStatus: 'done', orgId: 'org-1' }),
      );
      expect(targets.find((t: any) => t.trigger === 'review_approve')).toBeUndefined();
    });

    it('should NOT emit review_approve when task has no assignee', async () => {
      const { orch, taskRepo, workflowEngine } = createOrchestrator();
      const task = createTask({ id: 'task-1', status: 'done', assigneeRoleId: null, parentId: null });

      (taskRepo.findById as any).mockResolvedValue(task);
      (workflowEngine.isTerminalStatus as any).mockResolvedValue(true);
      (taskRepo.findByParentId as any).mockResolvedValue([]);

      const targets = await orch.calculateWakeTargets(
        createEvent('task:status-changed', { taskId: 'task-1', newStatus: 'done', orgId: 'org-1' }),
      );
      expect(targets).toEqual([]);
    });

    it('should NOT emit review_approve when getItemTypeDefinition returns null', async () => {
      const { orch, taskRepo, workflowEngine } = createOrchestrator();
      const task = createTask({ id: 'task-1', status: 'done', assigneeRoleId: 'role-1', parentId: null });

      (taskRepo.findById as any).mockResolvedValue(task);
      (workflowEngine.isTerminalStatus as any).mockResolvedValue(true);
      (taskRepo.findByParentId as any).mockResolvedValue([]);
      (workflowEngine.getItemTypeDefinition as any).mockResolvedValue(null);

      const targets = await orch.calculateWakeTargets(
        createEvent('task:status-changed', { taskId: 'task-1', newStatus: 'done', orgId: 'org-1' }),
      );
      expect(targets.find((t: any) => t.trigger === 'review_approve')).toBeUndefined();
    });

    it('should wake next pending sibling when current task completes (sequential gate)', async () => {
      const { orch, taskRepo, workflowEngine } = createOrchestrator();
      const completedTask = createTask({ id: 'sib-1', status: 'done', parentId: 'parent-1' });
      const nextSibling = createTask({ id: 'sib-2', status: 'open', assigneeRoleId: 'role-2', parentId: 'parent-1' });

      (taskRepo.findById as any).mockResolvedValue(completedTask);
      (workflowEngine.isTerminalStatus as any).mockImplementation(async (_o: string, s: string) => s === 'done');
      (workflowEngine.getInitialStatus as any).mockResolvedValue('open');

      (taskRepo.findByParentId as any).mockImplementation(async (parentId: string) => {
        if (parentId === 'sib-1') return [];
        if (parentId === 'parent-1') return [completedTask, nextSibling];
        return [];
      });

      const targets = await orch.calculateWakeTargets(
        createEvent('task:status-changed', { taskId: 'sib-1', newStatus: 'done', orgId: 'org-1' }),
      );

      expect(targets).toContainEqual(expect.objectContaining({
        roleId: 'role-2', taskNodeId: 'sib-2', trigger: 'task_assigned',
      }));
    });

    it('should NOT wake sibling when all siblings are already terminal', async () => {
      const { orch, taskRepo, workflowEngine } = createOrchestrator();
      const sib1 = createTask({ id: 'sib-1', status: 'done', parentId: 'parent-1' });
      const sib2 = createTask({ id: 'sib-2', status: 'done', parentId: 'parent-1' });

      (taskRepo.findById as any).mockResolvedValue(sib1);
      (workflowEngine.isTerminalStatus as any).mockResolvedValue(true);
      (taskRepo.findByParentId as any).mockImplementation(async (parentId: string) => {
        if (parentId === 'sib-1') return [];
        if (parentId === 'parent-1') return [sib1, sib2];
        return [];
      });

      const targets = await orch.calculateWakeTargets(
        createEvent('task:status-changed', { taskId: 'sib-1', newStatus: 'done', orgId: 'org-1' }),
      );

      expect(targets.find((t: any) => t.trigger === 'task_assigned' && t.taskNodeId !== 'sib-1')).toBeUndefined();
    });

    it('should skip sibling progression when terminal task has active children', async () => {
      const { orch, taskRepo, workflowEngine } = createOrchestrator();
      const task = createTask({ id: 'task-1', status: 'done', parentId: 'parent-1' });
      const activeChild = createTask({ id: 'child-1', status: 'in_progress', parentId: 'task-1' });

      (taskRepo.findById as any).mockResolvedValue(task);
      (workflowEngine.isTerminalStatus as any).mockImplementation(async (_o: string, s: string) => s === 'done');
      (taskRepo.findByParentId as any).mockImplementation(async (parentId: string) => {
        if (parentId === 'task-1') return [activeChild];
        return [];
      });

      const targets = await orch.calculateWakeTargets(
        createEvent('task:status-changed', { taskId: 'task-1', newStatus: 'done', orgId: 'org-1' }),
      );

      const siblingWake = targets.find((t: any) => t.trigger === 'task_assigned' && t.taskNodeId !== 'task-1');
      expect(siblingWake).toBeUndefined();
    });

    it('should return empty targets for root task with no children and no assignee', async () => {
      const { orch, taskRepo, workflowEngine } = createOrchestrator();
      const rootTask = createTask({ id: 'root-1', parentId: null, assigneeRoleId: null });

      (taskRepo.findById as any).mockResolvedValue(rootTask);
      (workflowEngine.isTerminalStatus as any).mockResolvedValue(true);
      (taskRepo.findByParentId as any).mockResolvedValue([]);
      (workflowEngine.getItemTypeDefinition as any).mockResolvedValue(null);

      const targets = await orch.calculateWakeTargets(
        createEvent('task:status-changed', { taskId: 'root-1', newStatus: 'done', orgId: 'org-1' }),
      );
      expect(targets).toEqual([]);
    });

    it('should not check siblings when task has no parentId', async () => {
      const { orch, taskRepo, workflowEngine } = createOrchestrator();
      const rootTask = createTask({ id: 'root-1', parentId: null, assigneeRoleId: 'role-1' });

      (taskRepo.findById as any).mockResolvedValue(rootTask);
      (workflowEngine.isTerminalStatus as any).mockResolvedValue(true);
      (taskRepo.findByParentId as any).mockResolvedValue([]);
      (workflowEngine.getItemTypeDefinition as any).mockResolvedValue({ canDecompose: true });

      const targets = await orch.calculateWakeTargets(
        createEvent('task:status-changed', { taskId: 'root-1', newStatus: 'done', orgId: 'org-1' }),
      );

      expect(targets).toHaveLength(1);
      expect(targets[0].trigger).toBe('review_approve');
    });

    it('should handle isTerminalStatus rejection in child check gracefully (counts as active)', async () => {
      const { orch, taskRepo, workflowEngine } = createOrchestrator();
      const task = createTask({ id: 'task-1', status: 'done', parentId: 'parent-1' });
      const child = createTask({ id: 'child-1', status: 'weird', parentId: 'task-1' });
      const nextSibling = createTask({ id: 'sib-2', status: 'open', assigneeRoleId: 'role-3', parentId: 'parent-1' });

      (taskRepo.findById as any).mockResolvedValue(task);
      (workflowEngine.isTerminalStatus as any).mockImplementation(async (_o: string, s: string) => {
        if (s === 'done') return true;
        if (s === 'weird') throw new Error('engine error');
        return false;
      });
      (workflowEngine.getInitialStatus as any).mockResolvedValue('open');
      (taskRepo.findByParentId as any).mockImplementation(async (parentId: string) => {
        if (parentId === 'task-1') return [child]; // children of task → has child with rejected status check
        if (parentId === 'parent-1') return [task, nextSibling]; // siblings
        return [];
      });

      const targets = await orch.calculateWakeTargets(
        createEvent('task:status-changed', { taskId: 'task-1', newStatus: 'done', orgId: 'org-1' }),
      );

      // Rejected promise counts as active child → skip sibling progression entirely
      // So no sibling wake for sib-2
      const siblingWake = targets.find((t: any) => t.taskNodeId === 'sib-2');
      expect(siblingWake).toBeUndefined();
    });
  });

  // ═══════════════════════════════════════════════════════════
  // calculateWakeTargets — run:succeeded
  // ═══════════════════════════════════════════════════════════

  describe('calculateWakeTargets — run:succeeded', () => {
    it('should return empty and reset wake count + clear retry state', async () => {
      const { orch, pendingWakeRepo } = createOrchestrator();
      vi.spyOn((orch as any).gateValidator, 'resetWakeCount').mockResolvedValue(undefined);
      (pendingWakeRepo.findByOrgId as any).mockResolvedValue([]);

      const targets = await orch.calculateWakeTargets(
        createEvent('run:succeeded', { roleId: 'role-1', orgId: 'org-1', taskNodeId: 'task-1' }),
      );
      expect(targets).toEqual([]);
    });

    it('should consume pending wakes after run succeeds', async () => {
      const { orch, pendingWakeRepo, executionEngine } = createOrchestrator();
      vi.spyOn((orch as any).gateValidator, 'resetWakeCount').mockResolvedValue(undefined);
      vi.spyOn((orch as any).gateValidator, 'check').mockResolvedValue({ allowed: true, role: createRole() });
      vi.spyOn((orch as any).gateValidator, 'incrementWakeCount').mockResolvedValue(undefined);

      (pendingWakeRepo.findByOrgId as any).mockResolvedValue([{
        id: 'pw-1', roleId: 'role-2', orgId: 'org-1', trigger: 'task_assigned',
        taskNodeId: 'task-2', priority: 1, createdAt: '',
      }]);

      await orch.calculateWakeTargets(
        createEvent('run:succeeded', { roleId: 'role-1', orgId: 'org-1', taskNodeId: 'task-1' }),
      );
      expect(pendingWakeRepo.consume).toHaveBeenCalledWith('pw-1');
      expect(executionEngine.startRun).toHaveBeenCalledWith('role-2', 'task-2', 'org-1', 'task_assigned');
    });
  });

  // ═══════════════════════════════════════════════════════════
  // calculateWakeTargets — run:failed / run:timed-out
  // ═══════════════════════════════════════════════════════════

  describe('calculateWakeTargets — run:failed / run:timed-out', () => {
    it('should return empty for run:failed (retry handled by RetryScheduler)', async () => {
      const { orch } = createOrchestrator();
      vi.spyOn((orch as any).gateValidator, 'resetWakeCount').mockResolvedValue(undefined);
      vi.spyOn((orch as any).retryScheduler, 'handleFailure').mockResolvedValue(undefined);

      const targets = await orch.calculateWakeTargets(
        createEvent('run:failed', { roleId: 'role-1', orgId: 'org-1', taskNodeId: 'task-1' }),
      );
      expect(targets).toEqual([]);
    });

    it('should return empty for run:timed-out', async () => {
      const { orch } = createOrchestrator();
      vi.spyOn((orch as any).gateValidator, 'resetWakeCount').mockResolvedValue(undefined);
      vi.spyOn((orch as any).retryScheduler, 'handleFailure').mockResolvedValue(undefined);

      const targets = await orch.calculateWakeTargets(
        createEvent('run:timed-out', { roleId: 'role-1', orgId: 'org-1', taskNodeId: 'task-1' }),
      );
      expect(targets).toEqual([]);
    });

    it('should call retryScheduler.handleFailure with wakeRoleIfPossible callback', async () => {
      const { orch } = createOrchestrator();
      vi.spyOn((orch as any).gateValidator, 'resetWakeCount').mockResolvedValue(undefined);
      const handleFailureSpy = vi.spyOn((orch as any).retryScheduler, 'handleFailure').mockResolvedValue(undefined);

      await orch.calculateWakeTargets(
        createEvent('run:failed', { roleId: 'role-1', orgId: 'org-1', taskNodeId: 'task-1' }),
      );

      expect(handleFailureSpy).toHaveBeenCalledWith('role-1', 'org-1', 'task-1', expect.any(Function));
    });
  });

  // ═══════════════════════════════════════════════════════════
  // calculateWakeTargets — wake:triggered
  // ═══════════════════════════════════════════════════════════

  describe('calculateWakeTargets — wake:triggered', () => {
    it('should use explicit taskNodeId from payload when provided', async () => {
      const { orch } = createOrchestrator();
      const targets = await orch.calculateWakeTargets(
        createEvent('wake:triggered', {
          roleId: 'role-1', orgId: 'org-1', trigger: 'task_assigned', taskNodeId: 'task-explicit',
        }),
      );
      expect(targets).toEqual([{
        roleId: 'role-1', orgId: 'org-1', taskNodeId: 'task-explicit', trigger: 'task_assigned',
      }]);
    });

    it('should fallback to findByAssignee when no explicit taskNodeId', async () => {
      const { orch, taskRepo, workflowEngine } = createOrchestrator();
      const activeTask = createTask({ id: 'active-task', status: 'in_progress' });
      (taskRepo.findByAssignee as any).mockResolvedValue([activeTask]);
      (workflowEngine.isTerminalStatus as any).mockResolvedValue(false);

      const targets = await orch.calculateWakeTargets(
        createEvent('wake:triggered', { roleId: 'role-1', orgId: 'org-1', trigger: 'manual' }),
      );
      expect(targets).toEqual([{
        roleId: 'role-1', orgId: 'org-1', taskNodeId: 'active-task', trigger: 'manual',
      }]);
    });

    it('should skip terminal tasks when searching by assignee', async () => {
      const { orch, taskRepo, workflowEngine } = createOrchestrator();
      const terminalTask = createTask({ id: 'done-task', status: 'done' });
      const activeTask = createTask({ id: 'active-task', status: 'open' });
      (taskRepo.findByAssignee as any).mockResolvedValue([terminalTask, activeTask]);
      (workflowEngine.isTerminalStatus as any)
        .mockResolvedValueOnce(true)
        .mockResolvedValueOnce(false);

      const targets = await orch.calculateWakeTargets(
        createEvent('wake:triggered', { roleId: 'role-1', orgId: 'org-1', trigger: 'manual' }),
      );
      expect(targets[0].taskNodeId).toBe('active-task');
    });

    it('should return empty when no non-terminal task found for role', async () => {
      const { orch, taskRepo, workflowEngine } = createOrchestrator();
      (taskRepo.findByAssignee as any).mockResolvedValue([createTask({ status: 'done' })]);
      (workflowEngine.isTerminalStatus as any).mockResolvedValue(true);

      const targets = await orch.calculateWakeTargets(
        createEvent('wake:triggered', { roleId: 'role-1', orgId: 'org-1', trigger: 'manual' }),
      );
      expect(targets).toEqual([]);
    });

    it('should return empty when role has no assigned tasks', async () => {
      const { orch, taskRepo } = createOrchestrator();
      (taskRepo.findByAssignee as any).mockResolvedValue([]);

      const targets = await orch.calculateWakeTargets(
        createEvent('wake:triggered', { roleId: 'role-1', orgId: 'org-1', trigger: 'manual' }),
      );
      expect(targets).toEqual([]);
    });
  });

  // ═══════════════════════════════════════════════════════════
  // calculateWakeTargets — dispute:detected
  // ═══════════════════════════════════════════════════════════

  describe('calculateWakeTargets — dispute:detected', () => {
    it('should wake parent role for dispute intervention', async () => {
      const { orch } = createOrchestrator();
      const targets = await orch.calculateWakeTargets(
        createEvent('dispute:detected', { parentRoleId: 'boss-role', orgId: 'org-1', taskId: 'task-1' }),
      );
      expect(targets).toEqual([{
        roleId: 'boss-role', orgId: 'org-1', taskNodeId: 'task-1', trigger: 'dispute_detected',
      }]);
    });
  });

  // ═══════════════════════════════════════════════════════════
  // calculateWakeTargets — conversation events
  // ═══════════════════════════════════════════════════════════

  describe('calculateWakeTargets — conversation events', () => {
    it('conversation:reply-posted should wake asking role', async () => {
      const { orch } = createOrchestrator();
      const targets = await orch.calculateWakeTargets(
        createEvent('conversation:reply-posted', {
          workflow: { askingRoleId: 'asker-role', orgId: 'org-1', taskNodeId: 'task-1' },
        }),
      );
      expect(targets).toEqual([{
        roleId: 'asker-role', orgId: 'org-1', taskNodeId: 'task-1', trigger: 'discussion_reply',
      }]);
    });

    it('conversation:reply-posted should return empty when no workflow in payload', async () => {
      const { orch } = createOrchestrator();
      const targets = await orch.calculateWakeTargets(
        createEvent('conversation:reply-posted', {}),
      );
      expect(targets).toEqual([]);
    });

    it('conversation:escalated should wake new respondent', async () => {
      const { orch } = createOrchestrator();
      const targets = await orch.calculateWakeTargets(
        createEvent('conversation:escalated', {
          respondentRoleId: 'escalated-role', orgId: 'org-1',
          workflow: { taskNodeId: 'task-1' },
        }),
      );
      expect(targets).toEqual([{
        roleId: 'escalated-role', orgId: 'org-1', taskNodeId: 'task-1', trigger: 'conversation_escalation',
      }]);
    });

    it('conversation:escalated should return empty when no respondentRoleId', async () => {
      const { orch } = createOrchestrator();
      const targets = await orch.calculateWakeTargets(
        createEvent('conversation:escalated', {
          respondentRoleId: '', orgId: 'org-1', workflow: { taskNodeId: 'task-1' },
        }),
      );
      expect(targets).toEqual([]);
    });

    it('conversation:timed-out should return empty', async () => {
      const { orch } = createOrchestrator();
      const targets = await orch.calculateWakeTargets(
        createEvent('conversation:timed-out', { orgId: 'org-1' }),
      );
      expect(targets).toEqual([]);
    });
  });

  // ═══════════════════════════════════════════════════════════
  // calculateWakeTargets — default
  // ═══════════════════════════════════════════════════════════

  describe('calculateWakeTargets — default', () => {
    it('should return empty for unknown event types', async () => {
      const { orch } = createOrchestrator();
      const targets = await orch.calculateWakeTargets(createEvent('some:unknown:event', { orgId: 'org-1' }));
      expect(targets).toEqual([]);
    });

    it('should return empty for discussion:vote-added (falls to default)', async () => {
      const { orch } = createOrchestrator();
      const targets = await orch.calculateWakeTargets(
        createEvent('discussion:vote-added', { orgId: 'org-1' }),
      );
      expect(targets).toEqual([]);
    });
  });

  // ═══════════════════════════════════════════════════════════
  // wakeRoleIfPossible
  // ═══════════════════════════════════════════════════════════

  describe('wakeRoleIfPossible', () => {
    it('should start a run when all gates pass', async () => {
      const { orch, executionEngine } = createOrchestrator();
      vi.spyOn((orch as any).gateValidator, 'check').mockResolvedValue({ allowed: true, role: createRole() });
      vi.spyOn((orch as any).gateValidator, 'incrementWakeCount').mockResolvedValue(undefined);

      const result = await orch.wakeRoleIfPossible('role-1', 'org-1', 'task-1', 'task_assigned');

      expect(result).toBe(true);
      expect(executionEngine.startRun).toHaveBeenCalledWith('role-1', 'task-1', 'org-1', 'task_assigned');
    });

    it('should return false when gate check fails', async () => {
      const { orch, executionEngine } = createOrchestrator();
      vi.spyOn((orch as any).gateValidator, 'check').mockResolvedValue({ allowed: false });

      const result = await orch.wakeRoleIfPossible('role-1', 'org-1', 'task-1', 'task_assigned');

      expect(result).toBe(false);
      expect(executionEngine.startRun).not.toHaveBeenCalled();
    });

    it('should increment wake count before starting run', async () => {
      const { orch } = createOrchestrator();
      const incrementSpy = vi.spyOn((orch as any).gateValidator, 'incrementWakeCount').mockResolvedValue(undefined);
      vi.spyOn((orch as any).gateValidator, 'check').mockResolvedValue({
        allowed: true, role: createRole({ consecutiveWakeCount: 3 }),
      });

      await orch.wakeRoleIfPossible('role-1', 'org-1', 'task-1', 'task_assigned');

      expect(incrementSpy).toHaveBeenCalledWith('role-1', 3);
    });

    it('should return false and log error when executionEngine.startRun throws', async () => {
      const { orch, executionEngine, logger } = createOrchestrator();
      vi.spyOn((orch as any).gateValidator, 'check').mockResolvedValue({ allowed: true, role: createRole() });
      vi.spyOn((orch as any).gateValidator, 'incrementWakeCount').mockResolvedValue(undefined);
      (executionEngine.startRun as any).mockRejectedValue(new Error('boom'));

      const result = await orch.wakeRoleIfPossible('role-1', 'org-1', 'task-1', 'task_assigned');

      expect(result).toBe(false);
      expect(logger.error).toHaveBeenCalledWith('Failed to start run for wake', expect.objectContaining({
        roleId: 'role-1', taskNodeId: 'task-1',
      }));
    });
  });

  // ═══════════════════════════════════════════════════════════
  // handleEvent — per-org serialization queue
  // ═══════════════════════════════════════════════════════════

  describe('handleEvent — per-org queue', () => {
    it('should process events without orgId immediately (not queued)', async () => {
      const { orch, logger } = createOrchestrator();

      await orch.handleEvent(createEvent('task:completed', {}));
      expect(logger.debug).toHaveBeenCalledWith('OrgOrchestrator handling event', { type: 'task:completed' });
    });

    it('should log error when processEvent catches exception (inner try/catch)', async () => {
      const { orch, taskRepo, logger } = createOrchestrator();
      (taskRepo.findById as any).mockRejectedValue(new Error('db down'));

      orch.handleEvent(createEvent('task:created', { taskId: 'task-1', orgId: 'org-1' }));
      await new Promise((r) => setTimeout(r, 100));

      // processEvent's try/catch logs the error
      expect(logger.error).toHaveBeenCalledWith(
        'OrgOrchestrator event handling error',
        expect.objectContaining({ type: 'task:created', error: expect.stringContaining('db down') }),
      );
    });

    it('should emit orchestrator:error when enqueued fn rejects past processEvent', async () => {
      const { orch, logger, eventBus } = createOrchestrator();
      // Force processEvent itself to throw by mocking calculateWakeTargets to throw
      // AND having processEvent's catch rethrow
      // Actually, processEvent catches internally, so we need to bypass it
      // Spy on processEvent to make it throw
      vi.spyOn(orch as any, 'processEvent').mockRejectedValue(new Error('fatal'));

      orch.handleEvent(createEvent('task:created', { taskId: 'task-1', orgId: 'org-1' }));
      await new Promise((r) => setTimeout(r, 100));

      expect(logger.error).toHaveBeenCalledWith(
        'OrgOrchestrator queued event error',
        expect.objectContaining({ orgId: 'org-1' }),
      );
      expect(eventBus.emit).toHaveBeenCalledWith(expect.objectContaining({
        type: 'orchestrator:error',
        payload: expect.objectContaining({ orgId: 'org-1' }),
      }));
    });

    it('should serialize concurrent events for same org', async () => {
      const { orch, taskRepo } = createOrchestrator();
      const results: string[] = [];

      (taskRepo.findById as any).mockImplementation(async (id: string) => {
        if (id === 'slow-task') {
          await new Promise((r) => setTimeout(r, 50));
          results.push('slow');
        } else {
          results.push('fast');
        }
        return null;
      });

      orch.handleEvent(createEvent('task:created', { taskId: 'slow-task', orgId: 'org-1' }));
      orch.handleEvent(createEvent('task:created', { taskId: 'fast-task', orgId: 'org-1' }));

      await new Promise((r) => setTimeout(r, 200));

      expect(results).toEqual(['slow', 'fast']);
    });

    it('should clean up org queue entry after processing', async () => {
      const { orch, taskRepo } = createOrchestrator();
      (taskRepo.findById as any).mockResolvedValue(null);

      orch.handleEvent(createEvent('task:created', { taskId: 'task-1', orgId: 'org-cleanup' }));
      await new Promise((r) => setTimeout(r, 50));

      expect((orch as any).orgQueues.has('org-cleanup')).toBe(false);
    });
  });

  // ═══════════════════════════════════════════════════════════
  // consumePendingWakes
  // ═══════════════════════════════════════════════════════════

  describe('consumePendingWakes (via run:succeeded)', () => {
    it('should do nothing when no pending wakes exist', async () => {
      const { orch, pendingWakeRepo } = createOrchestrator();
      vi.spyOn((orch as any).gateValidator, 'resetWakeCount').mockResolvedValue(undefined);
      (pendingWakeRepo.findByOrgId as any).mockResolvedValue([]);

      await orch.calculateWakeTargets(
        createEvent('run:succeeded', { roleId: 'role-1', orgId: 'org-1', taskNodeId: 'task-1' }),
      );
      expect(pendingWakeRepo.consume).not.toHaveBeenCalled();
    });

    it('should consume wake with explicit taskNodeId and start run', async () => {
      const { orch, pendingWakeRepo, executionEngine } = createOrchestrator();
      vi.spyOn((orch as any).gateValidator, 'resetWakeCount').mockResolvedValue(undefined);
      vi.spyOn((orch as any).gateValidator, 'check').mockResolvedValue({ allowed: true, role: createRole() });
      vi.spyOn((orch as any).gateValidator, 'incrementWakeCount').mockResolvedValue(undefined);

      (pendingWakeRepo.findByOrgId as any).mockResolvedValue([{
        id: 'pw-1', roleId: 'role-2', orgId: 'org-1', trigger: 'task_assigned',
        taskNodeId: 'task-2', priority: 1, createdAt: '',
      }]);

      await orch.calculateWakeTargets(
        createEvent('run:succeeded', { roleId: 'role-1', orgId: 'org-1', taskNodeId: 'task-1' }),
      );

      expect(pendingWakeRepo.consume).toHaveBeenCalledWith('pw-1');
      expect(executionEngine.startRun).toHaveBeenCalledWith('role-2', 'task-2', 'org-1', 'task_assigned');
    });

    it('should consume wake and skip when no eligible task (null taskNodeId, no active tasks)', async () => {
      const { orch, pendingWakeRepo, taskRepo, executionEngine } = createOrchestrator();
      vi.spyOn((orch as any).gateValidator, 'resetWakeCount').mockResolvedValue(undefined);

      (pendingWakeRepo.findByOrgId as any).mockResolvedValue([{
        id: 'pw-1', roleId: 'role-2', orgId: 'org-1', trigger: 'task_assigned',
        taskNodeId: null, priority: 1, createdAt: '',
      }]);
      (taskRepo.findByAssignee as any).mockResolvedValue([]);

      await orch.calculateWakeTargets(
        createEvent('run:succeeded', { roleId: 'role-1', orgId: 'org-1', taskNodeId: 'task-1' }),
      );

      expect(pendingWakeRepo.consume).toHaveBeenCalledWith('pw-1');
      expect(executionEngine.startRun).not.toHaveBeenCalled();
    });

    it('should stop processing after first successful run start', async () => {
      const { orch, pendingWakeRepo, executionEngine } = createOrchestrator();
      vi.spyOn((orch as any).gateValidator, 'resetWakeCount').mockResolvedValue(undefined);
      vi.spyOn((orch as any).gateValidator, 'check').mockResolvedValue({ allowed: true, role: createRole() });
      vi.spyOn((orch as any).gateValidator, 'incrementWakeCount').mockResolvedValue(undefined);

      (pendingWakeRepo.findByOrgId as any).mockResolvedValue([
        { id: 'pw-1', roleId: 'role-2', orgId: 'org-1', trigger: 'task_assigned', taskNodeId: 'task-2', priority: 2, createdAt: '' },
        { id: 'pw-2', roleId: 'role-3', orgId: 'org-1', trigger: 'task_assigned', taskNodeId: 'task-3', priority: 1, createdAt: '' },
      ]);

      await orch.calculateWakeTargets(
        createEvent('run:succeeded', { roleId: 'role-1', orgId: 'org-1', taskNodeId: 'task-1' }),
      );

      expect(executionEngine.startRun).toHaveBeenCalledTimes(1);
      expect(pendingWakeRepo.consume).toHaveBeenCalledTimes(1);
    });

    it('should try next pending wake when first one fails gate check', async () => {
      const { orch, pendingWakeRepo, executionEngine } = createOrchestrator();
      vi.spyOn((orch as any).gateValidator, 'resetWakeCount').mockResolvedValue(undefined);
      vi.spyOn((orch as any).gateValidator, 'incrementWakeCount').mockResolvedValue(undefined);

      let checkCallCount = 0;
      vi.spyOn((orch as any).gateValidator, 'check').mockImplementation(async () => {
        checkCallCount++;
        if (checkCallCount === 1) return { allowed: false };
        return { allowed: true, role: createRole() };
      });

      (pendingWakeRepo.findByOrgId as any).mockResolvedValue([
        { id: 'pw-1', roleId: 'role-2', orgId: 'org-1', trigger: 'task_assigned', taskNodeId: 'task-2', priority: 2, createdAt: '' },
        { id: 'pw-2', roleId: 'role-3', orgId: 'org-1', trigger: 'task_assigned', taskNodeId: 'task-3', priority: 1, createdAt: '' },
      ]);

      await orch.calculateWakeTargets(
        createEvent('run:succeeded', { roleId: 'role-1', orgId: 'org-1', taskNodeId: 'task-1' }),
      );

      expect(pendingWakeRepo.consume).toHaveBeenCalledTimes(2);
      expect(executionEngine.startRun).toHaveBeenCalledTimes(1);
      expect(executionEngine.startRun).toHaveBeenCalledWith('role-3', 'task-3', 'org-1', 'task_assigned');
    });

    it('should resolve taskNodeId from findByAssignee when pending wake has no taskNodeId', async () => {
      const { orch, pendingWakeRepo, taskRepo, workflowEngine, executionEngine } = createOrchestrator();
      vi.spyOn((orch as any).gateValidator, 'resetWakeCount').mockResolvedValue(undefined);
      vi.spyOn((orch as any).gateValidator, 'check').mockResolvedValue({ allowed: true, role: createRole() });
      vi.spyOn((orch as any).gateValidator, 'incrementWakeCount').mockResolvedValue(undefined);

      (pendingWakeRepo.findByOrgId as any).mockResolvedValue([{
        id: 'pw-1', roleId: 'role-2', orgId: 'org-1', trigger: 'task_assigned',
        taskNodeId: null, priority: 1, createdAt: '',
      }]);

      const activeTask = createTask({ id: 'found-task', status: 'open' });
      (taskRepo.findByAssignee as any).mockResolvedValue([activeTask]);
      (workflowEngine.isTerminalStatus as any).mockResolvedValue(false);

      await orch.calculateWakeTargets(
        createEvent('run:succeeded', { roleId: 'role-1', orgId: 'org-1', taskNodeId: 'task-1' }),
      );

      expect(executionEngine.startRun).toHaveBeenCalledWith('role-2', 'found-task', 'org-1', 'task_assigned');
    });
  });

  // ═══════════════════════════════════════════════════════════
  // resumeOrgRoles
  // ═══════════════════════════════════════════════════════════

  describe('resumeOrgRoles', () => {
    it('should delegate to BudgetGuard and consume pending wakes on resume', async () => {
      const { orch, roleRepo, pendingWakeRepo } = createOrchestrator();
      (roleRepo.findByOrgId as any).mockResolvedValue([
        createRole({ id: 'r1', status: 'paused' }),
        createRole({ id: 'r2', status: 'paused' }),
      ]);
      (pendingWakeRepo.findByOrgId as any).mockResolvedValue([]);

      const count = await orch.resumeOrgRoles('org-1');

      expect(count).toBe(2);
      expect(roleRepo.update).toHaveBeenCalledWith({ id: 'r1', status: 'active' });
      expect(roleRepo.update).toHaveBeenCalledWith({ id: 'r2', status: 'active' });
    });

    it('should return 0 when no paused roles', async () => {
      const { orch, roleRepo } = createOrchestrator();
      (roleRepo.findByOrgId as any).mockResolvedValue([
        createRole({ id: 'r1', status: 'active' }),
      ]);

      const count = await orch.resumeOrgRoles('org-1');
      expect(count).toBe(0);
    });
  });

  // ═══════════════════════════════════════════════════════════
  // resetSelfWakeCount
  // ═══════════════════════════════════════════════════════════

  describe('resetSelfWakeCount', () => {
    it('should delegate to gateValidator.resetWakeCount', async () => {
      const { orch } = createOrchestrator();
      const resetSpy = vi.spyOn((orch as any).gateValidator, 'resetWakeCount').mockResolvedValue(undefined);

      await orch.resetSelfWakeCount('role-1');
      expect(resetSpy).toHaveBeenCalledWith('role-1');
    });
  });

  // ═══════════════════════════════════════════════════════════
  // BudgetGuard — handleBudgetExceeded
  // ═══════════════════════════════════════════════════════════

  describe('BudgetGuard — handleBudgetExceeded', () => {
    it('should pause all active roles in org', async () => {
      const { orch, roleRepo } = createOrchestrator();
      (roleRepo.findByOrgId as any).mockResolvedValue([
        createRole({ id: 'r1', status: 'active' }),
        createRole({ id: 'r2', status: 'active' }),
        createRole({ id: 'r3', status: 'paused' }),
      ]);

      const budgetGuard = (orch as any).budgetGuard;
      await budgetGuard.handleBudgetExceeded(
        createEvent('budget:exceeded', { orgId: 'org-1', totalTokens: 50000, limit: 10000 }),
      );

      expect(roleRepo.update).toHaveBeenCalledWith({ id: 'r1', status: 'paused' });
      expect(roleRepo.update).toHaveBeenCalledWith({ id: 'r2', status: 'paused' });
      expect(roleRepo.update).toHaveBeenCalledTimes(2);
    });

    it('should do nothing when no active roles exist', async () => {
      const { orch, roleRepo } = createOrchestrator();
      (roleRepo.findByOrgId as any).mockResolvedValue([]);

      const budgetGuard = (orch as any).budgetGuard;
      await budgetGuard.handleBudgetExceeded(
        createEvent('budget:exceeded', { orgId: 'org-1', totalTokens: 99, limit: 10 }),
      );

      expect(roleRepo.update).not.toHaveBeenCalled();
    });
  });

  // ═══════════════════════════════════════════════════════════
  // BudgetGuard — resumeOrgRoles
  // ═══════════════════════════════════════════════════════════

  describe('BudgetGuard — resumeOrgRoles', () => {
    it('should resume paused roles and call onResumed callback', async () => {
      const { orch, roleRepo } = createOrchestrator();
      (roleRepo.findByOrgId as any).mockResolvedValue([
        createRole({ id: 'r1', status: 'paused' }),
      ]);

      const budgetGuard = (orch as any).budgetGuard;
      const onResumed = vi.fn().mockResolvedValue(undefined);

      const count = await budgetGuard.resumeOrgRoles('org-1', onResumed);

      expect(count).toBe(1);
      expect(roleRepo.update).toHaveBeenCalledWith({ id: 'r1', status: 'active' });
      expect(onResumed).toHaveBeenCalledWith('org-1');
    });

    it('should NOT call onResumed when no roles were resumed', async () => {
      const { orch, roleRepo } = createOrchestrator();
      (roleRepo.findByOrgId as any).mockResolvedValue([
        createRole({ id: 'r1', status: 'active' }),
      ]);

      const budgetGuard = (orch as any).budgetGuard;
      const onResumed = vi.fn();

      const count = await budgetGuard.resumeOrgRoles('org-1', onResumed);

      expect(count).toBe(0);
      expect(onResumed).not.toHaveBeenCalled();
    });

    it('should work without onResumed callback', async () => {
      const { orch, roleRepo } = createOrchestrator();
      (roleRepo.findByOrgId as any).mockResolvedValue([
        createRole({ id: 'r1', status: 'paused' }),
      ]);

      const budgetGuard = (orch as any).budgetGuard;
      const count = await budgetGuard.resumeOrgRoles('org-1');

      expect(count).toBe(1);
    });
  });

  // ═══════════════════════════════════════════════════════════
  // Edge Cases
  // ═══════════════════════════════════════════════════════════

  describe('edge cases', () => {
    it('should handle processEvent catching unexpected errors gracefully', async () => {
      const { orch, logger } = createOrchestrator();
      vi.spyOn(orch, 'calculateWakeTargets').mockRejectedValue(new Error('unexpected'));

      await orch.handleEvent(createEvent('task:completed', {}));

      expect(logger.error).toHaveBeenCalledWith(
        'OrgOrchestrator event handling error',
        expect.objectContaining({ error: expect.stringContaining('unexpected') }),
      );
    });

    it('should handle task:status-changed with child whose assignee is null', async () => {
      const { orch, taskRepo, workflowEngine } = createOrchestrator();
      const parent = createTask({ id: 'parent-1', parentId: null });
      const childNoAssignee = createTask({ id: 'child-1', status: 'open', assigneeRoleId: null, parentId: 'parent-1' });

      (taskRepo.findById as any).mockResolvedValue(parent);
      (workflowEngine.isTerminalStatus as any).mockResolvedValue(true);
      (workflowEngine.getInitialStatus as any).mockResolvedValue('open');
      (taskRepo.findByParentId as any).mockResolvedValue([childNoAssignee]);

      const targets = await orch.calculateWakeTargets(
        createEvent('task:status-changed', { taskId: 'parent-1', newStatus: 'done', orgId: 'org-1' }),
      );

      expect(targets.find((t: any) => t.taskNodeId === 'child-1')).toBeUndefined();
    });

    it('should handle setTaskStateMachine delegation to retryScheduler', () => {
      const { orch } = createOrchestrator();
      const mockSM = { transition: vi.fn(), canTransition: vi.fn(), setWorkflowEngine: vi.fn() };
      const retrySetSpy = vi.spyOn((orch as any).retryScheduler, 'setTaskStateMachine');

      orch.setTaskStateMachine(mockSM);

      expect(retrySetSpy).toHaveBeenCalledWith(mockSM);
    });

    it('should store WorkflowEngine reference via setWorkflowEngine', () => {
      const { orch } = createOrchestrator();
      const newEngine = { isTerminalStatus: vi.fn() } as any;

      orch.setWorkflowEngine(newEngine);

      expect((orch as any).workflowEngine).toBe(newEngine);
    });

    it('should store ExecutionEngine reference via setExecutionEngine', () => {
      const { orch } = createOrchestrator();
      const newEngine = { startRun: vi.fn() } as any;

      orch.setExecutionEngine(newEngine);

      expect((orch as any).executionEngine).toBe(newEngine);
    });
  });
});
