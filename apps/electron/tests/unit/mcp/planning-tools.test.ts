import { describe, it, expect, beforeEach } from 'vitest';
import { createPlanningTools } from '@core/modules/mcp/handlers/planning-tools';
import type { McpToolDefinition } from '@core/modules/mcp/registry/mcp-tool.registry';
import type { PendingPlanStore } from '@core/infrastructure/stores/pending-plan.store';

describe('Planning Tools (MCP Handlers)', () => {
  let tools: McpToolDefinition[];
  let pendingPlanStore: PendingPlanStore;

  beforeEach(() => {
    pendingPlanStore = {
      get: vi.fn(),
      set: vi.fn(),
      has: vi.fn(),
      delete: vi.fn(),
      clear: vi.fn(),
    } as unknown as PendingPlanStore;

    tools = createPlanningTools(pendingPlanStore);
  });

  function findTool(name: string): McpToolDefinition {
    return tools.find((t) => t.name === name)!;
  }

  describe('capibara_plan_tasks', () => {
    it('stores plan in PendingPlanStore', async () => {
      const tasks = [
        { type: 'task', title: 'Design API', assigneeRoleId: 'role-1' },
        { type: 'task', title: 'Implement API', assigneeRoleId: 'role-2' },
      ];
      const tool = findTool('capibara_plan_tasks');
      const result = await tool.handler(
        { conversationId: 'conv-1', orgId: 'org-1', roleId: 'role-planner', tasks },
        'run-1',
      );

      expect(pendingPlanStore.set).toHaveBeenCalledWith('conv-1', expect.objectContaining({
        conversationId: 'conv-1',
        orgId: 'org-1',
        roleId: 'role-planner',
        tasks,
      }));
      expect(result).toEqual({ status: 'plan_submitted', conversationId: 'conv-1' });
    });

    it('includes submittedAt timestamp in stored plan', async () => {
      const tool = findTool('capibara_plan_tasks');
      await tool.handler(
        { conversationId: 'conv-2', orgId: 'org-1', roleId: 'role-1', tasks: [] },
        'run-1',
      );

      const stored = vi.mocked(pendingPlanStore.set).mock.calls[0][1];
      expect(stored.submittedAt).toBeDefined();
      expect(new Date(stored.submittedAt).getTime()).not.toBeNaN();
    });
  });
});
