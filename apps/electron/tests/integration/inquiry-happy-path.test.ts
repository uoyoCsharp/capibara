import { describe, it, expect, beforeEach } from 'vitest';
import { ConversationService } from '@core/modules/conversation/services/conversation.service';
import { InquiryRouter } from '@core/modules/coordination/routing/inquiry.router';
import { ConversationOrchestrator } from '@core/modules/orchestrator/orchestrators/conversation.orchestrator';
import { createConversationTools } from '@core/modules/mcp/handlers/conversation-tools';
import { MockEventBus } from '../helpers/mock-event-bus';
import { MockLogger } from '../helpers/mock-logger';
import type { IConversationRepository } from '@core/modules/conversation/interfaces/i-conversation.repository';
import type { IConversationMessageRepository } from '@core/modules/conversation/interfaces/i-conversation-message.repository';
import type { ConversationEventLogger } from '@core/modules/conversation/persistence/conversation-event.logger';
import type { IRoleRepository } from '@core/modules/organization/interfaces/i-role.repository';
import type { Role } from '@core/modules/organization/types/organization.types';
import type {
  Conversation,
  ConversationMessage,
  CreateMessageInput,
  RespondentType,
} from '@core/modules/conversation/types/conversation.types';
import type { WakeGateValidator } from '@core/modules/orchestrator/wake-gate.validator';
import type { RunCoordinator } from '@core/modules/orchestrator/run.coordinator';
import type { TaskOrchestrator } from '@core/modules/orchestrator/orchestrators/task.orchestrator';
import type { IPendingWakeRepository } from '@core/modules/orchestrator/interfaces/i-pending-wake.repository';

/**
 * Happy-path end-to-end: AI ↔ AI inquiry across the full lifecycle.
 *
 *   step 1  Role-A invokes createInquiry            → conversation:needs-routing
 *   step 2  InquiryRouter picks Role-B (parent)     → assignRespondent
 *   step 3  ConversationService transitions waiting → conversation:respondent-assigned
 *                                                    → conversation:response-needed
 *   step 4  ConversationOrchestrator dispatches Run → RunCoordinator.executeForConversation
 *   step 5  Role-B replies via addMessage(intent='reply')
 *   step 6  Conversation resolved                   → conversation:resolved
 *   step 7  ConversationOrchestrator wakes Role-A   → TaskOrchestrator.tryWake('conversation_reply', taskId)
 *
 * Existing inquiry-flow.test.ts covers steps 1-4. This file pins step 5-7
 * (the part that lets Role-A *continue executing* after the answer arrives).
 */

const ORG = 'org-1';
const TASK = 'task-1';
const ROLE_LEAD = 'role-lead';
const ROLE_FE = 'role-fe';

interface Harness {
  bus: MockEventBus;
  convRepo: IConversationRepository;
  msgStore: ConversationMessage[];
  conversationService: ConversationService;
  router: InquiryRouter;
  conversationOrchestrator: ConversationOrchestrator;
  runCoordinator: RunCoordinator;
  taskOrchestrator: TaskOrchestrator;
  wakeGateValidator: WakeGateValidator;
}

function makeRole(overrides: Partial<Role> & { id: string }): Role {
  return {
    orgId: ORG,
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
    updateExternalSessionId: vi.fn((id, sessionId) => {
      const c = store.get(id);
      if (c) store.set(id, { ...c, externalSessionId: sessionId });
    }),
    delete: vi.fn((id) => store.delete(id)),
  } as unknown as IConversationRepository;
}

