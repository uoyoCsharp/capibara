import type { AdapterCliConfig, RunStatus } from '../types/execution.types';

export interface RunJob {
  runId: string;
  roleId: string;
  orgId: string;
  taskId: string;
  wakeReason: string;
  prompt: string;
  mcpConfigPath: string;
  projectDir: string;
  executor: string;
  cliConfig?: AdapterCliConfig;
  sessionId?: string;
}

export type ParentMessage =
  | { type: 'enqueue-run'; payload: RunJob }
  | { type: 'cancel-run'; runId: string };

export type ChildMessage =
  | { type: 'run-log'; runId: string; stream: 'stdout' | 'stderr'; chunk: string }
  | { type: 'run-status'; runId: string; status: RunStatus; message: string }
  | {
      type: 'run-finished';
      runId: string;
      status: RunStatus;
      summary: string | null;
      errorMessage: string | null;
      exitCode: number | null;
      signal: string | null;
      model: string | null;
      sessionId: string | null;
      inputTokens: number;
      outputTokens: number;
      cachedInputTokens: number;
    };
