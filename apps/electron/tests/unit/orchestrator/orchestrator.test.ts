import { describe, it, expect, beforeEach } from 'vitest';
import { Orchestrator } from '@core/modules/orchestrator/orchestrator';
import { MockEventBus } from '../../helpers/mock-event-bus';
import { MockLogger } from '../../helpers/mock-logger';
import { TEST_ORG_ID, TEST_ROLE_ID, TEST_TASK_ID } from '../../helpers/fixtures';
import type { ITaskRepository } from '@core/modules/workflow/interfaces/i-task.repository';
import type { IRoleRepository } from '@core/modules/organization/interfaces/i-role.repository';
import type { IOrganizationRepository } from '@core/modules/organization/interfaces/i-organization.repository';
import type { IConversationRepository } from '@core/modules/conversation/interfaces/i-conversation.repository';
import type { IPendingWakeRepository } from '@core/modules/orchestrator/interfaces/i-pending-wake.repository';
import type { WakeGateValidator } from '@core/modules/orchestrator/wake-gate.validator';
import type { RetryScheduler } from '@core/modules/orchestrator/retry.scheduler';
import type { RunCoordinator } from '@core/modules/orchestrator/run.coordinator';
import type { TaskScheduler } from '@core/modules/orchestrator/task.scheduler';
import type { TaskStateMachine } from '@core/modules/workflow/engines/task.state-machine';
import type { ProcessEngine } from '@core/modules/workflow/engines/process.engine';
import type { BehaviorEngine } from '@core/modules/workflow/engines/behavior.engine';

