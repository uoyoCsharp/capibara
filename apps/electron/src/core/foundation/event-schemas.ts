import { z } from 'zod';
import type { DomainEventMap, DomainEventType } from './events';

// ═══════════════════════════════════════════════════════════════
// Zod schemas mirroring DomainEventMap payloads.
// Used at runtime for Outbox deserialization and (future) IPC.
// ═══════════════════════════════════════════════════════════════

// Organization ─────────────────────────────────────────────────
const OrgCreatedSchema = z.object({ orgId: z.string(), name: z.string() });
const OrgUpdatedSchema = z.object({ orgId: z.string(), changes: z.array(z.string()) });
const OrgDeletedSchema = z.object({ orgId: z.string() });
const RoleCreatedSchema = z.object({ roleId: z.string(), orgId: z.string(), name: z.string() });
const RoleUpdatedSchema = z.object({ roleId: z.string(), orgId: z.string() });
const RoleDeletedSchema = z.object({ roleId: z.string(), orgId: z.string() });

// Task ─────────────────────────────────────────────────────────
const TaskCreatedSchema = z.object({
  taskId: z.string(),
  orgId: z.string(),
  type: z.string(),
  parentId: z.string().nullable(),
});
const TaskStatusChangedSchema = z.object({
  taskId: z.string(),
  orgId: z.string(),
  from: z.string(),
  to: z.string(),
  assigneeRoleId: z.string().nullable(),
});
const TaskApprovalTransitionSchema = z.object({
  taskId: z.string(),
  orgId: z.string(),
  from: z.string(),
  to: z.string(),
});
const TaskAutoApprovedSchema = z.object({
  taskId: z.string(),
  orgId: z.string(),
  roleId: z.string().nullable(),
  from: z.string(),
  via: z.string(),
  to: z.string(),
});
const TaskCompletedSchema = z.object({
  taskId: z.string(),
  orgId: z.string(),
  status: z.string(),
});

// Conversation ─────────────────────────────────────────────────
const ConversationTypeSchema = z.enum(['inquiry', 'planning', 'adhoc', 'plan_review']);
const ConversationCreatedSchema = z.object({
  conversationId: z.string(),
  orgId: z.string(),
  type: ConversationTypeSchema,
});
const ConversationMessageAddedSchema = z.object({
  conversationId: z.string(),
  orgId: z.string(),
  messageId: z.string(),
  authorType: z.enum(['ai', 'human', 'system']),
});
const ConversationResponseNeededSchema = z.object({
  conversationId: z.string(),
  orgId: z.string(),
  roleId: z.string().nullable(),
});
const ConversationNeedsRoutingSchema = z.object({
  conversationId: z.string(),
  orgId: z.string(),
  askingRoleId: z.string(),
  taskId: z.string(),
  conversationDepth: z.number(),
});
const ConversationRespondentAssignedSchema = z.object({
  conversationId: z.string(),
  orgId: z.string(),
  respondentRoleId: z.string().nullable(),
});
const ConversationResolvedSchema = z.object({ conversationId: z.string() });
const ConversationEscalatedSchema = z.object({
  conversationId: z.string(),
  orgId: z.string(),
  newRespondentRoleId: z.string(),
});
const ConversationTimedOutSchema = z.object({ conversationId: z.string(), orgId: z.string() });
const ConversationCancelledSchema = z.object({ conversationId: z.string() });
const ConversationCompletedSchema = z.object({ conversationId: z.string(), orgId: z.string() });

// Run ──────────────────────────────────────────────────────────
const RunLifecycleSchema = z.object({
  runId: z.string(),
  orgId: z.string(),
  roleId: z.string(),
});
const RunWithTokensSchema = RunLifecycleSchema.extend({ tokenCount: z.number() });
const RunFailedSchema = RunWithTokensSchema.extend({ errorMessage: z.string().nullable() });
const RunLogSchema = z.object({
  runId: z.string(),
  stream: z.enum(['stdout', 'stderr']),
  chunk: z.string(),
});
const RunAssistantTextSchema = z.object({ runId: z.string(), text: z.string() });
const RunStatusSchema = z.object({ runId: z.string(), status: z.string() });

