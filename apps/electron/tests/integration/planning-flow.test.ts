import { describe, it, expect, beforeEach } from 'vitest';
import { PlanningService } from '@core/modules/planning/planning.service';
import { createPlanningTools } from '@core/modules/mcp/handlers/planning-tools';
import { MockEventBus } from '../helpers/mock-event-bus';
import { MockLogger } from '../helpers/mock-logger';
import type { ConversationService } from '@core/modules/conversation/services/conversation.service';
import type { TaskService } from '@core/modules/workflow/services/task.service';

/**
 * End-to-end planning flow:
 *   1. Human starts the planning conversation.
 *   2. AI submits a plan via MCP tool → plan:submitted published.
 *   3. PlanningService stores the pending plan.
 *   4. Human confirms → batchCreate happens + planning:plan-ready emitted.
 */
describe('Planning flow integration', () => {
  let bus: MockEventBus;
  let conversationService: ConversationService;
  let taskService: TaskService;
  let planning: PlanningService;

  beforeEach(() => {
    bus = new MockEventBus();
    conversationService = {
      createPlanningOrAdhoc: vi.fn().mockReturnValue({ id: 'conv-plan-1' }),
      addMessage: vi.fn(),
      complete: vi.fn(),
      cancel: vi.fn(),
    } as unknown as ConversationService;
    taskService = {
      batchCreate: vi.fn().mockReturnValue([
        { id: 'task-1', title: 'Design' },
        { id: 'task-2', title: 'Implement' },
      ]),
    } as unknown as TaskService;

    planning = new PlanningService(conversationService, taskService, bus, bus, new MockLogger());
    planning.init();
  });

  it('full happy path: human start → AI submits → human confirms', async () => {
    // Step 1: Human starts planning conversation
    const { conversationId } = planning.start('org-1', 'role-planner', 'Plan my feature');
    expect(conversationId).toBe('conv-plan-1');
    expect(conversationService.createPlanningOrAdhoc).toHaveBeenCalled();

    // Step 2: AI calls capibara_plan_tasks — emits plan:submitted
    const tools = createPlanningTools(bus);
    const tool = tools.find((t) => t.name === 'capibara_plan_tasks')!;
    const planTasks = [
      { type: 'task', title: 'Design', assigneeRoleId: 'role-1' },
      { type: 'task', title: 'Implement', assigneeRoleId: 'role-2' },
    ];
    const submitResult = await tool.handler(
      { conversationId: 'conv-plan-1', orgId: 'org-1', roleId: 'role-planner', tasks: planTasks },
      'run-mcp',
    );
    expect(submitResult).toEqual({ status: 'plan_pending', conversationId: 'conv-plan-1', orgId: 'org-1' });
    bus.assertEmitted('plan:submitted');

    // Step 3: PlanningService recorded the plan
    const pending = planning.getPendingPlan('conv-plan-1');
    expect(pending).toBeDefined();
    expect(pending?.tasks).toEqual(planTasks);

    // Step 4: Human confirms — tasks get batch-created, planning:plan-ready emitted
    planning.confirmPlan('conv-plan-1', 'org-1', null);
    expect(taskService.batchCreate).toHaveBeenCalledWith('org-1', null, planTasks);
    expect(conversationService.complete).toHaveBeenCalledWith('conv-plan-1');
    bus.assertEmitted('planning:plan-ready');
    const ready = bus.getLastEmitted('planning:plan-ready');
    expect(ready?.payload).toEqual(expect.objectContaining({
      conversationId: 'conv-plan-1',
      orgId: 'org-1',
      taskCount: 2,
    }));

    // Post-confirm: pending plan is cleared
    expect(planning.getPendingPlan('conv-plan-1')).toBeUndefined();
  });

  it('discard path: pending plan recorded then discarded never reaches batchCreate', async () => {
    const tools = createPlanningTools(bus);
    const tool = tools.find((t) => t.name === 'capibara_plan_tasks')!;
    await tool.handler(
      { conversationId: 'conv-plan-2', orgId: 'org-1', roleId: 'role-planner', tasks: [{ type: 'task', title: 'X' }] },
      'run',
    );
    expect(planning.getPendingPlan('conv-plan-2')).toBeDefined();

    planning.discardPlan('conv-plan-2');

    expect(planning.getPendingPlan('conv-plan-2')).toBeUndefined();
    expect(conversationService.cancel).toHaveBeenCalledWith('conv-plan-2');
    expect(taskService.batchCreate).not.toHaveBeenCalled();
  });

  it('confirmPlan before any plan is submitted is a no-op', () => {
    planning.confirmPlan('conv-missing', 'org-1', null);
    expect(taskService.batchCreate).not.toHaveBeenCalled();
  });

  it('multiple conversations maintain independent pending plans', async () => {
    const tools = createPlanningTools(bus);
    const tool = tools.find((t) => t.name === 'capibara_plan_tasks')!;
    await tool.handler(
      { conversationId: 'conv-a', orgId: 'org-1', roleId: 'role-1', tasks: [{ type: 'task', title: 'A' }] },
      'run',
    );
    await tool.handler(
      { conversationId: 'conv-b', orgId: 'org-1', roleId: 'role-1', tasks: [{ type: 'task', title: 'B' }] },
      'run',
    );

    planning.confirmPlan('conv-a', 'org-1', null);
    expect(taskService.batchCreate).toHaveBeenCalledTimes(1);
    expect(taskService.batchCreate).toHaveBeenCalledWith('org-1', null, [{ type: 'task', title: 'A' }]);

    // conv-b still pending
    expect(planning.getPendingPlan('conv-b')).toBeDefined();
    planning.confirmPlan('conv-b', 'org-1', 'parent-task');
    expect(taskService.batchCreate).toHaveBeenLastCalledWith('org-1', 'parent-task', [{ type: 'task', title: 'B' }]);
  });
});
