import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AcpUpdateHandler } from '@core/modules/acp/handlers/acp-update.handler';
import type { IEventBus } from '@core/foundation/interfaces/i-event-bus';
import type { ILogger } from '@core/foundation/interfaces/i-logger';
import { MockLogger } from '../../helpers/mock-logger';

function createMockEventBus(): IEventBus {
  return {
    emit: vi.fn(),
    on: vi.fn(),
    off: vi.fn(),
  } as any;
}

describe('AcpUpdateHandler — run:tool-call events', () => {
  let handler: AcpUpdateHandler;
  let eventBus: IEventBus;
  let logger: ILogger;

  beforeEach(() => {
    eventBus = createMockEventBus();
    logger = new MockLogger();
    handler = new AcpUpdateHandler(eventBus, logger);
  });

  it('should emit run:tool-call domain event on tool_call update when runId is set', () => {
    handler.setRunId('acp-session-1', 'run-1');
    handler.handleUpdate('acp-session-1', {
      sessionUpdate: 'tool_call',
      toolCallId: 'tc-1',
      title: 'Read File',
      status: 'running',
    } as any);

    expect(eventBus.emit).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'run:tool-call',
        payload: {
          runId: 'run-1',
          toolCallId: 'tc-1',
          title: 'Read File',
          status: 'running',
          kind: null,
        },
      }),
    );
  });

  it('should not emit run:tool-call when runId is not set', () => {
    handler.handleUpdate('unknown-session', {
      sessionUpdate: 'tool_call',
      toolCallId: 'tc-1',
      title: 'Read File',
      status: 'running',
    } as any);

    expect(eventBus.emit).not.toHaveBeenCalled();
  });

  it('should emit run:tool-call on tool_call_update', () => {
    handler.setRunId('acp-session-1', 'run-1');
    handler.handleUpdate('acp-session-1', {
      sessionUpdate: 'tool_call_update',
      toolCallId: 'tc-1',
      status: 'completed',
    } as any);

    expect(eventBus.emit).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'run:tool-call',
        payload: expect.objectContaining({
          runId: 'run-1',
          toolCallId: 'tc-1',
          status: 'completed',
        }),
      }),
    );
  });

  it('should clear runId mapping on removeCallbacks', () => {
    handler.setRunId('acp-session-1', 'run-1');
    handler.removeCallbacks('acp-session-1');

    handler.handleUpdate('acp-session-1', {
      sessionUpdate: 'tool_call',
      toolCallId: 'tc-1',
      title: 'Read File',
      status: 'running',
    } as any);

    expect(eventBus.emit).not.toHaveBeenCalled();
  });

  it('should still invoke log callbacks alongside domain events', () => {
    const logCb = vi.fn();
    handler.setRunId('acp-session-1', 'run-1');
    handler.onLog('acp-session-1', logCb);

    handler.handleUpdate('acp-session-1', {
      sessionUpdate: 'tool_call',
      toolCallId: 'tc-1',
      title: 'Read File',
      status: 'running',
    } as any);

    // Both log callback and domain event should fire
    expect(logCb).toHaveBeenCalledWith('stdout', expect.any(String));
    expect(eventBus.emit).toHaveBeenCalled();
  });
});
