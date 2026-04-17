import { existsSync, mkdirSync } from 'node:fs';
import { appendFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { injectable } from 'tsyringe';

function sanitizeName(name: string): string {
  return name.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_');
}

@injectable()
export class FileLogService {
  private writeQueues = new Map<string, Promise<void>>();

  constructor(private readonly logDir: string) {}

  writeInput(
    contextLabel: string,
    contextId: string,
    runId: string,
    data: Record<string, unknown>,
  ): void {
    const entry = { type: 'input', ts: new Date().toISOString(), runId, ...data };
    this.append(contextLabel, contextId, runId, JSON.stringify(entry) + '\n');
  }

  append(contextLabel: string, contextId: string, runId: string, content: string): void {
    const filePath = this.resolveLogPath(contextLabel, contextId, runId);
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
    const filePath = this.resolveLogPath(contextLabel, contextId, runId);
    if (!existsSync(filePath)) return [];
    const content = await readFile(filePath, 'utf-8');
    let lines = content.split('\n').filter((l) => l.trim());
    if (options?.offset) lines = lines.slice(options.offset);
    if (options?.limit) lines = lines.slice(0, options.limit);
    return lines;
  }

  private resolveLogPath(contextLabel: string, contextId: string, runId: string): string {
    return join(this.logDir, sanitizeName(contextLabel), sanitizeName(contextId), `${runId}.jsonl`);
  }
}
