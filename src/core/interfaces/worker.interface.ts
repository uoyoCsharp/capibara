/**
 * Worker Role Interface - Responsible for executing core work of development phases
 * @module core/interfaces/worker
 */

import type { WorkerCommand, WorkerResult } from '../types/worker.types.js';

export interface IWorker {
  /** Execute a phase command (e.g., #analyze, #implement) */
  executeCommand(command: WorkerCommand): Promise<WorkerResult>;

  /** Get currently bound CLI session ID */
  getSessionId(): string | undefined;
}
