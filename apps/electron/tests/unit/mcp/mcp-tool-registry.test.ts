import { describe, it, expect, beforeEach } from 'vitest';
import { McpToolRegistry } from '@core/modules/mcp/registry/mcp-tool.registry';
import { MockLogger } from '../../helpers/mock-logger';
import type { McpToolDefinition } from '@core/modules/mcp/registry/mcp-tool.registry';

function createTool(overrides?: Partial<McpToolDefinition>): McpToolDefinition {
  return {
    name: 'test_tool',
    description: 'A test tool',
    inputSchema: { type: 'object', properties: {} },
    handler: vi.fn().mockResolvedValue({ ok: true }),
    ...overrides,
  };
}

describe('McpToolRegistry', () => {
  let registry: McpToolRegistry;
  let logger: MockLogger;

  beforeEach(() => {
    logger = new MockLogger();
    registry = new McpToolRegistry(logger);
  });

  describe('register', () => {
    it('registers a tool and logs debug message', () => {
      registry.register(createTool({ name: 'my_tool' }));
      expect(registry.get('my_tool')).toBeDefined();
      expect(logger.logs.some((l) => l.level === 'debug' && l.msg.includes('registered'))).toBe(true);
    });

    it('overwrites existing tool with same name', () => {
      registry.register(createTool({ name: 'dup', description: 'first' }));
      registry.register(createTool({ name: 'dup', description: 'second' }));
      expect(registry.get('dup')!.description).toBe('second');
    });
  });

  describe('get', () => {
    it('returns tool when registered', () => {
      registry.register(createTool({ name: 'found' }));
      expect(registry.get('found')).toBeDefined();
      expect(registry.get('found')!.name).toBe('found');
    });

    it('returns undefined when not registered', () => {
      expect(registry.get('nonexistent')).toBeUndefined();
    });
  });

  describe('getAll', () => {
    it('returns empty array when no tools registered', () => {
      expect(registry.getAll()).toEqual([]);
    });

    it('returns all registered tools', () => {
      registry.register(createTool({ name: 'tool_a' }));
      registry.register(createTool({ name: 'tool_b' }));
      const all = registry.getAll();
      expect(all).toHaveLength(2);
      expect(all.map((t) => t.name).sort()).toEqual(['tool_a', 'tool_b']);
    });
  });

  describe('dispatch', () => {
    it('calls handler with params and runId', async () => {
      const handler = vi.fn().mockResolvedValue({ result: 'done' });
      registry.register(createTool({ name: 'my_tool', handler }));

      const result = await registry.dispatch('my_tool', { key: 'value' }, 'run-1');
      expect(handler).toHaveBeenCalledWith({ key: 'value' }, 'run-1');
      expect(result).toEqual({ result: 'done' });
    });

    it('throws when tool not found', async () => {
      await expect(registry.dispatch('missing', {}, 'run-1')).rejects.toThrow('Unknown MCP tool: missing');
    });

    it('logs info on successful dispatch (visible at default level)', async () => {
      registry.register(createTool({ name: 'logged_tool' }));
      await registry.dispatch('logged_tool', {}, 'run-1');
      expect(logger.logs.some((l) => l.level === 'info' && l.msg === 'MCP tool call started')).toBe(true);
      expect(logger.logs.some((l) => l.level === 'info' && l.msg === 'MCP tool call completed')).toBe(true);
    });

    it('logs params at debug level (requires CAPIBARA_LOG_LEVEL=debug to surface)', async () => {
      registry.register(createTool({ name: 'logged_tool' }));
      await registry.dispatch('logged_tool', { foo: 'bar' }, 'run-1');
      const paramsLog = logger.logs.find((l) => l.msg === 'MCP tool call params');
      expect(paramsLog).toBeDefined();
      expect(paramsLog!.level).toBe('debug');
    });

    it('logs error and rethrows when handler fails', async () => {
      const handler = vi.fn().mockRejectedValue(new Error('handler error'));
      registry.register(createTool({ name: 'err_tool', handler }));

      await expect(registry.dispatch('err_tool', {}, 'run-1')).rejects.toThrow('handler error');
      expect(logger.logs.some((l) => l.level === 'error' && l.msg === 'MCP tool call failed')).toBe(true);
    });

    it('logs error for unknown tool dispatch', async () => {
      await expect(registry.dispatch('nope', {}, 'run-1')).rejects.toThrow();
      expect(logger.logs.some((l) => l.level === 'error' && l.msg === 'MCP dispatch: unknown tool')).toBe(true);
    });
  });
});
