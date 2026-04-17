export type ConversationType = 'inquiry' | 'planning' | 'adhoc';
export type ConversationState = 'active' | 'waiting' | 'resolved' | 'escalated' | 'timed_out' | 'cancelled' | 'completed';
export type MessageIntent = 'question' | 'reply' | 'escalation' | 'resolution' | 'general';
export type AuthorType = 'ai' | 'human' | 'system';
export type RespondentType = 'ai' | 'human';

export interface Conversation {
  id: string;
  orgId: string;
  type: ConversationType;
  state: ConversationState;
  initiatorRoleId: string;
  respondentRoleId: string | null;
  respondentType: RespondentType | null;
  taskId: string | null;
  parentConversationId: string | null;
  depth: number;
  priority: number;
  timeoutAt: string | null;
  externalSessionId: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface ConversationMessage {
  id: string;
  conversationId: string;
  authorRoleId: string | null;
  authorType: AuthorType;
  content: string;
  intent: MessageIntent;
  inReplyToMessageId: string | null;
  createdAt: string;
}

export interface CreateConversationInput {
  orgId: string;
  type: ConversationType;
  initiatorRoleId: string;
  respondentRoleId?: string | null;
  respondentType?: RespondentType | null;
  taskId?: string | null;
  parentConversationId?: string | null;
  externalSessionId?: string | null;
  metadata?: Record<string, unknown>;
}

export interface CreateMessageInput {
  conversationId: string;
  authorRoleId: string | null;
  authorType: AuthorType;
  content: string;
  intent: MessageIntent;
  inReplyToMessageId?: string | null;
}

export interface RoutingRequest {
  askingRoleId: string;
  orgId: string;
  taskId: string;
  questionContent: string;
  conversationDepth: number;
}

export interface RoutingDecision {
  respondentRoleId: string | null;
  respondentType: RespondentType;
  priority: number;
  auditReason: string;
}

export interface ConversationTransition {
  from: ConversationState;
  to: ConversationState;
}

export const CONVERSATION_TRANSITIONS: ConversationTransition[] = [
  { from: 'active', to: 'waiting' },
  { from: 'active', to: 'resolved' },
  { from: 'active', to: 'cancelled' },
  { from: 'active', to: 'completed' },
  { from: 'waiting', to: 'resolved' },
  { from: 'waiting', to: 'escalated' },
  { from: 'waiting', to: 'timed_out' },
  { from: 'waiting', to: 'cancelled' },
  { from: 'escalated', to: 'resolved' },
  { from: 'escalated', to: 'cancelled' },
  { from: 'timed_out', to: 'escalated' },
  { from: 'timed_out', to: 'cancelled' },
];
