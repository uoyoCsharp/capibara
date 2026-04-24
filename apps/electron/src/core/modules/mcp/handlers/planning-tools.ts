import type { McpToolDefinition } from '../registry/mcp-tool.registry';
import type { IEventPublisher } from '@core/foundation/interfaces/i-event-publisher';
import type { PlanTaskDraft } from '@core/foundation/events';

export function createPlanningTools(
  eventPublisher: IEventPublisher,
): McpToolDefinition[] {
  return [
    {
      name: 'capibara_plan_tasks',
      description: 'Submit a structured task plan for human review. The plan is recorded as pending and the human operator confirms it in the UI to batch-create the tasks.',
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
        const roleId = params.roleId as string;
        const tasks = params.tasks as PlanTaskDraft[];

        eventPublisher.publish('plan:submitted', {
          conversationId,
          orgId,
          roleId,
          tasks,
          submittedAt: new Date().toISOString(),
        });

        return { status: 'plan_pending', conversationId, orgId };
      },
    },
  ];
}
