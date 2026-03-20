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
  /** System prompt file path (takes precedence over systemPrompt when provided) */
  systemPromptFile?: string;
  /** Command executor type (defaults to 'claude-cli') */
  executorType?: string;
  /** Executor-specific parameters */
  executorOptions?: Record<string, unknown>;
  /** Working directory */
  cwd?: string;
  /** Timeout (milliseconds) */
  timeout?: number;
}

export interface WorkerResult {
  success: boolean;
  output: string;
  artifact: string;
  duration: number;
  /** Executor-specific result metadata */
  metadata: Record<string, unknown>;
}
