/**
 * WakeGateValidator Unit Tests
 *
 * Covers: 4-gate validation (role status, budget, serial execution, circuit breaker),
 * escalation (parent wake, top-level), wake count management, trigger priority mapping,
 * and all edge cases.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { WakeGateValidator } from '@main/application/orchestrator/wake-gate.validator.js';
import type { GateResult } from '@main/application/orchestrator/wake-gate.validator.js';
import type { IRoleRepository } from '@main/core/interfaces/i-role.repository.js';
import type { IRunRepository } from '@main/core/interfaces/i-run.repository.js';
import type { ICostEntryRepository } from '@main/core/interfaces/i-cost-entry.repository.js';
import type { IPendingWakeRepository } from '@main/core/interfaces/i-pending-wake.repository.js';
import type { IEventBus } from '@main/core/interfaces/i-event-bus.js';
import type { ILogger } from '@main/core/interfaces/i-logger.js';
import type { CapibaraConfig } from '@main/core/types/config.types.js';
import type { Role, Run, WakeTrigger } from '@main/core/types/domain.types.js';

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

function createRun(overrides: Partial<Run> = {}): Run {
  return {
    id: 'run-1', orgId: 'org-1', taskNodeId: 'task-1', roleId: 'role-1', status: 'running',
    trigger: 'task_assigned', startedAt: null, finishedAt: null, tokenCount: 0,
    sessionId: null, createdAt: '',
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
    findChildren: vi.fn(), create: vi.fn(), update: vi.fn().mockResolvedValue(role), delete: vi.fn(),
  } as any;
}

function createMockRunRepo(activeRun: Run | null = null): IRunRepository {
  return {
    findById: vi.fn(), findByOrgId: vi.fn(), findByTaskId: vi.fn(), findActiveByRoleId: vi.fn(),
    findActiveByOrgId: vi.fn().mockResolvedValue(activeRun), findAnyActiveRun: vi.fn(),
    create: vi.fn(), updateStatus: vi.fn(), finish: vi.fn(), findLastSessionId: vi.fn(),
  } as any;
}

function createMockCostRepo(totalTokens = 0): ICostEntryRepository {
  return {
    findByRunId: vi.fn(), findByOrgId: vi.fn(),
    getTotalTokensByOrgId: vi.fn().mockResolvedValue(totalTokens), create: vi.fn(),
  } as any;
}

function createMockPendingWakeRepo(): IPendingWakeRepository {
  return {
    findByRoleId: vi.fn(), findByOrgId: vi.fn(), findHighestPriority: vi.fn(),
    create: vi.fn().mockResolvedValue({ id: 'pw-1' }), consume: vi.fn(),
    consumeAllForRole: vi.fn(), consumeByRoleAndTask: vi.fn(),
  } as any;
}

interface Deps {
  config: CapibaraConfig;
  logger: ILogger;
  eventBus: IEventBus;
  roleRepo: IRoleRepository;
  runRepo: IRunRepository;
  costRepo: ICostEntryRepository;
  pendingWakeRepo: IPendingWakeRepository;
  validator: WakeGateValidator;
}

function createValidator(opts: {
  role?: Role | null;
  activeRun?: Run | null;
  totalTokens?: number;
  configOverrides?: Partial<CapibaraConfig['execution']>;
} = {}): Deps {
  const config = createConfig(opts.configOverrides);
  const logger = createMockLogger();
  const eventBus = createMockEventBus();
  const roleRepo = createMockRoleRepo('role' in opts ? opts.role! : createRole());
  const runRepo = createMockRunRepo(opts.activeRun ?? null);
  const costRepo = createMockCostRepo(opts.totalTokens ?? 0);
  const pendingWakeRepo = createMockPendingWakeRepo();
  const validator = new WakeGateValidator(config, logger, eventBus, roleRepo, runRepo, costRepo, pendingWakeRepo);
  return { config, logger, eventBus, roleRepo, runRepo, costRepo, pendingWakeRepo, validator };
}

// ─── Tests ──────────────────────────────────────────────────

describe('WakeGateValidator', () => {
  const ORG = 'org-1';
  const ROLE = 'role-1';
  const TASK = 'task-1';
  const TRIGGER: WakeTrigger = 'task_assigned';

  // ═══════════════════════════════════════════════════════════
  // Full pass-through (all gates pass)
  // ═══════════════════════════════════════════════════════════

  describe('all gates pass', () => {
    it('should return allowed=true with role when all gates pass', async () => {
      const role = createRole();
      const { validator } = createValidator({ role });

      const result = await validator.check(ROLE, ORG, TASK, TRIGGER);

      expect(result.allowed).toBe(true);
      expect((result as any).role).toEqual(role);
    });
  });

  // ═══════════════════════════════════════════════════════════
  // Gate 1: Role Status
  // ═══════════════════════════════════════════════════════════

  describe('Gate 1: role status', () => {
    it('should reject when role is not found', async () => {
      const { validator } = createValidator({ role: null });

      const result = await validator.check(ROLE, ORG, TASK, TRIGGER);

      expect(result).toEqual({ allowed: false, reason: 'role_inactive' });
    });

    it('should reject when role status is paused', async () => {
      const { validator } = createValidator({ role: createRole({ status: 'paused' }) });

      const result = await validator.check(ROLE, ORG, TASK, TRIGGER);

      expect(result).toEqual({ allowed: false, reason: 'role_inactive' });
    });

    it('should reject when role status is idle', async () => {
      const { validator } = createValidator({ role: createRole({ status: 'idle' }) });

      const result = await validator.check(ROLE, ORG, TASK, TRIGGER);

      expect(result).toEqual({ allowed: false, reason: 'role_inactive' });
    });

    it('should pass when role status is active', async () => {
      const { validator } = createValidator({ role: createRole({ status: 'active' }) });

      const result = await validator.check(ROLE, ORG, TASK, TRIGGER);

      expect(result.allowed).toBe(true);
    });

    it('should log debug message when role is inactive', async () => {
      const { validator, logger } = createValidator({ role: createRole({ status: 'paused' }) });

      await validator.check(ROLE, ORG, TASK, TRIGGER);

      expect(logger.debug).toHaveBeenCalledWith(
        'Wake skipped: role inactive or not found',
        expect.objectContaining({ roleId: ROLE }),
      );
    });

    it('should not check subsequent gates when role is inactive', async () => {
      const { validator, costRepo, runRepo } = createValidator({ role: null });

      await validator.check(ROLE, ORG, TASK, TRIGGER);

      expect(costRepo.getTotalTokensByOrgId).not.toHaveBeenCalled();
      expect(runRepo.findActiveByOrgId).not.toHaveBeenCalled();
    });
  });

  // ═══════════════════════════════════════════════════════════
  // Gate 2: Budget Check
  // ═══════════════════════════════════════════════════════════

  describe('Gate 2: budget check', () => {
    it('should reject when budget is exceeded', async () => {
      // budgetLimit = 10M tokens, totalTokens = 11M (raw tokens, not millions)
      const { validator } = createValidator({ totalTokens: 11_000_000, configOverrides: { budgetLimit: 10 } });

      const result = await validator.check(ROLE, ORG, TASK, TRIGGER);

      expect(result).toEqual({ allowed: false, reason: 'budget_exceeded' });
    });

    it('should reject when budget is exactly at limit', async () => {
      const { validator } = createValidator({ totalTokens: 10_000_000, configOverrides: { budgetLimit: 10 } });

      const result = await validator.check(ROLE, ORG, TASK, TRIGGER);

      expect(result).toEqual({ allowed: false, reason: 'budget_exceeded' });
    });

    it('should pass when budget is under limit', async () => {
      const { validator } = createValidator({ totalTokens: 9_999_999, configOverrides: { budgetLimit: 10 } });

      const result = await validator.check(ROLE, ORG, TASK, TRIGGER);

      expect(result.allowed).toBe(true);
    });

    it('should skip budget check when budgetLimit is 0 (unlimited)', async () => {
      const { validator, costRepo } = createValidator({
        totalTokens: 999_999_999, configOverrides: { budgetLimit: 0 },
      });

      const result = await validator.check(ROLE, ORG, TASK, TRIGGER);

      expect(result.allowed).toBe(true);
      expect(costRepo.getTotalTokensByOrgId).not.toHaveBeenCalled();
    });

    it('should emit budget:exceeded event when budget exceeded', async () => {
      const { validator, eventBus } = createValidator({ totalTokens: 20_000_000, configOverrides: { budgetLimit: 10 } });

      await validator.check(ROLE, ORG, TASK, TRIGGER);

      expect(eventBus.emit).toHaveBeenCalledWith(expect.objectContaining({
        type: 'budget:exceeded',
        payload: expect.objectContaining({ orgId: ORG }),
      }));
    });

    it('should log warning when budget exceeded', async () => {
      const { validator, logger } = createValidator({ totalTokens: 20_000_000, configOverrides: { budgetLimit: 10 } });

      await validator.check(ROLE, ORG, TASK, TRIGGER);

      expect(logger.warn).toHaveBeenCalledWith('Wake skipped: budget exceeded', expect.any(Object));
    });

    it('should not check subsequent gates when budget exceeded', async () => {
      const { validator, runRepo } = createValidator({ totalTokens: 20_000_000, configOverrides: { budgetLimit: 10 } });

      await validator.check(ROLE, ORG, TASK, TRIGGER);

      expect(runRepo.findActiveByOrgId).not.toHaveBeenCalled();
    });
  });

  // ═══════════════════════════════════════════════════════════
  // Gate 3: Serial Execution Lock
  // ═══════════════════════════════════════════════════════════

  describe('Gate 3: serial execution lock', () => {
    it('should reject when org has an active run', async () => {
      const { validator } = createValidator({ activeRun: createRun() });

      const result = await validator.check(ROLE, ORG, TASK, TRIGGER);

      expect(result).toEqual({ allowed: false, reason: 'org_busy' });
    });

    it('should create pending wake when org is busy', async () => {
      const { validator, pendingWakeRepo } = createValidator({ activeRun: createRun() });

      await validator.check(ROLE, ORG, TASK, TRIGGER);

      expect(pendingWakeRepo.create).toHaveBeenCalledWith(expect.objectContaining({
        roleId: ROLE, orgId: ORG, trigger: TRIGGER, taskNodeId: TASK, priority: 0,
      }));
    });

    it('should emit wake:pending-enqueued event when org is busy', async () => {
      const { validator, eventBus } = createValidator({ activeRun: createRun() });

      await validator.check(ROLE, ORG, TASK, TRIGGER);

      expect(eventBus.emit).toHaveBeenCalledWith(expect.objectContaining({
        type: 'wake:pending-enqueued',
        payload: expect.objectContaining({ roleId: ROLE, trigger: TRIGGER }),
      }));
    });

    it('should use correct priority for pending wake based on trigger', async () => {
      const { validator, pendingWakeRepo } = createValidator({ activeRun: createRun() });

      await validator.check(ROLE, ORG, TASK, 'conversation_escalation');

      expect(pendingWakeRepo.create).toHaveBeenCalledWith(expect.objectContaining({ priority: 2 }));
    });

    it('should pass when no active run in org', async () => {
      const { validator } = createValidator({ activeRun: null });

      const result = await validator.check(ROLE, ORG, TASK, TRIGGER);

      expect(result.allowed).toBe(true);
    });

    it('should not check circuit breaker when org is busy', async () => {
      // Role with high wake count should not matter if org is busy
      const role = createRole({ consecutiveWakeCount: 100 });
      const { validator } = createValidator({ role, activeRun: createRun() });

      const result = await validator.check(ROLE, ORG, TASK, TRIGGER);

      expect(result.reason).toBe('org_busy');
    });
  });

  // ═══════════════════════════════════════════════════════════
  // Gate 4: Circuit Breaker
  // ═══════════════════════════════════════════════════════════

  describe('Gate 4: circuit breaker', () => {
    it('should reject when consecutive wake count >= max', async () => {
      const role = createRole({ consecutiveWakeCount: 5 });
      const { validator } = createValidator({ role, configOverrides: { maxConsecutiveWakes: 5 } });

      const result = await validator.check(ROLE, ORG, TASK, TRIGGER);

      expect(result).toEqual({ allowed: false, reason: 'circuit_breaker' });
    });

    it('should reject when consecutive wake count > max', async () => {
      const role = createRole({ consecutiveWakeCount: 10 });
      const { validator } = createValidator({ role, configOverrides: { maxConsecutiveWakes: 5 } });

      const result = await validator.check(ROLE, ORG, TASK, TRIGGER);

      expect(result).toEqual({ allowed: false, reason: 'circuit_breaker' });
    });

    it('should pass when consecutive wake count < max', async () => {
      const role = createRole({ consecutiveWakeCount: 4 });
      const { validator } = createValidator({ role, configOverrides: { maxConsecutiveWakes: 5 } });

      const result = await validator.check(ROLE, ORG, TASK, TRIGGER);

      expect(result.allowed).toBe(true);
    });

    it('should pass when consecutive wake count is 0', async () => {
      const role = createRole({ consecutiveWakeCount: 0 });
      const { validator } = createValidator({ role });

      const result = await validator.check(ROLE, ORG, TASK, TRIGGER);

      expect(result.allowed).toBe(true);
    });

    it('should emit circuit-breaker:self-wake event', async () => {
      const role = createRole({ consecutiveWakeCount: 5 });
      const { validator, eventBus } = createValidator({ role, configOverrides: { maxConsecutiveWakes: 5 } });

      await validator.check(ROLE, ORG, TASK, TRIGGER);

      expect(eventBus.emit).toHaveBeenCalledWith(expect.objectContaining({
        type: 'circuit-breaker:self-wake',
        payload: expect.objectContaining({ roleId: ROLE, count: 5 }),
      }));
    });

    it('should log warning when circuit breaker triggers', async () => {
      const role = createRole({ consecutiveWakeCount: 5 });
      const { validator, logger } = createValidator({ role, configOverrides: { maxConsecutiveWakes: 5 } });

      await validator.check(ROLE, ORG, TASK, TRIGGER);

      expect(logger.warn).toHaveBeenCalledWith(
        'Circuit breaker: self-wake limit reached',
        expect.objectContaining({ roleId: ROLE, selfWakeCount: 5 }),
      );
    });
  });

  // ═══════════════════════════════════════════════════════════
  // Circuit Breaker Escalation
  // ═══════════════════════════════════════════════════════════

  describe('circuit breaker escalation', () => {
    it('should escalate to parent role when parent exists', async () => {
      const role = createRole({ id: 'child-role', parentId: 'parent-role', consecutiveWakeCount: 5 });
      const { validator, eventBus } = createValidator({ role, configOverrides: { maxConsecutiveWakes: 5 } });

      await validator.check('child-role', ORG, TASK, TRIGGER);

      expect(eventBus.emit).toHaveBeenCalledWith(expect.objectContaining({
        type: 'wake:triggered',
        payload: expect.objectContaining({
          roleId: 'parent-role', orgId: ORG, trigger: 'retry_failed', taskNodeId: TASK,
        }),
      }));
    });

    it('should emit escalation:top-level when no parent', async () => {
      const role = createRole({ id: 'top-role', parentId: null, consecutiveWakeCount: 5 });
      const { validator, eventBus } = createValidator({ role, configOverrides: { maxConsecutiveWakes: 5 } });

      await validator.check('top-role', ORG, TASK, TRIGGER);

      expect(eventBus.emit).toHaveBeenCalledWith(expect.objectContaining({
        type: 'escalation:top-level',
        payload: expect.objectContaining({
          roleId: 'top-role', orgId: ORG, taskId: TASK,
        }),
      }));
    });

    it('should log error when top-level escalation occurs', async () => {
      const role = createRole({ id: 'top-role', parentId: null, consecutiveWakeCount: 5 });
      const { validator, logger } = createValidator({ role, configOverrides: { maxConsecutiveWakes: 5 } });

      await validator.check('top-role', ORG, TASK, TRIGGER);

      expect(logger.error).toHaveBeenCalledWith(
        'Escalation reached top-level role with no parent',
        expect.objectContaining({ roleId: 'top-role' }),
      );
    });

    it('should include failure reason in top-level escalation payload', async () => {
      const role = createRole({ id: 'top-role', parentId: null, consecutiveWakeCount: 7 });
      const { validator, eventBus } = createValidator({ role, configOverrides: { maxConsecutiveWakes: 5 } });

      await validator.check('top-role', ORG, TASK, TRIGGER);

      const topLevelCall = (eventBus.emit as any).mock.calls.find(
        (c: any[]) => c[0]?.type === 'escalation:top-level',
      );
      expect(topLevelCall[0].payload.failureReason).toContain('7 consecutive wakes');
    });
  });

  // ═══════════════════════════════════════════════════════════
  // Wake Count Management
  // ═══════════════════════════════════════════════════════════

  describe('wake count management', () => {
    it('should increment wake count by 1', async () => {
      const { validator, roleRepo } = createValidator();

      await validator.incrementWakeCount('role-1', 3);

      expect(roleRepo.update).toHaveBeenCalledWith({ id: 'role-1', consecutiveWakeCount: 4 });
    });

    it('should increment from 0 to 1', async () => {
      const { validator, roleRepo } = createValidator();

      await validator.incrementWakeCount('role-1', 0);

      expect(roleRepo.update).toHaveBeenCalledWith({ id: 'role-1', consecutiveWakeCount: 1 });
    });

    it('should reset wake count to 0', async () => {
      const { validator, roleRepo } = createValidator();

      await validator.resetWakeCount('role-1');

      expect(roleRepo.update).toHaveBeenCalledWith({ id: 'role-1', consecutiveWakeCount: 0 });
    });
  });

  // ═══════════════════════════════════════════════════════════
  // Trigger Priority Mapping
  // ═══════════════════════════════════════════════════════════

  describe('trigger priority mapping', () => {
    it('should return 2 for conversation_escalation', () => {
      const { validator } = createValidator();
      expect(validator.triggerToPriority('conversation_escalation')).toBe(2);
    });

    it('should return 1 for discussion_reply', () => {
      const { validator } = createValidator();
      expect(validator.triggerToPriority('discussion_reply')).toBe(1);
    });

    it('should return 0 for task_assigned', () => {
      const { validator } = createValidator();
      expect(validator.triggerToPriority('task_assigned')).toBe(0);
    });

    it('should return 0 for retry_failed', () => {
      const { validator } = createValidator();
      expect(validator.triggerToPriority('retry_failed')).toBe(0);
    });

    it('should return 0 for review_approve', () => {
      const { validator } = createValidator();
      expect(validator.triggerToPriority('review_approve')).toBe(0);
    });

    it('should return 0 for all other triggers', () => {
      const { validator } = createValidator();
      const others: WakeTrigger[] = [
        'task_completed', 'review_requested', 'review_revise',
        'review_delegate', 'delegation_completed', 'dispute_detected',
      ];
      for (const t of others) {
        expect(validator.triggerToPriority(t)).toBe(0);
      }
    });
  });

  // ═══════════════════════════════════════════════════════════
  // Gate Order & Edge Cases
  // ═══════════════════════════════════════════════════════════

  describe('gate execution order', () => {
    it('should check gates in order: role → budget → serial → circuit breaker', async () => {
      // Role passes, budget passes, serial fails
      const role = createRole({ consecutiveWakeCount: 999 }); // would fail gate 4
      const { validator } = createValidator({
        role,
        activeRun: createRun(), // fails gate 3 first
      });

      const result = await validator.check(ROLE, ORG, TASK, TRIGGER);

      // Should fail at gate 3, not gate 4
      expect((result as any).reason).toBe('org_busy');
    });

    it('should fail at gate 1 before checking gate 2', async () => {
      const { validator, costRepo } = createValidator({
        role: null,
        totalTokens: 999_000_000, // would fail gate 2
      });

      const result = await validator.check(ROLE, ORG, TASK, TRIGGER);

      expect((result as any).reason).toBe('role_inactive');
      expect(costRepo.getTotalTokensByOrgId).not.toHaveBeenCalled();
    });

    it('should fail at gate 2 before checking gate 3', async () => {
      const { validator, runRepo } = createValidator({
        totalTokens: 999_000_000,
        configOverrides: { budgetLimit: 1 },
        activeRun: createRun(), // would fail gate 3
      });

      const result = await validator.check(ROLE, ORG, TASK, TRIGGER);

      expect((result as any).reason).toBe('budget_exceeded');
      expect(runRepo.findActiveByOrgId).not.toHaveBeenCalled();
    });
  });

  describe('edge cases', () => {
    it('should handle budgetLimit with fractional token counts', async () => {
      // 5.5M tokens vs 5.5M limit → exactly at limit → rejected
      const { validator } = createValidator({
        totalTokens: 5_500_000,
        configOverrides: { budgetLimit: 5.5 },
      });

      const result = await validator.check(ROLE, ORG, TASK, TRIGGER);

      expect(result).toEqual({ allowed: false, reason: 'budget_exceeded' });
    });

    it('should handle zero totalTokens', async () => {
      const { validator } = createValidator({ totalTokens: 0, configOverrides: { budgetLimit: 10 } });

      const result = await validator.check(ROLE, ORG, TASK, TRIGGER);

      expect(result.allowed).toBe(true);
    });

    it('should handle maxConsecutiveWakes = 0 (always triggers circuit breaker)', async () => {
      const role = createRole({ consecutiveWakeCount: 0 });
      const { validator } = createValidator({ role, configOverrides: { maxConsecutiveWakes: 0 } });

      const result = await validator.check(ROLE, ORG, TASK, TRIGGER);

      expect(result).toEqual({ allowed: false, reason: 'circuit_breaker' });
    });

    it('should handle negative budgetLimit as no-budget-check (treated as 0)', async () => {
      // budgetLimit <= 0 means check is skipped
      const { validator, costRepo } = createValidator({
        totalTokens: 999_000_000, configOverrides: { budgetLimit: -1 },
      });

      const result = await validator.check(ROLE, ORG, TASK, TRIGGER);

      // budgetLimit <= 0, so budget check is skipped
      expect(costRepo.getTotalTokensByOrgId).not.toHaveBeenCalled();
      expect(result.allowed).toBe(true);
    });
  });
});
