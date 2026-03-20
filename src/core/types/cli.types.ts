/**
 * Type definitions for Claude CLI process interaction
 * @module core/types/cli
 */

export interface ClaudeCliOptions {
  prompt: string;
  systemPrompt?: string;
  appendSystemPrompt?: string;
  /**
   * Path to a file whose contents will be used as the system prompt
   * via `--system-prompt-file`. When provided this takes precedence
   * over `systemPrompt` (the two are mutually exclusive at the CLI level).
   * Reserved for future user-configurable system prompt files.
   */
  systemPromptFile?: string;
  sessionId?: string;
  resume?: boolean;
  outputFormat?: 'json' | 'text' | 'stream-json';
  maxTurns?: number;
  allowedTools?: string[];
  disallowedTools?: string[];
  cwd?: string;
  timeout?: number;
}

export interface ClaudeCliResult {
  success: boolean;
  output: string;
  sessionId: string;
  tokensUsed?: number;
  costUsd?: number;
  exitCode: number;
  duration: number;
}

/** claude --output-format json return structure */
export interface ClaudeCliJsonOutput {
  type: 'result';
  subtype: 'success' | 'error_max_turns';
  is_error: boolean;
  duration_ms: number;
  duration_api_ms: number;
  num_turns: number;
  result: string;
  total_cost_usd: number;
  session_id: string;
}
