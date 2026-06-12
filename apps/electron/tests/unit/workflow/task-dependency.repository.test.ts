import { describe, it, expect, beforeEach, vi } from 'vitest';
import { SqliteTaskDependencyRepository } from '@core/modules/workflow/persistence/sqlite-task-dependency.repository';
import type { ISqliteConnection } from '@core/foundation/interfaces/i-sqlite-connection';
import type { TaskDependency, CreateTaskDependencyInput } from '@core/modules/workflow/types/workflow.types';

function createMockConnection(): ISqliteConnection {
  const statements = new Map<string, { get: ReturnType<typeof vi.fn>; all: ReturnType<typeof vi.fn>; run: ReturnType<typeof vi.fn> }>();

  const getStatement = (sql: string) => {
    if (!statements.has(sql)) {
      statements.set(sql, {
        get: vi.fn(),
        all: vi.fn(),
        run: vi.fn(),
      });
    }
    return statements.get(sql)!;
  };

  return {
    getDb: vi.fn().mockReturnValue({
      prepare: vi.fn().mockImplementation((sql: string) => ({
        get: (...args: unknown[]) => getStatement(sql).get(...args),
        all: (...args: unknown[]) => getStatement(sql).all(...args),
        run: (...args: unknown[]) => getStatement(sql).run(...args),
      })),
      transaction: vi.fn().mockImplementation((fn: () => unknown) => fn),
    }),
  } as unknown as ISqliteConnection;
}

