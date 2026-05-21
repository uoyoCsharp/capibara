import { injectable } from 'tsyringe';
import type { ILogger } from '@core/foundation/interfaces/i-logger';
import type { RunJob, ChildMessage } from './worker-protocol';

type MessageHandler = (msg: ChildMessage) => void;
type FinishedMessage = Extract<ChildMessage, { type: 'run-finished' }>;

export interface SpawnedRun {
  pid: number;
  finished: Promise<FinishedMessage>;
}

@injectable()
export class WorkerService {
  private worker: Electron.UtilityProcess | null = null;
  private messageHandlers: MessageHandler[] = [];
  private activeRunIds = new Set<string>();
  private spawnCallbacks = new Map<string, { resolve: (pid: number) => void; reject: (err: Error) => void }>();
  private finishedCallbacks = new Map<string, (msg: FinishedMessage) => void>();

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

      if (msg.type === 'run-spawned') {
        const cb = this.spawnCallbacks.get(msg.runId);
        if (cb) {
          this.spawnCallbacks.delete(msg.runId);
          cb.resolve(msg.pid);
        }
        return;
      }

      if (msg.type === 'run-spawn-failed') {
        const spawnCb = this.spawnCallbacks.get(msg.runId);
        if (spawnCb) {
          this.spawnCallbacks.delete(msg.runId);
          spawnCb.reject(new Error(msg.errorMessage));
        }
        this.finishedCallbacks.delete(msg.runId);
        this.activeRunIds.delete(msg.runId);
        return;
      }

      if (msg.type === 'run-finished') {
        this.activeRunIds.delete(msg.runId);
        const cb = this.finishedCallbacks.get(msg.runId);
        if (cb) {
          this.finishedCallbacks.delete(msg.runId);
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

  spawnRun(job: RunJob): Promise<SpawnedRun> {
    if (!this.worker) {
      this.start();
    }
    this.activeRunIds.add(job.runId);

    const finished = new Promise<FinishedMessage>((resolve) => {
      this.finishedCallbacks.set(job.runId, resolve);
    });

    return new Promise<SpawnedRun>((resolve, reject) => {
      this.spawnCallbacks.set(job.runId, {
        resolve: (pid) => resolve({ pid, finished }),
        reject,
      });
      this.worker!.postMessage({ type: 'spawn-run', payload: job });
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
      const spawnCb = this.spawnCallbacks.get(runId);
      if (spawnCb) {
        this.spawnCallbacks.delete(runId);
        spawnCb.reject(new Error(errorMessage));
      }
      const finishedCb = this.finishedCallbacks.get(runId);
      if (finishedCb) {
        this.finishedCallbacks.delete(runId);
        finishedCb({
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
