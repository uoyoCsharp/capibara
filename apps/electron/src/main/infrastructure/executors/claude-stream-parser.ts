/**
 * Parses Claude Code CLI `--output-format stream-json` stdout.
 * Each line is a JSON object with a `type` field.
 *
 * Reference: adapter-claude-local/src/server/parse.ts from AgentCompany.
 */

export interface ClaudeUsage {
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
}

export interface ClaudeStreamResult {
  /** Parsed result JSON from the final `type: "result"` message */
  resultJson: Record<string, unknown> | null;
  /** Aggregated token usage */
  usage: ClaudeUsage | null;
  /** Model used */
  model: string;
  /** Session ID for resumption */
  sessionId: string;
  /** Final summary text */
  summary: string;
  /** Whether the result indicates an error */
  isError: boolean;
  /** Error messages */
  errors: string[];
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function asNumber(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function asString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

function safeJsonParse(line: string): unknown {
  try {
    return JSON.parse(line);
  } catch {
    return null;
  }
}

/**
 * Parse the full stdout from a Claude CLI `--output-format stream-json` invocation.
 * Processes each NDJSON line to extract usage, cost, session, model, and result.
 */
export function parseClaudeStreamJson(stdout: string): ClaudeStreamResult {
  const result: ClaudeStreamResult = {
    resultJson: null,
    usage: null,
    model: '',
    sessionId: '',
    summary: '',
    isError: false,
    errors: [],
  };

  const lines = stdout.split(/\r?\n/);

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    const parsed = asRecord(safeJsonParse(trimmed));
    if (!parsed) continue;

    const type = asString(parsed.type);

    // `type: "system"` with `subtype: "init"` — extract model and sessionId
    if (type === 'system' && parsed.subtype === 'init') {
      result.model = asString(parsed.model, result.model);
      result.sessionId = asString(parsed.session_id, result.sessionId);
      continue;
    }

    // `type: "result"` — final message with usage, cost, summary
    if (type === 'result') {
      result.resultJson = parsed;

      const usageObj = asRecord(parsed.usage);
      if (usageObj) {
        result.usage = {
          inputTokens: asNumber(usageObj.input_tokens),
          cachedInputTokens: asNumber(usageObj.cache_read_input_tokens),
          outputTokens: asNumber(usageObj.output_tokens),
        };
      }

      result.summary = asString(parsed.result);
      result.model = asString(parsed.model, result.model);
      result.sessionId = asString(parsed.session_id, result.sessionId);
      result.isError = parsed.is_error === true;

      if (Array.isArray(parsed.errors)) {
        for (const err of parsed.errors) {
          const text = typeof err === 'string' ? err : asString((asRecord(err) ?? {}).message);
          if (text) result.errors.push(text);
        }
      }
      continue;
    }
  }

  return result;
}

/**
 * Detect if Claude CLI output indicates a login is required.
 */
export function detectClaudeLoginRequired(opts: {
  parsed: Record<string, unknown> | null;
  stdout: string;
  stderr: string;
}): { requiresLogin: boolean; loginUrl: string | null } {
  const { parsed, stdout, stderr } = opts;
  const combined = `${stdout}\n${stderr}`;

  // Check for login URL in output
  const urlMatch = combined.match(/https:\/\/console\.anthropic\.com\/[^\s"')]+/);

  // Check for auth-related error codes
  if (parsed) {
    const isError = parsed.is_error === true;
    const errorText = asString(parsed.result) + asString(parsed.error);
    if (isError && /auth|login|unauthorized|api.key/i.test(errorText)) {
      return { requiresLogin: true, loginUrl: urlMatch?.[0] ?? null };
    }
  }

  if (/please log in|authentication required|unauthorized/i.test(combined)) {
    return { requiresLogin: true, loginUrl: urlMatch?.[0] ?? null };
  }

  return { requiresLogin: false, loginUrl: null };
}

/**
 * Check if the result indicates max turns was reached.
 */
export function isClaudeMaxTurnsResult(parsed: Record<string, unknown>): boolean {
  return asString(parsed.subtype) === 'max_turns';
}

/**
 * Build a human-readable failure description from Claude result JSON.
 */
export function describeClaudeFailure(parsed: Record<string, unknown>): string | null {
  if (parsed.is_error !== true) return null;

  const errors = Array.isArray(parsed.errors)
    ? parsed.errors.map((e) => (typeof e === 'string' ? e : asString((asRecord(e) ?? {}).message))).filter(Boolean)
    : [];

  if (errors.length > 0) return errors.join('; ');

  const result = asString(parsed.result);
  if (result) return result;

  return 'Claude exited with an error';
}
