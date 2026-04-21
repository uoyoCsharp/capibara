import { describe, it, expect, beforeEach } from 'vitest';
import { PromptBuilder } from '@core/modules/prompt/builder/prompt.builder';
import type { RunContext } from '@core/modules/prompt/context/run.context';
import type { PromptContext, ConversationPromptContext } from '@core/modules/prompt/types/prompt.types';

function createPromptContext(overrides?: Partial<PromptContext>): PromptContext {
  return {
    wakeReason: 'task_assigned',
    task: {
      id: 'task-1',
      type: 'task',
      title: 'Build feature',
      description: 'Implement the feature',
      status: 'in_progress',
      orgId: 'org-1',
      hasChildren: false,
      isDecomposable: false,
      allowedChildTypes: [],
      isTerminal: false,
      parentChain: [],
      siblings: [],
    },
    role: {
      id: 'role-1',
      name: 'Developer',
      persona: 'A senior dev',
      knowledgeBaseRefs: [],
    },
    skills: [],
    locale: 'en',
    ...overrides,
  };
}

function createConvPromptContext(overrides?: Partial<ConversationPromptContext>): ConversationPromptContext {
  return {
    conversation: {
      id: 'conv-1',
      type: 'inquiry',
      state: 'waiting',
      messageHistory: [],
    },
    task: null,
    role: {
      id: 'role-1',
      name: 'Developer',
      persona: 'A senior dev',
      knowledgeBaseRefs: [],
    },
    skills: [],
    locale: 'en',
    ...overrides,
  };
}

describe('PromptBuilder', () => {
  let builder: PromptBuilder;
  let runContext: RunContext;

  beforeEach(() => {
    runContext = {
      buildForTask: vi.fn().mockReturnValue(createPromptContext()),
      buildForConversation: vi.fn().mockReturnValue(createConvPromptContext()),
    } as unknown as RunContext;

    builder = new PromptBuilder(runContext);
  });

  describe('buildForTask', () => {
    it('returns null when RunContext returns null', () => {
      vi.mocked(runContext.buildForTask).mockReturnValue(null);
      expect(builder.buildForTask('task-1', 'role-1', 'en', 'task_assigned')).toBeNull();
    });

    it('returns prompt string when context exists', () => {
      const result = builder.buildForTask('task-1', 'role-1', 'en', 'task_assigned');
      expect(result).not.toBeNull();
      expect(typeof result).toBe('string');
      expect(result).toContain('Developer');
      expect(result).toContain('Build feature');
    });

    it('passes args to RunContext.buildForTask including wakeReason', () => {
      builder.buildForTask('t-1', 'r-1', 'zh', 'review_revise');
      expect(runContext.buildForTask).toHaveBeenCalledWith('t-1', 'r-1', 'zh', 'review_revise');
    });
  });

  describe('buildForConversation', () => {
    it('returns null when RunContext returns null', () => {
      vi.mocked(runContext.buildForConversation).mockReturnValue(null);
      expect(builder.buildForConversation('conv-1', 'role-1', 'en')).toBeNull();
    });

    it('returns prompt string when context exists', () => {
      const result = builder.buildForConversation('conv-1', 'role-1', 'en');
      expect(result).not.toBeNull();
      expect(typeof result).toBe('string');
      expect(result).toContain('Developer');
    });

    it('passes args to RunContext.buildForConversation', () => {
      builder.buildForConversation('c-1', 'r-1', 'ja');
      expect(runContext.buildForConversation).toHaveBeenCalledWith('c-1', 'r-1', 'ja');
    });
  });

  describe('buildFromContext', () => {
    it('generates task prompt from pre-built context', () => {
      const ctx = createPromptContext();
      const result = builder.buildFromContext(ctx);
      expect(result).toContain('Developer');
      expect(result).toContain('Build feature');
      expect(result).toContain('in_progress');
    });
  });

  describe('buildFromConversationContext', () => {
    it('generates conversation prompt from pre-built context', () => {
      const ctx = createConvPromptContext();
      const result = builder.buildFromConversationContext(ctx);
      expect(result).toContain('Developer');
      expect(result).toContain('Inquiry');
    });
  });
});
