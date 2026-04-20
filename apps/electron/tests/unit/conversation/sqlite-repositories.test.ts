import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SQLITE_SKIP_REASON } from '../../helpers/test-db';

let Database: typeof import('better-sqlite3').default;
let canUseSqlite = false;

try {
  Database = (await import('better-sqlite3')).default;
  new Database(':memory:');
  canUseSqlite = true;
} catch {
  canUseSqlite = false;
}

describe.skipIf(!canUseSqlite)('Conversation SQLite Repositories', () => {
  let db: InstanceType<typeof Database>;

  beforeEach(async () => {
    const { runMigrations } = await import('@core/infrastructure/persistence/sqlite/migrations');
    db = new Database(':memory:');
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    runMigrations(db);

    db.exec(`
      INSERT INTO organizations (id, name, workspace_path) VALUES ('org-1', 'Test Org', '/tmp');
      INSERT INTO roles (id, org_id, name) VALUES ('role-init', 'org-1', 'Initiator');
      INSERT INTO roles (id, org_id, name) VALUES ('role-resp', 'org-1', 'Responder');
    `);
  });

  afterEach(() => {
    db?.close();
  });

  describe('SqliteConversationRepository', () => {
    let repo: import('@core/modules/conversation/persistence/sqlite-conversation.repository').SqliteConversationRepository;

    beforeEach(async () => {
      const { SqliteConversationRepository } = await import('@core/modules/conversation/persistence/sqlite-conversation.repository');
      repo = new SqliteConversationRepository({ getDb: () => db, close: () => db.close() });
    });

    it('creates conversation with correct fields', () => {
      const conv = repo.create({ orgId: 'org-1', type: 'inquiry', initiatorRoleId: 'role-init', taskId: null });
      expect(conv.id).toBeDefined();
      expect(conv.type).toBe('inquiry');
      expect(conv.state).toBe('active');
      expect(conv.initiatorRoleId).toBe('role-init');
    });

    it('findById returns conversation when exists', () => {
      const created = repo.create({ orgId: 'org-1', type: 'planning', initiatorRoleId: 'role-init' });
      const found = repo.findById(created.id);
      expect(found).not.toBeNull();
      expect(found!.type).toBe('planning');
    });

    it('findById returns null when not exists', () => {
      expect(repo.findById('nonexistent')).toBeNull();
    });

    it('findByOrgId returns all conversations for org', () => {
      repo.create({ orgId: 'org-1', type: 'inquiry', initiatorRoleId: 'role-init' });
      repo.create({ orgId: 'org-1', type: 'adhoc', initiatorRoleId: 'role-init' });
      expect(repo.findByOrgId('org-1')).toHaveLength(2);
    });

    it('findActiveByOrgId returns only active/waiting conversations', () => {
      const conv = repo.create({ orgId: 'org-1', type: 'inquiry', initiatorRoleId: 'role-init' });
      repo.create({ orgId: 'org-1', type: 'adhoc', initiatorRoleId: 'role-init' });
      repo.updateState(conv.id, 'cancelled');
      expect(repo.findActiveByOrgId('org-1')).toHaveLength(1);
    });

    it('updateState changes conversation state', () => {
      const conv = repo.create({ orgId: 'org-1', type: 'inquiry', initiatorRoleId: 'role-init' });
      repo.updateState(conv.id, 'waiting');
      expect(repo.findById(conv.id)!.state).toBe('waiting');
    });

    it('updateRespondent sets respondent fields', () => {
      const conv = repo.create({ orgId: 'org-1', type: 'inquiry', initiatorRoleId: 'role-init' });
      repo.updateRespondent(conv.id, 'role-resp', 'ai');
      const updated = repo.findById(conv.id)!;
      expect(updated.respondentRoleId).toBe('role-resp');
      expect(updated.respondentType).toBe('ai');
    });

    it('updateExternalSessionId sets session', () => {
      const conv = repo.create({ orgId: 'org-1', type: 'inquiry', initiatorRoleId: 'role-init' });
      repo.updateExternalSessionId(conv.id, 'sess-123');
      expect(repo.findById(conv.id)!.externalSessionId).toBe('sess-123');
    });

    it('findTimedOutInquiries returns timed out waiting inquiries', () => {
      const conv = repo.create({ orgId: 'org-1', type: 'inquiry', initiatorRoleId: 'role-init' });
      repo.updateState(conv.id, 'waiting');
      db.prepare('UPDATE conversations SET timeout_at = ? WHERE id = ?')
        .run('2020-01-01T00:00:00.000Z', conv.id);
      expect(repo.findTimedOutInquiries()).toHaveLength(1);
    });

    it('delete removes conversation', () => {
      const conv = repo.create({ orgId: 'org-1', type: 'inquiry', initiatorRoleId: 'role-init' });
      repo.delete(conv.id);
      expect(repo.findById(conv.id)).toBeNull();
    });

    it('delete throws when not found', () => {
      expect(() => repo.delete('nonexistent')).toThrow();
    });

    it('stores and retrieves metadata', () => {
      const conv = repo.create({ orgId: 'org-1', type: 'inquiry', initiatorRoleId: 'role-init', metadata: { key: 'value' } });
      expect(repo.findById(conv.id)!.metadata).toEqual({ key: 'value' });
    });
  });

  describe('SqliteConversationMessageRepository', () => {
    let repo: import('@core/modules/conversation/persistence/sqlite-conversation-message.repository').SqliteConversationMessageRepository;
    let convId: string;

    beforeEach(async () => {
      const { SqliteConversationRepository } = await import('@core/modules/conversation/persistence/sqlite-conversation.repository');
      const { SqliteConversationMessageRepository } = await import('@core/modules/conversation/persistence/sqlite-conversation-message.repository');
      const connection = { getDb: () => db, close: () => db.close() };
      const convRepo = new SqliteConversationRepository(connection);
      repo = new SqliteConversationMessageRepository(connection);
      const conv = convRepo.create({ orgId: 'org-1', type: 'inquiry', initiatorRoleId: 'role-init' });
      convId = conv.id;
    });

    it('creates message with correct fields', () => {
      const msg = repo.create({ conversationId: convId, authorRoleId: 'role-init', authorType: 'ai', content: 'Hello', intent: 'question' });
      expect(msg.id).toBeDefined();
      expect(msg.conversationId).toBe(convId);
      expect(msg.content).toBe('Hello');
      expect(msg.authorType).toBe('ai');
    });

    it('findById returns message when exists', () => {
      const created = repo.create({ conversationId: convId, authorRoleId: null, authorType: 'human', content: 'Hi', intent: 'general' });
      expect(repo.findById(created.id)).not.toBeNull();
    });

    it('findById returns null when not exists', () => {
      expect(repo.findById('nonexistent')).toBeNull();
    });

    it('findByConversationId returns messages in order', () => {
      repo.create({ conversationId: convId, authorRoleId: 'role-init', authorType: 'ai', content: 'First', intent: 'question' });
      repo.create({ conversationId: convId, authorRoleId: 'role-resp', authorType: 'ai', content: 'Second', intent: 'reply' });
      const msgs = repo.findByConversationId(convId);
      expect(msgs).toHaveLength(2);
      expect(msgs[0].content).toBe('First');
      expect(msgs[1].content).toBe('Second');
    });

    it('findLatest returns limited messages in chronological order', () => {
      repo.create({ conversationId: convId, authorRoleId: 'role-init', authorType: 'ai', content: 'A', intent: 'question' });
      repo.create({ conversationId: convId, authorRoleId: 'role-resp', authorType: 'ai', content: 'B', intent: 'reply' });
      repo.create({ conversationId: convId, authorRoleId: 'role-init', authorType: 'ai', content: 'C', intent: 'question' });
      const msgs = repo.findLatest(convId, 2);
      expect(msgs).toHaveLength(2);
      expect(msgs[0].content).toBe('B');
      expect(msgs[1].content).toBe('C');
    });
  });

  describe('ConversationEventLogger', () => {
    let logger: import('@core/modules/conversation/persistence/conversation-event.logger').ConversationEventLogger;
    let convId: string;

    beforeEach(async () => {
      const { SqliteConversationRepository } = await import('@core/modules/conversation/persistence/sqlite-conversation.repository');
      const { ConversationEventLogger } = await import('@core/modules/conversation/persistence/conversation-event.logger');
      const connection = { getDb: () => db, close: () => db.close() };
      const convRepo = new SqliteConversationRepository(connection);
      logger = new ConversationEventLogger(connection);
      const conv = convRepo.create({ orgId: 'org-1', type: 'inquiry', initiatorRoleId: 'role-init' });
      convId = conv.id;
    });

    it('logs event without payload', () => {
      logger.log(convId, 'resolved');
      const events = logger.findByConversationId(convId);
      expect(events).toHaveLength(1);
      expect(events[0].eventType).toBe('resolved');
      expect(events[0].eventPayload).toBeNull();
    });

    it('logs event with payload', () => {
      logger.log(convId, 'escalated', { newRespondentRoleId: 'role-parent' });
      const events = logger.findByConversationId(convId);
      expect(events).toHaveLength(1);
      expect(JSON.parse(events[0].eventPayload!)).toEqual({ newRespondentRoleId: 'role-parent' });
    });

    it('returns events in chronological order', () => {
      logger.log(convId, 'created');
      logger.log(convId, 'waiting');
      logger.log(convId, 'resolved');
      const events = logger.findByConversationId(convId);
      expect(events).toHaveLength(3);
      expect(events.map((e) => e.eventType)).toEqual(['created', 'waiting', 'resolved']);
    });
  });
});

describe.skipIf(canUseSqlite)(SQLITE_SKIP_REASON, () => {
  it('SQLite tests skipped — native module not available for system Node.js', () => {
    expect(true).toBe(true);
  });
});
