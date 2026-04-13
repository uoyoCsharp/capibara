import { injectable, inject } from 'tsyringe';
import type { IOrganizationRepository } from '@main/core/interfaces/i-organization.repository.js';
import type { IRunRepository } from '@main/core/interfaces/i-run.repository.js';
import type { IRoleRepository } from '@main/core/interfaces/i-role.repository.js';
import type { ITaskRepository } from '@main/core/interfaces/i-task.repository.js';
import type { ICostEntryRepository } from '@main/core/interfaces/i-cost-entry.repository.js';
import type { IEventBus } from '@main/core/interfaces/i-event-bus.js';
import type { ILogger } from '@main/core/interfaces/i-logger.js';
import type { IExecutor } from '@main/core/interfaces/i-executor.js';
import type { IPromptBuilder } from '@main/core/interfaces/i-prompt-builder.js';
import type { CapibaraConfig } from '@main/core/types/config.types.js';
import type { Run, WakeTrigger } from '@main/core/types/domain.types.js';
import type { IConversationWorkflowRepository } from '@main/core/interfaces/i-conversation-workflow.repository.js';
import { TERMINAL_RUN_STATUSES } from '@main/core/constants/run.constants.js';
import type { IWorkflowEngine } from '@main/core/interfaces/i-workflow-engine.js';
import type { TaskStateMachine } from '../state-machine/task.state-machine.js';
import type { TaskService } from '../tasks/task.service.js';
import {
  CONFIG_TOKEN,
  LOGGER_TOKEN,
  EVENT_BUS_TOKEN,
  ORGANIZATION_REPO_TOKEN,
  RUN_REPO_TOKEN,
  ROLE_REPO_TOKEN,
  TASK_REPO_TOKEN,
  COST_ENTRY_REPO_TOKEN,
  EXECUTOR_TOKEN,
  PROMPT_BUILDER_TOKEN,
} from '@main/core/tokens.js';
import { BudgetExceededError, ExecutionError } from '@main/core/errors/capibara.errors.js';
import type { ExecutionContext } from '../context/execution.context.js';
import type { McpConfigGenerator } from '../../infrastructure/mcp/mcp-config-generator.js';
import type { McpIpcServer } from '../../infrastructure/mcp/mcp-ipc-server.js';
import type { FileLogService } from '../../infrastructure/logging/file-log.service.js';

@injectable()
export class ExecutionEngine {
  private jwtSecrets = new Map<string, string>();
  private conversationWorkflowRepo: IConversationWorkflowRepository | null = null;
  private workflowEngine!: IWorkflowEngine;
  private taskService!: TaskService;

  /** Maps runId → { orgName, taskId } for log file path resolution */
  private runLogCtx = new Map<string, { orgName: string; taskId: string }>();

  /** Maps runId → sessionId for in-flight runs (before finish() persists to DB) */
  private runSessionIds = new Map<string, string>();

  constructor(
    @inject(CONFIG_TOKEN) private readonly config: CapibaraConfig,
    @inject(LOGGER_TOKEN) private readonly logger: ILogger,
    @inject(EVENT_BUS_TOKEN) private readonly eventBus: IEventBus,
    @inject(ORGANIZATION_REPO_TOKEN) private readonly orgRepo: IOrganizationRepository,
    @inject(RUN_REPO_TOKEN) private readonly runRepo: IRunRepository,
    @inject(ROLE_REPO_TOKEN) private readonly roleRepo: IRoleRepository,
    @inject(TASK_REPO_TOKEN) private readonly taskRepo: ITaskRepository,
    @inject(COST_ENTRY_REPO_TOKEN) private readonly costRepo: ICostEntryRepository,
    @inject(EXECUTOR_TOKEN) private readonly executor: IExecutor,
    @inject(PROMPT_BUILDER_TOKEN) private readonly promptBuilder: IPromptBuilder,
    private readonly executionContext: ExecutionContext,
    private readonly mcpConfigGen: McpConfigGenerator,
    private readonly mcpIpcServer: McpIpcServer,
    private readonly fileLogService: FileLogService,
    private readonly taskStateMachine: TaskStateMachine,
  ) {
    // Register log callback to stream output to file and renderer
    this.executor.onLog((runId, stream, chunk) => {
      const ctx = this.runLogCtx.get(runId);
      if (ctx) {
        this.fileLogService.append(ctx.orgName, ctx.taskId, runId, chunk);
      }
      this.eventBus.emit({
        type: 'run:log',
        timestamp: new Date().toISOString(),
        payload: { runId, stream, chunk },
      });
    });
  }

  setConversationWorkflowRepo(repo: IConversationWorkflowRepository): void {
    this.conversationWorkflowRepo = repo;
  }

