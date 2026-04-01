/**
 * Cross-platform child process utilities for CLI adapters.
 *
 * Handles:
 * - Command PATH resolution with platform-aware fallbacks
 * - Windows chcp 65001 UTF-8 forcing (instead of shell: true)
 * - StringDecoder for multi-byte character boundary handling
 * - GBK fallback detection for CJK environments
 * - Claude nesting env var cleanup
 * - Graceful shutdown with configurable grace period
 *
 * Reference: AgentCompany adapter-utils/src/server-utils.ts
 */

import { spawn, type ChildProcess } from 'node:child_process';
import { constants as fsConstants, promises as fs } from 'node:fs';
import path from 'node:path';
import { StringDecoder } from 'node:string_decoder';

// ─── Types ────────────────────────────────────────────────────────────

export interface RunProcessResult {
  exitCode: number | null;
  signal: string | null;
  timedOut: boolean;
  stdout: string;
  stderr: string;
}

export interface RunProcessOptions {
  cwd: string;
  env: NodeJS.ProcessEnv;
  stdin?: string;
  timeoutMs: number;
  graceMs: number;
  onLog: (stream: 'stdout' | 'stderr', chunk: string) => void;
  /** Optional map to register the child process for external abort support */
  childTracker?: Map<string, ChildProcess>;
}

interface SpawnTarget {
  command: string;
  args: string[];
}

// ─── Constants ────────────────────────────────────────────────────────

const MAX_CAPTURE_BYTES = 4 * 1024 * 1024;

/** Claude Code nesting guard env vars that must be stripped */
const CLAUDE_NESTING_VARS = [
  'CLAUDECODE',
  'CLAUDE_CODE_ENTRYPOINT',
  'CLAUDE_CODE_SESSION',
  'CLAUDE_CODE_PARENT_SESSION',
  'CLAUDE_AGENT_SDK',
] as const;

// ─── PATH utilities ───────────────────────────────────────────────────

function defaultPathForPlatform(): string {
  if (process.platform === 'win32') {
    const home = process.env.USERPROFILE ?? process.env.HOME ?? '';
    const appData = process.env.APPDATA ?? (home ? `${home}\\AppData\\Roaming` : '');
    const localAppData = process.env.LOCALAPPDATA ?? (home ? `${home}\\AppData\\Local` : '');
    return [
      'C:\\Windows\\System32',
      'C:\\Windows',
      'C:\\Windows\\System32\\Wbem',
      appData ? `${appData}\\npm` : '',
      localAppData ? `${localAppData}\\pnpm` : '',
      home ? `${home}\\.local\\bin` : '',
      home ? `${home}\\.cargo\\bin` : '',
      'C:\\Program Files\\nodejs',
    ].filter(Boolean).join(';');
  }
  return '/usr/local/bin:/opt/homebrew/bin:/usr/local/sbin:/usr/bin:/bin:/usr/sbin:/sbin';
}

export function ensurePathInEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  if (typeof env.PATH === 'string' && env.PATH.length > 0) return env;
  if (typeof env.Path === 'string' && env.Path.length > 0) return env;
  return { ...env, PATH: defaultPathForPlatform() };
}

// ─── Command resolution ───────────────────────────────────────────────

function windowsPathExts(env: NodeJS.ProcessEnv): string[] {
  return (env.PATHEXT ?? '.EXE;.CMD;.BAT;.COM').split(';').filter(Boolean);
}

async function pathExists(candidate: string): Promise<boolean> {
  try {
    await fs.access(candidate, process.platform === 'win32' ? fsConstants.F_OK : fsConstants.X_OK);
    return true;
  } catch {
    return false;
  }
}

async function resolveCommandPath(
  command: string,
  cwd: string,
  env: NodeJS.ProcessEnv,
): Promise<string | null> {
  const hasPathSeparator = command.includes('/') || command.includes('\\');
  if (hasPathSeparator) {
    const absolute = path.isAbsolute(command) ? command : path.resolve(cwd, command);
    return (await pathExists(absolute)) ? absolute : null;
  }

  const pathValue = env.PATH ?? env.Path ?? '';
  const delimiter = process.platform === 'win32' ? ';' : ':';
  const dirs = pathValue.split(delimiter).filter(Boolean);
  const exts = process.platform === 'win32' ? windowsPathExts(env) : [''];
  const hasExtension = process.platform === 'win32' && path.extname(command).length > 0;

  for (const dir of dirs) {
    const candidates = process.platform === 'win32'
      ? hasExtension
        ? [path.join(dir, command)]
        : exts.map((ext) => path.join(dir, `${command}${ext}`))
      : [path.join(dir, command)];
    for (const candidate of candidates) {
      if (await pathExists(candidate)) return candidate;
    }
  }

  return null;
}

