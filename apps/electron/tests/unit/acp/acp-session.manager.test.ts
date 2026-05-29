import { describe, it, expect, beforeEach, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { AcpSessionManager } from '@core/modules/acp/client/acp-session.manager';
import type { AcpAgentSpawner } from '@core/modules/acp/client/acp-agent.spawner';
import type { AcpUpdateHandler } from '@core/modules/acp/handlers/acp-update.handler';
import type { IAcpSessionRepository, CreateAcpSessionInput } from '@core/modules/acp/interfaces/i-acp-session.repository';
import type { AcpSessionRecord, AcpSessionStatus } from '@core/modules/acp/types/acp.types';
import { MockLogger } from '../../helpers/mock-logger';

/** In-memory IAcpSessionRepository for exercising the manager's state machine without SQLite. */
class FakeAcpSessionRepository implements IAcpSessionRepository {
  private rows = new Map<string, AcpSessionRecord>();

  create(input: CreateAcpSessionInput): AcpSessionRecord {
    const record: AcpSessionRecord = { id: randomUUID(), createdAt: new Date().toISOString(), ...input };
    this.rows.set(record.id, record);
    return record;
  }
  findById(id: string): AcpSessionRecord | null {
    return this.rows.get(id) ?? null;
  }
  findByAcpSessionId(acpSessionId: string): AcpSessionRecord | null {
    return [...this.rows.values()].filter(r => r.acpSessionId === acpSessionId).at(-1) ?? null;
  }
  findByConversationId(conversationId: string): AcpSessionRecord | null {
    return [...this.rows.values()].filter(r => r.conversationId === conversationId).at(-1) ?? null;
  }
  findResumable(roleId: string, orgId: string): AcpSessionRecord | null {
    return [...this.rows.values()]
      .filter(r => r.roleId === roleId && r.orgId === orgId && (r.status === 'active' || r.status === 'suspended'))
      .sort((a, b) => b.lastActivityAt.localeCompare(a.lastActivityAt))[0] ?? null;
  }
  findIdleExpired(beforeIso: string): AcpSessionRecord[] {
    return [...this.rows.values()].filter(
      r => r.status === 'suspended' && r.suspendReason === 'idle' && r.lastActivityAt <= beforeIso,
    );
  }
  findCollaborationExpired(beforeIso: string): AcpSessionRecord[] {
    return [...this.rows.values()].filter(
      r => r.status === 'suspended' && r.suspendReason === 'collaboration' && r.lastActivityAt <= beforeIso,
    );
  }
  findNonTerminal(): AcpSessionRecord[] {
    return [...this.rows.values()].filter(r => r.status === 'active' || r.status === 'suspended');
  }
  updateStatus(id: string, status: AcpSessionStatus, patch: Partial<AcpSessionRecord> = {}): void {
    const row = this.rows.get(id);
    if (!row) return;
    this.rows.set(id, { ...row, status, ...patch });
  }
  touchActivity(id: string, iso: string): void {
    const row = this.rows.get(id);
    if (row) this.rows.set(id, { ...row, lastActivityAt: iso });
  }
}

function createMockConnection() {
  return {
    newSession: vi.fn().mockResolvedValue({ sessionId: 'acp-sess-1' }),
    prompt: vi.fn().mockResolvedValue({ stopReason: 'end_turn', usage: { inputTokens: 100, outputTokens: 50 } }),
    closeSession: vi.fn().mockResolvedValue({}),
    cancel: vi.fn().mockResolvedValue({}),
    resumeSession: vi.fn().mockResolvedValue({}),
    loadSession: vi.fn().mockResolvedValue({}),
  };
}

function createMockSpawner(connection: ReturnType<typeof createMockConnection>, capabilities: any): AcpAgentSpawner {
  return {
    getOrSpawn: vi.fn().mockResolvedValue({ connection, child: { pid: 12345 }, capabilities }),
    getCapabilities: vi.fn().mockReturnValue(capabilities),
    shutdown: vi.fn().mockResolvedValue(undefined),
    setSessionContextResolver: vi.fn(),
    setInFlightSession: vi.fn(),
    setFilesystemHandler: vi.fn(),
  } as any;
}

function createMockUpdateHandler(): AcpUpdateHandler {
  return { handleUpdate: vi.fn(), onLog: vi.fn(), onText: vi.fn(), removeCallbacks: vi.fn() } as any;
}

const CREATE_PARAMS = {
  agentId: 'claude-agent',
  roleId: 'role-1',
  orgId: 'org-1',
  runId: 'run-1',
  taskId: 'task-1',
  cwd: '/workspace',
  mcpServers: [],
} as const;

describe('AcpSessionManager', () => {
  let manager: AcpSessionManager;
  let repo: FakeAcpSessionRepository;
  let spawner: AcpAgentSpawner;
  let updateHandler: AcpUpdateHandler;
  let logger: MockLogger;
  let connection: ReturnType<typeof createMockConnection>;

  function setup(capabilities: any) {
    repo = new FakeAcpSessionRepository();
    connection = createMockConnection();
    spawner = createMockSpawner(connection, capabilities);
    updateHandler = createMockUpdateHandler();
    logger = new MockLogger();
    manager = new AcpSessionManager(repo, spawner, updateHandler, logger);
  }

  beforeEach(() => {
    setup({ supportsResume: true, supportsLoad: false, supportedMcpTransports: ['stdio'] });
  });

  describe('createSession', () => {
    it('persists an active record and caches live runtime', async () => {
      const session = await manager.createSession(CREATE_PARAMS);
      expect(session.status).toBe('active');
      expect(session.acpSessionId).toBe('acp-sess-1');
      expect(session.resumeStrategy).toBe('resume');
      expect(repo.findById(session.id)!.status).toBe('active');
    });

    it('derives resumeStrategy from capabilities', async () => {
      setup({ supportsResume: false, supportsLoad: false, supportedMcpTransports: ['stdio'] });
      const session = await manager.createSession(CREATE_PARAMS);
      expect(session.resumeStrategy).toBe('rebuild');
    });
  });

  describe('prompt', () => {
    it('marks then clears the in-flight session on its agent connection (ADR-4)', async () => {
      const session = await manager.createSession(CREATE_PARAMS);
      await manager.prompt(session.id, [{ type: 'text', text: 'hi' }] as any);

      const calls = (spawner.setInFlightSession as any).mock.calls;
      expect(calls).toContainEqual(['claude-agent', session.acpSessionId]);
      // Final call clears it (finally block).
      expect(calls.at(-1)).toEqual(['claude-agent', null]);
    });
  });

  describe('suspend', () => {
    it('marks suspended WITHOUT a protocol close (ADR-3)', async () => {
      const session = await manager.createSession(CREATE_PARAMS);
      await manager.suspend(session.id, 'idle');

      expect(connection.closeSession).not.toHaveBeenCalled();
      const after = repo.findById(session.id)!;
      expect(after.status).toBe('suspended');
      expect(after.suspendReason).toBe('idle');
    });
  });

  describe('resume', () => {
    it('dispatches resumeSession for the resume strategy and clears suspend reason', async () => {
      const session = await manager.createSession(CREATE_PARAMS);
      await manager.suspend(session.id, 'idle');
      await manager.resume(session.id);

      expect(connection.resumeSession).toHaveBeenCalledWith(expect.objectContaining({ sessionId: 'acp-sess-1' }));
      const after = repo.findById(session.id)!;
      expect(after.status).toBe('active');
      expect(after.suspendReason).toBeNull();
      expect(after.resumeCount).toBe(1);
    });

    it('dispatches loadSession for the load strategy', async () => {
      setup({ supportsResume: false, supportsLoad: true, supportedMcpTransports: ['stdio'] });
      const session = await manager.createSession(CREATE_PARAMS);
      await manager.suspend(session.id, 'collaboration');
      await manager.resume(session.id);
      expect(connection.loadSession).toHaveBeenCalled();
    });

    it('rebuilds (fresh newSession) when strategy is rebuild', async () => {
      setup({ supportsResume: false, supportsLoad: false, supportedMcpTransports: ['stdio'] });
      const session = await manager.createSession(CREATE_PARAMS);
      await manager.suspend(session.id, 'idle');
      connection.newSession.mockResolvedValueOnce({ sessionId: 'acp-sess-2' });
      await manager.resume(session.id);

      expect(connection.resumeSession).not.toHaveBeenCalled();
      expect(repo.findById(session.id)!.acpSessionId).toBe('acp-sess-2');
      expect(repo.findById(session.id)!.status).toBe('active');
    });
  });

  describe('close', () => {
    it('sends protocol close and persists the close reason', async () => {
      const session = await manager.createSession(CREATE_PARAMS);
      await manager.close(session.id, 'completed');

      expect(connection.closeSession).toHaveBeenCalledWith({ sessionId: 'acp-sess-1' });
      const after = repo.findById(session.id)!;
      expect(after.status).toBe('closed');
      expect(after.closeReason).toBe('completed');
      expect(after.closedAt).not.toBeNull();
    });

    it('rejects an illegal transition (closed → closed)', async () => {
      const session = await manager.createSession(CREATE_PARAMS);
      await manager.close(session.id, 'completed');
      await expect(manager.close(session.id, 'completed')).rejects.toThrow(/Illegal ACP session transition/);
    });
  });

  describe('expire', () => {
    it('sends protocol close and marks expired', async () => {
      const session = await manager.createSession(CREATE_PARAMS);
      await manager.suspend(session.id, 'idle');
      await manager.expire(session.id);

      expect(connection.closeSession).toHaveBeenCalled();
      expect(repo.findById(session.id)!.status).toBe('expired');
    });
  });

  describe('reconcileOnStartup', () => {
    it('expires non-terminal persisted sessions', async () => {
      const a = await manager.createSession(CREATE_PARAMS);
      const b = await manager.createSession(CREATE_PARAMS);
      await manager.suspend(b.id, 'idle');

      await manager.reconcileOnStartup();

      expect(repo.findById(a.id)!.status).toBe('expired');
      expect(repo.findById(b.id)!.status).toBe('expired');
    });
  });

  describe('sweepIdle', () => {
    it('expires idle suspensions past the TTL, leaving recent collaboration ones', async () => {
      const idle = await manager.createSession(CREATE_PARAMS);
      const collab = await manager.createSession(CREATE_PARAMS);
      await manager.suspend(idle.id, 'idle');
      await manager.suspend(collab.id, 'collaboration');
      // Backdate the idle suspension ~1h (past the 30-min idle TTL) but within the 2h collab cap.
      repo.touchActivity(idle.id, '2026-05-29T04:00:00.000Z');
      repo.touchActivity(collab.id, '2026-05-29T04:00:00.000Z');

      await manager.sweepIdle('2026-05-29T05:00:00.000Z');

      expect(repo.findById(idle.id)!.status).toBe('expired');
      // Collaboration is TTL-exempt and still within the absolute cap → left alive.
      expect(repo.findById(collab.id)!.status).toBe('suspended');
    });

    it('expires collaboration suspensions past the absolute liveness cap (ADR-5)', async () => {
      const collab = await manager.createSession(CREATE_PARAMS);
      await manager.suspend(collab.id, 'collaboration');
      // Backdate well beyond the default 2h collaboration cap.
      repo.touchActivity(collab.id, '2026-05-29T00:00:00.000Z');

      await manager.sweepIdle('2026-05-29T05:00:00.000Z');

      expect(repo.findById(collab.id)!.status).toBe('expired');
    });
  });

  describe('getActiveSession', () => {
    it('returns the active session for a role/org', async () => {
      await manager.createSession(CREATE_PARAMS);
      const found = manager.getActiveSession('role-1', 'org-1');
      expect(found).not.toBeNull();
      expect(found!.status).toBe('active');
    });

    it('returns null when none active', () => {
      expect(manager.getActiveSession('role-x', 'org-x')).toBeNull();
    });
  });

  describe('shutdown', () => {
    it('clears live cache and shuts down the spawner without terminating records', async () => {
      const session = await manager.createSession(CREATE_PARAMS);
      await manager.shutdown();
      expect(spawner.shutdown).toHaveBeenCalled();
      // Record left non-terminal for next-launch reconciliation.
      expect(repo.findById(session.id)!.status).toBe('active');
    });
  });
});
