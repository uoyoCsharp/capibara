export class CapibaraError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    options?: { cause?: Error },
  ) {
    super(message, options);
    this.name = 'CapibaraError';
  }
}

export class NotFoundError extends CapibaraError {
  constructor(entity: string, id: string, options?: { cause?: Error }) {
    super(`${entity} not found: ${id}`, 'NOT_FOUND', options);
    this.name = 'NotFoundError';
  }
}

export class ValidationError extends CapibaraError {
  constructor(message: string, options?: { cause?: Error }) {
    super(message, 'VALIDATION_ERROR', options);
    this.name = 'ValidationError';
  }
}

export class TaskStateError extends CapibaraError {
  constructor(from: string, to: string) {
    super(`Invalid task transition: ${from} → ${to}`, 'INVALID_TASK_TRANSITION');
    this.name = 'TaskStateError';
  }
}

export class BudgetExceededError extends CapibaraError {
  constructor(orgId: string, limit: number, current: number) {
    super(
      `Token budget exceeded for org ${orgId}: ${current.toFixed(4)}M / ${limit.toFixed(4)}M tokens`,
      'BUDGET_EXCEEDED',
    );
    this.name = 'BudgetExceededError';
  }
}

export class CircuitBreakerError extends CapibaraError {
  constructor(roleId: string, mechanism: string, threshold: number) {
    super(
      `Circuit breaker triggered for role ${roleId}: ${mechanism} (threshold: ${threshold})`,
      'CIRCUIT_BREAKER',
    );
    this.name = 'CircuitBreakerError';
  }
}

export class ExecutionError extends CapibaraError {
  constructor(runId: string, message: string, options?: { cause?: Error }) {
    super(`Run ${runId} failed: ${message}`, 'EXECUTION_ERROR', options);
    this.name = 'ExecutionError';
  }
}

export class ConsensusError extends CapibaraError {
  constructor(groupId: string, message: string) {
    super(`Consensus error in group ${groupId}: ${message}`, 'CONSENSUS_ERROR');
    this.name = 'ConsensusError';
  }
}

// ─── Conversation Domain Errors ──────────────────────────────────────

export class ConversationStateError extends CapibaraError {
  constructor(workflowId: string, from: string, to: string) {
    super(
      `Invalid conversation transition: ${from} → ${to} (workflow: ${workflowId})`,
      'INVALID_CONVERSATION_TRANSITION',
    );
    this.name = 'ConversationStateError';
  }
}

export class ConversationRoutingError extends CapibaraError {
  constructor(taskId: string, reason: string) {
    super(`Routing failed for task ${taskId}: ${reason}`, 'CONVERSATION_ROUTING_FAILED');
    this.name = 'ConversationRoutingError';
  }
}

export class ConversationTimeoutError extends CapibaraError {
  constructor(workflowId: string, message: string) {
    super(
      `Conversation timeout: ${message} (workflow: ${workflowId})`,
      'CONVERSATION_TIMEOUT',
    );
    this.name = 'ConversationTimeoutError';
  }
}
