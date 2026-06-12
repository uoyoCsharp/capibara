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
  // 'user' (default): user/AI initiated, e.g. transition tool, scheduler;
  //                   orchestrators may react (wake assignee, etc.).
  // 'system': RunEngine/bootstrap drove this transition for run-lifecycle
  //          bookkeeping; orchestrators must NOT react to avoid feedback
  //          loops with the run that's already in flight.
  triggeredBy: 'user' | 'system';
}
export interface TaskEnteredApprovalPayload {
  taskId: string;
  orgId: string;
  from: string;
  to: string;
}
export interface TaskAutoApprovedPayload {
  taskId: string;
  orgId: string;
  roleId: string | null;
  from: string;
  via: string;
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

// Task Dependency ────────────────────────────────────────────────
export interface TaskDependencyAddedPayload {
  orgId: string;
  dependentTaskId: string;
  dependencyTaskId: string;
}
export interface TaskDependencyRemovedPayload {
  orgId: string;
  dependencyId: string;
}
export interface TaskDependencyResolvedPayload {
  orgId: string;
  dependentTaskId: string;
  dependencyTaskId: string;
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
export interface ConversationRouteResolvedPayload {
  conversationId: string;
  respondentRoleId: string | null;
  respondentType: 'ai' | 'human';
  auditReason: string;
  eventId: string;
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
export interface ConversationCompletedPayload {
  conversationId: string;
  orgId: string;
}

// Run ──────────────────────────────────────────────────────────
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
export interface RunSuspendedPayload {
  runId: string;
  orgId: string;
  roleId: string;
  tokenCount: number;
  sessionId: string | null;
}
export interface RunResumedPayload {
  runId: string;
  orgId: string;
  roleId: string;
  resumedFromSuspensionId: string;
}
export interface RunToolCallPayload {
  runId: string;
  toolCallId: string;
  title: string;
  status: string;
  kind: string | null;
}

// Plan tree (task-scoped preview/eager decomposition) ────────────
// Strict tree node — validated server-side by plan-tree-tools.
export interface PlanTreeNode {
  type: string;
  title: string;
  description: string;
  assigneeRoleId: string;
  dependsOn?: string[];
  children: PlanTreeNode[];
}

export type PlanTreeMode = 'preview' | 'eager';

/**
 * A tree submission is anchored to exactly one of:
 *   - rootTaskId: task-scoped preview/eager decomposition (existing flow)
 *   - sourceConversationId: conversation-only planning session (conversational planning flow)
 * Exactly one of these fields is non-null.
 */
export interface PlanTreeSubmittedPayload {
  rootTaskId: string | null;
  sourceConversationId: string | null;
  orgId: string;
  roleId: string;
  mode: PlanTreeMode;
  tree: PlanTreeNode;
  submittedAt: string;
}

export interface PlanTreeReadyPayload {
  rootTaskId: string | null;
  sourceConversationId: string | null;
  orgId: string;
  nodeCount: number;
  maxDepth: number;
}

export interface PlanTreeDiscardedPayload {
  rootTaskId: string | null;
  sourceConversationId: string | null;
  orgId: string;
  reason: string | null;
}

export interface PlanTreeApprovedPayload {
  rootTaskId: string | null;
  sourceConversationId: string | null;
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
  'task:auto-approved': TaskAutoApprovedPayload;
  'task:approval-confirmed': TaskApprovalConfirmedPayload;
  'task:approval-rejected': TaskApprovalRejectedPayload;
  'task:completed': TaskCompletedPayload;
  'task:dependency-added': TaskDependencyAddedPayload;
  'task:dependency-removed': TaskDependencyRemovedPayload;
  'task:dependency-resolved': TaskDependencyResolvedPayload;

  // Conversation
  'conversation:created': ConversationCreatedPayload;
  'conversation:message-added': ConversationMessageAddedPayload;
  'conversation:response-needed': ConversationResponseNeededPayload;
  'conversation:needs-routing': ConversationNeedsRoutingPayload;
  'conversation:route-resolved': ConversationRouteResolvedPayload;
  'conversation:respondent-assigned': ConversationRespondentAssignedPayload;
  'conversation:resolved': ConversationResolvedPayload;
  'conversation:escalated': ConversationEscalatedPayload;
  'conversation:timed-out': ConversationTimedOutPayload;
  'conversation:cancelled': ConversationCancelledPayload;
  'conversation:completed': ConversationCompletedPayload;

  // Run
  'run:started': RunStartedPayload;
  'run:succeeded': RunSucceededPayload;
  'run:failed': RunFailedPayload;
  'run:cancelled': RunCancelledPayload;
  'run:log': RunLogPayload;
  'run:assistant-text': RunAssistantTextPayload;
  'run:status': RunStatusPayload;
  'run:suspended': RunSuspendedPayload;
  'run:resumed': RunResumedPayload;
  'run:tool-call': RunToolCallPayload;

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
