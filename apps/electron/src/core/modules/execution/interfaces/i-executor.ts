import type { ExecutorInput, ExecutorOutput, ExecutorLogCallback } from '../types/execution.types';

export interface IExecutor {
  execute(input: ExecutorInput): Promise<ExecutorOutput>;
  abort(runId: string): void;
  onLog(callback: ExecutorLogCallback): void;
}
