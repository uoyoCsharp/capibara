import { describe, it, expect } from 'vitest';
import { parseClaudeStreamJson } from '@core/infrastructure/adapters/claude-stream-parser';

describe('parseClaudeStreamJson', () => {
  describe('system init parsing', () => {
    it('extracts model and sessionId from init event', () => {
      const stdout = JSON.stringify({ type: 'system', subtype: 'init', model: 'claude-sonnet-4-6-20250514', session_id: 'sess-abc' });

      const result = parseClaudeStreamJson(stdout);

      expect(result.model).toBe('claude-sonnet-4-6-20250514');
      expect(result.sessionId).toBe('sess-abc');
    });

    it('handles init without session_id', () => {
      const stdout = JSON.stringify({ type: 'system', subtype: 'init', model: 'claude-opus-4-6-20250514' });

      const result = parseClaudeStreamJson(stdout);

      expect(result.model).toBe('claude-opus-4-6-20250514');
      expect(result.sessionId).toBeNull();
    });
  });

  describe('result parsing — success', () => {
    it('extracts summary and usage from successful result', () => {
      const lines = [
        JSON.stringify({ type: 'system', subtype: 'init', model: 'claude-sonnet-4-6-20250514', session_id: 'sess-1' }),
        JSON.stringify({
          type: 'result',
          is_error: false,
          session_id: 'sess-1',
          result: 'Task completed successfully',
          usage: { input_tokens: 1200, output_tokens: 400, cache_read_input_tokens: 300 },
        }),
      ].join('\n');

      const result = parseClaudeStreamJson(lines);

      expect(result.isError).toBe(false);
      expect(result.summary).toBe('Task completed successfully');
      expect(result.inputTokens).toBe(1200);
      expect(result.outputTokens).toBe(400);
      expect(result.cachedInputTokens).toBe(300);
      expect(result.sessionId).toBe('sess-1');
    });
  });

  describe('result parsing — error', () => {
    it('extracts error message from failed result', () => {
      const lines = [
        JSON.stringify({ type: 'system', subtype: 'init', model: 'claude-sonnet-4-6-20250514' }),
        JSON.stringify({
          type: 'result',
          is_error: true,
          error: 'Rate limit exceeded',
          session_id: 'sess-2',
          usage: { input_tokens: 100, output_tokens: 0 },
        }),
      ].join('\n');

      const result = parseClaudeStreamJson(lines);

      expect(result.isError).toBe(true);
      expect(result.errorMessage).toBe('Rate limit exceeded');
      expect(result.summary).toBeNull();
      expect(result.inputTokens).toBe(100);
    });
  });

  describe('edge cases', () => {
    it('returns defaults for empty stdout', () => {
      const result = parseClaudeStreamJson('');

      expect(result.model).toBeNull();
      expect(result.sessionId).toBeNull();
      expect(result.summary).toBeNull();
      expect(result.isError).toBe(false);
      expect(result.inputTokens).toBe(0);
      expect(result.outputTokens).toBe(0);
    });

    it('ignores non-JSON lines', () => {
      const lines = [
        'Starting claude...',
        'some debug output',
        JSON.stringify({ type: 'system', subtype: 'init', model: 'claude-sonnet-4-6-20250514' }),
        'another garbage line',
        JSON.stringify({ type: 'result', is_error: false, result: 'Done', usage: { input_tokens: 10, output_tokens: 5 } }),
      ].join('\n');

      const result = parseClaudeStreamJson(lines);

      expect(result.model).toBe('claude-sonnet-4-6-20250514');
      expect(result.summary).toBe('Done');
    });

    it('handles missing usage field in result', () => {
      const stdout = JSON.stringify({ type: 'result', is_error: false, result: 'OK' });

      const result = parseClaudeStreamJson(stdout);

      expect(result.inputTokens).toBe(0);
      expect(result.outputTokens).toBe(0);
    });

    it('handles Windows line endings (\\r\\n)', () => {
      const lines = [
        JSON.stringify({ type: 'system', subtype: 'init', model: 'claude-sonnet-4-6-20250514' }),
        JSON.stringify({ type: 'result', is_error: false, result: 'OK', usage: { input_tokens: 50, output_tokens: 20 } }),
      ].join('\r\n');

      const result = parseClaudeStreamJson(lines);

      expect(result.model).toBe('claude-sonnet-4-6-20250514');
      expect(result.summary).toBe('OK');
    });

    it('uses last result event if multiple present', () => {
      const lines = [
        JSON.stringify({ type: 'result', is_error: false, result: 'First', usage: { input_tokens: 10, output_tokens: 5 } }),
        JSON.stringify({ type: 'result', is_error: false, result: 'Second', usage: { input_tokens: 20, output_tokens: 10 } }),
      ].join('\n');

      const result = parseClaudeStreamJson(lines);

      expect(result.summary).toBe('Second');
      expect(result.inputTokens).toBe(20);
    });

    it('session_id from result overrides init session_id', () => {
      const lines = [
        JSON.stringify({ type: 'system', subtype: 'init', session_id: 'init-sess', model: 'claude-sonnet-4-6-20250514' }),
        JSON.stringify({ type: 'result', is_error: false, session_id: 'result-sess', result: 'OK', usage: {} }),
      ].join('\n');

      const result = parseClaudeStreamJson(lines);

      expect(result.sessionId).toBe('result-sess');
    });
  });
});
