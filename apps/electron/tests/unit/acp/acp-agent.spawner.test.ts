import { describe, it, expect, beforeEach, vi } from 'vitest';
import { AcpAgentSpawner, type SessionContext } from '@core/infrastructure/acp-protocol/acp-agent.spawner';
import type { AgentRegistryConfig } from '@core/modules/acp/types/acp.types';
import type { AcpUpdateHandler } from '@core/modules/acp/handlers/acp-update.handler';
import type { AcpPermissionHandler } from '@core/modules/acp/handlers/acp-permission.handler';
import { MockLogger } from '../../helpers/mock-logger';

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
