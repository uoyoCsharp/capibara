import type { ExecutorInput, ExecutorOutput } from '../types/execution.types';

export type HandleLogCallback = (stream: 'stdout' | 'stderr', chunk: string) => void;

export interface ExecutorHandle {
  runId: string;
  pid: number;
  complete(): Promise<ExecutorOutput>;
  cancel(): void;
  onLog(callback: HandleLogCallback): void;
}

export interface IExecutor {
  spawn(input: ExecutorInput): Promise<ExecutorHandle>;
}
