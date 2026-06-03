import { describe, it, expect, vi, beforeEach } from 'vitest';
import { buildCapibaraMcpServer, type McpServerDeps } from '@core/modules/mcp/mcp-server.builder';
import { MockMcpServer } from '../../helpers/mock-mcp-server';

// Mock all handler registration modules so buildCapibaraMcpServer calls
// our captured register functions without pulling in real dependencies.
vi.mock('@core/mcp/providers/task-tool.provider', () => ({
  registerTaskTools: vi.fn(),
}));
vi.mock('@core/mcp/providers/conversation-tool.provider', () => ({
  registerConversationTools: vi.fn(),
}));
vi.mock('@core/mcp/providers/context-tool.provider', () => ({
  registerContextTools: vi.fn(),
}));
vi.mock('@core/mcp/providers/plan-tree-tool.provider', () => ({
  registerPlanTreeTools: vi.fn(),
}));

// Mock the SDK McpServer with our MockMcpServer so we can inspect calls
// without a real transport or gRPC connection.
let mockServerInstance: MockMcpServer;
vi.mock('@modelcontextprotocol/sdk/server/mcp.js', () => ({
  McpServer: class {
    constructor(opts: { name: string; version: string }) {
      mockServerInstance = Object.assign(new MockMcpServer(), { _opts: opts });
      return mockServerInstance as unknown;
    }
  },
}));

import { registerTaskTools } from '@core/mcp/providers/task-tool.provider';
import { registerConversationTools } from '@core/mcp/providers/conversation-tool.provider';
import { registerContextTools } from '@core/mcp/providers/context-tool.provider';
import { registerPlanTreeTools } from '@core/mcp/providers/plan-tree-tool.provider';

function stubDeps(): McpServerDeps {
  return {
    taskService: {} as McpServerDeps['taskService'],
    taskStateMachine: {} as McpServerDeps['taskStateMachine'],
    processEngine: {} as McpServerDeps['processEngine'],
    conversationService: {} as McpServerDeps['conversationService'],
    roleService: {} as McpServerDeps['roleService'],
    eventPublisher: {} as McpServerDeps['eventPublisher'],
    suspensionManager: null,
    collaborationConfig: null,
  };
}

describe('buildCapibaraMcpServer', () => {
  let deps: McpServerDeps;

  beforeEach(() => {
    vi.clearAllMocks();
    deps = stubDeps();
  });

  it('creates an McpServer with correct name and version', () => {
    const server = buildCapibaraMcpServer(deps);
    expect(server).toBeDefined();
    expect((mockServerInstance as unknown as { _opts: { name: string; version: string } })._opts).toEqual({
      name: 'capibara',
      version: '0.3.0',
    });
  });

  it('invokes all four handler registration functions', () => {
    const server = buildCapibaraMcpServer(deps);

    expect(registerTaskTools).toHaveBeenCalledOnce();
    expect(registerTaskTools).toHaveBeenCalledWith(server, deps);

    expect(registerConversationTools).toHaveBeenCalledOnce();
    expect(registerConversationTools).toHaveBeenCalledWith(server, deps);

    expect(registerContextTools).toHaveBeenCalledOnce();
    expect(registerContextTools).toHaveBeenCalledWith(server, deps);

    expect(registerPlanTreeTools).toHaveBeenCalledOnce();
    expect(registerPlanTreeTools).toHaveBeenCalledWith(server, deps);
  });

  it('passes the same server instance to every registration function', () => {
    const server = buildCapibaraMcpServer(deps);

    const calls = [
      vi.mocked(registerTaskTools).mock.calls[0]![0],
      vi.mocked(registerConversationTools).mock.calls[0]![0],
      vi.mocked(registerContextTools).mock.calls[0]![0],
      vi.mocked(registerPlanTreeTools).mock.calls[0]![0],
    ];

    for (const arg of calls) {
      expect(arg).toBe(server);
    }
  });

  it('passes deps including optional suspensionManager', () => {
    deps.suspensionManager = { suspend: vi.fn() } as unknown as McpServerDeps['suspensionManager'];
    buildCapibaraMcpServer(deps);

    expect(vi.mocked(registerConversationTools).mock.calls[0]![1]).toBe(deps);
  });

  it('passes deps including optional collaborationConfig', () => {
    deps.collaborationConfig = { maxChainDepth: 5 } as unknown as McpServerDeps['collaborationConfig'];
    buildCapibaraMcpServer(deps);

    expect(vi.mocked(registerConversationTools).mock.calls[0]![1]).toBe(deps);
  });

  it('returns the McpServer instance', () => {
    const server = buildCapibaraMcpServer(deps);
    expect(server).toBe(mockServerInstance);
  });
});

describe('buildCapibaraMcpServer - tool registration completeness', () => {
  // Verify that all 6 expected tools get registered end-to-end
  // by importing the real handler modules via vi.importActual.

  it('registers exactly 6 tools when all register functions execute', async () => {
    const expectedTools = [
      'capibara_task_transition',
      'capibara_task_create_child',
      'capibara_ask_question',
      'capibara_broadcast_question',
      'capibara_context',
      'capibara_plan_submit_tree',
    ];

    // Bypass vi.mock() to get the real implementations
    const { registerTaskTools: realTaskTools } =
      await vi.importActual<typeof import('@core/mcp/providers/task-tool.provider')>('@core/mcp/providers/task-tool.provider');
    const { registerConversationTools: realConvTools } =
      await vi.importActual<typeof import('@core/mcp/providers/conversation-tool.provider')>('@core/mcp/providers/conversation-tool.provider');
    const { registerContextTools: realCtxTools } =
      await vi.importActual<typeof import('@core/mcp/providers/context-tool.provider')>('@core/mcp/providers/context-tool.provider');
    const { registerPlanTreeTools: realPlanTools } =
      await vi.importActual<typeof import('@core/mcp/providers/plan-tree-tool.provider')>('@core/mcp/providers/plan-tree-tool.provider');

    const captureServer = new MockMcpServer();
    const deps = stubDeps();

    realTaskTools(captureServer as unknown as Parameters<typeof realTaskTools>[0], deps);
    realConvTools(captureServer as unknown as Parameters<typeof realConvTools>[0], deps);
    realCtxTools(captureServer as unknown as Parameters<typeof realCtxTools>[0], deps);
    realPlanTools(captureServer as unknown as Parameters<typeof realPlanTools>[0], deps);

    const registeredTools = captureServer.getToolNames();
    expect(registeredTools).toHaveLength(6);
    for (const name of expectedTools) {
      expect(registeredTools).toContain(name);
    }
  });
});
