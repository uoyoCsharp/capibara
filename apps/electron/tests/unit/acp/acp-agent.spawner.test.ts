import { describe, it, expect, beforeEach, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { AcpAgentSpawner, type SessionContext } from '@core/infrastructure/acp-protocol/acp-agent.spawner';
import type { AgentRegistryConfig } from '@core/modules/acp/types/acp.types';
import type { AcpUpdateHandler } from '@core/modules/acp/handlers/acp-update.handler';
import type { AcpPermissionHandler } from '@core/modules/acp/handlers/acp-permission.handler';
import { MockLogger } from '../../helpers/mock-logger';

vi.mock('node:child_process', () => ({
  spawn: vi.fn(() => {
    const stdin = new PassThrough();
    const stdout = new PassThrough();
    const stderr = new PassThrough();
    const proc = new EventEmitter() as EventEmitter & {
      pid: number;
      stdin: PassThrough;
      stdout: PassThrough;
      stderr: PassThrough;
      kill: () => boolean;
    };
    proc.pid = 99999;
    proc.stdin = stdin;
    proc.stdout = stdout;
    proc.stderr = stderr;
    proc.kill = () => true;
    return proc as never;
  }),
}));

vi.mock('@agentclientprotocol/sdk', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@agentclientprotocol/sdk')>();
  return {
    ...actual,
    ClientSideConnection: class {
      constructor(_handler: unknown, _stream: unknown) {}
      async initialize() {
        return { agentCapabilities: {} };
      }
    },
  };
});

import { spawn } from 'node:child_process';

const config: AgentRegistryConfig = {
  defaultAgent: 'agent-a',
  registry: [
    { id: 'agent-a', name: 'Agent A', command: 'a', args: [] },
    { id: 'agent-b', name: 'Agent B', command: 'b', args: [] },
  ],
  globalFilePolicy: { denyPatterns: [] },
};

function ctx(overrides: Partial<SessionContext>): SessionContext {
  return {
    sessionId: 'sess',
    acpSessionId: 'acp',
    roleId: 'role',
    orgId: 'org',
    runId: 'run',
    cwd: '/cwd',
    allowedPaths: null,
    ...overrides,
  };
}

describe('AcpAgentSpawner — per-prompt context resolution (ADR-4)', () => {
  let spawner: AcpAgentSpawner;

  beforeEach(() => {
    spawner = new AcpAgentSpawner(
      config,
      {} as AcpUpdateHandler,
      {} as AcpPermissionHandler,
      new MockLogger(),
    );
  });

  it('resolves each agent connection against its own in-flight session, not a global', () => {
    // Two distinct live sessions, each on its own agent connection, in flight simultaneously.
    const contexts: Record<string, SessionContext> = {
      'acp-a': ctx({ sessionId: 'sa', acpSessionId: 'acp-a', roleId: 'role-a', cwd: '/a', allowedPaths: ['a/**'] }),
      'acp-b': ctx({ sessionId: 'sb', acpSessionId: 'acp-b', roleId: 'role-b', cwd: '/b', allowedPaths: ['b/**'] }),
    };
    spawner.setSessionContextResolver((acpSessionId) => contexts[acpSessionId] ?? null);

    spawner.setInFlightSession('agent-a', 'acp-a');
    spawner.setInFlightSession('agent-b', 'acp-b');

    const resolve = (agentId: string) => (spawner as any).resolveInFlightContext(agentId) as SessionContext | null;

    expect(resolve('agent-a')!.roleId).toBe('role-a');
    expect(resolve('agent-a')!.cwd).toBe('/a');
    expect(resolve('agent-a')!.allowedPaths).toEqual(['a/**']);

    expect(resolve('agent-b')!.roleId).toBe('role-b');
    expect(resolve('agent-b')!.cwd).toBe('/b');
    expect(resolve('agent-b')!.allowedPaths).toEqual(['b/**']);
  });

  it('returns null when no prompt is in flight on the connection', () => {
    spawner.setSessionContextResolver(() => ctx({}));
    expect((spawner as any).resolveInFlightContext('agent-a')).toBeNull();
  });

  it('clears the in-flight session when set to null', () => {
    spawner.setSessionContextResolver((id) => (id === 'acp-a' ? ctx({ acpSessionId: 'acp-a' }) : null));
    spawner.setInFlightSession('agent-a', 'acp-a');
    expect((spawner as any).resolveInFlightContext('agent-a')).not.toBeNull();

    spawner.setInFlightSession('agent-a', null);
    expect((spawner as any).resolveInFlightContext('agent-a')).toBeNull();
  });

  it('returns null when no resolver is configured', () => {
    spawner.setInFlightSession('agent-a', 'acp-a');
    expect((spawner as any).resolveInFlightContext('agent-a')).toBeNull();
  });
});

