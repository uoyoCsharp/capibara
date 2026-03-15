/**
 * Claude CLI Adapter - Encapsulates CLI process spawn, argument building and output collection
 * @module infrastructure/cli-adapter/claude-cli-adapter
 */

import { spawn } from 'node:child_process';
import { inject, injectable } from 'tsyringe';
import { CONFIG_TOKEN, LOGGER_TOKEN } from '../../tokens.js';
import type { AutomationConfig } from '../../core/types/config.types.js';
import type { ClaudeCliOptions, ClaudeCliResult } from '../../core/types/cli.types.js';
import type { Logger } from 'pino';
import { CliExecutionError, CliTimeoutError } from '../../core/errors/cli.errors.js';

@injectable()
export class ClaudeCliAdapter {
  private readonly cliPath: string;

  constructor(
    @inject(CONFIG_TOKEN) private config: AutomationConfig,
    @inject(LOGGER_TOKEN) private logger: Logger,
  ) {
    this.cliPath = config.cli.cliPath;
  }

  /** Execute a single Claude CLI call */
  async execute(options: ClaudeCliOptions): Promise<ClaudeCliResult> {
    const args = this.buildArgs(options);
    const startTime = Date.now();

    this.logger.debug({ args: this.redactArgs(args) }, 'CLI execute');

    return new Promise<ClaudeCliResult>((resolve, reject) => {
      const proc = spawn(this.cliPath, args, {
        cwd: options.cwd ?? this.config.cli.projectDir,
        env: { ...process.env },
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      let stdout = '';
      let stderr = '';

      proc.stdout.on('data', (data: Buffer) => {
        stdout += data.toString();
      });
      proc.stderr.on('data', (data: Buffer) => {
        stderr += data.toString();
      });

      // Timeout protection
      const timer = options.timeout
        ? setTimeout(() => {
            proc.kill('SIGTERM');
            reject(new CliTimeoutError(options.timeout!));
          }, options.timeout)
        : null;

      proc.on('close', (code) => {
        if (timer) clearTimeout(timer);
        const duration = Date.now() - startTime;

        if (stderr) {
          this.logger.warn({ stderr: stderr.slice(0, 500) }, 'CLI stderr output');
        }

        resolve({
          success: code === 0,
          output: stdout,
          sessionId: this.extractSessionId(stdout, options),
          exitCode: code ?? 1,
          duration,
        });
      });

      proc.on('error', (err) => {
        if (timer) clearTimeout(timer);
        reject(new CliExecutionError(err.message));
      });
    });
  }

  /** Build CLI argument array */
  private buildArgs(options: ClaudeCliOptions): string[] {
    const args: string[] = ['--print', '--output-format', options.outputFormat ?? 'json'];

    if (options.systemPrompt) {
      args.push('--system-prompt', options.systemPrompt);
    }
    if (options.appendSystemPrompt) {
      args.push('--append-system-prompt', options.appendSystemPrompt);
    }
    if (options.sessionId) {
      args.push('--session-id', options.sessionId);
    }
    if (options.resume) {
      args.push('--resume');
    }
    if (options.maxTurns) {
      args.push('--max-turns', String(options.maxTurns));
    }
    if (options.allowedTools?.length) {
      args.push('--allowedTools', options.allowedTools.join(','));
    }
    if (options.disallowedTools?.length) {
      args.push('--disallowedTools', options.disallowedTools.join(','));
    }

    // Skip permission confirmation in automation scenarios
    args.push('--dangerously-skip-permissions');
    args.push(options.prompt);

    return args;
  }

  /** Extract session ID from CLI JSON output */
  private extractSessionId(stdout: string, options: ClaudeCliOptions): string {
    if (options.sessionId) return options.sessionId;
    try {
      const parsed = JSON.parse(stdout);
      return parsed.session_id ?? '';
    } catch {
      return '';
    }
  }

  /** Redact sensitive system-prompt content in logs */
  private redactArgs(args: string[]): string[] {
    return args.map((a, i) => (args[i - 1] === '--system-prompt' ? '[REDACTED]' : a));
  }
}
