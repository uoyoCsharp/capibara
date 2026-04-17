import { randomUUID } from 'node:crypto';
import { injectable } from 'tsyringe';
import type { ISqliteConnection } from '@core/foundation/interfaces/i-sqlite-connection';
import { NotFoundError } from '@core/foundation/errors/capibara.errors';
import type { ISkillRepository } from '../interfaces/i-skill.repository';
import type { Skill, CreateSkillInput, SkillCategory } from '../types/organization.types';

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

function toSkill(row: SkillRow): Skill {
  return {
    id: row.id,
    name: row.name,
    command: row.command,
    description: row.description,
    category: row.category as Skill['category'],
    source: row.source as Skill['source'],
    orgTemplateId: row.org_template_id,
    customPromptContent: row.custom_prompt_content,
    createdAt: row.created_at,
  };
}

@injectable()
export class SqliteSkillRepository implements ISkillRepository {
  constructor(private readonly connection: ISqliteConnection) {}

  findById(id: string): Skill | null {
    const row = this.connection.getDb()
      .prepare('SELECT * FROM skills WHERE id = ?')
      .get(id) as SkillRow | undefined;
    return row ? toSkill(row) : null;
  }

  findByCommand(command: string): Skill | null {
    const row = this.connection.getDb()
      .prepare('SELECT * FROM skills WHERE command = ?')
      .get(command) as SkillRow | undefined;
    return row ? toSkill(row) : null;
  }

  findByCategory(category: SkillCategory): Skill[] {
    const rows = this.connection.getDb()
      .prepare('SELECT * FROM skills WHERE category = ? ORDER BY name')
      .all(category) as SkillRow[];
    return rows.map(toSkill);
  }

  findByOrgTemplateId(orgTemplateId: string): Skill[] {
    const rows = this.connection.getDb()
      .prepare('SELECT * FROM skills WHERE org_template_id = ? ORDER BY category, name')
      .all(orgTemplateId) as SkillRow[];
    return rows.map(toSkill);
  }

  findAll(): Skill[] {
    const rows = this.connection.getDb()
      .prepare('SELECT * FROM skills ORDER BY category, name')
      .all() as SkillRow[];
    return rows.map(toSkill);
  }

  create(input: CreateSkillInput): Skill {
    const id = randomUUID();
    const now = new Date().toISOString();
    this.connection.getDb()
      .prepare(`
        INSERT INTO skills (id, name, command, description, category, source, org_template_id, custom_prompt_content, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(id, input.name, input.command, input.description, input.category, input.source, input.orgTemplateId, input.customPromptContent, now);
    return this.findById(id)!;
  }

  update(id: string, input: Partial<CreateSkillInput>): Skill {
    const fields: string[] = [];
    const values: unknown[] = [];

    if (input.name !== undefined) { fields.push('name = ?'); values.push(input.name); }
    if (input.command !== undefined) { fields.push('command = ?'); values.push(input.command); }
    if (input.description !== undefined) { fields.push('description = ?'); values.push(input.description); }
    if (input.category !== undefined) { fields.push('category = ?'); values.push(input.category); }
    if (input.source !== undefined) { fields.push('source = ?'); values.push(input.source); }
    if (input.customPromptContent !== undefined) { fields.push('custom_prompt_content = ?'); values.push(input.customPromptContent); }

    if (fields.length === 0) {
      const result = this.findById(id);
      if (!result) throw new NotFoundError('Skill', id);
      return result;
    }

    values.push(id);
    this.connection.getDb()
      .prepare(`UPDATE skills SET ${fields.join(', ')} WHERE id = ?`)
      .run(...values);

    const result = this.findById(id);
    if (!result) throw new NotFoundError('Skill', id);
    return result;
  }

  delete(id: string): void {
    const info = this.connection.getDb()
      .prepare('DELETE FROM skills WHERE id = ?')
      .run(id);
    if (info.changes === 0) throw new NotFoundError('Skill', id);
  }
}
