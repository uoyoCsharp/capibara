// ─── Event Types ────────────────────────────────────────────────────
// Internal EventBus event names follow `entity:lifecycle` format.

export type DomainEventType =
  | 'task:created'
  | 'task:status-changed'
  | 'task:completed'
  | 'task:propagation-failed'
  | 'discussion:vote-added'
  | 'discussion:message-added'
  | 'discussion:group-created'
  | 'run:queued'
  | 'run:started'
  | 'run:succeeded'
  | 'run:failed'
  | 'run:cancelled'
  | 'run:log'
  | 'run:timed-out'
  | 'org:created'
  | 'org:updated'
  | 'org:deleted'
  | 'role:created'
  | 'role:updated'
  | 'role:deleted'
  | 'dispute:detected'
  | 'circuit-breaker:self-wake'
  | 'circuit-breaker:revise-limit'
  | 'budget:exceeded'
  | 'wake:triggered'
  | 'wake:pending-enqueued'
  | 'narrative:updated'
  | 'approval:required'
  | 'approval:completed'
  | 'escalation:top-level'
  | 'orchestrator:error'
  | 'settings:locale-changed'
  | 'conversation:question-posted'
  | 'conversation:reply-posted'
  | 'conversation:state-changed'
  | 'conversation:routing-failed'
  | 'conversation:escalated'
  | 'conversation:timed-out'
  | 'conversation:resolved'
  | 'conversation:cancelled'
  | 'schema:updated'
  | 'behavior:executed';

export interface DomainEvent<T = unknown> {
  type: DomainEventType;
  timestamp: string;
  payload: T;
}
