import type { ProcessSchemaRecord } from '../types/workflow.types';

export interface IProcessSchemaRepository {
  findActiveByOrgId(orgId: string): ProcessSchemaRecord | null;
  findById(id: string): ProcessSchemaRecord | null;
  save(orgId: string, schemaJson: string): ProcessSchemaRecord;
  deactivate(id: string): void;
}
