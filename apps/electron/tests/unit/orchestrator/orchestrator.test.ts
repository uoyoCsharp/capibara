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
import type { IRunRepository } from '@core/modules/execution/interfaces/i-run.repository';
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
  let runRepo: IRunRepository;
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
      hasChildren: vi.fn().mockReturnValue(false),
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
    runRepo = {
      findById: vi.fn(),
      findByOrgId: vi.fn().mockReturnValue([]),
      findByTaskId: vi.fn().mockReturnValue([]),
      findActiveByRoleId: vi.fn(),
      findActiveByOrgId: vi.fn(),
      create: vi.fn(),
      updateStatus: vi.fn(),
      finish: vi.fn(),
      markOrphanedAsInterrupted: vi.fn().mockReturnValue(0),
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
      runRepo,
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
      pendingWakeRepo,
      wakeGateValidator,
      runCoordinator,
      taskOrchestrator,
      { send: vi.fn() } as unknown as import('@core/foundation/interfaces/i-notification.service').INotificationService,
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
        payload: { taskId: TEST_TASK_ID, assigneeRoleId: TEST_ROLE_ID, orgId: TEST_ORG_ID, from: 'pending', to: 'in_progress', triggeredBy: 'user' },
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
        payload: { taskId: TEST_TASK_ID, assigneeRoleId: null, orgId: TEST_ORG_ID, from: 'pending', to: 'in_progress', triggeredBy: 'user' },
      });
      expect(runCoordinator.executeForTask).not.toHaveBeenCalled();
    });

    it('does not wake when task.pausedReason is set', () => {
      vi.mocked(taskRepo.findById).mockReturnValue(taskFixture({ pausedReason: 'approval' }));
      eventBus.emit({
        type: 'task:status-changed',
        timestamp: new Date().toISOString(),
        payload: { taskId: TEST_TASK_ID, assigneeRoleId: TEST_ROLE_ID, orgId: TEST_ORG_ID, from: 'pending', to: 'in_progress', triggeredBy: 'user' },
      });
      expect(runCoordinator.executeForTask).not.toHaveBeenCalled();
    });

    it('queues wake when gate blocks', () => {
      vi.mocked(wakeGateValidator.validate).mockReturnValue({ allowed: false, reason: 'Budget exceeded' });
      eventBus.emit({
        type: 'task:status-changed',
        timestamp: new Date().toISOString(),
        payload: { taskId: TEST_TASK_ID, assigneeRoleId: TEST_ROLE_ID, orgId: TEST_ORG_ID, from: 'pending', to: 'in_progress', triggeredBy: 'user' },
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

  // Preview-tree flow (Bug 3):
  //   AI run succeeds → plan tree submitted → human approves (separate event).
  //   advanceRootAfterDecomposition early-returns if root is already in_progress,
  //   so no task:status-changed fires. Without subscribing to plan-tree:approved,
  //   children materialize but nobody calls scheduleNext — the whole subtree sits
  //   dormant. This test pins the contract: on approve, TaskOrchestrator schedules.
  describe('plan-tree:approved', () => {
    it('calls scheduleNext so the newly-materialized children start running', () => {
      eventBus.emit({
        type: 'plan-tree:approved',
        timestamp: new Date().toISOString(),
        payload: { rootTaskId: TEST_TASK_ID, orgId: TEST_ORG_ID, nodeCount: 10 },
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

    // --------------------------------------------------------------
    // Bug 2 — Conversation wake must be queued, not dropped, when gate blocks
    // --------------------------------------------------------------
    //
    // Scenario: AI-A is executing a run and calls an inquiry tool routed to
    // AI-B. The conversation service emits `conversation:response-needed`
    // while AI-A's run is still active; the org-level wake gate blocks.
    //
    // Today's code just logs and returns — AI-B is NEVER woken, even after
    // AI-A's run ends. The conversation sits in inbox forever.
    //
    // Fix requires ConversationOrchestrator to enqueue a pending wake whose
    // payload carries enough metadata (conversationId + a reason marker) for
    // RunOrchestrator to later dispatch via `executeForConversation`.
    it('enqueues a pending wake when gate blocks (AI→AI inquiry during active run)', () => {
      vi.mocked(wakeGateValidator.validate).mockReturnValue({ allowed: false, reason: 'Active run exists: run-x' });

      eventBus.emit({
        type: 'conversation:response-needed',
        timestamp: new Date().toISOString(),
        payload: { conversationId: 'conv-42', orgId: TEST_ORG_ID, roleId: 'role-respondent' },
      });

      expect(runCoordinator.executeForConversation).not.toHaveBeenCalled();
      expect(pendingWakeRepo.create).toHaveBeenCalledTimes(1);

      // Minimum contract: whatever field the implementation adds to distinguish
      // a conversation wake from a task wake (reason=conversation_inquiry and/or
      // conversationId), it must route to role-respondent in the correct org.
      const createArg = vi.mocked(pendingWakeRepo.create).mock.calls[0]![0];
      expect(createArg).toEqual(
        expect.objectContaining({
          roleId: 'role-respondent',
          orgId: TEST_ORG_ID,
        }),
      );

      const looksLikeConvWake =
        createArg.reason === 'conversation_inquiry' ||
        (createArg as unknown as { conversationId?: string }).conversationId === 'conv-42';
      expect(looksLikeConvWake).toBe(true);
    });

    it('does not enqueue when roleId is null, even if gate would block', () => {
      // Guard: a null respondent means the inquiry isn't ready to route yet.
      // We must not leak ghost pending wakes with no target.
      vi.mocked(wakeGateValidator.validate).mockReturnValue({ allowed: false, reason: 'x' });

      eventBus.emit({
        type: 'conversation:response-needed',
        timestamp: new Date().toISOString(),
        payload: { conversationId: 'conv-null', orgId: TEST_ORG_ID, roleId: null },
      });

      expect(pendingWakeRepo.create).not.toHaveBeenCalled();
      expect(runCoordinator.executeForConversation).not.toHaveBeenCalled();
    });

    it('independent inquiries to different AI respondents each enqueue a distinct wake', () => {
      vi.mocked(wakeGateValidator.validate).mockReturnValue({ allowed: false, reason: 'Active run' });

      eventBus.emit({
        type: 'conversation:response-needed',
        timestamp: new Date().toISOString(),
        payload: { conversationId: 'conv-A', orgId: TEST_ORG_ID, roleId: 'role-B' },
      });
      eventBus.emit({
        type: 'conversation:response-needed',
        timestamp: new Date().toISOString(),
        payload: { conversationId: 'conv-B', orgId: TEST_ORG_ID, roleId: 'role-C' },
      });

      expect(pendingWakeRepo.create).toHaveBeenCalledTimes(2);
      const calls = vi.mocked(pendingWakeRepo.create).mock.calls.map((c) => c[0]);
      expect(calls.map((a) => a.roleId).sort()).toEqual(['role-B', 'role-C']);
    });
  });

  // ==========================================================================
  // drainPendingWakes — conversation variant (Bug 2)
  // ==========================================================================
  //
  // Counterpart to the existing `drainPendingWakes` suite. When a pending
  // wake represents a conversation inquiry (as enqueued by the tests above),
  // RunOrchestrator must dispatch it via `executeForConversation`, not the
  // task path. Otherwise the queued wake is run as a bogus task and the
  // real conversation response never happens.

  describe('drainPendingWakes (conversation variant, Bug 2)', () => {
    const convWake = {
      id: 'cwake-1',
      roleId: 'role-respondent',
      orgId: TEST_ORG_ID,
      reason: 'conversation_inquiry',
      taskId: null,
      // The implementation is expected to add `conversationId` to PendingWake;
      // we include it here so either dispatch strategy (reason-based or
      // field-based) can pick it up.
      conversationId: 'conv-42',
      priority: 0,
      createdAt: new Date().toISOString(),
    } as unknown as ReturnType<typeof pendingWakeRepo.findNext> & { conversationId: string };

    it('drained conversation wake dispatches via executeForConversation, NOT executeForTask', async () => {
      vi.mocked(pendingWakeRepo.findNext).mockReturnValue(convWake);
      vi.mocked(wakeGateValidator.validate).mockReturnValue({ allowed: true });

      eventBus.emit({
        type: 'run:succeeded',
        timestamp: new Date().toISOString(),
        payload: { runId: 'r-prev', orgId: TEST_ORG_ID, roleId: TEST_ROLE_ID, tokenCount: 0 },
      });

      expect(pendingWakeRepo.delete).toHaveBeenCalledWith('cwake-1');

      await vi.waitFor(() => {
        expect(runCoordinator.executeForConversation).toHaveBeenCalledWith(
          'conv-42',
          'role-respondent',
          TEST_ORG_ID,
          'en-US',
        );
      });
      expect(runCoordinator.executeForTask).not.toHaveBeenCalled();
    });

    it('drained conversation wake re-enqueues when gate still blocks', () => {
      vi.mocked(pendingWakeRepo.findNext).mockReturnValue(convWake);
      vi.mocked(wakeGateValidator.validate).mockReturnValue({ allowed: false, reason: 'Role paused' });

      eventBus.emit({
        type: 'run:succeeded',
        timestamp: new Date().toISOString(),
        payload: { runId: 'r-prev', orgId: TEST_ORG_ID, roleId: TEST_ROLE_ID, tokenCount: 0 },
      });

      expect(pendingWakeRepo.delete).toHaveBeenCalledWith('cwake-1');
      expect(pendingWakeRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          roleId: 'role-respondent',
          orgId: TEST_ORG_ID,
          reason: 'conversation_inquiry',
        }),
      );
      expect(runCoordinator.executeForConversation).not.toHaveBeenCalled();
      expect(runCoordinator.executeForTask).not.toHaveBeenCalled();
    });

    it('logs error but does not crash when executeForConversation rejects', async () => {
      vi.mocked(pendingWakeRepo.findNext).mockReturnValue(convWake);
      vi.mocked(wakeGateValidator.validate).mockReturnValue({ allowed: true });
      vi.mocked(runCoordinator.executeForConversation).mockRejectedValue(new Error('boom'));

      expect(() => {
        eventBus.emit({
          type: 'run:succeeded',
          timestamp: new Date().toISOString(),
          payload: { runId: 'r-prev', orgId: TEST_ORG_ID, roleId: TEST_ROLE_ID, tokenCount: 0 },
        });
      }).not.toThrow();

      await vi.waitFor(() => {
        expect(
          logger.logs.some((l) => l.level === 'error' && /pending wake/i.test(l.msg)),
        ).toBe(true);
      });
    });

    it('full round trip: gate blocks inquiry → blocking run ends → drain wakes respondent', async () => {
      // Stage 1: AI-A's run is active, inquiry arrives for AI-B → gate blocks,
      // conversation orchestrator enqueues.
      vi.mocked(wakeGateValidator.validate).mockReturnValue({ allowed: false, reason: 'Active run' });
      eventBus.emit({
        type: 'conversation:response-needed',
        timestamp: new Date().toISOString(),
        payload: { conversationId: 'conv-E2E', orgId: TEST_ORG_ID, roleId: 'role-B' },
      });
      expect(pendingWakeRepo.create).toHaveBeenCalledTimes(1);
      expect(runCoordinator.executeForConversation).not.toHaveBeenCalled();

      // Stage 2: AI-A's run ends; gate now allows. Simulate the queue handing
      // the conversation wake back out of findNext, matching what the
      // orchestrator would have enqueued in stage 1.
      const enqueued = vi.mocked(pendingWakeRepo.create).mock.calls[0]![0];
      vi.mocked(pendingWakeRepo.findNext).mockReturnValue({
        id: 'cwake-E2E',
        roleId: enqueued.roleId,
        orgId: enqueued.orgId,
        reason: enqueued.reason,
        taskId: enqueued.taskId,
        // Pass through whatever conversation identifier the impl chose.
        conversationId:
          (enqueued as unknown as { conversationId?: string }).conversationId ?? 'conv-E2E',
        priority: 0,
        createdAt: new Date().toISOString(),
      } as unknown as ReturnType<typeof pendingWakeRepo.findNext>);
      vi.mocked(wakeGateValidator.validate).mockReturnValue({ allowed: true });

      eventBus.emit({
        type: 'run:succeeded',
        timestamp: new Date().toISOString(),
        payload: { runId: 'run-A', orgId: TEST_ORG_ID, roleId: TEST_ROLE_ID, tokenCount: 0 },
      });

      await vi.waitFor(() => {
        expect(runCoordinator.executeForConversation).toHaveBeenCalledWith(
          'conv-E2E',
          'role-B',
          TEST_ORG_ID,
          'en-US',
        );
      });
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
    it('does not transition tasks — RunEngine is now the sole authority on initial→active', () => {
      const task = taskFixture({ id: 'task-s1' });
      vi.mocked(taskScheduler.findNextTask).mockReturnValue({ task, wakeReason: 'task_scheduled' });

      eventBus.emit({
        type: 'run:succeeded',
        timestamp: new Date().toISOString(),
        payload: { runId: 'r', orgId: TEST_ORG_ID, roleId: TEST_ROLE_ID, tokenCount: 0 },
      });

      expect(taskStateMachine.transition).not.toHaveBeenCalled();
    });

    it('wakes the next schedulable task via runCoordinator (no transition)', async () => {
      const task = taskFixture({ id: 'task-s2' });
      vi.mocked(taskScheduler.findNextTask).mockReturnValue({ task, wakeReason: 'task_scheduled' });

      eventBus.emit({
        type: 'run:succeeded',
        timestamp: new Date().toISOString(),
        payload: { runId: 'r', orgId: TEST_ORG_ID, roleId: TEST_ROLE_ID, tokenCount: 0 },
      });

      await vi.waitFor(() => {
        expect(runCoordinator.executeForTask).toHaveBeenCalledWith(
          'task-s2', TEST_ROLE_ID, TEST_ORG_ID, 'task_scheduled', 'en-US',
        );
      });
      expect(taskStateMachine.transition).not.toHaveBeenCalled();
    });
  });

  describe('wakeReason distinction', () => {
    it('uses reason=task_assigned for unscheduled task', () => {
      eventBus.emit({
        type: 'task:status-changed',
        timestamp: new Date().toISOString(),
        payload: { taskId: 'task-w2', assigneeRoleId: TEST_ROLE_ID, orgId: TEST_ORG_ID, from: 'pending', to: 'in_progress', triggeredBy: 'user' },
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
      conversationId: null,
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

  // ─── resumeInterruptedForOrg ─────────────────────────────────
  describe('resumeInterruptedForOrg', () => {
    beforeEach(() => {
      taskOrchestrator.start();
    });

    it('wakes exactly one task chosen by TaskScheduler priority', () => {
      const scheduledTask = taskFixture({ id: 'task-first', assigneeRoleId: 'role-a' });
      vi.mocked(taskScheduler.findNextTask).mockReturnValue({
        task: scheduledTask,
        wakeReason: 'task_scheduled',
      });

      const result = taskOrchestrator.resumeInterruptedForOrg(TEST_ORG_ID);

      expect(result).toBe(1);
      expect(taskScheduler.findNextTask).toHaveBeenCalledWith(TEST_ORG_ID);
      expect(runCoordinator.executeForTask).toHaveBeenCalledWith(
        'task-first', 'role-a', TEST_ORG_ID, 'task_assigned', 'en-US',
      );
    });

    it('does not bulk-wake all interrupted tasks', () => {
      const scheduledTask = taskFixture({ id: 'task-1', assigneeRoleId: 'role-a' });
      vi.mocked(taskScheduler.findNextTask).mockReturnValue({
        task: scheduledTask,
        wakeReason: 'task_scheduled',
      });

      taskOrchestrator.resumeInterruptedForOrg(TEST_ORG_ID);

      expect(runCoordinator.executeForTask).toHaveBeenCalledTimes(1);
    });

    it('returns 0 when no schedulable task exists', () => {
      vi.mocked(taskScheduler.findNextTask).mockReturnValue(null);

      const result = taskOrchestrator.resumeInterruptedForOrg(TEST_ORG_ID);

      expect(result).toBe(0);
      expect(runCoordinator.executeForTask).not.toHaveBeenCalled();
    });

    it('returns 0 when schedulable task has no assigneeRoleId', () => {
      const noAssignee = taskFixture({ id: 'task-orphan', assigneeRoleId: null });
      vi.mocked(taskScheduler.findNextTask).mockReturnValue({
        task: noAssignee,
        wakeReason: 'task_scheduled',
      });

      const result = taskOrchestrator.resumeInterruptedForOrg(TEST_ORG_ID);

      expect(result).toBe(0);
      expect(runCoordinator.executeForTask).not.toHaveBeenCalled();
    });

    it('queues wake via pending_wakes when gate blocks', () => {
      const scheduledTask = taskFixture({ id: 'task-blocked', assigneeRoleId: 'role-a' });
      vi.mocked(taskScheduler.findNextTask).mockReturnValue({
        task: scheduledTask,
        wakeReason: 'task_scheduled',
      });
      vi.mocked(wakeGateValidator.validate).mockReturnValue({ allowed: false, reason: 'Active run' });

      const result = taskOrchestrator.resumeInterruptedForOrg(TEST_ORG_ID);

      expect(result).toBe(1);
      expect(runCoordinator.executeForTask).not.toHaveBeenCalled();
      expect(pendingWakeRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          roleId: 'role-a',
          orgId: TEST_ORG_ID,
          taskId: 'task-blocked',
        }),
      );
    });
  });
});
