import type {
  Conversation,
  ConversationMessage,
  ConversationState,
  CreateMessageInput,
  PlanningHistoryEntry,
  RespondentType,
} from '../types/conversation.types';

/**
 * Interface for ConversationService — the command + query service for conversation lifecycle.
 * Cross-module callers depend on this interface; composition-root binds the concrete.
 */
export interface IConversationCommandService {
  // ─── Queries ───
  findById(id: string): Conversation | null;
  findByOrgId(orgId: string): Conversation[];
  findActiveByOrgId(orgId: string): Conversation[];
  findByTaskId(taskId: string): Conversation[];
  getMessages(conversationId: string): ConversationMessage[];
  findPlanningHistory(orgId: string): PlanningHistoryEntry[];
  getLatestMessages(conversationId: string, limit: number): ConversationMessage[];

  // ─── Commands ───
  createInquiry(
    orgId: string,
    initiatorRoleId: string,
    taskId: string,
    questionContent: string,
    parentConversationId?: string,
    depth?: number,
    targetRespondentRoleId?: string,
  ): Conversation;
  assignRespondent(
    conversationId: string,
    respondentRoleId: string | null,
    respondentType: RespondentType,
    auditReason: string,
  ): void;
  createPlanning(orgId: string, agentRoleId: string, firstHumanMessage: string): Conversation;
  createPlanningOrAdhoc(
    orgId: string,
    type: 'planning' | 'adhoc',
    initiatorRoleId: string,
    respondentRoleId: string,
    initialMessage: string,
    taskId?: string,
  ): Conversation;
  createPlanReview(
    orgId: string,
    initiatorRoleId: string,
    rootTaskId: string,
    pendingPlanId: string,
    currentVersion: number,
  ): Conversation;
  addMessage(conversationId: string, input: CreateMessageInput): ConversationMessage;
  resolve(conversationId: string): void;
  cancel(conversationId: string): void;
  complete(conversationId: string): void;
  escalate(conversationId: string, newRespondentRoleId: string): void;
  delete(conversationId: string): void;
  updateExternalSessionId(conversationId: string, sessionId: string): void;
}
