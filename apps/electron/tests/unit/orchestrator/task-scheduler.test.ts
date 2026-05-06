import { describe, it, expect, beforeEach, vi } from 'vitest';
import { TaskScheduler } from '@core/modules/orchestrator/task.scheduler';
import type { ITaskRepository } from '@core/modules/workflow/interfaces/i-task.repository';
import type { ProcessEngine } from '@core/modules/workflow/engines/process.engine';
import type { ILogger } from '@core/foundation/interfaces/i-logger';
import type { Task, StatusCategory } from '@core/modules/workflow/types/workflow.types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createTask(overrides?: Partial<Task>): Task {
  return {
    id: 'task-1',
    orgId: 'org-1',
    parentId: null,
    type: 'task',
    title: 'Test',
    description: '',
    status: 'pending',
    assigneeRoleId: 'role-1',
    depth: 0,
    artifactPaths: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

const STATUS_MAP: Record<string, StatusCategory> = {
  pending: 'initial',
  in_progress: 'active',
  review: 'approval',
  done: 'terminal',
};

// ---------------------------------------------------------------------------
// Shared mocks
// ---------------------------------------------------------------------------

let taskRepo: {
  findByOrgId: ReturnType<typeof vi.fn>;
  findChildren: ReturnType<typeof vi.fn>;
  [k: string]: unknown;
};

let processEngine: {
  getStatusCategory: ReturnType<typeof vi.fn>;
  [k: string]: unknown;
};

let logger: {
  info: ReturnType<typeof vi.fn>;
  warn: ReturnType<typeof vi.fn>;
  error: ReturnType<typeof vi.fn>;
  debug: ReturnType<typeof vi.fn>;
  child: ReturnType<typeof vi.fn>;
};

let scheduler: TaskScheduler;

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  const findChildrenMock = vi.fn().mockReturnValue([]);
  taskRepo = {
    findByOrgId: vi.fn().mockReturnValue([]),
    findChildren: findChildrenMock,
    // Default: derive from whatever findChildren returns. Individual tests
    // that need to diverge (e.g. simulate an orphan leaf) override this.
    hasChildren: vi.fn().mockImplementation(
      (parentId: string) => (findChildrenMock(parentId) as Task[]).length > 0,
    ),
    findById: vi.fn(),
    findByAssigneeRoleId: vi.fn(),
    create: vi.fn(),
    updateStatus: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  };

  // Default: schema unknown → returns null → isLeaf check falls back to hasChildren.
  // Individual tests that need isLeaf semantics override this mock.
  processEngine = {
    getStatusCategory: vi.fn().mockImplementation((_orgId: string, status: string) => {
      return STATUS_MAP[status] ?? null;
    }),
    getWorkItemType: vi.fn().mockReturnValue(null),
  };

  logger = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    child: vi.fn().mockReturnThis(),
  };

  scheduler = new TaskScheduler(
    taskRepo as unknown as ITaskRepository,
    processEngine as unknown as ProcessEngine,
    logger as unknown as ILogger,
  );
});

// ===========================================================================
// 2.1 Basic scheduling — single root
// ===========================================================================

