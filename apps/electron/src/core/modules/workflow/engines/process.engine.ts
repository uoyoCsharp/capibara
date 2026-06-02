import { injectable } from 'tsyringe';
import type { IProcessEngine } from '../interfaces/i-process.engine';
import type { IProcessSchemaRepository } from '../interfaces/i-process-schema.repository';
import type { ILogger } from '@core/foundation/interfaces/i-logger';
import { ValidationError } from '@core/foundation/errors/capibara.errors';
import type {
  ProcessSchema,
  StatusDefinition,
  StatusCategory,
  TransitionDefinition,
  WorkItemTypeDefinition,
} from '../types/workflow.types';

@injectable()
export class ProcessEngine implements IProcessEngine {
  private schemaCache = new Map<string, ProcessSchema>();

  constructor(
    private readonly schemaRepo: IProcessSchemaRepository,
    private readonly logger: ILogger,
  ) {}

  getSchema(orgId: string): ProcessSchema | null {
    const cached = this.schemaCache.get(orgId);
    if (cached) return cached;

    const record = this.schemaRepo.findActiveByOrgId(orgId);
    if (!record) return null;

    const schema = JSON.parse(record.schemaJson) as ProcessSchema;
    this.schemaCache.set(orgId, schema);
    return schema;
  }

  clearCache(orgId: string): void {
    this.schemaCache.delete(orgId);
  }

  validateType(orgId: string, typeName: string): boolean {
    const schema = this.getSchema(orgId);
    if (!schema) return true;
    return schema.workItemTypes.some((t) => t.name === typeName);
  }

  validateStatus(orgId: string, statusName: string): boolean {
    const schema = this.getSchema(orgId);
    if (!schema) return true;
    return schema.statuses.some((s) => s.name === statusName);
  }

  validateTransition(orgId: string, from: string, to: string): boolean {
    const schema = this.getSchema(orgId);
    if (!schema) return true;
    return schema.transitions.some((t) => t.from === from && t.to === to);
  }

  getAvailableTransitions(orgId: string, fromStatus: string): TransitionDefinition[] {
    const schema = this.getSchema(orgId);
    if (!schema) return [];
    return schema.transitions.filter((t) => t.from === fromStatus);
  }

  getTransition(orgId: string, from: string, to: string): TransitionDefinition | null {
    const schema = this.getSchema(orgId);
    if (!schema) return null;
    return schema.transitions.find((t) => t.from === from && t.to === to) ?? null;
  }

  getStatusDefinition(orgId: string, statusName: string): StatusDefinition | null {
    const schema = this.getSchema(orgId);
    if (!schema) return null;
    return schema.statuses.find((s) => s.name === statusName) ?? null;
  }

  getStatusCategory(orgId: string, statusName: string): StatusCategory | null {
    const def = this.getStatusDefinition(orgId, statusName);
    return def?.category ?? null;
  }

  getStatusesByCategory(orgId: string, category: StatusCategory): StatusDefinition[] {
    const schema = this.getSchema(orgId);
    if (!schema) return [];
    return schema.statuses.filter((s) => s.category === category);
  }

  getInitialStatus(orgId: string): StatusDefinition | null {
    const statuses = this.getStatusesByCategory(orgId, 'initial');
    return statuses[0] ?? null;
  }

  getWorkItemType(orgId: string, typeName: string): WorkItemTypeDefinition | null {
    const schema = this.getSchema(orgId);
    if (!schema) return null;
    return schema.workItemTypes.find((t) => t.name === typeName) ?? null;
  }

  validateChildType(orgId: string, parentType: string, childType: string): boolean {
    const parentDef = this.getWorkItemType(orgId, parentType);
    if (!parentDef) return true;
    return parentDef.allowedChildren.includes(childType);
  }

  saveSchema(orgId: string, schema: ProcessSchema): void {
    this.validateSchema(schema);
    this.schemaRepo.save(orgId, JSON.stringify(schema));
    this.schemaCache.set(orgId, schema);
    this.logger.info('Process schema saved', { orgId });
  }

  private validateSchema(schema: ProcessSchema): void {
    if (!schema.statuses || schema.statuses.length === 0) {
      throw new ValidationError('ProcessSchema must define at least one status');
    }
    const initialStatuses = schema.statuses.filter((s) => s.category === 'initial');
    if (initialStatuses.length === 0) {
      throw new ValidationError('ProcessSchema must have at least one initial status');
    }
    const terminalStatuses = schema.statuses.filter((s) => s.category === 'terminal');
    if (terminalStatuses.length === 0) {
      throw new ValidationError('ProcessSchema must have at least one terminal status');
    }

    const statusNames = new Set(schema.statuses.map((s) => s.name));
    for (const t of schema.transitions) {
      if (!statusNames.has(t.from)) {
        throw new ValidationError(`Transition references unknown status: ${t.from}`);
      }
      if (!statusNames.has(t.to)) {
        throw new ValidationError(`Transition references unknown status: ${t.to}`);
      }
    }
  }
}
