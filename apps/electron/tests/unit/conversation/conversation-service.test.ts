import { describe, it, expect, beforeEach } from 'vitest';
import { ConversationService } from '@core/modules/conversation/services/conversation.service';
import { MockEventBus } from '../../helpers/mock-event-bus';
import { TEST_ORG_ID, TEST_ROLE_ID, TEST_TASK_ID } from '../../helpers/fixtures';
import type { IConversationRepository } from '@core/modules/conversation/interfaces/i-conversation.repository';
import type { IConversationMessageRepository } from '@core/modules/conversation/interfaces/i-conversation-message.repository';
import type { ConversationEventLogger } from '@core/modules/conversation/persistence/conversation-event.logger';
import type { InquiryRouter } from '@core/modules/conversation/routing/inquiry.router';
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
  let inquiryRouter: InquiryRouter;

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
      create: vi.fn().mockReturnValue(createMsg()),
    };
    eventLogger = {
      log: vi.fn(),
      findByConversationId: vi.fn().mockReturnValue([]),
    } as unknown as ConversationEventLogger;
    eventBus = new MockEventBus();
    inquiryRouter = {
      route: vi.fn().mockReturnValue({
        respondentRoleId: 'role-responder',
        respondentType: 'ai',
        priority: 0,
        auditReason: 'Routed to parent',
      }),
    } as unknown as InquiryRouter;

    service = new ConversationService(convRepo, msgRepo, eventLogger, eventBus, inquiryRouter);
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
    it('creates conversation, routes, transitions to waiting, and emits events', () => {
      vi.mocked(convRepo.findById)
        .mockReturnValueOnce(createConv({ state: 'active' }))
        .mockReturnValue(createConv({ state: 'waiting', respondentRoleId: 'role-responder' }));

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
      expect(inquiryRouter.route).toHaveBeenCalled();
      expect(convRepo.updateRespondent).toHaveBeenCalledWith('conv-1', 'role-responder', 'ai');
      expect(convRepo.updateState).toHaveBeenCalledWith('conv-1', 'waiting');
      eventBus.assertEmitted('conversation:respondent-assigned');
      eventBus.assertEmitted('conversation:response-needed');
      expect(result.respondentRoleId).toBe('role-responder');
    });

    it('does not update respondent when router returns null respondentRoleId', () => {
      vi.mocked(inquiryRouter.route).mockReturnValue({
        respondentRoleId: null,
        respondentType: 'human',
        priority: 10,
        auditReason: 'Human fallback',
      });

      service.createInquiry(TEST_ORG_ID, TEST_ROLE_ID, TEST_TASK_ID, 'Help?');
      expect(convRepo.updateRespondent).not.toHaveBeenCalled();
    });

    it('passes parentConversationId and depth when provided', () => {
      service.createInquiry(TEST_ORG_ID, TEST_ROLE_ID, TEST_TASK_ID, 'Q', 'parent-conv', 2);
      expect(convRepo.create).toHaveBeenCalledWith(expect.objectContaining({
        parentConversationId: 'parent-conv',
      }));
      expect(inquiryRouter.route).toHaveBeenCalledWith(expect.objectContaining({
        conversationDepth: 2,
      }));
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

    it('emits response-needed for human messages on non-inquiry conversations', () => {
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
    it('transitions state and logs event', () => {
      vi.mocked(convRepo.findById).mockReturnValue(createConv({ state: 'active' }));
      service.complete('conv-1');
      expect(convRepo.updateState).toHaveBeenCalledWith('conv-1', 'completed');
      expect(eventLogger.log).toHaveBeenCalledWith('conv-1', 'completed');
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
});
