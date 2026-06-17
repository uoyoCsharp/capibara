import { describe, it, expect, beforeEach } from 'vitest';
import { AcpMcpConfigBuilder } from '@core/modules/acp/mcp/acp-mcp.config';
import { MockLogger } from '../../helpers/mock-logger';

describe('AcpMcpConfigBuilder', () => {
  let builder: AcpMcpConfigBuilder;
  let logger: MockLogger;

  beforeEach(() => {
    logger = new MockLogger();
    builder = new AcpMcpConfigBuilder(logger);
  });

  describe('buildMcpServers', () => {
    it('should return empty array when port is not set', () => {
      const result = builder.buildMcpServers('session-key-1');

      expect(result).toEqual([]);
      expect(logger.logs.some(l => l.level === 'warn')).toBe(true);
    });

    it('should return HTTP MCP server config with session key in URL by default', () => {
      builder.setHttpPort(3456);

      const result = builder.buildMcpServers('session-key-1');

      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        type: 'http',
        name: 'capibara',
        url: 'http://127.0.0.1:3456/mcp/session-key-1',
        headers: [],
      });
    });

    it('should return SSE config when transport is sse (session key not used in SSE URL)', () => {
      builder.setHttpPort(3456);

      const result = builder.buildMcpServers('session-key-1', 'sse');

      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        type: 'sse',
        name: 'capibara',
        url: 'http://127.0.0.1:3456/sse',
      });
    });

    it('should return Streamable HTTP config with session key when transport is http', () => {
      builder.setHttpPort(3456);

      const result = builder.buildMcpServers('my-session-key', 'http');

      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        type: 'http',
        name: 'capibara',
        url: 'http://127.0.0.1:3456/mcp/my-session-key',
      });
    });
  });

  describe('setHttpPort', () => {
    it('should update port used in build', () => {
      builder.setHttpPort(1111);
      const result1 = builder.buildMcpServers('sk-1', 'sse');
      expect(result1[0]).toHaveProperty('url', 'http://127.0.0.1:1111/sse');

      builder.setHttpPort(2222);
      const result2 = builder.buildMcpServers('sk-2', 'http');
      expect(result2[0]).toHaveProperty('url', 'http://127.0.0.1:2222/mcp/sk-2');
    });
  });
});
