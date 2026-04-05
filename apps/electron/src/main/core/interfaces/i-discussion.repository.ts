import type {
  DiscussionGroup,
  DiscussionMessage,
  DiscussionStatus,
  VoteTag,
  AuthorType,
  MessageIntent,
} from '../types/domain.types.js';

export interface CreateDiscussionGroupInput {
  taskNodeId: string;
  orgId: string;
}

export interface PostMessageInput {
  groupId: string;
  authorRoleId: string | null;
  authorType: AuthorType;
  content: string;
  voteTag: VoteTag;
  reviewRound?: number;
  metadata?: Record<string, unknown> | null;
  intent?: MessageIntent;
  inReplyToMessageId?: string | null;
}

export interface VoteStats {
  APPROVE: number;
  REVISE: number;
  CONCERN: number;
  DELEGATE: number;
}

export interface IDiscussionRepository {
  findGroupById(id: string): Promise<DiscussionGroup | null>;
  findGroupByTaskNodeId(taskNodeId: string): Promise<DiscussionGroup | null>;
  findGroupsByOrgId(orgId: string): Promise<DiscussionGroup[]>;
  createGroup(input: CreateDiscussionGroupInput): Promise<DiscussionGroup>;
  updateGroupStatus(id: string, status: DiscussionStatus): Promise<void>;
  updateGroupSummary(id: string, summary: string): Promise<void>;

  findMessagesByGroupId(groupId: string): Promise<DiscussionMessage[]>;
  findRecentMessages(groupId: string, limit: number): Promise<DiscussionMessage[]>;
  postMessage(input: PostMessageInput): Promise<DiscussionMessage>;
  getVoteStats(groupId: string): Promise<VoteStats>;
  getVoteStatsForRound(groupId: string, round: number): Promise<VoteStats>;
  incrementRound(groupId: string): Promise<number>;
  incrementReviseCount(groupId: string): Promise<number>;
  resetReviseCount(groupId: string): Promise<void>;
  deleteGroupByTaskNodeId(taskNodeId: string): Promise<void>;
}
