import pino from 'pino';
import { injectable } from 'tsyringe';
import type { ILogger } from '@core/foundation/interfaces/i-logger';

@injectable()
export class PinoLogger implements ILogger {
  private readonly logger: pino.Logger;

  constructor(level: string = 'info', parentLogger?: pino.Logger) {
    const isDev = process.env.NODE_ENV !== 'production';
    const effectiveLevel = isDev && level === 'info' ? 'debug' : level;
    this.logger = parentLogger ?? pino({
      level: effectiveLevel,
      transport: isDev
        ? { target: 'pino/file', options: { destination: 1 } }
        : undefined,
    });
  }

  info(msg: string, data?: Record<string, unknown>): void {
    this.safeLog(() => this.logger.info(data ?? {}, msg));
  }

  warn(msg: string, data?: Record<string, unknown>): void {
    this.safeLog(() => this.logger.warn(data ?? {}, msg));
  }

  error(msg: string, data?: Record<string, unknown>): void {
    this.safeLog(() => this.logger.error(data ?? {}, msg));
  }

  debug(msg: string, data?: Record<string, unknown>): void {
    this.safeLog(() => this.logger.debug(data ?? {}, msg));
  }

  child(bindings: Record<string, unknown>): PinoLogger {
    return new PinoLogger(this.logger.level, this.logger.child(bindings));
  }

  private safeLog(fn: () => void): void {
    try {
      fn();
    } catch (error) {
      // During Electron shutdown, pino's transport worker can already be
      // tearing down. Avoid crashing the main process on late log writes.
      const message = error instanceof Error ? error.message : String(error);
      if (message.toLowerCase().includes('worker is ending')) {
        return;
      }
      throw error;
    }
  }
}
