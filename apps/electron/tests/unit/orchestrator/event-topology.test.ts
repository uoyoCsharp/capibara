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
import type { DomainEventType, DomainEventMap } from '@core/foundation/events';

/**
 * Event topology: verifies each DomainEventType has a deterministic handler
 * (or is deliberately ignored by the orchestrators). Emits every event and
 * asserts an expected side effect on one of the three sub-orchestrators.
 *
 * If a new event is added to DomainEventMap, TypeScript will complain about
 * `expectedSideEffect` not being exhaustive.
 */
describe('Event topology — every DomainEventType routes deterministically', () => {
  let bus: MockEventBus;
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

  function taskFixture(): Task {
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
    };
  }

  beforeEach(() => {
    bus = new MockEventBus();
    const logger = new MockLogger();

    taskRepo = {
      findById: vi.fn().mockReturnValue(taskFixture()),
      findByOrgId: vi.fn().mockReturnValue([]),
      findChildren: vi.fn().mockReturnValue([]),
      findByAssigneeRoleId: vi.fn().mockReturnValue([]),
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
      findById: vi.fn().mockReturnValue({
        id: 'conv-1',
        taskId: TEST_TASK_ID,
        initiatorRoleId: TEST_ROLE_ID,
        orgId: TEST_ORG_ID,
      }),
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
      findNext: vi.fn().mockReturnValue(null),
      create: vi.fn(),
      delete: vi.fn(),
      deleteByRoleId: vi.fn(),
    };
    wakeGateValidator = { validate: vi.fn().mockReturnValue({ allowed: true }) } as unknown as WakeGateValidator;
    retryScheduler = { scheduleRetry: vi.fn(), clearRetries: vi.fn() } as unknown as RetryScheduler;
    runCoordinator = {
      executeForTask: vi.fn().mockResolvedValue({ runId: 'r', status: 'succeeded' }),
      executeForConversation: vi.fn().mockResolvedValue({ runId: 'r', status: 'succeeded' }),
    } as unknown as RunCoordinator;
    taskScheduler = { findNextTask: vi.fn().mockReturnValue(null) } as unknown as TaskScheduler;
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
    behaviorEngine = { onStatusEnter: vi.fn(), onChildCompleted: vi.fn() } as unknown as BehaviorEngine;

    const taskOrchestrator = new TaskOrchestrator(
      bus, logger, taskRepo, orgRepo, pendingWakeRepo, wakeGateValidator, runCoordinator,
      taskScheduler, taskStateMachine, processEngine, behaviorEngine,
    );
    const conversationOrchestrator = new ConversationOrchestrator(
      bus, logger, convRepo, wakeGateValidator, runCoordinator, taskOrchestrator,
    );
    const runOrchestrator = new RunOrchestrator(
      bus, logger, pendingWakeRepo, wakeGateValidator, retryScheduler, runCoordinator, taskOrchestrator,
    );

    taskOrchestrator.start();
    conversationOrchestrator.start();
    runOrchestrator.start();
  });

  // Minimum-valid payloads for every event. Kept simple — handlers we care
  // about only read specific fields.
  const payloads: { [K in DomainEventType]: DomainEventMap[K] } = {
    'org:created': { orgId: TEST_ORG_ID, name: 'n' },
    'org:updated': { orgId: TEST_ORG_ID, changes: [] },
    'org:deleted': { orgId: TEST_ORG_ID },
    'role:created': { roleId: TEST_ROLE_ID, orgId: TEST_ORG_ID, name: 'R' },
    'role:updated': { roleId: TEST_ROLE_ID, orgId: TEST_ORG_ID },
    'role:deleted': { roleId: TEST_ROLE_ID, orgId: TEST_ORG_ID },

    'task:created': { taskId: TEST_TASK_ID, orgId: TEST_ORG_ID, type: 'task', parentId: null },
    'task:status-changed': {
      taskId: TEST_TASK_ID, orgId: TEST_ORG_ID, from: 'pending', to: 'in_progress', assigneeRoleId: TEST_ROLE_ID,
    },
    'task:entered-approval': { taskId: TEST_TASK_ID, orgId: TEST_ORG_ID, from: 'a', to: 'awaiting_review' },
    'task:approval-confirmed': { taskId: TEST_TASK_ID, orgId: TEST_ORG_ID, from: 'awaiting_review', to: 'approved' },
    'task:approval-rejected': { taskId: TEST_TASK_ID, orgId: TEST_ORG_ID, from: 'awaiting_review', to: 'revision' },
    'task:completed': { taskId: TEST_TASK_ID, orgId: TEST_ORG_ID, status: 'done' },

    'conversation:created': { conversationId: 'conv-1', orgId: TEST_ORG_ID, type: 'inquiry' },
    'conversation:message-added': { conversationId: 'conv-1', orgId: TEST_ORG_ID, messageId: 'm', authorType: 'ai' },
    'conversation:response-needed': { conversationId: 'conv-1', orgId: TEST_ORG_ID, roleId: TEST_ROLE_ID },
    'conversation:needs-routing': { conversationId: 'conv-1', orgId: TEST_ORG_ID, askingRoleId: TEST_ROLE_ID, taskId: TEST_TASK_ID, conversationDepth: 0 },
    'conversation:respondent-assigned': { conversationId: 'conv-1', orgId: TEST_ORG_ID, respondentRoleId: TEST_ROLE_ID },
    'conversation:resolved': { conversationId: 'conv-1' },
    'conversation:escalated': { conversationId: 'conv-1', orgId: TEST_ORG_ID, newRespondentRoleId: 'r-new' },
    'conversation:timed-out': { conversationId: 'conv-1', orgId: TEST_ORG_ID },
    'conversation:cancelled': { conversationId: 'conv-1' },

    'run:queued': { runId: 'r', orgId: TEST_ORG_ID, roleId: TEST_ROLE_ID },
    'run:started': { runId: 'r', orgId: TEST_ORG_ID, roleId: TEST_ROLE_ID },
    'run:succeeded': { runId: 'r', orgId: TEST_ORG_ID, roleId: TEST_ROLE_ID, tokenCount: 0 },
    'run:failed': { runId: 'r', orgId: TEST_ORG_ID, roleId: TEST_ROLE_ID, tokenCount: 0, errorMessage: null },
    'run:cancelled': { runId: 'r', orgId: TEST_ORG_ID, roleId: TEST_ROLE_ID, tokenCount: 0 },
    'run:log': { runId: 'r', stream: 'stdout', chunk: 'x' },
    'run:assistant-text': { runId: 'r', text: 'x' },
    'run:status': { runId: 'r', status: 'active' },

    'plan:submitted': { conversationId: 'conv-1', orgId: TEST_ORG_ID, roleId: TEST_ROLE_ID, tasks: [], submittedAt: new Date().toISOString() },
    'planning:plan-ready': { conversationId: 'conv-1', orgId: TEST_ORG_ID, taskCount: 0 },
  };

  function emit<T extends DomainEventType>(type: T): void {
    bus.emit({ type, timestamp: new Date().toISOString(), payload: payloads[type] });
  }

  // ─── Task events ──────────────────────────────────────────────

  it('task:created → TaskOrchestrator consults orgRepo for auto-start', () => {
    emit('task:created');
    expect(orgRepo.findById).toHaveBeenCalledWith(TEST_ORG_ID);
  });

  it('task:status-changed → TaskOrchestrator wakes the assignee', async () => {
    emit('task:status-changed');
    await vi.waitFor(() => {
      expect(runCoordinator.executeForTask).toHaveBeenCalled();
    });
  });

  it('task:entered-approval → TaskOrchestrator logs (DB side effect lives in state machine)', () => {
    emit('task:entered-approval');
    // No handler side effect beyond logging — assert that wake-gate & runCoordinator were NOT invoked
    expect(runCoordinator.executeForTask).not.toHaveBeenCalled();
  });

  it('task:approval-confirmed → TaskOrchestrator schedules next', () => {
    emit('task:approval-confirmed');
    expect(taskScheduler.findNextTask).toHaveBeenCalledWith(TEST_ORG_ID);
  });

  it('task:completed → TaskOrchestrator drives behaviorEngine and scheduling', () => {
    emit('task:completed');
    expect(behaviorEngine.onChildCompleted).toHaveBeenCalled();
    expect(taskScheduler.findNextTask).toHaveBeenCalledWith(TEST_ORG_ID);
  });

  it('task:approval-rejected → no orchestrator reaction (state-machine-only event)', () => {
    emit('task:approval-rejected');
    expect(runCoordinator.executeForTask).not.toHaveBeenCalled();
    expect(taskScheduler.findNextTask).not.toHaveBeenCalled();
  });

  // ─── Conversation events ──────────────────────────────────────

  it('conversation:response-needed → ConversationOrchestrator dispatches Run', async () => {
    emit('conversation:response-needed');
    await vi.waitFor(() => {
      expect(runCoordinator.executeForConversation).toHaveBeenCalled();
    });
  });

  it('conversation:resolved → ConversationOrchestrator wakes initiator through TaskOrchestrator', async () => {
    emit('conversation:resolved');
    await vi.waitFor(() => {
      expect(runCoordinator.executeForTask).toHaveBeenCalledWith(
        TEST_TASK_ID, TEST_ROLE_ID, TEST_ORG_ID, 'conversation_reply', 'en-US',
      );
    });
  });

  it('conversation:needs-routing → NOT handled by orchestrators (routed by InquiryRouter in coordination)', () => {
    emit('conversation:needs-routing');
    expect(runCoordinator.executeForTask).not.toHaveBeenCalled();
    expect(runCoordinator.executeForConversation).not.toHaveBeenCalled();
  });

  it.each([
    'conversation:created',
    'conversation:message-added',
    'conversation:respondent-assigned',
    'conversation:escalated',
    'conversation:timed-out',
    'conversation:cancelled',
  ] as const)('%s → orchestrators do not react (UI-facing event)', (type) => {
    emit(type);
    expect(runCoordinator.executeForTask).not.toHaveBeenCalled();
    expect(runCoordinator.executeForConversation).not.toHaveBeenCalled();
  });

  // ─── Run events ───────────────────────────────────────────────

  it('run:failed → RunOrchestrator retries and drains', () => {
    emit('run:failed');
    expect(retryScheduler.scheduleRetry).toHaveBeenCalledWith('r');
    expect(pendingWakeRepo.findNext).toHaveBeenCalledWith(TEST_ORG_ID);
    expect(taskScheduler.findNextTask).toHaveBeenCalledWith(TEST_ORG_ID);
  });

  it('run:succeeded → RunOrchestrator drains and schedules', () => {
    emit('run:succeeded');
    expect(pendingWakeRepo.findNext).toHaveBeenCalledWith(TEST_ORG_ID);
    expect(taskScheduler.findNextTask).toHaveBeenCalledWith(TEST_ORG_ID);
  });

  it('run:cancelled → RunOrchestrator drains and schedules', () => {
    emit('run:cancelled');
    expect(pendingWakeRepo.findNext).toHaveBeenCalledWith(TEST_ORG_ID);
    expect(taskScheduler.findNextTask).toHaveBeenCalledWith(TEST_ORG_ID);
  });

  it.each(['run:queued', 'run:started', 'run:log', 'run:assistant-text', 'run:status'] as const)(
    '%s → no orchestrator reaction (lifecycle / streaming only)',
    (type) => {
      emit(type);
      expect(retryScheduler.scheduleRetry).not.toHaveBeenCalled();
    },
  );

  // ─── Org / Role / Planning events ─────────────────────────────

  it.each([
    'org:created', 'org:updated', 'org:deleted',
    'role:created', 'role:updated', 'role:deleted',
    'plan:submitted', 'planning:plan-ready',
  ] as const)('%s → no orchestrator reaction (consumed elsewhere)', (type) => {
    emit(type);
    expect(runCoordinator.executeForTask).not.toHaveBeenCalled();
    expect(runCoordinator.executeForConversation).not.toHaveBeenCalled();
    expect(retryScheduler.scheduleRetry).not.toHaveBeenCalled();
  });
});
