import { randomUUID } from 'node:crypto';
import { injectable } from 'tsyringe';
import type { ISqliteConnection } from '@core/foundation/interfaces/i-sqlite-connection';
import type {
  IAcpSessionRepository,
  CreateAcpSessionInput,
} from '../interfaces/i-acp-session.repository';
import type { AcpSessionRecord, AcpSessionStatus } from '../types/acp.types';

interface AcpSessionRow {
  id: string;
  acp_session_id: string;
  agent_id: string;
  role_id: string;
  org_id: string;
  run_id: string | null;
  conversation_id: string | null;
  task_id: string | null;
  status: string;
  suspend_reason: string | null;
  resume_strategy: string;
  resume_count: number;
  last_activity_at: string;
  created_at: string;
  closed_at: string | null;
  close_reason: string | null;
}

function toRecord(row: AcpSessionRow): AcpSessionRecord {
  return {
    id: row.id,
    acpSessionId: row.acp_session_id,
    agentId: row.agent_id,
    roleId: row.role_id,
    orgId: row.org_id,
    runId: row.run_id,
    conversationId: row.conversation_id,
    taskId: row.task_id,
    status: row.status as AcpSessionRecord['status'],
    suspendReason: row.suspend_reason as AcpSessionRecord['suspendReason'],
    resumeStrategy: row.resume_strategy as AcpSessionRecord['resumeStrategy'],
    resumeCount: row.resume_count,
    lastActivityAt: row.last_activity_at,
    createdAt: row.created_at,
    closedAt: row.closed_at,
    closeReason: row.close_reason as AcpSessionRecord['closeReason'],
  };
}

/** Maps patchable record fields to their columns; only these may be updated post-create. */
const PATCHABLE_COLUMNS: Partial<Record<keyof AcpSessionRecord, string>> = {
  // Rebuild re-points the record at a fresh agent-side session id.
  acpSessionId: 'acp_session_id',
  suspendReason: 'suspend_reason',
  resumeStrategy: 'resume_strategy',
  resumeCount: 'resume_count',
  lastActivityAt: 'last_activity_at',
  closedAt: 'closed_at',
  closeReason: 'close_reason',
  runId: 'run_id',
  conversationId: 'conversation_id',
  taskId: 'task_id',
};

@injectable()
export class SqliteAcpSessionRepository implements IAcpSessionRepository {
  constructor(private readonly connection: ISqliteConnection) {}

  create(input: CreateAcpSessionInput): AcpSessionRecord {
    const id = input.id ?? randomUUID();
    this.connection.getDb()
      .prepare(`
        INSERT INTO acp_sessions (
          id, acp_session_id, agent_id, role_id, org_id, run_id, conversation_id, task_id,
          status, suspend_reason, resume_strategy, resume_count, last_activity_at, closed_at, close_reason
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        id,
        input.acpSessionId,
        input.agentId,
        input.roleId,
        input.orgId,
        input.runId,
        input.conversationId,
        input.taskId,
        input.status,
        input.suspendReason,
        input.resumeStrategy,
        input.resumeCount,
        input.lastActivityAt,
        input.closedAt,
        input.closeReason,
      );
    return this.findById(id)!;
  }

  findById(id: string): AcpSessionRecord | null {
    const row = this.connection.getDb()
      .prepare('SELECT * FROM acp_sessions WHERE id = ?')
      .get(id) as AcpSessionRow | undefined;
    return row ? toRecord(row) : null;
  }

  findByAcpSessionId(acpSessionId: string): AcpSessionRecord | null {
    const row = this.connection.getDb()
      .prepare('SELECT * FROM acp_sessions WHERE acp_session_id = ? ORDER BY created_at DESC LIMIT 1')
      .get(acpSessionId) as AcpSessionRow | undefined;
    return row ? toRecord(row) : null;
  }

  findByConversationId(conversationId: string): AcpSessionRecord | null {
    const row = this.connection.getDb()
      .prepare('SELECT * FROM acp_sessions WHERE conversation_id = ? ORDER BY created_at DESC LIMIT 1')
      .get(conversationId) as AcpSessionRow | undefined;
    return row ? toRecord(row) : null;
  }

  findResumable(roleId: string, orgId: string): AcpSessionRecord | null {
    const row = this.connection.getDb()
      .prepare(`
        SELECT * FROM acp_sessions
        WHERE role_id = ? AND org_id = ? AND status IN ('active', 'suspended')
        ORDER BY last_activity_at DESC
        LIMIT 1
      `)
      .get(roleId, orgId) as AcpSessionRow | undefined;
    return row ? toRecord(row) : null;
  }

  findIdleExpired(beforeIso: string): AcpSessionRecord[] {
    const rows = this.connection.getDb()
      .prepare(`
        SELECT * FROM acp_sessions
        WHERE status = 'suspended' AND suspend_reason = 'idle' AND last_activity_at <= ?
        ORDER BY last_activity_at ASC
      `)
      .all(beforeIso) as AcpSessionRow[];
    return rows.map(toRecord);
  }

  findCollaborationExpired(beforeIso: string): AcpSessionRecord[] {
    const rows = this.connection.getDb()
      .prepare(`
        SELECT * FROM acp_sessions
        WHERE status = 'suspended' AND suspend_reason = 'collaboration' AND last_activity_at <= ?
        ORDER BY last_activity_at ASC
      `)
      .all(beforeIso) as AcpSessionRow[];
    return rows.map(toRecord);
  }

  findNonTerminal(): AcpSessionRecord[] {
    const rows = this.connection.getDb()
      .prepare("SELECT * FROM acp_sessions WHERE status IN ('active', 'suspended') ORDER BY created_at ASC")
      .all() as AcpSessionRow[];
    return rows.map(toRecord);
  }

  updateStatus(id: string, status: AcpSessionStatus, patch: Partial<AcpSessionRecord> = {}): void {
    const columns = ['status = ?'];
    const values: unknown[] = [status];

    for (const [key, column] of Object.entries(PATCHABLE_COLUMNS)) {
      if (key in patch) {
        columns.push(`${column} = ?`);
        values.push(patch[key as keyof AcpSessionRecord] ?? null);
      }
    }

    values.push(id);
    this.connection.getDb()
      .prepare(`UPDATE acp_sessions SET ${columns.join(', ')} WHERE id = ?`)
      .run(...values);
  }

  touchActivity(id: string, iso: string): void {
    this.connection.getDb()
      .prepare('UPDATE acp_sessions SET last_activity_at = ? WHERE id = ?')
      .run(iso, id);
  }
}
