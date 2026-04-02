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
import { TERMINAL_RUN_STATUSES } from '@main/core/constants/run.constants.js';
import type { TaskStateMachine } from '../state-machine/task.state-machine.js';
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

  /** Maps runId → { orgName, taskId } for log file path resolution */
  private runLogCtx = new Map<string, { orgName: string; taskId: string }>();

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

    // Budget check
    const totalCost = await this.costRepo.getTotalCostByOrgId(orgId);
    if (totalCost >= this.config.execution.budgetLimit) {
      throw new BudgetExceededError(orgId, this.config.execution.budgetLimit, totalCost);
    }

    // Global serial execution — only one run at a time across all roles
    const activeRun = await this.runRepo.findAnyActiveRun();
    if (activeRun) {
      throw new ExecutionError('', `Another run is already active: ${activeRun.id}`);
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
    await this.runRepo.finish(runId, 'cancelled', run.costUsd);

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
      // ─── Transition task to in_progress ─────────────────────
      const task = await this.taskRepo.findById(taskNodeId);
      if (task && (task.status === 'pending' || task.status === 'revision')) {
        try {
          await this.taskStateMachine.transition(taskNodeId, 'in_progress');
        } catch {
          // Task may already be in_progress from a previous attempt
        }
      }

      // ─── Resolve org name for log path ────────────────────
      const org = await this.orgRepo.findById(orgId);
      const orgName = org?.name ?? orgId;
      this.runLogCtx.set(runId, { orgName, taskId: taskNodeId });

      // ─── Build Context and Prompt ──────────────────────────
      const ctx = await this.executionContext.buildPromptContext(roleId, taskNodeId);
      const systemPrompt = this.promptBuilder.build(ctx);

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
        cliConfig: {
          model: this.config.cli.model ?? undefined,
          maxTurnsPerRun: this.config.cli.maxTurnsPerRun,
          effort: this.config.cli.effort,
          timeoutMs: this.config.cli.timeoutMs,
          extraArgs: this.config.cli.extraArgs,
        },
      });

      // ─── Process Result ────────────────────────────────────
      const costUsd = result.costUsd ?? 0;

      if (result.status === 'succeeded') {
        await this.runRepo.finish(runId, 'succeeded', costUsd);
        this.logger.info('Run succeeded', {
          runId, costUsd, model: result.model,
          inputTokens: result.inputTokens, outputTokens: result.outputTokens,
        });

        // Record cost entry
        if (costUsd > 0) {
          await this.costRepo.create({
            runId,
            roleId,
            orgId,
            tokenCount: result.inputTokens + result.outputTokens,
            costUsd,
          });
        }

        this.eventBus.emit({
          type: 'run:succeeded',
          timestamp: new Date().toISOString(),
          payload: {
            runId, roleId, orgId, taskNodeId, costUsd,
            tokenCount: result.inputTokens + result.outputTokens,
          },
        });
      } else if (result.status === 'cancelled') {
        await this.runRepo.finish(runId, 'cancelled', costUsd);
        this.logger.info('Run cancelled by worker', { runId });

        this.eventBus.emit({
          type: 'run:cancelled',
          timestamp: new Date().toISOString(),
          payload: { runId, roleId, orgId },
        });
      } else {
        // failed or interrupted
        await this.runRepo.finish(runId, result.status, costUsd);
        this.logger.warn('Run failed', {
          runId, exitCode: result.exitCode, error: result.errorMessage,
        });

        // Still record cost even for failed runs
        if (costUsd > 0) {
          await this.costRepo.create({
            runId,
            roleId,
            orgId,
            tokenCount: result.inputTokens + result.outputTokens,
            costUsd,
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
      await this.fileLogService.flush(runId);
      this.runLogCtx.delete(runId);
      this.mcpIpcServer.revokeToken(runId);
      this.jwtSecrets.delete(runId);
      this.mcpConfigGen.cleanup(runId);
    } catch (err) {
      this.logger.error('Run execution error', { runId, error: String(err) });

      try {
        await this.runRepo.finish(runId, 'failed', 0);
      } catch {
        // Best-effort status update
      }

      this.eventBus.emit({
        type: 'run:failed',
        timestamp: new Date().toISOString(),
        payload: { runId, roleId, orgId, taskNodeId, error: String(err) },
      });

      await this.fileLogService.flush(runId).catch(() => {});
      this.runLogCtx.delete(runId);
      this.mcpIpcServer.revokeToken(runId);
      this.jwtSecrets.delete(runId);
      this.mcpConfigGen.cleanup(runId);
    }
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
