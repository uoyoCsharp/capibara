import type { ConversationMessage, CreateMessageInput } from '../types/conversation.types';

export interface IConversationMessageRepository {
  findById(id: string): ConversationMessage | null;
  findByConversationId(conversationId: string): ConversationMessage[];
  findLatest(conversationId: string, limit: number): ConversationMessage[];
  /** The earliest message authored by a human in a conversation, if any. Used for title derivation. */
  findFirstHuman(conversationId: string): ConversationMessage | null;
  create(input: CreateMessageInput): ConversationMessage;
}
