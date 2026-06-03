import { describe, it, expect, beforeEach } from 'vitest';
import { ConversationOrchestrator } from '@core/modules/orchestrator/orchestrators/conversation.orchestrator';
import { MockEventBus } from '../../helpers/mock-event-bus';
import { MockLogger } from '../../helpers/mock-logger';
import { TEST_ORG_ID } from '../../helpers/fixtures';
import type { IConversationRepository } from '@core/modules/conversation/interfaces/i-conversation.repository';
import type { IPendingWakeRepository } from '@core/modules/orchestrator/interfaces/i-pending-wake.repository';
import type { WakeGateValidator } from '@core/modules/orchestrator/wake-gate.validator';
import type { RunCoordinator } from '@core/modules/orchestrator/run.coordinator';
import type { TaskOrchestrator } from '@core/modules/orchestrator/orchestrators/task.orchestrator';
import type { INotificationService } from '@core/foundation/interfaces/i-notification.service';

describe('ConversationOrchestrator — human-fallback notification', () => {
  let bus: MockEventBus;
  let convRepo: IConversationRepository;
  let pendingWakeRepo: IPendingWakeRepository;
  let wakeGateValidator: WakeGateValidator;
  let runCoordinator: RunCoordinator;
  let taskOrchestrator: TaskOrchestrator;
  let notificationService: INotificationService;
  let send: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    bus = new MockEventBus();
    convRepo = {
      findById: vi.fn().mockReturnValue({ id: 'conv-1', type: 'inquiry' }),
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
    wakeGateValidator = { validate: vi.fn() } as unknown as WakeGateValidator;
    runCoordinator = {
      executeForTask: vi.fn(),
      executeForConversation: vi.fn(),
    } as unknown as RunCoordinator;
    taskOrchestrator = { tryWake: vi.fn() } as unknown as TaskOrchestrator;
    send = vi.fn();
    notificationService = { send } as unknown as NotificationService;

    const orchestrator = new ConversationOrchestrator(
      bus,
      new MockLogger(),
      convRepo,
      pendingWakeRepo,
      wakeGateValidator,
      runCoordinator,
      taskOrchestrator,
      notificationService,
    );
    orchestrator.start();
  });

  it('sends a desktop notification when response-needed has no roleId (human fallback)', () => {
    bus.emit({
      type: 'conversation:response-needed',
      timestamp: new Date().toISOString(),
      payload: { conversationId: 'conv-1', orgId: TEST_ORG_ID, roleId: null },
    });

    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0][0]).toContain('inquiry');
    expect(pendingWakeRepo.create).not.toHaveBeenCalled();
    expect(runCoordinator.executeForConversation).not.toHaveBeenCalled();
  });

  it('uses generic copy for non-inquiry conversations', () => {
    vi.mocked(convRepo.findById).mockReturnValue({ id: 'conv-1', type: 'planning' } as never);

    bus.emit({
      type: 'conversation:response-needed',
      timestamp: new Date().toISOString(),
      payload: { conversationId: 'conv-1', orgId: TEST_ORG_ID, roleId: null },
    });

    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0][0]).toBe('Conversation needs your reply');
  });

  it('does not notify when a respondent role is assigned (normal AI path)', () => {
    vi.mocked(wakeGateValidator.validate).mockReturnValue({ allowed: true });
    vi.mocked(runCoordinator.executeForConversation).mockResolvedValue({ runId: 'r-1', status: 'succeeded' });

    bus.emit({
      type: 'conversation:response-needed',
      timestamp: new Date().toISOString(),
      payload: { conversationId: 'conv-1', orgId: TEST_ORG_ID, roleId: 'role-x' },
    });

    expect(send).not.toHaveBeenCalled();
  });
});
