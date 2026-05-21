import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ClaudeCliAdapter } from '@core/infrastructure/adapters/claude-cli.adapter';
import type { CliAdapterContext } from '@core/infrastructure/adapters/i-cli-adapter';
import { spawn, type ChildProcess } from 'node:child_process';

vi.mock('node:child_process', () => ({
  spawn: vi.fn(),
  execSync: vi.fn(),
}));

function createMockProcess(): {
  proc: ChildProcess;
  simulateStdout: (data: string) => void;
  simulateStderr: (data: string) => void;
  simulateClose: (code: number | null, signal?: string | null) => void;
  simulateError: (err: Error) => void;
  stdinChunks: string[];
  stdinEnded: boolean;
} {
  const handlers: Record<string, ((...args: unknown[]) => void)[]> = {};
  const stdoutHandlers: Record<string, ((data: Buffer) => void)[]> = {};
  const stderrHandlers: Record<string, ((data: Buffer) => void)[]> = {};
  const stdinChunks: string[] = [];
  let stdinEnded = false;

  const proc = {
    pid: 12345,
    killed: false,
    stdin: {
      write: vi.fn((data: string) => { stdinChunks.push(data); }),
      end: vi.fn(() => { stdinEnded = true; }),
    },
    stdout: {
      on: vi.fn((event: string, handler: (data: Buffer) => void) => {
        stdoutHandlers[event] = stdoutHandlers[event] || [];
        stdoutHandlers[event].push(handler);
      }),
    },
    stderr: {
      on: vi.fn((event: string, handler: (data: Buffer) => void) => {
        stderrHandlers[event] = stderrHandlers[event] || [];
        stderrHandlers[event].push(handler);
      }),
    },
    on: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
      handlers[event] = handlers[event] || [];
      handlers[event].push(handler);
    }),
    kill: vi.fn(() => { (proc as Record<string, unknown>).killed = true; }),
  } as unknown as ChildProcess;

  return {
    proc,
    stdinChunks,
    get stdinEnded() { return stdinEnded; },
    simulateStdout: (data: string) => {
      for (const h of stdoutHandlers['data'] ?? []) h(Buffer.from(data));
    },
    simulateStderr: (data: string) => {
      for (const h of stderrHandlers['data'] ?? []) h(Buffer.from(data));
    },
    simulateClose: (code: number | null, signal?: string | null) => {
      for (const h of handlers['close'] ?? []) h(code, signal ?? null);
    },
    simulateError: (err: Error) => {
      for (const h of handlers['error'] ?? []) h(err);
    },
  };
}

function createCtx(overrides?: Partial<CliAdapterContext>): CliAdapterContext {
  return {
    runId: 'run-1',
    roleId: 'role-1',
    orgId: 'org-1',
    taskId: 'task-1',
    prompt: '# Role\n\nYou are Developer.\n\n# Task\n\nImplement feature X.',
    mcpConfigPath: '/tmp/mcp.json',
    projectDir: '/project',
    cliConfig: {
      model: 'sonnet',
      maxTurnsPerRun: 5,
      effort: 'medium',
      timeoutMs: 60000,
      extraArgs: [],
    },
    sessionId: undefined,
    onLog: vi.fn(),
    ...overrides,
  };
}

