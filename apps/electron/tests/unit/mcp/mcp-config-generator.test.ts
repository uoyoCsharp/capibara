import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { MockLogger } from '../../helpers/mock-logger';

vi.mock('electron', () => ({
  app: {
    getAppPath: () => '/mock/app/path',
  },
}));

import { McpConfigGenerator } from '@core/modules/mcp/config/mcp-config-generator';

describe('McpConfigGenerator', () => {
  let generator: McpConfigGenerator;
  let logger: MockLogger;
  const tempDir = join(tmpdir(), 'capibara-mcp');

  beforeEach(() => {
    logger = new MockLogger();
    generator = new McpConfigGenerator(logger);
  });

  afterEach(() => {
    generator.cleanup();
    try { rmSync(tempDir, { recursive: true, force: true }); } catch { /* ok */ }
  });

  describe('getBridgePath', () => {
    it('returns bridge path based on app path', () => {
      const path = generator.getBridgePath();
      expect(path).toBe(join('/mock/app/path', 'out', 'main', 'capibara-mcp-bridge.js'));
    });
  });

  describe('generate', () => {
    it('writes config JSON file with correct structure', () => {
      const filePath = generator.generate(12345);

      expect(existsSync(filePath)).toBe(true);
      expect(filePath).toContain('capibara-mcp.json');

      const content = JSON.parse(readFileSync(filePath, 'utf-8'));
      expect(content.mcpServers.capibara.command).toBe('node');
      expect(content.mcpServers.capibara.args).toContain('--port=12345');
      expect(content.mcpServers.capibara.args.some((a: string) => a.includes('capibara-mcp-bridge.js'))).toBe(true);
    });

    it('stores config path for later retrieval', () => {
      expect(generator.getConfigPath()).toBeNull();
      const filePath = generator.generate(1);
      expect(generator.getConfigPath()).toBe(filePath);
    });

    it('logs debug message', () => {
      generator.generate(1);
      expect(logger.logs.some((l) => l.level === 'debug' && l.msg === 'MCP config generated')).toBe(true);
    });
  });

  describe('cleanup', () => {
    it('deletes the config file', () => {
      const filePath = generator.generate(1);
      expect(existsSync(filePath)).toBe(true);

      generator.cleanup();
      expect(existsSync(filePath)).toBe(false);
      expect(generator.getConfigPath()).toBeNull();
    });

    it('does not throw when no config was generated', () => {
      expect(() => generator.cleanup()).not.toThrow();
    });

    it('logs debug message', () => {
      generator.generate(1);
      generator.cleanup();
      expect(logger.logs.some((l) => l.level === 'debug' && l.msg === 'MCP config cleaned up')).toBe(true);
    });
  });
});