// Plan tree ─────────────────────────────────────────────────────
// Strict shape for `plan-tree:submitted` (task-scoped preview/eager).
const PlanTreeNodeSchema: z.ZodType<{
  type: string;
  title: string;
  description: string;
  assigneeRoleId: string;
  children: Array<z.infer<typeof PlanTreeNodeSchema>>;
}> = z.lazy(() =>
  z.object({
    type: z.string().min(1),
    title: z.string().min(1),
    description: z.string().min(1),
    assigneeRoleId: z.string().min(1),
    children: z.array(PlanTreeNodeSchema),
  }),
);

const PlanTreeSubmittedSchema = z.object({
  rootTaskId: z.string().min(1).nullable(),
  sourceConversationId: z.string().min(1).nullable(),
  orgId: z.string().min(1),
  roleId: z.string().min(1),
  mode: z.enum(['preview', 'eager']),
  tree: PlanTreeNodeSchema,
  submittedAt: z.string(),
});
const PlanTreeReadySchema = z.object({
  rootTaskId: z.string().nullable(),
  sourceConversationId: z.string().nullable(),
  orgId: z.string(),
  nodeCount: z.number(),
  maxDepth: z.number(),
});
const PlanTreeDiscardedSchema = z.object({
  rootTaskId: z.string().nullable(),
  sourceConversationId: z.string().nullable(),
  orgId: z.string(),
  reason: z.string().nullable(),
});
const PlanTreeApprovedSchema = z.object({
  rootTaskId: z.string().nullable(),
  sourceConversationId: z.string().nullable(),
  orgId: z.string(),
  nodeCount: z.number(),
});

// ═══════════════════════════════════════════════════════════════
// Master registry — one schema per DomainEventType
// ═══════════════════════════════════════════════════════════════

export const EVENT_SCHEMAS = {
  'org:created': OrgCreatedSchema,
  'org:updated': OrgUpdatedSchema,
  'org:deleted': OrgDeletedSchema,
  'role:created': RoleCreatedSchema,
  'role:updated': RoleUpdatedSchema,
  'role:deleted': RoleDeletedSchema,

  'task:created': TaskCreatedSchema,
  'task:status-changed': TaskStatusChangedSchema,
  'task:entered-approval': TaskApprovalTransitionSchema,
  'task:auto-approved': TaskAutoApprovedSchema,
  'task:approval-confirmed': TaskApprovalTransitionSchema,
  'task:approval-rejected': TaskApprovalTransitionSchema,
  'task:completed': TaskCompletedSchema,

  'conversation:created': ConversationCreatedSchema,
  'conversation:message-added': ConversationMessageAddedSchema,
  'conversation:response-needed': ConversationResponseNeededSchema,
  'conversation:needs-routing': ConversationNeedsRoutingSchema,
  'conversation:respondent-assigned': ConversationRespondentAssignedSchema,
  'conversation:resolved': ConversationResolvedSchema,
  'conversation:escalated': ConversationEscalatedSchema,
  'conversation:timed-out': ConversationTimedOutSchema,
  'conversation:cancelled': ConversationCancelledSchema,
  'conversation:completed': ConversationCompletedSchema,

  'run:queued': RunLifecycleSchema,
  'run:started': RunLifecycleSchema,
  'run:succeeded': RunWithTokensSchema,
  'run:failed': RunFailedSchema,
  'run:cancelled': RunWithTokensSchema,
  'run:log': RunLogSchema,
  'run:assistant-text': RunAssistantTextSchema,
  'run:status': RunStatusSchema,

  'plan-tree:submitted': PlanTreeSubmittedSchema,
  'plan-tree:ready': PlanTreeReadySchema,
  'plan-tree:discarded': PlanTreeDiscardedSchema,
  'plan-tree:approved': PlanTreeApprovedSchema,
} as const satisfies { [K in DomainEventType]: z.ZodType<DomainEventMap[K]> };

export function parseEventPayload<T extends DomainEventType>(
  type: T,
  raw: unknown,
): DomainEventMap[T] {
  return EVENT_SCHEMAS[type].parse(raw) as DomainEventMap[T];
}
