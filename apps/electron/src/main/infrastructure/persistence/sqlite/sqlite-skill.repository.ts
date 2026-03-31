import { randomUUID } from 'node:crypto';
import { injectable, inject } from 'tsyringe';
import type { Skill, SkillCategory, SkillSource } from '@main/core/types/domain.types.js';
import type { ISkillRepository, CreateSkillInput } from '@main/core/interfaces/i-skill.repository.js';
import type { ISqliteConnection } from '@main/core/interfaces/i-sqlite-connection.js';
import { SQLITE_CONNECTION_TOKEN } from '@main/core/tokens.js';
import { NotFoundError } from '@main/core/errors/capibara.errors.js';

interface SkillRow {
  id: string;
  name: string;
  command: string;
  description: string;
  category: string;
  source: string;
  org_template_id: string | null;
  custom_prompt_content: string | null;
  created_at: string;
}

function rowToEntity(row: SkillRow): Skill {
  return {
    id: row.id,
    name: row.name,
    command: row.command,
    description: row.description,
    category: row.category as SkillCategory,
    source: row.source as SkillSource,
    orgTemplateId: row.org_template_id,
    customPromptContent: row.custom_prompt_content,
    createdAt: row.created_at,
  };
}

@injectable()
export class SqliteSkillRepository implements ISkillRepository {
  constructor(
    @inject(SQLITE_CONNECTION_TOKEN) private readonly conn: ISqliteConnection,
  ) {}

  async findById(id: string): Promise<Skill | null> {
    const row = this.conn.getDb()
      .prepare('SELECT * FROM skills WHERE id = ?')
      .get(id) as SkillRow | undefined;
    return row ? rowToEntity(row) : null;
  }

  async findByCommand(command: string): Promise<Skill | null> {
    const row = this.conn.getDb()
      .prepare('SELECT * FROM skills WHERE command = ?')
      .get(command) as SkillRow | undefined;
    return row ? rowToEntity(row) : null;
  }

  async findByCategory(category: SkillCategory): Promise<Skill[]> {
    const rows = this.conn.getDb()
      .prepare('SELECT * FROM skills WHERE category = ? ORDER BY name')
      .all(category) as SkillRow[];
    return rows.map(rowToEntity);
  }

  async findByOrgTemplateId(orgTemplateId: string): Promise<Skill[]> {
    const rows = this.conn.getDb()
      .prepare('SELECT * FROM skills WHERE org_template_id = ? ORDER BY name')
      .all(orgTemplateId) as SkillRow[];
    return rows.map(rowToEntity);
  }

  async findAll(): Promise<Skill[]> {
    const rows = this.conn.getDb()
      .prepare('SELECT * FROM skills ORDER BY category, name')
      .all() as SkillRow[];
    return rows.map(rowToEntity);
  }

  async create(input: CreateSkillInput): Promise<Skill> {
    const id = randomUUID();
    const now = new Date().toISOString();

    this.conn.getDb().prepare(`
      INSERT INTO skills (id, name, command, description, category, source, org_template_id, custom_prompt_content, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, input.name, input.command, input.description, input.category, input.source, input.orgTemplateId, input.customPromptContent, now);

    return (await this.findById(id))!;
  }

  async update(id: string, input: Partial<CreateSkillInput>): Promise<Skill> {
    const existing = await this.findById(id);
    if (!existing) throw new NotFoundError('Skill', id);

    this.conn.getDb().prepare(`
      UPDATE skills SET name = ?, command = ?, description = ?, category = ?, source = ?,
        org_template_id = ?, custom_prompt_content = ?
      WHERE id = ?
    `).run(
      input.name ?? existing.name,
      input.command ?? existing.command,
      input.description ?? existing.description,
      input.category ?? existing.category,
      input.source ?? existing.source,
      input.orgTemplateId !== undefined ? input.orgTemplateId : existing.orgTemplateId,
      input.customPromptContent !== undefined ? input.customPromptContent : existing.customPromptContent,
      id,
    );

    return (await this.findById(id))!;
  }

  async delete(id: string): Promise<void> {
    const changes = this.conn.getDb()
      .prepare('DELETE FROM skills WHERE id = ?')
      .run(id);
    if (changes.changes === 0) throw new NotFoundError('Skill', id);
  }
}
