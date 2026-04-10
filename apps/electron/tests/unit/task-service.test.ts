/**
 * TaskService Unit Tests
 *
 * Covers: task creation (validation, depth, type hierarchy, behavior rules),
 * status updates (review strategy, behavior evaluation, auto-propagation),
 * delete (recursive, cleanup), action execution, cycle protection, edge cases.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('tsyringe', () => ({
  injectable: () => (target: any) => target,
  inject: () => () => undefined,
}));

vi.mock('@main/core/tokens.js', () => ({
  TASK_REPO_TOKEN: Symbol('TASK_REPO_TOKEN'),
  ROLE_REPO_TOKEN: Symbol('ROLE_REPO_TOKEN'),
  PENDING_WAKE_REPO_TOKEN: Symbol('PENDING_WAKE_REPO_TOKEN'),
  DISCUSSION_REPO_TOKEN: Symbol('DISCUSSION_REPO_TOKEN'),
  EVENT_BUS_TOKEN: Symbol('EVENT_BUS_TOKEN'),
  LOGGER_TOKEN: Symbol('LOGGER_TOKEN'),
}));

import { TaskService } from '@main/application/tasks/task.service.js';
import { NotFoundError, ValidationError } from '@main/core/errors/capibara.errors.js';
import { InvalidTypeError } from '@main/core/errors/workflow.errors.js';
import type { ITaskRepository } from '@main/core/interfaces/i-task.repository.js';
import type { IRoleRepository } from '@main/core/interfaces/i-role.repository.js';
import type { IPendingWakeRepository } from '@main/core/interfaces/i-pending-wake.repository.js';
import type { IDiscussionRepository } from '@main/core/interfaces/i-discussion.repository.js';
import type { IEventBus } from '@main/core/interfaces/i-event-bus.js';
import type { ILogger } from '@main/core/interfaces/i-logger.js';
import type { IWorkflowEngine } from '@main/core/interfaces/i-workflow-engine.js';
import type { TaskNode, Role } from '@main/core/types/domain.types.js';
import type { BehaviorAction } from '@main/core/types/behavior.types.js';
import type { TaskStateMachine } from '@main/application/state-machine/task.state-machine.js';

// ─── Mock Factories ─────────────────────────────────────────

function createMockLogger(): ILogger {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    child: vi.fn().mockReturnThis(),
  };
}

function createMockEventBus(): IEventBus {
  return { emit: vi.fn(), on: vi.fn(), off: vi.fn() } as any;
}

function createTask(overrides: Partial<TaskNode> = {}): TaskNode {
  return {
    id: 'task-1',
    orgId: 'org-1',
    parentId: null,
    type: 'story',
    title: 'Test Task',
    description: '',
    status: 'open',
    assigneeRoleId: null,
    depth: 0,
    artifactPaths: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

function createRole(overrides: Partial<Role> = {}): Role {
  return {
    id: 'role-1',
    orgId: 'org-1',
    name: 'Developer',
    parentId: null,
    persona: 'A developer',
    knowledgeBaseRefs: [],
    skillIds: [],
    canApprove: true,
    canDelegate: false,
    requiresHumanApproval: false,
    consecutiveWakeCount: 0,
    status: 'active',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

function createMockTaskRepo(): ITaskRepository {
  return {
    findById: vi.fn().mockResolvedValue(null),
    findByParentId: vi.fn().mockResolvedValue([]),
    findByOrgId: vi.fn().mockResolvedValue([]),
    findByAssignee: vi.fn().mockResolvedValue([]),
    create: vi.fn().mockImplementation(async (input) => createTask({
      id: `task-${Date.now()}`,
      ...input,
    })),
    updateStatus: vi.fn().mockResolvedValue(undefined),
    updateAssignee: vi.fn().mockResolvedValue(undefined),
    setArtifactPaths: vi.fn().mockResolvedValue(undefined),
    delete: vi.fn().mockResolvedValue(undefined),
  } as any;
}

function createMockRoleRepo(): IRoleRepository {
  return {
    findById: vi.fn().mockResolvedValue(null),
    findByIds: vi.fn().mockResolvedValue([]),
    findByOrgId: vi.fn().mockResolvedValue([]),
    findChildren: vi.fn().mockResolvedValue([]),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  } as any;
}

function createMockPendingWakeRepo(): IPendingWakeRepository {
  return {
    findByRoleId: vi.fn(),
    findByOrgId: vi.fn(),
    findHighestPriority: vi.fn(),
    create: vi.fn(),
    consume: vi.fn(),
    consumeAllForRole: vi.fn(),
    consumeByRoleAndTask: vi.fn().mockResolvedValue(0),
  } as any;
}

function createMockDiscussionRepo(): IDiscussionRepository {
  return {
    findGroupById: vi.fn(),
    findGroupByTaskNodeId: vi.fn().mockResolvedValue(null),
    findGroupsByOrgId: vi.fn(),
    createGroup: vi.fn().mockResolvedValue({ id: 'group-1' }),
    updateGroupStatus: vi.fn(),
    updateGroupSummary: vi.fn(),
    findMessagesByGroupId: vi.fn(),
    findRecentMessages: vi.fn(),
    postMessage: vi.fn(),
    getVoteStats: vi.fn(),
    getVoteStatsForRound: vi.fn(),
    incrementRound: vi.fn(),
    incrementReviseCount: vi.fn(),
    resetReviseCount: vi.fn(),
    deleteGroupByTaskNodeId: vi.fn().mockResolvedValue(undefined),
  } as any;
}

function createMockStateMachine(): TaskStateMachine {
  return {
    setWorkflowEngine: vi.fn(),
    canTransition: vi.fn().mockResolvedValue(true),
    transition: vi.fn().mockResolvedValue(undefined),
  } as any;
}

function createMockWorkflowEngine(): IWorkflowEngine {
  return {
    validateType: vi.fn().mockResolvedValue(true),
    getItemTypeDefinition: vi.fn().mockResolvedValue(null),
    getAllItemTypes: vi.fn().mockResolvedValue([]),
    getRootTypes: vi.fn().mockResolvedValue([]),
    canTransition: vi.fn().mockResolvedValue(true),
    getManualTransitions: vi.fn().mockResolvedValue([]),
    getAllStatuses: vi.fn().mockResolvedValue([]),
    getInitialStatus: vi.fn().mockResolvedValue('open'),
    isTerminalStatus: vi.fn().mockResolvedValue(false),
    isReviewStatus: vi.fn().mockResolvedValue(false),
    isActiveStatus: vi.fn().mockResolvedValue(false),
    getFirstReviewStatus: vi.fn().mockResolvedValue(null),
    findTransitionTargetByCategory: vi.fn().mockResolvedValue(null),
    evaluateBehaviors: vi.fn().mockResolvedValue([]),
    getActiveSchema: vi.fn(),
    saveSchema: vi.fn(),
    analyzeImpactReadOnly: vi.fn(),
    validateSchemaIntegrity: vi.fn().mockReturnValue([]),
    invalidateCache: vi.fn(),
  } as IWorkflowEngine;
}

// ─── Helper to instantiate TaskService ──────────────────────

interface ServiceDeps {
  taskRepo: ITaskRepository;
  roleRepo: IRoleRepository;
  pendingWakeRepo: IPendingWakeRepository;
  discussionRepo: IDiscussionRepository;
  eventBus: IEventBus;
  logger: ILogger;
  stateMachine: TaskStateMachine;
  workflowEngine: IWorkflowEngine;
  service: TaskService;
}

function createService(): ServiceDeps {
  const taskRepo = createMockTaskRepo();
  const roleRepo = createMockRoleRepo();
  const pendingWakeRepo = createMockPendingWakeRepo();
  const discussionRepo = createMockDiscussionRepo();
  const eventBus = createMockEventBus();
  const logger = createMockLogger();
  const stateMachine = createMockStateMachine();
  const workflowEngine = createMockWorkflowEngine();

  const service = new (TaskService as any)(
    taskRepo,
    roleRepo,
    pendingWakeRepo,
    discussionRepo,
    eventBus,
    logger,
    stateMachine,
  );
  service.setWorkflowEngine(workflowEngine);

  return { taskRepo, roleRepo, pendingWakeRepo, discussionRepo, eventBus, logger, stateMachine, workflowEngine, service };
}

// ─── Tests ──────────────────────────────────────────────────

describe('TaskService', () => {

  // ═══════════════════════════════════════════════════════════
  // create
  // ═══════════════════════════════════════════════════════════

  describe('create', () => {
    it('should create a root-level task successfully', async () => {
      const { service, taskRepo, workflowEngine } = createService();

      const task = await service.create({
        orgId: 'org-1', parentId: null, type: 'epic', title: 'My Epic', description: 'desc', assigneeRoleId: null,
      });

      expect(taskRepo.create).toHaveBeenCalledWith(expect.objectContaining({
        orgId: 'org-1', parentId: null, type: 'epic', title: 'My Epic', depth: 0,
      }));
      expect(workflowEngine.validateType).toHaveBeenCalledWith('org-1', 'epic', null);
    });

    it('should create a child task with correct depth', async () => {
      const { service, taskRepo } = createService();
      const parent = createTask({ id: 'parent-1', depth: 2, type: 'story' });
      (taskRepo.findById as any).mockResolvedValue(parent);

      await service.create({
        orgId: 'org-1', parentId: 'parent-1', type: 'subtask', title: 'Sub', description: '', assigneeRoleId: null,
      });

      expect(taskRepo.create).toHaveBeenCalledWith(expect.objectContaining({ depth: 3 }));
    });

    it('should emit task:created event', async () => {
      const { service, eventBus, taskRepo } = createService();
      const createdTask = createTask({ id: 'new-task', orgId: 'org-1', type: 'epic' });
      (taskRepo.create as any).mockResolvedValue(createdTask);

      await service.create({
        orgId: 'org-1', parentId: null, type: 'epic', title: 'Epic', description: '', assigneeRoleId: null,
      });

      expect(eventBus.emit).toHaveBeenCalledWith(expect.objectContaining({
        type: 'task:created',
        payload: expect.objectContaining({ taskId: 'new-task', orgId: 'org-1', type: 'epic' }),
      }));
    });

    it('should evaluate on_task_created behavior rules after creation', async () => {
      const { service, workflowEngine, taskRepo } = createService();
      const createdTask = createTask({ id: 'new-task' });
      (taskRepo.create as any).mockResolvedValue(createdTask);
      (taskRepo.findByParentId as any).mockResolvedValue([]);

      await service.create({
        orgId: 'org-1', parentId: null, type: 'epic', title: 'Epic', description: '', assigneeRoleId: null,
      });

      expect(workflowEngine.evaluateBehaviors).toHaveBeenCalledWith(
        'org-1',
        { type: 'on_task_created' },
        expect.objectContaining({ taskId: 'new-task' }),
      );
    });

    it('should execute behavior actions from on_task_created', async () => {
      const { service, workflowEngine, stateMachine, taskRepo } = createService();
      const createdTask = createTask({ id: 'new-task' });
      (taskRepo.create as any).mockResolvedValue(createdTask);
      (taskRepo.findByParentId as any).mockResolvedValue([]);
      (workflowEngine.evaluateBehaviors as any).mockResolvedValue([
        { type: 'auto_transition', targetStatus: 'in_progress' },
      ]);

      await service.create({
        orgId: 'org-1', parentId: null, type: 'epic', title: 'Epic', description: '', assigneeRoleId: null,
      });

      expect(stateMachine.transition).toHaveBeenCalledWith('new-task', 'in_progress');
    });

    it('should stop executing actions after skip_propagation', async () => {
      const { service, workflowEngine, stateMachine, eventBus, taskRepo } = createService();
      const createdTask = createTask({ id: 'new-task' });
      (taskRepo.create as any).mockResolvedValue(createdTask);
      (taskRepo.findByParentId as any).mockResolvedValue([]);
      (workflowEngine.evaluateBehaviors as any).mockResolvedValue([
        { type: 'skip_propagation' },
        { type: 'auto_transition', targetStatus: 'done' },
      ]);

      await service.create({
        orgId: 'org-1', parentId: null, type: 'epic', title: 'Epic', description: '', assigneeRoleId: null,
      });

      // auto_transition should not be called (skipped)
      expect(stateMachine.transition).not.toHaveBeenCalled();
    });

    it('should log error but not throw if behavior action fails', async () => {
      const { service, workflowEngine, stateMachine, logger, taskRepo } = createService();
      const createdTask = createTask({ id: 'new-task' });
      (taskRepo.create as any).mockResolvedValue(createdTask);
      (taskRepo.findByParentId as any).mockResolvedValue([]);
      (workflowEngine.evaluateBehaviors as any).mockResolvedValue([
        { type: 'auto_transition', targetStatus: 'bad_status' },
      ]);
      (stateMachine.transition as any).mockRejectedValue(new Error('Transition failed'));

      const result = await service.create({
        orgId: 'org-1', parentId: null, type: 'epic', title: 'Epic', description: '', assigneeRoleId: null,
      });

      expect(result).toBeDefined(); // still returns the task
      expect(logger.error).toHaveBeenCalledWith(
        'on_task_created behavior action failed',
        expect.objectContaining({ taskId: 'new-task' }),
      );
    });

    // --- Validation errors ---

    it('should throw ValidationError for empty title', async () => {
      const { service } = createService();

      await expect(service.create({
        orgId: 'org-1', parentId: null, type: 'epic', title: '', description: '', assigneeRoleId: null,
      })).rejects.toThrow(ValidationError);
    });

    it('should throw ValidationError for whitespace-only title', async () => {
      const { service } = createService();

      await expect(service.create({
        orgId: 'org-1', parentId: null, type: 'epic', title: '   ', description: '', assigneeRoleId: null,
      })).rejects.toThrow(ValidationError);
    });

    it('should throw NotFoundError for nonexistent assignee role', async () => {
      const { service, roleRepo } = createService();
      (roleRepo.findById as any).mockResolvedValue(null);

      await expect(service.create({
        orgId: 'org-1', parentId: null, type: 'epic', title: 'Epic', description: '', assigneeRoleId: 'nonexistent-role',
      })).rejects.toThrow(NotFoundError);
    });

    it('should validate assignee exists when provided', async () => {
      const { service, roleRepo } = createService();
      const role = createRole({ id: 'role-1' });
      (roleRepo.findById as any).mockResolvedValue(role);

      await service.create({
        orgId: 'org-1', parentId: null, type: 'epic', title: 'Epic', description: '', assigneeRoleId: 'role-1',
      });

      expect(roleRepo.findById).toHaveBeenCalledWith('role-1');
    });

    it('should throw NotFoundError for nonexistent parent', async () => {
      const { service, taskRepo } = createService();
      (taskRepo.findById as any).mockResolvedValue(null);

      await expect(service.create({
        orgId: 'org-1', parentId: 'nonexistent', type: 'story', title: 'Story', description: '', assigneeRoleId: null,
      })).rejects.toThrow(NotFoundError);
    });

    it('should throw InvalidTypeError for invalid root type', async () => {
      const { service, workflowEngine } = createService();
      (workflowEngine.validateType as any).mockResolvedValue(false);
      (workflowEngine.getRootTypes as any).mockResolvedValue([{ name: 'epic' }]);

      await expect(service.create({
        orgId: 'org-1', parentId: null, type: 'subtask', title: 'Sub', description: '', assigneeRoleId: null,
      })).rejects.toThrow(InvalidTypeError);
    });

    it('should throw InvalidTypeError for invalid child type under parent', async () => {
      const { service, taskRepo, workflowEngine } = createService();
      const parent = createTask({ id: 'parent-1', type: 'subtask' });
      (taskRepo.findById as any).mockResolvedValue(parent);
      (workflowEngine.validateType as any).mockResolvedValue(false);
      (workflowEngine.getItemTypeDefinition as any).mockResolvedValue({ allowedChildren: [] });

      await expect(service.create({
        orgId: 'org-1', parentId: 'parent-1', type: 'epic', title: 'Epic', description: '', assigneeRoleId: null,
      })).rejects.toThrow(InvalidTypeError);
    });
  });

  // ═══════════════════════════════════════════════════════════
  // updateStatus
  // ═══════════════════════════════════════════════════════════

  describe('updateStatus', () => {
    it('should delegate to stateMachine.transition', async () => {
      const { service, stateMachine, taskRepo } = createService();
      const task = createTask({ id: 'task-1', status: 'in_progress' });
      (taskRepo.findById as any).mockResolvedValue(task);

      await service.updateStatus('task-1', 'in_review');

      expect(stateMachine.transition).toHaveBeenCalledWith('task-1', 'in_review');
    });

    it('should evaluate on_status_enter behavior rules', async () => {
      const { service, taskRepo, workflowEngine } = createService();
      const task = createTask({ id: 'task-1', status: 'in_progress' });
      (taskRepo.findById as any).mockResolvedValue(task);

      await service.updateStatus('task-1', 'in_progress');

      expect(workflowEngine.evaluateBehaviors).toHaveBeenCalledWith(
        'org-1',
        { type: 'on_status_enter', status: 'in_progress' },
        expect.objectContaining({ taskId: 'task-1' }),
      );
    });

    it('should return silently if task not found after transition', async () => {
      const { service, taskRepo, workflowEngine } = createService();
      (taskRepo.findById as any).mockResolvedValue(null);

      await service.updateStatus('task-gone', 'done');

      expect(workflowEngine.evaluateBehaviors).not.toHaveBeenCalled();
    });

    // --- Review status strategy ---

    describe('review status strategy', () => {
      it('should skip AI review when assignee requires human approval', async () => {
        const { service, taskRepo, roleRepo, workflowEngine, eventBus } = createService();
        const task = createTask({ id: 'task-1', assigneeRoleId: 'role-1' });
        (taskRepo.findById as any).mockResolvedValue(task);
        (workflowEngine.isReviewStatus as any).mockResolvedValue(true);
        const humanRole = createRole({ id: 'role-1', requiresHumanApproval: true });
        (roleRepo.findById as any).mockResolvedValue(humanRole);

        await service.updateStatus('task-1', 'in_review');

        // Should not emit wake:triggered or evaluate further behaviors
        const wakeEmits = (eventBus.emit as any).mock.calls.filter(
          (c: any[]) => c[0]?.type === 'wake:triggered',
        );
        expect(wakeEmits).toHaveLength(0);
        // evaluateBehaviors should not be called (early return)
        expect(workflowEngine.evaluateBehaviors).not.toHaveBeenCalled();
      });

      it('should wake parent role for AI review when no human approval needed', async () => {
        const { service, taskRepo, roleRepo, workflowEngine, eventBus } = createService();
        const task = createTask({ id: 'task-1', parentId: 'parent-1', assigneeRoleId: 'role-1' });
        const parentTask = createTask({ id: 'parent-1', assigneeRoleId: 'role-parent' });
        (taskRepo.findById as any).mockImplementation(async (id: string) => {
          if (id === 'task-1') return task;
          if (id === 'parent-1') return parentTask;
          return null;
        });
        (workflowEngine.isReviewStatus as any).mockResolvedValue(true);
        const aiRole = createRole({ id: 'role-1', requiresHumanApproval: false });
        (roleRepo.findById as any).mockResolvedValue(aiRole);

        await service.updateStatus('task-1', 'in_review');

        expect(eventBus.emit).toHaveBeenCalledWith(expect.objectContaining({
          type: 'wake:triggered',
          payload: expect.objectContaining({
            roleId: 'role-parent',
            trigger: 'review_requested',
            taskNodeId: 'parent-1',
          }),
        }));
      });

      it('should auto-approve when no parent reviewer and no human approval', async () => {
        const { service, taskRepo, roleRepo, workflowEngine, stateMachine } = createService();
        const task = createTask({ id: 'task-1', parentId: null, assigneeRoleId: 'role-1' });
        (taskRepo.findById as any).mockResolvedValue(task);
        (taskRepo.findByParentId as any).mockResolvedValue([]);
        (workflowEngine.isReviewStatus as any).mockResolvedValue(true);
        const aiRole = createRole({ id: 'role-1', requiresHumanApproval: false });
        (roleRepo.findById as any).mockResolvedValue(aiRole);
        (workflowEngine.getManualTransitions as any).mockResolvedValue([
          { from: 'in_review', to: 'done', trigger: 'manual' },
        ]);

        await service.updateStatus('task-1', 'in_review');

        // Should auto-approve via first manual transition
        expect(stateMachine.transition).toHaveBeenCalledWith('task-1', 'done');
      });

      it('should not auto-approve when no assignee role', async () => {
        const { service, taskRepo, workflowEngine, stateMachine } = createService();
        const task = createTask({ id: 'task-1', parentId: null, assigneeRoleId: null });
        (taskRepo.findById as any).mockResolvedValue(task);
        (taskRepo.findByParentId as any).mockResolvedValue([]);
        (workflowEngine.isReviewStatus as any).mockResolvedValue(true);

        await service.updateStatus('task-1', 'in_review');

        // stateMachine.transition called once for initial transition, but not for auto-approve
        expect(stateMachine.transition).toHaveBeenCalledTimes(1);
      });

      it('should not auto-approve when no manual transitions available', async () => {
        const { service, taskRepo, roleRepo, workflowEngine, stateMachine } = createService();
        const task = createTask({ id: 'task-1', parentId: null, assigneeRoleId: 'role-1' });
        (taskRepo.findById as any).mockResolvedValue(task);
        (taskRepo.findByParentId as any).mockResolvedValue([]);
        (workflowEngine.isReviewStatus as any).mockResolvedValue(true);
        (roleRepo.findById as any).mockResolvedValue(createRole({ id: 'role-1' }));
        (workflowEngine.getManualTransitions as any).mockResolvedValue([]);

        await service.updateStatus('task-1', 'in_review');

        // Only the initial transition call, no auto-approve
        expect(stateMachine.transition).toHaveBeenCalledTimes(1);
      });

      it('should skip review logic when parent has no assignee', async () => {
        const { service, taskRepo, roleRepo, workflowEngine, eventBus } = createService();
        const task = createTask({ id: 'task-1', parentId: 'parent-1', assigneeRoleId: 'role-1' });
        const parentTask = createTask({ id: 'parent-1', assigneeRoleId: null });
        (taskRepo.findById as any).mockImplementation(async (id: string) => {
          if (id === 'task-1') return task;
          if (id === 'parent-1') return parentTask;
          return null;
        });
        (taskRepo.findByParentId as any).mockResolvedValue([]);
        (workflowEngine.isReviewStatus as any).mockResolvedValue(true);
        (roleRepo.findById as any).mockResolvedValue(createRole({ id: 'role-1' }));
        (workflowEngine.getManualTransitions as any).mockResolvedValue([
          { from: 'in_review', to: 'done', trigger: 'manual' },
        ]);

        await service.updateStatus('task-1', 'in_review');

        // No wake:triggered for parent (parent has no assignee)
        // Falls through to auto-approve
        const wakeEmits = (eventBus.emit as any).mock.calls.filter(
          (c: any[]) => c[0]?.type === 'wake:triggered',
        );
        expect(wakeEmits).toHaveLength(0);
      });
    });

    // --- Terminal status → auto-propagation ---

    describe('auto-propagation on terminal status', () => {
      it('should check parent propagation when status is terminal', async () => {
        const { service, taskRepo, workflowEngine } = createService();
        const task = createTask({ id: 'task-1', parentId: 'parent-1', orgId: 'org-1' });
        const parentTask = createTask({ id: 'parent-1', parentId: null });
        const sibling = createTask({ id: 'task-2', parentId: 'parent-1', status: 'done' });

        (taskRepo.findById as any).mockImplementation(async (id: string) => {
          if (id === 'task-1') return task;
          if (id === 'parent-1') return parentTask;
          return null;
        });
        (taskRepo.findByParentId as any).mockImplementation(async (parentId: string) => {
          if (parentId === 'parent-1') return [task, sibling];
          if (parentId === 'task-1') return [];
          return [];
        });
        // Make task-1 and sibling both terminal
        (workflowEngine.isTerminalStatus as any).mockResolvedValue(true);

        await service.updateStatus('task-1', 'done');

        expect(workflowEngine.evaluateBehaviors).toHaveBeenCalledWith(
          'org-1',
          { type: 'on_all_children_terminal' },
          expect.objectContaining({ taskId: 'parent-1' }),
        );
      });

      it('should not propagate if not all siblings are terminal', async () => {
        const { service, taskRepo, workflowEngine } = createService();
        const task = createTask({ id: 'task-1', parentId: 'parent-1' });
        const activeSibling = createTask({ id: 'task-2', parentId: 'parent-1', status: 'in_progress' });

        (taskRepo.findById as any).mockImplementation(async (id: string) => {
          if (id === 'task-1') return task;
          return null;
        });
        (taskRepo.findByParentId as any).mockImplementation(async (parentId: string) => {
          if (parentId === 'parent-1') return [task, activeSibling];
          if (parentId === 'task-1') return [];
          return [];
        });
        (workflowEngine.isTerminalStatus as any).mockImplementation(async (_orgId: string, status: string) => {
          return status === 'done';
        });

        await service.updateStatus('task-1', 'done');

        // on_all_children_terminal should NOT be called because activeSibling is not terminal
        const allChildrenCalls = (workflowEngine.evaluateBehaviors as any).mock.calls.filter(
          (c: any[]) => c[1]?.type === 'on_all_children_terminal',
        );
        expect(allChildrenCalls).toHaveLength(0);
      });

      it('should not propagate when task has no parent', async () => {
        const { service, taskRepo, workflowEngine } = createService();
        const task = createTask({ id: 'task-1', parentId: null });
        (taskRepo.findById as any).mockResolvedValue(task);
        (taskRepo.findByParentId as any).mockResolvedValue([]);
        (workflowEngine.isTerminalStatus as any).mockResolvedValue(true);

        await service.updateStatus('task-1', 'done');

        const allChildrenCalls = (workflowEngine.evaluateBehaviors as any).mock.calls.filter(
          (c: any[]) => c[1]?.type === 'on_all_children_terminal',
        );
        expect(allChildrenCalls).toHaveLength(0);
      });

      it('should execute auto_transition action on parent during propagation', async () => {
        const { service, taskRepo, workflowEngine, stateMachine } = createService();
        const task = createTask({ id: 'task-1', parentId: 'parent-1' });
        const parentTask = createTask({ id: 'parent-1', parentId: null, status: 'in_progress' });

        (taskRepo.findById as any).mockImplementation(async (id: string) => {
          if (id === 'task-1') return task;
          if (id === 'parent-1') return parentTask;
          return null;
        });
        (taskRepo.findByParentId as any).mockImplementation(async (parentId: string) => {
          if (parentId === 'parent-1') return [task];
          if (parentId === 'task-1') return [];
          return [];
        });
        (workflowEngine.isTerminalStatus as any).mockResolvedValue(true);
        (workflowEngine.evaluateBehaviors as any).mockImplementation(async (_orgId: string, trigger: any) => {
          if (trigger.type === 'on_all_children_terminal') {
            return [{ type: 'auto_transition', targetStatus: 'done' }];
          }
          return [];
        });

        await service.updateStatus('task-1', 'done');

        expect(stateMachine.transition).toHaveBeenCalledWith('parent-1', 'done');
      });
    });

    // --- Behavior action error resilience in updateStatus path ---

    describe('behavior action resilience', () => {
      it('should log error and continue when behavior action fails during status update', async () => {
        const { service, taskRepo, workflowEngine, stateMachine, logger } = createService();
        const task = createTask({ id: 'task-1', status: 'in_progress' });
        (taskRepo.findById as any).mockResolvedValue(task);
        (taskRepo.findByParentId as any).mockResolvedValue([]);

        (workflowEngine.evaluateBehaviors as any).mockResolvedValue([
          { type: 'auto_transition', targetStatus: 'bad_status' },
        ]);
        (stateMachine.transition as any).mockImplementation(async (_id: string, to: string) => {
          if (to === 'bad_status') throw new Error('Invalid transition');
        });

        await service.updateStatus('task-1', 'in_progress');

        expect(logger.error).toHaveBeenCalledWith(
          'Behavior action failed',
          expect.objectContaining({ taskId: 'task-1', action: 'auto_transition' }),
        );
      });

      it('should stop evaluation when skip_propagation is returned during status update', async () => {
        const { service, taskRepo, workflowEngine, stateMachine } = createService();
        const task = createTask({ id: 'task-1', status: 'in_progress' });
        (taskRepo.findById as any).mockResolvedValue(task);
        (taskRepo.findByParentId as any).mockResolvedValue([]);

        (workflowEngine.evaluateBehaviors as any).mockResolvedValue([
          { type: 'skip_propagation' },
          { type: 'auto_transition', targetStatus: 'done' },
        ]);

        await service.updateStatus('task-1', 'in_progress');

        // auto_transition after skip_propagation should not be executed
        // stateMachine.transition called once for initial updateStatus, not for auto_transition
        expect(stateMachine.transition).toHaveBeenCalledTimes(1);
        expect(stateMachine.transition).toHaveBeenCalledWith('task-1', 'in_progress');
      });

      it('should not check terminal propagation when skip_propagation is returned', async () => {
        const { service, taskRepo, workflowEngine } = createService();
        const task = createTask({ id: 'task-1', parentId: 'parent-1', status: 'done' });
        (taskRepo.findById as any).mockResolvedValue(task);
        (taskRepo.findByParentId as any).mockResolvedValue([]);

        (workflowEngine.evaluateBehaviors as any).mockResolvedValue([
          { type: 'skip_propagation' },
        ]);
        // Even though status is terminal, skip_propagation prevents propagation check
        (workflowEngine.isTerminalStatus as any).mockResolvedValue(true);

        await service.updateStatus('task-1', 'done');

        // on_all_children_terminal should NOT be evaluated
        const allChildrenCalls = (workflowEngine.evaluateBehaviors as any).mock.calls.filter(
          (c: any[]) => c[1]?.type === 'on_all_children_terminal',
        );
        expect(allChildrenCalls).toHaveLength(0);
      });
    });

    // --- Propagation depth limit ---

    describe('propagation depth limit', () => {
      it('should stop recursive propagation at MAX_PROPAGATION_DEPTH (20)', async () => {
        const { service, taskRepo, workflowEngine, logger } = createService();

        // Build a chain of 22 tasks: task-0 → task-1 → ... → task-21
        const tasks = Array.from({ length: 22 }, (_, i) =>
          createTask({
            id: `task-${i}`,
            parentId: i > 0 ? `task-${i - 1}` : null,
            status: 'done',
          }),
        );

        (taskRepo.findById as any).mockImplementation(async (id: string) => {
          return tasks.find((t) => t.id === id) ?? null;
        });
        (taskRepo.findByParentId as any).mockImplementation(async (parentId: string) => {
          return tasks.filter((t) => t.parentId === parentId);
        });
        (workflowEngine.isTerminalStatus as any).mockResolvedValue(true);
        (workflowEngine.evaluateBehaviors as any).mockImplementation(async (_orgId: string, trigger: any) => {
          if (trigger.type === 'on_all_children_terminal') {
            return [{ type: 'auto_transition', targetStatus: 'done' }];
          }
          return [];
        });

        await service.updateStatus('task-21', 'done');

        expect(logger.warn).toHaveBeenCalledWith(
          'checkAutoPropagate depth limit reached',
          expect.objectContaining({ depth: 20 }),
        );
      });
    });
  });

  // ═══════════════════════════════════════════════════════════
  // executeAction (via create/updateStatus)
  // ═══════════════════════════════════════════════════════════

  describe('action execution', () => {
    it('should emit behavior:executed event for every action', async () => {
      const { service, taskRepo, workflowEngine, eventBus } = createService();
      const task = createTask({ id: 'task-1' });
      (taskRepo.create as any).mockResolvedValue(task);
      (taskRepo.findByParentId as any).mockResolvedValue([]);
      (workflowEngine.evaluateBehaviors as any).mockResolvedValue([
        { type: 'auto_transition', targetStatus: 'in_progress' },
      ]);

      await service.create({
        orgId: 'org-1', parentId: null, type: 'epic', title: 'Epic', description: '', assigneeRoleId: null,
      });

      expect(eventBus.emit).toHaveBeenCalledWith(expect.objectContaining({
        type: 'behavior:executed',
        payload: expect.objectContaining({ taskId: 'task-1', action: 'auto_transition' }),
      }));
    });

    it('should emit wake:triggered for wake_assignee when task has assignee', async () => {
      const { service, taskRepo, workflowEngine, eventBus } = createService();
      const task = createTask({ id: 'task-1', assigneeRoleId: 'role-1' });
      (taskRepo.create as any).mockResolvedValue(task);
      (taskRepo.findByParentId as any).mockResolvedValue([]);
      (workflowEngine.evaluateBehaviors as any).mockResolvedValue([
        { type: 'wake_assignee', trigger: 'task_assigned' },
      ]);

      await service.create({
        orgId: 'org-1', parentId: null, type: 'epic', title: 'Epic', description: '', assigneeRoleId: null,
      });

      expect(eventBus.emit).toHaveBeenCalledWith(expect.objectContaining({
        type: 'wake:triggered',
        payload: expect.objectContaining({ roleId: 'role-1', trigger: 'task_assigned' }),
      }));
    });

    it('should not emit wake:triggered for wake_assignee when task has no assignee', async () => {
      const { service, taskRepo, workflowEngine, eventBus } = createService();
      const task = createTask({ id: 'task-1', assigneeRoleId: null });
      (taskRepo.create as any).mockResolvedValue(task);
      (taskRepo.findByParentId as any).mockResolvedValue([]);
      (workflowEngine.evaluateBehaviors as any).mockResolvedValue([
        { type: 'wake_assignee', trigger: 'task_assigned' },
      ]);

      await service.create({
        orgId: 'org-1', parentId: null, type: 'epic', title: 'Epic', description: '', assigneeRoleId: null,
      });

      const wakeCalls = (eventBus.emit as any).mock.calls.filter(
        (c: any[]) => c[0]?.type === 'wake:triggered',
      );
      expect(wakeCalls).toHaveLength(0);
    });

    it('should emit wake:triggered for wake_parent_assignee when parent has assignee', async () => {
      const { service, taskRepo, workflowEngine, eventBus } = createService();
      const task = createTask({ id: 'task-1', parentId: 'parent-1' });
      const parentTask = createTask({ id: 'parent-1', assigneeRoleId: 'role-parent' });
      (taskRepo.create as any).mockResolvedValue(task);
      (taskRepo.findById as any).mockImplementation(async (id: string) => {
        if (id === 'parent-1') return parentTask;
        return null;
      });
      (taskRepo.findByParentId as any).mockResolvedValue([]);
      (workflowEngine.evaluateBehaviors as any).mockResolvedValue([
        { type: 'wake_parent_assignee', trigger: 'review_needed' },
      ]);

      await service.create({
        orgId: 'org-1', parentId: null, type: 'epic', title: 'Epic', description: '', assigneeRoleId: null,
      });

      expect(eventBus.emit).toHaveBeenCalledWith(expect.objectContaining({
        type: 'wake:triggered',
        payload: expect.objectContaining({ roleId: 'role-parent', trigger: 'review_needed' }),
      }));
    });

    it('should create discussion group if not exists', async () => {
      const { service, taskRepo, workflowEngine, discussionRepo } = createService();
      const task = createTask({ id: 'task-1' });
      (taskRepo.create as any).mockResolvedValue(task);
      (taskRepo.findByParentId as any).mockResolvedValue([]);
      (discussionRepo.findGroupByTaskNodeId as any).mockResolvedValue(null);
      (workflowEngine.evaluateBehaviors as any).mockResolvedValue([
        { type: 'create_discussion_group' },
      ]);

      await service.create({
        orgId: 'org-1', parentId: null, type: 'epic', title: 'Epic', description: '', assigneeRoleId: null,
      });

      expect(discussionRepo.createGroup).toHaveBeenCalledWith(
        expect.objectContaining({ taskNodeId: 'task-1', orgId: 'org-1' }),
      );
    });

    it('should not create duplicate discussion group', async () => {
      const { service, taskRepo, workflowEngine, discussionRepo } = createService();
      const task = createTask({ id: 'task-1' });
      (taskRepo.create as any).mockResolvedValue(task);
      (taskRepo.findByParentId as any).mockResolvedValue([]);
      (discussionRepo.findGroupByTaskNodeId as any).mockResolvedValue({ id: 'existing-group' });
      (workflowEngine.evaluateBehaviors as any).mockResolvedValue([
        { type: 'create_discussion_group' },
      ]);

      await service.create({
        orgId: 'org-1', parentId: null, type: 'epic', title: 'Epic', description: '', assigneeRoleId: null,
      });

      expect(discussionRepo.createGroup).not.toHaveBeenCalled();
    });
  });

  // ═══════════════════════════════════════════════════════════
  // delete
  // ═══════════════════════════════════════════════════════════

  describe('delete', () => {
    it('should throw NotFoundError for nonexistent task', async () => {
      const { service, taskRepo } = createService();
      (taskRepo.findById as any).mockResolvedValue(null);

      await expect(service.delete('nonexistent')).rejects.toThrow(NotFoundError);
    });

    it('should delete task and clean up pending wakes', async () => {
      const { service, taskRepo, pendingWakeRepo } = createService();
      const task = createTask({ id: 'task-1', assigneeRoleId: 'role-1' });
      (taskRepo.findById as any).mockResolvedValue(task);
      (taskRepo.findByParentId as any).mockResolvedValue([]);

      await service.delete('task-1');

      expect(pendingWakeRepo.consumeByRoleAndTask).toHaveBeenCalledWith('role-1', 'task-1');
      expect(taskRepo.delete).toHaveBeenCalledWith('task-1');
    });

    it('should delete discussion group for the task', async () => {
      const { service, taskRepo, discussionRepo } = createService();
      const task = createTask({ id: 'task-1' });
      (taskRepo.findById as any).mockResolvedValue(task);
      (taskRepo.findByParentId as any).mockResolvedValue([]);

      await service.delete('task-1');

      expect(discussionRepo.deleteGroupByTaskNodeId).toHaveBeenCalledWith('task-1');
    });

    it('should recursively delete children first', async () => {
      const { service, taskRepo } = createService();
      const parent = createTask({ id: 'parent-1' });
      const child1 = createTask({ id: 'child-1', parentId: 'parent-1' });
      const child2 = createTask({ id: 'child-2', parentId: 'parent-1' });

      (taskRepo.findById as any).mockImplementation(async (id: string) => {
        if (id === 'parent-1') return parent;
        if (id === 'child-1') return child1;
        if (id === 'child-2') return child2;
        return null;
      });
      (taskRepo.findByParentId as any).mockImplementation(async (parentId: string) => {
        if (parentId === 'parent-1') return [child1, child2];
        return [];
      });

      await service.delete('parent-1');

      const deleteCalls = (taskRepo.delete as any).mock.calls.map((c: any[]) => c[0]);
      // Children should be deleted before parent
      expect(deleteCalls.indexOf('child-1')).toBeLessThan(deleteCalls.indexOf('parent-1'));
      expect(deleteCalls.indexOf('child-2')).toBeLessThan(deleteCalls.indexOf('parent-1'));
    });

    it('should skip pending wake cleanup when task has no assignee', async () => {
      const { service, taskRepo, pendingWakeRepo } = createService();
      const task = createTask({ id: 'task-1', assigneeRoleId: null });
      (taskRepo.findById as any).mockResolvedValue(task);
      (taskRepo.findByParentId as any).mockResolvedValue([]);

      await service.delete('task-1');

      expect(pendingWakeRepo.consumeByRoleAndTask).not.toHaveBeenCalled();
    });
  });

  // ═══════════════════════════════════════════════════════════
  // Read-only queries
  // ═══════════════════════════════════════════════════════════

  describe('read-only queries', () => {
    it('should delegate findById to taskRepo', async () => {
      const { service, taskRepo } = createService();
      const task = createTask({ id: 'task-1' });
      (taskRepo.findById as any).mockResolvedValue(task);

      const result = await service.findById('task-1');

      expect(result).toBe(task);
      expect(taskRepo.findById).toHaveBeenCalledWith('task-1');
    });

    it('should delegate findByOrgId to taskRepo', async () => {
      const { service, taskRepo } = createService();

      await service.findByOrgId('org-1');

      expect(taskRepo.findByOrgId).toHaveBeenCalledWith('org-1');
    });

    it('should delegate findChildren to taskRepo.findByParentId', async () => {
      const { service, taskRepo } = createService();

      await service.findChildren('parent-1');

      expect(taskRepo.findByParentId).toHaveBeenCalledWith('parent-1');
    });
  });

  // ═══════════════════════════════════════════════════════════
  // buildBehaviorContext
  // ═══════════════════════════════════════════════════════════

  describe('buildBehaviorContext (via create)', () => {
    it('should build context with parent info when task has parent', async () => {
      const { service, taskRepo, workflowEngine } = createService();
      const parentTask = createTask({ id: 'parent-1', type: 'epic', status: 'in_progress' });
      const createdTask = createTask({ id: 'task-1', parentId: 'parent-1', type: 'story' });
      (taskRepo.create as any).mockResolvedValue(createdTask);
      (taskRepo.findById as any).mockImplementation(async (id: string) => {
        if (id === 'parent-1') return parentTask;
        return null;
      });
      (taskRepo.findByParentId as any).mockResolvedValue([]);

      await service.create({
        orgId: 'org-1', parentId: null, type: 'story', title: 'Story', description: '', assigneeRoleId: null,
      });

      expect(workflowEngine.evaluateBehaviors).toHaveBeenCalledWith(
        'org-1',
        { type: 'on_task_created' },
        expect.objectContaining({
          parentTaskId: 'parent-1',
          parentTaskType: 'epic',
          parentTaskStatus: 'in_progress',
        }),
      );
    });

    it('should build context with null parent info when task has no parent', async () => {
      const { service, taskRepo, workflowEngine } = createService();
      const createdTask = createTask({ id: 'task-1', parentId: null });
      (taskRepo.create as any).mockResolvedValue(createdTask);
      (taskRepo.findByParentId as any).mockResolvedValue([]);

      await service.create({
        orgId: 'org-1', parentId: null, type: 'epic', title: 'Epic', description: '', assigneeRoleId: null,
      });

      expect(workflowEngine.evaluateBehaviors).toHaveBeenCalledWith(
        'org-1',
        { type: 'on_task_created' },
        expect.objectContaining({
          parentTaskId: null,
          parentTaskType: null,
          parentTaskStatus: null,
        }),
      );
    });

    it('should include child count, types, and statuses in context', async () => {
      const { service, taskRepo, workflowEngine } = createService();
      const createdTask = createTask({ id: 'task-1' });
      (taskRepo.create as any).mockResolvedValue(createdTask);
      const children = [
        createTask({ id: 'c1', type: 'subtask', status: 'open' }),
        createTask({ id: 'c2', type: 'bug', status: 'done' }),
      ];
      (taskRepo.findByParentId as any).mockResolvedValue(children);

      await service.create({
        orgId: 'org-1', parentId: null, type: 'epic', title: 'Epic', description: '', assigneeRoleId: null,
      });

      expect(workflowEngine.evaluateBehaviors).toHaveBeenCalledWith(
        'org-1',
        { type: 'on_task_created' },
        expect.objectContaining({
          childCount: 2,
          childTypes: ['subtask', 'bug'],
          childStatuses: ['open', 'done'],
        }),
      );
    });
  });
});
