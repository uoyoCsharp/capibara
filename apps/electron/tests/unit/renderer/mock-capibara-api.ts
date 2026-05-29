import type { CapibaraApi } from '@core/shared/api';
import type { DesktopEvent } from '@core/shared/types';

type EventCallback = (event: DesktopEvent) => void;

/**
 * Test double for `window.capibara`. Every method is a vi.fn() that returns
 * a default success `DesktopResult`. Override per-test via:
 *
 *   const api = createMockCapibaraApi();
 *   vi.mocked(api.getRolesByOrgId).mockResolvedValue({ ok: true, data: [...] });
 *
 * Event subscribers registered via `subscribe()` can be driven with
 * `emit(event)` on the returned controller.
 */
export interface MockCapibaraApiController {
  api: CapibaraApi;
  emit: (event: DesktopEvent) => void;
  subscriberCount: () => number;
}

export function createMockCapibaraApi(): MockCapibaraApiController {
  const subscribers = new Set<EventCallback>();

  const ok = <T>(data: T) => ({ ok: true as const, data });

  const api: CapibaraApi = {
    // Organization
    getOrganizations: vi.fn().mockResolvedValue(ok([])),
    getOrganization: vi.fn().mockResolvedValue(ok(null)),
    createOrganization: vi.fn(),
    updateOrganization: vi.fn(),
    deleteOrganization: vi.fn().mockResolvedValue(ok(null)),

    // Roles
    getRolesByOrgId: vi.fn().mockResolvedValue(ok([])),
    getRole: vi.fn().mockResolvedValue(ok(null)),
    createRole: vi.fn(),
    updateRole: vi.fn(),
    deleteRole: vi.fn().mockResolvedValue(ok(null)),

    // Skills
    getSkills: vi.fn().mockResolvedValue(ok([])),
    getSkill: vi.fn().mockResolvedValue(ok(null)),
    createSkill: vi.fn(),
    deleteSkill: vi.fn().mockResolvedValue(ok(null)),

    // Templates
    getTemplates: vi.fn().mockResolvedValue(ok([])),
    loadTemplate: vi.fn(),

    // Tasks
    getTasksByOrgId: vi.fn().mockResolvedValue(ok([])),
    getTask: vi.fn().mockResolvedValue(ok(null)),
    getTaskChildren: vi.fn().mockResolvedValue(ok([])),
    createTask: vi.fn(),
    updateTaskStatus: vi.fn(),
    cancelTask: vi.fn(),
    deleteTask: vi.fn().mockResolvedValue(ok(null)),

    // Approval
    confirmApproval: vi.fn(),
    rejectApproval: vi.fn(),

    // Process Schema
    getProcessSchema: vi.fn().mockResolvedValue(ok(null)),
    saveProcessSchema: vi.fn().mockResolvedValue(ok(null)),
    getProcessTemplates: vi.fn().mockResolvedValue(ok([])),

    // Conversations
    getConversations: vi.fn().mockResolvedValue(ok([])),
    getActiveConversations: vi.fn().mockResolvedValue(ok([])),
    getConversation: vi.fn().mockResolvedValue(ok(null)),
    getConversationMessages: vi.fn().mockResolvedValue(ok([])),
    addConversationMessage: vi.fn(),
    resolveConversation: vi.fn().mockResolvedValue(ok(null)),
    cancelConversation: vi.fn().mockResolvedValue(ok(null)),
    createInquiry: vi.fn(),
    createAdhocConversation: vi.fn(),

    // Conversational Planning
    startPlanning: vi.fn(),
    getActivePlanning: vi.fn().mockResolvedValue(ok(null)),
    getPlanningHistory: vi.fn().mockResolvedValue(ok([])),
    getPlanTreeByConversation: vi.fn().mockResolvedValue(ok(null)),
    approvePlanTreeByConversation: vi.fn().mockResolvedValue(ok(null)),
    discardPlanTreeByConversation: vi.fn().mockResolvedValue(ok(null)),
    refinePlanTreeByConversation: vi.fn().mockResolvedValue(ok(null)),

    // Runs
    getRunsByOrgId: vi.fn().mockResolvedValue(ok([])),
    getRun: vi.fn().mockResolvedValue(ok(null)),
    getRunsByTaskId: vi.fn().mockResolvedValue(ok([])),
    getRunLogs: vi.fn().mockResolvedValue(ok([])),
    getRunLogDir: vi.fn().mockResolvedValue(ok('')),
    cancelRun: vi.fn().mockResolvedValue(ok(null)),
    getInterruptedCount: vi.fn().mockResolvedValue(ok({ count: 0 })),
    resumeInterrupted: vi.fn().mockResolvedValue(ok({ resumed: 0 })),

    // Logs
    getLogStats: vi.fn().mockResolvedValue(ok({ totalSizeMB: 0, fileCount: 0, oldestMonth: null, newestMonth: null })),
    clearAllLogs: vi.fn().mockResolvedValue(ok({ deletedFiles: 0, freedMB: 0 })),
    clearLogsBefore: vi.fn().mockResolvedValue(ok({ deletedFiles: 0, freedMB: 0 })),

    // Cost
    getCostSummary: vi.fn(),

    // Plan Tree
    getPlanTree: vi.fn().mockResolvedValue(ok(null)),
    approvePlanTree: vi.fn().mockResolvedValue(ok(null)),
    discardPlanTree: vi.fn().mockResolvedValue(ok(null)),
    refinePlanTree: vi.fn().mockResolvedValue(ok(null)),

    // Settings
    getSetting: vi.fn().mockResolvedValue(ok(null)),
    setSetting: vi.fn().mockResolvedValue(ok(null)),

    // ACP Model Selection
    getModelState: vi.fn().mockResolvedValue(ok({ supported: false, models: [], currentModelId: null, selectedModelId: null })),
    setSelectedModel: vi.fn().mockResolvedValue(ok({ supported: false, models: [], currentModelId: null, selectedModelId: null })),

    // System
    getSystemHealth: vi.fn().mockResolvedValue(ok({ status: 'ok', timestamp: '' })),
    checkSystemDeps: vi.fn(),
    getAgentConfig: vi.fn().mockResolvedValue(ok({
      defaultAgent: 'claude-agent',
      registry: [{ id: 'claude-agent', name: 'Claude Agent', command: 'node' }],
      globalFilePolicy: { denyPatterns: ['**/.env'] },
      collaboration: { maxChainDepth: 5, maxBroadcastTargets: 5, maxResumeCount: 10, inquiryTimeoutMs: 300000 },
    })),

    // Scheduler
    getExecutionState: vi.fn().mockResolvedValue(ok({ paused: false })),
    pauseExecution: vi.fn().mockResolvedValue(ok({ cancelledRunCount: 0 })),
    resumeExecution: vi.fn().mockResolvedValue(ok(null)),

    // Dialogs / Shell
    selectFolder: vi.fn().mockResolvedValue(ok(null)),
    openFolder: vi.fn().mockResolvedValue(ok(null)),

    // Events
    subscribe: vi.fn((cb: EventCallback) => {
      subscribers.add(cb);
      return () => subscribers.delete(cb);
    }),

    // Auto-update events (not exercised in these tests — noop unsub)
    onUpdateEvent: vi.fn(() => () => {}),
  };

  return {
    api,
    emit: (event: DesktopEvent) => {
      for (const cb of subscribers) cb(event);
    },
    subscriberCount: () => subscribers.size,
  };
}

/**
 * Installs the mock api on window.capibara. Works in both environments:
 *
 *   - node (store tests): window doesn't exist → we stub a minimal global
 *     object that carries only `capibara`.
 *   - jsdom (DOM tests): window already exists → we assign onto it without
 *     replacing the whole global object (doing so breaks @testing-library).
 */
export function installMockCapibaraApi(): MockCapibaraApiController {
  const controller = createMockCapibaraApi();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const g = globalThis as any;
  if (typeof g.window !== 'undefined' && g.window !== null) {
    g.window.capibara = controller.api;
  } else {
    vi.stubGlobal('window', { capibara: controller.api });
  }
  return controller;
}
