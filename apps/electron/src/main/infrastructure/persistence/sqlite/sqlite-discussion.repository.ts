import { randomUUID } from 'node:crypto';
import { injectable, inject } from 'tsyringe';
import type {
  DiscussionGroup,
  DiscussionMessage,
  DiscussionStatus,
} from '@main/core/types/domain.types.js';
import type {
  IDiscussionRepository,
  CreateDiscussionGroupInput,
  PostMessageInput,
  VoteStats,
} from '@main/core/interfaces/i-discussion.repository.js';
import type { ISqliteConnection } from '@main/core/interfaces/i-sqlite-connection.js';
import { SQLITE_CONNECTION_TOKEN } from '@main/core/tokens.js';
import { NotFoundError } from '@main/core/errors/capibara.errors.js';

interface GroupRow {
  id: string;
  task_node_id: string;
  org_id: string;
  status: string;
  summary: string | null;
  last_summary_at: string | null;
  current_round: number;
  revise_count: number;
  created_at: string;
}

interface MessageRow {
  id: string;
  group_id: string;
  author_role_id: string | null;
  author_type: string;
  content: string;
  vote_tag: string | null;
  review_round: number;
  metadata: string | null;
  created_at: string;
}

function groupRowToEntity(row: GroupRow): DiscussionGroup {
  return {
    id: row.id,
    taskNodeId: row.task_node_id,
    orgId: row.org_id,
    status: row.status as DiscussionStatus,
    summary: row.summary,
    lastSummaryAt: row.last_summary_at,
    currentRound: row.current_round ?? 1,
    reviseCount: row.revise_count ?? 0,
    createdAt: row.created_at,
  };
}

function messageRowToEntity(row: MessageRow): DiscussionMessage {
  return {
    id: row.id,
    groupId: row.group_id,
    authorRoleId: row.author_role_id,
    authorType: row.author_type as DiscussionMessage['authorType'],
    content: row.content,
    voteTag: (row.vote_tag as DiscussionMessage['voteTag']) ?? null,
    reviewRound: row.review_round ?? 1,
    metadata: row.metadata ? JSON.parse(row.metadata) as Record<string, unknown> : null,
    createdAt: row.created_at,
  };
}

@injectable()
export class SqliteDiscussionRepository implements IDiscussionRepository {
  constructor(
    @inject(SQLITE_CONNECTION_TOKEN) private readonly conn: ISqliteConnection,
  ) {}

  async findGroupById(id: string): Promise<DiscussionGroup | null> {
    const row = this.conn.getDb()
      .prepare('SELECT * FROM discussion_groups WHERE id = ?')
      .get(id) as GroupRow | undefined;
    return row ? groupRowToEntity(row) : null;
  }

  async findGroupByTaskNodeId(taskNodeId: string): Promise<DiscussionGroup | null> {
    const row = this.conn.getDb()
      .prepare('SELECT * FROM discussion_groups WHERE task_node_id = ?')
      .get(taskNodeId) as GroupRow | undefined;
    return row ? groupRowToEntity(row) : null;
  }

  async findGroupsByOrgId(orgId: string): Promise<DiscussionGroup[]> {
    const rows = this.conn.getDb()
      .prepare('SELECT * FROM discussion_groups WHERE org_id = ? ORDER BY created_at DESC')
      .all(orgId) as GroupRow[];
    return rows.map(groupRowToEntity);
  }

  async createGroup(input: CreateDiscussionGroupInput): Promise<DiscussionGroup> {
    const id = randomUUID();
    const now = new Date().toISOString();

    this.conn.getDb().prepare(`
      INSERT INTO discussion_groups (id, task_node_id, org_id, status, created_at)
      VALUES (?, ?, ?, 'active', ?)
    `).run(id, input.taskNodeId, input.orgId, now);

    return (await this.findGroupById(id))!;
  }

  async updateGroupStatus(id: string, status: DiscussionStatus): Promise<void> {
    const changes = this.conn.getDb()
      .prepare('UPDATE discussion_groups SET status = ? WHERE id = ?')
      .run(status, id);
    if (changes.changes === 0) throw new NotFoundError('DiscussionGroup', id);
  }

  async updateGroupSummary(id: string, summary: string): Promise<void> {
    const now = new Date().toISOString();
    const changes = this.conn.getDb()
      .prepare('UPDATE discussion_groups SET summary = ?, last_summary_at = ? WHERE id = ?')
      .run(summary, now, id);
    if (changes.changes === 0) throw new NotFoundError('DiscussionGroup', id);
  }

