/**
 * Claude CLI related errors
 * @module core/errors/cli
 */

import { AppError } from './base.error.js';

/** CLI process execution failed (spawn error, non-zero exit code, etc.) */
export class CliExecutionError extends AppError {
  constructor(detail: string) {
    super(`CLI execution failed: ${detail}`, 'CLI_EXEC_ERROR', true);
  }
}

/** CLI execution timeout */
export class CliTimeoutError extends AppError {
  constructor(timeout: number) {
    super(`CLI timed out after ${timeout}ms`, 'CLI_TIMEOUT', true);
  }
}

/** CLI output parsing failed */
export class CliParseError extends AppError {
  constructor(detail: string) {
    super(`CLI output parse failed: ${detail}`, 'CLI_PARSE_ERROR', true);
  }
}
