import { injectable, inject } from 'tsyringe';
import type { ITaskRepository, CreateTaskInput } from '@main/core/interfaces/i-task.repository.js';
import type { IRoleRepository } from '@main/core/interfaces/i-role.repository.js';
import type { IPendingWakeRepository } from '@main/core/interfaces/i-pending-wake.repository.js';
import type { IDiscussionRepository } from '@main/core/interfaces/i-discussion.repository.js';
import type { IEventBus } from '@main/core/interfaces/i-event-bus.js';
import type { ILogger } from '@main/core/interfaces/i-logger.js';
import type { TaskNode, TaskStatus, TaskType } from '@main/core/types/domain.types.js';
import {
  TASK_REPO_TOKEN,
  ROLE_REPO_TOKEN,
  PENDING_WAKE_REPO_TOKEN,
  DISCUSSION_REPO_TOKEN,
  EVENT_BUS_TOKEN,
  LOGGER_TOKEN,
} from '@main/core/tokens.js';
import { NotFoundError, ValidationError } from '@main/core/errors/capibara.errors.js';
import { TaskStateMachine } from '../state-machine/task.state-machine.js';

/**
 * Allowed child types per parent type.
 * - Root (null parent): only epic
 * - epic: story | spike
 * - story: task | bug | chore | spike
 * - task: subtask
 * - subtask: leaf (no children)
 * - spike: leaf (no children)
 * - bug: leaf (no children)
 * - chore: leaf (no children)
 */
const ALLOWED_CHILDREN: Record<TaskType | 'root', TaskType[]> = {
  root: ['epic'],
  epic: ['story', 'spike'],
  story: ['task', 'bug', 'chore', 'spike'],
  task: ['subtask'],
  subtask: [],
  spike: [],
  bug: [],
  chore: [],
};

@injectable()
export class TaskService {
  constructor(
    @inject(TASK_REPO_TOKEN) private readonly taskRepo: ITaskRepository,
    @inject(ROLE_REPO_TOKEN) private readonly roleRepo: IRoleRepository,
    @inject(PENDING_WAKE_REPO_TOKEN) private readonly pendingWakeRepo: IPendingWakeRepository,
    @inject(DISCUSSION_REPO_TOKEN) private readonly discussionRepo: IDiscussionRepository,
    @inject(EVENT_BUS_TOKEN) private readonly eventBus: IEventBus,
    @inject(LOGGER_TOKEN) private readonly logger: ILogger,
    private readonly stateMachine: TaskStateMachine,
  ) {}

  async findById(id: string): Promise<TaskNode | null> {
    return this.taskRepo.findById(id);
  }

  async findByOrgId(orgId: string): Promise<TaskNode[]> {
    return this.taskRepo.findByOrgId(orgId);
  }

  async findChildren(parentId: string): Promise<TaskNode[]> {
    return this.taskRepo.findByParentId(parentId);
  }

  async create(input: {
    orgId: string;
    parentId: string | null;
    type: TaskNode['type'];
    title: string;
    description: string;
    assigneeRoleId: string | null;
  }): Promise<TaskNode> {
    if (!input.title.trim()) {
      throw new ValidationError('Task title is required');
    }

    // Validate assignee exists
    if (input.assigneeRoleId) {
      const role = await this.roleRepo.findById(input.assigneeRoleId);
      if (!role) {
        throw new NotFoundError('Role', input.assigneeRoleId);
      }
    }

    // Calculate depth from parent and validate type hierarchy
    let depth = 0;
    if (input.parentId) {
      const parent = await this.taskRepo.findById(input.parentId);
      if (!parent) {
        throw new NotFoundError('TaskNode (parent)', input.parentId);
      }
      depth = parent.depth + 1;

      const allowed = ALLOWED_CHILDREN[parent.type];
      if (!allowed.includes(input.type)) {
        throw new ValidationError(
          `Cannot create "${input.type}" under "${parent.type}". Allowed: ${allowed.length ? allowed.join(', ') : 'none (leaf node)'}`,
        );
      }
    } else {
      // Root-level task must be epic
      const allowed = ALLOWED_CHILDREN.root;
      if (!allowed.includes(input.type)) {
        throw new ValidationError(
          `Root-level tasks must be of type: ${allowed.join(', ')}. Got "${input.type}"`,
        );
      }
    }

    const createInput: CreateTaskInput = {
      orgId: input.orgId,
      parentId: input.parentId,
      type: input.type,
      title: input.title,
      description: input.description,
      assigneeRoleId: input.assigneeRoleId,
      depth,
    };

    const task = await this.taskRepo.create(createInput);
    this.logger.info('Task created', { taskId: task.id, type: task.type, depth });

    this.eventBus.emit({
      type: 'task:created',
      timestamp: new Date().toISOString(),
      payload: { taskId: task.id, orgId: task.orgId, type: task.type, parentId: task.parentId },
    });

    return task;
  }

