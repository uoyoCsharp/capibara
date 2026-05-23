import { readFile, writeFile } from 'node:fs/promises';
import type { ILogger } from '@core/foundation/interfaces/i-logger';
import type { IFileAccessPolicy, AccessDecision } from '../policies/file-access.policy';

export interface FileSessionContext {
  roleId: string;
  cwd: string;
  allowedPaths: string[] | null;
}

export interface ReadFileParams {
  path: string;
  line?: number;
  limit?: number;
}

export interface WriteFileParams {
  path: string;
  content: string;
}

export interface FileAccessLogEntry {
  sessionId: string;
  roleId: string;
  path: string;
  operation: 'read' | 'write';
  allowed: boolean;
  reason?: string;
}

/**
 * Implements ACP fs/read_text_file and fs/write_text_file.
 * All file access passes through the IFileAccessPolicy for authorization.
 */
export class AcpFilesystemHandler {
  private readonly accessLog: FileAccessLogEntry[] = [];

  constructor(
    private readonly filePolicy: IFileAccessPolicy,
    private readonly logger: ILogger,
  ) {}

  async handleReadFile(
    sessionId: string,
    context: FileSessionContext,
    params: ReadFileParams,
  ): Promise<{ content: string } | { error: string }> {
    const { roleId, cwd, allowedPaths } = context;

    const access = this.filePolicy.checkRead(params.path, cwd, allowedPaths ?? undefined);
    this.logAccess(sessionId, roleId, params.path, 'read', access);

    if (!access.allowed) {
      this.logger.warn('File read denied', { roleId, path: params.path, reason: access.reason });
      return { error: `Access denied: ${access.reason}` };
    }

    try {
      const content = await readFile(params.path, 'utf-8');

      if (params.line || params.limit) {
        const lines = content.split('\n');
        const start = (params.line ?? 1) - 1;
        const end = params.limit ? start + params.limit : lines.length;
        return { content: lines.slice(start, end).join('\n') };
      }

      return { content };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error('File read IO error', { path: params.path, error: message });
      return { error: `IO error: ${message}` };
    }
  }

  async handleWriteFile(
    sessionId: string,
    context: FileSessionContext,
    params: WriteFileParams,
  ): Promise<null | { error: string }> {
    const { roleId, cwd, allowedPaths } = context;

    const access = this.filePolicy.checkWrite(params.path, cwd, allowedPaths ?? undefined);
    this.logAccess(sessionId, roleId, params.path, 'write', access);

    if (!access.allowed) {
      this.logger.warn('File write denied', { roleId, path: params.path, reason: access.reason });
      return { error: `Access denied: ${access.reason}` };
    }

    try {
      await writeFile(params.path, params.content, 'utf-8');
      this.logger.info('File write', { roleId, path: params.path, size: params.content.length });
      return null;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error('File write IO error', { path: params.path, error: message });
      return { error: `IO error: ${message}` };
    }
  }

  /**
   * Get collected access log entries (for audit persistence).
   */
  drainAccessLog(): FileAccessLogEntry[] {
    return this.accessLog.splice(0);
  }

  private logAccess(
    sessionId: string,
    roleId: string,
    path: string,
    operation: 'read' | 'write',
    decision: AccessDecision,
  ): void {
    this.accessLog.push({
      sessionId,
      roleId,
      path,
      operation,
      allowed: decision.allowed,
      reason: decision.reason,
    });
  }
}
