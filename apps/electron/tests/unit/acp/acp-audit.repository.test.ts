import { describe, it, expect, beforeEach, vi } from 'vitest';
import { AcpAuditRepository } from '@core/modules/acp/persistence/acp-audit.repository';
import type { ISqliteConnection } from '@core/foundation/interfaces/i-sqlite-connection';

function createMockDb() {
  const runFn = vi.fn();
  const stmt = { run: runFn };
  const transactionFn = vi.fn().mockImplementation((fn: () => void) => fn);

  return {
    db: {
      prepare: vi.fn().mockReturnValue(stmt),
      transaction: transactionFn,
    },
    runFn,
    transactionFn,
  };
}

function createMockConnection(db: any): ISqliteConnection {
  return {
    getDb: () => db,
    close: vi.fn(),
  } as any;
}

describe('AcpAuditRepository', () => {
  let mockDb: ReturnType<typeof createMockDb>;
  let repo: AcpAuditRepository;

  beforeEach(() => {
    mockDb = createMockDb();
    const connection = createMockConnection(mockDb.db);
    repo = new AcpAuditRepository(connection);
  });

  describe('insertFileAccessLogs', () => {
    it('should do nothing when entries array is empty', () => {
      repo.insertFileAccessLogs([]);
      expect(mockDb.db.prepare).not.toHaveBeenCalled();
    });

    it('should insert file access log entries', () => {
      repo.insertFileAccessLogs([
        {
          sessionId: 'sess-1',
          roleId: 'role-1',
          path: '/workspace/src/app.ts',
          operation: 'read',
          allowed: true,
          reason: undefined,
        },
        {
          sessionId: 'sess-1',
          roleId: 'role-1',
          path: '/workspace/.env',
          operation: 'read',
          allowed: false,
          reason: 'denied by policy',
        },
      ]);

      expect(mockDb.db.prepare).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO file_access_log'));
      expect(mockDb.runFn).toHaveBeenCalledTimes(2);
      // Parameters: (id, session_id, role_id, path, operation, allowed, reason)
      // First call: allowed entry
      expect(mockDb.runFn.mock.calls[0][1]).toBe('sess-1');
      expect(mockDb.runFn.mock.calls[0][2]).toBe('role-1');
      expect(mockDb.runFn.mock.calls[0][4]).toBe('read');
      expect(mockDb.runFn.mock.calls[0][5]).toBe(1); // allowed = true → 1
      // Second call: denied entry
      expect(mockDb.runFn.mock.calls[1][5]).toBe(0); // allowed = false → 0
      expect(mockDb.runFn.mock.calls[1][6]).toBe('denied by policy');
    });
  });

  describe('insertToolCallLogs', () => {
    it('should do nothing when entries array is empty', () => {
      repo.insertToolCallLogs([]);
      expect(mockDb.db.prepare).not.toHaveBeenCalled();
    });

    it('should insert tool call log entries', () => {
      repo.insertToolCallLogs([
        {
          sessionId: 'sess-1',
          runId: 'run-1',
          toolCallId: 'tc-1',
          title: 'Read file',
          kind: 'read',
          permission: 'allowed',
        },
        {
          sessionId: 'sess-1',
          runId: null,
          toolCallId: 'tc-2',
          title: 'rm -rf /',
          kind: 'command',
          permission: 'rejected',
        },
      ]);

      expect(mockDb.db.prepare).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO tool_call_log'));
      expect(mockDb.runFn).toHaveBeenCalledTimes(2);
      // Parameters: (id, session_id, run_id, tool_call_id, title, kind, permission)
      expect(mockDb.runFn.mock.calls[0][1]).toBe('sess-1');
      expect(mockDb.runFn.mock.calls[0][2]).toBe('run-1');
      expect(mockDb.runFn.mock.calls[0][3]).toBe('tc-1');
      expect(mockDb.runFn.mock.calls[1][2]).toBeNull(); // runId null
      expect(mockDb.runFn.mock.calls[1][6]).toBe('rejected');
    });
  });
});