function makeMsgRepo(store: ConversationMessage[]): IConversationMessageRepository {
  let mc = 0;
  return {
    create: vi.fn((input: CreateMessageInput) => {
      mc++;
      const msg: ConversationMessage = {
        id: `msg-${mc}`,
        conversationId: input.conversationId,
        authorRoleId: input.authorRoleId,
        authorType: input.authorType,
        content: input.content,
        intent: input.intent,
        inReplyToMessageId: input.inReplyToMessageId ?? null,
        createdAt: '',
      };
      store.push(msg);
      return msg;
    }),
    findById: vi.fn((id: string) => store.find((m) => m.id === id) ?? null),
    findByConversationId: vi.fn((cid: string) => store.filter((m) => m.conversationId === cid)),
    findLatest: vi.fn((cid: string, limit: number) =>
      store.filter((m) => m.conversationId === cid).slice(-limit),
    ),
  } as unknown as IConversationMessageRepository;
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

function buildHarness(): Harness {
  const bus = new MockEventBus();
  const logger = new MockLogger();
  const convRepo = makeConvRepo();
  const msgStore: ConversationMessage[] = [];
  const msgRepo = makeMsgRepo(msgStore);
  const eventLogger = {
    log: vi.fn(),
    findByConversationId: vi.fn(() => []),
  } as unknown as ConversationEventLogger;

  // Hierarchy: Tech Lead (parent) ← Frontend Dev (child).
  // role-fe asks → InquiryRouter routes to its parent role-lead.
  const roleRepo = makeRoleRepo([
    makeRole({ id: ROLE_LEAD, name: 'Tech Lead', parentId: null }),
    makeRole({ id: ROLE_FE, name: 'Frontend Dev', parentId: ROLE_LEAD }),
  ]);

  const conversationService = new ConversationService(convRepo, msgRepo, eventLogger, bus);

  const router = new InquiryRouter(roleRepo, conversationService, bus, logger);
  router.start();

  const wakeGateValidator = {
    validate: vi.fn().mockReturnValue({ allowed: true }),
  } as unknown as WakeGateValidator;

  const runCoordinator = {
    executeForTask: vi.fn().mockResolvedValue({ runId: 'run-task', status: 'succeeded' }),
    executeForConversation: vi.fn().mockResolvedValue({ runId: 'run-conv', status: 'succeeded' }),
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

  const conversationOrchestrator = new ConversationOrchestrator(
    bus,
    logger,
    convRepo,
    pendingWakeRepo,
    wakeGateValidator,
    runCoordinator,
    taskOrchestrator,
  );
  conversationOrchestrator.start();

  return {
    bus,
    convRepo,
    msgStore,
    conversationService,
    router,
    conversationOrchestrator,
    runCoordinator,
    taskOrchestrator,
    wakeGateValidator,
  };
}

describe('Inquiry happy-path end-to-end', () => {
  let h: Harness;

  beforeEach(() => {
    h = buildHarness();
  });

  it('full loop: ask → route → respond → resolve → wake initiator', async () => {
    // ── step 1: Role-A (frontend dev) asks a question ─────────────────────
    const conv = h.conversationService.createInquiry(
      ORG,
      ROLE_FE,
      TASK,
      'Need guidance on architecture',
    );
    expect(conv.id).toBe('conv-1');

    // ── step 2 + 3: router assigned the parent and flipped to waiting ─────
    const stored = h.convRepo.findById('conv-1');
    expect(stored?.respondentRoleId).toBe(ROLE_LEAD);
    expect(stored?.respondentType).toBe('ai');
    expect(stored?.state).toBe('waiting');

    // ── step 4: ConversationOrchestrator dispatched Run for Role-B ────────
    await vi.waitFor(() => {
      expect(h.runCoordinator.executeForConversation).toHaveBeenCalledWith(
        'conv-1',
        ROLE_LEAD,
        ORG,
        'en-US',
      );
    });
    expect(h.runCoordinator.executeForConversation).toHaveBeenCalledTimes(1);

    // ── step 5: Role-B replies via addMessage(intent='reply') ─────────────
    // Mirrors what RunCoordinator does after a successful Run completes.
    h.conversationService.addMessage('conv-1', {
      conversationId: 'conv-1',
      authorRoleId: ROLE_LEAD,
      authorType: 'ai',
      content: 'Use a layered architecture with clear interfaces.',
      intent: 'reply',
    });

    // The reply itself must NOT trigger another Run for Role-B
    // (waiting + ai author + intent=reply → determineResponseNeeded=false).
    expect(h.runCoordinator.executeForConversation).toHaveBeenCalledTimes(1);

    // ── step 6: caller resolves the conversation ──────────────────────────
    h.conversationService.resolve('conv-1');
    expect(h.convRepo.findById('conv-1')?.state).toBe('resolved');
    h.bus.assertEmitted('conversation:resolved');

    // ── step 7: TaskOrchestrator.tryWake fires for the original task ──────
    expect(h.taskOrchestrator.tryWake).toHaveBeenCalledWith(
      ROLE_FE,
      ORG,
      'conversation_reply',
      TASK,
    );

    // ── full event ordering across the loop ───────────────────────────────
    h.bus.assertOrder([
      'conversation:needs-routing',
      'conversation:respondent-assigned',
      'conversation:response-needed',
      'conversation:message-added',
      'conversation:resolved',
    ]);
  });

  it('MCP capibara_ask_question entry produces the same routed inquiry', async () => {
    const tools = createConversationTools(h.conversationService);
    const ask = tools.find((t) => t.name === 'capibara_ask_question');
    expect(ask).toBeDefined();

    const result = await ask!.handler({
      orgId: ORG,
      askingRoleId: ROLE_FE,
      taskId: TASK,
      question: 'Which state library should we standardise on?',
    });

    // The tool returns the freshly-created conversation; by the time it
    // resolves, InquiryRouter has already written the respondent back.
    expect(result).toMatchObject({
      conversationId: 'conv-1',
      respondentRoleId: ROLE_LEAD,
      state: 'waiting',
    });

    // First message recorded as the asker's question
    const msgs = h.msgStore.filter((m) => m.conversationId === 'conv-1');
    expect(msgs).toHaveLength(1);
    expect(msgs[0]).toMatchObject({
      authorRoleId: ROLE_FE,
      authorType: 'ai',
      intent: 'question',
    });

    // And step 4 still kicks in: a Run is dispatched for the respondent
    await vi.waitFor(() => {
      expect(h.runCoordinator.executeForConversation).toHaveBeenCalledWith(
        'conv-1',
        ROLE_LEAD,
        ORG,
        'en-US',
      );
    });
  });

  it('human follow-up on the inquiry routes the response back to the initiator', async () => {
    h.conversationService.createInquiry(ORG, ROLE_FE, TASK, 'Need approval before refactor');

    // Wait for the initial respondent dispatch so we can isolate the next call.
    await vi.waitFor(() => {
      expect(h.runCoordinator.executeForConversation).toHaveBeenCalledTimes(1);
    });
    (h.runCoordinator.executeForConversation as ReturnType<typeof vi.fn>).mockClear();

    // A human jumps in and replies on the inquiry. determineResponseNeeded
    // says 'human author + inquiry' → respond. The target is the *initiator*
    // (the asker) — that is what unblocks Role-A on its original task.
    h.conversationService.addMessage('conv-1', {
      conversationId: 'conv-1',
      authorRoleId: null,
      authorType: 'human',
      content: 'Go ahead, but file a follow-up ticket for tests.',
      intent: 'reply',
    });

    await vi.waitFor(() => {
      expect(h.runCoordinator.executeForConversation).toHaveBeenCalledWith(
        'conv-1',
        ROLE_FE, // the initiator, not the respondent
        ORG,
        'en-US',
      );
    });
  });
});
