import { describe, it, expect, beforeEach, vi } from 'vitest';
import { RunEngine } from '@core/modules/execution/engines/run.engine';
import type { IRunRepository } from '@core/modules/execution/interfaces/i-run.repository';
import type { IExecutor } from '@core/modules/execution/interfaces/i-executor';
import type { Run, ExecutorOutput } from '@core/modules/execution/types/execution.types';
import { CostTracker } from '@core/modules/execution/services/cost-tracker';
import { FileLogService } from '@core/modules/execution/logging/file-log.service';
import { MockEventBus } from '../../helpers/mock-event-bus';
import { MockLogger } from '../../helpers/mock-logger';
import { createTestConfig, createRunExecutionParams, TEST_ORG_ID, TEST_ROLE_ID } from '../../helpers/fixtures';
import { ExecutionError } from '@core/foundation/errors/capibara.errors';

function createMockRun(overrides?: Partial<Run>): Run {
  return {
    id: 'run-1',
    orgId: TEST_ORG_ID,
    taskId: 'task-1',
    conversationId: null,
    roleId: TEST_ROLE_ID,
    status: 'queued',
    wakeReason: 'task_assigned',
    startedAt: null,
    finishedAt: null,
    costUsd: 0,
    tokenCount: 0,
    summary: null,
    errorMessage: null,
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

function createMockExecutorOutput(overrides?: Partial<ExecutorOutput>): ExecutorOutput {
  return {
    exitCode: 0,
    status: 'succeeded',
    summary: 'Task completed',
    errorMessage: null,
    model: 'claude-sonnet-4-6-20250514',
    sessionId: 'sess-1',
    inputTokens: 1000,
    outputTokens: 500,
    cachedInputTokens: 200,
    ...overrides,
  };
}

describe('RunEngine', () => {
  let engine: RunEngine;
  let runRepo: IRunRepository;
  let executor: IExecutor;
  let eventBus: MockEventBus;
  let logger: MockLogger;
  let costTracker: CostTracker;
  let fileLogService: FileLogService;
  let costEntryRepo: { create: ReturnType<typeof vi.fn>; getTotalTokensByOrgId: ReturnType<typeof vi.fn>; getTotalCostByOrgId: ReturnType<typeof vi.fn>; findByRunId: ReturnType<typeof vi.fn>; findByOrgId: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    eventBus = new MockEventBus();
    logger = new MockLogger();

    const mockRun = createMockRun();
    runRepo = {
      findById: vi.fn().mockReturnValue(mockRun),
      findByOrgId: vi.fn().mockReturnValue([]),
      findByTaskId: vi.fn().mockReturnValue([]),
      findActiveByRoleId: vi.fn().mockReturnValue(null),
      findActiveByOrgId: vi.fn().mockReturnValue(null),
      create: vi.fn().mockReturnValue(mockRun),
      updateStatus: vi.fn(),
      finish: vi.fn(),
    };

    executor = {
      execute: vi.fn().mockResolvedValue(createMockExecutorOutput()),
      abort: vi.fn(),
      onLog: vi.fn(),
    };

    costEntryRepo = {
      create: vi.fn().mockReturnValue({ id: 'cost-1', runId: 'run-1', roleId: TEST_ROLE_ID, orgId: TEST_ORG_ID, tokenCount: 1500, costUsd: 0, createdAt: '' }),
      getTotalTokensByOrgId: vi.fn().mockReturnValue(0),
      getTotalCostByOrgId: vi.fn().mockReturnValue(0),
      findByRunId: vi.fn().mockReturnValue([]),
      findByOrgId: vi.fn().mockReturnValue([]),
    };
    costTracker = new CostTracker(costEntryRepo);

    fileLogService = {
      writeInput: vi.fn(),
      append: vi.fn(),
      flush: vi.fn().mockResolvedValue(undefined),
      readRaw: vi.fn().mockResolvedValue([]),
    } as unknown as FileLogService;

    const taskRepo = {
      findById: vi.fn().mockReturnValue(null),
      findByOrgId: vi.fn().mockReturnValue([]),
      findChildren: vi.fn().mockReturnValue([]),
      hasChildren: vi.fn().mockReturnValue(false),
      findByAssigneeRoleId: vi.fn().mockReturnValue([]),
      create: vi.fn(),
      updateStatus: vi.fn(),
      updatePausedReason: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    };
    const taskStateMachine = {
      transition: vi.fn(),
      confirmApproval: vi.fn(),
      rejectApproval: vi.fn(),
      setBehaviorEngine: vi.fn(),
    } as unknown as import('@core/modules/workflow/engines/task.state-machine').TaskStateMachine;
    const processEngine = {
      getStatusCategory: vi.fn().mockReturnValue(null),
      getInitialStatus: vi.fn().mockReturnValue(null),
      getAvailableTransitions: vi.fn().mockReturnValue([]),
    } as unknown as import('@core/modules/workflow/engines/process.engine').ProcessEngine;

    const config = createTestConfig();
    engine = new RunEngine(
      runRepo, executor, eventBus, eventBus, logger, config, costTracker, fileLogService,
      taskRepo, taskStateMachine, processEngine,
    );
  });

  describe('execute — golden path (succeeded)', () => {
    it('creates run, executes, and returns successful result', async () => {
      const params = createRunExecutionParams();
      const result = await engine.execute(params);

      expect(result.status).toBe('succeeded');
      expect(result.runId).toBe('run-1');
      expect(result.sessionId).toBe('sess-1');
      expect(result.inputTokens).toBe(1000);
      expect(result.outputTokens).toBe(500);
    });

    it('emits events in correct order: queued → started → succeeded', async () => {
      await engine.execute(createRunExecutionParams());

      eventBus.assertOrder(['run:queued', 'run:started', 'run:succeeded']);
    });

    it('creates run record via repository', async () => {
      await engine.execute(createRunExecutionParams());

      expect(runRepo.create).toHaveBeenCalledWith({
        orgId: TEST_ORG_ID,
        taskId: 'task-test-1',
        conversationId: null,
        roleId: TEST_ROLE_ID,
        wakeReason: 'task_assigned',
      });
    });

    it('updates run status to running', async () => {
      await engine.execute(createRunExecutionParams());

      expect(runRepo.updateStatus).toHaveBeenCalledWith('run-1', 'running');
    });

    it('finishes run with token count and status', async () => {
      await engine.execute(createRunExecutionParams());

      expect(runRepo.finish).toHaveBeenCalledWith(
        'run-1', 'succeeded', 1500, 0, 'sess-1', 'Task completed', null,
      );
    });

    it('records cost when tokens > 0', async () => {
      await engine.execute(createRunExecutionParams());

      expect(costEntryRepo.create).toHaveBeenCalledWith({
        runId: 'run-1',
        roleId: TEST_ROLE_ID,
        orgId: TEST_ORG_ID,
        tokenCount: 1500,
        costUsd: 0,
      });
    });

    it('writes input to file log', async () => {
      await engine.execute(createRunExecutionParams());

      expect(fileLogService.writeInput).toHaveBeenCalledWith(
        'test', 'ctx-1', 'run-1',
        expect.objectContaining({ roleId: TEST_ROLE_ID }),
      );
    });
  });

  describe('execute — failed', () => {
    it('emits run:failed when executor returns failed status', async () => {
      (executor.execute as ReturnType<typeof vi.fn>).mockResolvedValue(
        createMockExecutorOutput({ status: 'failed', errorMessage: 'CLI error' }),
      );

      const result = await engine.execute(createRunExecutionParams());

      expect(result.status).toBe('failed');
      eventBus.assertEmitted('run:failed');
    });

    it('emits run:failed when executor throws', async () => {
      (executor.execute as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('crash'));

      await expect(engine.execute(createRunExecutionParams())).rejects.toThrow('crash');
      eventBus.assertOrder(['run:queued', 'run:started', 'run:failed']);
    });

    it('finishes run with failed status on executor error', async () => {
      (executor.execute as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('crash'));

      await expect(engine.execute(createRunExecutionParams())).rejects.toThrow();
      expect(runRepo.finish).toHaveBeenCalledWith('run-1', 'failed');
    });
  });

  describe('execute — cancelled', () => {
    it('emits run:cancelled when executor returns cancelled status', async () => {
      (executor.execute as ReturnType<typeof vi.fn>).mockResolvedValue(
        createMockExecutorOutput({ status: 'cancelled' }),
      );

      const result = await engine.execute(createRunExecutionParams());

      expect(result.status).toBe('cancelled');
      eventBus.assertEmitted('run:cancelled');
    });
  });

  describe('cancelRun', () => {
    it('aborts executor and finishes run as cancelled', async () => {
      await engine.cancelRun('run-1');

      expect(executor.abort).toHaveBeenCalledWith('run-1');
      expect(runRepo.finish).toHaveBeenCalledWith('run-1', 'cancelled');
      eventBus.assertEmitted('run:cancelled');
    });
  });

  describe('serial execution guard', () => {
    it('throws ExecutionError when org already has active run', async () => {
      (runRepo.findActiveByOrgId as ReturnType<typeof vi.fn>).mockReturnValue(createMockRun({ id: 'active-run' }));

      await expect(engine.execute(createRunExecutionParams()))
        .rejects.toThrow(ExecutionError);
    });
  });

  describe('edge cases', () => {
    it('does not record cost when tokenCount is 0', async () => {
      (executor.execute as ReturnType<typeof vi.fn>).mockResolvedValue(
        createMockExecutorOutput({ inputTokens: 0, outputTokens: 0 }),
      );

      await engine.execute(createRunExecutionParams());
      expect(costEntryRepo.create).not.toHaveBeenCalled();
    });

    it('handles null sessionId in executor output', async () => {
      (executor.execute as ReturnType<typeof vi.fn>).mockResolvedValue(
        createMockExecutorOutput({ sessionId: null }),
      );

      const result = await engine.execute(createRunExecutionParams());
      expect(result.sessionId).toBeNull();
    });

    it('uses userMessage instead of prompt when sessionId present', async () => {
      const params = createRunExecutionParams({
        sessionId: 'sess-existing',
        userMessage: 'follow up message',
        prompt: 'original prompt',
      });

      await engine.execute(params);

      expect(executor.execute).toHaveBeenCalledWith(
        expect.objectContaining({ prompt: 'follow up message', sessionId: 'sess-existing' }),
      );
    });

    it('defaults wakeReason to task_assigned when not provided', async () => {
      const params = createRunExecutionParams({ wakeReason: undefined });

      await engine.execute(params);

      expect(runRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ wakeReason: 'task_assigned' }),
      );
    });
  });

  describe('log callbacks', () => {
    it('invokes registered log callbacks on executor log', () => {
      const logCallback = vi.fn();
      engine.onLog(logCallback);

      const onLogHandler = (executor.onLog as ReturnType<typeof vi.fn>).mock.calls[0][0];
      onLogHandler('run-1', 'stdout', 'test chunk');

      expect(logCallback).toHaveBeenCalledWith('run-1', 'stdout', 'test chunk');
    });

    it('emits run:log event on executor log', () => {
      const onLogHandler = (executor.onLog as ReturnType<typeof vi.fn>).mock.calls[0][0];
      onLogHandler('run-1', 'stderr', 'error output');

      eventBus.assertEmitted('run:log');
      const event = eventBus.getLastEmitted('run:log');
      expect(event?.payload).toEqual(expect.objectContaining({ runId: 'run-1', stream: 'stderr' }));
    });
  });
});