describe('SqliteTaskDependencyRepository', () => {
  let repo: SqliteTaskDependencyRepository;
  let connection: ISqliteConnection;

  beforeEach(() => {
    connection = createMockConnection();
    repo = new SqliteTaskDependencyRepository(connection);
  });

  describe('findById', () => {
    it('returns null when dependency not found', () => {
      const db = connection.getDb();
      vi.mocked(db.prepare).mockReturnValue({
        get: vi.fn().mockReturnValue(undefined),
        all: vi.fn(),
        run: vi.fn(),
      } as never);

      const result = repo.findById('nonexistent');

      expect(result).toBeNull();
    });

    it('returns TaskDependency when found', () => {
      const row = {
        id: 'dep-1',
        org_id: 'org-1',
        dependent_task_id: 'task-1',
        dependency_task_id: 'task-2',
        created_at: '2026-01-01T00:00:00.000Z',
      };
      const db = connection.getDb();
      vi.mocked(db.prepare).mockReturnValue({
        get: vi.fn().mockReturnValue(row),
        all: vi.fn(),
        run: vi.fn(),
      } as never);

      const result = repo.findById('dep-1');

      expect(result).toEqual({
        id: 'dep-1',
        orgId: 'org-1',
        dependentTaskId: 'task-1',
        dependencyTaskId: 'task-2',
        createdAt: '2026-01-01T00:00:00.000Z',
      });
    });
  });

  describe('findByDependentTaskId', () => {
    it('returns empty array when no dependencies', () => {
      const db = connection.getDb();
      vi.mocked(db.prepare).mockReturnValue({
        get: vi.fn(),
        all: vi.fn().mockReturnValue([]),
        run: vi.fn(),
      } as never);

      const result = repo.findByDependentTaskId('task-1');

      expect(result).toEqual([]);
    });

    it('returns dependencies for task', () => {
      const rows = [
        { id: 'dep-1', org_id: 'org-1', dependent_task_id: 'task-1', dependency_task_id: 'task-2', created_at: '2026-01-01T00:00:00.000Z' },
        { id: 'dep-2', org_id: 'org-1', dependent_task_id: 'task-1', dependency_task_id: 'task-3', created_at: '2026-01-01T00:00:00.000Z' },
      ];
      const db = connection.getDb();
      vi.mocked(db.prepare).mockReturnValue({
        get: vi.fn(),
        all: vi.fn().mockReturnValue(rows),
        run: vi.fn(),
      } as never);

      const result = repo.findByDependentTaskId('task-1');

      expect(result).toHaveLength(2);
      expect(result[0].dependentTaskId).toBe('task-1');
      expect(result[1].dependencyTaskId).toBe('task-3');
    });
  });

  describe('findByDependencyTaskId', () => {
    it('returns tasks that depend on given task', () => {
      const rows = [
        { id: 'dep-1', org_id: 'org-1', dependent_task_id: 'task-2', dependency_task_id: 'task-1', created_at: '2026-01-01T00:00:00.000Z' },
      ];
      const db = connection.getDb();
      vi.mocked(db.prepare).mockReturnValue({
        get: vi.fn(),
        all: vi.fn().mockReturnValue(rows),
        run: vi.fn(),
      } as never);

      const result = repo.findByDependencyTaskId('task-1');

      expect(result).toHaveLength(1);
      expect(result[0].dependencyTaskId).toBe('task-1');
    });
  });

  describe('findByOrgId', () => {
    it('returns all dependencies for organization', () => {
      const rows = [
        { id: 'dep-1', org_id: 'org-1', dependent_task_id: 'task-1', dependency_task_id: 'task-2', created_at: '2026-01-01T00:00:00.000Z' },
        { id: 'dep-2', org_id: 'org-1', dependent_task_id: 'task-3', dependency_task_id: 'task-4', created_at: '2026-01-01T00:00:00.000Z' },
      ];
      const db = connection.getDb();
      vi.mocked(db.prepare).mockReturnValue({
        get: vi.fn(),
        all: vi.fn().mockReturnValue(rows),
        run: vi.fn(),
      } as never);

      const result = repo.findByOrgId('org-1');

      expect(result).toHaveLength(2);
    });
  });

  describe('create', () => {
    it('creates dependency and returns it', () => {
      const input: CreateTaskDependencyInput = {
        orgId: 'org-1',
        dependentTaskId: 'task-1',
        dependencyTaskId: 'task-2',
      };
      const createdRow = {
        id: 'generated-id',
        org_id: 'org-1',
        dependent_task_id: 'task-1',
        dependency_task_id: 'task-2',
        created_at: '2026-01-01T00:00:00.000Z',
      };
      const db = connection.getDb();
      vi.mocked(db.prepare).mockImplementation((sql: string) => ({
        get: vi.fn().mockReturnValue(sql.includes('SELECT') ? createdRow : undefined),
        all: vi.fn(),
        run: vi.fn(),
      }) as never);

      const result = repo.create(input);

      expect(result.orgId).toBe('org-1');
      expect(result.dependentTaskId).toBe('task-1');
      expect(result.dependencyTaskId).toBe('task-2');
    });
  });

  describe('deleteByDependentTaskId', () => {
    it('deletes all dependencies where task is dependent', () => {
      const db = connection.getDb();
      const runFn = vi.fn();
      vi.mocked(db.prepare).mockReturnValue({
        get: vi.fn(),
        all: vi.fn(),
        run: runFn,
      } as never);

      repo.deleteByDependentTaskId('task-1');

      expect(runFn).toHaveBeenCalledWith('task-1');
    });
  });

  describe('deleteByDependencyTaskId', () => {
    it('deletes all dependencies where task is dependency', () => {
      const db = connection.getDb();
      const runFn = vi.fn();
      vi.mocked(db.prepare).mockReturnValue({
        get: vi.fn(),
        all: vi.fn(),
        run: runFn,
      } as never);

      repo.deleteByDependencyTaskId('task-1');

      expect(runFn).toHaveBeenCalledWith('task-1');
    });
  });

  describe('deleteByTaskId', () => {
    it('deletes dependencies in both directions', () => {
      const db = connection.getDb();
      const runFn = vi.fn();
      vi.mocked(db.prepare).mockReturnValue({
        get: vi.fn(),
        all: vi.fn(),
        run: runFn,
      } as never);

      repo.deleteByTaskId('task-1');

      expect(runFn).toHaveBeenCalledWith('task-1', 'task-1');
    });
  });

  describe('hasUnresolvedDependencies', () => {
    it('returns false when no unresolved dependencies', () => {
      const db = connection.getDb();
      vi.mocked(db.prepare).mockReturnValue({
        get: vi.fn().mockReturnValue(undefined),
        all: vi.fn(),
        run: vi.fn(),
      } as never);

      const result = repo.hasUnresolvedDependencies('task-1');

      expect(result).toBe(false);
    });

    it('returns true when unresolved dependencies exist', () => {
      const db = connection.getDb();
      vi.mocked(db.prepare).mockReturnValue({
        get: vi.fn().mockReturnValue({ 1: 1 }),
        all: vi.fn(),
        run: vi.fn(),
      } as never);

      const result = repo.hasUnresolvedDependencies('task-1');

      expect(result).toBe(true);
    });

    it('accepts custom terminal statuses', () => {
      const db = connection.getDb();
      vi.mocked(db.prepare).mockReturnValue({
        get: vi.fn().mockReturnValue(undefined),
        all: vi.fn(),
        run: vi.fn(),
      } as never);

      repo.hasUnresolvedDependencies('task-1', ['done', 'cancelled', 'failed']);

      expect(db.prepare).toHaveBeenCalled();
    });
  });

  describe('canReach', () => {
    it('returns true when fromTaskId equals toTaskId', () => {
      const result = repo.canReach('task-1', 'task-1');

      expect(result).toBe(true);
    });

    it('returns false when no path exists', () => {
      const db = connection.getDb();
      vi.mocked(db.prepare).mockReturnValue({
        get: vi.fn(),
        all: vi.fn().mockReturnValue([]),
        run: vi.fn(),
      } as never);

      const result = repo.canReach('task-1', 'task-2');

      expect(result).toBe(false);
    });

    it('returns true when direct path exists', () => {
      const db = connection.getDb();
      vi.mocked(db.prepare).mockReturnValue({
        get: vi.fn(),
        all: vi.fn().mockReturnValue([{ dependency_task_id: 'task-2' }]),
        run: vi.fn(),
      } as never);

      const result = repo.canReach('task-1', 'task-2');

      expect(result).toBe(true);
    });

    it('returns true when transitive path exists', () => {
      const db = connection.getDb();
      vi.mocked(db.prepare).mockImplementation((sql: string) => ({
        get: vi.fn(),
        all: vi.fn().mockImplementation((currentId: string) => {
          if (currentId === 'task-1') return [{ dependency_task_id: 'task-2' }];
          if (currentId === 'task-2') return [{ dependency_task_id: 'task-3' }];
          return [];
        }),
        run: vi.fn(),
      }) as never);

      const result = repo.canReach('task-1', 'task-3');

      expect(result).toBe(true);
    });

    it('detects cycle: A -> B -> A', () => {
      const db = connection.getDb();
      vi.mocked(db.prepare).mockImplementation((sql: string) => ({
        get: vi.fn(),
        all: vi.fn().mockImplementation((currentId: string) => {
          if (currentId === 'task-A') return [{ dependency_task_id: 'task-B' }];
          if (currentId === 'task-B') return [{ dependency_task_id: 'task-A' }];
          return [];
        }),
        run: vi.fn(),
      }) as never);

      const result = repo.canReach('task-A', 'task-A');

      expect(result).toBe(true);
    });

    it('detects transitive cycle: A -> B -> C -> A', () => {
      const db = connection.getDb();
      vi.mocked(db.prepare).mockImplementation((sql: string) => ({
        get: vi.fn(),
        all: vi.fn().mockImplementation((currentId: string) => {
          if (currentId === 'task-A') return [{ dependency_task_id: 'task-B' }];
          if (currentId === 'task-B') return [{ dependency_task_id: 'task-C' }];
          if (currentId === 'task-C') return [{ dependency_task_id: 'task-A' }];
          return [];
        }),
        run: vi.fn(),
      }) as never);

      const result = repo.canReach('task-A', 'task-A');

      expect(result).toBe(true);
    });
  });
});
