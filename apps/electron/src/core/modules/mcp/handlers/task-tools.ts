import type { McpToolDefinition } from '../registry/mcp-tool.registry';
import type { TaskService } from '@core/modules/workflow/services/task.service';
import type { TaskStateMachine } from '@core/modules/workflow/engines/task.state-machine';
import type { ProcessEngine } from '@core/modules/workflow/engines/process.engine';

export function createTaskTools(
  taskService: TaskService,
  taskStateMachine: TaskStateMachine,
  processEngine: ProcessEngine,
): McpToolDefinition[] {
  return [
    {
      name: 'capibara_task_complete',
      description: 'Mark a task as completed by transitioning it to a terminal status',
      inputSchema: {
        type: 'object',
        properties: {
          taskId: { type: 'string', description: 'The task ID to complete' },
        },
        required: ['taskId'],
      },
      handler: async (params) => {
        const taskId = params.taskId as string;
        const task = taskService.findById(taskId);
        if (!task) return { error: `Task not found: ${taskId}` };

        const terminalStatuses = processEngine.getStatusesByCategory(task.orgId, 'terminal');
        const targetStatus = terminalStatuses[0]?.name ?? 'done';

        const updated = taskStateMachine.transition(taskId, targetStatus);
        return { taskId: updated.id, status: updated.status };
      },
    },
    {
      name: 'capibara_task_create_child',
      description: 'Create a child task under an existing parent task',
      inputSchema: {
        type: 'object',
        properties: {
          parentId: { type: 'string', description: 'Parent task ID' },
          type: { type: 'string', description: 'Task type (e.g., task, subtask)' },
          title: { type: 'string', description: 'Task title' },
          description: { type: 'string', description: 'Task description' },
          assigneeRoleId: { type: 'string', description: 'Role ID to assign', nullable: true },
        },
        required: ['parentId', 'type', 'title'],
      },
      handler: async (params) => {
        const parent = taskService.findById(params.parentId as string);
        if (!parent) return { error: `Parent task not found: ${params.parentId}` };

        const child = taskService.create({
          orgId: parent.orgId,
          parentId: parent.id,
          type: params.type as string,
          title: params.title as string,
          description: (params.description as string) ?? '',
          assigneeRoleId: (params.assigneeRoleId as string) ?? null,
        });
        return { taskId: child.id, status: child.status };
      },
    },
    {
      name: 'capibara_task_review',
      description: 'Submit a task for review by transitioning it to an approval status',
      inputSchema: {
        type: 'object',
        properties: {
          taskId: { type: 'string', description: 'The task ID to submit for review' },
        },
        required: ['taskId'],
      },
      handler: async (params) => {
        const taskId = params.taskId as string;
        const task = taskService.findById(taskId);
        if (!task) return { error: `Task not found: ${taskId}` };

        const approvalStatuses = processEngine.getStatusesByCategory(task.orgId, 'approval');
        const targetStatus = approvalStatuses[0]?.name ?? 'awaiting_approval';

        const updated = taskStateMachine.transition(taskId, targetStatus);
        return { taskId: updated.id, status: updated.status };
      },
    },
  ];
}
