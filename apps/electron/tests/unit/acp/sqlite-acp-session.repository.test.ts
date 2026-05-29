import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SQLITE_SKIP_REASON } from '../../helpers/test-db';
import type { CreateAcpSessionInput } from '@core/modules/acp/interfaces/i-acp-session.repository';

let Database: typeof import('better-sqlite3').default;
let canUseSqlite = false;

try {
  Database = (await import('better-sqlite3')).default;
  new Database(':memory:');
  canUseSqlite = true;
} catch {
  canUseSqlite = false;
}

function input(overrides: Partial<CreateAcpSessionInput> = {}): CreateAcpSessionInput {
  return {
    acpSessionId: 'acp-1',
    agentId: 'agent-1',
    roleId: 'role-1',
    orgId: 'org-1',
    runId: 'run-1',
    conversationId: null,
    taskId: null,
    status: 'active',
    suspendReason: null,
    resumeStrategy: 'resume',
    resumeCount: 0,
    lastActivityAt: '2026-05-29T00:00:00.000Z',
    closedAt: null,
    closeReason: null,
    ...overrides,
  };
}

describe.skipIf(!canUseSqlite)('SqliteAcpSessionRepository', () => {
  let db: InstanceType<typeof Database>;
  let repo: import('@core/modules/acp/persistence/sqlite-acp-session.repository').SqliteAcpSessionRepository;

  beforeEach(async () => {
    const { SqliteAcpSessionRepository } = await import('@core/modules/acp/persistence/sqlite-acp-session.repository');
    const { runMigrations } = await import('@core/infrastructure/persistence/sqlite/migrations');

    db = new Database(':memory:');
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    runMigrations(db);

    const connection = { getDb: () => db, close: () => db.close() };
    repo = new SqliteAcpSessionRepository(connection);
  });

  afterEach(() => {
    db?.close();
  });

  describe('migration', () => {
    it('creates the acp_sessions table on a fresh DB', () => {
      const row = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='acp_sessions'").get();
      expect(row).toBeDefined();
    });
  });

  describe('create / findById', () => {
    it('assigns an id and round-trips all fields', () => {
      const rec = repo.create(input({ conversationId: 'conv-1', taskId: 'task-1' }));
      expect(rec.id).toBeDefined();
      expect(rec.createdAt).toBeDefined();

      const found = repo.findById(rec.id);
      expect(found).not.toBeNull();
      expect(found!.acpSessionId).toBe('acp-1');
      expect(found!.conversationId).toBe('conv-1');
      expect(found!.taskId).toBe('task-1');
      expect(found!.status).toBe('active');
      expect(found!.resumeStrategy).toBe('resume');
      expect(found!.resumeCount).toBe(0);
    });

    it('returns null for a missing id', () => {
      expect(repo.findById('nope')).toBeNull();
    });
  });

  describe('findByAcpSessionId', () => {
    it('finds by agent-side session id', () => {
      repo.create(input({ acpSessionId: 'acp-xyz' }));
      expect(repo.findByAcpSessionId('acp-xyz')).not.toBeNull();
      expect(repo.findByAcpSessionId('absent')).toBeNull();
    });
  });

  describe('findByConversationId', () => {
    it('resolves the planning binding', () => {
      repo.create(input({ conversationId: 'conv-9' }));
      expect(repo.findByConversationId('conv-9')).not.toBeNull();
      expect(repo.findByConversationId('conv-other')).toBeNull();
    });
  });

  describe('findResumable', () => {
    it('returns active or suspended sessions, newest activity first', () => {
      repo.create(input({ status: 'active', lastActivityAt: '2026-05-29T00:00:00.000Z' }));
      repo.create(input({ status: 'suspended', suspendReason: 'idle', lastActivityAt: '2026-05-29T01:00:00.000Z' }));
      const found = repo.findResumable('role-1', 'org-1');
      expect(found).not.toBeNull();
      expect(found!.status).toBe('suspended');
    });

    it('ignores closed/expired sessions', () => {
      repo.create(input({ status: 'closed', closeReason: 'completed' }));
      repo.create(input({ status: 'expired' }));
      expect(repo.findResumable('role-1', 'org-1')).toBeNull();
    });
  });

  describe('findIdleExpired', () => {
    it('returns only idle suspensions at or before the cutoff', () => {
      repo.create(input({ status: 'suspended', suspendReason: 'idle', lastActivityAt: '2026-05-29T00:00:00.000Z' }));
      // collaboration suspension — TTL-exempt, must be excluded
      repo.create(input({ status: 'suspended', suspendReason: 'collaboration', lastActivityAt: '2026-05-29T00:00:00.000Z' }));
      // idle but newer than cutoff
      repo.create(input({ status: 'suspended', suspendReason: 'idle', lastActivityAt: '2026-05-29T10:00:00.000Z' }));
      // active — not a suspension
      repo.create(input({ status: 'active', lastActivityAt: '2026-05-29T00:00:00.000Z' }));

      const expired = repo.findIdleExpired('2026-05-29T05:00:00.000Z');
      expect(expired).toHaveLength(1);
      expect(expired[0].suspendReason).toBe('idle');
      expect(expired[0].lastActivityAt).toBe('2026-05-29T00:00:00.000Z');
    });
  });

  describe('findNonTerminal', () => {
    it('returns active and suspended, excludes closed and expired', () => {
      repo.create(input({ status: 'active' }));
      repo.create(input({ status: 'suspended', suspendReason: 'idle' }));
      repo.create(input({ status: 'closed', closeReason: 'completed' }));
      repo.create(input({ status: 'expired' }));

      const nonTerminal = repo.findNonTerminal();
      expect(nonTerminal).toHaveLength(2);
      expect(nonTerminal.map(r => r.status).sort()).toEqual(['active', 'suspended']);
    });
  });

  describe('updateStatus', () => {
    it('updates status and patches related fields', () => {
      const rec = repo.create(input({ status: 'active' }));
      repo.updateStatus(rec.id, 'suspended', { suspendReason: 'idle' });
      const after = repo.findById(rec.id)!;
      expect(after.status).toBe('suspended');
      expect(after.suspendReason).toBe('idle');
    });

    it('persists close fields on terminal transition', () => {
      const rec = repo.create(input({ status: 'active' }));
      repo.updateStatus(rec.id, 'closed', { closeReason: 'completed', closedAt: '2026-05-29T02:00:00.000Z' });
      const after = repo.findById(rec.id)!;
      expect(after.status).toBe('closed');
      expect(after.closeReason).toBe('completed');
      expect(after.closedAt).toBe('2026-05-29T02:00:00.000Z');
    });

    it('clears a nullable field when patched to null', () => {
      const rec = repo.create(input({ status: 'suspended', suspendReason: 'idle' }));
      repo.updateStatus(rec.id, 'active', { suspendReason: null });
      expect(repo.findById(rec.id)!.suspendReason).toBeNull();
    });
  });

  describe('touchActivity', () => {
    it('bumps lastActivityAt', () => {
      const rec = repo.create(input({ lastActivityAt: '2026-05-29T00:00:00.000Z' }));
      repo.touchActivity(rec.id, '2026-05-29T03:00:00.000Z');
      expect(repo.findById(rec.id)!.lastActivityAt).toBe('2026-05-29T03:00:00.000Z');
    });
  });
});

describe.skipIf(canUseSqlite)(SQLITE_SKIP_REASON, () => {
  it('SQLite tests skipped — native module not available for system Node.js', () => {
    expect(true).toBe(true);
  });
});
