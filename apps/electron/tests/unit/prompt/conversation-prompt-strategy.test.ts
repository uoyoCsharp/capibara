import { describe, it, expect } from 'vitest';
import { buildConversationPrompt } from '@core/modules/prompt/strategies/conversation-prompt.strategy';
import type { ConversationPromptContext } from '@core/modules/prompt/types/prompt.types';

function createCtx(overrides?: Partial<ConversationPromptContext>): ConversationPromptContext {
  return {
    conversation: {
      id: 'conv-1',
      type: 'inquiry',
      state: 'waiting',
      orgId: 'org-1',
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
        orgId: 'org-1',
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
        orgId: 'org-1',
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
      conversation: { id: 'c', type: 'planning', state: 'active', orgId: 'org-1', messageHistory: [] },
    });
    const result = buildConversationPrompt(ctx);
    expect(result).toContain('This is a Planning Session (state: active)');
  });

  it('labels adhoc type as Conversation', () => {
    const ctx = createCtx({
      conversation: { id: 'c', type: 'adhoc', state: 'active', orgId: 'org-1', messageHistory: [] },
    });
    const result = buildConversationPrompt(ctx);
    expect(result).toContain('This is a Conversation (state: active)');
  });

  it('separates sections with horizontal rules', () => {
    const result = buildConversationPrompt(createCtx());
    expect(result).toContain('---');
  });
});

describe('buildConversationPrompt — decomposition revision', () => {
  it('includes decomposition instructions when task is decomposable', () => {
    const ctx = createCtx({
      task: { id: 't-1', type: 'epic', title: 'Epic', description: '', status: 'in_progress', isDecomposable: true },
    });
    const result = buildConversationPrompt(ctx);
    expect(result).toContain('# Instructions');
    expect(result).toContain('decomposition proposal');
  });

  it('omits decomposition instructions for non-decomposable task', () => {
    const ctx = createCtx({
      task: { id: 't-1', type: 'task', title: 'Task', description: '', status: 'in_progress', isDecomposable: false },
    });
    const result = buildConversationPrompt(ctx);
    expect(result).not.toContain('decomposition proposal');
  });

  it('omits decomposition instructions when no task', () => {
    const ctx = createCtx({ task: null });
    const result = buildConversationPrompt(ctx);
    expect(result).not.toContain('# Instructions');
  });
});

// ═══════════════════════════════════════════════════════════════
// planning_discussion branch (conversational task planning)
// ═══════════════════════════════════════════════════════════════

function createPlanningCtx(overrides?: Partial<ConversationPromptContext>): ConversationPromptContext {
  return {
    conversation: {
      id: 'conv-plan-1',
      type: 'planning',
      state: 'waiting',
      orgId: 'org-1',
      messageHistory: [],
    },
    task: null,
    role: {
      id: 'role-pm',
      name: 'Planning Agent',
      persona: 'Gathers requirements and structures plans',
      knowledgeBaseRefs: [],
    },
    skills: [],
    locale: 'en',
    typeSchema: {
      allTypes: [
        { name: 'epic', label: 'Epic', isLeaf: false, canDecompose: true, allowedChildren: ['story'], allowedAtRoot: true },
        { name: 'story', label: 'Story', isLeaf: false, canDecompose: true, allowedChildren: ['task'], allowedAtRoot: true },
        { name: 'task', label: 'Task', isLeaf: true, canDecompose: false, allowedChildren: [], allowedAtRoot: false },
      ],
    },
    orgRoles: [
      { id: 'role-pm', name: 'Product Manager', skillDescriptions: ['requirements gathering'] },
      { id: 'role-dev', name: 'Senior Developer', skillDescriptions: ['architecture', 'coding'] },
    ],
    pendingFeedback: null,
    ...overrides,
  };
}

