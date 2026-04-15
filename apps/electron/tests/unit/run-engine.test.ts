/**
 * RunEngine Unit Tests
 *
 * Covers: execute lifecycle (succeeded/failed/cancelled), budget check,
 * serial execution guard, cost tracking, session ID management,
 * cancelRun, cleanup, and edge cases.
 */

import { describe, it, expect, vi } from 'vitest';

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
  COST_ENTRY_REPO_TOKEN: Symbol('COST_ENTRY_REPO_TOKEN'),
  EXECUTOR_TOKEN: Symbol('EXECUTOR_TOKEN'),
}));

vi.mock('@main/core/constants/run.constants.js', () => ({
  TERMINAL_RUN_STATUSES: new Set(['succeeded', 'failed', 'cancelled', 'interrupted']),
}));

vi.mock('../../src/main/infrastructure/executors/stream-json-parser.js', () => ({
  StreamJsonParser: vi.fn().mockImplementation(() => ({
    feed: vi.fn(),
    flush: vi.fn(),
  })),
}));

import { RunEngine } from '@main/application/execution/run.engine.js';
import { BudgetExceededError, ExecutionError } from '@main/core/errors/capibara.errors.js';
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

function createExecutorOutput(overrides: Record<string, any> = {}) {
  return {
    exitCode: 0, status: 'succeeded', summary: 'Done', errorMessage: null,
    model: 'opus', sessionId: 'sess-123', inputTokens: 1000, outputTokens: 500,
    cachedInputTokens: 0,
    ...overrides,
  };
}

function createEngine(opts: { configOverrides?: Partial<CapibaraConfig['execution']> } = {}) {
  const config = createConfig(opts.configOverrides);
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), child: vi.fn().mockReturnThis() };
  const eventBus = { emit: vi.fn(), on: vi.fn(), off: vi.fn() };
  const orgRepo = { findById: vi.fn().mockResolvedValue({ id: 'org-1', name: 'Test Org', workspacePath: '/workspace' }), findAll: vi.fn(), create: vi.fn(), update: vi.fn(), delete: vi.fn() };
  const runRepo = {
    findById: vi.fn(), findByOrgId: vi.fn(), findByTaskId: vi.fn(), findActiveByRoleId: vi.fn(),
    findActiveByOrgId: vi.fn().mockResolvedValue(null), findAnyActiveRun: vi.fn(),
    create: vi.fn().mockResolvedValue({ id: 'run-1', orgId: 'org-1', roleId: 'role-1', status: 'queued', tokenCount: 0 }),
    updateStatus: vi.fn().mockResolvedValue(undefined),
    finish: vi.fn().mockResolvedValue(undefined), findLastSessionId: vi.fn().mockResolvedValue(null),
  };
  const costRepo = { findByRunId: vi.fn(), findByOrgId: vi.fn(), getTotalTokensByOrgId: vi.fn().mockResolvedValue(0), create: vi.fn().mockResolvedValue({}) };
  const executor = { execute: vi.fn().mockResolvedValue(createExecutorOutput()), abort: vi.fn(), onLog: vi.fn() };
  const mcpConfigGen = { generate: vi.fn().mockReturnValue('/tmp/mcp.json'), getBridgePath: vi.fn().mockReturnValue('/bin/bridge'), cleanup: vi.fn() };
  const mcpIpcServer = { registerToken: vi.fn(), revokeToken: vi.fn() };
  const fileLogService = { append: vi.fn(), writeInput: vi.fn(), flush: vi.fn().mockResolvedValue(undefined) };

  const engine = new (RunEngine as any)(
    config, logger, eventBus, orgRepo, runRepo, costRepo, executor,
    mcpConfigGen, mcpIpcServer, fileLogService,
  );

  return {
    engine: engine as RunEngine, config, logger, eventBus, orgRepo, runRepo,
    costRepo, executor, mcpConfigGen, mcpIpcServer, fileLogService,
  };
}

const PARAMS = {
  roleId: 'role-1', orgId: 'org-1', prompt: 'system prompt',
  contextId: 'task-1', contextLabel: 'Test Org', taskNodeId: 'task-1',
  mcpContext: 'task:execution' as const, trigger: 'task_assigned' as const,
};

// ─── Tests ──────────────────────────────────────────────────

