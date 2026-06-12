import { describe, it, expect, beforeEach, vi } from 'vitest';
import { BehaviorEngine } from '@core/modules/workflow/engines/behavior.engine';
import type { ITaskRepository } from '@core/modules/workflow/interfaces/i-task.repository';
import type { ITaskDependencyRepository } from '@core/modules/workflow/interfaces/i-task-dependency.repository';
import type { ProcessEngine } from '@core/modules/workflow/engines/process.engine';
import type { TaskStateMachine } from '@core/modules/workflow/engines/task.state-machine';
import type { ILogger } from '@core/foundation/interfaces/i-logger';
import type { Task, TaskDependency } from '@core/modules/workflow/types/workflow.types';

function createTask(overrides?: Partial<Task>): Task {
  return {
    id: 'task-1',
    orgId: 'org-1',
    parentId: null,
    type: 'task',
    title: 'Test Task',
    description: '',
    status: 'pending',
    assigneeRoleId: 'role-1',
    depth: 0,
    artifactPaths: null,
    pausedReason: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function createDependency(overrides?: Partial<TaskDependency>): TaskDependency {
  return {
    id: 'dep-1',
    orgId: 'org-1',
    dependentTaskId: 'task-1',
    dependencyTaskId: 'task-2',
    createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('BehaviorEngine — onDependencyResolved', () => {
  let engine: BehaviorEngine;
  let taskRepo: ITaskRepository;
  let dependencyRepo: ITaskDependencyRepository;
  let processEngine: ProcessEngine;
  let taskStateMachine: TaskStateMachine;
  let logger: ILogger;

  beforeEach(() => {
    taskRepo = {
      findById: vi.fn().mockReturnValue(null),
      findByOrgId: vi.fn().mockReturnValue([]),
      findChildren: vi.fn().mockReturnValue([]),
      hasChildren: vi.fn().mockReturnValue(false),
      findByAssigneeRoleId: vi.fn().mockReturnValue([]),
      create: vi.fn(),
      updateStatus: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    } as unknown as ITaskRepository;

    dependencyRepo = {
      findById: vi.fn(),
      findByDependentTaskId: vi.fn().mockReturnValue([]),
      findByDependencyTaskId: vi.fn().mockReturnValue([]),
      findByOrgId: vi.fn().mockReturnValue([]),
      create: vi.fn(),
      deleteByDependentTaskId: vi.fn(),
      deleteByDependencyTaskId: vi.fn(),
      deleteByTaskId: vi.fn(),
      hasUnresolvedDependencies: vi.fn().mockReturnValue(false),
      canReach: vi.fn().mockReturnValue(false),
    } as unknown as ITaskDependencyRepository;

    processEngine = {
      getSchema: vi.fn().mockReturnValue(null),
      getStatusCategory: vi.fn().mockImplementation((_orgId: string, status: string) => {
        if (status === 'done' || status === 'cancelled') return 'terminal';
        if (status === 'in_progress') return 'active';
        if (status === 'blocked') return 'blocked';
        if (status === 'pending') return 'initial';
        return null;
      }),
    } as unknown as ProcessEngine;

    taskStateMachine = {
      transition: vi.fn(),
    } as unknown as TaskStateMachine;

    logger = {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      child: vi.fn(),
    } as unknown as ILogger;

    engine = new BehaviorEngine(taskRepo, processEngine, taskStateMachine, logger);
    engine.setDependencyRepo(dependencyRepo);
  });

  describe('dependency resolution', () => {
    it('transitions blocked task to pending when all dependencies are terminal', () => {
      const completedTask = createTask({ id: 'task-completed', status: 'done' });
      const blockedTask = createTask({ id: 'task-blocked', status: 'blocked' });
      const dependency = createDependency({
        dependentTaskId: 'task-blocked',
        dependencyTaskId: 'task-completed',
      });

      vi.mocked(dependencyRepo.findByDependencyTaskId).mockReturnValue([dependency]);
      vi.mocked(taskRepo.findById).mockImplementation((id) => {
        if (id === 'task-blocked') return blockedTask;
        if (id === 'task-completed') return completedTask;
        return null;
      });
      vi.mocked(dependencyRepo.findByDependentTaskId).mockReturnValue([dependency]);

      engine.onDependencyResolved(completedTask);

      expect(taskStateMachine.transition).toHaveBeenCalledWith(
        'task-blocked',
        'pending',
        { triggeredBy: 'system' }
      );
    });

    it('does not transition when dependencies remain unresolved', () => {
      const completedTask = createTask({ id: 'task-completed', status: 'done' });
      const blockedTask = createTask({ id: 'task-blocked', status: 'blocked' });
      const unresolvedTask = createTask({ id: 'task-unresolved', status: 'in_progress' });

      const dep1 = createDependency({
        id: 'dep-1',
        dependentTaskId: 'task-blocked',
        dependencyTaskId: 'task-completed',
      });
      const dep2 = createDependency({
        id: 'dep-2',
        dependentTaskId: 'task-blocked',
        dependencyTaskId: 'task-unresolved',
      });

      vi.mocked(dependencyRepo.findByDependencyTaskId).mockReturnValue([dep1]);
      vi.mocked(taskRepo.findById).mockImplementation((id) => {
        if (id === 'task-blocked') return blockedTask;
        if (id === 'task-completed') return completedTask;
        if (id === 'task-unresolved') return unresolvedTask;
        return null;
      });
      vi.mocked(dependencyRepo.findByDependentTaskId).mockReturnValue([dep1, dep2]);

      engine.onDependencyResolved(completedTask);

      expect(taskStateMachine.transition).not.toHaveBeenCalled();
    });

    it('handles multiple dependents of completed task', () => {
      const completedTask = createTask({ id: 'task-completed', status: 'done' });
      const blockedTask1 = createTask({ id: 'task-blocked-1', status: 'blocked' });
      const blockedTask2 = createTask({ id: 'task-blocked-2', status: 'blocked' });

      const dep1 = createDependency({
        id: 'dep-1',
        dependentTaskId: 'task-blocked-1',
        dependencyTaskId: 'task-completed',
      });
      const dep2 = createDependency({
        id: 'dep-2',
        dependentTaskId: 'task-blocked-2',
        dependencyTaskId: 'task-completed',
      });

      vi.mocked(dependencyRepo.findByDependencyTaskId).mockReturnValue([dep1, dep2]);
      vi.mocked(taskRepo.findById).mockImplementation((id) => {
        if (id === 'task-blocked-1') return blockedTask1;
        if (id === 'task-blocked-2') return blockedTask2;
        if (id === 'task-completed') return completedTask;
        return null;
      });
      vi.mocked(dependencyRepo.findByDependentTaskId).mockImplementation((taskId) => {
        if (taskId === 'task-blocked-1') return [dep1];
        if (taskId === 'task-blocked-2') return [dep2];
        return [];
      });

      engine.onDependencyResolved(completedTask);

      expect(taskStateMachine.transition).toHaveBeenCalledTimes(2);
      expect(taskStateMachine.transition).toHaveBeenCalledWith('task-blocked-1', 'pending', { triggeredBy: 'system' });
      expect(taskStateMachine.transition).toHaveBeenCalledWith('task-blocked-2', 'pending', { triggeredBy: 'system' });
    });

    it('skips terminal tasks (idempotent on re-delivery)', () => {
      const completedTask = createTask({ id: 'task-completed', status: 'done' });
      const doneTask = createTask({ id: 'task-done', status: 'done' });
      const dependency = createDependency({
        dependentTaskId: 'task-done',
        dependencyTaskId: 'task-completed',
      });

      vi.mocked(dependencyRepo.findByDependencyTaskId).mockReturnValue([dependency]);
      vi.mocked(taskRepo.findById).mockImplementation((id) => {
        if (id === 'task-done') return doneTask;
        if (id === 'task-completed') return completedTask;
        return null;
      });

      engine.onDependencyResolved(completedTask);

      expect(taskStateMachine.transition).not.toHaveBeenCalled();
    });

    it('attempts transition for active tasks (state machine validates)', () => {
      const completedTask = createTask({ id: 'task-completed', status: 'done' });
      const activeTask = createTask({ id: 'task-active', status: 'in_progress' });
      const dependency = createDependency({
        dependentTaskId: 'task-active',
        dependencyTaskId: 'task-completed',
      });

      vi.mocked(dependencyRepo.findByDependencyTaskId).mockReturnValue([dependency]);
      vi.mocked(taskRepo.findById).mockImplementation((id) => {
        if (id === 'task-active') return activeTask;
        if (id === 'task-completed') return completedTask;
        return null;
      });

      engine.onDependencyResolved(completedTask);

      expect(taskStateMachine.transition).toHaveBeenCalledWith('task-active', 'pending', { triggeredBy: 'system' });
    });

    it('attempts transition for initial tasks (state machine validates)', () => {
      const completedTask = createTask({ id: 'task-completed', status: 'done' });
      const pendingTask = createTask({ id: 'task-pending', status: 'pending' });
      const dependency = createDependency({
        dependentTaskId: 'task-pending',
        dependencyTaskId: 'task-completed',
      });

      vi.mocked(dependencyRepo.findByDependencyTaskId).mockReturnValue([dependency]);
      vi.mocked(taskRepo.findById).mockImplementation((id) => {
        if (id === 'task-pending') return pendingTask;
        if (id === 'task-completed') return completedTask;
        return null;
      });

      engine.onDependencyResolved(completedTask);

      expect(taskStateMachine.transition).toHaveBeenCalledWith('task-pending', 'pending', { triggeredBy: 'system' });
    });

    it('does nothing when no dependents exist', () => {
      const completedTask = createTask({ id: 'task-completed', status: 'done' });

      vi.mocked(dependencyRepo.findByDependencyTaskId).mockReturnValue([]);

      engine.onDependencyResolved(completedTask);

      expect(taskStateMachine.transition).not.toHaveBeenCalled();
    });

    it('does nothing when dependencyRepo is not set', () => {
      const engineWithoutRepo = new BehaviorEngine(taskRepo, processEngine, taskStateMachine, logger);
      const completedTask = createTask({ id: 'task-completed', status: 'done' });

      engineWithoutRepo.onDependencyResolved(completedTask);

      expect(dependencyRepo.findByDependencyTaskId).not.toHaveBeenCalled();
      expect(taskStateMachine.transition).not.toHaveBeenCalled();
    });

    it('handles transition failure gracefully', () => {
      const completedTask = createTask({ id: 'task-completed', status: 'done' });
      const blockedTask = createTask({ id: 'task-blocked', status: 'blocked' });
      const dependency = createDependency({
        dependentTaskId: 'task-blocked',
        dependencyTaskId: 'task-completed',
      });

      vi.mocked(dependencyRepo.findByDependencyTaskId).mockReturnValue([dependency]);
      vi.mocked(taskRepo.findById).mockImplementation((id) => {
        if (id === 'task-blocked') return blockedTask;
        if (id === 'task-completed') return completedTask;
        return null;
      });
      vi.mocked(dependencyRepo.findByDependentTaskId).mockReturnValue([dependency]);
      vi.mocked(taskStateMachine.transition).mockImplementation(() => {
        throw new Error('Transition failed');
      });

      expect(() => engine.onDependencyResolved(completedTask)).not.toThrow();
      expect(logger.warn).toHaveBeenCalledWith(
        'Failed to transition dependent task from blocked to pending',
        expect.objectContaining({ taskId: 'task-blocked' })
      );
    });

    it('handles missing dependent task gracefully', () => {
      const completedTask = createTask({ id: 'task-completed', status: 'done' });
      const dependency = createDependency({
        dependentTaskId: 'task-missing',
        dependencyTaskId: 'task-completed',
      });

      vi.mocked(dependencyRepo.findByDependencyTaskId).mockReturnValue([dependency]);
      vi.mocked(taskRepo.findById).mockImplementation((id) => {
        if (id === 'task-completed') return completedTask;
        return null;
      });

      expect(() => engine.onDependencyResolved(completedTask)).not.toThrow();
      expect(taskStateMachine.transition).not.toHaveBeenCalled();
    });

    it('handles missing dependency task in allDeps check gracefully', () => {
      const completedTask = createTask({ id: 'task-completed', status: 'done' });
      const blockedTask = createTask({ id: 'task-blocked', status: 'blocked' });
      const dependency = createDependency({
        dependentTaskId: 'task-blocked',
        dependencyTaskId: 'task-completed',
      });
      const depWithMissingTask = createDependency({
        id: 'dep-missing',
        dependentTaskId: 'task-blocked',
        dependencyTaskId: 'task-gone',
      });

      vi.mocked(dependencyRepo.findByDependencyTaskId).mockReturnValue([dependency]);
      vi.mocked(taskRepo.findById).mockImplementation((id) => {
        if (id === 'task-blocked') return blockedTask;
        if (id === 'task-completed') return completedTask;
        if (id === 'task-gone') return null;
        return null;
      });
      vi.mocked(dependencyRepo.findByDependentTaskId).mockReturnValue([dependency, depWithMissingTask]);

      engine.onDependencyResolved(completedTask);

      expect(taskStateMachine.transition).toHaveBeenCalledWith(
        'task-blocked',
        'pending',
        { triggeredBy: 'system' }
      );
    });
  });
});
