import { describe, it, expect, beforeEach, vi } from 'vitest';
import { AcpSessionSweeper } from '@core/infrastructure/acp-protocol/acp-session.sweeper';
import type { IAcpSessionManager } from '@core/modules/acp/interfaces/i-acp-session.manager';
import { MockLogger } from '../../helpers/mock-logger';

function createMockManager(): IAcpSessionManager {
  return {
    sweepIdle: vi.fn().mockResolvedValue(undefined),
  } as unknown as IAcpSessionManager;
}

describe('AcpSessionSweeper', () => {
  let manager: IAcpSessionManager;
  let logger: MockLogger;
  let sweeper: AcpSessionSweeper;

  beforeEach(() => {
    manager = createMockManager();
    logger = new MockLogger();
    sweeper = new AcpSessionSweeper(manager, logger, 1000);
  });

  it('runs a single sweep with the current time', async () => {
    await sweeper.runOnce();
    expect(manager.sweepIdle).toHaveBeenCalledTimes(1);
    const arg = (manager.sweepIdle as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(typeof arg).toBe('string');
    expect(() => new Date(arg).toISOString()).not.toThrow();
  });

  it('swallows and logs sweep errors so the timer survives', async () => {
    (manager.sweepIdle as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('db down'));
    await expect(sweeper.runOnce()).resolves.toBeUndefined();
    expect(logger.logs.some(l => l.level === 'error' && /sweep failed/i.test(l.msg))).toBe(true);
  });

  it('drives periodic sweeps on the configured interval and stops cleanly', async () => {
    vi.useFakeTimers();
    try {
      sweeper.start();
      await vi.advanceTimersByTimeAsync(3000);
      expect((manager.sweepIdle as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThanOrEqual(3);

      sweeper.stop();
      const countAfterStop = (manager.sweepIdle as ReturnType<typeof vi.fn>).mock.calls.length;
      await vi.advanceTimersByTimeAsync(3000);
      expect((manager.sweepIdle as ReturnType<typeof vi.fn>).mock.calls.length).toBe(countAfterStop);
    } finally {
      vi.useRealTimers();
    }
  });

  it('start() is idempotent (no duplicate timers)', async () => {
    vi.useFakeTimers();
    try {
      sweeper.start();
      sweeper.start();
      await vi.advanceTimersByTimeAsync(1000);
      // One interval elapsed → exactly one sweep, not two.
      expect((manager.sweepIdle as ReturnType<typeof vi.fn>).mock.calls.length).toBe(1);
      sweeper.stop();
    } finally {
      vi.useRealTimers();
    }
  });
});
