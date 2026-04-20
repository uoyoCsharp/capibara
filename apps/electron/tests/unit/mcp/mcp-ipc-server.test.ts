import { describe, it, expect, beforeEach } from 'vitest';
import { McpIpcServer } from '@core/modules/mcp/server/mcp-ipc.server';
import { MockLogger } from '../../helpers/mock-logger';
import type { McpToolRegistry } from '@core/modules/mcp/registry/mcp-tool.registry';

describe('McpIpcServer', () => {
  let server: McpIpcServer;
  let toolRegistry: McpToolRegistry;
  let logger: MockLogger;

  beforeEach(() => {
    toolRegistry = {
      register: vi.fn(),
      get: vi.fn(),
      getAll: vi.fn().mockReturnValue([
        { name: 'tool_a', description: 'Tool A', inputSchema: { type: 'object' }, handler: vi.fn() },
        { name: 'tool_b', description: 'Tool B', inputSchema: { type: 'object' }, handler: vi.fn() },
      ]),
      dispatch: vi.fn().mockResolvedValue({ ok: true }),
    } as unknown as McpToolRegistry;
    logger = new MockLogger();

    server = new McpIpcServer(toolRegistry, logger);
  });

  describe('registerToken / validateToken', () => {
    it('validates registered token correctly', () => {
      server.registerToken('run-1', 'secret-token');
      expect(server.validateToken('run-1', 'secret-token')).toBe(true);
    });

    it('rejects wrong token', () => {
      server.registerToken('run-1', 'correct');
      expect(server.validateToken('run-1', 'wrong')).toBe(false);
    });

    it('rejects unregistered runId', () => {
      expect(server.validateToken('unknown-run', 'any')).toBe(false);
    });
  });

  describe('revokeToken', () => {
    it('removes token so validation fails', () => {
      server.registerToken('run-1', 'token');
      server.revokeToken('run-1');
      expect(server.validateToken('run-1', 'token')).toBe(false);
    });
  });

  describe('handleToolCall', () => {
    it('dispatches tool call when token is valid', async () => {
      server.registerToken('run-1', 'valid-token');
      const result = await server.handleToolCall('tool_a', { x: 1 }, 'run-1', 'valid-token');
      expect(toolRegistry.dispatch).toHaveBeenCalledWith('tool_a', { x: 1 }, 'run-1');
      expect(result).toEqual({ ok: true });
    });

    it('throws when token is invalid', async () => {
      server.registerToken('run-1', 'correct');
      await expect(
        server.handleToolCall('tool_a', {}, 'run-1', 'wrong'),
      ).rejects.toThrow('Invalid MCP token');
    });

    it('throws when run has no token registered', async () => {
      await expect(
        server.handleToolCall('tool_a', {}, 'run-x', 'any'),
      ).rejects.toThrow('Invalid MCP token');
    });
  });

  describe('getToolDefinitions', () => {
    it('returns tool metadata without handlers', () => {
      const defs = server.getToolDefinitions();
      expect(defs).toHaveLength(2);
      expect(defs[0]).toEqual({ name: 'tool_a', description: 'Tool A', inputSchema: { type: 'object' } });
      expect(defs[1]).toEqual({ name: 'tool_b', description: 'Tool B', inputSchema: { type: 'object' } });
      expect((defs[0] as Record<string, unknown>).handler).toBeUndefined();
    });
  });
});
