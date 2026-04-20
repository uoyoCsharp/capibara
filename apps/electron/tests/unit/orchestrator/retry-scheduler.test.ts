import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { RetryScheduler } from '@core/modules/orchestrator/retry.scheduler';
import { MockLogger } from '../../helpers/mock-logger';
import { createTestConfig, TEST_ORG_ID, TEST_ROLE_ID, TEST_TASK_ID } from '../../helpers/fixtures';
import type { IRunRepository } from '@core/modules/execution/interfaces/i-run.repository';
import type { IPendingWakeRepository } from '@core/modules/orchestrator/interfaces/i-pending-wake.repository';
import type { Run } from '@core/modules/execution/types/execution.types';

function createRun(overrides?: Partial<Run>): Run {
  return {
    id: 'run-1',
    orgId: TEST_ORG_ID,
    taskId: TEST_TASK_ID,
    conversationId: null,
    roleId: TEST_ROLE_ID,
    status: 'failed',
    wakeReason: 'task_assigned',
    startedAt: '2026-01-01T00:00:00.000Z',
    finishedAt: '2026-01-01T00:01:00.000Z',
    costUsd: 0,
    tokenCount: 0,
    summary: null,
    errorMessage: 'something broke',
    createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('RetryScheduler', () => {
  let scheduler: RetryScheduler;
  let runRepo: IRunRepository;
  let pendingWakeRepo: IPendingWakeRepository;
  let config: ReturnType<typeof createTestConfig>;
  let logger: MockLogger;

  beforeEach(() => {
    vi.useFakeTimers();
    runRepo = {
      findById: vi.fn().mockReturnValue(createRun()),
      findByOrgId: vi.fn(),
      findActiveByOrgId: vi.fn(),
      create: vi.fn(),
      updateStatus: vi.fn(),
      finish: vi.fn(),
    } as unknown as IRunRepository;
    pendingWakeRepo = {
      findById: vi.fn(),
      findByOrgId: vi.fn(),
      findByRoleId: vi.fn(),
      findNext: vi.fn(),
      create: vi.fn(),
      delete: vi.fn(),
      deleteByRoleId: vi.fn(),
    };
    config = createTestConfig();
    logger = new MockLogger();

    scheduler = new RetryScheduler(runRepo, pendingWakeRepo, config, logger);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns false when run not found', () => {
    vi.mocked(runRepo.findById).mockReturnValue(null);
    expect(scheduler.scheduleRetry('nonexistent')).toBe(false);
  });

  it('schedules retry with exponential backoff', () => {
    const result = scheduler.scheduleRetry('run-1');
    expect(result).toBe(true);

    vi.advanceTimersByTime(config.execution.retryBackoffMs);
    expect(pendingWakeRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        roleId: TEST_ROLE_ID,
        orgId: TEST_ORG_ID,
        reason: 'retry_failed',
        taskId: TEST_TASK_ID,
        priority: -1,
      }),
    );
  });

  it('doubles backoff on each retry', () => {
    scheduler.scheduleRetry('run-1');
    vi.advanceTimersByTime(config.execution.retryBackoffMs);

    scheduler.scheduleRetry('run-1');
    vi.advanceTimersByTime(config.execution.retryBackoffMs);
    expect(pendingWakeRepo.create).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(config.execution.retryBackoffMs);
    expect(pendingWakeRepo.create).toHaveBeenCalledTimes(2);
  });

  it('stops retrying after max retries reached', () => {
    config.execution.maxRetryOnFailure = 2;
    scheduler = new RetryScheduler(runRepo, pendingWakeRepo, config, logger);

    expect(scheduler.scheduleRetry('run-1')).toBe(true);
    expect(scheduler.scheduleRetry('run-1')).toBe(true);
    expect(scheduler.scheduleRetry('run-1')).toBe(false);
  });

  it('uses conversationId as key when taskId is null', () => {
    vi.mocked(runRepo.findById).mockReturnValue(createRun({ taskId: null, conversationId: 'conv-1' }));
    scheduler.scheduleRetry('run-1');
    vi.advanceTimersByTime(config.execution.retryBackoffMs);

    expect(pendingWakeRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({ taskId: null }),
    );
  });

  it('uses runId as key when both taskId and conversationId are null', () => {
    vi.mocked(runRepo.findById).mockReturnValue(createRun({ taskId: null, conversationId: null }));
    config.execution.maxRetryOnFailure = 1;
    scheduler = new RetryScheduler(runRepo, pendingWakeRepo, config, logger);

    expect(scheduler.scheduleRetry('run-1')).toBe(true);
    expect(scheduler.scheduleRetry('run-1')).toBe(false);
  });

  it('clearRetries resets count for key', () => {
    config.execution.maxRetryOnFailure = 2;
    scheduler = new RetryScheduler(runRepo, pendingWakeRepo, config, logger);

    scheduler.scheduleRetry('run-1');
    scheduler.scheduleRetry('run-1');
    scheduler.clearRetries(TEST_TASK_ID);
    expect(scheduler.scheduleRetry('run-1')).toBe(true);
  });
});
