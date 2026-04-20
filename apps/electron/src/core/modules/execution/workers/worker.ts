import type { ParentMessage, ChildMessage, RunJob } from './worker-protocol';
import type { RunStatus } from '../types/execution.types';

const activeByRole = new Map<string, string>();
const queue: RunJob[] = [];
const cancelledRuns = new Set<string>();

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
        signal: null,
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

async function executeJob(job: RunJob): Promise<{
  status: RunStatus;
  summary: string | null;
  errorMessage: string | null;
  exitCode: number | null;
  model: string | null;
  sessionId: string | null;
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
}> {
  const { spawn } = await import('node:child_process');
  const { parseClaudeStreamJson } = await import('./claude-stream-parser');

  const args = [
    '--output-format', 'stream-json',
    '--verbose',
    '-p', job.prompt,
  ];

  if (job.cliConfig?.model) args.push('--model', job.cliConfig.model);
  if (job.cliConfig?.maxTurnsPerRun) args.push('--max-turns', String(job.cliConfig.maxTurnsPerRun));
  if (job.cliConfig?.effort) args.push('--effort', job.cliConfig.effort);
  if (job.mcpConfigPath) args.push('--mcp-config', job.mcpConfigPath);
  if (job.sessionId) args.push('--resume', job.sessionId);
  if (job.cliConfig?.extraArgs) args.push(...job.cliConfig.extraArgs);

  return new Promise((resolve, reject) => {
    let stdout = '';
    let stderr = '';

    const proc = spawn('claude', args, {
      cwd: job.projectDir,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env },
      shell: process.platform === 'win32',
    });

    proc.stdout?.on('data', (data: Buffer) => {
      const chunk = data.toString();
      stdout += chunk;
      postMessage({ type: 'run-log', runId: job.runId, stream: 'stdout', chunk });
    });

    proc.stderr?.on('data', (data: Buffer) => {
      const chunk = data.toString();
      stderr += chunk;
      postMessage({ type: 'run-log', runId: job.runId, stream: 'stderr', chunk });
    });

    proc.on('error', (err) => reject(err));

    proc.on('close', (code) => {
      const parsed = parseClaudeStreamJson(stdout);
      const status: RunStatus = code === 0 ? 'succeeded' : 'failed';
      resolve({
        status,
        summary: parsed.summary,
        errorMessage: parsed.errorMessage ?? (stderr.trim() || null),
        exitCode: code,
        model: parsed.model,
        sessionId: parsed.sessionId,
        inputTokens: parsed.inputTokens,
        outputTokens: parsed.outputTokens,
        cachedInputTokens: parsed.cachedInputTokens,
      });
    });

    if (cancelledRuns.has(job.runId)) {
      proc.kill('SIGTERM');
    }
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
    }
  }
});
