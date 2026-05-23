import { describe, it, expect, beforeEach, vi } from 'vitest';
import { AcpExecutor } from '@core/modules/acp/client/acp-executor';
import type { IAcpSessionManager } from '@core/modules/acp/interfaces/i-acp-session.manager';
import type { AcpUpdateHandler } from '@core/modules/acp/handlers/acp-update.handler';
import type { AcpMcpConfigBuilder } from '@core/modules/acp/mcp/acp-mcp.config';
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
    resumeSession: vi.fn().mockResolvedValue(undefined),
    closeSession: vi.fn().mockResolvedValue(undefined),
    cancelPrompt: vi.fn().mockResolvedValue(undefined),
    getAgentCapabilities: vi.fn().mockReturnValue(null),
    getActiveSession: vi.fn().mockReturnValue(null),
    shutdown: vi.fn().mockResolvedValue(undefined),
  };
}

function createMockUpdateHandler(): AcpUpdateHandler {
  return {
    onLog: vi.fn(),
    onText: vi.fn(),
    removeCallbacks: vi.fn(),
    handleUpdate: vi.fn(),
  } as any;
}

function createMockMcpConfigBuilder(): AcpMcpConfigBuilder {
  return {
    buildMcpServers: vi.fn().mockReturnValue([
      { name: 'capibara', command: 'node', args: ['mcp-server.js', '--port=3000'], env: [] },
    ]),
    setIpcPort: vi.fn(),
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
  agents: [],
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
  });

  describe('spawn', () => {
    it('should create a session and return a handle', async () => {
      const input = createTestInput();
      const handle = await executor.spawn(input);

      expect(handle.runId).toBe('run-1');
      expect(handle.pid).toBe(process.pid);
      expect(typeof handle.complete).toBe('function');
      expect(typeof handle.cancel).toBe('function');
      expect(typeof handle.onLog).toBe('function');
    });

    it('should pass MCP servers from config builder to session creation', async () => {
      const input = createTestInput();
      await executor.spawn(input);

      expect(mcpConfigBuilder.buildMcpServers).toHaveBeenCalledWith(input);
      expect(sessionManager.createSession).toHaveBeenCalledWith(
        expect.objectContaining({
          agentId: 'claude-agent',
          mcpServers: [{ name: 'capibara', command: 'node', args: ['mcp-server.js', '--port=3000'], env: [] }],
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

      expect(output.exitCode).toBe(0);
      expect(output.status).toBe('succeeded');
      expect(output.summary).toBe('Task completed successfully');
      expect(output.inputTokens).toBe(500);
      expect(output.outputTokens).toBe(200);
      expect(output.cachedInputTokens).toBe(100);
      expect(output.sessionId).toBe('acp-sess-1');
    });

    it('should close session and remove callbacks after completion', async () => {
      const input = createTestInput();
      const handle = await executor.spawn(input);
      await handle.complete();

      expect(sessionManager.closeSession).toHaveBeenCalledWith('internal-1');
      expect(updateHandler.removeCallbacks).toHaveBeenCalledWith('acp-sess-1');
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

      expect(output.exitCode).toBe(1);
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

      expect(output.exitCode).toBe(1);
      expect(output.status).toBe('failed');
      expect(output.errorMessage).toBe('Agent stopped: max_tokens');
    });

    it('should handle prompt errors gracefully', async () => {
      (sessionManager.prompt as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('Connection lost'));

      const input = createTestInput();
      const handle = await executor.spawn(input);
      const output = await handle.complete();

      expect(output.exitCode).toBe(1);
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
});
