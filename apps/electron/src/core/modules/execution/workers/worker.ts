import type { ParentMessage, ChildMessage, RunJob } from './worker-protocol';
import type { RunStatus } from '../types/execution.types';
import type { ICliAdapter, CliAdapterHandle } from '@core/infrastructure/adapters/i-cli-adapter';
import { ClaudeCliAdapter } from '@core/infrastructure/adapters/claude-cli.adapter';

const handles = new Map<string, CliAdapterHandle>();
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

async function spawnRun(job: RunJob): Promise<void> {
  const adapter = getAdapter(job.executor);

  let handle: CliAdapterHandle;
  try {
    handle = await adapter.spawn({
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
  } catch (err) {
    postMessage({
      type: 'run-spawn-failed',
      runId: job.runId,
      errorMessage: err instanceof Error ? err.message : String(err),
    });
    return;
  }

  handles.set(job.runId, handle);
  postMessage({ type: 'run-spawned', runId: job.runId, pid: handle.pid });

  if (cancelledRuns.has(job.runId)) {
    handle.cancel();
  }

  try {
    const result = await handle.complete();
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
  } catch (err) {
    postMessage({
      type: 'run-finished',
      runId: job.runId,
      status: 'failed',
      summary: null,
      errorMessage: err instanceof Error ? err.message : String(err),
      exitCode: null,
      signal: null,
      model: null,
      sessionId: null,
      inputTokens: 0,
      outputTokens: 0,
      cachedInputTokens: 0,
    });
  } finally {
    handles.delete(job.runId);
    cancelledRuns.delete(job.runId);
  }
}

process.parentPort?.on('message', (event: { data: ParentMessage }) => {
  const msg = event.data;

  if (msg.type === 'spawn-run') {
    void spawnRun(msg.payload);
    return;
  }

  if (msg.type === 'cancel-run') {
    cancelledRuns.add(msg.runId);
    const handle = handles.get(msg.runId);
    if (handle) handle.cancel();
  }
});
