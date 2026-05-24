# Capibara ACP 迁移遗留代码清理计划

> **日期**: 2025-05-24
> **基准**: `legacy-code-audit-report.md` + 补充验证
> **状态**: 待执行

---

## 执行概览

基于审计报告的 6 项发现（L1-L6）以及补充验证发现的 7 项遗漏（M1-M7），按风险和依赖关系划分为 4 个执行步骤。

```
Step 0 ──→ Step 1 ──→ Step 2 ──→ Step 3
死文件删除   配置/UI/DI   协作机制评估   IExecutor 重构
(零风险)    (低风险)     (需分析)       (中风险)
```

---

## Step 0: 死文件与空目录清理

> **风险**: 无 — 这些文件/目录无任何代码引用
> **预计工作量**: 10 分钟

### 0.1 删除孤立测试文件（M1-M3）

根目录 `tests/unit/` 下 3 个测试文件 import 了已删除的源码模块，无法编译：

| 文件 | 引用的已删除模块 |
|------|-----------------|
| `tests/unit/claude-cli-adapter.test.ts` | `src/infrastructure/cli-adapter/claude-cli.adapter.js` |
| `tests/unit/config-schema.test.ts` | `src/config/config.schema.js`（旧 schema，非 Electron 内的新版） |
| `tests/unit/state-machine.test.ts` | `src/application/state-machine/state-machine.js` |

**动作**: 删除这 3 个文件。

### 0.2 删除 CLI 诊断脚本（M4）

| 文件 | 说明 |
|------|------|
| `tests/diagnostic/cli-spawn-diagnostic.ts` | CLI 时代的 spawn 诊断脚本，测试 "why Claude CLI exits early"，ACP 架构下无意义 |

**动作**: 删除文件。若 `tests/diagnostic/` 目录随之变空，一并删除。

### 0.3 删除过时配置文件（M5）

| 文件 | 说明 |
|------|------|
| `automation.config.json` | 使用旧 schema（`cli.cliPath`, `worker`, `evaluator`, `pipeline`），新 Electron app 不引用此文件 |

**动作**: 删除文件。

### 0.4 清理空目录（M7）

| 目录 | 说明 |
|------|------|
| `apps/electron/src/core/modules/execution/workers/` | 文件已在 ACP Phase 1 中清空，目录残留 |

**动作**: 删除空目录。

### 0.5 检查清单

```
[ ] rm tests/unit/claude-cli-adapter.test.ts
[ ] rm tests/unit/config-schema.test.ts
[ ] rm tests/unit/state-machine.test.ts
[ ] rm tests/diagnostic/cli-spawn-diagnostic.ts
[ ] rm tests/diagnostic/（如果变空）
[ ] rm automation.config.json
[ ] rm -r apps/electron/src/core/modules/execution/workers/
[ ] 运行 pnpm tsc --noEmit 确认无影响
[ ] 运行 pnpm test 确认无影响
```

---

## Step 1: 配置层 + HealthCheck + DI Token + 兼容垫片

> **风险**: 低 — 纯重命名和删除，不改变运行时逻辑
> **预计工作量**: 1-2 小时
> **依赖**: Step 0（无硬依赖，可并行）

### 1.1 L1 — `cli` 配置块重命名为 `agents`

**目标结构**：

```typescript
// 新结构
agents: {
  defaultAgent: string;       // 从 cli.defaultExecutor 迁移
};
execution: {
  // ... 保留现有字段
  maxTurnsPerRun: number;     // 从 cli 迁移
};
// 删除: model, effort, timeoutMs, extraArgs, projectDir
```

**字段去留决策**：

| 字段 | 决策 | 理由 |
|------|------|------|
| `defaultExecutor` | ✅ 保留，移至 `agents.defaultAgent` | 仍需指定默认 Agent |
| `projectDir` | ❌ 删除 | 已由 `org.workspacePath` 覆盖 |
| `model` | ❌ 删除 | ACP 通过 `_meta.claudeCode.options.settings` 传模型 |
| `maxTurnsPerRun` | ✅ 保留，移至 `execution` | 仍需限制单次 Run 的最大轮次 |
| `effort` | ❌ 删除 | CLI `--effort` 参数，ACP 无对应 |
| `timeoutMs` | ❌ 删除 | ACP session 有自己的生命周期管理 |
| `extraArgs` | ❌ 删除 | CLI 额外参数，ACP 不需要 |

