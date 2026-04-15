import type { Run } from '../types/domain.types.js';

// ─── Execution Context ─────────────────────────────────────────────
export type McpExecutionContext = 'session:planning' | 'session:adhoc' | 'task:execution';

// ─── Run Execution Input ───────────────────────────────────────────
export interface RunExecutionParams {
  roleId: string;
  orgId: string;
  prompt: string;
  /** Used for log file path: sessionId or taskNodeId */
  contextId: string;
  /** Used for log file path: org name */
  contextLabel: string;
  /** Task node ID — null for session-based runs */
  taskNodeId?: string;
  /** claude-cli --resume session ID */
  sessionId?: string;
  /** Determines which MCP tools are available */
  mcpContext?: McpExecutionContext;
  /** Wake trigger — only for task-based runs */
  trigger?: string;
  /** User message for resumed sessions. When set with sessionId, this is sent as stdin instead of prompt. */
  userMessage?: string;
}

// ─── Run Execution Result ──────────────────────────────────────────
export interface RunResult {
  runId: string;
  status: 'succeeded' | 'failed' | 'cancelled' | 'interrupted';
  /** claude-cli session ID from output */
  sessionId: string | null;
  summary: string | null;
  inputTokens: number;
  outputTokens: number;
  model: string | null;
  exitCode: number | null;
  errorMessage: string | null;
}

// ─── Run Engine Interface ──────────────────────────────────────────
export interface IRunEngine {
  /**
   * Execute an AI run. Pure execution — no task lifecycle, no orchestration.
   * Returns a RunResult; caller handles post-processing.
   */
  execute(params: RunExecutionParams): Promise<RunResult>;

  /** Cancel an in-flight run. */
  cancelRun(runId: string): Promise<void>;

  /** Returns the sessionId for an in-flight run (before DB persistence). */
  getRunSessionId(runId: string): string | null;

  /** Register callback for log streaming. */
  onLog(callback: (runId: string, stream: 'stdout' | 'stderr', chunk: string) => void): void;

  /** Register callback for parsed assistant text. */
  onAssistantText(callback: (runId: string, text: string) => void): void;
}
