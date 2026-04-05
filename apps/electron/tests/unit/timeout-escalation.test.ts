/**
 * Epic 13 — Story 13.5: Integration Test — Timeout Escalation Chain to Human
 *
 * Verifies:
 * 1. Timeout detection → escalation chain → forced human notification
 * 2. Crash recovery for orphaned workflows
 *
 * Uses mocked repositories — no actual SQLite.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Types ──────────────────────────────────────────────────

interface ConversationWorkflow {
  id: string;
  orgId: string;
  taskNodeId: string;
  discussionGroupId: string;
  askingRoleId: string;
  askingRunId: string;
  askingSessionId: string | null;
  questionMessageId: string;
  replyMessageId: string | null;
  respondentRoleId: string | null;
  respondentType: 'ai' | 'human';
  state: string;
  depth: number;
  parentWorkflowId: string | null;
  priority: number;
  timeoutAt: string | null;
  resolvedAt: string | null;
  auditReason: string | null;
  createdAt: string;
  updatedAt: string;
}

interface DomainEvent<T = unknown> {
  type: string;
  timestamp: string;
  payload: T;
}

// ─── Helpers ────────────────────────────────────────────────

function createRole(id: string, name: string, parentId: string | null) {
  return {
    id,
    orgId: 'org-1',
    name,
    parentId,
    persona: `${name} persona`,
    knowledgeBaseRefs: [],
    skillIds: [],
    canApprove: false,
    canDelegate: false,
    requiresHumanApproval: false,
    status: 'active' as const,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

function createWorkflow(overrides: Partial<ConversationWorkflow> = {}): ConversationWorkflow {
  return {
    id: 'wf-1',
    orgId: 'org-1',
    taskNodeId: 'task-1',
    discussionGroupId: 'dg-1',
    askingRoleId: 'role-dev',
    askingRunId: 'run-1',
    askingSessionId: null,
    questionMessageId: 'msg-1',
    replyMessageId: null,
    respondentRoleId: 'role-em',
    respondentType: 'ai',
    state: 'waiting_for_reply',
    depth: 0,
    parentWorkflowId: null,
    priority: 1,
    timeoutAt: new Date(Date.now() - 10_000).toISOString(), // expired 10s ago
    resolvedAt: null,
    auditReason: null,
    createdAt: new Date(Date.now() - 310_000).toISOString(),
    updatedAt: new Date(Date.now() - 310_000).toISOString(),
    ...overrides,
  };
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
      if (fns) for (const fn of fns) fn(event);
    }),
    on: vi.fn((type: string, handler: (e: DomainEvent) => void) => {
      if (!handlers.has(type)) handlers.set(type, new Set());
      handlers.get(type)!.add(handler);
    }),
    off: vi.fn(),
  };
}

function createMockEventLogger() {
  return {
    log: vi.fn(),
  };
}

// ─── Tests ──────────────────────────────────────────────────

describe('Epic 13 — Timeout Escalation Chain', () => {
  let eventBus: ReturnType<typeof createMockEventBus>;
  let eventLogger: ReturnType<typeof createMockEventLogger>;
  let workflowStore: Map<string, ConversationWorkflow>;
  let workflowRepo: Record<string, ReturnType<typeof vi.fn>>;
  let roleRepo: Record<string, ReturnType<typeof vi.fn>>;
  let pendingWakeRepo: Record<string, ReturnType<typeof vi.fn>>;
  let workflowService: Record<string, ReturnType<typeof vi.fn>>;
  let wfIdCounter: number;

  // Roles: Developer (parent=EM) → EM (parent=CTO) → CTO (parent=null)
  const roleDev = createRole('role-dev', 'Developer', 'role-em');
  const roleEM = createRole('role-em', 'Engineering Manager', 'role-cto');
  const roleCTO = createRole('role-cto', 'CTO', null);

  beforeEach(() => {
    vi.clearAllMocks();
    eventBus = createMockEventBus();
    eventLogger = createMockEventLogger();
    wfIdCounter = 0;
    workflowStore = new Map();

    roleRepo = {
      findById: vi.fn((id: string) => {
        const roles: Record<string, typeof roleDev> = {
          'role-dev': roleDev,
          'role-em': roleEM,
          'role-cto': roleCTO,
        };
        return Promise.resolve(roles[id] ?? null);
      }),
    };

    workflowRepo = {
      findById: vi.fn((id: string) => Promise.resolve(workflowStore.get(id) ?? null)),
      findExpiredWorkflows: vi.fn((_now: string) => {
        const expired = [...workflowStore.values()].filter(
          (wf) => wf.state === 'waiting_for_reply' && wf.timeoutAt && wf.timeoutAt < new Date().toISOString(),
        );
        return Promise.resolve(expired);
      }),
      findByState: vi.fn((state: string) => {
        return Promise.resolve([...workflowStore.values()].filter((wf) => wf.state === state));
      }),
      updateState: vi.fn((id: string, state: string, reason?: string) => {
        const wf = workflowStore.get(id);
        if (wf) {
          wf.state = state;
          wf.auditReason = reason ?? wf.auditReason;
          wf.updatedAt = new Date().toISOString();
        }
        return Promise.resolve();
      }),
      create: vi.fn(),
    };

    pendingWakeRepo = {
      create: vi.fn(() => Promise.resolve({ id: `pw-${++wfIdCounter}` })),
      findByRoleId: vi.fn(() => Promise.resolve([])),
    };

    workflowService = {
      createEscalatedWorkflow: vi.fn((parentWf: ConversationWorkflow, newRespondentRoleId: string) => {
        const newId = `wf-escalated-${++wfIdCounter}`;
        const escalated: ConversationWorkflow = {
          ...parentWf,
          id: newId,
          respondentRoleId: newRespondentRoleId,
          state: 'waiting_for_reply',
          depth: parentWf.depth + 1,
          parentWorkflowId: parentWf.id,
          priority: 2,
          timeoutAt: new Date(Date.now() - 5_000).toISOString(), // expire immediately for chain
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
        workflowStore.set(newId, escalated);
        return Promise.resolve(escalated);
      }),
    };
  });

  async function createService(maxEscalationLevels = 3) {
    // Dynamic import to ensure mocking is set up first
    const { TimeoutEscalationService } = await import(
      '../../src/main/application/conversation/timeout-escalation.service.js'
    );
    return new TimeoutEscalationService(
      workflowRepo as never,
      workflowService as never,
      roleRepo as never,
      pendingWakeRepo as never,
      eventBus as never,
      mockLogger as never,
      eventLogger as never,
      {
        normalTimeoutMs: 300_000,
        urgentTimeoutMs: 60_000,
        maxEscalationLevels,
        scanIntervalMs: 15_000,
      },
    );
  }

  it('escalates Developer→EM timeout to CTO', async () => {
    // Setup: Developer asked EM, EM timed out
    const wf = createWorkflow({
      id: 'wf-1',
      askingRoleId: 'role-dev',
      respondentRoleId: 'role-em',
      depth: 0,
    });
    workflowStore.set(wf.id, wf);

    const service = await createService();

    // Trigger scan (calling private method via bracket notation)
    await (service as unknown as { scan: () => Promise<void> }).scan();

    // Original workflow should be escalated
    expect(workflowRepo.updateState).toHaveBeenCalledWith(
      'wf-1',
      'escalated',
      expect.stringContaining('escalating'),
    );

    // Escalated workflow should target CTO (EM's parent)
    expect(workflowService.createEscalatedWorkflow).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'wf-1' }),
      'role-cto', // EM's parent
    );

    // Audit log should record timeout + escalation
    expect(eventLogger.log).toHaveBeenCalledWith('wf-1', 'timeout_triggered', expect.any(Object));
    expect(eventLogger.log).toHaveBeenCalledWith('wf-1', 'escalation_created', expect.any(Object));
  });

  it('forces human escalation when max depth reached', async () => {
    const wf = createWorkflow({
      id: 'wf-deep',
      askingRoleId: 'role-dev',
      respondentRoleId: 'role-cto',
      depth: 3, // at max escalation level
    });
    workflowStore.set(wf.id, wf);

    const service = await createService(3);
    await (service as unknown as { scan: () => Promise<void> }).scan();

    // Should transition to timed_out (not escalated)
    expect(workflowRepo.updateState).toHaveBeenCalledWith(
      'wf-deep',
      'timed_out',
      expect.stringContaining('max_escalation_depth'),
    );

    // Should NOT create escalated workflow
    expect(workflowService.createEscalatedWorkflow).not.toHaveBeenCalled();

    // Should emit escalation:top-level for mandatory human notification
    expect(eventBus.emit).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'escalation:top-level',
        payload: expect.objectContaining({
          workflowId: 'wf-deep',
          reason: 'max_escalation_depth_reached',
        }),
      }),
    );

    // Should also emit conversation:timed-out
    expect(eventBus.emit).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'conversation:timed-out',
      }),
    );
  });

  it('forces human escalation when respondent has no parent', async () => {
    // CTO has no parent role
    const wf = createWorkflow({
      id: 'wf-top',
      askingRoleId: 'role-dev',
      respondentRoleId: 'role-cto',
      depth: 1,
    });
    workflowStore.set(wf.id, wf);

    const service = await createService();
    await (service as unknown as { scan: () => Promise<void> }).scan();

    // CTO has no parent → forced human escalation
    expect(workflowRepo.updateState).toHaveBeenCalledWith(
      'wf-top',
      'timed_out',
      expect.stringContaining('top_of_hierarchy'),
    );

    expect(eventBus.emit).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'escalation:top-level',
        payload: expect.objectContaining({
          reason: 'top_of_hierarchy',
        }),
      }),
    );
  });

  it('full chain: Dev→EM timeout → EM→CTO timeout → forced human', async () => {
    // Step 1: Developer asked EM, EM timed out
    const wf1 = createWorkflow({
      id: 'wf-chain-1',
      askingRoleId: 'role-dev',
      respondentRoleId: 'role-em',
      depth: 0,
    });
    workflowStore.set(wf1.id, wf1);

    const service = await createService();

    // First scan: escalate wf-chain-1 → new workflow targeting CTO
    await (service as unknown as { scan: () => Promise<void> }).scan();

    expect(workflowService.createEscalatedWorkflow).toHaveBeenCalledTimes(1);
    expect(workflowStore.get('wf-chain-1')!.state).toBe('escalated');

    // The mock createEscalatedWorkflow already added the new workflow to store
    // with depth=1, respondent=CTO, and immediate expiry
    const escalatedWfs = [...workflowStore.values()].filter((w) => w.parentWorkflowId === 'wf-chain-1');
    expect(escalatedWfs).toHaveLength(1);
    expect(escalatedWfs[0].respondentRoleId).toBe('role-cto');
    expect(escalatedWfs[0].depth).toBe(1);

    // Second scan: CTO has no parent → forced human escalation
    vi.clearAllMocks();
    await (service as unknown as { scan: () => Promise<void> }).scan();

    // CTO has no parent → top_of_hierarchy
    expect(eventBus.emit).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'escalation:top-level',
      }),
    );
  });

  describe('Crash Recovery', () => {
    it('recovers expired waiting_for_reply workflows', async () => {
      const wf = createWorkflow({
        id: 'wf-orphan',
        state: 'waiting_for_reply',
        respondentRoleId: 'role-em',
        depth: 0,
      });
      workflowStore.set(wf.id, wf);

      const service = await createService();
      await service.recoverOrphaned();

      // Should have escalated the expired workflow
      expect(workflowRepo.updateState).toHaveBeenCalledWith(
        'wf-orphan',
        'escalated',
        expect.any(String),
      );
      expect(workflowService.createEscalatedWorkflow).toHaveBeenCalled();
    });

    it('re-arms PendingWake for reply_received workflows', async () => {
      const wf = createWorkflow({
        id: 'wf-reply-lost',
        state: 'reply_received',
        askingRoleId: 'role-dev',
      });
      workflowStore.set(wf.id, wf);

      const service = await createService();
      await service.recoverOrphaned();

      // Should create a PendingWake for the asking role
      expect(pendingWakeRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          roleId: 'role-dev',
          trigger: 'discussion_reply',
          taskNodeId: wf.taskNodeId,
        }),
      );
    });

    it('logs recovery summary when orphans found', async () => {
      const wf1 = createWorkflow({ id: 'wf-o1', state: 'reply_received' });
      const wf2 = createWorkflow({ id: 'wf-o2', state: 'waiting_for_reply', depth: 0 });
      workflowStore.set(wf1.id, wf1);
      workflowStore.set(wf2.id, wf2);

      const service = await createService();
      await service.recoverOrphaned();

      expect(mockLogger.info).toHaveBeenCalledWith(
        'Crash recovery complete',
        expect.objectContaining({
          expiredEscalated: expect.any(Number),
          replyRecoveredWakes: expect.any(Number),
        }),
      );
    });
  });

  describe('Service Lifecycle', () => {
    it('starts and stops the scan interval', async () => {
      const service = await createService();

      service.start();
      // Should not throw on double start
      service.start();

      service.stop();
      // Should not throw on double stop
      service.stop();
    });
  });
});
