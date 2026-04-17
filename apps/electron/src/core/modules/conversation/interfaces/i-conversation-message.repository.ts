import type { ConversationMessage, CreateMessageInput } from '../types/conversation.types';

export interface IConversationMessageRepository {
  findById(id: string): ConversationMessage | null;
  findByConversationId(conversationId: string): ConversationMessage[];
  findLatest(conversationId: string, limit: number): ConversationMessage[];
  create(input: CreateMessageInput): ConversationMessage;
}