**改动文件**：

| 文件 | 改动 |
|------|------|
| `apps/electron/src/core/config/config.types.ts` | `cli` 块 → `agents` 块，删除无用字段 |
| `apps/electron/src/core/config/config.schema.ts` | 同步修改 zod schema |
| `apps/electron/src/core/config/config.defaults.ts` | 同步修改默认值 |
| `apps/electron/src/core/bootstrap/composition-root.ts:95` | `config.cli?.defaultExecutor` → `config.agents.defaultAgent` |
| `apps/electron/tests/helpers/fixtures.ts` | 测试 fixture 中 `cli` → `agents` |

**注意**: 修改前搜索全代码库 `config.cli` 确认无其他引用。

### 1.2 L3 — HealthCheckStep 从 CLI 改为 ACP Agent

**后端改动**（`system.handlers.ts`）：

- 将 `claudeCli` 字段重命名为 `acpAgent`
- 实现真实检查逻辑：验证 ACP Agent 二进制是否可解析（调用现有的 `resolveAgentBinaryPath()` 或等价逻辑）
- 移除硬编码 stub

**前端改动**（`HealthCheckStep.tsx`）：

- `SystemCheckResult.claudeCli` → `SystemCheckResult.acpAgent`
- 移除 "Claude Code CLI is required..." 安装提示
- 移除 `installCommand` 显示（Agent 随 npm install 安装，无需手动安装）

**国际化改动**（3 文件）：

| 文件 | 改动 |
|------|------|
| `apps/electron/src/shared/locale/types.ts` | `claudeCli: string` → `acpAgent: string`，删除 `installCommand` |
| `apps/electron/src/shared/locale/en-US.ts` | `claudeCli: 'Claude Code CLI'` → `acpAgent: 'AI Agent'`，删除 `installCommand` |
| `apps/electron/src/shared/locale/zh-CN.ts` | `claudeCli: 'Claude Code CLI'` → `acpAgent: 'AI Agent'`，删除 `installCommand` |

**M6 补充**: `installCommand` 的值 `npm install -g @anthropic-ai/claude-code` 引用了旧的 npm 包名，应一并删除而非更新。

### 1.3 L5 — 删除未使用的 DI Token

**文件**: `apps/electron/src/core/foundation/tokens.ts`

删除以下 5 个从未被注册或解析的 Token：

```typescript
// 删除：L38-41
export const ACP_SESSION_MANAGER_TOKEN = Symbol('ACP_SESSION_MANAGER_TOKEN');
export const ACP_EXECUTOR_TOKEN = Symbol('ACP_EXECUTOR_TOKEN');
export const ACP_UPDATE_HANDLER_TOKEN = Symbol('ACP_UPDATE_HANDLER_TOKEN');
export const ACP_MCP_CONFIG_BUILDER_TOKEN = Symbol('ACP_MCP_CONFIG_BUILDER_TOKEN');

// 删除：L67
export const SYSTEM_CHECK_SERVICE_TOKEN = Symbol('SYSTEM_CHECK_SERVICE_TOKEN');
```

**保留**: `EXECUTOR_TOKEN`（仍由 `execution.module.ts:53` 使用）。

### 1.4 L6 — 删除 `claude-cli` 向后兼容垫片

**文件**: `apps/electron/src/core/bootstrap/composition-root.ts`

删除 `normalizeDefaultAgentId` 中的 `claude-cli` 分支：

```typescript
// 删除此行：
if (requested === 'claude-cli') return 'claude-agent';
```

**前置确认**: 已验证代码库中无任何 `capibara.config.json` 文件包含 `claude-cli` 值。

### 1.5 补充 — 过时注释清理

| 文件 | 行号 | 当前内容 | 改为 |
|------|------|---------|------|
| `composition-root.ts` | ~L79 | `// system environment (e.g. to pin a specific CLI version).` | `// system environment (e.g. to pin a specific agent binary version).` |

### 1.6 检查清单

```
[ ] 修改 config.types.ts：cli → agents，删除 5 个字段
[ ] 修改 config.schema.ts：同步 zod schema
[ ] 修改 config.defaults.ts：同步默认值
[ ] 修改 composition-root.ts：config.cli → config.agents，删 claude-cli 分支，更新注释
[ ] 修改 fixtures.ts：测试 fixture 同步
[ ] 修改 system.handlers.ts：实现 ACP Agent 真实检查
[ ] 修改 HealthCheckStep.tsx：claudeCli → acpAgent，移除安装提示
[ ] 修改 locale types.ts / en-US.ts / zh-CN.ts：更新键名和文案
[ ] 删除 tokens.ts 中 5 个未使用 Token
[ ] 运行 pnpm tsc --noEmit
[ ] 运行 pnpm test
[ ] 手动验证 Onboarding HealthCheck 页面
```

