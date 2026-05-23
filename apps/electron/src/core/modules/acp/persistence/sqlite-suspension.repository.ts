import { randomUUID } from 'node:crypto';
import type { ISqliteConnection } from '@core/foundation/interfaces/i-sqlite-connection';
import type { ISuspensionRepository } from '../interfaces/i-suspension.repository';
import type {
  SessionSuspension,
  SuspensionAwaiting,
  CreateSuspensionInput,
  CreateAwaitingInput,
  SuspensionStatus,
  AwaitingStatus,
} from '../collaboration/suspension.types';

interface SuspensionRow {
  id: string;
  session_id: string;
  acp_session_id: string;
  run_id: string;
  role_id: string;
  org_id: string;
  task_id: string | null;
  aggregation_mode: string;
  parent_suspension_id: string | null;
  chain_depth: number;
  status: string;
  suspended_at: string;
  resumed_at: string | null;
  created_at: string;
}

interface AwaitingRow {
  id: string;
  suspension_id: string;
  conversation_id: string;
  respondent_role_id: string;
  status: string;
  response: string | null;
  resolved_at: string | null;
  created_at: string;
}

export class SqliteSuspensionRepository implements ISuspensionRepository {
  constructor(private readonly connection: ISqliteConnection) {}

  createSuspension(input: CreateSuspensionInput): SessionSuspension {
    const id = randomUUID();
    const now = new Date().toISOString();
    const db = this.connection.getDb();

    db.prepare(`
      INSERT INTO session_suspensions (id, session_id, acp_session_id, run_id, role_id, org_id, task_id, aggregation_mode, parent_suspension_id, chain_depth, status, suspended_at, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'suspended', ?, ?)
    `).run(id, input.sessionId, input.acpSessionId, input.runId, input.roleId, input.orgId, input.taskId, input.aggregationMode, input.parentSuspensionId ?? null, input.chainDepth ?? 0, now, now);

    return {
      id,
      sessionId: input.sessionId,
      acpSessionId: input.acpSessionId,
      runId: input.runId,
      roleId: input.roleId,
      orgId: input.orgId,
      taskId: input.taskId,
      aggregationMode: input.aggregationMode as SessionSuspension['aggregationMode'],
      parentSuspensionId: input.parentSuspensionId ?? null,
      chainDepth: input.chainDepth ?? 0,
      status: 'suspended',
      suspendedAt: now,
      resumedAt: null,
      createdAt: now,
    };
  }

  createAwaiting(input: CreateAwaitingInput): SuspensionAwaiting {
    const id = randomUUID();
    const now = new Date().toISOString();
    const db = this.connection.getDb();

    db.prepare(`
      INSERT INTO suspension_awaiting (id, suspension_id, conversation_id, respondent_role_id, status, created_at)
      VALUES (?, ?, ?, ?, 'pending', ?)
    `).run(id, input.suspensionId, input.conversationId, input.respondentRoleId, now);

    return {
      id,
      suspensionId: input.suspensionId,
      conversationId: input.conversationId,
      respondentRoleId: input.respondentRoleId,
      status: 'pending',
      response: null,
      resolvedAt: null,
      createdAt: now,
    };
  }

  findById(id: string): SessionSuspension | null {
    const db = this.connection.getDb();
    const row = db.prepare('SELECT * FROM session_suspensions WHERE id = ?').get(id) as SuspensionRow | undefined;
    return row ? this.toSuspension(row) : null;
  }

  findByConversationId(conversationId: string): SessionSuspension | null {
    const db = this.connection.getDb();
    const row = db.prepare(`
      SELECT ss.* FROM session_suspensions ss
      JOIN suspension_awaiting sa ON sa.suspension_id = ss.id
      WHERE sa.conversation_id = ? AND ss.status = 'suspended'
      LIMIT 1
    `).get(conversationId) as SuspensionRow | undefined;
    return row ? this.toSuspension(row) : null;
  }

  findAwaitingBySuspensionId(suspensionId: string): SuspensionAwaiting[] {
    const db = this.connection.getDb();
    const rows = db.prepare('SELECT * FROM suspension_awaiting WHERE suspension_id = ?').all(suspensionId) as AwaitingRow[];
    return rows.map(this.toAwaiting);
  }

  findActiveByOrg(orgId: string): SessionSuspension[] {
    const db = this.connection.getDb();
    const rows = db.prepare("SELECT * FROM session_suspensions WHERE org_id = ? AND status = 'suspended'").all(orgId) as SuspensionRow[];
    return rows.map(this.toSuspension);
  }

  findActiveByRole(roleId: string, orgId: string): SessionSuspension | null {
    const db = this.connection.getDb();
    const row = db.prepare("SELECT * FROM session_suspensions WHERE role_id = ? AND org_id = ? AND status = 'suspended' LIMIT 1")
      .get(roleId, orgId) as SuspensionRow | undefined;
    return row ? this.toSuspension(row) : null;
  }

  findSuspensionAwaitingRole(roleId: string, orgId: string): SessionSuspension | null {
    const db = this.connection.getDb();
    const row = db.prepare(`
      SELECT ss.* FROM session_suspensions ss
      JOIN suspension_awaiting sa ON sa.suspension_id = ss.id
      WHERE sa.respondent_role_id = ? AND ss.org_id = ? AND ss.status = 'suspended'
      LIMIT 1
    `).get(roleId, orgId) as SuspensionRow | undefined;
    return row ? this.toSuspension(row) : null;
  }

  updateSuspensionStatus(id: string, status: SuspensionStatus, resumedAt?: string): void {
    const db = this.connection.getDb();
    if (resumedAt) {
      db.prepare('UPDATE session_suspensions SET status = ?, resumed_at = ? WHERE id = ?').run(status, resumedAt, id);
    } else {
      db.prepare('UPDATE session_suspensions SET status = ? WHERE id = ?').run(status, id);
    }
  }

  updateAwaitingStatus(id: string, status: AwaitingStatus, response?: string, resolvedAt?: string): void {
    const db = this.connection.getDb();
    db.prepare('UPDATE suspension_awaiting SET status = ?, response = ?, resolved_at = ? WHERE id = ?')
      .run(status, response ?? null, resolvedAt ?? null, id);
  }

  private toSuspension(row: SuspensionRow): SessionSuspension {
    return {
      id: row.id,
      sessionId: row.session_id,
      acpSessionId: row.acp_session_id,
      runId: row.run_id,
      roleId: row.role_id,
      orgId: row.org_id,
      taskId: row.task_id,
      aggregationMode: row.aggregation_mode as SessionSuspension['aggregationMode'],
      parentSuspensionId: row.parent_suspension_id,
      chainDepth: row.chain_depth,
      status: row.status as SessionSuspension['status'],
      suspendedAt: row.suspended_at,
      resumedAt: row.resumed_at,
      createdAt: row.created_at,
    };
  }

  private toAwaiting(row: AwaitingRow): SuspensionAwaiting {
    return {
      id: row.id,
      suspensionId: row.suspension_id,
      conversationId: row.conversation_id,
      respondentRoleId: row.respondent_role_id,
      status: row.status as SuspensionAwaiting['status'],
      response: row.response,
      resolvedAt: row.resolved_at,
      createdAt: row.created_at,
    };
  }
}
