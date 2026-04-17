import { injectable } from 'tsyringe';
import type { ILogger } from '@core/foundation/interfaces/i-logger';
import type { IEventBus } from '@core/foundation/interfaces/i-event-bus';
import type { ProcessEngine } from './process.engine';
import type { BehaviorRule, BehaviorTrigger, BehaviorCondition, BehaviorAction } from '../types/workflow.types';

export interface BehaviorContext {
  orgId: string;
  taskId: string;
  taskType: string;
  taskStatus: string;
  assigneeRoleId: string | null;
  parentId: string | null;
  depth: number;
}

export interface BehaviorResult {
  ruleId: string;
  ruleName: string;
  action: BehaviorAction;
}

@injectable()
export class BehaviorEngine {
  constructor(
    private readonly processEngine: ProcessEngine,
    private readonly eventBus: IEventBus,
    private readonly logger: ILogger,
  ) {}

  evaluate(trigger: BehaviorTrigger, context: BehaviorContext): BehaviorResult[] {
    const schema = this.processEngine.getSchema(context.orgId);
    if (!schema) return [];

    const matchingRules = schema.behaviorRules
      .filter((rule) => rule.trigger === trigger)
      .sort((a, b) => a.priority - b.priority);

    const results: BehaviorResult[] = [];

    for (const rule of matchingRules) {
      if (this.evaluateCondition(rule.condition, context)) {
        results.push({
          ruleId: rule.id,
          ruleName: rule.name,
          action: rule.action,
        });
        this.logger.debug('Behavior rule matched', { ruleId: rule.id, ruleName: rule.name, trigger });
        this.eventBus.emit({
          type: 'behavior:executed',
          timestamp: new Date().toISOString(),
          payload: { ruleId: rule.id, ruleName: rule.name, trigger, orgId: context.orgId, taskId: context.taskId },
        });
      }
    }

    return results;
  }

  private evaluateCondition(condition: BehaviorCondition | null, context: BehaviorContext): boolean {
    if (!condition) return true;

    const fieldValue = this.resolveField(condition.field, context);

    switch (condition.operator) {
      case 'equals':
        return fieldValue === condition.value;
      case 'not_equals':
        return fieldValue !== condition.value;
      case 'in':
        return Array.isArray(condition.value) && (condition.value as unknown[]).includes(fieldValue);
      case 'not_in':
        return Array.isArray(condition.value) && !(condition.value as unknown[]).includes(fieldValue);
      default:
        return false;
    }
  }

  private resolveField(field: string, context: BehaviorContext): unknown {
    switch (field) {
      case 'taskType': return context.taskType;
      case 'taskStatus': return context.taskStatus;
      case 'assigneeRoleId': return context.assigneeRoleId;
      case 'depth': return context.depth;
      case 'parentId': return context.parentId;
      default: return undefined;
    }
  }
}
