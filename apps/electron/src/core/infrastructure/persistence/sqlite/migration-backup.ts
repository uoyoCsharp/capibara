import { copyFileSync, existsSync, readdirSync, statSync, unlinkSync } from 'fs';
import { dirname, basename, join } from 'path';
import type Database from 'better-sqlite3';

export interface MigrationBackup {
  path: string;
  preVersion: number;
  createdAt: Date;
}

export class MigrationBackupService {
  constructor(
    private readonly dbPath: string,
    private readonly maxBackups = 5,
  ) {}

  getCurrentVersion(db: Database.Database): number {
    db.exec(`
      CREATE TABLE IF NOT EXISTS schema_version (
        version INTEGER PRIMARY KEY,
        description TEXT NOT NULL,
        applied_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `);
    const row = db
      .prepare('SELECT MAX(version) as version FROM schema_version')
      .get() as { version: number | null } | undefined;
    return row?.version ?? 0;
  }

  backupIfNeeded(currentVersion: number, latestTargetVersion: number): string | null {
    if (latestTargetVersion <= currentVersion) return null;
    if (currentVersion === 0) return null;
    if (!existsSync(this.dbPath)) return null;

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupPath = `${this.dbPath}.backup.pre-v${latestTargetVersion}-${timestamp}`;
    copyFileSync(this.dbPath, backupPath);
    this.pruneOldBackups();
    return backupPath;
  }

  listBackups(): MigrationBackup[] {
    const dir = dirname(this.dbPath);
    const prefix = `${basename(this.dbPath)}.backup.`;
    if (!existsSync(dir)) return [];

    return readdirSync(dir)
      .filter((name) => name.startsWith(prefix))
      .map((name) => {
        const match = name.match(/\.backup\.pre-v(\d+)-/);
        const path = join(dir, name);
        return {
          path,
          preVersion: match ? Number(match[1]) : 0,
          createdAt: statSync(path).mtime,
        };
      })
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }

  private pruneOldBackups(): void {
    const backups = this.listBackups();
    const excess = backups.slice(this.maxBackups);
    for (const b of excess) {
      try {
        unlinkSync(b.path);
      } catch {
        // best-effort; keep going
      }
    }
  }
}
