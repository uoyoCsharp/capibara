# Capibara ACP 迁移架构设计方案

> **版本**: 1.1  
> **日期**: 2026-05-23  
> **状态**: 待架构团队审阅  
> **作者**: AI Architecture Assistant  
> **范围**: 将执行引擎从 Claude Code CLI 直接调用迁移到 Agent Client Protocol (ACP) + AG-UI 标准化架构  
> **变更记录**: v1.1 — 引入 AG-UI 协议作为 Agent→UI 事件推送标准层（第 4.7、6 章新增内容）

---

## 目录

1. [背景与动机](#1-背景与动机)
2. [当前架构分析](#2-当前架构分析)
3. [目标架构设计](#3-目标架构设计)
4. [ACP 协议适配层设计](#4-acp-协议适配层设计)
5. [AG-UI 协议集成设计](#5-ag-ui-协议集成设计)
6. [三大核心问题的解决方案](#6-三大核心问题的解决方案)
7. [模块级改动清单](#7-模块级改动清单)
8. [数据模型变更](#8-数据模型变更)
9. [配置变更](#9-配置变更)
10. [迁移策略](#10-迁移策略)
11. [风险与缓解](#11-风险与缓解)
12. [附录](#12-附录)

---

## 1. 背景与动机

### 1.1 项目概述

Capibara 是一个基于 Electron 的多 AI Agent 协作平台。系统建模了组织结构（Org → Role → Skill），通过任务系统（Task）驱动 AI Agent 执行工作，Agent 之间可以通过对话系统（Conversation）进行协作。

**技术栈**: Electron + React 19 + Zustand 5 + better-sqlite3 + Drizzle ORM + TailwindCSS 4

### 1.2 当前执行引擎的根本问题

当前系统通过 `child_process.spawn` 直接调用 Claude Code CLI 作为 AI Agent 的执行引擎。这一设计在实验阶段暴露了三个无法绕过的根本性问题：

| # | 问题 | 根因 | 影响 |
|---|------|------|------|
| **P1** | AI↔AI 协同无法实现 | CLI 是 fire-and-forget 模式，无法在 Run 内挂起等待另一个 Agent 的回复。跨 Run 的 `--resume` 导致认知上下文断裂 | 多 Agent 协作形同虚设 |
| **P2** | 无法控制 AI 行为 | CLI 以 `--dangerously-skip-permissions` 启动，参数静态构建，运行时唯一控制手段为 `cancel()` (SIGTERM) | 无法拦截工具调用、无法注入指令、无法限制行为 |
| **P3** | 无法限制文件操作范围 | Claude CLI 内建的 `Read`/`Write`/`Edit`/`Bash` 工具直接操作 `projectDir`，不经过 MCP，无 allowlist 机制 | 任意 Role 可读写任意文件，存在安全风险 |

### 1.3 为什么选择 ACP

**Agent Client Protocol (ACP)** 是由 Zed 编辑器团队发起的开放协议，标准化了应用程序（Client）与 AI 编码代理（Agent）之间的通信。它类似于 LSP（Language Server Protocol）对语言服务器的标准化作用。

**ACP 的关键设计特征：**

| 特征 | 说明 | 解决的问题 |
|------|------|-----------|
| JSON-RPC over stdio | Agent 作为子进程运行，Client 通过标准输入/输出通信 | 与 Electron 主进程天然兼容 |
| Session 生命周期管理 | `session/new` → `session/prompt` → `session/resume` → `session/close` | **P1**: 可挂起/恢复 Agent 上下文 |
| Tool Call 权限系统 | `session/request_permission` + allow/reject 机制 | **P2**: 运行时拦截和审批工具调用 |
| Client 侧文件系统 | `fs/read_text_file` / `fs/write_text_file` 由 Client 实现 | **P3**: Client 端 allowlist 控制文件访问范围 |
| MCP 原生集成 | Client 在 `session/new` 时配置 Agent 可连接的 MCP 服务器 | 复用现有 MCP 工具体系 |
| 结构化事件流 | `session/update` 推送 tool_call、text_chunk、plan、diff | 替代自定义 StreamJsonParser |

**ACP 生态成熟度（截至 2026 年 5 月）：**

已支持的 Agent（可直接作为 Capibara 的 Agent 后端）：
- GitHub Copilot (Public Preview)
- Claude Agent (via Zed SDK adapter)
- Codex CLI (via Zed adapter)
- Gemini CLI (原生支持)
- Cursor (原生支持)
- Cline、Goose、OpenCode、Kiro CLI 等 30+ Agent

### 1.4 引入的协议

| 协议 | 决策 | 理由 |
|------|------|------|
| **ACP** (Agent Client Protocol) | ✅ 引入 | 标准化 Client↔Agent 通信，解决 P1/P2/P3 三大问题 |
| **MCP** (Model Context Protocol) | ✅ 保留 | 已有的工具调用协议，ACP 原生集成 |
| **AG-UI** (Agent-UI Protocol) | ✅ 引入 | 标准化 Agent 执行事件向前端的推送格式，统一 UI 控制层（详见第 5 章） |

### 1.5 不引入的协议

| 协议 | 决策 | 理由 |
|------|------|------|
| **A2A** (Agent-to-Agent) | ❌ 不引入 | Capibara 是 Hub-and-Spoke 架构，所有 Agent 通信由 Capibara 中央编排。A2A 设计用于 Mesh 拓扑（Agent 互相发现、直连），增加不必要的复杂度 |
| **SSE** (Server-Sent Events) | ❌ 不引入 | ACP 使用 JSON-RPC over stdio，桌面应用使用 Electron IPC。AG-UI 协议是 transport agnostic 的，IPC 即为其传输层。未来 Web 化时可切换到 SSE |

---

## 2. 当前架构分析

### 2.1 进程模型

```
┌────────────────────────────────────────────────────────────┐
│                      Electron App                          │
│                                                            │
│  ┌─────────────┐  IPC   ┌──────────────────────────────┐  │
│  │  Renderer    │◄─────►│  Main Process                │  │
│  │  (React 19)  │       │                              │  │
│  │  Zustand 5   │       │  DI Container (41 步引导)     │  │
│  │  TailwindCSS │       │  SQLite + Transactional Outbox│  │
│  └─────────────┘       │  EventBus (Emittery)          │  │
│                         │  Orchestrators (3)            │  │
│                         │  MCP HTTP Server              │  │
│                         └──────────┬───────────────────┘  │
│                                    │                       │
│                         ┌──────────▼───────────────────┐  │
│                         │  Worker (utilityProcess)      │  │
│                         │  └── claude-cli.adapter.ts    │  │
│                         │      └── spawn claude CLI     │  │
│                         └──────────┬───────────────────┘  │
│                                    │ child_process.spawn   │
│                         ┌──────────▼───────────────────┐  │
│                         │  Claude Code CLI              │  │
│                         │  --dangerously-skip-perms     │  │
│                         │  --output-format stream-json  │  │
│                         │  --mcp-config (capibara tools)│  │
│                         └──────────┬───────────────────┘  │
│                                    │ stdin/stdout          │
│                         ┌──────────▼───────────────────┐  │
│                         │  MCP Bridge (独立进程)         │  │
│                         │  JSON-RPC stdio ↔ HTTP POST   │  │
│                         │  → POST /tool-call → Main     │  │
│                         └──────────────────────────────┘  │
└────────────────────────────────────────────────────────────┘
```

### 2.2 当前执行链路（待替换）

```
RunEngine.execute(params)
  → executor.spawn(RunJob)
    → WorkerService.spawnRun(job)                    // IPC to utilityProcess
      → worker.ts: adapter.spawn(context)            // in worker process
        → ClaudeCliAdapter.spawn(context)
          → child_process.spawn('claude', args)      // spawn CLI
          → pipe prompt via stdin
          → StreamJsonParser parses stdout            // custom parser
          → handle.complete() returns result
      → postMessage({type:'run-finished', ...})      // IPC back to main
    → WorkerService receives result
  → RunEngine records result, emits events
```

**关键痛点文件：**

| 文件 | 职责 | 问题 |
|------|------|------|
| `claude-cli.adapter.ts` | 硬编码 `--dangerously-skip-permissions`，静态参数构建 | 无法拦截 tool call，无法限制行为 |
| `worker.ts` / `worker-protocol.ts` | 自定义的 `ParentMessage`/`ChildMessage` 协议 | 被 ACP JSON-RPC 替代 |
| `stream-json-parser.ts` | 解析 Claude CLI 的 `stream-json` 输出 | 被 ACP `session/update` 替代 |
| `utility-process.executor.ts` | utilityProcess 封装 | 不再需要独立 worker 进程 |
| `capibara-mcp-bridge.ts` | stdio↔HTTP 桥接，静态工具列表 | 被 ACP 原生 MCP 集成替代 |
| `mcp-ipc.server.ts` | 本地 HTTP server 中继 tool call | 被 ACP 原生 MCP 集成替代 |
| `mcp-config-generator.ts` | 生成临时 MCP 配置文件 | 改为 ACP `session/new` 的 `mcpServers` 参数 |

### 2.3 保留不变的模块

| 模块 | 理由 |
|------|------|
| `organization/` | 组织/角色/技能建模，与执行引擎无关 |
| `workflow/` | 任务状态机、流程引擎，与执行引擎无关 |
| `conversation/` | 对话/消息模型，保留并扩展 |
| `planning/` | 分解树，保留不变 |
| `prompt/` | 提示词构建，保留并适配 ACP prompt 格式 |
| `orchestrator/` | 编排逻辑，保留核心设计，适配 ACP session 管理 |
| `notification/` | 事件广播，适配 ACP `session/update` 事件 |
| Foundation 层 | EventBus、EventPublisher、Outbox、Logger、SQLite 全部保留 |
| DB schema (14 tables) | 保留，新增 `acp_sessions` 表 |
| Renderer / Zustand stores | 保留，适配新的事件类型 |

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
│  │                   │       │  ┌──────────────────────────────┐  │  │
│  │  ┌─────────────┐ │       │  │    ACP Session Manager        │  │  │
│  │  │ AG-UI Event  │ │ IPC   │  │  ┌────────────────────────┐  │  │  │
│  │  │ Consumer     │◄├──────┤  │  │ Permission Handler     │  │  │  │
│  │  │ (agui:event) │ │ch.1  │  │  ├────────────────────────┤  │  │  │
│  │  ├─────────────┤ │       │  │  │ File System Handler    │  │  │  │
│  │  │ Domain Event│ │ IPC   │  │  ├────────────────────────┤  │  │  │
│  │  │ Consumer    │◄├──────┤  │  │ Update Handler         │  │  │  │
│  │  │ (desktop-ev)│ │ch.2  │  │  └────────────────────────┘  │  │  │
│  │  └─────────────┘ │       │  └───────────┬──────────────────┘  │  │
│  │                   │       │              │                     │  │
│  │  Zustand stores   │       │  ┌───────────▼──────────────────┐  │  │
│  │  + AG-UI store    │       │  │ ACP→AG-UI Adapter            │  │  │
│  └──────────────────┘       │  │ (ACP session/update          │  │  │
│                              │  │  → AG-UI 标准事件格式)        │  │  │
│                              │  └───────────┬──────────────────┘  │  │
│                              │              │ JSON-RPC stdio       │  │
│                              │  ┌───────────▼──────────────────┐  │  │
│                              │  │  ACP Agent 子进程             │  │  │
│                              │  │  (Copilot/Claude/Gemini/...) │  │  │
│                              │  │  Agent ──MCP──► Capibara     │  │  │
│                              │  │               MCP Server     │  │  │
│                              │  └──────────────────────────────┘  │  │
│                              │                                    │  │
│                              │  Orchestrators / EventBus / SQLite │  │
│                              └────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────────────┘

双通道事件架构：
  ch.1 — agui:event    → AG-UI 标准事件（Agent 执行相关）
  ch.2 — desktop-event → Domain 事件（业务状态变更，保留现有）
```

**关键变化：**
- **删除** utilityProcess worker 层（不再需要独立进程管理 CLI）
- **删除** MCP Bridge 进程（ACP Agent 原生连接 MCP server）
- **删除** MCP HTTP IPC Server（MCP server 直接通过 stdio 由 Agent 连接）
- **新增** ACP Session Manager（Main 进程内，管理 Agent 子进程的完整生命周期）
- **Main 进程直接 spawn** ACP Agent 子进程，通过 stdio JSON-RPC 通信

### 3.2 核心数据流

```
用户操作 → IPC Handler → Orchestrator → ACP Session Manager
                                              │
                                    ┌─────────▼──────────┐
                                    │  spawn agent 子进程  │
                                    │  session/new        │
                                    │  session/prompt     │
                                    └─────────┬──────────┘
                                              │
                              ┌───────────────▼───────────────┐
                              │  Agent 执行中                  │
                              │                               │
                              │  ←── session/update ──→       │
                              │      (tool_call/text/plan)    │
                              │                               │
                              │  ←── request_permission ──→   │
                              │      (Client allow/reject)    │
                              │                               │
                              │  ←── fs/read_text_file ──→    │
                              │      (Client 检查 allowlist)   │
                              │                               │
                              │  ──── MCP tool call ────→     │
                              │      capibara_ask_question     │
                              │      capibara_task_transition  │
                              │      capibara_context          │
                              └───────────────┬───────────────┘
                                              │
                                    session/prompt response
                                    { stopReason: 'end_turn' }
                                              │
                              ┌───────────────▼───────────────┐
                              │  ACP Session Manager          │
                              │  → 记录结果                    │
                              │  → 发布 DomainEvent           │
                              │  → 触发下一步编排              │
                              └───────────────────────────────┘
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
│   │   └── acp-jsonrpc.transport.ts        ← JSON-RPC over stdio 传输层
│   ├── handlers/
│   │   ├── acp-permission.handler.ts       ← 处理 session/request_permission
│   │   ├── acp-filesystem.handler.ts       ← 实现 fs/read_text_file, fs/write_text_file
│   │   └── acp-update.handler.ts           ← 处理 session/update (tool_call, text, plan, diff)
│   ├── policies/
│   │   ├── file-access.policy.ts           ← 文件访问 allowlist/denylist 策略
│   │   └── tool-permission.policy.ts       ← 工具调用权限策略
│   ├── interfaces/
│   │   ├── i-acp-session.manager.ts        ← 接口定义
│   │   └── i-file-access.policy.ts         ← 文件策略接口
│   ├── types/
│   │   └── acp.types.ts                    ← ACP 协议类型定义
│   └── mcp/
│       └── acp-mcp.config.ts               ← 为 ACP session 生成 MCP server 配置
```

### 4.2 ACP Session Manager（核心组件）

```typescript
// 接口定义: i-acp-session.manager.ts

interface IAcpSessionManager {
  /**
   * 创建新会话并启动 Agent 子进程（如果尚未启动）。
   * 对应 ACP: initialize → session/new
   */
  createSession(params: CreateSessionParams): Promise<AcpSession>;

  /**
   * 向会话发送 prompt，返回 turn 完成后的结果。
   * 对应 ACP: session/prompt → 消费 session/update 流 → session/prompt response
   */
  prompt(sessionId: string, content: PromptContent[]): Promise<PromptResult>;

  /**
   * 恢复已关闭的会话（不 replay 历史）。
   * 对应 ACP: session/resume
   */
  resumeSession(sessionId: string): Promise<void>;

  /**
   * 关闭会话，释放资源。
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
}

interface CreateSessionParams {
  agentId: string;          // 配置中注册的 agent 标识
  roleId: string;           // Capibara Role ID
  orgId: string;            // Capibara Org ID
  cwd: string;              // 工作目录（作为文件操作边界）
  mcpServers: McpServerConfig[];  // MCP 服务器配置列表
  allowedPaths?: string[];  // 文件访问 allowlist（追加到 cwd 约束之上）
}

interface AcpSession {
  sessionId: string;        // ACP 协议返回的 session ID
  agentId: string;
  roleId: string;
  orgId: string;
  status: 'active' | 'closed' | 'error';
}

interface PromptResult {
  stopReason: 'end_turn' | 'max_tokens' | 'cancelled' | 'refusal';
  toolCallsMade: ToolCallRecord[];   // 本次 turn 中的所有工具调用
  textOutput: string;                // 累积的文本输出
  tokensUsed?: { input: number; output: number; cached: number };
}
```

### 4.3 ACP Permission Handler

```typescript
// acp-permission.handler.ts

/**
 * 处理 Agent 发送的 session/request_permission 请求。
 * 根据 Role 的权限策略自动决定 allow/reject。
 */
class AcpPermissionHandler {
  constructor(
    private readonly toolPolicy: ToolPermissionPolicy,
    private readonly logger: ILogger,
  ) {}

  /**
   * 收到 permission 请求时调用。
   * 返回 { outcome: 'selected', optionId: 'allow-once' | 'reject-once' }
   */
  handlePermissionRequest(
    sessionContext: SessionContext,
    request: PermissionRequest,
  ): PermissionResponse {
    const { roleId, orgId, allowedPaths } = sessionContext;
    const { toolCall, options } = request;

    // 1. 检查工具类型是否在 Role 的 allowlist 中
    const decision = this.toolPolicy.evaluate(roleId, toolCall);

    // 2. 记录审计日志
    this.logger.info('Permission decision', {
      roleId, toolCallId: toolCall.toolCallId,
      title: toolCall.title, kind: toolCall.kind,
      decision: decision.allowed ? 'allow' : 'reject',
    });

    // 3. 返回决策
    if (decision.allowed) {
      const allowOption = options.find(o => o.kind === 'allow_once');
      return { outcome: { outcome: 'selected', optionId: allowOption!.optionId } };
    } else {
      const rejectOption = options.find(o => o.kind === 'reject_once');
      return { outcome: { outcome: 'selected', optionId: rejectOption!.optionId } };
    }
  }
}
```

### 4.4 ACP File System Handler

```typescript
// acp-filesystem.handler.ts

/**
 * 实现 ACP 的 fs/read_text_file 和 fs/write_text_file。
 * 所有文件访问经过 allowlist 检查。
 */
class AcpFilesystemHandler {
  constructor(
    private readonly filePolicy: FileAccessPolicy,
    private readonly logger: ILogger,
  ) {}

  /**
   * 处理 fs/read_text_file 请求。
   * Agent 读取文件时此方法被调用，Client 决定是否允许。
   */
  async handleReadFile(
    sessionContext: SessionContext,
    params: { path: string; line?: number; limit?: number },
  ): Promise<{ content: string } | JsonRpcError> {
    const { roleId, cwd, allowedPaths } = sessionContext;

    // 检查路径是否在允许范围内
    const access = this.filePolicy.checkRead(params.path, cwd, allowedPaths);
    if (!access.allowed) {
      this.logger.warn('File read denied', {
        roleId, path: params.path, reason: access.reason,
      });
      return { code: -32001, message: `Access denied: ${access.reason}` };
    }

    // 读取文件内容
    const content = await readFile(params.path, 'utf-8');

    // 按需截取行范围
    if (params.line || params.limit) {
      const lines = content.split('\n');
      const start = (params.line ?? 1) - 1;
      const end = params.limit ? start + params.limit : lines.length;
      return { content: lines.slice(start, end).join('\n') };
    }

    return { content };
  }

  /**
   * 处理 fs/write_text_file 请求。
   * Agent 写入文件时此方法被调用，Client 决定是否允许。
   */
  async handleWriteFile(
    sessionContext: SessionContext,
    params: { path: string; content: string },
  ): Promise<null | JsonRpcError> {
    const { roleId, cwd, allowedPaths } = sessionContext;

    // 检查路径是否在允许范围内
    const access = this.filePolicy.checkWrite(params.path, cwd, allowedPaths);
    if (!access.allowed) {
      this.logger.warn('File write denied', {
        roleId, path: params.path, reason: access.reason,
      });
      return { code: -32001, message: `Access denied: ${access.reason}` };
    }

    // 审计日志
    this.logger.info('File write', { roleId, path: params.path, size: params.content.length });

    // 写入文件
    await writeFile(params.path, params.content, 'utf-8');
    return null;
  }
}
```

### 4.5 File Access Policy

```typescript
// file-access.policy.ts

interface FileAccessPolicy {
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
 *   Layer 3: denylist — 全局黑名单（.env, secrets, node_modules/.cache 等）
 */
class DefaultFileAccessPolicy implements FileAccessPolicy {
  private readonly globalDenyPatterns = [
    '**/.env',
    '**/.env.*',
    '**/secrets/**',
    '**/.git/objects/**',
  ];

  checkRead(path: string, cwd: string, allowedPaths?: string[]): AccessDecision {
    return this.check(path, cwd, allowedPaths);
  }

  checkWrite(path: string, cwd: string, allowedPaths?: string[]): AccessDecision {
    return this.check(path, cwd, allowedPaths);
  }

  private check(path: string, cwd: string, allowedPaths?: string[]): AccessDecision {
    const resolved = resolve(path);

    // Layer 1: cwd 边界
    if (!resolved.startsWith(resolve(cwd))) {
      return { allowed: false, reason: `Path outside workspace: ${path}` };
    }

    // Layer 2: allowlist（如果配置了）
    if (allowedPaths && allowedPaths.length > 0) {
      const relative = relative(cwd, resolved);
      const matched = allowedPaths.some(pattern => minimatch(relative, pattern));
      if (!matched) {
        return { allowed: false, reason: `Path not in allowedPaths for this role` };
      }
    }

    // Layer 3: 全局黑名单
    const relative = relative(cwd, resolved);
    const denied = this.globalDenyPatterns.some(pattern => minimatch(relative, pattern));
    if (denied) {
      return { allowed: false, reason: `Path matches global deny pattern` };
    }

    return { allowed: true };
  }
}
```

---

## 5. AG-UI 协议集成设计

### 5.1 为什么引入 AG-UI

**Agent User Interaction Protocol (AG-UI)** 是由 CopilotKit 团队发起的开放协议，定义了 AI Agent 向前端推送执行状态的标准事件格式。它提供了 16 种标准化事件类型，涵盖 Agent 执行的完整生命周期。

**引入 AG-UI 的核心动机：**

当前系统使用自定义的 `DesktopEvent` 联合类型（14 种事件）通过 Electron IPC 推送到 Renderer。这一设计存在以下不足：

| 缺失能力 | 现状 | AG-UI 提供的方案 |
|---------|------|------------------|
| 工具调用可视化 | ❌ 完全没有 | `ToolCallStart` → `ToolCallArgs` → `ToolCallEnd` → `ToolCallResult` |
| Agent 状态同步 | ❌ 完全没有 | `StateSnapshot` + `StateDelta` (RFC 6902 JSON Patch) |
| 文本流的 Start/End 边界 | ⚠️ 只有 `run:assistant-text` 追加流 | `TextMessageStart` → `TextMessageContent` → `TextMessageEnd` |
| 多步骤进度 | ⚠️ `run:status` 单一字符串 | `StepStarted` / `StepFinished`（命名步骤） |
| 推理过程可视化 | ❌ 完全没有 | `ReasoningStart` → `ReasoningMessageContent` → `ReasoningEnd` |
| 活动进度（搜索/计划等） | ❌ 完全没有 | `ActivitySnapshot` / `ActivityDelta` |
| 完整对话历史同步 | ❌ 完全没有 | `MessagesSnapshot`（断线恢复） |

**AG-UI 的关键设计特征：**

| 特征 | 说明 | 对 Capibara 的意义 |
|------|------|-------------------|
| **Transport Agnostic** | 协议不强制传输层，支持 SSE / WebSocket / 任意通道 | ✅ Electron IPC 直接承载 AG-UI 事件 |
| **16 种标准事件** | Lifecycle / Text / ToolCall / State / Activity / Reasoning / Special | ✅ 远比现有 DesktopEvent 丰富 |
| **Snapshot-Delta 模式** | StateSnapshot + StateDelta (JSON Patch) | ✅ 高效增量状态同步 |
| **CopilotKit 兼容** | AG-UI 是 CopilotKit 的底层协议 | ✅ 可复用 CopilotKit React 组件 |
| **ACP-to-AG-UI Bridge** | 已有开源桥接实现 | ✅ ACP 事件转 AG-UI 事件有参考实现 |

### 5.2 双通道事件架构

Main Process → Renderer 的事件推送分为两个独立通道，各司其职：

```
通道 1: AG-UI Events — IPC channel 'agui:event'
┌──────────────────────────────────────────────────────┐
│ 职责：Agent 执行过程的实时 UI 控制                      │
│                                                      │
│ Lifecycle:  RunStarted / RunFinished / RunError       │
│ Text:       TextMessageStart / Content / End          │
│ ToolCall:   ToolCallStart / Args / End / Result       │
│ State:      StateSnapshot / StateDelta                │
│ Steps:      StepStarted / StepFinished                │
│ Activity:   ActivitySnapshot / ActivityDelta          │
│ Reasoning:  ReasoningStart / Content / End            │
│ Custom:     ACP 特有事件 (diff / terminal / permission)│
└──────────────────────────────────────────────────────┘

通道 2: Domain Events — IPC channel 'capibara:desktop-event'（保留现有）
┌──────────────────────────────────────────────────────┐
│ 职责：业务领域状态变更通知                               │
│                                                      │
│ org:changed / role:changed / skill:changed            │
│ task:changed / task:entered-approval                  │
│ conversation:changed / conversation:response-needed   │
│ plan-tree:ready / approved / discarded                │
│ scheduler:paused / scheduler:resumed                  │
│ notification                                         │
└──────────────────────────────────────────────────────┘
```

**分离原则：**
- Agent 执行事件（高频、流式、面向 UI 渲染）→ AG-UI 通道
- 业务领域事件（低频、状态变更、面向 Store 刷新）→ Domain 通道
- 两个通道互不影响，Renderer 端独立消费

### 5.3 ACP → AG-UI 事件映射

#### 5.3.1 映射规则

| ACP session/update 类型 | AG-UI 事件 | 说明 |
|------------------------|-----------|------|
| `agent_message_chunk` (首次) | `TextMessageStart` | 新消息开始，分配 messageId |
| `agent_message_chunk` (后续) | `TextMessageContent` | 增量文本 delta |
| `agent_message_chunk` (结束) | `TextMessageEnd` | 消息完成 |
| `tool_call` | `ToolCallStart` | 工具调用开始，携带 toolCallId + title + kind |
| `tool_call_update` (status: in_progress) | `ToolCallArgs` | 流式工具参数 |
| `tool_call_update` (status: completed) | `ToolCallEnd` + `ToolCallResult` | 工具调用完成 + 结果 |
| `tool_call_update` (status: failed) | `ToolCallEnd` + `Custom("tool_error")` | 工具调用失败 |
| `plan` | `ActivitySnapshot` (activityType: "PLAN") | Agent 执行计划 |
| `plan` (条目状态更新) | `ActivityDelta` | 计划条目增量更新 |
| `user_message_chunk` | `Custom("user_message_replay")` | session/load 历史回放 |
| (session/prompt 调用时) | `RunStarted` | 生命周期开始 |
| (session/prompt 返回时) | `RunFinished` | 生命周期结束，含 stopReason |
| (session/prompt 错误时) | `RunError` | 运行错误 |

#### 5.3.2 ACP 特有事件的处理

ACP 协议中某些事件类型没有 AG-UI 原生对应，使用 `Custom` 事件承载：

| ACP 事件 | AG-UI 映射 | Custom name |
|---------|-----------|-------------|
| `diff` (文件修改) | `Custom` | `"file_diff"` |
| `terminal` (终端输出) | `Custom` | `"terminal_output"` |
| `session/request_permission` | `Custom` | `"permission_request"` |
| Permission 结果 | `Custom` | `"permission_result"` |

### 5.4 新增模块结构

```
apps/electron/src/core/modules/
├── agui/                                       ← 新增模块
│   ├── adapter/
│   │   ├── acp-agui.adapter.ts                  ← 核心：ACP session/update → AG-UI 事件转换
│   │   └── agui-text-message.tracker.ts         ← 文本消息 Start/Content/End 状态机
│   ├── emitter/
│   │   └── agui-ipc.emitter.ts                  ← 通过 Electron IPC 发送 AG-UI 事件到 Renderer
│   ├── state/
│   │   └── agui-state.manager.ts                ← Agent StateSnapshot/StateDelta 管理
│   ├── types/
│   │   └── agui-events.ts                       ← AG-UI 事件类型定义（16 种标准事件）
│   └── index.ts

apps/electron/src/renderer/
├── stores/
│   ├── agui.slice.ts                            ← 新增：AG-UI 事件消费 + 状态管理
│   └── ...                                      ← 现有 stores 保持不变
├── components/execution/
│   ├── ToolCallCard.tsx                          ← 新增：工具调用可视化卡片
│   ├── ToolCallTimeline.tsx                      ← 新增：工具调用时间线
│   ├── AgentMessageStream.tsx                    ← 新增：结构化消息流（替代 raw log）
│   ├── AgentPlanView.tsx                         ← 新增：Agent 执行计划展示
│   ├── AgentStepIndicator.tsx                    ← 新增：多步骤进度指示
│   ├── AgentReasoningPanel.tsx                   ← 新增：推理过程折叠面板
│   └── AgentStatePanel.tsx                       ← 新增：Agent 状态面板
```

### 5.5 核心组件设计

#### 5.5.1 ACP→AG-UI Adapter

```typescript
// acp-agui.adapter.ts

import type { AcpSessionUpdate } from '@core/modules/acp/types/acp.types';
import type { AguiEvent } from './types/agui-events';

/**
 * 将 ACP session/update 通知转换为 AG-UI 标准事件。
 * 维护消息状态机，处理 ACP 的非边界流 → AG-UI 的 Start/Content/End 三段式。
 */
class AcpAguiAdapter {
  private readonly textTracker: AguiTextMessageTracker;
  private currentRunId: string | null = null;

  constructor(
    private readonly emitter: AguiIpcEmitter,
    private readonly stateManager: AguiStateManager,
  ) {
    this.textTracker = new AguiTextMessageTracker();
  }

  /**
   * 当一个新的 ACP session/prompt 被发送时调用。
   * 发射 RunStarted 事件。
   */
  onPromptStarted(runId: string, sessionId: string, roleId: string): void {
    this.currentRunId = runId;
    this.textTracker.reset();
    this.emitter.emit({
      type: 'RUN_STARTED',
      threadId: sessionId,
      runId,
      timestamp: Date.now(),
    });

    // 发送初始状态快照
    this.emitter.emit({
      type: 'STATE_SNAPSHOT',
      snapshot: this.stateManager.buildSnapshot(runId, roleId),
      timestamp: Date.now(),
    });
  }

  /**
   * 处理 ACP session/update 通知，转换为 AG-UI 事件。
   */
  onSessionUpdate(update: AcpSessionUpdate): void {
    const events = this.mapUpdate(update);
    for (const event of events) {
      this.emitter.emit(event);
    }
  }

  /**
   * 当 session/prompt 返回结果时调用。
   * 关闭未结束的文本消息，发射 RunFinished。
   */
  onPromptFinished(runId: string, stopReason: string, result?: PromptResult): void {
    // 关闭未结束的文本消息
    const pendingEnd = this.textTracker.finalize();
    if (pendingEnd) this.emitter.emit(pendingEnd);

    // 发射 RunFinished
    this.emitter.emit({
      type: 'RUN_FINISHED',
      threadId: result?.sessionId,
      runId,
      timestamp: Date.now(),
    });

    // 发射最终状态增量
    this.emitter.emit({
      type: 'STATE_DELTA',
      delta: [{ op: 'replace', path: '/status', value: stopReason }],
      timestamp: Date.now(),
    });

    this.currentRunId = null;
  }

  private mapUpdate(update: AcpSessionUpdate): AguiEvent[] {
    switch (update.sessionUpdate) {
      case 'agent_message_chunk':
        return this.textTracker.process(update.content);

      case 'tool_call':
        return [{
          type: 'TOOL_CALL_START',
          toolCallId: update.toolCallId,
          toolCallName: update.title,
          timestamp: Date.now(),
        }];

      case 'tool_call_update': {
        const events: AguiEvent[] = [];
        if (update.rawInput) {
          events.push({
            type: 'TOOL_CALL_ARGS',
            toolCallId: update.toolCallId,
            delta: JSON.stringify(update.rawInput),
          });
        }
        if (update.status === 'completed' || update.status === 'failed') {
          events.push({
            type: 'TOOL_CALL_END',
            toolCallId: update.toolCallId,
          });
          if (update.status === 'completed' && update.rawOutput) {
            events.push({
              type: 'TOOL_CALL_RESULT',
              toolCallId: update.toolCallId,
              content: JSON.stringify(update.rawOutput),
              messageId: `result-${update.toolCallId}`,
            });
          }
        }
        // 状态增量
        this.stateManager.recordToolCall(update.toolCallId, update.status);
        events.push({
          type: 'STATE_DELTA',
          delta: [{ op: 'replace', path: '/lastToolCall', value: {
            id: update.toolCallId, status: update.status,
          }}],
        });
        return events;
      }

      case 'plan':
        return [{
          type: 'ACTIVITY_SNAPSHOT',
          messageId: `plan-${this.currentRunId}`,
          activityType: 'PLAN',
          content: update.entries,
        }];

      default:
        return [{
          type: 'CUSTOM',
          name: update.sessionUpdate,
          value: update,
        }];
    }
  }
}
```

#### 5.5.2 AG-UI IPC Emitter

```typescript
// agui-ipc.emitter.ts

import type { BrowserWindow } from 'electron';
import type { AguiEvent } from '../types/agui-events';

/**
 * 通过 Electron IPC 将 AG-UI 事件发送到 Renderer。
 * 使用独立的 IPC 通道 'agui:event'，与现有 'capibara:desktop-event' 分离。
 */
class AguiIpcEmitter {
  private mainWindow: BrowserWindow | null = null;

  setMainWindow(window: BrowserWindow): void {
    this.mainWindow = window;
  }

  emit(event: AguiEvent): void {
    if (!this.mainWindow || this.mainWindow.isDestroyed()) return;
    this.mainWindow.webContents.send('agui:event', event);
  }
}
```

#### 5.5.3 Renderer AG-UI Store

```typescript
// agui.slice.ts

import { create } from 'zustand';
import type { AguiEvent } from '@shared/types/agui-events';

interface ToolCallState {
  id: string;
  name: string;
  args: string;
  status: 'pending' | 'in_progress' | 'completed' | 'failed';
  result?: string;
}

interface AguiState {
  // 当前 Run
  currentRunId: string | null;
  isRunning: boolean;

  // 流式文本
  currentMessageId: string | null;
  messageText: string;

  // 工具调用
  toolCalls: ToolCallState[];

  // Agent 状态
  agentState: Record<string, unknown>;

  // 活动（Plan 等）
  activities: Map<string, unknown>;

  // 推理过程
  reasoning: { messageId: string; text: string } | null;

  // Actions
  handleEvent: (event: AguiEvent) => void;
  reset: () => void;
}

export const useAguiStore = create<AguiState>((set, get) => ({
  currentRunId: null,
  isRunning: false,
  currentMessageId: null,
  messageText: '',
  toolCalls: [],
  agentState: {},
  activities: new Map(),
  reasoning: null,

  handleEvent: (event: AguiEvent) => {
    switch (event.type) {
      case 'RUN_STARTED':
        set({ currentRunId: event.runId, isRunning: true, toolCalls: [], messageText: '' });
        break;
      case 'RUN_FINISHED':
      case 'RUN_ERROR':
        set({ isRunning: false });
        break;
      case 'TEXT_MESSAGE_START':
        set({ currentMessageId: event.messageId, messageText: '' });
        break;
      case 'TEXT_MESSAGE_CONTENT':
        set({ messageText: get().messageText + event.delta });
        break;
      case 'TOOL_CALL_START':
        set({ toolCalls: [...get().toolCalls, {
          id: event.toolCallId, name: event.toolCallName,
          args: '', status: 'pending',
        }]});
        break;
      case 'TOOL_CALL_ARGS': {
        const calls = get().toolCalls.map(tc =>
          tc.id === event.toolCallId
            ? { ...tc, args: tc.args + event.delta, status: 'in_progress' as const }
            : tc
        );
        set({ toolCalls: calls });
        break;
      }
      case 'TOOL_CALL_END': {
        const calls = get().toolCalls.map(tc =>
          tc.id === event.toolCallId ? { ...tc, status: 'completed' as const } : tc
        );
        set({ toolCalls: calls });
        break;
      }
      case 'TOOL_CALL_RESULT': {
        const calls = get().toolCalls.map(tc =>
          tc.id === event.toolCallId ? { ...tc, result: event.content } : tc
        );
        set({ toolCalls: calls });
        break;
      }
      case 'STATE_SNAPSHOT':
        set({ agentState: event.snapshot as Record<string, unknown> });
        break;
      case 'STATE_DELTA':
        // 应用 JSON Patch (RFC 6902)
        set({ agentState: applyJsonPatch(get().agentState, event.delta) });
        break;
      case 'ACTIVITY_SNAPSHOT':
        get().activities.set(event.messageId, event.content);
        set({ activities: new Map(get().activities) });
        break;
      case 'REASONING_MESSAGE_CONTENT':
        set({ reasoning: {
          messageId: event.messageId,
          text: (get().reasoning?.text ?? '') + event.delta,
        }});
        break;
    }
  },

  reset: () => set({
    currentRunId: null, isRunning: false,
    currentMessageId: null, messageText: '',
    toolCalls: [], agentState: {},
    activities: new Map(), reasoning: null,
  }),
}));
```

### 5.6 Preload AG-UI 通道

```typescript
// preload/index.ts 新增

// AG-UI 事件订阅（独立通道）
subscribeAgui: (handler: (event: AguiEvent) => void) => {
  const listener = (_ev: IpcRendererEvent, event: AguiEvent) => handler(event);
  ipcRenderer.on('agui:event', listener);
  return () => ipcRenderer.removeListener('agui:event', listener);
},
```

### 5.7 与 ACP Update Handler 的集成

```
ACP Agent 子进程
  │
  │ JSON-RPC stdio: session/update
  ▼
ACP Update Handler（第 4 章已设计）
  │
  │ 解析 ACP 事件，触发 domain 逻辑
  │ 同时调用 AcpAguiAdapter
  ▼
ACP→AG-UI Adapter（本章设计）
  │
  │ 转换为 AG-UI 标准事件
  ▼
AG-UI IPC Emitter
  │
  │ mainWindow.webContents.send('agui:event', event)
  ▼
Renderer AG-UI Store (agui.slice.ts)
  │
  │ Zustand selector
  ▼
UI 组件 (ToolCallCard / AgentMessageStream / ...)
```

### 5.8 未来 Web 化路径

引入 AG-UI 的一个重要长期收益是为未来 Web 化提供零改动的迁移路径：

```
当前（Electron 桌面应用）：
  AG-UI 事件 → Electron IPC → Renderer

未来（Web 应用）：
  AG-UI 事件 → SSE / WebSocket → Browser
  （只改传输层，事件格式和前端消费逻辑不变）
```

已有 [ACP-to-AG-UI bridge](https://github.com/namanrajpal/acp-to-agui) 开源实现可直接暴露 SSE 端点。

---

## 6. 三大核心问题的解决方案

### 6.1 P1: AI↔AI 协同

**解决方案：ACP Session Pause/Resume + Capibara 中央编排**

```
完整流程（以 Role-A 向 Role-B 提问为例）：

1. Capibara 创建 Agent-A 的 ACP 会话
   → AcpSessionManager.createSession({ agentId, roleId: A, ... })
   → session/new → sessionId_A

2. 发送 prompt 给 Agent-A
   → AcpSessionManager.prompt(sessionId_A, "分析并实现登录模块")
   → session/prompt

3. Agent-A 执行中，调用 MCP 工具 capibara_ask_question
   → Agent → MCP server → ConversationService.createInquiry()
   → InquiryRouter 匹配到 Role-B
   → MCP tool 返回 { conversationId, respondentRoleId: B, status: 'pending' }
   → Agent-A 继续处理其他工作...

4. Agent-A 的 turn 结束
   → session/prompt response { stopReason: 'end_turn' }
   → AcpSessionManager 收到结果

5. Orchestrator 检测到 pending inquiry
   → 关闭 Agent-A 的会话（保留状态）
   → AcpSessionManager.closeSession(sessionId_A)
   → session/close

6. 创建 Agent-B 的会话，发送 inquiry 内容
   → AcpSessionManager.createSession({ agentId, roleId: B, ... })
   → AcpSessionManager.prompt(sessionId_B, "请回答以下问题: ...")

7. Agent-B 回复，调用 MCP 工具 capibara_reply
   → ConversationService 记录回复
   → Agent-B turn 结束
   → AcpSessionManager.closeSession(sessionId_B)

8. 恢复 Agent-A 的会话
   → AcpSessionManager.resumeSession(sessionId_A)
   → session/resume（Agent 恢复完整上下文，不 replay）

9. 注入 Role-B 的回复
   → AcpSessionManager.prompt(sessionId_A, "Role-B 的回复: ...")
   → Agent-A 在原始上下文中继续工作     ← ✅ 上下文完整保留

10. 如果 Agent 不支持 resume
    → 降级为 session/load（replay 历史）
    → 或降级为 session/new + 完整上下文重建
```

**Orchestrator 改动：**

```typescript
// ConversationOrchestrator 改动

// 现在: 排队 pending_wakes，等 RunOrchestrator.drainPendingWakes
// 改后: 直接使用 ACP session 管理

private async onInquiryCreated(event: DomainEvent<'conversation:response-needed'>): Promise<void> {
  const { conversationId, orgId, roleId: respondentRoleId } = event.payload;

  // 获取发起方的当前会话
  const initiatorSession = this.acpSessionManager.getActiveSession(orgId);

  if (initiatorSession) {
    // 关闭发起方会话（保留状态用于 resume）
    await this.acpSessionManager.closeSession(initiatorSession.sessionId);
  }

  // 创建响应方会话
  const respondentSession = await this.acpSessionManager.createSession({
    agentId: this.resolveAgentForRole(respondentRoleId),
    roleId: respondentRoleId,
    orgId,
    cwd: this.getWorkspacePath(orgId),
    mcpServers: this.buildMcpConfig(orgId),
  });

  // 构建 inquiry prompt
  const prompt = await this.promptBuilder.buildConversationPrompt(conversationId, respondentRoleId);
  await this.acpSessionManager.prompt(respondentSession.sessionId, prompt);
}
```

### 6.2 P2: 控制 AI 行为

**解决方案：ACP Permission System + 策略引擎**

```
ACP Permission 拦截流程：

Agent 想执行某操作
  → session/request_permission {
      toolCall: { toolCallId, title: "Run bash: rm -rf /tmp", kind: "command" },
      options: [
        { optionId: "allow-once", name: "Allow once", kind: "allow_once" },
        { optionId: "reject-once", name: "Reject", kind: "reject_once" }
      ]
    }
  → AcpPermissionHandler.handlePermissionRequest(context, request)
    → ToolPermissionPolicy.evaluate(roleId, toolCall)
      → 检查 Role 的工具权限配置:
         - kind === 'command' && title.includes('rm -rf') → ❌ reject
         - kind === 'read' → ✅ allow
         - kind === 'edit' && path in allowedPaths → ✅ allow
      → 返回 { outcome: 'selected', optionId: 'reject-once' }
  → Agent 收到拒绝，不执行该操作
```

**Role 权限配置扩展（DB schema）：**

```sql
-- 在 roles 表新增列
ALTER TABLE roles ADD COLUMN file_access_paths TEXT DEFAULT NULL;
-- JSON array: ["src/components/**", "src/utils/**"]

ALTER TABLE roles ADD COLUMN tool_policy TEXT DEFAULT 'permissive';
-- 'permissive' (默认允许，黑名单拦截)
-- 'restrictive' (默认拒绝，白名单放行)
-- 'ask_user' (弹窗询问用户)
```

### 6.3 P3: 限制文件操作范围

**解决方案：ACP Client 侧文件系统 + 三层防护**

```
三层防护体系：

Layer 1 — ACP cwd 边界（协议级）
  session/new { cwd: "/project/workspace" }
  → Agent SHOULD 不超出 cwd 范围

Layer 2 — fs/* 方法 allowlist（代码级 —— 不可绕过）
  Agent 调用 fs/read_text_file { path: "/project/workspace/.env" }
  → AcpFilesystemHandler.handleReadFile()
  → FileAccessPolicy.checkRead()
  → 命中全局黑名单 '**/.env' → ❌ 返回 JSON-RPC error
  → Agent 无法读取文件内容

Layer 3 — MCP 工具 allowlist（工具级）
  capibara_context(query: 'file_tree') → 只返回 allowedPaths 内的文件列表
  → Agent 对 allowedPaths 外的文件无感知

审计日志：
  所有 fs/* 调用记录到 file_access_log 表
  → { roleId, path, operation: 'read'|'write', allowed: boolean, timestamp }
```

---

## 7. 模块级改动清单

### 7.1 删除的文件

| 文件 | 原职责 | 替代方案 |
|------|--------|---------|
| `infrastructure/adapters/claude-cli.adapter.ts` | CLI 参数构建 + 进程管理 | ACP Session Manager |
| `execution/workers/worker.ts` | utilityProcess 内的 CLI 执行 | ACP Agent Spawner |
| `execution/workers/worker-protocol.ts` | 自定义 `ParentMessage`/`ChildMessage` | ACP JSON-RPC |
| `execution/workers/worker-service.ts` | utilityProcess 管理 | ACP Agent Spawner |
| `execution/workers/utility-process.executor.ts` | `IExecutor` 实现 | ACP Session Manager 实现 `IExecutor` |
| `execution/workers/stream-json-parser.ts` | Claude stream-json 解析 | ACP `session/update` Handler |
| `mcp/bridge/capibara-mcp-bridge.ts` | stdio↔HTTP 桥接进程 | ACP 原生 MCP 集成 |
| `mcp/server/mcp-ipc.server.ts` | HTTP tool call 中继 | MCP server 直连 Agent |
| `mcp/config/mcp-config-generator.ts` | 生成临时 MCP JSON 配置 | `acp-mcp.config.ts` |
| `electron.vite.config.ts` 中的 bridge 入口 | bridge 构建 | 删除 |

### 7.2 新增的文件

**ACP 模块：**

| 文件 | 职责 |
|------|------|
| `acp/client/acp-session.manager.ts` | **核心**：管理 ACP 会话生命周期 |
| `acp/client/acp-agent.spawner.ts` | spawn ACP agent 子进程，管理进程生命周期 |
| `acp/client/acp-jsonrpc.transport.ts` | JSON-RPC over stdio 传输层封装 |
| `acp/handlers/acp-permission.handler.ts` | 处理 `session/request_permission` |
| `acp/handlers/acp-filesystem.handler.ts` | 实现 `fs/read_text_file` / `fs/write_text_file` |
| `acp/handlers/acp-update.handler.ts` | 处理 `session/update` 事件流 |
| `acp/policies/file-access.policy.ts` | 文件访问策略引擎 |
| `acp/policies/tool-permission.policy.ts` | 工具调用权限策略引擎 |
| `acp/types/acp.types.ts` | ACP 协议类型定义 |
| `acp/mcp/acp-mcp.config.ts` | 为 ACP session 构建 MCP server 配置 |

**AG-UI 模块：**

| 文件 | 职责 |
|------|------|
| `agui/adapter/acp-agui.adapter.ts` | **核心**：ACP session/update → AG-UI 标准事件转换 |
| `agui/adapter/agui-text-message.tracker.ts` | 文本消息 Start/Content/End 状态机 |
| `agui/emitter/agui-ipc.emitter.ts` | 通过 Electron IPC 发送 AG-UI 事件 |
| `agui/state/agui-state.manager.ts` | Agent StateSnapshot/StateDelta 管理 |
| `agui/types/agui-events.ts` | AG-UI 16 种标准事件类型定义 |

**Renderer 新增：**

| 文件 | 职责 |
|------|------|
| `stores/agui.slice.ts` | AG-UI 事件消费 Zustand store |
| `components/execution/ToolCallCard.tsx` | 工具调用可视化卡片 |
| `components/execution/ToolCallTimeline.tsx` | 工具调用时间线 |
| `components/execution/AgentMessageStream.tsx` | 结构化消息流展示 |
| `components/execution/AgentPlanView.tsx` | Agent 执行计划展示 |
| `components/execution/AgentStepIndicator.tsx` | 多步骤进度指示 |
| `components/execution/AgentReasoningPanel.tsx` | 推理过程折叠面板 |
| `components/execution/AgentStatePanel.tsx` | Agent 状态面板 |

### 7.3 修改的文件

| 文件 | 改动内容 |
|------|---------|
| `execution/engines/run.engine.ts` | `executor.spawn()` → `acpSessionManager.createSession()` + `prompt()`；删除 StreamJsonParser 相关逻辑；保留 cost tracking 和 event publishing；集成 AcpAguiAdapter 回调 |
| `execution/interfaces/i-executor.ts` | 可保留接口，由 ACP Session Manager 实现；或直接依赖 `IAcpSessionManager` |
| `orchestrator/orchestrators/conversation.orchestrator.ts` | `pending_wakes` 机制 → ACP session close/resume 流程 |
| `orchestrator/orchestrators/run.orchestrator.ts` | `drainPendingWakes` → 基于 ACP session 状态的编排 |
| `orchestrator/run.coordinator.ts` | 改为使用 `IAcpSessionManager` 执行 Run |
| `notification/event-broadcaster.ts` | Agent 执行事件从此组件移出，改由 AG-UI 通道处理；仅保留 Domain 事件广播 |
| `prompt/builder/` | 输出格式从纯文本 → ACP `ContentBlock[]`（text + resource） |
| `config/config.types.ts` | `cli` 配置块 → `agents` 配置块 |
| `bootstrap/composition-root.ts` | 注册 ACP 模块 + AG-UI 模块；替代 execution worker 模块 |
| `foundation/tokens.ts` | 新增 `ACP_SESSION_MANAGER_TOKEN`、`AGUI_ADAPTER_TOKEN`、`AGUI_EMITTER_TOKEN` 等；删除 `WORKER_SERVICE_TOKEN` |
| `foundation/events.ts` | 新增 `run:tool-call` 等流式事件类型（内部 EventBus 层，AG-UI 转换在 adapter 中） |
| `preload/index.ts` | 新增 `subscribeAgui()` 方法，暴露 AG-UI 事件订阅通道 |

---

## 8. 数据模型变更

### 8.1 新增表

```sql
-- ACP 会话状态跟踪
CREATE TABLE acp_sessions (
  id            TEXT PRIMARY KEY,       -- Capibara 内部 ID
  acp_session_id TEXT NOT NULL,          -- ACP 协议返回的 session ID
  agent_id      TEXT NOT NULL,           -- 配置中的 agent 标识
  role_id       TEXT NOT NULL REFERENCES roles(id),
  org_id        TEXT NOT NULL REFERENCES organizations(id),
  run_id        TEXT REFERENCES runs(id),
  status        TEXT NOT NULL DEFAULT 'active',  -- active | closed | error
  cwd           TEXT NOT NULL,
  allowed_paths TEXT,                    -- JSON array
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  closed_at     TEXT,
  resumed_count INTEGER NOT NULL DEFAULT 0
);

-- 文件访问审计日志
CREATE TABLE file_access_log (
  id          TEXT PRIMARY KEY,
  session_id  TEXT NOT NULL REFERENCES acp_sessions(id),
  role_id     TEXT NOT NULL,
  path        TEXT NOT NULL,
  operation   TEXT NOT NULL,   -- 'read' | 'write'
  allowed     INTEGER NOT NULL, -- 0 | 1
  reason      TEXT,            -- 拒绝原因
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 工具调用审计日志
CREATE TABLE tool_call_log (
  id            TEXT PRIMARY KEY,
  session_id    TEXT NOT NULL REFERENCES acp_sessions(id),
  run_id        TEXT REFERENCES runs(id),
  tool_call_id  TEXT NOT NULL,   -- ACP toolCallId
  title         TEXT NOT NULL,
  kind          TEXT,            -- 'read' | 'edit' | 'command' | 'other'
  status        TEXT NOT NULL,   -- 'pending' | 'in_progress' | 'completed' | 'failed'
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
```

### 8.3 保留不变的表

`organizations`, `skills`, `tasks`, `conversations`, `conversation_messages`, `outbox`, `cost_entries`, `pending_wakes`, `plan_tree_nodes`, `process_schemas`, `settings` — 均保留不变。

---

## 9. 配置变更

### 9.1 CapibaraConfig 变更

```typescript
// 旧配置
interface CapibaraConfig {
  // ...
  cli: {
    defaultExecutor: string;    // 'claude-cli'
    projectDir: string;
    model: string | null;
    maxTurnsPerRun: number;
    effort: 'low' | 'medium' | 'high';
    timeoutMs: number;
    extraArgs: string[];
  };
}

// 新配置
interface CapibaraConfig {
  // ...
  agents: {
    defaultAgent: string;                  // 默认使用的 agent ID
    registry: AgentRegistryEntry[];        // 已注册的 agent 列表
    globalFilePolicy: {
      denyPatterns: string[];              // 全局文件黑名单
    };
  };
  execution: {
    // ... 保留现有字段
    maxTurnsPerRun: number;                // 从 cli 移至此处
    sessionResumeEnabled: boolean;         // 是否启用 session resume
  };
}

interface AgentRegistryEntry {
  id: string;                              // 'copilot' | 'claude-agent' | 'gemini-cli'
  name: string;                            // 显示名称
  command: string;                         // 可执行文件路径
  args: string[];                          // 启动参数
  env?: Record<string, string>;            // 环境变量
  capabilities?: {                         // 已知能力（覆盖 initialize 结果）
    resumeSession?: boolean;
    loadSession?: boolean;
  };
}
```

### 9.2 配置示例

```yaml
agents:
  defaultAgent: copilot
  registry:
    - id: copilot
      name: GitHub Copilot
      command: github-copilot-agent
      args: []
    - id: claude-agent
      name: Claude Agent
      command: claude-agent
      args: []
    - id: gemini-cli
      name: Gemini CLI
      command: gemini
      args: ['--acp']
  globalFilePolicy:
    denyPatterns:
      - '**/.env'
      - '**/.env.*'
      - '**/secrets/**'
      - '**/.git/objects/**'

execution:
  maxTurnsPerRun: 25
  sessionResumeEnabled: true
```

---

## 10. 迁移策略

### 10.1 分阶段实施

```
Phase 1 — ACP 基础层（预计工作量：大）
  ├── 实现 ACP JSON-RPC transport
  ├── 实现 ACP Session Manager（create, prompt, close）
  ├── 实现 ACP Agent Spawner
  ├── 实现 ACP Update Handler（消费 session/update）
  ├── 实现 RunEngine 对接 ACP Session Manager
  ├── 删除 CLI adapter + worker 层 + MCP bridge
  └── 验证：单 Agent 执行一个 task 的完整生命周期

Phase 2 — 权限与文件控制（预计工作量：中）
  ├── 实现 ACP Permission Handler
  ├── 实现 ACP Filesystem Handler + FileAccessPolicy
  ├── 实现 ToolPermissionPolicy
  ├── Role 表 schema 扩展
  ├── 审计日志表 + 写入逻辑
  └── 验证：文件 allowlist 拒绝越界访问

Phase 3 — AI↔AI 协同（预计工作量：中）
  ├── 实现 session resume/close 流程
  ├── 改造 ConversationOrchestrator（close A → start B → resume A）
  ├── 改造 RunOrchestrator 的 pending_wakes 处理
  ├── Prompt Builder 适配 conversation reply 场景
  └── 验证：Role-A 提问 → Role-B 回答 → Role-A 恢复上下文并继续

Phase 4 — AG-UI 集成 + UI 增强（预计工作量：中）
  ├── 实现 ACP→AG-UI Adapter（事件格式转换）
  ├── 实现 AG-UI IPC Emitter（双通道事件架构）
  ├── 实现 AG-UI State Manager（StateSnapshot / StateDelta）
  ├── 实现 agui.slice.ts Zustand store
  ├── Preload 新增 subscribeAgui() 通道
  ├── EventBroadcaster 剥离 Agent 执行事件（迁移到 AG-UI 通道）
  ├── 验证：Renderer 接收并渲染 AG-UI 标准事件
  └── 验证：双通道独立工作（AG-UI + Domain Events）

Phase 5 — UI 组件开发（预计工作量：中）
  ├── ToolCallCard / ToolCallTimeline 组件
  ├── AgentMessageStream 组件（替代 raw log 展示）
  ├── AgentPlanView 组件
  ├── AgentStepIndicator 组件
  ├── AgentReasoningPanel 组件
  ├── AgentStatePanel 组件
  ├── 审计日志查看界面
  └── 多 Agent 配置管理界面
```

### 10.2 迁移策略

由于本项目是实验性项目，未上线运行，采用**直接替换**策略（非渐进式）：

1. **Feature branch**: 在 `feature/acp-migration` 分支进行所有改动
2. **删除旧代码**: 直接删除 CLI adapter、worker 层、MCP bridge 等文件
3. **新建 ACP 模块**: 在 `modules/acp/` 下实现完整 ACP 适配层
4. **改造现有模块**: RunEngine、Orchestrators、EventBroadcaster 等
5. **端到端测试**: 用至少一个 ACP Agent（建议 Gemini CLI 或 Cline，免费且原生支持 ACP）验证完整流程

### 10.3 依赖变更

```
删除:
  - 无外部依赖需要删除（Claude CLI 不是 npm 包）

新增:
  - @agent-client-protocol/sdk       (ACP TypeScript SDK，如已发布)
    或自行实现 JSON-RPC transport（~300 行代码，无外部依赖）
  - fast-json-patch                   (RFC 6902 JSON Patch，用于 AG-UI StateDelta)
  - @anthropic-ai/claude-agent-acp    (可选，如果用 Claude Agent)

保留:
  - 所有现有依赖不变
```

---

## 11. 风险与缓解

| 风险 | 严重程度 | 可能性 | 缓解措施 |
|------|---------|--------|---------|
| **ACP Agent 不支持 session/resume** | 高 | 中 | 在 `initialize` 阶段检查 `sessionCapabilities.resume`。不支持时降级为 `session/load`（replay 历史），或 `session/new` + 完整上下文重建 |
| **ACP Agent 不请求 permission 就直接执行工具** | 高 | 低 | ACP 协议规定 Agent "MAY" 请求 permission。通过 MCP 控制可用工具（不提供文件操作 MCP tool），依赖 ACP `fs/*` 方法（Client 实现，不可绕过） |
| **不同 ACP Agent 的行为差异** | 中 | 高 | 在 Agent Registry 中标记已验证的 Agent + 已知 capability。维护兼容性矩阵 |
| **ACP 协议尚在演进，可能有 breaking change** | 中 | 中 | 封装 ACP 交互在 `acp/` 模块内，协议细节不泄漏到业务层。protocol version 检查在 initialize 阶段完成 |
| **JSON-RPC over stdio 的吞吐量限制** | 低 | 低 | ACP 的 session/update 是增量推送，数据量远小于 stream-json。stdio 吞吐量对文本交互绰绰有余 |
| **MCP server 配置从 HTTP 改为 stdio** | 低 | 低 | ACP Agent 必须支持 stdio MCP transport（协议强制）。当前 MCP tool handler 逻辑完全复用，只改传输层 |
| **ACP 事件无法完整映射到 AG-UI** | 低 | 中 | ACP 的 `diff`、`terminal` 等特有事件使用 AG-UI 的 `Custom` 事件承载。前端为 Custom 事件实现专用渲染组件 |
| **CopilotKit React 组件在 Electron Renderer 中的兼容性** | 中 | 中 | CopilotKit 是标准 React 库，Electron Renderer 本质是 Chromium。如不兼容，使用自建组件消费 AG-UI 事件（agui.slice.ts 不依赖 CopilotKit） |

---

## 12. 附录

### 12.1 ACP 协议关键方法速查

| 方向 | 方法 | 用途 |
|------|------|------|
| Client → Agent | `initialize` | 协议握手，交换能力 |
| Client → Agent | `session/new` | 创建会话 |
| Client → Agent | `session/prompt` | 发送用户消息 |
| Client → Agent | `session/cancel` | 取消当前 turn |
| Client → Agent | `session/resume` | 恢复已关闭会话（不 replay） |
| Client → Agent | `session/load` | 恢复已关闭会话（replay 历史） |
| Client → Agent | `session/close` | 关闭会话 |
| Agent → Client | `session/update` | 推送 tool_call / text / plan / diff |
| Agent → Client | `session/request_permission` | 请求工具调用权限 |
| Agent → Client | `fs/read_text_file` | 读取文件（Client 实现） |
| Agent → Client | `fs/write_text_file` | 写入文件（Client 实现） |
| Agent → Client | `terminal/create` | 创建终端（可选） |

### 12.2 AG-UI 协议事件速查

| 类别 | 事件类型 | 用途 |
|------|---------|------|
| Lifecycle | `RunStarted` | Run 开始，携带 runId + threadId |
| Lifecycle | `RunFinished` | Run 结束，含 stopReason + outcome (success/interrupt) |
| Lifecycle | `RunError` | Run 异常终止 |
| Lifecycle | `StepStarted` / `StepFinished` | 命名步骤的开始/结束 |
| Text | `TextMessageStart` | 消息开始，分配 messageId + role |
| Text | `TextMessageContent` | 流式文本增量 delta |
| Text | `TextMessageEnd` | 消息完成 |
| ToolCall | `ToolCallStart` | 工具调用开始，携带 toolCallId + toolCallName |
| ToolCall | `ToolCallArgs` | 流式工具参数 delta |
| ToolCall | `ToolCallEnd` | 工具调用完成 |
| ToolCall | `ToolCallResult` | 工具执行结果 |
| State | `StateSnapshot` | 完整状态快照 |
| State | `StateDelta` | JSON Patch (RFC 6902) 增量更新 |
| State | `MessagesSnapshot` | 完整对话历史快照 |
| Activity | `ActivitySnapshot` / `ActivityDelta` | 结构化活动进度（PLAN、SEARCH 等） |
| Reasoning | `ReasoningStart` / `ReasoningMessageContent` / `ReasoningEnd` | Agent 推理过程可视化 |
| Special | `Custom` | ACP 特有事件承载（diff、terminal、permission） |
| Special | `Raw` | 外部系统事件透传 |

### 12.3 协议资源

| 资源 | 链接 |
|------|------|
| ACP 官方文档 | https://agentclientprotocol.com |
| ACP GitHub | https://github.com/agentclientprotocol/agent-client-protocol |
| ACP TypeScript SDK | https://agentclientprotocol.com/libraries/typescript |
| 已支持 Agent 列表 | https://agentclientprotocol.com/get-started/agents |
| 已支持 Client 列表 | https://agentclientprotocol.com/get-started/clients |
| AG-UI 官方文档 | https://docs.ag-ui.com |
| AG-UI GitHub | https://github.com/ag-ui-protocol/ag-ui |
| AG-UI 事件规范 | https://docs.ag-ui.com/concepts/events |
| CopilotKit (AG-UI 参考实现) | https://www.copilotkit.ai |
| ACP-to-AG-UI Bridge | https://github.com/namanrajpal/acp-to-agui |

### 12.4 Capibara 协议栈全景

```
┌───────────────────────────────────────────────────────┐
│                  Capibara 协议栈                       │
│                                                       │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐            │
│  │   ACP    │  │   MCP    │  │  AG-UI   │            │
│  │ Client↔  │  │ Agent↔   │  │ Agent→   │            │
│  │ Agent    │  │ Tool     │  │ UI       │            │
│  │ 会话管理  │  │ 工具调用  │  │ 事件推送  │            │
│  └────┬─────┘  └────┬─────┘  └────┬─────┘            │
│       │              │              │                 │
│       └──────┬───────┘              │                 │
│              │                      │                 │
│    ACP 原生集成 MCP:         ACP → AG-UI 适配:        │
│    session/new 传递           session/update 转换为    │
│    mcpServers 配置            AG-UI 标准事件格式       │
│                               通过 IPC 推送到 Renderer │
│                                                       │
│  ┌─────────────────────────────────────────────┐      │
│  │  不引入: A2A (Hub-and-Spoke 架构不需要)      │      │
│  │  不引入: SSE (Electron IPC 承载 AG-UI 事件)  │      │
│  └─────────────────────────────────────────────┘      │
└───────────────────────────────────────────────────────┘

三协议协作关系：
  ACP (管控) ──── Agent 生命周期、权限、文件访问
  MCP (能力) ──── Agent 可调用的 Capibara 工具
  AG-UI (展示) ── Agent 执行状态的标准化 UI 呈现
```

### 12.5 决策记录 (ADR)

**ADR-001: 选择 ACP 替代 CLI 直接调用**
- 状态: 已批准
- 背景: CLI fire-and-forget 模式导致无法实现 AI↔AI 协同、无法控制行为、无法限制文件访问
- 决策: 采用 Agent Client Protocol 作为统一的 Agent 管理协议
- 后果: 需要重写执行引擎层，但上层业务逻辑（Orchestrator、Domain Service、DB）基本不变

**ADR-002: 不引入 A2A 协议**
- 状态: 已批准
- 背景: Capibara 是 Hub-and-Spoke 架构，所有 Agent 由 Capibara 中央编排
- 决策: 不引入 A2A，Agent 间通信通过 Capibara 的 ConversationService + ACP session 管理完成
- 后果: 简化架构，但未来如需跨实例 Agent 互联，需要重新评估

**ADR-003: 多 Agent 支持**
- 状态: 已批准
- 背景: ACP 支持多种 Agent 后端
- 决策: 引入 Agent Registry 配置，不同 Role 可绑定不同 Agent
- 后果: 同一 Org 内可以混用 Copilot、Claude Agent、Gemini CLI 等

**ADR-004: 引入 AG-UI 协议作为 UI 控制标准层**
- 状态: 已批准
- 背景: 当前自定义 DesktopEvent 缺少工具调用可视化、状态同步、推理过程展示等关键能力。ACP 的 session/update 提供了丰富的结构化事件，但直接推送到前端缺乏标准化
- 决策: 引入 AG-UI 协议作为 Agent 执行事件的标准化 UI 层。采用双通道架构：AG-UI 通道专管 Agent 执行流，现有 Domain Events 通道保持不变
- 后果: 
  - 获得 16 种标准化事件类型，UI 能力大幅提升
  - 未来 Web 化只需切换传输层（IPC → SSE），事件格式和前端消费逻辑零改动
  - 可选接入 CopilotKit React 组件生态
  - 新增 ACP→AG-UI 适配层的维护成本

**ADR-005: AG-UI 传输层使用 Electron IPC 而非 SSE**
- 状态: 已批准
- 背景: AG-UI 协议是 transport agnostic 的，不强制使用 SSE
- 决策: 在 Electron 桌面应用中，使用 IPC channel `agui:event` 作为 AG-UI 事件的传输层
- 后果: 无需引入 HTTP server 或 SSE 基础设施。未来 Web 化时替换为 SSE/WebSocket 传输

---

> **审阅要点：**
> 1. Phase 1 的 ACP 基础层是否需要先做 PoC 验证（建议用 Gemini CLI 或 Cline 做单 Agent 端到端测试）
> 2. FileAccessPolicy 的三层防护是否足够，是否需要 OS 级沙箱作为第四层
> 3. 不支持 session/resume 的 Agent 的降级策略是否可接受
> 4. 审计日志的存储策略（当前设计为 SQLite 本地表，是否需要导出能力）
> 5. MCP server 从 HTTP 改为 stdio 传输的可行性确认
> 6. AG-UI 双通道架构中，两类事件的边界划分是否清晰（Agent 执行 vs 业务领域）
> 7. 是否评估引入 CopilotKit React 组件作为 AG-UI 前端消费方案，还是全部自建组件
> 8. ACP 特有事件（diff / terminal）使用 AG-UI Custom 事件承载的方案是否可接受，是否需要扩展 AG-UI 事件类型
