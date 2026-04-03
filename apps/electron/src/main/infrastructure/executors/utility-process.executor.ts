import { injectable, inject } from 'tsyringe';
import type { IExecutor, ExecutorInput, ExecutorOutput, ExecutorLogCallback } from '@main/core/interfaces/i-executor.js';
import type { ILogger } from '@main/core/interfaces/i-logger.js';
import { LOGGER_TOKEN } from '@main/core/tokens.js';
import type { WorkerService } from './worker-service.js';
import type { RunFinishedMessage } from './worker-protocol.js';
import type { WakeTrigger } from '@main/core/types/domain.types.js';

/**
 * Executor implementation backed by UtilityProcess WorkerService.
 * Delegates CLI execution to an isolated V8 process, receives structured
 * results with cost/usage/session data parsed from stream-json output.
 *
 * See Architecture §7.5 — UtilityProcess Executor.
 */
@injectable()
export class UtilityProcessExecutor implements IExecutor {
  private workerService!: WorkerService;
  private pendingRuns = new Map<string, {
    resolve: (output: ExecutorOutput) => void;
  }>();
  private logCallbacks: ExecutorLogCallback[] = [];

  constructor(
    @inject(LOGGER_TOKEN) private readonly logger: ILogger,
  ) {}

  /**
   * Inject WorkerService after construction (avoids circular DI).
   */
  setWorkerService(ws: WorkerService): void {
    this.workerService = ws;

    // Wire worker callbacks to route messages back to pending run promises
    ws.setCallbacks({
      onLog: (runId, stream, chunk) => {
        for (const cb of this.logCallbacks) {
          cb(runId, stream, chunk);
        }
      },
      onStatusChange: (runId, status, message) => {
        this.logger.debug('Run status change from worker', { runId, status, message });
      },
      onFinished: (event) => {
        this.handleRunFinished(event);
      },
    });
  }

  async execute(input: ExecutorInput): Promise<ExecutorOutput> {
    if (!this.workerService) {
      throw new Error('WorkerService not initialized');
    }

    return new Promise<ExecutorOutput>((resolve) => {
      this.pendingRuns.set(input.runId, { resolve });

      this.workerService.enqueueRun({
        runId: input.runId,
        roleId: input.roleId,
        orgId: input.orgId,
        taskNodeId: input.taskNodeId,
        trigger: input.trigger as WakeTrigger,
        prompt: input.prompt,
        mcpConfigPath: input.mcpConfigPath,
        projectDir: input.projectDir,
        executor: input.executor,
        cliConfig: input.cliConfig ?? {},
        sessionId: input.sessionId,
      });
    });
  }

  abort(runId: string): void {
    if (this.workerService) {
      this.workerService.cancelRun(runId);
    }
  }

  onLog(callback: ExecutorLogCallback): void {
    this.logCallbacks.push(callback);
  }

  private handleRunFinished(event: RunFinishedMessage): void {
    const pending = this.pendingRuns.get(event.runId);
    if (!pending) {
      this.logger.warn('Received run-finished for unknown run', { runId: event.runId });
      return;
    }

    this.pendingRuns.delete(event.runId);

    pending.resolve({
      exitCode: event.exitCode,
      status: event.status as ExecutorOutput['status'],
      summary: event.summary,
      errorMessage: event.errorMessage,
      model: event.model,
      sessionId: event.sessionId,
      inputTokens: event.inputTokens,
      outputTokens: event.outputTokens,
      cachedInputTokens: event.cachedInputTokens,
    });
  }
}
