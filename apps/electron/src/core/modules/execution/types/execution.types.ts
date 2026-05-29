export type RunStatus =
  | 'running'
  | 'succeeded'
  | 'failed'
  | 'cancelled'
  | 'interrupted'
  | 'suspended';

/**
 * Caller-supplied session-lifecycle intent. Threaded from RunCoordinator through
 * RunEngine to AcpExecutor, where it decides whether a completed session is suspended
 * (kept alive on the agent side) or closed. Defined here — the execution layer is the
 * shared lower layer that ACP depends on, so the canonical type lives here to avoid a
 * dependency cycle; `acp.types` re-exports it.
 */
export type LifecycleIntent = 'keep_alive' | 'close_on_complete';

export type WakeReason =
  | 'task_assigned'
  | 'task_scheduled'
  | 'task_completed'
  | 'review_requested'
  | 'review_approve'
  | 'review_revise'
  | 'review_delegate'
  | 'delegation_completed'
  | 'retry_failed'
  | 'dispute_detected'
  | 'conversation_reply'
  | 'conversation_escalation'
  | 'respondent_woken';

interface RunBase {
  id: string;
  orgId: string;
  roleId: string;
  status: RunStatus;
  wakeReason: WakeReason;
  startedAt: string | null;
  finishedAt: string | null;
  costUsd: number;
  tokenCount: number;
  summary: string | null;
  errorMessage: string | null;
  acpSessionId: string | null;
  agentId: string | null;
  createdAt: string;
}

/**
 * A Run always targets exactly one of three valid scenarios:
 *   - Task execution: taskId set, conversationId null
 *   - Inquiry response: both set (AI responds inside a Task context)
 *   - Planning / Adhoc: taskId null, conversationId set
 *
 * The DB enforces `task_id IS NOT NULL OR conversation_id IS NOT NULL`
 * (no run with both null). The "both set" case is permitted by the DB
 * and required for inquiry responses.
 */
export type RunTarget =
  | { taskId: string; conversationId: null }
  | { taskId: string; conversationId: string }
  | { taskId: null; conversationId: string };

export type Run = RunBase & RunTarget;

export interface CostEntry {
  id: string;
  runId: string;
  roleId: string;
  orgId: string;
  tokenCount: number;
  costUsd: number;
  createdAt: string;
}

export interface ExecutorInput {
  runId: string;
  roleId: string;
  orgId: string;
  taskId: string;
  wakeReason: string;
  prompt: string;
  projectDir: string;
  sessionId?: string;
  /**
   * Session-lifecycle intent. The executor calls `decideLifecycle` with this and the
   * observed stop reason to choose suspend-vs-close. Defaults to `close_on_complete` when absent.
   */
  lifecycleIntent?: LifecycleIntent;
}

export interface ExecutorOutput {
  status: 'succeeded' | 'failed' | 'cancelled' | 'interrupted' | 'suspended';
  summary: string | null;
  errorMessage: string | null;
  sessionId: string | null;
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
}

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
  /** Session-lifecycle intent, threaded through to the executor. Defaults to `close_on_complete`. */
  lifecycleIntent?: LifecycleIntent;
}

export interface RunResult {
  runId: string;
  status: RunStatus;
  sessionId: string | null;
  summary: string | null;
  inputTokens: number;
  outputTokens: number;
  errorMessage: string | null;
}

interface CreateRunBase {
  id: string;
  orgId: string;
  roleId: string;
  wakeReason: WakeReason;
}

export type CreateRunInput = CreateRunBase & RunTarget;

export interface CreateCostEntryInput {
  runId: string;
  roleId: string;
  orgId: string;
  tokenCount: number;
  costUsd: number;
}
