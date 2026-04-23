import { describe, it, expect, beforeEach, vi } from 'vitest';
import { BehaviorEngine } from '@core/modules/workflow/engines/behavior.engine';
import type { ITaskRepository } from '@core/modules/workflow/interfaces/i-task.repository';
import type { ProcessEngine } from '@core/modules/workflow/engines/process.engine';
import type { TaskStateMachine } from '@core/modules/workflow/engines/task.state-machine';
import type { ILogger } from '@core/foundation/interfaces/i-logger';
import type { Task, ProcessSchema, BehaviorCondition } from '@core/modules/workflow/types/workflow.types';

function createTask(overrides?: Partial<Task>): Task {
  return {
    id: 'task-1',
    orgId: 'org-1',
    parentId: null,
    type: 'task',
    title: 'Test Task',
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

function createDefaultSchema(): ProcessSchema {
  return {
    workItemTypes: [
      { name: 'epic', label: 'Epic', isLeaf: false, allowedChildren: ['story'], allowedAtRoot: true, canDecompose: true },
      { name: 'story', label: 'Story', isLeaf: false, allowedChildren: ['task'], allowedAtRoot: true, canDecompose: true },
      { name: 'task', label: 'Task', isLeaf: false, allowedChildren: ['subtask'], allowedAtRoot: false, canDecompose: false },
      { name: 'subtask', label: 'Subtask', isLeaf: true, allowedChildren: [], allowedAtRoot: false, canDecompose: false },
    ],
    statuses: [
      { name: 'pending', label: 'Pending', category: 'initial' },
      { name: 'in_progress', label: 'In Progress', category: 'active' },
      { name: 'awaiting_review', label: 'Awaiting Review', category: 'approval' },
      { name: 'approved', label: 'Approved', category: 'terminal' },
      { name: 'done', label: 'Done', category: 'terminal' },
      { name: 'cancelled', label: 'Cancelled', category: 'terminal' },
    ],
    transitions: [
      { from: 'pending', to: 'in_progress' },
      { from: 'in_progress', to: 'awaiting_review' },
      { from: 'awaiting_review', to: 'approved' },
      { from: 'approved', to: 'done' },
    ],
    behaviorRules: [
      {
        id: 'rule-1',
        name: 'Auto-complete leaf on terminal',
        priority: 10,
        trigger: 'on_status_enter',
        condition: {
          all: [
            { field: 'status.category', op: 'eq', value: 'terminal' },
            { field: 'type.isLeaf', op: 'eq', value: true },
          ],
        },
        action: { type: 'transition', params: { targetStatus: 'done' } },
      },
      {
        id: 'rule-2',
        name: 'Auto-complete parent',
        priority: 20,
        trigger: 'on_all_children_terminal',
        action: { type: 'transition', params: { targetStatus: 'done' } },
      },
    ],
  };
}

describe('BehaviorEngine', () => {
  let engine: BehaviorEngine;
  let taskRepo: ITaskRepository;
  let processEngine: ProcessEngine;
  let taskStateMachine: TaskStateMachine;
  let logger: ILogger;

  beforeEach(() => {
    taskRepo = {
      findById: vi.fn().mockReturnValue(null),
      findByOrgId: vi.fn().mockReturnValue([]),
      findChildren: vi.fn().mockReturnValue([]),
      findByAssigneeRoleId: vi.fn().mockReturnValue([]),
      create: vi.fn(),
      updateStatus: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    } as unknown as ITaskRepository;

    processEngine = {
      getSchema: vi.fn().mockReturnValue(createDefaultSchema()),
      getStatusCategory: vi.fn().mockImplementation((_orgId: string, status: string) => {
        const schema = createDefaultSchema();
        const def = schema.statuses.find((s) => s.name === status);
        return def?.category ?? null;
      }),
    } as unknown as ProcessEngine;

    taskStateMachine = {
      transition: vi.fn(),
    } as unknown as TaskStateMachine;

    logger = {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      child: vi.fn(),
    } as unknown as ILogger;

    engine = new BehaviorEngine(taskRepo, processEngine, taskStateMachine, logger);
  });

  // ─── 1.1 FieldCondition ──────────────────────────────────────────

  describe('evaluateCondition — FieldCondition', () => {
    it('#1 eq string match', () => {
      const condition: BehaviorCondition = { field: 'task.type', op: 'eq', value: 'bug' };
      expect(engine.evaluateCondition(condition, { 'task.type': 'bug' })).toBe(true);
    });

    it('#2 eq string mismatch', () => {
      const condition: BehaviorCondition = { field: 'task.type', op: 'eq', value: 'bug' };
      expect(engine.evaluateCondition(condition, { 'task.type': 'task' })).toBe(false);
    });

    it('#3 eq boolean match', () => {
      const condition: BehaviorCondition = { field: 'type.isLeaf', op: 'eq', value: true };
      expect(engine.evaluateCondition(condition, { 'type.isLeaf': true })).toBe(true);
    });

    it('#4 eq boolean mismatch', () => {
      const condition: BehaviorCondition = { field: 'type.isLeaf', op: 'eq', value: true };
      expect(engine.evaluateCondition(condition, { 'type.isLeaf': false })).toBe(false);
    });

    it('#5 eq number match', () => {
      const condition: BehaviorCondition = { field: 'task.depth', op: 'eq', value: 2 };
      expect(engine.evaluateCondition(condition, { 'task.depth': 2 })).toBe(true);
    });

    it('#6 neq match', () => {
      const condition: BehaviorCondition = { field: 'task.type', op: 'neq', value: 'epic' };
      expect(engine.evaluateCondition(condition, { 'task.type': 'task' })).toBe(true);
    });

    it('#7 neq mismatch', () => {
      const condition: BehaviorCondition = { field: 'task.type', op: 'neq', value: 'task' };
      expect(engine.evaluateCondition(condition, { 'task.type': 'task' })).toBe(false);
    });

    it('#8 in value in list', () => {
      const condition: BehaviorCondition = { field: 'task.type', op: 'in', value: ['bug', 'chore'] };
      expect(engine.evaluateCondition(condition, { 'task.type': 'bug' })).toBe(true);
    });

    it('#9 in value not in list', () => {
      const condition: BehaviorCondition = { field: 'task.type', op: 'in', value: ['bug', 'chore'] };
      expect(engine.evaluateCondition(condition, { 'task.type': 'epic' })).toBe(false);
    });

    it('#10 not_in value not in list', () => {
      const condition: BehaviorCondition = { field: 'status.category', op: 'not_in', value: ['terminal'] };
      expect(engine.evaluateCondition(condition, { 'status.category': 'active' })).toBe(true);
    });

    it('#11 not_in value in list', () => {
      const condition: BehaviorCondition = { field: 'status.category', op: 'not_in', value: ['terminal'] };
      expect(engine.evaluateCondition(condition, { 'status.category': 'terminal' })).toBe(false);
    });

    it('#12 gt greater', () => {
      const condition: BehaviorCondition = { field: 'task.depth', op: 'gt', value: 2 };
      expect(engine.evaluateCondition(condition, { 'task.depth': 3 })).toBe(true);
    });

    it('#13 gt equal (fails)', () => {
      const condition: BehaviorCondition = { field: 'task.depth', op: 'gt', value: 2 };
      expect(engine.evaluateCondition(condition, { 'task.depth': 2 })).toBe(false);
    });

    it('#14 gt less', () => {
      const condition: BehaviorCondition = { field: 'task.depth', op: 'gt', value: 2 };
      expect(engine.evaluateCondition(condition, { 'task.depth': 1 })).toBe(false);
    });

    it('#15 lt less', () => {
      const condition: BehaviorCondition = { field: 'task.depth', op: 'lt', value: 3 };
      expect(engine.evaluateCondition(condition, { 'task.depth': 2 })).toBe(true);
    });

    it('#16 lt equal (fails)', () => {
      const condition: BehaviorCondition = { field: 'task.depth', op: 'lt', value: 2 };
      expect(engine.evaluateCondition(condition, { 'task.depth': 2 })).toBe(false);
    });

    it('#17 unknown field returns false', () => {
      const condition: BehaviorCondition = { field: 'nonexistent', op: 'eq', value: 'x' };
      expect(engine.evaluateCondition(condition, {})).toBe(false);
    });

    it('#18 unknown operator returns false', () => {
      const condition: BehaviorCondition = { field: 'task.type', op: 'regex' as never, value: '.*' };
      expect(engine.evaluateCondition(condition, { 'task.type': 'bug' })).toBe(false);
    });

    it('#19 in with non-array value returns false', () => {
      const condition: BehaviorCondition = { field: 'task.type', op: 'in', value: 'bug' };
      expect(engine.evaluateCondition(condition, { 'task.type': 'bug' })).toBe(false);
    });

    it('#20 gt with non-number actual returns false', () => {
      const condition: BehaviorCondition = { field: 'task.type', op: 'gt', value: 1 };
      expect(engine.evaluateCondition(condition, { 'task.type': 'bug' })).toBe(false);
    });

    it('#21 gt with non-number value returns false', () => {
      const condition: BehaviorCondition = { field: 'task.depth', op: 'gt', value: 'high' };
      expect(engine.evaluateCondition(condition, { 'task.depth': 3 })).toBe(false);
    });
  });

  // ─── 1.2 Combination logic ───────────────────────────────────────

  describe('evaluateCondition — Combination logic', () => {
    it('#22 all: all true', () => {
      const condition: BehaviorCondition = {
        all: [
          { field: 'task.type', op: 'eq', value: 'bug' },
          { field: 'task.depth', op: 'eq', value: 0 },
        ],
      };
      expect(engine.evaluateCondition(condition, { 'task.type': 'bug', 'task.depth': 0 })).toBe(true);
    });

    it('#23 all: partial false', () => {
      const condition: BehaviorCondition = {
        all: [
          { field: 'task.type', op: 'eq', value: 'bug' },
          { field: 'task.depth', op: 'eq', value: 5 },
        ],
      };
      expect(engine.evaluateCondition(condition, { 'task.type': 'bug', 'task.depth': 0 })).toBe(false);
    });

    it('#24 all: empty array', () => {
      const condition: BehaviorCondition = { all: [] };
      expect(engine.evaluateCondition(condition, {})).toBe(true);
    });

    it('#25 any: at least one true', () => {
      const condition: BehaviorCondition = {
        any: [
          { field: 'task.type', op: 'eq', value: 'bug' },
          { field: 'task.type', op: 'eq', value: 'task' },
        ],
      };
      expect(engine.evaluateCondition(condition, { 'task.type': 'bug' })).toBe(true);
    });

    it('#26 any: all false', () => {
      const condition: BehaviorCondition = {
        any: [
          { field: 'task.type', op: 'eq', value: 'epic' },
          { field: 'task.type', op: 'eq', value: 'story' },
        ],
      };
      expect(engine.evaluateCondition(condition, { 'task.type': 'bug' })).toBe(false);
    });

    it('#27 any: empty array', () => {
      const condition: BehaviorCondition = { any: [] };
      expect(engine.evaluateCondition(condition, {})).toBe(false);
    });

    it('#28 not: negate true to false', () => {
      const condition: BehaviorCondition = {
        not: { field: 'task.type', op: 'eq', value: 'bug' },
      };
      expect(engine.evaluateCondition(condition, { 'task.type': 'bug' })).toBe(false);
    });

    it('#29 not: negate false to true', () => {
      const condition: BehaviorCondition = {
        not: { field: 'task.type', op: 'eq', value: 'bug' },
      };
      expect(engine.evaluateCondition(condition, { 'task.type': 'task' })).toBe(true);
    });

    it('#30 3-level nesting all > any > not', () => {
      // all: [any: [not(type==bug), depth==0], status==active]
      // context: type=task(not bug -> true), depth=0(true), status=active(true) => all true => true
      const condition: BehaviorCondition = {
        all: [
          {
            any: [
              { not: { field: 'task.type', op: 'eq', value: 'bug' } },
              { field: 'task.depth', op: 'eq', value: 0 },
            ],
          },
          { field: 'task.status', op: 'eq', value: 'active' },
        ],
      };
      expect(
        engine.evaluateCondition(condition, {
          'task.type': 'task',
          'task.depth': 0,
          'task.status': 'active',
        }),
      ).toBe(true);
    });

    it('#31 not nesting all — when all conditions true, not returns false', () => {
      const condition: BehaviorCondition = {
        not: {
          all: [
            { field: 'task.type', op: 'eq', value: 'bug' },
            { field: 'task.depth', op: 'eq', value: 0 },
          ],
        },
      };
      expect(engine.evaluateCondition(condition, { 'task.type': 'bug', 'task.depth': 0 })).toBe(false);
    });

    it('#32 condition null returns true', () => {
      expect(engine.evaluateCondition(null, {})).toBe(true);
    });

    it('#33 condition undefined returns true', () => {
      expect(engine.evaluateCondition(undefined, {})).toBe(true);
    });

    it('#34 condition omitted (rule without condition) returns true', () => {
      // Simulates a rule where condition property is not set at all (undefined)
      const ruleCondition = undefined as BehaviorCondition | undefined;
      expect(engine.evaluateCondition(ruleCondition, {})).toBe(true);
    });
  });

  // ─── 1.3 Context building ────────────────────────────────────────

  describe('Context building — via onStatusEnter', () => {
    it('#35 complete context with all 8 fields', () => {
      const task = createTask({ type: 'subtask', status: 'approved', depth: 2, assigneeRoleId: 'role-1' });
      const childTasks = [createTask({ id: 'child-1', parentId: task.id })];
      vi.mocked(taskRepo.findChildren).mockReturnValue(childTasks);

      // Capture the condition evaluation via a custom rule that always matches
      const schema = createDefaultSchema();
      schema.behaviorRules = [
        {
          id: 'ctx-check',
          name: 'Context checker',
          priority: 1,
          trigger: 'on_status_enter',
          condition: {
            all: [
              { field: 'task.type', op: 'eq', value: 'subtask' },
              { field: 'task.status', op: 'eq', value: 'approved' },
              { field: 'task.depth', op: 'eq', value: 2 },
              { field: 'task.hasChildren', op: 'eq', value: true },
              { field: 'task.hasAssignee', op: 'eq', value: true },
              { field: 'status.category', op: 'eq', value: 'terminal' },
              { field: 'type.isLeaf', op: 'eq', value: true },
              { field: 'type.canDecompose', op: 'eq', value: false },
            ],
          },
          action: { type: 'transition', params: { targetStatus: 'done' } },
        },
      ];
      vi.mocked(processEngine.getSchema).mockReturnValue(schema);

      engine.onStatusEnter(task);

      expect(taskStateMachine.transition).toHaveBeenCalledWith(task.id, 'done');
    });

    it('#36 task.hasChildren = true when children exist', () => {
      const task = createTask({ type: 'subtask', status: 'approved' });
      vi.mocked(taskRepo.findChildren).mockReturnValue([createTask({ id: 'child-1' })]);

      const schema = createDefaultSchema();
      schema.behaviorRules = [
        {
          id: 'has-children-check',
          name: 'Check hasChildren true',
          priority: 1,
          trigger: 'on_status_enter',
          condition: { field: 'task.hasChildren', op: 'eq', value: true },
          action: { type: 'transition', params: { targetStatus: 'done' } },
        },
      ];
      vi.mocked(processEngine.getSchema).mockReturnValue(schema);

      engine.onStatusEnter(task);

      expect(taskStateMachine.transition).toHaveBeenCalled();
    });

    it('#37 task.hasChildren = false when no children', () => {
      const task = createTask({ type: 'subtask', status: 'approved' });
      vi.mocked(taskRepo.findChildren).mockReturnValue([]);

      const schema = createDefaultSchema();
      schema.behaviorRules = [
        {
          id: 'no-children-check',
          name: 'Check hasChildren false',
          priority: 1,
          trigger: 'on_status_enter',
          condition: { field: 'task.hasChildren', op: 'eq', value: false },
          action: { type: 'transition', params: { targetStatus: 'done' } },
        },
      ];
      vi.mocked(processEngine.getSchema).mockReturnValue(schema);

      engine.onStatusEnter(task);

      expect(taskStateMachine.transition).toHaveBeenCalled();
    });

    it('#38 task.hasAssignee = true when assigneeRoleId set', () => {
      const task = createTask({ type: 'subtask', status: 'approved', assigneeRoleId: 'role-1' });
      vi.mocked(taskRepo.findChildren).mockReturnValue([]);

      const schema = createDefaultSchema();
      schema.behaviorRules = [
        {
          id: 'assignee-check',
          name: 'Check hasAssignee true',
          priority: 1,
          trigger: 'on_status_enter',
          condition: { field: 'task.hasAssignee', op: 'eq', value: true },
          action: { type: 'transition', params: { targetStatus: 'done' } },
        },
      ];
      vi.mocked(processEngine.getSchema).mockReturnValue(schema);

      engine.onStatusEnter(task);

      expect(taskStateMachine.transition).toHaveBeenCalled();
    });

    it('#39 task.hasAssignee = false when assigneeRoleId null', () => {
      const task = createTask({ type: 'subtask', status: 'approved', assigneeRoleId: null });
      vi.mocked(taskRepo.findChildren).mockReturnValue([]);

      const schema = createDefaultSchema();
      schema.behaviorRules = [
        {
          id: 'no-assignee-check',
          name: 'Check hasAssignee false',
          priority: 1,
          trigger: 'on_status_enter',
          condition: { field: 'task.hasAssignee', op: 'eq', value: false },
          action: { type: 'transition', params: { targetStatus: 'done' } },
        },
      ];
      vi.mocked(processEngine.getSchema).mockReturnValue(schema);

      engine.onStatusEnter(task);

      expect(taskStateMachine.transition).toHaveBeenCalled();
    });

    it('#40 status.category = null when status not in schema', () => {
      const task = createTask({ type: 'subtask', status: 'unknown_status' });
      vi.mocked(taskRepo.findChildren).mockReturnValue([]);

      const schema = createDefaultSchema();
      schema.behaviorRules = [
        {
          id: 'null-category-check',
          name: 'Check category null',
          priority: 1,
          trigger: 'on_status_enter',
          // null === null via eq
          condition: { field: 'status.category', op: 'eq', value: null },
          action: { type: 'transition', params: { targetStatus: 'done' } },
        },
      ];
      vi.mocked(processEngine.getSchema).mockReturnValue(schema);

      engine.onStatusEnter(task);

      expect(taskStateMachine.transition).toHaveBeenCalled();
    });

    it('#41 type.isLeaf = false when type not in schema', () => {
      const task = createTask({ type: 'unknown_type', status: 'pending' });
      vi.mocked(taskRepo.findChildren).mockReturnValue([]);

      const schema = createDefaultSchema();
      schema.behaviorRules = [
        {
          id: 'unknown-type-leaf-check',
          name: 'Check isLeaf false for unknown type',
          priority: 1,
          trigger: 'on_status_enter',
          condition: { field: 'type.isLeaf', op: 'eq', value: false },
          action: { type: 'transition', params: { targetStatus: 'done' } },
        },
      ];
      vi.mocked(processEngine.getSchema).mockReturnValue(schema);

      engine.onStatusEnter(task);

      expect(taskStateMachine.transition).toHaveBeenCalled();
    });

    it('#42 type.canDecompose = false when type not in schema', () => {
      const task = createTask({ type: 'unknown_type', status: 'pending' });
      vi.mocked(taskRepo.findChildren).mockReturnValue([]);

      const schema = createDefaultSchema();
      schema.behaviorRules = [
        {
          id: 'unknown-type-decompose-check',
          name: 'Check canDecompose false for unknown type',
          priority: 1,
          trigger: 'on_status_enter',
          condition: { field: 'type.canDecompose', op: 'eq', value: false },
          action: { type: 'transition', params: { targetStatus: 'done' } },
        },
      ];
      vi.mocked(processEngine.getSchema).mockReturnValue(schema);

      engine.onStatusEnter(task);

      expect(taskStateMachine.transition).toHaveBeenCalled();
    });
  });

  // ─── 1.4 Trigger matching & rule sorting ─────────────────────────

  describe('Trigger matching & rule sorting', () => {
    it('#43 only on_status_enter rules fire for onStatusEnter', () => {
      const task = createTask({ type: 'subtask', status: 'approved' });
      vi.mocked(taskRepo.findChildren).mockReturnValue([]);

      const schema = createDefaultSchema();
      // rule-1 is on_status_enter, rule-2 is on_all_children_terminal
      // Only rule-1 should fire if its condition matches
      vi.mocked(processEngine.getSchema).mockReturnValue(schema);

      engine.onStatusEnter(task);

      // rule-1 condition: status.category=terminal AND type.isLeaf=true
      // subtask is isLeaf=true, approved is terminal => matches rule-1
      expect(taskStateMachine.transition).toHaveBeenCalledTimes(1);
      expect(taskStateMachine.transition).toHaveBeenCalledWith(task.id, 'done');
    });

    it('#44 rules execute in priority ascending order', () => {
      const task = createTask({ type: 'subtask', status: 'approved' });
      vi.mocked(taskRepo.findChildren).mockReturnValue([]);

      const executionOrder: string[] = [];

      const schema = createDefaultSchema();
      schema.behaviorRules = [
        {
          id: 'rule-high',
          name: 'High priority (runs second)',
          priority: 20,
          trigger: 'on_status_enter',
          action: { type: 'transition', params: { targetStatus: 'done' } },
        },
        {
          id: 'rule-low',
          name: 'Low priority (runs first)',
          priority: 5,
          trigger: 'on_status_enter',
          action: { type: 'transition', params: { targetStatus: 'cancelled' } },
        },
      ];
      vi.mocked(processEngine.getSchema).mockReturnValue(schema);
      vi.mocked(taskStateMachine.transition).mockImplementation((_id, status) => {
        executionOrder.push(status);
        return undefined as never;
      });

      engine.onStatusEnter(task);

      expect(executionOrder).toEqual(['cancelled', 'done']);
    });

    it('#45 same priority preserves array order', () => {
      const task = createTask({ type: 'subtask', status: 'approved' });
      vi.mocked(taskRepo.findChildren).mockReturnValue([]);

      const executionOrder: string[] = [];

      const schema = createDefaultSchema();
      schema.behaviorRules = [
        {
          id: 'rule-a',
          name: 'Rule A',
          priority: 10,
          trigger: 'on_status_enter',
          action: { type: 'transition', params: { targetStatus: 'done' } },
        },
        {
          id: 'rule-b',
          name: 'Rule B',
          priority: 10,
          trigger: 'on_status_enter',
          action: { type: 'transition', params: { targetStatus: 'cancelled' } },
        },
      ];
      vi.mocked(processEngine.getSchema).mockReturnValue(schema);
      vi.mocked(taskStateMachine.transition).mockImplementation((_id, status) => {
        executionOrder.push(status);
        return undefined as never;
      });

      engine.onStatusEnter(task);

      expect(executionOrder).toEqual(['done', 'cancelled']);
    });

    it('#46 no matching rules causes no error', () => {
      const task = createTask({ type: 'subtask', status: 'approved' });
      vi.mocked(taskRepo.findChildren).mockReturnValue([]);

      const schema = createDefaultSchema();
      schema.behaviorRules = [
        {
          id: 'rule-nomatch',
          name: 'Never matches',
          priority: 10,
          trigger: 'on_status_enter',
          condition: { field: 'task.type', op: 'eq', value: 'nonexistent_type' },
          action: { type: 'transition', params: { targetStatus: 'done' } },
        },
      ];
      vi.mocked(processEngine.getSchema).mockReturnValue(schema);

      expect(() => engine.onStatusEnter(task)).not.toThrow();
      expect(taskStateMachine.transition).not.toHaveBeenCalled();
    });

    it('#47 schema not found causes silent return', () => {
      const task = createTask();
      vi.mocked(processEngine.getSchema).mockReturnValue(null);

      expect(() => engine.onStatusEnter(task)).not.toThrow();
      expect(taskStateMachine.transition).not.toHaveBeenCalled();
    });
  });

  // ─── 1.5 Action execution — transition ───────────────────────────

  describe('Action execution — transition', () => {
    it('#48 transition action calls taskStateMachine.transition', () => {
      const task = createTask({ type: 'subtask', status: 'approved' });
      vi.mocked(taskRepo.findChildren).mockReturnValue([]);

      const schema = createDefaultSchema();
      schema.behaviorRules = [
        {
          id: 'rule-transition',
          name: 'Transition rule',
          priority: 1,
          trigger: 'on_status_enter',
          action: { type: 'transition', params: { targetStatus: 'done' } },
        },
      ];
      vi.mocked(processEngine.getSchema).mockReturnValue(schema);

      engine.onStatusEnter(task);

      expect(taskStateMachine.transition).toHaveBeenCalledWith('task-1', 'done');
    });

    it('#49 transition missing targetStatus logs warn', () => {
      const task = createTask({ type: 'subtask', status: 'approved' });
      vi.mocked(taskRepo.findChildren).mockReturnValue([]);

      const schema = createDefaultSchema();
      schema.behaviorRules = [
        {
          id: 'rule-no-target',
          name: 'No target',
          priority: 1,
          trigger: 'on_status_enter',
          action: { type: 'transition', params: {} },
        },
      ];
      vi.mocked(processEngine.getSchema).mockReturnValue(schema);

      engine.onStatusEnter(task);

      expect(logger.warn).toHaveBeenCalledWith('Behavior action missing targetStatus', { taskId: task.id });
      expect(taskStateMachine.transition).not.toHaveBeenCalled();
    });

    it('#50 transition missing params logs warn', () => {
      const task = createTask({ type: 'subtask', status: 'approved' });
      vi.mocked(taskRepo.findChildren).mockReturnValue([]);

      const schema = createDefaultSchema();
      schema.behaviorRules = [
        {
          id: 'rule-no-params',
          name: 'No params',
          priority: 1,
          trigger: 'on_status_enter',
          action: { type: 'transition' },
        },
      ];
      vi.mocked(processEngine.getSchema).mockReturnValue(schema);

      engine.onStatusEnter(task);

      expect(logger.warn).toHaveBeenCalledWith('Behavior action missing targetStatus', { taskId: task.id });
      expect(taskStateMachine.transition).not.toHaveBeenCalled();
    });

    it('#51 unknown action type logs warn', () => {
      const task = createTask({ type: 'subtask', status: 'approved' });
      vi.mocked(taskRepo.findChildren).mockReturnValue([]);

      const schema = createDefaultSchema();
      schema.behaviorRules = [
        {
          id: 'rule-unknown-action',
          name: 'Unknown action',
          priority: 1,
          trigger: 'on_status_enter',
          action: { type: 'send_email' as never, params: { to: 'user@test.com' } },
        },
      ];
      vi.mocked(processEngine.getSchema).mockReturnValue(schema);

      engine.onStatusEnter(task);

      expect(logger.warn).toHaveBeenCalledWith('Unknown behavior action type', {
        type: 'send_email',
        taskId: task.id,
      });
      expect(taskStateMachine.transition).not.toHaveBeenCalled();
    });
  });

  // ─── 1.6 onStatusEnter ───────────────────────────────────────────

  describe('onStatusEnter', () => {
    it('#52 leaf task entering terminal matches Rule 1 of default schema', () => {
      const task = createTask({ type: 'subtask', status: 'approved' });
      vi.mocked(taskRepo.findChildren).mockReturnValue([]);

      engine.onStatusEnter(task);

      // subtask is isLeaf=true, approved has category=terminal => rule-1 matches
      expect(taskStateMachine.transition).toHaveBeenCalledWith(task.id, 'done');
    });

    it('#53 non-leaf task entering terminal — Rule 1 does not match', () => {
      const task = createTask({ type: 'task', status: 'approved' });
      vi.mocked(taskRepo.findChildren).mockReturnValue([]);

      engine.onStatusEnter(task);

      // task type is isLeaf=false => rule-1 condition fails
      expect(taskStateMachine.transition).not.toHaveBeenCalled();
    });

    it('#54 task entering active — Rule 1 does not match', () => {
      const task = createTask({ type: 'subtask', status: 'in_progress' });
      vi.mocked(taskRepo.findChildren).mockReturnValue([]);

      engine.onStatusEnter(task);

      // in_progress has category=active, not terminal => rule-1 condition fails
      expect(taskStateMachine.transition).not.toHaveBeenCalled();
    });

    it('#55 multiple matching rules execute in order', () => {
      const task = createTask({ type: 'subtask', status: 'approved' });
      vi.mocked(taskRepo.findChildren).mockReturnValue([]);

      const executionOrder: string[] = [];

      const schema = createDefaultSchema();
      schema.behaviorRules = [
        {
          id: 'rule-first',
          name: 'First rule',
          priority: 5,
          trigger: 'on_status_enter',
          condition: { field: 'type.isLeaf', op: 'eq', value: true },
          action: { type: 'transition', params: { targetStatus: 'cancelled' } },
        },
        {
          id: 'rule-second',
          name: 'Second rule',
          priority: 15,
          trigger: 'on_status_enter',
          condition: { field: 'status.category', op: 'eq', value: 'terminal' },
          action: { type: 'transition', params: { targetStatus: 'done' } },
        },
      ];
      vi.mocked(processEngine.getSchema).mockReturnValue(schema);
      vi.mocked(taskStateMachine.transition).mockImplementation((_id, status) => {
        executionOrder.push(status);
        return undefined as never;
      });

      engine.onStatusEnter(task);

      expect(executionOrder).toEqual(['cancelled', 'done']);
    });
  });

  // ─── 1.7 onChildCompleted ────────────────────────────────────────

  describe('onChildCompleted', () => {
    it('#56 all siblings terminal triggers on_all_children_terminal', () => {
      const parent = createTask({ id: 'parent-1', type: 'story', status: 'in_progress' });
      const child1 = createTask({ id: 'child-1', parentId: 'parent-1', type: 'task', status: 'done' });
      const child2 = createTask({ id: 'child-2', parentId: 'parent-1', type: 'task', status: 'done' });

      vi.mocked(taskRepo.findChildren).mockImplementation((parentId: string) => {
        if (parentId === 'parent-1') return [child1, child2];
        return [];
      });
      vi.mocked(processEngine.getStatusCategory).mockImplementation((_orgId, status) => {
        if (status === 'done') return 'terminal';
        if (status === 'in_progress') return 'active';
        return null;
      });
      vi.mocked(taskRepo.findById).mockReturnValue(parent);

      engine.onChildCompleted(child1);

      // rule-2 in default schema matches on_all_children_terminal with no condition
      expect(taskStateMachine.transition).toHaveBeenCalledWith('parent-1', 'done');
    });

    it('#57 some siblings non-terminal does not trigger', () => {
      const child1 = createTask({ id: 'child-1', parentId: 'parent-1', type: 'task', status: 'done' });
      const child2 = createTask({ id: 'child-2', parentId: 'parent-1', type: 'task', status: 'in_progress' });

      vi.mocked(taskRepo.findChildren).mockReturnValue([child1, child2]);
      vi.mocked(processEngine.getStatusCategory).mockImplementation((_orgId, status) => {
        if (status === 'done') return 'terminal';
        if (status === 'in_progress') return 'active';
        return null;
      });

      engine.onChildCompleted(child1);

      expect(taskStateMachine.transition).not.toHaveBeenCalled();
    });

    it('#58 child has no parentId returns immediately', () => {
      const child = createTask({ id: 'child-1', parentId: null });

      engine.onChildCompleted(child);

      expect(taskRepo.findChildren).not.toHaveBeenCalled();
      expect(taskStateMachine.transition).not.toHaveBeenCalled();
    });

    it('#59 parent not found returns', () => {
      const child = createTask({ id: 'child-1', parentId: 'parent-1', status: 'done' });

      vi.mocked(taskRepo.findChildren).mockReturnValue([child]);
      vi.mocked(processEngine.getStatusCategory).mockReturnValue('terminal');
      vi.mocked(taskRepo.findById).mockReturnValue(null);

      engine.onChildCompleted(child);

      expect(taskStateMachine.transition).not.toHaveBeenCalled();
    });

    it('#60 single child completed triggers (only sibling)', () => {
      const parent = createTask({ id: 'parent-1', type: 'story', status: 'in_progress' });
      const onlyChild = createTask({ id: 'child-1', parentId: 'parent-1', type: 'task', status: 'done' });

      vi.mocked(taskRepo.findChildren).mockImplementation((parentId: string) => {
        if (parentId === 'parent-1') return [onlyChild];
        return [];
      });
      vi.mocked(processEngine.getStatusCategory).mockImplementation((_orgId, status) => {
        if (status === 'done') return 'terminal';
        if (status === 'in_progress') return 'active';
        return null;
      });
      vi.mocked(taskRepo.findById).mockReturnValue(parent);

      engine.onChildCompleted(onlyChild);

      expect(taskStateMachine.transition).toHaveBeenCalledWith('parent-1', 'done');
    });
  });

  // ─── 1.8 Reentrancy guard ────────────────────────────────────────

  describe('Reentrancy guard', () => {
    it('#61 same taskId + trigger reentrant — second call skipped', () => {
      const task = createTask({ type: 'subtask', status: 'approved' });
      vi.mocked(taskRepo.findChildren).mockReturnValue([]);

      const schema = createDefaultSchema();
      schema.behaviorRules = [
        {
          id: 'rule-reentrant',
          name: 'Reentrant trigger',
          priority: 1,
          trigger: 'on_status_enter',
          action: { type: 'transition', params: { targetStatus: 'done' } },
        },
      ];
      vi.mocked(processEngine.getSchema).mockReturnValue(schema);

      // When transition is called, it triggers onStatusEnter again for the same task
      vi.mocked(taskStateMachine.transition).mockImplementation(() => {
        engine.onStatusEnter(task);
        return undefined as never;
      });

      engine.onStatusEnter(task);

      // transition called exactly once, the reentrant call was skipped
      expect(taskStateMachine.transition).toHaveBeenCalledTimes(1);
    });

    it('#62 different taskId same trigger — not blocked', () => {
      const task1 = createTask({ id: 'task-1', type: 'subtask', status: 'approved' });
      const task2 = createTask({ id: 'task-2', type: 'subtask', status: 'approved' });
      vi.mocked(taskRepo.findChildren).mockReturnValue([]);

      const schema = createDefaultSchema();
      schema.behaviorRules = [
        {
          id: 'rule-any',
          name: 'Any rule',
          priority: 1,
          trigger: 'on_status_enter',
          action: { type: 'transition', params: { targetStatus: 'done' } },
        },
      ];
      vi.mocked(processEngine.getSchema).mockReturnValue(schema);

      // When first task's transition fires, trigger onStatusEnter for task2
      let firstCall = true;
      vi.mocked(taskStateMachine.transition).mockImplementation(() => {
        if (firstCall) {
          firstCall = false;
          engine.onStatusEnter(task2);
        }
        return undefined as never;
      });

      engine.onStatusEnter(task1);

      // Both tasks should have triggered transitions
      expect(taskStateMachine.transition).toHaveBeenCalledTimes(2);
      expect(taskStateMachine.transition).toHaveBeenCalledWith('task-1', 'done');
      expect(taskStateMachine.transition).toHaveBeenCalledWith('task-2', 'done');
    });

    it('#63 same taskId different trigger — not blocked', () => {
      const task = createTask({ id: 'task-1', type: 'subtask', status: 'approved' });
      const parent = createTask({ id: 'parent-1', type: 'story', status: 'in_progress' });

      // We need both on_status_enter and on_all_children_terminal rules
      const schema = createDefaultSchema();
      schema.behaviorRules = [
        {
          id: 'rule-enter',
          name: 'Status enter rule',
          priority: 1,
          trigger: 'on_status_enter',
          action: { type: 'transition', params: { targetStatus: 'done' } },
        },
        {
          id: 'rule-children',
          name: 'Children terminal rule',
          priority: 1,
          trigger: 'on_all_children_terminal',
          action: { type: 'transition', params: { targetStatus: 'done' } },
        },
      ];
      vi.mocked(processEngine.getSchema).mockReturnValue(schema);

      // on_status_enter for task-1 triggers; inside its action, we call onChildCompleted
      // which will ultimately call evaluateAndExecute('on_all_children_terminal', parent-1)
      // But here we want to show same taskId with different trigger works.
      // Let's create a scenario where task-1 has on_status_enter,
      // and then inside the action we manually trigger on_all_children_terminal for task-1.
      const childTask = createTask({ id: 'child-for-task1', parentId: 'task-1', status: 'done' });

      vi.mocked(taskRepo.findChildren).mockImplementation((parentId: string) => {
        if (parentId === 'task-1') return [childTask];
        return [];
      });
      vi.mocked(processEngine.getStatusCategory).mockImplementation((_orgId, status) => {
        if (status === 'done') return 'terminal';
        if (status === 'approved') return 'terminal';
        if (status === 'in_progress') return 'active';
        return null;
      });
      vi.mocked(taskRepo.findById).mockReturnValue(task);

      // When transition fires for on_status_enter, call onChildCompleted to trigger on_all_children_terminal for task-1
      let firstCall = true;
      vi.mocked(taskStateMachine.transition).mockImplementation(() => {
        if (firstCall) {
          firstCall = false;
          engine.onChildCompleted(childTask);
        }
        return undefined as never;
      });

      engine.onStatusEnter(task);

      // on_status_enter for task-1 triggers transition once,
      // then on_all_children_terminal for task-1 triggers transition once
      expect(taskStateMachine.transition).toHaveBeenCalledTimes(2);
    });

    it('#64 key cleared after execution — can re-enter', () => {
      const task = createTask({ type: 'subtask', status: 'approved' });
      vi.mocked(taskRepo.findChildren).mockReturnValue([]);

      const schema = createDefaultSchema();
      schema.behaviorRules = [
        {
          id: 'rule-simple',
          name: 'Simple rule',
          priority: 1,
          trigger: 'on_status_enter',
          action: { type: 'transition', params: { targetStatus: 'done' } },
        },
      ];
      vi.mocked(processEngine.getSchema).mockReturnValue(schema);

      engine.onStatusEnter(task);
      engine.onStatusEnter(task);

      // Both calls should succeed since the key is cleared after each execution
      expect(taskStateMachine.transition).toHaveBeenCalledTimes(2);
    });

    it('#65 action throws — key still cleared', () => {
      const task = createTask({ type: 'subtask', status: 'approved' });
      vi.mocked(taskRepo.findChildren).mockReturnValue([]);

      const schema = createDefaultSchema();
      schema.behaviorRules = [
        {
          id: 'rule-throws',
          name: 'Throwing rule',
          priority: 1,
          trigger: 'on_status_enter',
          action: { type: 'transition', params: { targetStatus: 'done' } },
        },
      ];
      vi.mocked(processEngine.getSchema).mockReturnValue(schema);

      // First call: transition throws
      vi.mocked(taskStateMachine.transition).mockImplementationOnce(() => {
        throw new Error('Transition failed');
      });

      expect(() => engine.onStatusEnter(task)).toThrow('Transition failed');

      // Second call: transition succeeds — key should be cleared
      vi.mocked(taskStateMachine.transition).mockImplementation(() => undefined as never);

      engine.onStatusEnter(task);

      expect(taskStateMachine.transition).toHaveBeenCalledTimes(2);
    });
  });

  // ─── 1.9 Custom schema compatibility ─────────────────────────────

  describe('Custom schema compatibility', () => {
    it('#66 minimal schema (open -> working -> closed) works', () => {
      const task = createTask({ type: 'ticket', status: 'closed' });
      vi.mocked(taskRepo.findChildren).mockReturnValue([]);

      const minimalSchema: ProcessSchema = {
        workItemTypes: [
          { name: 'ticket', label: 'Ticket', isLeaf: true, allowedChildren: [], allowedAtRoot: true, canDecompose: false },
        ],
        statuses: [
          { name: 'open', label: 'Open', category: 'initial' },
          { name: 'working', label: 'Working', category: 'active' },
          { name: 'closed', label: 'Closed', category: 'terminal' },
        ],
        transitions: [
          { from: 'open', to: 'working' },
          { from: 'working', to: 'closed' },
        ],
        behaviorRules: [
          {
            id: 'auto-close',
            name: 'Auto close on terminal',
            priority: 1,
            trigger: 'on_status_enter',
            condition: { field: 'status.category', op: 'eq', value: 'terminal' },
            action: { type: 'transition', params: { targetStatus: 'closed' } },
          },
        ],
      };
      vi.mocked(processEngine.getSchema).mockReturnValue(minimalSchema);

      engine.onStatusEnter(task);

      expect(taskStateMachine.transition).toHaveBeenCalledWith(task.id, 'closed');
    });

    it('#67 schema with no behaviorRules causes silent return', () => {
      const task = createTask({ type: 'task', status: 'pending' });
      vi.mocked(taskRepo.findChildren).mockReturnValue([]);

      const emptyRulesSchema: ProcessSchema = {
        workItemTypes: [
          { name: 'task', label: 'Task', isLeaf: true, allowedChildren: [], allowedAtRoot: true, canDecompose: false },
        ],
        statuses: [
          { name: 'pending', label: 'Pending', category: 'initial' },
          { name: 'done', label: 'Done', category: 'terminal' },
        ],
        transitions: [{ from: 'pending', to: 'done' }],
        behaviorRules: [],
      };
      vi.mocked(processEngine.getSchema).mockReturnValue(emptyRulesSchema);

      expect(() => engine.onStatusEnter(task)).not.toThrow();
      expect(taskStateMachine.transition).not.toHaveBeenCalled();
    });

    it('#68 custom condition referencing custom type field', () => {
      const task = createTask({ type: 'incident', status: 'resolved' });
      vi.mocked(taskRepo.findChildren).mockReturnValue([]);

      const customSchema: ProcessSchema = {
        workItemTypes: [
          { name: 'incident', label: 'Incident', isLeaf: true, allowedChildren: [], allowedAtRoot: true, canDecompose: false },
          { name: 'change', label: 'Change Request', isLeaf: false, allowedChildren: ['incident'], allowedAtRoot: true, canDecompose: true },
        ],
        statuses: [
          { name: 'open', label: 'Open', category: 'initial' },
          { name: 'resolved', label: 'Resolved', category: 'terminal' },
        ],
        transitions: [{ from: 'open', to: 'resolved' }],
        behaviorRules: [
          {
            id: 'incident-auto-close',
            name: 'Auto-close resolved incidents',
            priority: 1,
            trigger: 'on_status_enter',
            condition: {
              all: [
                { field: 'type.isLeaf', op: 'eq', value: true },
                { field: 'type.canDecompose', op: 'eq', value: false },
                { field: 'task.type', op: 'eq', value: 'incident' },
                { field: 'status.category', op: 'eq', value: 'terminal' },
              ],
            },
            action: { type: 'transition', params: { targetStatus: 'resolved' } },
          },
        ],
      };
      vi.mocked(processEngine.getSchema).mockReturnValue(customSchema);

      engine.onStatusEnter(task);

      expect(taskStateMachine.transition).toHaveBeenCalledWith(task.id, 'resolved');
    });
  });
});
