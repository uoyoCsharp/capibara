import type { AdapterCliConfig } from '@core/modules/execution/types/execution.types';

export interface CliAdapterContext {
  runId: string;
  roleId: string;
  orgId: string;
  taskId: string;
  prompt: string;
  mcpConfigPath: string;
  projectDir: string;
  cliConfig?: AdapterCliConfig;
  sessionId?: string;
  onLog: (stream: 'stdout' | 'stderr', chunk: string) => void;
}

export interface CliAdapterResult {
  exitCode: number | null;
  signal: string | null;
  status: 'succeeded' | 'failed' | 'cancelled';
  timedOut: boolean;
  summary: string | null;
  errorMessage: string | null;
  model: string | null;
  sessionId: string | null;
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
  clearSession: boolean;
}

export interface ICliAdapter {
  readonly name: string;
  execute(ctx: CliAdapterContext): Promise<CliAdapterResult>;
  abort(runId: string): void;
}
