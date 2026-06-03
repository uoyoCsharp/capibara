import { describe, it, expect, beforeEach, vi } from 'vitest';
import { AcpExecutor } from '@core/infrastructure/acp-protocol/acp-executor';
import type { IAcpSessionManager } from '@core/modules/acp/interfaces/i-acp-session.manager';
import type { AcpUpdateHandler } from '@core/modules/acp/handlers/acp-update.handler';
import type { AcpMcpConfigBuilder } from '@core/modules/acp/mcp/acp-mcp.config';
import type { AcpFilesystemHandler } from '@core/modules/acp/handlers/acp-filesystem.handler';
import type { AcpPermissionHandler } from '@core/modules/acp/handlers/acp-permission.handler';
import type { AcpAuditRepository } from '@core/modules/acp/persistence/acp-audit.repository';
import type { IRoleRepository } from '@core/modules/organization/interfaces/i-role.repository';
import type { AgentRegistryConfig } from '@core/modules/acp/types/acp.types';
import type { ExecutorInput } from '@core/modules/execution/types/execution.types';
import { MockLogger } from '../../helpers/mock-logger';

function createMockSessionManager(): IAcpSessionManager {
  return {
    createSession: vi.fn().mockResolvedValue({
      id: 'internal-1',
      acpSessionId: 'acp-sess-1',
      agentId: 'claude-agent',
      roleId: 'role-1',
      orgId: 'org-1',
      status: 'active',
    }),
    prompt: vi.fn().mockResolvedValue({
      stopReason: 'end_turn',
      textOutput: 'Task completed successfully',
      tokensUsed: { input: 500, output: 200, cached: 100 },
    }),
    suspend: vi.fn().mockResolvedValue(undefined),
    resume: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined),
    expire: vi.fn().mockResolvedValue(undefined),
    reconcileOnStartup: vi.fn().mockResolvedValue(undefined),
    sweepIdle: vi.fn().mockResolvedValue(undefined),
    cancelPrompt: vi.fn().mockResolvedValue(undefined),
    getAgentCapabilities: vi.fn().mockReturnValue(null),
    getActiveSession: vi.fn().mockReturnValue(null),
    findByAcpSessionId: vi.fn().mockReturnValue(null),
    shutdown: vi.fn().mockResolvedValue(undefined),
  };
}

function createMockUpdateHandler(): AcpUpdateHandler {
  const textCallbacks = new Map<string, Set<(text: string) => void>>();
  return {
    onLog: vi.fn(),
    onText: vi.fn().mockImplementation((sessionId: string, cb: (text: string) => void) => {
      if (!textCallbacks.has(sessionId)) textCallbacks.set(sessionId, new Set());
      textCallbacks.get(sessionId)!.add(cb);
    }),
    removeCallbacks: vi.fn().mockImplementation((sessionId: string) => {
      textCallbacks.delete(sessionId);
    }),
    handleUpdate: vi.fn(),
    setRunId: vi.fn(),
    // Test helper: simulate agent text chunks
    _emitText: (sessionId: string, text: string) => {
      textCallbacks.get(sessionId)?.forEach(cb => cb(text));
    },
  } as any;
}

function createMockMcpConfigBuilder(): AcpMcpConfigBuilder {
  return {
    buildMcpServers: vi.fn().mockReturnValue([
      { type: 'http', name: 'capibara', url: 'http://127.0.0.1:3000/mcp', headers: [] },
    ]),
    setHttpPort: vi.fn(),
  } as any;
}

function createTestInput(overrides?: Partial<ExecutorInput>): ExecutorInput {
  return {
    runId: 'run-1',
    taskId: 'task-1',
    roleId: 'role-1',
    orgId: 'org-1',
    projectDir: '/workspace',
    prompt: 'Implement the feature',
    ...overrides,
  } as ExecutorInput;
}

const agentConfig: AgentRegistryConfig = {
  defaultAgent: 'claude-agent',
  registry: [{ id: 'claude-agent', name: 'Claude Agent', command: 'claude', args: [] }],
  globalFilePolicy: { denyPatterns: [] },
};

