import type {
  DiscussionGroup,
  DiscussionMessage,
  DiscussionStatus,
  VoteTag,
  AuthorType,
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
}
