/**
 * Shell Command Executor
 *
 * Executes arbitrary shell commands, collecting stdout/stderr.
 * options.command specifies the command to execute.
 * request.input is sent via stdin.
 * @module infrastructure/executors/shell-executor
 */

import { spawn } from 'node:child_process';
import type { ICommandExecutor } from '../../core/interfaces/command-executor.interface.js';
import type { CommandRequest, CommandResponse } from '../../core/types/command-executor.types.js';
import type { Logger } from 'pino';

export class ShellExecutor implements ICommandExecutor {
  readonly type = 'shell-command';

  constructor(private logger: Logger) {}

  async execute(request: CommandRequest): Promise<CommandResponse> {
    const command = request.options.command as string;
    if (!command) {
      return {
        success: false,
        output: 'ShellExecutor: options.command is required',
        duration: 0,
        metadata: { exitCode: 1 },
      };
    }

    const startTime = Date.now();

    return new Promise<CommandResponse>((resolve) => {
      const proc = spawn(command, {
        cwd: request.cwd,
        env: {
          ...process.env,
          ...(request.options.env as Record<string, string> | undefined),
        },
        shell: true,
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      if (request.input) {
        proc.stdin.write(request.input);
        proc.stdin.end();
      } else {
        proc.stdin.end();
      }

      let stdout = '';
      let stderr = '';
      let settled = false;

      proc.stdout.on('data', (data: Buffer) => { stdout += data.toString(); });
      proc.stderr.on('data', (data: Buffer) => { stderr += data.toString(); });

      const settle = (response: CommandResponse) => {
        if (settled) return;
        settled = true;
        if (timer) clearTimeout(timer);
        resolve(response);
      };

      const timer = request.timeout
        ? setTimeout(() => {
            proc.kill('SIGTERM');
            settle({
              success: false,
              output: `ShellExecutor: command timed out after ${request.timeout}ms`,
              duration: Date.now() - startTime,
              metadata: { exitCode: -1, stderr },
            });
          }, request.timeout)
        : null;

      let stdoutEnded = false;
      let stderrEnded = false;
      let exitCode: number | null = null;
      let exited = false;

      const trySettle = () => {
        if (!stdoutEnded || !stderrEnded || !exited) return;
        settle({
          success: exitCode === 0,
          output: stdout,
          duration: Date.now() - startTime,
          metadata: { exitCode: exitCode ?? 1, stderr },
        });
      };

      proc.stdout.on('end', () => { stdoutEnded = true; trySettle(); });
      proc.stderr.on('end', () => { stderrEnded = true; trySettle(); });
      proc.on('close', (code) => { exitCode = code; exited = true; trySettle(); });
      proc.on('error', (err) => {
        settle({
          success: false,
          output: err.message,
          duration: Date.now() - startTime,
          metadata: { exitCode: 1, stderr: err.message },
        });
      });
    });
  }

  async validate(): Promise<boolean> {
    return true;
  }
}
