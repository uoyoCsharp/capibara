import { describe, it, expect, beforeEach } from 'vitest';
import { TaskOrchestrator } from '@core/modules/orchestrator/orchestrators/task.orchestrator';
import { ConversationOrchestrator } from '@core/modules/orchestrator/orchestrators/conversation.orchestrator';
import { RunOrchestrator } from '@core/modules/orchestrator/orchestrators/run.orchestrator';
import { MockEventBus } from '../../helpers/mock-event-bus';
import { MockLogger } from '../../helpers/mock-logger';
import { TEST_ORG_ID, TEST_ROLE_ID, TEST_TASK_ID } from '../../helpers/fixtures';
import type { ITaskRepository } from '@core/modules/workflow/interfaces/i-task.repository';
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
import type { Task } from '@core/modules/workflow/types/workflow.types';

/**
 * End-to-end tests for the three sub-orchestrators working as a set.
 * These verify the behavior that the monolithic Orchestrator used to
 * own — now distributed across TaskOrchestrator, ConversationOrchestrator,
 * and RunOrchestrator.
 */
describe('Orchestrators (task + conversation + run)', () => {
  let taskOrchestrator: TaskOrchestrator;
  let conversationOrchestrator: ConversationOrchestrator;
  let runOrchestrator: RunOrchestrator;
  let eventBus: MockEventBus;
  let logger: MockLogger;
  let taskRepo: ITaskRepository;
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

  function taskFixture(overrides?: Partial<Task>): Task {
    return {
      id: TEST_TASK_ID,
      orgId: TEST_ORG_ID,
      parentId: null,
      type: 'task',
      title: 'T',
      description: '',
      status: 'pending',
      assigneeRoleId: TEST_ROLE_ID,
      depth: 0,
      artifactPaths: null,
      pausedReason: null,
      createdAt: '',
      updatedAt: '',
      ...overrides,
    };
  }

  beforeEach(() => {
    eventBus = new MockEventBus();
    logger = new MockLogger();
    taskRepo = {
      findById: vi.fn().mockReturnValue(taskFixture()),
      findByOrgId: vi.fn(),
      findChildren: vi.fn(),
      findByAssigneeRoleId: vi.fn(),
      create: vi.fn(),
      updateStatus: vi.fn(),
      updatePausedReason: vi.fn(),
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
      getStatusCategory: vi.fn().mockReturnValue('active'),
      getSchema: vi.fn().mockReturnValue(null),
    } as unknown as ProcessEngine;
    behaviorEngine = {
      onStatusEnter: vi.fn(),
      onChildCompleted: vi.fn(),
    } as unknown as BehaviorEngine;

    taskOrchestrator = new TaskOrchestrator(
      eventBus,
      logger,
      taskRepo,
      orgRepo,
      pendingWakeRepo,
      wakeGateValidator,
      runCoordinator,
      taskScheduler,
      taskStateMachine,
      processEngine,
      behaviorEngine,
    );
    conversationOrchestrator = new ConversationOrchestrator(
      eventBus,
      logger,
      convRepo,
      wakeGateValidator,
      runCoordinator,
      taskOrchestrator,
    );
    runOrchestrator = new RunOrchestrator(
      eventBus,
      logger,
      pendingWakeRepo,
      wakeGateValidator,
      retryScheduler,
      runCoordinator,
      taskOrchestrator,
    );

    taskOrchestrator.start();
    conversationOrchestrator.start();
    runOrchestrator.start();
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

    it('does not wake when task.pausedReason is set', () => {
      vi.mocked(taskRepo.findById).mockReturnValue(taskFixture({ pausedReason: 'approval' }));
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

  describe('task:approval-confirmed', () => {
    it('calls scheduleNext after approval is confirmed', () => {
      eventBus.emit({
        type: 'task:approval-confirmed',
        timestamp: new Date().toISOString(),
        payload: { taskId: TEST_TASK_ID, orgId: TEST_ORG_ID, from: 'awaiting_review', to: 'approved' },
      });

      expect(taskScheduler.findNextTask).toHaveBeenCalledWith(TEST_ORG_ID);
    });
  });

  describe('task:completed', () => {
    it('calls behaviorEngine.onChildCompleted and scheduleNext', () => {
      const task = taskFixture({ parentId: 'parent-task' });
      vi.mocked(taskRepo.findById).mockReturnValue(task);

      eventBus.emit({
        type: 'task:completed',
        timestamp: new Date().toISOString(),
        payload: { taskId: TEST_TASK_ID, orgId: TEST_ORG_ID, status: 'done' },
      });

      expect(behaviorEngine.onChildCompleted).toHaveBeenCalledWith(task);
      expect(taskScheduler.findNextTask).toHaveBeenCalledWith(TEST_ORG_ID);
    });

    it('does nothing when task not found', () => {
      vi.mocked(taskRepo.findById).mockReturnValue(null);

      eventBus.emit({
        type: 'task:completed',
        timestamp: new Date().toISOString(),
        payload: { taskId: TEST_TASK_ID, orgId: TEST_ORG_ID, status: 'done' },
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
      vi.mocked(convRepo.findById).mockReturnValue({ id: 'conv-1', taskId: null, initiatorRoleId: TEST_ROLE_ID, orgId: TEST_ORG_ID } as ReturnType<typeof convRepo.findById>);
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
        payload: { runId: 'run-failed', orgId: TEST_ORG_ID, roleId: TEST_ROLE_ID, tokenCount: 0, errorMessage: null },
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
        payload: { runId: 'run-1', orgId: TEST_ORG_ID, roleId: TEST_ROLE_ID, tokenCount: 0 },
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
        payload: { runId: 'run-1', orgId: TEST_ORG_ID, roleId: TEST_ROLE_ID, tokenCount: 0 },
      });
      expect(pendingWakeRepo.findNext).toHaveBeenCalledWith(TEST_ORG_ID);
      expect(taskScheduler.findNextTask).toHaveBeenCalledWith(TEST_ORG_ID);
    });
  });

  describe('scheduleNext via run:succeeded', () => {
    it('warns and takes no action when no active transition target exists', () => {
      const task = taskFixture({ id: 'task-s1' });
      vi.mocked(taskScheduler.findNextTask).mockReturnValue({ task, wakeReason: 'task_scheduled' });
      vi.mocked(processEngine.getAvailableTransitions).mockReturnValue([{ from: 'pending', to: 'review' }]);
      vi.mocked(processEngine.getStatusCategory).mockReturnValue('approval');

      eventBus.emit({
        type: 'run:succeeded',
        timestamp: new Date().toISOString(),
        payload: { runId: 'r', orgId: TEST_ORG_ID, roleId: TEST_ROLE_ID, tokenCount: 0 },
      });

      expect(taskStateMachine.transition).not.toHaveBeenCalled();
      expect(logger.logs.some((l) => l.level === 'warn' && l.msg.includes('No active transition'))).toBe(true);
    });

    it('adds taskId to scheduledTaskIds so next status-changed uses reason=task_scheduled', () => {
      const task = taskFixture({ id: 'task-s2' });
      vi.mocked(taskScheduler.findNextTask).mockReturnValue({ task, wakeReason: 'task_scheduled' });
      vi.mocked(processEngine.getAvailableTransitions).mockReturnValue([{ from: 'pending', to: 'in_progress' }]);
      vi.mocked(processEngine.getStatusCategory).mockReturnValue('active');

      eventBus.emit({
        type: 'run:succeeded',
        timestamp: new Date().toISOString(),
        payload: { runId: 'r', orgId: TEST_ORG_ID, roleId: TEST_ROLE_ID, tokenCount: 0 },
      });

      expect(taskStateMachine.transition).toHaveBeenCalledWith('task-s2', 'in_progress');

      vi.mocked(runCoordinator.executeForTask).mockClear();
      vi.mocked(taskRepo.findById).mockReturnValue(taskFixture({ id: 'task-s2' }));
      eventBus.emit({
        type: 'task:status-changed',
        timestamp: new Date().toISOString(),
        payload: { taskId: 'task-s2', assigneeRoleId: TEST_ROLE_ID, orgId: TEST_ORG_ID, from: 'pending', to: 'in_progress' },
      });

      expect(runCoordinator.executeForTask).toHaveBeenCalledWith(
        'task-s2', TEST_ROLE_ID, TEST_ORG_ID, 'task_scheduled', 'en-US',
      );
    });
  });

  describe('wakeReason distinction', () => {
    it('uses reason=task_assigned for unscheduled task', () => {
      eventBus.emit({
        type: 'task:status-changed',
        timestamp: new Date().toISOString(),
        payload: { taskId: 'task-w2', assigneeRoleId: TEST_ROLE_ID, orgId: TEST_ORG_ID, from: 'pending', to: 'in_progress' },
      });

      expect(runCoordinator.executeForTask).toHaveBeenCalledWith(
        'task-w2', TEST_ROLE_ID, TEST_ORG_ID, 'task_assigned', 'en-US',
      );
    });
  });

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
        payload: { runId: 'r', orgId: TEST_ORG_ID, roleId: TEST_ROLE_ID, tokenCount: 0 },
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
        payload: { runId: 'r', orgId: TEST_ORG_ID, roleId: TEST_ROLE_ID, tokenCount: 0 },
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
        payload: { runId: 'r', orgId: TEST_ORG_ID, roleId: TEST_ROLE_ID, tokenCount: 0 },
      });

      expect(pendingWakeRepo.delete).not.toHaveBeenCalled();
    });

    it('logs error but does not crash when executeForTask rejects', async () => {
      vi.mocked(pendingWakeRepo.findNext).mockReturnValue(pendingWake);
      vi.mocked(wakeGateValidator.validate).mockReturnValue({ allowed: true });
      vi.mocked(runCoordinator.executeForTask).mockRejectedValue(new Error('Execution failed'));

      expect(() => {
        eventBus.emit({
          type: 'run:succeeded',
          timestamp: new Date().toISOString(),
          payload: { runId: 'r', orgId: TEST_ORG_ID, roleId: TEST_ROLE_ID, tokenCount: 0 },
        });
      }).not.toThrow();

      await vi.waitFor(() => {
        expect(logger.logs.some((l) => l.level === 'error' && l.msg.includes('Pending wake execution failed'))).toBe(true);
      });
    });
  });
});
