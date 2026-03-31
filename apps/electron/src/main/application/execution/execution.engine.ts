import { injectable, inject } from 'tsyringe';
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
import {
  CONFIG_TOKEN,
  LOGGER_TOKEN,
  EVENT_BUS_TOKEN,
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

@injectable()
export class ExecutionEngine {
  constructor(
    @inject(CONFIG_TOKEN) private readonly config: CapibaraConfig,
    @inject(LOGGER_TOKEN) private readonly logger: ILogger,
    @inject(EVENT_BUS_TOKEN) private readonly eventBus: IEventBus,
    @inject(RUN_REPO_TOKEN) private readonly runRepo: IRunRepository,
    @inject(ROLE_REPO_TOKEN) private readonly roleRepo: IRoleRepository,
    @inject(TASK_REPO_TOKEN) private readonly taskRepo: ITaskRepository,
    @inject(COST_ENTRY_REPO_TOKEN) private readonly costRepo: ICostEntryRepository,
    @inject(EXECUTOR_TOKEN) private readonly executor: IExecutor,
    @inject(PROMPT_BUILDER_TOKEN) private readonly promptBuilder: IPromptBuilder,
    private readonly executionContext: ExecutionContext,
    private readonly mcpConfigGen: McpConfigGenerator,
  ) {}

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

    // No active run for this role
    const activeRun = await this.runRepo.findActiveByRoleId(roleId);
    if (activeRun) {
      throw new ExecutionError('', `Role ${roleId} already has an active run: ${activeRun.id}`);
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
    const { id: runId, roleId, taskNodeId, orgId } = run;

    try {
      // ─── Build Context and Prompt ──────────────────────────
      const ctx = await this.executionContext.buildPromptContext(roleId, taskNodeId);
      const systemPrompt = this.promptBuilder.build(ctx);

      // ─── Generate MCP Config ───────────────────────────────
      const token = this.generateRunToken(runId);
      const bridgePath = this.mcpConfigGen.getBridgePath();
      const mcpConfigPath = this.mcpConfigGen.generate(runId, bridgePath, token);

      // ─── Update to Running ─────────────────────────────────
      await this.runRepo.updateStatus(runId, 'running');
      this.eventBus.emit({
        type: 'run:started',
        timestamp: new Date().toISOString(),
        payload: { runId, roleId, orgId },
      });

      // ─── Invoke Executor ───────────────────────────────────
      this.logger.info('Executing run', { runId, executor: this.config.cli.defaultExecutor });

      const result = await this.executor.execute({
        runId,
        prompt: systemPrompt,
        mcpConfigPath,
        projectDir: this.config.cli.projectDir,
        executor: this.config.cli.defaultExecutor,
      });

      // ─── Store Output ──────────────────────────────────────
      const fullOutput = result.stdout + (result.stderr ? `\n[stderr]\n${result.stderr}` : '');
      await this.runRepo.appendOutputLog(runId, fullOutput);

      // ─── Determine Outcome ─────────────────────────────────
      const costUsd = this.parseCostFromOutput(result.stdout);

      if (result.exitCode === 0) {
        await this.runRepo.finish(runId, 'succeeded', costUsd);
        this.logger.info('Run succeeded', { runId, costUsd });

        // Record cost entry
        if (costUsd > 0) {
          await this.costRepo.create({
            runId,
            roleId,
            orgId,
            tokenCount: this.parseTokenCountFromOutput(result.stdout),
            costUsd,
          });
        }

        this.eventBus.emit({
          type: 'run:succeeded',
          timestamp: new Date().toISOString(),
          payload: { runId, roleId, orgId, costUsd, tokenCount: 0 },
        });
      } else {
        await this.runRepo.finish(runId, 'failed', costUsd);
        this.logger.warn('Run failed', { runId, exitCode: result.exitCode });

        this.eventBus.emit({
          type: 'run:failed',
          timestamp: new Date().toISOString(),
          payload: { runId, roleId, orgId, exitCode: result.exitCode, error: result.stderr },
        });
      }

      // ─── Cleanup ───────────────────────────────────────────
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
        payload: { runId, roleId, orgId, error: String(err) },
      });

      this.mcpConfigGen.cleanup(runId);
    }
  }

  private generateRunToken(runId: string): string {
    // Simple token for MCP bridge authentication. In production, use JWT.
    const { createHash } = require('node:crypto') as typeof import('node:crypto');
    return createHash('sha256').update(`capibara:${runId}:${Date.now()}`).digest('hex').slice(0, 32);
  }

  private parseCostFromOutput(stdout: string): number {
    // Attempt to extract cost from Claude CLI output (e.g., "Total cost: $0.0123")
    const match = stdout.match(/(?:total\s*cost|cost)[:\s]*\$?([\d.]+)/i);
    return match ? parseFloat(match[1]) || 0 : 0;
  }

  private parseTokenCountFromOutput(stdout: string): number {
    const match = stdout.match(/(?:total\s*tokens?|tokens?)[:\s]*([\d,]+)/i);
    return match ? parseInt(match[1].replace(/,/g, ''), 10) || 0 : 0;
  }
}
