/**
 * File-based log service for run output.
 *
 * Writes JSONL (one JSON object per line) to:
 *   {logDir}/{orgName}/{taskId}/{runId}.jsonl
 *
 * Provides both raw and parsed read modes with streaming support.
 */

import { createReadStream, existsSync, mkdirSync } from 'node:fs';
import { appendFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createInterface } from 'node:readline';

/** A single parsed log entry for user-friendly display */
export interface ParsedLogEntry {
  /** Timestamp (ISO string or null) */
  ts: string | null;
  /** Entry type: assistant, tool_use, tool_result, system, result, unknown */
  kind: string;
  /** User-friendly text content */
  text: string;
}

export interface ReadLogOptions {
  /** 0-based line offset */
  offset?: number;
  /** Max lines to return (default 500) */
  limit?: number;
}

export class FileLogService {
  /** Per-run write queues to guarantee ordering without file locking */
  private readonly writeQueues = new Map<string, Promise<void>>();

  constructor(private readonly logDir: string) {}

  /**
   * Write the input prompt and execution context as the first entry in the run log.
   * This records what was sent to the CLI, enabling full request/response traceability.
   */
  writeInput(orgName: string, taskId: string, runId: string, input: {
    prompt: string;
    trigger: string;
    roleId: string;
    executor: string;
    projectDir: string;
    sessionId?: string;
    cliConfig?: Record<string, unknown>;
  }): void {
    const filePath = this.resolveLogPath(orgName, taskId, runId);
    const dir = join(this.logDir, sanitizeName(orgName), taskId);

    const prev = this.writeQueues.get(runId) ?? Promise.resolve();
    const next = prev.then(async () => {
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
      }
      const entry = JSON.stringify({
        type: 'input',
        ts: new Date().toISOString(),
        runId,
        trigger: input.trigger,
        roleId: input.roleId,
        executor: input.executor,
        projectDir: input.projectDir,
        sessionId: input.sessionId ?? null,
        cliConfig: input.cliConfig ?? null,
        prompt: input.prompt,
      }) + '\n';
      await appendFile(filePath, entry, 'utf-8');
    }).catch(() => {
      // Best-effort write
    });
    this.writeQueues.set(runId, next);
  }

  /**
   * Append a raw stdout/stderr chunk to the run log file.
   * Creates directories lazily on first write per run.
   */
  append(orgName: string, taskId: string, runId: string, chunk: string): void {
    const filePath = this.resolveLogPath(orgName, taskId, runId);

    // Chain writes to ensure ordering per run
    const prev = this.writeQueues.get(runId) ?? Promise.resolve();
    const next = prev.then(async () => {
      const dir = join(this.logDir, sanitizeName(orgName), taskId);
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
      }
      await appendFile(filePath, chunk, 'utf-8');
    }).catch(() => {
      // Best-effort write — don't block execution
    });
    this.writeQueues.set(runId, next);
  }

  /** Flush pending writes for a run and remove the queue entry */
  async flush(runId: string): Promise<void> {
    const pending = this.writeQueues.get(runId);
    if (pending) {
      await pending;
      this.writeQueues.delete(runId);
    }
  }

  /**
   * Read raw JSONL lines from a run log file.
   * Uses streaming readline to avoid loading entire file into memory.
   */
  async readRaw(
    orgName: string,
    taskId: string,
    runId: string,
    opts: ReadLogOptions = {},
  ): Promise<string[]> {
    const filePath = this.resolveLogPath(orgName, taskId, runId);
    if (!existsSync(filePath)) return [];

    const offset = opts.offset ?? 0;
    const limit = opts.limit ?? 500;

    return this.readLines(filePath, offset, limit);
  }

  /**
   * Read and parse log entries into user-friendly format.
   * Each JSONL line from stream-json output is parsed into a ParsedLogEntry.
   */
  async readParsed(
    orgName: string,
    taskId: string,
    runId: string,
    opts: ReadLogOptions = {},
  ): Promise<ParsedLogEntry[]> {
    const filePath = this.resolveLogPath(orgName, taskId, runId);
    if (!existsSync(filePath)) return [];

    const offset = opts.offset ?? 0;
    const limit = opts.limit ?? 500;
    const lines = await this.readLines(filePath, offset, limit);
    return parseLinesIntoEntries(lines);
  }

  /** Check if a log file exists */
  exists(orgName: string, taskId: string, runId: string): boolean {
    return existsSync(this.resolveLogPath(orgName, taskId, runId));
  }

  /** Get the directory containing the log file */
  getLogDir(orgName: string, taskId: string): string {
    return join(this.logDir, sanitizeName(orgName), taskId);
  }

  private resolveLogPath(orgName: string, taskId: string, runId: string): string {
    return join(this.logDir, sanitizeName(orgName), taskId, `${runId}.jsonl`);
  }

  private readLines(filePath: string, offset: number, limit: number): Promise<string[]> {
    return new Promise<string[]>((resolve, reject) => {
      const lines: string[] = [];
      let lineIndex = 0;

      const stream = createReadStream(filePath, { encoding: 'utf-8' });
      const rl = createInterface({ input: stream, crlfDelay: Infinity });

      rl.on('line', (line) => {
        if (lineIndex >= offset && lines.length < limit) {
          lines.push(line);
        }
        lineIndex++;
        if (lines.length >= limit) {
          rl.close();
          stream.destroy();
        }
      });

      rl.on('close', () => resolve(lines));
      rl.on('error', reject);
      stream.on('error', reject);
    });
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────

/** Sanitize org name for safe filesystem path (no slashes, dots-only, etc.) */
function sanitizeName(name: string): string {
  return name
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '_')
    .replace(/^\.+$/, '_')
    .slice(0, 100) || '_';
}