describe('TaskScheduler', () => {
  describe('2.1 Basic scheduling — single root', () => {
    it('1: initial + has assignee → returns the task', () => {
      const root = createTask({ id: 'root', status: 'pending', assigneeRoleId: 'role-1' });
      taskRepo.findByOrgId.mockReturnValue([root]);

      const result = scheduler.findNextTask('org-1');

      expect(result).toEqual({ task: root, wakeReason: 'task_scheduled' });
    });

    it('2: initial + no assignee → blocked (null), warn logged', () => {
      const root = createTask({ id: 'root', status: 'pending', assigneeRoleId: null });
      taskRepo.findByOrgId.mockReturnValue([root]);

      const result = scheduler.findNextTask('org-1');

      expect(result).toBeNull();
      expect(logger.warn).toHaveBeenCalledWith(
        'Task blocked: no assigneeRoleId',
        expect.objectContaining({ taskId: 'root' }),
      );
    });

    it('3: active → skip (null)', () => {
      const root = createTask({ id: 'root', status: 'in_progress' });
      taskRepo.findByOrgId.mockReturnValue([root]);

      const result = scheduler.findNextTask('org-1');

      expect(result).toBeNull();
    });

    it('4: approval → skip (null)', () => {
      const root = createTask({ id: 'root', status: 'review' });
      taskRepo.findByOrgId.mockReturnValue([root]);

      const result = scheduler.findNextTask('org-1');

      expect(result).toBeNull();
    });

    it('5: terminal + no children → skip (null)', () => {
      const root = createTask({ id: 'root', status: 'done' });
      taskRepo.findByOrgId.mockReturnValue([root]);
      taskRepo.findChildren.mockReturnValue([]);

      const result = scheduler.findNextTask('org-1');

      expect(result).toBeNull();
    });

    it('6: terminal + initial child → returns child', () => {
      const root = createTask({ id: 'root', status: 'done' });
      const child = createTask({
        id: 'child',
        parentId: 'root',
        status: 'pending',
        assigneeRoleId: 'role-1',
      });
      taskRepo.findByOrgId.mockReturnValue([root]);
      taskRepo.findChildren.mockImplementation((parentId: string) =>
        parentId === 'root' ? [child] : [],
      );

      const result = scheduler.findNextTask('org-1');

      expect(result).toEqual({ task: child, wakeReason: 'task_scheduled' });
    });

    it('7: org has no tasks → null', () => {
      taskRepo.findByOrgId.mockReturnValue([]);

      const result = scheduler.findNextTask('org-1');

      expect(result).toBeNull();
    });
  });

  // =========================================================================
  // 2.2 DFS traversal
  // =========================================================================

  describe('2.2 DFS traversal', () => {
    it('8: first subtree first — returns A1', () => {
      const root = createTask({ id: 'root', status: 'done' });
      const A = createTask({ id: 'A', parentId: 'root', status: 'done', createdAt: '2026-01-01T00:00:00.000Z' });
      const B = createTask({ id: 'B', parentId: 'root', status: 'pending', assigneeRoleId: 'role-1', createdAt: '2026-01-02T00:00:00.000Z' });
      const A1 = createTask({ id: 'A1', parentId: 'A', status: 'pending', assigneeRoleId: 'role-1', createdAt: '2026-01-01T00:00:00.000Z' });
      const A2 = createTask({ id: 'A2', parentId: 'A', status: 'pending', assigneeRoleId: 'role-1', createdAt: '2026-01-02T00:00:00.000Z' });

      taskRepo.findByOrgId.mockReturnValue([root]);
      taskRepo.findChildren.mockImplementation((parentId: string) => {
        if (parentId === 'root') return [A, B];
        if (parentId === 'A') return [A1, A2];
        return [];
      });

      const result = scheduler.findNextTask('org-1');

      expect(result).toEqual({ task: A1, wakeReason: 'task_scheduled' });
    });

    it('9: first subtree done → second subtree returned', () => {
      const root = createTask({ id: 'root', status: 'done' });
      const A = createTask({ id: 'A', parentId: 'root', status: 'done', createdAt: '2026-01-01T00:00:00.000Z' });
      const B = createTask({ id: 'B', parentId: 'root', status: 'pending', assigneeRoleId: 'role-1', createdAt: '2026-01-02T00:00:00.000Z' });
      const A1 = createTask({ id: 'A1', parentId: 'A', status: 'done', createdAt: '2026-01-01T00:00:00.000Z' });
      const A2 = createTask({ id: 'A2', parentId: 'A', status: 'done', createdAt: '2026-01-02T00:00:00.000Z' });

      taskRepo.findByOrgId.mockReturnValue([root]);
      taskRepo.findChildren.mockImplementation((parentId: string) => {
        if (parentId === 'root') return [A, B];
        if (parentId === 'A') return [A1, A2];
        if (parentId === 'A1') return [];
        if (parentId === 'A2') return [];
        return [];
      });

      const result = scheduler.findNextTask('org-1');

      expect(result).toEqual({ task: B, wakeReason: 'task_scheduled' });
    });

    it('10: 3-level depth — epic→story→task', () => {
      const epic = createTask({ id: 'epic', status: 'done' });
      const story = createTask({ id: 'story', parentId: 'epic', status: 'done' });
      const task = createTask({ id: 'task-leaf', parentId: 'story', status: 'pending', assigneeRoleId: 'role-1' });

      taskRepo.findByOrgId.mockReturnValue([epic]);
      taskRepo.findChildren.mockImplementation((parentId: string) => {
        if (parentId === 'epic') return [story];
        if (parentId === 'story') return [task];
        return [];
      });

      const result = scheduler.findNextTask('org-1');

      expect(result).toEqual({ task, wakeReason: 'task_scheduled' });
    });

    it('11: 4-level depth — epic→story→task→subtask', () => {
      const epic = createTask({ id: 'epic', status: 'done' });
      const story = createTask({ id: 'story', parentId: 'epic', status: 'done' });
      const task = createTask({ id: 'task-mid', parentId: 'story', status: 'done' });
      const subtask = createTask({ id: 'subtask', parentId: 'task-mid', status: 'pending', assigneeRoleId: 'role-1' });

      taskRepo.findByOrgId.mockReturnValue([epic]);
      taskRepo.findChildren.mockImplementation((parentId: string) => {
        if (parentId === 'epic') return [story];
        if (parentId === 'story') return [task];
        if (parentId === 'task-mid') return [subtask];
        return [];
      });

      const result = scheduler.findNextTask('org-1');

      expect(result).toEqual({ task: subtask, wakeReason: 'task_scheduled' });
    });
  });

  // =========================================================================
  // 2.3 createdAt sorting
  // =========================================================================

  describe('2.3 createdAt sorting', () => {
    it('12: roots sorted by createdAt — earlier root returned', () => {
      const rootB = createTask({ id: 'root-B', status: 'pending', assigneeRoleId: 'role-1', createdAt: '2026-01-01T00:00:00.000Z' });
      const rootA = createTask({ id: 'root-A', status: 'pending', assigneeRoleId: 'role-1', createdAt: '2026-01-02T00:00:00.000Z' });

      // Return in wrong order to verify sort
      taskRepo.findByOrgId.mockReturnValue([rootA, rootB]);

      const result = scheduler.findNextTask('org-1');

      expect(result).toEqual({ task: rootB, wakeReason: 'task_scheduled' });
    });

    it('13: children sorted by createdAt — earlier child returned', () => {
      const parent = createTask({ id: 'parent', status: 'done' });
      const childB = createTask({ id: 'child-B', parentId: 'parent', status: 'pending', assigneeRoleId: 'role-1', createdAt: '2026-01-01T00:00:00.000Z' });
      const childA = createTask({ id: 'child-A', parentId: 'parent', status: 'pending', assigneeRoleId: 'role-1', createdAt: '2026-01-02T00:00:00.000Z' });

      taskRepo.findByOrgId.mockReturnValue([parent]);
      // Return in wrong order to verify sort
      taskRepo.findChildren.mockImplementation((parentId: string) =>
        parentId === 'parent' ? [childA, childB] : [],
      );

      const result = scheduler.findNextTask('org-1');

      expect(result).toEqual({ task: childB, wakeReason: 'task_scheduled' });
    });

    it('14: same createdAt → stable, returns one without crash', () => {
      const rootX = createTask({ id: 'root-X', status: 'pending', assigneeRoleId: 'role-1', createdAt: '2026-01-01T00:00:00.000Z' });
      const rootY = createTask({ id: 'root-Y', status: 'pending', assigneeRoleId: 'role-1', createdAt: '2026-01-01T00:00:00.000Z' });

      taskRepo.findByOrgId.mockReturnValue([rootX, rootY]);

      const result = scheduler.findNextTask('org-1');

      expect(result).not.toBeNull();
      expect(result!.wakeReason).toBe('task_scheduled');
      expect(['root-X', 'root-Y']).toContain(result!.task.id);
    });
  });

  // =========================================================================
  // 2.4 Blocking semantics
  // =========================================================================

  describe('2.4 Blocking semantics', () => {
    it('15: no-assignee task skipped, sibling with assignee returned', () => {
      const parent = createTask({ id: 'parent', status: 'done' });
      const T1 = createTask({ id: 'T1', parentId: 'parent', status: 'done', createdAt: '2026-01-01T00:00:00.000Z' });
      const T2 = createTask({ id: 'T2', parentId: 'parent', status: 'pending', assigneeRoleId: null, createdAt: '2026-01-02T00:00:00.000Z' });
      const T3 = createTask({ id: 'T3', parentId: 'parent', status: 'pending', assigneeRoleId: 'role-1', createdAt: '2026-01-03T00:00:00.000Z' });

      taskRepo.findByOrgId.mockReturnValue([parent]);
      taskRepo.findChildren.mockImplementation((parentId: string) =>
        parentId === 'parent' ? [T1, T2, T3] : [],
      );

      const result = scheduler.findNextTask('org-1');

      expect(result).toEqual({ task: T3, wakeReason: 'task_scheduled' });
    });

    it('16: all children no assignee → null', () => {
      const parent = createTask({ id: 'parent', status: 'done' });
      const T1 = createTask({ id: 'T1', parentId: 'parent', status: 'pending', assigneeRoleId: null, createdAt: '2026-01-01T00:00:00.000Z' });
      const T2 = createTask({ id: 'T2', parentId: 'parent', status: 'pending', assigneeRoleId: null, createdAt: '2026-01-02T00:00:00.000Z' });

      taskRepo.findByOrgId.mockReturnValue([parent]);
      taskRepo.findChildren.mockImplementation((parentId: string) =>
        parentId === 'parent' ? [T1, T2] : [],
      );

      const result = scheduler.findNextTask('org-1');

      expect(result).toBeNull();
      expect(logger.warn).toHaveBeenCalledTimes(2);
    });

    it('17: subtree A blocked, subtree B schedulable', () => {
      const root = createTask({ id: 'root', status: 'done' });
      const A = createTask({ id: 'A', parentId: 'root', status: 'done', createdAt: '2026-01-01T00:00:00.000Z' });
      const B = createTask({ id: 'B', parentId: 'root', status: 'pending', assigneeRoleId: 'role-1', createdAt: '2026-01-02T00:00:00.000Z' });
      const A1 = createTask({ id: 'A1', parentId: 'A', status: 'pending', assigneeRoleId: null });

      taskRepo.findByOrgId.mockReturnValue([root]);
      taskRepo.findChildren.mockImplementation((parentId: string) => {
        if (parentId === 'root') return [A, B];
        if (parentId === 'A') return [A1];
        return [];
      });

      const result = scheduler.findNextTask('org-1');

      expect(result).toEqual({ task: B, wakeReason: 'task_scheduled' });
    });

    it('18: has-assignee found first (earlier createdAt)', () => {
      const parent = createTask({ id: 'parent', status: 'done' });
      const T1 = createTask({ id: 'T1', parentId: 'parent', status: 'pending', assigneeRoleId: 'role-1', createdAt: '2026-01-01T00:00:00.000Z' });
      const T2 = createTask({ id: 'T2', parentId: 'parent', status: 'pending', assigneeRoleId: null, createdAt: '2026-01-02T00:00:00.000Z' });

      taskRepo.findByOrgId.mockReturnValue([parent]);
      taskRepo.findChildren.mockImplementation((parentId: string) =>
        parentId === 'parent' ? [T1, T2] : [],
      );

      const result = scheduler.findNextTask('org-1');

      expect(result).toEqual({ task: T1, wakeReason: 'task_scheduled' });
    });
  });

  // =========================================================================
  // 2.5 Depth limit
  // =========================================================================

  describe('2.5 Depth limit', () => {
    it('19: depth=10 still schedulable', () => {
      // Build a chain of 10 terminal nodes + 1 initial leaf at depth 10
      // findInSubtree is called with depth 0 for root.
      // root(depth=0) → child1(depth=1) → ... → child10(depth=10, initial)
      // depth increments happen in findInChildren: depth + 1
      // So root is at depth 0, and to reach depth 10 we need 10 terminal nodes.
      const nodes: Task[] = [];
      for (let i = 0; i <= 10; i++) {
        const isLeaf = i === 10;
        nodes.push(
          createTask({
            id: `node-${i}`,
            parentId: i === 0 ? null : `node-${i - 1}`,
            status: isLeaf ? 'pending' : 'done',
            assigneeRoleId: isLeaf ? 'role-1' : null,
          }),
        );
      }

      taskRepo.findByOrgId.mockReturnValue([nodes[0]]);
      taskRepo.findChildren.mockImplementation((parentId: string) => {
        const idx = nodes.findIndex((n) => n.id === parentId);
        if (idx >= 0 && idx < nodes.length - 1) return [nodes[idx + 1]];
        return [];
      });

      const result = scheduler.findNextTask('org-1');

      expect(result).toEqual({ task: nodes[10], wakeReason: 'task_scheduled' });
      expect(logger.warn).not.toHaveBeenCalledWith(
        'TaskScheduler depth limit exceeded',
        expect.anything(),
      );
    });

    it('20: depth=11 → not scheduled, warn logged', () => {
      // Build a chain of 11 terminal nodes + 1 initial leaf at depth 11
      const nodes: Task[] = [];
      for (let i = 0; i <= 11; i++) {
        const isLeaf = i === 11;
        nodes.push(
          createTask({
            id: `node-${i}`,
            parentId: i === 0 ? null : `node-${i - 1}`,
            status: isLeaf ? 'pending' : 'done',
            assigneeRoleId: isLeaf ? 'role-1' : null,
          }),
        );
      }

      taskRepo.findByOrgId.mockReturnValue([nodes[0]]);
      taskRepo.findChildren.mockImplementation((parentId: string) => {
        const idx = nodes.findIndex((n) => n.id === parentId);
        if (idx >= 0 && idx < nodes.length - 1) return [nodes[idx + 1]];
        return [];
      });

      const result = scheduler.findNextTask('org-1');

      expect(result).toBeNull();
      expect(logger.warn).toHaveBeenCalledWith(
        'TaskScheduler depth limit exceeded',
        expect.objectContaining({ taskId: 'node-11', depth: 11 }),
      );
    });
  });

  // =========================================================================
  // 2.6 Mixed states
  // =========================================================================

  describe('2.6 Mixed states', () => {
    it('21: active child skipped, initial child returned', () => {
      const parent = createTask({ id: 'parent', status: 'done' });
      const T1 = createTask({ id: 'T1', parentId: 'parent', status: 'in_progress', createdAt: '2026-01-01T00:00:00.000Z' });
      const T2 = createTask({ id: 'T2', parentId: 'parent', status: 'pending', assigneeRoleId: 'role-1', createdAt: '2026-01-02T00:00:00.000Z' });

      taskRepo.findByOrgId.mockReturnValue([parent]);
      taskRepo.findChildren.mockImplementation((parentId: string) =>
        parentId === 'parent' ? [T1, T2] : [],
      );

      const result = scheduler.findNextTask('org-1');

      expect(result).toEqual({ task: T2, wakeReason: 'task_scheduled' });
    });

    it('22: approval child skipped, initial child returned', () => {
      const parent = createTask({ id: 'parent', status: 'done' });
      const T1 = createTask({ id: 'T1', parentId: 'parent', status: 'review', createdAt: '2026-01-01T00:00:00.000Z' });
      const T2 = createTask({ id: 'T2', parentId: 'parent', status: 'pending', assigneeRoleId: 'role-1', createdAt: '2026-01-02T00:00:00.000Z' });

      taskRepo.findByOrgId.mockReturnValue([parent]);
      taskRepo.findChildren.mockImplementation((parentId: string) =>
        parentId === 'parent' ? [T1, T2] : [],
      );

      const result = scheduler.findNextTask('org-1');

      expect(result).toEqual({ task: T2, wakeReason: 'task_scheduled' });
    });

    it('23: all children terminal, no grandchildren → null', () => {
      const parent = createTask({ id: 'parent', status: 'done' });
      const T1 = createTask({ id: 'T1', parentId: 'parent', status: 'done', createdAt: '2026-01-01T00:00:00.000Z' });
      const T2 = createTask({ id: 'T2', parentId: 'parent', status: 'done', createdAt: '2026-01-02T00:00:00.000Z' });

      taskRepo.findByOrgId.mockReturnValue([parent]);
      taskRepo.findChildren.mockImplementation((parentId: string) => {
        if (parentId === 'parent') return [T1, T2];
        if (parentId === 'T1') return [];
        if (parentId === 'T2') return [];
        return [];
      });

      const result = scheduler.findNextTask('org-1');

      expect(result).toBeNull();
    });

    it('24: all children active → null', () => {
      const parent = createTask({ id: 'parent', status: 'done' });
      const T1 = createTask({ id: 'T1', parentId: 'parent', status: 'in_progress', createdAt: '2026-01-01T00:00:00.000Z' });
      const T2 = createTask({ id: 'T2', parentId: 'parent', status: 'in_progress', createdAt: '2026-01-02T00:00:00.000Z' });

      taskRepo.findByOrgId.mockReturnValue([parent]);
      taskRepo.findChildren.mockImplementation((parentId: string) =>
        parentId === 'parent' ? [T1, T2] : [],
      );

      const result = scheduler.findNextTask('org-1');

      expect(result).toBeNull();
    });

    it('25: unknown status category (null) → skipped', () => {
      const root = createTask({ id: 'root', status: 'unknown_status' });
      taskRepo.findByOrgId.mockReturnValue([root]);
      // getStatusCategory returns null for unknown statuses (via our STATUS_MAP mock)

      const result = scheduler.findNextTask('org-1');

      expect(result).toBeNull();
    });
  });

  // =========================================================================
  // 2.7 Multiple roots
  // =========================================================================

  describe('2.7 Multiple roots', () => {
    it('26: multiple roots by createdAt — first root has no schedulable children, second root is schedulable', () => {
      const rootA = createTask({ id: 'root-A', status: 'done', createdAt: '2026-01-01T00:00:00.000Z' });
      const rootB = createTask({ id: 'root-B', status: 'pending', assigneeRoleId: 'role-1', createdAt: '2026-01-02T00:00:00.000Z' });

      taskRepo.findByOrgId.mockReturnValue([rootB, rootA]); // wrong order to test sort
      taskRepo.findChildren.mockImplementation((parentId: string) =>
        parentId === 'root-A' ? [] : [],
      );

      const result = scheduler.findNextTask('org-1');

      expect(result).toEqual({ task: rootB, wakeReason: 'task_scheduled' });
    });

    it('27: first root has schedulable child → returns it (DFS into first root)', () => {
      const rootA = createTask({ id: 'root-A', status: 'done', createdAt: '2026-01-01T00:00:00.000Z' });
      const rootB = createTask({ id: 'root-B', status: 'pending', assigneeRoleId: 'role-1', createdAt: '2026-01-02T00:00:00.000Z' });
      const child = createTask({ id: 'child', parentId: 'root-A', status: 'pending', assigneeRoleId: 'role-1' });

      taskRepo.findByOrgId.mockReturnValue([rootB, rootA]); // wrong order to test sort
      taskRepo.findChildren.mockImplementation((parentId: string) =>
        parentId === 'root-A' ? [child] : [],
      );

      const result = scheduler.findNextTask('org-1');

      expect(result).toEqual({ task: child, wakeReason: 'task_scheduled' });
    });
  });

  // =========================================================================
  // 2.8 Leaf-only scheduling (Bug 1)
  // =========================================================================
  //
  // The scheduler must only return tasks that are actually executable — i.e.
  // LEAF tasks (no children in the repo). Returning a non-leaf parent causes
  // Claude Code to run on a container whose semantics are undefined. The
  // scheduler should descend into children of any non-leaf instead of
  // returning the parent, regardless of the parent's status category.
  //
  // These tests reproduce a user-reported bug where user-story (non-leaf)
  // nodes were triggering Claude Code runs after Eager/Preview decomposition.
  // See findInSubtree in task.scheduler.ts.

  describe('2.8 Leaf-only scheduling (Bug 1)', () => {
    it('28: non-leaf (initial + assignee + has children) → descends to leaf, never returns the parent', () => {
      // epic(pending, assignee) → story(pending, assignee) → task-leaf(pending, assignee)
      // Today's scheduler returns the first `initial + assignee` node it sees (epic)
      // which causes Claude Code to run on the epic container. It must descend.
      const epic = createTask({ id: 'epic', status: 'pending', assigneeRoleId: 'role-1', type: 'epic' });
      const story = createTask({ id: 'story', parentId: 'epic', status: 'pending', assigneeRoleId: 'role-1', type: 'story' });
      const leaf = createTask({ id: 'task-leaf', parentId: 'story', status: 'pending', assigneeRoleId: 'role-2', type: 'task' });

      taskRepo.findByOrgId.mockReturnValue([epic]);
      taskRepo.findChildren.mockImplementation((parentId: string) => {
        if (parentId === 'epic') return [story];
        if (parentId === 'story') return [leaf];
        return [];
      });
      taskRepo.hasChildren.mockImplementation((id: string) => id === 'epic' || id === 'story');

      const result = scheduler.findNextTask('org-1');

      expect(result).toEqual({ task: leaf, wakeReason: 'task_scheduled' });
    });

    it('29: non-leaf root in ACTIVE state after eager decomposition → descends to pending leaf', () => {
      // This is the exact scenario the user hit. Planning advances root (epic) to
      // in_progress, the scheduler is called, and today's code returns null at
      // active without descending — so leaf tasks never get dispatched. Worse,
      // onTaskStatusChanged may have already dispatched the active non-leaf itself.
      const epic = createTask({ id: 'epic', status: 'in_progress', assigneeRoleId: 'role-1', type: 'epic' });
      const story = createTask({ id: 'story', parentId: 'epic', status: 'pending', assigneeRoleId: 'role-1', type: 'story' });
      const leaf = createTask({ id: 'task-leaf', parentId: 'story', status: 'pending', assigneeRoleId: 'role-2', type: 'task' });

      taskRepo.findByOrgId.mockReturnValue([epic]);
      taskRepo.findChildren.mockImplementation((parentId: string) => {
        if (parentId === 'epic') return [story];
        if (parentId === 'story') return [leaf];
        return [];
      });
      taskRepo.hasChildren.mockImplementation((id: string) => id === 'epic' || id === 'story');

      const result = scheduler.findNextTask('org-1');

      expect(result).toEqual({ task: leaf, wakeReason: 'task_scheduled' });
    });

    it('30: non-leaf with only terminal descendants → null (nothing to schedule)', () => {
      // A non-leaf whose entire subtree is terminal must not be itself returned,
      // even though its status is `initial + assignee`. Expected: null (caller
      // will propagate parent-completion instead).
      const epic = createTask({ id: 'epic', status: 'pending', assigneeRoleId: 'role-1', type: 'epic' });
      const story = createTask({ id: 'story', parentId: 'epic', status: 'done', type: 'story' });
      const leaf = createTask({ id: 'task-leaf', parentId: 'story', status: 'done', type: 'task' });

      taskRepo.findByOrgId.mockReturnValue([epic]);
      taskRepo.findChildren.mockImplementation((parentId: string) => {
        if (parentId === 'epic') return [story];
        if (parentId === 'story') return [leaf];
        return [];
      });
      taskRepo.hasChildren.mockImplementation((id: string) => id === 'epic' || id === 'story');

      const result = scheduler.findNextTask('org-1');

      expect(result).toBeNull();
    });

    it('31: mixed subtrees under active non-leaf — returns pending leaf in second subtree', () => {
      //   epic(in_progress)
      //     ├─ story-A(done) → task-A(done, leaf)
      //     └─ story-B(in_progress) → task-B(pending, leaf, assignee)
      // Must descend through active non-leaves in both directions and return task-B.
      const epic = createTask({ id: 'epic', status: 'in_progress', assigneeRoleId: 'role-1', type: 'epic' });
      const storyA = createTask({ id: 'story-A', parentId: 'epic', status: 'done', type: 'story', createdAt: '2026-01-01T00:00:00.000Z' });
      const storyB = createTask({ id: 'story-B', parentId: 'epic', status: 'in_progress', type: 'story', createdAt: '2026-01-02T00:00:00.000Z' });
      const taskA = createTask({ id: 'task-A', parentId: 'story-A', status: 'done', type: 'task' });
      const taskB = createTask({ id: 'task-B', parentId: 'story-B', status: 'pending', assigneeRoleId: 'role-2', type: 'task' });

      taskRepo.findByOrgId.mockReturnValue([epic]);
      taskRepo.findChildren.mockImplementation((parentId: string) => {
        if (parentId === 'epic') return [storyA, storyB];
        if (parentId === 'story-A') return [taskA];
        if (parentId === 'story-B') return [taskB];
        return [];
      });
      taskRepo.hasChildren.mockImplementation((id: string) => ['epic', 'story-A', 'story-B'].includes(id));

      const result = scheduler.findNextTask('org-1');

      expect(result).toEqual({ task: taskB, wakeReason: 'task_scheduled' });
    });

    it('32: non-leaf pending whose leaves are ALL active (running) → null (nothing to schedule)', () => {
      //   epic(pending) — non-leaf, must not be returned
      //     ├─ task-1(in_progress, leaf)
      //     └─ task-2(in_progress, leaf)
      // Today's code returns epic (non-leaf bug). Correct behavior: descend, find
      // only active leaves, return null. Gate prevents concurrent dispatch anyway.
      const epic = createTask({ id: 'epic', status: 'pending', assigneeRoleId: 'role-1', type: 'epic' });
      const t1 = createTask({ id: 't1', parentId: 'epic', status: 'in_progress', assigneeRoleId: 'role-1', type: 'task', createdAt: '2026-01-01T00:00:00.000Z' });
      const t2 = createTask({ id: 't2', parentId: 'epic', status: 'in_progress', assigneeRoleId: 'role-1', type: 'task', createdAt: '2026-01-02T00:00:00.000Z' });

      taskRepo.findByOrgId.mockReturnValue([epic]);
      taskRepo.findChildren.mockImplementation((parentId: string) =>
        parentId === 'epic' ? [t1, t2] : [],
      );
      taskRepo.hasChildren.mockImplementation((id: string) => id === 'epic');

      const result = scheduler.findNextTask('org-1');

      expect(result).toBeNull();
    });

    it('33: chained non-leaves (all initial) → recurses all the way to deep leaf', () => {
      // root(pending, non-leaf) → mid(pending, non-leaf) → deep(pending, leaf)
      // Scheduler must recurse through every non-leaf, returning only the deep leaf.
      const root = createTask({ id: 'root', status: 'pending', assigneeRoleId: 'role-1', type: 'epic' });
      const mid = createTask({ id: 'mid', parentId: 'root', status: 'pending', assigneeRoleId: 'role-1', type: 'story' });
      const deep = createTask({ id: 'deep', parentId: 'mid', status: 'pending', assigneeRoleId: 'role-2', type: 'task' });

      taskRepo.findByOrgId.mockReturnValue([root]);
      taskRepo.findChildren.mockImplementation((parentId: string) => {
        if (parentId === 'root') return [mid];
        if (parentId === 'mid') return [deep];
        return [];
      });
      taskRepo.hasChildren.mockImplementation((id: string) => id === 'root' || id === 'mid');

      const result = scheduler.findNextTask('org-1');

      expect(result).toEqual({ task: deep, wakeReason: 'task_scheduled' });
    });

    it('34: non-leaf initial with NO assigneeRoleId but has schedulable children → descends, does NOT warn', () => {
      // Non-leaves are containers — "no assignee" is not a blocking condition for
      // them. The "Task blocked: no assigneeRoleId" warn must only fire for leaves.
      const epic = createTask({ id: 'epic', status: 'pending', assigneeRoleId: null, type: 'epic' });
      const leaf = createTask({ id: 'task-leaf', parentId: 'epic', status: 'pending', assigneeRoleId: 'role-1', type: 'task' });

      taskRepo.findByOrgId.mockReturnValue([epic]);
      taskRepo.findChildren.mockImplementation((parentId: string) =>
        parentId === 'epic' ? [leaf] : [],
      );
      taskRepo.hasChildren.mockImplementation((id: string) => id === 'epic');

      const result = scheduler.findNextTask('org-1');

      expect(result).toEqual({ task: leaf, wakeReason: 'task_scheduled' });
      expect(logger.warn).not.toHaveBeenCalledWith(
        'Task blocked: no assigneeRoleId',
        expect.objectContaining({ taskId: 'epic' }),
      );
    });

    it('35: leaf already in active state → null (must not re-schedule a running task)', () => {
      // Regression guard: today's code correctly returns null on active leaves.
      // The leaf fix must not break this.
      const leaf = createTask({ id: 'leaf', status: 'in_progress', assigneeRoleId: 'role-1', type: 'task' });
      taskRepo.findByOrgId.mockReturnValue([leaf]);
      taskRepo.hasChildren.mockReturnValue(false);

      const result = scheduler.findNextTask('org-1');

      expect(result).toBeNull();
    });
  });

  // =========================================================================
  // 2.9 Non-leaf-but-not-yet-decomposed must schedule (Bug 4)
  // =========================================================================
  //
  // A task whose schema type is non-leaf (isLeaf=false) but which has NO
  // children yet is NOT a container — it's a node waiting to be decomposed.
  // The scheduler MUST return it so the assignee role gets woken. The prompt
  // scenario system will automatically route the wake to a decomposition
  // scenario (preview_decomposition / eager_decomposition) based on
  // task.planningMode. See scenario.ts.
  //
  // Without this, manually-created epic/story root tasks sit dormant forever.

  describe('2.9 Non-leaf-but-not-yet-decomposed (Bug 4)', () => {
    // Helper: schema says "epic is non-leaf". This is the whole point of these
    // tests — we must not let the isLeaf=false signal alone classify the task
    // as a container when it has no children yet.
    function mockEpicIsNonLeaf() {
      processEngine.getWorkItemType.mockImplementation(
        (_orgId: string, typeName: string) =>
          typeName === 'epic'
            ? { name: 'epic', label: 'Epic', isLeaf: false, allowedChildren: ['story'], allowedAtRoot: true, canDecompose: true }
            : null,
      );
    }

    it('36: non-leaf type + initial + assignee + NO children → returns itself', () => {
      // The typical manual-create case: user creates an epic root through UI,
      // planningMode defaults to "preview", assignee is a planner role.
      // Scheduler must dispatch it so the AI can decompose it.
      mockEpicIsNonLeaf();
      const epic = createTask({
        id: 'epic-root',
        type: 'epic',
        status: 'pending',
        assigneeRoleId: 'role-lead',
      });

      taskRepo.findByOrgId.mockReturnValue([epic]);
      // No children. Default hasChildren mock derives from findChildren=[].

      const result = scheduler.findNextTask('org-1');

      expect(result).toEqual({ task: epic, wakeReason: 'task_scheduled' });
    });

    it('37: non-leaf + initial + NO assignee + no children → null, warn logged', () => {
      mockEpicIsNonLeaf();
      // Unlike the old over-broad "non-leaf is always a container" rule, a
      // non-leaf without children IS schedulable — so the missing-assignee
      // warning DOES apply here (same as leaves).
      const epic = createTask({
        id: 'epic-root',
        type: 'epic',
        status: 'pending',
        assigneeRoleId: null,
      });

      taskRepo.findByOrgId.mockReturnValue([epic]);

      const result = scheduler.findNextTask('org-1');

      expect(result).toBeNull();
      expect(logger.warn).toHaveBeenCalledWith(
        'Task blocked: no assigneeRoleId',
        expect.objectContaining({ taskId: 'epic-root' }),
      );
    });

    it('38: non-leaf with children → still descends, never returns itself', () => {
      // Regression guard on the OLD fix: once decomposition happened, the
      // non-leaf must become a container. This parallels #28 but makes the
      // before/after contrast explicit.
      mockEpicIsNonLeaf();
      const epic = createTask({ id: 'epic', type: 'epic', status: 'pending', assigneeRoleId: 'role-lead' });
      const leaf = createTask({ id: 'leaf', parentId: 'epic', status: 'pending', assigneeRoleId: 'role-dev', type: 'task' });

      taskRepo.findByOrgId.mockReturnValue([epic]);
      taskRepo.findChildren.mockImplementation((parentId: string) =>
        parentId === 'epic' ? [leaf] : [],
      );

      const result = scheduler.findNextTask('org-1');

      expect(result?.task.id).toBe('leaf');
      expect(result?.task.id).not.toBe('epic');
    });

    it('39: non-leaf + active status + no children → null (run already in flight)', () => {
      // The assignee is presumably already executing. Do not re-dispatch.
      mockEpicIsNonLeaf();
      const epic = createTask({
        id: 'epic',
        type: 'epic',
        status: 'in_progress',
        assigneeRoleId: 'role-lead',
      });

      taskRepo.findByOrgId.mockReturnValue([epic]);

      const result = scheduler.findNextTask('org-1');

      expect(result).toBeNull();
    });
  });
});
