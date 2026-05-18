import { describe, it, expect, beforeEach } from 'vitest';
import { ConversationService } from '@core/modules/conversation/services/conversation.service';
import { InquiryRouter } from '@core/modules/coordination/routing/inquiry.router';
import { ConversationOrchestrator } from '@core/modules/orchestrator/orchestrators/conversation.orchestrator';
import { MockEventBus } from '../helpers/mock-event-bus';
import { MockLogger } from '../helpers/mock-logger';
import type { IConversationRepository } from '@core/modules/conversation/interfaces/i-conversation.repository';
import type { IConversationMessageRepository } from '@core/modules/conversation/interfaces/i-conversation-message.repository';
import type { ConversationEventLogger } from '@core/modules/conversation/persistence/conversation-event.logger';
import type { IRoleRepository } from '@core/modules/organization/interfaces/i-role.repository';
import type { Role } from '@core/modules/organization/types/organization.types';
import type { Conversation, RespondentType } from '@core/modules/conversation/types/conversation.types';
import type { WakeGateValidator } from '@core/modules/orchestrator/wake-gate.validator';
import type { RunCoordinator } from '@core/modules/orchestrator/run.coordinator';
import type { TaskOrchestrator } from '@core/modules/orchestrator/orchestrators/task.orchestrator';
import type { IPendingWakeRepository } from '@core/modules/orchestrator/interfaces/i-pending-wake.repository';

/**
 * End-to-end inquiry flow:
 *   1. AI calls createInquiry → emits conversation:needs-routing
 *   2. InquiryRouter consumes it, reads Organization, calls assignRespondent
 *   3. ConversationService transitions to 'waiting' and emits
 *      conversation:respondent-assigned + conversation:response-needed
 *   4. ConversationOrchestrator picks up response-needed and invokes
 *      RunCoordinator.executeForConversation
 */
