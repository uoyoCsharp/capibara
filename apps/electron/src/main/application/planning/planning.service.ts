import { injectable, inject } from 'tsyringe';
import type { IRoleRepository } from '@main/core/interfaces/i-role.repository.js';
import type { ISkillRepository } from '@main/core/interfaces/i-skill.repository.js';
import type { ITaskRepository } from '@main/core/interfaces/i-task.repository.js';
import type { IOrganizationRepository } from '@main/core/interfaces/i-organization.repository.js';
import type { ILogger } from '@main/core/interfaces/i-logger.js';
import type { IWorkflowEngine } from '@main/core/interfaces/i-workflow-engine.js';
import type { PlanningPromptContext } from '@main/core/interfaces/i-prompt-builder.js';
import type { PlanningRoleOption } from '@shared/contracts.js';
import type { SessionService } from '../session/session.service.js';
import type { SessionRunCoordinator } from '../session/session-run.coordinator.js';
import {
  ROLE_REPO_TOKEN,
  SKILL_REPO_TOKEN,
  TASK_REPO_TOKEN,
  ORGANIZATION_REPO_TOKEN,
  LOGGER_TOKEN,
  SESSION_SERVICE_TOKEN,
  SESSION_RUN_COORDINATOR_TOKEN,
} from '@main/core/tokens.js';
import { ValidationError } from '@main/core/errors/capibara.errors.js';
import { PLANNING_TASK_TYPE } from '@main/core/constants/planning.constants.js';

export interface StartPlanningResult {
  sessionId: string;
  roleId: string;
}

export interface ActivePlanningSession {
  /** Session-based planning uses sessionId; legacy task-based uses taskId */
  sessionId: string | null;
  taskId: string | null;
  roleId: string;
  roleName: string;
}

@injectable()
export class PlanningService {
  /** Legacy support — set only for backward compat with task-based planning detection */
  private workflowEngine!: IWorkflowEngine;

  constructor(
    @inject(ROLE_REPO_TOKEN) private readonly roleRepo: IRoleRepository,
    @inject(SKILL_REPO_TOKEN) private readonly skillRepo: ISkillRepository,
    @inject(TASK_REPO_TOKEN) private readonly taskRepo: ITaskRepository,
    @inject(ORGANIZATION_REPO_TOKEN) private readonly orgRepo: IOrganizationRepository,
    @inject(LOGGER_TOKEN) private readonly logger: ILogger,
    @inject(SESSION_SERVICE_TOKEN) private readonly sessionService: SessionService,
    @inject(SESSION_RUN_COORDINATOR_TOKEN) private readonly sessionRunCoordinator: SessionRunCoordinator,
  ) {}

  /** Retained for legacy task-based planning session detection */
  setWorkflowEngine(engine: IWorkflowEngine): void {
    this.workflowEngine = engine;
  }

