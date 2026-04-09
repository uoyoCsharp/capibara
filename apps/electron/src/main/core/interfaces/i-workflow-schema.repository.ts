import type { WorkflowSchema } from '../types/workflow-schema.types.js';

export interface IWorkflowSchemaRepository {
  findActiveByOrgId(orgId: string): Promise<WorkflowSchema | null>;
  save(orgId: string, schema: WorkflowSchema): Promise<void>;
  delete(id: string): Promise<void>;
}
