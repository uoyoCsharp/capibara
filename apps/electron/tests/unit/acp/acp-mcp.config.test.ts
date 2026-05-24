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
      const result = builder.buildMcpServers();

      expect(result).toEqual([]);
      expect(logger.logs.some(l => l.level === 'warn')).toBe(true);
    });

    it('should return HTTP MCP server config when port is set', () => {
      builder.setHttpPort(3456);

      const result = builder.buildMcpServers();

      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        type: 'http',
        name: 'capibara',
        url: 'http://127.0.0.1:3456/mcp',
        headers: [],
      });
    });
  });

  describe('setHttpPort', () => {
    it('should update port used in build', () => {
      builder.setHttpPort(1111);
      const result1 = builder.buildMcpServers();
      expect(result1[0]).toHaveProperty('url', 'http://127.0.0.1:1111/mcp');

      builder.setHttpPort(2222);
      const result2 = builder.buildMcpServers();
      expect(result2[0]).toHaveProperty('url', 'http://127.0.0.1:2222/mcp');
    });
  });
});
