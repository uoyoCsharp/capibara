import { injectable } from 'tsyringe';
import type { IExecutor, ExecutorHandle, HandleLogCallback } from '../interfaces/i-executor';
import type { ExecutorInput, ExecutorOutput } from '../types/execution.types';
import type { WorkerService } from './worker-service';
import type { ChildMessage } from './worker-protocol';

@injectable()
export class UtilityProcessExecutor implements IExecutor {
  private logRouters = new Map<string, Set<HandleLogCallback>>();

  constructor(private readonly workerService: WorkerService) {
    this.workerService.onMessage((msg: ChildMessage) => {
      if (msg.type === 'run-log') {
        const callbacks = this.logRouters.get(msg.runId);
        if (callbacks) {
          for (const cb of callbacks) cb(msg.stream, msg.chunk);
        }
      }
    });
  }

  async spawn(input: ExecutorInput): Promise<ExecutorHandle> {
    const callbacks = new Set<HandleLogCallback>();
    this.logRouters.set(input.runId, callbacks);

    let spawned;
    try {
      spawned = await this.workerService.spawnRun({
        runId: input.runId,
        roleId: input.roleId,
        orgId: input.orgId,
        taskId: input.taskId,
        wakeReason: input.wakeReason,
        prompt: input.prompt,
        mcpConfigPath: input.mcpConfigPath,
        projectDir: input.projectDir,
        executor: input.executor,
        cliConfig: input.cliConfig,
        sessionId: input.sessionId,
      });
    } catch (err) {
      this.logRouters.delete(input.runId);
      throw err;
    }

    const completion = spawned.finished.then((result): ExecutorOutput => ({
      exitCode: result.exitCode,
      status: result.status as ExecutorOutput['status'],
      summary: result.summary,
      errorMessage: result.errorMessage,
      model: result.model,
      sessionId: result.sessionId,
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
      cachedInputTokens: result.cachedInputTokens,
    })).finally(() => {
      this.logRouters.delete(input.runId);
    });

    return {
      runId: input.runId,
      pid: spawned.pid,
      complete: () => completion,
      cancel: () => this.workerService.cancelRun(input.runId),
      onLog: (cb) => { callbacks.add(cb); },
    };
  }
}
