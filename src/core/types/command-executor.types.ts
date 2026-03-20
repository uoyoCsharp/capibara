/**
 * Command executor request/response types
 * @module core/types/command-executor
 */

/**
 * Universal command request
 *
 * Design principles:
 * - Common fields defined directly (input, timeout, cwd)
 * - LLM-related fields as optional (systemPrompt, systemPromptFile)
 * - Executor-specific parameters in options
 */
export interface CommandRequest {
  /** Input content (user prompt / command args / stdin input) */
  input: string;

  /** System-level prompt (used by LLM executors) */
  systemPrompt?: string;

  /**
   * System prompt file path (used by LLM executors)
   * When systemPrompt is too long, executor should prefer file-based delivery
   * to avoid command-line length limits (Windows ~8K, Linux ~2M).
   *
   * Priority:
   * 1. If systemPromptFile is provided -> use file path directly
   * 2. If only systemPrompt and length > threshold -> executor writes to temp file
   * 3. If only systemPrompt and short -> can pass as parameter
   */
  systemPromptFile?: string;

  /** Working directory */
  cwd?: string;

  /** Timeout in milliseconds */
  timeout?: number;

  /**
   * Executor-specific parameters
   *
   * ClaudeCliExecutor: { sessionId, resume, maxTurns, allowedTools, disallowedTools, outputFormat }
   * ShellExecutor: { command, env, shell }
   * Future HttpApiExecutor: { url, method, headers, body }
   */
  options: Record<string, unknown>;
}

/** Universal command response */
export interface CommandResponse {
  /** Whether execution succeeded */
  success: boolean;

  /** Raw output content (Messenger handles format normalization) */
  output: string;

  /** Execution duration in milliseconds */
  duration: number;

  /**
   * Executor-specific result metadata
   *
   * ClaudeCliExecutor: { sessionId, exitCode, costUsd, tokensUsed, numTurns }
   * ShellExecutor: { exitCode, stderr }
   */
  metadata: Record<string, unknown>;
}

/** Executor configuration (deserialized from YAML/JSON) */
export interface CommandExecutorConfig {
  /** Executor type */
  type: string;
  /** Executor-specific config */
  options: Record<string, unknown>;
}