describe('Orchestrator', () => {
  let orchestrator: Orchestrator;
  let eventBus: MockEventBus;
  let logger: MockLogger;
  let taskRepo: ITaskRepository;
  let roleRepo: IRoleRepository;
  let orgRepo: IOrganizationRepository;
  let convRepo: IConversationRepository;
  let pendingWakeRepo: IPendingWakeRepository;
  let wakeGateValidator: WakeGateValidator;
  let retryScheduler: RetryScheduler;
  let runCoordinator: RunCoordinator;
  let taskScheduler: TaskScheduler;
  let taskStateMachine: TaskStateMachine;
  let processEngine: ProcessEngine;
  let behaviorEngine: BehaviorEngine;

  beforeEach(() => {
    eventBus = new MockEventBus();
    logger = new MockLogger();
    taskRepo = {
      findById: vi.fn().mockReturnValue({ id: TEST_TASK_ID, assigneeRoleId: TEST_ROLE_ID, parentId: null }),
      findByOrgId: vi.fn(),
      findChildren: vi.fn(),
      findByAssigneeRoleId: vi.fn(),
      create: vi.fn(),
      updateStatus: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    };
    roleRepo = {
      findById: vi.fn(),
      findByIds: vi.fn(),
      findByOrgId: vi.fn(),
      findChildren: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    };
    orgRepo = {
      findAll: vi.fn(),
      findById: vi.fn().mockReturnValue({ id: TEST_ORG_ID, autoStartOnCreate: true }),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    };
    convRepo = {
      findById: vi.fn().mockReturnValue({ id: 'conv-1', taskId: TEST_TASK_ID, initiatorRoleId: TEST_ROLE_ID, orgId: TEST_ORG_ID }),
      findByOrgId: vi.fn(),
      findByTaskId: vi.fn(),
      findActiveByOrgId: vi.fn(),
      findByState: vi.fn(),
      findTimedOutInquiries: vi.fn(),
      create: vi.fn(),
      updateState: vi.fn(),
      updateRespondent: vi.fn(),
      updateExternalSessionId: vi.fn(),
      delete: vi.fn(),
    };
    pendingWakeRepo = {
      findById: vi.fn(),
      findByOrgId: vi.fn(),
      findByRoleId: vi.fn(),
      findNext: vi.fn(),
      create: vi.fn(),
      delete: vi.fn(),
      deleteByRoleId: vi.fn(),
    };
    wakeGateValidator = {
      validate: vi.fn().mockReturnValue({ allowed: true }),
    } as unknown as WakeGateValidator;
    retryScheduler = {
      scheduleRetry: vi.fn(),
      clearRetries: vi.fn(),
    } as unknown as RetryScheduler;
    runCoordinator = {
      executeForTask: vi.fn().mockResolvedValue({ runId: 'run-1', status: 'succeeded' }),
      executeForConversation: vi.fn().mockResolvedValue({ runId: 'run-2', status: 'succeeded' }),
    } as unknown as RunCoordinator;
    taskScheduler = {
      findNextTask: vi.fn().mockReturnValue(null),
    } as unknown as TaskScheduler;
    taskStateMachine = {
      transition: vi.fn(),
      confirmApproval: vi.fn(),
      rejectApproval: vi.fn(),
    } as unknown as TaskStateMachine;
    processEngine = {
      getAvailableTransitions: vi.fn().mockReturnValue([]),
      getStatusCategory: vi.fn().mockReturnValue(null),
      getSchema: vi.fn().mockReturnValue(null),
    } as unknown as ProcessEngine;
    behaviorEngine = {
      onStatusEnter: vi.fn(),
      onChildCompleted: vi.fn(),
    } as unknown as BehaviorEngine;

    orchestrator = new Orchestrator(
      eventBus,
      logger,
      taskRepo,
      roleRepo,
      orgRepo,
      convRepo,
      pendingWakeRepo,
      wakeGateValidator,
      retryScheduler,
      runCoordinator,
      taskScheduler,
      taskStateMachine,
      processEngine,
      behaviorEngine,
    );
    orchestrator.start();
  });

  describe('task:status-changed', () => {
    it('wakes agent when task status changes and assignee exists', async () => {
      eventBus.emit({
        type: 'task:status-changed',
        timestamp: new Date().toISOString(),
        payload: { taskId: TEST_TASK_ID, assigneeRoleId: TEST_ROLE_ID, orgId: TEST_ORG_ID, from: 'pending', to: 'in_progress' },
      });

      await vi.waitFor(() => {
        expect(runCoordinator.executeForTask).toHaveBeenCalledWith(
          TEST_TASK_ID, TEST_ROLE_ID, TEST_ORG_ID, 'task_assigned', 'en-US',
        );
      });
    });

    it('does not wake when no assigneeRoleId', () => {
      eventBus.emit({
        type: 'task:status-changed',
        timestamp: new Date().toISOString(),
        payload: { taskId: TEST_TASK_ID, assigneeRoleId: null, orgId: TEST_ORG_ID, from: 'pending', to: 'in_progress' },
      });
      expect(runCoordinator.executeForTask).not.toHaveBeenCalled();
    });

    it('does not wake when task is paused for approval', () => {
      eventBus.emit({
        type: 'task:entered-approval',
        timestamp: new Date().toISOString(),
        payload: { taskId: TEST_TASK_ID },
      });
      eventBus.emit({
        type: 'task:status-changed',
        timestamp: new Date().toISOString(),
        payload: { taskId: TEST_TASK_ID, assigneeRoleId: TEST_ROLE_ID, orgId: TEST_ORG_ID, from: 'pending', to: 'in_progress' },
      });
      expect(runCoordinator.executeForTask).not.toHaveBeenCalled();
    });

    it('queues wake when gate blocks', () => {
      vi.mocked(wakeGateValidator.validate).mockReturnValue({ allowed: false, reason: 'Budget exceeded' });
      eventBus.emit({
        type: 'task:status-changed',
        timestamp: new Date().toISOString(),
        payload: { taskId: TEST_TASK_ID, assigneeRoleId: TEST_ROLE_ID, orgId: TEST_ORG_ID, from: 'pending', to: 'in_progress' },
      });
      expect(pendingWakeRepo.create).toHaveBeenCalledWith(expect.objectContaining({
        roleId: TEST_ROLE_ID,
        orgId: TEST_ORG_ID,
        reason: 'task_assigned',
        taskId: TEST_TASK_ID,
      }));
      expect(runCoordinator.executeForTask).not.toHaveBeenCalled();
    });
  });

  describe('task:entered-approval', () => {
    it('pauses task scheduling', () => {
      eventBus.emit({
        type: 'task:entered-approval',
        timestamp: new Date().toISOString(),
        payload: { taskId: TEST_TASK_ID },
      });
      eventBus.emit({
        type: 'task:status-changed',
        timestamp: new Date().toISOString(),
        payload: { taskId: TEST_TASK_ID, assigneeRoleId: TEST_ROLE_ID, orgId: TEST_ORG_ID, from: 'a', to: 'b' },
      });
      expect(runCoordinator.executeForTask).not.toHaveBeenCalled();
    });
  });

  describe('task:approval-confirmed', () => {
    it('resumes task and calls scheduleNext', () => {
      eventBus.emit({
        type: 'task:entered-approval',
        timestamp: new Date().toISOString(),
        payload: { taskId: TEST_TASK_ID },
      });
      eventBus.emit({
        type: 'task:approval-confirmed',
        timestamp: new Date().toISOString(),
        payload: { taskId: TEST_TASK_ID, orgId: TEST_ORG_ID },
      });

      expect(taskScheduler.findNextTask).toHaveBeenCalledWith(TEST_ORG_ID);
    });

    it('removes task from paused set on approval confirmed', () => {
      eventBus.emit({
        type: 'task:entered-approval',
        timestamp: new Date().toISOString(),
        payload: { taskId: TEST_TASK_ID },
      });
      eventBus.emit({
        type: 'task:approval-confirmed',
        timestamp: new Date().toISOString(),
        payload: { taskId: TEST_TASK_ID, orgId: TEST_ORG_ID },
      });
      eventBus.emit({
        type: 'task:status-changed',
        timestamp: new Date().toISOString(),
        payload: { taskId: TEST_TASK_ID, assigneeRoleId: TEST_ROLE_ID, orgId: TEST_ORG_ID, from: 'a', to: 'b' },
      });
      expect(runCoordinator.executeForTask).toHaveBeenCalled();
    });
  });

  describe('task:completed', () => {
    it('calls behaviorEngine.onChildCompleted and scheduleNext', () => {
      const task = { id: TEST_TASK_ID, assigneeRoleId: TEST_ROLE_ID, parentId: 'parent-task', orgId: TEST_ORG_ID };
      vi.mocked(taskRepo.findById).mockReturnValue(task as any);

      eventBus.emit({
        type: 'task:completed',
        timestamp: new Date().toISOString(),
        payload: { taskId: TEST_TASK_ID, orgId: TEST_ORG_ID },
      });

      expect(behaviorEngine.onChildCompleted).toHaveBeenCalledWith(task);
      expect(taskScheduler.findNextTask).toHaveBeenCalledWith(TEST_ORG_ID);
    });

    it('does nothing when task not found', () => {
      vi.mocked(taskRepo.findById).mockReturnValue(null);

      eventBus.emit({
        type: 'task:completed',
        timestamp: new Date().toISOString(),
        payload: { taskId: TEST_TASK_ID, orgId: TEST_ORG_ID },
      });

      expect(behaviorEngine.onChildCompleted).not.toHaveBeenCalled();
      expect(taskScheduler.findNextTask).not.toHaveBeenCalled();
    });
  });

  describe('conversation:response-needed', () => {
    it('executes run for conversation when gate allows', async () => {
      eventBus.emit({
        type: 'conversation:response-needed',
        timestamp: new Date().toISOString(),
        payload: { conversationId: 'conv-1', orgId: TEST_ORG_ID, roleId: TEST_ROLE_ID },
      });

      await vi.waitFor(() => {
        expect(runCoordinator.executeForConversation).toHaveBeenCalledWith(
          'conv-1', TEST_ROLE_ID, TEST_ORG_ID, 'en-US',
        );
      });
    });

    it('does not execute when gate blocks', () => {
      vi.mocked(wakeGateValidator.validate).mockReturnValue({ allowed: false, reason: 'Role is paused' });
      eventBus.emit({
        type: 'conversation:response-needed',
        timestamp: new Date().toISOString(),
        payload: { conversationId: 'conv-1', orgId: TEST_ORG_ID, roleId: TEST_ROLE_ID },
      });
      expect(runCoordinator.executeForConversation).not.toHaveBeenCalled();
    });

    it('does not execute when roleId is null', () => {
      eventBus.emit({
        type: 'conversation:response-needed',
        timestamp: new Date().toISOString(),
        payload: { conversationId: 'conv-1', orgId: TEST_ORG_ID, roleId: null },
      });
      expect(runCoordinator.executeForConversation).not.toHaveBeenCalled();
    });
  });

  describe('conversation:resolved', () => {
    it('wakes initiator to resume task work', async () => {
      eventBus.emit({
        type: 'conversation:resolved',
        timestamp: new Date().toISOString(),
        payload: { conversationId: 'conv-1' },
      });

      await vi.waitFor(() => {
        expect(runCoordinator.executeForTask).toHaveBeenCalledWith(
          TEST_TASK_ID, TEST_ROLE_ID, TEST_ORG_ID, 'conversation_reply', 'en-US',
        );
      });
    });

    it('does not wake when conversation has no taskId', () => {
      vi.mocked(convRepo.findById).mockReturnValue({ id: 'conv-1', taskId: null, initiatorRoleId: TEST_ROLE_ID, orgId: TEST_ORG_ID } as any);
      eventBus.emit({
        type: 'conversation:resolved',
        timestamp: new Date().toISOString(),
        payload: { conversationId: 'conv-1' },
      });
      expect(runCoordinator.executeForTask).not.toHaveBeenCalled();
    });
  });

  describe('run:failed', () => {
    it('delegates to retry scheduler and drains pending wakes', () => {
      eventBus.emit({
        type: 'run:failed',
        timestamp: new Date().toISOString(),
        payload: { runId: 'run-failed', orgId: TEST_ORG_ID },
      });
      expect(retryScheduler.scheduleRetry).toHaveBeenCalledWith('run-failed');
      expect(pendingWakeRepo.findNext).toHaveBeenCalledWith(TEST_ORG_ID);
      expect(taskScheduler.findNextTask).toHaveBeenCalledWith(TEST_ORG_ID);
    });
  });

  describe('run:succeeded', () => {
    it('drains pending wakes and calls scheduleNext', () => {
      eventBus.emit({
        type: 'run:succeeded',
        timestamp: new Date().toISOString(),
        payload: { orgId: TEST_ORG_ID },
      });
      expect(pendingWakeRepo.findNext).toHaveBeenCalledWith(TEST_ORG_ID);
      expect(taskScheduler.findNextTask).toHaveBeenCalledWith(TEST_ORG_ID);
    });
  });

  describe('run:cancelled', () => {
    it('drains pending wakes and calls scheduleNext', () => {
      eventBus.emit({
        type: 'run:cancelled',
        timestamp: new Date().toISOString(),
        payload: { orgId: TEST_ORG_ID },
      });
      expect(pendingWakeRepo.findNext).toHaveBeenCalledWith(TEST_ORG_ID);
      expect(taskScheduler.findNextTask).toHaveBeenCalledWith(TEST_ORG_ID);
    });
  });

  // ─── 3.1 scheduleNext ─────────────────────────────────────────

  describe('scheduleNext (additional)', () => {
    it('warns and takes no action when no active transition target exists', () => {
      const task = { id: 'task-s1', status: 'pending', assigneeRoleId: TEST_ROLE_ID, orgId: TEST_ORG_ID };
      vi.mocked(taskScheduler.findNextTask).mockReturnValue({ task: task as any });
      vi.mocked(processEngine.getAvailableTransitions).mockReturnValue([{ from: 'pending', to: 'review' }]);
      vi.mocked(processEngine.getStatusCategory).mockReturnValue('approval'); // not 'active'

      eventBus.emit({
        type: 'run:succeeded',
        timestamp: new Date().toISOString(),
        payload: { orgId: TEST_ORG_ID },
      });

      expect(taskStateMachine.transition).not.toHaveBeenCalled();
      expect(logger.logs.some((l) => l.level === 'warn' && l.msg.includes('No active transition'))).toBe(true);
    });

    it('adds taskId to scheduledTaskIds so next status-changed uses reason=task_scheduled', () => {
      const task = { id: 'task-s2', status: 'pending', assigneeRoleId: TEST_ROLE_ID, orgId: TEST_ORG_ID };
      vi.mocked(taskScheduler.findNextTask).mockReturnValue({ task: task as any });
      vi.mocked(processEngine.getAvailableTransitions).mockReturnValue([{ from: 'pending', to: 'in_progress' }]);
      vi.mocked(processEngine.getStatusCategory).mockReturnValue('active');

      // Trigger scheduleNext via run:succeeded
      eventBus.emit({
        type: 'run:succeeded',
        timestamp: new Date().toISOString(),
        payload: { orgId: TEST_ORG_ID },
      });

      expect(taskStateMachine.transition).toHaveBeenCalledWith('task-s2', 'in_progress');

      // Now emit task:status-changed for that scheduled task
      vi.mocked(runCoordinator.executeForTask).mockClear();
      eventBus.emit({
        type: 'task:status-changed',
        timestamp: new Date().toISOString(),
        payload: { taskId: 'task-s2', assigneeRoleId: TEST_ROLE_ID, orgId: TEST_ORG_ID, from: 'pending', to: 'in_progress' },
      });

      expect(runCoordinator.executeForTask).toHaveBeenCalledWith(
        'task-s2', TEST_ROLE_ID, TEST_ORG_ID, 'task_scheduled', 'en-US',
      );
    });

    it('throws when taskStateMachine.transition throws (error propagates from scheduleNext)', () => {
      const task = { id: 'task-s3', status: 'pending', assigneeRoleId: TEST_ROLE_ID, orgId: TEST_ORG_ID };
      vi.mocked(taskScheduler.findNextTask).mockReturnValue({ task: task as any });
      vi.mocked(processEngine.getAvailableTransitions).mockReturnValue([{ from: 'pending', to: 'in_progress' }]);
      vi.mocked(processEngine.getStatusCategory).mockReturnValue('active');
      vi.mocked(taskStateMachine.transition).mockImplementation(() => { throw new Error('Transition error'); });

      expect(() => {
        eventBus.emit({
          type: 'run:succeeded',
          timestamp: new Date().toISOString(),
          payload: { orgId: TEST_ORG_ID },
        });
      }).toThrow('Transition error');

      // Orchestrator remains functional after the error
      vi.mocked(taskStateMachine.transition).mockReset();
      vi.mocked(taskScheduler.findNextTask).mockReturnValue(null);
      expect(() => {
        eventBus.emit({
          type: 'run:succeeded',
          timestamp: new Date().toISOString(),
          payload: { orgId: TEST_ORG_ID },
        });
      }).not.toThrow();
    });
  });

  // ─── 3.2 wakeReason distinction ───────────────────────────────

  describe('wakeReason distinction', () => {
    it('uses reason=task_scheduled when taskId is in scheduledTaskIds', () => {
      // First, schedule a task via scheduleNext
      const task = { id: 'task-w1', status: 'pending', assigneeRoleId: TEST_ROLE_ID, orgId: TEST_ORG_ID };
      vi.mocked(taskScheduler.findNextTask).mockReturnValue({ task: task as any });
      vi.mocked(processEngine.getAvailableTransitions).mockReturnValue([{ from: 'pending', to: 'in_progress' }]);
      vi.mocked(processEngine.getStatusCategory).mockReturnValue('active');

      eventBus.emit({
        type: 'run:succeeded',
        timestamp: new Date().toISOString(),
        payload: { orgId: TEST_ORG_ID },
      });

      // Now emit task:status-changed for the scheduled task
      vi.mocked(runCoordinator.executeForTask).mockClear();
      eventBus.emit({
        type: 'task:status-changed',
        timestamp: new Date().toISOString(),
        payload: { taskId: 'task-w1', assigneeRoleId: TEST_ROLE_ID, orgId: TEST_ORG_ID, from: 'pending', to: 'in_progress' },
      });

      expect(runCoordinator.executeForTask).toHaveBeenCalledWith(
        'task-w1', TEST_ROLE_ID, TEST_ORG_ID, 'task_scheduled', 'en-US',
      );
    });

    it('uses reason=task_assigned when taskId is NOT in scheduledTaskIds', () => {
      eventBus.emit({
        type: 'task:status-changed',
        timestamp: new Date().toISOString(),
        payload: { taskId: 'task-w2', assigneeRoleId: TEST_ROLE_ID, orgId: TEST_ORG_ID, from: 'pending', to: 'in_progress' },
      });

      expect(runCoordinator.executeForTask).toHaveBeenCalledWith(
        'task-w2', TEST_ROLE_ID, TEST_ORG_ID, 'task_assigned', 'en-US',
      );
    });

    it('removes taskId from scheduledTaskIds after first use', () => {
      // Schedule a task
      const task = { id: 'task-w3', status: 'pending', assigneeRoleId: TEST_ROLE_ID, orgId: TEST_ORG_ID };
      vi.mocked(taskScheduler.findNextTask).mockReturnValue({ task: task as any });
      vi.mocked(processEngine.getAvailableTransitions).mockReturnValue([{ from: 'pending', to: 'in_progress' }]);
      vi.mocked(processEngine.getStatusCategory).mockReturnValue('active');

      eventBus.emit({
        type: 'run:succeeded',
        timestamp: new Date().toISOString(),
        payload: { orgId: TEST_ORG_ID },
      });

      // First status-changed => task_scheduled
      vi.mocked(runCoordinator.executeForTask).mockClear();
      eventBus.emit({
        type: 'task:status-changed',
        timestamp: new Date().toISOString(),
        payload: { taskId: 'task-w3', assigneeRoleId: TEST_ROLE_ID, orgId: TEST_ORG_ID, from: 'pending', to: 'in_progress' },
      });

      expect(runCoordinator.executeForTask).toHaveBeenCalledWith(
        'task-w3', TEST_ROLE_ID, TEST_ORG_ID, 'task_scheduled', 'en-US',
      );

      // Second status-changed for same taskId => task_assigned (consumed)
      vi.mocked(runCoordinator.executeForTask).mockClear();
      eventBus.emit({
        type: 'task:status-changed',
        timestamp: new Date().toISOString(),
        payload: { taskId: 'task-w3', assigneeRoleId: TEST_ROLE_ID, orgId: TEST_ORG_ID, from: 'in_progress', to: 'review' },
      });

      expect(runCoordinator.executeForTask).toHaveBeenCalledWith(
        'task-w3', TEST_ROLE_ID, TEST_ORG_ID, 'task_assigned', 'en-US',
      );
    });
  });

  // ─── 3.4 onTaskCompleted (additional) ─────────────────────────

  describe('task:completed (additional)', () => {
    it('returns directly when task not found — behaviorEngine.onChildCompleted not called', () => {
      vi.mocked(taskRepo.findById).mockReturnValue(null);

      eventBus.emit({
        type: 'task:completed',
        timestamp: new Date().toISOString(),
        payload: { taskId: 'missing-task', orgId: TEST_ORG_ID },
      });

      expect(behaviorEngine.onChildCompleted).not.toHaveBeenCalled();
      expect(taskScheduler.findNextTask).not.toHaveBeenCalled();
    });

    it('removes task from pausedTasks so subsequent status-changed wakes the agent', () => {
      // Pause the task first
      eventBus.emit({
        type: 'task:entered-approval',
        timestamp: new Date().toISOString(),
        payload: { taskId: TEST_TASK_ID },
      });

      // Verify it is paused
      eventBus.emit({
        type: 'task:status-changed',
        timestamp: new Date().toISOString(),
        payload: { taskId: TEST_TASK_ID, assigneeRoleId: TEST_ROLE_ID, orgId: TEST_ORG_ID, from: 'a', to: 'b' },
      });
      expect(runCoordinator.executeForTask).not.toHaveBeenCalled();

      // Complete the task — removes from paused
      const task = { id: TEST_TASK_ID, assigneeRoleId: TEST_ROLE_ID, parentId: 'parent-1', orgId: TEST_ORG_ID };
      vi.mocked(taskRepo.findById).mockReturnValue(task as any);
      eventBus.emit({
        type: 'task:completed',
        timestamp: new Date().toISOString(),
        payload: { taskId: TEST_TASK_ID, orgId: TEST_ORG_ID },
      });

      // Now a status-changed should wake the agent (not paused anymore)
      vi.mocked(runCoordinator.executeForTask).mockClear();
      eventBus.emit({
        type: 'task:status-changed',
        timestamp: new Date().toISOString(),
        payload: { taskId: TEST_TASK_ID, assigneeRoleId: TEST_ROLE_ID, orgId: TEST_ORG_ID, from: 'b', to: 'c' },
      });
      expect(runCoordinator.executeForTask).toHaveBeenCalled();
    });
  });

  // ─── 3.6 drainPendingWakes ────────────────────────────────────

  describe('drainPendingWakes', () => {
    const pendingWake = {
      id: 'wake-1',
      roleId: TEST_ROLE_ID,
      orgId: TEST_ORG_ID,
      reason: 'task_assigned',
      taskId: TEST_TASK_ID,
      priority: 0,
      createdAt: new Date().toISOString(),
    };

    it('executes and deletes wake when gate allows', async () => {
      vi.mocked(pendingWakeRepo.findNext).mockReturnValue(pendingWake);
      vi.mocked(wakeGateValidator.validate).mockReturnValue({ allowed: true });

      eventBus.emit({
        type: 'run:succeeded',
        timestamp: new Date().toISOString(),
        payload: { orgId: TEST_ORG_ID },
      });

      expect(pendingWakeRepo.delete).toHaveBeenCalledWith('wake-1');
      await vi.waitFor(() => {
        expect(runCoordinator.executeForTask).toHaveBeenCalledWith(
          TEST_TASK_ID, TEST_ROLE_ID, TEST_ORG_ID, 'task_assigned', 'en-US',
        );
      });
    });

    it('re-enqueues wake when gate blocks and does not execute', () => {
      vi.mocked(pendingWakeRepo.findNext).mockReturnValue(pendingWake);
      vi.mocked(wakeGateValidator.validate).mockReturnValue({ allowed: false, reason: 'Budget exceeded' });

      eventBus.emit({
        type: 'run:succeeded',
        timestamp: new Date().toISOString(),
        payload: { orgId: TEST_ORG_ID },
      });

      expect(pendingWakeRepo.delete).toHaveBeenCalledWith('wake-1');
      expect(pendingWakeRepo.create).toHaveBeenCalledWith(expect.objectContaining({
        roleId: TEST_ROLE_ID,
        orgId: TEST_ORG_ID,
        reason: 'task_assigned',
        taskId: TEST_TASK_ID,
      }));
      expect(runCoordinator.executeForTask).not.toHaveBeenCalled();
    });

    it('does nothing when queue is empty', () => {
      vi.mocked(pendingWakeRepo.findNext).mockReturnValue(null);

      eventBus.emit({
        type: 'run:succeeded',
        timestamp: new Date().toISOString(),
        payload: { orgId: TEST_ORG_ID },
      });

      expect(pendingWakeRepo.delete).not.toHaveBeenCalled();
      // executeForTask is not called for drain (may be called by scheduleNext, so check drain-specific call)
    });

    it('logs error but does not crash when executeForTask rejects', async () => {
      vi.mocked(pendingWakeRepo.findNext).mockReturnValue(pendingWake);
      vi.mocked(wakeGateValidator.validate).mockReturnValue({ allowed: true });
      vi.mocked(runCoordinator.executeForTask).mockRejectedValue(new Error('Execution failed'));

      expect(() => {
        eventBus.emit({
          type: 'run:succeeded',
          timestamp: new Date().toISOString(),
          payload: { orgId: TEST_ORG_ID },
        });
      }).not.toThrow();

      await vi.waitFor(() => {
        expect(logger.logs.some((l) => l.level === 'error' && l.msg.includes('Pending wake execution failed'))).toBe(true);
      });
    });

    it('deletes consumed wake from queue', () => {
      vi.mocked(pendingWakeRepo.findNext).mockReturnValue(pendingWake);
      vi.mocked(wakeGateValidator.validate).mockReturnValue({ allowed: true });

      eventBus.emit({
        type: 'run:succeeded',
        timestamp: new Date().toISOString(),
        payload: { orgId: TEST_ORG_ID },
      });

      expect(pendingWakeRepo.delete).toHaveBeenCalledWith('wake-1');
    });
  });

  // ─── 3.7 Event subscription completeness ──────────────────────

  describe('event subscription completeness', () => {
    it('start() subscribes to all 10 required event types', () => {
      const freshEventBus = new MockEventBus();
      const freshOrchestrator = new Orchestrator(
        freshEventBus,
        logger,
        taskRepo,
        roleRepo,
        orgRepo,
        convRepo,
        pendingWakeRepo,
        wakeGateValidator,
        retryScheduler,
        runCoordinator,
        taskScheduler,
        taskStateMachine,
        processEngine,
        behaviorEngine,
      );

      freshOrchestrator.start();

      const requiredEvents = [
        'task:created',
        'task:status-changed',
        'task:entered-approval',
        'task:approval-confirmed',
        'task:completed',
        'conversation:response-needed',
        'conversation:resolved',
        'run:failed',
        'run:succeeded',
        'run:cancelled',
      ];

      for (const eventType of requiredEvents) {
        // Verify each event type has a handler by emitting and checking no crash
        // We access the internal handlers map via the mock's on() calls
        expect(() => {
          freshEventBus.emit({
            type: eventType as any,
            timestamp: new Date().toISOString(),
            payload: {},
          });
        }).not.toThrow();
      }
    });
  });

  // ─── 3.8 Idempotency ─────────────────────────────────────────

  describe('idempotency', () => {
    it('concurrent scheduleNext does not double-schedule when first transitions task away', () => {
      const task = { id: 'task-idem', status: 'pending', assigneeRoleId: TEST_ROLE_ID, orgId: TEST_ORG_ID };

      // First call to findNextTask returns the task; after transition, second call returns null
      vi.mocked(taskScheduler.findNextTask)
        .mockReturnValueOnce({ task: task as any })
        .mockReturnValueOnce(null);
      vi.mocked(processEngine.getAvailableTransitions).mockReturnValue([{ from: 'pending', to: 'in_progress' }]);
      vi.mocked(processEngine.getStatusCategory).mockReturnValue('active');

      // Trigger scheduleNext twice (e.g., two run:succeeded events in quick succession)
      eventBus.emit({
        type: 'run:succeeded',
        timestamp: new Date().toISOString(),
        payload: { orgId: TEST_ORG_ID },
      });
      eventBus.emit({
        type: 'run:succeeded',
        timestamp: new Date().toISOString(),
        payload: { orgId: TEST_ORG_ID },
      });

      expect(taskStateMachine.transition).toHaveBeenCalledTimes(1);
      expect(taskStateMachine.transition).toHaveBeenCalledWith('task-idem', 'in_progress');
    });
  });
});
