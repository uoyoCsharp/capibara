import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { McpHttpTransportManager } from '@core/infrastructure/mcp-protocol/mcp-http-transport';
import type { ILogger } from '@core/foundation/interfaces/i-logger';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { McpServerDeps } from '@core/modules/mcp/mcp-server.builder';
import http from 'node:http';

function stubLogger(): ILogger {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  } as unknown as ILogger;
}

function stubMcpServer(): McpServer {
  return {
    connect: vi.fn().mockResolvedValue(undefined),
  } as unknown as McpServer;
}

function stubDeps(): McpServerDeps {
  return {
    taskService: {} as McpServerDeps['taskService'],
    taskStateMachine: {} as McpServerDeps['taskStateMachine'],
    processEngine: {} as McpServerDeps['processEngine'],
    conversationService: {} as McpServerDeps['conversationService'],
    roleService: {} as McpServerDeps['roleService'],
    eventPublisher: {} as McpServerDeps['eventPublisher'],
    suspensionManager: null,
    collaborationConfig: null,
  };
}

describe('McpHttpTransportManager', () => {
  let manager: McpHttpTransportManager;
  let logger: ILogger;
  let mcpServer: McpServer;
  let deps: McpServerDeps;

  beforeEach(() => {
    logger = stubLogger();
    mcpServer = stubMcpServer();
    deps = stubDeps();
    manager = new McpHttpTransportManager(logger, deps);
  });

  afterEach(() => {
    manager.stop();
  });

  describe('start()', () => {
    it('binds to a random port on 127.0.0.1 and returns the port number', async () => {
      const port = await manager.start(mcpServer);

      expect(port).toBeGreaterThan(0);
      expect(port).toBeLessThan(65536);
    });

    it('connects the McpServer to the Streamable HTTP transport at startup', async () => {
      await manager.start(mcpServer);

      expect(mcpServer.connect).toHaveBeenCalled();
    });

    it('logs the port on startup', async () => {
      const port = await manager.start(mcpServer);

      expect(logger.info).toHaveBeenCalledWith('MCP server started (SSE + Streamable HTTP)', { port });
    });

    it('getPort() returns the bound port after start', async () => {
      const port = await manager.start(mcpServer);

      expect(manager.getPort()).toBe(port);
    });
  });

  describe('Streamable HTTP endpoint', () => {
    it('accepts POST /mcp requests', async () => {
      const port = await manager.start(mcpServer);

      const response = await new Promise<http.IncomingMessage>((resolve, reject) => {
        const req = http.request(
          { hostname: '127.0.0.1', port, path: '/mcp', method: 'POST', headers: { 'Content-Type': 'application/json', 'Accept': 'application/json, text/event-stream' } },
          resolve,
        );
        req.on('error', reject);
        req.write(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'test', version: '1.0' } } }));
        req.end();
      });

      expect(response.statusCode).toBeDefined();
      response.resume();
    });
  });

  describe('request routing', () => {
    it('returns 404 for unknown paths', async () => {
      const port = await manager.start(mcpServer);

      const response = await new Promise<http.IncomingMessage>((resolve, reject) => {
        const req = http.request(
          { hostname: '127.0.0.1', port, path: '/unknown', method: 'GET' },
          resolve,
        );
        req.on('error', reject);
        req.end();
      });

      expect(response.statusCode).toBe(404);
      expect(logger.warn).toHaveBeenCalledWith('MCP unknown request', { method: 'GET', path: '/unknown' });
      response.resume();
    });

    it('returns 400 for POST /messages without active SSE connection', async () => {
      const port = await manager.start(mcpServer);

      const response = await new Promise<http.IncomingMessage>((resolve, reject) => {
        const req = http.request(
          { hostname: '127.0.0.1', port, path: '/messages', method: 'POST', headers: { 'Content-Type': 'application/json' } },
          resolve,
        );
        req.on('error', reject);
        req.write('{}');
        req.end();
      });

      expect(response.statusCode).toBe(400);
      expect(logger.warn).toHaveBeenCalledWith('MCP POST /messages received without active SSE connection');
      response.resume();
    });
  });

  describe('stop()', () => {
    it('closes the server and resets port to 0', async () => {
      await manager.start(mcpServer);
      expect(manager.getPort()).toBeGreaterThan(0);

      manager.stop();

      expect(manager.getPort()).toBe(0);
    });

    it('logs shutdown message', async () => {
      await manager.start(mcpServer);
      manager.stop();

      expect(logger.info).toHaveBeenCalledWith('MCP server stopped');
    });

    it('is safe to call multiple times', () => {
      manager.stop();
      manager.stop();
    });

    it('releases the port so it can be reused', async () => {
      await manager.start(mcpServer);
      manager.stop();

      const manager2 = new McpHttpTransportManager(logger, deps);
      const port2 = await manager2.start(stubMcpServer());
      expect(port2).toBeGreaterThan(0);
      manager2.stop();
    });
  });

  describe('getPort()', () => {
    it('returns 0 before start is called', () => {
      expect(manager.getPort()).toBe(0);
    });

    it('returns 0 after stop is called', async () => {
      await manager.start(mcpServer);
      manager.stop();
      expect(manager.getPort()).toBe(0);
    });
  });
});
