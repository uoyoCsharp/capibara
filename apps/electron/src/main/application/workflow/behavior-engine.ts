import type { ILogger } from '@main/core/interfaces/i-logger.js';
import type { IWorkflowEngine } from '@main/core/interfaces/i-workflow-engine.js';
import type {
  WorkflowSchema,
  WorkItemTypeDefinition,
} from '@main/core/types/workflow-schema.types.js';
import type {
  BehaviorRule,
  BehaviorTrigger,
  BehaviorCondition,
  BehaviorAction,
  BehaviorContext,
} from '@main/core/types/behavior.types.js';

export class BehaviorEngine {
  constructor(
    private readonly workflowEngine: IWorkflowEngine,
    private readonly logger: ILogger,
  ) {}

  evaluate(
    schema: WorkflowSchema,
    trigger: BehaviorTrigger,
    context: BehaviorContext,
  ): BehaviorAction[] {
    // 1. Filter rules matching the trigger
    const matchingRules = schema.behaviorRules
      .filter((rule) => this.matchesTrigger(rule.trigger, trigger))
      .sort((a, b) => a.priority - b.priority);

    if (matchingRules.length === 0) return [];

    // 2. Evaluate conditions and collect actions, with short-circuit on skip_propagation
    const actions: BehaviorAction[] = [];

    for (const rule of matchingRules) {
      const typeDef = schema.workItemTypes.find((t) => t.name === context.taskType) ?? null;
      if (this.evaluateCondition(rule.condition, context, typeDef)) {
        actions.push(rule.action);
        this.logger.debug('Behavior rule fired', {
          ruleId: rule.id,
          ruleName: rule.name,
          taskId: context.taskId,
          action: rule.action.type,
        });

        if (rule.action.type === 'skip_propagation') {
          break;
        }
      }
    }

    return actions;
  }

  private matchesTrigger(ruleTrigger: BehaviorTrigger, eventTrigger: BehaviorTrigger): boolean {
    if (ruleTrigger.type !== eventTrigger.type) return false;

    switch (ruleTrigger.type) {
      case 'on_status_enter':
        return (
          eventTrigger.type === 'on_status_enter' && ruleTrigger.status === eventTrigger.status
        );
      case 'on_task_created':
        return eventTrigger.type === 'on_task_created';
      case 'on_all_children_terminal':
        return eventTrigger.type === 'on_all_children_terminal';
      case 'on_children_of_type_terminal': {
        if (eventTrigger.type !== 'on_children_of_type_terminal') return false;
        // Rule matches if the event's childTypes are a superset of the rule's
        return ruleTrigger.childTypes.every((ct) => eventTrigger.childTypes.includes(ct));
      }
      default:
        return false;
    }
  }

  private evaluateCondition(
    condition: BehaviorCondition,
    context: BehaviorContext,
    typeDef: WorkItemTypeDefinition | null,
  ): boolean {
    switch (condition.type) {
      case 'always':
        return true;

      case 'item_is_leaf':
        return typeDef?.isLeaf === true;

      case 'item_has_no_children':
        return context.childCount === 0;

      case 'item_type_in':
        return condition.types.includes(context.taskType);

      case 'item_in_status':
        return condition.statuses.includes(context.taskStatus);

      case 'parent_in_status':
        return context.parentTaskStatus !== null && condition.statuses.includes(context.parentTaskStatus);

      case 'and':
        return condition.conditions.every((c) => this.evaluateCondition(c, context, typeDef));

      case 'or':
        return condition.conditions.some((c) => this.evaluateCondition(c, context, typeDef));

      case 'not':
        return !this.evaluateCondition(condition.condition, context, typeDef);

      default:
        return false;
    }
  }
}
