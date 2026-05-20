import { describe, it, expect, beforeEach, vi } from 'vitest';
import { RunEngine } from '@core/modules/execution/engines/run.engine';
import type { IRunRepository } from '@core/modules/execution/interfaces/i-run.repository';
import type { IExecutor } from '@core/modules/execution/interfaces/i-executor';
import type { Run, ExecutorOutput } from '@core/modules/execution/types/execution.types';
import type { ITaskRepository } from '@core/modules/workflow/interfaces/i-task.repository';
import type { TaskStateMachine } from '@core/modules/workflow/engines/task.state-machine';
import type { ProcessEngine } from '@core/modules/workflow/engines/process.engine';
import type { Task } from '@core/modules/workflow/types/workflow.types';
import { CostTracker } from '@core/modules/execution/services/cost-tracker';
import { FileLogService } from '@core/modules/execution/logging/file-log.service';
import { MockEventBus } from '../../helpers/mock-event-bus';
import { MockLogger } from '../../helpers/mock-logger';
import { createTestConfig, createRunExecutionParams, TEST_ORG_ID, TEST_ROLE_ID, TEST_TASK_ID } from '../../helpers/fixtures';

function createMockRun(overrides?: Partial<Run>): Run {
  return {
    id: 'run-1',
    orgId: TEST_ORG_ID,
    taskId: TEST_TASK_ID,
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

function createMockTask(overrides?: Partial<Task>): Task {
  return {
    id: TEST_TASK_ID,
    orgId: TEST_ORG_ID,
    parentId: null,
    type: 'task',
    title: 'Test',
    description: '',
    status: 'pending',
    assigneeRoleId: TEST_ROLE_ID,
    depth: 0,
    artifactPaths: null,
    pausedReason: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function createMockOutput(overrides?: Partial<ExecutorOutput>): ExecutorOutput {
  return {
    exitCode: 0,
    status: 'succeeded',
    summary: 'Done',
    errorMessage: null,
    model: 'claude-sonnet-4-6-20250514',
    sessionId: 'sess-1',
    inputTokens: 100,
    outputTokens: 50,
    cachedInputTokens: 0,
    ...overrides,
  };
}

describe('RunEngine — task lifecycle (R2/R3)', () => {
  let engine: RunEngine;
  let runRepo: IRunRepository;
  let executor: IExecutor;
  let eventBus: MockEventBus;
  let taskRepo: ITaskRepository;
  let taskStateMachine: TaskStateMachine;
  let processEngine: ProcessEngine;

  beforeEach(() => {
    eventBus = new MockEventBus();
    const logger = new MockLogger();

    runRepo = {
      findById: vi.fn().mockReturnValue(createMockRun()),
      findByOrgId: vi.fn().mockReturnValue([]),
      findByTaskId: vi.fn().mockReturnValue([]),
      findActiveByRoleId: vi.fn().mockReturnValue(null),
      findActiveByOrgId: vi.fn().mockReturnValue(null),
      create: vi.fn().mockReturnValue(createMockRun()),
      updateStatus: vi.fn(),
      finish: vi.fn(),
    };

    executor = {
      execute: vi.fn().mockResolvedValue(createMockOutput()),
      abort: vi.fn(),
      onLog: vi.fn(),
    };

    taskRepo = {
      findById: vi.fn().mockReturnValue(createMockTask()),
      findByOrgId: vi.fn().mockReturnValue([]),
      findChildren: vi.fn().mockReturnValue([]),
      hasChildren: vi.fn().mockReturnValue(false),
      findByAssigneeRoleId: vi.fn().mockReturnValue([]),
      create: vi.fn(),
      updateStatus: vi.fn(),
      updatePausedReason: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    } as unknown as ITaskRepository;

    taskStateMachine = {
      transition: vi.fn(),
      confirmApproval: vi.fn(),
      rejectApproval: vi.fn(),
      setBehaviorEngine: vi.fn(),
    } as unknown as TaskStateMachine;

    processEngine = {
      getStatusCategory: vi.fn().mockReturnValue('initial'),
      getInitialStatus: vi.fn().mockReturnValue({ name: 'pending', label: 'Pending', category: 'initial' }),
      getAvailableTransitions: vi.fn().mockReturnValue([
        { from: 'pending', to: 'in_progress' },
      ]),
    } as unknown as ProcessEngine;

    const costEntryRepo = {
      create: vi.fn().mockReturnValue({ id: 'c', runId: 'run-1', roleId: TEST_ROLE_ID, orgId: TEST_ORG_ID, tokenCount: 0, costUsd: 0, createdAt: '' }),
      getTotalTokensByOrgId: vi.fn().mockReturnValue(0),
      getTotalCostByOrgId: vi.fn().mockReturnValue(0),
      findByRunId: vi.fn().mockReturnValue([]),
      findByOrgId: vi.fn().mockReturnValue([]),
    };
    const costTracker = new CostTracker(costEntryRepo);

    const fileLogService = {
      writeInput: vi.fn(),
      append: vi.fn(),
      flush: vi.fn().mockResolvedValue(undefined),
    } as unknown as FileLogService;

    const config = createTestConfig();
    engine = new RunEngine(
      runRepo, executor, eventBus, eventBus, logger, config, costTracker, fileLogService,
      taskRepo, taskStateMachine, processEngine,
    );
  });

  // ─── R2: advanceTaskToActive ─────────────────────────────────

  describe('R2 — advance task to active on run start', () => {
    it('transitions task from initial to first active status', async () => {
      vi.mocked(processEngine.getStatusCategory).mockImplementation((_org, status) => {
        if (status === 'pending') return 'initial';
        if (status === 'in_progress') return 'active';
        return null;
      });

      await engine.execute(createRunExecutionParams());

      expect(taskStateMachine.transition).toHaveBeenCalledWith(
        TEST_TASK_ID, 'in_progress', { triggeredBy: 'system' },
      );
    });

    it('is idempotent — does not re-transition already-active task to active', async () => {
      vi.mocked(taskRepo.findById).mockReturnValue(createMockTask({ status: 'in_progress' }));
      vi.mocked(processEngine.getStatusCategory).mockReturnValue('active');
      vi.mocked(processEngine.getInitialStatus).mockReturnValue({ name: 'pending', label: 'Pending', category: 'initial' });

      await engine.execute(createRunExecutionParams());

      const calls = vi.mocked(taskStateMachine.transition).mock.calls;
      const advanceCalls = calls.filter((c) => c[1] === 'in_progress');
      expect(advanceCalls).toHaveLength(0);
    });

    it('no-op when run has no taskId (conversation-only)', async () => {
      const params = createRunExecutionParams({ taskId: undefined, conversationId: 'conv-1' });

      await engine.execute(params);

      expect(processEngine.getStatusCategory).not.toHaveBeenCalled();
    });

    it('no-op when task is not found in repo', async () => {
      vi.mocked(taskRepo.findById).mockReturnValue(null);

      await engine.execute(createRunExecutionParams());

      expect(taskStateMachine.transition).not.toHaveBeenCalled();
    });

    it('does not override approval/terminal status', async () => {
      vi.mocked(taskRepo.findById).mockReturnValue(createMockTask({ status: 'awaiting_review' }));
      vi.mocked(processEngine.getStatusCategory).mockReturnValue('approval');

      await engine.execute(createRunExecutionParams());

      expect(taskStateMachine.transition).not.toHaveBeenCalled();
    });

    it('logs warning when schema has no initial→active transition', async () => {
      vi.mocked(processEngine.getAvailableTransitions).mockReturnValue([]);

      await engine.execute(createRunExecutionParams());

      expect(taskStateMachine.transition).not.toHaveBeenCalled();
    });

    it('swallows transition error and continues run execution', async () => {
      vi.mocked(taskStateMachine.transition).mockImplementation(() => { throw new Error('state machine boom'); });
      vi.mocked(processEngine.getStatusCategory).mockImplementation((_org, status) => {
        if (status === 'pending') return 'initial';
        return 'active';
      });

      const result = await engine.execute(createRunExecutionParams());

      expect(result.status).toBe('succeeded');
    });
  });

  // ─── R3: rollbackTaskIfActive ────────────────────────────────

  describe('R3 — rollback task on run termination', () => {
    beforeEach(() => {
      vi.mocked(processEngine.getStatusCategory).mockImplementation((_org, status) => {
        if (status === 'pending') return 'initial';
        if (status === 'in_progress') return 'active';
        if (status === 'done' || status === 'cancelled') return 'terminal';
        return null;
      });
    });

    it('rolls back active task to initial on run:succeeded', async () => {
      vi.mocked(taskRepo.findById)
        .mockReturnValueOnce(createMockTask({ status: 'pending' }))   // advanceTask lookup
        .mockReturnValueOnce(createMockTask({ status: 'in_progress' })); // rollback lookup

      await engine.execute(createRunExecutionParams());

      const calls = vi.mocked(taskStateMachine.transition).mock.calls;
      const rollbackCall = calls.find(
        (c) => c[1] === 'pending' && c[2]?.triggeredBy === 'system',
      );
      expect(rollbackCall).toBeDefined();
    });

    it('rolls back active task to initial on run:failed', async () => {
      vi.mocked(executor.execute).mockResolvedValue(createMockOutput({ status: 'failed' }));
      vi.mocked(taskRepo.findById)
        .mockReturnValueOnce(createMockTask({ status: 'pending' }))
        .mockReturnValueOnce(createMockTask({ status: 'in_progress' }));

      await engine.execute(createRunExecutionParams());

      const calls = vi.mocked(taskStateMachine.transition).mock.calls;
      const rollbackCall = calls.find(
        (c) => c[1] === 'pending' && c[2]?.triggeredBy === 'system',
      );
      expect(rollbackCall).toBeDefined();
    });

    it('rolls back active task on executor throw', async () => {
      vi.mocked(executor.execute).mockRejectedValue(new Error('crash'));
      vi.mocked(taskRepo.findById)
        .mockReturnValueOnce(createMockTask({ status: 'pending' }))
        .mockReturnValueOnce(createMockTask({ status: 'in_progress' }));

      await expect(engine.execute(createRunExecutionParams())).rejects.toThrow();

      const calls = vi.mocked(taskStateMachine.transition).mock.calls;
      const rollbackCall = calls.find(
        (c) => c[1] === 'pending' && c[2]?.triggeredBy === 'system',
      );
      expect(rollbackCall).toBeDefined();
    });

    it('rolls back active task on cancelRun', async () => {
      vi.mocked(runRepo.findById).mockReturnValue(createMockRun({ taskId: TEST_TASK_ID }));
      vi.mocked(taskRepo.findById).mockReturnValue(createMockTask({ status: 'in_progress' }));

      await engine.cancelRun('run-1');

      expect(taskStateMachine.transition).toHaveBeenCalledWith(
        TEST_TASK_ID, 'pending', { triggeredBy: 'system' },
      );
    });

    it('R5 — does not rollback if agent already moved task to terminal', async () => {
      vi.mocked(taskRepo.findById)
        .mockReturnValueOnce(createMockTask({ status: 'pending' }))   // advance
        .mockReturnValueOnce(createMockTask({ status: 'done' }));      // rollback check

      await engine.execute(createRunExecutionParams());

      const calls = vi.mocked(taskStateMachine.transition).mock.calls;
      const rollbackCall = calls.find((c) => c[1] === 'pending' && c[0] === TEST_TASK_ID && calls.indexOf(c) > 0);
      expect(rollbackCall).toBeUndefined();
    });

    it('no-op when run has no taskId', async () => {
      const params = createRunExecutionParams({ taskId: undefined, conversationId: 'conv-1' });
      vi.mocked(runRepo.create).mockReturnValue(createMockRun({ taskId: null }));

      await engine.execute(params);

      const calls = vi.mocked(taskStateMachine.transition).mock.calls;
      expect(calls.length).toBe(0);
    });

    it('swallows rollback transition error (run still completes)', async () => {
      vi.mocked(taskRepo.findById)
        .mockReturnValueOnce(createMockTask({ status: 'pending' }))
        .mockReturnValueOnce(createMockTask({ status: 'in_progress' }));
      vi.mocked(taskStateMachine.transition).mockImplementation((_id, to) => {
        if (to === 'pending') throw new Error('rollback failed');
        return createMockTask({ status: to });
      });

      const result = await engine.execute(createRunExecutionParams());

      expect(result.status).toBe('succeeded');
      eventBus.assertEmitted('run:succeeded');
    });
  });
});
