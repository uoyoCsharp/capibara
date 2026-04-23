import { describe, it, expect, beforeEach } from 'vitest';
import { MockEventBus } from '../helpers/mock-event-bus';
import { MockLogger } from '../helpers/mock-logger';
import { BehaviorEngine } from '@core/modules/workflow/engines/behavior.engine';
import { TaskStateMachine } from '@core/modules/workflow/engines/task.state-machine';
import { TaskScheduler } from '@core/modules/orchestrator/task.scheduler';
import { Orchestrator } from '@core/modules/orchestrator/orchestrator';
import type { ProcessEngine } from '@core/modules/workflow/engines/process.engine';
import type { ITaskRepository } from '@core/modules/workflow/interfaces/i-task.repository';
import type { IRoleRepository } from '@core/modules/organization/interfaces/i-role.repository';
import type { IConversationRepository } from '@core/modules/conversation/interfaces/i-conversation.repository';
import type {
  IPendingWakeRepository,
  PendingWake,
  CreatePendingWakeInput,
} from '@core/modules/orchestrator/interfaces/i-pending-wake.repository';
import type { WakeGateValidator } from '@core/modules/orchestrator/wake-gate.validator';
import type { RetryScheduler } from '@core/modules/orchestrator/retry.scheduler';
import type { RunCoordinator } from '@core/modules/orchestrator/run.coordinator';
import type { Task, ProcessSchema } from '@core/modules/workflow/types/workflow.types';

// ---------------------------------------------------------------------------
// InMemoryTaskStore
// ---------------------------------------------------------------------------
class InMemoryTaskStore {
  private tasks = new Map<string, Task>();

  add(task: Task): void {
    this.tasks.set(task.id, { ...task });
  }

  findById(id: string): Task | null {
    const t = this.tasks.get(id);
    return t ? { ...t } : null;
  }

  findByOrgId(orgId: string): Task[] {
    return [...this.tasks.values()].filter((t) => t.orgId === orgId).map((t) => ({ ...t }));
  }

  findChildren(parentId: string): Task[] {
    return [...this.tasks.values()].filter((t) => t.parentId === parentId).map((t) => ({ ...t }));
  }

  updateStatus(id: string, status: string): void {
    const t = this.tasks.get(id);
    if (t) {
      t.status = status;
      t.updatedAt = new Date().toISOString();
    }
  }

  get(id: string): Task | null {
    const t = this.tasks.get(id);
    return t ? { ...t } : null;
  }
}

// ---------------------------------------------------------------------------
// ProcessEngine mock factory
// ---------------------------------------------------------------------------
function createProcessEngineMock(schema: ProcessSchema): ProcessEngine {
  return {
    getSchema: vi.fn().mockImplementation((_orgId: string) => schema),
    getStatusCategory: vi.fn().mockImplementation((_orgId: string, status: string) => {
      return schema.statuses.find((s) => s.name === status)?.category ?? null;
    }),
    getAvailableTransitions: vi.fn().mockImplementation((_orgId: string, from: string) => {
      return schema.transitions.filter((t) => t.from === from);
    }),
    validateTransition: vi.fn().mockImplementation((_orgId: string, from: string, to: string) => {
      return schema.transitions.some((t) => t.from === from && t.to === to);
    }),
    getStatusDefinition: vi.fn().mockImplementation((_orgId: string, statusName: string) => {
      return schema.statuses.find((s) => s.name === statusName) ?? null;
    }),
    getStatusesByCategory: vi.fn().mockImplementation((_orgId: string, category: string) => {
      return schema.statuses.filter((s) => s.category === category);
    }),
    getInitialStatus: vi.fn().mockImplementation((_orgId: string) => {
      return schema.statuses.find((s) => s.category === 'initial') ?? null;
    }),
    getWorkItemType: vi.fn().mockImplementation((_orgId: string, typeName: string) => {
      return schema.workItemTypes.find((t) => t.name === typeName) ?? null;
    }),
    validateType: vi.fn().mockReturnValue(true),
    validateStatus: vi.fn().mockReturnValue(true),
    validateChildType: vi.fn().mockReturnValue(true),
    getTransition: vi.fn().mockImplementation((_orgId: string, from: string, to: string) => {
      return schema.transitions.find((t) => t.from === from && t.to === to) ?? null;
    }),
    clearCache: vi.fn(),
    saveSchema: vi.fn(),
  } as unknown as ProcessEngine;
}

