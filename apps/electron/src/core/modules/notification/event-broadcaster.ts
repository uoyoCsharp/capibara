import { injectable } from 'tsyringe';
import type { IEventBus } from '@core/foundation/interfaces/i-event-bus';
import type { DomainEvent, DomainEventType } from '@core/foundation/events';
import type { ILogger } from '@core/foundation/interfaces/i-logger';

export type DesktopEvent =
  | { type: 'snapshot:updated' }
  | { type: 'org:changed'; orgId: string }
  | { type: 'role:changed'; orgId: string }
  | { type: 'skill:changed' }
  | { type: 'task:changed'; orgId: string }
  | { type: 'task:entered-approval'; taskId: string; orgId: string }
  | { type: 'run:changed'; orgId: string }
  | { type: 'run:log'; runId: string; stream: string; chunk: string }
  | { type: 'run:assistant-text'; runId: string; text: string }
  | { type: 'run:status'; runId: string; status: string }
  | { type: 'run:completed'; runId: string; orgId: string; status: string; tokenCount: number }
  | { type: 'conversation:changed'; orgId: string }
  | { type: 'conversation:response-needed'; orgId: string; conversationId: string }
  | { type: 'scheduler:paused'; cancelledRunCount: number }
  | { type: 'scheduler:resumed' }
  | { type: 'planning:plan-ready'; orgId: string; taskCount: number }
  | { type: 'notification'; title: string; body: string };

type SendFn = (event: DesktopEvent) => void;

const EVENT_MAP: Array<{ domain: DomainEventType; map: (payload: Record<string, unknown>) => DesktopEvent | null }> = [
  { domain: 'org:created', map: (p) => ({ type: 'org:changed', orgId: p.orgId as string }) },
  { domain: 'org:updated', map: (p) => ({ type: 'org:changed', orgId: p.orgId as string }) },
  { domain: 'org:deleted', map: (p) => ({ type: 'org:changed', orgId: p.orgId as string }) },
  { domain: 'role:created', map: (p) => ({ type: 'role:changed', orgId: p.orgId as string }) },
  { domain: 'role:updated', map: (p) => ({ type: 'role:changed', orgId: p.orgId as string }) },
  { domain: 'role:deleted', map: (p) => ({ type: 'role:changed', orgId: p.orgId as string }) },
  { domain: 'task:created', map: (p) => ({ type: 'task:changed', orgId: p.orgId as string }) },
  { domain: 'task:status-changed', map: (p) => ({ type: 'task:changed', orgId: p.orgId as string }) },
  { domain: 'task:completed', map: (p) => ({ type: 'task:changed', orgId: p.orgId as string }) },
  { domain: 'task:entered-approval', map: (p) => ({ type: 'task:entered-approval', taskId: p.taskId as string, orgId: p.orgId as string }) },
  { domain: 'run:queued', map: (p) => ({ type: 'run:changed', orgId: p.orgId as string }) },
  { domain: 'run:started', map: (p) => ({ type: 'run:changed', orgId: p.orgId as string }) },
  { domain: 'run:succeeded', map: (p) => ({ type: 'run:completed', runId: p.runId as string, orgId: p.orgId as string, status: 'succeeded', tokenCount: (p.tokenCount as number) ?? 0 }) },
  { domain: 'run:failed', map: (p) => ({ type: 'run:completed', runId: p.runId as string, orgId: p.orgId as string, status: 'failed', tokenCount: 0 }) },
  { domain: 'run:cancelled', map: (p) => ({ type: 'run:completed', runId: p.runId as string, orgId: p.orgId as string, status: 'cancelled', tokenCount: 0 }) },
  { domain: 'run:log', map: (p) => ({ type: 'run:log', runId: p.runId as string, stream: p.stream as string, chunk: p.chunk as string }) },
  { domain: 'run:assistant-text', map: (p) => ({ type: 'run:assistant-text', runId: p.runId as string, text: p.text as string }) },
  { domain: 'run:status', map: (p) => ({ type: 'run:status', runId: p.runId as string, status: p.status as string }) },
  { domain: 'conversation:created', map: (p) => ({ type: 'conversation:changed', orgId: p.orgId as string }) },
  { domain: 'conversation:resolved', map: (p) => ({ type: 'conversation:changed', orgId: p.orgId as string }) },
  { domain: 'conversation:response-needed', map: (p) => ({ type: 'conversation:response-needed', orgId: p.orgId as string, conversationId: p.conversationId as string }) },
  { domain: 'planning:plan-ready', map: (p) => ({ type: 'planning:plan-ready', orgId: p.orgId as string, taskCount: (p.taskCount as number) ?? 0 }) },
];

@injectable()
export class EventBroadcaster {
  private sendFn: SendFn | null = null;

  constructor(
    private readonly eventBus: IEventBus,
    private readonly logger: ILogger,
  ) {}

  setSendFn(fn: SendFn): void {
    this.sendFn = fn;
  }

  start(): void {
    for (const mapping of EVENT_MAP) {
      this.eventBus.on(mapping.domain, (event: DomainEvent<unknown>) => {
        if (!this.sendFn) return;
        const desktopEvent = mapping.map(event.payload as Record<string, unknown>);
        if (desktopEvent) {
          this.sendFn(desktopEvent);
        }
      });
    }
    this.logger.info('EventBroadcaster started');
  }
}