  async findMessagesByGroupId(groupId: string): Promise<DiscussionMessage[]> {
    const rows = this.conn.getDb()
      .prepare('SELECT * FROM discussion_messages WHERE group_id = ? ORDER BY created_at')
      .all(groupId) as MessageRow[];
    return rows.map(messageRowToEntity);
  }

  async findRecentMessages(groupId: string, limit: number): Promise<DiscussionMessage[]> {
    const rows = this.conn.getDb()
      .prepare('SELECT * FROM discussion_messages WHERE group_id = ? ORDER BY created_at DESC LIMIT ?')
      .all(groupId, limit) as MessageRow[];
    return rows.reverse().map(messageRowToEntity);
  }

  async postMessage(input: PostMessageInput): Promise<DiscussionMessage> {
    const id = randomUUID();
    const now = new Date().toISOString();
    const reviewRound = input.reviewRound ?? 1;
    const metadata = input.metadata ? JSON.stringify(input.metadata) : null;

    this.conn.getDb().prepare(`
      INSERT INTO discussion_messages (id, group_id, author_role_id, author_type, content, vote_tag, review_round, metadata, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, input.groupId, input.authorRoleId, input.authorType, input.content, input.voteTag, reviewRound, metadata, now);

    const row = this.conn.getDb()
      .prepare('SELECT * FROM discussion_messages WHERE id = ?')
      .get(id) as MessageRow;
    return messageRowToEntity(row);
  }

  async getVoteStats(groupId: string): Promise<VoteStats> {
    const rows = this.conn.getDb()
      .prepare(`
        SELECT vote_tag, COUNT(*) as count
        FROM discussion_messages
        WHERE group_id = ? AND vote_tag IS NOT NULL
        GROUP BY vote_tag
      `)
      .all(groupId) as Array<{ vote_tag: string; count: number }>;

    const stats: VoteStats = { APPROVE: 0, REVISE: 0, CONCERN: 0, DELEGATE: 0 };
    for (const row of rows) {
      if (row.vote_tag in stats) {
        stats[row.vote_tag as keyof VoteStats] = row.count;
      }
    }
    return stats;
  }

  async getVoteStatsForRound(groupId: string, round: number): Promise<VoteStats> {
    const rows = this.conn.getDb()
      .prepare(`
        SELECT vote_tag, COUNT(*) as count
        FROM discussion_messages
        WHERE group_id = ? AND vote_tag IS NOT NULL AND review_round = ?
        GROUP BY vote_tag
      `)
      .all(groupId, round) as Array<{ vote_tag: string; count: number }>;

    const stats: VoteStats = { APPROVE: 0, REVISE: 0, CONCERN: 0, DELEGATE: 0 };
    for (const row of rows) {
      if (row.vote_tag in stats) {
        stats[row.vote_tag as keyof VoteStats] = row.count;
      }
    }
    return stats;
  }

  async incrementRound(groupId: string): Promise<number> {
    const row = this.conn.getDb()
      .prepare('UPDATE discussion_groups SET current_round = current_round + 1 WHERE id = ? RETURNING current_round')
      .get(groupId) as { current_round: number } | undefined;
    return row?.current_round ?? 1;
  }

  async incrementReviseCount(groupId: string): Promise<number> {
    const row = this.conn.getDb()
      .prepare('UPDATE discussion_groups SET revise_count = revise_count + 1 WHERE id = ? RETURNING revise_count')
      .get(groupId) as { revise_count: number } | undefined;
    return row?.revise_count ?? 0;
  }

  async resetReviseCount(groupId: string): Promise<void> {
    this.conn.getDb()
      .prepare('UPDATE discussion_groups SET revise_count = 0 WHERE id = ?')
      .run(groupId);
  }

  async deleteGroupByTaskNodeId(taskNodeId: string): Promise<void> {
    // Delete messages first (child records), then the group
    const group = await this.findGroupByTaskNodeId(taskNodeId);
    if (!group) return;
    this.conn.getDb()
      .prepare('DELETE FROM discussion_messages WHERE group_id = ?')
      .run(group.id);
    this.conn.getDb()
      .prepare('DELETE FROM discussion_groups WHERE id = ?')
      .run(group.id);
  }
}
