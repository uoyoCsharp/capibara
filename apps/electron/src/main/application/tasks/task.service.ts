import { injectable, inject } from 'tsyringe';
import type { ITaskRepository, CreateTaskInput } from '@main/core/interfaces/i-task.repository.js';
import type { IRoleRepository } from '@main/core/interfaces/i-role.repository.js';
import type { IPendingWakeRepository } from '@main/core/interfaces/i-pending-wake.repository.js';
import type { IDiscussionRepository } from '@main/core/interfaces/i-discussion.repository.js';
import type { IEventBus } from '@main/core/interfaces/i-event-bus.js';
import type { ILogger } from '@main/core/interfaces/i-logger.js';
import type { IWorkflowEngine } from '@main/core/interfaces/i-workflow-engine.js';
import type { TaskNode, TaskStatus } from '@main/core/types/domain.types.js';
import type { BehaviorAction, BehaviorContext } from '@main/core/types/behavior.types.js';
import {
  TASK_REPO_TOKEN,
  ROLE_REPO_TOKEN,
  PENDING_WAKE_REPO_TOKEN,
  DISCUSSION_REPO_TOKEN,
  EVENT_BUS_TOKEN,
  LOGGER_TOKEN,
} from '@main/core/tokens.js';
import { NotFoundError, ValidationError } from '@main/core/errors/capibara.errors.js';
import { InvalidTypeError } from '@main/core/errors/workflow.errors.js';
import { TaskStateMachine } from '../state-machine/task.state-machine.js';

@injectable()
export class TaskService {
  private workflowEngine!: IWorkflowEngine;

  constructor(
    @inject(TASK_REPO_TOKEN) private readonly taskRepo: ITaskRepository,
    @inject(ROLE_REPO_TOKEN) private readonly roleRepo: IRoleRepository,
    @inject(PENDING_WAKE_REPO_TOKEN) private readonly pendingWakeRepo: IPendingWakeRepository,
    @inject(DISCUSSION_REPO_TOKEN) private readonly discussionRepo: IDiscussionRepository,
    @inject(EVENT_BUS_TOKEN) private readonly eventBus: IEventBus,
    @inject(LOGGER_TOKEN) private readonly logger: ILogger,
    private readonly stateMachine: TaskStateMachine,
  ) {}

  setWorkflowEngine(engine: IWorkflowEngine): void {
    this.workflowEngine = engine;
  }

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

    // Calculate depth from parent and validate type hierarchy via WorkflowEngine
    let depth = 0;
    if (input.parentId) {
      const parent = await this.taskRepo.findById(input.parentId);
      if (!parent) {
        throw new NotFoundError('TaskNode (parent)', input.parentId);
      }
      depth = parent.depth + 1;

      const valid = await this.workflowEngine.validateType(input.orgId, input.type, parent.type);
      if (!valid) {
        const parentDef = await this.workflowEngine.getItemTypeDefinition(input.orgId, parent.type);
        const allowed = parentDef?.allowedChildren ?? [];
        throw new InvalidTypeError(
          input.type,
          `Cannot create under "${parent.type}". Allowed: ${allowed.length ? allowed.join(', ') : 'none (leaf node)'}`,
        );
      }
    } else {
      // Root-level task validation
      const valid = await this.workflowEngine.validateType(input.orgId, input.type, null);
      if (!valid) {
        const rootTypes = await this.workflowEngine.getRootTypes(input.orgId);
        throw new InvalidTypeError(
          input.type,
          `Root-level tasks must be of type: ${rootTypes.map((t) => t.name).join(', ')}`,
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

    // Evaluate on_task_created behavior rules
    const behaviorContext = await this.buildBehaviorContext(task);
    const behaviorActions = await this.workflowEngine.evaluateBehaviors(
      task.orgId,
      { type: 'on_task_created' },
      behaviorContext,
    );
    for (const action of behaviorActions) {
      try {
        await this.executeAction(action, task);
      } catch (err) {
        this.logger.error('on_task_created behavior action failed', { taskId: task.id, action: action.type, error: String(err) });
      }
      if (action.type === 'skip_propagation') break;
    }

    return task;
  }

  async updateStatus(taskId: string, status: TaskStatus): Promise<void> {
    await this.stateMachine.transition(taskId, status);

    const task = await this.taskRepo.findById(taskId);
    if (!task) return;

    // When task moves to a review-category status, determine review strategy
    if (await this.workflowEngine.isReviewStatus(task.orgId, status)) {
      const assigneeRole = task.assigneeRoleId
        ? await this.roleRepo.findById(task.assigneeRoleId)
        : null;

      if (assigneeRole?.requiresHumanApproval) {
        this.logger.info('Task requires human approval, skipping AI review', {
          taskId, roleId: assigneeRole.id,
        });
        return;
      }

      // Try parent AI review
      if (task.parentId) {
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
              taskNodeId: parentTask.id,
            },
          });
          return;
        }
      }

