/**
 * TaskStateMachine Unit Tests
 *
 * Covers: canTransition delegation, transition success/failure,
 * event emission, WorkflowEngine not set, task not found,
 * repo interaction verification, and edge cases.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('tsyringe', () => ({
  injectable: () => (target: any) => target,
  inject: () => () => undefined,
}));

vi.mock('@main/core/tokens.js', () => ({
  TASK_REPO_TOKEN: Symbol('TASK_REPO_TOKEN'),
  EVENT_BUS_TOKEN: Symbol('EVENT_BUS_TOKEN'),
  LOGGER_TOKEN: Symbol('LOGGER_TOKEN'),
}));

import { TaskStateMachine } from '@main/application/state-machine/task.state-machine.js';
import { NotFoundError } from '@main/core/errors/capibara.errors.js';
import { InvalidTransitionError } from '@main/core/errors/workflow.errors.js';
import type { ITaskRepository } from '@main/core/interfaces/i-task.repository.js';
import type { IEventBus } from '@main/core/interfaces/i-event-bus.js';
import type { ILogger } from '@main/core/interfaces/i-logger.js';
import type { IWorkflowEngine } from '@main/core/interfaces/i-workflow-engine.js';
import type { TaskNode } from '@main/core/types/domain.types.js';

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

function createMockTaskRepo(task: TaskNode | null = null): ITaskRepository {
  return {
    findById: vi.fn().mockResolvedValue(task),
    findByParentId: vi.fn(),
    findByOrgId: vi.fn(),
    findByAssignee: vi.fn(),
    create: vi.fn(),
    updateStatus: vi.fn().mockResolvedValue(undefined),
    updateAssignee: vi.fn(),
    setArtifactPaths: vi.fn(),
    delete: vi.fn(),
  } as any;
}

function createMockWorkflowEngine(canTransitionResult = true): IWorkflowEngine {
  return {
    canTransition: vi.fn().mockResolvedValue(canTransitionResult),
    validateType: vi.fn(),
    getItemTypeDefinition: vi.fn(),
    getAllItemTypes: vi.fn(),
    getRootTypes: vi.fn(),
    getManualTransitions: vi.fn(),
    getAllStatuses: vi.fn(),
    getInitialStatus: vi.fn(),
    isTerminalStatus: vi.fn(),
    isReviewStatus: vi.fn(),
    isActiveStatus: vi.fn(),
    getFirstReviewStatus: vi.fn(),
    findTransitionTargetByCategory: vi.fn(),
    evaluateBehaviors: vi.fn(),
    getActiveSchema: vi.fn(),
    saveSchema: vi.fn(),
    analyzeImpactReadOnly: vi.fn(),
    validateSchemaIntegrity: vi.fn(),
    invalidateCache: vi.fn(),
  } as IWorkflowEngine;
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

// ─── Tests ──────────────────────────────────────────────────

describe('TaskStateMachine', () => {
  let sm: TaskStateMachine;
  let taskRepo: ITaskRepository;
  let eventBus: IEventBus;
  let logger: ILogger;
  let workflowEngine: IWorkflowEngine;

  const task = createTask({ id: 'task-1', orgId: 'org-1', status: 'open' });

  beforeEach(() => {
    taskRepo = createMockTaskRepo(task);
    eventBus = createMockEventBus();
    logger = createMockLogger();
    workflowEngine = createMockWorkflowEngine(true);

    sm = new (TaskStateMachine as any)(taskRepo, eventBus, logger);
    sm.setWorkflowEngine(workflowEngine);
  });

  // ═══════════════════════════════════════════════════════════
  // canTransition
  // ═══════════════════════════════════════════════════════════

  describe('canTransition', () => {
    it('should delegate to WorkflowEngine and return true when allowed', async () => {
      expect(await sm.canTransition('org-1', 'open', 'in_progress')).toBe(true);
      expect(workflowEngine.canTransition).toHaveBeenCalledWith('org-1', 'open', 'in_progress');
    });

    it('should delegate to WorkflowEngine and return false when not allowed', async () => {
      (workflowEngine.canTransition as any).mockResolvedValue(false);

      expect(await sm.canTransition('org-1', 'open', 'done')).toBe(false);
    });

    it('should return false and log warning when WorkflowEngine is not set', async () => {
      const smNoEngine = new (TaskStateMachine as any)(taskRepo, eventBus, logger);

      expect(await smNoEngine.canTransition('org-1', 'open', 'in_progress')).toBe(false);
      expect(logger.warn).toHaveBeenCalledWith('WorkflowEngine not set, rejecting transition');
    });

    it('should not call WorkflowEngine when engine is not set', async () => {
      const smNoEngine = new (TaskStateMachine as any)(taskRepo, eventBus, logger);

      await smNoEngine.canTransition('org-1', 'open', 'in_progress');

      expect(workflowEngine.canTransition).not.toHaveBeenCalled();
    });
  });

  // ═══════════════════════════════════════════════════════════
  // transition — success
  // ═══════════════════════════════════════════════════════════

  describe('transition — success', () => {
    it('should update task status in repo', async () => {
      await sm.transition('task-1', 'in_progress');

      expect(taskRepo.updateStatus).toHaveBeenCalledWith('task-1', 'in_progress');
    });

    it('should emit task:status-changed event with correct payload', async () => {
      await sm.transition('task-1', 'in_progress');

      expect(eventBus.emit).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'task:status-changed',
          payload: expect.objectContaining({
            taskId: 'task-1',
            orgId: 'org-1',
            from: 'open',
            to: 'in_progress',
            newStatus: 'in_progress',
          }),
        }),
      );
    });

    it('should emit event with ISO timestamp', async () => {
      await sm.transition('task-1', 'in_progress');

      const emitCall = (eventBus.emit as any).mock.calls[0][0];
      expect(emitCall.timestamp).toBeDefined();
      expect(() => new Date(emitCall.timestamp)).not.toThrow();
    });

    it('should log the transition', async () => {
      await sm.transition('task-1', 'in_progress');

      expect(logger.info).toHaveBeenCalledWith('Task state transition', {
        taskId: 'task-1',
        from: 'open',
        to: 'in_progress',
      });
    });

    it('should call operations in correct order: findById → canTransition → updateStatus → emit', async () => {
      const callOrder: string[] = [];
      (taskRepo.findById as any).mockImplementation(async () => {
        callOrder.push('findById');
        return task;
      });
      (workflowEngine.canTransition as any).mockImplementation(async () => {
        callOrder.push('canTransition');
        return true;
      });
      (taskRepo.updateStatus as any).mockImplementation(async () => {
        callOrder.push('updateStatus');
      });
      (eventBus.emit as any).mockImplementation(() => {
        callOrder.push('emit');
      });

      await sm.transition('task-1', 'in_progress');

      expect(callOrder).toEqual(['findById', 'canTransition', 'updateStatus', 'emit']);
    });
  });

  // ═══════════════════════════════════════════════════════════
  // transition — failures
  // ═══════════════════════════════════════════════════════════

  describe('transition — failures', () => {
    it('should throw NotFoundError when task does not exist', async () => {
      (taskRepo.findById as any).mockResolvedValue(null);

      await expect(sm.transition('nonexistent', 'in_progress')).rejects.toThrow(NotFoundError);
    });

    it('should not update status or emit event when task not found', async () => {
      (taskRepo.findById as any).mockResolvedValue(null);

      try { await sm.transition('nonexistent', 'in_progress'); } catch { /* expected */ }

      expect(taskRepo.updateStatus).not.toHaveBeenCalled();
      expect(eventBus.emit).not.toHaveBeenCalled();
    });

    it('should throw InvalidTransitionError when WorkflowEngine is not set', async () => {
      const smNoEngine = new (TaskStateMachine as any)(taskRepo, eventBus, logger);

      await expect(smNoEngine.transition('task-1', 'in_progress')).rejects.toThrow(InvalidTransitionError);
    });

    it('should throw InvalidTransitionError when transition is not allowed', async () => {
      (workflowEngine.canTransition as any).mockResolvedValue(false);

      await expect(sm.transition('task-1', 'done')).rejects.toThrow(InvalidTransitionError);
    });

    it('should not update status or emit event when transition is not allowed', async () => {
      (workflowEngine.canTransition as any).mockResolvedValue(false);

      try { await sm.transition('task-1', 'done'); } catch { /* expected */ }

      expect(taskRepo.updateStatus).not.toHaveBeenCalled();
      expect(eventBus.emit).not.toHaveBeenCalled();
    });

    it('should include from and to status in InvalidTransitionError (no engine)', async () => {
      const smNoEngine = new (TaskStateMachine as any)(taskRepo, eventBus, logger);

      try {
        await smNoEngine.transition('task-1', 'in_progress');
        expect.fail('Should have thrown');
      } catch (err: any) {
        expect(err).toBeInstanceOf(InvalidTransitionError);
        expect(err.message).toContain('open');
        expect(err.message).toContain('in_progress');
      }
    });

    it('should include from and to status in InvalidTransitionError (rejected)', async () => {
      (workflowEngine.canTransition as any).mockResolvedValue(false);

      try {
        await sm.transition('task-1', 'done');
        expect.fail('Should have thrown');
      } catch (err: any) {
        expect(err).toBeInstanceOf(InvalidTransitionError);
        expect(err.message).toContain('open');
        expect(err.message).toContain('done');
      }
    });
  });

  // ═══════════════════════════════════════════════════════════
  // setWorkflowEngine
  // ═══════════════════════════════════════════════════════════

  describe('setWorkflowEngine', () => {
    it('should enable transitions after setting engine', async () => {
      const smFresh = new (TaskStateMachine as any)(taskRepo, eventBus, logger);

      // Before setting engine
      expect(await smFresh.canTransition('org-1', 'open', 'in_progress')).toBe(false);

      // After setting engine
      smFresh.setWorkflowEngine(workflowEngine);
      expect(await smFresh.canTransition('org-1', 'open', 'in_progress')).toBe(true);
    });

    it('should allow replacing workflow engine', async () => {
      const engine2 = createMockWorkflowEngine(false);
      sm.setWorkflowEngine(engine2);

      expect(await sm.canTransition('org-1', 'open', 'in_progress')).toBe(false);
      expect(engine2.canTransition).toHaveBeenCalled();
    });
  });

  // ═══════════════════════════════════════════════════════════
  // Edge Cases
  // ═══════════════════════════════════════════════════════════

  describe('edge cases', () => {
    it('should use task.orgId from repo for WorkflowEngine validation', async () => {
      const taskWithDifferentOrg = createTask({ id: 'task-2', orgId: 'org-special' });
      (taskRepo.findById as any).mockResolvedValue(taskWithDifferentOrg);

      await sm.transition('task-2', 'in_progress');

      expect(workflowEngine.canTransition).toHaveBeenCalledWith('org-special', 'open', 'in_progress');
    });

    it('should handle transition to same status if schema allows it', async () => {
      const taskSameStatus = createTask({ status: 'in_progress' });
      (taskRepo.findById as any).mockResolvedValue(taskSameStatus);

      await sm.transition('task-1', 'in_progress');

      expect(taskRepo.updateStatus).toHaveBeenCalledWith('task-1', 'in_progress');
      expect(eventBus.emit).toHaveBeenCalledWith(
        expect.objectContaining({
          payload: expect.objectContaining({ from: 'in_progress', to: 'in_progress' }),
        }),
      );
    });

    it('should pass correct from status to WorkflowEngine (reads from task, not param)', async () => {
      const taskInReview = createTask({ status: 'in_review' });
      (taskRepo.findById as any).mockResolvedValue(taskInReview);

      await sm.transition('task-1', 'done');

      expect(workflowEngine.canTransition).toHaveBeenCalledWith('org-1', 'in_review', 'done');
    });
  });
});
