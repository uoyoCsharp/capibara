# Requirements Analysis: 任务进度反馈 + 人工介入功能

> Change ID: `20260320-progress-feedback-human-intervention`
> Date: 2026-03-20
> Source: `docs/project background.md` - Functional Requirements #3, #4

---

## Features Identified

| ID | Feature | Description | Priority |
|----|---------|-------------|----------|
| F1 | 任务进度反馈 | 系统提供完整的任务进度反馈和执行情况（LLM输出、执行结果、评估结果、执行日志等），便于用户随时了解流程状态和进展 | High |
| F2 | 人工介入 | 半自动/手动模式下，系统在关键点停止流程等待用户反馈，并展示当前上下文信息和执行结果 | High |

---

## F1: 任务进度反馈 - 现状分析

### 需求原文

> 系统会在任务执行时，提供完整的任务进度反馈和任务执行情况，比如LLM的输出结果，执行结果，评估结果，执行日志等，便于用户随时了解整个流程的状态和进展。

### 现有实现

#### 已实现能力

| 能力 | 实现位置 | 说明 |
|------|----------|------|
| 事件发布 | `IEventBus` + `EmitteryEventBus` | 支持 17 种事件类型，覆盖 pipeline/phase/worker/evaluator/conductor/human/cost |
| 关键事件 | `events.types.ts` | `pipeline:started/completed/failed`, `phase:started/completed/retry`, `worker:started/completed`, `evaluator:started/completed`, `conductor:decided`, `human:intervention_requested/response_received` |
| 事件数据 | `PipelineEvent.data` | 包含 `reason`, `action`, `cost`, `attempt` 等关键信息 |

#### 缺失能力

| 缺失项 | 影响 | 优先级 |
|--------|------|--------|
| **LLM 输出结果反馈** | 用户无法看到 Worker 实际输出内容 | High |
| **执行日志汇总** | 事件流式发布，无持久化汇总，无法回顾历史 | High |
| **评估结果详情** | `evaluator:completed` 只有 `resultCount`，无具体评估内容 | Medium |
| **进度可视化接口** | 无对外暴露的查询 API（如 HTTP/WebSocket） | Medium |
| **成本实时反馈** | `cost:threshold_warning` 已定义但未实现 | Low |

### 差距分析

```
需求期望                          现有实现                     差距
─────────────────────────────────────────────────────────────────────
LLM 输出结果                       事件中无 payload             WorkerResult.output 未上报
执行结果                           phase:completed 有 attempts  无 success/failure 详情
评估结果                           仅 resultCount              无 evalResults 内容
执行日志                           事件流式发布                无持久化/聚合机制
```

### 澄清结果

| ID | Question | Answer |
|----|----------|--------|
| C1 | 进度反馈需要"实时推送"还是"查询式获取"？ | **查询式获取** - 无需 WebSocket，提供查询 API |
| C2 | 执行日志需要持久化吗？保留多长时间？ | **需要持久化** - 需设计存储机制 |
| C3 | 是否需要支持多客户端订阅？ | 未明确，暂不考虑 |

**架构影响**：查询式获取简化了设计，无需实现推送机制；日志持久化需扩展 `IStateStore` 或新增 `IExecutionLogStore`。

---

## F2: 人工介入 - 现状分析

### 需求原文

> 当配置为半自动或者手动时，系统会在需要人工介入的关键点停止流程，并等待用户的反馈和输入，来推动流程的继续进行。当人工介入时，应该展示当前的上下文信息和相关的执行结果，便于用户做出决策和提供反馈。

### 现有实现

#### 已实现能力

| 能力 | 实现位置 | 说明 |
|------|----------|------|
| 交互模式配置 | `InteractionMode` | 支持 `auto` / `semi-auto` / `manual` 三种模式 |
| 人工介入 Handler | `HumanInteractionHandler` | 提供 `requestApproval(context, reason)` 方法 |
| 策略模式 | `IHumanInteractionStrategy` | 可扩展不同交互方式 |
| Terminal 策略 | `TerminalStrategy` | 通过 stdin/stdout 进行交互 |
| GitHub Comment 策略 | `GitHubCommentStrategy` | Skeleton 实现，标记为 Phase C |
| 介入事件 | `human:intervention_requested/response_received` | 事件发布机制已就绪 |
| Conductor 升级 | `ConductorAction.escalate` | Conductor 可决策升级到人工处理 |

#### 缺失能力

| 缺失项 | 影响 | 优先级 |
|--------|------|--------|
| **上下文信息展示** | `requestApproval(reason)` 只传 reason，无上下文详情 | High |
| **执行结果展示** | 人工介入时无法看到 Worker/Evaluator 的输出 | High |
| **交互模式判定** | `WorkerNodeHandler.handle()` 中 `escalate` 直接 `break`，未根据 mode 决定 | High |
| **手动模式支持** | 无明确的"每个关键点都介入"实现 | Medium |
| **半自动模式关键点定义** | 未定义哪些点需要人工介入 | High |

### 关键代码路径分析

#### Conductor escalate 处理现状

