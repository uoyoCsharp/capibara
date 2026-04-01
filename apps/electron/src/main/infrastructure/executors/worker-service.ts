/**
 * Main-process side of the UtilityProcess worker management.
 *
 * Uses `utilityProcess.fork()` to spawn the worker script in an isolated V8 process.
 * Handles:
 * - Worker lifecycle (create, destroy, crash recovery)
 * - Message routing (run-log, run-status, run-finished)
 * - Pending run resolution callbacks
 *
 * Reference: AgentCompany worker-service.ts
 */

import { utilityProcess } from 'electron';
import type { ILogger } from '@main/core/interfaces/i-logger.js';
import type { RunJob, ParentMessage, ChildMessage, RunFinishedMessage } from './worker-protocol.js';

export interface WorkerRunCallbacks {
  onLog: (runId: string, stream: 'stdout' | 'stderr', chunk: string) => void;
  onStatusChange: (runId: string, status: string, message: string) => void;
  onFinished: (event: RunFinishedMessage) => void;
}

export class WorkerService {
  private worker: Electron.UtilityProcess | null = null;
  private destroyed = false;
  private callbacks: WorkerRunCallbacks | null = null;

  constructor(
    private readonly workerPath: string,
    private readonly logger: ILogger,
  ) {}

  setCallbacks(cb: WorkerRunCallbacks): void {
    this.callbacks = cb;
  }

  /**
   * Spawn the UtilityProcess worker. Call once during bootstrap.
   */
  start(): void {
    if (this.destroyed) return;
    this.createWorker();
    this.logger.info('WorkerService started', { workerPath: this.workerPath });
  }

  /**
   * Send a run job to the worker for execution.
   */
  enqueueRun(job: RunJob): void {
    const w = this.worker;
    if (!w) {
      this.logger.error('Cannot enqueue run: worker not available', { runId: job.runId });
      this.callbacks?.onFinished({
        type: 'run-finished',
        runId: job.runId,
        status: 'failed',
        summary: null,
        errorMessage: 'Worker process not available',
        exitCode: null,
        signal: null,
        model: null,
        sessionId: null,
        costUsd: null,
        inputTokens: 0,
        outputTokens: 0,
        cachedInputTokens: 0,
      });
      return;
    }

    const msg: ParentMessage = { type: 'enqueue-run', payload: job };
    w.postMessage(msg);
  }

  /**
   * Cancel a running or queued run.
   */
  cancelRun(runId: string): void {
    const w = this.worker;
    if (!w) return;

    const msg: ParentMessage = { type: 'cancel-run', runId };
    w.postMessage(msg);
  }

  /**
   * Gracefully shut down the worker process.
   */
  destroy(): void {
    this.destroyed = true;
    if (this.worker) {
      this.worker.kill();
      // Force kill after 2s if SIGTERM didn't work
      const ref = this.worker;
      setTimeout(() => {
        try { ref.kill(); } catch { /* already dead */ }
      }, 2000);
      this.worker = null;
    }
    this.logger.info('WorkerService destroyed');
  }

  // ─── Internal ─────────────────────────────────────────────────────

  private createWorker(): void {
    this.worker = utilityProcess.fork(this.workerPath, [], {
      stdio: 'pipe',
      serviceName: 'Capibara Orchestrator Worker',
    });

    this.worker.stdout?.on('data', (chunk: Buffer) => {
      this.logger.info(`[worker] ${chunk.toString('utf-8').trim()}`);
    });

    this.worker.stderr?.on('data', (chunk: Buffer) => {
      this.logger.error(`[worker] ${chunk.toString('utf-8').trim()}`);
    });

    this.worker.on('exit', (code) => {
      if (this.destroyed) return;

      this.logger.warn(`Worker exited with code ${code}, restarting...`);
      this.createWorker();
    });

    this.worker.on('message', (message: ChildMessage) => {
      this.handleWorkerMessage(message);
    });
  }

  private handleWorkerMessage(message: ChildMessage): void {
    if (!this.callbacks) return;

    switch (message.type) {
      case 'run-log':
        this.callbacks.onLog(message.runId, message.stream, message.chunk);
        break;

      case 'run-status':
        this.callbacks.onStatusChange(message.runId, message.status, message.message);
        break;

      case 'run-finished':
        this.callbacks.onFinished(message);
        break;
    }
  }
}
