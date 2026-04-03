/**
 * Pluggable CLI adapter interface for AI provider abstraction.
 *
 * Each adapter encapsulates the full lifecycle of invoking an AI CLI tool
 * (Claude, Codex, etc.) — argument building, process spawning, output parsing,
 * and session management.
 *
 * Reference: AgentCompany ServerAdapterModule pattern.
 */

export interface AdapterExecutionContext {
  runId: string;
  roleId: string;
  orgId: string;
  taskNodeId: string;
  prompt: string;
  mcpConfigPath: string;
  projectDir: string;

  /** CLI-specific config from CapibaraConfig.cli */
  cliConfig: AdapterCliConfig;

  /** Session ID from a previous run for resumption (if supported) */
  sessionId?: string;

  /** Callback for streaming log output */
  onLog: (stream: 'stdout' | 'stderr', chunk: string) => void;
}

export interface AdapterCliConfig {
  model?: string;
  maxTurnsPerRun?: number;
  effort?: 'low' | 'medium' | 'high';
  timeoutMs?: number;
  /** Additional CLI args passed through verbatim */
  extraArgs?: string[];
}

export interface AdapterExecutionResult {
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
  /** Whether to clear session for next run (e.g., on unknown session error) */
  clearSession: boolean;
  /** Whether login/auth is required */
  requiresLogin: boolean;
  loginUrl: string | null;
}

export interface ICliAdapter {
  /** Unique adapter identifier (e.g., 'claude-cli', 'codex') */
  readonly name: string;

  /** Execute a run using this CLI provider */
  execute(ctx: AdapterExecutionContext): Promise<AdapterExecutionResult>;

  /** Abort a running execution by runId */
  abort(runId: string): void;
}
