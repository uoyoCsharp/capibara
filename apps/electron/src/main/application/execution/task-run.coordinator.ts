import { injectable, inject } from 'tsyringe';
import type { IRunEngine, RunResult } from '@main/core/interfaces/i-run-engine.js';
import type { IRoleRepository } from '@main/core/interfaces/i-role.repository.js';
import type { ITaskRepository } from '@main/core/interfaces/i-task.repository.js';
import type { IConversationWorkflowRepository } from '@main/core/interfaces/i-conversation-workflow.repository.js';
import type { IEventBus } from '@main/core/interfaces/i-event-bus.js';
import type { ILogger } from '@main/core/interfaces/i-logger.js';
import type { IPromptBuilder, PlanningPromptContext } from '@main/core/interfaces/i-prompt-builder.js';
import type { IWorkflowEngine } from '@main/core/interfaces/i-workflow-engine.js';
import type { ISettingsRepository } from '@main/core/interfaces/i-settings.repository.js';
import type { IOrganizationRepository } from '@main/core/interfaces/i-organization.repository.js';
import type { IRunRepository } from '@main/core/interfaces/i-run.repository.js';
import type { Run, WakeTrigger } from '@main/core/types/domain.types.js';
import type { TaskStateMachine } from '../state-machine/task.state-machine.js';
import type { TaskService } from '../tasks/task.service.js';
import type { ExecutionContext } from '../context/execution.context.js';
import {
  LOGGER_TOKEN,
  EVENT_BUS_TOKEN,
  ROLE_REPO_TOKEN,
  TASK_REPO_TOKEN,
  RUN_REPO_TOKEN,
  ORGANIZATION_REPO_TOKEN,
  PROMPT_BUILDER_TOKEN,
  RUN_ENGINE_TOKEN,
  SETTINGS_REPO_TOKEN,
} from '@main/core/tokens.js';

/**
 * Orchestrates AI runs within a Task context. Handles all the pre/post-run
 * logic that was previously in ExecutionEngine.executeRun():
 * - Task state transitions
 * - Conversation workflow resume
 * - Session resume for discussion_reply
 * - Post-run Phase 1 advancement to review
 * - Active conversation skip logic
 *
 * See architecture-session-layer.md §8 (ADR-SESSION-02).
 */
@injectable()
export class TaskRunCoordinator {
  private workflowEngine!: IWorkflowEngine;
  private conversationWorkflowRepo: IConversationWorkflowRepository | null = null;

  /** Maps taskId → planning context for persistence across conversation rounds */
  private taskPlanningCtx = new Map<string, PlanningPromptContext>();

  constructor(
    @inject(RUN_ENGINE_TOKEN) private readonly runEngine: IRunEngine,
    @inject(LOGGER_TOKEN) private readonly logger: ILogger,
    @inject(EVENT_BUS_TOKEN) private readonly eventBus: IEventBus,
    @inject(ROLE_REPO_TOKEN) private readonly roleRepo: IRoleRepository,
    @inject(TASK_REPO_TOKEN) private readonly taskRepo: ITaskRepository,
    @inject(RUN_REPO_TOKEN) private readonly runRepo: IRunRepository,
    @inject(ORGANIZATION_REPO_TOKEN) private readonly orgRepo: IOrganizationRepository,
    @inject(PROMPT_BUILDER_TOKEN) private readonly promptBuilder: IPromptBuilder,
    @inject(SETTINGS_REPO_TOKEN) private readonly settingsRepo: ISettingsRepository,
    private readonly executionContext: ExecutionContext,
    private readonly taskStateMachine: TaskStateMachine,
    private readonly taskService: TaskService,
  ) {}

  setWorkflowEngine(engine: IWorkflowEngine): void {
    this.workflowEngine = engine;
  }

  setConversationWorkflowRepo(repo: IConversationWorkflowRepository): void {
    this.conversationWorkflowRepo = repo;
  }

