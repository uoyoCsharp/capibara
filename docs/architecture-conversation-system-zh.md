---
version: '2.0'
date: '2026-04-04'
status: 'draft-v2'
source: '_bmad-output/planning-artifacts/architecture-conversation-system.md'
audience: 'human-readable'
language: 'zh-CN'
---

> **⚠ ARCHIVED — Superseded by refactoring-architecture-plan v2.1**
>
> This draft described the initial Conversation module design. The ideas in §4–§6 (Conversation entity, state machine, routing策略) landed in production, but v2.1 restructured how they are wired:
> - `InquiryRouter` moved from Layer 1 (inside `modules/conversation/`) to Layer 2 (`modules/coordination/routing/`).
> - Conversation → Organization dependency removed; routing is now triggered by the `conversation:needs-routing` event.
> - `Conversation.metadata` is now a discriminated union by type, not `Record<string, unknown>`.
>
> Authoritative source: `_bmad-output/planning-artifacts/refactoring-architecture-plan.v2.1.md`.

---

# Capibara 对话系统架构 v2（全新设计）

> **前提**：这是一个全新项目，尚未上线。不受任何历史兼容约束。在复杂度有明确价值支撑的前提下，鼓励大胆采用新的架构模式。

---

## 目录

1. [设计原则](#1-设计原则)
2. [架构总览](#2-架构总览)
3. [架构决策记录](#3-架构决策记录)
4. [对话模型](#4-对话模型)
5. [对话状态机](#5-对话状态机)
6. [路由策略引擎](#6-路由策略引擎)
7. [唤醒触发器扩展](#7-唤醒触发器扩展)
8. [MCP 工具扩展](#8-mcp-工具扩展)
9. [上下文注入](#9-上下文注入)
10. [超时与升级](#10-超时与升级)
11. [循环检测与安全](#11-循环检测与安全)
12. [并发对话管理](#12-并发对话管理)
13. [人工交互模型](#13-人工交互模型)
14. [数据模型扩展](#14-数据模型扩展)
15. [事件扩展](#15-事件扩展)
16. [代码结构](#16-代码结构)
17. [Prompt Builder 扩展](#17-prompt-builder-扩展)
18. [审计与可观测性](#18-审计与可观测性)
19. [非功能性需求](#19-非功能性需求)
20. [实施分阶段计划](#20-实施分阶段计划)
21. [验收清单](#21-验收清单)

---

## 1. 设计原则

### 1.1 基本前提

1. **无历史兼容负担**：现有数据模型和执行流可以自由替换或扩展。
2. **可交付优先**：优先构建能稳定上线的架构，再逐步增强。
3. **复杂度必须有价值**：每个抽象都必须用具体的、可追溯的价值来证明其存在。

### 1.2 核心原则

| # | 原则 | 含义 |
|---|------|------|
| P1 | **简单内核，可插拔边缘** | 对话核心保持最小化。路由策略、超时策略、升级规则均以注入方式提供，不硬编码。 |
| P2 | **对话 = 持久化工作流** | 多轮对话不是"消息队列"，而是一个可恢复、可审计的工作流实例，具有显式状态转换。 |
| P3 | **默认 AI 上级路由** | 除非角色开启了 `requiresHumanApproval=true`，所有路由默认指向上级 AI。人工是例外，不是常态。 |
| P4 | **本地优先可靠性** | 所有状态存储在 SQLite 中。无网络依赖。从持久化的工作流状态中崩溃恢复。 |
| P5 | **事件驱动集成** | 对话系统通过 EventBus 与现有 OrgOrchestrator 集成，不分叉事件循环。 |

---

## 2. 架构总览

### 2.1 架构风格

- **模块化单体** — 在单个 Main Process 内划分具有明确边界的领域模块。
- **事件驱动内核** — 对话生命周期事件通过现有 Emittery EventBus 流转。
- **持久化工作流运行时** — 对话状态在任何副作用之前持久化到 SQLite；崩溃后可恢复。

### 2.2 不引入的内容

- 微服务拆分（当前规模不需要）
- 外部消息队列（SQLite + EventBus 对单用户桌面端足够）
- 重度 DDD 仪式（聚合根、领域事件总线、Saga 编排器）
- 独立 ORM 层（保持手写 SQL）

### 2.3 与基础架构的集成关系

对话系统**扩展** — 而非替换 — 基础架构（v2.0）。具体对应：

| 基础架构组件 | 对话系统如何集成 |
|---|---|
| `OrgOrchestrator` | 订阅新的 `conversation:*` 事件。事件循环结构不变。 |
| `WakeTrigger` 类型 | 扩展 `discussion_reply` 和 `conversation_escalation` 触发器。 |
| `PromptBuilder` | 扩展对话上下文部分（完整历史 + Token 预算）。 |
| `DiscussionGroup / DiscussionMessage` | 复用为对话消息存储。添加新字段。 |
| `PendingWake` | 复用于对话唤醒排队，添加新的 priority 字段。 |
| `MCP Tool Registry` | 通过现有 `McpToolRegistry` 模式注册新工具。 |
| `ExecutionEngine` | 利用 `--resume <sessionId>` 实现跨运行对话连续性。 |

### 2.4 顶层流程

```
Agent 执行任务
  |
  +-- 遇到阻塞 -> 调用 MCP `capibara_ask_question`
  |                  |
  |                  v
  |            ConversationWorkflowService
  |                  |
  |                  +-- 1. 将问题持久化为 DiscussionMessage
  |                  +-- 2. 创建/更新 ConversationWorkflow -> WAITING_FOR_REPLY
  |                  +-- 3. RoutingPolicyEngine 解析接收者
  |                  |       +-- 人工门控检查
  |                  |       +-- 上级路由解析
  |                  |       +-- 技能匹配解析
  |                  +-- 4. 为接收者创建 PendingWake
  |                  +-- 5. 发出 conversation:question-posted 事件
  |
  +-- Agent 运行结束（CLI 在 ask_question 后退出）
  |
  v
接收者被唤醒（AI 角色或人工）
  |
  +-- AI：ExecutionEngine 创建 Run（trigger=discussion_reply）
  |       PromptBuilder 注入完整对话历史
  |       Agent 回复 -> 系统检测到回复 -> 唤醒原始提问者
  |
  +-- 人工：UI 通知 -> 人工输入回复 -> 触发 discussion_reply 唤醒
```

---

## 3. 架构决策记录

### ADR-v2-01：对话作为持久化工作流

**背景**：多轮对话涉及异步等待（秒到小时）、进程重启，以及问题和回复之间可能的崩溃。

**决策**：将每个对话建模为 `ConversationWorkflow` 实例，具有显式状态机（`WAITING_FOR_REPLY -> REPLY_RECEIVED -> RESUMED -> RESOLVED | ESCALATED | TIMED_OUT`），在任何副作用之前持久化到 SQLite。

**结果**：
- 崩溃恢复：重启时扫描处于 `WAITING_FOR_REPLY` 或 `REPLY_RECEIVED` 状态的工作流并恢复处理。
- 可审计：每次状态转换都被记录。
- 可测试：状态机是纯函数，可以简单地进行单元测试。

### ADR-v2-02：统一路由策略引擎

**背景**：路由决策（谁应该回复？）涉及多个规则 — 角色层级、技能匹配、人工门控、可用性检查、循环检测。分散在多个服务中会造成不一致。

**决策**：引入 `RoutingPolicyEngine` 作为单一入口服务，在确定性管道中评估所有路由规则：

```
接收者目标解析 -> 人工门控检查 -> 可用性检查 -> 循环检测 -> 兜底升级 -> 最终接收者
```

**结果**：所有路由逻辑可从一条代码路径审计。新路由规则作为管道步骤添加，而非散落的条件判断。

### ADR-v2-03：人工门控作为系统级约束

**背景**：PRD 要求只有 `requiresHumanApproval=true` 的角色才能请求人工回复。所有其他角色必须路由到上级 AI。

**决策**：在 `RoutingPolicyEngine` 中作为硬性门控执行，而非 UI 级过滤。如果 Agent 指定 `target=human` 但其角色没有该标志，系统静默改写为 `supervisor` 并记录审计原因。

**结果**：
- 无论提示注入如何，Agent 都无法绕过门控。
- 审计轨迹记录每次门控执行。
- 人工通知保证相关性（不会被未开启标志的角色骚扰）。

### ADR-v2-04：复用 DiscussionGroup 存储对话消息

**背景**：现有 `DiscussionGroup` / `DiscussionMessage` 模型已经存储了带有作者、类型和元数据的消息。

**决策**：通过添加以下内容复用 `DiscussionMessage`：
- `intent` 字段（`question` | `reply` | `escalation` | `resolution` | `vote` | `general`）
- `recipientTarget` 存储在 `metadata` JSON 中
- `inReplyToMessageId` 用于消息线程

不创建单独的 `conversation_messages` 表。一个消息表，一个事实来源。

**结果**：现有讨论功能零数据迁移。对话消息和审查消息在同一时间线中 — 对 UI 渲染自然。

### ADR-v2-05：基于优先级的调度队列

**决策**：在 `pending_wakes` 表中添加 `priority` 列。编排器按 `priority DESC, created_at ASC` 消费队列。

| 优先级 | 含义 |
|--------|------|
| 0 | 普通任务唤醒（task_assigned 等） |
| 1 | 对话问题（discussion_reply） |
| 2 | 升级（conversation_escalation、超时） |
| 3 | 系统关键（顶层升级、人工干预） |

### ADR-v2-06：利用会话恢复实现对话连续性

**决策**：当 Agent 被 `discussion_reply` 唤醒时，系统必须传递原始 `sessionId`。这使 Agent 能够恢复其完整的上下文记忆。

**结果**：Agent 能看到自己之前的思维过程 + 新的回复。无需重新注入完整任务描述。

---

## 4. 对话模型

### 4.1 ConversationWorkflow 实体

一个 `ConversationWorkflow` 代表任务讨论中的单个问答周期。

| 字段 | 类型 | 说明 |
|------|------|------|
| id | string | UUID |
| orgId | string | 组织范围 |
| taskNodeId | string | 触发对话的任务 |
| discussionGroupId | string | 消息所在的讨论组 |
| askingRoleId | string | 提问的角色 |
| askingRunId | string | 提问时活跃的 Run |
| askingSessionId | string? | CLI sessionId，用于 --resume |
| questionMessageId | string | 包含问题的 DiscussionMessage |
| replyMessageId | string? | 包含回复的 DiscussionMessage |
| respondentRoleId | string? | 已解析的回复者 |
| respondentType | 'ai' \| 'human' | 回复者类型 |
| state | ConversationWorkflowState | 当前状态机状态 |
| depth | number | 对话链深度（用于循环检测） |
| parentWorkflowId | string? | 如果是从另一个对话级联的 |
| priority | number | 调度优先级（0-3） |
| timeoutAt | string? | 应该升级的时间 |
| resolvedAt | string? | 解决时间 |
| auditReason | string? | 路由审计轨迹 |

### 4.2 与现有实体的关系

- 一个任务可以有多个 ConversationWorkflow（多轮问答）
- 工作流通过 discussionGroupId 链接到讨论
- 通过 parentWorkflowId 形成升级链

### 4.3 消息意图扩展

现有 `DiscussionMessage` 增加 `intent` 字段以区分对话消息和审查投票：

| Intent | 说明 |
|--------|------|
| question | Agent 提出问题 |
| reply | Agent 或人工回复问题 |
| escalation | 系统因超时或循环升级 |
| resolution | 对话标记为已解决 |
| vote | 现有审查投票（APPROVE / REVISE 等） |
| general | 自由讨论消息 |

---

## 5. 对话状态机

### 5.1 状态定义

| 状态 | 说明 |
|------|------|
| waiting_for_reply | 问题已发布，等待回复 |
| reply_received | 收到回复，准备唤醒提问者 |
| resumed | 提问者已带回复上下文被唤醒 |
| resolved | 对话成功完成 |
| escalated | 因超时或循环升级到更高角色 |
| timed_out | 无回复超时（终态） |
| cancelled | 被人工手动取消（终态） |

### 5.2 状态转换图

```
                  +-----------------+
                  | waiting_for_reply|---- 超时 ---->+-----------+
                  +--------+--------+              | timed_out |
                           | 收到回复               +-----------+
                           v
                  +-----------------+
                  | reply_received   |
                  +--------+--------+
                           | 提问者被唤醒
                           v
                  +-----------------+
                  | resumed          |
                  +--------+--------+
                           |
                +----------+----------+
                v          v          v
         +----------+ +----------+ +-----------------+
         | resolved  | | escalated| | 新 workflow      |
         +----------+ +----------+ | (追问)           |
                                    +-----------------+
```

### 5.3 转换规则

| 从 | 到 | 触发条件 | 副作用 |
|----|----|---------|--------|
| — | waiting_for_reply | MCP ask_question 被调用 | 持久化问题消息，为接收者创建 PendingWake |
| waiting_for_reply | reply_received | 回复消息已发布 | 更新工作流，取消超时计时器 |
| waiting_for_reply | escalated | 超时或检测到循环 | 创建新工作流指向下一级 |
| waiting_for_reply | cancelled | 人工取消对话 | 标记已解决，不唤醒 |
| reply_received | resumed | 提问者被 discussion_reply 触发器唤醒 | 创建 Run（带 --resume sessionId） |
| resumed | resolved | 提问者完成任务或调用 mark_resolved | 归档工作流 |
| resumed | 新 waiting_for_reply | 提问者提出追问 | 创建子工作流，depth+1 |
| resumed | escalated | 提问者认为回复不足，升级 | 路由到下一级 |

### 5.4 实现方式

状态机是纯函数，无副作用。转换规则定义为数组，通过 `canTransition()` 验证合法性。

---

## 6. 路由策略引擎

### 6.1 职责

所有"谁应该回复？"决策的单一入口。评估确定性管道规则，产出 `RoutingDecision`。

### 6.2 管道步骤（按顺序评估）

| 步骤 | 说明 |
|------|------|
| 1. 人工门控检查 | 如果 target=human 且角色未开启 requiresHumanApproval → 改写为 supervisor |
| 2. 指定角色解析 | 如果 target=role 且该角色活跃 → 路由到指定角色 |
| 3. 上级路由解析 | 如果 target=supervisor → 解析 parentId → 路由到上级 |
| 4. 技能匹配解析 | 如果 target=any → 查找技能匹配的同级角色 |
| 5. 循环检测 | 如果接收者在最近对话链中出现过 → 跳过，升级 |
| 6. 顶层兜底 | 如果到达层级顶层无 AI 角色 → 强制路由到人工 |

### 6.3 路由决策示例

| 场景 | 提问角色 | 目标 | 门控结果 | 最终接收者 |
|------|---------|------|---------|-----------|
| 开发者问上级 | Developer | supervisor | — | Engineering Manager (AI) |
| 开发者问人工（无标志） | Developer | human | 阻断 | EM (AI)，审计记录 |
| 分析师问人工（有标志） | Analyst | human | 通过 | Human |
| 开发者问特定同事 | Developer | role:QA | — | QA（如可用） |
| 顶层：CTO 无上级 | CTO | supervisor | — | Human（强制） |
| 循环：A→B→A | A | supervisor(B) | 循环中断 | B 的上级 |

---

## 7. 唤醒触发器扩展

### 7.1 新触发器

在现有 `WakeTrigger` 联合类型中添加：

| 触发器 | 说明 |
|--------|------|
| discussion_reply | 角色等待的对话收到回复 |
| conversation_escalation | 对话被升级到此角色 |

### 7.2 与 OrgOrchestrator 的集成

现有 OrgOrchestrator 订阅新事件类型，在 `calculateWakeTargets()` 中添加新的 case 分支。

### 7.3 会话恢复

当 ExecutionEngine 为 `discussion_reply` 唤醒创建 Run 时，必须使用原始提问 Run 的 `sessionId`，通过 `--resume` 参数传递。

---

## 8. MCP 工具扩展

### 8.1 新工具

| 工具 | 输入 | 说明 |
|------|------|------|
| capibara_ask_question | taskId, question, recipientTarget?, urgency? | 发布问题并暂停执行 |
| capibara_mark_conversation_resolved | taskId, summary? | 标记当前对话已解决 |

### 8.2 `capibara_ask_question` 行为流程

1. 验证 taskId 匹配当前 Run 的任务
2. 查找或创建任务的 DiscussionGroup
3. 将问题持久化为 DiscussionMessage（intent='question'）
4. 创建 ConversationWorkflow（state=waiting_for_reply）
5. 调用 RoutingPolicyEngine 确定接收者
6. 为接收者创建 PendingWake
7. 根据紧急程度设置超时
8. 发出 conversation:question-posted 事件
9. 返回 `{ status: 'question_posted', respondentInfo, timeoutSeconds }`
10. 当前 CLI 运行自然退出

**安全性**：验证 runId + JWT token。taskId 必须匹配当前 Run 的任务。

### 8.3 现有工具增强：`capibara_discussion_post`

增强检测对话回复：当消息 intent 为 reply 或是对问题的回复时，检查是否有活跃的 ConversationWorkflow 等待回复。

---

## 9. 上下文注入

### 9.1 策略

Agent 被 `discussion_reply` 唤醒时，PromptBuilder 构建扩展的对话上下文部分。两个上下文来源协同工作：

1. **CLI `--resume` 会话**：Agent 自身之前的思维过程、代码更改等
2. **注入的对话历史**：带结构化格式的完整讨论时间线

### 9.2 Token 预算管理

| 配置项 | 默认值 | 说明 |
|--------|--------|------|
| maxConversationTokens | 8000 | 对话历史最大 token 数 |
| reserveForTaskContext | 2000 | 为任务上下文保留 |
| reserveForPromptTemplate | 1000 | 为 prompt 模板保留 |
| truncationStrategy | oldest_first | 截断策略 |

**算法**：
1. 如果对话消息不超过 20 条，注入全部消息
2. 如果超过 token 预算：保留第一个问题 + 最近 10 条消息
3. 始终保留：原始问题 + 最新回复（永不截断）

---

## 10. 超时与升级

### 10.1 超时配置

| 配置项 | 默认值 | 说明 |
|--------|--------|------|
| normalTimeoutMs | 300,000 (5分钟) | 普通问题超时 |
| urgentTimeoutMs | 60,000 (1分钟) | 紧急问题超时 |
| maxEscalationLevels | 3 | 最大升级层数 |
| humanNotifyOnTopLevel | true | 顶层时通知人工 |

### 10.2 超时扫描器

Main Process 中的周期性扫描器（每 15 秒）：
1. 查询所有 `timeout_at < now()` 且 state = 'waiting_for_reply' 的工作流
2. 对每个过期工作流执行升级

### 10.3 升级链

```
Developer 问 EM（超时）
  -> 新工作流：Developer 问 CTO（超时）
    -> 新工作流：Developer 问 Human（强制，顶层）
      -> 人工收到通知，附带完整升级历史
```

每次升级创建新的 ConversationWorkflow：
- parentWorkflowId = 前一个工作流
- depth = 前一个 depth + 1
- priority = 2（升级优先级）

---

## 11. 循环检测与安全

### 11.1 检测层次

| 层次 | 检测内容 | 阈值 | 处理方式 |
|------|---------|------|---------|
| 深度限制 | 对话链总长 | maxConversationDepth = 10 | 强制升级到人工 |
| 配对循环 | A→B→A→B 循环 | 连续 2 次同对话对 | 跳过 B，路由到 B 的上级 |
| 预算门控 | 组织对话花费过多 | conversationBudgetLimit | 暂停所有对话，通知人工 |
| 自唤醒 | 角色问自己 | asking = respondent | 拒绝，路由到上级 |

---

## 12. 并发对话管理

### 12.1 核心规则

1. **每角色一个活跃 Run**：如果角色当前正在执行，传入的对话唤醒排入 pending_wakes 带优先级
2. **优先级排序**：Run 完成后，按 `priority DESC, created_at ASC` 选择下一个
3. **无并行对话**：角色不能同时被唤醒两次，队列保证序列化

### 12.2 优先级映射

| 触发器 | 优先级 |
|--------|--------|
| conversation_escalation | 2 |
| discussion_reply | 1 |
| 其他（task_assigned 等） | 0 |

---

## 13. 人工交互模型

### 13.1 人工介入场景

| 场景 | 需要门控？ |
|------|-----------|
| 角色有 requiresHumanApproval=true 且指定 target=human | 是 |
| 顶层角色无上级 | 否 — 强制兜底 |
| 人工主动回复讨论 | 否 — 始终允许 |
| 人工标记对话已解决 | 否 — 始终允许 |
| 人工取消对话 | 否 — 始终允许 |

### 13.2 人工操作能力

- **回复任何对话**：人工可以在任何讨论中发帖，包括 Agent-to-Agent
- **取消对话**：人工可以标记任何活跃工作流为 cancelled
- **覆盖路由**：人工可以通过 UI 直接分配对话给特定角色
- **查看所有对话**：跨组织的所有活跃对话统一视图

---

## 14. 数据模型扩展

### 14.1 新表：conversation_workflows

| 列名 | 类型 | 说明 |
|------|------|------|
| id | TEXT PK | UUID |
| org_id | TEXT FK | 组织 |
| task_node_id | TEXT FK | 任务 |
| discussion_group_id | TEXT FK | 讨论组 |
| asking_role_id | TEXT FK | 提问角色 |
| asking_run_id | TEXT FK | 提问时的 Run |
| asking_session_id | TEXT | CLI sessionId |
| question_message_id | TEXT FK | 问题消息 |
| reply_message_id | TEXT FK | 回复消息 |
| respondent_role_id | TEXT FK | 回复者角色 |
| respondent_type | TEXT | 'ai' 或 'human' |
| state | TEXT | 工作流状态 |
| depth | INTEGER | 对话链深度 |
| parent_workflow_id | TEXT FK | 父工作流（升级链） |
| priority | INTEGER | 调度优先级 |
| timeout_at | TEXT | 超时时间 |
| audit_reason | TEXT | 路由审计原因 |

索引：org_id+state、task_node_id+state、asking_role_id+state、timeout_at（部分索引）

### 14.2 扩展表：discussion_messages

新增列：
- `intent` — 消息意图（question/reply/escalation/resolution/vote/general）
- `in_reply_to_message_id` — 回复目标消息

### 14.3 扩展表：pending_wakes

新增列：
- `priority` — 调度优先级（默认 0）

查询变更：ORDER BY 改为 `priority DESC, created_at ASC`

### 14.4 新表：conversation_events（仅追加审计日志）

| 列名 | 类型 | 说明 |
|------|------|------|
| id | TEXT PK | UUID |
| workflow_id | TEXT FK | 工作流 |
| event_type | TEXT | 事件类型 |
| event_payload | TEXT | JSON 负载 |
| created_at | TEXT | 创建时间 |

事件类型：question_posted、reply_posted、state_changed、routing_decided、timeout_triggered、escalation_created、human_gate_enforced、cancelled、resolved

---

## 15. 事件扩展

### 15.1 新领域事件

| 事件 | 说明 |
|------|------|
| conversation:question-posted | Agent 提出问题 |
| conversation:reply-posted | 等待中的对话收到回复 |
| conversation:state-changed | 工作流状态转换 |
| conversation:escalated | 对话升级到下一级 |
| conversation:timed-out | 对话超时 |
| conversation:resolved | 对话标记已解决 |
| conversation:cancelled | 人工取消对话 |

---

## 16. 代码结构

### 16.1 新增文件

```
apps/electron/src/main/
  core/
    types/conversation.types.ts                    # 类型定义
    interfaces/i-conversation-workflow.repository.ts
    interfaces/i-routing-policy-engine.ts
    interfaces/i-conversation-workflow.service.ts
    tokens.ts                                       # + 4个新 token

  application/
    conversation/
      conversation-workflow.service.ts              # 核心对话编排
      routing-policy.engine.ts                      # 统一路由决策
      timeout-escalation.service.ts                 # 超时扫描+升级
      conversation-context.builder.ts               # 对话历史格式化

  infrastructure/
    persistence/sqlite/
      sqlite-conversation-workflow.repository.ts
    mcp/tools/
      ask-question.handler.ts
      mark-resolved.handler.ts

  ipc-handlers/
    conversation.ipc-handler.ts
```

### 16.2 修改文件

- `domain.types.ts` — 扩展 WakeTrigger、DiscussionMessage、PendingWake
- `event.types.ts` — 添加 conversation:* 事件类型
- `org.orchestrator.ts` — 订阅对话事件
- `prompt-builder.ts` — 添加对话上下文部分
- `execution.engine.ts` — discussion_reply 的会话恢复
- `discussion.service.ts` — 检测对话回复
- `mcp-tool-registry.ts` — 注册新工具
- `composition-root.ts` — 注册新 DI token

---

## 17. Prompt Builder 扩展

当触发器为 `discussion_reply` 或 `conversation_escalation` 时，PromptBuilder 添加对话上下文部分：

- 完整对话历史（格式化为编号时间线）
- 唤醒原因说明
- 恢复指令（继续工作、追问或标记解决）

新增 MCP 工具列表项：
- capibara_ask_question
- capibara_mark_conversation_resolved

---

## 18. 审计与可观测性

### 18.1 事件日志

所有重要操作记录在 conversation_events 中（仅追加、不可更新、不可删除）。

### 18.2 指标（按需计算）

| 指标 | 说明 |
|------|------|
| totalConversations | 对话总数 |
| avgResponseTimeMs | 平均响应时间 |
| escalationRate | 升级率 |
| timeoutRate | 超时率 |
| humanInterventionRate | 人工干预率 |
| avgDepth | 平均对话链深度 |
| cycleDetectionCount | 循环检测触发次数 |

通过 SQL 聚合查询从 conversation_workflows 和 conversation_events 表计算，无需单独的指标表。

### 18.3 新 IPC 通道

- `capibara:conversation:list-active` — 列出组织的活跃对话
- `capibara:conversation:get-history` — 获取工作流的完整历史
- `capibara:conversation:cancel` — 取消活跃对话
- `capibara:conversation:get-metrics` — 获取对话指标

---

## 19. 非功能性需求

### 19.1 性能目标

| 指标 | 目标 |
|------|------|
| 回复→唤醒延迟 | P95 < 10s（本地） |
| 上下文装配 | P95 < 500ms |
| 工作流状态转换 | < 50ms |
| 超时扫描周期 | < 100ms/次 |
| 事件日志写入 | < 10ms |

### 19.2 可靠性

- **零消息丢失**：问题和回复消息在任何副作用之前写入 SQLite
- **崩溃恢复**：Main Process 重启时扫描孤立的 waiting_for_reply 工作流
- **无孤立状态**：Run 失败时工作流保持 waiting_for_reply，由超时扫描器处理
- **优雅降级**：路由完全失败时回退到人工通知

### 19.3 数据完整性

- SQLite WAL 模式
- conversation_events 仅追加
- 外键约束强制执行
- 状态转换由状态机验证后方可持久化

---

## 20. 实施分阶段计划

### Phase 1：对话核心（MVP）

**目标**：Agent 能提问，系统路由到上级 AI，上级回复，原始 Agent 恢复。

12 个步骤：类型定义 → 数据库表 → Repository → Service → 路由引擎 → MCP 工具 → 触发器扩展 → 会话恢复 → Prompt 扩展 → 集成测试

### Phase 2：人工交互

**目标**：requiresHumanApproval=true 的角色可请求人工输入。人工可通过 UI 回复。

6 个步骤：人工门控 → IPC 端点 → 回复检测 → UI 通知 → mark_resolved 工具 → 集成测试

### Phase 3：超时、升级与安全

**目标**：停滞的对话自动升级。循环被检测并打断。

5 个步骤：超时服务 → 循环检测 → 审计表 → 崩溃恢复 → 集成测试

### Phase 4：并发与可观测性

**目标**：多个并发对话正常工作。指标可用。

5 个步骤：优先级消费 → 指标查询 → UI 对话列表 → 人工覆盖 → 压力测试

### Phase 5：高级特性

**目标**：技能匹配路由、级联多角色讨论、对话智能。

4 个步骤：技能匹配路由 → 多跳级联 → Token 截断策略 → 对话模式分析

---

## 21. 验收清单

### 业务验收

| # | 问题 | 预期答案 |
|---|------|---------|
| B1 | 默认路由是否总是指向上级 AI？ | 是 |
| B2 | 无 requiresHumanApproval 的角色能否请求人工回复？ | 否 — 门控改写为上级，审计记录 |
| B3 | 有 requiresHumanApproval 的角色能否请求人工回复？ | 是 — 门控通过，人工收到通知 |
| B4 | 多轮上下文是否跨恢复保留？ | 是 — CLI --resume + 注入对话历史 |
| B5 | 人工能否回复任何对话？ | 是 — 人工发起的回复无门控 |
| B6 | 超时升级是否沿层级工作？ | 是 — 最多 maxEscalationLevels 层，之后强制人工 |
| B7 | Agent-to-Agent 对话是否全自动？ | 是 — 路由 + 唤醒 + 恢复全部自动化 |
| B8 | 完整对话链是否可审计？ | 是 — conversation_events 仅追加日志 |

### 工程验收

| # | 问题 | 预期答案 |
|---|------|---------|
| E1 | 崩溃后对话状态可恢复？ | 是 — SQLite 持久化，超时扫描器恢复 |
| E2 | 路由逻辑是否集中？ | 是 — RoutingPolicyEngine 单入口 |
| E3 | 是否避免了分布式基础设施？ | 是 — SQLite + EventBus |
| E4 | 状态机是否纯函数可测试？ | 是 — canTransition() 纯函数 |
| E5 | 循环检测是否可证明完备？ | 是 — 深度 + 配对 + 自唤醒，3 层防护 |
| E6 | 设计是否扩展（而非分叉）现有架构？ | 是 — 新事件、新触发器、相同模式 |
| E7 | 优先级调度是否确定性？ | 是 — priority DESC, created_at ASC |
| E8 | 所有对话操作是否 Zod 验证？ | 是 — MCP 输入和 IPC 输入 |

---

## 设计理由总结

| 决策 | 原因 |
|------|------|
| 复用 DiscussionMessage | 一个事实来源；现有功能零迁移 |
| 对话作为显式工作流实体 | 崩溃可恢复、可审计、清晰生命周期 |
| 路由作为管道引擎 | 单一审计路径，新规则不触碰编排器 |
| 会话恢复（--resume） | Agent 保留自己的思维过程；最小化重注入 |
| 通过 SQL 列实现优先级队列 | 无新基础设施；简单 ORDER BY 更改 |
| 通过周期性扫描实现超时 | 简单、可调试、无内存计时器泄漏风险 |
| 人工门控作为硬约束 | 提示注入无法绕过 |
| 保留现有模式 | EventBus、DI tokens、Repository 接口 — 团队生产力保持 |