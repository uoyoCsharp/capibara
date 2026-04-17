export type DomainEventType =
  // Task events
  | 'task:created'
  | 'task:status-changed'
  | 'task:completed'
  | 'task:entered-approval'
  | 'task:approval-confirmed'
  | 'task:approval-rejected'
  // Organization events
  | 'org:created'
  | 'org:updated'
  | 'org:deleted'
  | 'role:created'
  | 'role:updated'
  | 'role:deleted'
  // Conversation events
  | 'conversation:created'
  | 'conversation:message-added'
  | 'conversation:response-needed'
  | 'conversation:respondent-assigned'
  | 'conversation:resolved'
  | 'conversation:escalated'
  | 'conversation:timed-out'
  | 'conversation:cancelled'
  // Run events
  | 'run:queued'
  | 'run:started'
  | 'run:succeeded'
  | 'run:failed'
  | 'run:cancelled'
  | 'run:log'
  | 'run:assistant-text'
  | 'run:status'
  | 'run:timed-out'
  // Process schema events
  | 'process:schema-updated'
  | 'behavior:executed'
  // Orchestrator events
  | 'wake:triggered'
  | 'wake:pending-enqueued'
  | 'orchestrator:error'
  // Budget events
  | 'budget:exceeded'
  // Approval events
  | 'approval:required'
  | 'approval:completed'
  // Planning events
  | 'planning:plan-ready'
  // Settings events
  | 'settings:locale-changed';

export interface DomainEvent<T = unknown> {
  type: DomainEventType;
  timestamp: string;
  payload: T;
}