---

## Step 2: pending_wakes 与 SuspensionManager 分析评估 ✅ 已完成

> **决策**: 方案 A — 保留两套机制，清理注释明确边界
> **理由**: 两套机制服务于不同抽象层次，不可合并
>   - `pending_wakes` = 调度层（org 内同时只允许一个 active run，排队等待）
>   - `SuspensionManager` = 会话层（ACP session 挂起/恢复，保留 agent 上下文）
> **已完成工作**:
>   - 重写 `ConversationOrchestrator` 类 JSDoc，文档化双路径架构
>   - 为 `onResolved()` 添加方法级 JSDoc，描述两条互斥路径
>   - 将内联注释从 "Original behavior" 改为 Path 1/Path 2 结构化标注
>   - 为 `RunOrchestrator.drainPendingWakes()` 添加 JSDoc，说明与 suspension 的正交关系

### 2.1 L4 — 当前状态

两套机制并存，服务于不同层次的 AI↔AI 协作：

```
pending_wakes:        Role 级别排队（"Role-B 正忙，排队等 Run 结束"）
SuspensionManager:    Session 级别挂起（"Agent-A 等待 inquiry 回复"）
```

**交叉点**: `ConversationOrchestrator.onResolved()` 中存在两条路径分叉：
- L83-113: SuspensionManager 路径（恢复挂起的 ACP session）
- L116-118: tryWake/pending_wakes 路径（触发排队的唤醒）

### 2.2 分析任务

```
[ ] 绘制完整的 AI↔AI 协作流程图，标注两套机制的介入点
[ ] 列出所有场景组合，明确哪些场景只由一套机制处理
[ ] 评估合并可行性：pending_wakes 的排队语义能否由 SuspensionManager 统一表达？
[ ] 清理 ConversationOrchestrator.onResolved() 的分叉逻辑，添加职责边界注释
```

### 2.3 可能的决策

| 方案 | 描述 | 适用条件 |
|------|------|---------|
| **A: 保留两套** | 清理注释，明确边界 | 两套机制语义确实不同且不可替代 |
| **B: 合并到 SuspensionManager** | 将 pending_wakes 的排队功能统一到 suspension 模型 | 排队语义可用 suspension 的 "awaiting" 状态表达 |
| **C: 替换 pending_wakes** | 用新的 WakeQueue 替代 pending_wakes，与 suspension 正交 | 需要更清晰的抽象层次分离 |

---

## Step 3: IExecutor 接口重构

> **风险**: 中 — 接口变更影响 RunEngine 核心路径
> **预计工作量**: 4-6 小时
> **依赖**: Step 1（配置层清理完成后再动接口层）

### 3.1 L2 — 重构方向：方案 A（渐进式）

保持 `IExecutor` 抽象，清理无意义的 CLI 残留字段：

```typescript
// 目标接口
export type AgentEventCallback = (event: AgentEvent) => void;

export interface ExecutorHandle {
  runId: string;
  // pid: 移除（ACP Agent PID 由 AcpAgentSpawner 管理，不属于此层）
  complete(): Promise<ExecutorOutput>;
  cancel(): void;
  onEvent(callback: AgentEventCallback): void;   // 替换 onLog
}
```

### 3.2 `ExecutorOutput` 清理

```typescript
export interface ExecutorOutput {
  // exitCode: 移除（用 status 替代）
  status: 'succeeded' | 'failed' | 'cancelled' | 'interrupted' | 'suspended';
  summary: string | null;
  errorMessage: string | null;
  // model: 移除（ACP 不返回模型名称，且当前无消费方）
  sessionId: string | null;
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
}
```

### 3.3 `AgentEvent` 类型设计

```typescript
// 结构化事件，替代 stdout/stderr 原始流
export type AgentEvent =
  | { type: 'text'; content: string }
  | { type: 'tool_call'; name: string; input: unknown }
  | { type: 'tool_result'; name: string; output: unknown }
  | { type: 'plan'; steps: string[] }
  | { type: 'error'; message: string }
  | { type: 'status'; status: string };
```

