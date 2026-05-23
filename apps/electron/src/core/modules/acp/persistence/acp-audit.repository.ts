import { randomUUID } from 'node:crypto';
import type { ISqliteConnection } from '@core/foundation/interfaces/i-sqlite-connection';
import type { FileAccessLogEntry } from '../handlers/acp-filesystem.handler';
import type { ToolCallLogEntry } from '../handlers/acp-permission.handler';

/**
 * Persists file access and tool call audit log entries to SQLite.
 */
export class AcpAuditRepository {
  constructor(private readonly connection: ISqliteConnection) {}

  insertFileAccessLogs(entries: FileAccessLogEntry[]): void {
    if (entries.length === 0) return;

    const stmt = this.connection.getDb().prepare(`
      INSERT INTO file_access_log (id, session_id, role_id, path, operation, allowed, reason)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    const transaction = this.connection.getDb().transaction(() => {
      for (const entry of entries) {
        stmt.run(
          randomUUID(),
          entry.sessionId,
          entry.roleId,
          entry.path,
          entry.operation,
          entry.allowed ? 1 : 0,
          entry.reason ?? null,
        );
      }
    });

    transaction();
  }

  insertToolCallLogs(entries: ToolCallLogEntry[]): void {
    if (entries.length === 0) return;

    const stmt = this.connection.getDb().prepare(`
      INSERT INTO tool_call_log (id, session_id, run_id, tool_call_id, title, kind, permission)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    const transaction = this.connection.getDb().transaction(() => {
      for (const entry of entries) {
        stmt.run(
          randomUUID(),
          entry.sessionId,
          entry.runId,
          entry.toolCallId,
          entry.title,
          entry.kind ?? null,
          entry.permission,
        );
      }
    });

    transaction();
  }
}
