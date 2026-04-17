import { randomUUID } from 'node:crypto';
import { injectable } from 'tsyringe';
import type { ISqliteConnection } from '@core/foundation/interfaces/i-sqlite-connection';
import type { IConversationMessageRepository } from '../interfaces/i-conversation-message.repository';
import type { ConversationMessage, CreateMessageInput } from '../types/conversation.types';

interface MsgRow {
  id: string;
  conversation_id: string;
  author_role_id: string | null;
  author_type: string;
  content: string;
  intent: string;
  in_reply_to_message_id: string | null;
  created_at: string;
}

function toMessage(row: MsgRow): ConversationMessage {
  return {
    id: row.id,
    conversationId: row.conversation_id,
    authorRoleId: row.author_role_id,
    authorType: row.author_type as ConversationMessage['authorType'],
    content: row.content,
    intent: row.intent as ConversationMessage['intent'],
    inReplyToMessageId: row.in_reply_to_message_id,
    createdAt: row.created_at,
  };
}

@injectable()
export class SqliteConversationMessageRepository implements IConversationMessageRepository {
  constructor(private readonly connection: ISqliteConnection) {}

  findById(id: string): ConversationMessage | null {
    const row = this.connection.getDb()
      .prepare('SELECT * FROM conversation_messages WHERE id = ?')
      .get(id) as MsgRow | undefined;
    return row ? toMessage(row) : null;
  }

  findByConversationId(conversationId: string): ConversationMessage[] {
    const rows = this.connection.getDb()
      .prepare('SELECT * FROM conversation_messages WHERE conversation_id = ? ORDER BY created_at')
      .all(conversationId) as MsgRow[];
    return rows.map(toMessage);
  }

  findLatest(conversationId: string, limit: number): ConversationMessage[] {
    const rows = this.connection.getDb()
      .prepare('SELECT * FROM conversation_messages WHERE conversation_id = ? ORDER BY created_at DESC LIMIT ?')
      .all(conversationId, limit) as MsgRow[];
    return rows.map(toMessage).reverse();
  }

  create(input: CreateMessageInput): ConversationMessage {
    const id = randomUUID();
    const now = new Date().toISOString();
    this.connection.getDb()
      .prepare(`
        INSERT INTO conversation_messages (id, conversation_id, author_role_id, author_type, content, intent, in_reply_to_message_id, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(id, input.conversationId, input.authorRoleId, input.authorType, input.content, input.intent, input.inReplyToMessageId ?? null, now);
    return this.findById(id)!;
  }
}
