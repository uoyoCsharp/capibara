import { randomUUID } from 'node:crypto';
import { injectable, inject } from 'tsyringe';
import type { ConversationWorkflow, ConversationWorkflowState } from '@main/core/types/conversation.types.js';
import { canTransition } from '@main/core/types/conversation.types.js';
import type {
  IConversationWorkflowRepository,
  CreateConversationWorkflowInput,
} from '@main/core/interfaces/i-conversation-workflow.repository.js';
import type { ISqliteConnection } from '@main/core/interfaces/i-sqlite-connection.js';
import { SQLITE_CONNECTION_TOKEN } from '@main/core/tokens.js';

interface WorkflowRow {
  id: string;
  org_id: string;
  task_node_id: string;
  discussion_group_id: string;
  asking_role_id: string;
  asking_run_id: string;
  asking_session_id: string | null;
  question_message_id: string;
  reply_message_id: string | null;
  respondent_role_id: string | null;
  respondent_type: string;
  state: string;
  depth: number;
  parent_workflow_id: string | null;
  priority: number;
  timeout_at: string | null;
  resolved_at: string | null;
  audit_reason: string | null;
  created_at: string;
  updated_at: string;
}

function rowToEntity(row: WorkflowRow): ConversationWorkflow {
  return {
    id: row.id,
    orgId: row.org_id,
    taskNodeId: row.task_node_id,
    discussionGroupId: row.discussion_group_id,
    askingRoleId: row.asking_role_id,
    askingRunId: row.asking_run_id,
    askingSessionId: row.asking_session_id,
    questionMessageId: row.question_message_id,
    replyMessageId: row.reply_message_id,
    respondentRoleId: row.respondent_role_id,
    respondentType: row.respondent_type as ConversationWorkflow['respondentType'],
    state: row.state as ConversationWorkflowState,
    depth: row.depth,
    parentWorkflowId: row.parent_workflow_id,
    priority: row.priority,
    timeoutAt: row.timeout_at,
    resolvedAt: row.resolved_at,
    auditReason: row.audit_reason,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

const TERMINAL_STATES: ConversationWorkflowState[] = ['resolved', 'timed_out', 'cancelled'];

@injectable()
export class SqliteConversationWorkflowRepository implements IConversationWorkflowRepository {
  constructor(
    @inject(SQLITE_CONNECTION_TOKEN) private readonly conn: ISqliteConnection,
  ) {}

  async findById(id: string): Promise<ConversationWorkflow | null> {
    const row = this.conn.getDb()
      .prepare('SELECT * FROM conversation_workflows WHERE id = ?')
      .get(id) as WorkflowRow | undefined;
    return row ? rowToEntity(row) : null;
  }

  async findByTaskNodeId(taskNodeId: string): Promise<ConversationWorkflow[]> {
    const rows = this.conn.getDb()
      .prepare('SELECT * FROM conversation_workflows WHERE task_node_id = ? ORDER BY created_at DESC')
      .all(taskNodeId) as WorkflowRow[];
    return rows.map(rowToEntity);
  }

  async findActiveByRoleAndTask(roleId: string, taskNodeId: string): Promise<ConversationWorkflow | null> {
    const row = this.conn.getDb()
      .prepare(`
        SELECT * FROM conversation_workflows
        WHERE asking_role_id = ? AND task_node_id = ?
          AND state NOT IN ('resolved', 'timed_out', 'cancelled')
        ORDER BY created_at DESC LIMIT 1
      `)
      .get(roleId, taskNodeId) as WorkflowRow | undefined;
    return row ? rowToEntity(row) : null;
  }

  async findWaitingByDiscussionGroup(discussionGroupId: string): Promise<ConversationWorkflow | null> {
    const row = this.conn.getDb()
      .prepare(`
        SELECT * FROM conversation_workflows
        WHERE discussion_group_id = ? AND state = 'waiting_for_reply'
        ORDER BY priority DESC, created_at ASC LIMIT 1
      `)
      .get(discussionGroupId) as WorkflowRow | undefined;
    return row ? rowToEntity(row) : null;
  }

  async findExpiredWorkflows(now: string): Promise<ConversationWorkflow[]> {
    const rows = this.conn.getDb()
      .prepare(`
        SELECT * FROM conversation_workflows
        WHERE state = 'waiting_for_reply' AND timeout_at IS NOT NULL AND timeout_at < ?
      `)
      .all(now) as WorkflowRow[];
    return rows.map(rowToEntity);
  }

  async findByOrgId(orgId: string): Promise<ConversationWorkflow[]> {
    const rows = this.conn.getDb()
      .prepare('SELECT * FROM conversation_workflows WHERE org_id = ? ORDER BY created_at DESC')
      .all(orgId) as WorkflowRow[];
    return rows.map(rowToEntity);
  }

  async findByState(state: ConversationWorkflowState): Promise<ConversationWorkflow[]> {
    const rows = this.conn.getDb()
      .prepare('SELECT * FROM conversation_workflows WHERE state = ? ORDER BY created_at ASC')
      .all(state) as WorkflowRow[];
    return rows.map(rowToEntity);
  }

  async findRecentChainByTask(taskNodeId: string, limit: number): Promise<ConversationWorkflow[]> {
    const rows = this.conn.getDb()
      .prepare(`
        SELECT * FROM conversation_workflows
        WHERE task_node_id = ? AND state NOT IN ('cancelled')
        ORDER BY created_at DESC LIMIT ?
      `)
      .all(taskNodeId, limit) as WorkflowRow[];
    return rows.map(rowToEntity);
  }

  async create(input: CreateConversationWorkflowInput): Promise<ConversationWorkflow> {
    const id = randomUUID();
    const now = new Date().toISOString();

    this.conn.getDb().prepare(`
      INSERT INTO conversation_workflows (
        id, org_id, task_node_id, discussion_group_id,
        asking_role_id, asking_run_id, asking_session_id,
        question_message_id, respondent_role_id, respondent_type,
        state, depth, parent_workflow_id, priority,
        timeout_at, audit_reason, created_at, updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id, input.orgId, input.taskNodeId, input.discussionGroupId,
      input.askingRoleId, input.askingRunId, input.askingSessionId,
      input.questionMessageId, input.respondentRoleId, input.respondentType,
      input.state, input.depth, input.parentWorkflowId, input.priority,
      input.timeoutAt, input.auditReason, now, now,
    );

    return (await this.findById(id))!;
  }

  async updateState(id: string, state: ConversationWorkflowState, auditReason?: string): Promise<void> {
    const current = await this.findById(id);
    if (!current) return;
    if (!canTransition(current.state, state)) {
      throw new Error(`Invalid transition: ${current.state} -> ${state}`);
    }

    const now = new Date().toISOString();
    this.conn.getDb()
      .prepare('UPDATE conversation_workflows SET state = ?, audit_reason = COALESCE(?, audit_reason), updated_at = ? WHERE id = ?')
      .run(state, auditReason ?? null, now, id);
  }

  async updateReply(id: string, replyMessageId: string): Promise<void> {
    const now = new Date().toISOString();
    this.conn.getDb()
      .prepare('UPDATE conversation_workflows SET reply_message_id = ?, state = ?, updated_at = ? WHERE id = ?')
      .run(replyMessageId, 'reply_received' satisfies ConversationWorkflowState, now, id);
  }

  async updateRespondent(id: string, respondentRoleId: string, respondentType: 'ai' | 'human'): Promise<void> {
    const now = new Date().toISOString();
    this.conn.getDb()
      .prepare('UPDATE conversation_workflows SET respondent_role_id = ?, respondent_type = ?, updated_at = ? WHERE id = ?')
      .run(respondentRoleId, respondentType, now, id);
  }

  async resolve(id: string, resolvedAt: string): Promise<void> {
    this.conn.getDb()
      .prepare('UPDATE conversation_workflows SET state = ?, resolved_at = ?, updated_at = ? WHERE id = ?')
      .run('resolved' satisfies ConversationWorkflowState, resolvedAt, resolvedAt, id);
  }
}
