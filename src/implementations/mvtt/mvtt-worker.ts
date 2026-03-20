/**
 * MVTT Worker Implementation
 *
 * Thin layer: delegates to ICommandExecutor for execution.
 * Does not directly depend on any CLI/Shell/API infrastructure.
 * @module implementations/mvtt/mvtt-worker
 */

import type { IWorker } from '../../core/interfaces/worker.interface.js';
import type { ICommandExecutor } from '../../core/interfaces/command-executor.interface.js';
import type { WorkerCommand, WorkerResult } from '../../core/types/worker.types.js';
import type { AutomationConfig } from '../../core/types/config.types.js';
import type { IEventBus } from '../../core/interfaces/event-bus.interface.js';
import type { Logger } from 'pino';

export class MvttWorker implements IWorker {
  private currentSessionId?: string;

  constructor(
    private executor: ICommandExecutor,
    private config: AutomationConfig,
    private logger: Logger,
    private eventBus: IEventBus,
  ) {}

  async executeCommand(command: WorkerCommand): Promise<WorkerResult> {
    this.logger.info({ command: command.command }, 'MvttWorker executing');

    const response = await this.executor.execute({
      input: command.input,
      systemPrompt: command.systemPrompt,
      systemPromptFile: command.systemPromptFile,
      cwd: command.cwd ?? this.config.cli.projectDir,
      timeout: command.timeout ?? this.config.worker.defaultTimeout,
      options: {
        sessionId: command.executorOptions?.sessionId,
        resume: command.executorOptions?.resume,
        maxTurns: command.executorOptions?.maxTurns
          ?? this.config.worker.defaultMaxTurns,
        allowedTools: command.executorOptions?.allowedTools,
        disallowedTools: command.executorOptions?.disallowedTools,
        outputFormat: 'json',
      },
    });

    this.currentSessionId = response.metadata.sessionId as string | undefined;

    this.logger.info(
      { success: response.success, duration: response.duration, cost: response.metadata.costUsd },
      'MvttWorker completed',
    );

    return {
      success: response.success,
      output: response.output,
      artifact: '',
      duration: response.duration,
      metadata: response.metadata,
    };
  }

  getSessionId(): string | undefined {
    return this.currentSessionId;
  }

  getRegisteredStrategies(): string[] {
    return [this.executor.type];
  }
}
