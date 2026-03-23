/**
 * JSON Execution Log Store - File-based implementation using JSON Lines format
 * @module infrastructure/persistence/json-execution-log-store
 */

import { inject, injectable } from 'tsyringe';
import { appendFile, readFile, writeFile, readdir, mkdir, stat, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import type { IExecutionLogStore } from '../../core/interfaces/execution-log-store.interface.js';
import type {
  ExecutionLogEntry,
  ExecutionLogQuery,
} from '../../core/types/execution-log.types.js';
import type { Logger } from 'pino';
import { CONFIG_TOKEN, LOGGER_TOKEN } from '../../tokens.js';
import type { AutomationConfig } from '../../core/types/config.types.js';

@injectable()
export class JsonExecutionLogStore implements IExecutionLogStore {
  private readonly baseDir: string;

  constructor(
    @inject(CONFIG_TOKEN) config: AutomationConfig,
    @inject(LOGGER_TOKEN) private logger: Logger,
  ) {
    this.baseDir = join(config.persistence.stateDir, 'logs');
  }

  async append(entry: ExecutionLogEntry): Promise<void> {
    await this.ensureDir();
    const filePath = this.getFilePath(entry.pipelineId);
    const line = JSON.stringify(entry) + '\n';
    await appendFile(filePath, line, 'utf-8');
    this.logger.debug({ pipelineId: entry.pipelineId, eventType: entry.eventType }, 'Log entry appended');
  }

  async query(query: ExecutionLogQuery): Promise<ExecutionLogEntry[]> {
    // Optimization: only load relevant logs when pipelineId is specified
    let logs: ExecutionLogEntry[];

    if (query.pipelineId) {
      // W1 fix: Only load the specific pipeline's log file
      logs = await this.loadLogsByPipeline(query.pipelineId);
    } else {
      logs = await this.loadAllLogs();
    }

    let filtered = logs;

    if (query.pipelineId) {
      filtered = filtered.filter((log) => log.pipelineId === query.pipelineId);
    }
    if (query.changeId) {
      filtered = filtered.filter((log) => log.changeId === query.changeId);
    }
    if (query.phase) {
      filtered = filtered.filter((log) => log.phase === query.phase);
    }
    if (query.eventTypes && query.eventTypes.length > 0) {
      filtered = filtered.filter((log) => query.eventTypes!.includes(log.eventType));
    }
    if (query.since) {
      const sinceTime = new Date(query.since).getTime();
      filtered = filtered.filter((log) => new Date(log.timestamp).getTime() >= sinceTime);
    }
    if (query.until) {
      const untilTime = new Date(query.until).getTime();
      filtered = filtered.filter((log) => new Date(log.timestamp).getTime() <= untilTime);
    }

    // Sort by timestamp descending (newest first)
    filtered.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

    // Apply offset
    if (query.offset && query.offset > 0) {
      filtered = filtered.slice(query.offset);
    }

    // Apply limit
    if (query.limit && query.limit > 0) {
      filtered = filtered.slice(0, query.limit);
    }

    return filtered;
  }

  async getLogsByPipeline(pipelineId: string, limit?: number): Promise<ExecutionLogEntry[]> {
    return this.query({ pipelineId, limit });
  }

  async purge(olderThanDays: number): Promise<number> {
    await this.ensureDir();
    const cutoffTime = Date.now() - olderThanDays * 24 * 60 * 60 * 1000;
    const files = await readdir(this.baseDir);
    let deletedCount = 0;

    for (const file of files) {
      if (!file.endsWith('.jsonl')) continue;

      const filePath = join(this.baseDir, file);
      const fileStat = await stat(filePath);

      if (fileStat.mtimeMs < cutoffTime) {
        await unlink(filePath);
        deletedCount++;
        this.logger.info({ file }, 'Purged old log file');
      }
    }

    return deletedCount;
  }

  async count(pipelineId: string): Promise<number> {
    const logs = await this.getLogsByPipeline(pipelineId);
    return logs.length;
  }

  private async ensureDir(): Promise<void> {
    await mkdir(this.baseDir, { recursive: true });
  }

  private getFilePath(pipelineId: string): string {
    return join(this.baseDir, `${pipelineId}.jsonl`);
  }

  private async loadAllLogs(): Promise<ExecutionLogEntry[]> {
    await this.ensureDir();
    const files = await readdir(this.baseDir);
    const allLogs: ExecutionLogEntry[] = [];

    for (const file of files) {
      if (!file.endsWith('.jsonl')) continue;

      const filePath = join(this.baseDir, file);
      try {
        const content = await readFile(filePath, 'utf-8');
        const lines = content.trim().split('\n');

        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            allLogs.push(JSON.parse(line) as ExecutionLogEntry);
          } catch {
            this.logger.warn({ file, line: line.slice(0, 100) }, 'Failed to parse log line');
          }
        }
      } catch {
        this.logger.warn({ file }, 'Failed to read log file');
      }
    }

    return allLogs;
  }

  /** Load logs from a specific pipeline file only (W1 fix: performance optimization) */
  private async loadLogsByPipeline(pipelineId: string): Promise<ExecutionLogEntry[]> {
    await this.ensureDir();
    const filePath = this.getFilePath(pipelineId);
    const logs: ExecutionLogEntry[] = [];

    try {
      const content = await readFile(filePath, 'utf-8');
      const lines = content.trim().split('\n');

      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          logs.push(JSON.parse(line) as ExecutionLogEntry);
        } catch {
          this.logger.warn({ pipelineId, line: line.slice(0, 100) }, 'Failed to parse log line');
        }
      }
    } catch {
      // File doesn't exist yet, return empty array
    }

    return logs;
  }
}
