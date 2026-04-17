import { injectable } from 'tsyringe';
import type { IExecutor } from '../interfaces/i-executor';
import type { ExecutorInput, ExecutorOutput, ExecutorLogCallback } from '../types/execution.types';
import type { WorkerService } from './worker-service';
import type { ChildMessage } from './worker-protocol';

@injectable()
export class UtilityProcessExecutor implements IExecutor {
  private logCallbacks: ExecutorLogCallback[] = [];

  constructor(private readonly workerService: WorkerService) {
    this.workerService.onMessage((msg: ChildMessage) => {
      if (msg.type === 'run-log') {
        for (const cb of this.logCallbacks) {
          cb(msg.runId, msg.stream, msg.chunk);
        }
      }
    });
  }

  async execute(input: ExecutorInput): Promise<ExecutorOutput> {
    const result = await this.workerService.enqueueRun({
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

    return {
      exitCode: result.exitCode,
      status: result.status as ExecutorOutput['status'],
      summary: result.summary,
      errorMessage: result.errorMessage,
      model: result.model,
      sessionId: result.sessionId,
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
      cachedInputTokens: result.cachedInputTokens,
    };
  }

  abort(runId: string): void {
    this.workerService.cancelRun(runId);
  }

  onLog(callback: ExecutorLogCallback): void {
    this.logCallbacks.push(callback);
  }
}
