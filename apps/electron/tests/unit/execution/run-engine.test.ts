import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('node:crypto', async () => {
  const actual = await vi.importActual<typeof import('node:crypto')>('node:crypto');
  return { ...actual, randomUUID: () => 'run-1' };
});

import { RunEngine } from '@core/modules/execution/engines/run.engine';
import type { IRunRepository } from '@core/modules/execution/interfaces/i-run.repository';
import type { IExecutor, ExecutorHandle, HandleLogCallback } from '@core/modules/execution/interfaces/i-executor';
import type { Run, ExecutorOutput } from '@core/modules/execution/types/execution.types';
import { CostTracker } from '@core/modules/execution/services/cost-tracker';
import { FileLogService } from '@core/modules/execution/logging/file-log.service';
import { MockEventBus } from '../../helpers/mock-event-bus';
import { MockLogger } from '../../helpers/mock-logger';
import { createRunExecutionParams, TEST_ORG_ID, TEST_ROLE_ID } from '../../helpers/fixtures';
import { ExecutionError } from '@core/foundation/errors/capibara.errors';

function createMockRun(overrides?: Partial<Run>): Run {
  return {
    id: 'run-1',
    orgId: TEST_ORG_ID,
    taskId: 'task-1',
    conversationId: null,
    roleId: TEST_ROLE_ID,
    status: 'running',
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
    status: 'succeeded',
    summary: 'Task completed',
    errorMessage: null,
    sessionId: 'sess-1',
    inputTokens: 1000,
    outputTokens: 500,
    cachedInputTokens: 200,
    ...overrides,
  };
}

interface MockHandle extends ExecutorHandle {
  __logCallbacks: HandleLogCallback[];
}

