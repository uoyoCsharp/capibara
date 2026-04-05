import Database from 'better-sqlite3';
import { injectable } from 'tsyringe';
import type { ISqliteConnection } from '@main/core/interfaces/i-sqlite-connection.js';

@injectable()
export class SqliteConnection implements ISqliteConnection {
  private db: Database.Database | null = null;

  constructor(private readonly dbPath: string) {}

  getDb(): Database.Database {
    if (!this.db) {
      try {
        this.db = new Database(this.dbPath);
        this.db.pragma('journal_mode = WAL');
        this.db.pragma('foreign_keys = ON');
        this.db.pragma('busy_timeout = 5000');
      } catch (err) {
        this.db = null;
        throw new Error(
          `Database initialization failed for ${this.dbPath}: ${err instanceof Error ? err.message : String(err)}`,
          { cause: err instanceof Error ? err : undefined },
        );
      }
    }
    return this.db;
  }

  close(): void {
    if (this.db) {
      this.db.close();
      this.db = null;
    }
  }
}
