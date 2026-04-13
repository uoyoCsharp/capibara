import { injectable, inject } from 'tsyringe';
import type { IRoleRepository } from '@main/core/interfaces/i-role.repository.js';
import type { ISkillRepository } from '@main/core/interfaces/i-skill.repository.js';
import type { ITaskRepository } from '@main/core/interfaces/i-task.repository.js';
import type { IConversationWorkflowRepository } from '@main/core/interfaces/i-conversation-workflow.repository.js';
import type { ILogger } from '@main/core/interfaces/i-logger.js';
import type { IWorkflowEngine } from '@main/core/interfaces/i-workflow-engine.js';
import type { IOrganizationRepository } from '@main/core/interfaces/i-organization.repository.js';
import type { IDiscussionRepository } from '@main/core/interfaces/i-discussion.repository.js';
import type { PlanningPromptContext } from '@main/core/interfaces/i-prompt-builder.js';
import type { PlanningRoleOption } from '@shared/contracts.js';
import type { Role, TaskNode } from '@main/core/types/domain.types.js';
import type { ExecutionEngine } from '../execution/execution.engine.js';
import type { TaskService } from '../tasks/task.service.js';
import {
  ROLE_REPO_TOKEN,
  SKILL_REPO_TOKEN,
  TASK_REPO_TOKEN,
  LOGGER_TOKEN,
} from '@main/core/tokens.js';
import { ValidationError } from '@main/core/errors/capibara.errors.js';
import { PLANNING_TASK_TYPE } from '@main/core/constants/planning.constants.js';

/** PM-related skill commands that identify a Planning Agent role. */
const PM_SKILL_COMMANDS = [
  '/bmad-create-prd',
  '/bmad-product-brief',
  '/bmad-create-epics-and-stories',
];

export interface StartPlanningResult {
  runId: string;
  taskId: string;
  roleId: string;
}

export interface ActivePlanningSession {
  taskId: string;
  taskTitle: string;
  roleId: string;
  roleName: string;
  discussionGroupId: string | null;
  workflowId: string | null;
  workflowState: string | null;
}

@injectable()
export class PlanningService {
  private executionEngine!: ExecutionEngine;
  private taskService!: TaskService;
  private workflowEngine!: IWorkflowEngine;
  private conversationWorkflowRepo: IConversationWorkflowRepository | null = null;
  private orgRepo: IOrganizationRepository | null = null;
  private discussionRepo: IDiscussionRepository | null = null;

  constructor(
    @inject(ROLE_REPO_TOKEN) private readonly roleRepo: IRoleRepository,
    @inject(SKILL_REPO_TOKEN) private readonly skillRepo: ISkillRepository,
    @inject(TASK_REPO_TOKEN) private readonly taskRepo: ITaskRepository,
    @inject(LOGGER_TOKEN) private readonly logger: ILogger,
  ) {}

  setExecutionEngine(engine: ExecutionEngine): void {
    this.executionEngine = engine;
  }

  setTaskService(service: TaskService): void {
    this.taskService = service;
  }

  setWorkflowEngine(engine: IWorkflowEngine): void {
    this.workflowEngine = engine;
  }

  setConversationWorkflowRepo(repo: IConversationWorkflowRepository): void {
    this.conversationWorkflowRepo = repo;
  }

  setOrgRepo(repo: IOrganizationRepository): void {
    this.orgRepo = repo;
  }

  setDiscussionRepo(repo: IDiscussionRepository): void {
    this.discussionRepo = repo;
  }

  /**
   * Select the best Planning Agent role from the organization.
   * Priority: role with PM-related skills > root role (parentId=null) > error.
   */
  async selectPlanningRole(orgId: string): Promise<Role> {
    const roles = await this.roleRepo.findByOrgId(orgId);
    if (roles.length === 0) {
      throw new ValidationError('Organization has no roles. At least one role is required for planning.');
    }

    // Check each role's skills for PM-related commands
    for (const role of roles) {
      if (role.status !== 'active') continue;
      if (role.skillIds.length === 0) continue;

      const skills = await Promise.all(
        role.skillIds.map((id) => this.skillRepo.findById(id)),
      );
      const hasPmSkill = skills.some(
        (s) => s && PM_SKILL_COMMANDS.includes(s.command),
      );
      if (hasPmSkill) {
        this.logger.info('Selected PM role for planning', { roleId: role.id, roleName: role.name });
        return role;
      }
    }

    // Fallback: root role (parentId = null)
    const rootRole = roles.find((r) => r.parentId === null && r.status === 'active');
    if (rootRole) {
      this.logger.info('No PM role found, falling back to root role for planning', {
        roleId: rootRole.id, roleName: rootRole.name,
      });
      return rootRole;
    }

    // Last resort: first active role
    const firstActive = roles.find((r) => r.status === 'active');
    if (firstActive) {
      this.logger.warn('No PM or root role found, using first active role for planning', {
        roleId: firstActive.id, roleName: firstActive.name,
      });
      return firstActive;
    }

    throw new ValidationError('No active roles found in organization.');
  }

