/**
 * RetryScheduler Unit Tests
 *
 * Covers: exponential backoff calculation, retry limit, escalation to parent,
 * top-level escalation, task blocked transition, timer management, clearRetryState,
 * stop cleanup, concurrent safety, and edge cases.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { RetryScheduler } from '@main/application/orchestrator/retry.scheduler.js';
import type { IRoleRepository } from '@main/core/interfaces/i-role.repository.js';
import type { IEventBus } from '@main/core/interfaces/i-event-bus.js';
import type { ILogger } from '@main/core/interfaces/i-logger.js';
import type { CapibaraConfig } from '@main/core/types/config.types.js';
import type { Role, WakeTrigger } from '@main/core/types/domain.types.js';
import type { TaskStateMachine } from '@main/application/state-machine/task.state-machine.js';

// ─── Mock Factories ─────────────────────────────────────────

function createMockLogger(): ILogger {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), child: vi.fn().mockReturnThis() };
}

function createMockEventBus(): IEventBus {
  return { emit: vi.fn(), on: vi.fn(), off: vi.fn() } as any;
}

function createRole(overrides: Partial<Role> = {}): Role {
  return {
    id: 'role-1', orgId: 'org-1', name: 'Dev', parentId: null, persona: '', knowledgeBaseRefs: [],
    skillIds: [], canApprove: true, canDelegate: false, requiresHumanApproval: false,
    consecutiveWakeCount: 0, status: 'active', createdAt: '', updatedAt: '',
    ...overrides,
  };
}

function createConfig(overrides: Partial<CapibaraConfig['execution']> = {}): CapibaraConfig {
  return {
    execution: {
      budgetLimit: 10, maxConsecutiveWakes: 5, maxRetryOnFailure: 3,
      maxReviseAttempts: 3, maxDecompositionDepth: 5, retryBackoffMs: 1000,
      ...overrides,
    },
    organization: { template: '', customFile: null },
    skills: { provider: '', bmadRoot: '' },
    database: { driver: 'sqlite', sqlitePath: '' },
    cli: { defaultExecutor: 'claude', projectDir: '.', model: null, maxTurnsPerRun: 10, effort: 'medium', timeoutMs: 60000, extraArgs: [] },
    logging: { level: 'info', logDir: '' },
  } as CapibaraConfig;
}

function createMockRoleRepo(role: Role | null = null): IRoleRepository {
  return {
    findById: vi.fn().mockResolvedValue(role), findByIds: vi.fn(), findByOrgId: vi.fn(),
    findChildren: vi.fn(), create: vi.fn(), update: vi.fn(), delete: vi.fn(),
  } as any;
}

function createMockStateMachine(): TaskStateMachine {
  return {
    setWorkflowEngine: vi.fn(), canTransition: vi.fn(), transition: vi.fn().mockResolvedValue(undefined),
  } as any;
}

interface Deps {
  config: CapibaraConfig;
  logger: ILogger;
  eventBus: IEventBus;
  roleRepo: IRoleRepository;
  stateMachine: TaskStateMachine;
  scheduler: RetryScheduler;
}

function createScheduler(opts: {
  role?: Role | null;
  configOverrides?: Partial<CapibaraConfig['execution']>;
} = {}): Deps {
  const config = createConfig(opts.configOverrides);
  const logger = createMockLogger();
  const eventBus = createMockEventBus();
  const roleRepo = createMockRoleRepo(opts.role ?? createRole());
  const stateMachine = createMockStateMachine();
  const scheduler = new RetryScheduler(config, logger, eventBus, roleRepo);
  scheduler.setTaskStateMachine(stateMachine);
  return { config, logger, eventBus, roleRepo, stateMachine, scheduler };
}

// ─── Tests ──────────────────────────────────────────────────

describe('RetryScheduler', () => {
  const ORG = 'org-1';
  const ROLE = 'role-1';
  const TASK = 'task-1';

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // ═══════════════════════════════════════════════════════════
  // Retry Scheduling with Exponential Backoff
  // ═══════════════════════════════════════════════════════════

  describe('retry scheduling', () => {
    it('should schedule first retry with base backoff (1000ms * 2^0 = 1000ms)', async () => {
      const { scheduler } = createScheduler({ configOverrides: { retryBackoffMs: 1000, maxRetryOnFailure: 3 } });
      const callback = vi.fn().mockResolvedValue(true);

      await scheduler.handleFailure(ROLE, ORG, TASK, callback);

      expect(callback).not.toHaveBeenCalled();
      vi.advanceTimersByTime(1000);
      expect(callback).toHaveBeenCalledWith(ROLE, ORG, TASK, 'retry_failed');
    });

    it('should schedule second retry with doubled backoff (1000ms * 2^1 = 2000ms)', async () => {
      const { scheduler } = createScheduler({ configOverrides: { retryBackoffMs: 1000, maxRetryOnFailure: 3 } });
      const callback = vi.fn().mockResolvedValue(true);

      await scheduler.handleFailure(ROLE, ORG, TASK, callback);
      vi.advanceTimersByTime(1000);
      expect(callback).toHaveBeenCalledTimes(1);

      await scheduler.handleFailure(ROLE, ORG, TASK, callback);
      vi.advanceTimersByTime(1999);
      expect(callback).toHaveBeenCalledTimes(1); // not yet
      vi.advanceTimersByTime(1);
      expect(callback).toHaveBeenCalledTimes(2);
    });

    it('should schedule third retry with 4x backoff (1000ms * 2^2 = 4000ms)', async () => {
      const { scheduler } = createScheduler({ configOverrides: { retryBackoffMs: 1000, maxRetryOnFailure: 4 } });
      const callback = vi.fn().mockResolvedValue(true);

      await scheduler.handleFailure(ROLE, ORG, TASK, callback); // retry 1: 1000ms
      vi.advanceTimersByTime(1000);
      await scheduler.handleFailure(ROLE, ORG, TASK, callback); // retry 2: 2000ms
      vi.advanceTimersByTime(2000);
      await scheduler.handleFailure(ROLE, ORG, TASK, callback); // retry 3: 4000ms

      vi.advanceTimersByTime(3999);
      expect(callback).toHaveBeenCalledTimes(2); // only first two completed
      vi.advanceTimersByTime(1);
      expect(callback).toHaveBeenCalledTimes(3);
    });

    it('should log retry scheduling info', async () => {
      const { scheduler, logger } = createScheduler({ configOverrides: { retryBackoffMs: 500, maxRetryOnFailure: 3 } });
      const callback = vi.fn().mockResolvedValue(true);

      await scheduler.handleFailure(ROLE, ORG, TASK, callback);

      expect(logger.info).toHaveBeenCalledWith(
        'Scheduling retry with backoff',
        expect.objectContaining({ retryCount: 1, maxRetries: 3, backoffMs: 500 }),
      );
    });

    it('should increment retry count with each failure', async () => {
      const { scheduler, logger } = createScheduler({ configOverrides: { retryBackoffMs: 100, maxRetryOnFailure: 5 } });
      const callback = vi.fn().mockResolvedValue(true);

      await scheduler.handleFailure(ROLE, ORG, TASK, callback);
      vi.advanceTimersByTime(100);
      expect(logger.info).toHaveBeenCalledWith('Scheduling retry with backoff', expect.objectContaining({ retryCount: 1 }));

      await scheduler.handleFailure(ROLE, ORG, TASK, callback);
      vi.advanceTimersByTime(200);
      expect(logger.info).toHaveBeenCalledWith('Scheduling retry with backoff', expect.objectContaining({ retryCount: 2 }));
    });
  });

  // ═══════════════════════════════════════════════════════════
  // Retry Limit & Escalation
  // ═══════════════════════════════════════════════════════════

  describe('retry limit exhaustion', () => {
    it('should escalate to parent when retries are exhausted', async () => {
      const role = createRole({ id: ROLE, parentId: 'parent-role' });
      const parentRole = createRole({ id: 'parent-role', name: 'Lead' });
      const { scheduler, roleRepo, eventBus } = createScheduler({
        role, configOverrides: { maxRetryOnFailure: 2, retryBackoffMs: 100 },
      });
      (roleRepo.findById as any).mockImplementation(async (id: string) => {
        if (id === ROLE) return role;
        if (id === 'parent-role') return parentRole;
        return null;
      });
      const callback = vi.fn().mockResolvedValue(true);

      // 2 retries
      await scheduler.handleFailure(ROLE, ORG, TASK, callback);
      vi.advanceTimersByTime(100);
      await scheduler.handleFailure(ROLE, ORG, TASK, callback);
      vi.advanceTimersByTime(200);

      // 3rd failure = exhausted (maxRetryOnFailure=2 means 2 retries allowed)
      await scheduler.handleFailure(ROLE, ORG, TASK, callback);

      expect(eventBus.emit).toHaveBeenCalledWith(expect.objectContaining({
        type: 'wake:triggered',
        payload: expect.objectContaining({ roleId: 'parent-role', trigger: 'retry_failed' }),
      }));
    });

    it('should try to transition task to blocked on escalation', async () => {
      const role = createRole({ id: ROLE, parentId: 'parent-role' });
      const parentRole = createRole({ id: 'parent-role' });
      const { scheduler, roleRepo, stateMachine } = createScheduler({
        role, configOverrides: { maxRetryOnFailure: 0, retryBackoffMs: 100 },
      });
      (roleRepo.findById as any).mockImplementation(async (id: string) => {
        if (id === ROLE) return role;
        if (id === 'parent-role') return parentRole;
        return null;
      });

      await scheduler.handleFailure(ROLE, ORG, TASK, vi.fn());

      expect(stateMachine.transition).toHaveBeenCalledWith(TASK, 'blocked');
    });

    it('should not throw if blocked transition fails', async () => {
      const role = createRole({ id: ROLE, parentId: 'parent-role' });
      const parentRole = createRole({ id: 'parent-role' });
      const { scheduler, roleRepo, stateMachine } = createScheduler({
        role, configOverrides: { maxRetryOnFailure: 0 },
      });
      (roleRepo.findById as any).mockImplementation(async (id: string) => {
        if (id === ROLE) return role;
        if (id === 'parent-role') return parentRole;
        return null;
      });
      (stateMachine.transition as any).mockRejectedValue(new Error('Transition not allowed'));

      // Should not throw
      await expect(scheduler.handleFailure(ROLE, ORG, TASK, vi.fn())).resolves.toBeUndefined();
    });

    it('should emit escalation:top-level when no parent role', async () => {
      const role = createRole({ id: ROLE, parentId: null, name: 'Top Dev' });
      const { scheduler, roleRepo, eventBus } = createScheduler({
        role, configOverrides: { maxRetryOnFailure: 0 },
      });
      (roleRepo.findById as any).mockResolvedValue(role);

      await scheduler.handleFailure(ROLE, ORG, TASK, vi.fn());

      expect(eventBus.emit).toHaveBeenCalledWith(expect.objectContaining({
        type: 'escalation:top-level',
        payload: expect.objectContaining({
          roleId: ROLE, orgId: ORG, taskId: TASK,
        }),
      }));
    });

    it('should include failure reason with retry count in top-level escalation', async () => {
      const role = createRole({ id: ROLE, parentId: null });
      const { scheduler, roleRepo, eventBus } = createScheduler({
        role, configOverrides: { maxRetryOnFailure: 3 },
      });
      (roleRepo.findById as any).mockResolvedValue(role);
      const callback = vi.fn().mockResolvedValue(true);

      // Exhaust 3 retries
      for (let i = 0; i < 3; i++) {
        await scheduler.handleFailure(ROLE, ORG, TASK, callback);
        vi.advanceTimersByTime(10000);
      }
      // Final failure triggers escalation
      await scheduler.handleFailure(ROLE, ORG, TASK, callback);

      const topLevelCall = (eventBus.emit as any).mock.calls.find(
        (c: any[]) => c[0]?.type === 'escalation:top-level',
      );
      expect(topLevelCall[0].payload.failureReason).toContain('3 retries exhausted');
    });

    it('should log error on top-level escalation', async () => {
      const role = createRole({ id: ROLE, parentId: null });
      const { scheduler, roleRepo, logger } = createScheduler({
        role, configOverrides: { maxRetryOnFailure: 0 },
      });
      (roleRepo.findById as any).mockResolvedValue(role);

      await scheduler.handleFailure(ROLE, ORG, TASK, vi.fn());

      expect(logger.error).toHaveBeenCalledWith(
        'Escalation reached top-level role after retries exhausted',
        expect.objectContaining({ roleId: ROLE }),
      );
    });

    it('should clear retry count after exhaustion', async () => {
      const role = createRole({ id: ROLE, parentId: null });
      const { scheduler, roleRepo, logger } = createScheduler({
        role, configOverrides: { maxRetryOnFailure: 1, retryBackoffMs: 100 },
      });
      (roleRepo.findById as any).mockResolvedValue(role);
      const callback = vi.fn().mockResolvedValue(true);

      // 1 retry
      await scheduler.handleFailure(ROLE, ORG, TASK, callback);
      vi.advanceTimersByTime(100);

      // Exhausted → escalation
      await scheduler.handleFailure(ROLE, ORG, TASK, callback);

      // Next failure should start fresh (retry count reset after escalation)
      await scheduler.handleFailure(ROLE, ORG, TASK, callback);
      expect(logger.info).toHaveBeenCalledWith(
        'Scheduling retry with backoff',
        expect.objectContaining({ retryCount: 1 }), // back to 1, not continuing from 2
      );
    });

    it('should silently return when role is not found during escalation', async () => {
      const { scheduler, roleRepo } = createScheduler({
        configOverrides: { maxRetryOnFailure: 0 },
      });
      (roleRepo.findById as any).mockResolvedValue(null);

      await expect(scheduler.handleFailure(ROLE, ORG, TASK, vi.fn())).resolves.toBeUndefined();
    });

    it('should silently skip parent wake when parent role not found', async () => {
      const role = createRole({ id: ROLE, parentId: 'ghost-parent' });
      const { scheduler, roleRepo, eventBus } = createScheduler({
        role, configOverrides: { maxRetryOnFailure: 0 },
      });
      (roleRepo.findById as any).mockImplementation(async (id: string) => {
        if (id === ROLE) return role;
        return null; // parent not found
      });

      await scheduler.handleFailure(ROLE, ORG, TASK, vi.fn());

      // Falls through to top-level escalation
      expect(eventBus.emit).toHaveBeenCalledWith(expect.objectContaining({
        type: 'escalation:top-level',
      }));
    });
  });

  // ═══════════════════════════════════════════════════════════
  // clearRetryState
  // ═══════════════════════════════════════════════════════════

  describe('clearRetryState', () => {
    it('should reset retry count for a task', async () => {
      const { scheduler, logger } = createScheduler({ configOverrides: { retryBackoffMs: 100, maxRetryOnFailure: 5 } });
      const callback = vi.fn().mockResolvedValue(true);

      // Build up retry count
      await scheduler.handleFailure(ROLE, ORG, TASK, callback);
      vi.advanceTimersByTime(100);
      await scheduler.handleFailure(ROLE, ORG, TASK, callback);
      vi.advanceTimersByTime(200);

      // Clear state
      scheduler.clearRetryState(TASK);

      // Next failure should start at retryCount 0 again (backoff = base)
      await scheduler.handleFailure(ROLE, ORG, TASK, callback);
      expect(logger.info).toHaveBeenCalledWith(
        'Scheduling retry with backoff',
        expect.objectContaining({ retryCount: 1, backoffMs: 100 }),
      );
    });

    it('should be safe to call on unknown taskNodeId', () => {
      const { scheduler } = createScheduler();
      expect(() => scheduler.clearRetryState('unknown-task')).not.toThrow();
    });
  });

  // ═══════════════════════════════════════════════════════════
  // stop
  // ═══════════════════════════════════════════════════════════

  describe('stop', () => {
    it('should clear all timers and retry counts', async () => {
      const { scheduler } = createScheduler({ configOverrides: { retryBackoffMs: 5000, maxRetryOnFailure: 5 } });
      const callback = vi.fn().mockResolvedValue(true);

      // Schedule retries for multiple tasks
      await scheduler.handleFailure('role-1', ORG, 'task-a', callback);
      await scheduler.handleFailure('role-2', ORG, 'task-b', callback);

      scheduler.stop();

      // Advance time past all possible backoffs — callbacks should NOT fire
      vi.advanceTimersByTime(100_000);
      expect(callback).not.toHaveBeenCalled();
    });

    it('should allow new retries after stop', async () => {
      const { scheduler, logger } = createScheduler({ configOverrides: { retryBackoffMs: 100, maxRetryOnFailure: 5 } });
      const callback = vi.fn().mockResolvedValue(true);

      await scheduler.handleFailure(ROLE, ORG, TASK, callback);
      scheduler.stop();

      // New failure should start fresh
      await scheduler.handleFailure(ROLE, ORG, TASK, callback);
      expect(logger.info).toHaveBeenCalledWith(
        'Scheduling retry with backoff',
        expect.objectContaining({ retryCount: 1, backoffMs: 100 }),
      );
    });
  });

  // ═══════════════════════════════════════════════════════════
  // Timer Replacement (concurrent safety)
  // ═══════════════════════════════════════════════════════════

  describe('timer replacement', () => {
    it('should replace existing timer for same task on new failure', async () => {
      const { scheduler } = createScheduler({ configOverrides: { retryBackoffMs: 1000, maxRetryOnFailure: 5 } });
      const callback = vi.fn().mockResolvedValue(true);

      await scheduler.handleFailure(ROLE, ORG, TASK, callback);
      // 500ms into first timer, new failure arrives
      vi.advanceTimersByTime(500);
      await scheduler.handleFailure(ROLE, ORG, TASK, callback);

      // First timer was cleared, 500ms more shouldn't trigger
      vi.advanceTimersByTime(500);
      expect(callback).not.toHaveBeenCalled();

      // Second timer needs full 2000ms from its start
      vi.advanceTimersByTime(1500);
      expect(callback).toHaveBeenCalledTimes(1);
    });

    it('should handle multiple tasks independently', async () => {
      const { scheduler } = createScheduler({ configOverrides: { retryBackoffMs: 1000, maxRetryOnFailure: 5 } });
      const callbackA = vi.fn().mockResolvedValue(true);
      const callbackB = vi.fn().mockResolvedValue(true);

      await scheduler.handleFailure('role-a', ORG, 'task-a', callbackA);
      await scheduler.handleFailure('role-b', ORG, 'task-b', callbackB);

      vi.advanceTimersByTime(1000);
      expect(callbackA).toHaveBeenCalledTimes(1);
      expect(callbackB).toHaveBeenCalledTimes(1);
    });
  });

  // ═══════════════════════════════════════════════════════════
  // Edge Cases
  // ═══════════════════════════════════════════════════════════

  describe('edge cases', () => {
    it('should handle maxRetryOnFailure = 0 (immediate escalation)', async () => {
      const role = createRole({ id: ROLE, parentId: null });
      const { scheduler, roleRepo, eventBus } = createScheduler({
        role, configOverrides: { maxRetryOnFailure: 0 },
      });
      (roleRepo.findById as any).mockResolvedValue(role);

      await scheduler.handleFailure(ROLE, ORG, TASK, vi.fn());

      expect(eventBus.emit).toHaveBeenCalledWith(expect.objectContaining({
        type: 'escalation:top-level',
      }));
    });

    it('should handle retryBackoffMs = 0 (immediate retry)', async () => {
      const { scheduler } = createScheduler({ configOverrides: { retryBackoffMs: 0, maxRetryOnFailure: 3 } });
      const callback = vi.fn().mockResolvedValue(true);

      await scheduler.handleFailure(ROLE, ORG, TASK, callback);
      vi.advanceTimersByTime(0);

      expect(callback).toHaveBeenCalledTimes(1);
    });

    it('should handle very large backoff values', async () => {
      const { scheduler } = createScheduler({ configOverrides: { retryBackoffMs: 60000, maxRetryOnFailure: 3 } });
      const callback = vi.fn().mockResolvedValue(true);

      // Retry 3: backoff = 60000 * 2^2 = 240000ms
      await scheduler.handleFailure(ROLE, ORG, TASK, callback);
      vi.advanceTimersByTime(60000);
      await scheduler.handleFailure(ROLE, ORG, TASK, callback);
      vi.advanceTimersByTime(120000);
      await scheduler.handleFailure(ROLE, ORG, TASK, callback);

      vi.advanceTimersByTime(239999);
      expect(callback).toHaveBeenCalledTimes(2);
      vi.advanceTimersByTime(1);
      expect(callback).toHaveBeenCalledTimes(3);
    });
  });
});
