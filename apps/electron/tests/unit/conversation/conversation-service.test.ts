import { describe, it, expect, beforeEach } from 'vitest';
import { ConversationService } from '@core/modules/conversation/services/conversation.service';
import { MockEventBus } from '../../helpers/mock-event-bus';
import { TEST_ORG_ID, TEST_ROLE_ID, TEST_TASK_ID } from '../../helpers/fixtures';
import type { IConversationRepository } from '@core/modules/conversation/interfaces/i-conversation.repository';
import type { IConversationMessageRepository } from '@core/modules/conversation/interfaces/i-conversation-message.repository';
import type { ConversationEventLogger } from '@core/modules/conversation/persistence/conversation-event.logger';
import type { Conversation, ConversationMessage } from '@core/modules/conversation/types/conversation.types';

function createConv(overrides?: Partial<Conversation>): Conversation {
  return {
    id: 'conv-1',
    orgId: TEST_ORG_ID,
    type: 'inquiry',
    state: 'active',
    initiatorRoleId: TEST_ROLE_ID,
    respondentRoleId: null,
    respondentType: null,
    taskId: TEST_TASK_ID,
    parentConversationId: null,
    depth: 0,
    priority: 0,
    timeoutAt: null,
    externalSessionId: null,
    metadata: {},
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function createMsg(overrides?: Partial<ConversationMessage>): ConversationMessage {
  return {
    id: 'msg-1',
    conversationId: 'conv-1',
    authorRoleId: TEST_ROLE_ID,
    authorType: 'ai',
    content: 'Hello',
    intent: 'question',
    inReplyToMessageId: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('ConversationService', () => {
  let service: ConversationService;
  let convRepo: IConversationRepository;
  let msgRepo: IConversationMessageRepository;
  let eventLogger: ConversationEventLogger;
  let eventBus: MockEventBus;

  beforeEach(() => {
    convRepo = {
      findById: vi.fn().mockReturnValue(createConv()),
      findByOrgId: vi.fn().mockReturnValue([]),
      findByTaskId: vi.fn().mockReturnValue([]),
      findActiveByOrgId: vi.fn().mockReturnValue([]),
      findByState: vi.fn().mockReturnValue([]),
      findTimedOutInquiries: vi.fn().mockReturnValue([]),
      create: vi.fn().mockReturnValue(createConv()),
      updateState: vi.fn(),
      updateRespondent: vi.fn(),
      updateExternalSessionId: vi.fn(),
      delete: vi.fn(),
    };
    msgRepo = {
      findById: vi.fn(),
      findByConversationId: vi.fn().mockReturnValue([]),
      findLatest: vi.fn().mockReturnValue([]),
      findFirstHuman: vi.fn().mockReturnValue(null),
      create: vi.fn().mockReturnValue(createMsg()),
    };
    eventLogger = {
      log: vi.fn(),
      findByConversationId: vi.fn().mockReturnValue([]),
    } as unknown as ConversationEventLogger;
    eventBus = new MockEventBus();

    service = new ConversationService(convRepo, msgRepo, eventLogger, eventBus);
  });

  describe('findById', () => {
    it('delegates to repository', () => {
      service.findById('conv-1');
      expect(convRepo.findById).toHaveBeenCalledWith('conv-1');
    });
  });

  describe('findByOrgId', () => {
    it('delegates to repository', () => {
      service.findByOrgId(TEST_ORG_ID);
      expect(convRepo.findByOrgId).toHaveBeenCalledWith(TEST_ORG_ID);
    });
  });

  describe('findActiveByOrgId', () => {
    it('delegates to repository', () => {
      service.findActiveByOrgId(TEST_ORG_ID);
      expect(convRepo.findActiveByOrgId).toHaveBeenCalledWith(TEST_ORG_ID);
    });
  });

  describe('getMessages', () => {
    it('delegates to message repository', () => {
      service.getMessages('conv-1');
      expect(msgRepo.findByConversationId).toHaveBeenCalledWith('conv-1');
    });
  });

  describe('getLatestMessages', () => {
    it('delegates with limit', () => {
      service.getLatestMessages('conv-1', 5);
      expect(msgRepo.findLatest).toHaveBeenCalledWith('conv-1', 5);
    });
  });

  describe('createInquiry', () => {
    it('creates conversation, persists the question, and emits needs-routing', () => {
      const result = service.createInquiry(TEST_ORG_ID, TEST_ROLE_ID, TEST_TASK_ID, 'What is this?');

      expect(convRepo.create).toHaveBeenCalledWith(expect.objectContaining({
        orgId: TEST_ORG_ID,
        type: 'inquiry',
        initiatorRoleId: TEST_ROLE_ID,
        taskId: TEST_TASK_ID,
      }));
      expect(msgRepo.create).toHaveBeenCalledWith(expect.objectContaining({
        authorRoleId: TEST_ROLE_ID,
        authorType: 'ai',
        content: 'What is this?',
        intent: 'question',
      }));
      eventBus.assertEmitted('conversation:needs-routing');
      eventBus.assertNotEmitted('conversation:respondent-assigned');
      eventBus.assertNotEmitted('conversation:response-needed');
      expect(convRepo.updateRespondent).not.toHaveBeenCalled();
      expect(result).toBeDefined();
    });

    it('needs-routing payload carries askingRoleId, taskId, and depth', () => {
      service.createInquiry(TEST_ORG_ID, TEST_ROLE_ID, TEST_TASK_ID, 'Q', 'parent-conv', 2);
      expect(convRepo.create).toHaveBeenCalledWith(expect.objectContaining({
        parentConversationId: 'parent-conv',
      }));
      const event = eventBus.getLastEmitted('conversation:needs-routing');
      expect(event?.payload).toEqual(expect.objectContaining({
        conversationId: 'conv-1',
        orgId: TEST_ORG_ID,
        askingRoleId: TEST_ROLE_ID,
        taskId: TEST_TASK_ID,
        conversationDepth: 2,
      }));
    });

    it('defaults conversationDepth to 0 when not provided', () => {
      service.createInquiry(TEST_ORG_ID, TEST_ROLE_ID, TEST_TASK_ID, 'Q');
      const event = eventBus.getLastEmitted('conversation:needs-routing');
      expect(event?.payload).toEqual(expect.objectContaining({ conversationDepth: 0 }));
    });
  });

  describe('assignRespondent', () => {
    it('updates respondent, transitions to waiting, emits both assignment events', () => {
      vi.mocked(convRepo.findById).mockReturnValue(createConv({ state: 'active' }));
      service.assignRespondent('conv-1', 'role-responder', 'ai', 'Routed to parent');

      expect(convRepo.updateRespondent).toHaveBeenCalledWith('conv-1', 'role-responder', 'ai');
      expect(convRepo.updateState).toHaveBeenCalledWith('conv-1', 'waiting');
      eventBus.assertEmitted('conversation:respondent-assigned');
      eventBus.assertEmitted('conversation:response-needed');
    });

    it('accepts null respondentRoleId with human respondentType', () => {
      vi.mocked(convRepo.findById).mockReturnValue(createConv({ state: 'active' }));
      service.assignRespondent('conv-1', null, 'human', 'Human fallback');

      expect(convRepo.updateRespondent).toHaveBeenCalledWith('conv-1', null, 'human');
      const assigned = eventBus.getLastEmitted('conversation:respondent-assigned');
      expect(assigned?.payload).toEqual(expect.objectContaining({ respondentRoleId: null }));
      const needed = eventBus.getLastEmitted('conversation:response-needed');
      expect(needed?.payload).toEqual(expect.objectContaining({ roleId: null }));
    });

    it('throws NotFoundError when conversation does not exist', () => {
      vi.mocked(convRepo.findById).mockReturnValue(null);
      expect(() => service.assignRespondent('missing', 'role-x', 'ai', 'reason')).toThrow();
    });
  });

  describe('createPlanningOrAdhoc', () => {
    it('creates conversation with human message and emits events', () => {
      const conv = createConv({ type: 'planning', respondentRoleId: 'role-resp' });
      vi.mocked(convRepo.create).mockReturnValue(conv);

      const result = service.createPlanningOrAdhoc(TEST_ORG_ID, 'planning', TEST_ROLE_ID, 'role-resp', 'Start planning', TEST_TASK_ID);

      expect(convRepo.create).toHaveBeenCalledWith(expect.objectContaining({
        type: 'planning',
        respondentRoleId: 'role-resp',
        respondentType: 'ai',
      }));
      expect(msgRepo.create).toHaveBeenCalledWith(expect.objectContaining({
        authorRoleId: null,
        authorType: 'human',
        content: 'Start planning',
        intent: 'general',
      }));
      eventBus.assertEmitted('conversation:created');
      eventBus.assertEmitted('conversation:response-needed');
      expect(result).toEqual(conv);
    });
  });

  describe('addMessage', () => {
    it('throws NotFoundError when conversation does not exist', () => {
      vi.mocked(convRepo.findById).mockReturnValue(null);
      expect(() => service.addMessage('nonexistent', {
        conversationId: 'nonexistent',
        authorRoleId: null,
        authorType: 'human',
        content: 'Hi',
        intent: 'general',
      })).toThrow();
    });

    it('creates message and emits message-added event', () => {
      vi.mocked(convRepo.findById).mockReturnValue(createConv({ type: 'adhoc', respondentRoleId: 'role-resp' }));
      const result = service.addMessage('conv-1', {
        conversationId: 'conv-1',
        authorRoleId: null,
        authorType: 'human',
        content: 'Reply',
        intent: 'reply',
      });

      expect(msgRepo.create).toHaveBeenCalled();
      eventBus.assertEmitted('conversation:message-added');
      expect(result.id).toBe('msg-1');
    });

    it('message-added payload contains correct metadata', () => {
      vi.mocked(convRepo.findById).mockReturnValue(createConv({ type: 'adhoc' }));
      service.addMessage('conv-1', {
        conversationId: 'conv-1',
        authorRoleId: null,
        authorType: 'human',
        content: 'Test',
        intent: 'general',
      });

      const event = eventBus.getLastEmitted('conversation:message-added');
      expect(event?.payload).toEqual(expect.objectContaining({
        conversationId: 'conv-1',
        authorType: 'human',
      }));
    });

    // ─── inquiry + human reply ───────────────────────────────────

    it('emits response-needed when human replies to inquiry in waiting state', () => {
      vi.mocked(convRepo.findById).mockReturnValue(createConv({ type: 'inquiry', state: 'waiting', initiatorRoleId: 'role-cto', respondentType: 'human' }));
      service.addMessage('conv-1', {
        conversationId: 'conv-1',
        authorRoleId: null,
        authorType: 'human',
        content: 'Approved with changes',
        intent: 'reply',
      });
      eventBus.assertEmitted('conversation:response-needed');
    });

    it('targets initiatorRoleId when human replies to inquiry', () => {
      vi.mocked(convRepo.findById).mockReturnValue(createConv({ type: 'inquiry', state: 'waiting', initiatorRoleId: 'role-cto', respondentRoleId: null, respondentType: 'human' }));
      service.addMessage('conv-1', {
        conversationId: 'conv-1',
        authorRoleId: null,
        authorType: 'human',
        content: 'Go ahead',
        intent: 'reply',
      });

      const event = eventBus.getLastEmitted('conversation:response-needed');
      expect(event?.payload).toEqual(expect.objectContaining({ roleId: 'role-cto' }));
    });

    it('emits response-needed when human replies to inquiry in active state', () => {
      vi.mocked(convRepo.findById).mockReturnValue(createConv({ type: 'inquiry', state: 'active', initiatorRoleId: 'role-cto', respondentType: 'human' }));
      service.addMessage('conv-1', {
        conversationId: 'conv-1',
        authorRoleId: null,
        authorType: 'human',
        content: 'Rejected',
        intent: 'reply',
      });
      eventBus.assertEmitted('conversation:response-needed');
    });

    it('emits response-needed when human replies to escalated inquiry', () => {
      vi.mocked(convRepo.findById).mockReturnValue(createConv({ type: 'inquiry', state: 'escalated', initiatorRoleId: 'role-pm', respondentType: 'human' }));
      service.addMessage('conv-1', {
        conversationId: 'conv-1',
        authorRoleId: null,
        authorType: 'human',
        content: 'Feedback after escalation',
        intent: 'reply',
      });
      eventBus.assertEmitted('conversation:response-needed');
      const event = eventBus.getLastEmitted('conversation:response-needed');
      expect(event?.payload).toEqual(expect.objectContaining({ roleId: 'role-pm' }));
    });

    // ─── inquiry + ai messages ───────────────────────────────────

    it('emits response-needed for inquiry when ai asks question in waiting state', () => {
      vi.mocked(convRepo.findById).mockReturnValue(createConv({ type: 'inquiry', state: 'waiting', respondentRoleId: 'role-resp' }));
      service.addMessage('conv-1', {
        conversationId: 'conv-1',
        authorRoleId: TEST_ROLE_ID,
        authorType: 'ai',
        content: 'Follow up?',
        intent: 'question',
      });
      eventBus.assertEmitted('conversation:response-needed');
    });

    it('targets respondentRoleId when ai asks question in inquiry', () => {
      vi.mocked(convRepo.findById).mockReturnValue(createConv({ type: 'inquiry', state: 'waiting', respondentRoleId: 'role-resp' }));
      service.addMessage('conv-1', {
        conversationId: 'conv-1',
        authorRoleId: TEST_ROLE_ID,
        authorType: 'ai',
        content: 'Clarify?',
        intent: 'question',
      });

      const event = eventBus.getLastEmitted('conversation:response-needed');
      expect(event?.payload).toEqual(expect.objectContaining({ roleId: 'role-resp' }));
    });

    it('does not emit response-needed for ai reply in inquiry', () => {
      vi.mocked(convRepo.findById).mockReturnValue(createConv({ type: 'inquiry', state: 'waiting' }));
      service.addMessage('conv-1', {
        conversationId: 'conv-1',
        authorRoleId: TEST_ROLE_ID,
        authorType: 'ai',
        content: 'Answer',
        intent: 'reply',
      });
      eventBus.assertNotEmitted('conversation:response-needed');
    });

    it('does not emit response-needed for ai question in active state (not yet routed)', () => {
      vi.mocked(convRepo.findById).mockReturnValue(createConv({ type: 'inquiry', state: 'active', respondentRoleId: 'role-resp' }));
      service.addMessage('conv-1', {
        conversationId: 'conv-1',
        authorRoleId: TEST_ROLE_ID,
        authorType: 'ai',
        content: 'Question?',
        intent: 'question',
      });
      eventBus.assertNotEmitted('conversation:response-needed');
    });

    it('does not emit response-needed for ai general message in inquiry', () => {
      vi.mocked(convRepo.findById).mockReturnValue(createConv({ type: 'inquiry', state: 'waiting' }));
      service.addMessage('conv-1', {
        conversationId: 'conv-1',
        authorRoleId: TEST_ROLE_ID,
        authorType: 'ai',
        content: 'Status update',
        intent: 'general',
      });
      eventBus.assertNotEmitted('conversation:response-needed');
    });

    // ─── non-inquiry conversations ───────────────────────────────

    it('emits response-needed for human messages on adhoc conversations', () => {
      vi.mocked(convRepo.findById).mockReturnValue(createConv({ type: 'adhoc', respondentRoleId: 'role-resp' }));
      service.addMessage('conv-1', {
        conversationId: 'conv-1',
        authorRoleId: null,
        authorType: 'human',
        content: 'Do this',
        intent: 'general',
      });
      eventBus.assertEmitted('conversation:response-needed');
    });

    it('targets respondentRoleId for human messages on adhoc conversations', () => {
      vi.mocked(convRepo.findById).mockReturnValue(createConv({ type: 'adhoc', respondentRoleId: 'role-resp' }));
      service.addMessage('conv-1', {
        conversationId: 'conv-1',
        authorRoleId: null,
        authorType: 'human',
        content: 'Do this',
        intent: 'general',
      });

      const event = eventBus.getLastEmitted('conversation:response-needed');
      expect(event?.payload).toEqual(expect.objectContaining({ roleId: 'role-resp' }));
    });

    it('emits response-needed for human messages on planning conversations', () => {
      vi.mocked(convRepo.findById).mockReturnValue(createConv({ type: 'planning', respondentRoleId: 'role-planner' }));
      service.addMessage('conv-1', {
        conversationId: 'conv-1',
        authorRoleId: null,
        authorType: 'human',
        content: 'Adjust the plan',
        intent: 'reply',
      });
      eventBus.assertEmitted('conversation:response-needed');
      const event = eventBus.getLastEmitted('conversation:response-needed');
      expect(event?.payload).toEqual(expect.objectContaining({ roleId: 'role-planner' }));
    });

    it('does not emit response-needed for ai messages on adhoc conversations', () => {
      vi.mocked(convRepo.findById).mockReturnValue(createConv({ type: 'adhoc', respondentRoleId: 'role-resp' }));
      service.addMessage('conv-1', {
        conversationId: 'conv-1',
        authorRoleId: 'role-resp',
        authorType: 'ai',
        content: 'Done',
        intent: 'reply',
      });
      eventBus.assertNotEmitted('conversation:response-needed');
    });

    // ─── system messages ─────────────────────────────────────────

    it('does not emit response-needed for system messages on inquiry', () => {
      vi.mocked(convRepo.findById).mockReturnValue(createConv({ type: 'inquiry', state: 'waiting' }));
      service.addMessage('conv-1', {
        conversationId: 'conv-1',
        authorRoleId: null,
        authorType: 'system',
        content: 'Timed out',
        intent: 'general',
      });
      eventBus.assertNotEmitted('conversation:response-needed');
    });

    it('does not emit response-needed for system messages on adhoc', () => {
      vi.mocked(convRepo.findById).mockReturnValue(createConv({ type: 'adhoc' }));
      service.addMessage('conv-1', {
        conversationId: 'conv-1',
        authorRoleId: null,
        authorType: 'system',
        content: 'Note',
        intent: 'general',
      });
      eventBus.assertNotEmitted('conversation:response-needed');
    });

    // ─── payload correctness ─────────────────────────────────────

    it('response-needed payload includes conversationId and orgId', () => {
      vi.mocked(convRepo.findById).mockReturnValue(createConv({ type: 'adhoc', orgId: 'org-abc', respondentRoleId: 'role-resp' }));
      service.addMessage('conv-1', {
        conversationId: 'conv-1',
        authorRoleId: null,
        authorType: 'human',
        content: 'Hello',
        intent: 'general',
      });

      const event = eventBus.getLastEmitted('conversation:response-needed');
      expect(event?.payload).toEqual(expect.objectContaining({
        conversationId: 'conv-1',
        orgId: 'org-abc',
        roleId: 'role-resp',
      }));
    });
  });

  describe('resolve', () => {
    it('transitions state and emits resolved event', () => {
      vi.mocked(convRepo.findById).mockReturnValue(createConv({ state: 'active' }));
      service.resolve('conv-1');
      expect(convRepo.updateState).toHaveBeenCalledWith('conv-1', 'resolved');
      expect(eventLogger.log).toHaveBeenCalledWith('conv-1', 'resolved');
      eventBus.assertEmitted('conversation:resolved');
    });

    it('throws on invalid state transition', () => {
      vi.mocked(convRepo.findById).mockReturnValue(createConv({ state: 'completed' }));
      expect(() => service.resolve('conv-1')).toThrow();
    });
  });

  describe('cancel', () => {
    it('transitions state and emits cancelled event', () => {
      vi.mocked(convRepo.findById).mockReturnValue(createConv({ state: 'active' }));
      service.cancel('conv-1');
      expect(convRepo.updateState).toHaveBeenCalledWith('conv-1', 'cancelled');
      eventBus.assertEmitted('conversation:cancelled');
    });
  });

  describe('complete', () => {
    it('transitions state, logs event, and emits completed event', () => {
      vi.mocked(convRepo.findById).mockReturnValue(createConv({ state: 'active' }));
      service.complete('conv-1');
      expect(convRepo.updateState).toHaveBeenCalledWith('conv-1', 'completed');
      expect(eventLogger.log).toHaveBeenCalledWith('conv-1', 'completed');
      eventBus.assertEmitted('conversation:completed');
    });
  });

  describe('escalate', () => {
    it('transitions, updates respondent, and emits event', () => {
      vi.mocked(convRepo.findById).mockReturnValue(createConv({ state: 'waiting' }));
      service.escalate('conv-1', 'role-escalated');
      expect(convRepo.updateState).toHaveBeenCalledWith('conv-1', 'escalated');
      expect(convRepo.updateRespondent).toHaveBeenCalledWith('conv-1', 'role-escalated', 'ai');
      eventBus.assertEmitted('conversation:escalated');
    });

    it('throws when conversation not found', () => {
      vi.mocked(convRepo.findById).mockReturnValue(null);
      expect(() => service.escalate('nonexistent', 'role-x')).toThrow();
    });
  });

  describe('updateExternalSessionId', () => {
    it('delegates to repository', () => {
      service.updateExternalSessionId('conv-1', 'sess-new');
      expect(convRepo.updateExternalSessionId).toHaveBeenCalledWith('conv-1', 'sess-new');
    });
  });

  describe('findPlanningHistory', () => {
    it('returns only planning conversations, newest first', () => {
      vi.mocked(convRepo.findByOrgId).mockReturnValue([
        createConv({ id: 'inq', type: 'inquiry', updatedAt: '2026-01-05T00:00:00.000Z' }),
        createConv({ id: 'plan-old', type: 'planning', updatedAt: '2026-01-01T00:00:00.000Z' }),
        createConv({ id: 'plan-new', type: 'planning', updatedAt: '2026-01-03T00:00:00.000Z' }),
        createConv({ id: 'adhoc', type: 'adhoc', updatedAt: '2026-01-04T00:00:00.000Z' }),
      ]);
      vi.mocked(msgRepo.findByConversationId).mockReturnValue([]);

      const history = service.findPlanningHistory(TEST_ORG_ID);

      expect(history.map((h) => h.id)).toEqual(['plan-new', 'plan-old']);
      expect(convRepo.findByOrgId).toHaveBeenCalledWith(TEST_ORG_ID);
    });

    it('derives the title from the first human message', () => {
      vi.mocked(convRepo.findByOrgId).mockReturnValue([
        createConv({ id: 'plan-1', type: 'planning' }),
      ]);
      vi.mocked(msgRepo.findFirstHuman).mockReturnValue(
        createMsg({ id: 'm1', authorType: 'human', content: 'Build a note-taking app\nwith sync' }),
      );

      const [entry] = service.findPlanningHistory(TEST_ORG_ID);
      expect(entry.title).toBe('Build a note-taking app');
      expect(msgRepo.findFirstHuman).toHaveBeenCalledWith('plan-1');
    });

    it('truncates long titles to 80 chars with an ellipsis', () => {
      const long = 'x'.repeat(120);
      vi.mocked(convRepo.findByOrgId).mockReturnValue([createConv({ id: 'plan-1', type: 'planning' })]);
      vi.mocked(msgRepo.findFirstHuman).mockReturnValue(createMsg({ authorType: 'human', content: long }));

      const [entry] = service.findPlanningHistory(TEST_ORG_ID);
      expect(entry.title).toHaveLength(81); // 80 chars + ellipsis
      expect(entry.title.endsWith('…')).toBe(true);
    });

    it('falls back to an empty title when there is no human message', () => {
      vi.mocked(convRepo.findByOrgId).mockReturnValue([createConv({ id: 'plan-1', type: 'planning' })]);
      vi.mocked(msgRepo.findFirstHuman).mockReturnValue(null);

      const [entry] = service.findPlanningHistory(TEST_ORG_ID);
      expect(entry.title).toBe('');
    });
  });
});