  /**
   * Execute an AI run for a task. Direct replacement for ExecutionEngine.startRun().
   * Called by OrgOrchestrator.
   */
  async executeForTask(
    roleId: string,
    taskNodeId: string,
    orgId: string,
    trigger: WakeTrigger,
    planningContext?: PlanningPromptContext,
  ): Promise<Run> {
    // ─── Pre-Run: Transition task to in_progress ────────────
    const task = await this.taskRepo.findById(taskNodeId);
    if (task) {
      const isTerminal = await this.workflowEngine.isTerminalStatus(orgId, task.status);
      const isReview = await this.workflowEngine.isReviewStatus(orgId, task.status);
      if (!isTerminal && !isReview) {
        const allStatuses = await this.workflowEngine.getAllStatuses(orgId);
        const firstActive = allStatuses.find((s) => s.category === 'active');
        if (firstActive) {
          try {
            await this.taskStateMachine.transition(taskNodeId, firstActive.name);
          } catch {
            // Task may already be in this status
          }
        }
      }
    }

    // ─── Transition conversation workflow to 'resumed' ──────
    if (trigger === 'discussion_reply' && this.conversationWorkflowRepo) {
      try {
        const workflow = await this.conversationWorkflowRepo.findActiveByRoleAndTask(roleId, taskNodeId);
        if (workflow && workflow.state === 'reply_received') {
          await this.conversationWorkflowRepo.updateState(workflow.id, 'resumed');
          this.logger.info('Conversation workflow transitioned to resumed', {
            workflowId: workflow.id,
          });
        }
      } catch (err) {
        this.logger.warn('Failed to transition conversation workflow to resumed', {
          error: String(err),
        });
      }
    }

    // ─── Resolve session ID for --resume ────────────────────
    const NO_RESUME_TRIGGERS: WakeTrigger[] = ['review_approve'];
    let lastSessionId: string | null = null;

    if (!NO_RESUME_TRIGGERS.includes(trigger)) {
      // For discussion_reply: prefer conversation workflow's asking session ID
      if (trigger === 'discussion_reply' && this.conversationWorkflowRepo) {
        const workflow = await this.conversationWorkflowRepo.findActiveByRoleAndTask(roleId, taskNodeId);
        if (workflow?.askingSessionId) {
          lastSessionId = workflow.askingSessionId;
          this.logger.info('Resuming conversation session', {
            sessionId: lastSessionId.slice(0, 8), workflowId: workflow.id,
          });
        }
      }

      if (!lastSessionId) {
        lastSessionId = await this.runRepo.findLastSessionId(roleId, taskNodeId);
      }
    }

    // ─── Build Planning Context (if applicable) ─────────────
    const runPlanningCtx = planningContext ?? this.taskPlanningCtx.get(taskNodeId);
    if (runPlanningCtx) {
      try {
        const localeSetting = await this.settingsRepo.get('locale');
        if (localeSetting) runPlanningCtx.communicationLanguage = localeSetting;
      } catch (err) {
        this.logger.warn('Failed to load locale setting for planning context', { error: String(err) });
      }
      this.taskPlanningCtx.set(taskNodeId, runPlanningCtx);
    }

    // ─── Build Prompt ───────────────────────────────────────
    const ctx = await this.executionContext.buildPromptContext(roleId, taskNodeId, trigger, runPlanningCtx);
    const systemPrompt = this.promptBuilder.build(ctx);

    // ─── Resolve org name for context label ─────────────────
    const org = await this.orgRepo.findById(orgId);
    const orgName = org?.name ?? orgId;

    // ─── Execute via RunEngine ──────────────────────────────
    const result = await this.runEngine.execute({
      roleId,
      orgId,
      prompt: systemPrompt,
      contextId: taskNodeId,
      contextLabel: orgName,
      taskNodeId,
      sessionId: lastSessionId ?? undefined,
      mcpContext: 'task:execution',
      trigger,
    });

    // ─── Post-Run: Phase 1 advancement ──────────────────────
    if (result.status === 'succeeded') {
      await this.handlePostRunAdvancement(roleId, taskNodeId, orgId, result);
    }

    // ─── Cleanup task planning context if terminal ──────────
    await this.cleanupTaskPlanningCtx();

    // ─── Return the Run record (fetch from DB) ──────────────
    // The RunEngine created the Run record; we need to return it
    const run = await this.runRepo.findById(result.runId);
    return run!;
  }

  /**
   * Phase 1 advancement: if the run succeeded and the task is still in an active
   * status (for requiresHumanApproval roles), advance to review.
   */
  private async handlePostRunAdvancement(
    roleId: string,
    taskNodeId: string,
    orgId: string,
    result: RunResult,
  ): Promise<void> {
    const postRunTask = await this.taskRepo.findById(taskNodeId);
    if (!postRunTask) return;

    const isActive = await this.workflowEngine.isActiveStatus(orgId, postRunTask.status);
    if (!isActive) return;

    const role = await this.roleRepo.findById(roleId);
    if (!role?.requiresHumanApproval) return;

    // Skip advancement if there's an active conversation
    let hasActiveConversation = false;
    if (this.conversationWorkflowRepo) {
      try {
        const activeConvo = await this.conversationWorkflowRepo.findActiveByRoleAndTask(roleId, taskNodeId);
        hasActiveConversation = activeConvo != null;
      } catch {
        // Fail-open
      }
    }

    if (hasActiveConversation) {
      this.logger.info('Skipping Phase 1 advancement — active conversation pending', { taskNodeId });
      return;
    }

    const reviewStatus = await this.workflowEngine.getFirstReviewStatus(orgId);
    if (reviewStatus) {
      try {
        await this.taskService.updateStatus(taskNodeId, reviewStatus);
        this.logger.info('Task advanced to review status after Phase 1 run', { taskNodeId, reviewStatus });
      } catch {
        // Transition not allowed from current state — leave as-is
      }
    }
  }

  private async cleanupTaskPlanningCtx(): Promise<void> {
    for (const [taskId] of this.taskPlanningCtx) {
      try {
        const task = await this.taskRepo.findById(taskId);
        if (!task || await this.workflowEngine?.isTerminalStatus(task.orgId, task.status)) {
          this.taskPlanningCtx.delete(taskId);
        }
      } catch {
        this.taskPlanningCtx.delete(taskId);
      }
    }
  }
}
