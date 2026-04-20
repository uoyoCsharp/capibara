export type RunStatus =
  | 'queued'
  | 'running'
  | 'succeeded'
  | 'failed'
  | 'cancelled'
  | 'interrupted';

export type WakeReason =
  | 'task_assigned'
  | 'task_completed'
  | 'review_requested'
  | 'review_approve'
  | 'review_revise'
  | 'review_delegate'
  | 'delegation_completed'
  | 'retry_failed'
  | 'dispute_detected'
  | 'conversation_reply'
  | 'conversation_escalation';

export interface Run {
  id: string;
  orgId: string;
  taskId: string | null;
  conversationId: string | null;
  roleId: string;
  status: RunStatus;
  wakeReason: WakeReason;
  startedAt: string | null;
  finishedAt: string | null;
  costUsd: number;
  tokenCount: number;
  summary: string | null;
  errorMessage: string | null;
  createdAt: string;
}

export interface CostEntry {
  id: string;
  runId: string;
  roleId: string;
  orgId: string;
  tokenCount: number;
  costUsd: number;
  createdAt: string;
}

export interface AdapterCliConfig {
  model: string | null;
  maxTurnsPerRun: number;
  effort: 'low' | 'medium' | 'high';
  timeoutMs: number;
  extraArgs: string[];
}

export interface ExecutorInput {
  runId: string;
  roleId: string;
  orgId: string;
  taskId: string;
  wakeReason: string;
  prompt: string;
  mcpConfigPath: string;
  projectDir: string;
  executor: string;
  cliConfig?: AdapterCliConfig;
  sessionId?: string;
}

export interface ExecutorOutput {
  exitCode: number | null;
  status: 'succeeded' | 'failed' | 'cancelled' | 'interrupted';
  summary: string | null;
  errorMessage: string | null;
  model: string | null;
  sessionId: string | null;
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
}

export type ExecutorLogCallback = (
  runId: string,
  stream: 'stdout' | 'stderr',
  chunk: string,
) => void;

export interface RunExecutionParams {
  roleId: string;
  orgId: string;
  prompt: string;
  contextId: string;
  contextLabel: string;
  taskId?: string;
  conversationId?: string;
  sessionId?: string;
  wakeReason?: WakeReason;
  userMessage?: string;
  projectDir?: string;
}

export interface RunResult {
  runId: string;
  status: RunStatus;
  sessionId: string | null;
  summary: string | null;
  inputTokens: number;
  outputTokens: number;
  model: string | null;
  exitCode: number | null;
  errorMessage: string | null;
}

export interface CreateRunInput {
  orgId: string;
  taskId: string | null;
  conversationId: string | null;
  roleId: string;
  wakeReason: WakeReason;
}

export interface CreateCostEntryInput {
  runId: string;
  roleId: string;
  orgId: string;
  tokenCount: number;
  costUsd: number;
}
