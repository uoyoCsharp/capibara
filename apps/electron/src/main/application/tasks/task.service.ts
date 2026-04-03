import { injectable, inject } from 'tsyringe';
import type { ITaskRepository, CreateTaskInput } from '@main/core/interfaces/i-task.repository.js';
import type { IRoleRepository } from '@main/core/interfaces/i-role.repository.js';
import type { IEventBus } from '@main/core/interfaces/i-event-bus.js';
import type { ILogger } from '@main/core/interfaces/i-logger.js';
import type { TaskNode, TaskStatus, TaskType } from '@main/core/types/domain.types.js';
import {
  TASK_REPO_TOKEN,
  ROLE_REPO_TOKEN,
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
      if (task?.parentId) {
        const parentTask = await this.taskRepo.findById(task.parentId);
        if (parentTask?.assigneeRoleId) {
          // Wake the parent role to review this child task
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

      // Fallback: no parent reviewer available — use original auto-approve logic
      if (task?.assigneeRoleId) {
        const role = await this.roleRepo.findById(task.assigneeRoleId);
        if (role && !role.requiresHumanApproval) {
          this.logger.info('Auto-approving task (no parent reviewer, role does not require human approval)', {
            taskId,
            roleId: role.id,
          });
          await this.stateMachine.transition(taskId, 'approved');
          status = 'approved';
        }
      }
    }

    // When a decomposition task (epic/story) is approved but has no children yet,
    // this is Phase 1 approval — wake the assignee to execute Phase 2 (create children).
    if (status === 'approved') {
      const approvedTask = await this.taskRepo.findById(taskId);
      if (approvedTask && (approvedTask.type === 'epic' || approvedTask.type === 'story')) {
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
    }

    // Check for auto-propagation when task reaches done/approved
    if (status === 'done' || status === 'approved') {
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

    await this.taskRepo.delete(taskId);
    this.logger.info('Task deleted', { taskId });
  }

  private async checkAutoPropagate(taskId: string): Promise<void> {
    const task = await this.taskRepo.findById(taskId);
    if (!task || !task.parentId) return;

    const siblings = await this.taskRepo.findByParentId(task.parentId);

    // Check if all siblings are truly complete.
    // An "approved" task with unfinished children (decomposition task) is NOT complete —
    // it only means the decomposition plan was approved, children still need to execute.
    let allComplete = true;
    for (const s of siblings) {
      if (s.status === 'done' || s.status === 'cancelled') continue;
      if (s.status === 'approved') {
        const children = await this.taskRepo.findByParentId(s.id);
        if (children.length > 0) {
          const childrenDone = children.every(
            (c) => c.status === 'done' || c.status === 'approved' || c.status === 'cancelled',
          );
          if (!childrenDone) {
            allComplete = false;
            break;
          }
        }
        continue;
      }
      allComplete = false;
      break;
    }

    if (!allComplete) return;

    const parentTask = await this.taskRepo.findById(task.parentId);
    if (!parentTask) return;

    this.logger.info('All children complete, advancing parent task', {
      parentId: task.parentId,
      parentStatus: parentTask.status,
    });

    // Directly advance parent task status instead of waking the assignee role.
    // This avoids wasting a Run for decomposition tasks that just need status progression.
    if (parentTask.status === 'approved') {
      // Parent was already approved (decomposition reviewed) → advance to done
      await this.stateMachine.transition(parentTask.id, 'done');
      this.logger.info('Parent task advanced to done', { parentId: parentTask.id });
      // Recursively check if grandparent should also advance
      await this.checkAutoPropagate(parentTask.id);
    } else if (parentTask.status === 'in_progress') {
      // Parent is still in_progress (e.g., requiresHumanApproval=false decomposition
      // that was auto-approved, children are now done) → advance to awaiting_review
      await this.updateStatus(parentTask.id, 'awaiting_review');
    }
    // If parent is in awaiting_review or other states, don't advance — it's in a review flow
  }
}