describe('RunEngine', () => {

  describe('execute — budget check', () => {
    it('should throw BudgetExceededError when budget exceeded', async () => {
      const { engine, costRepo } = createEngine({ configOverrides: { budgetLimit: 5 } });
      (costRepo.getTotalTokensByOrgId as any).mockResolvedValue(6_000_000);

      await expect(engine.execute(PARAMS)).rejects.toThrow(BudgetExceededError);
    });

    it('should skip budget check when budgetLimit is 0', async () => {
      const { engine, costRepo } = createEngine({ configOverrides: { budgetLimit: 0 } });

      await engine.execute(PARAMS);

      expect(costRepo.getTotalTokensByOrgId).not.toHaveBeenCalled();
    });

    it('should reject when budget exactly at limit', async () => {
      const { engine, costRepo } = createEngine({ configOverrides: { budgetLimit: 10 } });
      (costRepo.getTotalTokensByOrgId as any).mockResolvedValue(10_000_000);

      await expect(engine.execute(PARAMS)).rejects.toThrow(BudgetExceededError);
    });
  });

  describe('execute — serial execution guard', () => {
    it('should throw ExecutionError when org already has an active run', async () => {
      const { engine, runRepo } = createEngine();
      (runRepo.findActiveByOrgId as any).mockResolvedValue({ id: 'active-run' });

      await expect(engine.execute(PARAMS)).rejects.toThrow(ExecutionError);
    });
  });

  describe('execute — succeeded', () => {
    it('should create run, finish as succeeded, and emit events', async () => {
      const { engine, runRepo, eventBus } = createEngine();

      const result = await engine.execute(PARAMS);

      expect(result.status).toBe('succeeded');
      expect(result.runId).toBe('run-1');
      expect(runRepo.create).toHaveBeenCalled();
      expect(runRepo.finish).toHaveBeenCalledWith('run-1', 'succeeded', 1500, 'sess-123');
      expect(eventBus.emit).toHaveBeenCalledWith(expect.objectContaining({ type: 'run:queued' }));
      expect(eventBus.emit).toHaveBeenCalledWith(expect.objectContaining({ type: 'run:started' }));
      expect(eventBus.emit).toHaveBeenCalledWith(expect.objectContaining({ type: 'run:succeeded' }));
    });

    it('should record cost entry when tokenCount > 0', async () => {
      const { engine, costRepo } = createEngine();

      await engine.execute(PARAMS);

      expect(costRepo.create).toHaveBeenCalledWith(expect.objectContaining({
        runId: 'run-1', tokenCount: 1500,
      }));
    });

    it('should not record cost entry when tokenCount is 0', async () => {
      const { engine, costRepo, executor } = createEngine();
      (executor.execute as any).mockResolvedValue(createExecutorOutput({ inputTokens: 0, outputTokens: 0 }));

      await engine.execute(PARAMS);

      expect(costRepo.create).not.toHaveBeenCalled();
    });
  });

  describe('execute — failed', () => {
    it('should finish run as failed and emit run:failed', async () => {
      const { engine, runRepo, eventBus, executor } = createEngine();
      (executor.execute as any).mockResolvedValue(createExecutorOutput({ status: 'failed', errorMessage: 'Crash' }));

      const result = await engine.execute(PARAMS);

      expect(result.status).toBe('failed');
      expect(runRepo.finish).toHaveBeenCalledWith('run-1', 'failed', 1500, 'sess-123');
      expect(eventBus.emit).toHaveBeenCalledWith(expect.objectContaining({ type: 'run:failed' }));
    });

    it('should still record cost for failed runs', async () => {
      const { engine, costRepo, executor } = createEngine();
      (executor.execute as any).mockResolvedValue(createExecutorOutput({ status: 'failed', inputTokens: 200, outputTokens: 100 }));

      await engine.execute(PARAMS);

      expect(costRepo.create).toHaveBeenCalledWith(expect.objectContaining({ tokenCount: 300 }));
    });
  });

  describe('execute — cancelled by worker', () => {
    it('should finish run as cancelled', async () => {
      const { engine, runRepo, executor } = createEngine();
      (executor.execute as any).mockResolvedValue(createExecutorOutput({ status: 'cancelled' }));

      const result = await engine.execute(PARAMS);

      expect(result.status).toBe('cancelled');
      expect(runRepo.finish).toHaveBeenCalledWith('run-1', 'cancelled', expect.any(Number), 'sess-123');
    });
  });

  describe('execute — unexpected error', () => {
    it('should catch executor errors and return failed result', async () => {
      const { engine, runRepo, executor } = createEngine();
      (executor.execute as any).mockRejectedValue(new Error('Worker crashed'));

      const result = await engine.execute(PARAMS);

      expect(result.status).toBe('failed');
      expect(result.errorMessage).toContain('Worker crashed');
      expect(runRepo.finish).toHaveBeenCalledWith('run-1', 'failed', 0, null);
    });

    it('should not throw if finish() fails during error handling', async () => {
      const { engine, runRepo, executor } = createEngine();
      (executor.execute as any).mockRejectedValue(new Error('Crash'));
      (runRepo.finish as any).mockRejectedValue(new Error('DB down'));

      const result = await engine.execute(PARAMS);

      expect(result.status).toBe('failed');
    });
  });

  describe('cancelRun', () => {
    it('should throw when run not found', async () => {
      const { engine, runRepo } = createEngine();
      (runRepo.findById as any).mockResolvedValue(null);

      await expect(engine.cancelRun('nonexistent')).rejects.toThrow(ExecutionError);
    });

    it('should throw when run is already terminal', async () => {
      const { engine, runRepo } = createEngine();
      for (const status of ['succeeded', 'failed', 'cancelled', 'interrupted'] as const) {
        (runRepo.findById as any).mockResolvedValue({ id: 'run-1', status, tokenCount: 0, roleId: 'r1', orgId: 'o1' });
        await expect(engine.cancelRun('run-1')).rejects.toThrow(ExecutionError);
      }
    });

    it('should abort, finish, and emit event', async () => {
      const { engine, runRepo, executor, eventBus } = createEngine();
      (runRepo.findById as any).mockResolvedValue({ id: 'run-1', status: 'running', tokenCount: 0, roleId: 'role-1', orgId: 'org-1' });

      await engine.cancelRun('run-1');

      expect(executor.abort).toHaveBeenCalledWith('run-1');
      expect(runRepo.finish).toHaveBeenCalledWith('run-1', 'cancelled', 0);
      expect(eventBus.emit).toHaveBeenCalledWith(expect.objectContaining({ type: 'run:cancelled' }));
    });
  });

  describe('cleanup', () => {
    it('should revoke MCP token and flush logs after execute', async () => {
      const { engine, mcpIpcServer, fileLogService } = createEngine();

      await engine.execute(PARAMS);

      expect(mcpIpcServer.revokeToken).toHaveBeenCalledWith('run-1');
      expect(fileLogService.flush).toHaveBeenCalledWith('run-1');
    });

    it('should cleanup MCP config after execute', async () => {
      const { engine, mcpConfigGen } = createEngine();

      await engine.execute(PARAMS);

      expect(mcpConfigGen.cleanup).toHaveBeenCalledWith('run-1');
    });

    it('should clear sessionId from memory after execute', async () => {
      const { engine } = createEngine();

      await engine.execute(PARAMS);

      expect(engine.getRunSessionId('run-1')).toBeNull();
    });

    it('should not fail if flush throws during cleanup', async () => {
      const { engine, fileLogService } = createEngine();
      (fileLogService.flush as any).mockRejectedValue(new Error('Flush error'));

      const result = await engine.execute(PARAMS);

      expect(result.status).toBe('succeeded');
    });
  });

  describe('session ID management', () => {
    it('should return null for unknown runId', () => {
      const { engine } = createEngine();
      expect(engine.getRunSessionId('nonexistent')).toBeNull();
    });
  });

  describe('edge cases', () => {
    it('should handle null inputTokens/outputTokens as 0', async () => {
      const { engine, runRepo, executor } = createEngine();
      (executor.execute as any).mockResolvedValue(createExecutorOutput({ inputTokens: null, outputTokens: null }));

      await engine.execute(PARAMS);

      expect(runRepo.finish).toHaveBeenCalledWith('run-1', 'succeeded', 0, 'sess-123');
    });

    it('should use org workspacePath as projectDir', async () => {
      const { engine, orgRepo, executor } = createEngine();
      (orgRepo.findById as any).mockResolvedValue({ id: 'org-1', workspacePath: '/custom/workspace' });

      await engine.execute(PARAMS);

      expect(executor.execute).toHaveBeenCalledWith(expect.objectContaining({
        projectDir: '/custom/workspace',
      }));
    });

    it('should fall back to config projectDir when org has no workspacePath', async () => {
      const { engine, orgRepo, executor } = createEngine();
      (orgRepo.findById as any).mockResolvedValue({ id: 'org-1', workspacePath: '' });

      await engine.execute(PARAMS);

      expect(executor.execute).toHaveBeenCalledWith(expect.objectContaining({
        projectDir: '/project',
      }));
    });

    it('should handle interrupted status from executor', async () => {
      const { engine, runRepo, eventBus, executor } = createEngine();
      (executor.execute as any).mockResolvedValue(createExecutorOutput({ status: 'interrupted' }));

      const result = await engine.execute(PARAMS);

      expect(result.status).toBe('interrupted');
      expect(runRepo.finish).toHaveBeenCalledWith('run-1', 'interrupted', expect.any(Number), expect.any(String));
      expect(eventBus.emit).toHaveBeenCalledWith(expect.objectContaining({ type: 'run:failed' }));
    });
  });

  describe('log callback', () => {
    it('should register log callback on executor in constructor', () => {
      const { executor } = createEngine();
      expect(executor.onLog).toHaveBeenCalledWith(expect.any(Function));
    });
  });
});
