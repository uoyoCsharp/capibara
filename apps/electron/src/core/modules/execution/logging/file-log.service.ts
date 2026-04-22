import { existsSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs';
import { appendFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { injectable } from 'tsyringe';

function sanitizeName(name: string): string {
  return name.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_');
}

function currentMonth(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

@injectable()
export class FileLogService {
  private writeQueues = new Map<string, Promise<void>>();

  constructor(private readonly logDir: string) {}

  writeInput(
    contextLabel: string,
    _contextId: string,
    runId: string,
    data: Record<string, unknown>,
  ): void {
    const entry = { type: 'input', ts: new Date().toISOString(), runId, ...data };
    this.appendToFile(this.resolveLogPath(contextLabel, runId), runId, JSON.stringify(entry) + '\n');
  }

  append(contextLabel: string, _contextId: string, runId: string, content: string): void {
    this.appendToFile(this.resolveLogPath(contextLabel, runId), runId, content);
  }

  private appendToFile(filePath: string, runId: string, content: string): void {
    const prev = this.writeQueues.get(runId) ?? Promise.resolve();
    const next = prev.then(async () => {
      const dir = join(filePath, '..');
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
      }
      await appendFile(filePath, content, 'utf-8');
    });
    this.writeQueues.set(runId, next);
  }

  async flush(runId: string): Promise<void> {
    const pending = this.writeQueues.get(runId);
    if (pending) {
      await pending;
      this.writeQueues.delete(runId);
    }
  }

  async readRaw(
    contextLabel: string,
    contextId: string,
    runId: string,
    options?: { offset?: number; limit?: number },
  ): Promise<string[]> {
    const filePath = this.findLogFile(contextLabel, contextId, runId);
    if (!filePath || !existsSync(filePath)) return [];
    const content = await readFile(filePath, 'utf-8');
    let lines = content.split('\n').filter((l) => l.trim());
    if (options?.offset) lines = lines.slice(options.offset);
    if (options?.limit) lines = lines.slice(0, options.limit);
    return lines;
  }

  resolveLogDir(contextLabel: string, _contextId: string): string {
    return join(this.logDir, sanitizeName(contextLabel), currentMonth());
  }

  getLogStats(): { totalSizeMB: number; fileCount: number; oldestMonth: string | null; newestMonth: string | null } {
    if (!existsSync(this.logDir)) return { totalSizeMB: 0, fileCount: 0, oldestMonth: null, newestMonth: null };
    let totalSize = 0;
    let fileCount = 0;
    const months: string[] = [];

    for (const orgDir of readdirSync(this.logDir)) {
      const orgPath = join(this.logDir, orgDir);
      if (!statSync(orgPath).isDirectory()) continue;
      for (const sub of readdirSync(orgPath)) {
        const subPath = join(orgPath, sub);
        if (!statSync(subPath).isDirectory()) continue;
        const isMonth = /^\d{4}-\d{2}$/.test(sub);
        for (const file of readdirSync(subPath)) {
          const fp = join(subPath, file);
          if (statSync(fp).isFile()) {
            totalSize += statSync(fp).size;
            fileCount++;
          }
        }
        if (isMonth) months.push(sub);
        else {
          for (const file of []) { void file; }
          months.push('legacy');
        }
      }
    }

    const sorted = months.filter((m) => m !== 'legacy').sort();
    return {
      totalSizeMB: Math.round((totalSize / 1024 / 1024) * 100) / 100,
      fileCount,
      oldestMonth: sorted[0] ?? null,
      newestMonth: sorted[sorted.length - 1] ?? null,
    };
  }

  clearAllLogs(): { deletedFiles: number; freedMB: number } {
    if (!existsSync(this.logDir)) return { deletedFiles: 0, freedMB: 0 };
    const stats = this.getLogStats();
    rmSync(this.logDir, { recursive: true, force: true });
    mkdirSync(this.logDir, { recursive: true });
    return { deletedFiles: stats.fileCount, freedMB: stats.totalSizeMB };
  }

  clearBeforeMonth(cutoffMonth: string): { deletedFiles: number; freedMB: number } {
    if (!existsSync(this.logDir)) return { deletedFiles: 0, freedMB: 0 };
    let deletedFiles = 0;
    let freedBytes = 0;

    for (const orgDir of readdirSync(this.logDir)) {
      const orgPath = join(this.logDir, orgDir);
      if (!statSync(orgPath).isDirectory()) continue;
      for (const sub of readdirSync(orgPath)) {
        const subPath = join(orgPath, sub);
        if (!statSync(subPath).isDirectory()) continue;
        const isOldMonth = /^\d{4}-\d{2}$/.test(sub) && sub < cutoffMonth;
        const isLegacyContext = !(/^\d{4}-\d{2}$/.test(sub));
        if (isOldMonth || isLegacyContext) {
          for (const file of readdirSync(subPath)) {
            const fp = join(subPath, file);
            if (statSync(fp).isFile()) {
              freedBytes += statSync(fp).size;
              deletedFiles++;
            }
          }
          rmSync(subPath, { recursive: true, force: true });
        }
      }
      const remaining = readdirSync(orgPath);
      if (remaining.length === 0) rmSync(orgPath, { recursive: true, force: true });
    }

    return { deletedFiles, freedMB: Math.round((freedBytes / 1024 / 1024) * 100) / 100 };
  }

  private resolveLogPath(contextLabel: string, runId: string): string {
    return join(this.logDir, sanitizeName(contextLabel), currentMonth(), `${runId}.jsonl`);
  }

  private findLogFile(contextLabel: string, contextId: string, runId: string): string | null {
    const newPath = join(this.logDir, sanitizeName(contextLabel), currentMonth(), `${runId}.jsonl`);
    if (existsSync(newPath)) return newPath;

    const orgPath = join(this.logDir, sanitizeName(contextLabel));
    if (!existsSync(orgPath)) return null;
    for (const sub of readdirSync(orgPath)) {
      const candidate = join(orgPath, sub, `${runId}.jsonl`);
      if (existsSync(candidate)) return candidate;
    }

    const legacyPath = join(this.logDir, sanitizeName(contextLabel), sanitizeName(contextId), `${runId}.jsonl`);
    if (existsSync(legacyPath)) return legacyPath;

    return null;
  }
}
