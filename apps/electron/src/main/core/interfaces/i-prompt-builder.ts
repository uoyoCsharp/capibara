import type { Role, TaskNode, Skill } from '../types/domain.types.js';
import type { VoteStats } from './i-discussion.repository.js';

export interface PromptContext {
  role: Role;
  task: TaskNode;
  parentRole: Role | null;
  subordinates: Role[];
  peers: Role[];
  skills: Skill[];
  discussionSummary: DiscussionSummary | null;
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
