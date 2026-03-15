/**
 * Worker role command and execution result types
 * @module core/types/worker
 */

export interface WorkerCommand {
  /** Framework command, e.g., "#analyze" */
  command: string;
  /** User prompt content */
  input: string;
  /** Merged system prompt (role + rules + command + knowledge base) */
  systemPrompt: string;
  /** CLI session ID (for Worker's persistent session) */
  sessionId?: string;
  /** Whether to resume existing session */
  resume?: boolean;
  /** Maximum agentic turns */
  maxTurns?: number;
  /** Allowed tools list */
  allowedTools?: string[];
  /** Disallowed tools list */
  disallowedTools?: string[];
  /** Working directory */
  cwd?: string;
  /** Timeout (milliseconds) */
  timeout?: number;
}

export interface WorkerResult {
  success: boolean;
  output: string;
  artifact: string;
  sessionId: string;
  tokensUsed: number;
  costUsd: number;
  duration: number;
}
