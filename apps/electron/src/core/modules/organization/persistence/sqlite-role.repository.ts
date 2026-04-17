import { randomUUID } from 'node:crypto';
import { injectable } from 'tsyringe';
import type { ISqliteConnection } from '@core/foundation/interfaces/i-sqlite-connection';
import { NotFoundError } from '@core/foundation/errors/capibara.errors';
import type { IRoleRepository } from '../interfaces/i-role.repository';
import type { Role, CreateRoleInput, UpdateRoleInput } from '../types/organization.types';

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
  is_system_role: number;
  status: string;
  created_at: string;
  updated_at: string;
}

function toRole(row: RoleRow): Role {
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
    consecutiveWakeCount: row.consecutive_wake_count,
    isSystemRole: row.is_system_role === 1,
    status: row.status as Role['status'],
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

@injectable()
export class SqliteRoleRepository implements IRoleRepository {
  constructor(private readonly connection: ISqliteConnection) {}

  findById(id: string): Role | null {
    const row = this.connection.getDb()
      .prepare('SELECT * FROM roles WHERE id = ?')
      .get(id) as RoleRow | undefined;
    return row ? toRole(row) : null;
  }

  findByIds(ids: string[]): Role[] {
    if (ids.length === 0) return [];
    const placeholders = ids.map(() => '?').join(', ');
    const rows = this.connection.getDb()
      .prepare(`SELECT * FROM roles WHERE id IN (${placeholders})`)
      .all(...ids) as RoleRow[];
    return rows.map(toRole);
  }

  findByOrgId(orgId: string): Role[] {
    const rows = this.connection.getDb()
      .prepare('SELECT * FROM roles WHERE org_id = ? ORDER BY name')
      .all(orgId) as RoleRow[];
    return rows.map(toRole);
  }

  findChildren(parentId: string): Role[] {
    const rows = this.connection.getDb()
      .prepare('SELECT * FROM roles WHERE parent_id = ? ORDER BY name')
      .all(parentId) as RoleRow[];
    return rows.map(toRole);
  }

  create(input: CreateRoleInput): Role {
    const id = randomUUID();
    const now = new Date().toISOString();
    this.connection.getDb()
      .prepare(`
        INSERT INTO roles (id, org_id, name, parent_id, persona, knowledge_base_refs, skill_ids, can_approve, can_delegate, requires_human_approval, is_system_role, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        id, input.orgId, input.name, input.parentId, input.persona,
        JSON.stringify(input.knowledgeBaseRefs), JSON.stringify(input.skillIds),
        input.canApprove ? 1 : 0, input.canDelegate ? 1 : 0,
        input.requiresHumanApproval ? 1 : 0, input.isSystemRole ? 1 : 0,
        now, now,
      );
    return this.findById(id)!;
  }

  update(input: UpdateRoleInput): Role {
    const now = new Date().toISOString();
    const fields: string[] = ['updated_at = ?'];
    const values: unknown[] = [now];

    if (input.name !== undefined) { fields.push('name = ?'); values.push(input.name); }
    if (input.persona !== undefined) { fields.push('persona = ?'); values.push(input.persona); }
    if (input.knowledgeBaseRefs !== undefined) { fields.push('knowledge_base_refs = ?'); values.push(JSON.stringify(input.knowledgeBaseRefs)); }
    if (input.skillIds !== undefined) { fields.push('skill_ids = ?'); values.push(JSON.stringify(input.skillIds)); }
    if (input.canApprove !== undefined) { fields.push('can_approve = ?'); values.push(input.canApprove ? 1 : 0); }
    if (input.canDelegate !== undefined) { fields.push('can_delegate = ?'); values.push(input.canDelegate ? 1 : 0); }
    if (input.requiresHumanApproval !== undefined) { fields.push('requires_human_approval = ?'); values.push(input.requiresHumanApproval ? 1 : 0); }
    if (input.consecutiveWakeCount !== undefined) { fields.push('consecutive_wake_count = ?'); values.push(input.consecutiveWakeCount); }
    if (input.status !== undefined) { fields.push('status = ?'); values.push(input.status); }

    values.push(input.id);
    this.connection.getDb()
      .prepare(`UPDATE roles SET ${fields.join(', ')} WHERE id = ?`)
      .run(...values);

    const result = this.findById(input.id);
    if (!result) throw new NotFoundError('Role', input.id);
    return result;
  }

  delete(id: string): void {
    const info = this.connection.getDb()
      .prepare('DELETE FROM roles WHERE id = ?')
      .run(id);
    if (info.changes === 0) throw new NotFoundError('Role', id);
  }
}
