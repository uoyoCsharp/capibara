import { randomUUID } from 'node:crypto';
import { injectable } from 'tsyringe';
import type { ISqliteConnection } from '@core/foundation/interfaces/i-sqlite-connection';
import type { IPendingPlanTreeRepository } from '../interfaces/i-pending-plan-tree.repository';
import type {
  PendingPlanTree,
  PendingPlanTreeStatus,
  UpsertPendingPlanTreeInput,
} from '../types/pending-plan-tree.types';
import type { PlanTreeNode } from '@core/foundation/events';

interface PendingPlanTreeRow {
  id: string;
  root_task_id: string | null;
  source_conversation_id: string | null;
  org_id: string;
  role_id: string;
  mode: string;
  tree_json: string;
  version: number;
  status: string;
  pending_feedback: string | null;
  conversation_id: string | null;
  submitted_at: string;
  expires_at: string;
  reviewed_at: string | null;
  created_at: string;
  updated_at: string;
}

function toEntity(row: PendingPlanTreeRow): PendingPlanTree {
  return {
    id: row.id,
    rootTaskId: row.root_task_id,
    sourceConversationId: row.source_conversation_id,
    orgId: row.org_id,
    roleId: row.role_id,
    mode: row.mode as PendingPlanTree['mode'],
    tree: JSON.parse(row.tree_json) as PlanTreeNode,
    version: row.version,
    status: row.status as PendingPlanTreeStatus,
    pendingFeedback: row.pending_feedback,
    conversationId: row.conversation_id,
    submittedAt: row.submitted_at,
    expiresAt: row.expires_at,
    reviewedAt: row.reviewed_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

@injectable()
export class SqlitePendingPlanTreeRepository implements IPendingPlanTreeRepository {
  constructor(private readonly connection: ISqliteConnection) {}

  findById(id: string): PendingPlanTree | null {
    const row = this.connection
      .getDb()
      .prepare('SELECT * FROM pending_plan_trees WHERE id = ?')
      .get(id) as PendingPlanTreeRow | undefined;
    return row ? toEntity(row) : null;
  }

  findActiveByRootTaskId(rootTaskId: string): PendingPlanTree | null {
    const row = this.connection
      .getDb()
      .prepare(
        `SELECT * FROM pending_plan_trees
         WHERE root_task_id = ? AND status IN ('active', 'refining')
         LIMIT 1`,
      )
      .get(rootTaskId) as PendingPlanTreeRow | undefined;
    return row ? toEntity(row) : null;
  }

  findActiveBySourceConversationId(conversationId: string): PendingPlanTree | null {
    const row = this.connection
      .getDb()
      .prepare(
        `SELECT * FROM pending_plan_trees
         WHERE source_conversation_id = ? AND status IN ('active', 'refining')
         LIMIT 1`,
      )
      .get(conversationId) as PendingPlanTreeRow | undefined;
    return row ? toEntity(row) : null;
  }

  findByOrgId(orgId: string): PendingPlanTree[] {
    const rows = this.connection
      .getDb()
      .prepare('SELECT * FROM pending_plan_trees WHERE org_id = ? ORDER BY created_at DESC')
      .all(orgId) as PendingPlanTreeRow[];
    return rows.map(toEntity);
  }

  findExpired(now: string): PendingPlanTree[] {
    const rows = this.connection
      .getDb()
      .prepare(
        `SELECT * FROM pending_plan_trees
         WHERE status IN ('active', 'refining') AND expires_at < ?`,
      )
      .all(now) as PendingPlanTreeRow[];
    return rows.map(toEntity);
  }

  upsert(input: UpsertPendingPlanTreeInput): PendingPlanTree {
    const db = this.connection.getDb();
    const now = new Date().toISOString();
    const treeJson = JSON.stringify(input.tree);

    const existing = input.rootTaskId
      ? this.findActiveByRootTaskId(input.rootTaskId)
      : this.findActiveBySourceConversationId(input.sourceConversationId!);

    if (existing) {
      const nextVersion = existing.version + 1;
      db.prepare(
        `UPDATE pending_plan_trees
         SET tree_json = ?, version = ?, status = 'active',
             pending_feedback = NULL, submitted_at = ?, expires_at = ?,
             role_id = ?, mode = ?, updated_at = ?
         WHERE id = ?`,
      ).run(treeJson, nextVersion, input.submittedAt, input.expiresAt, input.roleId, input.mode, now, existing.id);
      return this.findById(existing.id)!;
    }

    const id = randomUUID();
    db.prepare(
      `INSERT INTO pending_plan_trees
       (id, root_task_id, source_conversation_id, org_id, role_id, mode, tree_json, version, status,
        pending_feedback, conversation_id, submitted_at, expires_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 1, 'active', NULL, ?, ?, ?, ?, ?)`,
    ).run(
      id,
      input.rootTaskId ?? null,
      input.sourceConversationId ?? null,
      input.orgId, input.roleId, input.mode,
      treeJson, input.conversationId ?? null,
      input.submittedAt, input.expiresAt, now, now,
    );
    return this.findById(id)!;
  }

  updateStatus(id: string, status: PendingPlanTreeStatus, reviewedAt?: string): void {
    const now = new Date().toISOString();
    this.connection
      .getDb()
      .prepare(
        `UPDATE pending_plan_trees
         SET status = ?, reviewed_at = ?, updated_at = ?
         WHERE id = ?`,
      )
      .run(status, reviewedAt ?? null, now, id);
  }

  updateFeedback(id: string, feedback: string | null): void {
    const now = new Date().toISOString();
    this.connection
      .getDb()
      .prepare(
        `UPDATE pending_plan_trees
         SET pending_feedback = ?, updated_at = ?
         WHERE id = ?`,
      )
      .run(feedback, now, id);
  }

  updateConversationId(id: string, conversationId: string): void {
    const now = new Date().toISOString();
    this.connection
      .getDb()
      .prepare(
        `UPDATE pending_plan_trees
         SET conversation_id = ?, updated_at = ?
         WHERE id = ?`,
      )
      .run(conversationId, now, id);
  }

  delete(id: string): void {
    this.connection
      .getDb()
      .prepare('DELETE FROM pending_plan_trees WHERE id = ?')
      .run(id);
  }
}
