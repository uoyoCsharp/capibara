import type { Role, TaskNode, TaskType, TaskStatus, Skill, WakeTrigger } from '../types/domain.types.js';
import type { ConversationWorkflow } from '../types/conversation.types.js';
import type { VoteStats } from './i-discussion.repository.js';

/** A decomposition task's deliverable: the child tasks it created. */
export interface DecompositionDeliverable {
  kind: 'decomposition';
  grandchildren: Array<{
    title: string;
    type: TaskType;
    status: TaskStatus;
    assigneeRoleName: string | null;
  }>;
}

/** A leaf task's deliverable: the artifact files it produced. */
export interface LeafDeliverable {
  kind: 'leaf';
  artifactPaths: string[];
}

/** A child task enriched with deliverable context for review scenarios. */
export interface ReviewableChild {
  task: TaskNode;
  assigneeRoleName: string | null;
  deliverable: DecompositionDeliverable | LeafDeliverable;
  workSummary: string | null;
}

export interface PromptContext {
  role: Role;
  task: TaskNode;
  trigger: WakeTrigger;
  parentRole: Role | null;
  subordinates: Role[];
  peers: Role[];
  skills: Skill[];
  discussionSummary: DiscussionSummary | null;
  /** Child tasks awaiting review, enriched with deliverable context (populated when trigger is 'review_requested') */
  childrenAwaitingReview: ReviewableChild[];
  /** Whether the current task has any child tasks (for revision sub-mode detection) */
  hasChildren: boolean;
  /** Conversation context text (populated when trigger is 'discussion_reply' or 'conversation_escalation') */
  conversationContext?: string;
  /** Active conversation workflow (populated for conversation triggers) */
  conversationWorkflow?: ConversationWorkflow;
}

export interface DiscussionSummary {
  groupId: string;
  recentMessages: Array<{ authorName: string; content: string; voteTag: string | null }>;
  voteStats: VoteStats;
  latestReviseFeedback: string | null;
  /** Dispute summary stored by discussion service when dispute is detected */
  disputeSummary: string | null;
}

export interface IPromptBuilder {
  build(context: PromptContext): string;
}
