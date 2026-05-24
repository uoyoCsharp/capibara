# MCP 官方 SDK 迁移架构设计方案

> **版本**: 1.0  
> **日期**: 2026-05-24  
> **状态**: 待审阅  
> **范围**: 将手写 MCP 协议实现迁移到官方 `@modelcontextprotocol/server` SDK，消除 MCP 子进程和 HTTP 中继层  

---

## 目录

1. [背景与动机](#1-背景与动机)
2. [当前架构实态分析](#2-当前架构实态分析)
3. [目标架构设计](#3-目标架构设计)
4. [分阶段实施计划](#4-分阶段实施计划)
5. [Phase 1 详细设计](#5-phase-1-详细设计)
6. [Phase 2 详细设计](#6-phase-2-详细设计)
7. [模块级改动清单](#7-模块级改动清单)
8. [测试策略](#8-测试策略)
9. [风险与缓解](#9-风险与缓解)
10. [附录：ACP MCP 传输类型调查](#10-附录acp-mcp-传输类型调查)

---

## 1. 背景与动机

### 1.1 问题陈述

当前 Capibara 的 MCP 实现完全手写，存在以下问题：

| # | 问题 | 严重程度 | 详细说明 |
|---|------|---------|---------|
| **P1** | 工具定义双重维护 | **高** | `capibara-mcp-server.ts` 硬编码了 5 个工具的 schema，与 `handlers/*.ts` 中的注册完全重复。新增/修改工具必须同步两处，极易漂移 |
| **P2** | 手写 JSON-RPC 协议 | **中** | `capibara-mcp-server.ts` 手动 switch method，仅实现 `initialize`/`tools/list`/`tools/call` 三个方法，缺少协议完整性 |
| **P3** | 协议版本硬编码 | **中** | 写死 `protocolVersion: '2024-11-05'`，无法随 MCP 协议演进自动升级 |
| **P4** | HTTP 中继层冗余 | **中** | 数据链路：ACP Agent → spawn stdio 子进程 → HTTP POST → 主进程，多了一层网络跳转和序列化 |
| **P5** | 无运行时 schema 校验 | **低** | 工具 inputSchema 是 `Record<string, unknown>`，handler 内全靠 `as` 类型断言 |
| **P6** | 不支持 resources/prompts | **低** | 仅实现 tools 能力，无法利用 MCP 的 resources 和 prompts 能力 |
| **P7** | 独立构建入口维护负担 | **低** | `capibara-mcp-server.ts` 需要在 `electron.vite.config.ts` 中作为独立 rollup 入口构建 |

### 1.2 决策：引入 `@modelcontextprotocol/server`

MCP 官方 TypeScript SDK v2（2026 Q1 稳定发布）提供：

- `McpServer` 类：自动处理 initialize、tools/list、tools/call、协议版本协商
- `StdioServerTransport`：stdio JSON-RPC 传输（可接受任意 Node.js 流）
- `StreamableHTTPServerTransport`：HTTP 传输
- Standard Schema 集成（Zod v3/v4 兼容）：运行时 schema 校验
- 原生 resources/prompts 支持

项目已依赖 `zod@^3.24.0`，SDK 可直接复用。

---

## 2. 当前架构实态分析

### 2.1 组件拓扑

```
┌──────────────────────────── Electron Main Process ─────────────────────────────┐
│                                                                                 │
│  composition-root.ts                                                            │
│    ├─ registerMcpModule() ───────────────────────────────────────────────┐       │
│    │                                                                     │       │
│    │   McpToolRegistry (手写, Map<string, McpToolDefinition>)            │       │
│    │     ├─ task-tools.ts          → capibara_task_transition            │       │
│    │     ├─ task-tools.ts          → capibara_task_create_child          │       │
│    │     ├─ conversation-tools.ts  → capibara_ask_question              │       │
│    │     ├─ conversation-tools.ts  → capibara_broadcast_question        │       │
│    │     ├─ context-tools.ts       → capibara_context                   │       │
│    │     └─ plan-tree-tools.ts     → capibara_plan_submit_tree          │       │
│    │                                                                     │       │
│    │   McpIpcServer (HTTP, 127.0.0.1:N)                                  │       │
│    │     └─ POST /tool-call → toolRegistry.dispatch()                   │       │
│    │                                     ▲                               │       │
│    │                                     │ HTTP POST                     │       │
│    │                                     │                               │       │
│    └─ AcpMcpConfigBuilder ──────────────►│                               │       │
│         buildMcpServers() returns:       │                               │       │
│         [{ command: 'node',              │                               │       │
│            args: ['capibara-mcp-server.js', '--port=N'] }]              │       │
│                                           │                              │       │
│  ┌────────────────────────────────────────│─────────────────────────┐    │       │
│  │  ACP Agent 子进程 (claude-agent-acp)   │                         │    │       │
│  │    └─ spawn capibara-mcp-server.js ────┘                         │    │       │
│  │         (独立构建入口, 手写 JSON-RPC)                              │    │       │
│  │         硬编码 5 个 TOOLS 定义 ← ← ← ← ← P1: 与上方重复!        │    │       │
│  └──────────────────────────────────────────────────────────────────┘    │       │
└─────────────────────────────────────────────────────────────────────────────────┘
```

### 2.2 数据流路径（当前）

```
Agent 调用 MCP 工具（如 capibara_task_transition）
  │
  ▼
capibara-mcp-server.js (子进程, stdio JSON-RPC)        ← 手写 JSON-RPC 解析
  │ method: tools/call
  │ 匹配 tool name
  ▼
callMainProcess()                                       ← HTTP POST
  │ POST http://127.0.0.1:<port>/tool-call
  │ body: { toolName, arguments }
  ▼
McpIpcServer.handleRequest()                            ← 手写 HTTP handler
  │ 解析 body
  ▼
McpToolRegistry.dispatch(toolName, params, runId)       ← Map lookup + handler 调用
  │
  ▼
handler (如 task-tools.ts)                              ← 业务逻辑
  │ 调用 TaskService, ConversationService 等
  ▼
返回结果 → HTTP response → JSON-RPC response → Agent 接收
```

**跳数**: stdio → HTTP → registry → handler = **4 层**

### 2.3 当前组件清单

| 文件 | 行数 | 职责 | 命运 |
|------|------|------|------|
| `capibara-mcp-server.ts` | ~178 | 手写 JSON-RPC MCP server + 硬编码工具定义 | **删除** |
| `mcp-ipc.server.ts` | ~104 | HTTP tool call 中继服务器 | **删除** |
| `mcp-tool.registry.ts` | ~55 | 工具注册表 | **删除** |
| `mcp.module.ts` | ~53 | 模块注册 | **重写** |
| `acp-mcp.config.ts` | ~57 | 生成 MCP server spawn 配置 | **重写** |
| `task-tools.ts` | ~89 | 任务工具 handler | **适配签名** |
| `conversation-tools.ts` | ~146 | 对话工具 handler | **适配签名** |
| `context-tools.ts` | ~52 | 上下文查询工具 handler | **适配签名** |
| `plan-tree-tools.ts` | ~259 | 计划树工具 handler | **适配签名** |
| `tokens.ts` | — | `MCP_IPC_SERVER_TOKEN`, `MCP_TOOL_REGISTRY_TOKEN` | **删除 2 个 token** |
| `electron.vite.config.ts` | — | `capibara-mcp-server` 构建入口 | **删除入口** |
| `composition-root.ts` | — | MCP 模块注册 + port 注入 | **简化** |
| `acp.types.ts` | — | `CreateSessionParams.mcpServers: McpServerStdio[]` | **扩展类型** |
| `acp-session.manager.ts` | — | `createSession()` 传递 mcpServers | **适配** |

### 2.4 现有测试清单

| 测试文件 | 覆盖 | 影响 |
|----------|------|------|
| `mcp-tool-registry.test.ts` (~98 行) | register/dispatch | **删除** |
| `mcp-ipc-server.test.ts` (~115 行) | HTTP server 生命周期 | **删除** |
| `task-tools.test.ts` (~250 行) | 工具逻辑 | **适配** |
| `conversation-tools.test.ts` (~220 行) | 工具逻辑 | **适配** |
| `context-tools.test.ts` (~140 行) | 工具逻辑 | **适配** |
| `plan-tree-tools.test.ts` (~640 行) | 工具逻辑 + 树验证 | **适配** |

---

## 3. 目标架构设计

### 3.1 分阶段目标

| Phase | 目标 | 架构变化 |
|-------|------|---------|
| **Phase 1** | 主进程 MCP SDK Server + HTTP 传输 | 消除 MCP 子进程 + 消除手写 JSON-RPC + 消除工具双维护 |
| **Phase 2** | 进程内 ACP Agent + 内存 MCP 传输 | 消除子进程 spawn + 消除 HTTP 开销 + 最小进程数 |

Phase 1 是 Phase 2 的严格子集，所有改动在 Phase 2 中保留。

### 3.2 Phase 1 目标架构

```
┌──────────────────────────── Electron Main Process ─────────────────────────────┐
│                                                                                 │
│  mcp.module.ts (重写)                                                           │
│    └─ buildCapibaraMcpServer()                                                  │
│         │                                                                       │
│         ▼                                                                       │
│       McpServer (@modelcontextprotocol/server)                                  │
│         ├─ registerTool('capibara_task_transition', ...)      ← Zod schema      │
│         ├─ registerTool('capibara_task_create_child', ...)                       │
│         ├─ registerTool('capibara_ask_question', ...)                            │
│         ├─ registerTool('capibara_broadcast_question', ...)                      │
│         ├─ registerTool('capibara_context', ...)                                 │
│         └─ registerTool('capibara_plan_submit_tree', ...)                        │
│                │                                                                │
│                ▼                                                                │
│       StreamableHTTPServerTransport                                              │
│         └─ 127.0.0.1:N/mcp  (MCP 原生 HTTP 端点)                               │
│                ▲                                                                │
│  ──────────────│────────────────────────────────────────────────────────────── │
│                │ HTTP (MCP 原生协议)                                             │
│  ┌─────────────│────────────────────────────────────────────────────────────┐   │
│  │  ACP Agent 子进程                                                        │   │
│  │    └─ 直接 HTTP 连接 MCP Server（无 spawn 子进程）                       │   │
│  │       配置: { type: "http", name: "capibara", url: "..." }              │   │
│  └──────────────────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────────────┘
```

**数据流（Phase 1）**：

```
Agent 调用 MCP 工具
  │
  ▼
McpServer (SDK, 主进程内) via StreamableHTTPServerTransport
  │ SDK 自动处理 JSON-RPC 解析、工具分发、schema 校验
  ▼
registerTool handler（直接调用 TaskService, ConversationService 等）
  │
  ▼
返回 MCP ContentBlock → HTTP response → Agent 接收
```

**跳数**: HTTP → handler = **2 层**（从 4 层降至 2 层）

### 3.3 Phase 2 目标架构（最终形态）

```
┌──────────────────────────── Electron Main Process ─────────────────────────────┐
│                                                                                 │
│  AcpSessionManager                                                              │
│    └─ ClaudeAcpAgent (进程内, 库导入, 内存流通信)                                │
│         ├─ ACP 通信: InMemoryStream (无 stdio 序列化)                           │
│         ├─ MCP: { type: "sdk", instance: mcpServer }                            │
│         │        └─ SdkMcpTransport (进程内内存通道, 零网络开销)                  │
│         │             └─ registerTool handler (直调 TaskService 等)              │
│         └─ Claude CLI: 仍由 claude-agent-sdk 内部 spawn 为子进程                │
│                                                                                 │
│  最终进程模型:                                                                   │
│    Electron Main ──(内存)── claude-agent-sdk ──(spawn)── Claude CLI              │
│    (2 个进程, 零网络开销)                                                        │
└─────────────────────────────────────────────────────────────────────────────────┘
```

---

## 4. 分阶段实施计划

### 4.1 Phase 1：MCP SDK + HTTP 传输

**目标**：消除手写 MCP 协议 + 消除 MCP 子进程 + 消除工具双维护

**前置条件**：无

**改动量**：删 ~560 行，新增 ~200 行，净减 ~360 行

**验证标准**：
- 所有 6 个 MCP 工具通过集成测试
- ACP Agent 能通过 HTTP 连接 MCP Server
- `capibara-mcp-server.ts` 构建入口移除
- 无手写 JSON-RPC 代码残留

### 4.2 Phase 2：进程内 ACP Agent + 内存 MCP 传输

**目标**：消除 ACP 子进程 + 消除 HTTP 开销

**前置条件**：
- Phase 1 完成
- 验证 `ClaudeAcpAgent` 库 API 稳定性
- 验证进程内错误隔离策略

**改动量**：额外修改 ~5 文件（AcpAgentSpawner, AcpSessionManager, acp.types, acp.module, composition-root）

**验证标准**：
- ACP Agent 在主进程内运行
- MCP 工具调用通过内存通道
- Claude CLI 仍作为独立子进程运行（由 SDK 管理）
- 进程崩溃不影响 Electron 主进程

---

## 5. Phase 1 详细设计

### 5.1 新增依赖

```json
{
  "dependencies": {
    "@modelcontextprotocol/server": "latest"
  }
}
```

### 5.2 新增：`mcp-server.builder.ts`

替换原有的 `mcp.module.ts`，在主进程内构建 MCP SDK Server 实例。

```typescript
// apps/electron/src/core/modules/mcp/mcp-server.builder.ts

import { McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';
import type { TaskService } from '@core/modules/workflow/services/task.service';
import type { TaskStateMachine } from '@core/modules/workflow/engines/task.state-machine';
import type { ProcessEngine } from '@core/modules/workflow/engines/process.engine';
import type { ConversationService } from '@core/modules/conversation/services/conversation.service';
import type { RoleService } from '@core/modules/organization/services/role.service';
import type { IEventPublisher } from '@core/foundation/interfaces/i-event-publisher';
import type { ISessionSuspensionManager } from '@core/modules/acp/interfaces/i-session-suspension.manager';
import type { CollaborationConfig } from '@core/modules/acp/types/acp.types';

export interface McpServerDeps {
  taskService: TaskService;
  taskStateMachine: TaskStateMachine;
  processEngine: ProcessEngine;
  conversationService: ConversationService;
  roleService: RoleService;
  eventPublisher: IEventPublisher;
  suspensionManager?: ISessionSuspensionManager | null;
  collaborationConfig?: CollaborationConfig | null;
}

export function buildCapibaraMcpServer(deps: McpServerDeps): McpServer {
  const server = new McpServer({
    name: 'capibara',
    version: '0.3.0',
  });

  registerTaskTools(server, deps);
  registerConversationTools(server, deps);
  registerContextTools(server, deps);
  registerPlanTreeTools(server, deps);

  return server;
}
```

### 5.3 工具注册迁移示例

**当前** `task-tools.ts` 签名：

```typescript
// 当前：返回 McpToolDefinition[]
export function createTaskTools(
  taskService: TaskService,
  taskStateMachine: TaskStateMachine,
  processEngine: ProcessEngine,
): McpToolDefinition[] {
  return [
    {
      name: 'capibara_task_transition',
      description: '...',
      inputSchema: {                          // Record<string, unknown>, 无校验
        type: 'object',
        properties: {
          taskId: { type: 'string', ... },
          targetStatus: { type: 'string', ... },
        },
        required: ['taskId', 'targetStatus'],
      },
      handler: async (params) => {            // params: Record<string, unknown>
        const taskId = params.taskId as string;   // 手动断言
        ...
      },
    },
  ];
}
```

**迁移后** `task-tools.ts` 签名：

```typescript
// 迁移后：直接注册到 McpServer
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/server';

export function registerTaskTools(
  server: McpServer,
  deps: McpServerDeps,
): void {
  const { taskService, taskStateMachine, processEngine } = deps;

  server.registerTool(
    'capibara_task_transition',
    {
      description:
        'Transition a task to a new status. ' +
        'On failure, returns the current status and available transitions so you can retry.',
      inputSchema: z.object({                 // Zod schema, 运行时校验
        taskId: z.string().describe('The task ID to transition'),
        targetStatus: z.string().describe('The target status name'),
      }),
    },
    async ({ taskId, targetStatus }) => {     // 参数自动解构, 类型安全
      const task = taskService.findById(taskId);
      if (!task) {
        return {
          content: [{ type: 'text', text: JSON.stringify({ error: `Task not found: ${taskId}` }) }],
          isError: true,
        };
      }

      const currentCategory = processEngine.getStatusCategory(task.orgId, task.status);
      if (currentCategory === 'terminal') {
        return {
          content: [{ type: 'text', text: JSON.stringify({
            taskId: task.id,
            previousStatus: task.status,
            currentStatus: task.status,
            message: `Task is already in terminal status "${task.status}".`,
          }) }],
        };
      }

      const availableTransitions = processEngine.getAvailableTransitions(task.orgId, task.status);
      if (!processEngine.validateTransition(task.orgId, task.status, targetStatus)) {
        return {
          content: [{ type: 'text', text: JSON.stringify({
            error: `Invalid transition: "${task.status}" → "${targetStatus}"`,
            taskId: task.id,
            currentStatus: task.status,
            availableTransitions: availableTransitions.map((t) => t.to),
          }) }],
          isError: true,
        };
      }

      const previousStatus = task.status;
      const updated = taskStateMachine.transition(taskId, targetStatus);
      return {
        content: [{ type: 'text', text: JSON.stringify({
          taskId: updated.id,
          previousStatus,
          currentStatus: updated.status,
        }) }],
      };
    },
  );

  server.registerTool(
    'capibara_task_create_child',
    {
      description: 'Create a child task under an existing parent task',
      inputSchema: z.object({
        parentId: z.string().describe('Parent task ID'),
        type: z.string().describe('Task type (e.g., task, subtask)'),
        title: z.string().describe('Task title'),
        description: z.string().optional().describe('Task description'),
        assigneeRoleId: z.string().nullable().optional().describe('Role ID to assign'),
      }),
    },
    async ({ parentId, type, title, description, assigneeRoleId }) => {
      const parent = taskService.findById(parentId);
      if (!parent) {
        return {
          content: [{ type: 'text', text: JSON.stringify({ error: `Parent task not found: ${parentId}` }) }],
          isError: true,
        };
      }
      const child = taskService.create({
        orgId: parent.orgId,
        parentId: parent.id,
        type,
        title,
        description: description ?? '',
        assigneeRoleId: assigneeRoleId ?? null,
      });
      return {
        content: [{ type: 'text', text: JSON.stringify({ taskId: child.id, status: child.status }) }],
      };
    },
  );
}
```

### 5.4 HTTP 传输层

```typescript
// apps/electron/src/core/modules/mcp/mcp-http-transport.ts

import { createServer, type Server } from 'node:http';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/server/streamableHttp';
import { randomUUID } from 'node:crypto';
import type { McpServer } from '@modelcontextprotocol/server';
import type { ILogger } from '@core/foundation/interfaces/i-logger';

export class McpHttpTransportManager {
  private server: Server | null = null;
  private transport: StreamableHTTPServerTransport | null = null;
  private port = 0;

  constructor(private readonly logger: ILogger) {}

  async start(mcpServer: McpServer): Promise<number> {
    this.transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
    });

    await mcpServer.connect(this.transport);

    return new Promise((resolve, reject) => {
      const srv = createServer((req, res) => {
        this.transport!.handleRequest(req, res);
      });

      srv.listen(0, '127.0.0.1', () => {
        const addr = srv.address();
        if (addr && typeof addr === 'object') {
          this.port = addr.port;
          this.server = srv;
          this.logger.info('MCP HTTP server started (SDK)', { port: this.port });
          resolve(this.port);
        } else {
          reject(new Error('Failed to bind MCP HTTP server'));
        }
      });

      srv.on('error', reject);
    });
  }

  stop(): void {
    if (this.server) {
      this.server.close();
      this.server = null;
      this.transport = null;
      this.port = 0;
      this.logger.info('MCP HTTP server stopped');
    }
  }

  getPort(): number {
    return this.port;
  }
}
```

### 5.5 重写 `acp-mcp.config.ts`

```typescript
// apps/electron/src/core/modules/acp/mcp/acp-mcp.config.ts (重写)

import type * as acp from '@agentclientprotocol/sdk';
import type { ILogger } from '@core/foundation/interfaces/i-logger';

/**
 * Builds MCP server configuration for ACP sessions.
 * Phase 1: HTTP transport — Agent connects directly to MCP Server in main process.
 */
export class AcpMcpConfigBuilder {
  private mcpHttpPort = 0;

  constructor(private readonly logger: ILogger) {}

  setHttpPort(port: number): void {
    this.mcpHttpPort = port;
  }

  /**
   * Build MCP server config for ACP session/new.
   * Returns McpServerHttp — Agent connects via HTTP, no subprocess needed.
   */
  buildMcpServers(): acp.McpServerHttp[] {
    if (this.mcpHttpPort === 0) {
      this.logger.warn('MCP HTTP port not set, returning empty MCP servers');
      return [];
    }

    return [
      {
        type: 'http',
        name: 'capibara',
        url: `http://127.0.0.1:${this.mcpHttpPort}/mcp`,
        headers: [],
      },
    ];
  }
}
```

### 5.6 重写 `mcp.module.ts`

```typescript
// apps/electron/src/core/bootstrap/mcp.module.ts (重写)

import type { ILogger } from '@core/foundation/interfaces/i-logger';
// ... service imports ...
import { buildCapibaraMcpServer } from '@core/modules/mcp/mcp-server.builder';
import { McpHttpTransportManager } from '@core/modules/mcp/mcp-http-transport';

export function registerMcpModule(
  logger: ILogger,
  taskService: TaskService,
  taskStateMachine: TaskStateMachine,
  processEngine: ProcessEngine,
  conversationService: ConversationService,
  roleService: RoleService,
  eventPublisher: IEventPublisher,
  suspensionManager?: ISessionSuspensionManager | null,
  collaborationConfig?: CollaborationConfig | null,
): { mcpServer: McpServer; mcpTransport: McpHttpTransportManager } {
  const mcpServer = buildCapibaraMcpServer({
    taskService, taskStateMachine, processEngine,
    conversationService, roleService, eventPublisher,
    suspensionManager, collaborationConfig,
  });

  const mcpTransport = new McpHttpTransportManager(logger);

  return { mcpServer, mcpTransport };
}
```

### 5.7 修改 `composition-root.ts`

```diff
- import { McpIpcServer } from '@core/modules/mcp/server/mcp-ipc.server';
+ import type { McpServer } from '@modelcontextprotocol/server';
+ import { McpHttpTransportManager } from '@core/modules/mcp/mcp-http-transport';

- let mcpIpcServer: McpIpcServer;
+ let mcpTransport: McpHttpTransportManager;

  // ... 在 bootstrap() 中 ...

  const mcp = registerMcpModule(
    logger, taskService, taskStateMachine, processEngine,
    conversationService, roleService, eventPublisher,
    acpModule.suspensionManager, config.collaboration,
  );

- const mcpPort = await mcp.mcpIpcServer.start();
- acpModule.mcpConfigBuilder.setIpcPort(mcpPort);
+ const mcpPort = await mcp.mcpTransport.start(mcp.mcpServer);
+ acpModule.mcpConfigBuilder.setHttpPort(mcpPort);

  // ... 在 shutdown() 中 ...
- mcpIpcServer?.stop();
+ mcpTransport?.stop();
```

### 5.8 修改 `acp-session.manager.ts`

`CreateSessionParams.mcpServers` 类型从 `McpServerStdio[]` 扩展为 `(McpServerStdio | McpServerHttp)[]`。

```diff
// acp.types.ts
  export interface CreateSessionParams {
    // ...
-   mcpServers: schema.McpServerStdio[];
+   mcpServers: (schema.McpServerStdio | schema.McpServerHttp)[];
    // ...
  }
```

```diff
// acp-session.manager.ts createSession()
-   const mcpServerConfigs: acp.McpServerStdio[] = mcpServers.map(s => ({
-     name: s.name, command: s.command, args: s.args, env: s.env,
-   }));
+   const mcpServerConfigs = mcpServers.map(s => {
+     if ('type' in s && s.type === 'http') {
+       return { type: 'http' as const, name: s.name, url: s.url, headers: s.headers ?? [] };
+     }
+     return { name: s.name, command: s.command, args: s.args, env: s.env ?? [] };
+   });
```

### 5.9 修改 `electron.vite.config.ts`

```diff
  build: {
    rollupOptions: {
      input: {
        index: resolve('src/core/index.ts'),
-       'capibara-mcp-server': resolve('src/core/modules/acp/mcp/capibara-mcp-server.ts'),
      },
    },
  },
```

### 5.10 修改 `tokens.ts`

```diff
- // MCP Bridge (Integration)
- export const MCP_IPC_SERVER_TOKEN = Symbol('MCP_IPC_SERVER_TOKEN');
- export const MCP_TOOL_REGISTRY_TOKEN = Symbol('MCP_TOOL_REGISTRY_TOKEN');
```

### 5.11 删除文件

| 文件 | 行数 | 原因 |
|------|------|------|
| `modules/acp/mcp/capibara-mcp-server.ts` | ~178 | 手写 JSON-RPC 子进程，被 SDK 替代 |
| `modules/mcp/server/mcp-ipc.server.ts` | ~104 | HTTP 中继服务器，被 SDK HTTP transport 替代 |
| `modules/mcp/registry/mcp-tool.registry.ts` | ~55 | 手写工具注册表，被 McpServer.registerTool 替代 |
| `tests/unit/mcp-tool-registry.test.ts` | ~98 | 测试已删除组件 |
| `tests/unit/mcp-ipc-server.test.ts` | ~115 | 测试已删除组件 |

---

## 6. Phase 2 详细设计

### 6.1 前置条件

| 条件 | 验证方式 |
|------|---------|
| `ClaudeAcpAgent` 库 API 稳定 | 检查 npm 包 `main: "dist/lib.js"` 导出的 `ClaudeAcpAgent` 类是否有文档化的公开 API |
| 进程内错误隔离 | PoC：在主进程内实例化 `ClaudeAcpAgent`，模拟 Claude CLI 崩溃，验证主进程不受影响 |
| 内存流 ACP 通信 | PoC：用 `ndJsonStream()` 接受内存流替代 stdio，验证 ACP 协议正常工作 |

### 6.2 架构变化

#### AcpAgentSpawner 重构

```diff
// 当前：child_process.spawn
- const child = spawn(entry.command, entry.args, {
-   stdio: ['pipe', 'pipe', 'pipe'],
-   env: { ...process.env, ...entry.env },
- });
- const input = Writable.toWeb(child.stdin!);
- const output = Readable.toWeb(child.stdout!);

// Phase 2：进程内实例化
+ import { ClaudeAcpAgent } from '@agentclientprotocol/claude-agent-acp';
+ const [clientStream, agentStream] = createInMemoryStreamPair();
+ const agentConn = new AgentSideConnection(
+   (client) => new ClaudeAcpAgent(client),
+   agentStream,
+ );
+ const clientConn = new ClientSideConnection(
+   (_agent) => this.createClientCallbacks(),
+   clientStream,
+ );
```

#### MCP 传输变化

```diff
// Phase 1 配置
- { type: 'http', name: 'capibara', url: 'http://127.0.0.1:PORT/mcp' }

// Phase 2 配置 — 通过 _meta 传递 SDK 实例
+ const mcpServer = buildCapibaraMcpServer(deps);
+ // 在 newSession 时通过 options 直传（同进程，对象引用有效）
+ session._meta = {
+   claudeCode: {
+     options: {
+       mcpServers: {
+         capibara: { type: 'sdk', name: 'capibara', instance: mcpServer },
+       },
+     },
+   },
+ };
```

#### 删除组件（Phase 2 额外）

| 组件 | 原因 |
|------|------|
| `McpHttpTransportManager` | 不再需要 HTTP 传输 |
| `AcpMcpConfigBuilder` | 不再需要生成 MCP 配置 |
| HTTP server 端口管理 | 不再需要 |

### 6.3 进程模型对比

```
当前 (4+ 进程):
  Electron Main
    └─ claude-agent-acp (子进程 1)
         ├─ capibara-mcp-server.js (子进程 2)
         └─ Claude CLI (子进程 3)

Phase 1 (2 进程):
  Electron Main
    └─ claude-agent-acp (子进程 1)
         └─ Claude CLI (子进程 2)
    注: capibara-mcp-server 被消除, Agent 直连主进程 HTTP

Phase 2 (2 进程):
  Electron Main  ← 含 ClaudeAcpAgent (进程内)
    └─ Claude CLI (子进程, 由 SDK 内部 spawn)
    注: claude-agent-acp 从子进程变为进程内库
```

### 6.4 Phase 2 风险

| 风险 | 严重度 | 缓解策略 |
|------|--------|---------|
| Claude CLI 崩溃传导到主进程 | 高 | Claude CLI 仍为独立子进程（SDK 内部 spawn），崩溃不直接影响主进程。需验证 SDK 对 CLI 崩溃的 error handling |
| `ClaudeAcpAgent` 库 API 变更 | 中 | 通过接口层隔离，在 Spawner 内封装。锁定 npm 版本 |
| 多 Agent 共享事件循环 | 中 | ACP 通信量低（JSON-RPC 消息），实际计算在 CLI 子进程中。主进程仅做消息分发 |
| 内存泄漏 | 低 | Agent session 有明确生命周期（create→close），session 关闭时释放引用 |

---

## 7. 模块级改动清单

### 7.1 Phase 1 完整改动矩阵

| 文件 | 操作 | 改动说明 |
|------|------|---------|
| **新增** | | |
| `modules/mcp/mcp-server.builder.ts` | **新建** | 构建 McpServer 实例，注册所有工具（Zod schema） |
| `modules/mcp/mcp-http-transport.ts` | **新建** | StreamableHTTPServerTransport 包装器 |
| **重写** | | |
| `bootstrap/mcp.module.ts` | **重写** | 删除 McpToolRegistry/McpIpcServer 创建；改为 buildCapibaraMcpServer + McpHttpTransportManager |
| `modules/acp/mcp/acp-mcp.config.ts` | **重写** | 从 stdio spawn 配置改为 HTTP URL 配置 |
| **修改** | | |
| `bootstrap/composition-root.ts` | **修改** | 适配新的 mcp module 返回值和启动流程 |
| `modules/acp/client/acp-session.manager.ts` | **修改** | mcpServers 映射逻辑适配 HTTP 类型 |
| `modules/acp/types/acp.types.ts` | **修改** | `CreateSessionParams.mcpServers` 类型扩展 |
| `modules/acp/client/acp-executor.ts` | **修改** | `buildMcpServers()` 调用签名适配（不再传 ExecutorInput） |
| `foundation/tokens.ts` | **修改** | 删除 `MCP_IPC_SERVER_TOKEN`, `MCP_TOOL_REGISTRY_TOKEN` |
| `electron.vite.config.ts` | **修改** | 删除 capibara-mcp-server 构建入口 |
| `package.json` | **修改** | 新增 `@modelcontextprotocol/server` |
| **适配** | | |
| `modules/mcp/handlers/task-tools.ts` | **适配** | 从返回 `McpToolDefinition[]` 改为 `registerTaskTools(server, deps)` |
| `modules/mcp/handlers/conversation-tools.ts` | **适配** | 同上 |
| `modules/mcp/handlers/context-tools.ts` | **适配** | 同上 |
| `modules/mcp/handlers/plan-tree-tools.ts` | **适配** | 同上；`validatePlanTree` 和 `__testing__` 导出保留不变 |
| **删除** | | |
| `modules/acp/mcp/capibara-mcp-server.ts` | **删除** | 手写 JSON-RPC MCP 子进程 |
| `modules/mcp/server/mcp-ipc.server.ts` | **删除** | HTTP tool call 中继服务器 |
| `modules/mcp/registry/mcp-tool.registry.ts` | **删除** | 手写工具注册表 |
| `tests/.../mcp-tool-registry.test.ts` | **删除** | 测试已删除组件 |
| `tests/.../mcp-ipc-server.test.ts` | **删除** | 测试已删除组件 |

### 7.2 handler 适配返回值变化

当前 handler 返回任意 `unknown`（由 McpToolRegistry 包装为 HTTP JSON）：

```typescript
// 当前
handler: async (params) => {
  return { taskId: updated.id, previousStatus, currentStatus: updated.status };
}
```

迁移后 handler 必须返回 MCP `CallToolResult`：

```typescript
// 迁移后
async ({ taskId, targetStatus }) => {
  return {
    content: [{ type: 'text', text: JSON.stringify({ taskId, previousStatus, currentStatus }) }],
  };
}
```

**注意**：所有工具的错误返回也需要加 `isError: true` 标记。

---

## 8. 测试策略

### 8.1 Phase 1 测试矩阵

| 测试类型 | 内容 | 工具 |
|----------|------|------|
| **单元测试（适配）** | 4 个 handler test 文件适配 SDK registerTool 签名 | vitest |
| **单元测试（删除）** | 2 个文件（registry, ipc-server）随组件删除 | — |
| **集成测试（新增）** | `mcp-server.builder.test.ts`：验证 McpServer 实例工具注册完整性 | vitest |
| **集成测试（新增）** | `mcp-http-transport.test.ts`：验证 HTTP transport 启动/停止/请求处理 | vitest + http client |
| **E2E 验证** | 启动完整系统，ACP Agent 通过 HTTP 连接 MCP Server，调用全部 6 个工具 | 手动 / PoC 脚本 |

### 8.2 handler 测试适配方式

当前 handler 测试直接实例化 `McpToolDefinition.handler()`：

```typescript
// 当前
const tools = createTaskTools(taskService, taskStateMachine, processEngine);
const result = await tools[0].handler({ taskId: 'xxx', targetStatus: 'yyy' }, 'run-1');
```

迁移后需要通过 McpServer 调用或提取 handler：

```typescript
// 方案 1：直接测试业务逻辑函数（推荐）
// 将 handler 逻辑提取为独立函数，registerTool 只做注册
export async function handleTaskTransition(deps, { taskId, targetStatus }) { ... }

// 测试：
const result = await handleTaskTransition(deps, { taskId: 'xxx', targetStatus: 'yyy' });

// 方案 2：通过 McpServer in-memory client 测试（集成测试级别）
const server = buildCapibaraMcpServer(deps);
const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
await server.connect(serverTransport);
const client = new Client(...);
await client.connect(clientTransport);
const result = await client.callTool('capibara_task_transition', { taskId: 'xxx', ... });
```

**推荐方案 1**：保持 handler 逻辑为纯函数，便于单元测试。`mcp-server.builder.ts` 负责注册包装。

---

## 9. 风险与缓解

| # | 风险 | 概率 | 影响 | 缓解 |
|---|------|------|------|------|
| R1 | MCP SDK v2 API 不稳定 | 低 | 高 | SDK 于 2026 Q1 稳定发布；锁定版本号 |
| R2 | `StreamableHTTPServerTransport` 与 Claude CLI 不兼容 | 低 | 高 | claude-agent-acp 已验证支持 `type: "http"`；Phase 0 PoC 先验证 |
| R3 | Zod v3 与 MCP SDK v2 不兼容 | 低 | 中 | SDK v2 使用 Standard Schema，Zod v3.24+ 已实现 Standard Schema 接口 |
| R4 | `plan-tree-tools` 复杂校验逻辑迁移出错 | 中 | 中 | `validatePlanTree()` 是纯函数导出，不受注册方式变化影响；保持现有 640 行测试覆盖 |
| R5 | HTTP 端口在 shutdown 时未正确释放 | 低 | 低 | `McpHttpTransportManager.stop()` 在 `shutdown()` 中调用 |

---

## 10. 附录：ACP MCP 传输类型调查

### 10.1 ACP SDK 支持的 MCP Server 类型

ACP SDK (`@agentclientprotocol/sdk@0.22.1`) 定义了 4 种 MCP Server 传输类型：

| 类型 | Schema 字段 | claude-agent-acp 支持 | 用途 |
|------|------------|----------------------|------|
| `stdio`（默认） | `command`, `args`, `env` | ✅ | Agent spawn 子进程 |
| `http` | `type: "http"`, `url`, `headers` | ✅ | Agent HTTP 连接 |
| `sse` | `type: "sse"`, `url`, `headers` | ✅ | Agent SSE 连接（已 deprecated） |
| `acp` | `type: "acp"`, `id` | ❌ 被忽略 | 实验性，ACP 通道内嵌 |

### 10.2 claude-agent-sdk 额外支持的类型

| 类型 | 说明 | 是否可通过 ACP 传递 |
|------|------|-------------------|
| `sdk` | 进程内 McpServer 实例 | ❌ 对象无法 JSON 序列化。仅同进程直接调用 SDK 时可用 |

### 10.3 Phase 1 选择 HTTP 的依据

| 考虑因素 | stdio | http | sse | sdk |
|----------|-------|------|-----|-----|
| 无 MCP 子进程 | ❌ | ✅ | ✅ | ✅ |
| 工具定义一处维护 | ❌ | ✅ | ✅ | ✅ |
| 不需改 AcpAgentSpawner | ✅ | ✅ | ✅ | ❌ (需进程内) |
| 协议非 deprecated | ✅ | ✅ | ❌ | ✅ |
| 可通过 ACP JSON-RPC 传递 | ✅ | ✅ | ✅ | ❌ |

**结论**：`http` 是 Phase 1 唯一同时满足所有约束的选项。
