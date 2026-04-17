import { injectable } from 'tsyringe';
import type { ILogger } from '@core/foundation/interfaces/i-logger';
import type { RunJob, ChildMessage } from './worker-protocol';

type MessageHandler = (msg: ChildMessage) => void;

@injectable()
export class WorkerService {
  private worker: Electron.UtilityProcess | null = null;
  private messageHandlers: MessageHandler[] = [];
  private activeRunIds = new Set<string>();
  private onFinishedCallbacks = new Map<string, (msg: Extract<ChildMessage, { type: 'run-finished' }>) => void>();

  constructor(
    private readonly workerPath: string,
    private readonly logger: ILogger,
  ) {}

  start(): void {
    if (this.worker) return;

    const { utilityProcess } = require('electron') as typeof import('electron');
    this.worker = utilityProcess.fork(this.workerPath);

    this.worker.on('message', (msg: ChildMessage) => {
      for (const handler of this.messageHandlers) {
        handler(msg);
      }

      if (msg.type === 'run-finished') {
        this.activeRunIds.delete(msg.runId);
        const cb = this.onFinishedCallbacks.get(msg.runId);
        if (cb) {
          this.onFinishedCallbacks.delete(msg.runId);
          cb(msg);
        }
      }
    });

    this.worker.on('exit', (code) => {
      this.logger.warn('Worker process exited', { code });
      this.failActiveRuns(`Worker process crashed (exit code: ${code})`);
      this.worker = null;
    });
  }

  stop(): void {
    if (this.worker) {
      this.worker.kill();
      this.worker = null;
    }
  }

  enqueueRun(job: RunJob): Promise<Extract<ChildMessage, { type: 'run-finished' }>> {
    if (!this.worker) {
      this.start();
    }
    this.activeRunIds.add(job.runId);

    return new Promise((resolve) => {
      this.onFinishedCallbacks.set(job.runId, resolve);
      this.worker!.postMessage({ type: 'enqueue-run', payload: job });
    });
  }

  cancelRun(runId: string): void {
    if (this.worker && this.activeRunIds.has(runId)) {
      this.worker.postMessage({ type: 'cancel-run', runId });
    }
  }

  onMessage(handler: MessageHandler): void {
    this.messageHandlers.push(handler);
  }

  private failActiveRuns(errorMessage: string): void {
    for (const runId of this.activeRunIds) {
      const cb = this.onFinishedCallbacks.get(runId);
      if (cb) {
        this.onFinishedCallbacks.delete(runId);
        cb({
          type: 'run-finished',
          runId,
          status: 'failed',
          summary: null,
          errorMessage,
          exitCode: null,
          signal: null,
          model: null,
          sessionId: null,
          inputTokens: 0,
          outputTokens: 0,
          cachedInputTokens: 0,
        });
      }
    }
    this.activeRunIds.clear();
  }
}
