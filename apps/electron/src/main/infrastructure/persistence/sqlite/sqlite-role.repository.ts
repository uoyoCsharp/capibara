import { randomUUID } from 'node:crypto';
import { injectable, inject } from 'tsyringe';
import type { Role, RoleStatus } from '@main/core/types/domain.types.js';
import type { IRoleRepository, CreateRoleInput, UpdateRoleInput } from '@main/core/interfaces/i-role.repository.js';
import type { ISqliteConnection } from '@main/core/interfaces/i-sqlite-connection.js';
import { SQLITE_CONNECTION_TOKEN } from '@main/core/tokens.js';
import { NotFoundError } from '@main/core/errors/capibara.errors.js';

interface RoleRow {
  id: string;
  org_id: string;
  name: string;
  parent_id: string | null;
  persona: string;
  knowledge_base_refs: string;
  skill_ids: string;
  can_approve: number;
  can_delegate: number;
  requires_human_approval: number;
  consecutive_wake_count: number;
  status: string;
  created_at: string;
  updated_at: string;
}

function rowToEntity(row: RoleRow): Role {
  return {
    id: row.id,
    orgId: row.org_id,
    name: row.name,
    parentId: row.parent_id,
    persona: row.persona,
    knowledgeBaseRefs: JSON.parse(row.knowledge_base_refs) as string[],
    skillIds: JSON.parse(row.skill_ids) as string[],
    canApprove: row.can_approve === 1,
    canDelegate: row.can_delegate === 1,
    requiresHumanApproval: row.requires_human_approval === 1,
    consecutiveWakeCount: row.consecutive_wake_count ?? 0,
    status: row.status as RoleStatus,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

@injectable()
export class SqliteRoleRepository implements IRoleRepository {
  constructor(
    @inject(SQLITE_CONNECTION_TOKEN) private readonly conn: ISqliteConnection,
  ) {}

  async findById(id: string): Promise<Role | null> {
    const row = this.conn.getDb()
      .prepare('SELECT * FROM roles WHERE id = ?')
      .get(id) as RoleRow | undefined;
    return row ? rowToEntity(row) : null;
  }

  async findByOrgId(orgId: string): Promise<Role[]> {
    const rows = this.conn.getDb()
      .prepare('SELECT * FROM roles WHERE org_id = ? ORDER BY name')
      .all(orgId) as RoleRow[];
    return rows.map(rowToEntity);
  }

  async findChildren(parentId: string): Promise<Role[]> {
    const rows = this.conn.getDb()
      .prepare('SELECT * FROM roles WHERE parent_id = ? ORDER BY name')
      .all(parentId) as RoleRow[];
    return rows.map(rowToEntity);
  }

  async create(input: CreateRoleInput): Promise<Role> {
    const id = randomUUID();
    const now = new Date().toISOString();

    this.conn.getDb().prepare(`
      INSERT INTO roles (id, org_id, name, parent_id, persona, knowledge_base_refs, skill_ids,
        can_approve, can_delegate, requires_human_approval, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)
    `).run(
      id, input.orgId, input.name, input.parentId, input.persona,
      JSON.stringify(input.knowledgeBaseRefs), JSON.stringify(input.skillIds),
      input.canApprove ? 1 : 0, input.canDelegate ? 1 : 0,
      input.requiresHumanApproval ? 1 : 0, now, now,
    );

    return (await this.findById(id))!;
  }

  async update(input: UpdateRoleInput): Promise<Role> {
    const existing = await this.findById(input.id);
    if (!existing) throw new NotFoundError('Role', input.id);

    const now = new Date().toISOString();
    this.conn.getDb().prepare(`
      UPDATE roles SET name = ?, persona = ?, knowledge_base_refs = ?, skill_ids = ?,
        can_approve = ?, can_delegate = ?, requires_human_approval = ?, consecutive_wake_count = ?, status = ?, updated_at = ?
      WHERE id = ?
    `).run(
      input.name ?? existing.name,
      input.persona ?? existing.persona,
      JSON.stringify(input.knowledgeBaseRefs ?? existing.knowledgeBaseRefs),
      JSON.stringify(input.skillIds ?? existing.skillIds),
      (input.canApprove ?? existing.canApprove) ? 1 : 0,
      (input.canDelegate ?? existing.canDelegate) ? 1 : 0,
      (input.requiresHumanApproval ?? existing.requiresHumanApproval) ? 1 : 0,
      input.consecutiveWakeCount ?? existing.consecutiveWakeCount,
      input.status ?? existing.status,
      now,
      input.id,
    );

    return (await this.findById(input.id))!;
  }

  async delete(id: string): Promise<void> {
    const changes = this.conn.getDb()
      .prepare('DELETE FROM roles WHERE id = ?')
      .run(id);
    if (changes.changes === 0) throw new NotFoundError('Role', id);
  }
}
