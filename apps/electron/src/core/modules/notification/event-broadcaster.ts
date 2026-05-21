import { injectable } from 'tsyringe';
import type { IEventBus } from '@core/foundation/interfaces/i-event-bus';
import type { DomainEvent, DomainEventType, DomainEventMap } from '@core/foundation/events';
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
  | { type: 'plan-tree:ready'; orgId: string; rootTaskId: string | null; sourceConversationId: string | null; nodeCount: number; maxDepth: number }
  | { type: 'plan-tree:discarded'; orgId: string; rootTaskId: string | null; sourceConversationId: string | null }
  | { type: 'plan-tree:approved'; orgId: string; rootTaskId: string | null; sourceConversationId: string | null }
  | { type: 'notification'; title: string; body: string };

type SendFn = (event: DesktopEvent) => void;

type Mapping<T extends DomainEventType> = {
  domain: T;
  map: (payload: DomainEventMap[T]) => DesktopEvent | null;
};

function mapping<T extends DomainEventType>(m: Mapping<T>): Mapping<T> {
  return m;
}

const EVENT_MAPPINGS = [
  mapping({ domain: 'org:created', map: (p) => ({ type: 'org:changed', orgId: p.orgId }) }),
  mapping({ domain: 'org:updated', map: (p) => ({ type: 'org:changed', orgId: p.orgId }) }),
  mapping({ domain: 'org:deleted', map: (p) => ({ type: 'org:changed', orgId: p.orgId }) }),
  mapping({ domain: 'role:created', map: (p) => ({ type: 'role:changed', orgId: p.orgId }) }),
  mapping({ domain: 'role:updated', map: (p) => ({ type: 'role:changed', orgId: p.orgId }) }),
  mapping({ domain: 'role:deleted', map: (p) => ({ type: 'role:changed', orgId: p.orgId }) }),
  mapping({ domain: 'task:created', map: (p) => ({ type: 'task:changed', orgId: p.orgId }) }),
  mapping({ domain: 'task:status-changed', map: (p) => ({ type: 'task:changed', orgId: p.orgId }) }),
  mapping({ domain: 'task:completed', map: (p) => ({ type: 'task:changed', orgId: p.orgId }) }),
  mapping({
    domain: 'task:entered-approval',
    map: (p) => ({ type: 'task:entered-approval', taskId: p.taskId, orgId: p.orgId }),
  }),
  mapping({ domain: 'run:started', map: (p) => ({ type: 'run:changed', orgId: p.orgId }) }),
  mapping({
    domain: 'run:succeeded',
    map: (p) => ({ type: 'run:completed', runId: p.runId, orgId: p.orgId, status: 'succeeded', tokenCount: p.tokenCount }),
  }),
  mapping({
    domain: 'run:failed',
    map: (p) => ({ type: 'run:completed', runId: p.runId, orgId: p.orgId, status: 'failed', tokenCount: p.tokenCount }),
  }),
  mapping({
    domain: 'run:cancelled',
    map: (p) => ({ type: 'run:completed', runId: p.runId, orgId: p.orgId, status: 'cancelled', tokenCount: p.tokenCount }),
  }),
  mapping({
    domain: 'run:log',
    map: (p) => ({ type: 'run:log', runId: p.runId, stream: p.stream, chunk: p.chunk }),
  }),
  mapping({
    domain: 'run:assistant-text',
    map: (p) => ({ type: 'run:assistant-text', runId: p.runId, text: p.text }),
  }),
  mapping({
    domain: 'run:status',
    map: (p) => ({ type: 'run:status', runId: p.runId, status: p.status }),
  }),
  mapping({ domain: 'conversation:created', map: (p) => ({ type: 'conversation:changed', orgId: p.orgId }) }),
  mapping({ domain: 'conversation:message-added', map: (p) => ({ type: 'conversation:changed', orgId: p.orgId }) }),
  mapping({ domain: 'conversation:completed', map: (p) => ({ type: 'conversation:changed', orgId: p.orgId }) }),
  mapping({
    domain: 'conversation:resolved',
    map: () => null,
  }),
  mapping({
    domain: 'conversation:response-needed',
    map: (p) =>
      p.roleId
        ? null
        : { type: 'conversation:response-needed', orgId: p.orgId, conversationId: p.conversationId },
  }),
  mapping({
    domain: 'plan-tree:ready',
    map: (p) => ({
      type: 'plan-tree:ready',
      orgId: p.orgId,
      rootTaskId: p.rootTaskId,
      sourceConversationId: p.sourceConversationId,
      nodeCount: p.nodeCount,
      maxDepth: p.maxDepth,
    }),
  }),
  mapping({
    domain: 'plan-tree:discarded',
    map: (p) => ({
      type: 'plan-tree:discarded',
      orgId: p.orgId,
      rootTaskId: p.rootTaskId,
      sourceConversationId: p.sourceConversationId,
    }),
  }),
  mapping({
    domain: 'plan-tree:approved',
    map: (p) => ({
      type: 'plan-tree:approved',
      orgId: p.orgId,
      rootTaskId: p.rootTaskId,
      sourceConversationId: p.sourceConversationId,
    }),
  }),
] as const;

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
    for (const m of EVENT_MAPPINGS) {
      this.eventBus.on(m.domain, (event: DomainEvent<typeof m.domain>) => {
        if (!this.sendFn) return;
        const desktopEvent = (m.map as (p: unknown) => DesktopEvent | null)(event.payload);
        if (desktopEvent) {
          this.sendFn(desktopEvent);
        }
      });
    }
    this.logger.info('EventBroadcaster started');
  }
}