describe('AcpExecutor', () => {
  let executor: AcpExecutor;
  let sessionManager: IAcpSessionManager;
  let updateHandler: ReturnType<typeof createMockUpdateHandler>;
  let mcpConfigBuilder: ReturnType<typeof createMockMcpConfigBuilder>;
  let logger: MockLogger;

  beforeEach(() => {
    sessionManager = createMockSessionManager();
    updateHandler = createMockUpdateHandler();
    mcpConfigBuilder = createMockMcpConfigBuilder();
    logger = new MockLogger();
    executor = new AcpExecutor(sessionManager, updateHandler, mcpConfigBuilder, agentConfig, logger);

    // Make prompt mock emit text chunks before resolving, simulating ACP streaming.
    (sessionManager.prompt as ReturnType<typeof vi.fn>).mockImplementation(async () => {
      (updateHandler as any)._emitText('acp-sess-1', 'Task completed successfully');
      return { stopReason: 'end_turn', textOutput: '', tokensUsed: { input: 500, output: 200, cached: 100 } };
    });
  });

  describe('spawn', () => {
    it('should create a session and return a handle', async () => {
      const input = createTestInput();
      const handle = await executor.spawn(input);

      expect(handle.runId).toBe('run-1');
      expect(typeof handle.complete).toBe('function');
      expect(typeof handle.cancel).toBe('function');
      expect(typeof handle.onLog).toBe('function');
    });

    it('should pass MCP servers from config builder to session creation', async () => {
      const input = createTestInput();
      await executor.spawn(input);

      expect(mcpConfigBuilder.buildMcpServers).toHaveBeenCalled();
      expect(sessionManager.createSession).toHaveBeenCalledWith(
        expect.objectContaining({
          agentId: 'claude-agent',
          mcpServers: [{ type: 'http', name: 'capibara', url: 'http://127.0.0.1:3000/mcp', headers: [] }],
        }),
      );
    });

    it('should register log callback via onLog', async () => {
      const input = createTestInput();
      const handle = await executor.spawn(input);
      const cb = vi.fn();

      handle.onLog(cb);

      expect(updateHandler.onLog).toHaveBeenCalledWith('acp-sess-1', cb);
    });
  });

  describe('complete', () => {
    it('should resolve with success output on end_turn', async () => {
      const input = createTestInput();
      const handle = await executor.spawn(input);
      const output = await handle.complete();

      expect(output.status).toBe('succeeded');
      expect(output.summary).toBe('Task completed successfully');
      expect(output.inputTokens).toBe(500);
      expect(output.outputTokens).toBe(200);
      expect(output.cachedInputTokens).toBe(100);
      expect(output.sessionId).toBe('acp-sess-1');
    });

    it('should close session and remove callbacks after a task completes (close_on_complete)', async () => {
      const input = createTestInput({ lifecycleIntent: 'close_on_complete' });
      const handle = await executor.spawn(input);
      await handle.complete();

      expect(sessionManager.close).toHaveBeenCalledWith('internal-1', 'completed');
      expect(sessionManager.suspend).not.toHaveBeenCalled();
      expect(updateHandler.removeCallbacks).toHaveBeenCalledWith('acp-sess-1');
    });

    it('should suspend (idle), not close, when intent is keep_alive (planning continuation)', async () => {
      const input = createTestInput({ lifecycleIntent: 'keep_alive' });
      const handle = await executor.spawn(input);
      const output = await handle.complete();

      expect(sessionManager.suspend).toHaveBeenCalledWith('internal-1', 'idle');
      expect(sessionManager.close).not.toHaveBeenCalled();
      expect(output.status).toBe('succeeded');
      expect(updateHandler.removeCallbacks).toHaveBeenCalledWith('acp-sess-1');
    });

    it('should default to close_on_complete when no intent is supplied', async () => {
      const input = createTestInput();
      const handle = await executor.spawn(input);
      await handle.complete();

      expect(sessionManager.close).toHaveBeenCalledWith('internal-1', 'completed');
    });

    it('should close with reason "error" on an abnormal stop reason', async () => {
      (sessionManager.prompt as ReturnType<typeof vi.fn>).mockResolvedValue({
        stopReason: 'max_tokens',
        textOutput: 'partial',
        tokensUsed: { input: 1000, output: 4096, cached: 0 },
      });
      const input = createTestInput({ lifecycleIntent: 'keep_alive' });
      const handle = await executor.spawn(input);
      const output = await handle.complete();

      expect(sessionManager.close).toHaveBeenCalledWith('internal-1', 'error');
      expect(sessionManager.suspend).not.toHaveBeenCalled();
      expect(output.status).toBe('failed');
    });

    it('should resolve with cancelled status on cancelled stop reason', async () => {
      (sessionManager.prompt as ReturnType<typeof vi.fn>).mockResolvedValue({
        stopReason: 'cancelled',
        textOutput: '',
        tokensUsed: { input: 100, output: 0, cached: 0 },
      });

      const input = createTestInput();
      const handle = await executor.spawn(input);
      const output = await handle.complete();

      expect(output.status).toBe('cancelled');
    });

    it('should resolve with failed status on max_tokens', async () => {
      (sessionManager.prompt as ReturnType<typeof vi.fn>).mockResolvedValue({
        stopReason: 'max_tokens',
        textOutput: 'partial',
        tokensUsed: { input: 1000, output: 4096, cached: 0 },
      });

      const input = createTestInput();
      const handle = await executor.spawn(input);
      const output = await handle.complete();

      expect(output.status).toBe('failed');
      expect(output.errorMessage).toBe('Agent stopped: max_tokens');
    });

    it('should handle prompt errors gracefully', async () => {
      (sessionManager.prompt as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('Connection lost'));

      const input = createTestInput();
      const handle = await executor.spawn(input);
      const output = await handle.complete();

      expect(output.status).toBe('failed');
      expect(output.errorMessage).toBe('Connection lost');
      expect(updateHandler.removeCallbacks).toHaveBeenCalledWith('acp-sess-1');
    });
  });

  describe('cancel', () => {
    it('should call cancelPrompt on session manager', async () => {
      const input = createTestInput();
      const handle = await executor.spawn(input);

      handle.cancel();

      // cancelPrompt is fire-and-forget
      await vi.waitFor(() => {
        expect(sessionManager.cancelPrompt).toHaveBeenCalledWith('internal-1');
      });
    });
  });

  describe('pending-inquiry suspension (collaboration)', () => {
    function wireCollaboration(): { suspend: ReturnType<typeof vi.fn> } {
      const suspend = vi.fn();
      const mockConvRepo = {
        findByTaskId: vi.fn().mockReturnValue([
          { id: 'inq-1', type: 'inquiry', initiatorRoleId: 'role-1', state: 'waiting', respondentRoleId: 'role-2' },
        ]),
      } as any;
      executor.setConversationRepository(mockConvRepo);
      executor.setSuspensionManager({ suspend } as any);
      return { suspend };
    }

    it('suspends the session (collaboration) without closing when an inquiry is pending', async () => {
      const { suspend } = wireCollaboration();

      const input = createTestInput({ lifecycleIntent: 'close_on_complete' });
      const handle = await executor.spawn(input);
      const output = await handle.complete();

      expect(sessionManager.suspend).toHaveBeenCalledWith('internal-1', 'collaboration');
      expect(sessionManager.close).not.toHaveBeenCalled();
      expect(suspend).toHaveBeenCalledWith(expect.objectContaining({
        sessionId: 'internal-1',
        awaitingInquiries: [{ conversationId: 'inq-1', respondentRoleId: 'role-2' }],
      }));
      expect(output.status).toBe('suspended');
    });

    it('closes (does not orphan-suspend) when an inquiry is pending but no suspension manager is wired', async () => {
      // Only the conversation repo is set — suspensionManager intentionally left unset.
      const mockConvRepo = {
        findByTaskId: vi.fn().mockReturnValue([
          { id: 'inq-1', type: 'inquiry', initiatorRoleId: 'role-1', state: 'waiting', respondentRoleId: 'role-2' },
        ]),
      } as any;
      executor.setConversationRepository(mockConvRepo);

      const input = createTestInput({ lifecycleIntent: 'close_on_complete' });
      const handle = await executor.spawn(input);
      const output = await handle.complete();

      // Must close rather than mark the session suspended-with-no-resume-record (orphan).
      expect(sessionManager.close).toHaveBeenCalledWith('internal-1', 'completed');
      expect(sessionManager.suspend).not.toHaveBeenCalled();
      expect(output.status).toBe('succeeded');
      expect(logger.logs.some(l => l.level === 'error' && /no suspension manager/i.test(l.msg))).toBe(true);
    });
  });

  describe('resume', () => {
    it('resumes an existing session via the manager and does not create a new one', async () => {
      (sessionManager.findByAcpSessionId as ReturnType<typeof vi.fn>).mockReturnValue({
        id: 'internal-1', acpSessionId: 'acp-sess-1', status: 'suspended',
      });

      const input = createTestInput({ sessionId: 'acp-sess-1', prompt: 'aggregated reply' });
      await executor.spawn(input);

      expect(sessionManager.resume).toHaveBeenCalledWith('internal-1');
      expect(sessionManager.createSession).not.toHaveBeenCalled();
    });

    it('falls back to a fresh session at INFO (not WARN) when resume fails', async () => {
      (sessionManager.findByAcpSessionId as ReturnType<typeof vi.fn>).mockReturnValue({
        id: 'internal-1', acpSessionId: 'acp-sess-1', status: 'suspended',
      });
      (sessionManager.resume as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('agent gone'));

      const input = createTestInput({ sessionId: 'acp-sess-1' });
      await executor.spawn(input);

      expect(sessionManager.createSession).toHaveBeenCalled();
      expect(logger.logs.some(l => l.level === 'warn')).toBe(false);
      expect(logger.logs.some(l => l.level === 'info' && /resume unavailable/i.test(l.msg))).toBe(true);
    });

    it('does not attempt resume on a closed session; starts fresh', async () => {
      (sessionManager.findByAcpSessionId as ReturnType<typeof vi.fn>).mockReturnValue({
        id: 'internal-1', acpSessionId: 'acp-sess-1', status: 'closed',
      });

      const input = createTestInput({ sessionId: 'acp-sess-1' });
      await executor.spawn(input);

      expect(sessionManager.resume).not.toHaveBeenCalled();
      expect(sessionManager.createSession).toHaveBeenCalled();
    });
  });

  describe('setRoleRepository + allowedPaths', () => {
    it('should pass undefined allowedPaths when no roleRepo is set', async () => {
      const input = createTestInput();
      await executor.spawn(input);

      expect(sessionManager.createSession).toHaveBeenCalledWith(
        expect.objectContaining({ allowedPaths: undefined }),
      );
    });

    it('should resolve allowedPaths from role when roleRepo is set', async () => {
      const mockRoleRepo: IRoleRepository = {
        findById: vi.fn().mockReturnValue({
          id: 'role-1',
          fileAccessPaths: ['src/**', 'docs/**'],
          toolPolicy: 'permissive',
        }),
        findByOrgId: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
        delete: vi.fn(),
      } as any;
      executor.setRoleRepository(mockRoleRepo);

      const input = createTestInput();
      await executor.spawn(input);

      expect(mockRoleRepo.findById).toHaveBeenCalledWith('role-1');
      expect(sessionManager.createSession).toHaveBeenCalledWith(
        expect.objectContaining({ allowedPaths: ['src/**', 'docs/**'] }),
      );
    });

    it('should pass undefined when role has null fileAccessPaths', async () => {
      const mockRoleRepo: IRoleRepository = {
        findById: vi.fn().mockReturnValue({
          id: 'role-1',
          fileAccessPaths: null,
          toolPolicy: 'permissive',
        }),
        findByOrgId: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
        delete: vi.fn(),
      } as any;
      executor.setRoleRepository(mockRoleRepo);

      const input = createTestInput();
      await executor.spawn(input);

      expect(sessionManager.createSession).toHaveBeenCalledWith(
        expect.objectContaining({ allowedPaths: undefined }),
      );
    });

    it('should pass undefined when role is not found', async () => {
      const mockRoleRepo: IRoleRepository = {
        findById: vi.fn().mockReturnValue(null),
        findByOrgId: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
        delete: vi.fn(),
      } as any;
      executor.setRoleRepository(mockRoleRepo);

      const input = createTestInput();
      await executor.spawn(input);

      expect(sessionManager.createSession).toHaveBeenCalledWith(
        expect.objectContaining({ allowedPaths: undefined }),
      );
    });
  });

  describe('setAuditComponents + audit flush', () => {
    let mockFilesystemHandler: AcpFilesystemHandler;
    let mockPermissionHandler: AcpPermissionHandler;
    let mockAuditRepo: AcpAuditRepository;

    beforeEach(() => {
      mockFilesystemHandler = {
        drainAccessLog: vi.fn().mockReturnValue([
          { sessionId: 's1', roleId: 'role-1', path: '/a.ts', operation: 'read', allowed: true },
        ]),
        handleReadFile: vi.fn(),
        handleWriteFile: vi.fn(),
      } as any;

      mockPermissionHandler = {
        drainToolCallLog: vi.fn().mockReturnValue([
          { sessionId: 's1', runId: 'run-1', toolCallId: 'tc-1', title: 'bash', kind: 'shell', permission: 'allowed' },
        ]),
        handlePermissionRequest: vi.fn(),
        setToolPolicy: vi.fn(),
      } as any;

      mockAuditRepo = {
        insertFileAccessLogs: vi.fn(),
        insertToolCallLogs: vi.fn(),
      } as any;
    });

    it('should flush audit logs after successful prompt', async () => {
      executor.setAuditComponents(mockFilesystemHandler, mockPermissionHandler, mockAuditRepo);

      const input = createTestInput();
      const handle = await executor.spawn(input);
      await handle.complete();

      expect(mockFilesystemHandler.drainAccessLog).toHaveBeenCalled();
      expect(mockPermissionHandler.drainToolCallLog).toHaveBeenCalled();
      expect(mockAuditRepo.insertFileAccessLogs).toHaveBeenCalledWith([
        { sessionId: 's1', roleId: 'role-1', path: '/a.ts', operation: 'read', allowed: true },
      ]);
      expect(mockAuditRepo.insertToolCallLogs).toHaveBeenCalledWith([
        { sessionId: 's1', runId: 'run-1', toolCallId: 'tc-1', title: 'bash', kind: 'shell', permission: 'allowed' },
      ]);
    });

    it('should flush audit logs even on prompt failure', async () => {
      (sessionManager.prompt as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('boom'));
      executor.setAuditComponents(mockFilesystemHandler, mockPermissionHandler, mockAuditRepo);

      const input = createTestInput();
      const handle = await executor.spawn(input);
      await handle.complete();

      expect(mockFilesystemHandler.drainAccessLog).toHaveBeenCalled();
      expect(mockPermissionHandler.drainToolCallLog).toHaveBeenCalled();
      expect(mockAuditRepo.insertFileAccessLogs).toHaveBeenCalled();
      expect(mockAuditRepo.insertToolCallLogs).toHaveBeenCalled();
    });

    it('should skip audit flush when no audit components are set', async () => {
      // No setAuditComponents call — should not throw
      const input = createTestInput();
      const handle = await executor.spawn(input);
      await handle.complete();

      // No assertion needed — just verify no crash
    });

    it('should skip insertion when drain returns empty arrays', async () => {
      (mockFilesystemHandler.drainAccessLog as ReturnType<typeof vi.fn>).mockReturnValue([]);
      (mockPermissionHandler.drainToolCallLog as ReturnType<typeof vi.fn>).mockReturnValue([]);
      executor.setAuditComponents(mockFilesystemHandler, mockPermissionHandler, mockAuditRepo);

      const input = createTestInput();
      const handle = await executor.spawn(input);
      await handle.complete();

      expect(mockAuditRepo.insertFileAccessLogs).not.toHaveBeenCalled();
      expect(mockAuditRepo.insertToolCallLogs).not.toHaveBeenCalled();
    });

    it('should not crash when audit flush throws', async () => {
      (mockAuditRepo.insertFileAccessLogs as ReturnType<typeof vi.fn>).mockImplementation(() => { throw new Error('db error'); });
      executor.setAuditComponents(mockFilesystemHandler, mockPermissionHandler, mockAuditRepo);

      const input = createTestInput();
      const handle = await executor.spawn(input);
      const output = await handle.complete();

      // Prompt should still succeed despite audit failure
      expect(output.status).toBe('succeeded');
    });
  });
});