describe('buildConversationPrompt — planning_discussion branch', () => {
  it('PD-01: labels conversation as Planning Session', () => {
    const result = buildConversationPrompt(createPlanningCtx());
    expect(result).toContain('This is a Planning Session');
  });

  it('PD-02: includes work item type schema table with allowedAtRoot column', () => {
    const result = buildConversationPrompt(createPlanningCtx());
    expect(result).toContain('# Work Item Type Schema');
    expect(result).toContain('| epic | Epic');
    expect(result).toContain('Root?');
  });

  it('PD-03: surfaces allowedAtRoot types explicitly so AI cannot invent invalid roots', () => {
    const result = buildConversationPrompt(createPlanningCtx());
    // epic + story are allowedAtRoot=true; task is not
    expect(result).toContain('tree root MUST be one of these types');
    expect(result).toContain('`epic`');
    expect(result).toContain('`story`');
    expect(result).not.toMatch(/tree root MUST.*`task`/);
  });

  it('PD-04: lists available roles with ids for assigneeRoleId binding', () => {
    const result = buildConversationPrompt(createPlanningCtx());
    expect(result).toContain('# Available Roles');
    expect(result).toContain('`role-pm`');
    expect(result).toContain('`role-dev`');
    expect(result).toContain('Product Manager');
    expect(result).toContain('Senior Developer');
  });

  it('PD-05: includes role skill descriptions to help AI pick the right assignee', () => {
    const result = buildConversationPrompt(createPlanningCtx());
    expect(result).toContain('requirements gathering');
    expect(result).toContain('architecture, coding');
  });

  it('PD-06: tells AI to submit tree with conversationId, NOT rootTaskId', () => {
    const ctx = createPlanningCtx();
    const result = buildConversationPrompt(ctx);
    expect(result).toContain('capibara_plan_submit_tree');
    expect(result).toContain(`\`conversationId\`: \`${ctx.conversation.id}\``);
    expect(result).toMatch(/do NOT pass.*rootTaskId/i);
  });

  it('PD-07: renders planning-specific instructions section (not the task-revision one)', () => {
    const result = buildConversationPrompt(createPlanningCtx());
    expect(result).toContain('# Instructions');
    expect(result).toMatch(/conversational planning session|understand the user/i);
    // Task-revision instructions belong to a different branch
    expect(result).not.toContain('previously submitted a decomposition proposal for this task');
  });

  it('PD-08: injects pending feedback when provided (refine loop)', () => {
    const ctx = createPlanningCtx({ pendingFeedback: 'split the auth module' });
    const result = buildConversationPrompt(ctx);
    expect(result).toContain('# User Feedback on Previous Tree');
    expect(result).toContain('split the auth module');
  });

  it('PD-09: omits feedback section when pendingFeedback is null', () => {
    const result = buildConversationPrompt(createPlanningCtx({ pendingFeedback: null }));
    expect(result).not.toContain('# User Feedback on Previous Tree');
  });

  it('PD-10: omits feedback section when pendingFeedback is undefined', () => {
    const ctx = createPlanningCtx();
    delete (ctx as { pendingFeedback?: unknown }).pendingFeedback;
    const result = buildConversationPrompt(ctx);
    expect(result).not.toContain('# User Feedback on Previous Tree');
  });

  it('PD-11: preserves multi-line feedback formatting as blockquote', () => {
    const ctx = createPlanningCtx({ pendingFeedback: 'first line\nsecond line' });
    const result = buildConversationPrompt(ctx);
    expect(result).toContain('> first line');
    expect(result).toContain('> second line');
  });

  it('PD-12: works without typeSchema (missing type table but still renders)', () => {
    const ctx = createPlanningCtx();
    delete (ctx as { typeSchema?: unknown }).typeSchema;
    const result = buildConversationPrompt(ctx);
    expect(result).not.toContain('# Work Item Type Schema');
    // Instructions still present
    expect(result).toContain('# Instructions');
  });

  it('PD-13: works without orgRoles (no roles section but still renders)', () => {
    const ctx = createPlanningCtx();
    delete (ctx as { orgRoles?: unknown }).orgRoles;
    const result = buildConversationPrompt(ctx);
    expect(result).not.toContain('# Available Roles');
    expect(result).toContain('# Instructions');
  });

  it('PD-14: handles empty typeSchema.allTypes gracefully', () => {
    const ctx = createPlanningCtx({ typeSchema: { allTypes: [] } });
    const result = buildConversationPrompt(ctx);
    expect(result).not.toContain('# Work Item Type Schema');
  });

  it('PD-15: handles empty orgRoles gracefully', () => {
    const ctx = createPlanningCtx({ orgRoles: [] });
    const result = buildConversationPrompt(ctx);
    expect(result).not.toContain('# Available Roles');
  });

  it('PD-16: conversation history still rendered above planning sections', () => {
    const ctx = createPlanningCtx({
      conversation: {
        id: 'conv-plan-1',
        type: 'planning',
        state: 'waiting',
        orgId: 'org-1',
        messageHistory: [
          { authorRoleId: null, authorType: 'human', content: 'a note app', intent: 'general' },
          { authorRoleId: 'role-pm', authorType: 'ai', content: 'solo or shared?', intent: 'question' },
        ],
      },
    });
    const result = buildConversationPrompt(ctx);
    expect(result).toContain('# Conversation History');
    expect(result).toContain('a note app');
    expect(result).toContain('solo or shared?');
  });

  it('PD-17: does NOT trigger planning branch when type is inquiry (even if typeSchema passed)', () => {
    const ctx = createPlanningCtx({
      conversation: {
        id: 'conv-1',
        type: 'inquiry',
        state: 'waiting',
        orgId: 'org-1',
        messageHistory: [],
      },
    });
    const result = buildConversationPrompt(ctx);
    expect(result).not.toContain('# Work Item Type Schema');
    expect(result).not.toContain('# Available Roles');
    expect(result).not.toMatch(/conversational planning session/i);
  });

  it('PD-18: does NOT trigger planning branch when type is adhoc', () => {
    const ctx = createPlanningCtx({
      conversation: {
        id: 'conv-1',
        type: 'adhoc',
        state: 'active',
        orgId: 'org-1',
        messageHistory: [],
      },
    });
    const result = buildConversationPrompt(ctx);
    expect(result).not.toContain('# Work Item Type Schema');
    expect(result).not.toContain('# Available Roles');
  });
});
