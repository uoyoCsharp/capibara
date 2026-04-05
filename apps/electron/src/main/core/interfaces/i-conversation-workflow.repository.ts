import type { ConversationWorkflow, ConversationWorkflowState } from '../types/conversation.types.js';

export interface CreateConversationWorkflowInput {
  orgId: string;
  taskNodeId: string;
  discussionGroupId: string;
  askingRoleId: string;
  askingRunId: string;
  askingSessionId: string | null;
  questionMessageId: string;
  respondentRoleId: string | null;
  respondentType: 'ai' | 'human';
  state: ConversationWorkflowState;
  depth: number;
  parentWorkflowId: string | null;
  priority: number;
  timeoutAt: string | null;
  auditReason: string | null;
}

export interface IConversationWorkflowRepository {
  findById(id: string): Promise<ConversationWorkflow | null>;
  findByTaskNodeId(taskNodeId: string): Promise<ConversationWorkflow[]>;
  findActiveByRoleAndTask(roleId: string, taskNodeId: string): Promise<ConversationWorkflow | null>;
  findWaitingByDiscussionGroup(discussionGroupId: string): Promise<ConversationWorkflow | null>;
  findExpiredWorkflows(now: string): Promise<ConversationWorkflow[]>;
  findByOrgId(orgId: string): Promise<ConversationWorkflow[]>;
  findByState(state: ConversationWorkflowState): Promise<ConversationWorkflow[]>;
  findRecentChainByTask(taskNodeId: string, limit: number): Promise<ConversationWorkflow[]>;
  create(input: CreateConversationWorkflowInput): Promise<ConversationWorkflow>;
  updateState(id: string, state: ConversationWorkflowState, auditReason?: string): Promise<void>;
  updateReply(id: string, replyMessageId: string): Promise<void>;
  updateRespondent(id: string, respondentRoleId: string, respondentType: 'ai' | 'human'): Promise<void>;
  resolve(id: string, resolvedAt: string): Promise<void>;
}
