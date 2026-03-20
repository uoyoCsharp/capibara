/**
 * ClaudeCliAdapter Unit Tests
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'node:events';
import { Readable, Writable } from 'node:stream';

// Mock child_process before importing the adapter
vi.mock('node:child_process', () => ({
  spawn: vi.fn(),
  execSync: vi.fn(),
}));

vi.mock('node:fs', () => ({
  readFileSync: vi.fn(),
  writeFileSync: vi.fn(),
  existsSync: vi.fn(),
  mkdtempSync: vi.fn(() => '/tmp/capibara-abc123'),
  rmSync: vi.fn(),
}));

vi.mock('node:os', () => ({
  tmpdir: vi.fn(() => '/tmp'),
}));

// Stub tsyringe decorators so the class can be instantiated directly
vi.mock('tsyringe', () => ({
  injectable: () => (target: any) => target,
  inject: () => () => undefined,
}));

import { spawn } from 'node:child_process';
import { writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { ClaudeCliAdapter } from '../../src/infrastructure/cli-adapter/claude-cli.adapter.js';
import { CliExecutionError, CliTimeoutError } from '../../src/core/errors/cli.errors.js';

// ── Helpers ─────────────────────────────────────────────────────────────

function createFakeProc() {
  const proc = new EventEmitter() as any;
  proc.stdout = new Readable({ read() {} });
  proc.stderr = new Readable({ read() {} });

  let stdinData = '';
  proc.stdin = new Writable({
    write(chunk: Buffer, _encoding: string, callback: () => void) {
      stdinData += chunk.toString();
      callback();
    },
  });
  (proc.stdin as any).__getData = () => stdinData;

  proc.kill = vi.fn();
  proc.pid = 12345;
  return proc;
}

function completeFakeProc(
  proc: ReturnType<typeof createFakeProc>,
  opts: { stdout?: string; stderr?: string; exitCode?: number | null },
) {
  if (opts.stdout) proc.stdout.push(Buffer.from(opts.stdout));
  if (opts.stderr) proc.stderr.push(Buffer.from(opts.stderr));
  proc.stdout.push(null);
  proc.stderr.push(null);
  proc.emit('close', opts.exitCode ?? 0);
}

function createMockConfig(overrides: Record<string, any> = {}) {
  return {
    cli: {
      cliPath: 'claude',
      projectDir: '/test/project',
      maxConcurrentProcesses: 3,
      ...overrides,
    },
    worker: { defaultMaxTurns: 25, defaultTimeout: 600_000 },
  } as any;
}

function createMockLogger() {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  } as any;
}

// ── Tests ───────────────────────────────────────────────────────────────

describe('ClaudeCliAdapter', () => {
  let adapter: ClaudeCliAdapter;
  let config: ReturnType<typeof createMockConfig>;
  let logger: ReturnType<typeof createMockLogger>;
  const mockSpawn = vi.mocked(spawn);
  const mockWriteFileSync = vi.mocked(writeFileSync);
  const mockMkdtempSync = vi.mocked(mkdtempSync);
  const mockRmSync = vi.mocked(rmSync);

  beforeEach(() => {
    vi.useFakeTimers();
    config = createMockConfig();
    logger = createMockLogger();
    adapter = new (ClaudeCliAdapter as any)(config, logger);
    (adapter as any).resolvedCommand = { command: 'claude', prefixArgs: [], shell: false };
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  // ── Prompt via stdin ────────────────────────────────────────────────

  describe('prompt delivery via stdin', () => {
    it('should send prompt via stdin, NOT as a command-line argument', async () => {
      const proc = createFakeProc();
      mockSpawn.mockReturnValue(proc as any);

      const promise = adapter.execute({ prompt: 'my prompt here' });
      completeFakeProc(proc, { stdout: '{}', exitCode: 0 });
      await promise;

      const spawnArgs = mockSpawn.mock.calls[0][1] as string[];
      expect(spawnArgs).not.toContain('my prompt here');

      const stdinData = (proc.stdin as any).__getData();
      expect(stdinData).toBe('my prompt here');
    });

    it('should close stdin after writing the prompt', async () => {
      const proc = createFakeProc();
      mockSpawn.mockReturnValue(proc as any);
      const endSpy = vi.spyOn(proc.stdin, 'end');

      const promise = adapter.execute({ prompt: 'test' });
      completeFakeProc(proc, { stdout: '{}', exitCode: 0 });
      await promise;

      expect(endSpy).toHaveBeenCalled();
    });

    it('should use stdio pipe for stdin', async () => {
      const proc = createFakeProc();
      mockSpawn.mockReturnValue(proc as any);

      const promise = adapter.execute({ prompt: 'test' });
      completeFakeProc(proc, { stdout: '{}', exitCode: 0 });
      await promise;

      const spawnOpts = mockSpawn.mock.calls[0][2] as any;
      expect(spawnOpts.stdio).toEqual(['pipe', 'pipe', 'pipe']);
    });
  });

  // ── system prompt file ──────────────────────────────────────────────

  describe('system prompt file handling', () => {
    it('should write systemPrompt to a temp file and pass --system-prompt-file', async () => {
      const proc = createFakeProc();
      mockSpawn.mockReturnValue(proc as any);

      const promise = adapter.execute({
        prompt: 'hi',
        systemPrompt: 'You are a helpful assistant.',
      });
      completeFakeProc(proc, { stdout: '{}', exitCode: 0 });
      await promise;

      // Should have written the system prompt to a temp file
      expect(mockMkdtempSync).toHaveBeenCalled();
      expect(mockWriteFileSync).toHaveBeenCalledWith(
        expect.stringContaining('system-prompt.md'),
        'You are a helpful assistant.',
        'utf-8',
      );

      // Args should contain --system-prompt-file, NOT --system-prompt
      const spawnArgs = mockSpawn.mock.calls[0][1] as string[];
      expect(spawnArgs).toContain('--system-prompt-file');
      expect(spawnArgs).not.toContain('--system-prompt');
      expect(spawnArgs).not.toContain('You are a helpful assistant.');
    });

    it('should use explicit systemPromptFile when provided (skip temp file)', async () => {
      const proc = createFakeProc();
      mockSpawn.mockReturnValue(proc as any);

      const promise = adapter.execute({
        prompt: 'hi',
        systemPrompt: 'ignored when file is set',
        systemPromptFile: '/user/custom-prompt.md',
      });
      completeFakeProc(proc, { stdout: '{}', exitCode: 0 });
      await promise;

      // Should NOT create a temp file
      expect(mockMkdtempSync).not.toHaveBeenCalled();
      expect(mockWriteFileSync).not.toHaveBeenCalled();

      // Should use the user-provided file path
      const spawnArgs = mockSpawn.mock.calls[0][1] as string[];
      expect(spawnArgs).toContain('--system-prompt-file');
      expect(spawnArgs).toContain('/user/custom-prompt.md');
    });

    it('should clean up temp file after execution completes', async () => {
      const proc = createFakeProc();
      mockSpawn.mockReturnValue(proc as any);

      const promise = adapter.execute({ prompt: 'hi', systemPrompt: 'content' });
      completeFakeProc(proc, { stdout: '{}', exitCode: 0 });
      await promise;

      expect(mockRmSync).toHaveBeenCalledWith('/tmp/capibara-abc123', {
        recursive: true,
        force: true,
      });
    });

    it('should clean up temp file even if execution fails', async () => {
      const proc = createFakeProc();
      mockSpawn.mockReturnValue(proc as any);

      const promise = adapter.execute({ prompt: 'hi', systemPrompt: 'content' });
      proc.emit('error', new Error('spawn failed'));

      await expect(promise).rejects.toThrow();
      expect(mockRmSync).toHaveBeenCalledWith('/tmp/capibara-abc123', {
        recursive: true,
        force: true,
      });
    });

    it('should not create temp file when no systemPrompt is provided', async () => {
      const proc = createFakeProc();
      mockSpawn.mockReturnValue(proc as any);

      const promise = adapter.execute({ prompt: 'hi' });
      completeFakeProc(proc, { stdout: '{}', exitCode: 0 });
      await promise;

      expect(mockMkdtempSync).not.toHaveBeenCalled();
      expect(mockWriteFileSync).not.toHaveBeenCalled();

      const spawnArgs = mockSpawn.mock.calls[0][1] as string[];
      expect(spawnArgs).not.toContain('--system-prompt-file');
      expect(spawnArgs).not.toContain('--system-prompt');
    });

    it('should redact file path in debug logs', async () => {
      const proc = createFakeProc();
      mockSpawn.mockReturnValue(proc as any);

      const promise = adapter.execute({ prompt: 'hi', systemPrompt: 'secret' });
      completeFakeProc(proc, { stdout: '{}', exitCode: 0 });
      await promise;

      const debugCalls = logger.debug.mock.calls;
      const argLog = debugCalls.find((c: any[]) => c[0]?.args);
      expect(argLog).toBeDefined();
      const loggedArgs: string[] = argLog[0].args;
      const idx = loggedArgs.indexOf('--system-prompt-file');
      expect(loggedArgs[idx + 1]).toBe('[FILE]');
    });
  });

  // ── buildArgs ───────────────────────────────────────────────────────

  describe('buildArgs (via execute spawn call)', () => {
    it('should build args with --print and --output-format', async () => {
      const proc = createFakeProc();
      mockSpawn.mockReturnValue(proc as any);

      const promise = adapter.execute({ prompt: 'hello' });
      completeFakeProc(proc, { stdout: '{}', exitCode: 0 });
      await promise;

      const spawnArgs = mockSpawn.mock.calls[0][1] as string[];
      expect(spawnArgs).toContain('--print');
      expect(spawnArgs).toContain('--output-format');
      expect(spawnArgs).toContain('json');
      expect(spawnArgs).toContain('--dangerously-skip-permissions');
    });

    it('should include appendSystemPrompt when provided', async () => {
      const proc = createFakeProc();
      mockSpawn.mockReturnValue(proc as any);

      const promise = adapter.execute({ prompt: 'hi', appendSystemPrompt: 'extra' });
      completeFakeProc(proc, { stdout: '{}', exitCode: 0 });
      await promise;

      const spawnArgs = mockSpawn.mock.calls[0][1] as string[];
      const idx = spawnArgs.indexOf('--append-system-prompt');
      expect(idx).toBeGreaterThan(-1);
      expect(spawnArgs[idx + 1]).toBe('extra');
    });

    it('should include sessionId when provided', async () => {
      const proc = createFakeProc();
      mockSpawn.mockReturnValue(proc as any);

      const promise = adapter.execute({ prompt: 'hi', sessionId: 'sess-123' });
      completeFakeProc(proc, { stdout: '{}', exitCode: 0 });
      await promise;

      const spawnArgs = mockSpawn.mock.calls[0][1] as string[];
      expect(spawnArgs).toContain('--session-id');
      expect(spawnArgs).toContain('sess-123');
    });

    it('should include --resume flag when resume is true', async () => {
      const proc = createFakeProc();
      mockSpawn.mockReturnValue(proc as any);

      const promise = adapter.execute({ prompt: 'hi', resume: true });
      completeFakeProc(proc, { stdout: '{}', exitCode: 0 });
      await promise;

      const spawnArgs = mockSpawn.mock.calls[0][1] as string[];
      expect(spawnArgs).toContain('--resume');
    });

    it('should include maxTurns when provided', async () => {
      const proc = createFakeProc();
      mockSpawn.mockReturnValue(proc as any);

      const promise = adapter.execute({ prompt: 'hi', maxTurns: 10 });
      completeFakeProc(proc, { stdout: '{}', exitCode: 0 });
      await promise;

      const spawnArgs = mockSpawn.mock.calls[0][1] as string[];
      expect(spawnArgs).toContain('--max-turns');
      expect(spawnArgs).toContain('10');
    });

    it('should include allowedTools and disallowedTools', async () => {
      const proc = createFakeProc();
      mockSpawn.mockReturnValue(proc as any);

      const promise = adapter.execute({
        prompt: 'hi',
        allowedTools: ['Read', 'Write'],
        disallowedTools: ['Bash'],
      });
      completeFakeProc(proc, { stdout: '{}', exitCode: 0 });
      await promise;

      const spawnArgs = mockSpawn.mock.calls[0][1] as string[];
      expect(spawnArgs).toContain('--allowedTools');
      expect(spawnArgs).toContain('Read,Write');
      expect(spawnArgs).toContain('--disallowedTools');
      expect(spawnArgs).toContain('Bash');
    });

    it('should use custom outputFormat when provided', async () => {
      const proc = createFakeProc();
      mockSpawn.mockReturnValue(proc as any);

      const promise = adapter.execute({ prompt: 'hi', outputFormat: 'text' });
      completeFakeProc(proc, { stdout: 'hello', exitCode: 0 });
      await promise;

      const spawnArgs = mockSpawn.mock.calls[0][1] as string[];
      expect(spawnArgs).toContain('text');
      expect(spawnArgs).not.toContain('json');
    });
  });

  // ── execute: success ────────────────────────────────────────────────

  describe('execute - success', () => {
    it('should return success result when process exits with code 0', async () => {
      const proc = createFakeProc();
      mockSpawn.mockReturnValue(proc as any);

      const jsonOutput = JSON.stringify({ session_id: 'abc-123', result: 'done' });
      const promise = adapter.execute({ prompt: 'test prompt' });
      completeFakeProc(proc, { stdout: jsonOutput, exitCode: 0 });

      const result = await promise;
      expect(result.success).toBe(true);
      expect(result.output).toBe(jsonOutput);
      expect(result.sessionId).toBe('abc-123');
      expect(result.exitCode).toBe(0);
      expect(result.duration).toBeGreaterThanOrEqual(0);
    });

    it('should preserve existing sessionId from options', async () => {
      const proc = createFakeProc();
      mockSpawn.mockReturnValue(proc as any);

      const promise = adapter.execute({ prompt: 'test', sessionId: 'my-session' });
      completeFakeProc(proc, { stdout: '{}', exitCode: 0 });

      const result = await promise;
      expect(result.sessionId).toBe('my-session');
    });

    it('should collect stdout delivered in multiple chunks', async () => {
      const proc = createFakeProc();
      mockSpawn.mockReturnValue(proc as any);

      const promise = adapter.execute({ prompt: 'test' });

      proc.stdout.push(Buffer.from('chunk1'));
      proc.stdout.push(Buffer.from('chunk2'));
      proc.stdout.push(Buffer.from('chunk3'));
      proc.stdout.push(null);
      proc.stderr.push(null);
      proc.emit('close', 0);

      const result = await promise;
      expect(result.output).toBe('chunk1chunk2chunk3');
    });

    it('should use custom cwd when provided', async () => {
      const proc = createFakeProc();
      mockSpawn.mockReturnValue(proc as any);

      const promise = adapter.execute({ prompt: 'test', cwd: '/custom/dir' });
      completeFakeProc(proc, { stdout: '{}', exitCode: 0 });
      await promise;

      expect(mockSpawn.mock.calls[0][2]).toMatchObject({ cwd: '/custom/dir' });
    });

    it('should fall back to config projectDir when no cwd provided', async () => {
      const proc = createFakeProc();
      mockSpawn.mockReturnValue(proc as any);

      const promise = adapter.execute({ prompt: 'test' });
      completeFakeProc(proc, { stdout: '{}', exitCode: 0 });
      await promise;

      expect(mockSpawn.mock.calls[0][2]).toMatchObject({ cwd: '/test/project' });
    });
  });

  // ── execute: failure ────────────────────────────────────────────────

  describe('execute - failure', () => {
    it('should return success=false when process exits with non-zero code', async () => {
      const proc = createFakeProc();
      mockSpawn.mockReturnValue(proc as any);

      const promise = adapter.execute({ prompt: 'bad' });
      completeFakeProc(proc, { stdout: '', stderr: 'error happened', exitCode: 1 });

      const result = await promise;
      expect(result.success).toBe(false);
      expect(result.exitCode).toBe(1);
    });

    it('should handle null exit code (process killed without code)', async () => {
      const proc = createFakeProc();
      mockSpawn.mockReturnValue(proc as any);

      const promise = adapter.execute({ prompt: 'test' });
      proc.stdout.push(null);
      proc.stderr.push(null);
      proc.emit('close', null);

      const result = await promise;
      expect(result.success).toBe(false);
      expect(result.exitCode).toBe(1);
    });

    it('should reject with CliExecutionError on spawn error', async () => {
      const proc = createFakeProc();
      mockSpawn.mockReturnValue(proc as any);

      const promise = adapter.execute({ prompt: 'test' });
      proc.emit('error', new Error('ENOENT'));

      await expect(promise).rejects.toThrow(CliExecutionError);
      await expect(promise).rejects.toThrow('ENOENT');
    });

    it('should log stderr as warning when present', async () => {
      const proc = createFakeProc();
      mockSpawn.mockReturnValue(proc as any);

      const promise = adapter.execute({ prompt: 'test' });
      completeFakeProc(proc, { stdout: '{}', stderr: 'some warning', exitCode: 0 });
      await promise;

      expect(logger.warn).toHaveBeenCalledWith({ stderr: 'some warning' }, 'CLI stderr output');
    });

    it('should return empty sessionId when stdout is not valid JSON', async () => {
      const proc = createFakeProc();
      mockSpawn.mockReturnValue(proc as any);

      const promise = adapter.execute({ prompt: 'test' });
      completeFakeProc(proc, { stdout: 'not json', exitCode: 0 });

      const result = await promise;
      expect(result.sessionId).toBe('');
    });
  });

  // ── execute: timeout ────────────────────────────────────────────────

  describe('execute - timeout', () => {
    it('should reject with CliTimeoutError when timeout expires', async () => {
      const proc = createFakeProc();
      mockSpawn.mockReturnValue(proc as any);

      const promise = adapter.execute({ prompt: 'slow', timeout: 5000 });
      vi.advanceTimersByTime(5001);

      await expect(promise).rejects.toThrow(CliTimeoutError);
      expect(proc.kill).toHaveBeenCalledWith('SIGTERM');
    });

    it('should not timeout if process completes before deadline', async () => {
      const proc = createFakeProc();
      mockSpawn.mockReturnValue(proc as any);

      const promise = adapter.execute({ prompt: 'fast', timeout: 10000 });
      completeFakeProc(proc, { stdout: '{"session_id":"s1"}', exitCode: 0 });

      const result = await promise;
      expect(result.success).toBe(true);
    });

    it('should not resolve after timeout even if close fires later', async () => {
      const proc = createFakeProc();
      mockSpawn.mockReturnValue(proc as any);

      const promise = adapter.execute({ prompt: 'test', timeout: 1000 });
      vi.advanceTimersByTime(1001);

      proc.stdout.push(null);
      proc.stderr.push(null);
      proc.emit('close', 0);

      await expect(promise).rejects.toThrow(CliTimeoutError);
    });
  });

  // ── execute: stream ordering robustness ─────────────────────────────

  describe('execute - stream ordering robustness', () => {
    it('should wait for streams to end even if close fires first', async () => {
      const proc = createFakeProc();
      mockSpawn.mockReturnValue(proc as any);

      const promise = adapter.execute({ prompt: 'test' });

      proc.emit('close', 0);
      proc.stdout.push(Buffer.from('late data'));
      proc.stdout.push(null);
      proc.stderr.push(null);

      const result = await promise;
      expect(result.output).toBe('late data');
      expect(result.success).toBe(true);
    });

    it('should wait for stderr to end before resolving', async () => {
      const proc = createFakeProc();
      mockSpawn.mockReturnValue(proc as any);

      const promise = adapter.execute({ prompt: 'test' });

      proc.stdout.push(Buffer.from('ok'));
      proc.stdout.push(null);
      proc.emit('close', 0);

      let resolved = false;
      promise.then(() => {
        resolved = true;
      });
      await vi.advanceTimersByTimeAsync(0);
      expect(resolved).toBe(false);

      proc.stderr.push(null);
      await vi.advanceTimersByTimeAsync(0);
      expect(resolved).toBe(true);
    });

    it('should wait for stdout to end before resolving', async () => {
      const proc = createFakeProc();
      mockSpawn.mockReturnValue(proc as any);

      const promise = adapter.execute({ prompt: 'test' });

      proc.stderr.push(null);
      proc.emit('close', 0);

      let resolved = false;
      promise.then(() => {
        resolved = true;
      });
      await vi.advanceTimersByTimeAsync(0);
      expect(resolved).toBe(false);

      proc.stdout.push(Buffer.from('final'));
      proc.stdout.push(null);
      await vi.advanceTimersByTimeAsync(0);
      expect(resolved).toBe(true);

      const result = await promise;
      expect(result.output).toBe('final');
    });
  });

  // ── extractSessionId ────────────────────────────────────────────────

  describe('extractSessionId (via execute)', () => {
    it('should extract session_id from JSON output', async () => {
      const proc = createFakeProc();
      mockSpawn.mockReturnValue(proc as any);

      const promise = adapter.execute({ prompt: 'test' });
      completeFakeProc(proc, {
        stdout: JSON.stringify({ session_id: 'extracted-id', result: 'ok' }),
        exitCode: 0,
      });

      const result = await promise;
      expect(result.sessionId).toBe('extracted-id');
    });

    it('should return empty string when session_id is missing', async () => {
      const proc = createFakeProc();
      mockSpawn.mockReturnValue(proc as any);

      const promise = adapter.execute({ prompt: 'test' });
      completeFakeProc(proc, {
        stdout: JSON.stringify({ result: 'ok' }),
        exitCode: 0,
      });

      const result = await promise;
      expect(result.sessionId).toBe('');
    });
  });
});
