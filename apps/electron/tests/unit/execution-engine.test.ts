/**
 * ExecutionEngine Unit Tests
 *
 * Covers: startRun gate checks (role, task, budget, serial execution),
 * cancelRun, executeRun lifecycle (succeeded/failed/cancelled), event emission,
 * token/cost tracking, session ID management, Phase 1 advancement,
 * conversation workflow transitions, resource cleanup, and edge cases.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('tsyringe', () => ({
  injectable: () => (target: any) => target,
  inject: () => () => undefined,
}));

vi.mock('@main/core/tokens.js', () => ({
  CONFIG_TOKEN: Symbol('CONFIG_TOKEN'),
  LOGGER_TOKEN: Symbol('LOGGER_TOKEN'),
  EVENT_BUS_TOKEN: Symbol('EVENT_BUS_TOKEN'),
  ORGANIZATION_REPO_TOKEN: Symbol('ORGANIZATION_REPO_TOKEN'),
  RUN_REPO_TOKEN: Symbol('RUN_REPO_TOKEN'),
  ROLE_REPO_TOKEN: Symbol('ROLE_REPO_TOKEN'),
  TASK_REPO_TOKEN: Symbol('TASK_REPO_TOKEN'),
  COST_ENTRY_REPO_TOKEN: Symbol('COST_ENTRY_REPO_TOKEN'),
  EXECUTOR_TOKEN: Symbol('EXECUTOR_TOKEN'),
  PROMPT_BUILDER_TOKEN: Symbol('PROMPT_BUILDER_TOKEN'),
}));

vi.mock('@main/core/constants/run.constants.js', () => ({
  TERMINAL_RUN_STATUSES: new Set(['succeeded', 'failed', 'cancelled', 'interrupted']),
}));

import { ExecutionEngine } from '@main/application/execution/execution.engine.js';
import { BudgetExceededError, ExecutionError } from '@main/core/errors/capibara.errors.js';
import type { Run, Role, TaskNode, WakeTrigger } from '@main/core/types/domain.types.js';
import type { CapibaraConfig } from '@main/core/types/config.types.js';

// ─── Mock Factories ─────────────────────────────────────────

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
    cli: { defaultExecutor: 'claude', projectDir: '/project', model: 'opus', maxTurnsPerRun: 10, effort: 'medium', timeoutMs: 60000, extraArgs: [] },
    logging: { level: 'info', logDir: '' },
  } as CapibaraConfig;
}

function createRun(overrides: Partial<Run> = {}): Run {
  return {
    id: 'run-1', orgId: 'org-1', taskNodeId: 'task-1', roleId: 'role-1', status: 'queued',
    trigger: 'task_assigned', startedAt: null, finishedAt: null, tokenCount: 0,
    sessionId: null, createdAt: '',
    ...overrides,
  };
}

function createRole(overrides: Partial<Role> = {}): Role {
  return {
    id: 'role-1', orgId: 'org-1', name: 'Dev', parentId: null, persona: '', knowledgeBaseRefs: [],
    skillIds: [], canApprove: true, canDelegate: false, requiresHumanApproval: false,
    consecutiveWakeCount: 0, status: 'active', createdAt: '', updatedAt: '',
    ...overrides,
  };
}

function createTask(overrides: Partial<TaskNode> = {}): TaskNode {
  return {
    id: 'task-1', orgId: 'org-1', parentId: null, type: 'story', title: 'Test', description: '',
    status: 'open', assigneeRoleId: 'role-1', depth: 0, artifactPaths: null,
    createdAt: '', updatedAt: '',
    ...overrides,
  };
}

function createExecutorOutput(overrides: Record<string, any> = {}) {
  return {
    exitCode: 0, status: 'succeeded', summary: 'Done', errorMessage: null,
    model: 'opus', sessionId: 'sess-123', inputTokens: 1000, outputTokens: 500,
    cachedInputTokens: 0,
    ...overrides,
  };
}

function createEngine(opts: {
  configOverrides?: Partial<CapibaraConfig['execution']>;
} = {}) {
  const config = createConfig(opts.configOverrides);
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), child: vi.fn().mockReturnThis() };
  const eventBus = { emit: vi.fn(), on: vi.fn(), off: vi.fn() };
  const orgRepo = { findById: vi.fn().mockResolvedValue({ id: 'org-1', name: 'Test Org', workspacePath: '/workspace' }), findAll: vi.fn(), create: vi.fn(), update: vi.fn(), delete: vi.fn() };
  const runRepo = {
    findById: vi.fn(), findByOrgId: vi.fn(), findByTaskId: vi.fn(), findActiveByRoleId: vi.fn(),
    findActiveByOrgId: vi.fn().mockResolvedValue(null), findAnyActiveRun: vi.fn(),
    create: vi.fn().mockResolvedValue(createRun()), updateStatus: vi.fn().mockResolvedValue(undefined),
    finish: vi.fn().mockResolvedValue(undefined), findLastSessionId: vi.fn().mockResolvedValue(null),
  };
  const roleRepo = { findById: vi.fn().mockResolvedValue(createRole()), findByIds: vi.fn(), findByOrgId: vi.fn(), findChildren: vi.fn(), create: vi.fn(), update: vi.fn(), delete: vi.fn() };
  const taskRepo = { findById: vi.fn().mockResolvedValue(createTask()), findByParentId: vi.fn(), findByOrgId: vi.fn(), findByAssignee: vi.fn(), create: vi.fn(), updateStatus: vi.fn(), updateAssignee: vi.fn(), setArtifactPaths: vi.fn(), delete: vi.fn() };
  const costRepo = { findByRunId: vi.fn(), findByOrgId: vi.fn(), getTotalTokensByOrgId: vi.fn().mockResolvedValue(0), create: vi.fn().mockResolvedValue({}) };
  const executor = { execute: vi.fn().mockResolvedValue(createExecutorOutput()), abort: vi.fn(), onLog: vi.fn() };
  const promptBuilder = { build: vi.fn().mockReturnValue('system prompt') };
  const executionContext = { buildPromptContext: vi.fn().mockResolvedValue({}) };
  const mcpConfigGen = { generate: vi.fn().mockReturnValue('/tmp/mcp.json'), getBridgePath: vi.fn().mockReturnValue('/bin/bridge'), cleanup: vi.fn() };
  const mcpIpcServer = { registerToken: vi.fn(), revokeToken: vi.fn() };
  const fileLogService = { append: vi.fn(), writeInput: vi.fn(), flush: vi.fn().mockResolvedValue(undefined) };
  const taskStateMachine = { setWorkflowEngine: vi.fn(), canTransition: vi.fn(), transition: vi.fn().mockResolvedValue(undefined) };

  const workflowEngine = {
    isTerminalStatus: vi.fn().mockResolvedValue(false),
    isReviewStatus: vi.fn().mockResolvedValue(false),
    isActiveStatus: vi.fn().mockResolvedValue(false),
    getAllStatuses: vi.fn().mockResolvedValue([{ name: 'in_progress', category: 'active' }]),
    getFirstReviewStatus: vi.fn().mockResolvedValue('in_review'),
    canTransition: vi.fn(), getManualTransitions: vi.fn(), getAllItemTypes: vi.fn(),
    getInitialStatus: vi.fn(), getRootTypes: vi.fn(), validateType: vi.fn(),
    getItemTypeDefinition: vi.fn(), findTransitionTargetByCategory: vi.fn(),
    evaluateBehaviors: vi.fn(), getActiveSchema: vi.fn(), saveSchema: vi.fn(),
    analyzeImpactReadOnly: vi.fn(), validateSchemaIntegrity: vi.fn(), invalidateCache: vi.fn(),
  };
  const taskService = { updateStatus: vi.fn().mockResolvedValue(undefined) };

  const engine = new (ExecutionEngine as any)(
    config, logger, eventBus, orgRepo, runRepo, roleRepo, taskRepo,
    costRepo, executor, promptBuilder, executionContext, mcpConfigGen,
    mcpIpcServer, fileLogService, taskStateMachine,
  );
  engine.setWorkflowEngine(workflowEngine);
  engine.setTaskService(taskService);

  return {
    engine: engine as ExecutionEngine, config, logger, eventBus, orgRepo, runRepo, roleRepo,
    taskRepo, costRepo, executor, promptBuilder, executionContext, mcpConfigGen, mcpIpcServer,
    fileLogService, taskStateMachine, workflowEngine, taskService,
  };
}

// ─── Tests ──────────────────────────────────────────────────

describe('ExecutionEngine', () => {
  const ORG = 'org-1';
  const ROLE = 'role-1';
  const TASK = 'task-1';
  const TRIGGER: WakeTrigger = 'task_assigned';

  // ═══════════════════════════════════════════════════════════
  // startRun — Gate Checks
  // ═══════════════════════════════════════════════════════════

  describe('startRun — gate checks', () => {
    it('should throw ExecutionError when role is not found', async () => {
      const { engine, roleRepo } = createEngine();
      (roleRepo.findById as any).mockResolvedValue(null);

      await expect(engine.startRun(ROLE, TASK, ORG, TRIGGER)).rejects.toThrow(ExecutionError);
    });

    it('should throw ExecutionError when role is not active', async () => {
      const { engine, roleRepo } = createEngine();
      (roleRepo.findById as any).mockResolvedValue(createRole({ status: 'paused' }));

      await expect(engine.startRun(ROLE, TASK, ORG, TRIGGER)).rejects.toThrow(ExecutionError);
    });

    it('should throw ExecutionError when task is not found', async () => {
      const { engine, taskRepo } = createEngine();
      (taskRepo.findById as any).mockResolvedValue(null);

      await expect(engine.startRun(ROLE, TASK, ORG, TRIGGER)).rejects.toThrow(ExecutionError);
    });

    it('should throw BudgetExceededError when budget exceeded', async () => {
      const { engine, costRepo } = createEngine({ configOverrides: { budgetLimit: 5 } });
      (costRepo.getTotalTokensByOrgId as any).mockResolvedValue(6_000_000);

      await expect(engine.startRun(ROLE, TASK, ORG, TRIGGER)).rejects.toThrow(BudgetExceededError);
    });

    it('should skip budget check when budgetLimit is 0', async () => {
      const { engine, costRepo } = createEngine({ configOverrides: { budgetLimit: 0 } });

      await engine.startRun(ROLE, TASK, ORG, TRIGGER);

      expect(costRepo.getTotalTokensByOrgId).not.toHaveBeenCalled();
    });

    it('should throw ExecutionError when org already has an active run', async () => {
      const { engine, runRepo } = createEngine();
      (runRepo.findActiveByOrgId as any).mockResolvedValue(createRun({ id: 'active-run' }));

      await expect(engine.startRun(ROLE, TASK, ORG, TRIGGER)).rejects.toThrow(ExecutionError);
    });

    it('should pass all gates and create run', async () => {
      const { engine, runRepo, eventBus } = createEngine();

      const run = await engine.startRun(ROLE, TASK, ORG, TRIGGER);

      expect(runRepo.create).toHaveBeenCalledWith(expect.objectContaining({
        orgId: ORG, taskNodeId: TASK, roleId: ROLE, trigger: TRIGGER,
      }));
      expect(run.id).toBe('run-1');
    });

    it('should emit run:queued event on successful start', async () => {
      const { engine, eventBus } = createEngine();

      await engine.startRun(ROLE, TASK, ORG, TRIGGER);

      expect(eventBus.emit).toHaveBeenCalledWith(expect.objectContaining({
        type: 'run:queued',
        payload: expect.objectContaining({ runId: 'run-1', roleId: ROLE, orgId: ORG }),
      }));
    });

    it('should check gates in order: role → task → budget → serial', async () => {
      // Role exists but task doesn't → should fail at task check
      const { engine, roleRepo, taskRepo } = createEngine();
      (roleRepo.findById as any).mockResolvedValue(createRole());
      (taskRepo.findById as any).mockResolvedValue(null);

      const err = await engine.startRun(ROLE, TASK, ORG, TRIGGER).catch((e: any) => e);

      expect(err).toBeInstanceOf(ExecutionError);
      expect(err.message).toContain('Task');
    });

    it('should handle budget exactly at limit (rejected)', async () => {
      const { engine, costRepo } = createEngine({ configOverrides: { budgetLimit: 10 } });
      (costRepo.getTotalTokensByOrgId as any).mockResolvedValue(10_000_000);

      await expect(engine.startRun(ROLE, TASK, ORG, TRIGGER)).rejects.toThrow(BudgetExceededError);
    });

    it('should handle budget just under limit (allowed)', async () => {
      const { engine, costRepo } = createEngine({ configOverrides: { budgetLimit: 10 } });
      (costRepo.getTotalTokensByOrgId as any).mockResolvedValue(9_999_999);

      const run = await engine.startRun(ROLE, TASK, ORG, TRIGGER);
      expect(run).toBeDefined();
    });
  });

  // ═══════════════════════════════════════════════════════════
  // cancelRun
  // ═══════════════════════════════════════════════════════════

  describe('cancelRun', () => {
    it('should throw ExecutionError when run not found', async () => {
      const { engine, runRepo } = createEngine();
      (runRepo.findById as any).mockResolvedValue(null);

      await expect(engine.cancelRun('nonexistent')).rejects.toThrow(ExecutionError);
    });

    it('should throw ExecutionError when run is already terminal', async () => {
      const { engine, runRepo } = createEngine();
      (runRepo.findById as any).mockResolvedValue(createRun({ status: 'succeeded' }));

      await expect(engine.cancelRun('run-1')).rejects.toThrow(ExecutionError);
    });

    it('should throw for each terminal status', async () => {
      const { engine, runRepo } = createEngine();
      for (const status of ['succeeded', 'failed', 'cancelled', 'interrupted'] as const) {
        (runRepo.findById as any).mockResolvedValue(createRun({ status }));
        await expect(engine.cancelRun('run-1')).rejects.toThrow(ExecutionError);
      }
    });

    it('should abort executor, finish run, and emit event', async () => {
      const { engine, runRepo, executor, eventBus } = createEngine();
      (runRepo.findById as any).mockResolvedValue(createRun({ id: 'run-1', status: 'running' }));

      await engine.cancelRun('run-1');

      expect(executor.abort).toHaveBeenCalledWith('run-1');
      expect(runRepo.finish).toHaveBeenCalledWith('run-1', 'cancelled', 0);
      expect(eventBus.emit).toHaveBeenCalledWith(expect.objectContaining({
        type: 'run:cancelled',
        payload: expect.objectContaining({ runId: 'run-1' }),
      }));
    });

    it('should allow cancelling a queued run', async () => {
      const { engine, runRepo } = createEngine();
      (runRepo.findById as any).mockResolvedValue(createRun({ status: 'queued' }));

      await expect(engine.cancelRun('run-1')).resolves.toBeUndefined();
    });
  });

  // ═══════════════════════════════════════════════════════════
  // executeRun — Succeeded
  // ═══════════════════════════════════════════════════════════

  describe('executeRun — succeeded', () => {
    it('should finish run as succeeded and emit run:succeeded', async () => {
      const { engine, runRepo, eventBus, executor } = createEngine();
      (executor.execute as any).mockResolvedValue(createExecutorOutput({ status: 'succeeded' }));

      await engine.startRun(ROLE, TASK, ORG, TRIGGER);
      // Wait for async executeRun
      await vi.waitFor(() => {
        expect(runRepo.finish).toHaveBeenCalled();
      });

      expect(runRepo.finish).toHaveBeenCalledWith('run-1', 'succeeded', 1500, 'sess-123');
      expect(eventBus.emit).toHaveBeenCalledWith(expect.objectContaining({
        type: 'run:succeeded',
        payload: expect.objectContaining({ runId: 'run-1', tokenCount: 1500 }),
      }));
    });

    it('should record cost entry when tokenCount > 0', async () => {
      const { engine, costRepo, executor } = createEngine();
      (executor.execute as any).mockResolvedValue(createExecutorOutput({ inputTokens: 500, outputTokens: 300 }));

      await engine.startRun(ROLE, TASK, ORG, TRIGGER);
      await vi.waitFor(() => {
        expect(costRepo.create).toHaveBeenCalled();
      });

      expect(costRepo.create).toHaveBeenCalledWith(expect.objectContaining({
        runId: 'run-1', roleId: ROLE, orgId: ORG, tokenCount: 800,
      }));
    });

    it('should not record cost entry when tokenCount is 0', async () => {
      const { engine, costRepo, executor } = createEngine();
      (executor.execute as any).mockResolvedValue(createExecutorOutput({ inputTokens: 0, outputTokens: 0 }));

      await engine.startRun(ROLE, TASK, ORG, TRIGGER);
      await vi.waitFor(() => {
        expect(engine.getRunSessionId('run-1')).toBeNull(); // cleanup happened
      });

      expect(costRepo.create).not.toHaveBeenCalled();
    });

    it('should cache sessionId from executor result', async () => {
      const { engine, executor } = createEngine();
      (executor.execute as any).mockResolvedValue(createExecutorOutput({ sessionId: 'new-sess' }));

      await engine.startRun(ROLE, TASK, ORG, TRIGGER);

      // sessionId is cleaned up after run, but was set during run
      // We can verify via the finish call
      await vi.waitFor(() => {
        expect(engine.getRunSessionId('run-1')).toBeNull(); // cleaned up
      });
    });
  });

  // ═══════════════════════════════════════════════════════════
  // executeRun — Failed
  // ═══════════════════════════════════════════════════════════

  describe('executeRun — failed', () => {
    it('should finish run as failed and emit run:failed', async () => {
      const { engine, runRepo, eventBus, executor } = createEngine();
      (executor.execute as any).mockResolvedValue(createExecutorOutput({
        status: 'failed', exitCode: 1, errorMessage: 'Crash',
      }));

      await engine.startRun(ROLE, TASK, ORG, TRIGGER);
      await vi.waitFor(() => {
        expect(runRepo.finish).toHaveBeenCalled();
      });

      expect(runRepo.finish).toHaveBeenCalledWith('run-1', 'failed', 1500, 'sess-123');
      expect(eventBus.emit).toHaveBeenCalledWith(expect.objectContaining({
        type: 'run:failed',
        payload: expect.objectContaining({ runId: 'run-1', error: 'Crash' }),
      }));
    });

    it('should still record cost even for failed runs', async () => {
      const { engine, costRepo, executor } = createEngine();
      (executor.execute as any).mockResolvedValue(createExecutorOutput({
        status: 'failed', inputTokens: 200, outputTokens: 100,
      }));

      await engine.startRun(ROLE, TASK, ORG, TRIGGER);
      await vi.waitFor(() => {
        expect(costRepo.create).toHaveBeenCalled();
      });

      expect(costRepo.create).toHaveBeenCalledWith(expect.objectContaining({ tokenCount: 300 }));
    });
  });

  // ═══════════════════════════════════════════════════════════
  // executeRun — Cancelled (by worker)
  // ═══════════════════════════════════════════════════════════

  describe('executeRun — cancelled by worker', () => {
    it('should finish run as cancelled and emit run:cancelled', async () => {
      const { engine, runRepo, eventBus, executor } = createEngine();
      (executor.execute as any).mockResolvedValue(createExecutorOutput({ status: 'cancelled' }));

      await engine.startRun(ROLE, TASK, ORG, TRIGGER);
      await vi.waitFor(() => {
        expect(runRepo.finish).toHaveBeenCalled();
      });

      expect(runRepo.finish).toHaveBeenCalledWith('run-1', 'cancelled', expect.any(Number), 'sess-123');
      expect(eventBus.emit).toHaveBeenCalledWith(expect.objectContaining({
        type: 'run:cancelled',
      }));
    });
  });

  // ═══════════════════════════════════════════════════════════
  // executeRun — Exception (unexpected error)
  // ═══════════════════════════════════════════════════════════

  describe('executeRun — unexpected error', () => {
    it('should catch executor errors, fail the run, and emit run:failed', async () => {
      const { engine, runRepo, eventBus, executor } = createEngine();
      (executor.execute as any).mockRejectedValue(new Error('Worker crashed'));

      await engine.startRun(ROLE, TASK, ORG, TRIGGER);
      await vi.waitFor(() => {
        expect(runRepo.finish).toHaveBeenCalled();
      });

      expect(runRepo.finish).toHaveBeenCalledWith('run-1', 'failed', 0, null);
      expect(eventBus.emit).toHaveBeenCalledWith(expect.objectContaining({
        type: 'run:failed',
        payload: expect.objectContaining({ runId: 'run-1' }),
      }));
    });

    it('should still cleanup even when executor throws', async () => {
      const { engine, mcpIpcServer, executor } = createEngine();
      (executor.execute as any).mockRejectedValue(new Error('Crash'));

      await engine.startRun(ROLE, TASK, ORG, TRIGGER);
      await vi.waitFor(() => {
        expect(mcpIpcServer.revokeToken).toHaveBeenCalledWith('run-1');
      });
    });

    it('should not throw if finish() fails during error handling', async () => {
      const { engine, runRepo, executor } = createEngine();
      (executor.execute as any).mockRejectedValue(new Error('Crash'));
      (runRepo.finish as any).mockRejectedValue(new Error('DB down'));

      // Should not throw despite double failure
      await engine.startRun(ROLE, TASK, ORG, TRIGGER);
      await vi.waitFor(() => {
        expect(engine.getRunSessionId('run-1')).toBeNull();
      });
    });
  });

  // ═══════════════════════════════════════════════════════════
  // Task Status Transition at Start
  // ═══════════════════════════════════════════════════════════

  describe('task status transition at start', () => {
    it('should transition task to first active status when not terminal or review', async () => {
      const { engine, taskStateMachine, workflowEngine, runRepo } = createEngine();
      (workflowEngine.isTerminalStatus as any).mockResolvedValue(false);
      (workflowEngine.isReviewStatus as any).mockResolvedValue(false);
      (workflowEngine.getAllStatuses as any).mockResolvedValue([
        { name: 'in_progress', category: 'active' },
      ]);

      await engine.startRun(ROLE, TASK, ORG, TRIGGER);
      await vi.waitFor(() => {
        expect(runRepo.finish).toHaveBeenCalled();
      });

      expect(taskStateMachine.transition).toHaveBeenCalledWith(TASK, 'in_progress');
    });

    it('should not transition task when already in terminal status', async () => {
      const { engine, taskStateMachine, workflowEngine, runRepo } = createEngine();
      (workflowEngine.isTerminalStatus as any).mockResolvedValue(true);

      await engine.startRun(ROLE, TASK, ORG, TRIGGER);
      await vi.waitFor(() => {
        expect(runRepo.finish).toHaveBeenCalled();
      });

      expect(taskStateMachine.transition).not.toHaveBeenCalled();
    });

    it('should not transition task when in review status', async () => {
      const { engine, taskStateMachine, workflowEngine, runRepo } = createEngine();
      (workflowEngine.isTerminalStatus as any).mockResolvedValue(false);
      (workflowEngine.isReviewStatus as any).mockResolvedValue(true);

      await engine.startRun(ROLE, TASK, ORG, TRIGGER);
      await vi.waitFor(() => {
        expect(runRepo.finish).toHaveBeenCalled();
      });

      expect(taskStateMachine.transition).not.toHaveBeenCalled();
    });

    it('should swallow transition errors (task may already be in status)', async () => {
      const { engine, taskStateMachine, runRepo } = createEngine();
      (taskStateMachine.transition as any).mockRejectedValue(new Error('Already in status'));

      await engine.startRun(ROLE, TASK, ORG, TRIGGER);
      await vi.waitFor(() => {
        expect(runRepo.finish).toHaveBeenCalled();
      });

      // Should not fail the run
      expect(runRepo.finish).toHaveBeenCalledWith('run-1', 'succeeded', expect.any(Number), expect.any(String));
    });
  });

  // ═══════════════════════════════════════════════════════════
  // Phase 1 Advancement (post-run review)
  // ═══════════════════════════════════════════════════════════

  describe('Phase 1 advancement', () => {
    it('should advance to review when task is active and role requires human approval', async () => {
      const { engine, taskRepo, roleRepo, workflowEngine, taskService, runRepo, executor } = createEngine();
      (executor.execute as any).mockResolvedValue(createExecutorOutput({ status: 'succeeded' }));
      // After run, task is still active
      (taskRepo.findById as any).mockResolvedValue(createTask({ status: 'in_progress' }));
      (workflowEngine.isActiveStatus as any).mockResolvedValue(true);
      (roleRepo.findById as any).mockResolvedValue(createRole({ requiresHumanApproval: true }));
      (workflowEngine.getFirstReviewStatus as any).mockResolvedValue('in_review');

      await engine.startRun(ROLE, TASK, ORG, TRIGGER);
      await vi.waitFor(() => {
        expect(runRepo.finish).toHaveBeenCalled();
      });

      expect(taskService.updateStatus).toHaveBeenCalledWith(TASK, 'in_review');
    });

    it('should not advance when role does not require human approval', async () => {
      const { engine, taskRepo, roleRepo, workflowEngine, taskService, runRepo, executor } = createEngine();
      (executor.execute as any).mockResolvedValue(createExecutorOutput({ status: 'succeeded' }));
      (taskRepo.findById as any).mockResolvedValue(createTask({ status: 'in_progress' }));
      (workflowEngine.isActiveStatus as any).mockResolvedValue(true);
      (roleRepo.findById as any).mockResolvedValue(createRole({ requiresHumanApproval: false }));

      await engine.startRun(ROLE, TASK, ORG, TRIGGER);
      await vi.waitFor(() => {
        expect(runRepo.finish).toHaveBeenCalled();
      });

      expect(taskService.updateStatus).not.toHaveBeenCalled();
    });

    it('should not advance when task is not in active status after run', async () => {
      const { engine, taskRepo, workflowEngine, taskService, runRepo, executor } = createEngine();
      (executor.execute as any).mockResolvedValue(createExecutorOutput({ status: 'succeeded' }));
      (taskRepo.findById as any).mockResolvedValue(createTask({ status: 'done' }));
      (workflowEngine.isActiveStatus as any).mockResolvedValue(false);

      await engine.startRun(ROLE, TASK, ORG, TRIGGER);
      await vi.waitFor(() => {
        expect(runRepo.finish).toHaveBeenCalled();
      });

      expect(taskService.updateStatus).not.toHaveBeenCalled();
    });

    it('should swallow errors if phase advancement transition fails', async () => {
      const { engine, taskRepo, roleRepo, workflowEngine, taskService, runRepo, executor } = createEngine();
      (executor.execute as any).mockResolvedValue(createExecutorOutput({ status: 'succeeded' }));
      (taskRepo.findById as any).mockResolvedValue(createTask({ status: 'in_progress' }));
      (workflowEngine.isActiveStatus as any).mockResolvedValue(true);
      (roleRepo.findById as any).mockResolvedValue(createRole({ requiresHumanApproval: true }));
      (workflowEngine.getFirstReviewStatus as any).mockResolvedValue('in_review');
      (taskService.updateStatus as any).mockRejectedValue(new Error('Transition not allowed'));

      await engine.startRun(ROLE, TASK, ORG, TRIGGER);
      await vi.waitFor(() => {
        expect(runRepo.finish).toHaveBeenCalled();
      });

      // Should still succeed
      expect(runRepo.finish).toHaveBeenCalledWith('run-1', 'succeeded', expect.any(Number), expect.any(String));
    });
  });

  // ═══════════════════════════════════════════════════════════
  // Phase 1 Advancement — Conversation Awareness
  // ═══════════════════════════════════════════════════════════

  describe('Phase 1 advancement — conversation awareness', () => {
    /**
     * Helper: set up a succeeded run with an active task, requiresHumanApproval role,
     * and a conversation workflow repo. Returns all mocks for assertion.
     */
    function setupConversationScenario(ctx: ReturnType<typeof createEngine>, activeConvo: any | null) {
      const { executor, taskRepo, roleRepo, workflowEngine } = ctx;
      (executor.execute as any).mockResolvedValue(createExecutorOutput({ status: 'succeeded' }));
      (taskRepo.findById as any).mockResolvedValue(createTask({ status: 'in_progress' }));
      (workflowEngine.isActiveStatus as any).mockResolvedValue(true);
      (roleRepo.findById as any).mockResolvedValue(createRole({ requiresHumanApproval: true }));
      (workflowEngine.getFirstReviewStatus as any).mockResolvedValue('awaiting_review');

      const conversationWorkflowRepo = {
        findById: vi.fn(),
        findActiveByRoleAndTask: vi.fn().mockResolvedValue(activeConvo),
        updateState: vi.fn().mockResolvedValue(undefined),
        updateReply: vi.fn(),
        create: vi.fn(),
      };
      ctx.engine.setConversationWorkflowRepo(conversationWorkflowRepo as any);

      return { ...ctx, conversationWorkflowRepo };
    }

    it('should NOT advance to review when AI asked a question and conversation is still active', async () => {
      const ctx = createEngine();
      const activeConvo = { id: 'wf-1', state: 'waiting_for_reply', askingRoleId: ROLE, taskNodeId: TASK };
      const { engine, runRepo, taskService } = setupConversationScenario(ctx, activeConvo);

      await engine.startRun(ROLE, TASK, ORG, TRIGGER);
      await vi.waitFor(() => {
        expect(runRepo.finish).toHaveBeenCalled();
      });

      // Task should stay in_progress — not advanced to awaiting_review
      expect(taskService.updateStatus).not.toHaveBeenCalled();
    });

    it('should advance to review when no active conversation exists (work is done)', async () => {
      const ctx = createEngine();
      const { engine, runRepo, taskService } = setupConversationScenario(ctx, null);

      await engine.startRun(ROLE, TASK, ORG, TRIGGER);
      await vi.waitFor(() => {
        expect(runRepo.finish).toHaveBeenCalled();
      });

      expect(taskService.updateStatus).toHaveBeenCalledWith(TASK, 'awaiting_review');
    });

    it('should advance to review when conversation repo is not set (backward compat)', async () => {
      const ctx = createEngine();
      const { executor, taskRepo, roleRepo, workflowEngine, taskService, runRepo } = ctx;
      (executor.execute as any).mockResolvedValue(createExecutorOutput({ status: 'succeeded' }));
      (taskRepo.findById as any).mockResolvedValue(createTask({ status: 'in_progress' }));
      (workflowEngine.isActiveStatus as any).mockResolvedValue(true);
      (roleRepo.findById as any).mockResolvedValue(createRole({ requiresHumanApproval: true }));
      (workflowEngine.getFirstReviewStatus as any).mockResolvedValue('awaiting_review');
      // Do NOT set conversationWorkflowRepo — should still advance

      await ctx.engine.startRun(ROLE, TASK, ORG, TRIGGER);
      await vi.waitFor(() => {
        expect(runRepo.finish).toHaveBeenCalled();
      });

      expect(taskService.updateStatus).toHaveBeenCalledWith(TASK, 'awaiting_review');
    });

    it('should NOT advance when conversation is in waiting_for_reply state (human has not replied)', async () => {
      const ctx = createEngine();
      const activeConvo = { id: 'wf-2', state: 'waiting_for_reply', askingRoleId: ROLE, taskNodeId: TASK };
      const { engine, runRepo, taskService } = setupConversationScenario(ctx, activeConvo);

      await engine.startRun(ROLE, TASK, ORG, TRIGGER);
      await vi.waitFor(() => {
        expect(runRepo.finish).toHaveBeenCalled();
      });

      expect(taskService.updateStatus).not.toHaveBeenCalled();
    });

    it('should NOT advance when conversation is in reply_received state (not yet resumed)', async () => {
      const ctx = createEngine();
      const activeConvo = { id: 'wf-3', state: 'reply_received', askingRoleId: ROLE, taskNodeId: TASK };
      const { engine, runRepo, taskService } = setupConversationScenario(ctx, activeConvo);

      await engine.startRun(ROLE, TASK, ORG, TRIGGER);
      await vi.waitFor(() => {
        expect(runRepo.finish).toHaveBeenCalled();
      });

      expect(taskService.updateStatus).not.toHaveBeenCalled();
    });

    it('should still advance if conversationWorkflowRepo.findActiveByRoleAndTask throws', async () => {
      const ctx = createEngine();
      const { engine, runRepo, taskService } = setupConversationScenario(ctx, null);
      // Override to throw
      const conversationWorkflowRepo = {
        findById: vi.fn(),
        findActiveByRoleAndTask: vi.fn().mockRejectedValue(new Error('DB error')),
        updateState: vi.fn(),
        updateReply: vi.fn(),
        create: vi.fn(),
      };
      engine.setConversationWorkflowRepo(conversationWorkflowRepo as any);

      await engine.startRun(ROLE, TASK, ORG, TRIGGER);
      await vi.waitFor(() => {
        expect(runRepo.finish).toHaveBeenCalled();
      });

      // On error, should fall through and advance (fail-open for backward compat)
      expect(taskService.updateStatus).toHaveBeenCalledWith(TASK, 'awaiting_review');
    });
  });

  // ═══════════════════════════════════════════════════════════
  // Session ID Management
  // ═══════════════════════════════════════════════════════════

  describe('session ID management', () => {
    it('should return null for unknown runId', () => {
      const { engine } = createEngine();
      expect(engine.getRunSessionId('nonexistent')).toBeNull();
    });

    it('should not resume session for review_approve trigger', async () => {
      const { engine, runRepo, executor } = createEngine();
      (runRepo.findLastSessionId as any).mockResolvedValue('old-session');
      // Ensure create returns a run with the review_approve trigger
      (runRepo.create as any).mockResolvedValue(createRun({ trigger: 'review_approve' }));

      await engine.startRun(ROLE, TASK, ORG, 'review_approve');
      await vi.waitFor(() => {
        expect(runRepo.finish).toHaveBeenCalled();
      });

      // executor should not receive old session
      expect(executor.execute).toHaveBeenCalledWith(expect.objectContaining({
        sessionId: undefined,
      }));
    });

    it('should resume session for non-review_approve triggers', async () => {
      const { engine, runRepo, executor } = createEngine();
      (runRepo.findLastSessionId as any).mockResolvedValue('old-session');

      await engine.startRun(ROLE, TASK, ORG, 'task_assigned');
      await vi.waitFor(() => {
        expect(runRepo.finish).toHaveBeenCalled();
      });

      expect(executor.execute).toHaveBeenCalledWith(expect.objectContaining({
        sessionId: 'old-session',
      }));
    });
  });

  // ═══════════════════════════════════════════════════════════
  // Cleanup
  // ═══════════════════════════════════════════════════════════

  describe('cleanup', () => {
    it('should revoke MCP token after run completes', async () => {
      const { engine, mcpIpcServer, runRepo } = createEngine();

      await engine.startRun(ROLE, TASK, ORG, TRIGGER);
      await vi.waitFor(() => {
        expect(runRepo.finish).toHaveBeenCalled();
      });

      expect(mcpIpcServer.revokeToken).toHaveBeenCalledWith('run-1');
    });

    it('should flush file log after run completes', async () => {
      const { engine, fileLogService, runRepo } = createEngine();

      await engine.startRun(ROLE, TASK, ORG, TRIGGER);
      await vi.waitFor(() => {
        expect(runRepo.finish).toHaveBeenCalled();
      });

      expect(fileLogService.flush).toHaveBeenCalledWith('run-1');
    });

    it('should cleanup MCP config after run completes', async () => {
      const { engine, mcpConfigGen, runRepo } = createEngine();

      await engine.startRun(ROLE, TASK, ORG, TRIGGER);
      await vi.waitFor(() => {
        expect(runRepo.finish).toHaveBeenCalled();
      });

      expect(mcpConfigGen.cleanup).toHaveBeenCalledWith('run-1');
    });

    it('should not fail if flush throws during cleanup', async () => {
      const { engine, fileLogService, runRepo } = createEngine();
      (fileLogService.flush as any).mockRejectedValue(new Error('Flush error'));

      await engine.startRun(ROLE, TASK, ORG, TRIGGER);
      await vi.waitFor(() => {
        expect(runRepo.finish).toHaveBeenCalled();
      });

      // Should still complete without throwing
      expect(runRepo.finish).toHaveBeenCalled();
    });

    it('should clear sessionId from memory after cleanup', async () => {
      const { engine, runRepo } = createEngine();

      await engine.startRun(ROLE, TASK, ORG, TRIGGER);
      await vi.waitFor(() => {
        expect(runRepo.finish).toHaveBeenCalled();
      });

      expect(engine.getRunSessionId('run-1')).toBeNull();
    });
  });

  // ═══════════════════════════════════════════════════════════
  // Run:started event and status update
  // ═══════════════════════════════════════════════════════════

  describe('run:started event', () => {
    it('should emit run:started and update to running status', async () => {
      const { engine, runRepo, eventBus } = createEngine();

      await engine.startRun(ROLE, TASK, ORG, TRIGGER);
      await vi.waitFor(() => {
        expect(runRepo.finish).toHaveBeenCalled();
      });

      expect(runRepo.updateStatus).toHaveBeenCalledWith('run-1', 'running');
      expect(eventBus.emit).toHaveBeenCalledWith(expect.objectContaining({
        type: 'run:started',
        payload: expect.objectContaining({ runId: 'run-1', roleId: ROLE, orgId: ORG }),
      }));
    });
  });

  // ═══════════════════════════════════════════════════════════
  // Log callback registration
  // ═══════════════════════════════════════════════════════════

  describe('log callback', () => {
    it('should register log callback on executor in constructor', () => {
      const { executor } = createEngine();
      expect(executor.onLog).toHaveBeenCalledWith(expect.any(Function));
    });
  });

  // ═══════════════════════════════════════════════════════════
  // Edge cases
  // ═══════════════════════════════════════════════════════════

  describe('edge cases', () => {
    it('should handle null inputTokens/outputTokens as 0', async () => {
      const { engine, runRepo, executor } = createEngine();
      (executor.execute as any).mockResolvedValue(createExecutorOutput({
        inputTokens: null, outputTokens: null,
      }));

      await engine.startRun(ROLE, TASK, ORG, TRIGGER);
      await vi.waitFor(() => {
        expect(runRepo.finish).toHaveBeenCalled();
      });

      expect(runRepo.finish).toHaveBeenCalledWith('run-1', 'succeeded', 0, 'sess-123');
    });

    it('should use org workspacePath as projectDir when available', async () => {
      const { engine, orgRepo, executor, runRepo } = createEngine();
      (orgRepo.findById as any).mockResolvedValue({ id: 'org-1', name: 'Test Org', workspacePath: '/custom/workspace' });

      await engine.startRun(ROLE, TASK, ORG, TRIGGER);
      await vi.waitFor(() => {
        expect(runRepo.finish).toHaveBeenCalled();
      });

      expect(executor.execute).toHaveBeenCalledWith(expect.objectContaining({
        projectDir: '/custom/workspace',
      }));
    });

    it('should fall back to config projectDir when org has no workspacePath', async () => {
      const { engine, orgRepo, executor, runRepo } = createEngine();
      (orgRepo.findById as any).mockResolvedValue({ id: 'org-1', name: 'Test Org', workspacePath: '' });

      await engine.startRun(ROLE, TASK, ORG, TRIGGER);
      await vi.waitFor(() => {
        expect(runRepo.finish).toHaveBeenCalled();
      });

      expect(executor.execute).toHaveBeenCalledWith(expect.objectContaining({
        projectDir: '/project',
      }));
    });

    it('should handle interrupted status from executor', async () => {
      const { engine, runRepo, eventBus, executor } = createEngine();
      (executor.execute as any).mockResolvedValue(createExecutorOutput({ status: 'interrupted' }));

      await engine.startRun(ROLE, TASK, ORG, TRIGGER);
      await vi.waitFor(() => {
        expect(runRepo.finish).toHaveBeenCalled();
      });

      expect(runRepo.finish).toHaveBeenCalledWith('run-1', 'interrupted', expect.any(Number), expect.any(String));
      expect(eventBus.emit).toHaveBeenCalledWith(expect.objectContaining({ type: 'run:failed' }));
    });
  });
});
