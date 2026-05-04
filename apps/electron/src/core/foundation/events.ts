import type { ConversationType } from '@core/modules/conversation/types/conversation.types';

// ═══════════════════════════════════════════════════════════════
// Per-event payload interfaces
// ═══════════════════════════════════════════════════════════════

// Organization ─────────────────────────────────────────────────
export interface OrgCreatedPayload {
  orgId: string;
  name: string;
}
export interface OrgUpdatedPayload {
  orgId: string;
  changes: string[];
}
export interface OrgDeletedPayload {
  orgId: string;
}
export interface RoleCreatedPayload {
  roleId: string;
  orgId: string;
  name: string;
}
export interface RoleUpdatedPayload {
  roleId: string;
  orgId: string;
}
export interface RoleDeletedPayload {
  roleId: string;
  orgId: string;
}

// Task ─────────────────────────────────────────────────────────
export interface TaskCreatedPayload {
  taskId: string;
  orgId: string;
  type: string;
  parentId: string | null;
}
export interface TaskStatusChangedPayload {
  taskId: string;
  orgId: string;
  from: string;
  to: string;
  assigneeRoleId: string | null;
}
export interface TaskEnteredApprovalPayload {
  taskId: string;
  orgId: string;
  from: string;
  to: string;
}
export interface TaskApprovalConfirmedPayload {
  taskId: string;
  orgId: string;
  from: string;
  to: string;
}
export interface TaskApprovalRejectedPayload {
  taskId: string;
  orgId: string;
  from: string;
  to: string;
}
export interface TaskCompletedPayload {
  taskId: string;
  orgId: string;
  status: string;
}

// Conversation ─────────────────────────────────────────────────
export interface ConversationCreatedPayload {
  conversationId: string;
  orgId: string;
  type: ConversationType;
}
export interface ConversationMessageAddedPayload {
  conversationId: string;
  orgId: string;
  messageId: string;
  authorType: 'ai' | 'human' | 'system';
}
export interface ConversationResponseNeededPayload {
  conversationId: string;
  orgId: string;
  roleId: string | null;
}
export interface ConversationNeedsRoutingPayload {
  conversationId: string;
  orgId: string;
  askingRoleId: string;
  taskId: string;
  conversationDepth: number;
}
export interface ConversationRespondentAssignedPayload {
  conversationId: string;
  orgId: string;
  respondentRoleId: string | null;
}
export interface ConversationResolvedPayload {
  conversationId: string;
}
export interface ConversationEscalatedPayload {
  conversationId: string;
  orgId: string;
  newRespondentRoleId: string;
}
export interface ConversationTimedOutPayload {
  conversationId: string;
  orgId: string;
}
export interface ConversationCancelledPayload {
  conversationId: string;
}

// Run ──────────────────────────────────────────────────────────
export interface RunQueuedPayload {
  runId: string;
  orgId: string;
  roleId: string;
}
export interface RunStartedPayload {
  runId: string;
  orgId: string;
  roleId: string;
}
export interface RunSucceededPayload {
  runId: string;
  orgId: string;
  roleId: string;
  tokenCount: number;
}
export interface RunFailedPayload {
  runId: string;
  orgId: string;
  roleId: string;
  tokenCount: number;
  errorMessage: string | null;
}
export interface RunCancelledPayload {
  runId: string;
  orgId: string;
  roleId: string;
  tokenCount: number;
}
export interface RunLogPayload {
  runId: string;
  stream: 'stdout' | 'stderr';
  chunk: string;
}
export interface RunAssistantTextPayload {
  runId: string;
  text: string;
}
export interface RunStatusPayload {
  runId: string;
  status: string;
}

// Plan tree (task-scoped preview/eager decomposition) ────────────
// Strict tree node — validated server-side by plan-tree-tools.
export interface PlanTreeNode {
  type: string;
  title: string;
  description: string;
  assigneeRoleId: string;
  children: PlanTreeNode[];
}

export type PlanTreeMode = 'preview' | 'eager';

export interface PlanTreeSubmittedPayload {
  rootTaskId: string;
  orgId: string;
  roleId: string;
  mode: PlanTreeMode;
  tree: PlanTreeNode;
  submittedAt: string;
}

export interface PlanTreeReadyPayload {
  rootTaskId: string;
  orgId: string;
  nodeCount: number;
  maxDepth: number;
}

export interface PlanTreeDiscardedPayload {
  rootTaskId: string;
  orgId: string;
  reason: string | null;
}

export interface PlanTreeApprovedPayload {
  rootTaskId: string;
  orgId: string;
  nodeCount: number;
}

// ═══════════════════════════════════════════════════════════════
// DomainEventMap — single source of truth for event type → payload
// ═══════════════════════════════════════════════════════════════

export interface DomainEventMap {
  // Organization
  'org:created': OrgCreatedPayload;
  'org:updated': OrgUpdatedPayload;
  'org:deleted': OrgDeletedPayload;
  'role:created': RoleCreatedPayload;
  'role:updated': RoleUpdatedPayload;
  'role:deleted': RoleDeletedPayload;

  // Task
  'task:created': TaskCreatedPayload;
  'task:status-changed': TaskStatusChangedPayload;
  'task:entered-approval': TaskEnteredApprovalPayload;
  'task:approval-confirmed': TaskApprovalConfirmedPayload;
  'task:approval-rejected': TaskApprovalRejectedPayload;
  'task:completed': TaskCompletedPayload;

  // Conversation
  'conversation:created': ConversationCreatedPayload;
  'conversation:message-added': ConversationMessageAddedPayload;
  'conversation:response-needed': ConversationResponseNeededPayload;
  'conversation:needs-routing': ConversationNeedsRoutingPayload;
  'conversation:respondent-assigned': ConversationRespondentAssignedPayload;
  'conversation:resolved': ConversationResolvedPayload;
  'conversation:escalated': ConversationEscalatedPayload;
  'conversation:timed-out': ConversationTimedOutPayload;
  'conversation:cancelled': ConversationCancelledPayload;

  // Run
  'run:queued': RunQueuedPayload;
  'run:started': RunStartedPayload;
  'run:succeeded': RunSucceededPayload;
  'run:failed': RunFailedPayload;
  'run:cancelled': RunCancelledPayload;
  'run:log': RunLogPayload;
  'run:assistant-text': RunAssistantTextPayload;
  'run:status': RunStatusPayload;

  // Plan tree (task-scoped preview/eager decomposition)
  'plan-tree:submitted': PlanTreeSubmittedPayload;
  'plan-tree:ready': PlanTreeReadyPayload;
  'plan-tree:discarded': PlanTreeDiscardedPayload;
  'plan-tree:approved': PlanTreeApprovedPayload;
}

export type DomainEventType = keyof DomainEventMap;

export interface DomainEvent<T extends DomainEventType = DomainEventType> {
  type: T;
  timestamp: string;
  payload: DomainEventMap[T];
}
