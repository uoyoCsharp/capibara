// ─── Organization Status ────────────────────────────────────────────
export type OrgStatus = 'active' | 'paused' | 'archived';

// ─── Role Status ────────────────────────────────────────────────────
export type RoleStatus = 'active' | 'paused' | 'idle';

// ─── Task Types & Status ────────────────────────────────────────────
export type TaskType = 'epic' | 'story' | 'task' | 'subtask' | 'spike' | 'bug' | 'chore';

export type TaskStatus =
  | 'pending'
  | 'in_progress'
  | 'awaiting_review'
  | 'revision'
  | 'approved'
  | 'done'
  | 'blocked'
  | 'cancelled';

// ─── Vote Tags ──────────────────────────────────────────────────────
export type VoteTag = 'APPROVE' | 'REVISE' | 'CONCERN' | 'DELEGATE' | null;

// ─── Discussion ─────────────────────────────────────────────────────
export type DiscussionStatus = 'active' | 'archived';
export type AuthorType = 'ai' | 'human' | 'system';

// ─── Run Status ─────────────────────────────────────────────────────
export type RunStatus =
  | 'queued'
  | 'running'
  | 'succeeded'
  | 'failed'
  | 'cancelled'
  | 'interrupted';

// ─── Wake Triggers ──────────────────────────────────────────────────
export type WakeTrigger =
  | 'task_assigned'
  | 'task_completed'
  | 'review_requested'
  | 'review_approve'
  | 'review_revise'
  | 'review_delegate'
  | 'delegation_completed'
  | 'retry_failed'
  | 'dispute_detected'
  | 'discussion_reply'
  | 'conversation_escalation';

// ─── Conversation ───────────────────────────────────────────────────
export type MessageIntent =
  | 'question'
  | 'reply'
  | 'escalation'
  | 'resolution'
  | 'vote'
  | 'general';

// ─── Skill Source ───────────────────────────────────────────────────
export type SkillSource = 'builtin' | 'template' | 'custom';
export type SkillCategory =
  | 'analysis'
  | 'design'
  | 'implementation'
  | 'review'
  | 'test'
  | 'general';

// ─── Domain Entities ────────────────────────────────────────────────
export interface Organization {
  id: string;
  name: string;
  description: string;
  customInstructions: string;
  status: OrgStatus;
  budgetLimit: number;
  orgTemplateId: string | null;
  workspacePath: string;
  createdAt: string;
  updatedAt: string;
}

export interface Role {
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
  status: RoleStatus;
  createdAt: string;
  updatedAt: string;
}

export interface TaskNode {
  id: string;
  orgId: string;
  parentId: string | null;
  type: TaskType;
  title: string;
  description: string;
  status: TaskStatus;
  assigneeRoleId: string | null;
  depth: number;
  artifactPaths: string[] | null;
  createdAt: string;
  updatedAt: string;
}

export interface DiscussionGroup {
  id: string;
  taskNodeId: string;
  orgId: string;
  status: DiscussionStatus;
  /** Populated after discussion completes; null while active */
  summary: string | null;
  /** Timestamp of last summary generation; null if never summarized */
  lastSummaryAt: string | null;
  currentRound: number;
  reviseCount: number;
  createdAt: string;
  lastMessageAt: string | null;
}

export interface DiscussionMessage {
  id: string;
  groupId: string;
  /** null for system-generated messages */
  authorRoleId: string | null;
  authorType: AuthorType;
  content: string;
  /** null if message has not been voted on yet */
  voteTag: VoteTag;
  reviewRound: number;
  metadata: Record<string, unknown> | null;
  intent: MessageIntent;
  /** null for top-level messages (not a reply) */
  inReplyToMessageId: string | null;
  createdAt: string;
}

export interface Run {
  id: string;
  orgId: string;
  taskNodeId: string;
  roleId: string;
  status: RunStatus;
  trigger: WakeTrigger;
  /** null until run actually begins execution */
  startedAt: string | null;
  /** null while run is still in progress */
  finishedAt: string | null;
  tokenCount: number;
  /** null if run does not support session resumption */
  sessionId: string | null;
  createdAt: string;
}

export interface CostEntry {
  id: string;
  runId: string;
  roleId: string;
  orgId: string;
  tokenCount: number;
  createdAt: string;
}

export interface Narrative {
  id: string;
  orgId: string;
  templateData: Record<string, unknown>;
  renderedText: string;
  generatedAt: string;
}

export interface PendingWake {
  id: string;
  roleId: string;
  orgId: string;
  trigger: WakeTrigger;
  /** null when wake was enqueued without a specific task context */
  taskNodeId: string | null;
  priority: number;
  createdAt: string;
}

export interface Skill {
  id: string;
  name: string;
  command: string;
  description: string;
  category: SkillCategory;
  source: SkillSource;
  orgTemplateId: string | null;
  customPromptContent: string | null;
  createdAt: string;
}

export interface Setting {
  key: string;
  value: string;
}
