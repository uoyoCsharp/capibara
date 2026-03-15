/**
 * File System Artifact Store - File system implementation of IArtifactStore
 * @module infrastructure/persistence/fs-artifact-store
 */

import { inject, injectable } from 'tsyringe';
import { readFile, writeFile, readdir, mkdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import type { IArtifactStore, Artifact } from '../../core/interfaces/artifact-store.interface.js';
import type { Phase } from '../../core/types/phase.types.js';
import { CONFIG_TOKEN, LOGGER_TOKEN } from '../../tokens.js';
import type { AutomationConfig } from '../../core/types/config.types.js';
import type { Logger } from 'pino';

@injectable()
export class FsArtifactStore implements IArtifactStore {
  private readonly baseDir: string;

  constructor(
    @inject(CONFIG_TOKEN) config: AutomationConfig,
    @inject(LOGGER_TOKEN) private logger: Logger,
  ) {
    this.baseDir = join(config.persistence.stateDir, 'artifacts');
  }

  async save(changeId: string, phase: Phase, content: string): Promise<string> {
    const dir = join(this.baseDir, changeId);
    await mkdir(dir, { recursive: true });
    const filePath = join(dir, `${phase}.md`);
    await writeFile(filePath, content, 'utf-8');
    this.logger.debug({ changeId, phase, path: filePath }, 'Artifact saved');
    return filePath;
  }

  async load(changeId: string, phase: Phase): Promise<Artifact | null> {
    try {
      const filePath = join(this.baseDir, changeId, `${phase}.md`);
      const content = await readFile(filePath, 'utf-8');
      return { phase, path: filePath, content };
    } catch {
      return null;
    }
  }

  async loadAll(changeId: string): Promise<Artifact[]> {
    try {
      const dir = join(this.baseDir, changeId);
      const files = await readdir(dir);
      const artifacts = await Promise.all(
        files
          .filter((f) => f.endsWith('.md'))
          .map(async (f) => {
            const phase = f.replace('.md', '') as Phase;
            const filePath = join(dir, f);
            const content = await readFile(filePath, 'utf-8');
            return { phase, path: filePath, content };
          }),
      );
      return artifacts;
    } catch {
      return [];
    }
  }

  async detectChangedFiles(since?: string): Promise<string[]> {
    // Simplified implementation: traverse artifacts directory, return files modified after since
    const changed: string[] = [];
    const sinceTime = since ? new Date(since).getTime() : 0;

    try {
      const changeIds = await readdir(this.baseDir);
      for (const changeId of changeIds) {
        const dir = join(this.baseDir, changeId);
        const files = await readdir(dir);
        for (const file of files) {
          const filePath = join(dir, file);
          const fileStat = await stat(filePath);
          if (fileStat.mtimeMs > sinceTime) {
            changed.push(filePath);
          }
        }
      }
    } catch {
      // Return empty array when directory doesn't exist
    }

    return changed;
  }
}