describe('AcpAgentSpawner — spawn shell option (Windows .cmd shim handling)', () => {
  beforeEach(() => {
    vi.mocked(spawn).mockClear();
  });

  const makeSpawner = (entries: AgentRegistryConfig['registry']) => {
    return new AcpAgentSpawner(
      { defaultAgent: entries[0]!.id, registry: entries, globalFilePolicy: { denyPatterns: [] } },
      {} as AcpUpdateHandler,
      {} as AcpPermissionHandler,
      new MockLogger(),
    );
  };

  it('passes shell:true for .cmd entries on Windows so the cmd interpreter can execute the shim', async () => {
    const winSpy = vi.spyOn(process, 'platform', 'get').mockReturnValue('win32');
    try {
      const spawner = makeSpawner([
        { id: 'opencode-agent', name: 'OpenCode', command: 'C:/Users/me/AppData/Roaming/npm/opencode.cmd', args: ['acp'] },
      ]);
      await spawner.getOrSpawn('opencode-agent');
      const opts = vi.mocked(spawn).mock.calls.at(-1)?.[2] as Record<string, unknown> | undefined;
      expect(opts?.shell).toBe(true);
    } finally {
      winSpy.mockRestore();
    }
  });

  it('passes shell:true for .bat entries on Windows', async () => {
    const winSpy = vi.spyOn(process, 'platform', 'get').mockReturnValue('win32');
    try {
      const spawner = makeSpawner([
        { id: 'bat-agent', name: 'BAT', command: '/some/path/agent.bat', args: [] },
      ]);
      await spawner.getOrSpawn('bat-agent');
      const opts = vi.mocked(spawn).mock.calls.at(-1)?.[2] as Record<string, unknown> | undefined;
      expect(opts?.shell).toBe(true);
    } finally {
      winSpy.mockRestore();
    }
  });

  it('passes shell:false for .exe entries on Windows so node + bare .exe behavior is preserved', async () => {
    const winSpy = vi.spyOn(process, 'platform', 'get').mockReturnValue('win32');
    try {
      const spawner = makeSpawner([
        { id: 'claude-agent', name: 'Claude', command: 'node', args: ['C:/path/to/agent.js'] },
      ]);
      await spawner.getOrSpawn('claude-agent');
      const opts = vi.mocked(spawn).mock.calls.at(-1)?.[2] as Record<string, unknown> | undefined;
      expect(opts?.shell).toBe(false);
    } finally {
      winSpy.mockRestore();
    }
  });

  it('passes shell:false on non-Windows even when the command happens to end in .cmd', async () => {
    const linuxSpy = vi.spyOn(process, 'platform', 'get').mockReturnValue('linux');
    try {
      const spawner = makeSpawner([
        { id: 'opencode-agent', name: 'OpenCode', command: '/usr/local/bin/opencode', args: ['acp'] },
      ]);
      await spawner.getOrSpawn('opencode-agent');
      const opts = vi.mocked(spawn).mock.calls.at(-1)?.[2] as Record<string, unknown> | undefined;
      expect(opts?.shell).toBe(false);
    } finally {
      linuxSpy.mockRestore();
    }
  });
});
