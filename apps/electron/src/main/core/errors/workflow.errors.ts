import { CapibaraError } from './capibara.errors.js';

export class WorkflowSchemaError extends CapibaraError {
  constructor(message: string, code: string = 'WORKFLOW_SCHEMA_ERROR', options?: { cause?: Error }) {
    super(message, code, options);
    this.name = 'WorkflowSchemaError';
  }
}

export class InvalidTypeError extends WorkflowSchemaError {
  constructor(type: string, context: string) {
    super(`Invalid work item type '${type}': ${context}`, 'INVALID_TYPE');
    this.name = 'InvalidTypeError';
  }
}

export class InvalidTransitionError extends WorkflowSchemaError {
  constructor(from: string, to: string) {
    super(`Invalid status transition: '${from}' → '${to}'`, 'INVALID_TRANSITION');
    this.name = 'InvalidTransitionError';
  }
}

export class SchemaValidationError extends WorkflowSchemaError {
  constructor(
    public readonly violations: string[],
  ) {
    super(
      `Schema validation failed:\n${violations.map((v) => `  - ${v}`).join('\n')}`,
      'SCHEMA_VALIDATION',
    );
    this.name = 'SchemaValidationError';
  }
}
