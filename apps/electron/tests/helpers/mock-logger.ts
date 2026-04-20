import type { ILogger } from '@core/foundation/interfaces/i-logger';

export class MockLogger implements ILogger {
  readonly logs: Array<{ level: string; msg: string; data?: Record<string, unknown> }> = [];

  info(msg: string, data?: Record<string, unknown>): void {
    this.logs.push({ level: 'info', msg, data });
  }

  warn(msg: string, data?: Record<string, unknown>): void {
    this.logs.push({ level: 'warn', msg, data });
  }

  error(msg: string, data?: Record<string, unknown>): void {
    this.logs.push({ level: 'error', msg, data });
  }

  debug(msg: string, data?: Record<string, unknown>): void {
    this.logs.push({ level: 'debug', msg, data });
  }

  child(_bindings: Record<string, unknown>): ILogger {
    return this;
  }
}