  setWorkflowEngine(engine: IWorkflowEngine): void {
    this.workflowEngine = engine;
  }

  setTaskService(service: TaskService): void {
    this.taskService = service;
  }

  /** Returns the sessionId for an in-flight run (before DB persistence). */
  getRunSessionId(runId: string): string | null {
    return this.runSessionIds.get(runId) ?? null;
  }

  async startRun(
    roleId: string,
    taskNodeId: string,
    orgId: string,
    trigger: WakeTrigger,
  ): Promise<Run> {
    // ─── Pre-Execution Gate Checks ─────────────────────────────
    const role = await this.roleRepo.findById(roleId);
    if (!role || role.status !== 'active') {
      throw new ExecutionError('', `Role ${roleId} is not active`);
    }

    const task = await this.taskRepo.findById(taskNodeId);
    if (!task) {
      throw new ExecutionError('', `Task ${taskNodeId} not found`);
    }

    // Budget check (token-based, units: millions of tokens)
    const budgetLimit = this.config.execution.budgetLimit;
    if (budgetLimit > 0) {
      const totalTokens = await this.costRepo.getTotalTokensByOrgId(orgId);
      const totalTokensM = totalTokens / 1_000_000;
      if (totalTokensM >= budgetLimit) {
        throw new BudgetExceededError(orgId, budgetLimit, totalTokensM);
      }
    }

    // Per-org serial execution — only one run at a time within an organization
    const activeRun = await this.runRepo.findActiveByOrgId(orgId);
    if (activeRun) {
      throw new ExecutionError('', `Org ${orgId} already has an active run: ${activeRun.id}`);
    }

    // ─── Create Run Record ─────────────────────────────────────
    const run = await this.runRepo.create({ orgId, taskNodeId, roleId, trigger });
    this.logger.info('Run created', { runId: run.id, roleId, taskNodeId });

    this.eventBus.emit({
      type: 'run:queued',
      timestamp: new Date().toISOString(),
      payload: { runId: run.id, roleId, orgId, taskNodeId },
    });

    // ─── Execute Asynchronously ────────────────────────────────
    void this.executeRun(run);

    return run;
  }

  async cancelRun(runId: string): Promise<void> {
    const run = await this.runRepo.findById(runId);
    if (!run) {
      throw new ExecutionError(runId, 'Run not found');
    }
    if (TERMINAL_RUN_STATUSES.has(run.status)) {
      throw new ExecutionError(runId, `Run already in terminal state: ${run.status}`);
    }

    this.executor.abort(runId);
    await this.runRepo.finish(runId, 'cancelled', run.tokenCount);

    this.logger.info('Run cancelled', { runId });
    this.eventBus.emit({
      type: 'run:cancelled',
      timestamp: new Date().toISOString(),
      payload: { runId, roleId: run.roleId, orgId: run.orgId },
    });
  }

