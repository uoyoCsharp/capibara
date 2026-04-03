export class CapibaraError extends Error {
  constructor(
    message: string,
    public readonly code: string,
  ) {
    super(message);
    this.name = 'CapibaraError';
  }
}

export class NotFoundError extends CapibaraError {
  constructor(entity: string, id: string) {
    super(`${entity} not found: ${id}`, 'NOT_FOUND');
    this.name = 'NotFoundError';
  }
}

export class ValidationError extends CapibaraError {
  constructor(message: string) {
    super(message, 'VALIDATION_ERROR');
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
  constructor(runId: string, message: string) {
    super(`Run ${runId} failed: ${message}`, 'EXECUTION_ERROR');
    this.name = 'ExecutionError';
  }
}

export class ConsensusError extends CapibaraError {
  constructor(groupId: string, message: string) {
    super(`Consensus error in group ${groupId}: ${message}`, 'CONSENSUS_ERROR');
    this.name = 'ConsensusError';
  }
}
