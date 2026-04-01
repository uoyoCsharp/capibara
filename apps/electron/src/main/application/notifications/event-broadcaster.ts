import { BrowserWindow } from 'electron';
import type { IEventBus } from '@main/core/interfaces/i-event-bus.js';
import type { ILogger } from '@main/core/interfaces/i-logger.js';
import type { DomainEvent } from '@main/core/types/event.types.js';
import { IPC_CHANNELS } from '@shared/contracts.js';

/**
 * Forwards domain events to the renderer process via IPC so the UI
 * can react to task/run/discussion changes in real time.
 */
export class EventBroadcaster {
  constructor(
    private readonly eventBus: IEventBus,
    private readonly logger: ILogger,
  ) {}

  start(): void {
    const forward = (e: DomainEvent) => this.broadcast(e);

    // Task events
    this.eventBus.on('task:created', forward);
    this.eventBus.on('task:status-changed', forward);
    this.eventBus.on('task:completed', forward);

    // Run events
    this.eventBus.on('run:queued', forward);
    this.eventBus.on('run:started', forward);
    this.eventBus.on('run:succeeded', forward);
    this.eventBus.on('run:failed', forward);
    this.eventBus.on('run:cancelled', forward);

    // Discussion events
    this.eventBus.on('discussion:group-created', forward);
    this.eventBus.on('discussion:message-added', forward);
    this.eventBus.on('discussion:vote-added', forward);

    this.logger.info('EventBroadcaster started — forwarding domain events to renderer');
  }

  private broadcast(event: DomainEvent): void {
    const payload = event.payload as Record<string, unknown>;
    const windows = BrowserWindow.getAllWindows();
    if (windows.length === 0) return;

    // Map domain events to DesktopEvent shapes the renderer understands
    let desktopEvent: Record<string, unknown> | null = null;

    switch (event.type) {
      case 'task:created':
      case 'task:status-changed':
      case 'task:completed':
        desktopEvent = {
          type: 'task:changed',
          orgId: payload.orgId,
          taskId: payload.taskId,
        };
        break;

      case 'run:queued':
      case 'run:started':
      case 'run:succeeded':
      case 'run:failed':
      case 'run:cancelled':
        desktopEvent = {
          type: 'run:changed',
          orgId: payload.orgId,
          runId: payload.runId,
        };
        break;

      case 'discussion:group-created':
        desktopEvent = {
          type: 'discussion:changed',
          orgId: payload.orgId,
        };
        break;

      case 'discussion:message-added':
      case 'discussion:vote-added':
        desktopEvent = {
          type: 'discussion:message-added',
          groupId: payload.groupId,
        };
        break;

      default:
        return;
    }

    if (!desktopEvent) return;

    for (const win of windows) {
      try {
        win.webContents.send(IPC_CHANNELS.rendererEvent, desktopEvent);
      } catch {
        // Window may be destroyed
      }
    }
  }
}
