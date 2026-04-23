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
      name: 'capibara_task_transition',
      description:
        'Transition a task to a new status. ' +
        'On failure, returns the current status and available transitions so you can retry with a valid target.',
      inputSchema: {
        type: 'object',
        properties: {
          taskId: { type: 'string', description: 'The task ID to transition' },
          targetStatus: { type: 'string', description: 'The target status name to transition to' },
        },
        required: ['taskId', 'targetStatus'],
      },
      handler: async (params) => {
        const taskId = params.taskId as string;
        const targetStatus = params.targetStatus as string;
        const task = taskService.findById(taskId);
        if (!task) return { error: `Task not found: ${taskId}` };

        const currentCategory = processEngine.getStatusCategory(task.orgId, task.status);
        if (currentCategory === 'terminal') {
          return {
            taskId: task.id,
            previousStatus: task.status,
            currentStatus: task.status,
            message: `Task is already in terminal status "${task.status}". No transition needed.`,
          };
        }

        const availableTransitions = processEngine.getAvailableTransitions(task.orgId, task.status);

        if (!processEngine.validateTransition(task.orgId, task.status, targetStatus)) {
          return {
            error: `Invalid transition: "${task.status}" → "${targetStatus}" is not allowed.`,
            taskId: task.id,
            currentStatus: task.status,
            availableTransitions: availableTransitions.map((t) => t.to),
          };
        }

        const previousStatus = task.status;
        const updated = taskStateMachine.transition(taskId, targetStatus);
        return {
          taskId: updated.id,
          previousStatus,
          currentStatus: updated.status,
        };
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
  ];
}
