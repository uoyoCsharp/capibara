/**
 * CLI Process Pool - Limits parallel CLI processes via semaphore
 * @module infrastructure/cli-adapter/process-pool
 */

import type { ClaudeCliAdapter } from './claude-cli.adapter.js';
import type { ClaudeCliOptions, ClaudeCliResult } from '../../core/types/cli.types.js';

/**
 * Simple semaphore implementation, limits max concurrency.
 * No third-party libraries, manually implemented to stay lightweight.
 */
class Semaphore {
  private current = 0;
  private queue: Array<() => void> = [];

  constructor(private readonly max: number) {}

  async acquire(): Promise<void> {
    if (this.current < this.max) {
      this.current++;
      return;
    }
    return new Promise<void>((resolve) => {
      this.queue.push(() => {
        this.current++;
        resolve();
      });
    });
  }

  release(): void {
    this.current--;
    const next = this.queue.shift();
    if (next) next();
  }
}

export class CliProcessPool {
  private semaphore: Semaphore;

  constructor(
    private adapter: ClaudeCliAdapter,
    maxConcurrent: number,
  ) {
    this.semaphore = new Semaphore(maxConcurrent);
  }

  /** Execute single CLI call (concurrency limited) */
  async execute(options: ClaudeCliOptions): Promise<ClaudeCliResult> {
    await this.semaphore.acquire();
    try {
      return await this.adapter.execute(options);
    } finally {
      this.semaphore.release();
    }
  }

  /** Execute multiple CLI calls in parallel (still semaphore limited) */
  async executeParallel(optionsList: ClaudeCliOptions[]): Promise<ClaudeCliResult[]> {
    return Promise.all(optionsList.map((opts) => this.execute(opts)));
  }
}
