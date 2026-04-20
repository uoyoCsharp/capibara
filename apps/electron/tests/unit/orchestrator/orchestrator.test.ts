import { describe, it, expect, beforeEach } from 'vitest';
import { Orchestrator } from '@core/modules/orchestrator/orchestrator';
import { MockEventBus } from '../../helpers/mock-event-bus';
import { MockLogger } from '../../helpers/mock-logger';
import { TEST_ORG_ID, TEST_ROLE_ID, TEST_TASK_ID } from '../../helpers/fixtures';
import type { ITaskRepository } from '@core/modules/workflow/interfaces/i-task.repository';
import type { IRoleRepository } from '@core/modules/organization/interfaces/i-role.repository';
import type { IConversationRepository } from '@core/modules/conversation/interfaces/i-conversation.repository';
import type { IPendingWakeRepository } from '@core/modules/orchestrator/interfaces/i-pending-wake.repository';
import type { WakeGateValidator } from '@core/modules/orchestrator/wake-gate.validator';
import type { RetryScheduler } from '@core/modules/orchestrator/retry.scheduler';
import type { RunCoordinator } from '@core/modules/orchestrator/run.coordinator';

describe('Orchestrator', () => {
  let orchestrator: Orchestrator;
  let eventBus: MockEventBus;
  let logger: MockLogger;
  let taskRepo: ITaskRepository;
  let roleRepo: IRoleRepository;
  let convRepo: IConversationRepository;
  let pendingWakeRepo: IPendingWakeRepository;
  let wakeGateValidator: WakeGateValidator;
  let retryScheduler: RetryScheduler;
  let runCoordinator: RunCoordinator;

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

    orchestrator = new Orchestrator(
      eventBus,
      logger,
      taskRepo,
      roleRepo,
      convRepo,
      pendingWakeRepo,
      wakeGateValidator,
      retryScheduler,
      runCoordinator,
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
    it('resumes task and wakes agent', async () => {
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

      await vi.waitFor(() => {
        expect(runCoordinator.executeForTask).toHaveBeenCalledWith(
          TEST_TASK_ID, TEST_ROLE_ID, TEST_ORG_ID, 'review_approve', 'en-US',
        );
      });
    });

    it('does not wake if task has no assignee', () => {
      vi.mocked(taskRepo.findById).mockReturnValue({ id: TEST_TASK_ID, assigneeRoleId: null, parentId: null } as any);
      eventBus.emit({
        type: 'task:approval-confirmed',
        timestamp: new Date().toISOString(),
        payload: { taskId: TEST_TASK_ID, orgId: TEST_ORG_ID },
      });
      expect(runCoordinator.executeForTask).not.toHaveBeenCalled();
    });
  });

  describe('task:completed', () => {
    it('wakes parent task assignee when child completes', async () => {
      const parentTask = { id: 'parent-task', assigneeRoleId: 'role-parent', parentId: null };
      const childTask = { id: TEST_TASK_ID, assigneeRoleId: TEST_ROLE_ID, parentId: 'parent-task' };
      vi.mocked(taskRepo.findById).mockImplementation((id) => {
        if (id === TEST_TASK_ID) return childTask as any;
        if (id === 'parent-task') return parentTask as any;
        return null;
      });

      eventBus.emit({
        type: 'task:completed',
        timestamp: new Date().toISOString(),
        payload: { taskId: TEST_TASK_ID, orgId: TEST_ORG_ID },
      });

      await vi.waitFor(() => {
        expect(runCoordinator.executeForTask).toHaveBeenCalledWith(
          'parent-task', 'role-parent', TEST_ORG_ID, 'task_completed', 'en-US',
        );
      });
    });

    it('does nothing when task has no parent', () => {
      eventBus.emit({
        type: 'task:completed',
        timestamp: new Date().toISOString(),
        payload: { taskId: TEST_TASK_ID, orgId: TEST_ORG_ID },
      });
      expect(runCoordinator.executeForTask).not.toHaveBeenCalled();
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
    it('delegates to retry scheduler', () => {
      eventBus.emit({
        type: 'run:failed',
        timestamp: new Date().toISOString(),
        payload: { runId: 'run-failed' },
      });
      expect(retryScheduler.scheduleRetry).toHaveBeenCalledWith('run-failed');
    });
  });
});
