import { describe, it, expect, beforeEach, vi } from 'vitest';
import { StreamJsonParser } from '@core/modules/execution/workers/stream-json-parser';
import type { StreamJsonParserCallbacks } from '@core/modules/execution/workers/stream-json-parser';

describe('StreamJsonParser', () => {
  let parser: StreamJsonParser;
  let callbacks: StreamJsonParserCallbacks;

  beforeEach(() => {
    callbacks = {
      onText: vi.fn(),
      onStatus: vi.fn(),
    };
    parser = new StreamJsonParser(callbacks);
  });

  describe('feed — text extraction', () => {
    it('extracts text from assistant message block', () => {
      const json = JSON.stringify({
        type: 'assistant',
        message: {
          content: [{ type: 'text', text: 'Hello world' }],
        },
      });

      parser.feed(json + '\n');

      expect(callbacks.onText).toHaveBeenCalledWith('Hello world');
    });

    it('extracts multiple text blocks', () => {
      const json = JSON.stringify({
        type: 'assistant',
        message: {
          content: [
            { type: 'text', text: 'First' },
            { type: 'text', text: 'Second' },
          ],
        },
      });

      parser.feed(json + '\n');

      expect(callbacks.onText).toHaveBeenCalledTimes(2);
      expect(callbacks.onText).toHaveBeenCalledWith('First');
      expect(callbacks.onText).toHaveBeenCalledWith('Second');
    });
  });

  describe('feed — tool_use extraction', () => {
    it('emits tool status for tool_use blocks', () => {
      const json = JSON.stringify({
        type: 'assistant',
        message: {
          content: [{ type: 'tool_use', name: 'capibara_task_complete' }],
        },
      });

      parser.feed(json + '\n');

      expect(callbacks.onStatus).toHaveBeenCalledWith('tool:capibara_task_complete');
    });
  });

  describe('feed — chunked input', () => {
    it('handles data split across multiple chunks', () => {
      const json = JSON.stringify({
        type: 'assistant',
        message: { content: [{ type: 'text', text: 'chunked' }] },
      });
      const half = Math.floor(json.length / 2);

      parser.feed(json.slice(0, half));
      expect(callbacks.onText).not.toHaveBeenCalled();

      parser.feed(json.slice(half) + '\n');
      expect(callbacks.onText).toHaveBeenCalledWith('chunked');
    });

    it('handles multiple JSON objects in one chunk', () => {
      const json1 = JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'A' }] } });
      const json2 = JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'B' }] } });

      parser.feed(json1 + '\n' + json2 + '\n');

      expect(callbacks.onText).toHaveBeenCalledTimes(2);
      expect(callbacks.onText).toHaveBeenCalledWith('A');
      expect(callbacks.onText).toHaveBeenCalledWith('B');
    });
  });

  describe('feed — non-JSON resilience', () => {
    it('ignores non-JSON lines', () => {
      parser.feed('this is not json\n');
      parser.feed('another invalid line\n');

      expect(callbacks.onText).not.toHaveBeenCalled();
      expect(callbacks.onStatus).not.toHaveBeenCalled();
    });

    it('ignores non-assistant type objects', () => {
      const json = JSON.stringify({ type: 'system', subtype: 'init', model: 'claude' });
      parser.feed(json + '\n');

      expect(callbacks.onText).not.toHaveBeenCalled();
    });

    it('ignores empty lines', () => {
      parser.feed('\n\n\n');

      expect(callbacks.onText).not.toHaveBeenCalled();
    });
  });

  describe('flush', () => {
    it('processes remaining buffered content', () => {
      const json = JSON.stringify({
        type: 'assistant',
        message: { content: [{ type: 'text', text: 'buffered' }] },
      });

      parser.feed(json); // no newline — stays in buffer
      expect(callbacks.onText).not.toHaveBeenCalled();

      parser.flush();
      expect(callbacks.onText).toHaveBeenCalledWith('buffered');
    });

    it('handles empty buffer on flush', () => {
      parser.flush();
      expect(callbacks.onText).not.toHaveBeenCalled();
    });
  });

  describe('edge cases', () => {
    it('handles assistant message with empty content array', () => {
      const json = JSON.stringify({ type: 'assistant', message: { content: [] } });
      parser.feed(json + '\n');

      expect(callbacks.onText).not.toHaveBeenCalled();
      expect(callbacks.onStatus).not.toHaveBeenCalled();
    });

    it('handles assistant message with no message field', () => {
      const json = JSON.stringify({ type: 'assistant' });
      parser.feed(json + '\n');

      expect(callbacks.onText).not.toHaveBeenCalled();
    });

    it('handles assistant message with non-array content', () => {
      const json = JSON.stringify({ type: 'assistant', message: { content: 'not an array' } });
      parser.feed(json + '\n');

      expect(callbacks.onText).not.toHaveBeenCalled();
    });
  });
});
