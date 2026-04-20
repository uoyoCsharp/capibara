import { describe, it, expect, beforeEach } from 'vitest';
import { RunContext } from '@core/modules/prompt/context/run.context';
import { TEST_ORG_ID, TEST_ROLE_ID, TEST_TASK_ID } from '../../helpers/fixtures';
import type { ITaskRepository } from '@core/modules/workflow/interfaces/i-task.repository';
import type { IRoleRepository } from '@core/modules/organization/interfaces/i-role.repository';
import type { ISkillRepository } from '@core/modules/organization/interfaces/i-skill.repository';
import type { IConversationRepository } from '@core/modules/conversation/interfaces/i-conversation.repository';
import type { ConversationContextBuilder } from '@core/modules/conversation/context/conversation-context.builder';

function createTask(overrides?: Record<string, unknown>) {
  return {
    id: TEST_TASK_ID,
    orgId: TEST_ORG_ID,
    parentId: null,
    type: 'task',
    title: 'Implement feature',
    description: 'Build the feature',
    status: 'in_progress',
    assigneeRoleId: TEST_ROLE_ID,
    priority: 0,
    metadata: {},
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function createRole(overrides?: Record<string, unknown>) {
  return {
    id: TEST_ROLE_ID,
    orgId: TEST_ORG_ID,
    name: 'Developer',
    parentId: null,
    persona: 'A senior developer',
    knowledgeBaseRefs: [],
    skillIds: [],
    canApprove: false,
    canDelegate: false,
    requiresHumanApproval: false,
    consecutiveWakeCount: 0,
    isSystemRole: false,
    status: 'active',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function createSkill(overrides?: Record<string, unknown>) {
  return {
    id: 'skill-1',
    name: 'Code Review',
    command: '/code-review',
    description: 'Review code changes',
    category: 'development',
    source: 'custom',
    orgTemplateId: null,
    customPromptContent: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('RunContext', () => {
  let runContext: RunContext;
  let taskRepo: ITaskRepository;
  let roleRepo: IRoleRepository;
  let skillRepo: ISkillRepository;
  let convRepo: IConversationRepository;
  let convContextBuilder: ConversationContextBuilder;

  beforeEach(() => {
    taskRepo = {
      findById: vi.fn().mockReturnValue(createTask()),
      findByOrgId: vi.fn().mockReturnValue([]),
      findChildren: vi.fn().mockReturnValue([]),
      findByAssigneeRoleId: vi.fn().mockReturnValue([]),
      findByStatus: vi.fn().mockReturnValue([]),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    };
    roleRepo = {
      findById: vi.fn().mockReturnValue(createRole()),
      findByIds: vi.fn().mockReturnValue([]),
      findByOrgId: vi.fn().mockReturnValue([]),
      findChildren: vi.fn().mockReturnValue([]),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    };
    skillRepo = {
      findById: vi.fn().mockReturnValue(null),
      findByIds: vi.fn().mockReturnValue([]),
      findAll: vi.fn().mockReturnValue([]),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    };
    convRepo = {
      findById: vi.fn(),
      findByOrgId: vi.fn(),
      findByTaskId: vi.fn(),
      findActiveByOrgId: vi.fn(),
      findByState: vi.fn(),
      findTimedOutInquiries: vi.fn(),
      create: vi.fn(),
      updateState: vi.fn(),
      updateRespondent: vi.fn(),
      updateExternalSessionId: vi.fn(),
      delete: vi.fn(),
    };
    convContextBuilder = {
      build: vi.fn().mockReturnValue(null),
    } as unknown as ConversationContextBuilder;

    runContext = new RunContext(taskRepo, roleRepo, skillRepo, convRepo, convContextBuilder);
  });

  describe('buildForTask', () => {
    it('returns null when task not found', () => {
      vi.mocked(taskRepo.findById).mockReturnValue(null);
      expect(runContext.buildForTask('nonexistent', TEST_ROLE_ID, 'en')).toBeNull();
    });

    it('returns null when role not found', () => {
      vi.mocked(roleRepo.findById).mockReturnValue(null);
      expect(runContext.buildForTask(TEST_TASK_ID, 'nonexistent', 'en')).toBeNull();
    });

    it('builds context with basic task and role info', () => {
      const ctx = runContext.buildForTask(TEST_TASK_ID, TEST_ROLE_ID, 'en');
      expect(ctx).not.toBeNull();
      expect(ctx!.task.id).toBe(TEST_TASK_ID);
      expect(ctx!.task.title).toBe('Implement feature');
      expect(ctx!.task.status).toBe('in_progress');
      expect(ctx!.role.id).toBe(TEST_ROLE_ID);
      expect(ctx!.role.name).toBe('Developer');
      expect(ctx!.role.persona).toBe('A senior developer');
      expect(ctx!.locale).toBe('en');
    });

    it('resolves skills from role skillIds', () => {
      vi.mocked(roleRepo.findById).mockReturnValue(createRole({ skillIds: ['skill-1', 'skill-2'] }));
      vi.mocked(skillRepo.findById).mockImplementation((id) => {
        if (id === 'skill-1') return createSkill();
        if (id === 'skill-2') return createSkill({ id: 'skill-2', name: 'Deploy', command: '/deploy', description: 'Deploy app' });
        return null;
      });

      const ctx = runContext.buildForTask(TEST_TASK_ID, TEST_ROLE_ID, 'en');
      expect(ctx!.skills).toHaveLength(2);
      expect(ctx!.skills[0]).toEqual({ name: 'Code Review', command: '/code-review', description: 'Review code changes' });
      expect(ctx!.skills[1]).toEqual({ name: 'Deploy', command: '/deploy', description: 'Deploy app' });
    });

    it('filters out null skills', () => {
      vi.mocked(roleRepo.findById).mockReturnValue(createRole({ skillIds: ['skill-1', 'missing'] }));
      vi.mocked(skillRepo.findById).mockImplementation((id) => {
        if (id === 'skill-1') return createSkill();
        return null;
      });

      const ctx = runContext.buildForTask(TEST_TASK_ID, TEST_ROLE_ID, 'en');
      expect(ctx!.skills).toHaveLength(1);
    });

    it('builds parent chain walking up parentId references', () => {
      const childTask = createTask({ id: 'child', parentId: 'parent' });
      const parentTask = createTask({ id: 'parent', parentId: 'grandparent', title: 'Parent Task', type: 'epic' });
      const grandparentTask = createTask({ id: 'grandparent', parentId: null, title: 'GP Task', type: 'project' });

      vi.mocked(taskRepo.findById).mockImplementation((id) => {
        if (id === 'child') return childTask;
        if (id === 'parent') return parentTask;
        if (id === 'grandparent') return grandparentTask;
        return null;
      });

      const ctx = runContext.buildForTask('child', TEST_ROLE_ID, 'en');
      expect(ctx!.task.parentChain).toHaveLength(2);
      expect(ctx!.task.parentChain[0].title).toBe('Parent Task');
      expect(ctx!.task.parentChain[1].title).toBe('GP Task');
    });

    it('includes siblings when task has a parentId', () => {
      const task = createTask({ parentId: 'parent-1' });
      vi.mocked(taskRepo.findById).mockImplementation((id) => {
        if (id === TEST_TASK_ID) return task;
        if (id === 'parent-1') return createTask({ id: 'parent-1', parentId: null });
        return null;
      });
      vi.mocked(taskRepo.findChildren).mockReturnValue([
        createTask({ id: TEST_TASK_ID, title: 'Me' }),
        createTask({ id: 'sibling-1', title: 'Sibling A', type: 'task', status: 'todo' }),
        createTask({ id: 'sibling-2', title: 'Sibling B', type: 'task', status: 'done' }),
      ]);

      const ctx = runContext.buildForTask(TEST_TASK_ID, TEST_ROLE_ID, 'en');
      expect(ctx!.task.siblings).toHaveLength(2);
      expect(ctx!.task.siblings[0].title).toBe('Sibling A');
      expect(ctx!.task.siblings[1].title).toBe('Sibling B');
    });

    it('returns empty siblings when task has no parentId', () => {
      const ctx = runContext.buildForTask(TEST_TASK_ID, TEST_ROLE_ID, 'en');
      expect(ctx!.task.siblings).toEqual([]);
    });
  });

  describe('buildForConversation', () => {
    it('returns null when conversation context not found', () => {
      vi.mocked(convContextBuilder.build).mockReturnValue(null);
      expect(runContext.buildForConversation('conv-1', TEST_ROLE_ID, 'en')).toBeNull();
    });

    it('returns null when role not found', () => {
      vi.mocked(convContextBuilder.build).mockReturnValue({
        conversationId: 'conv-1',
        type: 'inquiry',
        state: 'waiting',
        initiatorRoleId: 'role-init',
        respondentRoleId: TEST_ROLE_ID,
        taskId: null,
        messageHistory: [],
        depth: 0,
        externalSessionId: null,
      });
      vi.mocked(roleRepo.findById).mockReturnValue(null);
      expect(runContext.buildForConversation('conv-1', 'nonexistent', 'en')).toBeNull();
    });

    it('builds conversation context with message history', () => {
      vi.mocked(convContextBuilder.build).mockReturnValue({
        conversationId: 'conv-1',
        type: 'inquiry',
        state: 'waiting',
        initiatorRoleId: 'role-init',
        respondentRoleId: TEST_ROLE_ID,
        taskId: null,
        messageHistory: [
          { authorRoleId: 'role-init', authorType: 'ai', content: 'What is X?', intent: 'question', createdAt: '2026-01-01T00:00:00.000Z' },
        ],
        depth: 1,
        externalSessionId: 'sess-1',
      });

      const ctx = runContext.buildForConversation('conv-1', TEST_ROLE_ID, 'en');
      expect(ctx).not.toBeNull();
      expect(ctx!.conversation.id).toBe('conv-1');
      expect(ctx!.conversation.type).toBe('inquiry');
      expect(ctx!.conversation.state).toBe('waiting');
      expect(ctx!.conversation.messageHistory).toHaveLength(1);
      expect(ctx!.role.name).toBe('Developer');
      expect(ctx!.locale).toBe('en');
    });

    it('includes task data when conversation has taskId', () => {
      vi.mocked(convContextBuilder.build).mockReturnValue({
        conversationId: 'conv-1',
        type: 'inquiry',
        state: 'waiting',
        initiatorRoleId: 'role-init',
        respondentRoleId: TEST_ROLE_ID,
        taskId: TEST_TASK_ID,
        messageHistory: [],
        depth: 0,
        externalSessionId: null,
      });

      const ctx = runContext.buildForConversation('conv-1', TEST_ROLE_ID, 'en');
      expect(ctx!.task).not.toBeNull();
      expect(ctx!.task!.id).toBe(TEST_TASK_ID);
      expect(ctx!.task!.title).toBe('Implement feature');
    });

    it('sets task to null when conversation has no taskId', () => {
      vi.mocked(convContextBuilder.build).mockReturnValue({
        conversationId: 'conv-1',
        type: 'adhoc',
        state: 'active',
        initiatorRoleId: 'role-init',
        respondentRoleId: TEST_ROLE_ID,
        taskId: null,
        messageHistory: [],
        depth: 0,
        externalSessionId: null,
      });

      const ctx = runContext.buildForConversation('conv-1', TEST_ROLE_ID, 'en');
      expect(ctx!.task).toBeNull();
    });

    it('sets task to null when taskId exists but task not found', () => {
      vi.mocked(convContextBuilder.build).mockReturnValue({
        conversationId: 'conv-1',
        type: 'inquiry',
        state: 'waiting',
        initiatorRoleId: 'role-init',
        respondentRoleId: TEST_ROLE_ID,
        taskId: 'missing-task',
        messageHistory: [],
        depth: 0,
        externalSessionId: null,
      });
      vi.mocked(taskRepo.findById).mockImplementation((id) => {
        if (id === 'missing-task') return null;
        return createTask();
      });

      const ctx = runContext.buildForConversation('conv-1', TEST_ROLE_ID, 'en');
      expect(ctx!.task).toBeNull();
    });
  });
});
