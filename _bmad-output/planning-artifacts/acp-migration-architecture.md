# Capibara ACP 迁移架构设计方案（修订版）

> **版本**: 2.1  
> **日期**: 2026-05-23  
> **状态**: 审阅决策已确认，待启动 Phase 0  
> **作者**: Winston (Architecture Review)  
> **基于**: 外部评估报告 v1.1 + 项目代码实态分析 + 协作模式补充设计  
> **范围**: 将执行引擎从 Claude Code CLI 直接调用迁移到 Agent Client Protocol (ACP) 标准化架构  

---

## 目录

1. [背景与动机](#1-背景与动机)
2. [当前架构实态分析](#2-当前架构实态分析)
3. [目标架构设计](#3-目标架构设计)
4. [ACP 协议适配层设计](#4-acp-协议适配层设计)
5. [AI↔AI 多模式协作设计](#5-aiai-多模式协作设计)
6. [权限与文件访问控制](#6-权限与文件访问控制)
7. [模块级改动清单](#7-模块级改动清单)
8. [数据模型变更](#8-数据模型变更)
9. [配置变更](#9-配置变更)
10. [迁移策略](#10-迁移策略)
11. [风险与缓解](#11-风险与缓解)
12. [AG-UI 未来路线图](#12-ag-ui-未来路线图)
13. [附录](#13-附录)

---

## 1. 背景与动机

### 1.1 项目概述

Capibara 是一个基于 Electron 的多 AI Agent 协作平台。系统建模了组织结构（Org → Role → Skill），通过任务系统（Task）驱动 AI Agent 执行工作，Agent 之间通过对话系统（Conversation）进行协作。

**技术栈**:
- **Platform**: Electron 41.1.0
- **Runtime**: Node.js >= 22.0.0, ESM
- **Language**: TypeScript 5.8.0 (strict, decorators enabled)
- **Frontend**: React 19 + Zustand 5 + TailwindCSS 4 + Radix UI
- **DI**: tsyringe + reflect-metadata
- **Database**: better-sqlite3 + Drizzle ORM (WAL mode, 14 tables)
- **Build**: electron-vite 5 + Vite 7 + electron-builder
- **Package Manager**: pnpm 10 (monorepo workspace)

**项目状态**: Epic 1-6 已完成，尚未上线，可接受破坏性改动。

### 1.2 当前执行引擎的三个根本性问题

| # | 问题 | 根因 | 影响 |
|---|------|------|------|
| **P1** | AI↔AI 协同无法实现 | CLI 是 fire-and-forget 模式，无法在 Run 内挂起等待另一个 Agent 的回复。跨 Run 的 `--resume` 导致认知上下文断裂 | 多 Agent 协作形同虚设 |
| **P2** | 无法控制 AI 行为 | CLI 以 `--dangerously-skip-permissions` 启动，参数静态构建，运行时唯一控制手段为 `cancel()` (SIGTERM) | 无法拦截工具调用、无法注入指令、无法限制行为 |
| **P3** | 无法限制文件操作范围 | Claude CLI 内建的 `Read`/`Write`/`Edit`/`Bash` 工具直接操作 `projectDir`，不经过 MCP，无 allowlist 机制 | 任意 Role 可读写任意文件，存在安全风险 |

### 1.3 为什么选择 ACP

**Agent Client Protocol (ACP)** 是由 Zed 编辑器团队发起的开放协议，标准化了应用程序（Client）与 AI 编码代理（Agent）之间的通信。

**ACP 解决三大问题的映射：**

| 特征 | 说明 | 解决的问题 |
|------|------|-----------|
| JSON-RPC over stdio | Agent 作为子进程运行，Client 通过标准输入/输出通信 | 与 Electron 主进程天然兼容 |
| Session 生命周期管理 | `session/new` → `session/prompt` → `session/close` → `session/resume` | **P1**: 可挂起/恢复 Agent 上下文 |
| Tool Call 权限系统 | `session/request_permission` + allow/reject 机制 | **P2**: 运行时拦截和审批工具调用 |
| Client 侧文件系统 | `fs/read_text_file` / `fs/write_text_file` 由 Client 实现 | **P3**: Client 端 allowlist 控制文件访问范围 |
| MCP 原生集成 | Client 在 `session/new` 时配置 Agent 可连接的 MCP 服务器 | 复用现有 MCP 工具体系 |
| 结构化事件流 | `session/update` 推送 tool_call、text_chunk、plan、diff | 替代自定义 StreamJsonParser |

**ACP 生态成熟度（截至 2026 年 5 月）：**
- 官方 TypeScript SDK: `@agentclientprotocol/sdk`（已发布）
- 已支持 Agent: GitHub Copilot, Claude Agent, Codex CLI, Gemini CLI, Cursor, Cline, Goose, OpenCode, Kiro CLI 等 30+

### 1.4 协议决策

| 协议 | 决策 | 理由 |
|------|------|------|
| **ACP** | ✅ 引入（本阶段） | 标准化 Client↔Agent 通信，解决 P1/P2/P3 三大问题 |
| **MCP** | ✅ 保留 | 已有的工具调用协议，ACP 原生集成 |
| **AG-UI** | ✅ 延后引入 | ACP 层稳定后再标准化 UI 事件推送，避免同时引入两个新协议 |
| **A2A** | ❌ 不引入 | Hub-and-Spoke 架构不需要 Agent 互相发现/直连 |
| **SSE** | ❌ 不引入 | 桌面应用使用 Electron IPC，未来 Web 化时再考虑 |

---

## 2. 当前架构实态分析

### 2.1 进程模型（基于代码实态）

```
┌─────────────────────────────────────────────────────────────────┐
│                        Electron App                              │
│                                                                  │
│  ┌─────────────┐     IPC     ┌────────────────────────────────┐ │
│  │  Renderer   │◄───────────►│  Main Process                  │ │
│  │  React 19   │             │                                │ │
│  │  Zustand 5  │             │  tsyringe DI Container         │ │
│  │  TailwindCSS│             │  Module registration pattern:  │ │
│  └─────────────┘             │    registerExecutionModule()   │ │
│                              │    registerOrchestratorModule() │ │
│                              │    registerWorkflowModule()     │ │
│                              │    registerConversationModule() │ │
│                              │    ... (10 modules total)       │ │
│                              │                                │ │
│                              │  Three-layer orchestration:     │ │
│                              │    RunOrchestrator              │ │
│                              │    TaskOrchestrator             │ │
│                              │    ConversationOrchestrator     │ │
│                              │                                │ │
│                              │  EventBus (Emittery)           │ │
│                              │  SQLite (WAL) + Outbox         │ │
│                              └────────────┬───────────────────┘ │
│                                           │                      │
│                              ┌────────────▼───────────────────┐ │
│                              │  Worker (utilityProcess.fork)   │ │
│                              │  └── worker.ts                  │ │
│                              │      └── ClaudeCliAdapter       │ │
│                              └────────────┬───────────────────┘ │
│                                           │ child_process.spawn  │
│                              ┌────────────▼───────────────────┐ │
│                              │  Claude Code CLI                │ │
│                              │  --dangerously-skip-permissions │ │
│                              │  --output-format stream-json    │ │
│                              │  --mcp-config (temp json)       │ │
│                              └────────────┬───────────────────┘ │
│                                           │ stdio (JSON-RPC)     │
│                              ┌────────────▼───────────────────┐ │
│                              │  capibara-mcp-bridge.ts         │ │
│                              │  (独立 Node.js 进程)            │ │
│                              │  JSON-RPC ↔ HTTP POST           │ │
│                              │  → McpIpcServer (127.0.0.1:N)  │ │
│                              └────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
```

### 2.2 当前执行链路（基于代码实态）

```
TaskOrchestrator.tryWake(roleId, orgId, taskId)
  → WakeGateValidator.check()                    // 序列化/暂停/连续唤醒检查
  → RunCoordinator.executeForTask(...)           // 构建执行参数
    → PromptBuilder.buildForTask(...)            // 8 种场景的提示构建
    → RunEngine.execute(params)                  // 核心执行
      → UtilityProcessExecutor.spawn(input)      // IExecutor 接口
        → WorkerService.spawnRun(job)            // IPC to utilityProcess
          → worker.ts: ClaudeCliAdapter.spawn()  // spawn CLI
          → StreamJsonParser 解析 stdout         // 自定义解析
          → postMessage('run-finished')          // IPC back
      → RunEngine: 记录 Run, 发布事件, 更新 Task 状态
  → RunOrchestrator.drainSuspensions()            // 排空挂起队列

对话场景:
ConversationOrchestrator.onResponseNeeded(event)
  → WakeGateValidator.check()
  → RunCoordinator.executeForConversation(...)
    → PromptBuilder.buildForConversation(...)
    → RunEngine.execute(...)
```

### 2.3 关键组件清单（待改动）

| 组件 | 位置 | 当前职责 | 改动类型 |
|------|------|---------|---------|
| `ClaudeCliAdapter` | `infrastructure/adapters/` | CLI 参数构建 + 进程管理 | **删除** |
| `claude-stream-parser.ts` | `infrastructure/adapters/` | 解析 CLI stream-json 输出 | **删除** |
| `worker.ts` | `modules/execution/workers/` | utilityProcess 内 CLI 执行 | **删除** |
| `worker-protocol.ts` | `modules/execution/workers/` | `ParentMessage`/`ChildMessage` 类型 | **删除** |
| `worker-service.ts` | `modules/execution/workers/` | utilityProcess 管理 | **删除** |
| `utility-process.executor.ts` | `modules/execution/workers/` | `IExecutor` 实现 | **替换** |
| `stream-json-parser.ts` | `modules/execution/workers/` | Claude stream 行解析 | **删除** |
| `capibara-mcp-bridge.ts` | `modules/mcp/bridge/` | stdio↔HTTP 桥接进程 | **删除** |
| `mcp-ipc.server.ts` | `modules/mcp/server/` | HTTP tool call 中继 | **改造** |
| `mcp-config-generator.ts` | `modules/mcp/config/` | 生成临时 MCP JSON 配置 | **改造** |
| `RunEngine` | `modules/execution/engines/` | 执行生命周期管理 | **改造** |
| `RunCoordinator` | `modules/orchestrator/` | 桥接编排器到执行引擎 | **改造** |
| `ConversationOrchestrator` | `modules/orchestrator/` | 对话协调 | **改造** |
| `PromptBuilder` | `modules/prompt/` | 提示词构建 | **适配** |
| `execution.module.ts` | `bootstrap/` | 执行模块 DI 注册 | **重写** |
| `electron.vite.config.ts` | 根目录 | 构建入口（含 bridge/worker） | **修改** |

### 2.4 保留不变的模块

| 模块 | 理由 |
|------|------|
| `organization/` | 角色/技能建模，与执行引擎无关 |
| `workflow/` | 任务状态机、流程引擎，与执行引擎无关 |
| `conversation/` | 对话/消息模型，保留并扩展 |
| `planning/` | 分解树，保留不变 |
| `coordination/` | InquiryRouter + EscalationService，保留并适配 |
| `notification/` | EventBroadcaster + DesktopEvent，保留（AG-UI 后续阶段） |
| Foundation 层 | EventBus, EventPublisher, Outbox, Logger, SQLite 全部保留 |
| DB schema (14 tables) | 保留，新增表 |
| Renderer / Zustand stores | 保留，新增事件类型 |
| `FileLogService` | 执行日志持久化，保留并适配新事件格式 |
| `CostTracker` | Token 费用追踪，保留 |
| `SqliteRunRepository` | Run 持久化，保留并扩展 |

---

## 3. 目标架构设计

### 3.1 新进程模型

```
┌──────────────────────────────────────────────────────────────────────┐
│                           Electron App                               │
│                                                                      │
│  ┌──────────────────┐       ┌────────────────────────────────────┐  │
│  │  Renderer         │       │  Main Process                      │  │
│  │  (React 19)       │       │                                    │  │
│  │  Zustand stores   │ IPC   │  tsyringe DI Container             │  │
│  │                   │◄─────►│                                    │  │
│  │  DesktopEvent     │       │  ┌──────────────────────────────┐  │  │
│  │  消费 (保留现有)   │       │  │  ACP Session Manager          │  │  │
│  │                   │       │  │  ┌────────────────────────┐  │  │  │
│  │  + 新增执行状态    │       │  │  │ Permission Handler     │  │  │  │
│  │    事件消费        │       │  │  ├────────────────────────┤  │  │  │
│  └──────────────────┘       │  │  │ File System Handler    │  │  │  │
│                              │  │  ├────────────────────────┤  │  │  │
│                              │  │  │ Update Handler         │  │  │  │
│                              │  │  └────────────────────────┘  │  │  │
│                              │  └───────────┬──────────────────┘  │  │
│                              │              │                     │  │
│                              │  ┌───────────▼──────────────────┐  │  │
│                              │  │  Session Suspension Manager   │  │  │
│                              │  │  (AI↔AI 协作依赖图管理)       │  │  │
│                              │  └───────────┬──────────────────┘  │  │
│                              │              │ JSON-RPC stdio       │  │
│                              │  ┌───────────▼──────────────────┐  │  │
│                              │  │  ACP Agent 子进程             │  │  │
│                              │  │  (Copilot/Claude/Gemini/...) │  │  │
│                              │  │                              │  │  │
│                              │  │  Agent ──stdio MCP──►        │  │  │
│                              │  │    Capibara MCP Server        │  │  │
│                              │  │    (同进程 or stdio pipe)     │  │  │
│                              │  └──────────────────────────────┘  │  │
│                              │                                    │  │
│                              │  Three-layer Orchestrators         │  │
│                              │  EventBus / SQLite / Outbox        │  │
│                              └────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────────────┘
```

**关键变化：**
- **删除** utilityProcess worker 层（不再需要独立进程管理 CLI）
- **删除** MCP Bridge 进程（ACP Agent 原生通过 stdio 连接 MCP server）
- **删除** MCP HTTP IPC Server（MCP 改为 stdio 传输，由 ACP 原生集成）
- **新增** ACP Session Manager（Main 进程内，管理 Agent 子进程的完整生命周期）
- **新增** Session Suspension Manager（管理 AI↔AI 协作的会话依赖图）
- **Main 进程直接 spawn** ACP Agent 子进程，通过 stdio JSON-RPC 通信
- **保留** IExecutor 接口（ACP Executor 实现它，最小化 RunEngine 改动）

### 3.2 核心数据流

```
用户触发 / 自动调度
  → TaskOrchestrator.tryWake()
    → WakeGateValidator.check()
    → RunCoordinator.executeForTask()
      → PromptBuilder.buildForTask() → ACP ContentBlock[]
      → RunEngine.execute()
        → AcpExecutor.spawn(input)             ← 新 IExecutor 实现
          → AcpSessionManager.createSession()
          → AcpSessionManager.prompt(content)
          │
          │  ← session/update (tool_call / text / plan)
          │  → AcpUpdateHandler.handle()
          │     → EventBroadcaster.emit('run:log')       ← 保留现有事件
          │     → EventBroadcaster.emit('run:assistant-text')
          │
          │  ← session/request_permission
          │  → AcpPermissionHandler.decide()
          │     → ToolPermissionPolicy.evaluate(roleId, toolCall)
          │     → 返回 allow/reject
          │
          │  ← fs/read_text_file | fs/write_text_file
          │  → AcpFilesystemHandler.handle()
          │     → FileAccessPolicy.check(path, cwd, allowedPaths)
          │
          │  Agent 调用 MCP: capibara_ask_question
          │  → MCP Server 处理 → ConversationService.createInquiry()
          │  → 返回 { inquiryId, status: 'pending' }
          │
          │  session/prompt response { stopReason: 'end_turn' }
          │
        → AcpExecutor 返回 ExecutorOutput
      → RunEngine: 记录结果, 发布事件

  如果有 pending inquiry:
    → ConversationOrchestrator.onInquiryCreated()
      → SessionSuspensionManager.suspend(sessionId, awaitingInquiries)
      → 创建 respondent session(s)
      → respondent 回答
      → SessionSuspensionManager.checkAndResume()
        → AcpSessionManager.resumeSession()
        → AcpSessionManager.prompt(aggregatedReply)
```

---

## 4. ACP 协议适配层设计

### 4.1 新增模块结构

```
apps/electron/src/core/modules/
├── acp/                                    ← 新增模块
│   ├── client/
│   │   ├── acp-session.manager.ts          ← 核心：管理所有 ACP 会话
│   │   ├── acp-agent.spawner.ts            ← spawn ACP agent 子进程
│   │   ├── acp-jsonrpc.transport.ts        ← JSON-RPC over stdio 传输层
│   │   └── acp-executor.ts                 ← 新的 IExecutor 实现
│   ├── handlers/
│   │   ├── acp-permission.handler.ts       ← 处理 session/request_permission
│   │   ├── acp-filesystem.handler.ts       ← 实现 fs/read_text_file, fs/write_text_file
│   │   └── acp-update.handler.ts           ← 处理 session/update (tool_call, text, plan, diff)
│   ├── policies/
│   │   ├── file-access.policy.ts           ← 文件访问 allowlist/denylist 策略
│   │   └── tool-permission.policy.ts       ← 工具调用权限策略
│   ├── collaboration/
│   │   ├── session-suspension.manager.ts   ← 会话挂起/恢复/依赖图管理
│   │   ├── inquiry-aggregator.ts           ← 多回复聚合
│   │   └── chain-depth.guard.ts            ← 链式协作深度防护
│   ├── interfaces/
│   │   ├── i-acp-session.manager.ts        ← 接口定义
│   │   ├── i-file-access.policy.ts         ← 文件策略接口
│   │   └── i-session-suspension.manager.ts ← 会话挂起管理器接口
│   ├── types/
│   │   └── acp.types.ts                    ← ACP 协议类型定义
│   └── mcp/
│       └── acp-mcp.config.ts               ← 为 ACP session 生成 MCP server 配置
```

### 4.2 ACP Session Manager（核心组件）

```typescript
// interfaces/i-acp-session.manager.ts

interface IAcpSessionManager {
  /**
   * 创建新会话并启动 Agent 子进程（如果尚未启动）。
   * 对应 ACP: initialize → session/new
   */
  createSession(params: CreateSessionParams): Promise<AcpSession>;

  /**
   * 向会话发送 prompt，消费 session/update 流，返回 turn 完成后的结果。
   * 对应 ACP: session/prompt → 消费 session/update 流 → session/prompt response
   */
  prompt(sessionId: string, content: PromptContent[]): Promise<PromptResult>;

  /**
   * 恢复已关闭的会话（不 replay 历史）。
   * 如果 Agent 不支持 resume，降级到 load 或 rebuild。
   * 对应 ACP: session/resume | session/load
   */
  resumeSession(sessionId: string): Promise<void>;

  /**
   * 关闭会话，保留状态以便后续 resume。
   * 对应 ACP: session/close
   */
  closeSession(sessionId: string): Promise<void>;

  /**
   * 取消正在进行的 prompt turn。
   * 对应 ACP: session/cancel
   */
  cancelPrompt(sessionId: string): Promise<void>;

  /**
   * 查询 Agent 能力（在 initialize 阶段获取）。
   */
  getAgentCapabilities(agentId: string): AgentCapabilities;

  /**
   * 获取活跃会话（用于并发检查）。
   */
  getActiveSession(roleId: string, orgId: string): AcpSession | null;
}

interface CreateSessionParams {
  agentId: string;              // 配置中注册的 agent 标识
  roleId: string;               // Capibara Role ID
  orgId: string;                // Capibara Org ID
  taskId?: string;              // 关联的 Task ID（可选）
  conversationId?: string;      // 关联的 Conversation ID（可选）
  cwd: string;                  // 工作目录（作为文件操作边界）
  mcpServers: McpServerConfig[];// MCP 服务器配置列表
  allowedPaths?: string[];      // 文件访问 allowlist（追加到 cwd 约束之上）
}

interface AcpSession {
  id: string;                   // Capibara 内部 ID
  acpSessionId: string;         // ACP 协议返回的 session ID
  agentId: string;
  roleId: string;
  orgId: string;
  status: 'active' | 'suspended' | 'closed' | 'error';
  capabilities: AgentCapabilities;
  createdAt: string;
  resumeCount: number;
}

interface AgentCapabilities {
  supportsResume: boolean;      // session/resume
  supportsLoad: boolean;        // session/load (replay history)
  supportedMcpTransports: ('stdio' | 'sse')[];
}

interface PromptResult {
  stopReason: 'end_turn' | 'max_tokens' | 'cancelled' | 'refusal';
  toolCallsMade: ToolCallRecord[];
  textOutput: string;
  tokensUsed?: { input: number; output: number; cached: number };
  pendingInquiries: PendingInquiry[];  // Agent 在本 turn 中创建的 inquiry
}

interface PendingInquiry {
  inquiryId: string;
  conversationId: string;
  targetRoleId: string;
  question: string;
}
```

### 4.3 ACP Executor（IExecutor 实现）

```typescript
// client/acp-executor.ts

/**
 * 新的 IExecutor 实现，桥接 RunEngine 到 ACP Session Manager。
 * 保留 IExecutor 接口不变，最小化 RunEngine 改动。
 */
class AcpExecutor implements IExecutor {
  constructor(
    private readonly sessionManager: IAcpSessionManager,
    private readonly updateHandler: AcpUpdateHandler,
    private readonly suspensionManager: ISessionSuspensionManager,
    private readonly config: AcpConfig,
  ) {}

  async spawn(input: ExecutorInput): Promise<ExecutorHandle> {
    // 1. 解析 Agent 配置
    const agentId = this.config.resolveAgentForRole(input.roleId) 
                    ?? this.config.defaultAgent;

    // 2. 创建 ACP 会话
    const session = await this.sessionManager.createSession({
      agentId,
      roleId: input.roleId,
      orgId: input.orgId,
      taskId: input.taskId,
      cwd: input.projectDir,
      mcpServers: this.buildMcpConfig(input),
      allowedPaths: this.resolveAllowedPaths(input.roleId),
    });

    // 3. 构建 prompt content
    const content: PromptContent[] = [
      { type: 'text', text: input.prompt },
    ];

    // 4. 返回 ExecutorHandle（保持接口兼容）
    let cancelled = false;
    const completePromise = this.executeWithCollaboration(session, content);

    return {
      runId: input.runId,
      pid: process.pid,  // Agent 子进程 PID（从 spawner 获取）
      complete: () => completePromise,
      cancel: async () => {
        cancelled = true;
        await this.sessionManager.cancelPrompt(session.id);
      },
      onLog: (cb) => this.updateHandler.onLog(session.id, cb),
      onAssistantText: (cb) => this.updateHandler.onText(session.id, cb),
    };
  }

  /**
   * 执行 prompt 并处理可能的协作挂起/恢复循环。
   */
  private async executeWithCollaboration(
    session: AcpSession,
    content: PromptContent[],
  ): Promise<ExecutorOutput> {
    const result = await this.sessionManager.prompt(session.id, content);

    // 检查是否有 pending inquiries 需要协作
    if (result.pendingInquiries.length > 0) {
      // 挂起当前会话，等待协作完成后由 Orchestrator 恢复
      await this.suspensionManager.suspend({
        sessionId: session.id,
        roleId: session.roleId,
        orgId: session.orgId,
        awaitingInquiries: result.pendingInquiries,
        aggregationMode: 'all',
      });

      // 返回中间状态 — Orchestrator 会在所有回复到达后恢复此会话
      return {
        exitCode: 0,
        status: 'suspended',  // 新增状态
        summary: null,
        sessionId: session.acpSessionId,
        inputTokens: result.tokensUsed?.input ?? 0,
        outputTokens: result.tokensUsed?.output ?? 0,
        cachedInputTokens: result.tokensUsed?.cached ?? 0,
      };
    }

    // 无协作需求，正常完成
    return {
      exitCode: 0,
      status: result.stopReason === 'end_turn' ? 'succeeded' : 'failed',
      summary: result.textOutput,
      sessionId: session.acpSessionId,
      inputTokens: result.tokensUsed?.input ?? 0,
      outputTokens: result.tokensUsed?.output ?? 0,
      cachedInputTokens: result.tokensUsed?.cached ?? 0,
    };
  }
}
```

### 4.4 ACP Update Handler

```typescript
// handlers/acp-update.handler.ts

/**
 * 处理 ACP session/update 事件流。
 * 将 ACP 事件转换为内部日志/事件，通过 EventBroadcaster 推送到 Renderer。
 */
class AcpUpdateHandler {
  private logCallbacks = new Map<string, Set<LogCallback>>();
  private textCallbacks = new Map<string, Set<TextCallback>>();

  constructor(
    private readonly eventBus: IEventBus,
    private readonly fileLogService: FileLogService,
    private readonly logger: ILogger,
  ) {}

  /**
   * 处理来自 ACP session/update 的通知。
   * 映射到内部事件系统 + 日志持久化。
   */
  handleUpdate(sessionId: string, update: AcpSessionUpdate): void {
    switch (update.sessionUpdate) {
      case 'agent_message_chunk': {
        // 文本流 → run:assistant-text 事件 + 回调
        const textCbs = this.textCallbacks.get(sessionId);
        textCbs?.forEach(cb => cb(update.content));
        break;
      }

      case 'tool_call': {
        // 工具调用开始 → run:log 事件
        this.emitLog(sessionId, {
          type: 'tool_call_start',
          toolCallId: update.toolCallId,
          title: update.title,
          kind: update.kind,
        });
        break;
      }

      case 'tool_call_update': {
        // 工具调用状态更新
        this.emitLog(sessionId, {
          type: 'tool_call_update',
          toolCallId: update.toolCallId,
          status: update.status,
          output: update.rawOutput,
        });
        break;
      }

      case 'plan': {
        // Agent 执行计划
        this.emitLog(sessionId, {
          type: 'plan',
          entries: update.entries,
        });
        break;
      }

      case 'diff': {
        // 文件修改
        this.emitLog(sessionId, {
          type: 'file_diff',
          path: update.path,
          diff: update.diff,
        });
        break;
      }
    }
  }

  onLog(sessionId: string, cb: LogCallback): void {
    if (!this.logCallbacks.has(sessionId)) {
      this.logCallbacks.set(sessionId, new Set());
    }
    this.logCallbacks.get(sessionId)!.add(cb);
  }

  onText(sessionId: string, cb: TextCallback): void {
    if (!this.textCallbacks.has(sessionId)) {
      this.textCallbacks.set(sessionId, new Set());
    }
    this.textCallbacks.get(sessionId)!.add(cb);
  }

  private emitLog(sessionId: string, data: unknown): void {
    const logCbs = this.logCallbacks.get(sessionId);
    logCbs?.forEach(cb => cb(JSON.stringify(data)));
  }
}
```

### 4.5 ACP Permission Handler

```typescript
// handlers/acp-permission.handler.ts

/**
 * 处理 Agent 发送的 session/request_permission 请求。
 * 根据 Role 的权限策略自动决定 allow/reject。
 */
class AcpPermissionHandler {
  constructor(
    private readonly toolPolicy: ToolPermissionPolicy,
    private readonly logger: ILogger,
  ) {}

  handlePermissionRequest(
    sessionContext: SessionContext,
    request: PermissionRequest,
  ): PermissionResponse {
    const { roleId, orgId } = sessionContext;
    const { toolCall, options } = request;

    // 根据策略评估
    const decision = this.toolPolicy.evaluate(roleId, toolCall);

    // 审计日志
    this.logger.info('Permission decision', {
      roleId,
      toolCallId: toolCall.toolCallId,
      title: toolCall.title,
      kind: toolCall.kind,
      decision: decision.allowed ? 'allow' : 'reject',
      reason: decision.reason,
    });

    // 返回 ACP 格式的响应
    if (decision.allowed) {
      const allowOption = options.find(o => o.kind === 'allow_once');
      return { outcome: { outcome: 'selected', optionId: allowOption!.optionId } };
    } else {
      const rejectOption = options.find(o => o.kind === 'reject_once');
      return { outcome: { outcome: 'selected', optionId: rejectOption!.optionId } };
    }
  }
}

/**
 * 工具调用权限策略引擎。
 * 基于 Role 配置的策略模式 (permissive / restrictive / ask_user)。
 */
class ToolPermissionPolicy {
  constructor(
    private readonly orgService: IOrgService,
  ) {}

  evaluate(roleId: string, toolCall: ToolCallInfo): PolicyDecision {
    const role = this.orgService.getRole(roleId);
    if (!role) return { allowed: false, reason: 'Role not found' };

    const policy = role.toolPolicy ?? 'permissive';

    switch (policy) {
      case 'permissive':
        // 默认允许，仅黑名单拦截
        return this.checkDenyList(toolCall);
      case 'restrictive':
        // 默认拒绝，仅白名单放行
        return this.checkAllowList(roleId, toolCall);
      case 'ask_user':
        // 暂不实现，降级为 permissive
        return this.checkDenyList(toolCall);
    }
  }

  private checkDenyList(toolCall: ToolCallInfo): PolicyDecision {
    // 高危操作黑名单
    const denyPatterns = [
      { kind: 'command', pattern: /rm\s+-rf/i },
      { kind: 'command', pattern: /drop\s+table/i },
      { kind: 'command', pattern: /format\s+/i },
    ];

    for (const deny of denyPatterns) {
      if (toolCall.kind === deny.kind && deny.pattern.test(toolCall.title)) {
        return { allowed: false, reason: `Denied by pattern: ${deny.pattern}` };
      }
    }
    return { allowed: true };
  }

  private checkAllowList(roleId: string, toolCall: ToolCallInfo): PolicyDecision {
    // TODO: 从 Role 配置中读取白名单
    // 暂时降级为 permissive
    return this.checkDenyList(toolCall);
  }
}
```

### 4.6 ACP File System Handler

```typescript
// handlers/acp-filesystem.handler.ts

import { resolve, relative } from 'node:path';
import { readFile, writeFile } from 'node:fs/promises';
import { minimatch } from 'minimatch';

/**
 * 实现 ACP 的 fs/read_text_file 和 fs/write_text_file。
 * 所有文件访问经过三层 allowlist 检查。
 */
class AcpFilesystemHandler {
  constructor(
    private readonly filePolicy: IFileAccessPolicy,
    private readonly logger: ILogger,
  ) {}

  async handleReadFile(
    sessionContext: SessionContext,
    params: { path: string; line?: number; limit?: number },
  ): Promise<{ content: string } | JsonRpcError> {
    const { roleId, cwd, allowedPaths } = sessionContext;

    const access = this.filePolicy.checkRead(params.path, cwd, allowedPaths);
    if (!access.allowed) {
      this.logger.warn('File read denied', { roleId, path: params.path, reason: access.reason });
      return { code: -32001, message: `Access denied: ${access.reason}` };
    }

    const content = await readFile(params.path, 'utf-8');

    if (params.line || params.limit) {
      const lines = content.split('\n');
      const start = (params.line ?? 1) - 1;
      const end = params.limit ? start + params.limit : lines.length;
      return { content: lines.slice(start, end).join('\n') };
    }

    return { content };
  }

  async handleWriteFile(
    sessionContext: SessionContext,
    params: { path: string; content: string },
  ): Promise<null | JsonRpcError> {
    const { roleId, cwd, allowedPaths } = sessionContext;

    const access = this.filePolicy.checkWrite(params.path, cwd, allowedPaths);
    if (!access.allowed) {
      this.logger.warn('File write denied', { roleId, path: params.path, reason: access.reason });
      return { code: -32001, message: `Access denied: ${access.reason}` };
    }

    this.logger.info('File write', { roleId, path: params.path, size: params.content.length });
    await writeFile(params.path, params.content, 'utf-8');
    return null;
  }
}
```

### 4.7 File Access Policy

```typescript
// policies/file-access.policy.ts

import { resolve, relative as relativePath } from 'node:path';
import { minimatch } from 'minimatch';

interface IFileAccessPolicy {
  checkRead(path: string, cwd: string, allowedPaths?: string[]): AccessDecision;
  checkWrite(path: string, cwd: string, allowedPaths?: string[]): AccessDecision;
}

interface AccessDecision {
  allowed: boolean;
  reason?: string;
}

/**
 * 三层文件访问控制：
 *   Layer 1: cwd 边界 — 路径必须在 cwd 内
 *   Layer 2: allowedPaths — 如果配置了，路径必须匹配白名单 glob
 *   Layer 3: denylist — 全局黑名单（.env, secrets 等）
 */
class DefaultFileAccessPolicy implements IFileAccessPolicy {
  private readonly globalDenyPatterns = [
    '**/.env',
    '**/.env.*',
    '**/secrets/**',
    '**/.git/objects/**',
    '**/node_modules/.cache/**',
  ];

  checkRead(path: string, cwd: string, allowedPaths?: string[]): AccessDecision {
    return this.check(path, cwd, allowedPaths);
  }

  checkWrite(path: string, cwd: string, allowedPaths?: string[]): AccessDecision {
    return this.check(path, cwd, allowedPaths);
  }

  private check(targetPath: string, cwd: string, allowedPaths?: string[]): AccessDecision {
    const resolved = resolve(targetPath);
    const resolvedCwd = resolve(cwd);

    // Layer 1: cwd 边界
    if (!resolved.startsWith(resolvedCwd)) {
      return { allowed: false, reason: `Path outside workspace: ${targetPath}` };
    }

    const rel = relativePath(resolvedCwd, resolved);

    // Layer 2: allowlist（如果配置了）
    if (allowedPaths && allowedPaths.length > 0) {
      const matched = allowedPaths.some(pattern => minimatch(rel, pattern));
      if (!matched) {
        return { allowed: false, reason: 'Path not in allowedPaths for this role' };
      }
    }

    // Layer 3: 全局黑名单
    const denied = this.globalDenyPatterns.some(pattern => minimatch(rel, pattern));
    if (denied) {
      return { allowed: false, reason: 'Path matches global deny pattern' };
    }

    return { allowed: true };
  }
}
```

### 4.8 ACP Agent Spawner

```typescript
// client/acp-agent.spawner.ts

import { spawn, type ChildProcess } from 'node:child_process';

/**
 * 管理 ACP Agent 子进程的生命周期。
 * 每个 Agent 配置对应一个可复用的子进程（多 session 共享同一进程）。
 */
class AcpAgentSpawner {
  private processes = new Map<string, AgentProcess>();

  constructor(
    private readonly config: AgentRegistryConfig,
    private readonly logger: ILogger,
  ) {}

  /**
   * 获取或启动 Agent 进程。
   * ACP 协议支持一个 Agent 进程承载多个 session。
   */
  async getOrSpawn(agentId: string): Promise<AgentProcess> {
    const existing = this.processes.get(agentId);
    if (existing && !existing.exited) return existing;

    const entry = this.config.registry.find(a => a.id === agentId);
    if (!entry) throw new CapibaraError('AGENT_NOT_FOUND', `Agent not registered: ${agentId}`);

    const child = spawn(entry.command, entry.args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, ...entry.env },
      windowsHide: true,
    });

    const agentProcess: AgentProcess = {
      agentId,
      child,
      exited: false,
      capabilities: null,
    };

    child.on('exit', (code) => {
      agentProcess.exited = true;
      this.processes.delete(agentId);
      this.logger.info('Agent process exited', { agentId, code });
    });

    // ACP initialize handshake
    agentProcess.capabilities = await this.initialize(child, entry);

    this.processes.set(agentId, agentProcess);
    return agentProcess;
  }

  /**
   * ACP initialize 握手。
   * 交换协议版本和能力。
   */
  private async initialize(child: ChildProcess, entry: AgentRegistryEntry): Promise<AgentCapabilities> {
    const transport = new JsonRpcTransport(child.stdin!, child.stdout!);

    const response = await transport.request('initialize', {
      protocolVersion: '0.1',
      clientInfo: { name: 'capibara', version: '1.0.0' },
      capabilities: {
        fileSystem: { readTextFile: true, writeTextFile: true },
      },
    });

    return {
      supportsResume: response.capabilities?.sessionCapabilities?.resume ?? false,
      supportsLoad: response.capabilities?.sessionCapabilities?.load ?? false,
      supportedMcpTransports: response.capabilities?.mcpTransports ?? ['stdio'],
    };
  }

  /**
   * 终止所有 Agent 进程（应用关闭时调用）。
   */
  async shutdown(): Promise<void> {
    for (const [agentId, proc] of this.processes) {
      if (!proc.exited) {
        proc.child.kill('SIGTERM');
        this.logger.info('Agent process terminated', { agentId });
      }
    }
    this.processes.clear();
  }
}

interface AgentProcess {
  agentId: string;
  child: ChildProcess;
  exited: boolean;
  capabilities: AgentCapabilities | null;
}
```

---

## 5. AI↔AI 多模式协作设计

### 5.1 协作模式总览

系统支持四种 Agent 间协作模式，复杂度递增：

| 模式 | 描述 | 会话数 | 复杂度 |
|------|------|--------|--------|
| 模式 1 | 单轮问答：A 问 B, B 答, A 恢复 | 2 | 低 |
| 模式 2 | 多轮对话：A 与 B 反复交流 | 2+N | 低 |
| 模式 3 | 链式协作：A→B→C→A | 3+ | 中 |
| 模式 4 | 广播询问：A 同时问 B+C | 3+ | 中 |

### 5.2 模式 1: 单轮问答

```
时间线：
  t0  Session_A: prompt → Agent-A 执行
  t1  Agent-A 调用 MCP: capibara_ask_question(target: B, question: "...")
  t2  MCP tool 返回 { inquiryId, status: 'pending' }
  t3  Agent-A turn 结束 (stopReason: 'end_turn')
  t4  SuspensionManager: 挂起 Session_A (awaiting: [inquiryId])
      AcpSessionManager: session/close(A)
  t5  InquiryRouter: 路由到 Role-B
  t6  ConversationOrchestrator: 创建 Session_B, prompt 注入问题
  t7  Agent-B 执行, 调用 capibara_reply(inquiryId, answer: "...")
  t8  Agent-B turn 结束 → 关闭 Session_B
  t9  SuspensionManager: 标记 inquiryId resolved
      → 所有 awaiting resolved → 触发恢复
  t10 AcpSessionManager: session/resume(A) 或 session/load(A) 或 rebuild(A)
  t11 AcpSessionManager: session/prompt(A, "Role-B 的回复: ...")
  t12 Agent-A 在完整上下文中继续工作
```

**会话状态流转**：
```
Session_A: active → suspended(awaiting:[inq_1]) → resumed → active → closed
Session_B: created → active → closed
```

### 5.3 模式 2: 多轮对话

```
时间线：
  t0-t8   同模式 1（A 问 B, B 答 A）
  t9-t11  A 恢复, 注入 B 的回复, 继续执行
  t12     Agent-A 再次调用 capibara_ask_question(target: B, question: "后续问题")
  t13     Agent-A turn 结束
  t14     SuspensionManager: 再次挂起 Session_A (awaiting: [inq_2])
  t15-t19 同模式 1（B 再次回答）
  t20     恢复 Session_A, 注入第二次回复
  t21     Agent-A 继续（上下文保留完整两轮对话历史）
```

**关键要求**：
- Session_A 支持**多次 suspend/resume 循环**
- ACP `session/resume` 可以在同一会话上多次调用
- `resumeCount` 字段追踪恢复次数
- 每次恢复时的 prompt 注入携带对话 ID 标识

**会话状态流转**：
```
Session_A: active → suspended → resumed → active → suspended → resumed → active → closed
Session_B:  [第一轮: created → active → closed]
Session_B': [第二轮: created → active → closed] (新会话)
```

**设计决策**：Response Session (B) 每轮**新建**而非复用。原因：
- B 的每次回答是独立 turn，无需保持 B 的跨轮上下文
- B 只需：问题内容 + 角色/任务上下文（由 `PromptBuilder.buildForConversation()` 构建）
- 避免维护多个长生命周期 session 的复杂度

### 5.4 模式 3: 链式协作

```
时间线：
  t0-t3   A 执行, 问 B
  t4      SuspensionManager: 挂起 Session_A
          → 依赖栈: [A(awaiting inq_1)]
  t5-t6   创建 Session_B, prompt 注入 A 的问题
  t7      Agent-B 执行中, 调用 capibara_ask_question(target: C)
  t8      Agent-B turn 结束
  t9      SuspensionManager: 挂起 Session_B
          → 依赖栈: [A(awaiting inq_1), B(awaiting inq_2)]
          → B.parentSuspensionId = A.suspensionId
  t10-t11 创建 Session_C, prompt 注入 B 的问题
  t12     Agent-C 回答 inq_2
  t13     关闭 Session_C
  t14     SuspensionManager: inq_2 resolved → 恢复 Session_B
  t15     Agent-B 继续, 调用 capibara_reply(inq_1, answer)
  t16     关闭 Session_B
  t17     SuspensionManager: inq_1 resolved → 恢复 Session_A
  t18     Agent-A 继续工作（上下文完整）
```

**依赖栈（LIFO 解决）**：
```
Push:  A suspended → B suspended
Pop:   C resolves inq_2 → B resumes → B resolves inq_1 → A resumes
```

**深度防护**：
- `chainDepth` 字段追踪当前嵌套深度
- 配置 `maxChainDepth`（默认 5），超过时 `capibara_ask_question` 返回错误
- Agent 收到错误后需要自行处理（不挂起，直接在 turn 内解决或放弃）

### 5.5 模式 4: 广播询问

```
时间线：
  t0-t2   A 执行, 调用 capibara_broadcast_question(targets: [B, C])
          或分两次: capibara_ask_question(B) + capibara_ask_question(C) (在同一 turn 内)
  t3      Agent-A turn 结束, pendingInquiries: [inq_1, inq_2]
  t4      SuspensionManager: 挂起 Session_A
          → awaiting: [inq_1(→B), inq_2(→C)], aggregationMode: 'all'
  t5      并行: 创建 Session_B (处理 inq_1)
          并行: 创建 Session_C (处理 inq_2)
          注: 如果 B ≠ C (不同 Role) 可以真正并行
              如果 B = C (同一 Role) 则串行（WakeGateValidator 约束）
  t6      Agent-B 回答 inq_1 ✓
  t7      SuspensionManager: 标记 inq_1 resolved
          → 检查: all resolved? → 否 (inq_2 still pending)
  t8      Agent-C 回答 inq_2 ✓
  t9      SuspensionManager: 标记 inq_2 resolved
          → 检查: all resolved? → 是!
  t10     恢复 Session_A, 注入聚合回复:
          "## Role-B 的回复\n{answer_1}\n\n## Role-C 的回复\n{answer_2}"
  t11     Agent-A 继续（拥有所有回复）
```

**聚合模式**：
- `'all'` — 等待所有 inquiry 回复后恢复（默认）
- `'any'` — 任意一个回复即恢复（预留，暂不实现）

**并行约束**：
- `WakeGateValidator` 已有规则：同一 Role 在 Org 内只允许一个活跃 Run
- 不同 Role 可以真正并行（不同 Agent 子进程独立运行）
- `capibara_broadcast_question` 工具用于多目标广播

### 5.6 Session Suspension Manager（核心组件）

```typescript
// collaboration/session-suspension.manager.ts

interface ISessionSuspensionManager {
  /**
   * 挂起一个会话，记录等待的 inquiry 列表。
   */
  suspend(params: SuspendParams): Promise<SessionSuspension>;

  /**
   * 当某个 inquiry 被回复时调用。
   * 检查关联的 suspension 是否可以恢复。
   */
  onInquiryResolved(inquiryId: string, response: string): Promise<void>;

  /**
   * 获取某个 inquiry 所属的 suspension（用于依赖图查询）。
   */
  findSuspensionByInquiry(inquiryId: string): SessionSuspension | null;

  /**
   * 计算当前链深度（用于防护检查）。
   */
  getChainDepth(orgId: string, fromRoleId: string): number;
}

interface SuspendParams {
  sessionId: string;
  roleId: string;
  orgId: string;
  awaitingInquiries: PendingInquiry[];
  aggregationMode: 'all' | 'any';
  parentSuspensionId?: string;  // 链式协作时指向上游
}

interface SessionSuspension {
  id: string;
  sessionId: string;
  roleId: string;
  orgId: string;
  awaitingInquiries: AwaitingInquiry[];
  aggregationMode: 'all' | 'any';
  parentSuspensionId: string | null;
  chainDepth: number;
  resumeStrategy: 'resume' | 'load' | 'rebuild';
  status: 'suspended' | 'resumed' | 'timed_out' | 'cancelled';
  suspendedAt: string;
  resumedAt: string | null;
}

interface AwaitingInquiry {
  inquiryId: string;
  conversationId: string;
  respondentRoleId: string;
  respondentSessionId: string | null;
  status: 'pending' | 'in_progress' | 'resolved' | 'timed_out';
  response: string | null;
  resolvedAt: string | null;
}

/**
 * 实现核心协作逻辑。
 */
class SessionSuspensionManager implements ISessionSuspensionManager {
  constructor(
    private readonly suspensionRepo: ISuspensionRepository,
    private readonly acpSessionManager: IAcpSessionManager,
    private readonly promptBuilder: PromptBuilder,
    private readonly config: CollaborationConfig,
    private readonly logger: ILogger,
  ) {}

  async suspend(params: SuspendParams): Promise<SessionSuspension> {
    const { sessionId, roleId, orgId, awaitingInquiries, aggregationMode, parentSuspensionId } = params;

    // 计算链深度
    const chainDepth = parentSuspensionId
      ? (await this.suspensionRepo.findById(parentSuspensionId))!.chainDepth + 1
      : 0;

    // 深度检查
    if (chainDepth >= this.config.maxChainDepth) { // 默认 5
      throw new CapibaraError('CHAIN_DEPTH_EXCEEDED',
        `Chain depth ${chainDepth} exceeds max ${this.config.maxChainDepth}`);
    }

    // 确定恢复策略（基于 Agent 能力）
    const capabilities = this.acpSessionManager.getAgentCapabilities(
      /* resolve agent for role */
    );
    const resumeStrategy = capabilities.supportsResume ? 'resume'
      : capabilities.supportsLoad ? 'load'
      : 'rebuild';

    // 关闭 ACP 会话（保留状态）
    await this.acpSessionManager.closeSession(sessionId);

    // 持久化 suspension 记录
    const suspension: SessionSuspension = {
      id: generateId(),
      sessionId,
      roleId,
      orgId,
      awaitingInquiries: awaitingInquiries.map(inq => ({
        inquiryId: inq.inquiryId,
        conversationId: inq.conversationId,
        respondentRoleId: inq.targetRoleId,
        respondentSessionId: null,
        status: 'pending',
        response: null,
        resolvedAt: null,
      })),
      aggregationMode,
      parentSuspensionId: parentSuspensionId ?? null,
      chainDepth,
      resumeStrategy,
      status: 'suspended',
      suspendedAt: new Date().toISOString(),
      resumedAt: null,
    };

    await this.suspensionRepo.create(suspension);
    this.logger.info('Session suspended', { sessionId, chainDepth, awaitingCount: awaitingInquiries.length });
    return suspension;
  }

  async onInquiryResolved(inquiryId: string, response: string): Promise<void> {
    // 1. 找到等待此 inquiry 的 suspension
    const suspension = await this.suspensionRepo.findByAwaitingInquiry(inquiryId);
    if (!suspension || suspension.status !== 'suspended') return;

    // 2. 标记该 inquiry 为 resolved
    const inquiry = suspension.awaitingInquiries.find(i => i.inquiryId === inquiryId);
    if (!inquiry || inquiry.status === 'resolved') return;

    inquiry.status = 'resolved';
    inquiry.response = response;
    inquiry.resolvedAt = new Date().toISOString();
    await this.suspensionRepo.updateInquiryStatus(suspension.id, inquiryId, inquiry);

    // 3. 检查是否满足恢复条件
    const isReady = suspension.aggregationMode === 'all'
      ? suspension.awaitingInquiries.every(i => i.status === 'resolved')
      : suspension.awaitingInquiries.some(i => i.status === 'resolved');

    if (!isReady) {
      this.logger.info('Inquiry resolved but suspension not ready', {
        suspensionId: suspension.id,
        resolved: suspension.awaitingInquiries.filter(i => i.status === 'resolved').length,
        total: suspension.awaitingInquiries.length,
      });
      return;
    }

    // 4. 所有条件满足 → 恢复会话
    await this.resumeSession(suspension);
  }

  private async resumeSession(suspension: SessionSuspension): Promise<void> {
    const { sessionId, awaitingInquiries, resumeStrategy } = suspension;

    // 5. 构建聚合回复 prompt
    const replyContent = this.buildAggregatedReply(awaitingInquiries);

    // 6. 恢复 ACP 会话
    switch (resumeStrategy) {
      case 'resume':
        await this.acpSessionManager.resumeSession(sessionId);
        break;
      case 'load':
        // session/load — replay 历史，Agent 重建上下文
        await this.acpSessionManager.resumeSession(sessionId); // 内部降级
        break;
      case 'rebuild':
        // 不支持 resume/load — 需要全新 session + 完整上下文重建
        // 由 RunCoordinator 处理（回退到新 Run 的方式）
        this.logger.warn('Agent does not support resume, rebuilding context', { sessionId });
        break;
    }

    // 7. 注入聚合回复
    await this.acpSessionManager.prompt(sessionId, replyContent);

    // 8. 更新状态
    suspension.status = 'resumed';
    suspension.resumedAt = new Date().toISOString();
    await this.suspensionRepo.updateStatus(suspension.id, suspension);

    this.logger.info('Session resumed', {
      sessionId,
      strategy: resumeStrategy,
      repliesInjected: awaitingInquiries.length,
    });
  }

  private buildAggregatedReply(inquiries: AwaitingInquiry[]): PromptContent[] {
    if (inquiries.length === 1) {
      // 单回复 — 简洁格式
      const inq = inquiries[0]!;
      return [{
        type: 'text',
        text: `你之前向 ${inq.respondentRoleId} 提出的问题已获得回复：\n\n${inq.response}`,
      }];
    }

    // 多回复 — 结构化聚合格式
    const parts: string[] = ['你之前提出的多个问题已全部获得回复：\n'];
    for (const inq of inquiries) {
      parts.push(`## 来自 ${inq.respondentRoleId} 的回复\n${inq.response}\n`);
    }
    parts.push('请基于以上所有回复继续你的工作。');

    return [{ type: 'text', text: parts.join('\n') }];
  }

  getChainDepth(orgId: string, fromRoleId: string): number {
    // 查询当前 org 中与该 role 相关的最大挂起链深度
    const activeSuspensions = this.suspensionRepo.findActiveByOrg(orgId);
    let maxDepth = 0;
    for (const s of activeSuspensions) {
      if (s.awaitingInquiries.some(i => i.respondentRoleId === fromRoleId)) {
        maxDepth = Math.max(maxDepth, s.chainDepth + 1);
      }
    }
    return maxDepth;
  }
}
```

### 5.7 MCP 工具变更（capibara_ask_question + capibara_broadcast_question）

```typescript
// 扩展 capibara_ask_question 保持单目标语义
// 新增 capibara_broadcast_question 用于广播场景

// capibara_ask_question — 保持原有签名（单目标）:
interface AskQuestionInput {
  targetRoleId: string;              // 单个目标
  question: string;
  context?: string;
}

// capibara_broadcast_question — 新工具（多目标广播）:
interface BroadcastQuestionInput {
  targetRoleIds: string[];           // 多个目标
  question: string;
  context?: string;
  waitMode?: 'all' | 'any';         // 默认 'all'
}

// MCP tool handler:
async function handleAskQuestion(input: AskQuestionInput, sessionContext: McpSessionContext) {
  const targets = [input.targetRoleId];
  // ... 其余逻辑与下方 handleBroadcastQuestion 共享
  return handleInquiryCreation(targets, 'all', input, sessionContext);
}

async function handleBroadcastQuestion(input: BroadcastQuestionInput, sessionContext: McpSessionContext) {
  const targets = input.targetRoleIds;
  return handleInquiryCreation(targets, input.waitMode ?? 'all', input, sessionContext);
}

async function handleInquiryCreation(
  targets: string[],
  waitMode: 'all' | 'any',
  input: { question: string; context?: string },
  sessionContext: McpSessionContext,
) {

  // 链深度检查
  const currentDepth = suspensionManager.getChainDepth(
    sessionContext.orgId,
    sessionContext.roleId,
  );
  if (currentDepth >= config.maxChainDepth) {
    return {
      error: `Chain depth limit reached (${config.maxChainDepth}). Cannot create nested inquiry.`,
      suggestion: 'Try to resolve this question yourself based on available context.',
    };
  }

  // 循环检测：不允许回问发起者
  const activeSuspension = suspensionManager.findActiveSuspensionForRole(
    sessionContext.orgId,
    sessionContext.roleId,
  );
  if (activeSuspension) {
    const wouldCycle = targets.some(t =>
      activeSuspension.awaitingInquiries.some(i => i.respondentRoleId === t)
    );
    if (wouldCycle) {
      return { error: 'Circular inquiry detected. Cannot ask a role that is waiting for your response.' };
    }
  }

  // 为每个目标创建 inquiry
  const inquiries: PendingInquiry[] = [];
  for (const targetRoleId of targets) {
    const conversation = await conversationService.createInquiry({
      initiatorRoleId: sessionContext.roleId,
      respondentRoleId: targetRoleId,
      orgId: sessionContext.orgId,
      question: input.question,
      context: input.context,
    });
    inquiries.push({
      inquiryId: conversation.inquiryId,
      conversationId: conversation.id,
      targetRoleId,
      question: input.question,
    });
  }

  return {
    inquiries: inquiries.map(i => ({
      inquiryId: i.inquiryId,
      targetRoleId: i.targetRoleId,
      status: 'pending',
    })),
    waitMode: input.waitMode ?? 'all',
    message: targets.length === 1
      ? `Question sent to ${targets[0]}. Your session will be suspended until a reply is received.`
      : `Questions broadcast to ${targets.join(', ')}. Your session will be suspended until ${waitMode === 'all' ? 'all replies are' : 'any reply is'} received.`,
  };
}
```

### 5.8 安全防护体系

| 防护 | 实现位置 | 规则 | 默认值 |
|------|---------|------|--------|
| 最大链深度 | `ChainDepthGuard` | chainDepth ≤ N | 5 |
| 循环检测 | `capibara_ask_question` handler | 不允许回问正在等待自己回复的 Role | - |
| 超时 | `InquiryEscalationService`（已有） | 超时升级/取消 | 可配置 |
| 并行限制 | `WakeGateValidator`（已有） | 同 Role 不并行 Session | - |
| 最大 awaiting 数 | `SessionSuspensionManager` | 单次广播最多 N 个目标 | 5 |
| 最大 resume 次数 | `AcpSession.resumeCount` | 防止无限来回 | 10 |

### 5.9 Orchestrator 改动

```typescript
// ConversationOrchestrator 核心改动

// 现有: 接收 conversation:response-needed 事件 → 排队 PendingWake → 执行
// 改后: 接收事件 → 创建 Suspension → 创建 respondent session → 回复后触发 resume

class ConversationOrchestrator {
  // ...

  /**
   * 当 inquiry 被路由到 respondent 后触发。
   * 为 respondent 创建执行。
   */
  private async onResponseNeeded(event: DomainEvent): Promise<void> {
    const { conversationId, orgId, roleId: respondentRoleId } = event.payload;

    // 门控检查（保留现有逻辑）
    const gateResult = this.wakeGateValidator.check(respondentRoleId, orgId);
    if (!gateResult.allowed) {
      // 被门阻止 → 创建一个待调度的 Suspension (aggregationMode='none')
      await this.suspensionRepo.createPending({ roleId: respondentRoleId, orgId, conversationId, ... });
      return;
    }

    // 创建 respondent 的执行
    await this.runCoordinator.executeForConversation(conversationId, respondentRoleId, orgId);
  }

  /**
   * 当 conversation 被解决时触发（respondent 回复了）。
   * 通知 SuspensionManager 检查是否可以恢复发起者。
   */
  private async onConversationResolved(event: DomainEvent): Promise<void> {
    const { conversationId, inquiryId, response } = event.payload;

    // 通知 suspension manager — 它会自动检查并恢复
    await this.suspensionManager.onInquiryResolved(inquiryId, response);
  }
}
```

---

## 6. 权限与文件访问控制

### 6.1 P2 解决方案：ACP Permission System + 策略引擎

```
ACP Permission 拦截流程：

Agent 想执行某操作
  → session/request_permission {
      toolCall: { toolCallId, title, kind },
      options: [allow_once, reject_once, ...]
    }
  → AcpPermissionHandler.handlePermissionRequest()
    → ToolPermissionPolicy.evaluate(roleId, toolCall)
    → 返回 allow / reject

注意: ACP 协议中 request_permission 是 MAY（非强制）。
因此文件安全的根本保障在 fs/* handler（不可绕过），
而非 permission system（可被绕过）。
```

### 6.2 P3 解决方案：三层文件防护

```
Layer 1 — ACP cwd 边界（协议建议级）
  session/new { cwd: "/project/workspace" }
  → Agent SHOULD 不超出 cwd 范围（但非强制）

Layer 2 — fs/* 方法 allowlist（代码级 —— 不可绕过）★ 核心防线
  Agent 调用 fs/read_text_file { path: ".env" }
  → AcpFilesystemHandler.handleReadFile()
  → DefaultFileAccessPolicy.check()
  → 命中全局黑名单 '**/.env' → ❌ 返回 JSON-RPC error
  → Agent 无法读取文件内容

Layer 3 — MCP context 工具感知限制（信息层）
  capibara_context(query: 'file_tree')
  → 只返回 allowedPaths 内的文件列表
  → Agent 对白名单外的文件无感知（但不是硬性防护）

审计: 所有 fs/* 调用记录到 file_access_log 表
```

### 6.3 Role 权限配置扩展

```typescript
// 在 Role 模型上扩展（DB schema 变更见第 8 章）

interface RoleSecurityConfig {
  fileAccessPaths?: string[];     // glob 白名单: ["src/components/**", "tests/**"]
  toolPolicy: 'permissive' | 'restrictive' | 'ask_user';
}

// 策略说明:
// permissive  — 默认允许，仅黑名单拦截（适合开发角色）
// restrictive — 默认拒绝，仅白名单放行（适合受限角色）
// ask_user    — 弹窗询问用户（未来实现，暂降级为 permissive）
```

---

## 7. 模块级改动清单

### 7.1 删除的文件

| 文件 | 原职责 | 替代方案 |
|------|--------|---------|
| `infrastructure/adapters/claude-cli.adapter.ts` | CLI 参数构建 + spawn | `AcpAgentSpawner` |
| `infrastructure/adapters/claude-stream-parser.ts` | 解析 stream-json | `AcpUpdateHandler` |
| `infrastructure/adapters/i-cli-adapter.ts` | 接口定义 | 不再需要 |
| `modules/execution/workers/worker.ts` | utilityProcess 入口 | `AcpExecutor` |
| `modules/execution/workers/worker-protocol.ts` | IPC 消息类型 | ACP JSON-RPC |
| `modules/execution/workers/worker-service.ts` | utilityProcess 管理 | `AcpAgentSpawner` |
| `modules/execution/workers/utility-process.executor.ts` | `IExecutor` 实现 | `AcpExecutor` |
| `modules/execution/workers/stream-json-parser.ts` | 行级 JSON 解析 | `AcpUpdateHandler` |
| `modules/mcp/bridge/capibara-mcp-bridge.ts` | stdio↔HTTP 桥接进程 | ACP 原生 MCP 集成 |
| `modules/mcp/server/mcp-ipc.server.ts` | HTTP tool call 中继 | MCP stdio server |
| `modules/mcp/config/mcp-config-generator.ts` | 生成临时 MCP JSON | `acp-mcp.config.ts` |
| `modules/orchestrator/pending-wake.repository.ts` | PendingWake 持久化 | `SessionSuspension` 统一替代 |
| `infrastructure/persistence/sqlite-pending-wake.repository.ts` | PendingWake SQLite 实现 | `sqlite-suspension.repository.ts` |

### 7.2 新增的文件

| 文件 | 职责 |
|------|------|
| `modules/acp/client/acp-session.manager.ts` | **核心**: 管理 ACP 会话生命周期 |
| `modules/acp/client/acp-agent.spawner.ts` | spawn ACP agent 子进程, 管理进程生命周期 |
| `modules/acp/client/acp-jsonrpc.transport.ts` | JSON-RPC over stdio 传输层 |
| `modules/acp/client/acp-executor.ts` | `IExecutor` 新实现, 桥接 RunEngine → ACP |
| `modules/acp/handlers/acp-permission.handler.ts` | 处理 `session/request_permission` |
| `modules/acp/handlers/acp-filesystem.handler.ts` | 实现 `fs/read_text_file`, `fs/write_text_file` |
| `modules/acp/handlers/acp-update.handler.ts` | 处理 `session/update` 事件流 |
| `modules/acp/policies/file-access.policy.ts` | 文件访问策略引擎 |
| `modules/acp/policies/tool-permission.policy.ts` | 工具调用权限策略引擎 |
| `modules/acp/collaboration/session-suspension.manager.ts` | **核心**: 会话挂起/恢复/依赖图 |
| `modules/acp/collaboration/inquiry-aggregator.ts` | 多回复聚合格式化 |
| `modules/acp/collaboration/chain-depth.guard.ts` | 链式协作深度防护 |
| `modules/acp/interfaces/i-acp-session.manager.ts` | 接口定义 |
| `modules/acp/interfaces/i-file-access.policy.ts` | 文件策略接口 |
| `modules/acp/interfaces/i-session-suspension.manager.ts` | 挂起管理器接口 |
| `modules/acp/types/acp.types.ts` | ACP 协议类型定义 |
| `modules/acp/mcp/acp-mcp.config.ts` | 为 ACP session 构建 MCP server 配置 |
| `modules/acp/mcp/stdio-mcp-server.ts` | stdio 传输的 MCP server（替代 HTTP） |
| `bootstrap/acp.module.ts` | ACP 模块 DI 注册 |
| `infrastructure/persistence/sqlite-suspension.repository.ts` | Suspension 持久化 |

### 7.3 修改的文件

| 文件 | 改动内容 |
|------|---------|
| `modules/execution/engines/run.engine.ts` | 最小改动：新增 `'suspended'` 状态处理；保留所有现有逻辑（日志、cost、事件）；`IExecutor` 依赖不变 |
| `modules/execution/types/execution.types.ts` | `RunStatus` 新增 `'suspended'`；`ExecutorOutput.status` 新增 `'suspended'` |
| `modules/orchestrator/orchestrators/conversation.orchestrator.ts` | 注入 `ISessionSuspensionManager`；`onConversationResolved` 中调用 `suspensionManager.onInquiryResolved()` |
| `modules/orchestrator/orchestrators/run.orchestrator.ts` | `onRunSucceeded` 中检查 suspension 状态：如果 run 是 suspended，不执行 `drainSuspensions` |
| `modules/orchestrator/run.coordinator.ts` | `executeForTask/executeForConversation` 中适配 suspended 返回值 |
| `modules/mcp/tools/conversation-tools.ts` | `capibara_ask_question` 保持单目标；新增 `capibara_broadcast_question` 工具；chainDepth 检查 + 循环检测 |
| `modules/prompt/builder/prompt.builder.ts` | 输出适配: 返回 `PromptContent[]` 格式（ACP 兼容）|
| `modules/notification/event-broadcaster.ts` | 新增 `run:suspended`、`run:resumed` 事件映射 |
| `config/config.types.ts` | `cli` 块 → `agents` 块；新增 `collaboration` 配置块 |
| `bootstrap/composition-root.ts` | 调用 `registerAcpModule()`；删除 `registerExecutionModule()` 中的 worker 相关注册 |
| `bootstrap/execution.module.ts` | 删除 WorkerService/UtilityProcessExecutor 注册；改为注册 AcpExecutor |
| `foundation/tokens.ts` | 新增 `ACP_SESSION_MANAGER_TOKEN`, `ACP_EXECUTOR_TOKEN`, `SESSION_SUSPENSION_MANAGER_TOKEN` 等；删除 `WORKER_SERVICE_TOKEN` |
| `foundation/events.ts` | 新增 `'run:suspended'`, `'run:resumed'` 事件类型 |
| `electron.vite.config.ts` | 删除 `capibara-worker` 和 `capibara-mcp-bridge` 构建入口 |
| `shared/api.ts` | 新增 `getAcpSessions()`, `getSessionSuspensions()` 等 API |
| `preload/index.ts` | 暴露新增 API 方法 |

---

## 8. 数据模型变更

### 8.1 新增表

```sql
-- ACP 会话状态跟踪
CREATE TABLE acp_sessions (
  id              TEXT PRIMARY KEY,
  acp_session_id  TEXT NOT NULL,          -- ACP 协议返回的 session ID
  agent_id        TEXT NOT NULL,           -- 配置中的 agent 标识
  role_id         TEXT NOT NULL REFERENCES roles(id),
  org_id          TEXT NOT NULL REFERENCES organizations(id),
  run_id          TEXT REFERENCES runs(id),
  status          TEXT NOT NULL DEFAULT 'active',  -- active | suspended | closed | error
  cwd             TEXT NOT NULL,
  allowed_paths   TEXT,                    -- JSON array
  resume_strategy TEXT NOT NULL DEFAULT 'resume',  -- resume | load | rebuild
  resume_count    INTEGER NOT NULL DEFAULT 0,
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  closed_at       TEXT
);
CREATE INDEX idx_acp_sessions_role_org ON acp_sessions(role_id, org_id, status);

-- 会话挂起记录（AI↔AI 协作核心）
CREATE TABLE session_suspensions (
  id                    TEXT PRIMARY KEY,
  session_id            TEXT NOT NULL REFERENCES acp_sessions(id),
  role_id               TEXT NOT NULL,
  org_id                TEXT NOT NULL,
  aggregation_mode      TEXT NOT NULL DEFAULT 'all',   -- 'all' | 'any'
  parent_suspension_id  TEXT REFERENCES session_suspensions(id),
  chain_depth           INTEGER NOT NULL DEFAULT 0,
  resume_strategy       TEXT NOT NULL DEFAULT 'resume',
  status                TEXT NOT NULL DEFAULT 'suspended', -- suspended | resumed | timed_out | cancelled
  suspended_at          TEXT NOT NULL DEFAULT (datetime('now')),
  resumed_at            TEXT
);
CREATE INDEX idx_suspensions_status ON session_suspensions(org_id, status);

-- 挂起会话等待的 inquiry 列表
CREATE TABLE suspension_awaiting (
  id                    TEXT PRIMARY KEY,
  suspension_id         TEXT NOT NULL REFERENCES session_suspensions(id),
  inquiry_id            TEXT NOT NULL,
  conversation_id       TEXT NOT NULL,
  respondent_role_id    TEXT NOT NULL,
  respondent_session_id TEXT,
  status                TEXT NOT NULL DEFAULT 'pending', -- pending | in_progress | resolved | timed_out
  response              TEXT,
  resolved_at           TEXT
);
CREATE INDEX idx_awaiting_inquiry ON suspension_awaiting(inquiry_id);
CREATE INDEX idx_awaiting_suspension ON suspension_awaiting(suspension_id);

-- 删除 pending_wakes 表（功能由 session_suspensions 统一替代）
DROP TABLE IF EXISTS pending_wakes;

-- 文件访问审计日志
CREATE TABLE file_access_log (
  id          TEXT PRIMARY KEY,
  session_id  TEXT NOT NULL REFERENCES acp_sessions(id),
  role_id     TEXT NOT NULL,
  path        TEXT NOT NULL,
  operation   TEXT NOT NULL,   -- 'read' | 'write'
  allowed     INTEGER NOT NULL, -- 0 | 1
  reason      TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 工具调用审计日志
CREATE TABLE tool_call_log (
  id            TEXT PRIMARY KEY,
  session_id    TEXT NOT NULL REFERENCES acp_sessions(id),
  run_id        TEXT REFERENCES runs(id),
  tool_call_id  TEXT NOT NULL,
  title         TEXT NOT NULL,
  kind          TEXT,            -- 'read' | 'edit' | 'command' | 'other'
  status        TEXT NOT NULL,   -- 'pending' | 'completed' | 'failed'
  permission    TEXT,            -- 'allowed' | 'rejected' | 'not_requested'
  raw_input     TEXT,            -- JSON
  raw_output    TEXT,            -- JSON
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  completed_at  TEXT
);
```

### 8.2 修改表

```sql
-- roles 表新增列
ALTER TABLE roles ADD COLUMN file_access_paths TEXT;     -- JSON: ["src/**", "tests/**"]
ALTER TABLE roles ADD COLUMN tool_policy TEXT DEFAULT 'permissive';

-- runs 表新增列
ALTER TABLE runs ADD COLUMN acp_session_id TEXT;          -- 关联 ACP 会话
ALTER TABLE runs ADD COLUMN agent_id TEXT;                -- 使用的 agent 标识
-- runs 表 status 列：新增 'suspended' 值
```

### 8.3 保留不变的表

`organizations`, `skills`, `tasks`, `conversations`, `conversation_messages`, `outbox`, `cost_entries`, `plan_tree_nodes`, `process_schemas`, `settings`

> **注意**: `pending_wakes` 表将被**删除**，其功能完全由 `session_suspensions` + `suspension_awaiting` 统一替代。所有调度场景（包括非协作的简单唤醒）统一使用 Suspension 模型。

---

## 9. 配置变更

### 9.1 新配置结构

```typescript
interface CapibaraConfig {
  organization: { template: string; customFile: string | null };
  execution: {
    maxReviseAttempts: number;
    maxRetryOnFailure: number;
    maxConsecutiveWakes: number;
    maxDecompositionDepth: number;
    retryBackoffMs: number;
    maxTurnsPerRun: number;        // 从 cli 移至此处
  };
  agents: {
    defaultAgent: string;                  // 默认使用的 agent ID
    registry: AgentRegistryEntry[];        // 已注册的 agent 列表
    globalFilePolicy: {
      denyPatterns: string[];              // 全局文件黑名单
    };
  };
  collaboration: {
    maxChainDepth: number;                 // 链式协作最大深度 (默认 5)
    maxBroadcastTargets: number;           // 广播询问最大目标数 (默认 5)
    maxResumeCount: number;                // 单会话最大恢复次数 (默认 10)
    inquiryTimeoutMs: number;              // 询问超时 (默认 300000 = 5min)
  };
  skills: { provider: string; bmadRoot: string };
  database: { driver: 'sqlite'; sqlitePath: string };
  logging: { level: string; logDir: string };
}

interface AgentRegistryEntry {
  id: string;                              // 'copilot' | 'claude-agent' | 'gemini-cli'
  name: string;                            // 显示名称
  command: string;                         // 可执行文件路径
  args: string[];                          // 启动参数
  env?: Record<string, string>;            // 环境变量
  capabilities?: {                         // 手动覆盖（优先于 initialize 检测）
    supportsResume?: boolean;
    supportsLoad?: boolean;
  };
  roleBindings?: Record<string, string>;   // roleId → agentId 映射（可选）
}
```

### 9.2 配置示例

```yaml
agents:
  defaultAgent: claude-agent
  registry:
    - id: claude-agent
      name: Claude Agent
      command: claude-agent-acp
      args: []
    - id: codex-cli
      name: Codex CLI
      command: codex
      args: []
    - id: gemini-cli
      name: Gemini CLI
      command: gemini
      args: ['--acp']
    - id: copilot
      name: GitHub Copilot
      command: github-copilot-agent
      args: []
  globalFilePolicy:
    denyPatterns:
      - '**/.env'
      - '**/.env.*'
      - '**/secrets/**'
      - '**/.git/objects/**'
      - '**/node_modules/.cache/**'

collaboration:
  maxChainDepth: 5
  maxBroadcastTargets: 5
  maxResumeCount: 10
  inquiryTimeoutMs: 300000

execution:
  maxTurnsPerRun: 25
  maxReviseAttempts: 3
  maxRetryOnFailure: 2
  maxConsecutiveWakes: 5
  maxDecompositionDepth: 3
  retryBackoffMs: 5000
```

### 9.3 从旧配置迁移

```
旧:
  cli.defaultExecutor       → 删除
  cli.projectDir            → 运行时由 Org 配置决定
  cli.model                 → Agent 内部配置
  cli.maxTurnsPerRun        → execution.maxTurnsPerRun
  cli.effort                → Agent 内部配置
  cli.timeoutMs             → 保留为 execution 级别超时
  cli.extraArgs             → 删除（不再需要）

新增:
  agents.*                  → 全新
  collaboration.*           → 全新
```

---

## 10. 迁移策略

### 10.1 分阶段实施

```
Phase 0 — PoC 验证 ★ 关键前置
  ├── 选择 Claude Agent (claude-agent-acp) 作为首选验证 Agent
  ├── 在隔离测试中验证:
  │   ├── initialize → session/new → session/prompt → session/update 全流程
  │   ├── session/close → session/resume 实际行为
  │   ├── fs/read_text_file / fs/write_text_file 实际行为
  │   ├── MCP stdio 传输：Agent 能否连接 Capibara MCP server
  │   └── session/request_permission 是否被触发
  ├── 产出: ACP 能力矩阵 + 已知限制 + 降级策略确认
  └── 风险决断点: 如果 resume 完全不可用，重新评估 P1 方案
  注: claude-agent-acp 是 Claude Agent SDK 的官方 ACP 适配器（npm: @agentclientprotocol/claude-agent-acp），
      本地已安装 Claude Code CLI，可直接使用，零额外配置成本

Phase 1 — ACP 基础层
  ├── 实现 ACP JSON-RPC transport (基于 @agentclientprotocol/sdk)
  ├── 实现 ACP Session Manager (create, prompt, close)
  ├── 实现 ACP Agent Spawner (进程生命周期)
  ├── 实现 ACP Update Handler (消费 session/update → 现有事件系统)
  ├── 实现 AcpExecutor (IExecutor 接口)
  ├── 实现 MCP stdio server (替代 HTTP bridge)
  ├── 改造 execution.module.ts DI 注册
  ├── 改造 electron.vite.config.ts (删除旧入口)
  ├── 删除 CLI adapter + worker 层 + MCP bridge
  └── 验证: 单 Agent 执行一个 task 的完整生命周期
      (TaskOrchestrator → RunCoordinator → RunEngine → AcpExecutor → Agent → MCP tools)

Phase 2 — 权限与文件控制
  ├── 实现 ACP Permission Handler
  ├── 实现 ACP Filesystem Handler + DefaultFileAccessPolicy
  ├── 实现 ToolPermissionPolicy
  ├── Role 表 schema 扩展
  ├── 审计日志表 + 写入逻辑
  └── 验证: 文件 allowlist 拒绝越界访问; permission 拦截危险操作

Phase 3a — AI↔AI 协同 (模式 1/2: 单轮 + 多轮)
  ├── 实现 SessionSuspensionManager (基础版: suspend + resume)
  ├── 实现 InquiryAggregator
  ├── 改造 ConversationOrchestrator (onInquiryResolved → resume)
  ├── 改造 RunOrchestrator (suspended 状态处理)
  ├── 适配 PromptBuilder (对话回复注入格式)
  ├── DB: session_suspensions + suspension_awaiting 表
  └── 验证: Role-A 问 Role-B → B 答 → A 恢复继续
      验证: Role-A 与 Role-B 多轮交流后完成任务

Phase 3b — AI↔AI 协同 (模式 3/4: 链式 + 广播)
  ├── SessionSuspensionManager 增强: parentSuspensionId, chainDepth
  ├── ChainDepthGuard (深度防护 + 循环检测)
  ├── 新增 capibara_broadcast_question 工具 (多目标, waitMode)
  ├── 并行会话调度 (不同 Role 可并行)
  ├── 聚合恢复逻辑 (all/any 模式)
  └── 验证: A→B→C→A 链式协作成功
      验证: A 问 B+C (广播) → 聚合回复 → A 恢复

Phase 4 — UI 增强 (使用现有 DesktopEvent 系统)
  ├── 新增 DesktopEvent 类型: run:tool-call, run:suspended, run:resumed
  ├── 扩展 run.slice.ts: 工具调用列表、挂起状态展示
  ├── UI: 工具调用时间线组件
  ├── UI: 会话状态面板 (active/suspended/resumed)
  ├── UI: 协作关系可视化 (哪些 session 在等谁)
  ├── UI: 审计日志查看界面
  └── UI: Agent 配置管理界面
```

### 10.2 实施策略

由于项目未上线，采用 **Feature Branch 直接替换** 策略：

1. **Feature branch**: `feature/acp-migration`
2. **Phase 0**: 独立测试目录 `tests/acp-poc/` 中验证
3. **Phase 1**: 直接删除旧代码，新建 ACP 模块
4. **Phase 2-4**: 增量开发，每个 Phase 一个 PR
5. **集成测试**: 每个 Phase 至少一个端到端测试验证完整流程

### 10.3 依赖变更

```
新增:
  @agentclientprotocol/sdk      ← ACP 官方 TypeScript SDK
  minimatch                      ← glob 匹配 (文件策略)

删除:
  (无 npm 包需要删除，Claude CLI 不是 npm 依赖)

保留:
  所有现有依赖不变
```

---

## 11. 风险与缓解

| # | 风险 | 严重程度 | 可能性 | 缓解措施 |
|---|------|---------|--------|---------|
| R1 | **ACP Agent 不支持 session/resume** | 高 | 中 | Phase 0 验证。三策略降级: resume → load → rebuild。rebuild 回退到 session/new + 完整上下文重建（类似当前跨 Run 行为） |
| R2 | **MCP stdio 传输兼容性** | 高 | 中 | Phase 0 验证 Agent 能否通过 stdio 连接 Capibara MCP server。不兼容则保留 HTTP 传输作为备选 |
| R3 | **Agent 不请求 permission 就直接执行** | 高 | 低 | 文件安全的根本防线在 `fs/*` handler（Client 实现，不可绕过）。Bash 执行的防护依赖 permission system，需要 Phase 0 验证 |
| R4 | **ACP 协议 breaking change** | 中 | 中 | 所有 ACP 交互封装在 `modules/acp/` 内，协议细节不泄漏到业务层。protocol version 检查在 initialize 阶段 |
| R5 | **不同 Agent 的行为差异** | 中 | 高 | Agent Registry 中标记已验证 Agent + capability。维护兼容性矩阵。Phase 0 用 Claude Agent (claude-agent-acp) 验证，后续逐个接入 |
| R6 | **链式协作死锁** | 中 | 中 | chainDepth 限制 + 循环检测 + 超时机制 (InquiryEscalationService) 三重防护 |
| R7 | **5 个 MCP 工具从 HTTP 改 stdio 的语义变化** | 中 | 低 | 工具 handler 逻辑不变，只改传输层。Phase 1 端到端测试覆盖所有 5 个工具 |
| R8 | **FileLogService 适配** | 低 | 确定 | `AcpUpdateHandler` 将 ACP 事件格式化为 JSONL 后写入 `FileLogService`，接口不变 |
| R9 | **现有集成测试 (cascade-execution.test.ts) 失效** | 低 | 确定 | 测试中 mock 的是 `IExecutor` 接口，该接口保留。只需更新 mock 实现以支持 `'suspended'` 状态 |

---

## 12. AG-UI 未来路线图

> **决策**: AG-UI 在 ACP 集成完全稳定后再引入，作为独立的后续阶段。

### 12.1 引入时机

当以下条件满足时启动 AG-UI 集成：
- Phase 1-4 全部完成且稳定运行
- 确认需要比现有 DesktopEvent 更丰富的前端事件能力
- 确认 Web 化路线图启动（AG-UI 的主要价值在于 transport agnostic）

### 12.2 预期收益

| 能力 | 现有 DesktopEvent | AG-UI 提供 |
|------|-------------------|-----------|
| 工具调用可视化 | `run:tool-call` (Phase 4 新增) | `ToolCallStart` → `Args` → `End` → `Result` 完整生命周期 |
| Agent 状态同步 | 无 | `StateSnapshot` + `StateDelta` (RFC 6902 JSON Patch) |
| 推理过程可视化 | 无 | `ReasoningStart` → `Content` → `End` |
| 多步骤进度 | `run:status` | `StepStarted` / `StepFinished` (命名步骤) |
| 断线恢复 | 无 | `MessagesSnapshot` |

### 12.3 架构预留

当前设计已为 AG-UI 预留接入点：
- `AcpUpdateHandler` 集中处理所有 ACP 事件 → 未来只需在此处接入 ACP→AG-UI Adapter
- 现有 `EventBroadcaster` 的 IPC 通道 (`capibara:desktop-event`) 保持不变
- 未来新增独立通道 `agui:event` 用于 AG-UI 事件（双通道共存）
- Renderer 端新增 `agui.slice.ts` 消费 AG-UI 事件

### 12.4 Web 化路径

```
当前 (Electron):  ACP events → EventBroadcaster → IPC → Renderer
未来 (AG-UI):     ACP events → AG-UI Adapter → IPC → Renderer
更远 (Web):       ACP events → AG-UI Adapter → SSE/WebSocket → Browser
```

---

## 13. 附录

### 13.1 ACP 协议关键方法速查

| 方向 | 方法 | 用途 |
|------|------|------|
| Client → Agent | `initialize` | 协议握手，交换能力 |
| Client → Agent | `session/new` | 创建会话（传递 mcpServers, cwd） |
| Client → Agent | `session/prompt` | 发送用户消息，触发 Agent 执行 |
| Client → Agent | `session/cancel` | 取消当前 turn |
| Client → Agent | `session/resume` | 恢复已关闭会话（不 replay） |
| Client → Agent | `session/load` | 恢复已关闭会话（replay 历史） |
| Client → Agent | `session/close` | 关闭会话 |
| Agent → Client | `session/update` | 推送 tool_call / text / plan / diff |
| Agent → Client | `session/request_permission` | 请求工具调用权限 |
| Agent → Client | `fs/read_text_file` | 读取文件（Client 实现） |
| Agent → Client | `fs/write_text_file` | 写入文件（Client 实现） |

### 13.2 四种协作模式的会话状态图

```
模式 1 (单轮):
  A: ●━━active━━━●━suspended━━●━━resumed━━━●━active━━━●closed
  B:              ●━━active━━━●closed

模式 2 (多轮):
  A: ●━active━●━susp━●━res━●━active━●━susp━●━res━●━active━●closed
  B:           ●━active━●closed      ●━active━●closed

模式 3 (链式):
  A: ●━active━●━━━━━━━━━━━suspended━━━━━━━━━━━●━resumed━●━active━●
  B:           ●━active━●━━suspended━━●━resumed━●━active━●closed
  C:                     ●━━active━━━●closed

模式 4 (广播):
  A: ●━active━●━━━━━━suspended━━━━━━●━resumed━●━active━●
  B:           ●━━━active━━━●closed  │
  C:           ●━━━━━━active━━━━━━━●closed
                  (B,C 可并行)       ↑聚合后恢复 A
```

### 13.3 决策记录 (ADR)

**ADR-001: 选择 ACP 替代 CLI 直接调用**
- 状态: ✅ 已批准
- 决策: 采用 Agent Client Protocol 作为统一的 Agent 管理协议
- 后果: 重写执行引擎层，上层业务逻辑（Orchestrator、Domain Service、DB）改动最小化

**ADR-002: 保留 IExecutor 接口**
- 状态: ✅ 已批准
- 背景: 原报告建议直接依赖 IAcpSessionManager，这会扩大 RunEngine 改动范围
- 决策: 保留 `IExecutor` 接口，由 `AcpExecutor` 实现。RunEngine 改动最小化
- 后果: RunEngine 不需要感知 ACP 细节；新增 `'suspended'` 状态处理即可

**ADR-003: 不引入 A2A 协议**
- 状态: ✅ 已批准
- 决策: Hub-and-Spoke 架构，Agent 间通信由 Capibara 中央编排
- 后果: 简化架构，未来如需跨实例互联需重新评估

**ADR-004: AG-UI 延后引入**
- 状态: ✅ 已批准
- 背景: 同时引入 ACP + AG-UI 认知负荷过重，且 AG-UI 的核心价值在 Web 化阶段
- 决策: ACP 稳定后再引入 AG-UI。当前使用现有 DesktopEvent 系统承载新事件
- 后果: 初期 UI 能力有限（无推理过程可视化等），但降低迁移风险

**ADR-005: 引入 SessionSuspension 统一替代 PendingWake**
- 状态: ✅ 已批准
- 背景: PendingWake 是 FIFO 队列，无法表达协作的依赖关系
- 决策: 新增 `SessionSuspension` + `SuspensionAwaiting` 模型，完全替代 PendingWake
- 后果: 删除 `pending_wakes` 表和相关代码。所有调度场景统一使用 Suspension 模型，非协作的简单唤醒作为 aggregationMode='none' 的特殊情况处理

**ADR-006: 多 Agent 支持**
- 状态: ✅ 已批准
- 决策: Agent Registry 配置，不同 Role 可绑定不同 Agent
- 后果: 同一 Org 内可混用 Copilot、Claude Agent、Gemini CLI 等

**ADR-007: 会话恢复三策略降级**
- 状态: ✅ 已批准
- 决策: resume → load → rebuild 三级降级
- resume: ACP session/resume（最优，完整上下文保留）
- load: ACP session/load（次优，replay 历史）
- rebuild: session/new + 完整上下文重建（兜底，类似当前跨 Run 行为）
- 后果: 兼容不支持 resume 的 Agent，但 rebuild 路径有上下文截断风险

**ADR-008: 广播询问作为独立 MCP 工具**
- 状态: ✅ 已批准
- 背景: 广播询问（模式 4）语义与单目标询问不同，混用同一工具增加 Agent 困惑
- 决策: 保留 `capibara_ask_question`（单目标），新增 `capibara_broadcast_question`（多目标）
- 后果: 工具语义清晰，Agent 不需要判断何时使用数组参数

### 13.4 依赖与协议资源

| 资源 | 链接/包名 |
|------|----------|
| ACP 官方文档 | https://agentclientprotocol.com |
| ACP TypeScript SDK | `@agentclientprotocol/sdk` (npm) |
| Claude Agent ACP Adapter | `@agentclientprotocol/claude-agent-acp` (npm) — https://github.com/agentclientprotocol/claude-agent-acp |
| ACP GitHub | https://github.com/agentclientprotocol/agent-client-protocol |
| 已支持 Agent 列表 | https://agentclientprotocol.com/get-started/agents |
| AG-UI 官方文档 | https://docs.ag-ui.com (未来参考) |

### 13.5 审阅要点

1. **Phase 0 PoC** — 是否同意将 Claude Agent (claude-agent-acp) 作为首选验证 Agent？✅ **已确认**
2. **session/resume 降级策略** — rebuild 路径的上下文截断是否可接受？✅ **已接受**
3. **SessionSuspension vs PendingWake** — 两套机制共存还是统一？✅ **统一为 Suspension，删除 PendingWake**
4. **链深度限制** — 默认值？✅ **确认默认 5**
5. **广播询问工具** — 扩展原有还是新增工具？✅ **新增 `capibara_broadcast_question`**
6. **MCP 传输层** — HTTP 改 stdio 不兼容时保留 HTTP？✅ **已接受，Phase 0 验证**
7. **文件访问粒度** — 是否需要 Task 级别的动态约束？✅ **不需要，Role 级别即可**
8. **协作超时** — 默认 5 分钟是否合理？✅ **已接受，超时后取消 suspension + 恢复发起者 + 超时通知**

---

> **下一步**: 待审阅完成后，开始 Phase 0 PoC 验证。
