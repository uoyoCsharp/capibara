import type { ILogger } from '@core/foundation/interfaces/i-logger';
import type { IAcpSessionManager } from '@core/modules/acp/interfaces/i-acp-session.manager';

/** Default interval between idle-TTL sweeps when not otherwise configured. */
const DEFAULT_SWEEP_INTERVAL_MS = 5 * 60 * 1000;

/**
 * Periodic driver for the session manager's idle-TTL sweep (ADR-7). Owns only the timer; the
 * reclamation policy (which sessions expire, idle vs collaboration cap) lives in
 * {@link IAcpSessionManager.sweepIdle}. Kept separate so the manager stays free of wall-clock
 * scheduling and remains unit-testable with an injected `nowIso`.
 */
export class AcpSessionSweeper {
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly sessionManager: IAcpSessionManager,
    private readonly logger: ILogger,
    private readonly intervalMs: number = DEFAULT_SWEEP_INTERVAL_MS,
  ) {}

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      void this.runOnce();
    }, this.intervalMs);
    // Do not keep the event loop alive solely for the sweeper.
    this.timer.unref?.();
  }

  stop(): void {
    if (!this.timer) return;
    clearInterval(this.timer);
    this.timer = null;
  }

  /** Run a single sweep. Errors are logged and swallowed so the periodic timer keeps running. */
  async runOnce(): Promise<void> {
    try {
      await this.sessionManager.sweepIdle(new Date().toISOString());
    } catch (err) {
      this.logger.error('ACP session sweep failed', { error: String(err) });
    }
  }
}
