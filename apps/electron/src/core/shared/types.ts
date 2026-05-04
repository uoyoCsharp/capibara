export type DesktopResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: { code: string; message: string } };

export type SectionId =
  | 'dashboard'
  | 'tasks'
  | 'inbox'
  | 'team'
  | 'settings'
  | 'workspace';

export interface OrganizationRecord {
  id: string;
  name: string;
  description: string;
  customInstructions: string;
  status: 'active' | 'paused' | 'archived';
  budgetLimit: number;
  autoStartOnCreate: boolean;
  orgTemplateId: string | null;
  planningRoleId: string | null;
  workspacePath: string;
  createdAt: string;
  updatedAt: string;
}

export interface RoleRecord {
  id: string;
  orgId: string;
  name: string;
  parentId: string | null;
  persona: string;
  knowledgeBaseRefs: string[];
  skillIds: string[];
  canApprove: boolean;
  canDelegate: boolean;
  requiresHumanApproval: boolean;
  consecutiveWakeCount: number;
  isSystemRole: boolean;
  status: 'active' | 'paused' | 'idle';
  createdAt: string;
  updatedAt: string;
}

export interface SkillRecord {
  id: string;
  name: string;
  command: string;
  description: string;
  category: 'analysis' | 'design' | 'implementation' | 'review' | 'test' | 'general';
  source: 'builtin' | 'template' | 'custom';
  orgTemplateId: string | null;
  customPromptContent: string | null;
  createdAt: string;
}

export interface TaskRecord {
  id: string;
  orgId: string;
  parentId: string | null;
  type: string;
  title: string;
  description: string;
  status: string;
  assigneeRoleId: string | null;
  depth: number;
  artifactPaths: string[] | null;
  pausedReason: 'approval' | null;
  planningMode: 'layered' | 'eager' | 'preview';
  createdAt: string;
  updatedAt: string;
}

export interface RunRecord {
  id: string;
  orgId: string;
  taskId: string | null;
  conversationId: string | null;
  roleId: string;
  status: 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled' | 'interrupted';
  wakeReason: string;
  startedAt: string | null;
  finishedAt: string | null;
  costUsd: number;
  tokenCount: number;
  summary: string | null;
  errorMessage: string | null;
  createdAt: string;
}

export interface ConversationRecord {
  id: string;
  orgId: string;
  type: 'inquiry' | 'planning' | 'adhoc' | 'plan_review';
  state: 'active' | 'waiting' | 'resolved' | 'escalated' | 'timed_out' | 'cancelled' | 'completed';
  initiatorRoleId: string;
  respondentRoleId: string | null;
  respondentType: 'ai' | 'human' | null;
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

export interface ConversationMessageRecord {
  id: string;
  conversationId: string;
  authorRoleId: string | null;
  authorType: 'ai' | 'human' | 'system';
  content: string;
  intent: 'question' | 'reply' | 'escalation' | 'resolution' | 'general';
  inReplyToMessageId: string | null;
  createdAt: string;
}

export interface CostSummaryRecord {
  totalTokens: number;
  totalCost: number;
}

export interface PlanDraftNodeRecord {
  type: string;
  title: string;
  description: string;
  assigneeRoleId: string;
  children: PlanDraftNodeRecord[];
}

export interface PendingTreeRecord {
  id: string;
  rootTaskId: string;
  orgId: string;
  roleId: string;
  mode: 'preview' | 'eager';
  tree: PlanDraftNodeRecord;
  submittedAt: string;
  version: number;
  status: 'active' | 'approved' | 'refining' | 'discarded' | 'expired';
  pendingFeedback: string | null;
  conversationId: string | null;
  expiresAt: string;
  reviewedAt: string | null;
}

export type DesktopEvent =
  | { type: 'snapshot:updated' }
  | { type: 'org:changed'; orgId: string }
  | { type: 'role:changed'; orgId: string }
  | { type: 'skill:changed' }
  | { type: 'task:changed'; orgId: string }
  | { type: 'task:entered-approval'; taskId: string; orgId: string }
  | { type: 'run:changed'; orgId: string }
  | { type: 'run:log'; runId: string; stream: string; chunk: string }
  | { type: 'run:assistant-text'; runId: string; text: string }
  | { type: 'run:status'; runId: string; status: string }
  | { type: 'run:completed'; runId: string; orgId: string; status: string; tokenCount: number }
  | { type: 'conversation:changed'; orgId: string }
  | { type: 'conversation:response-needed'; orgId: string; conversationId: string }
  | { type: 'scheduler:paused'; cancelledRunCount: number }
  | { type: 'scheduler:resumed' }
  | { type: 'plan-tree:ready'; orgId: string; rootTaskId: string; nodeCount: number; maxDepth: number }
  | { type: 'plan-tree:discarded'; orgId: string; rootTaskId: string }
  | { type: 'plan-tree:approved'; orgId: string; rootTaskId: string }
  | { type: 'notification'; title: string; body: string }
  | { type: 'settings:locale-changed'; locale: string };
