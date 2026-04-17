import { injectable } from 'tsyringe';
import type { IConversationRepository } from '../interfaces/i-conversation.repository';
import type { IConversationMessageRepository } from '../interfaces/i-conversation-message.repository';

export interface ConversationContext {
  conversationId: string;
  type: string;
  state: string;
  initiatorRoleId: string;
  respondentRoleId: string | null;
  taskId: string | null;
  messageHistory: Array<{
    authorRoleId: string | null;
    authorType: string;
    content: string;
    intent: string;
    createdAt: string;
  }>;
  depth: number;
  externalSessionId: string | null;
}

@injectable()
export class ConversationContextBuilder {
  constructor(
    private readonly convRepo: IConversationRepository,
    private readonly msgRepo: IConversationMessageRepository,
  ) {}

  build(conversationId: string, maxMessages: number = 20): ConversationContext | null {
    const conv = this.convRepo.findById(conversationId);
    if (!conv) return null;

    const messages = this.msgRepo.findLatest(conversationId, maxMessages);

    return {
      conversationId: conv.id,
      type: conv.type,
      state: conv.state,
      initiatorRoleId: conv.initiatorRoleId,
      respondentRoleId: conv.respondentRoleId,
      taskId: conv.taskId,
      messageHistory: messages.map((m) => ({
        authorRoleId: m.authorRoleId,
        authorType: m.authorType,
        content: m.content,
        intent: m.intent,
        createdAt: m.createdAt,
      })),
      depth: conv.depth,
      externalSessionId: conv.externalSessionId,
    };
  }
}
