import { randomUUID } from 'node:crypto';
import { injectable } from 'tsyringe';
import type { ISqliteConnection } from '@core/foundation/interfaces/i-sqlite-connection';
import { NotFoundError } from '@core/foundation/errors/capibara.errors';
import type { IConversationRepository } from '../interfaces/i-conversation.repository';
import type { Conversation, ConversationState, ConversationType, CreateConversationInput } from '../types/conversation.types';
import {
  InquiryMetadataSchema,
  PlanningMetadataSchema,
  AdhocMetadataSchema,
  PlanReviewMetadataSchema,
  emptyMetadataFor,
  parseConversationMetadata,
} from '../types/conversation-metadata.schema';

interface ConvRow {
  id: string;
  org_id: string;
  type: string;
  state: string;
  initiator_role_id: string;
  respondent_role_id: string | null;
  respondent_type: string | null;
  task_id: string | null;
  parent_conversation_id: string | null;
  depth: number;
  priority: number;
  timeout_at: string | null;
  external_session_id: string | null;
  metadata: string;
  created_at: string;
  updated_at: string;
}

function toConversation(row: ConvRow): Conversation {
  const type = row.type as ConversationType;
  const rawMeta: unknown = row.metadata ? JSON.parse(row.metadata) : {};
  const base = {
    id: row.id,
    orgId: row.org_id,
    state: row.state as ConversationState,
    initiatorRoleId: row.initiator_role_id,
    respondentRoleId: row.respondent_role_id,
    respondentType: row.respondent_type as Conversation['respondentType'],
    taskId: row.task_id,
    parentConversationId: row.parent_conversation_id,
    depth: row.depth,
    priority: row.priority,
    timeoutAt: row.timeout_at,
    externalSessionId: row.external_session_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };

  switch (type) {
    case 'inquiry':
      return { ...base, type, metadata: InquiryMetadataSchema.parse(rawMeta) };
    case 'planning':
      return { ...base, type, metadata: PlanningMetadataSchema.parse(rawMeta) };
    case 'adhoc':
      return { ...base, type, metadata: AdhocMetadataSchema.parse(rawMeta) };
    case 'plan_review':
      return { ...base, type, metadata: PlanReviewMetadataSchema.parse(rawMeta) };
  }
}

@injectable()
export class SqliteConversationRepository implements IConversationRepository {
  constructor(private readonly connection: ISqliteConnection) {}

  findById(id: string): Conversation | null {
    const row = this.connection.getDb()
      .prepare('SELECT * FROM conversations WHERE id = ?')
      .get(id) as ConvRow | undefined;
    return row ? toConversation(row) : null;
  }

  findByOrgId(orgId: string): Conversation[] {
    const rows = this.connection.getDb()
      .prepare('SELECT * FROM conversations WHERE org_id = ? ORDER BY created_at DESC')
      .all(orgId) as ConvRow[];
    return rows.map(toConversation);
  }

  findByTaskId(taskId: string): Conversation[] {
    const rows = this.connection.getDb()
      .prepare('SELECT * FROM conversations WHERE task_id = ? ORDER BY created_at DESC')
      .all(taskId) as ConvRow[];
    return rows.map(toConversation);
  }

  findActiveByOrgId(orgId: string): Conversation[] {
    const rows = this.connection.getDb()
      .prepare("SELECT * FROM conversations WHERE org_id = ? AND state IN ('active', 'waiting') ORDER BY created_at DESC")
      .all(orgId) as ConvRow[];
    return rows.map(toConversation);
  }

  findByState(orgId: string, state: ConversationState): Conversation[] {
    const rows = this.connection.getDb()
      .prepare('SELECT * FROM conversations WHERE org_id = ? AND state = ? ORDER BY created_at DESC')
      .all(orgId, state) as ConvRow[];
    return rows.map(toConversation);
  }

  findTimedOutInquiries(): Conversation[] {
    const now = new Date().toISOString();
    const rows = this.connection.getDb()
      .prepare("SELECT * FROM conversations WHERE type = 'inquiry' AND state = 'waiting' AND timeout_at IS NOT NULL AND timeout_at < ?")
      .all(now) as ConvRow[];
    return rows.map(toConversation);
  }

  create(input: CreateConversationInput): Conversation {
    const id = randomUUID();
    const now = new Date().toISOString();
    const metadata = parseConversationMetadata(input.type, input.metadata ?? emptyMetadataFor(input.type));
    this.connection.getDb()
      .prepare(`
        INSERT INTO conversations (id, org_id, type, state, initiator_role_id, respondent_role_id, respondent_type, task_id, parent_conversation_id, external_session_id, metadata, created_at, updated_at)
        VALUES (?, ?, ?, 'active', ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        id, input.orgId, input.type, input.initiatorRoleId,
        input.respondentRoleId ?? null, input.respondentType ?? null,
        input.taskId ?? null, input.parentConversationId ?? null,
        input.externalSessionId ?? null,
        JSON.stringify(metadata),
        now, now,
      );
    return this.findById(id)!;
  }

  updateState(id: string, state: ConversationState): void {
    const now = new Date().toISOString();
    this.connection.getDb()
      .prepare('UPDATE conversations SET state = ?, updated_at = ? WHERE id = ?')
      .run(state, now, id);
  }

  updateRespondent(id: string, respondentRoleId: string | null, respondentType: string): void {
    const now = new Date().toISOString();
    this.connection.getDb()
      .prepare('UPDATE conversations SET respondent_role_id = ?, respondent_type = ?, updated_at = ? WHERE id = ?')
      .run(respondentRoleId, respondentType, now, id);
  }

  updateExternalSessionId(id: string, externalSessionId: string): void {
    const now = new Date().toISOString();
    this.connection.getDb()
      .prepare('UPDATE conversations SET external_session_id = ?, updated_at = ? WHERE id = ?')
      .run(externalSessionId, now, id);
  }

  delete(id: string): void {
    const info = this.connection.getDb()
      .prepare('DELETE FROM conversations WHERE id = ?')
      .run(id);
    if (info.changes === 0) throw new NotFoundError('Conversation', id);
  }
}
