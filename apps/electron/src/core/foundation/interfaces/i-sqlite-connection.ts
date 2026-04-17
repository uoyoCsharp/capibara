import type Database from 'better-sqlite3';

export interface ISqliteConnection {
  getDb(): Database.Database;
  close(): void;
}
