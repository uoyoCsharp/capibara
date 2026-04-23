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
  taskRepo = {
    findByOrgId: vi.fn().mockReturnValue([]),
    findChildren: vi.fn().mockReturnValue([]),
    findById: vi.fn(),
    findByAssigneeRoleId: vi.fn(),
    create: vi.fn(),
    updateStatus: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  };

  processEngine = {
    getStatusCategory: vi.fn().mockImplementation((_orgId: string, status: string) => {
      return STATUS_MAP[status] ?? null;
    }),
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
});
