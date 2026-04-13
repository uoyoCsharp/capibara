import { randomUUID } from 'node:crypto';
import { injectable, inject } from 'tsyringe';
import type { Organization } from '@main/core/types/domain.types.js';
import type {
  IOrganizationRepository,
  CreateOrganizationInput,
  UpdateOrganizationInput,
} from '@main/core/interfaces/i-organization.repository.js';
import type { ISqliteConnection } from '@main/core/interfaces/i-sqlite-connection.js';
import { SQLITE_CONNECTION_TOKEN } from '@main/core/tokens.js';
import { NotFoundError } from '@main/core/errors/capibara.errors.js';

interface OrgRow {
  id: string;
  name: string;
  description: string;
  custom_instructions: string;
  status: string;
  budget_limit: number;
  org_template_id: string | null;
  planning_role_id: string | null;
  workspace_path: string;
  created_at: string;
  updated_at: string;
}

function rowToEntity(row: OrgRow): Organization {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    customInstructions: row.custom_instructions,
    status: row.status as Organization['status'],
    budgetLimit: row.budget_limit,
    orgTemplateId: row.org_template_id,
    planningRoleId: row.planning_role_id ?? null,
    workspacePath: row.workspace_path,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

@injectable()
export class SqliteOrganizationRepository implements IOrganizationRepository {
  constructor(
    @inject(SQLITE_CONNECTION_TOKEN) private readonly conn: ISqliteConnection,
  ) {}

  async findAll(): Promise<Organization[]> {
    const rows = this.conn
      .getDb()
      .prepare('SELECT * FROM organizations ORDER BY created_at DESC')
      .all() as OrgRow[];
    return rows.map(rowToEntity);
  }

  async findById(id: string): Promise<Organization | null> {
    const row = this.conn
      .getDb()
      .prepare('SELECT * FROM organizations WHERE id = ?')
      .get(id) as OrgRow | undefined;
    return row ? rowToEntity(row) : null;
  }

  async create(input: CreateOrganizationInput): Promise<Organization> {
    const id = randomUUID();
    const now = new Date().toISOString();

    this.conn.getDb().prepare(`
      INSERT INTO organizations (id, name, description, custom_instructions, budget_limit, org_template_id, workspace_path, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, input.name, input.description, input.customInstructions, input.budgetLimit, input.orgTemplateId, input.workspacePath, now, now);

    const org = await this.findById(id);
    return org!;
  }

  async update(input: UpdateOrganizationInput): Promise<Organization> {
    const existing = await this.findById(input.id);
    if (!existing) throw new NotFoundError('Organization', input.id);

    const now = new Date().toISOString();
    const name = input.name ?? existing.name;
    const description = input.description ?? existing.description;
    const customInstructions = input.customInstructions ?? existing.customInstructions;
    const status = input.status ?? existing.status;
    const budgetLimit = input.budgetLimit ?? existing.budgetLimit;
    const workspacePath = input.workspacePath ?? existing.workspacePath;
    const planningRoleId = input.planningRoleId !== undefined ? input.planningRoleId : existing.planningRoleId;

    this.conn.getDb().prepare(`
      UPDATE organizations SET name = ?, description = ?, custom_instructions = ?, status = ?, budget_limit = ?, workspace_path = ?, planning_role_id = ?, updated_at = ?
      WHERE id = ?
    `).run(name, description, customInstructions, status, budgetLimit, workspacePath, planningRoleId, now, input.id);

    const org = await this.findById(input.id);
    return org!;
  }

  async delete(id: string): Promise<void> {
    const changes = this.conn
      .getDb()
      .prepare('DELETE FROM organizations WHERE id = ?')
      .run(id);
    if (changes.changes === 0) throw new NotFoundError('Organization', id);
  }
}
