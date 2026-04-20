import { describe, it, expect, beforeEach } from 'vitest';
import { ConversationContextBuilder } from '@core/modules/conversation/context/conversation-context.builder';
import { TEST_ORG_ID, TEST_ROLE_ID, TEST_TASK_ID } from '../../helpers/fixtures';
import type { IConversationRepository } from '@core/modules/conversation/interfaces/i-conversation.repository';
import type { IConversationMessageRepository } from '@core/modules/conversation/interfaces/i-conversation-message.repository';
import type { Conversation, ConversationMessage } from '@core/modules/conversation/types/conversation.types';

function createConv(overrides?: Partial<Conversation>): Conversation {
  return {
    id: 'conv-1',
    orgId: TEST_ORG_ID,
    type: 'inquiry',
    state: 'waiting',
    initiatorRoleId: TEST_ROLE_ID,
    respondentRoleId: 'role-resp',
    respondentType: 'ai',
    taskId: TEST_TASK_ID,
    parentConversationId: null,
    depth: 1,
    priority: 0,
    timeoutAt: null,
    externalSessionId: 'sess-ext',
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

describe('ConversationContextBuilder', () => {
  let builder: ConversationContextBuilder;
  let convRepo: IConversationRepository;
  let msgRepo: IConversationMessageRepository;

  beforeEach(() => {
    convRepo = {
      findById: vi.fn().mockReturnValue(createConv()),
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
    msgRepo = {
      findById: vi.fn(),
      findByConversationId: vi.fn(),
      findLatest: vi.fn().mockReturnValue([]),
      create: vi.fn(),
    };

    builder = new ConversationContextBuilder(convRepo, msgRepo);
  });

  it('returns null when conversation not found', () => {
    vi.mocked(convRepo.findById).mockReturnValue(null);
    expect(builder.build('nonexistent')).toBeNull();
  });

  it('builds context with conversation fields and empty messages', () => {
    const ctx = builder.build('conv-1');
    expect(ctx).toEqual({
      conversationId: 'conv-1',
      type: 'inquiry',
      state: 'waiting',
      initiatorRoleId: TEST_ROLE_ID,
      respondentRoleId: 'role-resp',
      taskId: TEST_TASK_ID,
      messageHistory: [],
      depth: 1,
      externalSessionId: 'sess-ext',
    });
  });

  it('includes message history mapped correctly', () => {
    const messages = [
      createMsg({ id: 'msg-1', authorRoleId: TEST_ROLE_ID, authorType: 'ai', content: 'Question?', intent: 'question', createdAt: '2026-01-01T00:00:00.000Z' }),
      createMsg({ id: 'msg-2', authorRoleId: 'role-resp', authorType: 'ai', content: 'Answer.', intent: 'reply', createdAt: '2026-01-01T00:01:00.000Z' }),
    ];
    vi.mocked(msgRepo.findLatest).mockReturnValue(messages);

    const ctx = builder.build('conv-1');
    expect(ctx!.messageHistory).toHaveLength(2);
    expect(ctx!.messageHistory[0]).toEqual({
      authorRoleId: TEST_ROLE_ID,
      authorType: 'ai',
      content: 'Question?',
      intent: 'question',
      createdAt: '2026-01-01T00:00:00.000Z',
    });
    expect(ctx!.messageHistory[1].content).toBe('Answer.');
  });

  it('uses default maxMessages of 20', () => {
    builder.build('conv-1');
    expect(msgRepo.findLatest).toHaveBeenCalledWith('conv-1', 20);
  });

  it('respects custom maxMessages parameter', () => {
    builder.build('conv-1', 5);
    expect(msgRepo.findLatest).toHaveBeenCalledWith('conv-1', 5);
  });

  it('handles conversation with null optional fields', () => {
    vi.mocked(convRepo.findById).mockReturnValue(createConv({
      respondentRoleId: null,
      taskId: null,
      externalSessionId: null,
    }));

    const ctx = builder.build('conv-1');
    expect(ctx!.respondentRoleId).toBeNull();
    expect(ctx!.taskId).toBeNull();
    expect(ctx!.externalSessionId).toBeNull();
  });
});
