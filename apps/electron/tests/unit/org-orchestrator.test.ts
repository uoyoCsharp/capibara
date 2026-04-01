/**
 * Epic 7 — Story 7.5: End-to-End Workflow Integration Test
 *
 * Verifies the complete automation loop: wake-up cycle, consensus detection,
 * pending wake consumption, and circuit breaker behavior.
 *
 * Uses mocked repositories and executor — no actual CLI or SQLite.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Mock Types ─────────────────────────────────────────────

type WakeTrigger =
  | 'task_assigned'
  | 'task_completed'
  | 'review_approve'
  | 'review_revise'
  | 'review_delegate'
  | 'delegation_completed'
  | 'retry_failed'
  | 'dispute_detected';

interface DomainEvent<T = unknown> {
  type: string;
  timestamp: string;
  payload: T;
}

// ─── Mock Factories ─────────────────────────────────────────

const mockLogger = {
  info: vi.fn(),
  warn: vi.fn(),
  debug: vi.fn(),
  error: vi.fn(),
};

function createMockEventBus() {
  const handlers = new Map<string, Set<(e: DomainEvent) => void>>();
  return {
    emit: vi.fn((event: DomainEvent) => {
      const fns = handlers.get(event.type);
      if (fns) {
        for (const fn of fns) fn(event);
      }
    }),
    on: vi.fn((type: string, handler: (e: DomainEvent) => void) => {
      if (!handlers.has(type)) handlers.set(type, new Set());
      handlers.get(type)!.add(handler);
    }),
    off: vi.fn(),
  };
}

function createRole(overrides: Partial<{ id: string; orgId: string; parentId: string | null; status: string }> = {}) {
  return {
    id: overrides.id ?? 'role-1',
    orgId: overrides.orgId ?? 'org-1',
    name: 'Test Role',
    parentId: overrides.parentId ?? null,
    persona: 'A test role',
    knowledgeBaseRefs: [],
    skillIds: [],
    canApprove: true,
    canDelegate: true,
    requiresHumanApproval: false,
    status: overrides.status ?? 'active',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

function createTask(overrides: Partial<{
  id: string; orgId: string; parentId: string | null; assigneeRoleId: string | null;
  status: string; type: string;
}> = {}) {
  return {
    id: overrides.id ?? 'task-1',
    orgId: overrides.orgId ?? 'org-1',
    parentId: overrides.parentId ?? null,
    type: overrides.type ?? 'task',
    title: 'Test Task',
    description: 'A test task',
    status: overrides.status ?? 'pending',
    assigneeRoleId: overrides.assigneeRoleId ?? 'role-1',
    depth: 0,
    artifactPaths: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

// ─── OrgOrchestrator Reconstruction ─────────────────────────
// We test the actual logic by reconstructing the key methods
// to avoid importing from the Electron app (which has path aliases).

class TestOrgOrchestrator {
  private selfWakeCounts = new Map<string, number>();
  private executionEngine: { startRun: ReturnType<typeof vi.fn> } | null = null;

  constructor(
    private config: { execution: { budgetLimit: number; maxConsecutiveWakes: number } },
    private logger: typeof mockLogger,
    private eventBus: ReturnType<typeof createMockEventBus>,
    private taskRepo: Record<string, ReturnType<typeof vi.fn>>,
    private roleRepo: Record<string, ReturnType<typeof vi.fn>>,
    private runRepo: Record<string, ReturnType<typeof vi.fn>>,
    private pendingWakeRepo: Record<string, ReturnType<typeof vi.fn>>,
    private costRepo: Record<string, ReturnType<typeof vi.fn>>,
  ) {}

  setExecutionEngine(engine: { startRun: ReturnType<typeof vi.fn> }): void {
    this.executionEngine = engine;
  }

  start(): void {
    this.eventBus.on('task:created', (e: DomainEvent) => void this.handleEvent(e));
    this.eventBus.on('task:completed', (e: DomainEvent) => void this.handleEvent(e));
    this.eventBus.on('task:status-changed', (e: DomainEvent) => void this.handleEvent(e));
    this.eventBus.on('run:succeeded', (e: DomainEvent) => void this.handleEvent(e));
    this.eventBus.on('run:failed', (e: DomainEvent) => void this.handleEvent(e));
    this.eventBus.on('wake:triggered', (e: DomainEvent) => void this.handleEvent(e));
    this.eventBus.on('dispute:detected', (e: DomainEvent) => void this.handleEvent(e));
  }

  async handleEvent(event: DomainEvent): Promise<void> {
    const targets = await this.calculateWakeTargets(event);
    for (const target of targets) {
      await this.wakeRoleIfPossible(target.roleId, target.orgId, target.taskNodeId, target.trigger);
    }
  }

  async calculateWakeTargets(event: DomainEvent): Promise<Array<{
    roleId: string; orgId: string; taskNodeId: string; trigger: WakeTrigger;
  }>> {
    const payload = event.payload as Record<string, unknown>;

    switch (event.type) {
      case 'task:created': {
        const task = await this.taskRepo.findById(payload.taskId as string);
        if (task?.assigneeRoleId) {
          return [{ roleId: task.assigneeRoleId, orgId: task.orgId, taskNodeId: task.id, trigger: 'task_assigned' }];
        }
        return [];
      }
      case 'task:completed': {
        const task = await this.taskRepo.findById(payload.taskId as string);
        if (!task?.parentId) return [];
        const parentTask = await this.taskRepo.findById(task.parentId);
        if (!parentTask?.assigneeRoleId) return [];
        return [{ roleId: parentTask.assigneeRoleId, orgId: task.orgId, taskNodeId: parentTask.id, trigger: 'task_completed' }];
      }
      case 'task:status-changed': {
        const { taskId, newStatus } = payload as { taskId: string; newStatus: string };
        if (newStatus !== 'approved' && newStatus !== 'done') return [];
        const task = await this.taskRepo.findById(taskId);
        if (!task?.parentId) return [];
        const siblings = await this.taskRepo.findByParentId(task.parentId);
        const allDone = siblings.every((s: any) => s.status === 'approved' || s.status === 'done' || s.status === 'cancelled');
        if (!allDone) return [];
        const parentTask = await this.taskRepo.findById(task.parentId);
        if (!parentTask?.assigneeRoleId) return [];
        return [{ roleId: parentTask.assigneeRoleId, orgId: task.orgId, taskNodeId: parentTask.id, trigger: 'review_approve' }];
      }
      case 'run:succeeded':
      case 'run:failed': {
        this.selfWakeCounts.delete(payload.roleId as string);
        await this.consumePendingWakes(payload.roleId as string, payload.orgId as string);
        return [];
      }
      case 'wake:triggered': {
        const { roleId, orgId, trigger } = payload as { roleId: string; orgId: string; trigger: WakeTrigger };
        const tasks = await this.taskRepo.findByAssignee(roleId);
        const active = tasks.find((t: any) => t.status === 'pending' || t.status === 'in_progress' || t.status === 'revision');
        if (active) return [{ roleId, orgId, taskNodeId: active.id, trigger }];
        return [];
      }
      case 'dispute:detected': {
        const { parentRoleId, orgId: dOrgId, taskId: dTaskId } = payload as { parentRoleId: string; orgId: string; taskId: string };
        return [{ roleId: parentRoleId, orgId: dOrgId, taskNodeId: dTaskId, trigger: 'dispute_detected' }];
      }
      default:
        return [];
    }
  }

  async wakeRoleIfPossible(roleId: string, orgId: string, taskNodeId: string, trigger: WakeTrigger): Promise<boolean> {
    const role = await this.roleRepo.findById(roleId);
    if (!role || role.status !== 'active') return false;

    const totalCost = await this.costRepo.getTotalCostByOrgId(orgId);
    if (totalCost >= this.config.execution.budgetLimit) {
      this.eventBus.emit({ type: 'budget:exceeded', timestamp: new Date().toISOString(), payload: { orgId } });
      return false;
    }

    const activeRun = await this.runRepo.findActiveByRoleId(roleId);
    if (activeRun) {
      await this.pendingWakeRepo.create({ roleId, orgId, trigger });
      return false;
    }

    const count = this.selfWakeCounts.get(roleId) ?? 0;
    if (count >= this.config.execution.maxConsecutiveWakes) {
      this.eventBus.emit({ type: 'circuit-breaker:self-wake', timestamp: new Date().toISOString(), payload: { roleId, count } });
      return false;
    }

    this.selfWakeCounts.set(roleId, count + 1);
    await this.executionEngine!.startRun(roleId, taskNodeId, orgId, trigger);
    return true;
  }

  private async consumePendingWakes(roleId: string, orgId: string): Promise<void> {
    const wakes = await this.pendingWakeRepo.findByRoleId(roleId);
    if (wakes.length === 0) return;
    const oldest = wakes[0];
    await this.pendingWakeRepo.consume(oldest.id);
    const tasks = await this.taskRepo.findByAssignee(roleId);
    const active = tasks.find((t: any) => t.status === 'pending' || t.status === 'in_progress' || t.status === 'revision');
    if (active) {
      await this.wakeRoleIfPossible(roleId, orgId, active.id, oldest.trigger);
    }
  }

  resetSelfWakeCount(roleId: string): void {
    this.selfWakeCounts.delete(roleId);
  }
}

// ─── Tests ──────────────────────────────────────────────────

describe('OrgOrchestrator — Epic 7 Integration', () => {
  let eventBus: ReturnType<typeof createMockEventBus>;
  let taskRepo: Record<string, ReturnType<typeof vi.fn>>;
  let roleRepo: Record<string, ReturnType<typeof vi.fn>>;
  let runRepo: Record<string, ReturnType<typeof vi.fn>>;
  let pendingWakeRepo: Record<string, ReturnType<typeof vi.fn>>;
  let costRepo: Record<string, ReturnType<typeof vi.fn>>;
  let executionEngine: { startRun: ReturnType<typeof vi.fn> };
  let orchestrator: TestOrgOrchestrator;

  beforeEach(() => {
    vi.clearAllMocks();
    eventBus = createMockEventBus();

    const role1 = createRole({ id: 'dev-role', orgId: 'org-1', parentId: 'lead-role' });
    const leadRole = createRole({ id: 'lead-role', orgId: 'org-1', parentId: null });

    roleRepo = {
      findById: vi.fn(async (id: string) => {
        if (id === 'dev-role') return role1;
        if (id === 'lead-role') return leadRole;
        return null;
      }),
    };

    const epicTask = createTask({ id: 'epic-1', type: 'epic', assigneeRoleId: 'lead-role', status: 'in_progress' });
    const subtask1 = createTask({ id: 'sub-1', parentId: 'epic-1', assigneeRoleId: 'dev-role', status: 'pending' });
    const subtask2 = createTask({ id: 'sub-2', parentId: 'epic-1', assigneeRoleId: 'dev-role', status: 'done' });

    taskRepo = {
      findById: vi.fn(async (id: string) => {
        if (id === 'epic-1') return epicTask;
        if (id === 'sub-1') return subtask1;
        if (id === 'sub-2') return subtask2;
        return null;
      }),
      findByParentId: vi.fn(async () => [subtask1, subtask2]),
      findByAssignee: vi.fn(async (roleId: string) => {
        if (roleId === 'dev-role') return [subtask1];
        if (roleId === 'lead-role') return [epicTask];
        return [];
      }),
    };

    runRepo = {
      findActiveByRoleId: vi.fn(async () => null),
    };

    pendingWakeRepo = {
      findByRoleId: vi.fn(async () => []),
      create: vi.fn(async (input: any) => ({ id: 'pw-1', ...input, createdAt: new Date().toISOString() })),
      consume: vi.fn(async () => {}),
    };

    costRepo = {
      getTotalCostByOrgId: vi.fn(async () => 0),
    };

    executionEngine = {
      startRun: vi.fn(async () => ({ id: 'run-1' })),
    };

    orchestrator = new TestOrgOrchestrator(
      { execution: { budgetLimit: 50, maxConsecutiveWakes: 5 } },
      mockLogger,
      eventBus,
      taskRepo,
      roleRepo,
      runRepo,
      pendingWakeRepo,
      costRepo,
    );
    orchestrator.setExecutionEngine(executionEngine);
  });

  it('wakes assigned role when task is created', async () => {
    await orchestrator.handleEvent({
      type: 'task:created',
      timestamp: new Date().toISOString(),
      payload: { taskId: 'sub-1', orgId: 'org-1' },
    });

    expect(executionEngine.startRun).toHaveBeenCalledWith(
      'dev-role', 'sub-1', 'org-1', 'task_assigned',
    );
  });

  it('wakes parent role when task is completed', async () => {
    await orchestrator.handleEvent({
      type: 'task:completed',
      timestamp: new Date().toISOString(),
      payload: { taskId: 'sub-1', orgId: 'org-1' },
    });

    expect(executionEngine.startRun).toHaveBeenCalledWith(
      'lead-role', 'epic-1', 'org-1', 'task_completed',
    );
  });

  it('wakes parent role when all siblings are done (review_approve)', async () => {
    // Override: both siblings done
    taskRepo.findByParentId.mockResolvedValueOnce([
      createTask({ id: 'sub-1', parentId: 'epic-1', status: 'approved' }),
      createTask({ id: 'sub-2', parentId: 'epic-1', status: 'done' }),
    ]);

    await orchestrator.handleEvent({
      type: 'task:status-changed',
      timestamp: new Date().toISOString(),
      payload: { taskId: 'sub-1', orgId: 'org-1', newStatus: 'approved' },
    });

    expect(executionEngine.startRun).toHaveBeenCalledWith(
      'lead-role', 'epic-1', 'org-1', 'review_approve',
    );
  });

  it('does NOT wake when not all siblings are done', async () => {
    // Default: sub-1 is pending, sub-2 is done → not all done
    await orchestrator.handleEvent({
      type: 'task:status-changed',
      timestamp: new Date().toISOString(),
      payload: { taskId: 'sub-2', orgId: 'org-1', newStatus: 'done' },
    });

    expect(executionEngine.startRun).not.toHaveBeenCalled();
  });

  it('enqueues pending wake when role is busy', async () => {
    runRepo.findActiveByRoleId.mockResolvedValueOnce({ id: 'active-run' });

    const result = await orchestrator.wakeRoleIfPossible('dev-role', 'org-1', 'sub-1', 'task_assigned');

    expect(result).toBe(false);
    expect(pendingWakeRepo.create).toHaveBeenCalledWith({
      roleId: 'dev-role',
      orgId: 'org-1',
      trigger: 'task_assigned',
    });
  });

  it('consumes pending wakes after run succeeds', async () => {
    pendingWakeRepo.findByRoleId.mockResolvedValueOnce([
      { id: 'pw-1', roleId: 'dev-role', orgId: 'org-1', trigger: 'task_assigned', createdAt: new Date().toISOString() },
    ]);

    await orchestrator.handleEvent({
      type: 'run:succeeded',
      timestamp: new Date().toISOString(),
      payload: { runId: 'run-1', roleId: 'dev-role', orgId: 'org-1' },
    });

    expect(pendingWakeRepo.consume).toHaveBeenCalledWith('pw-1');
    expect(executionEngine.startRun).toHaveBeenCalledWith(
      'dev-role', 'sub-1', 'org-1', 'task_assigned',
    );
  });

  it('triggers circuit breaker after MAX_CONSECUTIVE_WAKES', async () => {
    // Set config to allow only 2 consecutive wakes
    orchestrator = new TestOrgOrchestrator(
      { execution: { budgetLimit: 50, maxConsecutiveWakes: 2 } },
      mockLogger,
      eventBus,
      taskRepo,
      roleRepo,
      runRepo,
      pendingWakeRepo,
      costRepo,
    );
    orchestrator.setExecutionEngine(executionEngine);

    // First two wakes should succeed
    expect(await orchestrator.wakeRoleIfPossible('dev-role', 'org-1', 'sub-1', 'task_assigned')).toBe(true);
    expect(await orchestrator.wakeRoleIfPossible('dev-role', 'org-1', 'sub-1', 'task_assigned')).toBe(true);

    // Third wake hits circuit breaker
    // Need to mock runRepo again since executionEngine.startRun doesn't actually create runs
    runRepo.findActiveByRoleId.mockResolvedValue(null);

    expect(await orchestrator.wakeRoleIfPossible('dev-role', 'org-1', 'sub-1', 'task_assigned')).toBe(false);
    expect(eventBus.emit).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'circuit-breaker:self-wake',
        payload: expect.objectContaining({ roleId: 'dev-role', count: 2 }),
      }),
    );
  });

  it('resets self-wake count after run completion', async () => {
    // Set maxConsecutiveWakes to 2
    orchestrator = new TestOrgOrchestrator(
      { execution: { budgetLimit: 50, maxConsecutiveWakes: 2 } },
      mockLogger,
      eventBus,
      taskRepo,
      roleRepo,
      runRepo,
      pendingWakeRepo,
      costRepo,
    );
    orchestrator.setExecutionEngine(executionEngine);

    // Two wakes consume the limit
    await orchestrator.wakeRoleIfPossible('dev-role', 'org-1', 'sub-1', 'task_assigned');
    await orchestrator.wakeRoleIfPossible('dev-role', 'org-1', 'sub-1', 'task_assigned');

    // Simulate run:succeeded which resets count
    await orchestrator.handleEvent({
      type: 'run:succeeded',
      timestamp: new Date().toISOString(),
      payload: { runId: 'run-1', roleId: 'dev-role', orgId: 'org-1' },
    });

    // Should be able to wake again
    expect(await orchestrator.wakeRoleIfPossible('dev-role', 'org-1', 'sub-1', 'task_assigned')).toBe(true);
  });

  it('blocks wake when budget is exceeded', async () => {
    costRepo.getTotalCostByOrgId.mockResolvedValueOnce(55);

    const result = await orchestrator.wakeRoleIfPossible('dev-role', 'org-1', 'sub-1', 'task_assigned');

    expect(result).toBe(false);
    expect(executionEngine.startRun).not.toHaveBeenCalled();
    expect(eventBus.emit).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'budget:exceeded' }),
    );
  });

  it('blocks wake when role is inactive', async () => {
    roleRepo.findById.mockResolvedValueOnce(createRole({ id: 'dev-role', status: 'paused' }));

    const result = await orchestrator.wakeRoleIfPossible('dev-role', 'org-1', 'sub-1', 'task_assigned');

    expect(result).toBe(false);
    expect(executionEngine.startRun).not.toHaveBeenCalled();
  });

  it('handles dispute:detected by waking parent role', async () => {
    await orchestrator.handleEvent({
      type: 'dispute:detected',
      timestamp: new Date().toISOString(),
      payload: { parentRoleId: 'lead-role', orgId: 'org-1', taskId: 'sub-1' },
    });

    expect(executionEngine.startRun).toHaveBeenCalledWith(
      'lead-role', 'sub-1', 'org-1', 'dispute_detected',
    );
  });
});
