import { describe, it, expect, beforeEach, vi } from 'vitest';
import { TaskStateMachine } from '@core/modules/workflow/engines/task.state-machine';
import type { ITaskRepository } from '@core/modules/workflow/interfaces/i-task.repository';
import type { ProcessEngine } from '@core/modules/workflow/engines/process.engine';
import type { IEventBus } from '@core/foundation/interfaces/i-event-bus';
import type { ILogger } from '@core/foundation/interfaces/i-logger';
import type { Task } from '@core/modules/workflow/types/workflow.types';
import { TaskStateError, NotFoundError } from '@core/foundation/errors/capibara.errors';

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
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('TaskStateMachine', () => {
  let stateMachine: TaskStateMachine;
  let taskRepo: ITaskRepository;
  let processEngine: ProcessEngine;
  let eventBus: IEventBus;
  let logger: ILogger;

  beforeEach(() => {
    taskRepo = {
      findById: vi.fn(),
      findByOrgId: vi.fn(),
      findChildren: vi.fn(),
      findByAssigneeRoleId: vi.fn(),
      create: vi.fn(),
      updateStatus: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    } as unknown as ITaskRepository;

    processEngine = {
      validateTransition: vi.fn().mockReturnValue(true),
      getStatusCategory: vi.fn().mockReturnValue('active'),
      getStatusesByCategory: vi.fn().mockReturnValue([]),
    } as unknown as ProcessEngine;

    eventBus = { emit: vi.fn(), on: vi.fn(), off: vi.fn() } as IEventBus;

    logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } as unknown as ILogger;

    stateMachine = new TaskStateMachine(taskRepo, processEngine, eventBus, logger);
  });

  // ─── transition() ──────────────────────────────────────────────

  describe('transition()', () => {
    it('succeeds for a valid transition', () => {
      const task = createTask({ status: 'pending' });
      const updated = createTask({ status: 'in_progress' });
      vi.mocked(taskRepo.findById).mockReturnValueOnce(task).mockReturnValueOnce(updated);

      const result = stateMachine.transition('task-1', 'in_progress');

      expect(taskRepo.updateStatus).toHaveBeenCalledWith('task-1', 'in_progress');
      expect(result.status).toBe('in_progress');
    });

    it('throws NotFoundError when task does not exist', () => {
      vi.mocked(taskRepo.findById).mockReturnValue(null);

      expect(() => stateMachine.transition('missing', 'in_progress')).toThrow(NotFoundError);
    });

    it('returns task unchanged when transitioning to same status (no-op)', () => {
      const task = createTask({ status: 'in_progress' });
      vi.mocked(taskRepo.findById).mockReturnValue(task);

      const result = stateMachine.transition('task-1', 'in_progress');

      expect(taskRepo.updateStatus).not.toHaveBeenCalled();
      expect(eventBus.emit).not.toHaveBeenCalled();
      expect(result).toBe(task);
    });

    it('throws TaskStateError when transition is invalid', () => {
      const task = createTask({ status: 'in_progress' });
      vi.mocked(taskRepo.findById).mockReturnValue(task);
      vi.mocked(processEngine.validateTransition).mockReturnValue(false);

      expect(() => stateMachine.transition('task-1', 'approved')).toThrow(TaskStateError);
      expect(taskRepo.updateStatus).not.toHaveBeenCalled();
    });

    it('throws TaskStateError for in_progress → approved (the reported bug path)', () => {
      const task = createTask({ status: 'in_progress' });
      vi.mocked(taskRepo.findById).mockReturnValue(task);
      vi.mocked(processEngine.validateTransition).mockReturnValue(false);

      expect(() => stateMachine.transition('task-1', 'approved')).toThrow(TaskStateError);
      expect(() => stateMachine.transition('task-1', 'approved')).toThrow(
        /Invalid task transition: in_progress → approved/,
      );
    });

    it('throws TaskStateError for pending → done (skipping entire workflow)', () => {
      const task = createTask({ status: 'pending' });
      vi.mocked(taskRepo.findById).mockReturnValue(task);
      vi.mocked(processEngine.validateTransition).mockReturnValue(false);

      expect(() => stateMachine.transition('task-1', 'done')).toThrow(TaskStateError);
    });

    it('throws TaskStateError for pending → approved (skipping active + review)', () => {
      const task = createTask({ status: 'pending' });
      vi.mocked(taskRepo.findById).mockReturnValue(task);
      vi.mocked(processEngine.validateTransition).mockReturnValue(false);

      expect(() => stateMachine.transition('task-1', 'approved')).toThrow(TaskStateError);
    });

    it('throws TaskStateError for done → in_progress (reverse from terminal)', () => {
      const task = createTask({ status: 'done' });
      vi.mocked(taskRepo.findById).mockReturnValue(task);
      vi.mocked(processEngine.validateTransition).mockReturnValue(false);

      expect(() => stateMachine.transition('task-1', 'in_progress')).toThrow(TaskStateError);
    });

    it('throws TaskStateError for cancelled → in_progress (reverse from terminal)', () => {
      const task = createTask({ status: 'cancelled' });
      vi.mocked(taskRepo.findById).mockReturnValue(task);
      vi.mocked(processEngine.validateTransition).mockReturnValue(false);

      expect(() => stateMachine.transition('task-1', 'in_progress')).toThrow(TaskStateError);
    });

    it('throws TaskStateError for awaiting_review → in_progress (not a defined transition)', () => {
      const task = createTask({ status: 'awaiting_review' });
      vi.mocked(taskRepo.findById).mockReturnValue(task);
      vi.mocked(processEngine.validateTransition).mockReturnValue(false);

      expect(() => stateMachine.transition('task-1', 'in_progress')).toThrow(TaskStateError);
    });

    // ─── Event emission ──────────────────────────────────────────

    it('emits task:entered-approval when entering an approval status', () => {
      const task = createTask({ status: 'in_progress' });
      const updated = createTask({ status: 'awaiting_review' });
      vi.mocked(taskRepo.findById).mockReturnValueOnce(task).mockReturnValueOnce(updated);
      vi.mocked(processEngine.getStatusCategory).mockReturnValue('approval');

      stateMachine.transition('task-1', 'awaiting_review');

      expect(eventBus.emit).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'task:entered-approval',
          payload: expect.objectContaining({ taskId: 'task-1', from: 'in_progress', to: 'awaiting_review' }),
        }),
      );
    });

    it('does NOT emit task:entered-approval for non-approval transitions', () => {
      const task = createTask({ status: 'pending' });
      const updated = createTask({ status: 'in_progress' });
      vi.mocked(taskRepo.findById).mockReturnValueOnce(task).mockReturnValueOnce(updated);
      vi.mocked(processEngine.getStatusCategory).mockReturnValue('active');

      stateMachine.transition('task-1', 'in_progress');

      const emittedTypes = vi.mocked(eventBus.emit).mock.calls.map((c) => c[0].type);
      expect(emittedTypes).not.toContain('task:entered-approval');
    });

    it('emits task:status-changed for non-approval transitions', () => {
      const task = createTask({ status: 'pending', assigneeRoleId: 'role-1' });
      const updated = createTask({ status: 'in_progress' });
      vi.mocked(taskRepo.findById).mockReturnValueOnce(task).mockReturnValueOnce(updated);
      vi.mocked(processEngine.getStatusCategory).mockReturnValue('active');

      stateMachine.transition('task-1', 'in_progress');

      expect(eventBus.emit).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'task:status-changed',
          payload: expect.objectContaining({
            taskId: 'task-1',
            from: 'pending',
            to: 'in_progress',
            assigneeRoleId: 'role-1',
          }),
        }),
      );
    });

    it('emits task:completed when entering a terminal status', () => {
      const task = createTask({ status: 'awaiting_review' });
      const updated = createTask({ status: 'approved' });
      vi.mocked(taskRepo.findById).mockReturnValueOnce(task).mockReturnValueOnce(updated);
      vi.mocked(processEngine.getStatusCategory).mockReturnValue('terminal');

      stateMachine.transition('task-1', 'approved');

      const emittedTypes = vi.mocked(eventBus.emit).mock.calls.map((c) => c[0].type);
      expect(emittedTypes).toContain('task:completed');
    });

    it('does NOT emit task:completed for non-terminal transitions', () => {
      const task = createTask({ status: 'pending' });
      const updated = createTask({ status: 'in_progress' });
      vi.mocked(taskRepo.findById).mockReturnValueOnce(task).mockReturnValueOnce(updated);
      vi.mocked(processEngine.getStatusCategory).mockReturnValue('active');

      stateMachine.transition('task-1', 'in_progress');

      const emittedTypes = vi.mocked(eventBus.emit).mock.calls.map((c) => c[0].type);
      expect(emittedTypes).not.toContain('task:completed');
    });

    it('emits both task:status-changed and task:completed for terminal non-approval status', () => {
      const task = createTask({ status: 'in_progress' });
      const updated = createTask({ status: 'cancelled' });
      vi.mocked(taskRepo.findById).mockReturnValueOnce(task).mockReturnValueOnce(updated);
      vi.mocked(processEngine.getStatusCategory).mockReturnValue('terminal');

      stateMachine.transition('task-1', 'cancelled');

      const emittedTypes = vi.mocked(eventBus.emit).mock.calls.map((c) => c[0].type);
      expect(emittedTypes).toContain('task:status-changed');
      expect(emittedTypes).toContain('task:completed');
    });
  });

  // ─── confirmApproval() ─────────────────────────────────────────

  describe('confirmApproval()', () => {
    it('succeeds when task is in approval status', () => {
      const task = createTask({ status: 'awaiting_review' });
      const updated = createTask({ status: 'approved' });
      vi.mocked(taskRepo.findById).mockReturnValueOnce(task).mockReturnValueOnce(updated);
      vi.mocked(processEngine.getStatusCategory).mockReturnValue('approval');

      const result = stateMachine.confirmApproval('task-1', 'approved');

      expect(taskRepo.updateStatus).toHaveBeenCalledWith('task-1', 'approved');
      expect(result.status).toBe('approved');
    });

    it('throws NotFoundError when task does not exist', () => {
      vi.mocked(taskRepo.findById).mockReturnValue(null);

      expect(() => stateMachine.confirmApproval('missing', 'approved')).toThrow(NotFoundError);
    });

    it('throws TaskStateError when task is NOT in approval status', () => {
      const task = createTask({ status: 'in_progress' });
      vi.mocked(taskRepo.findById).mockReturnValue(task);
      vi.mocked(processEngine.getStatusCategory).mockReturnValue('active');

      expect(() => stateMachine.confirmApproval('task-1', 'approved')).toThrow(TaskStateError);
      expect(taskRepo.updateStatus).not.toHaveBeenCalled();
    });

    it('throws TaskStateError when task is in terminal status', () => {
      const task = createTask({ status: 'done' });
      vi.mocked(taskRepo.findById).mockReturnValue(task);
      vi.mocked(processEngine.getStatusCategory).mockReturnValue('terminal');

      expect(() => stateMachine.confirmApproval('task-1', 'approved')).toThrow(TaskStateError);
    });

    it('throws TaskStateError when task is in initial status', () => {
      const task = createTask({ status: 'pending' });
      vi.mocked(taskRepo.findById).mockReturnValue(task);
      vi.mocked(processEngine.getStatusCategory).mockReturnValue('initial');

      expect(() => stateMachine.confirmApproval('task-1', 'approved')).toThrow(TaskStateError);
    });

    it('emits task:approval-confirmed event', () => {
      const task = createTask({ status: 'awaiting_review' });
      const updated = createTask({ status: 'approved' });
      vi.mocked(taskRepo.findById).mockReturnValueOnce(task).mockReturnValueOnce(updated);
      vi.mocked(processEngine.getStatusCategory)
        .mockReturnValueOnce('approval')
        .mockReturnValueOnce('terminal');

      stateMachine.confirmApproval('task-1', 'approved');

      expect(eventBus.emit).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'task:approval-confirmed',
          payload: expect.objectContaining({ taskId: 'task-1', from: 'awaiting_review', to: 'approved' }),
        }),
      );
    });

    it('emits task:completed when confirmed into terminal status', () => {
      const task = createTask({ status: 'awaiting_review' });
      const updated = createTask({ status: 'approved' });
      vi.mocked(taskRepo.findById).mockReturnValueOnce(task).mockReturnValueOnce(updated);
      vi.mocked(processEngine.getStatusCategory)
        .mockReturnValueOnce('approval')
        .mockReturnValueOnce('terminal');

      stateMachine.confirmApproval('task-1', 'approved');

      const emittedTypes = vi.mocked(eventBus.emit).mock.calls.map((c) => c[0].type);
      expect(emittedTypes).toContain('task:completed');
    });

    it('does NOT emit task:completed when confirmed into non-terminal status', () => {
      const task = createTask({ status: 'awaiting_review' });
      const updated = createTask({ status: 'revision' });
      vi.mocked(taskRepo.findById).mockReturnValueOnce(task).mockReturnValueOnce(updated);
      vi.mocked(processEngine.getStatusCategory)
        .mockReturnValueOnce('approval')
        .mockReturnValueOnce('active');

      stateMachine.confirmApproval('task-1', 'revision');

      const emittedTypes = vi.mocked(eventBus.emit).mock.calls.map((c) => c[0].type);
      expect(emittedTypes).not.toContain('task:completed');
    });
  });

  // ─── rejectApproval() ──────────────────────────────────────────

  describe('rejectApproval()', () => {
    it('succeeds when task is in approval status', () => {
      const task = createTask({ status: 'awaiting_review' });
      const updated = createTask({ status: 'revision' });
      vi.mocked(taskRepo.findById).mockReturnValueOnce(task).mockReturnValueOnce(updated);
      vi.mocked(processEngine.getStatusCategory).mockReturnValue('approval');

      const result = stateMachine.rejectApproval('task-1', 'revision');

      expect(taskRepo.updateStatus).toHaveBeenCalledWith('task-1', 'revision');
      expect(result.status).toBe('revision');
    });

    it('throws NotFoundError when task does not exist', () => {
      vi.mocked(taskRepo.findById).mockReturnValue(null);

      expect(() => stateMachine.rejectApproval('missing', 'revision')).toThrow(NotFoundError);
    });

    it('throws TaskStateError when task is NOT in approval status', () => {
      const task = createTask({ status: 'in_progress' });
      vi.mocked(taskRepo.findById).mockReturnValue(task);
      vi.mocked(processEngine.getStatusCategory).mockReturnValue('active');

      expect(() => stateMachine.rejectApproval('task-1', 'revision')).toThrow(TaskStateError);
      expect(taskRepo.updateStatus).not.toHaveBeenCalled();
    });

    it('throws TaskStateError when task is in terminal status', () => {
      const task = createTask({ status: 'done' });
      vi.mocked(taskRepo.findById).mockReturnValue(task);
      vi.mocked(processEngine.getStatusCategory).mockReturnValue('terminal');

      expect(() => stateMachine.rejectApproval('task-1', 'revision')).toThrow(TaskStateError);
    });

    it('emits task:approval-rejected event', () => {
      const task = createTask({ status: 'awaiting_review' });
      const updated = createTask({ status: 'revision' });
      vi.mocked(taskRepo.findById).mockReturnValueOnce(task).mockReturnValueOnce(updated);
      vi.mocked(processEngine.getStatusCategory).mockReturnValue('approval');

      stateMachine.rejectApproval('task-1', 'revision');

      expect(eventBus.emit).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'task:approval-rejected',
          payload: expect.objectContaining({ taskId: 'task-1', from: 'awaiting_review', to: 'revision' }),
        }),
      );
    });
  });
});