  /**
   * Build planning-specific prompt context (org roles with their skill descriptions).
   */
  async buildPlanningContext(orgId: string): Promise<PlanningPromptContext> {
    const roles = await this.roleRepo.findByOrgId(orgId);
    const orgRoles: PlanningPromptContext['orgRoles'] = [];

    for (const role of roles) {
      if (role.status !== 'active') continue;

      const skillDescriptions: string[] = [];
      for (const skillId of role.skillIds) {
        const skill = await this.skillRepo.findById(skillId);
        if (skill) {
          skillDescriptions.push(skill.description || skill.name);
        }
      }

      orgRoles.push({
        id: role.id,
        name: role.name,
        skillDescriptions,
      });
    }

    return { orgRoles };
  }

  /**
   * Start a planning run: create a planning task, select the agent, and trigger execution.
   */
  async startPlanningRun(orgId: string, initialMessage: string, roleId?: string): Promise<StartPlanningResult> {
    // Prevent concurrent planning sessions for the same org
    const existing = await this.getActivePlanningSession(orgId);
    if (existing) {
      throw new ValidationError(`A planning session is already active for this organization (task: ${existing.taskId}).`);
    }

    // Use explicit roleId if provided, otherwise auto-select
    const role = roleId
      ? await this.roleRepo.findById(roleId).then((r) => {
          if (!r) throw new ValidationError(`Planning role not found: ${roleId}`);
          return r;
        })
      : await this.selectPlanningRole(orgId);

    // Create a planning task using the system-reserved 'plan' type
    const titlePreview = initialMessage.length > 50
      ? initialMessage.slice(0, 50) + '...'
      : initialMessage;
    const task = await this.taskService.create({
      orgId,
      parentId: null,
      type: PLANNING_TASK_TYPE,
      title: `Planning: ${titlePreview}`,
      description: `Planning session initiated by user.\n\nUser's initial message:\n${initialMessage}`,
      assigneeRoleId: role.id,
    });

    this.logger.info('Planning task created', { taskId: task.id, roleId: role.id, orgId });

    // Start the run
    const run = await this.executionEngine.startRun(
      role.id,
      task.id,
      orgId,
      'task_assigned',
    );

    return {
      runId: run.id,
      taskId: task.id,
      roleId: role.id,
    };
  }

  /**
   * Detect an active (incomplete) planning session for an organization.
   * Looks for planning tasks with active conversation workflows.
   */
  async getActivePlanningSession(orgId: string): Promise<ActivePlanningSession | null> {
    if (!this.conversationWorkflowRepo) return null;

    // Find planning tasks by type ('plan') or legacy title prefix ('Project Planning:')
    const tasks = await this.taskRepo.findByOrgId(orgId);
    const planningTasks = tasks.filter(
      (t) => (t.type === PLANNING_TASK_TYPE || t.title.startsWith('Project Planning:')) && t.parentId === null,
    );

    for (const task of planningTasks) {
      // Plan tasks use hardcoded 'done'; legacy epic tasks use schema-driven terminal check
      if (task.type === PLANNING_TASK_TYPE) {
        if (task.status === 'done') continue;
      } else {
        const isTerminal = await this.workflowEngine.isTerminalStatus(orgId, task.status);
        if (isTerminal) continue;
      }

      // Check for active conversation workflow
      if (task.assigneeRoleId) {
        const workflow = await this.conversationWorkflowRepo.findActiveByRoleAndTask(
          task.assigneeRoleId, task.id,
        );

        const role = await this.roleRepo.findById(task.assigneeRoleId);

        return {
          taskId: task.id,
          taskTitle: task.title,
          roleId: task.assigneeRoleId,
          roleName: role?.name ?? 'Unknown',
          discussionGroupId: workflow?.discussionGroupId ?? null,
          workflowId: workflow?.id ?? null,
          workflowState: workflow?.state ?? null,
        };
      }
    }

    return null;
  }

