import { injectable, inject } from 'tsyringe';
import type { IWorkflowEngine } from '@main/core/interfaces/i-workflow-engine.js';
import type { IWorkflowSchemaRepository } from '@main/core/interfaces/i-workflow-schema.repository.js';
import type { IEventBus } from '@main/core/interfaces/i-event-bus.js';
import type { ILogger } from '@main/core/interfaces/i-logger.js';
import type {
  WorkflowSchema,
  WorkItemTypeDefinition,
  StatusDefinition,
  TransitionDefinition,
  SchemaImpactReport,
} from '@main/core/types/workflow-schema.types.js';
import type { BehaviorTrigger, BehaviorAction, BehaviorContext } from '@main/core/types/behavior.types.js';
import type { ITaskRepository } from '@main/core/interfaces/i-task.repository.js';
import { WORKFLOW_SCHEMA_REPO_TOKEN, EVENT_BUS_TOKEN, LOGGER_TOKEN, TASK_REPO_TOKEN } from '@main/core/tokens.js';
import { NotFoundError } from '@main/core/errors/capibara.errors.js';
import { SchemaValidationError } from '@main/core/errors/workflow.errors.js';
import { BehaviorEngine } from './behavior-engine.js';

@injectable()
export class WorkflowEngine implements IWorkflowEngine {
  private cache = new Map<string, WorkflowSchema>();
  private behaviorEngine: BehaviorEngine;
  private taskRepo: ITaskRepository | null = null;

  constructor(
    @inject(WORKFLOW_SCHEMA_REPO_TOKEN) private readonly schemaRepo: IWorkflowSchemaRepository,
    @inject(EVENT_BUS_TOKEN) private readonly eventBus: IEventBus,
    @inject(LOGGER_TOKEN) private readonly logger: ILogger,
  ) {
    this.behaviorEngine = new BehaviorEngine(this, logger);

    // Listen for schema:updated events to invalidate cache
    this.eventBus.on<{ orgId: string }>('schema:updated', (event) => {
      this.invalidateCache(event.payload.orgId);
    });
  }

  // ─── Cache Management ──────────────────────────────────────────────

  setTaskRepo(taskRepo: ITaskRepository): void {
    this.taskRepo = taskRepo;
  }

  invalidateCache(orgId: string): void {
    this.cache.delete(orgId);
    this.logger.debug('Schema cache invalidated', { orgId });
  }

  private async loadSchema(orgId: string): Promise<WorkflowSchema> {
    const cached = this.cache.get(orgId);
    if (cached) return cached;

    const schema = await this.schemaRepo.findActiveByOrgId(orgId);
    if (!schema) {
      throw new NotFoundError('WorkflowSchema', orgId);
    }

    this.cache.set(orgId, schema);
    return schema;
  }

  // ─── Type Validation ───────────────────────────────────────────────

  async validateType(orgId: string, type: string, parentType: string | null): Promise<boolean> {
    const schema = await this.loadSchema(orgId);
    const typeDef = schema.workItemTypes.find((t) => t.name === type);
    if (!typeDef) return false;

    if (parentType === null) {
      return typeDef.allowedAtRoot;
    }

    const parentDef = schema.workItemTypes.find((t) => t.name === parentType);
    if (!parentDef) return false;

    return parentDef.allowedChildren.includes(type);
  }

  async getItemTypeDefinition(orgId: string, type: string): Promise<WorkItemTypeDefinition | null> {
    const schema = await this.loadSchema(orgId);
    return schema.workItemTypes.find((t) => t.name === type) ?? null;
  }

  async getAllItemTypes(orgId: string): Promise<WorkItemTypeDefinition[]> {
    const schema = await this.loadSchema(orgId);
    return schema.workItemTypes;
  }

  async getRootTypes(orgId: string): Promise<WorkItemTypeDefinition[]> {
    const schema = await this.loadSchema(orgId);
    return schema.workItemTypes.filter((t) => t.allowedAtRoot);
  }

  // ─── Status & Transition Validation ────────────────────────────────

  async canTransition(orgId: string, from: string, to: string): Promise<boolean> {
    const schema = await this.loadSchema(orgId);
    return schema.transitions.some((t) => t.from === from && t.to === to);
  }

  async getManualTransitions(orgId: string, from: string): Promise<TransitionDefinition[]> {
    const schema = await this.loadSchema(orgId);
    return schema.transitions.filter((t) => t.from === from && t.trigger === 'manual');
  }

  async getAllStatuses(orgId: string): Promise<StatusDefinition[]> {
    const schema = await this.loadSchema(orgId);
    return schema.statuses;
  }

  async getInitialStatus(orgId: string): Promise<string> {
    const schema = await this.loadSchema(orgId);
    const initial = schema.statuses.find((s) => s.category === 'initial');
    if (!initial) {
      throw new SchemaValidationError(['No initial status defined in schema']);
    }
    return initial.name;
  }