  async updateStatus(taskId: string, status: TaskStatus): Promise<void> {
    await this.stateMachine.transition(taskId, status);

    // When task moves to awaiting_review, determine review strategy:
    // 1. If task has a parent with an assignee → wake parent role as AI reviewer
    // 2. If no parent reviewer available and role doesn't require human approval → auto-approve
    // 3. Otherwise → stay in awaiting_review for human or consensus review
    if (status === 'awaiting_review') {
      const task = await this.taskRepo.findById(taskId);

      // requiresHumanApproval takes priority — skip AI review, wait for human
      const assigneeRole = task?.assigneeRoleId
        ? await this.roleRepo.findById(task.assigneeRoleId)
        : null;

      if (assigneeRole?.requiresHumanApproval) {
        this.logger.info('Task requires human approval, skipping AI review', {
          taskId, roleId: assigneeRole.id,
        });
        // Stay in awaiting_review for human decision via discussion/approval panel
        return;
      }

      // No human approval required — try parent AI review
      if (task?.parentId) {
        const parentTask = await this.taskRepo.findById(task.parentId);
        if (parentTask?.assigneeRoleId) {
          this.logger.info('Waking parent role for AI review', {
            taskId,
            parentTaskId: parentTask.id,
            reviewerRoleId: parentTask.assigneeRoleId,
          });
          this.eventBus.emit({
            type: 'wake:triggered',
            timestamp: new Date().toISOString(),
            payload: {
              roleId: parentTask.assigneeRoleId,
              orgId: task.orgId,
              trigger: 'review_requested' as const,
            },
          });
          return; // Leave in awaiting_review — reviewer AI will decide
        }
      }

      // Fallback: no parent reviewer available, no human approval — auto-approve
      if (assigneeRole) {
        this.logger.info('Auto-approving task (no parent reviewer, no human approval required)', {
          taskId, roleId: assigneeRole.id,
        });
        await this.stateMachine.transition(taskId, 'approved');
        status = 'approved';
      }
    }

    // When a decomposition task (epic/story) is approved but has no children yet,
    // this is Phase 1 approval — wake the assignee to execute Phase 2 (create children).
    if (status === 'approved') {
      const approvedTask = await this.taskRepo.findById(taskId);
      if (approvedTask) {
        if ((approvedTask.type === 'epic' || approvedTask.type === 'story')) {
          const children = await this.taskRepo.findByParentId(taskId);
          if (children.length === 0 && approvedTask.assigneeRoleId) {
            this.logger.info('Phase 1 approved, waking assignee for Phase 2 decomposition', {
              taskId, roleId: approvedTask.assigneeRoleId, type: approvedTask.type,
            });
            this.eventBus.emit({
              type: 'wake:triggered',
              timestamp: new Date().toISOString(),
              payload: {
                roleId: approvedTask.assigneeRoleId,
                orgId: approvedTask.orgId,
                trigger: 'review_approve' as const,
              },
            });
            return; // Don't auto-propagate — Phase 2 needs to run first
          }
        }

        // Bug 7 fix: auto-advance leaf tasks from approved → done
        // Leaf types cannot have children, so approved = done
        const leafTypes: TaskType[] = ['subtask', 'spike', 'bug', 'chore'];
        if (leafTypes.includes(approvedTask.type)) {
          await this.stateMachine.transition(taskId, 'done');
          status = 'done';
        } else if (approvedTask.type === 'task') {
          // 'task' can have subtasks — only auto-advance if no children
          const children = await this.taskRepo.findByParentId(taskId);
          if (children.length === 0) {
            await this.stateMachine.transition(taskId, 'done');
            status = 'done';
          }
        }
      }
    }

    // Check for auto-propagation when task reaches done
    if (status === 'done') {
      await this.checkAutoPropagate(taskId);
    }
  }

  async delete(taskId: string): Promise<void> {
    const task = await this.taskRepo.findById(taskId);
    if (!task) {
      throw new NotFoundError('TaskNode', taskId);
    }

    // Delete children first (recursive)
    const children = await this.taskRepo.findByParentId(taskId);
    for (const child of children) {
      await this.delete(child.id);
    }

    // Bug 13 fix: clean up pending wakes for this specific task's assignee
    if (task.assigneeRoleId) {
      await this.pendingWakeRepo.consumeByRoleAndTask(task.assigneeRoleId, taskId);
    }

    // D1: cascade delete associated discussion group and its messages
    await this.discussionRepo.deleteGroupByTaskNodeId(taskId);

    await this.taskRepo.delete(taskId);
    this.logger.info('Task deleted', { taskId });
  }

  private async checkAutoPropagate(taskId: string): Promise<void> {
    const task = await this.taskRepo.findById(taskId);
    if (!task || !task.parentId) return;

    const siblings = await this.taskRepo.findByParentId(task.parentId);

    // Bug 7 fix: only trust done/cancelled as truly complete.
    // Since leaf tasks now auto-advance approved→done, we no longer need to check
    // approved status with children depth. This eliminates the multi-layer check issue.
    const allComplete = siblings.every(
      (s) => s.status === 'done' || s.status === 'cancelled',
    );

    if (!allComplete) return;

    const parentTask = await this.taskRepo.findById(task.parentId);
    if (!parentTask) return;

    this.logger.info('All children complete, advancing parent task', {
      parentId: task.parentId,
      parentStatus: parentTask.status,
    });

    if (parentTask.status === 'approved') {
      // Parent was already approved (decomposition reviewed) → advance to done
      await this.stateMachine.transition(parentTask.id, 'done');
      this.logger.info('Parent task advanced to done', { parentId: parentTask.id });
      // Recursively check if grandparent should also advance
      await this.checkAutoPropagate(parentTask.id);
    } else if (parentTask.status === 'in_progress') {
      // Parent is still in_progress → advance to awaiting_review
      await this.updateStatus(parentTask.id, 'awaiting_review');
    }
  }
}
