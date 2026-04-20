import { describe, it, expect } from 'vitest';
import { buildTaskPrompt } from '@core/modules/prompt/strategies/task-prompt.strategy';
import type { PromptContext } from '@core/modules/prompt/types/prompt.types';

function createCtx(overrides?: Partial<PromptContext>): PromptContext {
  return {
    task: {
      id: 'task-1',
      type: 'task',
      title: 'Implement auth',
      description: 'Add authentication flow',
      status: 'in_progress',
      parentChain: [],
      siblings: [],
    },
    role: {
      id: 'role-1',
      name: 'Backend Dev',
      persona: 'Expert in Node.js and security',
      knowledgeBaseRefs: [],
    },
    skills: [],
    locale: 'en',
    ...overrides,
  };
}

describe('buildTaskPrompt', () => {
  it('includes role name and persona', () => {
    const result = buildTaskPrompt(createCtx());
    expect(result).toContain('You are Backend Dev');
    expect(result).toContain('Expert in Node.js and security');
  });

  it('includes task type, title, status, and description', () => {
    const result = buildTaskPrompt(createCtx());
    expect(result).toContain('Type: task');
    expect(result).toContain('Title: Implement auth');
    expect(result).toContain('Status: in_progress');
    expect(result).toContain('Description: Add authentication flow');
  });

  it('includes skills section when skills are present', () => {
    const ctx = createCtx({
      skills: [
        { name: 'Deploy', command: '/deploy', description: 'Deploy to production' },
        { name: 'Test', command: '/test', description: 'Run tests' },
      ],
    });
    const result = buildTaskPrompt(ctx);
    expect(result).toContain('# Available Skills');
    expect(result).toContain('`/deploy` — Deploy to production');
    expect(result).toContain('`/test` — Run tests');
  });

  it('omits skills section when no skills', () => {
    const result = buildTaskPrompt(createCtx());
    expect(result).not.toContain('# Available Skills');
  });

  it('includes parent chain when present', () => {
    const ctx = createCtx({
      task: {
        ...createCtx().task,
        parentChain: [
          { id: 'p1', type: 'epic', title: 'Auth Epic', status: 'in_progress' },
          { id: 'p2', type: 'project', title: 'Security', status: 'active' },
        ],
      },
    });
    const result = buildTaskPrompt(ctx);
    expect(result).toContain('Parent chain:');
    expect(result).toContain('epic:Auth Epic [in_progress]');
    expect(result).toContain('project:Security [active]');
  });

  it('omits parent chain when empty', () => {
    const result = buildTaskPrompt(createCtx());
    expect(result).not.toContain('Parent chain:');
  });

  it('includes siblings when present', () => {
    const ctx = createCtx({
      task: {
        ...createCtx().task,
        siblings: [
          { id: 's1', type: 'task', title: 'Setup DB', status: 'done' },
          { id: 's2', type: 'task', title: 'Write tests', status: 'todo' },
        ],
      },
    });
    const result = buildTaskPrompt(ctx);
    expect(result).toContain('Siblings:');
    expect(result).toContain('task:Setup DB [done]');
    expect(result).toContain('task:Write tests [todo]');
  });

  it('omits siblings when empty', () => {
    const result = buildTaskPrompt(createCtx());
    expect(result).not.toContain('Siblings:');
  });

  it('includes knowledge base references when present', () => {
    const ctx = createCtx({
      role: {
        ...createCtx().role,
        knowledgeBaseRefs: ['docs/api.md', 'docs/security.md'],
      },
    });
    const result = buildTaskPrompt(ctx);
    expect(result).toContain('# Knowledge Base References');
    expect(result).toContain('docs/api.md');
    expect(result).toContain('docs/security.md');
  });

  it('omits knowledge base section when empty', () => {
    const result = buildTaskPrompt(createCtx());
    expect(result).not.toContain('# Knowledge Base References');
  });

  it('separates sections with horizontal rules', () => {
    const result = buildTaskPrompt(createCtx());
    expect(result).toContain('---');
  });
});
