import { describe, it, expect } from 'vitest';
import { buildTaskPrompt } from '@core/modules/prompt/strategies/task-prompt.strategy';
import type { PromptContext } from '@core/modules/prompt/types/prompt.types';

const defaultTask: PromptContext['task'] = {
  id: 'task-1',
  type: 'task',
  title: 'Implement auth',
  description: 'Add authentication flow',
  status: 'in_progress',
  orgId: 'org-1',
  hasChildren: false,
  isDecomposable: false,
  planningMode: 'preview',
  pendingFeedback: null,
  allowedChildTypes: [],
  isTerminal: false,
  parentChain: [],
  siblings: [],
};

const defaultRole: PromptContext['role'] = {
  id: 'role-1',
  name: 'Backend Dev',
  persona: 'Expert in Node.js and security',
  knowledgeBaseRefs: [],
};

function createCtx(overrides?: Partial<PromptContext>): PromptContext {
  return {
    wakeReason: 'task_assigned',
    task: { ...defaultTask },
    role: { ...defaultRole },
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
        ...defaultTask,
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
        ...defaultTask,
        siblings: [
          { id: 's1', type: 'task', title: 'Setup DB', status: 'done', assigneeRoleName: 'Dev', isCurrent: false },
          { id: 's2', type: 'task', title: 'Write tests', status: 'todo', assigneeRoleName: 'QA', isCurrent: false },
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
        ...defaultRole,
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

describe('buildTaskPrompt — new sections', () => {
  it('includes System Context section', () => {
    const result = buildTaskPrompt(createCtx());
    expect(result).toContain('# System Context');
    expect(result).toContain('Stateless runs');
  });

  it('includes ID bindings with correct values', () => {
    const ctx = createCtx({
      task: { ...defaultTask, orgId: 'org-1' },
      role: { ...defaultRole, id: 'role-1' },
    });
    const result = buildTaskPrompt(ctx);
    expect(result).toContain('# Your IDs');
    expect(result).toContain('taskId:');
    expect(result).toContain('roleId:');
    expect(result).toContain('orgId:');
    expect(result).toContain('org-1');
  });

  it('execute_leaf: includes capibara_task_transition instruction', () => {
    const ctx = createCtx({
      wakeReason: 'task_assigned',
      task: { ...defaultTask, isDecomposable: false },
    });
    const result = buildTaskPrompt(ctx);
    expect(result).toContain('capibara_task_transition');
    expect(result).not.toContain('capibara_task_create_child');
  });

  it('preview_decomposition (default): instructs to submit tree via plan_submit_tree', () => {
    const ctx = createCtx({
      wakeReason: 'task_assigned',
      task: { ...defaultTask, isDecomposable: true, planningMode: 'preview' },
    });
    const result = buildTaskPrompt(ctx);
    expect(result).toContain('capibara_plan_submit_tree');
    expect(result).not.toContain('capibara_task_create_child');
  });

  it('eager_decomposition: instructs to submit tree via plan_submit_tree', () => {
    const ctx = createCtx({
      wakeReason: 'task_assigned',
      task: { ...defaultTask, isDecomposable: true, planningMode: 'eager' },
    });
    const result = buildTaskPrompt(ctx);
    expect(result).toContain('capibara_plan_submit_tree');
    expect(result).not.toContain('capibara_task_create_child');
  });

  it('revision: instructs to address feedback', () => {
    const ctx = createCtx({ wakeReason: 'review_revise' });
    const result = buildTaskPrompt(ctx);
    expect(result).toContain('# Instructions');
    expect(result).toContain('revision');
  });

  it('tool guidance differs between leaf and decomposition', () => {
    const leafResult = buildTaskPrompt(createCtx({
      wakeReason: 'task_assigned',
      task: { ...defaultTask, isDecomposable: false },
    }));
    const decompResult = buildTaskPrompt(createCtx({
      wakeReason: 'task_assigned',
      task: { ...defaultTask, isDecomposable: true, planningMode: 'preview' },
    }));
    expect(leafResult).not.toContain('capibara_plan_submit_tree');
    expect(decompResult).toContain('capibara_plan_submit_tree');
  });
});

describe('buildTaskPrompt — organization context', () => {
  it('includes superior, subordinates with skills, and peers', () => {
    const ctx = createCtx({
      orgHierarchy: {
        parentRole: { id: 'r-lead', name: 'Tech Lead' },
        subordinates: [
          { id: 'r-dev', name: 'Developer', skillDescriptions: ['code implementation'] },
          { id: 'r-qa', name: 'QA', skillDescriptions: ['testing'] },
        ],
        peers: [{ id: 'r-design', name: 'Designer' }],
      },
      wakeReason: 'task_assigned',
      task: { ...defaultTask, isDecomposable: true },
    });
    const result = buildTaskPrompt(ctx);
    expect(result).toContain('Tech Lead');
    expect(result).toContain('Developer');
    expect(result).toContain('code implementation');
    expect(result).toContain('Designer');
  });

  it('handles top-level role with no superior', () => {
    const ctx = createCtx({
      orgHierarchy: { parentRole: null, subordinates: [], peers: [] },
    });
    const result = buildTaskPrompt(ctx);
    expect(result).not.toContain('Your superior');
  });

  it('shows subordinate skills only in decomposition scenarios', () => {
    const hierarchy = {
      parentRole: null,
      subordinates: [{ id: 'r-dev', name: 'Dev', skillDescriptions: ['coding'] }],
      peers: [],
    };
    const leafCtx = createCtx({
      orgHierarchy: hierarchy,
      wakeReason: 'task_assigned',
      task: { ...defaultTask, isDecomposable: false },
    });
    const decompCtx = createCtx({
      orgHierarchy: hierarchy,
      wakeReason: 'task_assigned',
      task: { ...defaultTask, isDecomposable: true },
    });
    expect(buildTaskPrompt(leafCtx)).not.toContain('coding');
    expect(buildTaskPrompt(decompCtx)).toContain('coding');
  });

  it('omits org context when orgHierarchy is undefined', () => {
    const ctx = createCtx({ orgHierarchy: undefined });
    const result = buildTaskPrompt(ctx);
    expect(result).not.toContain('# Organization Context');
  });
});

describe('buildTaskPrompt — organization instructions', () => {
  it('includes custom instructions when present', () => {
    const ctx = createCtx({
      organization: { name: 'TestOrg', customInstructions: 'Always write tests first.' },
    });
    const result = buildTaskPrompt(ctx);
    expect(result).toContain('# Organization Instructions');
    expect(result).toContain('Always write tests first.');
  });

  it('omits section when customInstructions is empty', () => {
    const ctx = createCtx({
      organization: { name: 'TestOrg', customInstructions: '' },
    });
    const result = buildTaskPrompt(ctx);
    expect(result).not.toContain('# Organization Instructions');
  });

  it('omits section when organization is undefined', () => {
    const ctx = createCtx({ organization: undefined });
    const result = buildTaskPrompt(ctx);
    expect(result).not.toContain('# Organization Instructions');
  });
});

describe('buildTaskPrompt — execution sequence', () => {
  it('renders sibling table with current task highlighted', () => {
    const ctx = createCtx({
      wakeReason: 'task_assigned',
      task: {
        ...defaultTask,
        parentChain: [{ id: 'p1', type: 'task', title: 'Backend API', status: 'in_progress' }],
        siblings: [
          { id: 's1', type: 'subtask', title: 'Setup scaffold', status: 'done', assigneeRoleName: 'Developer', isCurrent: false },
          { id: 'task-1', type: 'subtask', title: 'Implement auth', status: 'in_progress', assigneeRoleName: 'Developer', isCurrent: true },
          { id: 's3', type: 'subtask', title: 'Write tests', status: 'open', assigneeRoleName: 'QA', isCurrent: false },
        ],
      },
    });
    const result = buildTaskPrompt(ctx);
    expect(result).toContain('# Execution Sequence');
    expect(result).toContain('**2**');
    expect(result).toContain('**Implement auth**');
    expect(result).toContain('Setup scaffold');
    expect(result).toContain('Write tests');
  });

  it('omits execution sequence for root task (no parent)', () => {
    const ctx = createCtx({
      task: { ...defaultTask, parentChain: [], siblings: [] },
    });
    const result = buildTaskPrompt(ctx);
    expect(result).not.toContain('# Execution Sequence');
  });
});

describe('buildTaskPrompt — type schema', () => {
  it('renders type table in decomposition scenario', () => {
    const ctx = createCtx({
      wakeReason: 'task_assigned',
      task: { ...defaultTask, isDecomposable: true },
      typeSchema: {
        allTypes: [
          { name: 'epic', label: 'Epic', isLeaf: false, canDecompose: true, allowedChildren: ['story', 'task'], allowedAtRoot: true },
          { name: 'task', label: 'Task', isLeaf: true, canDecompose: false, allowedChildren: [], allowedAtRoot: true },
        ],
        currentTypeDef: { name: 'epic', label: 'Epic', isLeaf: false, canDecompose: true, allowedChildren: ['story', 'task'] },
      },
    });
    const result = buildTaskPrompt(ctx);
    expect(result).toContain('# Work Item Type Schema');
    expect(result).toContain('Epic');
    expect(result).toContain('story, task');
  });

  it('omits type schema in leaf execution scenario', () => {
    const ctx = createCtx({
      wakeReason: 'task_assigned',
      task: { ...defaultTask, isDecomposable: false },
      typeSchema: {
        allTypes: [{ name: 'task', label: 'Task', isLeaf: true, canDecompose: false, allowedChildren: [], allowedAtRoot: true }],
        currentTypeDef: null,
      },
    });
    const result = buildTaskPrompt(ctx);
    expect(result).not.toContain('# Work Item Type Schema');
  });
});

describe('buildTaskPrompt — workflow schema', () => {
  const workflowSchema: PromptContext['workflowSchema'] = {
    currentStatus: { name: 'in_progress', label: 'In Progress', category: 'active' },
    availableTransitions: [
      { targetStatus: 'awaiting_review', targetLabel: 'Awaiting Review' },
      { targetStatus: 'blocked', targetLabel: 'Blocked' },
      { targetStatus: 'cancelled', targetLabel: 'Cancelled' },
    ],
    allStatuses: [
      { name: 'pending', label: 'Pending', category: 'initial' },
      { name: 'in_progress', label: 'In Progress', category: 'active' },
      { name: 'awaiting_review', label: 'Awaiting Review', category: 'approval' },
      { name: 'approved', label: 'Approved', category: 'terminal' },
      { name: 'done', label: 'Done', category: 'terminal' },
    ],
    allTransitions: [
      { from: 'pending', to: 'in_progress' },
      { from: 'in_progress', to: 'awaiting_review' },
      { from: 'in_progress', to: 'blocked' },
      { from: 'awaiting_review', to: 'approved' },
      { from: 'approved', to: 'done' },
    ],
    terminalStatuses: ['approved', 'done'],
  };

  it('renders Workflow Status section with current status', () => {
    const ctx = createCtx({ workflowSchema });
    const result = buildTaskPrompt(ctx);
    expect(result).toContain('# Workflow Status');
    expect(result).toContain('**In Progress**');
    expect(result).toContain('`in_progress`');
    expect(result).toContain('category: active');
  });

  it('renders available transitions table', () => {
    const ctx = createCtx({ workflowSchema });
    const result = buildTaskPrompt(ctx);
    expect(result).toContain('Available transitions from current status');
    expect(result).toContain('`awaiting_review`');
    expect(result).toContain('`blocked`');
    expect(result).toContain('`cancelled`');
  });

  it('renders full status table', () => {
    const ctx = createCtx({ workflowSchema });
    const result = buildTaskPrompt(ctx);
    expect(result).toContain('All statuses');
    expect(result).toContain('`pending`');
    expect(result).toContain('`approved`');
    expect(result).toContain('`done`');
  });

  it('renders full transition table', () => {
    const ctx = createCtx({ workflowSchema });
    const result = buildTaskPrompt(ctx);
    expect(result).toContain('All transitions');
    expect(result).toContain('`pending`');
    expect(result).toContain('`in_progress`');
  });

  it('renders terminal statuses', () => {
    const ctx = createCtx({ workflowSchema });
    const result = buildTaskPrompt(ctx);
    expect(result).toContain('Terminal statuses');
    expect(result).toContain('`approved`');
    expect(result).toContain('`done`');
  });

  it('renders guidance note about capibara_task_transition', () => {
    const ctx = createCtx({ workflowSchema });
    const result = buildTaskPrompt(ctx);
    expect(result).toContain('capibara_task_transition');
    expect(result).toContain('available transitions');
  });

  it('shows no-transitions message for terminal status', () => {
    const ctx = createCtx({
      workflowSchema: {
        ...workflowSchema,
        currentStatus: { name: 'done', label: 'Done', category: 'terminal' },
        availableTransitions: [],
      },
    });
    const result = buildTaskPrompt(ctx);
    expect(result).toContain('No transitions available');
    expect(result).toContain('terminal state');
  });

  it('omits workflow section when workflowSchema is undefined', () => {
    const ctx = createCtx({ workflowSchema: undefined });
    const result = buildTaskPrompt(ctx);
    expect(result).not.toContain('# Workflow Status');
  });
});

describe('buildTaskPrompt — communication language', () => {
  it('renders Chinese instruction for zh-CN locale', () => {
    const ctx = createCtx({ locale: 'zh-CN' });
    const result = buildTaskPrompt(ctx);
    expect(result).toContain('Chinese');
    expect(result).toContain('中文');
  });

  it('omits language section for en-US locale', () => {
    const ctx = createCtx({ locale: 'en-US' });
    const result = buildTaskPrompt(ctx);
    expect(result).not.toContain('# Communication Language');
  });

  it('omits language section for default en locale', () => {
    const ctx = createCtx({ locale: 'en' });
    const result = buildTaskPrompt(ctx);
    expect(result).not.toContain('# Communication Language');
  });
});
