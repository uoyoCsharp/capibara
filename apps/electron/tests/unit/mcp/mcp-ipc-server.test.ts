import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { request as httpRequest } from 'node:http';
import { McpIpcServer } from '@core/modules/mcp/server/mcp-ipc.server';
import { McpToolRegistry } from '@core/modules/mcp/registry/mcp-tool.registry';
import { MockLogger } from '../../helpers/mock-logger';

function httpPost(port: number, body: Record<string, unknown>, path = '/tool-call'): Promise<{ status: number; body: Record<string, unknown> }> {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const req = httpRequest({
      hostname: '127.0.0.1',
      port,
      path,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) },
    }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => {
        resolve({
          status: res.statusCode!,
          body: JSON.parse(Buffer.concat(chunks).toString('utf-8')),
        });
      });
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

describe('McpIpcServer', () => {
  let server: McpIpcServer;
  let registry: McpToolRegistry;
  let logger: MockLogger;

  beforeEach(() => {
    logger = new MockLogger();
    registry = new McpToolRegistry(logger);
    server = new McpIpcServer(registry, logger);
  });

  afterEach(() => {
    server.stop();
  });

  describe('getToolDefinitions', () => {
    it('returns tool metadata without handlers', () => {
      registry.register({
        name: 'tool_a', description: 'Tool A', inputSchema: { type: 'object' },
        handler: async () => ({}),
      });
      registry.register({
        name: 'tool_b', description: 'Tool B', inputSchema: { type: 'object' },
        handler: async () => ({}),
      });

      const defs = server.getToolDefinitions();
      expect(defs).toHaveLength(2);
      expect(defs[0]).toEqual({ name: 'tool_a', description: 'Tool A', inputSchema: { type: 'object' } });
      expect(defs[1]).toEqual({ name: 'tool_b', description: 'Tool B', inputSchema: { type: 'object' } });
      expect((defs[0] as Record<string, unknown>).handler).toBeUndefined();
    });
  });

  describe('HTTP server', () => {
    it('starts on a dynamic port > 0', async () => {
      const port = await server.start();
      expect(port).toBeGreaterThan(0);
      expect(server.getPort()).toBe(port);
    });

    it('returns same port on repeated start calls', async () => {
      const port1 = await server.start();
      const port2 = await server.start();
      expect(port1).toBe(port2);
    });

    it('resets port to 0 after stop', async () => {
      await server.start();
      server.stop();
      expect(server.getPort()).toBe(0);
    });

    it('returns 404 for non /tool-call paths', async () => {
      const port = await server.start();
      const res = await httpPost(port, {}, '/wrong');
      expect(res.status).toBe(404);
    });

    it('returns 200 with success for valid tool call', async () => {
      registry.register({
        name: 'echo', description: 'echo', inputSchema: {},
        handler: async (params) => ({ echo: params }),
      });
      const port = await server.start();

      const res = await httpPost(port, {
        toolName: 'echo', arguments: { msg: 'hi' },
      });

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ success: true, data: { echo: { msg: 'hi' } } });
    });

    it('returns success:false when tool handler throws', async () => {
      registry.register({
        name: 'fail_tool', description: 'fails', inputSchema: {},
        handler: async () => { throw new Error('boom'); },
      });
      const port = await server.start();

      const res = await httpPost(port, {
        toolName: 'fail_tool', arguments: {},
      });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(false);
      expect(res.body.error).toContain('boom');
    });

    it('returns success:false for unknown tool', async () => {
      const port = await server.start();

      const res = await httpPost(port, {
        toolName: 'nonexistent', arguments: {},
      });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(false);
      expect(res.body.error).toContain('Unknown MCP tool');
    });
  });
});
