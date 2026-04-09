import { ipcMain } from 'electron';
import { IPC_CHANNELS, saveSchemaSchema } from '@shared/contracts.js';
import type { DesktopResult } from '@shared/contracts.js';
import type { IWorkflowEngine } from '@main/core/interfaces/i-workflow-engine.js';
import type { ILogger } from '@main/core/interfaces/i-logger.js';
import type { WorkflowSchema } from '@main/core/types/workflow-schema.types.js';
import { SchemaValidationError } from '@main/core/errors/workflow.errors.js';

function ok<T>(data: T): DesktopResult<T> {
  return { ok: true, data };
}

function fail<T>(code: string, message: string): DesktopResult<T> {
  return { ok: false, error: { code, message } };
}

export function registerWorkflowSchemaHandlers(
  workflowEngine: IWorkflowEngine,
  logger: ILogger,
): void {
  ipcMain.handle(IPC_CHANNELS.getActiveSchema, async (_event, orgId: unknown) => {
    try {
      if (typeof orgId !== 'string' || !orgId) {
        return fail('VALIDATION_ERROR', 'orgId must be a non-empty string');
      }
      const schema = await workflowEngine.getActiveSchema(orgId);
      return ok(schema);
    } catch (err) {
      if (err instanceof Error && err.name === 'NotFoundError') {
        return fail('NOT_FOUND', `No active schema for org ${orgId}`);
      }
      logger.error('Failed to get active schema', { error: String(err) });
      return fail('INTERNAL', 'Failed to get active schema');
    }
  });

  ipcMain.handle(IPC_CHANNELS.saveSchema, async (_event, input: unknown) => {
    try {
      const parsed = saveSchemaSchema.safeParse(input);
      if (!parsed.success) {
        return fail('VALIDATION_ERROR', parsed.error.message);
      }

      const schema = parsed.data.schema as unknown as WorkflowSchema;
      const impactReport = await workflowEngine.saveSchema(parsed.data.orgId, schema);
      return ok(impactReport);
    } catch (err) {
      if (err instanceof SchemaValidationError) {
        return fail('SCHEMA_VALIDATION', err.message);
      }
      logger.error('Failed to save schema', { error: String(err) });
      return fail('INTERNAL', 'Failed to save schema');
    }
  });

  ipcMain.handle(IPC_CHANNELS.validateSchema, async (_event, input: unknown) => {
    try {
      const parsed = saveSchemaSchema.safeParse(input);
      if (!parsed.success) {
        return fail('VALIDATION_ERROR', parsed.error.message);
      }

      const schema = parsed.data.schema as unknown as WorkflowSchema;
      const violations = workflowEngine.validateSchemaIntegrity(schema);
      return ok(violations);
    } catch (err) {
      logger.error('Failed to validate schema', { error: String(err) });
      return fail('INTERNAL', 'Failed to validate schema');
    }
  });

  ipcMain.handle(IPC_CHANNELS.schemaImpactAnalysis, async (_event, input: unknown) => {
    try {
      const parsed = saveSchemaSchema.safeParse(input);
      if (!parsed.success) {
        return fail('VALIDATION_ERROR', parsed.error.message);
      }

      const schema = parsed.data.schema as unknown as WorkflowSchema;
      const impactReport = await workflowEngine.analyzeImpactReadOnly(parsed.data.orgId, schema);
      return ok(impactReport);
    } catch (err) {
      logger.error('Failed to analyze schema impact', { error: String(err) });
      return fail('INTERNAL', 'Failed to analyze schema impact');
    }
  });
}
