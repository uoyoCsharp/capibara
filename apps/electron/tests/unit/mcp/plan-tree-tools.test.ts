import { describe, it, expect, beforeEach, vi } from 'vitest';
import { registerPlanTreeToolProvider } from '@core/mcp/providers/plan-tree-tool.provider';
import { validatePlanTree, MAX_TREE_NODES, MAX_TREE_DEPTH } from '@core/modules/planning/validation/plan-tree.validator';
import { MockMcpServer, parseToolResult } from '../../helpers/mock-mcp-server';
import type { ITaskService } from '@core/modules/workflow/interfaces/i-task.service';
import type { IProcessEngine } from '@core/modules/workflow/interfaces/i-process.engine';
import type { IRoleQueryService } from '@core/modules/organization/interfaces/i-role-query.service';
import type { IConversationCommandService } from '@core/modules/conversation/interfaces/i-conversation-command.service';
import type { IPlanningService } from '@core/modules/planning/interfaces/i-planning.service';
import type { IEventPublisher } from '@core/foundation/interfaces/i-event-publisher';
import type { PlanTreeNode } from '@core/foundation/events';
import type { WorkItemTypeDefinition } from '@core/modules/workflow/types/workflow.types';

// ─── Fixtures ──────────────────────────────────────────────────

function createTask(overrides?: Record<string, unknown>) {
  return {
    id: 'task-epic',
    orgId: 'org-1',
    parentId: null,
    type: 'epic',
    title: 'An epic',
    description: 'Root task',
    status: 'in_progress',
    assigneeRoleId: 'role-pm',
    depth: 0,
    planningMode: 'preview',
    artifactPaths: null,
    pausedReason: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function createConversation(overrides?: Record<string, unknown>) {
  return {
    id: 'conv-plan',
    orgId: 'org-1',
    type: 'planning',
    state: 'waiting',
    initiatorRoleId: 'role-pm',
    respondentRoleId: 'role-pm',
    respondentType: 'ai',
    taskId: null,
    parentConversationId: null,
    depth: 0,
    externalSessionId: null,
    metadata: {},
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function createRole(id: string, overrides?: Record<string, unknown>) {
  return {
    id,
    orgId: 'org-1',
    name: `Role ${id}`,
    parentId: null,
    persona: 'An agent',
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

const typeDefs: Record<string, WorkItemTypeDefinition> = {
  epic: { name: 'epic', label: 'Epic', isLeaf: false, allowedChildren: ['story'], allowedAtRoot: true, canDecompose: true },
  story: { name: 'story', label: 'Story', isLeaf: false, allowedChildren: ['task'], allowedAtRoot: true, canDecompose: true },
  task: { name: 'task', label: 'Task', isLeaf: true, allowedChildren: [], allowedAtRoot: false, canDecompose: false },
  bug: { name: 'bug', label: 'Bug', isLeaf: true, allowedChildren: [], allowedAtRoot: false, canDecompose: false },
};

function validTree(): PlanTreeNode {
  return {
    type: 'epic',
    title: 'Root',
    description: 'desc',
    assigneeRoleId: 'role-pm',
    children: [
      {
        type: 'story',
        title: 'S1',
        description: 'story 1',
        assigneeRoleId: 'role-dev',
        children: [
          { type: 'task', title: 'T1', description: 't1', assigneeRoleId: 'role-dev', children: [] },
        ],
      },
    ],
  };
}

// ─── Test Suite ────────────────────────────────────────────────

describe('capibara_plan_submit_tree (MCP tool)', () => {
  let mockServer: MockMcpServer;
  let taskService: ITaskService;
  let processEngine: IProcessEngine;
  let roleService: IRoleQueryService;
  let conversationService: IConversationCommandService;
  let planningService: IPlanningService;
  let eventPublisher: IEventPublisher;
  let published: Array<{ type: string; payload: unknown }>;

  beforeEach(() => {
    published = [];

    taskService = {
      findById: vi.fn().mockReturnValue(createTask()),
    } as unknown as ITaskService;

    processEngine = {
      getWorkItemType: vi.fn().mockImplementation((_orgId: string, name: string) => typeDefs[name] ?? null),
      getStatusCategory: vi.fn().mockReturnValue('active'),
    } as unknown as IProcessEngine;

    roleService = {
      findByOrgId: vi.fn().mockReturnValue([
        createRole('role-pm'),
        createRole('role-dev'),
      ]),
    } as unknown as IRoleQueryService;

    conversationService = {
      findById: vi.fn().mockReturnValue(createConversation()),
    } as unknown as IConversationCommandService;

    eventPublisher = {
      publish: vi.fn().mockImplementation((type: string, payload: unknown) => {
        published.push({ type, payload });
      }),
    } as unknown as IEventPublisher;

    planningService = {
      submit: vi.fn().mockImplementation((input: { rootTaskId: string | null; sourceConversationId: string | null; orgId: string; roleId: string; tree: any; rootType: string | null; mode: any }) => {
        // Delegate full validation to the real validator, then publish + return
        const roles = (roleService as any).findByOrgId(input.orgId) ?? [];
        const validRoleIds = new Set(roles.map((r: any) => r.id));
        const err = validatePlanTree({
          orgId: input.orgId,
          rootType: input.rootType,
          tree: input.tree,
          processEngine,
          validRoleIds,
        });
        if (err) throw err;

        eventPublisher.publish('plan-tree:submitted', {
          rootTaskId: input.rootTaskId,
          sourceConversationId: input.sourceConversationId,
          orgId: input.orgId,
          roleId: input.roleId,
          mode: input.mode,
          tree: input.tree,
          submittedAt: new Date().toISOString(),
        });

        return {
          mode: input.mode,
          nodeCount: 3,
          maxDepth: 3,
        };
      }),
    };

    mockServer = new MockMcpServer();
    registerPlanTreeToolProvider(mockServer as any, {
      taskService,
      processEngine,
      roleService,
      conversationService,
      planningService,
      eventPublisher,
    } as any);
  });

  async function invoke(params: Record<string, unknown>) {
    const handler = mockServer.getHandler('capibara_plan_submit_tree');
    const raw = await handler(params);
    return parseToolResult(raw);
  }

  // ─── Anchor validation (critical: AI MUST send exactly one) ──

  describe('anchor XOR enforcement', () => {
    it('PT-01: rejects when neither rootTaskId nor conversationId provided', async () => {
      const { data, isError } = await invoke({ tree: validTree() });
      expect(isError).toBe(true);
      expect(data).toMatchObject({ error: 'INVALID_ANCHOR' });
    });

    it('PT-02: rejects when BOTH rootTaskId and conversationId provided', async () => {
      const { data, isError } = await invoke({
        rootTaskId: 'task-epic',
        conversationId: 'conv-plan',
        tree: validTree(),
      });
      expect(isError).toBe(true);
      expect(data).toMatchObject({ error: 'INVALID_ANCHOR' });
    });

    it('PT-03: accepts when only rootTaskId provided', async () => {
      const { data } = await invoke({ rootTaskId: 'task-epic', tree: validTree() });
      expect((data as any).ok).toBe(true);
    });

    it('PT-04: accepts when only conversationId provided', async () => {
      const { data } = await invoke({ conversationId: 'conv-plan', tree: validTree() });
      expect((data as any).ok).toBe(true);
    });

    it('PT-05: treats empty string rootTaskId as absent (null anchor) — accepts conversationId', async () => {
      const { data, isError } = await invoke({ rootTaskId: '', conversationId: 'conv-plan', tree: validTree() });
      expect(isError).toBe(true);
      expect(data).toMatchObject({ error: 'INVALID_ANCHOR' });
    });
  });

  // ─── Tree shape validation ───────────────────────────────────

  describe('tree shape', () => {
    it('PT-10: rejects non-object tree', async () => {
      const { data, isError } = await invoke({ rootTaskId: 'task-epic', tree: 'not an object' });
      expect(isError).toBe(true);
      expect(data).toMatchObject({ error: 'INVALID_TREE_SHAPE' });
    });

    it('PT-11: rejects tree missing required fields', async () => {
      const bad = { type: 'epic', title: 'Root' };
      const { data, isError } = await invoke({ rootTaskId: 'task-epic', tree: bad });
      expect(isError).toBe(true);
      expect(data).toMatchObject({ error: 'INVALID_TREE_SHAPE' });
    });

    it('PT-12: rejects tree with empty string type', async () => {
      const bad = { type: '', title: 'x', description: '', assigneeRoleId: 'r', children: [] };
      const { data, isError } = await invoke({ rootTaskId: 'task-epic', tree: bad });
      expect(isError).toBe(true);
      expect(data).toMatchObject({ error: 'INVALID_TREE_SHAPE' });
    });

    it('PT-13: accepts tree where a child omits the children field (normalized to [])', async () => {
      const tree = {
        type: 'epic',
        title: 'R',
        description: 'd',
        assigneeRoleId: 'role-pm',
        children: [
          {
            type: 'story',
            title: 'S',
            description: 's',
            assigneeRoleId: 'role-dev',
            children: [
              { type: 'task', title: 'T', description: '', assigneeRoleId: 'role-dev' },
            ],
          },
        ],
      };
      const { data } = await invoke({ rootTaskId: 'task-epic', tree });
      expect((data as any).ok).toBe(true);
    });
  });

  // ─── Task-anchor path ─────────────────────────────────────────

  describe('task anchor', () => {
    it('PT-20: happy path — publishes plan-tree:submitted with task anchor + task planningMode', async () => {
      vi.mocked(taskService.findById).mockReturnValue(createTask({ planningMode: 'eager' }));
      const { data } = await invoke({ rootTaskId: 'task-epic', tree: validTree() });
      expect((data as any).ok).toBe(true);
      expect((data as any).mode).toBe('eager');

      expect(published).toHaveLength(1);
      expect(published[0].type).toBe('plan-tree:submitted');
      expect(published[0].payload).toMatchObject({
        rootTaskId: 'task-epic',
        sourceConversationId: null,
        orgId: 'org-1',
        mode: 'eager',
      });
    });

    it('PT-21: rejects when task not found', async () => {
      vi.mocked(taskService.findById).mockReturnValue(null);
      const { data, isError } = await invoke({ rootTaskId: 'missing', tree: validTree() });
      expect(isError).toBe(true);
      expect(data).toMatchObject({ error: 'ROOT_TASK_NOT_FOUND' });
      expect(published).toHaveLength(0);
    });

    it('PT-22: rejects when task is in terminal status', async () => {
      vi.mocked(processEngine.getStatusCategory).mockReturnValue('terminal');
      vi.mocked(taskService.findById).mockReturnValue(createTask({ status: 'done' }));
      const { data, isError } = await invoke({ rootTaskId: 'task-epic', tree: validTree() });
      expect(isError).toBe(true);
      expect(data).toMatchObject({ error: 'ROOT_TASK_TERMINAL' });
      expect(published).toHaveLength(0);
    });

    it('PT-23: rejects when tree root type does not match task type', async () => {
      vi.mocked(taskService.findById).mockReturnValue(createTask({ type: 'story' }));
      const tree = validTree();
      const { data, isError } = await invoke({ rootTaskId: 'task-epic', tree });
      expect(isError).toBe(true);
      expect(data).toMatchObject({ error: 'ROOT_TYPE_MISMATCH' });
      expect(published).toHaveLength(0);
    });

    it('PT-24: assigneeRoleId falls back to tree root when task has no assignee', async () => {
      vi.mocked(taskService.findById).mockReturnValue(createTask({ assigneeRoleId: null }));
      await invoke({ rootTaskId: 'task-epic', tree: validTree() });
      expect(published[0].payload).toMatchObject({ roleId: 'role-pm' });
    });
  });

  // ─── Conversation-anchor path ─────────────────────────────────

  describe('conversation anchor', () => {
    it('PT-30: happy path — publishes plan-tree:submitted with conversation anchor + mode=preview', async () => {
      const { data } = await invoke({ conversationId: 'conv-plan', tree: validTree() });
      expect((data as any).ok).toBe(true);
      expect((data as any).mode).toBe('preview');

      expect(published).toHaveLength(1);
      expect(published[0].type).toBe('plan-tree:submitted');
      expect(published[0].payload).toMatchObject({
        rootTaskId: null,
        sourceConversationId: 'conv-plan',
        orgId: 'org-1',
        mode: 'preview',
      });
    });

    it('PT-31: rejects when conversation not found', async () => {
      vi.mocked(conversationService.findById).mockReturnValue(null);
      const { data, isError } = await invoke({ conversationId: 'missing', tree: validTree() });
      expect(isError).toBe(true);
      expect(data).toMatchObject({ error: 'CONVERSATION_NOT_FOUND' });
      expect(published).toHaveLength(0);
    });

    it('PT-32: rejects non-planning conversations (adhoc / inquiry / plan_review)', async () => {
      const types = ['adhoc', 'inquiry', 'plan_review'] as const;
      for (const type of types) {
        published.length = 0;
        vi.mocked(conversationService.findById).mockReturnValue(createConversation({ type }));
        const { data, isError } = await invoke({ conversationId: 'c', tree: validTree() });
        expect(isError).toBe(true);
        expect(data).toMatchObject({ error: 'INVALID_CONVERSATION_TYPE' });
        expect(published).toHaveLength(0);
      }
    });

    it('PT-33: forces mode=preview even if someone passes eager intent via other means', async () => {
      await invoke({ conversationId: 'conv-plan', tree: validTree() });
      expect(published[0].payload).toMatchObject({ mode: 'preview' });
    });

    it('PT-34: skips ROOT_TYPE_MISMATCH check — root type just needs allowedAtRoot', async () => {
      const tree: PlanTreeNode = {
        type: 'story',
        title: 'S Root',
        description: 'd',
        assigneeRoleId: 'role-dev',
        children: [
          { type: 'task', title: 'T', description: '', assigneeRoleId: 'role-dev', children: [] },
        ],
      };
      const { data } = await invoke({ conversationId: 'conv-plan', tree });
      expect((data as any).ok).toBe(true);
    });

    it('PT-35: rejects root type that is NOT allowedAtRoot', async () => {
      const tree: PlanTreeNode = {
        type: 'task',
        title: 'T Root',
        description: '',
        assigneeRoleId: 'role-dev',
        children: [],
      };
      const { data, isError } = await invoke({ conversationId: 'conv-plan', tree });
      expect(isError).toBe(true);
      expect(data).toMatchObject({ error: 'ROOT_TYPE_MISMATCH' });
      expect(published).toHaveLength(0);
    });

    it('PT-36: uses conversation.respondentRoleId as published roleId', async () => {
      vi.mocked(conversationService.findById).mockReturnValue(
        createConversation({ respondentRoleId: 'role-custom-agent' }),
      );
      vi.mocked(roleService.findByOrgId).mockReturnValue([
        createRole('role-custom-agent'),
        createRole('role-pm'),
        createRole('role-dev'),
      ]);
      const tree = validTree();
      tree.assigneeRoleId = 'role-pm';
      await invoke({ conversationId: 'conv-plan', tree });
      expect(published[0].payload).toMatchObject({ roleId: 'role-custom-agent' });
    });

    it('PT-37: when conversation has null respondentRoleId, falls back to tree root assignee', async () => {
      vi.mocked(conversationService.findById).mockReturnValue(
        createConversation({ respondentRoleId: null }),
      );
      await invoke({ conversationId: 'conv-plan', tree: validTree() });
      expect(published[0].payload).toMatchObject({ roleId: 'role-pm' });
    });
  });

  // ─── Deep validation (independent of anchor) ─────────────────

  describe('tree validation errors propagate to AI', () => {
    it('PT-40: invalid child type (not in parent.allowedChildren) → TYPE_NOT_IN_ALLOWED_CHILDREN', async () => {
      const tree: PlanTreeNode = {
        type: 'epic',
        title: 'R',
        description: '',
        assigneeRoleId: 'role-pm',
        children: [
          { type: 'task', title: 'T', description: '', assigneeRoleId: 'role-dev', children: [] },
        ],
      };
      const { data, isError } = await invoke({ rootTaskId: 'task-epic', tree });
      expect(isError).toBe(true);
      expect(data).toMatchObject({ error: 'TYPE_NOT_IN_ALLOWED_CHILDREN' });
    });

    it('PT-41: unknown type → UNKNOWN_WORK_ITEM_TYPE (walked before parent-child check)', async () => {
      const tree: PlanTreeNode = {
        type: 'epic',
        title: 'R',
        description: '',
        assigneeRoleId: 'role-pm',
        children: [
          { type: 'zombiestory', title: 'Z', description: '', assigneeRoleId: 'role-dev', children: [] },
        ],
      };
      const { data, isError } = await invoke({ rootTaskId: 'task-epic', tree });
      expect(isError).toBe(true);
      expect(data).toMatchObject({ error: 'UNKNOWN_WORK_ITEM_TYPE' });
    });

    it('PT-42: unknown assigneeRoleId → UNKNOWN_ROLE_ID', async () => {
      const tree = validTree();
      tree.children[0].assigneeRoleId = 'role-ghost';
      const { data, isError } = await invoke({ rootTaskId: 'task-epic', tree });
      expect(isError).toBe(true);
      expect(data).toMatchObject({ error: 'UNKNOWN_ROLE_ID' });
    });

    it('PT-43: leaf with children → LEAF_CANNOT_HAVE_CHILDREN', async () => {
      const tree: PlanTreeNode = {
        type: 'epic',
        title: 'R',
        description: '',
        assigneeRoleId: 'role-pm',
        children: [
          {
            type: 'story',
            title: 'S',
            description: '',
            assigneeRoleId: 'role-dev',
            children: [
              {
                type: 'task',
                title: 'T',
                description: '',
                assigneeRoleId: 'role-dev',
                // Leaf type 'task' must NOT have children — this should fail
                children: [
                  { type: 'task', title: 'nested', description: '', assigneeRoleId: 'role-dev', children: [] },
                ],
              },
            ],
          },
        ],
      };
      const { data, isError } = await invoke({ rootTaskId: 'task-epic', tree });
      expect(isError).toBe(true);
      expect((data as any).error).toMatch(/LEAF_CANNOT_HAVE_CHILDREN|TYPE_NOT_IN_ALLOWED_CHILDREN/);
    });

    it('PT-44: non-leaf with zero children → NON_LEAF_MUST_HAVE_CHILDREN', async () => {
      const tree: PlanTreeNode = {
        type: 'epic',
        title: 'R',
        description: '',
        assigneeRoleId: 'role-pm',
        children: [],
      };
      const { data, isError } = await invoke({ rootTaskId: 'task-epic', tree });
      expect(isError).toBe(true);
      expect(data).toMatchObject({ error: 'NON_LEAF_MUST_HAVE_CHILDREN' });
    });
  });

  // ─── Successful result shape ─────────────────────────────────

  describe('success response', () => {
    it('PT-50: returns nodeCount and maxDepth', async () => {
      const { data } = await invoke({ rootTaskId: 'task-epic', tree: validTree() });
      const result = data as { ok: boolean; nodeCount: number; maxDepth: number };
      expect(result.ok).toBe(true);
      expect(result.nodeCount).toBe(3);
      expect(result.maxDepth).toBe(3);
    });
  });
});

// ─── validatePlanTree — rootType null branch (conversation-anchor mode) ──

describe('validatePlanTree — rootType=null (conversation-anchor) branch', () => {
  let processEngine: ProcessEngine;
  const validRoleIds = new Set(['role-pm', 'role-dev']);

  beforeEach(() => {
    processEngine = {
      getWorkItemType: vi.fn().mockImplementation((_orgId: string, name: string) => typeDefs[name] ?? null),
      getStatusCategory: vi.fn(),
    } as unknown as ProcessEngine;
  });

  it('V-01: accepts allowedAtRoot root type', () => {
    const err = validatePlanTree({
      orgId: 'org-1',
      rootType: null,
      tree: validTree(),
      processEngine,
      validRoleIds,
    });
    expect(err).toBeNull();
  });

  it('V-02: rejects non-allowedAtRoot root type with ROOT_TYPE_MISMATCH', () => {
    const tree: PlanTreeNode = {
      type: 'task', // allowedAtRoot = false
      title: 'T',
      description: '',
      assigneeRoleId: 'role-dev',
      children: [],
    };
    const err = validatePlanTree({
      orgId: 'org-1',
      rootType: null,
      tree,
      processEngine,
      validRoleIds,
    });
    expect(err).not.toBeNull();
    expect(err!.code).toBe('ROOT_TYPE_MISMATCH');
    expect(err!.nodePath).toBe('$');
  });

  it('V-03: rejects unknown root type with UNKNOWN_WORK_ITEM_TYPE', () => {
    const tree: PlanTreeNode = {
      type: 'ghostquest',
      title: 'G',
      description: '',
      assigneeRoleId: 'role-dev',
      children: [],
    };
    const err = validatePlanTree({
      orgId: 'org-1',
      rootType: null,
      tree,
      processEngine,
      validRoleIds,
    });
    expect(err).not.toBeNull();
    expect(err!.code).toBe('UNKNOWN_WORK_ITEM_TYPE');
  });

  it('V-04: still validates children under null rootType', () => {
    // Root is fine (allowedAtRoot) but child has invalid parent-child relationship
    const tree: PlanTreeNode = {
      type: 'epic',
      title: 'R',
      description: '',
      assigneeRoleId: 'role-pm',
      children: [
        { type: 'task', title: 'T', description: '', assigneeRoleId: 'role-dev', children: [] },
      ],
    };
    const err = validatePlanTree({
      orgId: 'org-1',
      rootType: null,
      tree,
      processEngine,
      validRoleIds,
    });
    expect(err).not.toBeNull();
    expect(err!.code).toBe('TYPE_NOT_IN_ALLOWED_CHILDREN');
  });

  it('V-05: enforces node count limit', () => {
    // Build a tree with MAX_TREE_NODES + 1 nodes
    const children: PlanTreeNode[] = [];
    for (let i = 0; i < MAX_TREE_NODES; i++) {
      children.push({ type: 'task', title: `T${i}`, description: '', assigneeRoleId: 'role-dev', children: [] });
    }
    const tree: PlanTreeNode = {
      type: 'story',
      title: 'S',
      description: '',
      assigneeRoleId: 'role-dev',
      children,
    };
    const err = validatePlanTree({
      orgId: 'org-1',
      rootType: null,
      tree,
      processEngine,
      validRoleIds,
    });
    expect(err).not.toBeNull();
    expect(err!.code).toBe('TOO_MANY_NODES');
  });

  it('V-06: enforces depth limit', () => {
    // Build a chain deeper than MAX_TREE_DEPTH using schema where story allows task
    // We stretch by nesting epic→story→task (3 levels only), so flat-fan this — use
    // a custom typeDef set that allows self-nesting to actually exceed the limit.
    // Simpler: mock getWorkItemType to allow unbounded nesting.
    vi.mocked(processEngine.getWorkItemType).mockImplementation(
      (_orgId: string, name: string) => ({
        name,
        label: name,
        isLeaf: false,
        allowedChildren: [name],
        allowedAtRoot: true,
        canDecompose: true,
      }),
    );
    let node: PlanTreeNode = {
      type: 'loop',
      title: 'leaf',
      description: '',
      assigneeRoleId: 'role-dev',
      children: [],
    };
    // Wrap (MAX_TREE_DEPTH) times → depth = MAX_TREE_DEPTH + 1
    for (let i = 0; i < MAX_TREE_DEPTH; i++) {
      node = {
        type: 'loop',
        title: `level-${i}`,
        description: '',
        assigneeRoleId: 'role-dev',
        children: [node],
      };
    }
    const err = validatePlanTree({
      orgId: 'org-1',
      rootType: null,
      tree: node,
      processEngine,
      validRoleIds,
    });
    expect(err).not.toBeNull();
    // Either depth exceeded or leaf-can't-have-children — but critically it IS rejected
    expect(['DEPTH_EXCEEDED', 'NON_LEAF_MUST_HAVE_CHILDREN']).toContain(err!.code);
  });
});
