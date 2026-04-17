import type { McpToolDefinition } from '../registry/mcp-tool.registry';
import type { TaskService } from '@core/modules/workflow/services/task.service';
import type { RoleService } from '@core/modules/organization/services/role.service';

export function createContextTools(
  taskService: TaskService,
  roleService: RoleService,
): McpToolDefinition[] {
  return [
    {
      name: 'capibara_context',
      description: 'Query project context: tasks, roles, and organizational information',
      inputSchema: {
        type: 'object',
        properties: {
          orgId: { type: 'string', description: 'Organization ID' },
          query: { type: 'string', enum: ['tasks', 'roles', 'task_detail', 'role_detail'], description: 'What to query' },
          entityId: { type: 'string', description: 'Entity ID for detail queries' },
        },
        required: ['orgId', 'query'],
      },
      handler: async (params) => {
        const orgId = params.orgId as string;
        const query = params.query as string;

        switch (query) {
          case 'tasks':
            return taskService.findByOrgId(orgId).map((t) => ({
              id: t.id, type: t.type, title: t.title, status: t.status, assigneeRoleId: t.assigneeRoleId,
            }));
          case 'roles':
            return roleService.findByOrgId(orgId).map((r) => ({
              id: r.id, name: r.name, parentId: r.parentId, status: r.status,
            }));
          case 'task_detail': {
            const task = taskService.findById(params.entityId as string);
            if (!task) return { error: 'Task not found' };
            const children = taskService.findChildren(task.id);
            return { ...task, children: children.map((c) => ({ id: c.id, type: c.type, title: c.title, status: c.status })) };
          }
          case 'role_detail': {
            const role = roleService.findById(params.entityId as string);
            if (!role) return { error: 'Role not found' };
            const children = roleService.findChildren(role.id);
            return { ...role, children: children.map((c) => ({ id: c.id, name: c.name, status: c.status })) };
          }
          default:
            return { error: `Unknown query: ${query}` };
        }
      },
    },
  ];
}
