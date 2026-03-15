/**
 * Claude CLI Worker Implementation - Executes development tasks using persistent sessions
 * @module roles/worker/claude-cli-worker
 */

import { inject, injectable } from 'tsyringe';
import type { IWorker } from '../../core/interfaces/worker.interface.js';
import type { WorkerCommand, WorkerResult } from '../../core/types/worker.types.js';
import type { ClaudeCliJsonOutput } from '../../core/types/cli.types.js';
import { CLI_ADAPTER_TOKEN, CONFIG_TOKEN, LOGGER_TOKEN, EVENT_BUS_TOKEN } from '../../tokens.js';
import type { ClaudeCliAdapter } from '../../infrastructure/cli-adapter/claude-cli.adapter.js';
import type { AutomationConfig } from '../../core/types/config.types.js';
import type { IEventBus } from '../../core/interfaces/event-bus.interface.js';
import type { Logger } from 'pino';

@injectable()
export class ClaudeCliWorker implements IWorker {
  private currentSessionId?: string;

  constructor(
    @inject(CLI_ADAPTER_TOKEN) private cliAdapter: ClaudeCliAdapter,
    @inject(CONFIG_TOKEN) private config: AutomationConfig,
    @inject(LOGGER_TOKEN) private logger: Logger,
    @inject(EVENT_BUS_TOKEN) private eventBus: IEventBus,
  ) {}

  async executeCommand(command: WorkerCommand): Promise<WorkerResult> {
    this.logger.info(
      { command: command.command, sessionId: command.sessionId },
      'Worker executing',
    );

    const result = await this.cliAdapter.execute({
      prompt: command.input,
      systemPrompt: command.systemPrompt,
      sessionId: command.sessionId,
      resume: command.resume,
      maxTurns: command.maxTurns ?? this.config.worker.defaultMaxTurns,
      allowedTools: command.allowedTools,
      disallowedTools: command.disallowedTools,
      cwd: command.cwd ?? this.config.cli.projectDir,
      timeout: command.timeout ?? this.config.worker.defaultTimeout,
      outputFormat: 'json',
    });

    this.currentSessionId = result.sessionId;

    // Try to extract cost info from JSON output
    let costUsd = 0;
    let tokensUsed = 0;
    try {
      const parsed = JSON.parse(result.output) as ClaudeCliJsonOutput;
      costUsd = parsed.total_cost_usd ?? 0;
      tokensUsed = parsed.num_turns ?? 0;
    } catch {
      // Unable to parse cost, keep default values
    }

    this.logger.info(
      { success: result.success, duration: result.duration, cost: costUsd },
      'Worker completed',
    );

    return {
      success: result.success,
      output: result.output,
      artifact: '', // Artifacts are read from filesystem via ArtifactStore
      sessionId: result.sessionId,
      tokensUsed,
      costUsd,
      duration: result.duration,
    };
  }

  getSessionId(): string | undefined {
    return this.currentSessionId;
  }
}
