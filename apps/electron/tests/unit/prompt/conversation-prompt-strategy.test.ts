import { describe, it, expect } from 'vitest';
import { buildConversationPrompt } from '@core/modules/prompt/strategies/conversation-prompt.strategy';
import type { ConversationPromptContext } from '@core/modules/prompt/types/prompt.types';

function createCtx(overrides?: Partial<ConversationPromptContext>): ConversationPromptContext {
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
      name: 'Lead Dev',
      persona: 'Experienced team lead',
      knowledgeBaseRefs: [],
    },
    skills: [],
    locale: 'en',
    ...overrides,
  };
}

describe('buildConversationPrompt', () => {
  it('includes role name and persona', () => {
    const result = buildConversationPrompt(createCtx());
    expect(result).toContain('You are Lead Dev');
    expect(result).toContain('Experienced team lead');
  });

  it('includes skills section when skills present', () => {
    const ctx = createCtx({
      skills: [{ name: 'Research', command: '/research', description: 'Research a topic' }],
    });
    const result = buildConversationPrompt(ctx);
    expect(result).toContain('# Available Skills');
    expect(result).toContain('`/research` — Research a topic');
  });

  it('omits skills section when empty', () => {
    const result = buildConversationPrompt(createCtx());
    expect(result).not.toContain('# Available Skills');
  });

  it('includes task context when task is present', () => {
    const ctx = createCtx({
      task: {
        id: 'task-1',
        type: 'task',
        title: 'Fix bug',
        description: 'Fix the login bug',
        status: 'in_progress',
      },
    });
    const result = buildConversationPrompt(ctx);
    expect(result).toContain('# Task Context');
    expect(result).toContain('Type: task');
    expect(result).toContain('Title: Fix bug');
    expect(result).toContain('Description: Fix the login bug');
  });

  it('omits task context when task is null', () => {
    const result = buildConversationPrompt(createCtx());
    expect(result).not.toContain('# Task Context');
  });

  it('includes conversation history when messages present', () => {
    const ctx = createCtx({
      conversation: {
        id: 'conv-1',
        type: 'inquiry',
        state: 'waiting',
        messageHistory: [
          { authorRoleId: 'role-asker', authorType: 'ai', content: 'How do I deploy?', intent: 'question' },
          { authorRoleId: null, authorType: 'human', content: 'Use the deploy command', intent: 'reply' },
        ],
      },
    });
    const result = buildConversationPrompt(ctx);
    expect(result).toContain('# Conversation History');
    expect(result).toContain('[role-asker] (question): How do I deploy?');
    expect(result).toContain('[human] (reply): Use the deploy command');
  });

  it('uses authorType as fallback when authorRoleId is null', () => {
    const ctx = createCtx({
      conversation: {
        id: 'conv-1',
        type: 'adhoc',
        state: 'active',
        messageHistory: [
          { authorRoleId: null, authorType: 'human', content: 'Hello', intent: 'general' },
        ],
      },
    });
    const result = buildConversationPrompt(ctx);
    expect(result).toContain('[human] (general): Hello');
  });

  it('omits conversation history when empty', () => {
    const result = buildConversationPrompt(createCtx());
    expect(result).not.toContain('# Conversation History');
  });

  it('labels inquiry type correctly', () => {
    const result = buildConversationPrompt(createCtx());
    expect(result).toContain('This is a Inquiry (state: waiting)');
  });

  it('labels planning type correctly', () => {
    const ctx = createCtx({
      conversation: { id: 'c', type: 'planning', state: 'active', messageHistory: [] },
    });
    const result = buildConversationPrompt(ctx);
    expect(result).toContain('This is a Planning Session (state: active)');
  });

  it('labels adhoc type as Conversation', () => {
    const ctx = createCtx({
      conversation: { id: 'c', type: 'adhoc', state: 'active', messageHistory: [] },
    });
    const result = buildConversationPrompt(ctx);
    expect(result).toContain('This is a Conversation (state: active)');
  });

  it('separates sections with horizontal rules', () => {
    const result = buildConversationPrompt(createCtx());
    expect(result).toContain('---');
  });
});