  /**
   * Discard an active planning session: cancel workflows and transition task to terminal.
   */
  async discardPlanningSession(taskId: string): Promise<void> {
    const task = await this.taskRepo.findById(taskId);
    if (!task) return;

    // Cancel any active conversation workflow
    if (task.assigneeRoleId && this.conversationWorkflowRepo) {
      try {
        const workflow = await this.conversationWorkflowRepo.findActiveByRoleAndTask(
          task.assigneeRoleId, task.id,
        );
        if (workflow) {
          await this.conversationWorkflowRepo.updateState(workflow.id, 'cancelled');
        }
      } catch (err) {
        this.logger.warn('Failed to cancel conversation workflow during planning discard', {
          taskId, error: String(err),
        });
      }
    }

    // Move plan task to terminal status.
    // Plan tasks use hardcoded 'done' status (bypasses schema validation).
    try {
      await this.taskService.updateStatus(taskId, 'done');
    } catch {
      // May fail if already terminal — best-effort
    }

    this.logger.info('Planning session discarded', { taskId });
  }

  /**
   * Get available planning roles for an organization.
   * Returns the system planning role (always present) and
   * the template-configured planning role (if any).
   */
  async getAvailablePlanningRoles(orgId: string): Promise<PlanningRoleOption[]> {
    const roles = await this.roleRepo.findByOrgId(orgId);
    const options: PlanningRoleOption[] = [];

    // System planning role (isSystemRole = true)
    const systemRole = roles.find((r) => r.isSystemRole && r.status === 'active');
    if (systemRole) {
      options.push({ roleId: systemRole.id, roleName: systemRole.name, source: 'system' });
    }

    // Template-configured planning role
    if (this.orgRepo) {
      const org = await this.orgRepo.findById(orgId);
      if (org?.planningRoleId) {
        const templateRole = roles.find((r) => r.id === org.planningRoleId && r.status === 'active');
        if (templateRole) {
          options.push({ roleId: templateRole.id, roleName: templateRole.name, source: 'template' });
        }
      }
    }

    // Fallback: if no roles found (e.g., old org without system role), use selectPlanningRole
    if (options.length === 0) {
      try {
        const fallback = await this.selectPlanningRole(orgId);
        options.push({ roleId: fallback.id, roleName: fallback.name, source: 'template' });
      } catch { /* no roles at all */ }
    }

    return options;
  }

  /**
   * Switch the planning role for an active planning session.
   * Only allowed when conversation workflow is in waiting_for_reply state.
   */
  async switchPlanningRole(taskId: string, newRoleId: string): Promise<{ previousRoleId: string; newRoleId: string }> {
    const task = await this.taskRepo.findById(taskId);
    if (!task) throw new ValidationError('Planning task not found');
    if (task.type !== PLANNING_TASK_TYPE) throw new ValidationError('Task is not a planning session');

    const previousRoleId = task.assigneeRoleId;
    if (!previousRoleId) throw new ValidationError('Planning task has no assignee');
    if (previousRoleId === newRoleId) return { previousRoleId, newRoleId };

    // Verify new role exists
    const newRole = await this.roleRepo.findById(newRoleId);
    if (!newRole) throw new ValidationError('Target role not found');

    // Verify conversation is in waiting_for_reply
    if (this.conversationWorkflowRepo && previousRoleId) {
      const workflow = await this.conversationWorkflowRepo.findActiveByRoleAndTask(previousRoleId, taskId);
      if (workflow && workflow.state !== 'waiting_for_reply') {
        throw new ValidationError('Can only switch roles when AI is waiting for your reply');
      }
    }

    // Update task assignee
    await this.taskRepo.updateAssignee(taskId, newRoleId);

    // Post system message to discussion group
    if (this.discussionRepo) {
      try {
        const group = await this.discussionRepo.findGroupByTaskNodeId(taskId);
        if (group) {
          await this.discussionRepo.postMessage({
            groupId: group.id,
            authorRoleId: null,
            authorType: 'system',
            content: `Planning role switched to ${newRole.name}`,
            voteTag: null,
          });
        }
      } catch (err) {
        this.logger.warn('Failed to post role switch system message', { taskId, error: String(err) });
      }
    }

    this.logger.info('Planning role switched', { taskId, from: previousRoleId, to: newRoleId });
    return { previousRoleId, newRoleId };
  }
}
