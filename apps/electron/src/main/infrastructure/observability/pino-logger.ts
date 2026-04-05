import pino from 'pino';
import { injectable } from 'tsyringe';
import type { ILogger } from '@main/core/interfaces/i-logger.js';

@injectable()
export class PinoLogger implements ILogger {
  private readonly logger: pino.Logger;

  constructor(level: string = 'info', parentLogger?: pino.Logger) {
    this.logger = parentLogger ?? pino({
      level,
      transport:
        process.env.NODE_ENV !== 'production'
          ? { target: 'pino/file', options: { destination: 1 } }
          : undefined,
    });
  }

  info(msg: string, data?: Record<string, unknown>): void {
    this.logger.info(data ?? {}, msg);
  }

  warn(msg: string, data?: Record<string, unknown>): void {
    this.logger.warn(data ?? {}, msg);
  }

  error(msg: string, data?: Record<string, unknown>): void {
    this.logger.error(data ?? {}, msg);
  }

  debug(msg: string, data?: Record<string, unknown>): void {
    this.logger.debug(data ?? {}, msg);
  }

  child(bindings: Record<string, unknown>): PinoLogger {
    return new PinoLogger('info', this.logger.child(bindings));
  }
}
