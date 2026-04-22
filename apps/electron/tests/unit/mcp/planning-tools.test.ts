import { describe, it, expect, beforeEach } from 'vitest';
import { createPlanningTools } from '@core/modules/mcp/handlers/planning-tools';
import type { McpToolDefinition } from '@core/modules/mcp/registry/mcp-tool.registry';
import type { PendingPlanStore } from '@core/infrastructure/stores/pending-plan.store';
import type { PlanningService } from '@core/modules/planning/planning.service';

describe('Planning Tools (MCP Handlers)', () => {
  let tools: McpToolDefinition[];
  let pendingPlanStore: PendingPlanStore;
  let planningService: PlanningService;

  beforeEach(() => {
    pendingPlanStore = {
      get: vi.fn(),
      set: vi.fn(),
      has: vi.fn(),
      delete: vi.fn(),
      clear: vi.fn(),
    } as unknown as PendingPlanStore;

    planningService = {
      confirmPlan: vi.fn(),
      discardPlan: vi.fn(),
      start: vi.fn(),
      sendMessage: vi.fn(),
      getPendingPlan: vi.fn(),
    } as unknown as PlanningService;

    tools = createPlanningTools(pendingPlanStore, planningService);
  });

  function findTool(name: string): McpToolDefinition {
    return tools.find((t) => t.name === name)!;
  }

  describe('capibara_plan_tasks', () => {
    it('stores plan and auto-confirms via PlanningService', async () => {
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
      expect(planningService.confirmPlan).toHaveBeenCalledWith('conv-1', 'org-1', null);
      expect(result).toEqual({ status: 'plan_confirmed', conversationId: 'conv-1', orgId: 'org-1' });
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