```typescript
// worker-node-handler.ts:135-139
if (decision.action === 'escalate') {
  this.logger.warn({ phase, nodeId: node.id }, 'Escalated to human intervention');
  emitNodeEvent(this.eventBus, context.pipelineId, phase, 'human:intervention_requested', {
    reason: decision.reason,
  });
  break;  // 直接退出循环，未调用 HumanInteractionHandler
}
```

**问题**：只发事件，未调用 `HumanInteractionHandler.requestApproval()`，流程直接终止。

#### HumanInteractionHandler 未被使用

```typescript
// human-interaction.handler.ts
// 虽然实现了完整的策略模式，但在 PipelineService/WorkerNodeHandler 中未被注入和调用
```

### 交互模式语义澄清

| Mode | 语义 | 关键点定义 |
|------|------|-----------|
| `auto` | 完全自动，无人介入 | - |
| `semi-auto` | Conductor escalate 时介入 | 由 Conductor 决定何时升级 |
| `manual` | 每个 phase 完成都介入 | 待定义 |

### 澄清结果

| ID | Question | Answer |
|----|----------|--------|
| C4 | `semi-auto` 模式下，人工介入点是否仅限于 Conductor escalate？ | **是** - 仅 Conductor escalate 触发 |
| C5 | `manual` 模式下，"每个关键点"具体指什么？ | **每一轮 worker 处理完成结束** |
| C6 | 人工介入时，需要展示哪些"上下文信息"？ | **前面 3 轮的交互记录上下文 + 最后一轮的输出结果** |
| C7 | 用户反馈是否需要更丰富的交互？ | 未明确，暂按现有 approve/reject + feedback |

### 交互模式行为定义

| Mode | 介入时机 | 介入频率 |
|------|----------|----------|
| `auto` | 无介入 | - |
| `semi-auto` | Conductor `escalate` 决策时 | 按需 |
| `manual` | 每轮 Worker 处理完成后 | 每轮必介入 |

### 人工介入上下文展示规格

```
┌─────────────────────────────────────────────────────────┐
│  Human Intervention Request                              │
├─────────────────────────────────────────────────────────┤
│  Pipeline: {pipelineId}                                  │
│  Phase: {currentPhase}                                   │
│  Round: {currentRound}                                   │
├─────────────────────────────────────────────────────────┤
│  ## Recent Interactions (Last 3 Rounds)                  │
│                                                          │
│  Round N-2:                                              │
│    - Worker Output: {truncated output}                   │
│    - Conductor Decision: approve/revise                  │
│    - Feedback: {if any}                                  │
│                                                          │
│  Round N-1:                                              │
│    - ...                                                 │
│                                                          │
│  Round N (Current):                                      │
│    - Worker Output: {full output}                        │
│    - Evaluator Results: {if evaluated}                   │
│    - Conductor Reason: {escalate reason}                 │
├─────────────────────────────────────────────────────────┤
│  Approve? (y/n): _                                       │
│  Feedback: _                                             │
└─────────────────────────────────────────────────────────┘
```

---

## 受影响文件

| 文件 | 影响 | 说明 |
|------|------|------|
| `src/core/types/events.types.ts` | **修改** | 增加事件 payload 字段（LLM输出、评估详情等） |
| `src/application/pipeline/worker-node-handler.ts` | **修改** | 集成 HumanInteractionHandler，根据 mode 决定介入行为 |
| `src/application/human-interaction/human-interaction.handler.ts` | **修改** | 增强 `requestApproval` 接口，支持上下文信息展示 |
| `src/application/human-interaction/strategies/human-interaction.strategy.ts` | **修改** | 接口增强，支持上下文参数 |
| `src/application/human-interaction/strategies/terminal.strategy.ts` | **修改** | 实现上下文信息展示 |
| `src/infrastructure/observability/emittery-event-bus.ts` | **修改** | 可选：增加事件持久化/日志聚合 |
| `src/core/types/pipeline.types.ts` | **修改** | 可能需要新增 `PipelineProgress` 类型 |

---

## Assumptions Made

| ID | Assumption | Reason |
|----|------------|--------|
| A1 | 进度反馈优先实现 CLI 查询接口，后续扩展 HTTP API | Electron UI 为未来计划，先满足基本需求 |
| A2 | 事件 payload 大小需要限制，避免内存问题 | LLM 输出可能很大，需要截断或分页策略 |
| A3 | 执行日志持久化使用文件存储（JSON/SQLite） | 复用现有 `IStateStore` 或 `IArtifactStore` 模式 |
| A4 | "3轮交互记录"存储在 PipelineContext 中 | 简化实现，随 Pipeline 状态持久化 |

---

## Summary

### F1 任务进度反馈

**已确认需求**：
- 查询式获取（非实时推送）
- 执行日志持久化

**实现差距**：
- 事件基础设施已就绪，但数据内容不足
- 核心缺失：LLM 输出上报、评估详情、执行日志持久化

### F2 人工介入

**已确认需求**：
- `semi-auto`: 仅 Conductor escalate 触发
- `manual`: 每轮 Worker 完成后介入
- 展示：前 3 轮交互记录 + 最新输出

**实现差距**：
- 框架已搭建，但未集成到主流程
- 核心缺失：mode 判定逻辑、上下文信息展示、交互记录存储

---

**Suggested Next Steps**:
- `#design` - 设计解决方案架构
