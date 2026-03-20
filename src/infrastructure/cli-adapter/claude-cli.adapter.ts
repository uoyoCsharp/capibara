/**
 * Claude CLI Adapter - Encapsulates CLI process spawn, argument building and output collection
 * @module infrastructure/cli-adapter/claude-cli-adapter
 */

import { spawn } from 'node:child_process';
import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { inject, injectable } from 'tsyringe';
import { CONFIG_TOKEN, LOGGER_TOKEN } from '../../tokens.js';
import type { AutomationConfig } from '../../core/types/config.types.js';
import type { ClaudeCliOptions, ClaudeCliResult } from '../../core/types/cli.types.js';
import type { Logger } from 'pino';
import { CliExecutionError, CliTimeoutError } from '../../core/errors/cli.errors.js';

interface ResolvedCommand {
  command: string;
  prefixArgs: string[];
  shell: boolean;
}

@injectable()
export class ClaudeCliAdapter {
  private readonly cliPath: string;
  private resolvedCommand: ResolvedCommand | null = null;

  constructor(
    @inject(CONFIG_TOKEN) private config: AutomationConfig,
    @inject(LOGGER_TOKEN) private logger: Logger,
  ) {
    this.cliPath = config.cli.cliPath;
  }

  /** Execute a single Claude CLI call */
  async execute(options: ClaudeCliOptions): Promise<ClaudeCliResult> {
    const startTime = Date.now();
    const resolved = this.resolveCommand();

    // Write system prompt to a temp file when no explicit file is provided.
    // This avoids Windows command-line length limits (~8K for cmd.exe).
    let tempDir: string | null = null;
    let effectiveOptions = options;

    if (options.systemPrompt && !options.systemPromptFile) {
      tempDir = mkdtempSync(join(tmpdir(), 'capibara-'));
      const filePath = join(tempDir, 'system-prompt.md');
      writeFileSync(filePath, options.systemPrompt, 'utf-8');
      effectiveOptions = { ...options, systemPromptFile: filePath };
      this.logger.debug(
        { file: filePath, length: options.systemPrompt.length },
        'System prompt written to temp file',
      );
    }

    const args = this.buildArgs(effectiveOptions);
    this.logger.debug({ args: this.redactArgs(args) }, 'CLI execute');

    try {
      return await this.spawnAndCollect(resolved, args, effectiveOptions, startTime);
    } finally {
      if (tempDir) {
        try {
          rmSync(tempDir, { recursive: true, force: true });
        } catch {
          /* ignore */
        }
      }
    }
  }

  /** Core spawn logic: sends prompt via stdin, waits for streams + close */
  private spawnAndCollect(
    resolved: ResolvedCommand,
    args: string[],
    options: ClaudeCliOptions,
    startTime: number,
  ): Promise<ClaudeCliResult> {
    return new Promise<ClaudeCliResult>((resolve, reject) => {
      const fullCommand = resolved.shell
        ? `${resolved.command} ${[...resolved.prefixArgs, ...args].join(' ')}`
        : `${resolved.command} ${[...resolved.prefixArgs, ...args].join(' ')}`;
      this.logger.debug({ command: fullCommand, shell: resolved.shell }, 'Spawning CLI process');

      // Clean environment to prevent debugger injection from parent process
      const cleanEnv = { ...process.env };
      delete cleanEnv.NODE_OPTIONS;

      const proc = spawn(resolved.command, [...resolved.prefixArgs, ...args], {
        cwd: options.cwd ?? this.config.cli.projectDir,
        env: cleanEnv,
        stdio: ['pipe', 'pipe', 'pipe'],
        shell: resolved.shell,
      });

      let spawned = false;
      let stdout = '';
      let stderr = '';
      let settled = false;
      let stdoutEnded = false;
      let stderrEnded = false;
      let exitCode: number | null = null;
      let exited = false;
      let epipeDetected = false;

      const settle = (result: ClaudeCliResult | Error) => {
        if (settled) return;
        settled = true;
        if (timer) clearTimeout(timer);
        if (result instanceof Error) reject(result);
        else resolve(result);
      };

      // Timeout protection
      const timer = options.timeout
        ? setTimeout(() => {
            this.logger.warn('CLI execution timed out');
            proc.kill('SIGTERM');
            settle(new CliTimeoutError(options.timeout!));
          }, options.timeout)
        : null;

      // Register spawn listener directly (NOT in setImmediate).
      // Node.js emits 'spawn' via nextTick which runs BEFORE setImmediate,
      // so wrapping in setImmediate would cause the listener to miss the event.
      proc.once('spawn', () => {
        spawned = true;
        this.logger.debug('CLI process spawned successfully');

        // Write prompt to stdin only after process is confirmed running
        try {
          proc.stdin.write(options.prompt);
          proc.stdin.end();
        } catch (writeErr) {
          this.logger.warn({ err: writeErr }, 'stdin write failed');
        }
      });

      // Handle process errors
      proc.on('error', (err) => {
        this.logger.error({ err, command: fullCommand }, 'CLI process error');
        settle(new CliExecutionError(`CLI process error: ${err.message}`));
      });

      // Handle stdin errors (EPIPE when process exits before reading stdin)
      proc.stdin.on('error', (err: Error & { code?: string }) => {
        if (err.message.includes('EPIPE') || err.code === 'EPIPE') {
          epipeDetected = true;
          this.logger.debug('CLI process exited before stdin was consumed (EPIPE)');
          // Don't settle yet - wait for process to fully exit
        } else {
          this.logger.warn({ err }, 'stdin error');
        }
      });

      // Collect stdout data
      proc.stdout.on('data', (data: Buffer) => {
        stdout += data.toString();
      });

      // Collect stderr data
      proc.stderr.on('data', (data: Buffer) => {
        stderr += data.toString();
      });

      // Try to settle when all conditions are met
      const trySettle = () => {
        this.logger.debug(
          {
            epipeDetected,
            stdoutLen: stdout.length,
            stdoutEnded,
            stderrEnded,
            exited,
            exitCode,
            spawned,
          },
          'trySettle check',
        );

        // If EPIPE was detected with no output, it's a failure
        // Note: exitCode can be 0 (process succeeded) but stdin wasn't consumed
        if (epipeDetected && !stdout) {
          this.logger.warn(
            { exitCode, epipeDetected, stdout: stdout.slice(0, 200) },
            'EPIPE detected - process exited before consuming stdin',
          );
          settle({
            success: false,
            output: stdout,
            sessionId: '',
            exitCode: exitCode ?? 1,
            duration: Date.now() - startTime,
          });
          return;
        }

        if (!stdoutEnded || !stderrEnded || !exited) return;

        const duration = Date.now() - startTime;
        if (stderr) {
          this.logger.warn({ stderr: stderr.slice(0, 500) }, 'CLI stderr output');
        }

        // If spawned is false, the process never started properly
        if (!spawned) {
          this.logger.error('CLI process never spawned');
          settle(new CliExecutionError('CLI process failed to start'));
          return;
        }

        settle({
          success: exitCode === 0,
          output: stdout,
          sessionId: this.extractSessionId(stdout, options),
          exitCode: exitCode ?? 1,
          duration,
        });
      };

      proc.stdout.on('end', () => {
        stdoutEnded = true;
        trySettle();
      });
      proc.stderr.on('end', () => {
        stderrEnded = true;
        trySettle();
      });
      proc.on('close', (code) => {
        exitCode = code;
        exited = true;
        trySettle();
      });

      // Fallback: If process closes very quickly without spawning, handle it
      proc.on('exit', (code, signal) => {
        this.logger.debug({ code, signal }, 'Process exited');
        if (!spawned && code !== 0) {
          // Process exited with error before even spawning
          this.logger.error({ code }, 'Process exited before spawning');
        }
      });
    });
  }

