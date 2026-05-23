import { describe, it, expect, beforeEach, vi } from 'vitest';
import { AcpFilesystemHandler } from '@core/modules/acp/handlers/acp-filesystem.handler';
import type { IFileAccessPolicy } from '@core/modules/acp/policies/file-access.policy';
import { MockLogger } from '../../helpers/mock-logger';

vi.mock('node:fs/promises', () => ({
  readFile: vi.fn(),
  writeFile: vi.fn(),
}));

import { readFile, writeFile } from 'node:fs/promises';

const mockReadFile = vi.mocked(readFile);
const mockWriteFile = vi.mocked(writeFile);

function createMockPolicy(allowed = true, reason?: string): IFileAccessPolicy {
  return {
    checkRead: vi.fn().mockReturnValue({ allowed, reason }),
    checkWrite: vi.fn().mockReturnValue({ allowed, reason }),
  };
}

describe('AcpFilesystemHandler', () => {
  let handler: AcpFilesystemHandler;
  let policy: IFileAccessPolicy;
  let logger: MockLogger;

  const sessionContext = {
    roleId: 'role-1',
    cwd: '/workspace',
    allowedPaths: ['src/**', 'tests/**'],
  };

  beforeEach(() => {
    vi.clearAllMocks();
    logger = new MockLogger();
    policy = createMockPolicy(true);
    handler = new AcpFilesystemHandler(policy, logger);
  });

  describe('handleReadFile', () => {
    it('should read file when policy allows', async () => {
      mockReadFile.mockResolvedValue('file content here');

      const result = await handler.handleReadFile('sess-1', sessionContext, { path: '/workspace/src/app.ts' });

      expect(policy.checkRead).toHaveBeenCalledWith('/workspace/src/app.ts', '/workspace', ['src/**', 'tests/**']);
      expect(result).toEqual({ content: 'file content here' });
    });

    it('should deny read when policy rejects', async () => {
      policy = createMockPolicy(false, 'Path outside workspace');
      handler = new AcpFilesystemHandler(policy, logger);

      const result = await handler.handleReadFile('sess-1', sessionContext, { path: '/etc/passwd' });

      expect(result).toEqual({ error: 'Access denied: Path outside workspace' });
      expect(mockReadFile).not.toHaveBeenCalled();
    });

    it('should support line range reading', async () => {
      mockReadFile.mockResolvedValue('line1\nline2\nline3\nline4\nline5');

      const result = await handler.handleReadFile('sess-1', sessionContext, {
        path: '/workspace/src/app.ts',
        line: 2,
        limit: 2,
      });

      expect(result).toEqual({ content: 'line2\nline3' });
    });

    it('should handle IO errors gracefully', async () => {
      mockReadFile.mockRejectedValue(new Error('ENOENT: no such file'));

      const result = await handler.handleReadFile('sess-1', sessionContext, { path: '/workspace/src/missing.ts' });

      expect(result).toEqual({ error: 'IO error: ENOENT: no such file' });
    });

    it('should handle null allowedPaths', async () => {
      mockReadFile.mockResolvedValue('content');
      const ctx = { ...sessionContext, allowedPaths: null };

      const result = await handler.handleReadFile('sess-1', ctx, { path: '/workspace/src/app.ts' });

      expect(policy.checkRead).toHaveBeenCalledWith('/workspace/src/app.ts', '/workspace', undefined);
      expect(result).toEqual({ content: 'content' });
    });
  });

  describe('handleWriteFile', () => {
    it('should write file when policy allows', async () => {
      mockWriteFile.mockResolvedValue(undefined);

      const result = await handler.handleWriteFile('sess-1', sessionContext, {
        path: '/workspace/src/new.ts',
        content: 'new file content',
      });

      expect(result).toBeNull();
      expect(mockWriteFile).toHaveBeenCalledWith('/workspace/src/new.ts', 'new file content', 'utf-8');
    });

    it('should deny write when policy rejects', async () => {
      policy = createMockPolicy(false, 'Path matches global deny pattern');
      handler = new AcpFilesystemHandler(policy, logger);

      const result = await handler.handleWriteFile('sess-1', sessionContext, {
        path: '/workspace/.env',
        content: 'SECRET=abc',
      });

      expect(result).toEqual({ error: 'Access denied: Path matches global deny pattern' });
      expect(mockWriteFile).not.toHaveBeenCalled();
    });

    it('should handle IO errors gracefully', async () => {
      mockWriteFile.mockRejectedValue(new Error('EACCES: permission denied'));

      const result = await handler.handleWriteFile('sess-1', sessionContext, {
        path: '/workspace/src/readonly.ts',
        content: 'content',
      });

      expect(result).toEqual({ error: 'IO error: EACCES: permission denied' });
    });
  });

  describe('drainAccessLog', () => {
    it('should collect access log entries', async () => {
      mockReadFile.mockResolvedValue('content');

      await handler.handleReadFile('sess-1', sessionContext, { path: '/workspace/src/app.ts' });
      await handler.handleReadFile('sess-1', sessionContext, { path: '/workspace/src/index.ts' });

      const logs = handler.drainAccessLog();
      expect(logs).toHaveLength(2);
      expect(logs[0]).toMatchObject({
        sessionId: 'sess-1',
        roleId: 'role-1',
        path: '/workspace/src/app.ts',
        operation: 'read',
        allowed: true,
      });
    });

    it('should clear log after drain', async () => {
      mockReadFile.mockResolvedValue('content');
      await handler.handleReadFile('sess-1', sessionContext, { path: '/workspace/src/app.ts' });

      handler.drainAccessLog();
      const secondDrain = handler.drainAccessLog();
      expect(secondDrain).toHaveLength(0);
    });

    it('should log denied access entries', async () => {
      policy = createMockPolicy(false, 'denied reason');
      handler = new AcpFilesystemHandler(policy, logger);

      await handler.handleReadFile('sess-1', sessionContext, { path: '/workspace/.env' });

      const logs = handler.drainAccessLog();
      expect(logs[0]).toMatchObject({
        allowed: false,
        reason: 'denied reason',
      });
    });
  });
});
