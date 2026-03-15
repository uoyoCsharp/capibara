/**
 * JSON File State Store - File system implementation of IStateStore
 * @module infrastructure/persistence/json-state-store
 */

import { inject, injectable } from 'tsyringe';
import { readFile, writeFile, readdir, unlink, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { IStateStore } from '../../core/interfaces/state-store.interface.js';
import type { PipelineState } from '../../core/types/pipeline.types.js';
import { CONFIG_TOKEN, LOGGER_TOKEN } from '../../tokens.js';
import type { AutomationConfig } from '../../core/types/config.types.js';
import type { Logger } from 'pino';

@injectable()
export class JsonStateStore implements IStateStore {
  private readonly dir: string;

  constructor(
    @inject(CONFIG_TOKEN) config: AutomationConfig,
    @inject(LOGGER_TOKEN) private logger: Logger,
  ) {
    this.dir = config.persistence.stateDir;
  }

  async save(state: PipelineState): Promise<void> {
    await mkdir(this.dir, { recursive: true });
    const filePath = join(this.dir, `${state.id}.json`);
    // Write temp file first then rename, ensuring atomic write
    const tmpPath = `${filePath}.tmp`;
    await writeFile(tmpPath, JSON.stringify(state, null, 2), 'utf-8');
    const { rename } = await import('node:fs/promises');
    await rename(tmpPath, filePath);
    this.logger.debug({ pipelineId: state.id }, 'State saved');
  }

  async load(pipelineId: string): Promise<PipelineState | null> {
    try {
      const filePath = join(this.dir, `${pipelineId}.json`);
      const raw = await readFile(filePath, 'utf-8');
      return JSON.parse(raw) as PipelineState;
    } catch {
      return null;
    }
  }

  async list(): Promise<PipelineState[]> {
    try {
      const files = await readdir(this.dir);
      const states = await Promise.all(
        files
          .filter((f) => f.endsWith('.json'))
          .map(async (f) => {
            const raw = await readFile(join(this.dir, f), 'utf-8');
            return JSON.parse(raw) as PipelineState;
          }),
      );
      return states;
    } catch {
      return [];
    }
  }

  async delete(pipelineId: string): Promise<void> {
    try {
      await unlink(join(this.dir, `${pipelineId}.json`));
    } catch {
      // Ignore if file doesn't exist
    }
  }
}
