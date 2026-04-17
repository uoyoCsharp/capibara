import { injectable } from 'tsyringe';
import type { IRunEngine } from '../interfaces/i-run-engine';
import type { IRunRepository } from '../interfaces/i-run.repository';
import type { IExecutor } from '../interfaces/i-executor';
import type { IEventBus } from '@core/foundation/interfaces/i-event-bus';
import type { ILogger } from '@core/foundation/interfaces/i-logger';
import type { CapibaraConfig } from '@core/config/config.types';
import type { RunExecutionParams, RunResult, WakeReason } from '../types/execution.types';
import { BudgetExceededError } from '@core/foundation/errors/capibara.errors';
import { ExecutionError } from '@core/foundation/errors/capibara.errors';
import { StreamJsonParser } from '../workers/stream-json-parser';
import { CostTracker } from '../services/cost-tracker';
import { FileLogService } from '../logging/file-log.service';

type LogCallback = (runId: string, stream: 'stdout' | 'stderr', chunk: string) => void;
type TextCallback = (runId: string, text: string) => void;

@injectable()
export class RunEngine implements IRunEngine {
  private logCallbacks: LogCallback[] = [];
  private textCallbacks: TextCallback[] = [];
  private parsers = new Map<string, StreamJsonParser>();
  private logContexts = new Map<string, { contextLabel: string; contextId: string }>();

  constructor(
    private readonly runRepo: IRunRepository,
    private readonly executor: IExecutor,
    private readonly eventBus: IEventBus,
    private readonly logger: ILogger,
    private readonly config: CapibaraConfig,
    private readonly costTracker: CostTracker,
    private readonly fileLogService: FileLogService,
  ) {
    this.executor.onLog((runId, stream, chunk) => {
      this.handleLog(runId, stream, chunk);
    });
  }

  async execute(params: RunExecutionParams): Promise<RunResult> {
    const { totalCost } = this.costTracker.getBudgetUsage(params.orgId);
    if (this.config.execution.budgetLimit > 0 && totalCost >= this.config.execution.budgetLimit) {
      throw new BudgetExceededError(params.orgId, this.config.execution.budgetLimit, totalCost);
    }

    const activeRun = this.runRepo.findActiveByOrgId(params.orgId);
    if (activeRun) {
      throw new ExecutionError('', `Org ${params.orgId} already has an active run: ${activeRun.id}`);
    }

    const run = this.runRepo.create({
      orgId: params.orgId,
      taskId: params.taskId ?? null,
      conversationId: params.conversationId ?? null,
      roleId: params.roleId,
      wakeReason: (params.wakeReason ?? 'task_assigned') as WakeReason,
    });

    this.logContexts.set(run.id, { contextLabel: params.contextLabel, contextId: params.contextId });

    this.emitEvent('run:queued', { runId: run.id, orgId: params.orgId, roleId: params.roleId });

    this.fileLogService.writeInput(params.contextLabel, params.contextId, run.id, {
      wakeReason: params.wakeReason,
      roleId: params.roleId,
      prompt: params.prompt.slice(0, 500),
    });

    this.runRepo.updateStatus(run.id, 'running');
    this.emitEvent('run:started', { runId: run.id, orgId: params.orgId, roleId: params.roleId });

    try {
      const result = await this.executor.execute({
        runId: run.id,
        roleId: params.roleId,
        orgId: params.orgId,
        taskId: params.taskId ?? params.contextId,
        wakeReason: params.wakeReason ?? 'task_assigned',
        prompt: params.sessionId && params.userMessage ? params.userMessage : params.prompt,
        mcpConfigPath: '',
        projectDir: this.config.cli.projectDir,
        executor: this.config.cli.defaultExecutor,
        cliConfig: {
          model: this.config.cli.model,
          maxTurnsPerRun: this.config.cli.maxTurnsPerRun,
          effort: this.config.cli.effort,
          timeoutMs: this.config.cli.timeoutMs,
          extraArgs: this.config.cli.extraArgs,
        },
        sessionId: params.sessionId,
      });

      const tokenCount = result.inputTokens + result.outputTokens;
      this.runRepo.finish(run.id, result.status, tokenCount, 0, result.sessionId);

      if (tokenCount > 0) {
        this.costTracker.recordCost(run.id, params.roleId, params.orgId, tokenCount, 0);
      }

      const eventType = result.status === 'succeeded' ? 'run:succeeded'
        : result.status === 'cancelled' ? 'run:cancelled'
        : 'run:failed';
      this.emitEvent(eventType, { runId: run.id, orgId: params.orgId, roleId: params.roleId, tokenCount });

      this.cleanupRun(run.id);

      return {
        runId: run.id,
        status: result.status,
        sessionId: result.sessionId,
        summary: result.summary,
        inputTokens: result.inputTokens,
        outputTokens: result.outputTokens,
        model: result.model,
        exitCode: result.exitCode,
        errorMessage: result.errorMessage,
      };
    } catch (err) {
      this.runRepo.finish(run.id, 'failed');
      this.emitEvent('run:failed', {
        runId: run.id,
        orgId: params.orgId,
        roleId: params.roleId,
        errorMessage: err instanceof Error ? err.message : String(err),
      });
      this.cleanupRun(run.id);
      throw err;
    }
  }

  async cancelRun(runId: string): Promise<void> {
    this.executor.abort(runId);
    this.runRepo.finish(runId, 'cancelled');
    this.emitEvent('run:cancelled', { runId });
    this.cleanupRun(runId);
  }

  onLog(callback: LogCallback): void {
    this.logCallbacks.push(callback);
  }

  onAssistantText(callback: TextCallback): void {
    this.textCallbacks.push(callback);
  }

  private handleLog(runId: string, stream: 'stdout' | 'stderr', chunk: string): void {
    for (const cb of this.logCallbacks) {
      cb(runId, stream, chunk);
    }

    this.emitEvent('run:log', { runId, stream, chunk });

    const ctx = this.logContexts.get(runId);
    if (ctx) {
      this.fileLogService.append(ctx.contextLabel, ctx.contextId, runId, chunk);
    }

    if (stream === 'stdout') {
      if (!this.parsers.has(runId)) {
        this.parsers.set(runId, new StreamJsonParser({
          onText: (text) => {
            for (const cb of this.textCallbacks) cb(runId, text);
            this.emitEvent('run:assistant-text', { runId, text });
          },
          onStatus: (status) => {
            this.emitEvent('run:status', { runId, status });
          },
        }));
      }
      this.parsers.get(runId)!.feed(chunk);
    }
  }

  private cleanupRun(runId: string): void {
    const parser = this.parsers.get(runId);
    if (parser) {
      parser.flush();
      this.parsers.delete(runId);
    }
    this.logContexts.delete(runId);
    this.fileLogService.flush(runId).catch((err) => {
      this.logger.error('Failed to flush log', { runId, error: String(err) });
    });
  }

  private emitEvent(type: string, payload: Record<string, unknown>): void {
    this.eventBus.emit({
      type: type as import('@core/foundation/events').DomainEventType,
      timestamp: new Date().toISOString(),
      payload,
    });
  }
}
