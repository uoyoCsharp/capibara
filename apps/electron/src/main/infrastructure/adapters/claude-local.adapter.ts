/**
 * Claude Code CLI adapter.
 *
 * Handles the full lifecycle of invoking `claude` CLI:
 * - Argument building (--model, --effort, --max-turns, --resume, etc.)
 * - Process spawning via shared process-utils (chcp 65001, StringDecoder, etc.)
 * - stream-json output parsing
 * - Session resume with automatic fresh-session retry
 * - Login/auth detection
 * - Timeout with configurable grace period
 * - extraArgs conflict deduplication
 *
 * Reference: AgentCompany adapter-claude-local/src/server/execute.ts
 */

import { type ChildProcess, execSync } from 'node:child_process';
import type {
  ICliAdapter,
  AdapterExecutionContext,
  AdapterExecutionResult,
} from '@main/core/interfaces/i-cli-adapter.js';
import {
  parseClaudeStreamJson,
  detectClaudeLoginRequired,
  describeClaudeFailure,
} from '../executors/claude-stream-parser.js';
import {
  buildCleanEnv,
  ensureCommandResolvable,
  filterConflictingArgs,
  runChildProcess,
  type RunProcessResult,
} from './process-utils.js';

/** Default grace period (ms) between SIGTERM and SIGKILL on timeout */
const DEFAULT_GRACE_MS = 20_000;

/** Flags the adapter manages — will be stripped from extraArgs to prevent duplication */
const MANAGED_FLAGS = [
  '--dangerously-skip-permissions',
  '--output-format',
  '--model',
  '--effort',
  '--max-turns',
  '--resume',
  '--mcp-config',
  '--verbose',
  '--print',
];

export class ClaudeLocalAdapter implements ICliAdapter {
  readonly name = 'claude-cli';

  /** Track running child processes for abort support */
  private readonly childTracker = new Map<string, ChildProcess>();

  execute(ctx: AdapterExecutionContext): Promise<AdapterExecutionResult> {
    return this.doExecute(ctx, false);
  }

  abort(runId: string): void {
    const child = this.childTracker.get(runId);
    if (!child || !child.pid) return;

    if (process.platform === 'win32') {
      // On Windows, the child is cmd.exe wrapping the actual CLI process.
      // child.kill() only terminates cmd.exe, leaving the CLI orphaned.
      // Use taskkill /T /F to kill the entire process tree.
      try {
        execSync(`taskkill /T /F /PID ${child.pid}`, { stdio: 'ignore' });
      } catch {
        // Process may have already exited
      }
    } else {
      // On Unix, send SIGTERM then SIGKILL after grace period
      child.kill('SIGTERM');
      setTimeout(() => {
        if (!child.killed) child.kill('SIGKILL');
      }, 5000);
    }
  }

  private async doExecute(
    ctx: AdapterExecutionContext,
    isRetryAfterSessionError: boolean,
  ): Promise<AdapterExecutionResult> {
    const command = this.resolveCommand();
    const args = this.buildArgs(ctx, isRetryAfterSessionError);
    const env = buildCleanEnv({
      CLAUDE_MCP_CONFIG: ctx.mcpConfigPath,
    });
    const timeoutMs = ctx.cliConfig.timeoutMs ?? 0;
    const graceMs = DEFAULT_GRACE_MS;

    // Pre-flight: verify command exists in PATH
    await ensureCommandResolvable(command, ctx.projectDir, env);

    // Spawn via shared process runner (handles StringDecoder, chcp 65001, GBK, etc.)
    const proc = await runChildProcess(ctx.runId, command, args, {
      cwd: ctx.projectDir,
      env,
      stdin: ctx.prompt,
      timeoutMs,
      graceMs,
      onLog: ctx.onLog,
      childTracker: this.childTracker,
    });

    return this.processResult(ctx, proc, isRetryAfterSessionError, timeoutMs);
  }

  private async processResult(
    ctx: AdapterExecutionContext,
    proc: RunProcessResult,
    isRetryAfterSessionError: boolean,
    timeoutMs: number,
  ): Promise<AdapterExecutionResult> {
    const { stdout, stderr, exitCode, timedOut } = proc;
    const parsed = parseClaudeStreamJson(stdout);

    // Detect login requirement
    const loginCheck = detectClaudeLoginRequired({
      parsed: parsed.resultJson,
      stdout,
      stderr,
    });

    // Detect session error — retry once with fresh session
    if (
      !isRetryAfterSessionError &&
      ctx.sessionId &&
      this.isUnknownSessionError(stderr, stdout)
    ) {
      ctx.onLog('stderr', `[capibara] Session "${ctx.sessionId}" unavailable; retrying with fresh session.\n`);
      return this.doExecute(ctx, true);
    }

    const status: AdapterExecutionResult['status'] = timedOut
      ? 'failed'
      : (exitCode ?? 1) === 0
        ? 'succeeded'
        : 'failed';

    const errorMessage = status === 'failed'
      ? (timedOut ? `Timed out after ${timeoutMs}ms` : null)
        ?? (parsed.resultJson ? describeClaudeFailure(parsed.resultJson) : null)
        ?? (stderr.trim()
          ? `Claude exited with code ${exitCode ?? -1}: ${stderr.split('\n').map(l => l.trim()).find(Boolean) ?? ''}`
          : `Claude exited with code ${exitCode ?? -1}`)
      : null;

    return {
      exitCode,
      signal: proc.signal,
      status,
      timedOut,
      summary: parsed.summary || null,
      errorMessage,
      model: parsed.model || null,
      sessionId: parsed.sessionId || null,
      inputTokens: parsed.usage?.inputTokens ?? 0,
      outputTokens: parsed.usage?.outputTokens ?? 0,
      cachedInputTokens: parsed.usage?.cachedInputTokens ?? 0,
      clearSession: isRetryAfterSessionError || this.isUnknownSessionError(stderr, stdout),
      requiresLogin: loginCheck.requiresLogin,
      loginUrl: loginCheck.loginUrl,
    };
  }

  private resolveCommand(): string {
    return 'claude';
  }

  private buildArgs(
    ctx: AdapterExecutionContext,
    skipSessionResume: boolean,
  ): string[] {
    const args = [
      '--print',
      '--output-format', 'stream-json',
      '--verbose',
      '--dangerously-skip-permissions',
    ];

    // MCP config
    if (ctx.mcpConfigPath) {
      args.push('--mcp-config', ctx.mcpConfigPath);
    }

    // Model override
    if (ctx.cliConfig.model) {
      args.push('--model', ctx.cliConfig.model);
    }

    // Max turns
    if (ctx.cliConfig.maxTurnsPerRun && ctx.cliConfig.maxTurnsPerRun > 0) {
      args.push('--max-turns', String(ctx.cliConfig.maxTurnsPerRun));
    }

    // Thinking effort
    if (ctx.cliConfig.effort) {
      args.push('--effort', ctx.cliConfig.effort);
    }

    // Session resume
    if (ctx.sessionId && !skipSessionResume) {
      args.push('--resume', ctx.sessionId);
    }

    // Extra args — filter out flags the adapter already manages
    if (ctx.cliConfig.extraArgs?.length) {
      const cleaned = filterConflictingArgs(ctx.cliConfig.extraArgs, MANAGED_FLAGS);
      if (cleaned.length > 0) {
        args.push(...cleaned);
      }
    }

    return args;
  }

  private isUnknownSessionError(stderr: string, stdout: string): boolean {
    const combined = `${stdout}\n${stderr}`;
    return /unknown session|session not found|invalid session/i.test(combined);
  }
}
