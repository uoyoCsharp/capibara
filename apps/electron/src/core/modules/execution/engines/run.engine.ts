import { randomUUID } from 'node:crypto';
import { injectable } from 'tsyringe';
import type { IRunEngine } from '../interfaces/i-run-engine';
import type { IRunRepository } from '../interfaces/i-run.repository';
import type { IExecutor, ExecutorHandle } from '../interfaces/i-executor';
import type { IEventBus } from '@core/foundation/interfaces/i-event-bus';
import type { IEventPublisher } from '@core/foundation/interfaces/i-event-publisher';
import type { ILogger } from '@core/foundation/interfaces/i-logger';
import type { DomainEventMap, DomainEventType } from '@core/foundation/events';
import type { CapibaraConfig } from '@core/config/config.types';
import type { RunExecutionParams, RunResult, WakeReason } from '../types/execution.types';
import { ExecutionError } from '@core/foundation/errors/capibara.errors';
import { StreamJsonParser } from '../workers/stream-json-parser';
import { CostTracker } from '../services/cost-tracker';
import { FileLogService } from '../logging/file-log.service';
import type { ITaskRepository } from '@core/modules/workflow/interfaces/i-task.repository';
import type { TaskStateMachine } from '@core/modules/workflow/engines/task.state-machine';
import type { ProcessEngine } from '@core/modules/workflow/engines/process.engine';

type LogCallback = (runId: string, stream: 'stdout' | 'stderr', chunk: string) => void;
type TextCallback = (runId: string, text: string) => void;

@injectable()
export class RunEngine implements IRunEngine {
  private logCallbacks: LogCallback[] = [];
  private textCallbacks: TextCallback[] = [];
  private parsers = new Map<string, StreamJsonParser>();
  private logContexts = new Map<string, { contextLabel: string; contextId: string }>();
  private activeOrgs = new Set<string>();
  private activeHandles = new Map<string, ExecutorHandle>();
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
    private readonly taskRepo: ITaskRepository,
    private readonly taskStateMachine: TaskStateMachine,
    private readonly processEngine: ProcessEngine,
  ) {}

  setMcpConfigPath(path: string): void {
    this.mcpConfigPath = path;
  }

  async execute(params: RunExecutionParams): Promise<RunResult> {
    if (this.activeOrgs.has(params.orgId)) {
      throw new ExecutionError('', `Org ${params.orgId} already has an active run`);
    }

    const wakeReason: WakeReason = (params.wakeReason ?? 'task_assigned') as WakeReason;
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

    this.activeOrgs.add(params.orgId);

    const runId = randomUUID();
    let handle: ExecutorHandle;
    try {
      handle = await this.executor.spawn({
        runId,
        roleId: params.roleId,
        orgId: params.orgId,
        taskId: params.taskId ?? params.contextId,
        wakeReason,
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
    } catch (err) {
      this.activeOrgs.delete(params.orgId);
      this.logger.error('CLI spawn failed; no run recorded', {
        orgId: params.orgId, roleId: params.roleId, error: String(err),
      });
      throw err instanceof Error ? err : new Error(String(err));
    }

    handle.onLog((stream, chunk) => this.handleLog(runId, stream, chunk));

    const run = this.runRepo.create({
      id: runId,
      orgId: params.orgId,
      roleId: params.roleId,
      wakeReason,
      ...target,
    });

    this.logContexts.set(run.id, { contextLabel: params.contextLabel, contextId: params.contextId });
    this.activeHandles.set(run.id, handle);

    this.fileLogService.writeInput(params.contextLabel, params.contextId, run.id, {
      wakeReason: params.wakeReason,
      roleId: params.roleId,
      prompt: params.prompt,
    });

    this.publishEvent('run:started', { runId: run.id, orgId: params.orgId, roleId: params.roleId });
    this.logger.info('Run started', {
      runId: run.id, pid: handle.pid, orgId: params.orgId, roleId: params.roleId,
      projectDir: params.projectDir || this.config.cli.projectDir,
    });

    this.advanceTaskToActive(params.taskId, params.orgId);

    try {
      const result = await handle.complete();
      const tokenCount = result.inputTokens + result.outputTokens;
      this.runRepo.finish(run.id, result.status, tokenCount, 0, result.sessionId, result.summary, result.errorMessage);

      if (tokenCount > 0) {
        this.costTracker.recordCost(run.id, params.roleId, params.orgId, tokenCount, 0);
      }

      this.logger.info('Run finished', { runId: run.id, status: result.status, tokenCount, exitCode: result.exitCode });

      this.rollbackTaskIfActive(params.taskId);

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
      this.rollbackTaskIfActive(params.taskId);
      this.publishEvent('run:failed', {
        runId: run.id,
        orgId: params.orgId,
        roleId: params.roleId,
        tokenCount: 0,
        errorMessage: err instanceof Error ? err.message : String(err),
      });
      throw err;
    } finally {
      this.cleanupRun(run.id);
      this.activeOrgs.delete(params.orgId);
    }
  }

  async cancelRun(runId: string): Promise<void> {
    const run = this.runRepo.findById(runId);
    const handle = this.activeHandles.get(runId);
    if (handle) handle.cancel();
    this.runRepo.finish(runId, 'cancelled');
    if (run) {
      this.rollbackTaskIfActive(run.taskId);
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
    this.activeHandles.delete(runId);
    this.fileLogService.flush(runId).catch((err) => {
      this.logger.error('Failed to flush log', { runId, error: String(err) });
    });
  }

  private publishEvent<T extends DomainEventType>(type: T, payload: DomainEventMap[T]): void {
    this.eventPublisher.publish(type, payload);
  }

  private advanceTaskToActive(taskId: string | null | undefined, orgId: string): void {
    if (!taskId) return;
    const task = this.taskRepo.findById(taskId);
    if (!task) return;

    const currentCategory = this.processEngine.getStatusCategory(orgId, task.status);
    if (currentCategory === 'active') return;
    if (currentCategory !== 'initial') {
      this.logger.debug('Skipping advanceTaskToActive for non-initial status', {
        taskId, status: task.status, category: currentCategory,
      });
      return;
    }

    const transitions = this.processEngine.getAvailableTransitions(orgId, task.status);
    const target = transitions.find(
      (t) => this.processEngine.getStatusCategory(orgId, t.to) === 'active',
    );
    if (!target) {
      this.logger.warn('Schema has no initial→active transition; task left in initial state', {
        taskId, status: task.status,
      });
      return;
    }

    try {
      this.taskStateMachine.transition(taskId, target.to, { triggeredBy: 'system' });
    } catch (err) {
      this.logger.error('Failed to advance task to active', { taskId, target: target.to, error: String(err) });
    }
  }

  private rollbackTaskIfActive(taskId: string | null | undefined): void {
    if (!taskId) return;
    const task = this.taskRepo.findById(taskId);
    if (!task) return;

    const category = this.processEngine.getStatusCategory(task.orgId, task.status);
    if (category !== 'active') return;

    const initial = this.processEngine.getInitialStatus(task.orgId);
    if (!initial) {
      this.logger.warn('Schema has no initial status; cannot rollback active task', { taskId });
      return;
    }

    try {
      this.taskStateMachine.transition(taskId, initial.name, { triggeredBy: 'system' });
    } catch (err) {
      this.logger.error('Failed to rollback active task', {
        taskId, from: task.status, to: initial.name, error: String(err),
      });
    }
  }

  private emitStreamingEvent<T extends DomainEventType>(type: T, payload: DomainEventMap[T]): void {
    this.eventBus.emit({ type, timestamp: new Date().toISOString(), payload });
  }
}
