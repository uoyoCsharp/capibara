/**
 * BehaviorEngine Unit Tests
 *
 * Covers: trigger matching, condition evaluation, boolean composition,
 * action collection, priority sorting, skip_propagation short-circuit,
 * and all edge cases.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BehaviorEngine } from '@main/application/workflow/behavior-engine.js';
import type { IWorkflowEngine } from '@main/core/interfaces/i-workflow-engine.js';
import type { ILogger } from '@main/core/interfaces/i-logger.js';
import type {
  WorkflowSchema,
  WorkItemTypeDefinition,
} from '@main/core/types/workflow-schema.types.js';
import type {
  BehaviorRule,
  BehaviorTrigger,
  BehaviorCondition,
  BehaviorAction,
  BehaviorContext,
} from '@main/core/types/behavior.types.js';

// ─── Mock Factories ─────────────────────────────────────────

function createMockLogger(): ILogger {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    child: vi.fn().mockReturnThis(),
  };
}

function createMockWorkflowEngine(): IWorkflowEngine {
  return {
    validateType: vi.fn(),
    getItemTypeDefinition: vi.fn(),
    getAllItemTypes: vi.fn(),
    getRootTypes: vi.fn(),
    canTransition: vi.fn(),
    getManualTransitions: vi.fn(),
    getAllStatuses: vi.fn(),
    getInitialStatus: vi.fn(),
    isTerminalStatus: vi.fn(),
    isReviewStatus: vi.fn(),
    isActiveStatus: vi.fn(),
    getFirstReviewStatus: vi.fn(),
    findTransitionTargetByCategory: vi.fn(),
    evaluateBehaviors: vi.fn(),
    getActiveSchema: vi.fn(),
    saveSchema: vi.fn(),
    analyzeImpactReadOnly: vi.fn(),
    validateSchemaIntegrity: vi.fn(),
    invalidateCache: vi.fn(),
  } as IWorkflowEngine;
}

function createContext(overrides: Partial<BehaviorContext> = {}): BehaviorContext {
  return {
    taskId: 'task-1',
    orgId: 'org-1',
    taskType: 'story',
    taskStatus: 'in_progress',
    parentTaskId: 'task-parent',
    parentTaskType: 'epic',
    parentTaskStatus: 'in_progress',
    childCount: 0,
    childTypes: [],
    childStatuses: [],
    ...overrides,
  };
}

function createTypeDef(overrides: Partial<WorkItemTypeDefinition> = {}): WorkItemTypeDefinition {
  return {
    name: 'story',
    label: 'Story',
    isLeaf: false,
    allowedChildren: ['subtask'],
    allowedAtRoot: false,
    canDecompose: true,
    hasDiscussionGroup: false,
    ...overrides,
  };
}

function createRule(overrides: Partial<BehaviorRule> = {}): BehaviorRule {
  return {
    id: overrides.id ?? 'rule-1',
    name: overrides.name ?? 'Test Rule',
    priority: overrides.priority ?? 10,
    trigger: overrides.trigger ?? { type: 'on_task_created' },
    condition: overrides.condition ?? { type: 'always' },
    action: overrides.action ?? { type: 'auto_transition', targetStatus: 'done' },
  };
}

function createSchema(
  rules: BehaviorRule[],
  types: WorkItemTypeDefinition[] = [createTypeDef()],
): WorkflowSchema {
  return {
    workItemTypes: types,
    statuses: [],
    transitions: [],
    behaviorRules: rules,
  };
}

// ─── Tests ──────────────────────────────────────────────────

describe('BehaviorEngine', () => {
  let engine: BehaviorEngine;
  let mockLogger: ILogger;
  let mockWorkflowEngine: IWorkflowEngine;

  beforeEach(() => {
    mockLogger = createMockLogger();
    mockWorkflowEngine = createMockWorkflowEngine();
    engine = new BehaviorEngine(mockWorkflowEngine, mockLogger);
  });

  // ═══════════════════════════════════════════════════════════
  // Trigger Matching
  // ═══════════════════════════════════════════════════════════

  describe('trigger matching', () => {
    it('should match on_task_created trigger', () => {
      const rule = createRule({ trigger: { type: 'on_task_created' } });
      const schema = createSchema([rule]);
      const trigger: BehaviorTrigger = { type: 'on_task_created' };

      const actions = engine.evaluate(schema, trigger, createContext());

      expect(actions).toHaveLength(1);
      expect(actions[0]).toEqual(rule.action);
    });

    it('should match on_all_children_terminal trigger', () => {
      const rule = createRule({ trigger: { type: 'on_all_children_terminal' } });
      const schema = createSchema([rule]);
      const trigger: BehaviorTrigger = { type: 'on_all_children_terminal' };

      const actions = engine.evaluate(schema, trigger, createContext());

      expect(actions).toHaveLength(1);
    });

    it('should match on_status_enter trigger with matching status', () => {
      const rule = createRule({
        trigger: { type: 'on_status_enter', status: 'in_review' },
      });
      const schema = createSchema([rule]);
      const trigger: BehaviorTrigger = { type: 'on_status_enter', status: 'in_review' };

      const actions = engine.evaluate(schema, trigger, createContext());

      expect(actions).toHaveLength(1);
    });

    it('should NOT match on_status_enter trigger with different status', () => {
      const rule = createRule({
        trigger: { type: 'on_status_enter', status: 'in_review' },
      });
      const schema = createSchema([rule]);
      const trigger: BehaviorTrigger = { type: 'on_status_enter', status: 'done' };

      const actions = engine.evaluate(schema, trigger, createContext());

      expect(actions).toHaveLength(0);
    });

    it('should match on_children_of_type_terminal when event childTypes is superset of rule childTypes', () => {
      const rule = createRule({
        trigger: { type: 'on_children_of_type_terminal', childTypes: ['subtask'] },
      });
      const schema = createSchema([rule]);
      const trigger: BehaviorTrigger = {
        type: 'on_children_of_type_terminal',
        childTypes: ['subtask', 'bug'],
      };

      const actions = engine.evaluate(schema, trigger, createContext());

      expect(actions).toHaveLength(1);
    });

    it('should match on_children_of_type_terminal when event childTypes exactly matches rule childTypes', () => {
      const rule = createRule({
        trigger: { type: 'on_children_of_type_terminal', childTypes: ['subtask', 'bug'] },
      });
      const schema = createSchema([rule]);
      const trigger: BehaviorTrigger = {
        type: 'on_children_of_type_terminal',
        childTypes: ['subtask', 'bug'],
      };

      const actions = engine.evaluate(schema, trigger, createContext());

      expect(actions).toHaveLength(1);
    });

    it('should NOT match on_children_of_type_terminal when event childTypes is subset of rule childTypes', () => {
      const rule = createRule({
        trigger: { type: 'on_children_of_type_terminal', childTypes: ['subtask', 'bug'] },
      });
      const schema = createSchema([rule]);
      const trigger: BehaviorTrigger = {
        type: 'on_children_of_type_terminal',
        childTypes: ['subtask'],
      };

      const actions = engine.evaluate(schema, trigger, createContext());

      expect(actions).toHaveLength(0);
    });

    it('should NOT match triggers of different types', () => {
      const rule = createRule({ trigger: { type: 'on_task_created' } });
      const schema = createSchema([rule]);
      const trigger: BehaviorTrigger = { type: 'on_all_children_terminal' };

      const actions = engine.evaluate(schema, trigger, createContext());

      expect(actions).toHaveLength(0);
    });

    it('should NOT match on_status_enter trigger against on_task_created event', () => {
      const rule = createRule({
        trigger: { type: 'on_status_enter', status: 'done' },
      });
      const schema = createSchema([rule]);
      const trigger: BehaviorTrigger = { type: 'on_task_created' };

      const actions = engine.evaluate(schema, trigger, createContext());

      expect(actions).toHaveLength(0);
    });

    it('should NOT match on_children_of_type_terminal against on_all_children_terminal event', () => {
      const rule = createRule({
        trigger: { type: 'on_children_of_type_terminal', childTypes: ['subtask'] },
      });
      const schema = createSchema([rule]);
      const trigger: BehaviorTrigger = { type: 'on_all_children_terminal' };

      const actions = engine.evaluate(schema, trigger, createContext());

      expect(actions).toHaveLength(0);
    });
  });

  // ═══════════════════════════════════════════════════════════
  // Condition Evaluation — Simple Conditions
  // ═══════════════════════════════════════════════════════════

  describe('condition evaluation — simple conditions', () => {
    const trigger: BehaviorTrigger = { type: 'on_task_created' };

    it('should always pass with "always" condition', () => {
      const rule = createRule({ condition: { type: 'always' } });
      const schema = createSchema([rule]);

      const actions = engine.evaluate(schema, trigger, createContext());

      expect(actions).toHaveLength(1);
    });

    it('should pass item_is_leaf when type is leaf', () => {
      const leafType = createTypeDef({ name: 'subtask', isLeaf: true });
      const rule = createRule({ condition: { type: 'item_is_leaf' } });
      const schema = createSchema([rule], [leafType]);
      const context = createContext({ taskType: 'subtask' });

      const actions = engine.evaluate(schema, trigger, context);

      expect(actions).toHaveLength(1);
    });

    it('should fail item_is_leaf when type is not leaf', () => {
      const nonLeafType = createTypeDef({ name: 'epic', isLeaf: false });
      const rule = createRule({ condition: { type: 'item_is_leaf' } });
      const schema = createSchema([rule], [nonLeafType]);
      const context = createContext({ taskType: 'epic' });

      const actions = engine.evaluate(schema, trigger, context);

      expect(actions).toHaveLength(0);
    });

    it('should fail item_is_leaf when type definition is not found in schema', () => {
      const rule = createRule({ condition: { type: 'item_is_leaf' } });
      const schema = createSchema([rule], []); // no type defs
      const context = createContext({ taskType: 'unknown_type' });

      const actions = engine.evaluate(schema, trigger, context);

      expect(actions).toHaveLength(0);
    });

    it('should pass item_has_no_children when childCount is 0', () => {
      const rule = createRule({ condition: { type: 'item_has_no_children' } });
      const schema = createSchema([rule]);
      const context = createContext({ childCount: 0 });

      const actions = engine.evaluate(schema, trigger, context);

      expect(actions).toHaveLength(1);
    });

    it('should fail item_has_no_children when childCount > 0', () => {
      const rule = createRule({ condition: { type: 'item_has_no_children' } });
      const schema = createSchema([rule]);
      const context = createContext({ childCount: 3 });

      const actions = engine.evaluate(schema, trigger, context);

      expect(actions).toHaveLength(0);
    });

    it('should pass item_type_in when taskType is in the list', () => {
      const rule = createRule({
        condition: { type: 'item_type_in', types: ['story', 'bug'] },
      });
      const schema = createSchema([rule]);
      const context = createContext({ taskType: 'story' });

      const actions = engine.evaluate(schema, trigger, context);

      expect(actions).toHaveLength(1);
    });

    it('should fail item_type_in when taskType is not in the list', () => {
      const rule = createRule({
        condition: { type: 'item_type_in', types: ['story', 'bug'] },
      });
      const schema = createSchema([rule]);
      const context = createContext({ taskType: 'epic' });

      const actions = engine.evaluate(schema, trigger, context);

      expect(actions).toHaveLength(0);
    });

    it('should pass item_in_status when taskStatus is in the list', () => {
      const rule = createRule({
        condition: { type: 'item_in_status', statuses: ['in_progress', 'in_review'] },
      });
      const schema = createSchema([rule]);
      const context = createContext({ taskStatus: 'in_review' });

      const actions = engine.evaluate(schema, trigger, context);

      expect(actions).toHaveLength(1);
    });

    it('should fail item_in_status when taskStatus is not in the list', () => {
      const rule = createRule({
        condition: { type: 'item_in_status', statuses: ['in_progress', 'in_review'] },
      });
      const schema = createSchema([rule]);
      const context = createContext({ taskStatus: 'done' });

      const actions = engine.evaluate(schema, trigger, context);

      expect(actions).toHaveLength(0);
    });

    it('should pass parent_in_status when parentTaskStatus is in the list', () => {
      const rule = createRule({
        condition: { type: 'parent_in_status', statuses: ['in_progress'] },
      });
      const schema = createSchema([rule]);
      const context = createContext({ parentTaskStatus: 'in_progress' });

      const actions = engine.evaluate(schema, trigger, context);

      expect(actions).toHaveLength(1);
    });

    it('should fail parent_in_status when parentTaskStatus is not in the list', () => {
      const rule = createRule({
        condition: { type: 'parent_in_status', statuses: ['in_progress'] },
      });
      const schema = createSchema([rule]);
      const context = createContext({ parentTaskStatus: 'done' });

      const actions = engine.evaluate(schema, trigger, context);

      expect(actions).toHaveLength(0);
    });

    it('should fail parent_in_status when parentTaskStatus is null (no parent)', () => {
      const rule = createRule({
        condition: { type: 'parent_in_status', statuses: ['in_progress'] },
      });
      const schema = createSchema([rule]);
      const context = createContext({ parentTaskStatus: null });

      const actions = engine.evaluate(schema, trigger, context);

      expect(actions).toHaveLength(0);
    });
  });

  // ═══════════════════════════════════════════════════════════
  // Condition Evaluation — Boolean Composition
  // ═══════════════════════════════════════════════════════════

  describe('condition evaluation — boolean composition', () => {
    const trigger: BehaviorTrigger = { type: 'on_task_created' };

    it('should pass "and" when all sub-conditions are true', () => {
      const rule = createRule({
        condition: {
          type: 'and',
          conditions: [
            { type: 'always' },
            { type: 'item_has_no_children' },
          ],
        },
      });
      const schema = createSchema([rule]);
      const context = createContext({ childCount: 0 });

      const actions = engine.evaluate(schema, trigger, context);

      expect(actions).toHaveLength(1);
    });

    it('should fail "and" when any sub-condition is false', () => {
      const rule = createRule({
        condition: {
          type: 'and',
          conditions: [
            { type: 'always' },
            { type: 'item_has_no_children' },
          ],
        },
      });
      const schema = createSchema([rule]);
      const context = createContext({ childCount: 5 });

      const actions = engine.evaluate(schema, trigger, context);

      expect(actions).toHaveLength(0);
    });

    it('should pass "and" with empty conditions array (vacuous truth)', () => {
      const rule = createRule({
        condition: { type: 'and', conditions: [] },
      });
      const schema = createSchema([rule]);

      const actions = engine.evaluate(schema, trigger, createContext());

      expect(actions).toHaveLength(1);
    });

    it('should pass "or" when at least one sub-condition is true', () => {
      const rule = createRule({
        condition: {
          type: 'or',
          conditions: [
            { type: 'item_type_in', types: ['bug'] },     // false (taskType is 'story')
            { type: 'item_has_no_children' },               // true
          ],
        },
      });
      const schema = createSchema([rule]);
      const context = createContext({ childCount: 0 });

      const actions = engine.evaluate(schema, trigger, context);

      expect(actions).toHaveLength(1);
    });

    it('should fail "or" when all sub-conditions are false', () => {
      const rule = createRule({
        condition: {
          type: 'or',
          conditions: [
            { type: 'item_type_in', types: ['bug'] },
            { type: 'item_in_status', statuses: ['done'] },
          ],
        },
      });
      const schema = createSchema([rule]);
      const context = createContext({ taskType: 'story', taskStatus: 'in_progress' });

      const actions = engine.evaluate(schema, trigger, context);

      expect(actions).toHaveLength(0);
    });

    it('should fail "or" with empty conditions array (vacuous falsehood)', () => {
      const rule = createRule({
        condition: { type: 'or', conditions: [] },
      });
      const schema = createSchema([rule]);

      const actions = engine.evaluate(schema, trigger, createContext());

      expect(actions).toHaveLength(0);
    });

    it('should negate a true condition with "not"', () => {
      const rule = createRule({
        condition: { type: 'not', condition: { type: 'always' } },
      });
      const schema = createSchema([rule]);

      const actions = engine.evaluate(schema, trigger, createContext());

      expect(actions).toHaveLength(0);
    });

    it('should negate a false condition with "not"', () => {
      const rule = createRule({
        condition: {
          type: 'not',
          condition: { type: 'item_type_in', types: ['bug'] },
        },
      });
      const schema = createSchema([rule]);
      const context = createContext({ taskType: 'story' });

      const actions = engine.evaluate(schema, trigger, context);

      expect(actions).toHaveLength(1);
    });

    it('should handle deeply nested boolean composition', () => {
      // not(and(item_type_in(['story']), or(item_has_no_children, item_in_status(['done']))))
      // story with children and status in_progress → and = true (story matches, or = false? no...)
      // Let's trace:
      //   item_type_in(['story']) → true (taskType = 'story')
      //   item_has_no_children → false (childCount = 2)
      //   item_in_status(['done']) → false (status = 'in_progress')
      //   or(false, false) → false
      //   and(true, false) → false
      //   not(false) → true
      const rule = createRule({
        condition: {
          type: 'not',
          condition: {
            type: 'and',
            conditions: [
              { type: 'item_type_in', types: ['story'] },
              {
                type: 'or',
                conditions: [
                  { type: 'item_has_no_children' },
                  { type: 'item_in_status', statuses: ['done'] },
                ],
              },
            ],
          },
        },
      });
      const schema = createSchema([rule]);
      const context = createContext({ taskType: 'story', childCount: 2, taskStatus: 'in_progress' });

      const actions = engine.evaluate(schema, trigger, context);

      expect(actions).toHaveLength(1);
    });

    it('should handle double negation: not(not(always)) → true', () => {
      const rule = createRule({
        condition: {
          type: 'not',
          condition: { type: 'not', condition: { type: 'always' } },
        },
      });
      const schema = createSchema([rule]);

      const actions = engine.evaluate(schema, trigger, createContext());

      expect(actions).toHaveLength(1);
    });

    it('should handle "and" with single condition', () => {
      const rule = createRule({
        condition: {
          type: 'and',
          conditions: [{ type: 'item_type_in', types: ['story'] }],
        },
      });
      const schema = createSchema([rule]);
      const context = createContext({ taskType: 'story' });

      const actions = engine.evaluate(schema, trigger, context);

      expect(actions).toHaveLength(1);
    });

    it('should handle "or" with single condition', () => {
      const rule = createRule({
        condition: {
          type: 'or',
          conditions: [{ type: 'item_type_in', types: ['bug'] }],
        },
      });
      const schema = createSchema([rule]);
      const context = createContext({ taskType: 'story' });

      const actions = engine.evaluate(schema, trigger, context);

      expect(actions).toHaveLength(0);
    });
  });

  // ═══════════════════════════════════════════════════════════
  // Priority Sorting
  // ═══════════════════════════════════════════════════════════

  describe('priority sorting', () => {
    const trigger: BehaviorTrigger = { type: 'on_task_created' };

    it('should execute rules in ascending priority order', () => {
      const actionLow: BehaviorAction = { type: 'wake_assignee', trigger: 'low' };
      const actionHigh: BehaviorAction = { type: 'wake_assignee', trigger: 'high' };

      const rules = [
        createRule({ id: 'r-high', priority: 50, action: actionHigh }),
        createRule({ id: 'r-low', priority: 10, action: actionLow }),
      ];
      const schema = createSchema(rules);

      const actions = engine.evaluate(schema, trigger, createContext());

      expect(actions).toHaveLength(2);
      expect(actions[0]).toEqual(actionLow);   // priority 10 first
      expect(actions[1]).toEqual(actionHigh);   // priority 50 second
    });

    it('should handle rules with equal priority (stable order from filter)', () => {
      const actionA: BehaviorAction = { type: 'auto_transition', targetStatus: 'a' };
      const actionB: BehaviorAction = { type: 'auto_transition', targetStatus: 'b' };

      const rules = [
        createRule({ id: 'r-a', priority: 10, action: actionA }),
        createRule({ id: 'r-b', priority: 10, action: actionB }),
      ];
      const schema = createSchema(rules);

      const actions = engine.evaluate(schema, trigger, createContext());

      expect(actions).toHaveLength(2);
    });
  });

  // ═══════════════════════════════════════════════════════════
  // Action Collection & Types
  // ═══════════════════════════════════════════════════════════

  describe('action collection', () => {
    const trigger: BehaviorTrigger = { type: 'on_task_created' };

    it('should collect auto_transition action', () => {
      const action: BehaviorAction = { type: 'auto_transition', targetStatus: 'done' };
      const rule = createRule({ action });
      const schema = createSchema([rule]);

      const actions = engine.evaluate(schema, trigger, createContext());

      expect(actions[0]).toEqual({ type: 'auto_transition', targetStatus: 'done' });
    });

    it('should collect wake_assignee action', () => {
      const action: BehaviorAction = { type: 'wake_assignee', trigger: 'task_assigned' };
      const rule = createRule({ action });
      const schema = createSchema([rule]);

      const actions = engine.evaluate(schema, trigger, createContext());

      expect(actions[0]).toEqual({ type: 'wake_assignee', trigger: 'task_assigned' });
    });

    it('should collect wake_parent_assignee action', () => {
      const action: BehaviorAction = { type: 'wake_parent_assignee', trigger: 'review_needed' };
      const rule = createRule({ action });
      const schema = createSchema([rule]);

      const actions = engine.evaluate(schema, trigger, createContext());

      expect(actions[0]).toEqual({ type: 'wake_parent_assignee', trigger: 'review_needed' });
    });

    it('should collect create_discussion_group action', () => {
      const action: BehaviorAction = { type: 'create_discussion_group' };
      const rule = createRule({ action });
      const schema = createSchema([rule]);

      const actions = engine.evaluate(schema, trigger, createContext());

      expect(actions[0]).toEqual({ type: 'create_discussion_group' });
    });

    it('should collect multiple actions from multiple matching rules', () => {
      const rules = [
        createRule({
          id: 'r1',
          priority: 1,
          action: { type: 'auto_transition', targetStatus: 'active' },
        }),
        createRule({
          id: 'r2',
          priority: 2,
          action: { type: 'wake_assignee', trigger: 'task_assigned' },
        }),
        createRule({
          id: 'r3',
          priority: 3,
          action: { type: 'create_discussion_group' },
        }),
      ];
      const schema = createSchema(rules);

      const actions = engine.evaluate(schema, trigger, createContext());

      expect(actions).toHaveLength(3);
    });
  });

  // ═══════════════════════════════════════════════════════════
  // skip_propagation Short-Circuit
  // ═══════════════════════════════════════════════════════════

  describe('skip_propagation short-circuit', () => {
    const trigger: BehaviorTrigger = { type: 'on_task_created' };

    it('should stop processing after skip_propagation action', () => {
      const rules = [
        createRule({
          id: 'r1',
          priority: 1,
          action: { type: 'auto_transition', targetStatus: 'active' },
        }),
        createRule({
          id: 'r2',
          priority: 2,
          action: { type: 'skip_propagation' },
        }),
        createRule({
          id: 'r3',
          priority: 3,
          action: { type: 'wake_assignee', trigger: 'task_assigned' },
        }),
      ];
      const schema = createSchema(rules);

      const actions = engine.evaluate(schema, trigger, createContext());

      expect(actions).toHaveLength(2);
      expect(actions[0]).toEqual({ type: 'auto_transition', targetStatus: 'active' });
      expect(actions[1]).toEqual({ type: 'skip_propagation' });
    });

    it('should include skip_propagation in the returned actions', () => {
      const rules = [
        createRule({
          id: 'r1',
          priority: 1,
          action: { type: 'skip_propagation' },
        }),
      ];
      const schema = createSchema(rules);

      const actions = engine.evaluate(schema, trigger, createContext());

      expect(actions).toHaveLength(1);
      expect(actions[0]).toEqual({ type: 'skip_propagation' });
    });

    it('should only short-circuit skip_propagation, not other actions', () => {
      const rules = [
        createRule({
          id: 'r1',
          priority: 1,
          action: { type: 'auto_transition', targetStatus: 'done' },
        }),
        createRule({
          id: 'r2',
          priority: 2,
          action: { type: 'auto_transition', targetStatus: 'archived' },
        }),
      ];
      const schema = createSchema(rules);

      const actions = engine.evaluate(schema, trigger, createContext());

      expect(actions).toHaveLength(2);
    });

    it('should skip_propagation as first rule still returns that single action', () => {
      const rules = [
        createRule({
          id: 'r-skip',
          priority: 1,
          action: { type: 'skip_propagation' },
        }),
        createRule({
          id: 'r-after',
          priority: 2,
          action: { type: 'auto_transition', targetStatus: 'done' },
        }),
        createRule({
          id: 'r-after2',
          priority: 3,
          action: { type: 'wake_assignee', trigger: 'test' },
        }),
      ];
      const schema = createSchema(rules);

      const actions = engine.evaluate(schema, trigger, createContext());

      expect(actions).toHaveLength(1);
      expect(actions[0]).toEqual({ type: 'skip_propagation' });
    });
  });

  // ═══════════════════════════════════════════════════════════
  // Edge Cases & Boundary Conditions
  // ═══════════════════════════════════════════════════════════

  describe('edge cases', () => {
    const trigger: BehaviorTrigger = { type: 'on_task_created' };

    it('should return empty array when schema has no behavior rules', () => {
      const schema = createSchema([]);

      const actions = engine.evaluate(schema, trigger, createContext());

      expect(actions).toHaveLength(0);
    });

    it('should return empty array when no rules match the trigger', () => {
      const rule = createRule({
        trigger: { type: 'on_all_children_terminal' },
      });
      const schema = createSchema([rule]);

      const actions = engine.evaluate(schema, trigger, createContext());

      expect(actions).toHaveLength(0);
    });

    it('should return empty array when rules match trigger but all conditions fail', () => {
      const rule = createRule({
        condition: { type: 'item_type_in', types: ['nonexistent'] },
      });
      const schema = createSchema([rule]);

      const actions = engine.evaluate(schema, trigger, createContext());

      expect(actions).toHaveLength(0);
    });

    it('should handle unknown condition type by returning false', () => {
      const rule = createRule({
        condition: { type: 'some_future_condition' } as any,
      });
      const schema = createSchema([rule]);

      const actions = engine.evaluate(schema, trigger, createContext());

      expect(actions).toHaveLength(0);
    });

    it('should resolve typeDef as null when taskType not found in schema workItemTypes', () => {
      const rule = createRule({ condition: { type: 'item_is_leaf' } });
      const schema = createSchema([rule], [createTypeDef({ name: 'epic' })]);
      // context.taskType = 'story' but schema only has 'epic'
      const context = createContext({ taskType: 'story' });

      const actions = engine.evaluate(schema, trigger, context);

      // item_is_leaf checks typeDef?.isLeaf === true → null?.isLeaf → false
      expect(actions).toHaveLength(0);
    });

    it('should correctly resolve typeDef for the context taskType, not some other type', () => {
      const types = [
        createTypeDef({ name: 'story', isLeaf: false }),
        createTypeDef({ name: 'subtask', isLeaf: true }),
      ];
      const rule = createRule({ condition: { type: 'item_is_leaf' } });
      const schema = createSchema([rule], types);
      const context = createContext({ taskType: 'subtask' });

      const actions = engine.evaluate(schema, trigger, context);

      expect(actions).toHaveLength(1);
    });

    it('should handle item_type_in with empty types array', () => {
      const rule = createRule({
        condition: { type: 'item_type_in', types: [] },
      });
      const schema = createSchema([rule]);

      const actions = engine.evaluate(schema, trigger, createContext());

      expect(actions).toHaveLength(0);
    });

    it('should handle item_in_status with empty statuses array', () => {
      const rule = createRule({
        condition: { type: 'item_in_status', statuses: [] },
      });
      const schema = createSchema([rule]);

      const actions = engine.evaluate(schema, trigger, createContext());

      expect(actions).toHaveLength(0);
    });

    it('should handle parent_in_status with empty statuses array', () => {
      const rule = createRule({
        condition: { type: 'parent_in_status', statuses: [] },
      });
      const schema = createSchema([rule]);

      const actions = engine.evaluate(schema, trigger, createContext());

      expect(actions).toHaveLength(0);
    });

    it('should handle on_children_of_type_terminal with empty childTypes in rule', () => {
      const rule = createRule({
        trigger: { type: 'on_children_of_type_terminal', childTypes: [] },
      });
      const schema = createSchema([rule]);
      const trigger: BehaviorTrigger = {
        type: 'on_children_of_type_terminal',
        childTypes: ['subtask'],
      };

      // empty.every(...) is vacuously true
      const actions = engine.evaluate(schema, trigger, createContext());

      expect(actions).toHaveLength(1);
    });

    it('should handle on_children_of_type_terminal with empty childTypes in event', () => {
      const rule = createRule({
        trigger: { type: 'on_children_of_type_terminal', childTypes: ['subtask'] },
      });
      const schema = createSchema([rule]);
      const trigger: BehaviorTrigger = {
        type: 'on_children_of_type_terminal',
        childTypes: [],
      };

      // 'subtask' not in [] → false
      const actions = engine.evaluate(schema, trigger, createContext());

      expect(actions).toHaveLength(0);
    });
  });

  // ═══════════════════════════════════════════════════════════
  // Logging
  // ═══════════════════════════════════════════════════════════

  describe('logging', () => {
    it('should log debug message for each fired rule', () => {
      const trigger: BehaviorTrigger = { type: 'on_task_created' };
      const rules = [
        createRule({ id: 'rule-a', name: 'Rule A', priority: 1 }),
        createRule({ id: 'rule-b', name: 'Rule B', priority: 2 }),
      ];
      const schema = createSchema(rules);
      const context = createContext();

      engine.evaluate(schema, trigger, context);

      expect(mockLogger.debug).toHaveBeenCalledTimes(2);
      expect(mockLogger.debug).toHaveBeenCalledWith('Behavior rule fired', {
        ruleId: 'rule-a',
        ruleName: 'Rule A',
        taskId: 'task-1',
        action: 'auto_transition',
      });
      expect(mockLogger.debug).toHaveBeenCalledWith('Behavior rule fired', {
        ruleId: 'rule-b',
        ruleName: 'Rule B',
        taskId: 'task-1',
        action: 'auto_transition',
      });
    });

    it('should not log for rules whose conditions fail', () => {
      const trigger: BehaviorTrigger = { type: 'on_task_created' };
      const rules = [
        createRule({
          id: 'rule-fail',
          condition: { type: 'item_type_in', types: ['nonexistent'] },
        }),
      ];
      const schema = createSchema(rules);

      engine.evaluate(schema, trigger, createContext());

      expect(mockLogger.debug).not.toHaveBeenCalled();
    });

    it('should not log for rules that do not match the trigger', () => {
      const trigger: BehaviorTrigger = { type: 'on_task_created' };
      const rules = [
        createRule({ trigger: { type: 'on_all_children_terminal' } }),
      ];
      const schema = createSchema(rules);

      engine.evaluate(schema, trigger, createContext());

      expect(mockLogger.debug).not.toHaveBeenCalled();
    });
  });

  // ═══════════════════════════════════════════════════════════
  // Complex Scenarios (Integration-like)
  // ═══════════════════════════════════════════════════════════

  describe('complex scenarios', () => {
    it('should handle a realistic workflow: leaf task auto-transitions on creation', () => {
      const types = [
        createTypeDef({ name: 'subtask', isLeaf: true }),
        createTypeDef({ name: 'story', isLeaf: false }),
      ];
      const rules = [
        createRule({
          id: 'auto-start-leaf',
          name: 'Auto-start leaf tasks',
          priority: 10,
          trigger: { type: 'on_task_created' },
          condition: { type: 'item_is_leaf' },
          action: { type: 'auto_transition', targetStatus: 'in_progress' },
        }),
        createRule({
          id: 'wake-assignee',
          name: 'Wake assignee on creation',
          priority: 20,
          trigger: { type: 'on_task_created' },
          condition: { type: 'always' },
          action: { type: 'wake_assignee', trigger: 'task_assigned' },
        }),
      ];
      const schema = createSchema(rules, types);
      const trigger: BehaviorTrigger = { type: 'on_task_created' };

      // Leaf task: both rules fire
      const leafActions = engine.evaluate(schema, trigger, createContext({ taskType: 'subtask' }));
      expect(leafActions).toHaveLength(2);
      expect(leafActions[0]).toEqual({ type: 'auto_transition', targetStatus: 'in_progress' });
      expect(leafActions[1]).toEqual({ type: 'wake_assignee', trigger: 'task_assigned' });

      // Non-leaf task: only wake rule fires
      const storyActions = engine.evaluate(schema, trigger, createContext({ taskType: 'story' }));
      expect(storyActions).toHaveLength(1);
      expect(storyActions[0]).toEqual({ type: 'wake_assignee', trigger: 'task_assigned' });
    });

    it('should handle skip_propagation blocking wake for specific types', () => {
      const types = [
        createTypeDef({ name: 'epic', isLeaf: false }),
        createTypeDef({ name: 'story', isLeaf: false }),
      ];
      const rules = [
        createRule({
          id: 'skip-epic-propagation',
          name: 'Skip propagation for epics',
          priority: 1,
          trigger: { type: 'on_task_created' },
          condition: { type: 'item_type_in', types: ['epic'] },
          action: { type: 'skip_propagation' },
        }),
        createRule({
          id: 'wake-all',
          name: 'Wake all on creation',
          priority: 10,
          trigger: { type: 'on_task_created' },
          condition: { type: 'always' },
          action: { type: 'wake_assignee', trigger: 'task_assigned' },
        }),
      ];
      const schema = createSchema(rules, types);
      const trigger: BehaviorTrigger = { type: 'on_task_created' };

      // Epic: skip_propagation fires, wake blocked
      const epicActions = engine.evaluate(schema, trigger, createContext({ taskType: 'epic' }));
      expect(epicActions).toHaveLength(1);
      expect(epicActions[0]).toEqual({ type: 'skip_propagation' });

      // Story: skip condition fails, wake fires
      const storyActions = engine.evaluate(schema, trigger, createContext({ taskType: 'story' }));
      expect(storyActions).toHaveLength(1);
      expect(storyActions[0]).toEqual({ type: 'wake_assignee', trigger: 'task_assigned' });
    });

    it('should handle parent propagation: auto-complete parent when all children done', () => {
      const rules = [
        createRule({
          id: 'auto-complete-parent',
          name: 'Auto-complete parent',
          priority: 10,
          trigger: { type: 'on_all_children_terminal' },
          condition: {
            type: 'and',
            conditions: [
              { type: 'item_type_in', types: ['epic', 'story'] },
              { type: 'not', condition: { type: 'item_is_leaf' } },
            ],
          },
          action: { type: 'auto_transition', targetStatus: 'done' },
        }),
      ];
      const types = [
        createTypeDef({ name: 'epic', isLeaf: false }),
        createTypeDef({ name: 'subtask', isLeaf: true }),
      ];
      const schema = createSchema(rules, types);
      const trigger: BehaviorTrigger = { type: 'on_all_children_terminal' };

      // Epic: matches type and not leaf → fires
      const epicActions = engine.evaluate(
        schema,
        trigger,
        createContext({ taskType: 'epic' }),
      );
      expect(epicActions).toHaveLength(1);
      expect(epicActions[0]).toEqual({ type: 'auto_transition', targetStatus: 'done' });

      // Subtask (leaf): matches type? No → fails
      const subtaskActions = engine.evaluate(
        schema,
        trigger,
        createContext({ taskType: 'subtask' }),
      );
      expect(subtaskActions).toHaveLength(0);
    });

    it('should handle multiple triggers: only matching trigger rules fire', () => {
      const rules = [
        createRule({
          id: 'on-create',
          priority: 1,
          trigger: { type: 'on_task_created' },
          action: { type: 'wake_assignee', trigger: 'task_assigned' },
        }),
        createRule({
          id: 'on-review',
          priority: 1,
          trigger: { type: 'on_status_enter', status: 'in_review' },
          action: { type: 'wake_parent_assignee', trigger: 'review_needed' },
        }),
        createRule({
          id: 'on-children-done',
          priority: 1,
          trigger: { type: 'on_all_children_terminal' },
          action: { type: 'auto_transition', targetStatus: 'done' },
        }),
      ];
      const schema = createSchema(rules);

      // Fire on_status_enter with 'in_review' → only the review rule should match
      const actions = engine.evaluate(
        schema,
        { type: 'on_status_enter', status: 'in_review' },
        createContext(),
      );
      expect(actions).toHaveLength(1);
      expect(actions[0]).toEqual({ type: 'wake_parent_assignee', trigger: 'review_needed' });
    });
  });
});
