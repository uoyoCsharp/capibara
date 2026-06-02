import type {
  ProcessSchema,
  StatusDefinition,
  StatusCategory,
  TransitionDefinition,
  WorkItemTypeDefinition,
} from '../types/workflow.types';

/**
 * Interface for ProcessEngine — schema-driven validation and lookup for task lifecycle.
 * Cross-module callers depend on this interface; composition-root binds the concrete.
 */
export interface IProcessEngine {
  getSchema(orgId: string): ProcessSchema | null;
  clearCache(orgId: string): void;
  validateType(orgId: string, typeName: string): boolean;
  validateStatus(orgId: string, statusName: string): boolean;
  validateTransition(orgId: string, from: string, to: string): boolean;
  getAvailableTransitions(orgId: string, fromStatus: string): TransitionDefinition[];
  getTransition(orgId: string, from: string, to: string): TransitionDefinition | null;
  getStatusDefinition(orgId: string, statusName: string): StatusDefinition | null;
  getStatusCategory(orgId: string, statusName: string): StatusCategory | null;
  getStatusesByCategory(orgId: string, category: StatusCategory): StatusDefinition[];
  getInitialStatus(orgId: string): StatusDefinition | null;
  getWorkItemType(orgId: string, typeName: string): WorkItemTypeDefinition | null;
  validateChildType(orgId: string, parentType: string, childType: string): boolean;
  saveSchema(orgId: string, schema: ProcessSchema): void;
}