  async isTerminalStatus(orgId: string, status: string): Promise<boolean> {
    const schema = await this.loadSchema(orgId);
    const def = schema.statuses.find((s) => s.name === status);
    return def?.category === 'terminal';
  }

  async isReviewStatus(orgId: string, status: string): Promise<boolean> {
    const schema = await this.loadSchema(orgId);
    const def = schema.statuses.find((s) => s.name === status);
    return def?.category === 'review';
  }

  async isActiveStatus(orgId: string, status: string): Promise<boolean> {
    const schema = await this.loadSchema(orgId);
    const def = schema.statuses.find((s) => s.name === status);
    return def?.category === 'active';
  }

  async getFirstReviewStatus(orgId: string): Promise<string | null> {
    const schema = await this.loadSchema(orgId);
    const reviewStatus = schema.statuses.find((s) => s.category === 'review');
    return reviewStatus?.name ?? null;
  }

  async findTransitionTargetByCategory(orgId: string, fromStatus: string, targetCategory: string): Promise<string | null> {
    const schema = await this.loadSchema(orgId);
    const categoryStatuses = new Set(
      schema.statuses.filter((s) => s.category === targetCategory).map((s) => s.name),
    );
    const transition = schema.transitions.find((t) => t.from === fromStatus && categoryStatuses.has(t.to));
    return transition?.to ?? null;
  }

  // ─── Behavior Rule Evaluation ──────────────────────────────────────

  async evaluateBehaviors(
    orgId: string,
    trigger: BehaviorTrigger,
    context: BehaviorContext,
  ): Promise<BehaviorAction[]> {
    const schema = await this.loadSchema(orgId);
    return this.behaviorEngine.evaluate(schema, trigger, context);
  }

  // ─── Schema CRUD ───────────────────────────────────────────────────

  async getActiveSchema(orgId: string): Promise<WorkflowSchema> {
    return this.loadSchema(orgId);
  }

  async saveSchema(orgId: string, schema: WorkflowSchema): Promise<SchemaImpactReport | null> {
    const violations = this.validateSchemaIntegrity(schema);
    if (violations.length > 0) {
      throw new SchemaValidationError(violations);
    }

    // Impact analysis: block save if active tasks would be orphaned
    let impactReport: SchemaImpactReport | null = null;
    if (this.taskRepo) {
      impactReport = await this.analyzeImpact(orgId, schema);
      if (impactReport && impactReport.affectedTaskCount > 0) {
        throw new SchemaValidationError([
          `Cannot save: ${impactReport.affectedTaskCount} active task(s) reference types/statuses not in the new schema. ` +
          `Affected: ${impactReport.details.map((d) => `${d.taskId} (type=${d.type}, status=${d.status})`).join(', ')}`,
        ]);
      }
    }

    await this.schemaRepo.save(orgId, schema);

    this.eventBus.emit({
      type: 'schema:updated',
      timestamp: new Date().toISOString(),
      payload: { orgId },
    });

    return impactReport;
  }

  /** Read-only impact analysis — does NOT save the schema. */
  async analyzeImpactReadOnly(orgId: string, schema: WorkflowSchema): Promise<SchemaImpactReport | null> {
    const violations = this.validateSchemaIntegrity(schema);
    if (violations.length > 0) {
      throw new SchemaValidationError(violations);
    }
    return this.analyzeImpact(orgId, schema);
  }

  private async analyzeImpact(orgId: string, schema: WorkflowSchema): Promise<SchemaImpactReport | null> {
    if (!this.taskRepo) return null;

    const typeNames = new Set(schema.workItemTypes.map((t) => t.name));
    const statusNames = new Set(schema.statuses.map((s) => s.name));
    const terminalStatuses = new Set(
      schema.statuses.filter((s) => s.category === 'terminal').map((s) => s.name),
    );

    const allTasks = await this.taskRepo.findByOrgId(orgId);
    const affected = allTasks.filter((task) => {
      if (terminalStatuses.has(task.status)) return false;
      return !typeNames.has(task.type) || !statusNames.has(task.status);
    });

    if (affected.length === 0) return null;

    return {
      affectedTaskCount: affected.length,
      details: affected.map((t) => ({ taskId: t.id, type: t.type, status: t.status })),
    };
  }

  // ─── Schema Validation ─────────────────────────────────────────────

