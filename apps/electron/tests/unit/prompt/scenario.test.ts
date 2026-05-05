import { describe, it, expect } from 'vitest';
import { resolveScenario } from '@core/modules/prompt/strategies/scenario';
import type { PromptContext } from '@core/modules/prompt/types/prompt.types';
import type { WakeReason } from '@core/modules/execution/types/execution.types';

const defaultTask: PromptContext['task'] = {
  id: 'task-1',
  type: 'task',
  title: 'Test',
  description: '',
  status: 'in_progress',
  orgId: 'org-1',
  hasChildren: false,
  isDecomposable: false,
  allowedChildTypes: [],
  isTerminal: false,
  parentChain: [],
  siblings: [],
};

function createCtx(overrides: { wakeReason?: WakeReason; task?: Partial<PromptContext['task']> }): PromptContext {
  return {
    wakeReason: overrides.wakeReason ?? 'task_assigned',
    task: { ...defaultTask, ...overrides.task },
    role: { id: 'role-1', name: 'Dev', persona: '', knowledgeBaseRefs: [] },
    skills: [],
    locale: 'en',
  };
}

describe('resolveScenario', () => {
  it('task_assigned + leaf → execute_leaf', () => {
    const ctx = createCtx({ wakeReason: 'task_assigned', task: { isDecomposable: false } });
    expect(resolveScenario(ctx)).toBe('execute_leaf');
  });

  it('task_assigned + decomposable → propose_decomposition', () => {
    const ctx = createCtx({ wakeReason: 'task_assigned', task: { isDecomposable: true } });
    expect(resolveScenario(ctx)).toBe('propose_decomposition');
  });

  it('conversation_reply + decomposable → execute_decomposition', () => {
    const ctx = createCtx({ wakeReason: 'conversation_reply', task: { isDecomposable: true } });
    expect(resolveScenario(ctx)).toBe('execute_decomposition');
  });

  it('conversation_reply + leaf → conversation_reply', () => {
    const ctx = createCtx({ wakeReason: 'conversation_reply', task: { isDecomposable: false } });
    expect(resolveScenario(ctx)).toBe('conversation_reply');
  });

  it('review_revise → revision', () => {
    const ctx = createCtx({ wakeReason: 'review_revise' });
    expect(resolveScenario(ctx)).toBe('revision');
  });

  it('retry_failed → retry_failed', () => {
    const ctx = createCtx({ wakeReason: 'retry_failed' });
    expect(resolveScenario(ctx)).toBe('retry_failed');
  });

  it('task_completed → task_completed', () => {
    const ctx = createCtx({ wakeReason: 'task_completed' });
    expect(resolveScenario(ctx)).toBe('task_completed');
  });

  it('review_approve → review_approve', () => {
    const ctx = createCtx({ wakeReason: 'review_approve' });
    expect(resolveScenario(ctx)).toBe('review_approve');
  });

  it('terminal task status → terminal_noop', () => {
    const ctx = createCtx({
      wakeReason: 'task_assigned',
      task: { status: 'done', isDecomposable: true },
    });
    expect(resolveScenario(ctx)).toBe('terminal_noop');
  });

  it('terminal workflow category → terminal_noop', () => {
    const ctx = createCtx({
      wakeReason: 'conversation_reply',
      task: { status: 'in_progress', isDecomposable: true },
    });
    ctx.workflowSchema = {
      currentStatus: { name: 'done', label: 'Done', category: 'terminal' },
      availableTransitions: [],
      allStatuses: [],
      allTransitions: [],
      terminalStatuses: ['done', 'cancelled'],
    };
    expect(resolveScenario(ctx)).toBe('terminal_noop');
  });
});
