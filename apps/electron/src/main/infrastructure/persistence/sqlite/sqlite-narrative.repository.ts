import { randomUUID } from 'node:crypto';
import { injectable, inject } from 'tsyringe';
import type { Narrative } from '@main/core/types/domain.types.js';
import type { INarrativeRepository, CreateNarrativeInput } from '@main/core/interfaces/i-narrative.repository.js';
import type { ISqliteConnection } from '@main/core/interfaces/i-sqlite-connection.js';
import { SQLITE_CONNECTION_TOKEN } from '@main/core/tokens.js';

interface NarrativeRow {
  id: string;
  org_id: string;
  template_data: string;
  rendered_text: string;
  generated_at: string;
}

function rowToEntity(row: NarrativeRow): Narrative {
  return {
    id: row.id,
    orgId: row.org_id,
    templateData: JSON.parse(row.template_data) as Record<string, unknown>,
    renderedText: row.rendered_text,
    generatedAt: row.generated_at,
  };
}

@injectable()
export class SqliteNarrativeRepository implements INarrativeRepository {
  constructor(
    @inject(SQLITE_CONNECTION_TOKEN) private readonly conn: ISqliteConnection,
  ) {}

  async findById(id: string): Promise<Narrative | null> {
    const row = this.conn.getDb()
      .prepare('SELECT * FROM narratives WHERE id = ?')
      .get(id) as NarrativeRow | undefined;
    return row ? rowToEntity(row) : null;
  }

  async findLatestByOrgId(orgId: string): Promise<Narrative | null> {
    const row = this.conn.getDb()
      .prepare('SELECT * FROM narratives WHERE org_id = ? ORDER BY generated_at DESC LIMIT 1')
      .get(orgId) as NarrativeRow | undefined;
    return row ? rowToEntity(row) : null;
  }

  async findByOrgId(orgId: string): Promise<Narrative[]> {
    const rows = this.conn.getDb()
      .prepare('SELECT * FROM narratives WHERE org_id = ? ORDER BY generated_at DESC')
      .all(orgId) as NarrativeRow[];
    return rows.map(rowToEntity);
  }

  async create(input: CreateNarrativeInput): Promise<Narrative> {
    const id = randomUUID();
    const now = new Date().toISOString();

    this.conn.getDb().prepare(`
      INSERT INTO narratives (id, org_id, template_data, rendered_text, generated_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(id, input.orgId, JSON.stringify(input.templateData), input.renderedText, now);

    return (await this.findById(id))!;
  }
}
