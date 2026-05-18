import { randomUUID } from 'node:crypto';
import { injectable } from 'tsyringe';
import type { ISqliteConnection } from '@core/foundation/interfaces/i-sqlite-connection';
import { NotFoundError } from '@core/foundation/errors/capibara.errors';
import type { IOrganizationRepository } from '../interfaces/i-organization.repository';
import type { Organization, CreateOrganizationInput, UpdateOrganizationInput } from '../types/organization.types';

interface OrgRow {
  id: string;
  name: string;
  description: string;
  custom_instructions: string;
  status: string;
  auto_start_on_create: number;
  org_template_id: string | null;
  planning_role_id: string | null;
  workspace_path: string;
  created_at: string;
  updated_at: string;
}

function toOrganization(row: OrgRow): Organization {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    customInstructions: row.custom_instructions,
    status: row.status as Organization['status'],
    autoStartOnCreate: row.auto_start_on_create === 1,
    orgTemplateId: row.org_template_id,
    planningRoleId: row.planning_role_id,
    workspacePath: row.workspace_path,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

@injectable()
export class SqliteOrganizationRepository implements IOrganizationRepository {
  constructor(private readonly connection: ISqliteConnection) {}

  findAll(): Organization[] {
    const rows = this.connection.getDb()
      .prepare('SELECT * FROM organizations ORDER BY created_at DESC')
      .all() as OrgRow[];
    return rows.map(toOrganization);
  }

  findById(id: string): Organization | null {
    const row = this.connection.getDb()
      .prepare('SELECT * FROM organizations WHERE id = ?')
      .get(id) as OrgRow | undefined;
    return row ? toOrganization(row) : null;
  }

  create(input: CreateOrganizationInput): Organization {
    const id = randomUUID();
    const now = new Date().toISOString();
    this.connection.getDb()
      .prepare(`
        INSERT INTO organizations (id, name, description, custom_instructions, org_template_id, workspace_path, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(id, input.name, input.description, input.customInstructions, input.orgTemplateId, input.workspacePath, now, now);
    return this.findById(id)!;
  }

  update(input: UpdateOrganizationInput): Organization {
    const now = new Date().toISOString();
    const fields: string[] = ['updated_at = ?'];
    const values: unknown[] = [now];

    if (input.name !== undefined) { fields.push('name = ?'); values.push(input.name); }
    if (input.description !== undefined) { fields.push('description = ?'); values.push(input.description); }
    if (input.customInstructions !== undefined) { fields.push('custom_instructions = ?'); values.push(input.customInstructions); }
    if (input.status !== undefined) { fields.push('status = ?'); values.push(input.status); }
    if (input.autoStartOnCreate !== undefined) { fields.push('auto_start_on_create = ?'); values.push(input.autoStartOnCreate ? 1 : 0); }
    if (input.workspacePath !== undefined) { fields.push('workspace_path = ?'); values.push(input.workspacePath); }
    if (input.planningRoleId !== undefined) { fields.push('planning_role_id = ?'); values.push(input.planningRoleId); }

    values.push(input.id);
    this.connection.getDb()
      .prepare(`UPDATE organizations SET ${fields.join(', ')} WHERE id = ?`)
      .run(...values);

    const result = this.findById(input.id);
    if (!result) throw new NotFoundError('Organization', input.id);
    return result;
  }

  delete(id: string): void {
    const info = this.connection.getDb()
      .prepare('DELETE FROM organizations WHERE id = ?')
      .run(id);
    if (info.changes === 0) throw new NotFoundError('Organization', id);
  }
}
