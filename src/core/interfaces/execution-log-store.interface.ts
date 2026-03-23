/**
 * Execution Log Store Interface - Persists execution logs for progress feedback
 * @module core/interfaces/execution-log-store
 */

import type {
  ExecutionLogEntry,
  ExecutionLogQuery,
} from '../types/execution-log.types.js';

export const EXECUTION_LOG_STORE_TOKEN = Symbol.for('IExecutionLogStore');

export interface IExecutionLogStore {
  /** Append log entry */
  append(entry: ExecutionLogEntry): Promise<void>;

  /** Query logs with filters */
  query(query: ExecutionLogQuery): Promise<ExecutionLogEntry[]>;

  /** Get logs for specific pipeline */
  getLogsByPipeline(pipelineId: string, limit?: number): Promise<ExecutionLogEntry[]>;

  /** Delete logs older than specified days */
  purge(olderThanDays: number): Promise<number>;

  /** Get log count for pipeline */
  count(pipelineId: string): Promise<number>;
}
