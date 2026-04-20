import { describe, it, expect, beforeEach } from 'vitest';
import { createContextTools } from '@core/modules/mcp/handlers/context-tools';
import type { McpToolDefinition } from '@core/modules/mcp/registry/mcp-tool.registry';
import type { TaskService } from '@core/modules/workflow/services/task.service';
import type { RoleService } from '@core/modules/organization/services/role.service';

function createTask(overrides?: Record<string, unknown>) {
  return {
    id: 'task-1',
    orgId: 'org-1',
    parentId: null,
    type: 'task',
    title: 'My Task',
    description: 'Description',
    status: 'in_progress',
    assigneeRoleId: 'role-1',
    priority: 0,
    metadata: {},
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function createRole(overrides?: Record<string, unknown>) {
  return {
    id: 'role-1',
    orgId: 'org-1',
    name: 'Developer',
    parentId: null,
    persona: 'Dev',
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

describe('Context Tools (MCP Handlers)', () => {
  let tools: McpToolDefinition[];
  let taskService: TaskService;
  let roleService: RoleService;

  beforeEach(() => {
    taskService = {
      findById: vi.fn().mockReturnValue(createTask()),
      findByOrgId: vi.fn().mockReturnValue([
        createTask({ id: 'task-1', title: 'Task A', status: 'in_progress' }),
        createTask({ id: 'task-2', title: 'Task B', status: 'done' }),
      ]),
      findChildren: vi.fn().mockReturnValue([
        createTask({ id: 'child-1', title: 'Child Task', status: 'todo' }),
      ]),
    } as unknown as TaskService;

    roleService = {
      findById: vi.fn().mockReturnValue(createRole()),
      findByOrgId: vi.fn().mockReturnValue([
        createRole({ id: 'role-1', name: 'Dev', status: 'active' }),
        createRole({ id: 'role-2', name: 'Lead', parentId: null, status: 'active' }),
      ]),
      findChildren: vi.fn().mockReturnValue([
        createRole({ id: 'role-child', name: 'Junior', status: 'active' }),
      ]),
    } as unknown as RoleService;

    tools = createContextTools(taskService, roleService);
  });

  function findTool(name: string): McpToolDefinition {
    return tools.find((t) => t.name === name)!;
  }

  describe('capibara_context - tasks query', () => {
    it('returns list of tasks for org', async () => {
      const tool = findTool('capibara_context');
      const result = await tool.handler({ orgId: 'org-1', query: 'tasks' }, 'run-1') as unknown[];
      expect(taskService.findByOrgId).toHaveBeenCalledWith('org-1');
      expect(result).toHaveLength(2);
      expect(result[0]).toEqual(expect.objectContaining({ id: 'task-1', title: 'Task A', status: 'in_progress' }));
    });
  });

  describe('capibara_context - roles query', () => {
    it('returns list of roles for org', async () => {
      const tool = findTool('capibara_context');
      const result = await tool.handler({ orgId: 'org-1', query: 'roles' }, 'run-1') as unknown[];
      expect(roleService.findByOrgId).toHaveBeenCalledWith('org-1');
      expect(result).toHaveLength(2);
      expect(result[0]).toEqual(expect.objectContaining({ id: 'role-1', name: 'Dev' }));
    });
  });

  describe('capibara_context - task_detail query', () => {
    it('returns task with children', async () => {
      const tool = findTool('capibara_context');
      const result = await tool.handler({ orgId: 'org-1', query: 'task_detail', entityId: 'task-1' }, 'run-1') as Record<string, unknown>;
      expect(taskService.findById).toHaveBeenCalledWith('task-1');
      expect(taskService.findChildren).toHaveBeenCalledWith('task-1');
      expect(result.id).toBe('task-1');
      expect((result.children as unknown[]).length).toBe(1);
    });

    it('returns error when task not found', async () => {
      vi.mocked(taskService.findById).mockReturnValue(null);
      const tool = findTool('capibara_context');
      const result = await tool.handler({ orgId: 'org-1', query: 'task_detail', entityId: 'missing' }, 'run-1');
      expect(result).toEqual({ error: 'Task not found' });
    });
  });

  describe('capibara_context - role_detail query', () => {
    it('returns role with children', async () => {
      const tool = findTool('capibara_context');
      const result = await tool.handler({ orgId: 'org-1', query: 'role_detail', entityId: 'role-1' }, 'run-1') as Record<string, unknown>;
      expect(roleService.findById).toHaveBeenCalledWith('role-1');
      expect(roleService.findChildren).toHaveBeenCalledWith('role-1');
      expect(result.id).toBe('role-1');
      expect((result.children as unknown[]).length).toBe(1);
    });

    it('returns error when role not found', async () => {
      vi.mocked(roleService.findById).mockReturnValue(null);
      const tool = findTool('capibara_context');
      const result = await tool.handler({ orgId: 'org-1', query: 'role_detail', entityId: 'missing' }, 'run-1');
      expect(result).toEqual({ error: 'Role not found' });
    });
  });

  describe('capibara_context - unknown query', () => {
    it('returns error for unknown query type', async () => {
      const tool = findTool('capibara_context');
      const result = await tool.handler({ orgId: 'org-1', query: 'invalid' }, 'run-1');
      expect(result).toEqual({ error: 'Unknown query: invalid' });
    });
  });
});
