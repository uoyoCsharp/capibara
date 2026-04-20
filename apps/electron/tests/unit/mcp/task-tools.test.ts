import { describe, it, expect, beforeEach } from 'vitest';
import { createTaskTools } from '@core/modules/mcp/handlers/task-tools';
import type { McpToolDefinition } from '@core/modules/mcp/registry/mcp-tool.registry';
import type { TaskService } from '@core/modules/workflow/services/task.service';
import type { TaskStateMachine } from '@core/modules/workflow/engines/task.state-machine';
import type { ProcessEngine } from '@core/modules/workflow/engines/process.engine';

function createTask(overrides?: Record<string, unknown>) {
  return {
    id: 'task-1',
    orgId: 'org-1',
    parentId: null,
    type: 'task',
    title: 'Test Task',
    description: 'A task',
    status: 'in_progress',
    assigneeRoleId: 'role-1',
    priority: 0,
    metadata: {},
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('Task Tools (MCP Handlers)', () => {
  let tools: McpToolDefinition[];
  let taskService: TaskService;
  let taskStateMachine: TaskStateMachine;
  let processEngine: ProcessEngine;

  beforeEach(() => {
    taskService = {
      findById: vi.fn().mockReturnValue(createTask()),
      findByOrgId: vi.fn().mockReturnValue([]),
      findChildren: vi.fn().mockReturnValue([]),
      create: vi.fn().mockReturnValue(createTask({ id: 'child-1', status: 'todo' })),
    } as unknown as TaskService;

    taskStateMachine = {
      transition: vi.fn().mockReturnValue(createTask({ status: 'done' })),
    } as unknown as TaskStateMachine;

    processEngine = {
      getStatusesByCategory: vi.fn().mockReturnValue([{ name: 'done' }]),
    } as unknown as ProcessEngine;

    tools = createTaskTools(taskService, taskStateMachine, processEngine);
  });

  function findTool(name: string): McpToolDefinition {
    return tools.find((t) => t.name === name)!;
  }

  describe('capibara_task_complete', () => {
    it('transitions task to terminal status', async () => {
      const tool = findTool('capibara_task_complete');
      const result = await tool.handler({ taskId: 'task-1' }, 'run-1');
      expect(processEngine.getStatusesByCategory).toHaveBeenCalledWith('org-1', 'terminal');
      expect(taskStateMachine.transition).toHaveBeenCalledWith('task-1', 'done');
      expect(result).toEqual({ taskId: 'task-1', status: 'done' });
    });

    it('returns error when task not found', async () => {
      vi.mocked(taskService.findById).mockReturnValue(null);
      const tool = findTool('capibara_task_complete');
      const result = await tool.handler({ taskId: 'missing' }, 'run-1');
      expect(result).toEqual({ error: 'Task not found: missing' });
    });

    it('uses fallback status when no terminal statuses configured', async () => {
      vi.mocked(processEngine.getStatusesByCategory).mockReturnValue([]);
      const tool = findTool('capibara_task_complete');
      await tool.handler({ taskId: 'task-1' }, 'run-1');
      expect(taskStateMachine.transition).toHaveBeenCalledWith('task-1', 'done');
    });
  });

  describe('capibara_task_create_child', () => {
    it('creates child task under parent', async () => {
      const tool = findTool('capibara_task_create_child');
      const result = await tool.handler(
        { parentId: 'task-1', type: 'subtask', title: 'Sub', description: 'Details', assigneeRoleId: 'role-2' },
        'run-1',
      );
      expect(taskService.create).toHaveBeenCalledWith(expect.objectContaining({
        orgId: 'org-1',
        parentId: 'task-1',
        type: 'subtask',
        title: 'Sub',
        description: 'Details',
        assigneeRoleId: 'role-2',
      }));
      expect(result).toEqual({ taskId: 'child-1', status: 'todo' });
    });

    it('returns error when parent not found', async () => {
      vi.mocked(taskService.findById).mockReturnValue(null);
      const tool = findTool('capibara_task_create_child');
      const result = await tool.handler({ parentId: 'missing', type: 'task', title: 'X' }, 'run-1');
      expect(result).toEqual({ error: 'Parent task not found: missing' });
    });

    it('handles missing optional fields', async () => {
      const tool = findTool('capibara_task_create_child');
      await tool.handler({ parentId: 'task-1', type: 'task', title: 'Minimal' }, 'run-1');
      expect(taskService.create).toHaveBeenCalledWith(expect.objectContaining({
        description: '',
        assigneeRoleId: null,
      }));
    });
  });

  describe('capibara_task_review', () => {
    it('transitions task to approval status', async () => {
      vi.mocked(processEngine.getStatusesByCategory).mockReturnValue([{ name: 'awaiting_approval' }]);
      vi.mocked(taskStateMachine.transition).mockReturnValue(createTask({ status: 'awaiting_approval' }));
      const tool = findTool('capibara_task_review');
      const result = await tool.handler({ taskId: 'task-1' }, 'run-1');
      expect(processEngine.getStatusesByCategory).toHaveBeenCalledWith('org-1', 'approval');
      expect(taskStateMachine.transition).toHaveBeenCalledWith('task-1', 'awaiting_approval');
      expect(result).toEqual({ taskId: 'task-1', status: 'awaiting_approval' });
    });

    it('returns error when task not found', async () => {
      vi.mocked(taskService.findById).mockReturnValue(null);
      const tool = findTool('capibara_task_review');
      const result = await tool.handler({ taskId: 'gone' }, 'run-1');
      expect(result).toEqual({ error: 'Task not found: gone' });
    });

    it('uses fallback status when no approval statuses configured', async () => {
      vi.mocked(processEngine.getStatusesByCategory).mockReturnValue([]);
      const tool = findTool('capibara_task_review');
      await tool.handler({ taskId: 'task-1' }, 'run-1');
      expect(taskStateMachine.transition).toHaveBeenCalledWith('task-1', 'awaiting_approval');
    });
  });
});
