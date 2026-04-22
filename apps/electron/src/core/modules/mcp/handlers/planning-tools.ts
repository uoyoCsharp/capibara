import type { McpToolDefinition } from '../registry/mcp-tool.registry';
import type { PendingPlanStore } from '@core/infrastructure/stores/pending-plan.store';
import type { PlanningService } from '@core/modules/planning/planning.service';

export function createPlanningTools(
  pendingPlanStore: PendingPlanStore,
  planningService: PlanningService,
): McpToolDefinition[] {
  return [
    {
      name: 'capibara_plan_tasks',
      description: 'Submit a structured task plan and create tasks immediately',
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
        const conversationId = params.conversationId as string;
        const orgId = params.orgId as string;

        pendingPlanStore.set(conversationId, {
          conversationId,
          orgId,
          roleId: params.roleId as string,
          tasks: params.tasks as unknown[],
          submittedAt: new Date().toISOString(),
        });

        planningService.confirmPlan(conversationId, orgId, null);

        return { status: 'plan_confirmed', conversationId, orgId };
      },
    },
  ];
}
