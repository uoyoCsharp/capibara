import { describe, it, expect, beforeEach, vi } from 'vitest';
import { AcpSessionManager } from '@core/modules/acp/client/acp-session.manager';
import type { AcpAgentSpawner } from '@core/modules/acp/client/acp-agent.spawner';
import type { AcpUpdateHandler } from '@core/modules/acp/handlers/acp-update.handler';
import { MockLogger } from '../../helpers/mock-logger';

function createMockConnection() {
  return {
    newSession: vi.fn().mockResolvedValue({ sessionId: 'acp-sess-1' }),
    prompt: vi.fn().mockResolvedValue({ stopReason: 'end_turn', usage: { inputTokens: 100, outputTokens: 50 } }),
    closeSession: vi.fn().mockResolvedValue({}),
    cancel: vi.fn().mockResolvedValue({}),
    resumeSession: vi.fn().mockResolvedValue({}),
    loadSession: vi.fn().mockResolvedValue({}),
    onNotification: vi.fn(),
    onRequest: vi.fn(),
    close: vi.fn(),
  };
}

function createMockSpawner(): AcpAgentSpawner {
  const connection = createMockConnection();
  return {
    getOrSpawn: vi.fn().mockResolvedValue({
      connection,
      child: { pid: 12345 },
      capabilities: { supportsResume: false, supportsLoad: false, mcpTransports: ['stdio'] },
    }),
    getCapabilities: vi.fn().mockReturnValue(null),
    shutdown: vi.fn().mockResolvedValue(undefined),
    setSessionContextResolver: vi.fn(),
    setFilesystemHandler: vi.fn(),
  } as any;
}

function createMockUpdateHandler(): AcpUpdateHandler {
  return {
    handleUpdate: vi.fn(),
    onLog: vi.fn(),
    onText: vi.fn(),
    removeCallbacks: vi.fn(),
  } as any;
}

describe('AcpSessionManager', () => {
  let manager: AcpSessionManager;
  let spawner: ReturnType<typeof createMockSpawner>;
  let updateHandler: ReturnType<typeof createMockUpdateHandler>;
  let logger: MockLogger;
  let mockConnection: ReturnType<typeof createMockConnection>;

  beforeEach(() => {
    spawner = createMockSpawner();
    updateHandler = createMockUpdateHandler();
    logger = new MockLogger();
    mockConnection = createMockConnection();

    // Setup spawner to use the shared mockConnection
    (spawner.getOrSpawn as ReturnType<typeof vi.fn>).mockResolvedValue({
      connection: mockConnection,
      child: { pid: 12345 },
      capabilities: { supportsResume: false, supportsLoad: false, mcpTransports: ['stdio'] },
    });

    manager = new AcpSessionManager(spawner, updateHandler, logger);
  });

  describe('createSession', () => {
    it('should spawn agent and create session via connection', async () => {
      const session = await manager.createSession({
        agentId: 'claude-agent',
        roleId: 'role-1',
        orgId: 'org-1',
        runId: 'run-1',
        taskId: 'task-1',
        cwd: '/workspace',
        mcpServers: [],
      });

      expect(spawner.getOrSpawn).toHaveBeenCalledWith('claude-agent');
      expect(mockConnection.newSession).toHaveBeenCalled();
      expect(session.acpSessionId).toBe('acp-sess-1');
      expect(session.agentId).toBe('claude-agent');
      expect(session.status).toBe('active');
    });

    it('should store session with correct metadata', async () => {
      const session = await manager.createSession({
        agentId: 'claude-agent',
        roleId: 'role-1',
        orgId: 'org-1',
        runId: 'run-1',
        taskId: 'task-1',
        cwd: '/workspace',
        mcpServers: [],
      });

      expect(session.cwd).toBe('/workspace');
      expect(session.resumeStrategy).toBe('rebuild'); // no resume or load support
      expect(session.resumeCount).toBe(0);
    });
  });

  describe('closeSession', () => {
    it('should send close request to connection', async () => {
      const session = await manager.createSession({
        agentId: 'claude-agent',
        roleId: 'role-1',
        orgId: 'org-1',
        runId: 'run-1',
        taskId: 'task-1',
        cwd: '/workspace',
        mcpServers: [],
      });

      await manager.closeSession(session.id);

      expect(mockConnection.closeSession).toHaveBeenCalledWith({ sessionId: 'acp-sess-1' });
    });
  });

  describe('getActiveSession', () => {
    it('should return null when no active session exists', () => {
      const result = manager.getActiveSession('role-1', 'org-1');
      expect(result).toBeNull();
    });

    it('should return active session after creation', async () => {
      await manager.createSession({
        agentId: 'claude-agent',
        roleId: 'role-1',
        orgId: 'org-1',
        runId: 'run-1',
        taskId: 'task-1',
        cwd: '/workspace',
        mcpServers: [],
      });

      const result = manager.getActiveSession('role-1', 'org-1');
      expect(result).not.toBeNull();
      expect(result!.agentId).toBe('claude-agent');
    });
  });

  describe('getAgentCapabilities', () => {
    it('should delegate to spawner', () => {
      manager.getAgentCapabilities('claude-agent');
      expect(spawner.getCapabilities).toHaveBeenCalledWith('claude-agent');
    });
  });

  describe('shutdown', () => {
    it('should close all sessions and shutdown spawner', async () => {
      await manager.shutdown();
      expect(spawner.shutdown).toHaveBeenCalled();
    });
  });
});
