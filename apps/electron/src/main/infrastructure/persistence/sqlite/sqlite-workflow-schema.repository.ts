import { injectable, inject } from 'tsyringe';
import { randomUUID } from 'node:crypto';
import type { IWorkflowSchemaRepository } from '@main/core/interfaces/i-workflow-schema.repository.js';
import type { WorkflowSchema } from '@main/core/types/workflow-schema.types.js';
import type { ISqliteConnection } from '@main/core/interfaces/i-sqlite-connection.js';
import { SQLITE_CONNECTION_TOKEN } from '@main/core/tokens.js';

interface SchemaRow {
  id: string;
  org_id: string;
  schema_json: string;
  is_active: number;
  created_at: string;
  updated_at: string;
}

@injectable()
export class SqliteWorkflowSchemaRepository implements IWorkflowSchemaRepository {
  constructor(
    @inject(SQLITE_CONNECTION_TOKEN) private readonly conn: ISqliteConnection,
  ) {}

  async findActiveByOrgId(orgId: string): Promise<WorkflowSchema | null> {
    const row = this.conn
      .getDb()
      .prepare('SELECT schema_json FROM workflow_schemas WHERE org_id = ? AND is_active = 1')
      .get(orgId) as Pick<SchemaRow, 'schema_json'> | undefined;
    if (!row) return null;
    return JSON.parse(row.schema_json) as WorkflowSchema;
  }

  async save(orgId: string, schema: WorkflowSchema): Promise<void> {
    const db = this.conn.getDb();
    const now = new Date().toISOString();
    const json = JSON.stringify(schema);

    const existing = db
      .prepare('SELECT id FROM workflow_schemas WHERE org_id = ? AND is_active = 1')
      .get(orgId) as { id: string } | undefined;

    if (existing) {
      db.prepare(
        'UPDATE workflow_schemas SET schema_json = ?, updated_at = ? WHERE id = ?',
      ).run(json, now, existing.id);
    } else {
      db.prepare(
        'INSERT INTO workflow_schemas (id, org_id, schema_json, is_active, created_at, updated_at) VALUES (?, ?, ?, 1, ?, ?)',
      ).run(randomUUID(), orgId, json, now, now);
    }
  }

  async delete(id: string): Promise<void> {
    this.conn
      .getDb()
      .prepare('DELETE FROM workflow_schemas WHERE id = ?')
      .run(id);
  }
}
