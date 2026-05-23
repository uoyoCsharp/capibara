import { describe, it, expect, beforeEach, vi } from 'vitest';
import { AcpMcpConfigBuilder } from '@core/modules/acp/mcp/acp-mcp.config';
import { MockLogger } from '../../helpers/mock-logger';

// Mock electron app
vi.mock('electron', () => ({
  app: {
    isPackaged: false,
    getAppPath: () => '/app',
  },
}));

describe('AcpMcpConfigBuilder', () => {
  let builder: AcpMcpConfigBuilder;
  let logger: MockLogger;

  beforeEach(() => {
    logger = new MockLogger();
    builder = new AcpMcpConfigBuilder(logger);
  });

  describe('buildMcpServers', () => {
    it('should return empty array when port is not set', () => {
      const result = builder.buildMcpServers({} as any);

      expect(result).toEqual([]);
      expect(logger.logs.some(l => l.level === 'warn')).toBe(true);
    });

    it('should return MCP server config when port is set', () => {
      builder.setIpcPort(3456);

      const result = builder.buildMcpServers({} as any);

      expect(result).toHaveLength(1);
      expect(result[0].name).toBe('capibara');
      expect(result[0].command).toBe('node');
      expect(result[0].args).toContain('--port=3456');
      expect(result[0].env).toEqual([]);
    });

    it('should include bridge path in args', () => {
      builder.setIpcPort(8080);

      const result = builder.buildMcpServers({} as any);

      expect(result[0].args[0]).toContain('capibara-mcp-server.js');
    });
  });

  describe('setIpcPort', () => {
    it('should update port used in build', () => {
      builder.setIpcPort(1111);
      const result1 = builder.buildMcpServers({} as any);
      expect(result1[0].args).toContain('--port=1111');

      builder.setIpcPort(2222);
      const result2 = builder.buildMcpServers({} as any);
      expect(result2[0].args).toContain('--port=2222');
    });
  });
});
