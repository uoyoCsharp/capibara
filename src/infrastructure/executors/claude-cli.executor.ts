/**
 * Claude CLI Command Executor
 *
 * Translates ICommandExecutor generic requests to ClaudeCliOptions,
 * delegating actual CLI invocation to ClaudeCliAdapter.
 *
 * systemPromptFile handling:
 * 1. If request.systemPromptFile is provided -> pass directly to CLI adapter
 * 2. If request.systemPrompt exists -> ClaudeCliAdapter auto-writes to temp file
 *    (adapter already implements this logic, see claude-cli.adapter.ts:46-55)
 * @module infrastructure/executors/claude-cli-executor
 */

import type { ICommandExecutor } from '../../core/interfaces/command-executor.interface.js';
import type { CommandRequest, CommandResponse } from '../../core/types/command-executor.types.js';
import type { ClaudeCliAdapter } from '../cli-adapter/claude-cli.adapter.js';
import type { ClaudeCliOptions } from '../../core/types/cli.types.js';
import type { Logger } from 'pino';

export class ClaudeCliExecutor implements ICommandExecutor {
  readonly type = 'claude-cli';

  constructor(
    private adapter: ClaudeCliAdapter,
    private logger: Logger,
  ) {}

  async execute(request: CommandRequest): Promise<CommandResponse> {
    const cliOptions = this.toCliOptions(request);
    const result = await this.adapter.execute(cliOptions);

    let costUsd = 0;
    let numTurns = 0;
    try {
      const parsed = JSON.parse(result.output);
      costUsd = parsed.total_cost_usd ?? 0;
      numTurns = parsed.num_turns ?? 0;
    } catch { /* non-JSON output, skip */ }

    return {
      success: result.success,
      output: result.output,
      duration: result.duration,
      metadata: {
        sessionId: result.sessionId,
        exitCode: result.exitCode,
        costUsd,
        numTurns,
      },
    };
  }

  async validate(): Promise<boolean> {
    try {
      const result = await this.adapter.execute({
        prompt: 'echo test',
        maxTurns: 1,
        timeout: 10_000,
      });
      return result.success;
    } catch {
      return false;
    }
  }

  private toCliOptions(request: CommandRequest): ClaudeCliOptions {
    const opts = request.options ?? {};
    return {
      prompt: request.input,
      systemPrompt: request.systemPrompt,
      systemPromptFile: request.systemPromptFile,
      sessionId: opts.sessionId as string | undefined,
      resume: opts.resume as boolean | undefined,
      maxTurns: opts.maxTurns as number | undefined,
      allowedTools: opts.allowedTools as string[] | undefined,
      disallowedTools: opts.disallowedTools as string[] | undefined,
      outputFormat: (opts.outputFormat as 'json' | 'text' | 'stream-json') ?? 'json',
      cwd: request.cwd,
      timeout: request.timeout,
    };
  }
}
