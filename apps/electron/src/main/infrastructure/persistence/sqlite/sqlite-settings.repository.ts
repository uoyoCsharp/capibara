import { injectable, inject } from 'tsyringe';
import type { Setting } from '@main/core/types/domain.types.js';
import type { ISettingsRepository } from '@main/core/interfaces/i-settings.repository.js';
import type { ISqliteConnection } from '@main/core/interfaces/i-sqlite-connection.js';
import { SQLITE_CONNECTION_TOKEN } from '@main/core/tokens.js';

@injectable()
export class SqliteSettingsRepository implements ISettingsRepository {
  constructor(
    @inject(SQLITE_CONNECTION_TOKEN) private readonly conn: ISqliteConnection,
  ) {}

  async get(key: string): Promise<string | null> {
    const row = this.conn
      .getDb()
      .prepare('SELECT value FROM settings WHERE key = ?')
      .get(key) as { value: string } | undefined;
    return row ? row.value : null;
  }

  async set(key: string, value: string): Promise<void> {
    this.conn
      .getDb()
      .prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
      .run(key, value);
  }

  async getAll(): Promise<Setting[]> {
    const rows = this.conn
      .getDb()
      .prepare('SELECT key, value FROM settings ORDER BY key')
      .all() as Setting[];
    return rows;
  }

  async delete(key: string): Promise<void> {
    this.conn
      .getDb()
      .prepare('DELETE FROM settings WHERE key = ?')
      .run(key);
  }
}
