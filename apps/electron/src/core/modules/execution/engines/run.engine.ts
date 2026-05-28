import { randomUUID } from 'node:crypto';
import { injectable } from 'tsyringe';
import type { IRunEngine } from '../interfaces/i-run-engine';
import type { IRunRepository } from '../interfaces/i-run.repository';
import type { IExecutor, ExecutorHandle } from '../interfaces/i-executor';
import type { IEventBus } from '@core/foundation/interfaces/i-event-bus';
import type { IEventPublisher } from '@core/foundation/interfaces/i-event-publisher';
import type { ILogger } from '@core/foundation/interfaces/i-logger';
import type { DomainEventMap, DomainEventType } from '@core/foundation/events';
import type { RunExecutionParams, RunResult, WakeReason } from '../types/execution.types';
import { ExecutionError } from '@core/foundation/errors/capibara.errors';
import { CostTracker } from '../services/cost-tracker';
import { FileLogService } from '../logging/file-log.service';
import type { ITaskRepository } from '@core/modules/workflow/interfaces/i-task.repository';
import type { TaskStateMachine } from '@core/modules/workflow/engines/task.state-machine';
import type { ProcessEngine } from '@core/modules/workflow/engines/process.engine';

type LogCallback = (runId: string, stream: 'stdout' | 'stderr', chunk: string) => void;
type TextCallback = (runId: string, text: string) => void;

/**
 * RunEngine — orchestrates the lifecycle of a single AI agent execution (Run).
 *
 * Responsibilities:
 *   - Spawn an executor (ACP session), wire callbacks, persist the Run record
 *   - Publish domain events for each lifecycle transition
 *   - Track token costs
 *   - Advance/rollback the associated Task's status
 *   - Persist execution logs to disk
 *
 * NOT responsible for:
 *   - Protocol-level details (ACP JSON-RPC, stream parsing) — handled by AcpExecutor/AcpUpdateHandler
 *   - Agent process management — handled by AcpAgentSpawner
 *   - Permission/file access control — handled by ACP handlers
 */
@injectable()
export class RunEngine implements IRunEngine {
  private logCallbacks: LogCallback[] = [];
  private textCallbacks: TextCallback[] = [];
  private logContexts = new Map<string, { contextLabel: string; contextId: string }>();
  private activeOrgs = new Set<string>();
  private activeHandles = new Map<string, ExecutorHandle>();

  constructor(
    private readonly runRepo: IRunRepository,
    private readonly executor: IExecutor,
    private readonly eventBus: IEventBus,
    private readonly eventPublisher: IEventPublisher,
    private readonly logger: ILogger,
    private readonly costTracker: CostTracker,
    private readonly fileLogService: FileLogService,
    private readonly taskRepo: ITaskRepository,
    private readonly taskStateMachine: TaskStateMachine,
    private readonly processEngine: ProcessEngine,
  ) {}

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
        projectDir: params.projectDir ?? '',
        sessionId: params.sessionId,
      });
    } catch (err) {
      this.activeOrgs.delete(params.orgId);
      this.logger.error('Agent execution failed to start; no run recorded', {
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
      runId: run.id, orgId: params.orgId, roleId: params.roleId,
    });

    this.advanceTaskToActive(params.taskId, params.orgId);

    try {
      const result = await handle.complete();
      const tokenCount = result.inputTokens + result.outputTokens;
      this.runRepo.finish(run.id, result.status, tokenCount, 0, result.sessionId, result.summary, result.errorMessage);

      if (tokenCount > 0) {
        this.costTracker.recordCost(run.id, params.roleId, params.orgId, tokenCount, 0);
      }

      this.logger.info('Run finished', { runId: run.id, status: result.status, tokenCount });

      if (result.status !== 'suspended') {
        this.rollbackTaskIfActive(params.taskId);
      }

      this.publishRunOutcome(run.id, params.orgId, params.roleId, tokenCount, result);

      return {
        runId: run.id,
        status: result.status,
        sessionId: result.sessionId,
        summary: result.summary,
        inputTokens: result.inputTokens,
        outputTokens: result.outputTokens,
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

  // ─── Private ────────────────────────────────────────────────────────────────

  /**
   * Handle log chunks from the executor.
   * In ACP mode, the AcpUpdateHandler emits structured text via this callback.
   * RunEngine simply: forwards to subscribers, persists to file, emits domain events.
   */
  private handleLog(runId: string, stream: 'stdout' | 'stderr', chunk: string): void {
    for (const cb of this.logCallbacks) {
      cb(runId, stream, chunk);
    }

    this.emitStreamingEvent('run:log', { runId, stream, chunk });

    const ctx = this.logContexts.get(runId);
    if (ctx) {
      this.fileLogService.append(ctx.contextLabel, ctx.contextId, runId, chunk);
    }

    // Emit assistant text for stdout, but skip structured JSON markers
    if (stream === 'stdout' && chunk && !isStructuredMarker(chunk)) {
      for (const cb of this.textCallbacks) cb(runId, chunk);
      this.emitStreamingEvent('run:assistant-text', { runId, text: chunk });
    }
  }

  private publishRunOutcome(
    runId: string,
    orgId: string,
    roleId: string,
    tokenCount: number,
    result: { status: string; sessionId: string | null; errorMessage: string | null },
  ): void {
    switch (result.status) {
      case 'succeeded':
        this.publishEvent('run:succeeded', { runId, orgId, roleId, tokenCount });
        break;
      case 'cancelled':
        this.publishEvent('run:cancelled', { runId, orgId, roleId, tokenCount });
        break;
      case 'suspended':
        this.publishEvent('run:suspended', { runId, orgId, roleId, tokenCount, sessionId: result.sessionId });
        break;
      default:
        this.publishEvent('run:failed', { runId, orgId, roleId, tokenCount, errorMessage: result.errorMessage ?? null });
        break;
    }
  }

  private cleanupRun(runId: string): void {
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
    if (currentCategory !== 'initial') return;

    const transitions = this.processEngine.getAvailableTransitions(orgId, task.status);
    const target = transitions.find(
      (t) => this.processEngine.getStatusCategory(orgId, t.to) === 'active',
    );
    if (!target) return;

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
    if (!initial) return;

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

const STRUCTURED_MARKER_PREFIXES = [
  '{"type":"tool_call_start"',
  '{"type":"tool_call_update"',
  '{"type":"plan"',
];

function isStructuredMarker(chunk: string): boolean {
  return STRUCTURED_MARKER_PREFIXES.some(p => chunk.startsWith(p));
}
