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
  constructor(from: string, to: string, reason?: string) {
    const suffix = reason ? ` — ${reason}` : '';
    super(`Invalid task transition: ${from} → ${to}${suffix}`, 'INVALID_TASK_TRANSITION');
    this.name = 'TaskStateError';
  }
}

export class ExecutionError extends CapibaraError {
  constructor(runId: string, message: string, options?: { cause?: Error }) {
    super(`Run ${runId} failed: ${message}`, 'EXECUTION_ERROR', options);
    this.name = 'ExecutionError';
  }
}

export class ConversationStateError extends CapibaraError {
  constructor(conversationId: string, from: string, to: string) {
    super(
      `Invalid conversation transition: ${from} → ${to} (conversation: ${conversationId})`,
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
  constructor(conversationId: string, message: string) {
    super(
      `Conversation timeout: ${message} (conversation: ${conversationId})`,
      'CONVERSATION_TIMEOUT',
    );
    this.name = 'ConversationTimeoutError';
  }
}
