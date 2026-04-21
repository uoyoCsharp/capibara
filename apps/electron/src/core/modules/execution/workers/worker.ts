import type { ParentMessage, ChildMessage, RunJob } from './worker-protocol';
import type { RunStatus } from '../types/execution.types';
import type { ICliAdapter, CliAdapterResult } from '@core/infrastructure/adapters/i-cli-adapter';
import { ClaudeCliAdapter } from '@core/infrastructure/adapters/claude-cli.adapter';

const activeByRole = new Map<string, string>();
const queue: RunJob[] = [];
const cancelledRuns = new Set<string>();

const adapters = new Map<string, ICliAdapter>();
adapters.set('claude-cli', new ClaudeCliAdapter());

function getAdapter(executor: string): ICliAdapter {
  const adapter = adapters.get(executor);
  if (!adapter) {
    throw new Error(`Unknown CLI adapter: ${executor}. Available: ${[...adapters.keys()].join(', ')}`);
  }
  return adapter;
}

function postMessage(msg: ChildMessage): void {
  process.parentPort?.postMessage(msg);
}

function startRun(job: RunJob): void {
  activeByRole.set(job.roleId, job.runId);
  postMessage({ type: 'run-status', runId: job.runId, status: 'running', message: 'Starting execution' });

  executeJob(job)
    .then((result) => {
      const status: RunStatus = cancelledRuns.has(job.runId) ? 'cancelled' : result.status;
      postMessage({
        type: 'run-finished',
        runId: job.runId,
        status,
        summary: result.summary,
        errorMessage: result.errorMessage,
        exitCode: result.exitCode,
        signal: result.signal,
        model: result.model,
        sessionId: result.sessionId,
        inputTokens: result.inputTokens,
        outputTokens: result.outputTokens,
        cachedInputTokens: result.cachedInputTokens,
      });
    })
    .catch((err: Error) => {
      postMessage({
        type: 'run-finished',
        runId: job.runId,
        status: 'failed',
        summary: null,
        errorMessage: err.message,
        exitCode: null,
        signal: null,
        model: null,
        sessionId: null,
        inputTokens: 0,
        outputTokens: 0,
        cachedInputTokens: 0,
      });
    })
    .finally(() => {
      activeByRole.delete(job.roleId);
      cancelledRuns.delete(job.runId);
      maybeStartQueued();
    });
}

function maybeStartQueued(): void {
  for (let i = 0; i < queue.length; i++) {
    const job = queue[i];
    if (!activeByRole.has(job.roleId)) {
      queue.splice(i, 1);
      startRun(job);
      return;
    }
  }
}

async function executeJob(job: RunJob): Promise<CliAdapterResult> {
  const adapter = getAdapter(job.executor);

  return adapter.execute({
    runId: job.runId,
    roleId: job.roleId,
    orgId: job.orgId,
    taskId: job.taskId,
    prompt: job.prompt,
    mcpConfigPath: job.mcpConfigPath,
    projectDir: job.projectDir,
    cliConfig: job.cliConfig,
    sessionId: job.sessionId,
    onLog: (stream, chunk) => {
      postMessage({ type: 'run-log', runId: job.runId, stream, chunk });
    },
  });
}

process.parentPort?.on('message', (event: { data: ParentMessage }) => {
  const msg = event.data;

  if (msg.type === 'enqueue-run') {
    const job = msg.payload;
    if (activeByRole.has(job.roleId)) {
      queue.push(job);
    } else {
      startRun(job);
    }
  }

  if (msg.type === 'cancel-run') {
    cancelledRuns.add(msg.runId);
    const queueIdx = queue.findIndex((j) => j.runId === msg.runId);
    if (queueIdx >= 0) {
      const removed = queue.splice(queueIdx, 1)[0];
      postMessage({
        type: 'run-finished',
        runId: removed.runId,
        status: 'cancelled',
        summary: null,
        errorMessage: null,
        exitCode: null,
        signal: null,
        model: null,
        sessionId: null,
        inputTokens: 0,
        outputTokens: 0,
        cachedInputTokens: 0,
      });
    } else {
      const adapter = adapters.get('claude-cli');
      adapter?.abort(msg.runId);
    }
  }
});