export async function ensureCommandResolvable(
  command: string,
  cwd: string,
  env: NodeJS.ProcessEnv,
): Promise<void> {
  const resolved = await resolveCommandPath(command, cwd, env);
  if (resolved) return;

  const pathValue = env.PATH ?? env.Path ?? '';
  if (command.includes('/') || command.includes('\\')) {
    const absolute = path.isAbsolute(command) ? command : path.resolve(cwd, command);
    throw new Error(`Command is not executable: "${command}" (resolved: "${absolute}")`);
  }
  throw new Error(
    `Command not found in PATH: "${command}". ` +
    `PATH=${pathValue}`,
  );
}

// ─── Windows spawn target ─────────────────────────────────────────────

function quoteForCmd(arg: string): string {
  if (!arg.length) return '""';
  const escaped = arg.replace(/"/g, '""');
  return /[\s"&<>|^()]/.test(escaped) ? `"${escaped}"` : escaped;
}

async function resolveSpawnTarget(
  command: string,
  args: string[],
  cwd: string,
  env: NodeJS.ProcessEnv,
): Promise<SpawnTarget> {
  const resolved = await resolveCommandPath(command, cwd, env);
  const executable = resolved ?? command;

  if (process.platform !== 'win32') {
    return { command: executable, args };
  }

  // On Windows, force UTF-8 code page (65001) via chcp to prevent
  // CJK character corruption in piped stdout/stderr.
  const shell = env.ComSpec || process.env.ComSpec || 'cmd.exe';
  const commandLine = [quoteForCmd(executable), ...args.map(quoteForCmd)].join(' ');
  return {
    command: shell,
    args: ['/d', '/s', '/c', `chcp 65001 >nul && ${commandLine}`],
  };
}

// ─── GBK decoding ─────────────────────────────────────────────────────

function decodeGbkBuffer(buf: Buffer): string {
  try {
    return new TextDecoder('gbk').decode(buf);
  } catch {
    return buf.toString('utf8');
  }
}

// ─── extraArgs conflict filter ────────────────────────────────────────

/**
 * Remove flags from extraArgs that the adapter already manages.
 * Handles both `--flag value` pairs and `--flag=value` forms.
 */
export function filterConflictingArgs(extraArgs: string[], managedFlags: string[]): string[] {
  const flagSet = new Set(managedFlags.map((f) => f.replace(/=.*$/, '')));
  const filtered: string[] = [];
  for (let i = 0; i < extraArgs.length; i++) {
    const arg = extraArgs[i];
    const bareFlag = arg.replace(/=.*$/, '');
    if (flagSet.has(bareFlag)) {
      // Skip this flag's value if it's a separate argument
      if (!arg.includes('=') && i + 1 < extraArgs.length && !extraArgs[i + 1].startsWith('-')) {
        i++;
      }
      continue;
    }
    filtered.push(arg);
  }
  return filtered;
}

// ─── String append with cap ───────────────────────────────────────────

function appendWithCap(prev: string, chunk: string, cap = MAX_CAPTURE_BYTES): string {
  const combined = prev + chunk;
  return combined.length > cap ? combined.slice(combined.length - cap) : combined;
}

// ─── Environment building ─────────────────────────────────────────────

export function buildCleanEnv(extra: Record<string, string | undefined> = {}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, ...extra };

  // Strip Claude nesting guard vars
  for (const key of CLAUDE_NESTING_VARS) {
    delete env[key];
  }

  // Ensure PATH exists
  const withPath = ensurePathInEnv(env);

  // Windows-specific UTF-8 env
  if (process.platform === 'win32') {
    withPath.PYTHONUTF8 = '1';
    withPath.PYTHONIOENCODING = 'utf-8';
    if (!withPath.LANG) withPath.LANG = 'en_US.UTF-8';
  }

  return withPath;
}

// ─── Core process runner ──────────────────────────────────────────────

/**
 * Spawn a child process with full cross-platform handling:
 * - StringDecoder for multi-byte boundary chars
 * - GBK auto-detection and fallback
 * - chcp 65001 on Windows
 * - Timeout + graceful shutdown
 * - Log chain ordering
 * - ENOENT error enrichment
 */
export async function runChildProcess(
  runId: string,
  command: string,
  args: string[],
  opts: RunProcessOptions,
): Promise<RunProcessResult> {
  const target = await resolveSpawnTarget(command, args, opts.cwd, opts.env);

  return new Promise<RunProcessResult>((resolve, reject) => {
    const child = spawn(target.command, target.args, {
      cwd: opts.cwd,
      env: opts.env,
      shell: false,
      stdio: [opts.stdin != null ? 'pipe' : 'ignore', 'pipe', 'pipe'],
    });

    // Register child for external abort support
    if (opts.childTracker) {
      opts.childTracker.set(runId, child);
    }

    if (opts.stdin != null && child.stdin) {
      child.stdin.write(opts.stdin);
      child.stdin.end();
    }

    let timedOut = false;
    let stdout = '';
    let stderr = '';

    // Use StringDecoder to handle multi-byte characters split across chunks.
    // Detects GBK per-stream and falls back when UTF-8 produces replacement chars.
    const stdoutDecoder = new StringDecoder('utf8');
    const stderrDecoder = new StringDecoder('utf8');
    let stdoutIsGbk = false;
    let stderrIsGbk = false;

    // Log chain ensures callbacks execute in order
    let logChain: Promise<void> = Promise.resolve();

    const timeoutHandle = opts.timeoutMs > 0
      ? setTimeout(() => {
          timedOut = true;
          child.kill('SIGTERM');
          setTimeout(() => {
            if (!child.killed) child.kill('SIGKILL');
          }, Math.max(1000, opts.graceMs));
        }, opts.timeoutMs)
      : null;

    child.stdout?.on('data', (chunk: unknown) => {
      let text: string;
      if (chunk instanceof Buffer) {
        if (stdoutIsGbk) {
          text = decodeGbkBuffer(chunk);
        } else {
          text = stdoutDecoder.write(chunk);
          if (text.includes('\ufffd') && chunk.length > 0) {
            stdoutIsGbk = true;
            text = decodeGbkBuffer(chunk);
          }
        }
      } else {
        text = String(chunk);
      }
      stdout = appendWithCap(stdout, text);
      logChain = logChain
        .then(() => { opts.onLog('stdout', text); })
        .catch(() => {});
    });

    child.stderr?.on('data', (chunk: unknown) => {
      let text: string;
      if (chunk instanceof Buffer) {
        if (stderrIsGbk) {
          text = decodeGbkBuffer(chunk);
        } else {
          text = stderrDecoder.write(chunk);
          if (text.includes('\ufffd') && chunk.length > 0) {
            stderrIsGbk = true;
            text = decodeGbkBuffer(chunk);
          }
        }
      } else {
        text = String(chunk);
      }
      stderr = appendWithCap(stderr, text);
      logChain = logChain
        .then(() => { opts.onLog('stderr', text); })
        .catch(() => {});
    });

    child.on('error', (err: Error) => {
      if (timeoutHandle) clearTimeout(timeoutHandle);
      opts.childTracker?.delete(runId);
      const errno = (err as NodeJS.ErrnoException).code;
      const pathValue = opts.env.PATH ?? opts.env.Path ?? '';
      const msg = errno === 'ENOENT'
        ? `Failed to start command "${command}" in "${opts.cwd}". Verify adapter command, working directory, and PATH (${pathValue}).`
        : `Failed to start command "${command}" in "${opts.cwd}": ${err.message}`;
      reject(new Error(msg));
    });

    child.on('close', (code: number | null, signal: NodeJS.Signals | null) => {
      if (timeoutHandle) clearTimeout(timeoutHandle);
      opts.childTracker?.delete(runId);

      // Flush remaining partial multi-byte characters
      const stdoutTail = stdoutDecoder.end();
      const stderrTail = stderrDecoder.end();
      if (stdoutTail) stdout = appendWithCap(stdout, stdoutTail);
      if (stderrTail) stderr = appendWithCap(stderr, stderrTail);

      void logChain.finally(() => {
        resolve({
          exitCode: code,
          signal,
          timedOut,
          stdout,
          stderr,
        });
      });
    });
  });
}
