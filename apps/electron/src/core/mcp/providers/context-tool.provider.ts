import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { McpProtocolDeps } from '@core/infrastructure/mcp-protocol/mcp-server.builder';

export function registerContextToolProvider(server: McpServer, deps: McpProtocolDeps): void {
  const { taskService, roleService } = deps;

  server.registerTool(
    'capibara_context',
    {
      description: 'Query project context: tasks, roles, and organizational information',
      inputSchema: {
        orgId: z.string().describe('Organization ID'),
        query: z.enum(['tasks', 'roles', 'task_detail', 'role_detail']).describe('What to query'),
        entityId: z.string().optional().describe('Entity ID for detail queries'),
      },
    },
    async ({ orgId, query, entityId }) => {
      let result: unknown;

      switch (query) {
        case 'tasks':
          result = taskService.findByOrgId(orgId).map((t) => ({
            id: t.id, type: t.type, title: t.title, status: t.status, assigneeRoleId: t.assigneeRoleId,
          }));
          break;
        case 'roles':
          result = roleService.findByOrgId(orgId).map((r) => ({
            id: r.id, name: r.name, parentId: r.parentId, status: r.status,
          }));
          break;
        case 'task_detail': {
          const task = taskService.findById(entityId as string);
          if (!task) {
            return {
              content: [{ type: 'text' as const, text: JSON.stringify({ error: 'Task not found' }) }],
              isError: true,
            };
          }
          const children = taskService.findChildren(task.id);
          result = { ...task, children: children.map((c) => ({ id: c.id, type: c.type, title: c.title, status: c.status })) };
          break;
        }
        case 'role_detail': {
          const role = roleService.findById(entityId as string);
          if (!role) {
            return {
              content: [{ type: 'text' as const, text: JSON.stringify({ error: 'Role not found' }) }],
              isError: true,
            };
          }
          const children = roleService.findChildren(role.id);
          result = { ...role, children: children.map((c) => ({ id: c.id, name: c.name, status: c.status })) };
          break;
        }
        default:
          return {
            content: [{ type: 'text' as const, text: JSON.stringify({ error: `Unknown query: ${query}` }) }],
            isError: true,
          };
      }

      return {
        content: [{ type: 'text' as const, text: JSON.stringify(result) }],
      };
    },
  );
}
