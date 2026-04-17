export interface ClaudeStreamResult {
  model: string | null;
  sessionId: string | null;
  summary: string | null;
  errorMessage: string | null;
  isError: boolean;
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
}

export function parseClaudeStreamJson(stdout: string): ClaudeStreamResult {
  const result: ClaudeStreamResult = {
    model: null,
    sessionId: null,
    summary: null,
    errorMessage: null,
    isError: false,
    inputTokens: 0,
    outputTokens: 0,
    cachedInputTokens: 0,
  };

  const lines = stdout.split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    let obj: Record<string, unknown>;
    try {
      obj = JSON.parse(trimmed) as Record<string, unknown>;
    } catch {
      continue;
    }

    if (obj.type === 'system' && obj.subtype === 'init') {
      if (typeof obj.model === 'string') result.model = obj.model;
      if (typeof obj.session_id === 'string') result.sessionId = obj.session_id;
    }

    if (obj.type === 'result') {
      result.isError = obj.is_error === true;
      if (typeof obj.session_id === 'string') result.sessionId = obj.session_id;

      const usage = obj.usage as Record<string, number> | undefined;
      if (usage) {
        result.inputTokens = usage.input_tokens ?? 0;
        result.outputTokens = usage.output_tokens ?? 0;
        result.cachedInputTokens = usage.cache_read_input_tokens ?? 0;
      }

      if (result.isError && typeof obj.error === 'string') {
        result.errorMessage = obj.error;
      }

      if (!result.isError && typeof obj.result === 'string') {
        result.summary = obj.result;
      }
    }
  }

  return result;
}
