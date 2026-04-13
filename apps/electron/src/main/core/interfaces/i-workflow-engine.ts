import type {
  WorkflowSchema,
  WorkItemTypeDefinition,
  StatusDefinition,
  TransitionDefinition,
  SchemaImpactReport,
} from '../types/workflow-schema.types.js';
import type { BehaviorTrigger, BehaviorAction, BehaviorContext } from '../types/behavior.types.js';

export interface IWorkflowEngine {
  // Type validation
  validateType(orgId: string, type: string, parentType: string | null): Promise<boolean>;
  getItemTypeDefinition(orgId: string, type: string): Promise<WorkItemTypeDefinition | null>;
  getAllItemTypes(orgId: string): Promise<WorkItemTypeDefinition[]>;
  getRootTypes(orgId: string): Promise<WorkItemTypeDefinition[]>;

  // Status & transition validation
  canTransition(orgId: string, from: string, to: string): Promise<boolean>;
  getManualTransitions(orgId: string, from: string): Promise<TransitionDefinition[]>;
  getAllStatuses(orgId: string): Promise<StatusDefinition[]>;
  getInitialStatus(orgId: string): Promise<string>;
  isTerminalStatus(orgId: string, status: string): Promise<boolean>;
  isReviewStatus(orgId: string, status: string): Promise<boolean>;
  isActiveStatus(orgId: string, status: string): Promise<boolean>;
  getFirstReviewStatus(orgId: string): Promise<string | null>;
  getFirstTerminalStatus(orgId: string): Promise<string | null>;
  /** Find a transition target from the given status that leads to a status of the specified category */
  findTransitionTargetByCategory(orgId: string, fromStatus: string, targetCategory: string): Promise<string | null>;

  // Behavior rule evaluation
  evaluateBehaviors(
    orgId: string,
    trigger: BehaviorTrigger,
    context: BehaviorContext,
  ): Promise<BehaviorAction[]>;

  // Schema CRUD
  getActiveSchema(orgId: string): Promise<WorkflowSchema>;
  saveSchema(orgId: string, schema: WorkflowSchema): Promise<SchemaImpactReport | null>;
  analyzeImpactReadOnly(orgId: string, schema: WorkflowSchema): Promise<SchemaImpactReport | null>;
  validateSchemaIntegrity(schema: WorkflowSchema): string[];

  // Cache management
  invalidateCache(orgId: string): void;
}
