import { randomUUID } from 'node:crypto';
import { injectable } from 'tsyringe';
import type { ISqliteConnection } from '@core/foundation/interfaces/i-sqlite-connection';
import type { IProcessSchemaRepository } from '../interfaces/i-process-schema.repository';
import type { ProcessSchemaRecord } from '../types/workflow.types';

interface SchemaRow {
  id: string;
  org_id: string;
  schema_json: string;
  is_active: number;
  created_at: string;
  updated_at: string;
}

function toRecord(row: SchemaRow): ProcessSchemaRecord {
  return {
    id: row.id,
    orgId: row.org_id,
    schemaJson: row.schema_json,
    isActive: row.is_active === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

@injectable()
export class SqliteProcessSchemaRepository implements IProcessSchemaRepository {
  constructor(private readonly connection: ISqliteConnection) {}

  findActiveByOrgId(orgId: string): ProcessSchemaRecord | null {
    const row = this.connection.getDb()
      .prepare('SELECT * FROM process_schemas WHERE org_id = ? AND is_active = 1')
      .get(orgId) as SchemaRow | undefined;
    return row ? toRecord(row) : null;
  }

  findById(id: string): ProcessSchemaRecord | null {
    const row = this.connection.getDb()
      .prepare('SELECT * FROM process_schemas WHERE id = ?')
      .get(id) as SchemaRow | undefined;
    return row ? toRecord(row) : null;
  }

  save(orgId: string, schemaJson: string): ProcessSchemaRecord {
    const db = this.connection.getDb();
    const now = new Date().toISOString();

    db.prepare('UPDATE process_schemas SET is_active = 0, updated_at = ? WHERE org_id = ? AND is_active = 1')
      .run(now, orgId);

    const id = randomUUID();
    db.prepare(`
      INSERT INTO process_schemas (id, org_id, schema_json, is_active, created_at, updated_at)
      VALUES (?, ?, ?, 1, ?, ?)
    `)
      .run(id, orgId, schemaJson, now, now);

    return this.findById(id)!;
  }

  deactivate(id: string): void {
    const now = new Date().toISOString();
    this.connection.getDb()
      .prepare('UPDATE process_schemas SET is_active = 0, updated_at = ? WHERE id = ?')
      .run(now, id);
  }
}