  validateSchemaIntegrity(schema: WorkflowSchema): string[] {
    const violations: string[] = [];
    const typeNames = new Set(schema.workItemTypes.map((t) => t.name));
    const statusNames = new Set(schema.statuses.map((s) => s.name));

    // 1. Exactly one initial status
    const initialStatuses = schema.statuses.filter((s) => s.category === 'initial');
    if (initialStatuses.length === 0) {
      violations.push('Exactly one initial status required, found 0');
    } else if (initialStatuses.length > 1) {
      violations.push(`Exactly one initial status required, found ${initialStatuses.length}`);
    }

    // 2. At least one terminal status
    const terminalStatuses = schema.statuses.filter((s) => s.category === 'terminal');
    if (terminalStatuses.length === 0) {
      violations.push('At least one terminal status required');
    }

    // 3. allowedChildren reference existing types + isLeaf consistency
    for (const typeDef of schema.workItemTypes) {
      if (typeDef.isLeaf && typeDef.allowedChildren.length > 0) {
        violations.push(`Type '${typeDef.name}' is marked isLeaf but has allowedChildren`);
      }
      for (const child of typeDef.allowedChildren) {
        if (!typeNames.has(child)) {
          violations.push(`Type '${typeDef.name}' references unknown child type '${child}'`);
        }
      }
    }

    // 4. Transitions reference existing statuses
    for (const transition of schema.transitions) {
      if (!statusNames.has(transition.from)) {
        violations.push(`Transition references unknown source status '${transition.from}'`);
      }
      if (!statusNames.has(transition.to)) {
        violations.push(`Transition references unknown target status '${transition.to}'`);
      }
    }

    // 5. Behavior rules reference existing statuses/types
    for (const rule of schema.behaviorRules) {
      this.validateRuleReferences(rule.trigger, rule.condition, rule.action, typeNames, statusNames, violations, rule.name);
    }

    // 6. No orphan statuses (unreachable from initial)
    if (initialStatuses.length === 1 && schema.transitions.length > 0) {
      const reachable = new Set<string>();
      reachable.add(initialStatuses[0].name);
      let changed = true;
      while (changed) {
        changed = false;
        for (const t of schema.transitions) {
          if (reachable.has(t.from) && !reachable.has(t.to)) {
            reachable.add(t.to);
            changed = true;
          }
        }
      }
      for (const status of schema.statuses) {
        if (!reachable.has(status.name)) {
          violations.push(`Status '${status.name}' is unreachable from initial status`);
        }
      }
    }

    // 7. Hierarchy cycle detection
    this.detectHierarchyCycles(schema.workItemTypes, typeNames, violations);

    return violations;
  }

  private validateRuleReferences(
    trigger: BehaviorTrigger['type'] extends string ? BehaviorTrigger : never,
    condition: import('@main/core/types/behavior.types.js').BehaviorCondition,
    action: BehaviorAction,
    typeNames: Set<string>,
    statusNames: Set<string>,
    violations: string[],
    ruleName: string,
  ): void {
    // Validate trigger references
    if (trigger.type === 'on_status_enter' && !statusNames.has(trigger.status)) {
      violations.push(`Rule '${ruleName}' trigger references unknown status '${trigger.status}'`);
    }
    if (trigger.type === 'on_children_of_type_terminal') {
      for (const ct of trigger.childTypes) {
        if (!typeNames.has(ct)) {
          violations.push(`Rule '${ruleName}' trigger references unknown type '${ct}'`);
        }
      }
    }

    // Validate condition references
    this.validateConditionReferences(condition, typeNames, statusNames, violations, ruleName);

    // Validate action references
    if (action.type === 'auto_transition' && !statusNames.has(action.targetStatus)) {
      violations.push(`Rule '${ruleName}' action references unknown status '${action.targetStatus}'`);
    }
  }

  private validateConditionReferences(
    condition: import('@main/core/types/behavior.types.js').BehaviorCondition,
    typeNames: Set<string>,
    statusNames: Set<string>,
    violations: string[],
    ruleName: string,
  ): void {
    switch (condition.type) {
      case 'item_type_in':
        for (const t of condition.types) {
          if (!typeNames.has(t)) {
            violations.push(`Rule '${ruleName}' condition references unknown type '${t}'`);
          }
        }
        break;
      case 'item_in_status':
      case 'parent_in_status':
        for (const s of condition.statuses) {
          if (!statusNames.has(s)) {
            violations.push(`Rule '${ruleName}' condition references unknown status '${s}'`);
          }
        }
        break;
      case 'and':
      case 'or':
        for (const sub of condition.conditions) {
          this.validateConditionReferences(sub, typeNames, statusNames, violations, ruleName);
        }
        break;
      case 'not':
        this.validateConditionReferences(condition.condition, typeNames, statusNames, violations, ruleName);
        break;
    }
  }

  private detectHierarchyCycles(
    types: WorkItemTypeDefinition[],
    typeNames: Set<string>,
    violations: string[],
  ): void {
    const visited = new Set<string>();
    const inStack = new Set<string>();

    const dfs = (name: string): boolean => {
      if (inStack.has(name)) return true;
      if (visited.has(name)) return false;
      visited.add(name);
      inStack.add(name);

      const typeDef = types.find((t) => t.name === name);
      if (typeDef) {
        for (const child of typeDef.allowedChildren) {
          if (typeNames.has(child) && dfs(child)) {
            violations.push(`Hierarchy cycle detected involving type '${name}'`);
            return true;
          }
        }
      }

      inStack.delete(name);
      return false;
    };

    for (const t of types) {
      dfs(t.name);
    }
  }
}
