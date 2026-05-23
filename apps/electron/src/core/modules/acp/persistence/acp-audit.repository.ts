import { randomUUID } from 'node:crypto';
import type { ISqliteConnection } from '@core/foundation/interfaces/i-sqlite-connection';
import type { FileAccessLogEntry } from '../handlers/acp-filesystem.handler';
import type { ToolCallLogEntry } from '../handlers/acp-permission.handler';

import type { ToolCallLogRecord, FileAccessLogRecord } from '@core/shared/types';

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

  findToolCallsByRunId(runId: string): ToolCallLogRecord[] {
    const rows = this.connection.getDb().prepare(
      'SELECT id, session_id, run_id, tool_call_id, title, kind, permission, created_at FROM tool_call_log WHERE run_id = ? ORDER BY created_at ASC',
    ).all(runId) as Array<{ id: string; session_id: string; run_id: string | null; tool_call_id: string; title: string; kind: string | null; permission: string; created_at: string }>;
    return rows.map(r => ({
      id: r.id,
      sessionId: r.session_id,
      runId: r.run_id,
      toolCallId: r.tool_call_id,
      title: r.title,
      kind: r.kind,
      permission: r.permission,
      createdAt: r.created_at,
    }));
  }

  findFileAccessByRunId(runId: string): FileAccessLogRecord[] {
    const rows = this.connection.getDb().prepare(`
      SELECT f.id, f.session_id, f.role_id, f.path, f.operation, f.allowed, f.reason, f.created_at
      FROM file_access_log f
      JOIN runs r ON r.acp_session_id IS NOT NULL
      JOIN tool_call_log t ON t.session_id = f.session_id AND t.run_id = ?
      WHERE f.session_id = t.session_id
      GROUP BY f.id
      ORDER BY f.created_at ASC
    `).all(runId) as Array<{ id: string; session_id: string; role_id: string; path: string; operation: string; allowed: number; reason: string | null; created_at: string }>;
    return rows.map(r => ({
      id: r.id,
      sessionId: r.session_id,
      roleId: r.role_id,
      path: r.path,
      operation: r.operation as 'read' | 'write',
      allowed: r.allowed === 1,
      reason: r.reason,
      createdAt: r.created_at,
    }));
  }

  findRecentToolCallsByOrgId(orgId: string, limit = 100): ToolCallLogRecord[] {
    const rows = this.connection.getDb().prepare(`
      SELECT t.id, t.session_id, t.run_id, t.tool_call_id, t.title, t.kind, t.permission, t.created_at
      FROM tool_call_log t
      JOIN runs r ON r.id = t.run_id
      WHERE r.org_id = ?
      ORDER BY t.created_at DESC
      LIMIT ?
    `).all(orgId, limit) as Array<{ id: string; session_id: string; run_id: string | null; tool_call_id: string; title: string; kind: string | null; permission: string; created_at: string }>;
    return rows.map(r => ({
      id: r.id,
      sessionId: r.session_id,
      runId: r.run_id,
      toolCallId: r.tool_call_id,
      title: r.title,
      kind: r.kind,
      permission: r.permission,
      createdAt: r.created_at,
    }));
  }

  findRecentFileAccessByOrgId(orgId: string, limit = 100): FileAccessLogRecord[] {
    const rows = this.connection.getDb().prepare(`
      SELECT f.id, f.session_id, f.role_id, f.path, f.operation, f.allowed, f.reason, f.created_at
      FROM file_access_log f
      JOIN runs r ON r.acp_session_id IS NOT NULL
      WHERE f.session_id IN (
        SELECT DISTINCT t.session_id FROM tool_call_log t JOIN runs r2 ON r2.id = t.run_id WHERE r2.org_id = ?
      )
      ORDER BY f.created_at DESC
      LIMIT ?
    `).all(orgId, limit) as Array<{ id: string; session_id: string; role_id: string; path: string; operation: string; allowed: number; reason: string | null; created_at: string }>;
    return rows.map(r => ({
      id: r.id,
      sessionId: r.session_id,
      roleId: r.role_id,
      path: r.path,
      operation: r.operation as 'read' | 'write',
      allowed: r.allowed === 1,
      reason: r.reason,
      createdAt: r.created_at,
    }));
  }
}
