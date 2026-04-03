/**
 * Typed message protocol between Main process and UtilityProcess worker.
 *
 * Main → Worker: ParentMessage
 * Worker → Main: ChildMessage
 *
 * Reference: AgentCompany worker-service.ts + orchestrator/worker.ts
 */

import type { RunStatus, WakeTrigger } from '@main/core/types/domain.types.js';
import type { AdapterCliConfig } from '@main/core/interfaces/i-cli-adapter.js';

// ─── Main → Worker ──────────────────────────────────────────────────

export interface RunJob {
  runId: string;
  roleId: string;
  orgId: string;
  taskNodeId: string;
  trigger: WakeTrigger;
  /** The full system prompt to send to Claude CLI via stdin */
  prompt: string;
  /** Path to the MCP config JSON file for this run */
  mcpConfigPath: string;
  /** Working directory for CLI execution */
  projectDir: string;
  /** Executor/adapter name (e.g., 'claude-cli', 'codex') */
  executor: string;
  /** CLI adapter config (model, maxTurns, effort, timeout, etc.) */
  cliConfig: AdapterCliConfig;
  /** Session ID from previous run for resumption */
  sessionId?: string;
}

export type ParentMessage =
  | { type: 'enqueue-run'; payload: RunJob }
  | { type: 'cancel-run'; runId: string };

// ─── Worker → Main ──────────────────────────────────────────────────

export interface RunLogMessage {
  type: 'run-log';
  runId: string;
  stream: 'stdout' | 'stderr';
  chunk: string;
}

export interface RunStatusMessage {
  type: 'run-status';
  runId: string;
  status: RunStatus;
  message: string;
}

export interface RunFinishedMessage {
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
}

export type ChildMessage = RunLogMessage | RunStatusMessage | RunFinishedMessage;
