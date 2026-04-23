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
      create: vi.fn().mockReturnValue(createTask({ id: 'child-1', status: 'pending' })),
    } as unknown as TaskService;

    taskStateMachine = {
      transition: vi.fn().mockImplementation((_id: string, target: string) =>
        createTask({ status: target }),
      ),
    } as unknown as TaskStateMachine;

    processEngine = {
      getStatusCategory: vi.fn().mockReturnValue('active'),
      getStatusesByCategory: vi.fn().mockReturnValue([]),
      validateTransition: vi.fn().mockReturnValue(true),
      getAvailableTransitions: vi.fn().mockReturnValue([
        { from: 'in_progress', to: 'awaiting_review' },
        { from: 'in_progress', to: 'blocked' },
        { from: 'in_progress', to: 'cancelled' },
      ]),
    } as unknown as ProcessEngine;

    tools = createTaskTools(taskService, taskStateMachine, processEngine);
  });

  function findTool(name: string): McpToolDefinition {
    return tools.find((t) => t.name === name)!;
  }

  // ─── capibara_task_transition ──────────────────────────────────

  describe('capibara_task_transition', () => {
    it('transitions task to a valid target status', async () => {
      const tool = findTool('capibara_task_transition');
      const result = await tool.handler({ taskId: 'task-1', targetStatus: 'awaiting_review' }, 'run-1');
      expect(taskStateMachine.transition).toHaveBeenCalledWith('task-1', 'awaiting_review');
      expect(result).toEqual({
        taskId: 'task-1',
        previousStatus: 'in_progress',
        currentStatus: 'awaiting_review',
      });
    });

    it('returns error when task not found', async () => {
      vi.mocked(taskService.findById).mockReturnValue(null);
      const tool = findTool('capibara_task_transition');
      const result = await tool.handler({ taskId: 'missing', targetStatus: 'done' }, 'run-1');
      expect(result).toEqual({ error: 'Task not found: missing' });
    });

    it('returns no-op when task is already in terminal status', async () => {
      vi.mocked(taskService.findById).mockReturnValue(createTask({ status: 'done' }));
      vi.mocked(processEngine.getStatusCategory).mockReturnValue('terminal');

      const tool = findTool('capibara_task_transition');
      const result = await tool.handler({ taskId: 'task-1', targetStatus: 'cancelled' }, 'run-1') as Record<string, unknown>;

      expect(taskStateMachine.transition).not.toHaveBeenCalled();
      expect(result.currentStatus).toBe('done');
      expect(result.message).toContain('terminal');
    });

    it('returns structured error with available transitions when transition is invalid', async () => {
      vi.mocked(processEngine.validateTransition).mockReturnValue(false);

      const tool = findTool('capibara_task_transition');
      const result = await tool.handler({ taskId: 'task-1', targetStatus: 'approved' }, 'run-1') as Record<string, unknown>;

      expect(taskStateMachine.transition).not.toHaveBeenCalled();
      expect(result.error).toContain('in_progress');
      expect(result.error).toContain('approved');
      expect(result.currentStatus).toBe('in_progress');
      expect(result.availableTransitions).toEqual([
        'awaiting_review',
        'blocked',
        'cancelled',
      ]);
    });

    it('prevents the original bug: in_progress → approved returns error with alternatives', async () => {
      vi.mocked(processEngine.validateTransition).mockReturnValue(false);
      vi.mocked(processEngine.getAvailableTransitions).mockReturnValue([
        { from: 'in_progress', to: 'awaiting_review' },
        { from: 'in_progress', to: 'blocked' },
        { from: 'in_progress', to: 'cancelled' },
      ]);

      const tool = findTool('capibara_task_transition');
      const result = await tool.handler({ taskId: 'task-1', targetStatus: 'approved' }, 'run-1') as Record<string, unknown>;

      expect(result.error).toBeDefined();
      expect(result.currentStatus).toBe('in_progress');
      const transitions = result.availableTransitions as string[];
      expect(transitions).toContain('awaiting_review');
      expect(transitions).not.toContain('approved');
    });

    it('epic decomposition scenario: AI can transition to awaiting_review instead of invalid approved', async () => {
      vi.mocked(taskService.findById).mockReturnValue(
        createTask({ id: 'epic-1', type: 'epic', status: 'in_progress' }),
      );
      vi.mocked(processEngine.validateTransition).mockReturnValue(true);

      const tool = findTool('capibara_task_transition');
      const result = await tool.handler({ taskId: 'epic-1', targetStatus: 'awaiting_review' }, 'run-1') as Record<string, unknown>;

      expect(taskStateMachine.transition).toHaveBeenCalledWith('epic-1', 'awaiting_review');
      expect(result.currentStatus).toBe('awaiting_review');
    });

    it('uses orgId from task for all process engine calls', async () => {
      vi.mocked(taskService.findById).mockReturnValue(createTask({ orgId: 'org-special' }));

      const tool = findTool('capibara_task_transition');
      await tool.handler({ taskId: 'task-1', targetStatus: 'awaiting_review' }, 'run-1');

      expect(processEngine.getStatusCategory).toHaveBeenCalledWith('org-special', 'in_progress');
      expect(processEngine.validateTransition).toHaveBeenCalledWith('org-special', 'in_progress', 'awaiting_review');
    });

    it('returns availableTransitions as empty array when no transitions exist', async () => {
      vi.mocked(processEngine.validateTransition).mockReturnValue(false);
      vi.mocked(processEngine.getAvailableTransitions).mockReturnValue([]);

      const tool = findTool('capibara_task_transition');
      const result = await tool.handler({ taskId: 'task-1', targetStatus: 'done' }, 'run-1') as Record<string, unknown>;

      expect(result.error).toBeDefined();
      expect(result.availableTransitions).toEqual([]);
    });

    it('handles transition from pending to in_progress', async () => {
      vi.mocked(taskService.findById).mockReturnValue(createTask({ status: 'pending' }));
      vi.mocked(processEngine.getStatusCategory).mockReturnValue('initial');

      const tool = findTool('capibara_task_transition');
      const result = await tool.handler({ taskId: 'task-1', targetStatus: 'in_progress' }, 'run-1') as Record<string, unknown>;

      expect(taskStateMachine.transition).toHaveBeenCalledWith('task-1', 'in_progress');
      expect(result.previousStatus).toBe('pending');
      expect(result.currentStatus).toBe('in_progress');
    });

    it('handles transition from awaiting_review to approved', async () => {
      vi.mocked(taskService.findById).mockReturnValue(createTask({ status: 'awaiting_review' }));
      vi.mocked(processEngine.getStatusCategory).mockReturnValue('approval');

      const tool = findTool('capibara_task_transition');
      const result = await tool.handler({ taskId: 'task-1', targetStatus: 'approved' }, 'run-1') as Record<string, unknown>;

      expect(taskStateMachine.transition).toHaveBeenCalledWith('task-1', 'approved');
      expect(result.previousStatus).toBe('awaiting_review');
      expect(result.currentStatus).toBe('approved');
    });

    it('handles transition to cancelled', async () => {
      const tool = findTool('capibara_task_transition');
      const result = await tool.handler({ taskId: 'task-1', targetStatus: 'cancelled' }, 'run-1') as Record<string, unknown>;

      expect(taskStateMachine.transition).toHaveBeenCalledWith('task-1', 'cancelled');
      expect(result.currentStatus).toBe('cancelled');
    });

    it('no-op for task already in done status', async () => {
      vi.mocked(taskService.findById).mockReturnValue(createTask({ status: 'done' }));
      vi.mocked(processEngine.getStatusCategory).mockReturnValue('terminal');

      const tool = findTool('capibara_task_transition');
      const result = await tool.handler({ taskId: 'task-1', targetStatus: 'done' }, 'run-1') as Record<string, unknown>;

      expect(taskStateMachine.transition).not.toHaveBeenCalled();
      expect(result.currentStatus).toBe('done');
    });

    it('no-op for task already in cancelled status', async () => {
      vi.mocked(taskService.findById).mockReturnValue(createTask({ status: 'cancelled' }));
      vi.mocked(processEngine.getStatusCategory).mockReturnValue('terminal');

      const tool = findTool('capibara_task_transition');
      const result = await tool.handler({ taskId: 'task-1', targetStatus: 'in_progress' }, 'run-1') as Record<string, unknown>;

      expect(taskStateMachine.transition).not.toHaveBeenCalled();
      expect(result.message).toContain('terminal');
    });
  });

  // ─── capibara_task_create_child ────────────────────────────────

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
      expect(result).toEqual({ taskId: 'child-1', status: 'pending' });
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

    it('inherits orgId from parent task', async () => {
      vi.mocked(taskService.findById).mockReturnValue(createTask({ orgId: 'org-special' }));
      const tool = findTool('capibara_task_create_child');
      await tool.handler({ parentId: 'task-1', type: 'subtask', title: 'Child' }, 'run-1');
      expect(taskService.create).toHaveBeenCalledWith(expect.objectContaining({ orgId: 'org-special' }));
    });

    it('propagates service errors to caller', async () => {
      vi.mocked(taskService.create).mockImplementation(() => {
        throw new Error("Type 'epic' not allowed as child of 'subtask'");
      });

      const tool = findTool('capibara_task_create_child');
      await expect(
        tool.handler({ parentId: 'task-1', type: 'epic', title: 'Bad' }, 'run-1'),
      ).rejects.toThrow("Type 'epic' not allowed as child of 'subtask'");
    });
  });

  // ─── Tool registration ────────────────────────────────────────

  describe('tool registration', () => {
    it('registers exactly 2 tools', () => {
      expect(tools).toHaveLength(2);
    });

    it('registers all expected tool names', () => {
      const names = tools.map((t) => t.name);
      expect(names).toContain('capibara_task_transition');
      expect(names).toContain('capibara_task_create_child');
    });

    it('does not register removed tools', () => {
      const names = tools.map((t) => t.name);
      expect(names).not.toContain('capibara_task_complete');
      expect(names).not.toContain('capibara_task_review');
    });

    it('all tools have required inputSchema fields', () => {
      for (const tool of tools) {
        expect(tool.inputSchema).toBeDefined();
        expect(tool.inputSchema.type).toBe('object');
        expect(tool.inputSchema.required).toBeDefined();
        expect(Array.isArray(tool.inputSchema.required)).toBe(true);
      }
    });

    it('capibara_task_transition requires taskId and targetStatus', () => {
      const tool = findTool('capibara_task_transition');
      expect(tool.inputSchema.required).toEqual(['taskId', 'targetStatus']);
    });
  });
});