  private async executeRun(run: Run): Promise<void> {
    const { id: runId, roleId, taskNodeId, orgId, trigger } = run;

    try {
      // ─── Transition task to in_progress (if in initial or active-revision state) ───
      const task = await this.taskRepo.findById(taskNodeId);
      if (task) {
        const isTerminal = await this.workflowEngine.isTerminalStatus(orgId, task.status);
        const isReview = await this.workflowEngine.isReviewStatus(orgId, task.status);
        if (!isTerminal && !isReview) {
          // Find the first active status to transition to
          const allStatuses = await this.workflowEngine.getAllStatuses(orgId);
          const firstActive = allStatuses.find((s) => s.category === 'active');
          if (firstActive) {
            try {
              await this.taskStateMachine.transition(taskNodeId, firstActive.name);
            } catch {
              // Task may already be in this status from a previous attempt
            }
          }
        }
      }

      // ─── Resolve org name for log path ────────────────────
      const org = await this.orgRepo.findById(orgId);
      const orgName = org?.name ?? orgId;
      this.runLogCtx.set(runId, { orgName, taskId: taskNodeId });

      // ─── Build Context and Prompt ──────────────────────────
      const ctx = await this.executionContext.buildPromptContext(roleId, taskNodeId, trigger);
      const systemPrompt = this.promptBuilder.build(ctx);

      // ─── Transition conversation workflow to 'resumed' ─────
      if (trigger === 'discussion_reply' && this.conversationWorkflowRepo) {
        try {
          const workflow = await this.conversationWorkflowRepo.findActiveByRoleAndTask(roleId, taskNodeId);
          if (workflow && workflow.state === 'reply_received') {
            await this.conversationWorkflowRepo.updateState(workflow.id, 'resumed');
            this.logger.info('Conversation workflow transitioned to resumed', {
              runId, workflowId: workflow.id,
            });
          }
        } catch (err) {
          this.logger.warn('Failed to transition conversation workflow to resumed', {
            runId, error: String(err),
          });
        }
      }

      // ─── Generate MCP Config ───────────────────────────────
      const token = this.generateRunToken(runId);
      this.mcpIpcServer.registerToken(runId, token);
      const bridgePath = this.mcpConfigGen.getBridgePath();
      const mcpConfigPath = this.mcpConfigGen.generate(runId, bridgePath, token);

      // ─── Update to Running ─────────────────────────────────
      await this.runRepo.updateStatus(runId, 'running');
      this.eventBus.emit({
        type: 'run:started',
        timestamp: new Date().toISOString(),
        payload: { runId, roleId, orgId },
      });

      // ─── Resolve Org Workspace Path ──────────────────────
      const projectDir = org?.workspacePath || this.config.cli.projectDir;

      // ─── Resolve Session ID for --resume ──────────────────
      // Do NOT resume sessions for phase transitions (e.g., review_approve triggers Phase 2
      // after Phase 1 posted a plan). Resuming would carry Phase 1's conversation context
      // where the AI was told "do NOT create children", causing it to ignore Phase 2's prompt.
      const NO_RESUME_TRIGGERS: WakeTrigger[] = ['review_approve'];
      let lastSessionId: string | null = null;

      if (!NO_RESUME_TRIGGERS.includes(trigger)) {
        // For discussion_reply: prefer the conversation workflow's asking session ID
        if (trigger === 'discussion_reply' && this.conversationWorkflowRepo) {
          const workflow = await this.conversationWorkflowRepo.findActiveByRoleAndTask(roleId, taskNodeId);
          if (workflow?.askingSessionId) {
            lastSessionId = workflow.askingSessionId;
            this.logger.info('Resuming conversation session', {
              runId, sessionId: lastSessionId.slice(0, 8), workflowId: workflow.id,
            });
          }
        }

        // Fallback to regular session resume
        if (!lastSessionId) {
          lastSessionId = await this.runRepo.findLastSessionId(roleId, taskNodeId);
        }
      }

      if (lastSessionId) {
        this.runSessionIds.set(runId, lastSessionId);
        this.logger.info('Resuming previous session', { runId, sessionId: lastSessionId.slice(0, 8) });
      }

      // ─── Log Input Prompt ──────────────────────────────────
      this.fileLogService.writeInput(orgName, taskNodeId, runId, {
        prompt: systemPrompt,
        trigger,
        roleId,
        executor: this.config.cli.defaultExecutor,
        projectDir,
        sessionId: lastSessionId ?? undefined,
        cliConfig: {
          model: this.config.cli.model,
          maxTurnsPerRun: this.config.cli.maxTurnsPerRun,
          effort: this.config.cli.effort,
          timeoutMs: this.config.cli.timeoutMs,
        },
      });

      // ─── Invoke Executor (via UtilityProcess Worker) ───────
      this.logger.info('Dispatching run to worker', { runId, executor: this.config.cli.defaultExecutor, projectDir });

      const result = await this.executor.execute({
        runId,
        roleId,
        orgId,
        taskNodeId,
        trigger,
        prompt: systemPrompt,
        mcpConfigPath,
        projectDir,
        executor: this.config.cli.defaultExecutor,
        sessionId: lastSessionId ?? undefined,
        cliConfig: {
          model: this.config.cli.model ?? undefined,
          maxTurnsPerRun: this.config.cli.maxTurnsPerRun,
          effort: this.config.cli.effort,
          timeoutMs: this.config.cli.timeoutMs,
          extraArgs: this.config.cli.extraArgs,
        },
      });

      // ─── Cache sessionId from result ──────────────────────
      if (result.sessionId) {
        this.runSessionIds.set(runId, result.sessionId);
      }

      // ─── Process Result ────────────────────────────────────
      const tokenCount = (result.inputTokens ?? 0) + (result.outputTokens ?? 0);

      if (result.status === 'succeeded') {
        await this.runRepo.finish(runId, 'succeeded', tokenCount, result.sessionId);
        this.logger.info('Run succeeded', {
          runId, tokenCount, model: result.model,
          inputTokens: result.inputTokens, outputTokens: result.outputTokens,
        });

        // Phase 1 advancement: if the run succeeded but the task is still in an active status
        // (e.g., requiresHumanApproval roles that post a plan without calling task_complete),
        // advance the task to the first review status so the user sees it needs attention.
        // Uses taskService.updateStatus() (not taskStateMachine directly) so that the
        // review wake logic in TaskService fires and emits wake:triggered for the parent role.
        const postRunTask = await this.taskRepo.findById(taskNodeId);
        if (postRunTask) {
          const isActive = await this.workflowEngine.isActiveStatus(orgId, postRunTask.status);
          if (isActive) {
            const role = await this.roleRepo.findById(roleId);
            if (role?.requiresHumanApproval) {
              // Skip advancement if there's an active conversation (AI asked a question
              // and is waiting for a reply). The task should stay in active status until
              // the conversation resolves and the agent completes its work.
              let hasActiveConversation = false;
              if (this.conversationWorkflowRepo) {
                try {
                  const activeConvo = await this.conversationWorkflowRepo.findActiveByRoleAndTask(roleId, taskNodeId);
                  hasActiveConversation = activeConvo != null;
                } catch {
                  // Fail-open: if lookup fails, proceed with advancement
                }
              }

              if (!hasActiveConversation) {
                const reviewStatus = await this.workflowEngine.getFirstReviewStatus(orgId);
                if (reviewStatus) {
                  try {
                    await this.taskService.updateStatus(taskNodeId, reviewStatus);
                    this.logger.info('Task advanced to review status after Phase 1 run', { runId, taskNodeId, reviewStatus });
                  } catch {
                    // Transition not allowed from current state — leave as-is
                  }
                }
              } else {
                this.logger.info('Skipping Phase 1 advancement — active conversation pending', { runId, taskNodeId });
              }
            }
          }
        }

        // Record cost entry
        if (tokenCount > 0) {
          await this.costRepo.create({
            runId,
            roleId,
            orgId,
            tokenCount,
          });
        }

        this.eventBus.emit({
          type: 'run:succeeded',
          timestamp: new Date().toISOString(),
          payload: {
            runId, roleId, orgId, taskNodeId, tokenCount,
            summary: result.summary,
          },
        });
      } else if (result.status === 'cancelled') {
        await this.runRepo.finish(runId, 'cancelled', tokenCount, result.sessionId);
        this.logger.info('Run cancelled by worker', { runId });

        this.eventBus.emit({
          type: 'run:cancelled',
          timestamp: new Date().toISOString(),
          payload: { runId, roleId, orgId },
        });
      } else {
        // failed or interrupted
        await this.runRepo.finish(runId, result.status, tokenCount, result.sessionId);
        this.logger.warn('Run failed', {
          runId, exitCode: result.exitCode, error: result.errorMessage,
        });

        // Still record cost even for failed runs
        if (tokenCount > 0) {
          await this.costRepo.create({
            runId,
            roleId,
            orgId,
            tokenCount,
          });
        }

        this.eventBus.emit({
          type: 'run:failed',
          timestamp: new Date().toISOString(),
          payload: {
            runId, roleId, orgId, taskNodeId,
            exitCode: result.exitCode, error: result.errorMessage,
          },
        });
      }

      // ─── Cleanup ───────────────────────────────────────────
      await this.cleanupRun(runId);
    } catch (err) {
      this.logger.error('Run execution error', { runId, error: String(err) });

      try {
        await this.runRepo.finish(runId, 'failed', 0, null);
      } catch {
        // Best-effort status update
      }

      this.eventBus.emit({
        type: 'run:failed',
        timestamp: new Date().toISOString(),
        payload: { runId, roleId, orgId, taskNodeId, error: String(err) },
      });

      await this.cleanupRun(runId);
    }
  }

