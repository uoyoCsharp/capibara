/**
 * Pino Logger Factory - Creates structured logger instance
 * @module infrastructure/observability/pino-logger
 */

import pino from 'pino';
import type { AutomationConfig } from '../../core/types/config.types.js';

/**
 * Create pino Logger instance based on config
 * Development environment uses pino-pretty for formatted output
 */
export function createLogger(config: AutomationConfig): pino.Logger {
  return pino({
    level: process.env.LOG_LEVEL ?? 'info',
    transport:
      process.env.NODE_ENV !== 'production'
        ? { target: 'pino-pretty', options: { colorize: true } }
        : undefined,
  });
}
