import type { RunExecutionParams, RunResult } from '../types/execution.types';

export interface IRunEngine {
  execute(params: RunExecutionParams): Promise<RunResult>;
  cancelRun(runId: string): Promise<void>;
  onLog(callback: (runId: string, stream: 'stdout' | 'stderr', chunk: string) => void): void;
  onAssistantText(callback: (runId: string, text: string) => void): void;
}