  /**
   * Cleanup all resources for a run. Each operation is isolated so
   * a failure in one (e.g. flush) does not prevent token revocation.
   */
  private async cleanupRun(runId: string): Promise<void> {
    const results = await Promise.allSettled([
      this.fileLogService.flush(runId),
      Promise.resolve(this.mcpConfigGen.cleanup(runId)),
    ]);

    for (const r of results) {
      if (r.status === 'rejected') {
        this.logger.warn('Run cleanup step failed', { runId, error: String(r.reason) });
      }
    }

    // Synchronous cleanup always runs regardless of above
    this.runLogCtx.delete(runId);
    this.runSessionIds.delete(runId);
    this.mcpIpcServer.revokeToken(runId);
    this.jwtSecrets.delete(runId);
  }

  private generateRunToken(runId: string): string {
    const { createHmac, randomBytes } = require('node:crypto') as typeof import('node:crypto');
    const secret = randomBytes(32).toString('hex');
    this.jwtSecrets.set(runId, secret);

    const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
    const payload = Buffer.from(JSON.stringify({
      sub: runId,
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 3600,
    })).toString('base64url');
    const signature = createHmac('sha256', secret)
      .update(`${header}.${payload}`)
      .digest('base64url');

    return `${header}.${payload}.${signature}`;
  }
}