describe('Inquiry flow integration', () => {
  let bus: MockEventBus;
  let convRepo: IConversationRepository;
  let roleRepo: IRoleRepository;
  let conversationService: ConversationService;
  let router: InquiryRouter;
  let conversationOrchestrator: ConversationOrchestrator;
  let runCoordinator: RunCoordinator;
  let wakeGateValidator: WakeGateValidator;

  // Tiny in-memory conv store so that assignRespondent + transitions are
  // real (repo writes back) and findById reflects the mutated state.
  function makeConvRepo(): IConversationRepository {
    const store = new Map<string, Conversation>();
    let counter = 0;
    return {
      findById: vi.fn((id: string) => store.get(id) ?? null),
      findByOrgId: vi.fn(() => [...store.values()]),
      findByTaskId: vi.fn(() => []),
      findActiveByOrgId: vi.fn(() => []),
      findByState: vi.fn(() => []),
      findTimedOutInquiries: vi.fn(() => []),
      create: vi.fn((input) => {
        counter++;
        const id = `conv-${counter}`;
        const conv: Conversation = {
          id,
          orgId: input.orgId,
          type: input.type,
          state: 'active',
          initiatorRoleId: input.initiatorRoleId,
          respondentRoleId: input.respondentRoleId ?? null,
          respondentType: (input.respondentType ?? null) as RespondentType | null,
          taskId: input.taskId ?? null,
          parentConversationId: input.parentConversationId ?? null,
          depth: 0,
          priority: 0,
          timeoutAt: null,
          externalSessionId: null,
          metadata: { routingAttempts: 0, escalationPath: [] },
          createdAt: '',
          updatedAt: '',
        } as Conversation;
        store.set(id, conv);
        return conv;
      }),
      updateState: vi.fn((id, state) => {
        const c = store.get(id);
        if (c) store.set(id, { ...c, state });
      }),
      updateRespondent: vi.fn((id, respondentRoleId, respondentType) => {
        const c = store.get(id);
        if (c) store.set(id, { ...c, respondentRoleId, respondentType: respondentType as RespondentType });
      }),
      updateExternalSessionId: vi.fn(),
      delete: vi.fn((id) => store.delete(id)),
    } as unknown as IConversationRepository;
  }

  function makeRoleRepo(roles: Role[]): IRoleRepository {
    const map = new Map(roles.map((r) => [r.id, r]));
    return {
      findById: vi.fn((id: string) => map.get(id) ?? null),
      findByIds: vi.fn(),
      findByOrgId: vi.fn((orgId: string) => roles.filter((r) => r.orgId === orgId)),
      findChildren: vi.fn((parentId: string) => roles.filter((r) => r.parentId === parentId)),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    };
  }

  function role(overrides: Partial<Role> & { id: string }): Role {
    return {
      orgId: 'org-1',
      name: overrides.id,
      parentId: null,
      persona: '',
      knowledgeBaseRefs: [],
      skillIds: [],
      canApprove: false,
      canDelegate: false,
      requiresHumanApproval: false,
      consecutiveWakeCount: 0,
      isSystemRole: false,
      status: 'active',
      createdAt: '',
      updatedAt: '',
      ...overrides,
    };
  }

  beforeEach(() => {
    bus = new MockEventBus();
    const logger = new MockLogger();
    convRepo = makeConvRepo();
    const msgRepo = {
      create: vi.fn().mockImplementation((i) => ({ id: 'msg-1', ...i })),
      findById: vi.fn(),
      findByConversationId: vi.fn(() => []),
      findLatest: vi.fn(() => []),
    } as unknown as IConversationMessageRepository;
    const eventLogger = { log: vi.fn(), findByConversationId: vi.fn(() => []) } as unknown as ConversationEventLogger;

    // Role hierarchy: Tech Lead (parent, active) ← Frontend Dev (child, active)
    roleRepo = makeRoleRepo([
      role({ id: 'role-lead', name: 'Tech Lead', parentId: null }),
      role({ id: 'role-fe', name: 'Frontend Dev', parentId: 'role-lead' }),
    ]);

    conversationService = new ConversationService(convRepo, msgRepo, eventLogger, bus);

    router = new InquiryRouter(roleRepo, conversationService, bus, logger);
    router.start();

    wakeGateValidator = { validate: vi.fn().mockReturnValue({ allowed: true }) } as unknown as WakeGateValidator;
    runCoordinator = {
      executeForTask: vi.fn().mockResolvedValue({ runId: 'r', status: 'succeeded' }),
      executeForConversation: vi.fn().mockResolvedValue({ runId: 'r', status: 'succeeded' }),
    } as unknown as RunCoordinator;
    const taskOrchestrator = { tryWake: vi.fn() } as unknown as TaskOrchestrator;
    const pendingWakeRepo = {
      findById: vi.fn(),
      findByOrgId: vi.fn(),
      findByRoleId: vi.fn(),
      findNext: vi.fn(),
      create: vi.fn(),
      delete: vi.fn(),
      deleteByRoleId: vi.fn(),
    } as unknown as IPendingWakeRepository;

    conversationOrchestrator = new ConversationOrchestrator(
      bus, logger, convRepo, pendingWakeRepo, wakeGateValidator, runCoordinator, taskOrchestrator,
      { send: vi.fn() } as unknown as import('@core/modules/notification/notification.service').NotificationService,
    );
    conversationOrchestrator.start();
  });

  it('routes child → parent and triggers a Run for the parent role', async () => {
    conversationService.createInquiry('org-1', 'role-fe', 'task-1', 'Need guidance on architecture');

    // needs-routing was emitted by createInquiry
    bus.assertEmitted('conversation:needs-routing');

    // InquiryRouter consumed it → called assignRespondent → write-back happened
    const conv = convRepo.findById('conv-1');
    expect(conv?.respondentRoleId).toBe('role-lead');
    expect(conv?.respondentType).toBe('ai');
    expect(conv?.state).toBe('waiting');

    // Follow-up events got published synchronously by MockEventBus
    bus.assertEmitted('conversation:respondent-assigned');
    bus.assertEmitted('conversation:response-needed');

    // ConversationOrchestrator saw response-needed and dispatched a Run
    await vi.waitFor(() => {
      expect(runCoordinator.executeForConversation).toHaveBeenCalledWith(
        'conv-1', 'role-lead', 'org-1', 'en-US',
      );
    });
  });

  it('routes to human fallback when no parent and no active peers', async () => {
    roleRepo = makeRoleRepo([role({ id: 'role-solo' })]);
    // Rebuild router+orchestrator so it uses the new repo (simple rebuild)
    router = new InquiryRouter(roleRepo, conversationService, bus, new MockLogger());
    router.start();

    conversationService.createInquiry('org-1', 'role-solo', 'task-solo', 'Anyone?');

    const conv = convRepo.findById('conv-1');
    expect(conv?.respondentRoleId).toBeNull();
    expect(conv?.respondentType).toBe('human');
    expect(conv?.state).toBe('waiting');

    // response-needed with null roleId → orchestrator should NOT dispatch
    bus.assertEmitted('conversation:response-needed');
    const evt = bus.getLastEmitted('conversation:response-needed');
    expect((evt?.payload as { roleId: string | null }).roleId).toBeNull();
    expect(runCoordinator.executeForConversation).not.toHaveBeenCalled();
  });

  it('routes to human when asking role requires human approval', () => {
    roleRepo = makeRoleRepo([
      role({ id: 'role-lead', name: 'Lead', parentId: null }),
      role({ id: 'role-gated', parentId: 'role-lead', requiresHumanApproval: true }),
    ]);
    router = new InquiryRouter(roleRepo, conversationService, bus, new MockLogger());
    router.start();

    conversationService.createInquiry('org-1', 'role-gated', 'task-x', 'Gated question');

    const conv = convRepo.findById('conv-1');
    expect(conv?.respondentRoleId).toBeNull();
    expect(conv?.respondentType).toBe('human');
  });

  it('gate blocked → no Run dispatched even after respondent assignment', async () => {
    (wakeGateValidator.validate as ReturnType<typeof vi.fn>).mockReturnValue({ allowed: false, reason: 'budget' });

    conversationService.createInquiry('org-1', 'role-fe', 'task-1', 'Q?');

    bus.assertEmitted('conversation:response-needed');
    expect(runCoordinator.executeForConversation).not.toHaveBeenCalled();
  });
});
