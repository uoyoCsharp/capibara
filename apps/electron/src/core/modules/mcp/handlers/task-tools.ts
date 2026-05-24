import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { McpServerDeps } from '../mcp-server.builder';

export function registerTaskTools(server: McpServer, deps: McpServerDeps): void {
  const { taskService, taskStateMachine, processEngine } = deps;

  server.tool(
    'capibara_task_transition',
    'Transition a task to a new status. ' +
      'On failure, returns the current status and available transitions so you can retry with a valid target.',
    {
      taskId: z.string().describe('The task ID to transition'),
      targetStatus: z.string().describe('The target status name to transition to'),
    },
    async ({ taskId, targetStatus }) => {
      const task = taskService.findById(taskId);
      if (!task) {
        return {
          content: [{ type: 'text' as const, text: JSON.stringify({ error: `Task not found: ${taskId}` }) }],
          isError: true,
        };
      }

      const currentCategory = processEngine.getStatusCategory(task.orgId, task.status);
      if (currentCategory === 'terminal') {
        return {
          content: [{ type: 'text' as const, text: JSON.stringify({
            taskId: task.id,
            previousStatus: task.status,
            currentStatus: task.status,
            message: `Task is already in terminal status "${task.status}". No transition needed.`,
          }) }],
        };
      }

      const availableTransitions = processEngine.getAvailableTransitions(task.orgId, task.status);

      if (!processEngine.validateTransition(task.orgId, task.status, targetStatus)) {
        return {
          content: [{ type: 'text' as const, text: JSON.stringify({
            error: `Invalid transition: "${task.status}" → "${targetStatus}" is not allowed.`,
            taskId: task.id,
            currentStatus: task.status,
            availableTransitions: availableTransitions.map((t) => t.to),
          }) }],
          isError: true,
        };
      }

      const previousStatus = task.status;
      const updated = taskStateMachine.transition(taskId, targetStatus);
      return {
        content: [{ type: 'text' as const, text: JSON.stringify({
          taskId: updated.id,
          previousStatus,
          currentStatus: updated.status,
        }) }],
      };
    },
  );

  server.tool(
    'capibara_task_create_child',
    'Create a child task under an existing parent task',
    {
      parentId: z.string().describe('Parent task ID'),
      type: z.string().describe('Task type (e.g., task, subtask)'),
      title: z.string().describe('Task title'),
      description: z.string().optional().describe('Task description'),
      assigneeRoleId: z.string().nullable().optional().describe('Role ID to assign'),
    },
    async ({ parentId, type, title, description, assigneeRoleId }) => {
      const parent = taskService.findById(parentId);
      if (!parent) {
        return {
          content: [{ type: 'text' as const, text: JSON.stringify({ error: `Parent task not found: ${parentId}` }) }],
          isError: true,
        };
      }

      const child = taskService.create({
        orgId: parent.orgId,
        parentId: parent.id,
        type,
        title,
        description: description ?? '',
        assigneeRoleId: assigneeRoleId ?? null,
      });
      return {
        content: [{ type: 'text' as const, text: JSON.stringify({ taskId: child.id, status: child.status }) }],
      };
    },
  );
}
