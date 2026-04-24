export type ConversationType = 'inquiry' | 'planning' | 'adhoc';
export type ConversationState = 'active' | 'waiting' | 'resolved' | 'escalated' | 'timed_out' | 'cancelled' | 'completed';
export type MessageIntent = 'question' | 'reply' | 'escalation' | 'resolution' | 'general';
export type AuthorType = 'ai' | 'human' | 'system';
export type RespondentType = 'ai' | 'human';

import type {
  InquiryMetadata,
  PlanningMetadata,
  AdhocMetadata,
} from './conversation-metadata.schema';

interface ConversationBase {
  id: string;
  orgId: string;
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
  createdAt: string;
  updatedAt: string;
}

export type Conversation =
  | (ConversationBase & { type: 'inquiry'; metadata: InquiryMetadata })
  | (ConversationBase & { type: 'planning'; metadata: PlanningMetadata })
  | (ConversationBase & { type: 'adhoc'; metadata: AdhocMetadata });

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

interface CreateConversationBase {
  orgId: string;
  initiatorRoleId: string;
  respondentRoleId?: string | null;
  respondentType?: RespondentType | null;
  taskId?: string | null;
  parentConversationId?: string | null;
  externalSessionId?: string | null;
}

export type CreateConversationInput =
  | (CreateConversationBase & { type: 'inquiry'; metadata?: Partial<InquiryMetadata> })
  | (CreateConversationBase & { type: 'planning'; metadata?: Partial<PlanningMetadata> })
  | (CreateConversationBase & { type: 'adhoc'; metadata?: Partial<AdhocMetadata> });

export interface CreateMessageInput {
  conversationId: string;
  authorRoleId: string | null;
  authorType: AuthorType;
  content: string;
  intent: MessageIntent;
  inReplyToMessageId?: string | null;
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
