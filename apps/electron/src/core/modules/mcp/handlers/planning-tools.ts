import type { McpToolDefinition } from '../registry/mcp-tool.registry';
import type { PendingPlanStore } from '@core/infrastructure/stores/pending-plan.store';

export function createPlanningTools(
  pendingPlanStore: PendingPlanStore,
): McpToolDefinition[] {
  return [
    {
      name: 'capibara_plan_tasks',
      description: 'Submit a structured task plan for human confirmation',
      inputSchema: {
        type: 'object',
        properties: {
          conversationId: { type: 'string', description: 'Planning conversation ID' },
          orgId: { type: 'string', description: 'Organization ID' },
          roleId: { type: 'string', description: 'Planning role ID' },
          tasks: {
            type: 'array',
            description: 'Array of task definitions forming the plan tree',
            items: { type: 'object' },
          },
        },
        required: ['conversationId', 'orgId', 'roleId', 'tasks'],
      },
      handler: async (params) => {
        pendingPlanStore.set(params.conversationId as string, {
          conversationId: params.conversationId as string,
          orgId: params.orgId as string,
          roleId: params.roleId as string,
          tasks: params.tasks as unknown[],
          submittedAt: new Date().toISOString(),
        });
        return { status: 'plan_submitted', conversationId: params.conversationId };
      },
    },
  ];
}
