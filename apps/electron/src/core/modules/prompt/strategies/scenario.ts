import type { PromptContext } from '../types/prompt.types';

export type PromptScenario =
  | 'terminal_noop'
  | 'preview_decomposition'
  | 'eager_decomposition'
  | 'execute_leaf'
  | 'revision'
  | 'review_approve'
  | 'task_completed'
  | 'conversation_reply'
  | 'retry_failed';

export function resolveScenario(ctx: PromptContext): PromptScenario {
  const { wakeReason } = ctx;

  const statusCategory = ctx.workflowSchema?.currentStatus.category;
  if (statusCategory === 'terminal' || ctx.task.status === 'done' || ctx.task.status === 'cancelled') {
    return 'terminal_noop';
  }

  if (wakeReason === 'review_revise') return 'revision';
  if (wakeReason === 'retry_failed') return 'retry_failed';
  if (wakeReason === 'task_completed') return 'task_completed';

  if (wakeReason === 'conversation_reply' && ctx.task.isDecomposable) {
    if (ctx.task.planningMode === 'eager') return 'eager_decomposition';
    return 'preview_decomposition';
  }
  if (wakeReason === 'conversation_reply') return 'conversation_reply';

  if (wakeReason === 'review_approve') return 'review_approve';

  if (ctx.task.isDecomposable) {
    if (ctx.task.planningMode === 'eager') return 'eager_decomposition';
    return 'preview_decomposition';
  }
  return 'execute_leaf';
}