### 3.4 改动文件

| 文件 | 改动 |
|------|------|
| `execution/interfaces/i-executor.ts` | 移除 `pid`、`HandleLogCallback`，添加 `AgentEvent`、`AgentEventCallback`，`onLog` → `onEvent` |
| `acp/client/acp-executor.ts` | 移除 `process.pid`，适配 `onEvent`（直接传递结构化事件，不再降级为 stdout） |
| `acp/handlers/acp-update.handler.ts` | 移除 stdout 模拟逻辑，直接发射 `AgentEvent` |
| `execution/engines/run.engine.ts` | `handle.onLog` → `handle.onEvent`，消费结构化事件；移除 `pid` 日志 |
| `execution/types/execution.types.ts` | `ExecutorOutput` 移除 `exitCode` 和 `model` |

### 3.5 测试影响

| 文件 | 改动 |
|------|------|
| `tests/unit/execution/run-engine.test.ts` | 更新 mock 的 `ExecutorHandle`（移除 `pid`、`onLog` → `onEvent`），更新 `ExecutorOutput`（移除 `exitCode`、`model`），修复 `'CLI error'` 测试字面量 |

### 3.6 检查清单

```
[ ] 设计 AgentEvent 类型（可先从 ACP session/update 事件类型推导）
[ ] 修改 i-executor.ts 接口
[ ] 修改 acp-executor.ts 实现
[ ] 修改 acp-update.handler.ts（移除 stdout 模拟）
[ ] 修改 run.engine.ts 消费方
[ ] 修改 execution.types.ts
[ ] 更新所有相关测试
[ ] 运行 pnpm tsc --noEmit
[ ] 运行 pnpm test
[ ] 端到端验证：启动 Org → 创建 Task → 执行 Run → 确认事件正常推送到 UI
```

---

## 附录 A: 报告笔误修正

审计报告中发现 1 处笔误：

| 位置 | 报告写法 | 实际代码 |
|------|---------|---------|
| Section 2.2 `config.schema.ts` | `projectByDir` | `projectDir` |

## 附录 B: 不处理项

以下项目经确认**不是遗留代码**，不在清理范围内：

| 项目 | 理由 |
|------|------|
| `acp-update.handler.ts` 忽略 `agent_thought_chunk` / `available_commands_update` | 有意忽略，Phase 4 AG-UI 实现时处理 |
| `tool-permission.policy.ts:72` TODO | 已知待实现功能，非遗留 |
| AG-UI 模块未实现 | Phase 4 计划，非遗留代码 |
| `pending_wakes` 机制 | 仍在活跃使用（Step 2 评估后决策） |
| `shared/locale.ts` re-export 兼容层 | 低优先级，不影响功能 |
| `system.handlers.ts:99` Legacy snapshot handler | 仍在使用中，仅注释标记为 legacy |

## 附录 C: 完整文件影响清单

```
删除:
  tests/unit/claude-cli-adapter.test.ts
  tests/unit/config-schema.test.ts
  tests/unit/state-machine.test.ts
  tests/diagnostic/cli-spawn-diagnostic.ts
  automation.config.json
  apps/electron/src/core/modules/execution/workers/  (空目录)

修改 (Step 1):
  apps/electron/src/core/config/config.types.ts
  apps/electron/src/core/config/config.schema.ts
  apps/electron/src/core/config/config.defaults.ts
  apps/electron/src/core/bootstrap/composition-root.ts
  apps/electron/src/core/foundation/tokens.ts
  apps/electron/src/core/ipc-handlers/system.handlers.ts
  apps/electron/src/renderer/components/onboarding/HealthCheckStep.tsx
  apps/electron/src/shared/locale/types.ts
  apps/electron/src/shared/locale/en-US.ts
  apps/electron/src/shared/locale/zh-CN.ts
  apps/electron/tests/helpers/fixtures.ts

修改 (Step 3):
  apps/electron/src/core/modules/execution/interfaces/i-executor.ts
  apps/electron/src/core/modules/acp/client/acp-executor.ts
  apps/electron/src/core/modules/acp/handlers/acp-update.handler.ts
  apps/electron/src/core/modules/execution/engines/run.engine.ts
  apps/electron/src/core/modules/execution/types/execution.types.ts
  apps/electron/tests/unit/execution/run-engine.test.ts
```