describe('ClaudeCliAdapter', () => {
  let adapter: ClaudeCliAdapter;
  let mockProc: ReturnType<typeof createMockProcess>;

  beforeEach(() => {
    vi.clearAllMocks();
    adapter = new ClaudeCliAdapter();
    mockProc = createMockProcess();
    vi.mocked(spawn).mockReturnValue(mockProc.proc);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('spawn / complete', () => {
    it('writes prompt to stdin instead of passing as arg', async () => {
      const ctx = createCtx();
      const handle = await adapter.spawn(ctx);

      mockProc.simulateClose(0);
      await handle.complete();

      expect(mockProc.stdinChunks).toEqual([ctx.prompt]);
      expect(mockProc.stdinEnded).toBe(true);

      const spawnArgs = vi.mocked(spawn).mock.calls[0][1] as string[];
      expect(spawnArgs).not.toContain(ctx.prompt);
    });

    it('includes --print flag without prompt value in args', async () => {
      const ctx = createCtx();
      const handle = await adapter.spawn(ctx);
      mockProc.simulateClose(0);
      await handle.complete();

      const args = vi.mocked(spawn).mock.calls[0][1] as string[];
      expect(args).toContain('--print');
      expect(args).toContain('--output-format');
      expect(args).toContain('stream-json');
      expect(args).toContain('--verbose');
    });

    it('includes model, max-turns, effort, mcp-config in args', async () => {
      const ctx = createCtx();
      const handle = await adapter.spawn(ctx);
      mockProc.simulateClose(0);
      await handle.complete();

      const args = vi.mocked(spawn).mock.calls[0][1] as string[];
      expect(args).toContain('--model');
      expect(args).toContain('sonnet');
      expect(args).toContain('--max-turns');
      expect(args).toContain('5');
      expect(args).toContain('--effort');
      expect(args).toContain('medium');
      expect(args).toContain('--mcp-config');
      expect(args).toContain('/tmp/mcp.json');
    });

    it('includes --resume when sessionId provided', async () => {
      const ctx = createCtx({ sessionId: 'sess-abc' });
      const handle = await adapter.spawn(ctx);
      mockProc.simulateClose(0);
      await handle.complete();

      const args = vi.mocked(spawn).mock.calls[0][1] as string[];
      expect(args).toContain('--resume');
      expect(args).toContain('sess-abc');
    });

    it('omits --resume when no sessionId', async () => {
      const ctx = createCtx({ sessionId: undefined });
      const handle = await adapter.spawn(ctx);
      mockProc.simulateClose(0);
      await handle.complete();

      const args = vi.mocked(spawn).mock.calls[0][1] as string[];
      expect(args).not.toContain('--resume');
    });

    it('filters managed flags from extraArgs', async () => {
      const ctx = createCtx({
        cliConfig: {
          model: 'sonnet',
          maxTurnsPerRun: 5,
          effort: 'medium',
          timeoutMs: 0,
          extraArgs: ['--verbose', '--custom-flag', '--print', '--other'],
        },
      });
      const handle = await adapter.spawn(ctx);
      mockProc.simulateClose(0);
      await handle.complete();

      const args = vi.mocked(spawn).mock.calls[0][1] as string[];
      expect(args).toContain('--custom-flag');
      expect(args).toContain('--other');
      expect(args.filter((a) => a === '--verbose')).toHaveLength(1);
      expect(args.filter((a) => a === '--print')).toHaveLength(1);
    });

    it('returns succeeded when exit code is 0', async () => {
      const ctx = createCtx();
      const handle = await adapter.spawn(ctx);

      mockProc.simulateStdout('{"type":"result","session_id":"sess-1","usage":{"input_tokens":100,"output_tokens":50,"cache_read_input_tokens":10},"result":"Done"}\n');
      mockProc.simulateClose(0);

      const result = await handle.complete();
      expect(result.status).toBe('succeeded');
      expect(result.exitCode).toBe(0);
      expect(result.sessionId).toBe('sess-1');
      expect(result.summary).toBe('Done');
      expect(result.inputTokens).toBe(100);
      expect(result.outputTokens).toBe(50);
      expect(result.cachedInputTokens).toBe(10);
    });

    it('returns failed when exit code is non-zero', async () => {
      const ctx = createCtx();
      const handle = await adapter.spawn(ctx);

      mockProc.simulateStderr('Something went wrong\n');
      mockProc.simulateClose(1);

      const result = await handle.complete();
      expect(result.status).toBe('failed');
      expect(result.exitCode).toBe(1);
      expect(result.errorMessage).toBe('Something went wrong');
    });

    it('streams stdout/stderr to onLog callback', async () => {
      const onLog = vi.fn();
      const ctx = createCtx({ onLog });
      const handle = await adapter.spawn(ctx);

      mockProc.simulateStdout('chunk1');
      mockProc.simulateStderr('err1');
      mockProc.simulateClose(0);
      await handle.complete();

      expect(onLog).toHaveBeenCalledWith('stdout', 'chunk1');
      expect(onLog).toHaveBeenCalledWith('stderr', 'err1');
    });

    it('rejects on spawn error', async () => {
      const ctx = createCtx();
      const handle = await adapter.spawn(ctx);

      mockProc.simulateError(new Error('ENOENT'));

      await expect(handle.complete()).rejects.toThrow('ENOENT');
    });

    it('retries with fresh session on session error', async () => {
      const secondMock = createMockProcess();
      vi.mocked(spawn)
        .mockReturnValueOnce(mockProc.proc)
        .mockReturnValueOnce(secondMock.proc);

      const onLog = vi.fn();
      const ctx = createCtx({ sessionId: 'sess-old', onLog });
      const handle = await adapter.spawn(ctx);

      mockProc.simulateStderr('unknown session error\n');
      mockProc.simulateClose(1);

      setTimeout(() => {
        secondMock.simulateStdout('{"type":"result","session_id":"sess-new","usage":{"input_tokens":50,"output_tokens":25,"cache_read_input_tokens":0},"result":"OK"}\n');
        secondMock.simulateClose(0);
      }, 0);

      const result = await handle.complete();
      expect(result.status).toBe('succeeded');
      expect(result.sessionId).toBe('sess-new');
      expect(result.clearSession).toBe(true);

      const secondArgs = vi.mocked(spawn).mock.calls[1][1] as string[];
      expect(secondArgs).not.toContain('--resume');
    });

    it('does not retry session error when no sessionId', async () => {
      const ctx = createCtx({ sessionId: undefined });
      const handle = await adapter.spawn(ctx);

      mockProc.simulateStderr('unknown session error\n');
      mockProc.simulateClose(1);

      const result = await handle.complete();
      expect(result.status).toBe('failed');
      expect(spawn).toHaveBeenCalledTimes(1);
    });

    it('strips Claude nesting env vars', async () => {
      process.env.CLAUDECODE = 'true';
      process.env.CLAUDE_CODE_ENTRYPOINT = '/usr/bin/claude';

      const ctx = createCtx();
      const handle = await adapter.spawn(ctx);
      mockProc.simulateClose(0);
      await handle.complete();

      const spawnOpts = vi.mocked(spawn).mock.calls[0][2] as Record<string, unknown>;
      const env = spawnOpts.env as NodeJS.ProcessEnv;
      expect(env.CLAUDECODE).toBeUndefined();
      expect(env.CLAUDE_CODE_ENTRYPOINT).toBeUndefined();

      delete process.env.CLAUDECODE;
      delete process.env.CLAUDE_CODE_ENTRYPOINT;
    });

    it('uses shell:true on Windows', async () => {
      const ctx = createCtx();
      const handle = await adapter.spawn(ctx);
      mockProc.simulateClose(0);
      await handle.complete();

      const spawnOpts = vi.mocked(spawn).mock.calls[0][2] as Record<string, unknown>;
      expect(spawnOpts.shell).toBe(process.platform === 'win32');
    });

    it('throws when spawn produces no pid', async () => {
      const noPidProc = createMockProcess();
      (noPidProc.proc as unknown as { pid: number | undefined }).pid = undefined;
      vi.mocked(spawn).mockReturnValue(noPidProc.proc);

      const ctx = createCtx();
      await expect(adapter.spawn(ctx)).rejects.toThrow(/no pid/i);
    });
  });

  describe('cancel', () => {
    it('kills process via handle.cancel()', async () => {
      const ctx = createCtx();
      const handle = await adapter.spawn(ctx);

      handle.cancel();

      mockProc.simulateClose(null, 'SIGTERM');

      const result = await handle.complete();
      expect(result.status).toBe('failed');
      if (process.platform === 'win32') {
        const { execSync } = await import('node:child_process');
        expect(vi.mocked(execSync)).toHaveBeenCalled();
      } else {
        expect(mockProc.proc.kill).toHaveBeenCalled();
      }
    });
  });

  describe('name', () => {
    it('returns claude-cli', () => {
      expect(adapter.name).toBe('claude-cli');
    });
  });
});
