import { spawn, execSync, type ChildProcess } from 'node:child_process';
import type { ICliAdapter, CliAdapterContext, CliAdapterResult } from './i-cli-adapter';
import { parseClaudeStreamJson } from './claude-stream-parser';

const isDev = process.env.NODE_ENV !== 'production';

const MANAGED_FLAGS = [
  '--dangerously-skip-permissions',
  '--output-format',
  '--model',
  '--effort',
  '--max-turns',
  '--resume',
  '--mcp-config',
  '--strict-mcp-config',
  '--verbose',
  '--print',
  '-p',
];

export class ClaudeCliAdapter implements ICliAdapter {
  readonly name = 'claude-cli';
  private readonly children = new Map<string, ChildProcess>();

  execute(ctx: CliAdapterContext): Promise<CliAdapterResult> {
    return this.doExecute(ctx, false);
  }

  abort(runId: string): void {
    const child = this.children.get(runId);
    if (!child || !child.pid) return;

    if (process.platform === 'win32') {
      try {
        execSync(`taskkill /T /F /PID ${child.pid}`, { stdio: 'ignore' });
      } catch {
        // Process may have already exited
      }
    } else {
      child.kill('SIGTERM');
      setTimeout(() => {
        if (!child.killed) child.kill('SIGKILL');
      }, 5000);
    }
  }

  private async doExecute(ctx: CliAdapterContext, isSessionRetry: boolean): Promise<CliAdapterResult> {
    const args = this.buildArgs(ctx, isSessionRetry);
    const env = this.buildEnv();
    const timeoutMs = ctx.cliConfig?.timeoutMs ?? 0;

    return new Promise((resolve, reject) => {
      let stdout = '';
      let stderr = '';
      let timedOut = false;
      let timer: ReturnType<typeof setTimeout> | null = null;

      if (isDev) {
        ctx.onLog('stderr', `[capibara:debug] Spawning Claude CLI: args=${JSON.stringify(args)} projectDir=${ctx.projectDir} sessionId=${ctx.sessionId ?? 'none'}\n`);
      }

      const proc = spawn('claude', args, {
        cwd: ctx.projectDir,
        stdio: ['pipe', 'pipe', 'pipe'],
        env,
        shell: process.platform === 'win32',
      });

      this.children.set(ctx.runId, proc);

      proc.stdin!.write(ctx.prompt);
      proc.stdin!.end();

      if (timeoutMs > 0) {
        timer = setTimeout(() => {
          timedOut = true;
          proc.kill('SIGTERM');
          setTimeout(() => { if (!proc.killed) proc.kill('SIGKILL'); }, 5000);
        }, timeoutMs);
      }

      proc.stdout?.on('data', (data: Buffer) => {
        const chunk = data.toString();
        stdout += chunk;
        ctx.onLog('stdout', chunk);
      });

      proc.stderr?.on('data', (data: Buffer) => {
        const chunk = data.toString();
        stderr += chunk;
        ctx.onLog('stderr', chunk);
      });

      proc.on('error', (err) => {
        this.children.delete(ctx.runId);
        if (timer) clearTimeout(timer);
        reject(err);
      });

      proc.on('close', (code, signal) => {
        this.children.delete(ctx.runId);
        if (timer) clearTimeout(timer);

        const sessionError = this.isSessionError(stderr, stdout);
        if (!isSessionRetry && ctx.sessionId && sessionError) {
          ctx.onLog('stderr', `[capibara] Session "${ctx.sessionId}" unavailable; retrying fresh.\n`);
          this.doExecute(ctx, true).then(resolve, reject);
          return;
        }

        const parsed = parseClaudeStreamJson(stdout);
        if (isDev) {
          ctx.onLog('stderr', `[capibara:debug] Claude CLI exited: code=${code} signal=${signal ?? 'none'} timedOut=${timedOut} model=${parsed.model} sessionId=${parsed.sessionId} tokens=${parsed.inputTokens}/${parsed.outputTokens} isError=${parsed.isError}\n`);
        }

        const status: CliAdapterResult['status'] = timedOut
          ? 'failed'
          : (code ?? 1) === 0 ? 'succeeded' : 'failed';

        const errorMessage = status === 'failed'
          ? (timedOut ? `Timed out after ${timeoutMs}ms` : null)
            ?? parsed.errorMessage
            ?? (stderr.trim() || null)
          : null;

        resolve({
          exitCode: code,
          signal: signal ?? null,
          status,
          timedOut,
          summary: parsed.summary,
          errorMessage,
          model: parsed.model,
          sessionId: parsed.sessionId,
          inputTokens: parsed.inputTokens,
          outputTokens: parsed.outputTokens,
          cachedInputTokens: parsed.cachedInputTokens,
          clearSession: isSessionRetry || sessionError,
        });
      });
    });
  }

  private buildArgs(ctx: CliAdapterContext, skipSession: boolean): string[] {
    const args = [
      '--print',
      '--output-format', 'stream-json',
      '--verbose',
      '--dangerously-skip-permissions',
    ];

    if (ctx.mcpConfigPath) args.push('--mcp-config', ctx.mcpConfigPath, '--strict-mcp-config');
    if (ctx.cliConfig?.model) args.push('--model', ctx.cliConfig.model);
    if (ctx.cliConfig?.maxTurnsPerRun && ctx.cliConfig.maxTurnsPerRun > 0) {
      args.push('--max-turns', String(ctx.cliConfig.maxTurnsPerRun));
    }
    if (ctx.cliConfig?.effort) args.push('--effort', ctx.cliConfig.effort);
    if (ctx.sessionId && !skipSession) args.push('--resume', ctx.sessionId);

    if (ctx.cliConfig?.extraArgs?.length) {
      const cleaned = ctx.cliConfig.extraArgs.filter((arg) =>
        !MANAGED_FLAGS.some((flag) => arg === flag || arg.startsWith(`${flag}=`)),
      );
      if (cleaned.length > 0) args.push(...cleaned);
    }

    return args;
  }

  private buildEnv(): NodeJS.ProcessEnv {
    const env = { ...process.env };
    delete env.CLAUDECODE;
    delete env.CLAUDE_CODE_ENTRYPOINT;
    delete env.CLAUDE_CODE_SESSION;
    delete env.CLAUDE_CODE_PARENT_SESSION;
    delete env.CLAUDE_AGENT_SDK;
    return env;
  }

  private isSessionError(stderr: string, stdout: string): boolean {
    const combined = `${stdout}\n${stderr}`;
    return /unknown session|session not found|invalid session/i.test(combined);
  }
}
