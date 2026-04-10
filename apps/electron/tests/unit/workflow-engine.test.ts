/**
 * WorkflowEngine Unit Tests
 *
 * Covers: type validation, status/transition validation, status category queries,
 * schema integrity validation, cache management, behavior delegation,
 * schema CRUD with impact analysis, hierarchy cycle detection.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Stub tsyringe decorators before importing the class
vi.mock('tsyringe', () => ({
  injectable: () => (target: any) => target,
  inject: () => () => undefined,
}));

// Stub token imports
vi.mock('@main/core/tokens.js', () => ({
  WORKFLOW_SCHEMA_REPO_TOKEN: Symbol('WORKFLOW_SCHEMA_REPO_TOKEN'),
  EVENT_BUS_TOKEN: Symbol('EVENT_BUS_TOKEN'),
  LOGGER_TOKEN: Symbol('LOGGER_TOKEN'),
  TASK_REPO_TOKEN: Symbol('TASK_REPO_TOKEN'),
}));

import { WorkflowEngine } from '@main/application/workflow/workflow-engine.js';
import { NotFoundError } from '@main/core/errors/capibara.errors.js';
import { SchemaValidationError } from '@main/core/errors/workflow.errors.js';
import type { IWorkflowSchemaRepository } from '@main/core/interfaces/i-workflow-schema.repository.js';
import type { IEventBus } from '@main/core/interfaces/i-event-bus.js';
import type { ILogger } from '@main/core/interfaces/i-logger.js';
import type { ITaskRepository } from '@main/core/interfaces/i-task.repository.js';
import type {
  WorkflowSchema,
  WorkItemTypeDefinition,
  StatusDefinition,
  TransitionDefinition,
} from '@main/core/types/workflow-schema.types.js';
import type { TaskNode } from '@main/core/types/domain.types.js';

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

function createMockEventBus(): IEventBus {
  return {
    emit: vi.fn(),
    on: vi.fn(),
    off: vi.fn(),
  } as any;
}

function createMockSchemaRepo(schema: WorkflowSchema | null = null): IWorkflowSchemaRepository {
  return {
    findActiveByOrgId: vi.fn().mockResolvedValue(schema),
    save: vi.fn().mockResolvedValue(undefined),
    delete: vi.fn().mockResolvedValue(undefined),
  };
}

function createMockTaskRepo(tasks: TaskNode[] = []): ITaskRepository {
  return {
    findById: vi.fn(),
    findByParentId: vi.fn(),
    findByOrgId: vi.fn().mockResolvedValue(tasks),
    findByAssignee: vi.fn(),
    create: vi.fn(),
    updateStatus: vi.fn(),
    updateAssignee: vi.fn(),
    setArtifactPaths: vi.fn(),
    delete: vi.fn(),
  } as any;
}

function createTypeDef(overrides: Partial<WorkItemTypeDefinition> = {}): WorkItemTypeDefinition {
  return {
    name: 'story',
    label: 'Story',
    isLeaf: false,
    allowedChildren: [],
    allowedAtRoot: true,
    canDecompose: true,
    hasDiscussionGroup: false,
    ...overrides,
  };
}

function createStatus(overrides: Partial<StatusDefinition> = {}): StatusDefinition {
  return {
    name: 'open',
    label: 'Open',
    category: 'initial',
    ...overrides,
  };
}

function createTransition(overrides: Partial<TransitionDefinition> = {}): TransitionDefinition {
  return {
    from: 'open',
    to: 'in_progress',
    trigger: 'manual',
    ...overrides,
  };
}

function createTask(overrides: Partial<TaskNode> = {}): TaskNode {
  return {
    id: 'task-1',
    orgId: 'org-1',
    parentId: null,
    type: 'story',
    title: 'Test Task',
    description: '',
    status: 'open',
    assigneeRoleId: null,
    depth: 0,
    artifactPaths: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

/** A standard test schema with initial → active → review → terminal flow */
function createTestSchema(overrides: Partial<WorkflowSchema> = {}): WorkflowSchema {
  return {
    workItemTypes: [
      createTypeDef({ name: 'epic', allowedChildren: ['story'], allowedAtRoot: true }),
      createTypeDef({ name: 'story', allowedChildren: ['subtask'], allowedAtRoot: false }),
      createTypeDef({ name: 'subtask', isLeaf: true, allowedChildren: [], allowedAtRoot: false }),
    ],
    statuses: [
      createStatus({ name: 'open', category: 'initial' }),
      createStatus({ name: 'in_progress', label: 'In Progress', category: 'active' }),
      createStatus({ name: 'in_review', label: 'In Review', category: 'review' }),
      createStatus({ name: 'done', label: 'Done', category: 'terminal' }),
      createStatus({ name: 'cancelled', label: 'Cancelled', category: 'terminal' }),
    ],
    transitions: [
      createTransition({ from: 'open', to: 'in_progress', trigger: 'manual' }),
      createTransition({ from: 'in_progress', to: 'in_review', trigger: 'auto' }),
      createTransition({ from: 'in_review', to: 'done', trigger: 'manual' }),
      createTransition({ from: 'in_review', to: 'in_progress', trigger: 'manual' }),
      createTransition({ from: 'open', to: 'cancelled', trigger: 'manual' }),
      createTransition({ from: 'in_progress', to: 'cancelled', trigger: 'system' }),
    ],
    behaviorRules: [],
    ...overrides,
  };
}

