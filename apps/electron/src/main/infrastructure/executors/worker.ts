/**
 * UtilityProcess worker script.
 * Runs in an isolated V8 process spawned via `utilityProcess.fork()`.
 *
 * Responsibilities:
 * - Maintain a per-role serial job queue
 * - Delegate CLI execution to the appropriate adapter (Claude, Codex, etc.)
 * - Post structured messages back to Main via parentPort
 *
 * The worker is adapter-agnostic — all CLI-specific logic lives in
 * infrastructure/adapters/*.adapter.ts.
 */

import type { ParentMessage, ChildMessage, RunJob } from './worker-protocol.js';
import { getAdapter } from '../adapters/adapter-registry.js';
import type { AdapterExecutionContext } from '@main/core/interfaces/i-cli-adapter.js';

const parentPort = process.parentPort;
if (!parentPort) {
  throw new Error('Capibara worker requires process.parentPort (must run as UtilityProcess)');
}

// ─── State ────────────────────────────────────────────────────────────

/** Tracks which role has an active run (per-role serial execution) */
const activeByRole = new Map<string, string>();
/** Tracks which executor name is used for each active run */
const activeExecutors = new Map<string, string>();
const queue: RunJob[] = [];
const cancelledRuns = new Set<string>();

// ─── Post helper ──────────────────────────────────────────────────────

function post(message: ChildMessage): void {
  parentPort.postMessage(message);
}

// ─── Queue management ─────────────────────────────────────────────────

function enqueue(job: RunJob): void {
  queue.push(job);
  post({
    type: 'run-status',
    runId: job.runId,
    status: 'queued',
    message: 'Run queued in worker.',
  });
  void maybeStartQueuedRuns();
}

async function maybeStartQueuedRuns(): Promise<void> {
  const candidates = [...queue];
  for (const job of candidates) {
    // Per-role serial: skip if this role already has an active run
    if (activeByRole.has(job.roleId)) continue;

    const idx = queue.findIndex((entry) => entry.runId === job.runId);
    if (idx >= 0) queue.splice(idx, 1);
    void startRun(job);
  }
}

// ─── Run execution ────────────────────────────────────────────────────

async function startRun(job: RunJob): Promise<void> {
  activeByRole.set(job.roleId, job.runId);
  activeExecutors.set(job.runId, job.executor);

  post({
    type: 'run-status',
    runId: job.runId,
    status: 'running',
    message: `Running with adapter "${job.executor}".`,
  });

  try {
    const adapter = getAdapter(job.executor);

    const ctx: AdapterExecutionContext = {
      runId: job.runId,
      roleId: job.roleId,
      orgId: job.orgId,
      taskNodeId: job.taskNodeId,
      prompt: job.prompt,
      mcpConfigPath: job.mcpConfigPath,
      projectDir: job.projectDir,
      cliConfig: job.cliConfig,
      sessionId: job.sessionId,
      onLog: (stream, chunk) => {
        post({
          type: 'run-log',
          runId: job.runId,
          stream,
          chunk,
        });
      },
    };

    const result = await adapter.execute(ctx);

    const cancelled = cancelledRuns.has(job.runId);
    cancelledRuns.delete(job.runId);

    const finalStatus = cancelled ? 'cancelled' as const : result.status;

    post({
      type: 'run-finished',
      runId: job.runId,
      status: finalStatus,
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
    cancelledRuns.delete(job.runId);

    post({
      type: 'run-finished',
      runId: job.runId,
      status: cancelledRuns.has(job.runId) ? 'cancelled' : 'failed',
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
    activeByRole.delete(job.roleId);
    activeExecutors.delete(job.runId);
    void maybeStartQueuedRuns();
  }
}

// ─── Cancel ───────────────────────────────────────────────────────────

function cancelRun(runId: string): void {
  // Check if queued
  const queuedIdx = queue.findIndex((entry) => entry.runId === runId);
  if (queuedIdx >= 0) {
    queue.splice(queuedIdx, 1);
    post({
      type: 'run-finished',
      runId,
      status: 'cancelled',
      summary: 'Cancelled before execution.',
      errorMessage: null,
      exitCode: null,
      signal: null,
      model: null,
      sessionId: null,
      inputTokens: 0,
      outputTokens: 0,
      cachedInputTokens: 0,
    });
    return;
  }

  // Mark for cancel + delegate abort to adapter
  cancelledRuns.add(runId);
  // Active runs are no longer in the queue — adapters track their own
  // running child processes via childTracker, so calling abort is sufficient.
  try {
    const executorName = activeExecutors.get(runId) ?? 'claude-cli';
    const adapter = getAdapter(executorName);
    adapter.abort(runId);
  } catch { /* best effort */ }
}

// ─── Message handler ──────────────────────────────────────────────────

parentPort.on('message', (event: { data: ParentMessage }) => {
  const message = event.data;
  if (message.type === 'enqueue-run') {
    enqueue(message.payload);
    return;
  }
  if (message.type === 'cancel-run') {
    cancelRun(message.runId);
  }
});
