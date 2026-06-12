import type { Task, BehaviorCondition } from '../types/workflow.types';

/**
 * Interface for BehaviorEngine — evaluates behavior rules on task status changes.
 * Cross-module callers depend on this interface; composition-root binds the concrete.
 */
export interface IBehaviorEngine {
  onStatusEnter(task: Task): void;
  onChildCompleted(childTask: Task): void;
  onDependencyResolved(completedTask: Task): void;
  evaluateCondition(condition: BehaviorCondition | null | undefined, context: Record<string, unknown>): boolean;
}
