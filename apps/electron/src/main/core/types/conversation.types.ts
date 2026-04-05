// ─── Conversation Workflow Types ─────────────────────────────────────

export type ConversationWorkflowState =
  | 'waiting_for_reply'
  | 'reply_received'
  | 'resumed'
  | 'resolved'
  | 'escalated'
  | 'timed_out'
  | 'cancelled';

export type RecipientTargetType = 'supervisor' | 'human' | 'role' | 'any';

export type RecipientTarget =
  | { type: 'supervisor' }
  | { type: 'human' }
  | { type: 'role'; roleId: string }
  | { type: 'any' };

// ─── Conversation Workflow Entity ───────────────────────────────────

export interface ConversationWorkflow {
  id: string;
  orgId: string;
  taskNodeId: string;
  discussionGroupId: string;
  askingRoleId: string;
  askingRunId: string;
  askingSessionId: string | null;
  questionMessageId: string;
  replyMessageId: string | null;
  respondentRoleId: string | null;
  respondentType: 'ai' | 'human';
  state: ConversationWorkflowState;
  depth: number;
  parentWorkflowId: string | null;
  priority: number;
  timeoutAt: string | null;
  resolvedAt: string | null;
  auditReason: string | null;
  createdAt: string;
  updatedAt: string;
}

// ─── Routing ────────────────────────────────────────────────────────

export interface RoutingRequest {
  askingRoleId: string;
  orgId: string;
  taskNodeId: string;
  recipientTarget: RecipientTarget;
  questionContent: string;
  conversationDepth: number;
}

export interface RoutingDecision {
  respondentRoleId: string | null;
  respondentType: 'ai' | 'human';
  priority: number;
  auditReason: string;
  wasRewritten: boolean;
}

// ─── State Machine ──────────────────────────────────────────────────

export interface ConversationTransition {
  from: ConversationWorkflowState;
  to: ConversationWorkflowState;
}

export const CONVERSATION_TRANSITIONS: ConversationTransition[] = [
  { from: 'waiting_for_reply', to: 'reply_received' },
  { from: 'waiting_for_reply', to: 'escalated' },
  { from: 'waiting_for_reply', to: 'timed_out' },
  { from: 'waiting_for_reply', to: 'cancelled' },
  { from: 'reply_received', to: 'resumed' },
  { from: 'resumed', to: 'resolved' },
  { from: 'resumed', to: 'escalated' },
];

export function canTransition(
  current: ConversationWorkflowState,
  target: ConversationWorkflowState,
): boolean {
  return CONVERSATION_TRANSITIONS.some(
    (t) => t.from === current && t.to === target,
  );
}

// ─── Context Budget ─────────────────────────────────────────────────

export interface ContextBudgetConfig {
  maxConversationTokens: number;
  truncationStrategy: 'oldest_first' | 'summarize_oldest';
}

// ─── Timeout ────────────────────────────────────────────────────────

export interface TimeoutConfig {
  normalTimeoutMs: number;
  urgentTimeoutMs: number;
  maxEscalationLevels: number;
  scanIntervalMs: number;
}

// ─── Cycle Detection ────────────────────────────────────────────────

export interface CycleCheckResult {
  hasCycle: boolean;
  reason?: string;
  action?: 'force_human' | 'route_to_supervisor' | 'escalate_respondent_parent';
}
