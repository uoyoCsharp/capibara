import type { Task, TaskStatus } from '../types/workflow.types';
import type { IBehaviorEngine } from './i-behavior.engine';

/**
 * Interface for TaskStateMachine — governs task status transitions.
 * Cross-module callers depend on this interface; composition-root binds the concrete.
 */
export interface ITaskStateMachine {
  setBehaviorEngine(engine: IBehaviorEngine): void;
  transition(taskId: string, newStatus: TaskStatus, opts?: { triggeredBy?: 'user' | 'system' }): Task;
  confirmApproval(taskId: string, nextStatus: TaskStatus): Task;
  rejectApproval(taskId: string, revertStatus: TaskStatus): Task;
}
