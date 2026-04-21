import type { PromptContext } from '../types/prompt.types';

export type PromptScenario =
  | 'propose_decomposition'
  | 'execute_decomposition'
  | 'execute_leaf'
  | 'revision'
  | 'review_approve'
  | 'task_completed'
  | 'conversation_reply'
  | 'retry_failed';

export function resolveScenario(ctx: PromptContext): PromptScenario {
  const { wakeReason } = ctx;

  if (wakeReason === 'review_revise') return 'revision';
  if (wakeReason === 'retry_failed') return 'retry_failed';
  if (wakeReason === 'task_completed') return 'task_completed';

  if (wakeReason === 'conversation_reply' && ctx.task.isDecomposable) {
    return 'execute_decomposition';
  }
  if (wakeReason === 'conversation_reply') return 'conversation_reply';

  if (wakeReason === 'review_approve') return 'review_approve';

  return ctx.task.isDecomposable ? 'propose_decomposition' : 'execute_leaf';
}
