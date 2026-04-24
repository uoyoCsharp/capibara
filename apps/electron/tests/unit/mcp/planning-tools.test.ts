import { describe, it, expect, beforeEach } from 'vitest';
import { createPlanningTools } from '@core/modules/mcp/handlers/planning-tools';
import type { McpToolDefinition } from '@core/modules/mcp/registry/mcp-tool.registry';
import { MockEventBus } from '../../helpers/mock-event-bus';

describe('Planning Tools (MCP Handlers)', () => {
  let tools: McpToolDefinition[];
  let bus: MockEventBus;

  beforeEach(() => {
    bus = new MockEventBus();
    // MockEventBus implements IEventPublisher; publish delegates to emit
    tools = createPlanningTools(bus);
  });

  function findTool(name: string): McpToolDefinition {
    return tools.find((t) => t.name === name)!;
  }

  describe('capibara_plan_tasks', () => {
    it('publishes plan:submitted with the submitted task tree', async () => {
      const tasks = [
        { type: 'task', title: 'Design API', assigneeRoleId: 'role-1' },
        { type: 'task', title: 'Implement API', assigneeRoleId: 'role-2' },
      ];
      const tool = findTool('capibara_plan_tasks');
      const result = await tool.handler(
        { conversationId: 'conv-1', orgId: 'org-1', roleId: 'role-planner', tasks },
        'run-1',
      );

      bus.assertEmitted('plan:submitted');
      const event = bus.getLastEmitted('plan:submitted');
      expect(event?.payload).toEqual(expect.objectContaining({
        conversationId: 'conv-1',
        orgId: 'org-1',
        roleId: 'role-planner',
        tasks,
      }));
      expect(result).toEqual({ status: 'plan_pending', conversationId: 'conv-1', orgId: 'org-1' });
    });

    it('includes submittedAt timestamp in the event payload', async () => {
      const tool = findTool('capibara_plan_tasks');
      await tool.handler(
        { conversationId: 'conv-2', orgId: 'org-1', roleId: 'role-1', tasks: [] },
        'run-1',
      );

      const event = bus.getLastEmitted('plan:submitted');
      const submittedAt = (event?.payload as { submittedAt: string }).submittedAt;
      expect(submittedAt).toBeDefined();
      expect(new Date(submittedAt).getTime()).not.toBeNaN();
    });
  });
});
