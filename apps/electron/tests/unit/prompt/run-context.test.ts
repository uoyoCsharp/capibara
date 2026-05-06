import { describe, it, expect, beforeEach } from 'vitest';
import { RunContext } from '@core/modules/prompt/context/run.context';
import { TEST_ORG_ID, TEST_ROLE_ID, TEST_TASK_ID } from '../../helpers/fixtures';
import type { ITaskRepository } from '@core/modules/workflow/interfaces/i-task.repository';
import type { IRoleRepository } from '@core/modules/organization/interfaces/i-role.repository';
import type { ISkillRepository } from '@core/modules/organization/interfaces/i-skill.repository';
import type { IConversationRepository } from '@core/modules/conversation/interfaces/i-conversation.repository';
import type { ConversationContextBuilder } from '@core/modules/conversation/context/conversation-context.builder';
import type { ProcessEngine } from '@core/modules/workflow/engines/process.engine';
import type { IOrganizationRepository } from '@core/modules/organization/interfaces/i-organization.repository';

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
  let processEngine: ProcessEngine;
  let orgRepo: IOrganizationRepository;

  beforeEach(() => {
    taskRepo = {
      findById: vi.fn().mockReturnValue(createTask()),
      findByOrgId: vi.fn().mockReturnValue([]),
      findChildren: vi.fn().mockReturnValue([]),
      hasChildren: vi.fn().mockReturnValue(false),
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
    processEngine = {
      getWorkItemType: vi.fn().mockReturnValue(null),
      getStatusCategory: vi.fn().mockReturnValue(null),
      getSchema: vi.fn().mockReturnValue(null),
    } as unknown as ProcessEngine;
    orgRepo = {
      findAll: vi.fn().mockReturnValue([]),
      findById: vi.fn().mockReturnValue(null),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    };

    runContext = new RunContext(taskRepo, roleRepo, skillRepo, convRepo, convContextBuilder, processEngine, orgRepo);
  });

  describe('buildForTask', () => {
    it('returns null when task not found', () => {
      vi.mocked(taskRepo.findById).mockReturnValue(null);
      expect(runContext.buildForTask('nonexistent', TEST_ROLE_ID, 'en', 'task_assigned')).toBeNull();
    });

    it('returns null when role not found', () => {
      vi.mocked(roleRepo.findById).mockReturnValue(null);
      expect(runContext.buildForTask(TEST_TASK_ID, 'nonexistent', 'en', 'task_assigned')).toBeNull();
    });

    it('builds context with basic task and role info', () => {
      const ctx = runContext.buildForTask(TEST_TASK_ID, TEST_ROLE_ID, 'en', 'task_assigned');
      expect(ctx).not.toBeNull();
      expect(ctx!.task.id).toBe(TEST_TASK_ID);
      expect(ctx!.task.title).toBe('Implement feature');
      expect(ctx!.task.status).toBe('in_progress');
      expect(ctx!.task.orgId).toBe(TEST_ORG_ID);
      expect(ctx!.role.id).toBe(TEST_ROLE_ID);
      expect(ctx!.role.name).toBe('Developer');
      expect(ctx!.role.persona).toBe('A senior developer');
      expect(ctx!.locale).toBe('en');
      expect(ctx!.wakeReason).toBe('task_assigned');
    });

    it('populates isDecomposable from ProcessEngine', () => {
      vi.mocked(processEngine.getWorkItemType).mockReturnValue({
        name: 'epic', label: 'Epic', isLeaf: false, allowedChildren: ['task'], allowedAtRoot: true, canDecompose: true,
      });
      const ctx = runContext.buildForTask(TEST_TASK_ID, TEST_ROLE_ID, 'en', 'task_assigned');
      expect(ctx!.task.isDecomposable).toBe(true);
      expect(ctx!.task.allowedChildTypes).toEqual(['task']);
    });

    it('defaults isDecomposable to false when no type def', () => {
      vi.mocked(processEngine.getWorkItemType).mockReturnValue(null);
      const ctx = runContext.buildForTask(TEST_TASK_ID, TEST_ROLE_ID, 'en', 'task_assigned');
      expect(ctx!.task.isDecomposable).toBe(false);
      expect(ctx!.task.allowedChildTypes).toEqual([]);
    });

    it('populates isTerminal from ProcessEngine', () => {
      vi.mocked(processEngine.getStatusCategory).mockReturnValue('terminal');
      const ctx = runContext.buildForTask(TEST_TASK_ID, TEST_ROLE_ID, 'en', 'task_assigned');
      expect(ctx!.task.isTerminal).toBe(true);
    });

    it('sets isTerminal false for non-terminal status', () => {
      vi.mocked(processEngine.getStatusCategory).mockReturnValue('active');
      const ctx = runContext.buildForTask(TEST_TASK_ID, TEST_ROLE_ID, 'en', 'task_assigned');
      expect(ctx!.task.isTerminal).toBe(false);
    });

    it('populates hasChildren when children exist', () => {
      vi.mocked(taskRepo.findChildren).mockReturnValue([createTask({ id: 'child-1' })]);
      const ctx = runContext.buildForTask(TEST_TASK_ID, TEST_ROLE_ID, 'en', 'task_assigned');
      expect(ctx!.task.hasChildren).toBe(true);
    });

    it('sets hasChildren false when no children', () => {
      vi.mocked(taskRepo.findChildren).mockReturnValue([]);
      const ctx = runContext.buildForTask(TEST_TASK_ID, TEST_ROLE_ID, 'en', 'task_assigned');
      expect(ctx!.task.hasChildren).toBe(false);
    });

    it('resolves skills from role skillIds', () => {
      vi.mocked(roleRepo.findById).mockReturnValue(createRole({ skillIds: ['skill-1', 'skill-2'] }));
      vi.mocked(skillRepo.findById).mockImplementation((id) => {
        if (id === 'skill-1') return createSkill();
        if (id === 'skill-2') return createSkill({ id: 'skill-2', name: 'Deploy', command: '/deploy', description: 'Deploy app' });
        return null;
      });

      const ctx = runContext.buildForTask(TEST_TASK_ID, TEST_ROLE_ID, 'en', 'task_assigned');
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

      const ctx = runContext.buildForTask(TEST_TASK_ID, TEST_ROLE_ID, 'en', 'task_assigned');
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

      const ctx = runContext.buildForTask('child', TEST_ROLE_ID, 'en', 'task_assigned');
      expect(ctx!.task.parentChain).toHaveLength(2);
      expect(ctx!.task.parentChain[0].title).toBe('Parent Task');
      expect(ctx!.task.parentChain[1].title).toBe('GP Task');
    });

    it('includes siblings with assigneeRoleName and isCurrent when task has a parentId', () => {
      const task = createTask({ parentId: 'parent-1' });
      vi.mocked(taskRepo.findById).mockImplementation((id) => {
        if (id === TEST_TASK_ID) return task;
        if (id === 'parent-1') return createTask({ id: 'parent-1', parentId: null });
        if (id === TEST_ROLE_ID) return createRole();
        return null;
      });
      vi.mocked(roleRepo.findById).mockImplementation((id) => {
        if (id === TEST_ROLE_ID) return createRole();
        if (id === 'role-qa') return createRole({ id: 'role-qa', name: 'QA Engineer' });
        return null;
      });
      vi.mocked(taskRepo.findChildren).mockReturnValue([
        createTask({ id: TEST_TASK_ID, title: 'Me', assigneeRoleId: TEST_ROLE_ID }),
        createTask({ id: 'sibling-1', title: 'Sibling A', type: 'task', status: 'todo', assigneeRoleId: TEST_ROLE_ID }),
        createTask({ id: 'sibling-2', title: 'Sibling B', type: 'task', status: 'done', assigneeRoleId: 'role-qa' }),
      ]);

      const ctx = runContext.buildForTask(TEST_TASK_ID, TEST_ROLE_ID, 'en', 'task_assigned');
      expect(ctx!.task.siblings).toHaveLength(3);
      expect(ctx!.task.siblings[0].isCurrent).toBe(true);
      expect(ctx!.task.siblings[0].assigneeRoleName).toBe('Developer');
      expect(ctx!.task.siblings[1].isCurrent).toBe(false);
      expect(ctx!.task.siblings[1].title).toBe('Sibling A');
      expect(ctx!.task.siblings[2].assigneeRoleName).toBe('QA Engineer');
    });

    it('returns empty siblings when task has no parentId', () => {
      const ctx = runContext.buildForTask(TEST_TASK_ID, TEST_ROLE_ID, 'en', 'task_assigned');
      expect(ctx!.task.siblings).toEqual([]);
    });

    it('populates typeSchema from ProcessEngine', () => {
      const mockSchema = {
        workItemTypes: [
          { name: 'epic', label: 'Epic', isLeaf: false, canDecompose: true, allowedChildren: ['task'], allowedAtRoot: true },
          { name: 'task', label: 'Task', isLeaf: true, canDecompose: false, allowedChildren: [], allowedAtRoot: true },
        ],
        statuses: [], transitions: [], behaviorRules: [],
      };
      vi.mocked(processEngine.getSchema as any).mockReturnValue(mockSchema);
      vi.mocked(processEngine.getWorkItemType).mockReturnValue(mockSchema.workItemTypes[0]);

      const ctx = runContext.buildForTask(TEST_TASK_ID, TEST_ROLE_ID, 'en', 'task_assigned');
      expect(ctx!.typeSchema).toBeDefined();
      expect(ctx!.typeSchema!.allTypes).toHaveLength(2);
      expect(ctx!.typeSchema!.currentTypeDef!.name).toBe('epic');
    });

    it('sets typeSchema undefined when no schema', () => {
      vi.mocked(processEngine.getSchema as any).mockReturnValue(null);
      const ctx = runContext.buildForTask(TEST_TASK_ID, TEST_ROLE_ID, 'en', 'task_assigned');
      expect(ctx!.typeSchema).toBeUndefined();
    });

    it('populates organization when org found', () => {
      vi.mocked(orgRepo.findById).mockReturnValue({
        id: TEST_ORG_ID, name: 'TestOrg', description: '', customInstructions: 'Always TDD',
        status: 'active', budgetLimit: 100, orgTemplateId: null, planningRoleId: null,
        workspacePath: '/tmp', createdAt: '', updatedAt: '',
      });
      const ctx = runContext.buildForTask(TEST_TASK_ID, TEST_ROLE_ID, 'en', 'task_assigned');
      expect(ctx!.organization).toEqual({ name: 'TestOrg', customInstructions: 'Always TDD' });
    });

    it('sets organization undefined when org not found', () => {
      vi.mocked(orgRepo.findById).mockReturnValue(null);
      const ctx = runContext.buildForTask(TEST_TASK_ID, TEST_ROLE_ID, 'en', 'task_assigned');
      expect(ctx!.organization).toBeUndefined();
    });

    it('builds orgHierarchy with parent, subordinates, and peers', () => {
      const leadRole = createRole({ id: 'role-lead', name: 'Tech Lead', parentId: null, skillIds: [] });
      const devRole = createRole({ id: TEST_ROLE_ID, name: 'Developer', parentId: 'role-lead', skillIds: [] });
      const qaRole = createRole({ id: 'role-qa', name: 'QA', parentId: 'role-lead', skillIds: [] });
      const juniorRole = createRole({ id: 'role-junior', name: 'Junior Dev', parentId: TEST_ROLE_ID, skillIds: ['skill-1'] });

      vi.mocked(roleRepo.findById).mockImplementation((id) => {
        if (id === TEST_ROLE_ID) return devRole;
        if (id === 'role-lead') return leadRole;
        return null;
      });
      vi.mocked(roleRepo.findChildren).mockImplementation((parentId) => {
        if (parentId === TEST_ROLE_ID) return [juniorRole];
        if (parentId === 'role-lead') return [devRole, qaRole];
        return [];
      });
      vi.mocked(skillRepo.findById).mockImplementation((id) => {
        if (id === 'skill-1') return createSkill({ description: 'code implementation' });
        return null;
      });

      const ctx = runContext.buildForTask(TEST_TASK_ID, TEST_ROLE_ID, 'en', 'task_assigned');
      expect(ctx!.orgHierarchy!.parentRole).toEqual({ id: 'role-lead', name: 'Tech Lead' });
      expect(ctx!.orgHierarchy!.subordinates).toEqual([
        { id: 'role-junior', name: 'Junior Dev', skillDescriptions: ['code implementation'] },
      ]);
      expect(ctx!.orgHierarchy!.peers).toEqual([{ id: 'role-qa', name: 'QA' }]);
    });

    it('handles top-level role with no parent', () => {
      vi.mocked(roleRepo.findById).mockReturnValue(createRole({ parentId: null }));
      vi.mocked(roleRepo.findChildren).mockReturnValue([]);
      const ctx = runContext.buildForTask(TEST_TASK_ID, TEST_ROLE_ID, 'en', 'task_assigned');
      expect(ctx!.orgHierarchy!.parentRole).toBeNull();
      expect(ctx!.orgHierarchy!.peers).toEqual([]);
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

    it('includes task data with isDecomposable when conversation has taskId', () => {
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
      vi.mocked(processEngine.getWorkItemType).mockReturnValue({
        name: 'epic', label: 'Epic', isLeaf: false, allowedChildren: ['task'], allowedAtRoot: true, canDecompose: true,
      });

      const ctx = runContext.buildForConversation('conv-1', TEST_ROLE_ID, 'en');
      expect(ctx!.task).not.toBeNull();
      expect(ctx!.task!.id).toBe(TEST_TASK_ID);
      expect(ctx!.task!.isDecomposable).toBe(true);
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

  // ═══════════════════════════════════════════════════════════════
  // buildForConversation — planning-specific enrichment branch
  // ═══════════════════════════════════════════════════════════════

  describe('buildForConversation (planning conversation enrichment)', () => {
    // Helper: mock a planning conversation in convRepo + convContextBuilder
    function mockPlanningConversation(orgId: string = TEST_ORG_ID) {
      const conv = {
        id: 'conv-plan-1',
        orgId,
        type: 'planning',
        state: 'waiting',
        initiatorRoleId: TEST_ROLE_ID,
        respondentRoleId: TEST_ROLE_ID,
        respondentType: 'ai',
        taskId: null,
        parentConversationId: null,
        depth: 0,
        externalSessionId: null,
        metadata: {},
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      };
      vi.mocked(convRepo.findById).mockReturnValue(conv);
      vi.mocked(convContextBuilder.build).mockReturnValue({
        conversationId: 'conv-plan-1',
        type: 'planning',
        state: 'waiting',
        initiatorRoleId: TEST_ROLE_ID,
        respondentRoleId: TEST_ROLE_ID,
        taskId: null,
        messageHistory: [],
        depth: 0,
        externalSessionId: null,
      });
      return conv;
    }

    it('PR-01: propagates orgId onto context.conversation.orgId', () => {
      mockPlanningConversation('org-custom');
      const ctx = runContext.buildForConversation('conv-plan-1', TEST_ROLE_ID, 'en');
      expect(ctx!.conversation.orgId).toBe('org-custom');
    });

    it('PR-02: populates typeSchema from ProcessEngine schema', () => {
      mockPlanningConversation();
      vi.mocked(processEngine.getSchema).mockReturnValue({
        workItemTypes: [
          { name: 'epic', label: 'Epic', isLeaf: false, canDecompose: true, allowedChildren: ['story'], allowedAtRoot: true },
          { name: 'task', label: 'Task', isLeaf: true, canDecompose: false, allowedChildren: [], allowedAtRoot: false },
        ],
        statuses: [],
        transitions: [],
        behaviorRules: [],
      });

      const ctx = runContext.buildForConversation('conv-plan-1', TEST_ROLE_ID, 'en');
      expect(ctx!.typeSchema).toBeDefined();
      expect(ctx!.typeSchema!.allTypes).toHaveLength(2);
      expect(ctx!.typeSchema!.allTypes[0]).toMatchObject({
        name: 'epic',
        allowedAtRoot: true,
        isLeaf: false,
      });
    });

    it('PR-03: leaves typeSchema undefined when ProcessEngine returns null', () => {
      mockPlanningConversation();
      vi.mocked(processEngine.getSchema).mockReturnValue(null);
      const ctx = runContext.buildForConversation('conv-plan-1', TEST_ROLE_ID, 'en');
      expect(ctx!.typeSchema).toBeUndefined();
    });

    it('PR-04: populates orgRoles from roleRepo.findByOrgId, excluding system roles', () => {
      mockPlanningConversation();
      vi.mocked(roleRepo.findByOrgId).mockReturnValue([
        createRole({ id: 'role-pm', name: 'PM', isSystemRole: false, skillIds: [] }),
        createRole({ id: 'role-system', name: 'System', isSystemRole: true, skillIds: [] }),
        createRole({ id: 'role-dev', name: 'Dev', isSystemRole: false, skillIds: [] }),
      ]);

      const ctx = runContext.buildForConversation('conv-plan-1', TEST_ROLE_ID, 'en');
      expect(ctx!.orgRoles).toBeDefined();
      expect(ctx!.orgRoles).toHaveLength(2);
      expect(ctx!.orgRoles!.map((r) => r.id)).toEqual(['role-pm', 'role-dev']);
    });

    it('PR-05: orgRoles contains skill descriptions when role has skills', () => {
      mockPlanningConversation();
      vi.mocked(roleRepo.findByOrgId).mockReturnValue([
        createRole({ id: 'role-pm', name: 'PM', isSystemRole: false, skillIds: ['skill-1'] }),
      ]);
      vi.mocked(skillRepo.findById).mockImplementation((id: string) =>
        id === 'skill-1' ? createSkill({ id: 'skill-1', description: 'Requirements gathering' }) : null,
      );

      const ctx = runContext.buildForConversation('conv-plan-1', TEST_ROLE_ID, 'en');
      expect(ctx!.orgRoles![0].skillDescriptions).toEqual(['Requirements gathering']);
    });

    it('PR-06: skips skill ids that resolve to null', () => {
      mockPlanningConversation();
      vi.mocked(roleRepo.findByOrgId).mockReturnValue([
        createRole({ id: 'role-pm', skillIds: ['skill-ghost', 'skill-real'], isSystemRole: false }),
      ]);
      vi.mocked(skillRepo.findById).mockImplementation((id: string) =>
        id === 'skill-real' ? createSkill({ id: 'skill-real', description: 'Real skill' }) : null,
      );

      const ctx = runContext.buildForConversation('conv-plan-1', TEST_ROLE_ID, 'en');
      expect(ctx!.orgRoles![0].skillDescriptions).toEqual(['Real skill']);
    });

    it('PR-07: calls consumePendingFeedbackByConversation on feedback provider', () => {
      mockPlanningConversation();
      const consumeFn = vi.fn().mockReturnValue('use better roles');
      runContext.setFeedbackProvider({
        consumePendingFeedback: vi.fn(),
        consumePendingFeedbackByConversation: consumeFn,
      });

      const ctx = runContext.buildForConversation('conv-plan-1', TEST_ROLE_ID, 'en');
      expect(consumeFn).toHaveBeenCalledWith('conv-plan-1');
      expect(ctx!.pendingFeedback).toBe('use better roles');
    });

    it('PR-08: handles feedback provider without conv-specific consumer (back-compat)', () => {
      mockPlanningConversation();
      runContext.setFeedbackProvider({
        consumePendingFeedback: vi.fn(),
        // No consumePendingFeedbackByConversation — guarded in strategy
      });

      const ctx = runContext.buildForConversation('conv-plan-1', TEST_ROLE_ID, 'en');
      expect(ctx!.pendingFeedback).toBeUndefined();
    });

    it('PR-09: returns null feedback when provider returns null', () => {
      mockPlanningConversation();
      runContext.setFeedbackProvider({
        consumePendingFeedback: vi.fn(),
        consumePendingFeedbackByConversation: vi.fn().mockReturnValue(null),
      });

      const ctx = runContext.buildForConversation('conv-plan-1', TEST_ROLE_ID, 'en');
      expect(ctx!.pendingFeedback).toBeNull();
    });

    it('PR-10: does NOT enrich when conversation type is not planning', () => {
      // Mock an inquiry conversation instead
      vi.mocked(convRepo.findById).mockReturnValue({
        id: 'conv-inquiry',
        orgId: TEST_ORG_ID,
        type: 'inquiry',
        state: 'waiting',
        initiatorRoleId: TEST_ROLE_ID,
        respondentRoleId: TEST_ROLE_ID,
        respondentType: 'ai',
        taskId: null,
        parentConversationId: null,
        depth: 0,
        externalSessionId: null,
        metadata: {},
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      });
      vi.mocked(convContextBuilder.build).mockReturnValue({
        conversationId: 'conv-inquiry',
        type: 'inquiry',
        state: 'waiting',
        initiatorRoleId: TEST_ROLE_ID,
        respondentRoleId: TEST_ROLE_ID,
        taskId: null,
        messageHistory: [],
        depth: 0,
        externalSessionId: null,
      });
      vi.mocked(processEngine.getSchema).mockReturnValue({
        workItemTypes: [],
        statuses: [],
        transitions: [],
        behaviorRules: [],
      });
      vi.mocked(roleRepo.findByOrgId).mockReturnValue([
        createRole({ id: 'role-pm', isSystemRole: false }),
      ]);

      const ctx = runContext.buildForConversation('conv-inquiry', TEST_ROLE_ID, 'en');
      expect(ctx!.typeSchema).toBeUndefined();
      expect(ctx!.orgRoles).toBeUndefined();
      expect(ctx!.pendingFeedback).toBeUndefined();
    });

    it('PR-11: does NOT enrich when conversation type is adhoc', () => {
      vi.mocked(convContextBuilder.build).mockReturnValue({
        conversationId: 'conv-adhoc',
        type: 'adhoc',
        state: 'active',
        initiatorRoleId: TEST_ROLE_ID,
        respondentRoleId: TEST_ROLE_ID,
        taskId: null,
        messageHistory: [],
        depth: 0,
        externalSessionId: null,
      });
      vi.mocked(convRepo.findById).mockReturnValue({
        id: 'conv-adhoc', orgId: TEST_ORG_ID, type: 'adhoc',
      } as never);

      const ctx = runContext.buildForConversation('conv-adhoc', TEST_ROLE_ID, 'en');
      expect(ctx!.typeSchema).toBeUndefined();
      expect(ctx!.orgRoles).toBeUndefined();
    });

    it('PR-12: does not crash when convRepo.findById returns null (orgId resolves to empty)', () => {
      vi.mocked(convContextBuilder.build).mockReturnValue({
        conversationId: 'conv-plan-1',
        type: 'planning',
        state: 'waiting',
        initiatorRoleId: TEST_ROLE_ID,
        respondentRoleId: TEST_ROLE_ID,
        taskId: null,
        messageHistory: [],
        depth: 0,
        externalSessionId: null,
      });
      vi.mocked(convRepo.findById).mockReturnValue(null);
      // When orgId is empty string, the planning branch should skip enrichment
      const ctx = runContext.buildForConversation('conv-plan-1', TEST_ROLE_ID, 'en');
      expect(ctx).not.toBeNull();
      expect(ctx!.typeSchema).toBeUndefined();
      expect(ctx!.orgRoles).toBeUndefined();
    });
  });
});