  /**
   * Find the system planning role for the organization.
   * Planning always uses the system role (isSystemRole=true).
   */
  private async getSystemPlanningRole(orgId: string): Promise<{ id: string; name: string }> {
    const roles = await this.roleRepo.findByOrgId(orgId);
    const systemRole = roles.find((r) => r.isSystemRole && r.status === 'active');
    if (systemRole) return systemRole;
    throw new ValidationError('No system planning role found. Organization may need to be re-initialized.');
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
   * Start a planning session: create a Session using the system planning role,
   * and trigger first execution. No Task or ConversationWorkflow is created.
   */
  async startPlanningRun(orgId: string, initialMessage: string, roleId?: string): Promise<StartPlanningResult> {
    // Prevent concurrent planning sessions for the same org
    const existing = await this.getActivePlanningSession(orgId);
    if (existing) {
      const ref = existing.sessionId ?? existing.taskId ?? 'unknown';
      throw new ValidationError(`A planning session is already active for this organization (${ref}).`);
    }

    // Use explicit roleId if provided, otherwise use the system planning role
    const resolvedRoleId = roleId
      ?? (await this.getSystemPlanningRole(orgId)).id;

    if (roleId) {
      const role = await this.roleRepo.findById(roleId);
      if (!role) throw new ValidationError(`Planning role not found: ${roleId}`);
    }

    // Create session + store initial message
    const session = await this.sessionService.startSession(orgId, 'planning', resolvedRoleId, initialMessage);

    this.logger.info('Planning session created', { sessionId: session.id, roleId: resolvedRoleId, orgId });

    // Fire first execution in background (skip user message — already stored by startSession)
    this.sessionRunCoordinator.executeInSession(session.id, initialMessage, true).catch((err) => {
      this.logger.error('Planning session first execution failed', { sessionId: session.id, error: String(err) });
    });

    return {
      sessionId: session.id,
      roleId: resolvedRoleId,
    };
  }

  /**
   * Detect an active planning session for an organization.
   * Checks session-based first, then falls back to legacy task-based detection.
   */
  async getActivePlanningSession(orgId: string): Promise<ActivePlanningSession | null> {
    // 1. Check for active session-based planning
    const session = await this.sessionService.getActiveSession(orgId, 'planning');
    if (session) {
      const role = await this.roleRepo.findById(session.roleId);
      return {
        sessionId: session.id,
        taskId: null,
        roleId: session.roleId,
        roleName: role?.name ?? 'Unknown',
      };
    }

    // 2. Legacy fallback: check for task-based planning sessions
    const tasks = await this.taskRepo.findByOrgId(orgId);
    const planningTasks = tasks.filter(
      (t) => (t.type === PLANNING_TASK_TYPE || t.title.startsWith('Project Planning:')) && t.parentId === null,
    );

    for (const task of planningTasks) {
      if (task.type === PLANNING_TASK_TYPE) {
        if (task.status === 'done') continue;
      } else if (this.workflowEngine) {
        const isTerminal = await this.workflowEngine.isTerminalStatus(orgId, task.status);
        if (isTerminal) continue;
      }

      if (task.assigneeRoleId) {
        const role = await this.roleRepo.findById(task.assigneeRoleId);
        return {
          sessionId: null,
          taskId: task.id,
          roleId: task.assigneeRoleId,
          roleName: role?.name ?? 'Unknown',
        };
      }
    }

    return null;
  }

  /**
   * Discard an active planning session.
   * Handles both session-based and legacy task-based sessions.
   */
  async discardPlanningSession(sessionOrTaskId: string): Promise<void> {
    // Try session-based cancel first
    const session = await this.sessionService.getSession(sessionOrTaskId);
    if (session) {
      await this.sessionService.cancelSession(sessionOrTaskId);
      this.logger.info('Planning session discarded (session-based)', { sessionId: sessionOrTaskId });
      return;
    }

    // Legacy fallback: task-based discard
    const task = await this.taskRepo.findById(sessionOrTaskId);
    if (!task) return;

    // Move plan task to terminal status
    try {
      await this.taskRepo.updateStatus(sessionOrTaskId, 'done');
    } catch {
      // May fail if already terminal — best-effort
    }

    this.logger.info('Planning session discarded (legacy task-based)', { taskId: sessionOrTaskId });
  }

  /**
   * Get available planning roles for an organization.
   * Returns the system role plus any template-configured planning role.
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
    const org = await this.orgRepo.findById(orgId);
    if (org?.planningRoleId) {
      const templateRole = roles.find((r) => r.id === org.planningRoleId && r.status === 'active');
      if (templateRole) {
        options.push({ roleId: templateRole.id, roleName: templateRole.name, source: 'template' });
      }
    }

    return options;
  }

  /**
   * Switch the planning role for an active session.
   */
  async switchPlanningRole(sessionId: string, newRoleId: string): Promise<{ previousRoleId: string; newRoleId: string }> {
    const session = await this.sessionService.getSession(sessionId);
    if (!session) throw new ValidationError('Planning session not found');
    if (session.status !== 'active') throw new ValidationError('Planning session is not active');

    const previousRoleId = session.roleId;
    if (previousRoleId === newRoleId) return { previousRoleId, newRoleId };

    // Verify new role exists
    const newRole = await this.roleRepo.findById(newRoleId);
    if (!newRole) throw new ValidationError('Target role not found');

    await this.sessionService.switchRole(sessionId, newRoleId);

    this.logger.info('Planning role switched', { sessionId, from: previousRoleId, to: newRoleId });
    return { previousRoleId, newRoleId };
  }
}