function createMockHandle(output: Promise<ExecutorOutput>): MockHandle {
  const logCallbacks: HandleLogCallback[] = [];
  return {
    runId: 'run-1',
    complete: () => output,
    cancel: vi.fn(),
    onLog: (cb) => { logCallbacks.push(cb); },
    __logCallbacks: logCallbacks,
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
  let currentHandle: MockHandle;
  let outputPromise: Promise<ExecutorOutput>;
  let resolveOutput: (out: ExecutorOutput) => void;
  let rejectOutput: (err: Error) => void;

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
      markOrphanedAsInterrupted: vi.fn().mockReturnValue(0),
    };

    outputPromise = new Promise<ExecutorOutput>((resolve, reject) => {
      resolveOutput = resolve;
      rejectOutput = reject;
    });
    currentHandle = createMockHandle(outputPromise);
    resolveOutput!(createMockExecutorOutput());

    executor = {
      spawn: vi.fn().mockImplementation(async () => currentHandle),
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

    engine = new RunEngine(
      runRepo, executor, eventBus, eventBus, logger, costTracker, fileLogService,
      taskRepo, taskStateMachine, processEngine,
    );
  });

  function setExecutorOutput(output: Partial<ExecutorOutput>): void {
    const next = new Promise<ExecutorOutput>((resolve) => resolve(createMockExecutorOutput(output)));
    currentHandle = createMockHandle(next);
    (executor.spawn as ReturnType<typeof vi.fn>).mockImplementation(async () => currentHandle);
  }

  function setExecutorError(err: Error): void {
    const next = Promise.reject(err);
    next.catch(() => {});
    currentHandle = createMockHandle(next);
    (executor.spawn as ReturnType<typeof vi.fn>).mockImplementation(async () => currentHandle);
  }

  function setSpawnError(err: Error): void {
    (executor.spawn as ReturnType<typeof vi.fn>).mockRejectedValue(err);
  }

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

    it('emits events in correct order: started → succeeded', async () => {
      await engine.execute(createRunExecutionParams());

      eventBus.assertOrder(['run:started', 'run:succeeded']);
    });

    it('creates run record via repository (after spawn succeeds)', async () => {
      await engine.execute(createRunExecutionParams());

      expect(runRepo.create).toHaveBeenCalledWith(expect.objectContaining({
        orgId: TEST_ORG_ID,
        taskId: 'task-test-1',
        conversationId: null,
        roleId: TEST_ROLE_ID,
        wakeReason: 'task_assigned',
      }));
      expect((runRepo.create as ReturnType<typeof vi.fn>).mock.calls[0][0].id).toEqual(expect.any(String));
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
      setExecutorOutput({ status: 'failed', errorMessage: 'Agent error' });

      const result = await engine.execute(createRunExecutionParams());

      expect(result.status).toBe('failed');
      eventBus.assertEmitted('run:failed');
    });

    it('emits run:failed when executor throws during completion', async () => {
      setExecutorError(new Error('crash'));

      await expect(engine.execute(createRunExecutionParams())).rejects.toThrow('crash');
      eventBus.assertOrder(['run:started', 'run:failed']);
    });

    it('finishes run with failed status on completion error', async () => {
      setExecutorError(new Error('crash'));

      await expect(engine.execute(createRunExecutionParams())).rejects.toThrow();
      expect(runRepo.finish).toHaveBeenCalledWith('run-1', 'failed');
    });

    it('does not create run when spawn fails (zero side effects)', async () => {
      setSpawnError(new Error('ENOENT'));

      await expect(engine.execute(createRunExecutionParams())).rejects.toThrow('ENOENT');

      expect(runRepo.create).not.toHaveBeenCalled();
      expect(fileLogService.writeInput).not.toHaveBeenCalled();
      eventBus.assertNotEmitted('run:started');
      eventBus.assertNotEmitted('run:failed');
    });
  });

  describe('execute — cancelled', () => {
    it('emits run:cancelled when executor returns cancelled status', async () => {
      setExecutorOutput({ status: 'cancelled' });

      const result = await engine.execute(createRunExecutionParams());

      expect(result.status).toBe('cancelled');
      eventBus.assertEmitted('run:cancelled');
    });
  });

  describe('cancelRun', () => {
    it('cancels active handle and finishes run as cancelled', async () => {
      let release: (() => void) | null = null;
      const blocking = new Promise<ExecutorOutput>((resolve) => {
        release = () => resolve(createMockExecutorOutput({ status: 'cancelled' }));
      });
      currentHandle = createMockHandle(blocking);
      (executor.spawn as ReturnType<typeof vi.fn>).mockImplementation(async () => currentHandle);

      const handlePromise = engine.execute(createRunExecutionParams());
      await new Promise((r) => setImmediate(r));
      await new Promise((r) => setImmediate(r));

      await engine.cancelRun('run-1');
      release!();
      await handlePromise.catch(() => {});

      expect(currentHandle.cancel).toHaveBeenCalled();
      expect(runRepo.finish).toHaveBeenCalledWith('run-1', 'cancelled');
      eventBus.assertEmitted('run:cancelled');
    });
  });

  describe('serial execution guard', () => {
    it('throws ExecutionError when org already has an in-flight run', async () => {
      let releaseFirst: (() => void) | null = null;
      const blockingOutput = new Promise<ExecutorOutput>((resolve) => {
        releaseFirst = () => resolve(createMockExecutorOutput());
      });
      const blockingHandle = createMockHandle(blockingOutput);
      (executor.spawn as ReturnType<typeof vi.fn>).mockImplementationOnce(async () => blockingHandle);

      const first = engine.execute(createRunExecutionParams());
      await new Promise((r) => setImmediate(r));

      await expect(engine.execute(createRunExecutionParams()))
        .rejects.toThrow(ExecutionError);

      releaseFirst!();
      await first;
    });
  });

  describe('edge cases', () => {
    it('does not record cost when tokenCount is 0', async () => {
      setExecutorOutput({ inputTokens: 0, outputTokens: 0 });

      await engine.execute(createRunExecutionParams());
      expect(costEntryRepo.create).not.toHaveBeenCalled();
    });

    it('handles null sessionId in executor output', async () => {
      setExecutorOutput({ sessionId: null });

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

      expect(executor.spawn).toHaveBeenCalledWith(
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
    it('invokes registered log callbacks when handle emits log', async () => {
      const logCallback = vi.fn();
      engine.onLog(logCallback);

      await engine.execute(createRunExecutionParams());

      currentHandle.__logCallbacks.forEach((cb) => cb('stdout', 'test chunk'));

      expect(logCallback).toHaveBeenCalledWith('run-1', 'stdout', 'test chunk');
    });

    it('emits run:log event when handle emits log', async () => {
      await engine.execute(createRunExecutionParams());

      currentHandle.__logCallbacks.forEach((cb) => cb('stderr', 'error output'));

      eventBus.assertEmitted('run:log');
      const event = eventBus.getLastEmitted('run:log');
      expect(event?.payload).toEqual(expect.objectContaining({ runId: 'run-1', stream: 'stderr' }));
    });
  });
});