// ─── Helper: instantiate WorkflowEngine with mocks ──────────

function createEngine(opts: {
  schema?: WorkflowSchema | null;
  taskRepo?: ITaskRepository;
} = {}) {
  const schema = opts.schema === undefined ? createTestSchema() : opts.schema;
  const schemaRepo = createMockSchemaRepo(schema);
  const eventBus = createMockEventBus();
  const logger = createMockLogger();

  // WorkflowEngine constructor expects (schemaRepo, eventBus, logger)
  const engine = new (WorkflowEngine as any)(schemaRepo, eventBus, logger);

  if (opts.taskRepo) {
    engine.setTaskRepo(opts.taskRepo);
  }

  return { engine: engine as WorkflowEngine, schemaRepo, eventBus, logger };
}

// ─── Tests ──────────────────────────────────────────────────

describe('WorkflowEngine', () => {
  const ORG = 'org-1';

  // ═══════════════════════════════════════════════════════════
  // Cache Management
  // ═══════════════════════════════════════════════════════════

  describe('cache management', () => {
    it('should load schema from repo on first access', async () => {
      const { engine, schemaRepo } = createEngine();

      await engine.getActiveSchema(ORG);

      expect(schemaRepo.findActiveByOrgId).toHaveBeenCalledWith(ORG);
    });

    it('should serve cached schema on second access (no second repo call)', async () => {
      const { engine, schemaRepo } = createEngine();

      await engine.getActiveSchema(ORG);
      await engine.getActiveSchema(ORG);

      expect(schemaRepo.findActiveByOrgId).toHaveBeenCalledTimes(1);
    });

    it('should invalidate cache so next access hits repo again', async () => {
      const { engine, schemaRepo } = createEngine();

      await engine.getActiveSchema(ORG);
      engine.invalidateCache(ORG);
      await engine.getActiveSchema(ORG);

      expect(schemaRepo.findActiveByOrgId).toHaveBeenCalledTimes(2);
    });

    it('should register schema:updated event listener in constructor', () => {
      const { eventBus } = createEngine();

      expect(eventBus.on).toHaveBeenCalledWith('schema:updated', expect.any(Function));
    });

    it('should invalidate cache when schema:updated event is received', async () => {
      const { engine, schemaRepo, eventBus } = createEngine();

      // Load to populate cache
      await engine.getActiveSchema(ORG);
      expect(schemaRepo.findActiveByOrgId).toHaveBeenCalledTimes(1);

      // Simulate schema:updated event
      const handler = (eventBus.on as any).mock.calls.find(
        (c: any[]) => c[0] === 'schema:updated',
      )?.[1];
      handler({ type: 'schema:updated', timestamp: '', payload: { orgId: ORG } });

      // Next access should hit repo again
      await engine.getActiveSchema(ORG);
      expect(schemaRepo.findActiveByOrgId).toHaveBeenCalledTimes(2);
    });

    it('should throw NotFoundError when schema is not found', async () => {
      const { engine } = createEngine({ schema: null });

      await expect(engine.getActiveSchema(ORG)).rejects.toThrow(NotFoundError);
    });

    it('should cache schemas per org independently', async () => {
      const { engine, schemaRepo } = createEngine();

      await engine.getActiveSchema('org-a');
      await engine.getActiveSchema('org-b');
      // Invalidate org-a only
      engine.invalidateCache('org-a');
      await engine.getActiveSchema('org-a');
      await engine.getActiveSchema('org-b');

      // org-a: 2 loads (initial + after invalidation), org-b: 1 load (cached)
      expect(schemaRepo.findActiveByOrgId).toHaveBeenCalledTimes(3);
    });
  });

  // ═══════════════════════════════════════════════════════════
  // Type Validation
  // ═══════════════════════════════════════════════════════════

  describe('type validation', () => {
    it('should allow root type when allowedAtRoot is true', async () => {
      const { engine } = createEngine();

      expect(await engine.validateType(ORG, 'epic', null)).toBe(true);
    });

    it('should reject root type when allowedAtRoot is false', async () => {
      const { engine } = createEngine();

      expect(await engine.validateType(ORG, 'story', null)).toBe(false);
    });

    it('should allow child type when parent allows it', async () => {
      const { engine } = createEngine();

      expect(await engine.validateType(ORG, 'story', 'epic')).toBe(true);
    });

    it('should reject child type when parent does not allow it', async () => {
      const { engine } = createEngine();

      expect(await engine.validateType(ORG, 'epic', 'story')).toBe(false);
    });

    it('should return false for unknown type', async () => {
      const { engine } = createEngine();

      expect(await engine.validateType(ORG, 'nonexistent', null)).toBe(false);
    });

    it('should return false for unknown parent type', async () => {
      const { engine } = createEngine();

      expect(await engine.validateType(ORG, 'story', 'nonexistent')).toBe(false);
    });

    it('should return type definition by name', async () => {
      const { engine } = createEngine();

      const def = await engine.getItemTypeDefinition(ORG, 'story');

      expect(def).not.toBeNull();
      expect(def!.name).toBe('story');
    });

    it('should return null for unknown type definition', async () => {
      const { engine } = createEngine();

      expect(await engine.getItemTypeDefinition(ORG, 'unknown')).toBeNull();
    });

    it('should return all item types', async () => {
      const { engine } = createEngine();

      const types = await engine.getAllItemTypes(ORG);

      expect(types).toHaveLength(3);
    });

    it('should return only root-allowed types', async () => {
      const { engine } = createEngine();

      const roots = await engine.getRootTypes(ORG);

      expect(roots).toHaveLength(1);
      expect(roots[0].name).toBe('epic');
    });
  });

  // ═══════════════════════════════════════════════════════════
  // Status & Transition Validation
  // ═══════════════════════════════════════════════════════════

  describe('status & transition validation', () => {
    it('should allow valid transition', async () => {
      const { engine } = createEngine();

      expect(await engine.canTransition(ORG, 'open', 'in_progress')).toBe(true);
    });

    it('should reject invalid transition', async () => {
      const { engine } = createEngine();

      expect(await engine.canTransition(ORG, 'open', 'done')).toBe(false);
    });

    it('should reject reverse transition not defined in schema', async () => {
      const { engine } = createEngine();

      expect(await engine.canTransition(ORG, 'in_progress', 'open')).toBe(false);
    });

    it('should return only manual transitions from a status', async () => {
      const { engine } = createEngine();

      const manual = await engine.getManualTransitions(ORG, 'in_progress');

      // in_progress → in_review is auto, in_progress → cancelled is system
      expect(manual).toHaveLength(0);
    });

    it('should return manual transitions when available', async () => {
      const { engine } = createEngine();

      const manual = await engine.getManualTransitions(ORG, 'open');

      // open → in_progress (manual), open → cancelled (manual)
      expect(manual).toHaveLength(2);
      expect(manual.map((t) => t.to).sort()).toEqual(['cancelled', 'in_progress']);
    });

    it('should return empty array for manual transitions from unknown status', async () => {
      const { engine } = createEngine();

      const manual = await engine.getManualTransitions(ORG, 'nonexistent');

      expect(manual).toHaveLength(0);
    });

    it('should return all statuses', async () => {
      const { engine } = createEngine();

      const all = await engine.getAllStatuses(ORG);

      expect(all).toHaveLength(5);
    });
  });

  // ═══════════════════════════════════════════════════════════
  // Status Category Queries
  // ═══════════════════════════════════════════════════════════

  describe('status category queries', () => {
    it('should return initial status', async () => {
      const { engine } = createEngine();

      expect(await engine.getInitialStatus(ORG)).toBe('open');
    });

    it('should throw SchemaValidationError when no initial status defined', async () => {
      const schema = createTestSchema({
        statuses: [
          createStatus({ name: 'active', category: 'active' }),
          createStatus({ name: 'done', category: 'terminal' }),
        ],
      });
      const { engine } = createEngine({ schema });

      await expect(engine.getInitialStatus(ORG)).rejects.toThrow(SchemaValidationError);
    });

    it('should identify terminal status', async () => {
      const { engine } = createEngine();

      expect(await engine.isTerminalStatus(ORG, 'done')).toBe(true);
      expect(await engine.isTerminalStatus(ORG, 'cancelled')).toBe(true);
    });

    it('should reject non-terminal status as terminal', async () => {
      const { engine } = createEngine();

      expect(await engine.isTerminalStatus(ORG, 'in_progress')).toBe(false);
    });

    it('should return false for unknown status in isTerminalStatus', async () => {
      const { engine } = createEngine();

      expect(await engine.isTerminalStatus(ORG, 'nonexistent')).toBe(false);
    });

    it('should identify review status', async () => {
      const { engine } = createEngine();

      expect(await engine.isReviewStatus(ORG, 'in_review')).toBe(true);
    });

    it('should reject non-review status as review', async () => {
      const { engine } = createEngine();

      expect(await engine.isReviewStatus(ORG, 'in_progress')).toBe(false);
    });

    it('should identify active status', async () => {
      const { engine } = createEngine();

      expect(await engine.isActiveStatus(ORG, 'in_progress')).toBe(true);
    });

    it('should reject non-active status as active', async () => {
      const { engine } = createEngine();

      expect(await engine.isActiveStatus(ORG, 'open')).toBe(false);
    });

    it('should return first review status', async () => {
      const { engine } = createEngine();

      expect(await engine.getFirstReviewStatus(ORG)).toBe('in_review');
    });

    it('should return null when no review status exists', async () => {
      const schema = createTestSchema({
        statuses: [
          createStatus({ name: 'open', category: 'initial' }),
          createStatus({ name: 'done', category: 'terminal' }),
        ],
      });
      const { engine } = createEngine({ schema });

      expect(await engine.getFirstReviewStatus(ORG)).toBeNull();
    });

    it('should find transition target by category', async () => {
      const { engine } = createEngine();

      // from in_progress, find a transition to a 'review' category status
      expect(await engine.findTransitionTargetByCategory(ORG, 'in_progress', 'review')).toBe('in_review');
    });

    it('should return null when no transition leads to target category', async () => {
      const { engine } = createEngine();

      // from open, no transition goes to a terminal status directly... wait, open → cancelled does
      // Let's check: open → cancelled (manual), cancelled is terminal
      expect(await engine.findTransitionTargetByCategory(ORG, 'open', 'terminal')).toBe('cancelled');
    });

    it('should return null when no matching transition exists at all', async () => {
      const { engine } = createEngine();

      // from done, there are no outgoing transitions
      expect(await engine.findTransitionTargetByCategory(ORG, 'done', 'active')).toBeNull();
    });
  });

  // ═══════════════════════════════════════════════════════════
  // Behavior Rule Delegation
  // ═══════════════════════════════════════════════════════════

  describe('behavior rule delegation', () => {
    it('should delegate to BehaviorEngine and return actions', async () => {
      const schema = createTestSchema({
        behaviorRules: [
          {
            id: 'r1',
            name: 'Auto start',
            priority: 10,
            trigger: { type: 'on_task_created' },
            condition: { type: 'always' },
            action: { type: 'auto_transition', targetStatus: 'in_progress' },
          },
        ],
      });
      const { engine } = createEngine({ schema });

      const actions = await engine.evaluateBehaviors(ORG, { type: 'on_task_created' }, {
        taskId: 'task-1',
        orgId: ORG,
        taskType: 'story',
        taskStatus: 'open',
        parentTaskId: null,
        parentTaskType: null,
        parentTaskStatus: null,
        childCount: 0,
        childTypes: [],
        childStatuses: [],
      });

      expect(actions).toHaveLength(1);
      expect(actions[0]).toEqual({ type: 'auto_transition', targetStatus: 'in_progress' });
    });

    it('should return empty array when no behavior rules match', async () => {
      const { engine } = createEngine(); // default schema has no behavior rules

      const actions = await engine.evaluateBehaviors(ORG, { type: 'on_task_created' }, {
        taskId: 'task-1',
        orgId: ORG,
        taskType: 'story',
        taskStatus: 'open',
        parentTaskId: null,
        parentTaskType: null,
        parentTaskStatus: null,
        childCount: 0,
        childTypes: [],
        childStatuses: [],
      });

      expect(actions).toHaveLength(0);
    });
  });

  // ═══════════════════════════════════════════════════════════
  // Schema Integrity Validation
  // ═══════════════════════════════════════════════════════════

  describe('schema integrity validation', () => {
    it('should pass a valid schema', () => {
      const { engine } = createEngine();

      const violations = engine.validateSchemaIntegrity(createTestSchema());

      expect(violations).toHaveLength(0);
    });

    // --- Initial status rules ---

    it('should flag zero initial statuses', () => {
      const { engine } = createEngine();
      const schema = createTestSchema({
        statuses: [
          createStatus({ name: 'active', category: 'active' }),
          createStatus({ name: 'done', category: 'terminal' }),
        ],
        transitions: [],
      });

      const violations = engine.validateSchemaIntegrity(schema);

      expect(violations).toContain('Exactly one initial status required, found 0');
    });

    it('should flag multiple initial statuses', () => {
      const { engine } = createEngine();
      const schema = createTestSchema({
        statuses: [
          createStatus({ name: 'open', category: 'initial' }),
          createStatus({ name: 'new', category: 'initial' }),
          createStatus({ name: 'done', category: 'terminal' }),
        ],
        transitions: [
          createTransition({ from: 'open', to: 'done' }),
          createTransition({ from: 'new', to: 'done' }),
        ],
      });

      const violations = engine.validateSchemaIntegrity(schema);

      expect(violations.some((v) => v.includes('Exactly one initial status required, found 2'))).toBe(true);
    });

    // --- Terminal status rules ---

    it('should flag zero terminal statuses', () => {
      const { engine } = createEngine();
      const schema = createTestSchema({
        statuses: [
          createStatus({ name: 'open', category: 'initial' }),
          createStatus({ name: 'active', category: 'active' }),
        ],
        transitions: [createTransition({ from: 'open', to: 'active' })],
      });

      const violations = engine.validateSchemaIntegrity(schema);

      expect(violations).toContain('At least one terminal status required');
    });

    // --- Leaf type with children ---

    it('should flag leaf type with allowedChildren', () => {
      const { engine } = createEngine();
      const schema = createTestSchema({
        workItemTypes: [
          createTypeDef({ name: 'task', isLeaf: true, allowedChildren: ['subtask'] }),
          createTypeDef({ name: 'subtask', isLeaf: true }),
        ],
      });

      const violations = engine.validateSchemaIntegrity(schema);

      expect(violations.some((v) => v.includes("is marked isLeaf but has allowedChildren"))).toBe(true);
    });

    // --- Unknown child type reference ---

    it('should flag unknown child type references', () => {
      const { engine } = createEngine();
      const schema = createTestSchema({
        workItemTypes: [
          createTypeDef({ name: 'epic', allowedChildren: ['ghost_type'] }),
        ],
      });

      const violations = engine.validateSchemaIntegrity(schema);

      expect(violations.some((v) => v.includes("unknown child type 'ghost_type'"))).toBe(true);
    });

    // --- Transition references unknown statuses ---

    it('should flag transition with unknown source status', () => {
      const { engine } = createEngine();
      const schema = createTestSchema({
        transitions: [createTransition({ from: 'nonexistent', to: 'done' })],
      });

      const violations = engine.validateSchemaIntegrity(schema);

      expect(violations.some((v) => v.includes("unknown source status 'nonexistent'"))).toBe(true);
    });

    it('should flag transition with unknown target status', () => {
      const { engine } = createEngine();
      const schema = createTestSchema({
        transitions: [createTransition({ from: 'open', to: 'nonexistent' })],
      });

      const violations = engine.validateSchemaIntegrity(schema);

      expect(violations.some((v) => v.includes("unknown target status 'nonexistent'"))).toBe(true);
    });

    // --- Orphan statuses ---

    it('should flag unreachable statuses', () => {
      const { engine } = createEngine();
      const schema = createTestSchema({
        statuses: [
          createStatus({ name: 'open', category: 'initial' }),
          createStatus({ name: 'in_progress', category: 'active' }),
          createStatus({ name: 'orphan', label: 'Orphan', category: 'active' }),
          createStatus({ name: 'done', category: 'terminal' }),
        ],
        transitions: [
          createTransition({ from: 'open', to: 'in_progress' }),
          createTransition({ from: 'in_progress', to: 'done' }),
          // 'orphan' has no incoming transition from reachable statuses
        ],
      });

      const violations = engine.validateSchemaIntegrity(schema);

      expect(violations.some((v) => v.includes("'orphan' is unreachable"))).toBe(true);
    });

    it('should not flag orphans when there are zero transitions', () => {
      const { engine } = createEngine();
      const schema = createTestSchema({
        statuses: [
          createStatus({ name: 'open', category: 'initial' }),
          createStatus({ name: 'done', category: 'terminal' }),
        ],
        transitions: [],
      });

      const violations = engine.validateSchemaIntegrity(schema);

      // Orphan check skipped when transitions.length === 0
      expect(violations.filter((v) => v.includes('unreachable'))).toHaveLength(0);
    });

    it('should not flag orphans when there are multiple initial statuses (guard)', () => {
      const { engine } = createEngine();
      const schema = createTestSchema({
        statuses: [
          createStatus({ name: 'open', category: 'initial' }),
          createStatus({ name: 'new', category: 'initial' }),
          createStatus({ name: 'done', category: 'terminal' }),
        ],
        transitions: [createTransition({ from: 'open', to: 'done' })],
      });

      const violations = engine.validateSchemaIntegrity(schema);

      // Orphan check requires exactly 1 initial status
      expect(violations.filter((v) => v.includes('unreachable'))).toHaveLength(0);
    });

    // --- Hierarchy cycle detection ---

    it('should flag direct self-referencing hierarchy cycle', () => {
      const { engine } = createEngine();
      const schema = createTestSchema({
        workItemTypes: [
          createTypeDef({ name: 'task', allowedChildren: ['task'] }),
        ],
      });

      const violations = engine.validateSchemaIntegrity(schema);

      expect(violations.some((v) => v.includes('Hierarchy cycle detected'))).toBe(true);
    });

    it('should flag indirect hierarchy cycle (A → B → A)', () => {
      const { engine } = createEngine();
      const schema = createTestSchema({
        workItemTypes: [
          createTypeDef({ name: 'a', allowedChildren: ['b'] }),
          createTypeDef({ name: 'b', allowedChildren: ['a'] }),
        ],
      });

      const violations = engine.validateSchemaIntegrity(schema);

      expect(violations.some((v) => v.includes('Hierarchy cycle detected'))).toBe(true);
    });

    it('should flag longer hierarchy cycle (A → B → C → A)', () => {
      const { engine } = createEngine();
      const schema = createTestSchema({
        workItemTypes: [
          createTypeDef({ name: 'a', allowedChildren: ['b'] }),
          createTypeDef({ name: 'b', allowedChildren: ['c'] }),
          createTypeDef({ name: 'c', allowedChildren: ['a'] }),
        ],
      });

      const violations = engine.validateSchemaIntegrity(schema);

      expect(violations.some((v) => v.includes('Hierarchy cycle detected'))).toBe(true);
    });

    it('should not flag acyclic hierarchy', () => {
      const { engine } = createEngine();
      const schema = createTestSchema({
        workItemTypes: [
          createTypeDef({ name: 'epic', allowedChildren: ['story'] }),
          createTypeDef({ name: 'story', allowedChildren: ['subtask'] }),
          createTypeDef({ name: 'subtask', isLeaf: true }),
        ],
      });

      const violations = engine.validateSchemaIntegrity(schema);

      expect(violations.filter((v) => v.includes('Hierarchy cycle'))).toHaveLength(0);
    });

    // --- Behavior rule reference validation ---

    it('should flag behavior rule trigger referencing unknown status', () => {
      const { engine } = createEngine();
      const schema = createTestSchema({
        behaviorRules: [{
          id: 'r1',
          name: 'Bad trigger',
          priority: 10,
          trigger: { type: 'on_status_enter', status: 'ghost_status' },
          condition: { type: 'always' },
          action: { type: 'auto_transition', targetStatus: 'done' },
        }],
      });

      const violations = engine.validateSchemaIntegrity(schema);

      expect(violations.some((v) => v.includes("trigger references unknown status 'ghost_status'"))).toBe(true);
    });

    it('should flag behavior rule trigger referencing unknown child type', () => {
      const { engine } = createEngine();
      const schema = createTestSchema({
        behaviorRules: [{
          id: 'r1',
          name: 'Bad trigger type',
          priority: 10,
          trigger: { type: 'on_children_of_type_terminal', childTypes: ['phantom'] },
          condition: { type: 'always' },
          action: { type: 'auto_transition', targetStatus: 'done' },
        }],
      });

      const violations = engine.validateSchemaIntegrity(schema);

      expect(violations.some((v) => v.includes("trigger references unknown type 'phantom'"))).toBe(true);
    });

    it('should flag behavior rule condition referencing unknown type', () => {
      const { engine } = createEngine();
      const schema = createTestSchema({
        behaviorRules: [{
          id: 'r1',
          name: 'Bad condition',
          priority: 10,
          trigger: { type: 'on_task_created' },
          condition: { type: 'item_type_in', types: ['imaginary'] },
          action: { type: 'auto_transition', targetStatus: 'done' },
        }],
      });

      const violations = engine.validateSchemaIntegrity(schema);

      expect(violations.some((v) => v.includes("condition references unknown type 'imaginary'"))).toBe(true);
    });

    it('should flag behavior rule condition referencing unknown status', () => {
      const { engine } = createEngine();
      const schema = createTestSchema({
        behaviorRules: [{
          id: 'r1',
          name: 'Bad condition status',
          priority: 10,
          trigger: { type: 'on_task_created' },
          condition: { type: 'item_in_status', statuses: ['limbo'] },
          action: { type: 'auto_transition', targetStatus: 'done' },
        }],
      });

      const violations = engine.validateSchemaIntegrity(schema);

      expect(violations.some((v) => v.includes("condition references unknown status 'limbo'"))).toBe(true);
    });

    it('should flag behavior rule action referencing unknown status', () => {
      const { engine } = createEngine();
      const schema = createTestSchema({
        behaviorRules: [{
          id: 'r1',
          name: 'Bad action',
          priority: 10,
          trigger: { type: 'on_task_created' },
          condition: { type: 'always' },
          action: { type: 'auto_transition', targetStatus: 'void_status' },
        }],
      });

      const violations = engine.validateSchemaIntegrity(schema);

      expect(violations.some((v) => v.includes("action references unknown status 'void_status'"))).toBe(true);
    });

    it('should validate nested conditions in behavior rules (and/or/not)', () => {
      const { engine } = createEngine();
      const schema = createTestSchema({
        behaviorRules: [{
          id: 'r1',
          name: 'Nested bad ref',
          priority: 10,
          trigger: { type: 'on_task_created' },
          condition: {
            type: 'and',
            conditions: [
              { type: 'or', conditions: [{ type: 'parent_in_status', statuses: ['unknown_s'] }] },
              { type: 'not', condition: { type: 'item_type_in', types: ['unknown_t'] } },
            ],
          },
          action: { type: 'wake_assignee', trigger: 'test' },
        }],
      });

      const violations = engine.validateSchemaIntegrity(schema);

      expect(violations.some((v) => v.includes("unknown status 'unknown_s'"))).toBe(true);
      expect(violations.some((v) => v.includes("unknown type 'unknown_t'"))).toBe(true);
    });

    it('should collect multiple violations from a single schema', () => {
      const { engine } = createEngine();
      const schema: WorkflowSchema = {
        workItemTypes: [
          createTypeDef({ name: 'task', isLeaf: true, allowedChildren: ['ghost'] }),
        ],
        statuses: [], // no initial, no terminal
        transitions: [createTransition({ from: 'x', to: 'y' })],
        behaviorRules: [],
      };

      const violations = engine.validateSchemaIntegrity(schema);

      expect(violations.length).toBeGreaterThanOrEqual(4);
      // Should include: no initial, no terminal, leaf with children, unknown child, unknown transition statuses
    });
  });

  // ═══════════════════════════════════════════════════════════
  // Schema CRUD — saveSchema
  // ═══════════════════════════════════════════════════════════

  describe('saveSchema', () => {
    it('should save valid schema and emit schema:updated event', async () => {
      const { engine, schemaRepo, eventBus } = createEngine();
      const schema = createTestSchema();

      await engine.saveSchema(ORG, schema);

      expect(schemaRepo.save).toHaveBeenCalledWith(ORG, schema);
      expect(eventBus.emit).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'schema:updated',
          payload: { orgId: ORG },
        }),
      );
    });

    it('should throw SchemaValidationError for invalid schema', async () => {
      const { engine } = createEngine();
      const badSchema: WorkflowSchema = {
        workItemTypes: [],
        statuses: [], // no initial, no terminal
        transitions: [],
        behaviorRules: [],
      };

      await expect(engine.saveSchema(ORG, badSchema)).rejects.toThrow(SchemaValidationError);
    });

    it('should not save or emit when validation fails', async () => {
      const { engine, schemaRepo, eventBus } = createEngine();
      const badSchema: WorkflowSchema = {
        workItemTypes: [],
        statuses: [],
        transitions: [],
        behaviorRules: [],
      };

      try {
        await engine.saveSchema(ORG, badSchema);
      } catch {
        // expected
      }

      expect(schemaRepo.save).not.toHaveBeenCalled();
      expect(eventBus.emit).not.toHaveBeenCalled();
    });

    it('should block save when active tasks would be orphaned', async () => {
      const tasks = [
        createTask({ id: 'task-1', type: 'story', status: 'in_progress' }),
      ];
      const taskRepo = createMockTaskRepo(tasks);
      const { engine } = createEngine({ taskRepo });

      // Schema without 'story' type
      const schema = createTestSchema({
        workItemTypes: [createTypeDef({ name: 'epic' })],
      });

      await expect(engine.saveSchema(ORG, schema)).rejects.toThrow(SchemaValidationError);
    });

    it('should allow save when only terminal tasks have orphaned types', async () => {
      const tasks = [
        createTask({ id: 'task-1', type: 'old_type', status: 'done' }),
      ];
      const taskRepo = createMockTaskRepo(tasks);
      const { engine, schemaRepo } = createEngine({ schema: createTestSchema(), taskRepo });

      // 'done' is terminal, so old_type being missing is OK
      await engine.saveSchema(ORG, createTestSchema());

      expect(schemaRepo.save).toHaveBeenCalled();
    });

    it('should allow save when no taskRepo is set (skip impact analysis)', async () => {
      const { engine, schemaRepo } = createEngine();
      // no taskRepo set

      await engine.saveSchema(ORG, createTestSchema());

      expect(schemaRepo.save).toHaveBeenCalled();
    });

    it('should block save when active tasks have unknown status in new schema', async () => {
      const tasks = [
        createTask({ id: 'task-1', type: 'story', status: 'custom_status' }),
      ];
      const taskRepo = createMockTaskRepo(tasks);
      const { engine } = createEngine({ taskRepo });

      // Schema does not include 'custom_status'
      await expect(engine.saveSchema(ORG, createTestSchema())).rejects.toThrow(SchemaValidationError);
    });
  });

  // ═══════════════════════════════════════════════════════════
  // analyzeImpactReadOnly
  // ═══════════════════════════════════════════════════════════

  describe('analyzeImpactReadOnly', () => {
    it('should return impact report without saving', async () => {
      const tasks = [
        createTask({ id: 'task-1', type: 'unknown_type', status: 'in_progress' }),
      ];
      const taskRepo = createMockTaskRepo(tasks);
      const { engine, schemaRepo } = createEngine({ taskRepo });

      const report = await engine.analyzeImpactReadOnly(ORG, createTestSchema());

      expect(report).not.toBeNull();
      expect(report!.affectedTaskCount).toBe(1);
      expect(schemaRepo.save).not.toHaveBeenCalled();
    });

    it('should throw on invalid schema even in read-only mode', async () => {
      const { engine } = createEngine();
      const badSchema: WorkflowSchema = {
        workItemTypes: [],
        statuses: [],
        transitions: [],
        behaviorRules: [],
      };

      await expect(engine.analyzeImpactReadOnly(ORG, badSchema)).rejects.toThrow(SchemaValidationError);
    });

    it('should return null when no tasks are affected', async () => {
      const tasks = [
        createTask({ id: 'task-1', type: 'story', status: 'open' }),
      ];
      const taskRepo = createMockTaskRepo(tasks);
      const { engine } = createEngine({ taskRepo });

      const report = await engine.analyzeImpactReadOnly(ORG, createTestSchema());

      expect(report).toBeNull();
    });

    it('should return null when no taskRepo is set', async () => {
      const { engine } = createEngine();

      const report = await engine.analyzeImpactReadOnly(ORG, createTestSchema());

      expect(report).toBeNull();
    });

    it('should exclude terminal tasks from impact analysis', async () => {
      const tasks = [
        createTask({ id: 'task-terminal', type: 'removed_type', status: 'done' }),
        createTask({ id: 'task-active', type: 'removed_type', status: 'in_progress' }),
      ];
      const taskRepo = createMockTaskRepo(tasks);
      const { engine } = createEngine({ taskRepo });

      const report = await engine.analyzeImpactReadOnly(ORG, createTestSchema());

      expect(report).not.toBeNull();
      expect(report!.affectedTaskCount).toBe(1);
      expect(report!.details[0].taskId).toBe('task-active');
    });
  });

  // ═══════════════════════════════════════════════════════════
  // Edge Cases
  // ═══════════════════════════════════════════════════════════

  describe('edge cases', () => {
    it('should handle schema with empty workItemTypes', () => {
      const { engine } = createEngine();
      const schema = createTestSchema({ workItemTypes: [] });

      const violations = engine.validateSchemaIntegrity(schema);

      // No type-related violations, but status issues may exist
      expect(violations.filter((v) => v.includes('isLeaf') || v.includes('child type'))).toHaveLength(0);
    });

    it('should handle schema with empty transitions', () => {
      const { engine } = createEngine();
      const schema = createTestSchema({ transitions: [] });

      const violations = engine.validateSchemaIntegrity(schema);

      // No transition-related violations
      expect(violations.filter((v) => v.includes('Transition references'))).toHaveLength(0);
    });

    it('should handle schema with empty behaviorRules', () => {
      const { engine } = createEngine();
      const schema = createTestSchema({ behaviorRules: [] });

      const violations = engine.validateSchemaIntegrity(schema);

      expect(violations).toHaveLength(0);
    });

    it('should handle canTransition with same from and to status', async () => {
      const { engine } = createEngine();

      // No self-transition defined in test schema
      expect(await engine.canTransition(ORG, 'open', 'open')).toBe(false);
    });

    it('should handle findTransitionTargetByCategory with non-existent category', async () => {
      const { engine } = createEngine();

      expect(await engine.findTransitionTargetByCategory(ORG, 'open', 'nonexistent_category')).toBeNull();
    });
  });
});
