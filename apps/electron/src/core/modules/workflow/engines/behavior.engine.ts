import { injectable } from 'tsyringe';
import type { IBehaviorEngine } from '../interfaces/i-behavior.engine';
import type { ILogger } from '@core/foundation/interfaces/i-logger';
import type { ITaskRepository } from '../interfaces/i-task.repository';
import type { IProcessEngine } from '../interfaces/i-process.engine';
import type { ITaskStateMachine } from '../interfaces/i-task.state-machine';
import type {
  Task,
  BehaviorTrigger,
  BehaviorCondition,
  BehaviorAction,
  FieldCondition,
  ProcessSchema,
} from '../types/workflow.types';

@injectable()
export class BehaviorEngine implements IBehaviorEngine {
  private evaluating = new Set<string>();

  constructor(
    private readonly taskRepo: ITaskRepository,
    private readonly processEngine: IProcessEngine,
    private readonly taskStateMachine: ITaskStateMachine,
    private readonly logger: ILogger,
  ) {}

  onStatusEnter(task: Task): void {
    this.evaluateAndExecute('on_status_enter', task);
  }

  onChildCompleted(childTask: Task): void {
    if (!childTask.parentId) return;

    const siblings = this.taskRepo.findChildren(childTask.parentId);
    const allTerminal = siblings.every(
      (s) => this.processEngine.getStatusCategory(s.orgId, s.status) === 'terminal',
    );

    if (!allTerminal) return;

    const parent = this.taskRepo.findById(childTask.parentId);
    if (!parent) return;

    this.evaluateAndExecute('on_all_children_terminal', parent);
  }

  private evaluateAndExecute(trigger: BehaviorTrigger, task: Task): void {
    const key = `${task.id}:${trigger}`;
    if (this.evaluating.has(key)) return;
    this.evaluating.add(key);

    try {
      const schema = this.processEngine.getSchema(task.orgId);
      if (!schema) return;

      const context = this.buildContext(task, schema);
      const rules = (schema.behaviorRules ?? [])
        .filter((r) => r.trigger === trigger)
        .sort((a, b) => a.priority - b.priority);

      for (const rule of rules) {
        if (this.evaluateCondition(rule.condition, context)) {
          this.logger.info('Behavior rule matched', { ruleId: rule.id, taskId: task.id, trigger });
          try {
            this.executeAction(rule.action, task);
          } catch (error) {
            this.logger.warn('Behavior rule action failed', {
              ruleId: rule.id,
              taskId: task.id,
              trigger,
              error: error instanceof Error ? error.message : String(error),
            });
          }
        }
      }
    } finally {
      this.evaluating.delete(key);
    }
  }

  private buildContext(task: Task, schema: ProcessSchema): Record<string, unknown> {
    const statusDef = schema.statuses.find((s) => s.name === task.status);
    const typeDef = schema.workItemTypes.find((t) => t.name === task.type);
    const children = this.taskRepo.findChildren(task.id);

    return {
      'task.type': task.type,
      'task.status': task.status,
      'task.depth': task.depth,
      'task.hasChildren': children.length > 0,
      'task.hasAssignee': task.assigneeRoleId !== null,
      'status.category': statusDef?.category ?? null,
      'type.isLeaf': typeDef?.isLeaf ?? false,
      'type.canDecompose': typeDef?.canDecompose ?? false,
    };
  }

  evaluateCondition(
    condition: BehaviorCondition | null | undefined,
    context: Record<string, unknown>,
  ): boolean {
    if (condition == null) return true;

    if ('all' in condition) {
      return (condition.all as BehaviorCondition[]).every((c) =>
        this.evaluateCondition(c, context),
      );
    }

    if ('any' in condition) {
      return (condition.any as BehaviorCondition[]).some((c) =>
        this.evaluateCondition(c, context),
      );
    }

    if ('not' in condition) {
      return !this.evaluateCondition((condition as { not: BehaviorCondition }).not, context);
    }

    const { field, op, value } = condition as FieldCondition;
    const actual = context[field];

    if (actual === undefined) return false;

    switch (op) {
      case 'eq':
        return actual === value;
      case 'neq':
        return actual !== value;
      case 'in':
        return Array.isArray(value) && (value as unknown[]).includes(actual);
      case 'not_in':
        return Array.isArray(value) && !(value as unknown[]).includes(actual);
      case 'gt':
        return typeof actual === 'number' && typeof value === 'number' && actual > value;
      case 'lt':
        return typeof actual === 'number' && typeof value === 'number' && actual < value;
      default:
        return false;
    }
  }

  private executeAction(action: BehaviorAction, task: Task): void {
    switch (action.type) {
      case 'transition': {
        const targetStatus = action.params?.targetStatus as string;
        if (!targetStatus) {
          this.logger.warn('Behavior action missing targetStatus', { taskId: task.id });
          return;
        }
        this.taskStateMachine.transition(task.id, targetStatus);
        break;
      }
      default:
        this.logger.warn('Unknown behavior action type', {
          type: action.type,
          taskId: task.id,
        });
    }
  }
}
