import type { AdapterCliConfig } from './i-cli-adapter.js';

export interface ExecutorInput {
  runId: string;
  roleId: string;
  orgId: string;
  taskNodeId: string;
  trigger: string;
  prompt: string;
  mcpConfigPath: string;
  projectDir: string;
  executor: string;
  /** CLI adapter config (model, maxTurns, effort, timeout, etc.) */
  cliConfig?: AdapterCliConfig;
  /** Session ID from previous run for resumption */
  sessionId?: string;
}

export interface ExecutorOutput {
  exitCode: number | null;
  status: 'succeeded' | 'failed' | 'cancelled' | 'interrupted';
  summary: string | null;
  errorMessage: string | null;
  model: string | null;
  sessionId: string | null;
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
}

export interface ExecutorLogCallback {
  (runId: string, stream: 'stdout' | 'stderr', chunk: string): void;
}

export interface IExecutor {
  /**
   * Submit a run for execution. Returns a Promise that resolves when the run finishes.
   */
  execute(input: ExecutorInput): Promise<ExecutorOutput>;

  /**
   * Cancel a running or queued run.
   */
  abort(runId: string): void;

  /**
   * Register a callback for streaming log output from runs.
   */
  onLog(callback: ExecutorLogCallback): void;
}
