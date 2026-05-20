import { describe, it, expect, beforeEach, vi } from 'vitest';
import { TaskStateMachine } from '@core/modules/workflow/engines/task.state-machine';
import type { ITaskRepository } from '@core/modules/workflow/interfaces/i-task.repository';
import type { IRoleRepository } from '@core/modules/organization/interfaces/i-role.repository';
import type { ProcessEngine } from '@core/modules/workflow/engines/process.engine';
import type { IEventPublisher } from '@core/foundation/interfaces/i-event-publisher';
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
    pausedReason: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('TaskStateMachine', () => {
  let stateMachine: TaskStateMachine;
  let taskRepo: ITaskRepository;
  let roleRepo: IRoleRepository;
  let processEngine: ProcessEngine;
  let eventPublisher: IEventPublisher;
  let logger: ILogger;

  beforeEach(() => {
    taskRepo = {
      findById: vi.fn(),
      findByOrgId: vi.fn(),
      findChildren: vi.fn(),
      hasChildren: vi.fn().mockReturnValue(false),
      findByAssigneeRoleId: vi.fn(),
      create: vi.fn(),
      updateStatus: vi.fn(),
      updatePausedReason: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    } as unknown as ITaskRepository;

    roleRepo = {
      findById: vi.fn().mockReturnValue({ id: 'role-1', requiresHumanApproval: true }),
      findByIds: vi.fn(),
      findByOrgId: vi.fn(),
      findChildren: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    } as unknown as IRoleRepository;

    processEngine = {
      validateTransition: vi.fn().mockReturnValue(true),
      getStatusCategory: vi.fn().mockReturnValue('active'),
      getStatusesByCategory: vi.fn().mockReturnValue([]),
      getAvailableTransitions: vi.fn().mockReturnValue([]),
    } as unknown as ProcessEngine;

    eventPublisher = { publish: vi.fn() } as IEventPublisher;

    logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } as unknown as ILogger;

    stateMachine = new TaskStateMachine(taskRepo, roleRepo, processEngine, eventPublisher, logger);
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
      expect(eventPublisher.publish).not.toHaveBeenCalled();
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

    // ─── Non-leaf approval guard ──────────────────────────────────

    it('throws TaskStateError when a non-leaf task attempts to enter an approval status', () => {
      const task = createTask({ status: 'in_progress' });
      vi.mocked(taskRepo.findById).mockReturnValue(task);
      vi.mocked(processEngine.getStatusCategory).mockReturnValue('approval');
      vi.mocked(taskRepo.hasChildren).mockReturnValue(true);

      expect(() => stateMachine.transition('task-1', 'awaiting_review')).toThrow(TaskStateError);
      expect(() => stateMachine.transition('task-1', 'awaiting_review')).toThrow(
        /non-leaf tasks cannot enter approval states/,
      );
      expect(taskRepo.updateStatus).not.toHaveBeenCalled();
      expect(eventPublisher.publish).not.toHaveBeenCalled();
    });

    it('allows a leaf task to enter an approval status', () => {
      const task = createTask({ status: 'in_progress' });
      const updated = createTask({ status: 'awaiting_review' });
      vi.mocked(taskRepo.findById).mockReturnValueOnce(task).mockReturnValueOnce(updated);
      vi.mocked(processEngine.getStatusCategory).mockReturnValue('approval');
      vi.mocked(taskRepo.hasChildren).mockReturnValue(false);

      stateMachine.transition('task-1', 'awaiting_review');

      expect(taskRepo.updateStatus).toHaveBeenCalledWith('task-1', 'awaiting_review');
      expect(eventPublisher.publish).toHaveBeenCalledWith(
        'task:entered-approval',
        expect.objectContaining({ taskId: 'task-1' }),
      );
    });

    // ─── AI role auto-approval ────────────────────────────────────

    it('auto-approves when assignee role has requiresHumanApproval=false', () => {
      const task = createTask({ status: 'in_progress', assigneeRoleId: 'ai-role' });
      const inApproval = createTask({ status: 'awaiting_review', assigneeRoleId: 'ai-role' });
      const done = createTask({ status: 'done', assigneeRoleId: 'ai-role' });
      vi.mocked(taskRepo.findById)
        .mockReturnValueOnce(task)        // transition() entry
        .mockReturnValueOnce(inApproval)  // recursive transition() entry
        .mockReturnValue(done);           // subsequent lookups
      vi.mocked(processEngine.getStatusCategory).mockImplementation((_org, status) => {
        if (status === 'awaiting_review') return 'approval';
        if (status === 'done') return 'terminal';
        return 'active';
      });
      vi.mocked(processEngine.getAvailableTransitions).mockImplementation((_org, from) => {
        if (from === 'in_progress') return [{ from: 'in_progress', to: 'awaiting_review' }] as never;
        if (from === 'awaiting_review') return [{ from: 'awaiting_review', to: 'done' }] as never;
        return [];
      });
      vi.mocked(roleRepo.findById).mockReturnValue({ id: 'ai-role', requiresHumanApproval: false } as never);

      stateMachine.transition('task-1', 'awaiting_review');

      expect(taskRepo.updateStatus).toHaveBeenCalledWith('task-1', 'awaiting_review');
      expect(taskRepo.updateStatus).toHaveBeenCalledWith('task-1', 'done');
      const emittedTypes = vi.mocked(eventPublisher.publish).mock.calls.map((c) => c[0]);
      expect(emittedTypes).toContain('task:auto-approved');
      expect(emittedTypes).toContain('task:completed');
      expect(emittedTypes).not.toContain('task:entered-approval');
      expect(taskRepo.updatePausedReason).not.toHaveBeenCalledWith('task-1', 'approval');
    });

    it('pauses human-role leaf at approval state (no auto-approval)', () => {
      const task = createTask({ status: 'in_progress', assigneeRoleId: 'human-role' });
      const updated = createTask({ status: 'awaiting_review', assigneeRoleId: 'human-role' });
      vi.mocked(taskRepo.findById).mockReturnValueOnce(task).mockReturnValueOnce(updated);
      vi.mocked(processEngine.getStatusCategory).mockReturnValue('approval');
      vi.mocked(roleRepo.findById).mockReturnValue({ id: 'human-role', requiresHumanApproval: true } as never);

      stateMachine.transition('task-1', 'awaiting_review');

      expect(taskRepo.updatePausedReason).toHaveBeenCalledWith('task-1', 'approval');
      const emittedTypes = vi.mocked(eventPublisher.publish).mock.calls.map((c) => c[0]);
      expect(emittedTypes).toContain('task:entered-approval');
      expect(emittedTypes).not.toContain('task:auto-approved');
    });

    it('falls back to pause when AI role has no non-approval exit transition', () => {
      const task = createTask({ status: 'in_progress', assigneeRoleId: 'ai-role' });
      const updated = createTask({ status: 'awaiting_review', assigneeRoleId: 'ai-role' });
      vi.mocked(taskRepo.findById).mockReturnValueOnce(task).mockReturnValueOnce(updated);
      vi.mocked(processEngine.getStatusCategory).mockImplementation((_org, status) => {
        if (status === 'awaiting_review' || status === 'needs_second_opinion') return 'approval';
        return 'active';
      });
      vi.mocked(processEngine.getAvailableTransitions).mockReturnValue([
        { from: 'awaiting_review', to: 'needs_second_opinion' },
      ] as never);
      vi.mocked(roleRepo.findById).mockReturnValue({ id: 'ai-role', requiresHumanApproval: false } as never);

      stateMachine.transition('task-1', 'awaiting_review');

      expect(taskRepo.updatePausedReason).toHaveBeenCalledWith('task-1', 'approval');
      expect(logger.warn).toHaveBeenCalled();
      const emittedTypes = vi.mocked(eventPublisher.publish).mock.calls.map((c) => c[0]);
      expect(emittedTypes).toContain('task:entered-approval');
      expect(emittedTypes).not.toContain('task:auto-approved');
    });

    it('pauses when task has no assigneeRoleId (no role to consult)', () => {
      const task = createTask({ status: 'in_progress', assigneeRoleId: null });
      const updated = createTask({ status: 'awaiting_review', assigneeRoleId: null });
      vi.mocked(taskRepo.findById).mockReturnValueOnce(task).mockReturnValueOnce(updated);
      vi.mocked(processEngine.getStatusCategory).mockReturnValue('approval');

      stateMachine.transition('task-1', 'awaiting_review');

      expect(taskRepo.updatePausedReason).toHaveBeenCalledWith('task-1', 'approval');
      expect(roleRepo.findById).not.toHaveBeenCalled();
      const emittedTypes = vi.mocked(eventPublisher.publish).mock.calls.map((c) => c[0]);
      expect(emittedTypes).toContain('task:entered-approval');
    });

    // ─── Event emission ──────────────────────────────────────────

    it('emits task:entered-approval when entering an approval status', () => {
      const task = createTask({ status: 'in_progress' });
      const updated = createTask({ status: 'awaiting_review' });
      vi.mocked(taskRepo.findById).mockReturnValueOnce(task).mockReturnValueOnce(updated);
      vi.mocked(processEngine.getStatusCategory).mockReturnValue('approval');

      stateMachine.transition('task-1', 'awaiting_review');

      expect(eventPublisher.publish).toHaveBeenCalledWith(
        'task:entered-approval',
        expect.objectContaining({ taskId: 'task-1', from: 'in_progress', to: 'awaiting_review' }),
      );
    });

    it('does NOT emit task:entered-approval for non-approval transitions', () => {
      const task = createTask({ status: 'pending' });
      const updated = createTask({ status: 'in_progress' });
      vi.mocked(taskRepo.findById).mockReturnValueOnce(task).mockReturnValueOnce(updated);
      vi.mocked(processEngine.getStatusCategory).mockReturnValue('active');

      stateMachine.transition('task-1', 'in_progress');

      const emittedTypes = vi.mocked(eventPublisher.publish).mock.calls.map((c) => c[0]);
      expect(emittedTypes).not.toContain('task:entered-approval');
    });

    it('emits task:status-changed for non-approval transitions', () => {
      const task = createTask({ status: 'pending', assigneeRoleId: 'role-1' });
      const updated = createTask({ status: 'in_progress' });
      vi.mocked(taskRepo.findById).mockReturnValueOnce(task).mockReturnValueOnce(updated);
      vi.mocked(processEngine.getStatusCategory).mockReturnValue('active');

      stateMachine.transition('task-1', 'in_progress');

      expect(eventPublisher.publish).toHaveBeenCalledWith(
        'task:status-changed',
        expect.objectContaining({
          taskId: 'task-1',
          from: 'pending',
          to: 'in_progress',
          assigneeRoleId: 'role-1',
        }),
      );
    });

    it('emits task:completed when entering a terminal status', () => {
      const task = createTask({ status: 'awaiting_review' });
      const updated = createTask({ status: 'approved' });
      vi.mocked(taskRepo.findById).mockReturnValueOnce(task).mockReturnValueOnce(updated);
      vi.mocked(processEngine.getStatusCategory).mockReturnValue('terminal');

      stateMachine.transition('task-1', 'approved');

      const emittedTypes = vi.mocked(eventPublisher.publish).mock.calls.map((c) => c[0]);
      expect(emittedTypes).toContain('task:completed');
    });

    it('does NOT emit task:completed for non-terminal transitions', () => {
      const task = createTask({ status: 'pending' });
      const updated = createTask({ status: 'in_progress' });
      vi.mocked(taskRepo.findById).mockReturnValueOnce(task).mockReturnValueOnce(updated);
      vi.mocked(processEngine.getStatusCategory).mockReturnValue('active');

      stateMachine.transition('task-1', 'in_progress');

      const emittedTypes = vi.mocked(eventPublisher.publish).mock.calls.map((c) => c[0]);
      expect(emittedTypes).not.toContain('task:completed');
    });

    it('emits both task:status-changed and task:completed for terminal non-approval status', () => {
      const task = createTask({ status: 'in_progress' });
      const updated = createTask({ status: 'cancelled' });
      vi.mocked(taskRepo.findById).mockReturnValueOnce(task).mockReturnValueOnce(updated);
      vi.mocked(processEngine.getStatusCategory).mockReturnValue('terminal');

      stateMachine.transition('task-1', 'cancelled');

      const emittedTypes = vi.mocked(eventPublisher.publish).mock.calls.map((c) => c[0]);
      expect(emittedTypes).toContain('task:status-changed');
      expect(emittedTypes).toContain('task:completed');
    });

    // ─── triggeredBy payload propagation ────────────────────────

    it('validates transition without mode parameter', () => {
      const task = createTask({ status: 'pending' });
      const updated = createTask({ status: 'in_progress' });
      vi.mocked(taskRepo.findById).mockReturnValueOnce(task).mockReturnValueOnce(updated);
      vi.mocked(processEngine.getStatusCategory).mockReturnValue('active');

      stateMachine.transition('task-1', 'in_progress');

      expect(processEngine.validateTransition).toHaveBeenCalledWith('org-1', 'pending', 'in_progress');
    });

    it('task:status-changed payload includes triggeredBy:"system" when system-triggered', () => {
      const task = createTask({ status: 'in_progress' });
      const updated = createTask({ status: 'pending' });
      vi.mocked(taskRepo.findById).mockReturnValueOnce(task).mockReturnValueOnce(updated);
      vi.mocked(processEngine.getStatusCategory).mockReturnValue('initial');

      stateMachine.transition('task-1', 'pending', { triggeredBy: 'system' });

      expect(eventPublisher.publish).toHaveBeenCalledWith(
        'task:status-changed',
        expect.objectContaining({ triggeredBy: 'system' }),
      );
    });

    it('task:status-changed payload includes triggeredBy:"user" by default', () => {
      const task = createTask({ status: 'pending', assigneeRoleId: 'role-1' });
      const updated = createTask({ status: 'in_progress' });
      vi.mocked(taskRepo.findById).mockReturnValueOnce(task).mockReturnValueOnce(updated);
      vi.mocked(processEngine.getStatusCategory).mockReturnValue('active');

      stateMachine.transition('task-1', 'in_progress');

      expect(eventPublisher.publish).toHaveBeenCalledWith(
        'task:status-changed',
        expect.objectContaining({ triggeredBy: 'user' }),
      );
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

      expect(eventPublisher.publish).toHaveBeenCalledWith(
        'task:approval-confirmed',
        expect.objectContaining({ taskId: 'task-1', from: 'awaiting_review', to: 'approved' }),
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

      const emittedTypes = vi.mocked(eventPublisher.publish).mock.calls.map((c) => c[0]);
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

      const emittedTypes = vi.mocked(eventPublisher.publish).mock.calls.map((c) => c[0]);
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

      expect(eventPublisher.publish).toHaveBeenCalledWith(
        'task:approval-rejected',
        expect.objectContaining({ taskId: 'task-1', from: 'awaiting_review', to: 'revision' }),
      );
    });
  });

  // ─── BehaviorEngine integration ───────────────────────────────

  describe('BehaviorEngine integration', () => {
    let behaviorEngine: { onStatusEnter: ReturnType<typeof vi.fn>; onChildCompleted: ReturnType<typeof vi.fn> };

    beforeEach(() => {
      behaviorEngine = {
        onStatusEnter: vi.fn(),
        onChildCompleted: vi.fn(),
      };
    });

    it('transition success calls behaviorEngine.onStatusEnter with updated task', () => {
      stateMachine.setBehaviorEngine(behaviorEngine as any);

      const task = createTask({ status: 'pending' });
      const freshTask = createTask({ status: 'in_progress' });
      vi.mocked(taskRepo.findById)
        .mockReturnValueOnce(task)       // initial lookup
        .mockReturnValueOnce(freshTask)  // behaviorEngine lookup (freshTask)
        .mockReturnValueOnce(freshTask); // return value

      const result = stateMachine.transition('task-1', 'in_progress');

      expect(behaviorEngine.onStatusEnter).toHaveBeenCalledWith(freshTask);
      expect(result.status).toBe('in_progress');
    });

    it('transition validation fails — onStatusEnter NOT called', () => {
      stateMachine.setBehaviorEngine(behaviorEngine as any);

      const task = createTask({ status: 'in_progress' });
      vi.mocked(taskRepo.findById).mockReturnValue(task);
      vi.mocked(processEngine.validateTransition).mockReturnValue(false);

      expect(() => stateMachine.transition('task-1', 'approved')).toThrow(TaskStateError);
      expect(behaviorEngine.onStatusEnter).not.toHaveBeenCalled();
    });

    it('same-status transition — onStatusEnter NOT called', () => {
      stateMachine.setBehaviorEngine(behaviorEngine as any);

      const task = createTask({ status: 'in_progress' });
      vi.mocked(taskRepo.findById).mockReturnValue(task);

      const result = stateMachine.transition('task-1', 'in_progress');

      expect(result).toBe(task);
      expect(behaviorEngine.onStatusEnter).not.toHaveBeenCalled();
    });

    it('onStatusEnter throws — updateStatus and events already completed, error propagates', () => {
      stateMachine.setBehaviorEngine(behaviorEngine as any);

      const task = createTask({ status: 'pending' });
      const freshTask = createTask({ status: 'in_progress' });
      vi.mocked(taskRepo.findById)
        .mockReturnValueOnce(task)       // initial lookup
        .mockReturnValueOnce(freshTask); // behaviorEngine lookup
      behaviorEngine.onStatusEnter.mockImplementation(() => { throw new Error('BehaviorEngine boom'); });

      expect(() => stateMachine.transition('task-1', 'in_progress')).toThrow('BehaviorEngine boom');

      // updateStatus was called before behaviorEngine
      expect(taskRepo.updateStatus).toHaveBeenCalledWith('task-1', 'in_progress');
      // events were emitted before behaviorEngine
      expect(eventPublisher.publish).toHaveBeenCalledWith(
        'task:status-changed',
        expect.objectContaining({ taskId: 'task-1', from: 'pending', to: 'in_progress' }),
      );
    });

    it('confirmApproval calls onStatusEnter', () => {
      stateMachine.setBehaviorEngine(behaviorEngine as any);

      const task = createTask({ status: 'awaiting_review' });
      const freshTask = createTask({ status: 'approved' });
      vi.mocked(taskRepo.findById)
        .mockReturnValueOnce(task)       // initial lookup
        .mockReturnValueOnce(freshTask)  // behaviorEngine lookup
        .mockReturnValueOnce(freshTask); // return value
      vi.mocked(processEngine.getStatusCategory)
        .mockReturnValueOnce('approval')  // category check for current status
        .mockReturnValueOnce('terminal'); // category check for next status

      stateMachine.confirmApproval('task-1', 'approved');

      expect(behaviorEngine.onStatusEnter).toHaveBeenCalledWith(freshTask);
    });
  });
});
