import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { ITaskRepository } from '@core/modules/workflow/interfaces/i-task.repository';
import type { TaskStateMachine } from '@core/modules/workflow/engines/task.state-machine';
import type { ProcessEngine } from '@core/modules/workflow/engines/process.engine';
import type { ILogger } from '@core/foundation/interfaces/i-logger';
import type { Task } from '@core/modules/workflow/types/workflow.types';

function createTask(overrides?: Partial<Task>): Task {
  return {
    id: 'task-1',
    orgId: 'org-1',
    parentId: null,
    type: 'task',
    title: 'T',
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

/**
 * Tests the R4 reconcile logic used in composition-root.ts:
 * After bootstrap marks orphaned runs as interrupted, any task still in an
 * 'active' status has no backing run. These must roll back to initial so the
 * scheduler can re-dispatch them.
 */
function reconcileOrphanedActiveTasks(
  orgIds: string[],
  taskRepo: ITaskRepository,
  processEngine: ProcessEngine,
  taskStateMachine: TaskStateMachine,
  log: ILogger,
): number {
  let total = 0;
  for (const orgId of orgIds) {
    const initial = processEngine.getInitialStatus(orgId);
    if (!initial) continue;

    for (const task of taskRepo.findByOrgId(orgId)) {
      if (processEngine.getStatusCategory(orgId, task.status) !== 'active') continue;
      try {
        taskStateMachine.transition(task.id, initial.name, { triggeredBy: 'system' });
        total += 1;
      } catch (err) {
        log.error('Failed to reconcile orphaned active task on startup', {
          taskId: task.id, from: task.status, to: initial.name, error: String(err),
        });
      }
    }
  }
  if (total > 0) {
    log.info('Reconciled orphaned active tasks on startup', { count: total });
  }
  return total;
}

describe('Bootstrap — reconcileOrphanedActiveTasks (R4)', () => {
  let taskRepo: ITaskRepository;
  let taskStateMachine: TaskStateMachine;
  let processEngine: ProcessEngine;
  let logger: ILogger;

  beforeEach(() => {
    taskRepo = {
      findById: vi.fn(),
      findByOrgId: vi.fn().mockReturnValue([]),
      findChildren: vi.fn().mockReturnValue([]),
      hasChildren: vi.fn().mockReturnValue(false),
      findByAssigneeRoleId: vi.fn().mockReturnValue([]),
      create: vi.fn(),
      updateStatus: vi.fn(),
      updatePausedReason: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    } as unknown as ITaskRepository;

    taskStateMachine = {
      transition: vi.fn(),
      confirmApproval: vi.fn(),
      rejectApproval: vi.fn(),
      setBehaviorEngine: vi.fn(),
    } as unknown as TaskStateMachine;

    processEngine = {
      getInitialStatus: vi.fn().mockReturnValue({ name: 'pending', label: 'Pending', category: 'initial' }),
      getStatusCategory: vi.fn().mockImplementation((_org: string, status: string) => {
        if (status === 'pending') return 'initial';
        if (status === 'in_progress' || status === 'revision' || status === 'blocked') return 'active';
        if (status === 'done' || status === 'cancelled') return 'terminal';
        if (status === 'awaiting_review') return 'approval';
        return null;
      }),
    } as unknown as ProcessEngine;

    logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } as unknown as ILogger;
  });

  it('rolls back orphaned active tasks to initial status', () => {
    vi.mocked(taskRepo.findByOrgId).mockReturnValue([
      createTask({ id: 't1', status: 'in_progress' }),
      createTask({ id: 't2', status: 'revision' }),
    ]);

    const count = reconcileOrphanedActiveTasks(['org-1'], taskRepo, processEngine, taskStateMachine, logger);

    expect(count).toBe(2);
    expect(taskStateMachine.transition).toHaveBeenCalledWith('t1', 'pending', { triggeredBy: 'system' });
    expect(taskStateMachine.transition).toHaveBeenCalledWith('t2', 'pending', { triggeredBy: 'system' });
  });

  it('skips tasks already in initial/terminal/approval status', () => {
    vi.mocked(taskRepo.findByOrgId).mockReturnValue([
      createTask({ id: 't1', status: 'pending' }),
      createTask({ id: 't2', status: 'done' }),
      createTask({ id: 't3', status: 'awaiting_review' }),
    ]);

    const count = reconcileOrphanedActiveTasks(['org-1'], taskRepo, processEngine, taskStateMachine, logger);

    expect(count).toBe(0);
    expect(taskStateMachine.transition).not.toHaveBeenCalled();
  });

  it('processes multiple orgs independently', () => {
    vi.mocked(taskRepo.findByOrgId).mockImplementation((orgId) => {
      if (orgId === 'org-1') return [createTask({ id: 't1', orgId: 'org-1', status: 'in_progress' })];
      if (orgId === 'org-2') return [createTask({ id: 't2', orgId: 'org-2', status: 'blocked' })];
      return [];
    });

    const count = reconcileOrphanedActiveTasks(['org-1', 'org-2'], taskRepo, processEngine, taskStateMachine, logger);

    expect(count).toBe(2);
    expect(taskStateMachine.transition).toHaveBeenCalledWith('t1', 'pending', { triggeredBy: 'system' });
    expect(taskStateMachine.transition).toHaveBeenCalledWith('t2', 'pending', { triggeredBy: 'system' });
  });

  it('skips org when schema has no initial status', () => {
    vi.mocked(processEngine.getInitialStatus).mockReturnValue(null);
    vi.mocked(taskRepo.findByOrgId).mockReturnValue([
      createTask({ id: 't1', status: 'in_progress' }),
    ]);

    const count = reconcileOrphanedActiveTasks(['org-1'], taskRepo, processEngine, taskStateMachine, logger);

    expect(count).toBe(0);
    expect(taskStateMachine.transition).not.toHaveBeenCalled();
  });

  it('continues after individual task transition failure', () => {
    vi.mocked(taskRepo.findByOrgId).mockReturnValue([
      createTask({ id: 't1', status: 'in_progress' }),
      createTask({ id: 't2', status: 'in_progress' }),
    ]);
    vi.mocked(taskStateMachine.transition).mockImplementation((taskId) => {
      if (taskId === 't1') throw new Error('transition failed');
      return createTask({ id: taskId, status: 'pending' });
    });

    const count = reconcileOrphanedActiveTasks(['org-1'], taskRepo, processEngine, taskStateMachine, logger);

    expect(count).toBe(1);
    expect(logger.error).toHaveBeenCalledWith(
      'Failed to reconcile orphaned active task on startup',
      expect.objectContaining({ taskId: 't1' }),
    );
    expect(taskStateMachine.transition).toHaveBeenCalledWith('t2', 'pending', { triggeredBy: 'system' });
  });

  it('no-op for empty org list', () => {
    const count = reconcileOrphanedActiveTasks([], taskRepo, processEngine, taskStateMachine, logger);

    expect(count).toBe(0);
    expect(taskRepo.findByOrgId).not.toHaveBeenCalled();
  });

  it('logs summary only when tasks were reconciled', () => {
    vi.mocked(taskRepo.findByOrgId).mockReturnValue([createTask({ id: 't1', status: 'in_progress' })]);

    reconcileOrphanedActiveTasks(['org-1'], taskRepo, processEngine, taskStateMachine, logger);

    expect(logger.info).toHaveBeenCalledWith('Reconciled orphaned active tasks on startup', { count: 1 });
  });

  it('does not log summary when no tasks needed reconciliation', () => {
    vi.mocked(taskRepo.findByOrgId).mockReturnValue([createTask({ status: 'pending' })]);

    reconcileOrphanedActiveTasks(['org-1'], taskRepo, processEngine, taskStateMachine, logger);

    expect(logger.info).not.toHaveBeenCalled();
  });
});
