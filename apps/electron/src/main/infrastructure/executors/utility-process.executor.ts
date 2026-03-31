import { spawn, type ChildProcess } from 'node:child_process';
import { injectable, inject } from 'tsyringe';
import type { IExecutor, ExecutorInput, ExecutorOutput } from '@main/core/interfaces/i-executor.js';
import type { ILogger } from '@main/core/interfaces/i-logger.js';
import { LOGGER_TOKEN } from '@main/core/tokens.js';
import { MAX_RUN_OUTPUT_BYTES } from '@main/core/constants/run.constants.js';

/**
 * Spawns Claude Code CLI (or other executor) as a child process.
 * Streams stdout/stderr and supports abort.
 *
 * See Architecture §7.5 — UtilityProcess Executor.
 */
@injectable()
export class UtilityProcessExecutor implements IExecutor {
  private activeRuns = new Map<string, ChildProcess>();

  constructor(
    @inject(LOGGER_TOKEN) private readonly logger: ILogger,
  ) {}

  async execute(input: ExecutorInput): Promise<ExecutorOutput> {
    this.logger.info('UtilityProcessExecutor: spawning', {
      runId: input.runId,
      executor: input.executor,
      projectDir: input.projectDir,
    });

    return new Promise<ExecutorOutput>((resolve) => {
      const args = this.buildArgs(input);
      const command = this.resolveCommand(input.executor);

      const child = spawn(command, args, {
        cwd: input.projectDir,
        stdio: ['pipe', 'pipe', 'pipe'],
        env: {
          ...process.env,
          CLAUDE_MCP_CONFIG: input.mcpConfigPath,
        },
        shell: process.platform === 'win32',
      });

      this.activeRuns.set(input.runId, child);

      const stdoutChunks: Buffer[] = [];
      const stderrChunks: Buffer[] = [];
      let totalBytes = 0;

      child.stdout?.on('data', (chunk: Buffer) => {
        totalBytes += chunk.length;
        if (totalBytes <= MAX_RUN_OUTPUT_BYTES) {
          stdoutChunks.push(chunk);
        }
      });

      child.stderr?.on('data', (chunk: Buffer) => {
        totalBytes += chunk.length;
        if (totalBytes <= MAX_RUN_OUTPUT_BYTES) {
          stderrChunks.push(chunk);
        }
      });

      // Send prompt via stdin
      if (child.stdin) {
        child.stdin.write(input.prompt);
        child.stdin.end();
      }

      child.on('close', (code) => {
        this.activeRuns.delete(input.runId);
        resolve({
          exitCode: code ?? 1,
          stdout: Buffer.concat(stdoutChunks).toString('utf-8'),
          stderr: Buffer.concat(stderrChunks).toString('utf-8'),
        });
      });

      child.on('error', (err) => {
        this.activeRuns.delete(input.runId);
        this.logger.error('Executor spawn error', { runId: input.runId, error: String(err) });
        resolve({
          exitCode: 1,
          stdout: '',
          stderr: `Failed to spawn executor: ${String(err)}`,
        });
      });
    });
  }

  abort(runId: string): void {
    const child = this.activeRuns.get(runId);
    if (child) {
      child.kill('SIGTERM');
      // Force kill after 5 seconds if still running
      setTimeout(() => {
        if (!child.killed) {
          child.kill('SIGKILL');
        }
      }, 5000);
      this.activeRuns.delete(runId);
      this.logger.info('Run aborted', { runId });
    }
  }

  private resolveCommand(executor: string): string {
    switch (executor) {
      case 'claude-cli':
      case 'claude':
        return 'claude';
      case 'codex':
        return 'codex';
      default:
        return executor;
    }
  }

  private buildArgs(input: ExecutorInput): string[] {
    const executor = input.executor;

    switch (executor) {
      case 'claude-cli':
      case 'claude':
        return [
          '--print',
          '--dangerously-skip-permissions',
          '--mcp-config', input.mcpConfigPath,
          input.prompt,
        ];
      default:
        // Generic: pass prompt as argument
        return [input.prompt];
    }
  }
}
