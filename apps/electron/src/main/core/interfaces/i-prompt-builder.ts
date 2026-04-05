import type { Role, TaskNode, Skill, WakeTrigger } from '../types/domain.types.js';
import type { ConversationWorkflow } from '../types/conversation.types.js';
import type { VoteStats } from './i-discussion.repository.js';

export interface PromptContext {
  role: Role;
  task: TaskNode;
  trigger: WakeTrigger;
  parentRole: Role | null;
  subordinates: Role[];
  peers: Role[];
  skills: Skill[];
  discussionSummary: DiscussionSummary | null;
  /** Child tasks awaiting review (populated when trigger is 'review_requested') */
  childrenAwaitingReview: TaskNode[];
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
}

export interface IPromptBuilder {
  build(context: PromptContext): string;
}