      // Fallback: no parent reviewer, no human approval — auto-approve via behavior rules
      if (assigneeRole) {
        this.logger.info('Auto-approving task (no parent reviewer, no human approval required)', {
          taskId, roleId: assigneeRole.id,
        });
        // Find the first terminal-bound transition from the current review status
        const transitions = await this.workflowEngine.getManualTransitions(task.orgId, status);
        const approveTransition = transitions[0];
        if (approveTransition) {
          await this.stateMachine.transition(taskId, approveTransition.to);
          status = approveTransition.to;
        }
      }
    }

    // Evaluate behavior rules for the new status
    await this.evaluateAndExecuteBehaviors(task, status, new Set<string>());
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

    // Clean up pending wakes for this specific task's assignee
    if (task.assigneeRoleId) {
      await this.pendingWakeRepo.consumeByRoleAndTask(task.assigneeRoleId, taskId);
    }

    // Cascade delete associated discussion group and its messages
    await this.discussionRepo.deleteGroupByTaskNodeId(taskId);

    await this.taskRepo.delete(taskId);
    this.logger.info('Task deleted', { taskId });
  }

  private async evaluateAndExecuteBehaviors(task: TaskNode, currentStatus: string, visitedStatuses?: Set<string>): Promise<void> {
    // Cycle protection: prevent infinite auto_transition loops
    const visited = visitedStatuses ?? new Set<string>();
    if (visited.has(currentStatus)) {
      this.logger.warn('Behavior cycle detected, breaking loop', { taskId: task.id, status: currentStatus });
      return;
    }
    visited.add(currentStatus);

    // Build behavior context
    const context = await this.buildBehaviorContext(task);

    // Evaluate on_status_enter trigger
    const actions = await this.workflowEngine.evaluateBehaviors(
      task.orgId,
      { type: 'on_status_enter', status: currentStatus },
      context,
    );

    for (const action of actions) {
      try {
        await this.executeAction(action, task);
      } catch (err) {
        this.logger.error('Behavior action failed', { taskId: task.id, action: action.type, error: String(err) });
      }
      if (action.type === 'skip_propagation') return;
    }

    // Check terminal status for parent propagation
    const isTerminal = await this.workflowEngine.isTerminalStatus(task.orgId, currentStatus);
    if (isTerminal && task.parentId) {
      await this.checkAutoPropagate(task, 0, visitedStatuses);
    }
  }

  private static readonly MAX_PROPAGATION_DEPTH = 20;

  private async checkAutoPropagate(task: TaskNode, depth = 0, visitedStatuses?: Set<string>): Promise<void> {
    if (!task.parentId) return;
    if (depth >= TaskService.MAX_PROPAGATION_DEPTH) {
      this.logger.warn('checkAutoPropagate depth limit reached', { taskId: task.id, depth });
      return;
    }

    const siblings = await this.taskRepo.findByParentId(task.parentId);
    const allTerminal = await Promise.all(
      siblings.map((s) => this.workflowEngine.isTerminalStatus(task.orgId, s.status)),
    );

    if (!allTerminal.every(Boolean)) return;

    const parentTask = await this.taskRepo.findById(task.parentId);
    if (!parentTask) return;

    // Build context for parent and evaluate on_all_children_terminal
    const parentContext = await this.buildBehaviorContext(parentTask);
    const actions = await this.workflowEngine.evaluateBehaviors(
      task.orgId,
      { type: 'on_all_children_terminal' },
      parentContext,
    );

    this.logger.info('All children terminal, evaluating parent behaviors', {
      parentId: parentTask.id,
      parentStatus: parentTask.status,
      actionCount: actions.length,
    });

    for (const action of actions) {
      await this.executeAction(action, parentTask);
      if (action.type === 'skip_propagation') return;
    }

    // If an auto_transition happened, recursively check grandparent
    const updatedParent = await this.taskRepo.findById(parentTask.id);
    if (updatedParent && updatedParent.parentId) {
      const parentIsTerminal = await this.workflowEngine.isTerminalStatus(
        updatedParent.orgId,
        updatedParent.status,
      );
      if (parentIsTerminal) {
        await this.checkAutoPropagate(updatedParent, depth + 1, visitedStatuses);
      }
    }
  }

  private async executeAction(action: BehaviorAction, task: TaskNode): Promise<void> {
    this.eventBus.emit({
      type: 'behavior:executed',
      timestamp: new Date().toISOString(),
      payload: { orgId: task.orgId, taskId: task.id, action: action.type },
    });

    switch (action.type) {
      case 'auto_transition':
        await this.stateMachine.transition(task.id, action.targetStatus);
        this.logger.info('Behavior auto-transition', {
          taskId: task.id,
          targetStatus: action.targetStatus,
        });
        break;

      case 'wake_assignee':
        if (task.assigneeRoleId) {
          this.eventBus.emit({
            type: 'wake:triggered',
            timestamp: new Date().toISOString(),
            payload: {
              roleId: task.assigneeRoleId,
              orgId: task.orgId,
              trigger: action.trigger,
              taskNodeId: task.id,
            },
          });
        }
        break;

      case 'wake_parent_assignee':
        if (task.parentId) {
          const parentTask = await this.taskRepo.findById(task.parentId);
          if (parentTask?.assigneeRoleId) {
            this.eventBus.emit({
              type: 'wake:triggered',
              timestamp: new Date().toISOString(),
              payload: {
                roleId: parentTask.assigneeRoleId,
                orgId: task.orgId,
                trigger: action.trigger,
                taskNodeId: task.id,
              },
            });
          }
        }
        break;

      case 'create_discussion_group':
        // Check if group already exists
        const existingGroup = await this.discussionRepo.findGroupByTaskNodeId(task.id);
        if (!existingGroup) {
          await this.discussionRepo.createGroup({
            taskNodeId: task.id,
            orgId: task.orgId,
          });
          this.logger.info('Discussion group created by behavior rule', { taskId: task.id });
        }
        break;

      case 'skip_propagation':
        this.logger.info('Skip propagation triggered', { taskId: task.id });
        break;
    }
  }

  private async buildBehaviorContext(task: TaskNode): Promise<BehaviorContext> {
    const children = await this.taskRepo.findByParentId(task.id);
    let parentTask: TaskNode | null = null;
    if (task.parentId) {
      parentTask = await this.taskRepo.findById(task.parentId);
    }

    return {
      taskId: task.id,
      orgId: task.orgId,
      taskType: task.type,
      taskStatus: task.status,
      parentTaskId: parentTask?.id ?? null,
      parentTaskType: parentTask?.type ?? null,
      parentTaskStatus: parentTask?.status ?? null,
      childCount: children.length,
      childTypes: children.map((c) => c.type),
      childStatuses: children.map((c) => c.status),
    };
  }
}
