# Capibara 对话模式与讨论模式技术解释文档

> **版本**: 1.0
> **日期**: 2026-04-05
> **受众**: 新开发人员
> **目的**: 帮助快速理解两种AI自动交互模式的工作原理

---

## 目录

1. [概述](#1-概述)
2. [对话模式 (Conversation Mode)](#2-对话模式-conversation-mode)
3. [讨论模式 (Discussion Mode)](#3-讨论模式-discussion-mode)
4. [两种模式对比](#4-两种模式对比)
5. [触发条件详解](#5-触发条件详解)
6. [技术实现架构](#6-技术实现架构)
7. [数据模型](#7-数据模型)
8. [事件流与状态机](#8-事件流与状态机)
9. [最佳实践与调试](#9-最佳实践与调试)

---

## 1. 概述

Capibara 项目为 AI Agent 自动交互设计了两种核心模式：

| 模式 | 核心特征 | 主要用途 |
|------|---------|---------|
| **对话模式** | 一对一问答工作流 | Agent遇到阻塞时向其他Agent或人工提问 |
| **讨论模式** | 多方协作讨论 | 任务审查、投票决策、共识达成 |

### 1.1 设计原则

```
┌─────────────────────────────────────────────────────────────┐
│                      核心设计原则                            │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  P1: 对话 = 持久化工作流                                     │
│      每次对话都是一个可恢复、可审计的工作流实例               │
│                                                             │
│  P2: 默认 AI 上级路由                                        │
│      所有路由默认指向上级 AI，人工是例外而非常态              │
│                                                             │
│  P3: 本地优先可靠性                                          │
│      所有状态存储在 SQLite 中，支持崩溃恢复                   │
│                                                             │
│  P4: 事件驱动集成                                            │
│      通过 EventBus 与现有系统无缝集成                         │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

---

## 2. 对话模式 (Conversation Mode)

### 2.1 定义

对话模式是一种**一对一问答工作流**，当 Agent 在执行任务过程中遇到阻塞或需要额外信息时，通过该模式向其他 Agent 或人工发起提问，并等待回复。

### 2.2 触发条件

对话模式在以下情况下触发：

| 触发场景 | 触发方式 | 说明 |
|---------|---------|------|
| Agent 需要澄清需求 | 调用 `capibara_ask_question` MCP 工具 | Agent 主动发起 |
| Agent 遇到技术决策点 | 调用 `capibara_ask_question` | 需要上级确认 |
| Agent 需要人工审批 | 设置 `recipientTarget.type = 'human'` | 仅限开启 `requiresHumanApproval` 的角色 |
| 超时升级 | TimeoutEscalationService | 自动升级到上一级 |

### 2.3 工作流程

```
┌─────────────────────────────────────────────────────────────┐
│                  对话模式完整工作流程                        │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  1. Agent 执行任务时遇到阻塞                                 │
│     │                                                       │
│     ▼                                                       │
│  2. 调用 MCP 工具: capibara_ask_question                    │
│     │   参数: taskId, question, recipientTarget, urgency    │
│     │                                                       │
│     ▼                                                       │
│  3. ConversationWorkflowService.createWorkflow()            │
│     │   ├── 创建/复用 DiscussionGroup                       │
│     │   ├── 发布问题消息 (intent='question')                │
│     │   ├── 路由策略引擎解析接收者                           │
│     │   ├── 创建 ConversationWorkflow 实体                  │
│     │   ├── 设置超时时间                                     │
│     │   └── 创建 PendingWake 唤醒接收者                     │
│     │                                                       │
│     ▼                                                       │
│  4. 工作流进入 'waiting_for_reply' 状态                     │
│     │   当前 Agent 的 CLI 进程正常退出                       │
│     │                                                       │
│     ▼                                                       │
│  5. 接收者被唤醒 (trigger='discussion_reply')               │
│     │   ├── AI: ExecutionEngine 创建新 Run                  │
│     │   └── Human: UI 显示通知                              │
│     │                                                       │
│     ▼                                                       │
│  6. 接收者发布回复消息                                       │
│     │   DiscussionService.onMessageAdded() 检测回复         │
│     │                                                       │
│     ▼                                                       │
│  7. 工作流转换到 'reply_received' 状态                       │
│     │   创建 PendingWake 唤醒提问者                          │
│     │                                                       │
│     ▼                                                       │
│  8. 提问者被唤醒 (带 --resume 恢复上下文)                    │
│     │   工作流转换到 'resumed' 状态                          │
│     │                                                       │
│     ▼                                                       │
│  9. 提问者处理回复并继续任务                                 │
│     │   可选: 调用 capibara_mark_conversation_resolved      │
│     │                                                       │
│     ▼                                                       │
│  10. 工作流进入 'resolved' 状态，对话结束                    │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### 2.4 路由策略

当 Agent 发起对话时，系统通过 **RoutingPolicyEngine** 决定谁应该接收问题：

```
路由管道步骤 (按顺序评估):

1. 人工门控检查
   └── 如果 target=human 且角色未开启 requiresHumanApproval
       → 静默改写为 supervisor，记录审计日志

2. 指定角色解析
   └── 如果 target=role 且该角色活跃
       → 路由到指定角色

3. 上级路由解析
   └── 如果 target=supervisor
       → 解析 parentId，路由到上级

4. 技能匹配解析
   └── 如果 target=any
       → 查找技能匹配的同级角色

5. 循环检测
   └── 如果接收者在最近对话链中出现过
       → 跳过，升级到上级

6. 顶层兜底
   └── 如果到达层级顶层无 AI 角色
       → 强制路由到人工
```

### 2.5 路由决策示例

| 场景 | 提问角色 | 目标 | 门控结果 | 最终接收者 |
|------|---------|------|---------|-----------|
| 开发者问上级 | Developer | supervisor | — | Engineering Manager (AI) |
| 开发者问人工（无标志） | Developer | human | 阻断 | EM (AI)，审计记录 |
| 分析师问人工（有标志） | Analyst | human | 通过 | Human |
| 开发者问特定同事 | Developer | role:QA | — | QA（如可用） |
| 顶层：CTO 无上级 | CTO | supervisor | — | Human（强制） |
| 循环：A→B→A | A | supervisor(B) | 循环中断 | B 的上级 |

### 2.6 超时与升级机制

```yaml
超时配置:
  normalTimeoutMs: 300000    # 普通问题: 5分钟
  urgentTimeoutMs: 60000     # 紧急问题: 1分钟
  maxEscalationLevels: 3     # 最大升级层数

升级链示例:
  Developer 问 EM（超时）
    → 新工作流：Developer 问 CTO（超时）
      → 新工作流：Developer 问 Human（强制，顶层）
```

---

## 3. 讨论模式 (Discussion Mode)

### 3.1 定义

讨论模式是一种**多方协作讨论机制**，用于任务审查、投票决策和共识达成。多个 Agent（和人工）可以在讨论组中发布消息、投票和反馈。

### 3.2 触发条件

讨论模式在以下情况下触发：

| 触发场景 | 触发方式 | 自动创建讨论组 |
|---------|---------|--------------|
| 创建 Epic 任务 | `task:created` 事件 | ✅ 自动创建 |
| 创建 Story 任务 | `task:created` 事件 | ✅ 自动创建 |
| 角色需要人工审批 | 角色配置 `requiresHumanApproval=true` | ✅ 自动创建 |
| Agent 完成任务 | `capibara_task_complete` MCP 工具 | 使用现有讨论组 |
| Agent 发布投票 | `capibara_discussion_post` MCP 工具 | 使用现有讨论组 |

### 3.3 工作流程

```
┌─────────────────────────────────────────────────────────────┐
│                  讨论模式完整工作流程                        │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  1. 任务创建 (Epic/Story 或需要人工审批的任务)               │
│     │                                                       │
│     ▼                                                       │
│  2. DiscussionService.onTaskCreated()                       │
│     │   自动创建 DiscussionGroup                            │
│     │                                                       │
│     ▼                                                       │
│  3. Agent 执行任务并完成                                     │
│     │   调用 capibara_task_complete                         │
│     │   任务状态 → awaiting_review                          │
│     │                                                       │
│     ▼                                                       │
│  4. Agent 发布审查投票                                       │
│     │   调用 capibara_discussion_post                       │
│     │   voteTag: APPROVE / REVISE / CONCERN / DELEGATE      │
│     │                                                       │
│     ▼                                                       │
│  5. DiscussionService.onVoteAdded()                         │
│     │   ConsensusDetector.evaluate()                        │
│     │                                                       │
│     ▼                                                       │
│  6. 共识检测结果处理                                         │
│     │                                                       │
│     ├── approved  → 任务通过，状态 → approved               │
│     │                                                       │
│     ├── revision  → 任务修订，状态 → revision               │
│     │              唤醒原 Agent 重新执行                    │
│     │                                                       │
│     ├── delegated → 任务委托，状态 → blocked                │
│     │              唤醒目标角色处理                         │
│     │                                                       │
│     └── disputed  → 争议检测，升级到父角色                   │
│                    发出 dispute:detected 事件               │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### 3.4 投票类型与共识规则

```yaml
投票类型 (VoteTag):
  APPROVE:  同意任务完成
  REVISE:   要求修改，附带反馈意见
  CONCERN:  表示担忧，不阻止但不支持
  DELEGATE: 委托给其他角色处理

共识检测规则:
  approved:
    条件: APPROVE 投票占多数且无 REVISE
    结果: 任务状态转为 approved

  revision:
    条件: 存在 REVISE 投票
    结果: 任务状态转为 revision，唤醒原 Agent

  delegated:
    条件: 存在 DELEGATE 投票且指定目标角色
    结果: 任务状态转为 blocked，唤醒目标角色

  disputed:
    条件: 投票意见分歧严重（如 APPROVE 与 REVISE 同时存在多个）
    结果: 升级到父角色处理
```

### 3.5 人工介入机制

```yaml
人工介入场景:

  1. 人工投票:
     - 人类用户通过 UI 直接投票
     - authorRoleId = null 标识人工投票
     - 人工投票优先级高于 AI 共识

  2. 人工审批 (requiresHumanApproval):
     - 角色配置 requiresHumanApproval=true
     - 任务完成后不自动通过
     - 等待人工 APPROVE 投票

  3. 人工直接回复对话:
     - 人工可在任何讨论组发帖
     - 自动触发对话回复检测
     - 无门控限制
```

---

## 4. 两种模式对比

### 4.1 功能对比表

| 特性 | 对话模式 | 讨论模式 |
|-----|---------|---------|
| **参与者** | 一对一（提问者 ↔ 回复者） | 多方（所有相关角色 + 人工） |
| **核心目的** | 解决阻塞、获取信息 | 任务审查、决策共识 |
| **触发方式** | Agent 主动调用 MCP 工具 | 任务创建/完成自动触发 |
| **数据实体** | ConversationWorkflow | DiscussionGroup + DiscussionMessage |
| **消息意图** | question, reply, escalation, resolution | vote, general, reply |
| **超时机制** | 有（支持升级） | 无（等待共识） |
| **人工介入** | 通过门控控制 | 随时可介入 |
| **状态机** | 7 种状态，显式转换 | 无显式状态机 |

### 4.2 使用场景决策树

```
┌─────────────────────────────────────────────────────────────┐
│                    模式选择决策树                            │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  你的 Agent 需要什么？                                       │
│     │                                                       │
│     ├── 需要向其他 Agent/人工提问                           │
│     │      └── 选择 对话模式                                │
│     │          调用 capibara_ask_question                   │
│     │                                                       │
│     ├── 需要获取任务审查/投票结果                           │
│     │      └── 选择 讨论模式                                │
│     │          调用 capibara_discussion_post                │
│     │                                                       │
│     ├── 任务已完成，等待审批                                 │
│     │      └── 使用 讨论模式（自动）                        │
│     │          调用 capibara_task_complete                  │
│     │                                                       │
│     └── 需要将对话标记为已解决                               │
│            └── 使用 对话模式                                │
│                调用 capibara_mark_conversation_resolved     │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

---

## 5. 触发条件详解

### 5.1 WakeTrigger 类型定义

```typescript
// 文件: apps/electron/src/main/core/types/domain.types.ts

export type WakeTrigger =
  | 'task_assigned'          // 任务分配
  | 'task_completed'         // 任务完成
  | 'review_requested'       // 审查请求
  | 'review_approve'         // 审查通过
  | 'review_revise'          // 审查修订
  | 'review_delegate'        // 审查委托
  | 'delegation_completed'   // 委托完成
  | 'retry_failed'           // 重试失败
  | 'dispute_detected'       // 争议检测
  | 'discussion_reply'       // 对话回复 ⭐ 对话模式
  | 'conversation_escalation';// 对话升级 ⭐ 对话模式
```

### 5.2 对话模式触发条件

```yaml
触发器: discussion_reply
  触发场景:
    - Agent 发起对话后，接收者回复
    - ConversationWorkflow 从 waiting_for_reply 转换到 reply_received
    - 系统为提问者创建 PendingWake

触发器: conversation_escalation
  触发场景:
    - 对话超时未收到回复
    - TimeoutEscalationService 检测到超时
    - 创建升级后的新 ConversationWorkflow
    - 系统为新接收者创建 PendingWake
```

### 5.3 讨论模式触发条件

```yaml
事件: task:created
  触发条件:
    - 任务类型为 'epic' 或 'story'
    - 或任务分配给需要人工审批的角色
  结果:
    - 自动创建 DiscussionGroup

事件: discussion:vote-added
  触发条件:
    - Agent 发布带 voteTag 的消息
  结果:
    - 执行共识检测
    - 根据结果处理任务状态

事件: discussion:message-added
  触发条件:
    - 任何消息发布到讨论组
  结果:
    - 检测是否为对话回复
    - 更新 UI 实时显示
```

---

## 6. 技术实现架构

### 6.1 核心服务架构

```
apps/electron/src/main/
├── application/
│   ├── conversation/
│   │   ├── conversation-workflow.service.ts  # 对话工作流编排
│   │   ├── routing-policy.engine.ts          # 路由策略引擎
│   │   ├── timeout-escalation.service.ts     # 超时升级服务
│   │   └── conversation-context.builder.ts   # 对话上下文构建
│   │
│   └── discussion/
│       └── discussion.service.ts             # 讨论服务
│
├── core/
│   ├── types/
│   │   ├── conversation.types.ts             # 对话类型定义
│   │   └── domain.types.ts                   # 领域类型定义
│   │
│   └── interfaces/
│       ├── i-conversation-workflow.repository.ts
│       ├── i-conversation-workflow.service.ts
│       └── i-routing-policy-engine.ts
│
└── infrastructure/
    ├── persistence/sqlite/
    │   ├── sqlite-conversation-workflow.repository.ts
    │   └── sqlite-discussion.repository.ts
    │
    └── mcp/
        └── mcp-tool-handlers.ts              # MCP 工具处理器
```

### 6.2 MCP 工具列表

| 工具名称 | 模式 | 说明 |
|---------|------|------|
| `capibara_ask_question` | 对话 | 发起对话，提问 |
| `capibara_mark_conversation_resolved` | 对话 | 标记对话已解决 |
| `capibara_discussion_post` | 讨论 | 发布讨论消息/投票 |
| `capibara_task_complete` | 讨论 | 完成任务，触发审查 |
| `capibara_task_review` | 讨论 | AI 审查任务 |

---

## 7. 数据模型

### 7.1 ConversationWorkflow 实体

```typescript
// 文件: apps/electron/src/main/core/types/conversation.types.ts

interface ConversationWorkflow {
  id: string;                    // UUID
  orgId: string;                 // 组织ID
  taskNodeId: string;            // 关联任务
  discussionGroupId: string;     // 讨论组ID

  // 提问者信息
  askingRoleId: string;          // 提问角色
  askingRunId: string;           // 提问时的 Run ID
  askingSessionId: string | null;// CLI sessionId（用于 --resume）

  // 消息ID
  questionMessageId: string;     // 问题消息ID
  replyMessageId: string | null; // 回复消息ID

  // 回复者信息
  respondentRoleId: string | null;  // 回复者角色
  respondentType: 'ai' | 'human';   // 回复者类型

  // 状态
  state: ConversationWorkflowState; // 当前状态
  depth: number;                    // 对话深度（升级链）
  parentWorkflowId: string | null;  // 父工作流（升级链）

  // 调度
  priority: number;              // 优先级 (0-3)
  timeoutAt: string | null;      // 超时时间
  resolvedAt: string | null;     // 解决时间
  auditReason: string | null;    // 路由审计原因
}
```

### 7.2 ConversationWorkflowState 状态

```typescript
type ConversationWorkflowState =
  | 'waiting_for_reply'  // 等待回复
  | 'reply_received'     // 收到回复
  | 'resumed'            // 提问者已恢复
  | 'resolved'           // 已解决
  | 'escalated'          // 已升级
  | 'timed_out'          // 超时
  | 'cancelled';         // 已取消
```

### 7.3 DiscussionGroup 实体

```typescript
interface DiscussionGroup {
  id: string;
  orgId: string;
  taskNodeId: string;        // 关联任务（Epic/Story）
  summary: string | null;    // 讨论摘要
  currentRound: number;      // 当前审查轮次
  reviseCount: number;       // 修订次数
  createdAt: string;
  updatedAt: string;
}
```

### 7.4 DiscussionMessage 实体

```typescript
interface DiscussionMessage {
  id: string;
  groupId: string;
  authorRoleId: string | null;  // null 表示人工
  authorType: 'ai' | 'human' | 'system';
  content: string;
  voteTag: VoteTag | null;      // 投票标签
  intent: MessageIntent;        // 消息意图
  inReplyToMessageId: string | null;
  reviewRound: number;
  metadata: Record<string, unknown> | null;
  createdAt: string;
}

type MessageIntent =
  | 'question'    // 对话模式：问题
  | 'reply'       // 对话模式：回复
  | 'escalation'  // 对话模式：升级
  | 'resolution'  // 对话模式：解决
  | 'vote'        // 讨论模式：投票
  | 'general';    // 通用消息
```

---

## 8. 事件流与状态机

### 8.1 对话模式事件流

```
┌─────────────────────────────────────────────────────────────┐
│                    对话模式事件序列                          │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  capibara_ask_question 调用                                 │
│     │                                                       │
│     ├── conversation:question-posted                       │
│     │                                                       │
│     ▼                                                       │
│  [waiting_for_reply] ──超时──> conversation:escalated      │
│     │                                                       │
│     │ 收到回复                                              │
│     ├── conversation:reply-posted                          │
│     │                                                       │
│     ▼                                                       │
│  [reply_received]                                           │
│     │                                                       │
│     ▼                                                       │
│  [resumed] ──调用 mark_resolved──> conversation:resolved   │
│     │                                                       │
│     └── 追问 ──> 新建 ConversationWorkflow                 │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### 8.2 对话状态机转换规则

```typescript
// 文件: apps/electron/src/main/core/types/conversation.types.ts

const CONVERSATION_TRANSITIONS = [
  { from: 'waiting_for_reply', to: 'reply_received' },
  { from: 'waiting_for_reply', to: 'escalated' },
  { from: 'waiting_for_reply', to: 'timed_out' },
  { from: 'waiting_for_reply', to: 'cancelled' },
  { from: 'reply_received', to: 'resumed' },
  { from: 'resumed', to: 'resolved' },
  { from: 'resumed', to: 'escalated' },
];

function canTransition(current: State, target: State): boolean {
  return CONVERSATION_TRANSITIONS.some(
    t => t.from === current && t.to === target
  );
}
```

### 8.3 讨论模式事件流

```
┌─────────────────────────────────────────────────────────────┐
│                    讨论模式事件序列                          │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  任务创建 (Epic/Story)                                      │
│     │                                                       │
│     ├── task:created                                       │
│     ├── discussion:group-created                           │
│     │                                                       │
│     ▼                                                       │
│  Agent 完成任务                                             │
│     │                                                       │
│     ├── capibara_task_complete                             │
│     ├── task:status-changed (awaiting_review)              │
│     │                                                       │
│     ▼                                                       │
│  Agent 发布投票                                             │
│     │                                                       │
│     ├── discussion:message-added                           │
│     ├── discussion:vote-added                              │
│     │                                                       │
│     ▼                                                       │
│  共识检测                                                   │
│     │                                                       │
│     ├── approved  → task:status-changed (approved)         │
│     ├── revision  → task:status-changed (revision)         │
│     │              + wake:triggered (review_revise)        │
│     ├── delegated → task:status-changed (blocked)          │
│     │              + wake:triggered (review_delegate)      │
│     └── disputed  → dispute:detected                       │
│                    + wake:triggered (dispute_detected)     │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

---

## 9. 最佳实践与调试

### 9.1 开发调试命令

```bash
# 查看数据库中的对话工作流
sqlite3 capibara.db "SELECT * FROM conversation_workflows ORDER BY created_at DESC LIMIT 10;"

# 查看讨论组
sqlite3 capibara.db "SELECT * FROM discussion_groups ORDER BY created_at DESC LIMIT 10;"

# 查看讨论消息
sqlite3 capibara.db "SELECT * FROM discussion_messages WHERE group_id = 'xxx' ORDER BY created_at;"

# 查看对话审计日志
sqlite3 capibara.db "SELECT * FROM conversation_events WHERE workflow_id = 'xxx' ORDER BY created_at;"

# 查看待唤醒队列
sqlite3 capibara.db "SELECT * FROM pending_wakes ORDER BY priority DESC, created_at ASC;"
```

### 9.2 常见问题排查

| 问题 | 可能原因 | 排查步骤 |
|-----|---------|---------|
| 对话没有触发唤醒 | PendingWake 未创建 | 检查 conversation_workflows 表中的 respondentRoleId |
| 回复后 Agent 未恢复 | discussion_reply 触发器问题 | 检查 pending_wakes 表中的 trigger 字段 |
| 人工门控不生效 | 角色配置问题 | 检查 roles 表中的 requiresHumanApproval 字段 |
| 循环检测误判 | depth 过大或历史工作流问题 | 检查 parentWorkflowId 链和 depth 值 |
| 超时升级未触发 | TimeoutEscalationService 未启动 | 检查服务是否正确注册和启动 |

### 9.3 关键文件快速索引

| 功能 | 文件路径 |
|-----|---------|
| 对话工作流服务 | `apps/electron/src/main/application/conversation/conversation-workflow.service.ts` |
| 讨论服务 | `apps/electron/src/main/application/discussion/discussion.service.ts` |
| 路由策略引擎 | `apps/electron/src/main/application/conversation/routing-policy.engine.ts` |
| 超时升级服务 | `apps/electron/src/main/application/conversation/timeout-escalation.service.ts` |
| MCP 工具处理 | `apps/electron/src/main/infrastructure/mcp/mcp-tool-handlers.ts` |
| 类型定义 | `apps/electron/src/main/core/types/conversation.types.ts` |
| 领域类型 | `apps/electron/src/main/core/types/domain.types.ts` |

---

## 附录：术语表

| 术语 | 英文 | 说明 |
|-----|------|------|
| 对话模式 | Conversation Mode | 一对一问答工作流模式 |
| 讨论模式 | Discussion Mode | 多方协作讨论模式 |
| 工作流 | Workflow | ConversationWorkflow 实例 |
| 讨论组 | Discussion Group | DiscussionGroup 实例 |
| 唤醒触发器 | Wake Trigger | 触发 Agent 唤醒的事件类型 |
| 路由策略 | Routing Policy | 决定对话接收者的规则 |
| 人工门控 | Human Gate | 控制人工介入的权限机制 |
| 共识检测 | Consensus Detection | 分析投票结果达成共识 |
| 升级链 | Escalation Chain | 超时后向上级传递的链路 |

---

**文档结束**

如有疑问，请参考：
- 详细架构文档：`docs/architecture-conversation-system-zh.md`
- BMad 模式说明：`_bmad-output/bmad-modes-explanation.md`
