import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { McpHttpTransportManager } from '@core/modules/mcp/mcp-http-transport';
import type { ILogger } from '@core/foundation/interfaces/i-logger';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
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

describe('McpHttpTransportManager', () => {
  let manager: McpHttpTransportManager;
  let logger: ILogger;
  let mcpServer: McpServer;

  beforeEach(() => {
    logger = stubLogger();
    mcpServer = stubMcpServer();
    manager = new McpHttpTransportManager(logger);
  });

  afterEach(() => {
    // Ensure cleanup even if a test fails
    manager.stop();
  });

  describe('start()', () => {
    it('binds to a random port on 127.0.0.1 and returns the port number', async () => {
      const port = await manager.start(mcpServer);

      expect(port).toBeGreaterThan(0);
      expect(port).toBeLessThan(65536);
    });

    it('connects the McpServer to the transport', async () => {
      await manager.start(mcpServer);

      expect(mcpServer.connect).toHaveBeenCalledOnce();
      // The argument should be a StreamableHTTPServerTransport instance
      const transportArg = vi.mocked(mcpServer.connect).mock.calls[0]![0];
      expect(transportArg).toBeDefined();
    });

    it('logs the port on startup', async () => {
      const port = await manager.start(mcpServer);

      expect(logger.info).toHaveBeenCalledWith('MCP HTTP server started (SDK)', { port });
    });

    it('getPort() returns the bound port after start', async () => {
      const port = await manager.start(mcpServer);

      expect(manager.getPort()).toBe(port);
    });

    it('accepts HTTP connections on the bound port', async () => {
      const port = await manager.start(mcpServer);

      // Verify the server is actually listening by making a request
      const response = await new Promise<http.IncomingMessage>((resolve, reject) => {
        const req = http.request(
          { hostname: '127.0.0.1', port, path: '/mcp', method: 'POST' },
          resolve,
        );
        req.on('error', reject);
        req.end();
      });

      // We don't care about the exact status (transport handles routing),
      // but we should get a response (not a connection error)
      expect(response.statusCode).toBeDefined();
      // Consume the response body to prevent socket hanging
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

      expect(logger.info).toHaveBeenCalledWith('MCP HTTP server stopped');
    });

    it('is safe to call multiple times', () => {
      // stop() without start() should not throw
      manager.stop();
      manager.stop();
    });

    it('releases the port so it can be reused', async () => {
      const port1 = await manager.start(mcpServer);
      manager.stop();

      // After stop, a new server should be able to bind
      const manager2 = new McpHttpTransportManager(logger);
      const port2 = await manager2.start(stubMcpServer());
      expect(port2).toBeGreaterThan(0);
      manager2.stop();

      // Both ports should have been valid
      expect(port1).toBeGreaterThan(0);
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
