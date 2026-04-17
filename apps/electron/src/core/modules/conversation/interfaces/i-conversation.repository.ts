import type { Conversation, ConversationState, CreateConversationInput } from '../types/conversation.types';

export interface IConversationRepository {
  findById(id: string): Conversation | null;
  findByOrgId(orgId: string): Conversation[];
  findByTaskId(taskId: string): Conversation[];
  findActiveByOrgId(orgId: string): Conversation[];
  findByState(orgId: string, state: ConversationState): Conversation[];
  findTimedOutInquiries(): Conversation[];
  create(input: CreateConversationInput): Conversation;
  updateState(id: string, state: ConversationState): void;
  updateRespondent(id: string, respondentRoleId: string, respondentType: string): void;
  updateExternalSessionId(id: string, externalSessionId: string): void;
  delete(id: string): void;
}