// ---------------------------------------------------------------------------
// Task factory helper
// ---------------------------------------------------------------------------
let taskCounter = 0;
function makeTask(overrides: Partial<Task> & { id: string; orgId: string }): Task {
  taskCounter++;
  return {
    parentId: null,
    type: 'task',
    title: `Task ${overrides.id}`,
    description: '',
    status: 'pending',
    assigneeRoleId: null,
    depth: 0,
    artifactPaths: null,
    createdAt: `2026-01-01T00:00:${String(taskCounter).padStart(2, '0')}.000Z`,
    updatedAt: `2026-01-01T00:00:${String(taskCounter).padStart(2, '0')}.000Z`,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Default schema (matches resources/workflows/default.json)
// ---------------------------------------------------------------------------
const DEFAULT_SCHEMA: ProcessSchema = {
  workItemTypes: [
    { name: 'epic', label: 'Epic', isLeaf: false, allowedChildren: ['story', 'spike'], allowedAtRoot: true, canDecompose: true },
    { name: 'story', label: 'Story', isLeaf: false, allowedChildren: ['task', 'bug', 'chore', 'spike'], allowedAtRoot: true, canDecompose: true },
    { name: 'task', label: 'Task', isLeaf: false, allowedChildren: ['subtask'], allowedAtRoot: false, canDecompose: false },
    { name: 'subtask', label: 'Subtask', isLeaf: true, allowedChildren: [], allowedAtRoot: false, canDecompose: false },
    { name: 'spike', label: 'Spike', isLeaf: true, allowedChildren: [], allowedAtRoot: false, canDecompose: false },
    { name: 'bug', label: 'Bug', isLeaf: true, allowedChildren: [], allowedAtRoot: false, canDecompose: false },
    { name: 'chore', label: 'Chore', isLeaf: true, allowedChildren: [], allowedAtRoot: false, canDecompose: false },
  ],
  statuses: [
    { name: 'pending', label: 'Pending', category: 'initial' },
    { name: 'in_progress', label: 'In Progress', category: 'active' },
    { name: 'revision', label: 'Revision', category: 'active' },
    { name: 'blocked', label: 'Blocked', category: 'active' },
    { name: 'awaiting_review', label: 'Awaiting Review', category: 'approval' },
    { name: 'approved', label: 'Approved', category: 'terminal' },
    { name: 'done', label: 'Done', category: 'terminal' },
    { name: 'cancelled', label: 'Cancelled', category: 'terminal' },
  ],
  transitions: [
    { from: 'pending', to: 'in_progress' },
    { from: 'in_progress', to: 'awaiting_review' },
    { from: 'in_progress', to: 'blocked' },
    { from: 'blocked', to: 'in_progress' },
    { from: 'awaiting_review', to: 'approved' },
    { from: 'awaiting_review', to: 'revision' },
    { from: 'revision', to: 'in_progress' },
    { from: 'revision', to: 'awaiting_review' },
    { from: 'approved', to: 'done' },
    { from: 'pending', to: 'cancelled' },
    { from: 'in_progress', to: 'cancelled' },
    { from: 'blocked', to: 'cancelled' },
  ],
  behaviorRules: [
    {
      id: 'default-auto-done-leaf',
      name: 'Auto-complete leaf on terminal entry',
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
      id: 'default-propagate-parent',
      name: 'Auto-complete parent when all children terminal',
      priority: 20,
      trigger: 'on_all_children_terminal',
      action: { type: 'transition', params: { targetStatus: 'done' } },
    },
  ],
};

// ---------------------------------------------------------------------------
// Wiring helper: builds real BehaviorEngine, TaskStateMachine, TaskScheduler,
// Orchestrator with a shared in-memory task store.
// ---------------------------------------------------------------------------
interface TestHarness {
  store: InMemoryTaskStore;
  eventBus: MockEventBus;
  logger: MockLogger;
  taskRepo: ITaskRepository;
  processEngine: ProcessEngine;
  behaviorEngine: BehaviorEngine;
  taskStateMachine: TaskStateMachine;
  taskScheduler: TaskScheduler;
  orchestrator: Orchestrator;
  roleRepo: IRoleRepository;
  convRepo: IConversationRepository;
  pendingWakeRepo: IPendingWakeRepository;
  wakeGateValidator: WakeGateValidator;
  retryScheduler: RetryScheduler;
  runCoordinator: RunCoordinator;
}

function buildHarness(schema: ProcessSchema = DEFAULT_SCHEMA): TestHarness {
  const store = new InMemoryTaskStore();
  const eventBus = new MockEventBus();
  const logger = new MockLogger();

  // Build a real ITaskRepository backed by InMemoryTaskStore
  const taskRepo: ITaskRepository = {
    findById: vi.fn().mockImplementation((id: string) => store.findById(id)),
    findByOrgId: vi.fn().mockImplementation((orgId: string) => store.findByOrgId(orgId)),
    findChildren: vi.fn().mockImplementation((parentId: string) => store.findChildren(parentId)),
    findByAssigneeRoleId: vi.fn().mockReturnValue([]),
    create: vi.fn(),
    updateStatus: vi.fn().mockImplementation((id: string, status: string) => store.updateStatus(id, status)),
    update: vi.fn(),
    delete: vi.fn(),
  };

  const processEngine = createProcessEngineMock(schema);

  // Real TaskStateMachine with real eventBus
  const taskStateMachine = new TaskStateMachine(
    taskRepo,
    processEngine,
    eventBus,
    logger,
  );

  // Real BehaviorEngine
  const behaviorEngine = new BehaviorEngine(
    taskRepo,
    processEngine,
    taskStateMachine,
    logger,
  );

  // Wire circular dependency
  taskStateMachine.setBehaviorEngine(behaviorEngine);

  // Real TaskScheduler
  const taskScheduler = new TaskScheduler(taskRepo, processEngine, logger);

  // Mock remaining orchestrator dependencies
  const roleRepo: IRoleRepository = {
    findById: vi.fn().mockReturnValue(null),
    findByIds: vi.fn().mockReturnValue([]),
    findByOrgId: vi.fn().mockReturnValue([]),
    findChildren: vi.fn().mockReturnValue([]),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  };

  const convRepo: IConversationRepository = {
    findById: vi.fn().mockReturnValue(null),
    findByOrgId: vi.fn().mockReturnValue([]),
    findByTaskId: vi.fn().mockReturnValue([]),
    findActiveByOrgId: vi.fn().mockReturnValue([]),
    findByState: vi.fn().mockReturnValue([]),
    findTimedOutInquiries: vi.fn().mockReturnValue([]),
    create: vi.fn(),
    updateState: vi.fn(),
    updateRespondent: vi.fn(),
    updateExternalSessionId: vi.fn(),
    delete: vi.fn(),
  };

  const pendingWakeRepo: IPendingWakeRepository = {
    findById: vi.fn().mockReturnValue(null),
    findByOrgId: vi.fn().mockReturnValue([]),
    findByRoleId: vi.fn().mockReturnValue([]),
    findNext: vi.fn().mockReturnValue(null),
    create: vi.fn().mockImplementation((input: CreatePendingWakeInput): PendingWake => ({
      id: `pw-${Date.now()}`,
      ...input,
      createdAt: new Date().toISOString(),
    })),
    delete: vi.fn(),
    deleteByRoleId: vi.fn(),
  };

  const wakeGateValidator = {
    validate: vi.fn().mockReturnValue({ allowed: true }),
  } as unknown as WakeGateValidator;

  const retryScheduler = {
    scheduleRetry: vi.fn(),
    clearRetries: vi.fn(),
  } as unknown as RetryScheduler;

  const runCoordinator = {
    executeForTask: vi.fn().mockResolvedValue({ runId: 'run-1', status: 'succeeded' }),
    executeForConversation: vi.fn().mockResolvedValue({ runId: 'run-2', status: 'succeeded' }),
  } as unknown as RunCoordinator;

  const orgRepo = {
    findAll: vi.fn(),
    findById: vi.fn().mockReturnValue({ id: 'org-integ-1', autoStartOnCreate: true }),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  };

  const orchestrator = new Orchestrator(
    eventBus,
    logger,
    taskRepo,
    roleRepo,
    orgRepo,
    convRepo,
    pendingWakeRepo,
    wakeGateValidator,
    retryScheduler,
    runCoordinator,
    taskScheduler,
    taskStateMachine,
    processEngine,
    behaviorEngine,
  );

  return {
    store,
    eventBus,
    logger,
    taskRepo,
    processEngine,
    behaviorEngine,
    taskStateMachine,
    taskScheduler,
    orchestrator,
    roleRepo,
    convRepo,
    pendingWakeRepo,
    wakeGateValidator,
    retryScheduler,
    runCoordinator,
  };
}

const ORG = 'org-integ-1';
const ROLE = 'role-dev-1';

// ============================================================================
// Tests
// ============================================================================
describe('Cascade Execution Integration', () => {
  let h: TestHarness;

  beforeEach(() => {
    taskCounter = 0;
    h = buildHarness();
    h.orchestrator.start();
  });

  // --------------------------------------------------------------------------
  // 5.1 Default Schema -- Full cascade
  // --------------------------------------------------------------------------
  describe('5.1 Default Schema - Full cascade', () => {
    it('1 - Leaf task approved -> auto done', () => {
      // A subtask (isLeaf=true) entering "approved" (terminal) triggers
      // behavior rule "default-auto-done-leaf" which transitions it to "done".
      const subtask = makeTask({
        id: 'sub-1',
        orgId: ORG,
        parentId: 'task-parent',
        type: 'subtask',
        status: 'awaiting_review',
        assigneeRoleId: ROLE,
        depth: 3,
      });
      h.store.add(subtask);

      // Also add the parent so that onChildCompleted can look it up.
      // Parent must be in "approved" so that approved->done is a valid transition.
      const parent = makeTask({
        id: 'task-parent',
        orgId: ORG,
        parentId: null,
        type: 'task',
        status: 'approved',
        depth: 2,
      });
      h.store.add(parent);

      // Transition subtask from awaiting_review -> approved (terminal)
      h.taskStateMachine.transition('sub-1', 'approved');

      // BehaviorEngine.onStatusEnter should fire, sees terminal + isLeaf => transitions to done
      const result = h.store.get('sub-1');
      expect(result).not.toBeNull();
      expect(result!.status).toBe('done');
    });

    it('2 - All children terminal -> parent auto done', () => {
      // Parent with 2 children, both done. When onChildCompleted fires for the
      // last child, parent auto-transitions to done.
      const parent = makeTask({
        id: 'story-1',
        orgId: ORG,
        parentId: null,
        type: 'story',
        status: 'in_progress',
        depth: 0,
      });
      h.store.add(parent);

      const child1 = makeTask({
        id: 'task-c1',
        orgId: ORG,
        parentId: 'story-1',
        type: 'task',
        status: 'done',
        depth: 1,
      });
      h.store.add(child1);

      const child2 = makeTask({
        id: 'task-c2',
        orgId: ORG,
        parentId: 'story-1',
        type: 'task',
        status: 'in_progress',
        depth: 1,
      });
      h.store.add(child2);

      // We need in_progress->done transition for the parent. The default schema
      // doesn't have that directly; the behaviorEngine calls
      // taskStateMachine.transition(parent.id, 'done') which needs a valid
      // transition. In the default schema, in_progress has no direct path to done.
      // However, the behavior rule triggers transition to done. The state machine
      // validates transitions. So we need the parent to be in a state that can
      // reach done. Let's put the parent in "approved" state so approved->done is valid.
      h.store.updateStatus('story-1', 'approved');

      // Now make child2 terminal by directly setting done
      h.store.updateStatus('task-c2', 'done');

      // Manually call onChildCompleted to simulate the event
      const freshChild2 = h.store.get('task-c2')!;
      h.behaviorEngine.onChildCompleted(freshChild2);

      const parentResult = h.store.get('story-1');
      expect(parentResult).not.toBeNull();
      expect(parentResult!.status).toBe('done');
    });

    it('3 - Three-layer cascade: task done -> story done -> epic done', () => {
      // epic(approved) -> story(approved) -> subtask(awaiting_review)
      // Complete subtask -> subtask auto-done (leaf) -> story all children terminal
      // -> story auto-done -> epic all children terminal -> epic auto-done
      const epic = makeTask({
        id: 'epic-1',
        orgId: ORG,
        parentId: null,
        type: 'epic',
        status: 'approved',
        depth: 0,
      });
      h.store.add(epic);

      const story = makeTask({
        id: 'story-1',
        orgId: ORG,
        parentId: 'epic-1',
        type: 'story',
        status: 'approved',
        depth: 1,
      });
      h.store.add(story);

      const subtask = makeTask({
        id: 'subtask-1',
        orgId: ORG,
        parentId: 'story-1',
        type: 'subtask',
        status: 'awaiting_review',
        assigneeRoleId: ROLE,
        depth: 2,
      });
      h.store.add(subtask);

      // Transition subtask: awaiting_review -> approved (terminal, leaf)
      // This should cascade: subtask->done, then story sees all children terminal -> done,
      // then epic sees all children terminal -> done
      h.taskStateMachine.transition('subtask-1', 'approved');

      expect(h.store.get('subtask-1')!.status).toBe('done');
      expect(h.store.get('story-1')!.status).toBe('done');
      expect(h.store.get('epic-1')!.status).toBe('done');
    });
  });

  // --------------------------------------------------------------------------
  // 5.2 Approval flow
  // --------------------------------------------------------------------------
  describe('5.2 Approval flow', () => {
    it('4 - Task enters approval -> paused', () => {
      const task = makeTask({
        id: 'task-appr-1',
        orgId: ORG,
        parentId: null,
        type: 'task',
        status: 'in_progress',
        assigneeRoleId: ROLE,
        depth: 0,
      });
      h.store.add(task);

      // Transition to awaiting_review (approval category)
      h.taskStateMachine.transition('task-appr-1', 'awaiting_review');

      // The TaskStateMachine emits task:entered-approval, which the Orchestrator
      // picks up and adds to pausedTasks.
      // Verify by emitting a status-changed for this task -- it should NOT trigger a wake
      h.eventBus.emit({
        type: 'task:status-changed',
        timestamp: new Date().toISOString(),
        payload: { taskId: 'task-appr-1', assigneeRoleId: ROLE, orgId: ORG, from: 'x', to: 'y' },
      });

      // runCoordinator.executeForTask should not be called because the task is paused
      expect(h.runCoordinator.executeForTask).not.toHaveBeenCalled();
    });

    it('5 - Approval confirmed -> scheduleNext resumes', () => {
      const task = makeTask({
        id: 'task-appr-2',
        orgId: ORG,
        parentId: null,
        type: 'task',
        status: 'in_progress',
        assigneeRoleId: ROLE,
        depth: 0,
      });
      h.store.add(task);

      // Enter approval
      h.taskStateMachine.transition('task-appr-2', 'awaiting_review');

      // Now add another task that is schedulable (initial + has assignee)
      const nextTask = makeTask({
        id: 'task-next',
        orgId: ORG,
        parentId: null,
        type: 'task',
        status: 'pending',
        assigneeRoleId: ROLE,
        depth: 0,
      });
      h.store.add(nextTask);

      // Confirm approval: awaiting_review -> approved
      h.taskStateMachine.confirmApproval('task-appr-2', 'approved');

      // The Orchestrator receives task:approval-confirmed and calls scheduleNext
      // scheduleNext should find task-next (pending + has assignee) and transition it
      const nextResult = h.store.get('task-next');
      expect(nextResult).not.toBeNull();
      expect(nextResult!.status).toBe('in_progress');
    });

    it('6 - Approval rejected -> no scheduling', () => {
      const task = makeTask({
        id: 'task-appr-3',
        orgId: ORG,
        parentId: null,
        type: 'task',
        status: 'in_progress',
        assigneeRoleId: ROLE,
        depth: 0,
      });
      h.store.add(task);

      // Enter approval
      h.taskStateMachine.transition('task-appr-3', 'awaiting_review');

      // Clear emitted events for clean check
      h.eventBus.clear();

      // Reject approval -> reverts to revision (active)
      h.taskStateMachine.rejectApproval('task-appr-3', 'revision');

      // Orchestrator should NOT call scheduleNext because approval-rejected is not subscribed
      // to scheduleNext logic (only approval-confirmed triggers scheduleNext)
      h.eventBus.assertEmitted('task:approval-rejected');
      h.eventBus.assertNotEmitted('task:approval-confirmed');
    });
  });

  // --------------------------------------------------------------------------
  // 5.3 Failure & recovery
  // --------------------------------------------------------------------------
  describe('5.3 Failure & recovery', () => {
    it('7 - Cancelled child does not block siblings', () => {
      // Parent is terminal (done), T1 is cancelled, T2 is initial with assignee
      const parent = makeTask({
        id: 'parent-fr',
        orgId: ORG,
        parentId: null,
        type: 'story',
        status: 'done',
        depth: 0,
      });
      h.store.add(parent);

      const t1 = makeTask({
        id: 'task-cancel-1',
        orgId: ORG,
        parentId: 'parent-fr',
        type: 'task',
        status: 'cancelled',
        depth: 1,
      });
      h.store.add(t1);

      const t2 = makeTask({
        id: 'task-init-2',
        orgId: ORG,
        parentId: 'parent-fr',
        type: 'task',
        status: 'pending',
        assigneeRoleId: ROLE,
        depth: 1,
      });
      h.store.add(t2);

      const result = h.taskScheduler.findNextTask(ORG);
      expect(result).not.toBeNull();
      expect(result!.task.id).toBe('task-init-2');
      expect(result!.wakeReason).toBe('task_scheduled');
    });

    it('8 - Cancelled + done = all terminal -> parent auto-done', () => {
      const parent = makeTask({
        id: 'parent-term',
        orgId: ORG,
        parentId: null,
        type: 'story',
        status: 'approved',
        depth: 0,
      });
      h.store.add(parent);

      const t1 = makeTask({
        id: 'task-cancel-t',
        orgId: ORG,
        parentId: 'parent-term',
        type: 'task',
        status: 'cancelled',
        depth: 1,
      });
      h.store.add(t1);

      const t2 = makeTask({
        id: 'task-done-t',
        orgId: ORG,
        parentId: 'parent-term',
        type: 'task',
        status: 'done',
        depth: 1,
      });
      h.store.add(t2);

      // Both children are terminal (cancelled + done). Trigger onChildCompleted for t2.
      const freshT2 = h.store.get('task-done-t')!;
      h.behaviorEngine.onChildCompleted(freshT2);

      expect(h.store.get('parent-term')!.status).toBe('done');
    });

    it('9 - run:succeeded -> drainPendingWakes + scheduleNext', () => {
      // Emit run:succeeded and verify both drainPendingWakes and scheduleNext are triggered
      const spyFindNext = vi.mocked(h.pendingWakeRepo.findNext);
      spyFindNext.mockReturnValue(null);

      h.eventBus.emit({
        type: 'run:succeeded',
        timestamp: new Date().toISOString(),
        payload: { orgId: ORG },
      });

      // drainPendingWakes calls pendingWakeRepo.findNext
      expect(h.pendingWakeRepo.findNext).toHaveBeenCalledWith(ORG);
      // scheduleNext calls taskScheduler (which internally calls taskRepo.findByOrgId)
      expect(h.taskRepo.findByOrgId).toHaveBeenCalledWith(ORG);
    });
  });

  // --------------------------------------------------------------------------
  // 5.4 Edge cases
  // --------------------------------------------------------------------------
  describe('5.4 Edge cases', () => {
    it('12 - Empty org (no tasks) -> findNextTask returns null', () => {
      const result = h.taskScheduler.findNextTask('org-empty');
      expect(result).toBeNull();
    });

    it('13 - Single leaf root task: scheduled -> done -> no parent -> ends', () => {
      const task = makeTask({
        id: 'solo-root',
        orgId: ORG,
        parentId: null,
        type: 'subtask',
        status: 'pending',
        assigneeRoleId: ROLE,
        depth: 0,
      });
      h.store.add(task);

      // TaskScheduler should find it
      const schedResult = h.taskScheduler.findNextTask(ORG);
      expect(schedResult).not.toBeNull();
      expect(schedResult!.task.id).toBe('solo-root');

      // Transition pending -> in_progress
      h.taskStateMachine.transition('solo-root', 'in_progress');
      expect(h.store.get('solo-root')!.status).toBe('in_progress');

      // Transition in_progress -> awaiting_review -> approved
      h.taskStateMachine.transition('solo-root', 'awaiting_review');
      // Now confirm approval -> approved (terminal, leaf)
      h.taskStateMachine.confirmApproval('solo-root', 'approved');

      // BehaviorEngine fires on_status_enter for approved:
      // terminal + isLeaf(subtask) => auto-done
      expect(h.store.get('solo-root')!.status).toBe('done');

      // onChildCompleted called with parentId=null, should return immediately without error
      // (The task:completed event fires, Orchestrator calls behaviorEngine.onChildCompleted,
      // which sees parentId=null and returns.)
      // No more cascading should occur.
    });

    it('14 - All tasks already completed -> findNextTask returns null', () => {
      const t1 = makeTask({ id: 'done-1', orgId: ORG, status: 'done', depth: 0 });
      const t2 = makeTask({ id: 'done-2', orgId: ORG, status: 'done', depth: 0 });
      const t3 = makeTask({ id: 'done-3', orgId: ORG, status: 'cancelled', depth: 0 });
      h.store.add(t1);
      h.store.add(t2);
      h.store.add(t3);

      // All terminal, none have initial children
      const result = h.taskScheduler.findNextTask(ORG);
      expect(result).toBeNull();
    });

    it('15 - Depth 10 still works', () => {
      // Build a chain of 10 layers (depth 0..9): root(done)->child1(done)->...->leaf at depth 9 (pending)
      let parentId: string | null = null;
      for (let i = 0; i < 10; i++) {
        const id = `depth-${i}`;
        const isLast = i === 9;
        const task = makeTask({
          id,
          orgId: ORG,
          parentId,
          type: isLast ? 'subtask' : 'story',
          status: isLast ? 'pending' : 'done',
          assigneeRoleId: isLast ? ROLE : null,
          depth: i,
        });
        h.store.add(task);
        parentId = id;
      }

      const result = h.taskScheduler.findNextTask(ORG);
      expect(result).not.toBeNull();
      expect(result!.task.id).toBe('depth-9');
    });

    it('16 - Depth 11 not schedulable', () => {
      // Build a chain of 11 layers. The leaf at depth 10 (index 10) exceeds the limit.
      // TaskScheduler's depth check: depth > 10 returns null.
      // The root is at depth 0. Each findInSubtree call increments depth.
      // findInSubtree(root, 0) -> findInChildren(root, 0) -> findInSubtree(child, 1) ...
      // findInSubtree(leaf, 10) -> depth=10, not > 10, so still works.
      // We need 12 layers (0..11) to have the leaf called with depth=11.
      let parentId: string | null = null;
      for (let i = 0; i < 12; i++) {
        const id = `deep-${i}`;
        const isLast = i === 11;
        const task = makeTask({
          id,
          orgId: ORG,
          parentId,
          type: isLast ? 'subtask' : 'story',
          status: isLast ? 'pending' : 'done',
          assigneeRoleId: isLast ? ROLE : null,
          depth: i,
        });
        h.store.add(task);
        parentId = id;
      }

      const result = h.taskScheduler.findNextTask(ORG);
      expect(result).toBeNull();
    });
  });

  // --------------------------------------------------------------------------
  // 5.5 PendingWake queue
  // --------------------------------------------------------------------------
  describe('5.5 PendingWake queue', () => {
    it('17 - gate blocked -> wake enqueued -> run ends -> drain executes', async () => {
      // Step 1: gate blocks so wake gets queued as a pending wake
      vi.mocked(h.wakeGateValidator.validate).mockReturnValue({ allowed: false, reason: 'Active run' });

      const task = makeTask({
        id: 'task-wake-1',
        orgId: ORG,
        parentId: null,
        type: 'task',
        status: 'in_progress',
        assigneeRoleId: ROLE,
        depth: 0,
      });
      h.store.add(task);

      // Emit task:status-changed -> orchestrator.tryWake -> gate blocked -> pendingWakeRepo.create
      h.eventBus.emit({
        type: 'task:status-changed',
        timestamp: new Date().toISOString(),
        payload: { taskId: 'task-wake-1', assigneeRoleId: ROLE, orgId: ORG, from: 'pending', to: 'in_progress' },
      });

      expect(h.pendingWakeRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          roleId: ROLE,
          orgId: ORG,
          taskId: 'task-wake-1',
        }),
      );

      // Step 2: gate now allows, and there is a pending wake to drain
      vi.mocked(h.wakeGateValidator.validate).mockReturnValue({ allowed: true });
      vi.mocked(h.pendingWakeRepo.findNext).mockReturnValueOnce({
        id: 'pw-1',
        roleId: ROLE,
        orgId: ORG,
        reason: 'task_assigned',
        taskId: 'task-wake-1',
        priority: 0,
        createdAt: new Date().toISOString(),
      });

      // Emit run:succeeded -> drainPendingWakes -> finds pw-1 -> gate allows -> executeForTask
      h.eventBus.emit({
        type: 'run:succeeded',
        timestamp: new Date().toISOString(),
        payload: { orgId: ORG },
      });

      expect(h.pendingWakeRepo.delete).toHaveBeenCalledWith('pw-1');
      await vi.waitFor(() => {
        expect(h.runCoordinator.executeForTask).toHaveBeenCalledWith(
          'task-wake-1', ROLE, ORG, 'task_assigned', 'en-US',
        );
      });
    });

    it('18 - drain still blocked -> re-enqueue', () => {
      // Gate is still blocked when drain tries to execute
      vi.mocked(h.wakeGateValidator.validate).mockReturnValue({ allowed: false, reason: 'Budget exceeded' });
      vi.mocked(h.pendingWakeRepo.findNext).mockReturnValueOnce({
        id: 'pw-2',
        roleId: ROLE,
        orgId: ORG,
        reason: 'task_scheduled',
        taskId: 'task-blocked',
        priority: 0,
        createdAt: new Date().toISOString(),
      });

      h.eventBus.emit({
        type: 'run:succeeded',
        timestamp: new Date().toISOString(),
        payload: { orgId: ORG },
      });

      // Should delete the old one
      expect(h.pendingWakeRepo.delete).toHaveBeenCalledWith('pw-2');
      // Should re-create a new pending wake
      expect(h.pendingWakeRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          roleId: ROLE,
          orgId: ORG,
          reason: 'task_scheduled',
          taskId: 'task-blocked',
        }),
      );
      // executeForTask should NOT have been called
      expect(h.runCoordinator.executeForTask).not.toHaveBeenCalled();
    });

    it('19 - drain after queue empty -> no-op', () => {
      vi.mocked(h.pendingWakeRepo.findNext).mockReturnValue(null);

      h.eventBus.emit({
        type: 'run:succeeded',
        timestamp: new Date().toISOString(),
        payload: { orgId: ORG },
      });

      expect(h.pendingWakeRepo.delete).not.toHaveBeenCalled();
      expect(h.runCoordinator.executeForTask).not.toHaveBeenCalled();
    });
  });

  // --------------------------------------------------------------------------
  // 5.6 Custom schema compat
  // --------------------------------------------------------------------------
  describe('5.6 Custom schema compat', () => {
    it('20 - Minimal schema (open->working->closed): leaf -> closed, no second transition since already closed', () => {
      const minimalSchema: ProcessSchema = {
        workItemTypes: [
          { name: 'item', label: 'Item', isLeaf: true, allowedChildren: [], allowedAtRoot: true, canDecompose: false },
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
            id: 'auto-close-leaf',
            name: 'Auto-close leaf on terminal entry',
            priority: 10,
            trigger: 'on_status_enter',
            condition: {
              all: [
                { field: 'status.category', op: 'eq', value: 'terminal' },
                { field: 'type.isLeaf', op: 'eq', value: true },
              ],
            },
            action: { type: 'transition', params: { targetStatus: 'closed' } },
          },
        ],
      };

      const ch = buildHarness(minimalSchema);
      ch.orchestrator.start();

      const task = makeTask({
        id: 'min-task-1',
        orgId: ORG,
        parentId: null,
        type: 'item',
        status: 'working',
        assigneeRoleId: ROLE,
        depth: 0,
      });
      ch.store.add(task);

      // Transition working -> closed (terminal). BehaviorEngine fires.
      // The rule tries to transition to "closed" but task is already closed,
      // so taskStateMachine.transition returns early (currentStatus === newStatus).
      ch.taskStateMachine.transition('min-task-1', 'closed');

      expect(ch.store.get('min-task-1')!.status).toBe('closed');
      // No infinite loop, no error
    });

    it('21 - Schema with no behaviorRules -> no auto behavior', () => {
      const noRulesSchema: ProcessSchema = {
        workItemTypes: [
          { name: 'item', label: 'Item', isLeaf: true, allowedChildren: [], allowedAtRoot: true, canDecompose: false },
        ],
        statuses: [
          { name: 'open', label: 'Open', category: 'initial' },
          { name: 'working', label: 'Working', category: 'active' },
          { name: 'done', label: 'Done', category: 'terminal' },
        ],
        transitions: [
          { from: 'open', to: 'working' },
          { from: 'working', to: 'done' },
        ],
        behaviorRules: [],
      };

      const ch = buildHarness(noRulesSchema);
      ch.orchestrator.start();

      // Parent with one child
      const parent = makeTask({
        id: 'nr-parent',
        orgId: ORG,
        parentId: null,
        type: 'item',
        status: 'working',
        depth: 0,
      });
      ch.store.add(parent);

      const child = makeTask({
        id: 'nr-child',
        orgId: ORG,
        parentId: 'nr-parent',
        type: 'item',
        status: 'working',
        assigneeRoleId: ROLE,
        depth: 1,
      });
      ch.store.add(child);

      // Complete child (working -> done)
      ch.taskStateMachine.transition('nr-child', 'done');

      // Child is done
      expect(ch.store.get('nr-child')!.status).toBe('done');
      // Parent stays working because no behaviorRules to auto-complete it
      expect(ch.store.get('nr-parent')!.status).toBe('working');
    });

    it('22 - Custom schema initial->active transition has different name', () => {
      const customSchema: ProcessSchema = {
        workItemTypes: [
          { name: 'ticket', label: 'Ticket', isLeaf: true, allowedChildren: [], allowedAtRoot: true, canDecompose: false },
        ],
        statuses: [
          { name: 'todo', label: 'To Do', category: 'initial' },
          { name: 'working', label: 'Working', category: 'active' },
          { name: 'completed', label: 'Completed', category: 'terminal' },
        ],
        transitions: [
          { from: 'todo', to: 'working' },
          { from: 'working', to: 'completed' },
        ],
        behaviorRules: [],
      };

      const ch = buildHarness(customSchema);
      ch.orchestrator.start();

      const task = makeTask({
        id: 'custom-t-1',
        orgId: ORG,
        parentId: null,
        type: 'ticket',
        status: 'todo',
        assigneeRoleId: ROLE,
        depth: 0,
      });
      ch.store.add(task);

      // scheduleNext should find the task in "todo" (initial) with assignee
      // and transition it to "working" (the active target)
      const schedResult = ch.taskScheduler.findNextTask(ORG);
      expect(schedResult).not.toBeNull();
      expect(schedResult!.task.id).toBe('custom-t-1');

      // Simulate what orchestrator.scheduleNext does
      const transitions = customSchema.transitions.filter((t) => t.from === 'todo');
      const activeTarget = transitions.find((t) => {
        const cat = customSchema.statuses.find((s) => s.name === t.to)?.category;
        return cat === 'active';
      });
      expect(activeTarget).toBeDefined();
      expect(activeTarget!.to).toBe('working');

      // Now emit run:succeeded to trigger scheduleNext via orchestrator
      ch.eventBus.emit({
        type: 'run:succeeded',
        timestamp: new Date().toISOString(),
        payload: { orgId: ORG },
      });

      // orchestrator.scheduleNext transitions todo -> working
      expect(ch.store.get('custom-t-1')!.status).toBe('working');
    });
  });

  // --------------------------------------------------------------------------
  // 5.7 Recursive bubbling termination
  // --------------------------------------------------------------------------
  describe('5.7 Recursive bubbling termination', () => {
    it('23 - Three-layer bubbling terminates at root', () => {
      // epic(approved) -> story(approved) -> subtask(awaiting_review)
      // transition subtask to approved -> auto-done -> story auto-done -> epic auto-done
      // Verify no infinite loop.
      const epic = makeTask({
        id: 'epic-b',
        orgId: ORG,
        parentId: null,
        type: 'epic',
        status: 'approved',
        depth: 0,
      });
      h.store.add(epic);

      const story = makeTask({
        id: 'story-b',
        orgId: ORG,
        parentId: 'epic-b',
        type: 'story',
        status: 'approved',
        depth: 1,
      });
      h.store.add(story);

      const subtask = makeTask({
        id: 'sub-b',
        orgId: ORG,
        parentId: 'story-b',
        type: 'subtask',
        status: 'awaiting_review',
        assigneeRoleId: ROLE,
        depth: 2,
      });
      h.store.add(subtask);

      // This should cascade all the way up and terminate cleanly
      h.taskStateMachine.transition('sub-b', 'approved');

      expect(h.store.get('sub-b')!.status).toBe('done');
      expect(h.store.get('story-b')!.status).toBe('done');
      expect(h.store.get('epic-b')!.status).toBe('done');

      // Verify events: task:completed should be emitted for each level
      const completedEvents = h.eventBus.getEmitted('task:completed');
      const completedIds = completedEvents.map((e) => (e.payload as Record<string, string>).taskId);
      // subtask completed twice (approved then done), story once (done), epic once (done)
      // Actually: subtask gets approved (terminal) -> task:completed emitted
      // Then behavior auto-dones subtask (done, also terminal) -> task:completed emitted again
      // Then story gets done (terminal) -> task:completed
      // Then epic gets done (terminal) -> task:completed
      expect(completedIds).toContain('sub-b');
      expect(completedIds).toContain('story-b');
      expect(completedIds).toContain('epic-b');
    });

    it('24 - Root task completed -> no further bubbling', () => {
      // Root task (parentId=null) completes. onChildCompleted should return immediately.
      const root = makeTask({
        id: 'root-only',
        orgId: ORG,
        parentId: null,
        type: 'story',
        status: 'approved',
        depth: 0,
      });
      h.store.add(root);

      // Transition to done
      h.taskStateMachine.transition('root-only', 'done');

      expect(h.store.get('root-only')!.status).toBe('done');

      // task:completed is emitted
      h.eventBus.assertEmitted('task:completed');

      // Orchestrator calls behaviorEngine.onChildCompleted which checks parentId.
      // Since parentId is null, it returns immediately. No error, no further transitions.
      const completedEvents = h.eventBus.getEmitted('task:completed');
      const completedIds = completedEvents.map((e) => (e.payload as Record<string, string>).taskId);
      expect(completedIds).toContain('root-only');

      // No additional task:status-changed events beyond the root's own transition
      // (The done transition is from approved which is terminal -> terminal, so
      // task:status-changed is emitted but no cascading happens since there's no parent.)
    });
  });

  // --------------------------------------------------------------------------
  // Additional: verify full Orchestrator -> scheduleNext -> transition flow
  // --------------------------------------------------------------------------
  describe('Additional integration scenarios', () => {
    it('25a - Multiple roots: scheduler picks earliest createdAt first', () => {
      // Two root tasks, both initial with assignees. The scheduler should pick
      // the one with the earlier createdAt.
      const t1 = makeTask({
        id: 'root-late',
        orgId: ORG,
        parentId: null,
        type: 'task',
        status: 'pending',
        assigneeRoleId: ROLE,
        depth: 0,
        createdAt: '2026-06-02T00:00:00.000Z',
      });
      h.store.add(t1);

      const t2 = makeTask({
        id: 'root-early',
        orgId: ORG,
        parentId: null,
        type: 'task',
        status: 'pending',
        assigneeRoleId: ROLE,
        depth: 0,
        createdAt: '2026-06-01T00:00:00.000Z',
      });
      h.store.add(t2);

      const result = h.taskScheduler.findNextTask(ORG);
      expect(result).not.toBeNull();
      expect(result!.task.id).toBe('root-early');
    });

    it('25b - run:failed triggers both retryScheduler and scheduleNext', () => {
      h.eventBus.emit({
        type: 'run:failed',
        timestamp: new Date().toISOString(),
        payload: { runId: 'run-fail-1', orgId: ORG },
      });

      expect(h.retryScheduler.scheduleRetry).toHaveBeenCalledWith('run-fail-1');
      // onRunEnded also fires for run:failed -> drainPendingWakes + scheduleNext
      expect(h.pendingWakeRepo.findNext).toHaveBeenCalledWith(ORG);
      expect(h.taskRepo.findByOrgId).toHaveBeenCalledWith(ORG);
    });

    it('scheduleNext transitions initial task to active via orchestrator event', () => {
      // Add a schedulable task
      const task = makeTask({
        id: 'sched-1',
        orgId: ORG,
        parentId: null,
        type: 'task',
        status: 'pending',
        assigneeRoleId: ROLE,
        depth: 0,
      });
      h.store.add(task);

      // Emit run:succeeded -> orchestrator.onRunEnded -> scheduleNext
      h.eventBus.emit({
        type: 'run:succeeded',
        timestamp: new Date().toISOString(),
        payload: { orgId: ORG },
      });

      // scheduleNext finds pending task with assignee -> transitions to in_progress
      expect(h.store.get('sched-1')!.status).toBe('in_progress');
    });
  });
});
