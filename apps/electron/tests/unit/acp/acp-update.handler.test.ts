import { describe, it, expect, beforeEach, vi } from 'vitest';
import { AcpUpdateHandler } from '@core/modules/acp/handlers/acp-update.handler';
import { MockLogger } from '../../helpers/mock-logger';
import { MockEventBus } from '../../helpers/mock-event-bus';

describe('AcpUpdateHandler', () => {
  let handler: AcpUpdateHandler;
  let logger: MockLogger;
  let eventBus: MockEventBus;

  beforeEach(() => {
    logger = new MockLogger();
    eventBus = new MockEventBus();
    handler = new AcpUpdateHandler(eventBus, logger);
  });

  describe('handleUpdate - agent_message_chunk', () => {
    it('should invoke text callbacks with text content', () => {
      const textCb = vi.fn();
      handler.onText('sess-1', textCb);

      handler.handleUpdate('sess-1', {
        sessionUpdate: 'agent_message_chunk',
        content: { type: 'text', text: 'hello world' },
      } as any);

      expect(textCb).toHaveBeenCalledWith('hello world');
    });

    it('should invoke log callbacks as stdout', () => {
      const logCb = vi.fn();
      handler.onLog('sess-1', logCb);

      handler.handleUpdate('sess-1', {
        sessionUpdate: 'agent_message_chunk',
        content: { type: 'text', text: 'chunk' },
      } as any);

      expect(logCb).toHaveBeenCalledWith('stdout', 'chunk');
    });

    it('should not invoke callbacks for other sessions', () => {
      const textCb = vi.fn();
      handler.onText('sess-1', textCb);

      handler.handleUpdate('sess-2', {
        sessionUpdate: 'agent_message_chunk',
        content: { type: 'text', text: 'data' },
      } as any);

      expect(textCb).not.toHaveBeenCalled();
    });
  });

  describe('handleUpdate - tool_call', () => {
    it('should emit JSON log with tool_call_start info', () => {
      const logCb = vi.fn();
      handler.onLog('sess-1', logCb);

      handler.handleUpdate('sess-1', {
        sessionUpdate: 'tool_call',
        toolCallId: 'tc-1',
        title: 'Read file',
        status: 'running',
      } as any);

      expect(logCb).toHaveBeenCalledTimes(1);
      const data = JSON.parse(logCb.mock.calls[0][1]);
      expect(data.type).toBe('tool_call_start');
      expect(data.toolCallId).toBe('tc-1');
      expect(data.title).toBe('Read file');
    });
  });

  describe('handleUpdate - tool_call_update', () => {
    it('should emit JSON log with tool_call_update info', () => {
      const logCb = vi.fn();
      handler.onLog('sess-1', logCb);

      handler.handleUpdate('sess-1', {
        sessionUpdate: 'tool_call_update',
        toolCallId: 'tc-1',
        status: 'completed',
      } as any);

      const data = JSON.parse(logCb.mock.calls[0][1]);
      expect(data.type).toBe('tool_call_update');
      expect(data.toolCallId).toBe('tc-1');
      expect(data.status).toBe('completed');
    });
  });

  describe('handleUpdate - plan', () => {
    it('should emit JSON log with plan entries', () => {
      const logCb = vi.fn();
      handler.onLog('sess-1', logCb);

      handler.handleUpdate('sess-1', {
        sessionUpdate: 'plan',
        entries: [{ title: 'Step 1', status: 'pending' }],
      } as any);

      const data = JSON.parse(logCb.mock.calls[0][1]);
      expect(data.type).toBe('plan');
      expect(data.entries).toHaveLength(1);
    });
  });

  describe('handleUpdate - usage_update', () => {
    it('should log debug without emitting callbacks', () => {
      const logCb = vi.fn();
      handler.onLog('sess-1', logCb);

      handler.handleUpdate('sess-1', {
        sessionUpdate: 'usage_update',
        inputTokens: 100,
        outputTokens: 50,
      } as any);

      expect(logCb).not.toHaveBeenCalled();
      expect(logger.logs.some(l => l.level === 'debug' && l.msg === 'Usage update')).toBe(true);
    });
  });

  describe('handleUpdate - unknown type', () => {
    it('should log debug for unhandled update types', () => {
      handler.handleUpdate('sess-1', {
        sessionUpdate: 'some_future_event',
      } as any);

      expect(logger.logs.some(l => l.level === 'debug' && l.msg === 'Unhandled session update')).toBe(true);
    });
  });

  describe('callback management', () => {
    it('should support multiple text callbacks per session', () => {
      const cb1 = vi.fn();
      const cb2 = vi.fn();
      handler.onText('sess-1', cb1);
      handler.onText('sess-1', cb2);

      handler.handleUpdate('sess-1', {
        sessionUpdate: 'agent_message_chunk',
        content: { type: 'text', text: 'hi' },
      } as any);

      expect(cb1).toHaveBeenCalledWith('hi');
      expect(cb2).toHaveBeenCalledWith('hi');
    });

    it('should remove all callbacks for a session', () => {
      const textCb = vi.fn();
      const logCb = vi.fn();
      handler.onText('sess-1', textCb);
      handler.onLog('sess-1', logCb);

      handler.removeCallbacks('sess-1');

      handler.handleUpdate('sess-1', {
        sessionUpdate: 'agent_message_chunk',
        content: { type: 'text', text: 'gone' },
      } as any);

      expect(textCb).not.toHaveBeenCalled();
      expect(logCb).not.toHaveBeenCalled();
    });
  });
});