  /**
   * Resolve the CLI command for the current platform.
   * On Windows, npm global packages are .cmd wrappers that break when spawn
   * passes arguments containing newlines through cmd.exe.
   * This method parses the .cmd file to extract the actual node + script path,
   * allowing direct spawn without shell.
   */
  private resolveCommand(): ResolvedCommand {
    if (this.resolvedCommand) return this.resolvedCommand;

    if (process.platform === 'win32') {
      try {
        const wherePaths = execSync(`where ${this.cliPath}`, { encoding: 'utf-8' })
          .trim()
          .split('\r\n');

        // Prefer the .cmd file; `where` may return the extensionless shell script first
        const cmdPath =
          wherePaths.find((p) => p.endsWith('.cmd') || p.endsWith('.bat')) ?? wherePaths[0];

        if (cmdPath.endsWith('.cmd') || cmdPath.endsWith('.bat')) {
          const content = readFileSync(cmdPath, 'utf-8');
          const cmdDir = dirname(cmdPath);

          // npm .cmd files use pattern: "%_prog%" "%dp0%\node_modules\...\cli.js" %*
          // or: @"%~dp0\node.exe" "%~dp0\node_modules\...\cli.js" %*
          const scriptMatch =
            content.match(/"%(?:dp0|~dp0)%\\([^"]+\.js)"/i) ||
            content.match(/"%~dp0\\([^"]+\.js)"/i);

          if (scriptMatch) {
            const scriptPath = join(cmdDir, scriptMatch[1]);

            if (existsSync(scriptPath)) {
              this.logger.debug(
                { node: process.execPath, script: scriptPath },
                'Resolved Windows .cmd to node script',
              );
              this.resolvedCommand = {
                command: process.execPath,
                prefixArgs: [scriptPath],
                shell: false,
              };
              return this.resolvedCommand;
            }
          }
        }
      } catch (err) {
        this.logger.debug({ err }, 'Failed to resolve Windows .cmd, falling back to shell mode');
      }

      // Fallback: use shell: true (works for non-.cmd executables)
      this.resolvedCommand = { command: this.cliPath, prefixArgs: [], shell: true };
      return this.resolvedCommand;
    }

    // Unix: spawn directly, no shell needed
    this.resolvedCommand = { command: this.cliPath, prefixArgs: [], shell: false };
    return this.resolvedCommand;
  }

  /**
   * Build CLI argument array.
   * - The prompt is NOT included; it is sent via stdin in execute().
   * - The system prompt is passed via --system-prompt-file to avoid
   *   Windows command-line length limits.
   */
  private buildArgs(options: ClaudeCliOptions): string[] {
    const args: string[] = ['--print', '--output-format', options.outputFormat ?? 'json'];

    if (options.systemPromptFile) {
      args.push('--system-prompt-file', options.systemPromptFile);
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

  /** Redact sensitive file paths in logs */
  private redactArgs(args: string[]): string[] {
    return args.map((a, i) => (args[i - 1] === '--system-prompt-file' ? '[FILE]' : a));
  }
}
