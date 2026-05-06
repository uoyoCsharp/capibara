import { injectable } from 'tsyringe';
import type { ILogger } from '@core/foundation/interfaces/i-logger';
import type { ITaskRepository } from '@core/modules/workflow/interfaces/i-task.repository';
import type { ProcessEngine } from '@core/modules/workflow/engines/process.engine';
import type { Task } from '@core/modules/workflow/types/workflow.types';
import type { WakeReason } from '@core/modules/execution/types/execution.types';

export interface ScheduleResult {
  task: Task;
  wakeReason: WakeReason;
}

@injectable()
export class TaskScheduler {
  constructor(
    private readonly taskRepo: ITaskRepository,
    private readonly processEngine: ProcessEngine,
    private readonly logger: ILogger,
  ) {}

  findNextTask(orgId: string): ScheduleResult | null {
    const roots = this.taskRepo
      .findByOrgId(orgId)
      .filter((t) => t.parentId === null)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));

    for (const root of roots) {
      const result = this.findInSubtree(root, 0);
      if (result) return result;
    }
    return null;
  }

  private findInSubtree(task: Task, depth: number): ScheduleResult | null {
    if (depth > 10) {
      this.logger.warn('TaskScheduler depth limit exceeded', { taskId: task.id, depth });
      return null;
    }

    // A task is a "container" only if it has actually grown children. The
    // schema flag `typeDef.isLeaf=false` does NOT mean "always descend" — a
    // non-leaf with no children yet is an as-yet-undecomposed node waiting
    // to be dispatched so the assignee role can plan it. The prompt layer
    // picks the correct scenario (preview/eager/propose decomposition) from
    // task.planningMode + isDecomposable — see scenario.ts.
    if (this.taskRepo.hasChildren(task.id)) {
      return this.findInChildren(task.id, depth);
    }

    // No children: task is the frontier. Dispatch it if initial+assignable.
    const category = this.processEngine.getStatusCategory(task.orgId, task.status);
    if (category !== 'initial') return null;

    if (!task.assigneeRoleId) {
      this.logger.warn('Task blocked: no assigneeRoleId', { taskId: task.id });
      return null;
    }

    return { task, wakeReason: 'task_scheduled' };
  }

  private findInChildren(parentId: string, depth: number): ScheduleResult | null {
    const children = this.taskRepo
      .findChildren(parentId)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));

    for (const child of children) {
      const result = this.findInSubtree(child, depth + 1);
      if (result) return result;
    }
    return null;
  }
}
