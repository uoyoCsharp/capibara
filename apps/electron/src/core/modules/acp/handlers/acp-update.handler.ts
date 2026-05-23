import type * as acp from '@agentclientprotocol/sdk';
import type { ILogger } from '@core/foundation/interfaces/i-logger';
import type { IEventBus } from '@core/foundation/interfaces/i-event-bus';
import type { LogCallback, TextCallback } from '../types/acp.types';

/**
 * Processes ACP session/update event stream.
 * Converts ACP events into internal logs/events, pushing them upstream via callbacks.
 */
export class AcpUpdateHandler {
  private logCallbacks = new Map<string, Set<LogCallback>>();
  private textCallbacks = new Map<string, Set<TextCallback>>();
  private sessionRunMap = new Map<string, string>();

  constructor(
    private readonly eventBus: IEventBus,
    private readonly logger: ILogger,
  ) {}

  /**
   * Associate an ACP session with a run for domain event emission.
   */
  setRunId(acpSessionId: string, runId: string): void {
    this.sessionRunMap.set(acpSessionId, runId);
  }

  /**
   * Handle a notification from ACP session/update.
   */
  handleUpdate(sessionId: string, update: acp.SessionUpdate): void {
    switch (update.sessionUpdate) {
      case 'agent_message_chunk': {
        if (update.content.type === 'text') {
          const text = update.content.text;
          const textCbs = this.textCallbacks.get(sessionId);
          textCbs?.forEach(cb => cb(text));
          // Also emit as stdout log
          this.emitLog(sessionId, 'stdout', text);
        }
        break;
      }

      case 'tool_call': {
        const data = JSON.stringify({
          type: 'tool_call_start',
          toolCallId: update.toolCallId,
          title: update.title,
          status: update.status,
        });
        this.emitLog(sessionId, 'stdout', data);
        this.emitToolCallEvent(sessionId, update.toolCallId, update.title, update.status ?? 'running', (update as { kind?: string }).kind ?? null);
        break;
      }

      case 'tool_call_update': {
        const data = JSON.stringify({
          type: 'tool_call_update',
          toolCallId: update.toolCallId,
          status: update.status,
        });
        this.emitLog(sessionId, 'stdout', data);
        this.emitToolCallEvent(sessionId, update.toolCallId, '', update.status ?? 'completed', null);
        break;
      }

      case 'plan': {
        const data = JSON.stringify({
          type: 'plan',
          entries: update.entries,
        });
        this.emitLog(sessionId, 'stdout', data);
        break;
      }

      case 'usage_update': {
        // Token usage update — not emitted externally; PromptResponse returns usage directly
        this.logger.debug('Usage update', { sessionId, usage: update });
        break;
      }

      default: {
        this.logger.debug('Unhandled session update', { sessionId, type: (update as { sessionUpdate: string }).sessionUpdate });
        break;
      }
    }
  }

  onLog(sessionId: string, cb: LogCallback): void {
    if (!this.logCallbacks.has(sessionId)) {
      this.logCallbacks.set(sessionId, new Set());
    }
    this.logCallbacks.get(sessionId)!.add(cb);
  }

  onText(sessionId: string, cb: TextCallback): void {
    if (!this.textCallbacks.has(sessionId)) {
      this.textCallbacks.set(sessionId, new Set());
    }
    this.textCallbacks.get(sessionId)!.add(cb);
  }

  removeCallbacks(sessionId: string): void {
    this.logCallbacks.delete(sessionId);
    this.textCallbacks.delete(sessionId);
    this.sessionRunMap.delete(sessionId);
  }

  private emitLog(sessionId: string, stream: 'stdout' | 'stderr', chunk: string): void {
    const logCbs = this.logCallbacks.get(sessionId);
    logCbs?.forEach(cb => cb(stream, chunk));
  }

  private emitToolCallEvent(
    acpSessionId: string,
    toolCallId: string,
    title: string,
    status: string,
    kind: string | null,
  ): void {
    const runId = this.sessionRunMap.get(acpSessionId);
    if (!runId) return;
    this.eventBus.emit({
      type: 'run:tool-call',
      timestamp: new Date().toISOString(),
      payload: { runId, toolCallId, title, status, kind },
    });
  }
}