/** Parse raw JSONL lines into user-friendly entries */
function parseLinesIntoEntries(lines: string[]): ParsedLogEntry[] {
  const entries: ParsedLogEntry[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    // Each line in stream-json may contain multiple JSON objects if
    // the CLI flushes multiple events in one stdout chunk.
    // But typically it's one JSON per line.
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      // Non-JSON line (e.g. raw stderr text)
      if (trimmed.length > 0) {
        entries.push({ ts: null, kind: 'stderr', text: trimmed });
      }
      continue;
    }

    const entry = parseStreamJsonObject(parsed);
    if (entry) entries.push(entry);
  }

  return entries;
}

/**
 * Only extract 'system' (init) and 'result' entries — these are the only
 * pieces meaningful to end users. All other event types (assistant, tool_use,
 * tool_result) are low-signal noise and are available in the raw view.
 */
function parseStreamJsonObject(obj: Record<string, unknown>): ParsedLogEntry | null {
  const type = typeof obj.type === 'string' ? obj.type : '';

  switch (type) {
    case 'input': {
      const ts = typeof obj.ts === 'string' ? obj.ts : null;
      const trigger = typeof obj.trigger === 'string' ? obj.trigger : '';
      const executor = typeof obj.executor === 'string' ? obj.executor : '';
      const sessionId = typeof obj.sessionId === 'string' ? obj.sessionId : null;
      const prompt = typeof obj.prompt === 'string' ? obj.prompt : '';
      const truncated = prompt.length > 500 ? prompt.slice(0, 500) + '…' : prompt;
      const sessionNote = sessionId ? `, resume: ${sessionId.slice(0, 8)}…` : '';
      return {
        ts,
        kind: 'input',
        text: `[Input] trigger=${trigger}, executor=${executor}${sessionNote}\n${truncated}`,
      };
    }

    case 'system': {
      const subtype = typeof obj.subtype === 'string' ? obj.subtype : '';
      if (subtype === 'init') {
        const model = typeof obj.model === 'string' ? obj.model : 'unknown';
        const sessionId = typeof obj.session_id === 'string' ? obj.session_id : '';
        return {
          ts: null,
          kind: 'system',
          text: `Session initialized — model: ${model}${sessionId ? `, session: ${sessionId.slice(0, 8)}...` : ''}`,
        };
      }
      return null;
    }

    case 'result': {
      const result = typeof obj.result === 'string' ? obj.result : '';
      const isError = obj.is_error === true;
      const prefix = isError ? '[Error] ' : '[Summary] ';
      const text = `${prefix}${result}`;
      return { ts: null, kind: 'result', text };
    }

    default:
      return null;
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}
