import { injectable } from 'tsyringe';
import type { IRunEngine } from '../interfaces/i-run-engine';
import type { IRunRepository } from '../interfaces/i-run.repository';
import type { IExecutor } from '../interfaces/i-executor';
import type { IEventBus } from '@core/foundation/interfaces/i-event-bus';
import type { IEventPublisher } from '@core/foundation/interfaces/i-event-publisher';
import type { ILogger } from '@core/foundation/interfaces/i-logger';
import type { DomainEventMap, DomainEventType } from '@core/foundation/events';
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
  private mcpConfigPath = '';

  constructor(
    private readonly runRepo: IRunRepository,
    private readonly executor: IExecutor,
    private readonly eventBus: IEventBus,
    private readonly eventPublisher: IEventPublisher,
    private readonly logger: ILogger,
    private readonly config: CapibaraConfig,
    private readonly costTracker: CostTracker,
    private readonly fileLogService: FileLogService,
  ) {
    this.executor.onLog((runId, stream, chunk) => {
      this.handleLog(runId, stream, chunk);
    });
  }

  setMcpConfigPath(path: string): void {
    this.mcpConfigPath = path;
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

    const wakeReason: WakeReason = (params.wakeReason ?? 'task_assigned') as WakeReason;
    const base = { orgId: params.orgId, roleId: params.roleId, wakeReason };
    const target = params.taskId
      ? params.conversationId
        ? { taskId: params.taskId, conversationId: params.conversationId }
        : { taskId: params.taskId, conversationId: null }
      : params.conversationId
        ? { taskId: null, conversationId: params.conversationId }
        : null;
    if (!target) {
      throw new ExecutionError('', 'Run requires either taskId or conversationId');
    }
    const run = this.runRepo.create({ ...base, ...target });

    this.logContexts.set(run.id, { contextLabel: params.contextLabel, contextId: params.contextId });

    this.publishEvent('run:queued', { runId: run.id, orgId: params.orgId, roleId: params.roleId });

    this.fileLogService.writeInput(params.contextLabel, params.contextId, run.id, {
      wakeReason: params.wakeReason,
      roleId: params.roleId,
      prompt: params.prompt,
    });

    this.runRepo.updateStatus(run.id, 'running');
    this.publishEvent('run:started', { runId: run.id, orgId: params.orgId, roleId: params.roleId });
    this.logger.info('Run started', { runId: run.id, orgId: params.orgId, roleId: params.roleId, projectDir: params.projectDir || this.config.cli.projectDir });

    try {
      const result = await this.executor.execute({
        runId: run.id,
        roleId: params.roleId,
        orgId: params.orgId,
        taskId: params.taskId ?? params.contextId,
        wakeReason: params.wakeReason ?? 'task_assigned',
        prompt: params.sessionId && params.userMessage ? params.userMessage : params.prompt,
        mcpConfigPath: this.mcpConfigPath,
        projectDir: params.projectDir || this.config.cli.projectDir,
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
      this.runRepo.finish(run.id, result.status, tokenCount, 0, result.sessionId, result.summary, result.errorMessage);

      if (tokenCount > 0) {
        this.costTracker.recordCost(run.id, params.roleId, params.orgId, tokenCount, 0);
      }

      this.logger.info('Run finished', { runId: run.id, status: result.status, tokenCount, exitCode: result.exitCode });
      if (result.status === 'succeeded') {
        this.publishEvent('run:succeeded', { runId: run.id, orgId: params.orgId, roleId: params.roleId, tokenCount });
      } else if (result.status === 'cancelled') {
        this.publishEvent('run:cancelled', { runId: run.id, orgId: params.orgId, roleId: params.roleId, tokenCount });
      } else {
        this.publishEvent('run:failed', {
          runId: run.id,
          orgId: params.orgId,
          roleId: params.roleId,
          tokenCount,
          errorMessage: result.errorMessage ?? null,
        });
      }

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
      this.publishEvent('run:failed', {
        runId: run.id,
        orgId: params.orgId,
        roleId: params.roleId,
        tokenCount: 0,
        errorMessage: err instanceof Error ? err.message : String(err),
      });
      this.cleanupRun(run.id);
      throw err;
    }
  }

  async cancelRun(runId: string): Promise<void> {
    const run = this.runRepo.findById(runId);
    this.executor.abort(runId);
    this.runRepo.finish(runId, 'cancelled');
    if (run) {
      this.publishEvent('run:cancelled', {
        runId,
        orgId: run.orgId,
        roleId: run.roleId,
        tokenCount: run.tokenCount,
      });
    }
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

    this.emitStreamingEvent('run:log', { runId, stream, chunk });

    const ctx = this.logContexts.get(runId);
    if (ctx) {
      this.fileLogService.append(ctx.contextLabel, ctx.contextId, runId, chunk);
    }

    if (stream === 'stdout') {
      if (!this.parsers.has(runId)) {
        this.parsers.set(runId, new StreamJsonParser({
          onText: (text) => {
            for (const cb of this.textCallbacks) cb(runId, text);
            this.emitStreamingEvent('run:assistant-text', { runId, text });
          },
          onStatus: (status) => {
            this.emitStreamingEvent('run:status', { runId, status });
          },
          onParseError: (line, error) => {
            this.logger.debug('Stream JSON parse error', { runId, line: line.slice(0, 200), error });
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

  // Lifecycle events go through outbox (transactional, durable)
  private publishEvent<T extends DomainEventType>(type: T, payload: DomainEventMap[T]): void {
    this.eventPublisher.publish(type, payload);
  }

  // Streaming events (log, assistant-text, status) are ephemeral high-volume
  // signals tied to live stdout — bypass outbox and broadcast directly.
  private emitStreamingEvent<T extends DomainEventType>(type: T, payload: DomainEventMap[T]): void {
    this.eventBus.emit({ type, timestamp: new Date().toISOString(), payload });
  }
}
