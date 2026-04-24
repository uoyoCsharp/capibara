# Capibara Refactoring Architecture Plan

> **Version**: 2.1
> **Date**: 2026-04-24
> **Status**: Approved Direction — supersedes v2.0
> **Project Stage**: Greenfield — no backward compatibility required; destructive changes allowed
> **Changes from v2.0**:
> 1. InquiryRouter relocated Layer 1 → Layer 2 (no more cross-base dependency)
> 2. PendingPlanStore replaced by EventBus pub/sub (no shared mutable store)
> 3. Typed event payloads via `DomainEventMap` (no more `as Record<string, unknown>` casts)
> 4. Conversation.metadata typed as discriminated union by ConversationType
> 5. Run.target modeled as discriminated union with DB CHECK
> 6. Orchestrator split into TaskOrchestrator / ConversationOrchestrator / RunOrchestrator
> 7. Paused-task state persisted to DB (no more in-memory Set)
> 8. §11 Concurrency & Consistency added (transactional outbox, reentrancy rules)
> 9. Migration safety strategy added (since we're greenfield: consolidate into single v1 migration)
> 10. Phase plan rewritten to reflect actual code state

---

## 1. Refactoring Principles

### 1.1 Core Insight

Capibara 的核心可以归纳为三个业务底座：

1. **Workflow** — 自定义工作任务类型和工作流流转（类似 Jira 的 issue 类型和工作流）
2. **Organization** — 自定义组织架构（仿照人类的 AI 角色组织架构）
3. **Conversation** — 对话系统（AI 角色间对话 + 人机对话，协同完成工作任务）

所有上层功能都是这三个底座的协调与组合。

### 1.2 Design Rules

| Rule | Description |
|------|-------------|
| **底座完全独立** | Workflow、Organization、Conversation 彼此**不得**直接依赖。任何跨底座的协调由 Layer 2（协调层）通过事件完成 |
| **事件驱动协调** | 底座只发出事件，协调层消费事件后做决策和分发 |
| **底座不调用 AI** | 底座只产生"需要 AI 做什么"的意图，由 Runtime 层执行 |
| **依赖向下** | 上层可依赖下层，下层不依赖上层 |
| **类型优于约定** | 所有事件 payload、实体 metadata 必须通过 TypeScript 判别联合 + Zod schema 强制类型安全；禁止 `Record<string, unknown>` 作为跨模块边界类型 |

### 1.3 Inter-Module Dependency Rules

```
允许的依赖方向：
  Layer 3  → Layer 2, Layer 1.5, Layer 1, Layer 0, Infrastructure
  Layer 2  → Layer 1.5, Layer 1, Layer 0, Infrastructure
  Layer 1.5 → Layer 1, Layer 0, Infrastructure
  Layer 1  → Layer 0, Infrastructure
  Layer 0  → Infrastructure

底座间（v2.1 变更 — 完全解耦）：
  Workflow      ⊥ Organization
  Workflow      ⊥ Conversation
  Conversation  ⊥ Organization   ← v2.0 曾允许单向只读；v2.1 禁止
```

**v2.0 曾允许 Conversation → Organization 的单向只读依赖（InquiryRouter 读 Role 数据）。v2.1 通过将 InquiryRouter 上移到 Layer 2 消除此依赖。**

---

## 2. Architecture Overview

```
┌──────────────────────────────────────────────────────────────┐
│ Layer 3 — Features（上层功能）                                │
│                                                              │
│   Planning                        Notification               │
│   (订阅 plan:submitted            (事件广播 +                 │
│    + 内部维护 pending list         桌面通知)                  │
│    + Workflow.batchCreate)                                    │
└────────────────────────┬─────────────────────────────────────┘
                         │ depends on
┌────────────────────────┴─────────────────────────────────────┐
│ Layer 2 — Coordination（协调层）                              │
│                                                              │
│   TaskOrchestrator    ConversationOrchestrator    RunOrchestrator │
│   (task:* 事件)        (conversation:* 事件)      (run:* 事件) │
│                                                              │
│   InquiryRouter       RunCoordinator                         │
│   (读 Organization     (Run 生命周期：                         │
│    做路由决策)          上下文 → prompt → 执行 → 后处理)       │
│                                                              │
│   共享: WakeGateValidator, RetryScheduler, BudgetGuard       │
└──────────────────────────┬───────────────────────────────────┘
                           │ depends on
┌──────────────────────────┴───────────────────────────────────┐
│ Layer 1.5 — Integration（集成层）                             │
│                                                              │
│   Prompt               MCP Bridge                            │
│   (底座 → AI:          (AI → 底座:                            │
│    聚合上下文           分发 Claude 回调)                      │
│    组装提示词)          写入 EventBus（plan:submitted 等）      │
└──┬──────────────────────┬─────────────────────┬──────────────┘
   │ reads                │ reads               │ reads
   ▼                      ▼                     ▼
┌─────────────────┐ ┌─────────────────┐ ┌──────────────────────┐
│ Layer 1          │ │ Layer 1          │ │ Layer 1               │
│ Workflow         │ │ Organization     │ │ Conversation          │
│                  │ │                  │ │                       │
│ ProcessSchema    │ │ Role hierarchy   │ │ Conversation entity   │
│ Task entity      │ │ Permissions      │ │ Message entity        │
│ Status machine   │ │ Persona          │ │ State machine         │
│ BehaviorRules    │ │ Skills           │ │ Context builder       │
│ Approval status  │ │                  │ │ (NO routing logic)    │
│                  │ │                  │ │                       │
└────────┬────────┘ └────────┬────────┘ └──────────┬───────────┘
         │                   │                      │
         └───────────────────┴──────────────────────┘
                             │ depends on
┌────────────────────────────┴─────────────────────────────────┐
│ Layer 0 — Runtime（运行时）                                   │
│                                                              │
│   Execution                                                  │
│   (纯 AI 调用：prompt + config → Claude → result)             │
│   无业务逻辑，无底座依赖                                       │
└──────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────┐
│ Infrastructure（基础设施）                                     │
│                                                              │
│   Persistence    EventBus    Cost/Budget    Settings          │
│   Logging        Outbox      Migration-Backup                 │
│                                                              │
│   ⚠ 不再有 PendingPlanStore — 改用 EventBus                   │
└──────────────────────────────────────────────────────────────┘
```

---

## 3. Module Specifications

### 3.1 Layer 0 — Execution

**职责：** 纯 AI 调用运行时。给定 prompt + 配置 → 调用 Claude → 返回结果。

**Run Entity（v2.1 判别联合）：**

```typescript
// Base fields common to all Runs
interface RunBase {
  id: string;
  orgId: string;
  roleId: string;
  status: RunStatus;
  wakeReason: WakeReason;
  startedAt: string | null;
  finishedAt: string | null;
  tokenCount: number;
  summary: string | null;
  errorMessage: string | null;
  createdAt: string;
}

// Discriminated union — a Run always belongs to exactly one valid scenario
type RunTarget =
  | { taskId: string;   conversationId: null }    // Task execution
  | { taskId: string;   conversationId: string }  // Inquiry response (AI replies within a task)
  | { taskId: null;     conversationId: string }; // Planning / Adhoc

export type Run = RunBase & RunTarget;
```

**DB Schema（v2.1）：**

```sql
CREATE TABLE runs (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL,
  task_id TEXT REFERENCES tasks(id) ON DELETE CASCADE,
  conversation_id TEXT REFERENCES conversations(id) ON DELETE SET NULL,
  role_id TEXT NOT NULL,
  status TEXT NOT NULL,
  wake_reason TEXT NOT NULL,
  ...
  -- v2.1: enforce at least one target
  CHECK (task_id IS NOT NULL OR conversation_id IS NOT NULL)
);
```

**Components（不变）：** RunEngine, WorkerService, FileLogService, CostTracker

**No Business Logic.** 不知道 Task、Role、Conversation 是什么。只接收 prompt string 和 config，返回 AI 输出。

---

### 3.2 Layer 1 — Workflow

**职责：** 定义和管理任务类型、状态、流转规则和自动化行为。

核心概念、Approval 状态类别、发出事件与 v2.0 一致。

**v2.1 变更：**

- **暂停状态持久化**：任务进入 `approval` 状态时，由 Workflow 模块在 `tasks.paused_reason` 列记录（不再由 Orchestrator 维护内存 Set）。应用重启后调度行为一致。
  ```sql
  ALTER TABLE tasks ADD COLUMN paused_reason TEXT; -- NULL or 'approval' | 'budget' | ...
  ```

- **No Dependencies On:** Organization, Conversation（严格，v2.0 无变化）

---

### 3.3 Layer 1 — Organization

核心概念、组件、事件与 v2.0 一致。

**v2.1 强化：** Organization 仍然是纯底座，但 **InquiryRouter 已不在此模块内**。Organization 模块不存在任何"路由"相关代码。

---

### 3.4 Layer 1 — Conversation

**职责：** 统一管理所有类型的结构化对话 — AI↔AI 质询、Human↔AI 规划、Human↔AI 自由对话。

**v2.1 关键变更：**

- ❌ **InquiryRouter 从此模块移出到 Layer 2**
- ❌ **InquiryEscalationService 从此模块移出到 Layer 2**
- ❌ **ConversationService 不再持有 `IRoleRepository` 引用**
- ✅ Conversation 发 `conversation:needs-routing` 事件，由 Layer 2 的 InquiryRouter 消费

**Conversation Entity（v2.1 判别联合 metadata）：**

```typescript
interface ConversationBase {
  id: string;
  orgId: string;
  state: ConversationState;
  initiatorRoleId: string;
  respondentRoleId: string | null;
  respondentType: 'ai' | 'human';
  taskId: string | null;
  parentConversationId: string | null;
  depth: number;
  priority: number;
  timeoutAt: string | null;
  externalSessionId: string | null;
  createdAt: string;
  updatedAt: string;
}

// Type-specific metadata
interface InquiryMetadata {
  questionIntent: 'clarification' | 'approval' | 'delegation';
  routingAttempts: number;
  escalationPath: string[];          // role IDs traversed
}

interface PlanningMetadata {
  pendingPlanId: string | null;
  confirmedAt: string | null;
}

interface AdhocMetadata {
  topic: string | null;
}

// Discriminated union
export type Conversation =
  | (ConversationBase & { type: 'inquiry';  metadata: InquiryMetadata  })
  | (ConversationBase & { type: 'planning'; metadata: PlanningMetadata })
  | (ConversationBase & { type: 'adhoc';    metadata: AdhocMetadata    });
```

**DB 存储：** metadata 仍然用 `TEXT` 存 JSON，Repository 反序列化时用 Zod `parse` 按 type 分支验证 — 禁止 `as` 类型断言。

**Components（v2.1 精简）：**

| Component | Responsibility |
|-----------|---------------|
| `ConversationService` | Conversation CRUD + 状态转换 + 消息管理（无路由、无升级、无 Organization 依赖） |
| `ConversationContextBuilder` | 构建对话上下文（给 Prompt 模块用） |

**Emitted Events:**
- `conversation:created`
- `conversation:message-added`
- `conversation:needs-routing` — **新增**（仅 inquiry 类型发出）
- `conversation:respondent-assigned`（由 Layer 2 的 InquiryRouter 写回 conversation 后发出）
- `conversation:response-needed` — 统一触发 Run 的事件
- `conversation:resolved` / `conversation:escalated` / `conversation:timed-out` / `conversation:cancelled`

**No Dependencies On:** Workflow, **Organization**（v2.1 严格）

---

### 3.5 Layer 1.5 — Prompt

职责、组件、数据源与 v2.0 一致。

---

### 3.6 Layer 1.5 — MCP Bridge

**职责：** AI 执行过程中的回调通道。让 Claude 能操作 Capibara 系统。

**v2.1 关键变更：**

- ❌ **PendingPlanStore 删除**。MCP Bridge 的 `capibara_plan_tasks` 工具不再写共享存储
- ✅ 改为发事件：`plan:submitted`（payload 含 conversationId + tasks 结构）
- ✅ Planning 服务订阅该事件，在自己模块内部维护 pending 状态

**更新后的 MCP Tools 数据流：**

| Tool | Description | Calls Into |
|------|-------------|------------|
| `capibara_task_complete` | 标记任务完成 | Workflow.TaskService |
| `capibara_task_create_child` | 创建子任务 | Workflow.TaskService |
| `capibara_task_review` | 提交审阅 | Workflow.TaskService |
| `capibara_ask_question` | 向另一个 Role 提问 | Conversation.ConversationService |
| `capibara_plan_tasks` | 提交结构化计划 | **EventBus.emit('plan:submitted', ...)** |
| `capibara_context` | 查询上下文信息 | Organization + Workflow (read-only) |

---

### 3.7 Layer 2 — Coordination（v2.1 重组）

**v2.0 单一 Orchestrator 拆分为三个 sub-Orchestrator + 共享组件。**

#### 3.7.1 Shared Infrastructure in Layer 2

| Component | Responsibility |
|-----------|---------------|
| `WakeGateValidator` | 检查 Role 是否可被唤醒（状态、权限、熔断） |
| `BudgetGuard` | 预算检查 |
| `RetryScheduler` | 失败重试策略 |
| `RunCoordinator` | Run 生命周期：上下文准备 → prompt → 执行 → 后处理 |

#### 3.7.2 TaskOrchestrator

订阅 `task:*` 事件，管理任务级调度。

```
EventBus.on('task:created')            → onTaskCreated
EventBus.on('task:status-changed')     → onTaskStatusChanged → tryWake
EventBus.on('task:entered-approval')   → 持久化 paused_reason='approval'
EventBus.on('task:approval-confirmed') → 清除 paused_reason，scheduleNext
EventBus.on('task:completed')          → BehaviorEngine.onChildCompleted，scheduleNext
```

#### 3.7.3 ConversationOrchestrator

订阅 `conversation:*` 事件。

```
EventBus.on('conversation:needs-routing')     → InquiryRouter.route() → 写回 respondent
EventBus.on('conversation:response-needed')   → WakeGate → RunCoordinator.executeForConversation
EventBus.on('conversation:resolved')          → 唤醒 initiator Role 继续任务
EventBus.on('conversation:timed-out')         → InquiryEscalationService.attemptEscalation
```

#### 3.7.4 RunOrchestrator

订阅 `run:*` 事件。

```
EventBus.on('run:failed')    → RetryScheduler.scheduleRetry，drainPendingWakes
EventBus.on('run:succeeded') → drainPendingWakes
EventBus.on('run:cancelled') → drainPendingWakes
```

#### 3.7.5 InquiryRouter（v2.1 新位置）

**Layer 2 组件。** 订阅 `conversation:needs-routing` 事件：
1. 读取 Organization 的 `IRoleRepository`（合法 — 协调层可以读底座）
2. 根据 Role 层级和状态做路由决策
3. 调用 `ConversationService.assignRespondent(conversationId, respondentRoleId)` 写回结果
4. ConversationService 内部发 `conversation:respondent-assigned` + `conversation:response-needed`

#### 3.7.6 InquiryEscalationService（v2.1 新位置）

**Layer 2 组件。** 订阅 `conversation:timed-out` 事件，同样在协调层读取 Organization 数据，执行升级路径。

---

### 3.8 Layer 3 — Planning（v2.1 重构）

**职责：** 人机多轮对话 → 结构化任务计划 → 批量创建任务。

**v2.1 实现：**

```
Planning = Conversation(type: 'planning')
         + EventBus 订阅 plan:submitted
         + 内部私有 pendingPlans Map
         + Workflow.batchCreate
```

**无 PendingPlanStore。** pending plan 状态是 Planning 模块的**私有状态**，不通过 Infrastructure 层共享。

**Flow（v2.1）：**

```
1. Human → PlanningService.start(orgId, roleId, message)
2. PlanningService → ConversationService.create(type: 'planning', ...)
3. Conversation emits conversation:response-needed
4. ConversationOrchestrator → RunCoordinator.executeForConversation()
5. AI 通过 MCP Tool capibara_plan_tasks 提交计划
6. MCP Bridge → EventBus.emit('plan:submitted', { conversationId, tasks })
7. PlanningService 订阅 plan:submitted → 写入私有 pendingPlans Map
8. PlanningService → 通知 UI（通过已有的 IPC 事件通道）
9. Human 在 UI 确认 → PlanningService.confirmPlan(conversationId)
10. PlanningService → Workflow.TaskService.batchCreate(tasks)
```

**Components：**

| Component | Responsibility |
|-----------|---------------|
| `PlanningService` | 发起 planning conversation、订阅 plan:submitted、维护私有 pendingPlans、batch create |

**私有 pendingPlans 存储策略：**
- 默认内存（pending plan 是短期工作状态，重启丢失可接受）
- 若需持久化，用 Planning 模块自己的表 `planning_pending_plans`，不下沉到 Infrastructure

---

### 3.9 Layer 3 — Notification

**v2.1 变更：删除 EventDigester。** 当前代码库中 EventDigester 无任何调用者，Narrative 已移除，保留无意义。

| Component | Responsibility |
|-----------|---------------|
| `EventBroadcaster` | 领域事件 → IPC → Renderer |
| `NotificationService` | 桌面系统通知 |

---

## 4. Typed Events & Metadata（v2.1 新章节）

### 4.1 Event Payload Typing

**禁止任何 handler 内出现 `event.payload as Record<string, ...>`。**

**新的 `foundation/events.ts` 结构：**

```typescript
// 1. Per-event payload interfaces
export interface TaskStatusChangedPayload {
  taskId: string;
  orgId: string;
  from: string;
  to: string;
  assigneeRoleId: string | null;
}

export interface ConversationResponseNeededPayload {
  conversationId: string;
  orgId: string;
  roleId: string;
  type: ConversationType;
}

export interface ConversationNeedsRoutingPayload {
  conversationId: string;
  orgId: string;
  askingRoleId: string;
  taskId: string | null;
}

export interface PlanSubmittedPayload {
  conversationId: string;
  orgId: string;
  tasks: PlanTaskDraft[];
}

export interface RunFailedPayload {
  runId: string;
  orgId: string;
  taskId: string | null;
  conversationId: string | null;
  errorCode: string;
  errorMessage: string;
}

// ... 每个事件都有 typed payload

// 2. Master map
export interface DomainEventMap {
  'task:created': TaskCreatedPayload;
  'task:status-changed': TaskStatusChangedPayload;
  'task:entered-approval': TaskEnteredApprovalPayload;
  'task:approval-confirmed': TaskApprovalConfirmedPayload;
  'task:approval-rejected': TaskApprovalRejectedPayload;
  'task:completed': TaskCompletedPayload;

  'conversation:created': ConversationCreatedPayload;
  'conversation:message-added': ConversationMessageAddedPayload;
  'conversation:needs-routing': ConversationNeedsRoutingPayload;
  'conversation:respondent-assigned': ConversationRespondentAssignedPayload;
  'conversation:response-needed': ConversationResponseNeededPayload;
  'conversation:resolved': ConversationResolvedPayload;
  'conversation:escalated': ConversationEscalatedPayload;
  'conversation:timed-out': ConversationTimedOutPayload;
  'conversation:cancelled': ConversationCancelledPayload;

  'run:queued': RunQueuedPayload;
  'run:started': RunStartedPayload;
  'run:succeeded': RunSucceededPayload;
  'run:failed': RunFailedPayload;
  'run:cancelled': RunCancelledPayload;

  'plan:submitted': PlanSubmittedPayload;

  // ... all events typed
}

export type DomainEventType = keyof DomainEventMap;

// 3. Typed event
export interface DomainEvent<T extends DomainEventType> {
  type: T;
  timestamp: string;
  payload: DomainEventMap[T];
}
```

**IEventBus 签名更新：**

```typescript
export interface IEventBus {
  emit<T extends DomainEventType>(event: DomainEvent<T>): void;
  on<T extends DomainEventType>(type: T, handler: (event: DomainEvent<T>) => void): Unsubscribe;
}
```

Handler 内部直接访问 `event.payload.taskId`，编译器保证字段存在性和类型。

### 4.2 Zod Schemas Mirror

每个 payload interface 对应一个 Zod schema（命名约定 `{PayloadName}Schema`），供两处使用：
- IPC 边界输入校验（已有约定）
- Repository JSON 字段反序列化（Conversation.metadata 等）

单一真相：Zod schema 通过 `z.infer` 派生 TS 类型，避免两处手写。

### 4.3 Metadata 判别联合

见 §3.4 — Conversation.metadata 按 type 判别联合。

---

## 5. Concurrency & Consistency（v2.1 新章节）

### 5.1 Execution Model

| 假设 | 保证方式 |
|------|---------|
| Electron 主进程单线程 | JS 事件循环天然串行 |
| better-sqlite3 同步阻塞 | 单条 SQL 原子，但长事务会阻塞主进程 |
| Worker 线程调用 Claude | 在 worker 池中，不阻塞主进程 |

### 5.2 Concurrency Constraints

| 维度 | 约束 | 保障机制 |
|------|------|---------|
| 同 Role 并发 | **最多 1 个 active Run** | WakeGateValidator + `runs.status='running'` 唯一性 + DB 唯一约束 |
| 同 Task 并发 | 由单一 assignee 处理 | Task 有 `assigneeRoleId`；WakeGateValidator 拒绝非 assignee 的唤醒 |
| 同 Conversation 并发 | 最多 1 个 active Run 关联 | 同上 |
| Orchestrator handler 重入 | 禁止 | emit 延迟到事务提交之后（见 §5.4） |

**DB 唯一约束（v2.1 新增）：**

```sql
CREATE UNIQUE INDEX idx_runs_active_per_role
  ON runs(role_id)
  WHERE status IN ('queued', 'running');
```

### 5.3 Transaction Boundaries

- 所有涉及多表写的业务操作必须包在 `db.transaction()` 内
- Repository 方法内部禁止嵌套 transaction；transaction 必须由 Service 层开启
- 长跑操作（Claude 调用）必须在 transaction 外

### 5.4 Transactional Outbox（事件发射时机）

**问题：** v2.0 代码在 service 方法内直接 `eventBus.emit(...)`，若外层 transaction 最终回滚，事件监听者已经产生副作用。

**v2.1 方案：Outbox Pattern**

```sql
CREATE TABLE outbox (
  id TEXT PRIMARY KEY,
  event_type TEXT NOT NULL,
  payload TEXT NOT NULL,       -- JSON
  created_at TEXT NOT NULL,
  published_at TEXT             -- NULL = not yet published
);
```

- Service 层"发射"事件 = 向 outbox 插入行（**在同一个 transaction 内**）
- `OutboxPublisher`（Infrastructure 组件）在 transaction 提交之后轮询未 published 的行，调用 `EventBus.emit`，然后标记 published
- 若事务回滚，outbox 插入也回滚 → 事件不会到达订阅者

**实现要点：**
- 每次 service 方法 commit 后立刻触发 `OutboxPublisher.flush()`（而非定时轮询），保持低延迟
- 单个 Node.js 进程内调用 `EventBus.emit` 是同步的，handler 串行执行，不会再次进入同一事务

### 5.5 Reentrancy Rules

- Orchestrator handler 禁止在自己内部**同步**触发会进入同一 handler 的事件链（编译期无法保证，但文档强制；测试用拓扑校验）
- 如必须级联，使用 `queueMicrotask` 或走 outbox

---

## 6. Migration & Data Safety（v2.1 新章节）

### 6.1 Greenfield Consolidation Strategy

因为**项目为全新项目、无向后兼容要求**，v2.1 取消渐进式迁移，采用：

1. **合并所有历史迁移为单一 v1 baseline**。删除 `migrations.ts` 中 v1–v9 的所有记录，新建统一的 v1 CREATE 脚本
2. **用户本地数据库无迁移路径 — 直接重置**。首次启动新版本时若检测到旧 schema_version < 新 baseline，弹出对话框告知用户数据将被清空，获得确认后重建
3. **未来迁移严格增量**，从 v2 起不再有 DROP TABLE 类破坏操作

### 6.2 Migration Safety Protocol（面向未来）

| 规则 | 说明 |
|------|------|
| **每次迁移前自动备份** | migration runner 在应用任何 v>current 迁移前，复制 `capibara.db` → `capibara.db.backup.pre-v{N}-{timestamp}` |
| **保留最近 5 个备份** | 滚动清理；提供手动恢复命令 |
| **禁止 DROP TABLE 业务表** | 改名为 `{table}_legacy_v{N}` 保留 1 个版本周期后再删 |
| **失败回滚策略** | 迁移失败 → 进入只读维护模式 → 指引用户从备份恢复 |
| **迁移脚本必须幂等** | 使用 `IF NOT EXISTS` / `pragma table_info` 预检 |

### 6.3 Backup Utility

新增 `infrastructure/persistence/sqlite/migration-backup.ts`：

```typescript
export class MigrationBackupService {
  backupBeforeMigration(currentVersion: number, targetVersion: number): string;
  listBackups(): Backup[];
  restoreFromBackup(backupPath: string): void;
  pruneOldBackups(keep: number): void;
}
```

---

## 7. Directory Structure（v2.1）

```
apps/electron/src/core/
├── bootstrap/
│   ├── composition-root.ts
│   ├── workflow.module.ts
│   ├── organization.module.ts
│   ├── conversation.module.ts
│   ├── execution.module.ts
│   ├── prompt.module.ts
│   ├── mcp.module.ts
│   ├── coordination.module.ts         ← v2.1 renamed (was orchestrator.module.ts)
│   ├── planning.module.ts
│   └── notification.module.ts
│
├── foundation/
│   ├── tokens.ts
│   ├── events.ts                       ← v2.1 typed DomainEventMap
│   ├── event-schemas.ts                ← v2.1 Zod schemas for events
│   └── errors/
│
├── modules/
│   ├── workflow/                       ← pure base (no cross-module deps)
│   ├── organization/                   ← pure base
│   │
│   ├── conversation/                   ← v2.1 slim
│   │   ├── types/
│   │   ├── interfaces/
│   │   ├── services/
│   │   │   └── conversation.service.ts (no role repo dep)
│   │   ├── context/
│   │   │   └── conversation-context.builder.ts
│   │   └── persistence/
│   │   ❌ no routing/ folder (moved to coordination)
│   │
│   ├── execution/                      ← v2.1 Run discriminated union
│   ├── prompt/
│   ├── mcp/                            ← v2.1 no pending-plan-store write
│   │
│   ├── coordination/                   ← v2.1 new (expanded from orchestrator)
│   │   ├── orchestrators/
│   │   │   ├── task.orchestrator.ts
│   │   │   ├── conversation.orchestrator.ts
│   │   │   └── run.orchestrator.ts
│   │   ├── routing/
│   │   │   ├── inquiry.router.ts       ← relocated from conversation/
│   │   │   └── inquiry-escalation.service.ts ← relocated
│   │   ├── run.coordinator.ts
│   │   ├── wake-gate.validator.ts
│   │   ├── retry.scheduler.ts
│   │   ├── budget.guard.ts
│   │   └── task.scheduler.ts
│   │
│   ├── planning/                       ← v2.1 owns its pendingPlans
│   │   └── planning.service.ts (subscribes plan:submitted)
│   │
│   └── notification/                   ← v2.1 no event-digester
│       ├── event-broadcaster.ts
│       └── notification.service.ts
│
├── ipc-handlers/
├── infrastructure/
│   ├── persistence/sqlite/
│   │   ├── migrations.ts               ← v2.1 consolidated v1 baseline
│   │   └── migration-backup.ts         ← v2.1 new
│   ├── observability/
│   │   ├── pino.logger.ts
│   │   ├── emittery.event-bus.ts
│   │   └── outbox.publisher.ts         ← v2.1 new
│   └── adapters/
│   ❌ no stores/ folder (PendingPlanStore removed)
│
└── preload/
```

---

## 8. Implementation Phases（v2.1 重新编排）

**基于代码实证评估**：方案 v2.0 Phase 2/3 的大部分工作（Session→Conversation 合并、Discussion 移除、Approval 实现）**代码里已经完成**。Phase 编号基于**剩余真实工作量**重新划分。

### Phase 0 — Foundation Contracts（阻塞其他 Phase）

目标：v2.1 的核心契约和安全基础。

- [ ] 将 `foundation/events.ts` 改造为 `DomainEventMap` 判别联合结构
- [ ] 为每个事件 payload 写对应 Zod schema（`foundation/event-schemas.ts`）
- [ ] 更新 `IEventBus` 签名为泛型版
- [ ] 创建 `Outbox` 表 + `OutboxPublisher`
- [ ] Service 层所有 `eventBus.emit` 改为写 outbox
- [ ] 创建 `MigrationBackupService`
- [ ] 定义"迁移失败处理策略"文档（进入只读模式 + 恢复指引）
- [ ] 数据库 schema 合并为单一 v1 baseline；删除历史 v1-v9 记录
- [ ] 新 baseline 加入 `runs` CHECK 约束 + 唯一索引 + `tasks.paused_reason` 列 + `outbox` 表

### Phase 1 — Break Cross-Base Coupling

目标：彻底解耦三底座，落地新协调层。

- [ ] 新建 `modules/coordination/` 目录结构
- [ ] 从 `modules/conversation/routing/` 迁出 `InquiryRouter` → `modules/coordination/routing/`
- [ ] 从 `modules/conversation/services/inquiry-escalation.service.ts` 迁出 → 同上
- [ ] `ConversationService` 移除 `IRoleRepository` 依赖；改为发 `conversation:needs-routing` 事件
- [ ] InquiryRouter 改为订阅 `conversation:needs-routing`，读完 Organization 后调用 `ConversationService.assignRespondent(...)` 写回
- [ ] `ConversationService.assignRespondent` 内部发 `conversation:respondent-assigned` + `conversation:response-needed`

### Phase 2 — Split Orchestrator

目标：把 222 行的 Orchestrator 拆成三个专职 sub-Orchestrator。

- [ ] 创建 `TaskOrchestrator`（订阅 task:*）
- [ ] 创建 `ConversationOrchestrator`（订阅 conversation:*）
- [ ] 创建 `RunOrchestrator`（订阅 run:*）
- [ ] 迁移 handler 代码；删除老 Orchestrator 文件
- [ ] `pausedTasks` 内存 Set → `tasks.paused_reason` 列
- [ ] `scheduledTaskIds` 内存 Set → 改为查 DB（Task.status=initial 且未在 active 子树内）
- [ ] Composition root 注册三个 sub-Orchestrator

### Phase 3 — Typed Metadata & Run Target

目标：落地所有判别联合类型。

- [ ] `Conversation` 改为判别联合，metadata 按 type 分
- [ ] Repository 反序列化改用 Zod `parse`（禁用 `as` 断言）
- [ ] `Run` 改为 `RunBase & RunTarget` 判别联合
- [ ] 所有创建 Run 的 Service 代码按判别联合构造入参
- [ ] DB migration（合并入 Phase 0 的 v1 baseline）
- [ ] Grep 全仓 `as Record<string,` / `as Record<string, unknown>` 确保清零

### Phase 4 — Eliminate PendingPlanStore

目标：Planning 私有状态 + 事件驱动。

- [ ] `PlanningService` 订阅 `plan:submitted` 事件
- [ ] `PlanningService` 内部持有私有 `pendingPlans: Map<string, Plan>`
- [ ] MCP `capibara_plan_tasks` tool handler 改为 `eventBus.emit('plan:submitted', ...)`
- [ ] 删除 `infrastructure/stores/pending-plan.store.ts`
- [ ] 删除 `infrastructure/stores/` 空目录
- [ ] 删除 `PENDING_PLAN_STORE_TOKEN`

### Phase 5 — Cleanup

- [ ] 删除 `modules/notification/event-digester.ts`（死代码）
- [ ] 删除 `EVENT_DIGESTER_TOKEN`
- [ ] 搜索并删除所有 Discussion 相关残留（已确认几乎无，但需 sweep）
- [ ] 统一 IPC 命名空间：`capibara:approval:*` 并入 `capibara:task:approve` / `capibara:task:reject`
- [ ] 更新 `docs/` 下所有文档中对 `Orchestrator` 单体、`PendingPlanStore` 的描述

### Phase 6 — Verification

- [ ] 补齐事件拓扑测试：模拟每个事件类型验证 Orchestrator 路由正确
- [ ] 补齐判别联合类型测试：非法 Run / 非法 Conversation 被 Zod 拒绝
- [ ] 集成测试：完整 planning flow（人发起 → MCP plan:submitted → Planning 接收 → 确认 → Workflow batchCreate）
- [ ] 集成测试：完整 inquiry flow（AI 问 → needs-routing → Router 指派 → respondent-assigned → response-needed → Run）
- [ ] 运行 v1 baseline 在空 DB 上，确认无迁移错误

---

## 9. Removed Features（v2.1 合并 v2.0）

| Feature | Status | Replacement |
|---------|--------|-------------|
| **Discussion**（DiscussionGroup 等） | 从未存在于当前代码 | Approval status category |
| **Narrative / NarrativeEngine** | 移除 | — |
| **Review/Consensus System** | 随 Discussion 移除 | Approval status |
| **Session / SessionMessage** | 已从 DB drop（v8 迁移） | Conversation(type: planning / adhoc) + externalSessionId |
| **EventDigester** | v2.1 新增移除 | 无替代（死代码） |
| **PendingPlanStore** | v2.1 新增移除 | EventBus + Planning 私有状态 |
| **单 Orchestrator god object** | v2.1 拆分 | TaskOrchestrator + ConversationOrchestrator + RunOrchestrator |

---

## 10. Terminology（v2.1 更新项）

（5.1 Unified Glossary 保持 v2.0 内容，新增/修改以下条目）

| Term | Definition | Module |
|------|-----------|--------|
| **InquiryRouter** | **Layer 2 组件**，订阅 `conversation:needs-routing`，读取 Organization 数据决策 respondent | Coordination |
| **InquiryEscalationService** | **Layer 2 组件**，订阅 `conversation:timed-out` 执行升级 | Coordination |
| **TaskOrchestrator** | 专责 task:* 事件的 sub-Orchestrator | Coordination |
| **ConversationOrchestrator** | 专责 conversation:* 事件的 sub-Orchestrator | Coordination |
| **RunOrchestrator** | 专责 run:* 事件的 sub-Orchestrator | Coordination |
| **Outbox** | 事务性事件发射表 | Infrastructure |
| **DomainEventMap** | 事件类型 → payload 类型 的映射（TS 判别联合基础） | foundation/events |

**新增 Removed Terms：**

| Removed | Replaced By |
|---------|-------------|
| `Orchestrator`（单体） | `TaskOrchestrator` + `ConversationOrchestrator` + `RunOrchestrator` |
| `PendingPlanStore` | EventBus + Planning 私有状态 |
| `EventDigester` | — |
| `ORCHESTRATOR_TOKEN` | `TASK_ORCHESTRATOR_TOKEN` / `CONVERSATION_ORCHESTRATOR_TOKEN` / `RUN_ORCHESTRATOR_TOKEN` |
| `PENDING_PLAN_STORE_TOKEN` | — |
| `EVENT_DIGESTER_TOKEN` | — |

---

## 11. Design Decisions Log（新增条目）

| # | Decision | Rationale |
|---|----------|-----------|
| D1–D7 | （v2.0 原决策保留） | — |
| **D8** | InquiryRouter / InquiryEscalationService 上移 Layer 2 | 原 v2.0 的"Conversation → Organization 单向只读"是底座独立原则的例外，长期会被团队当作"便利通道"滥用。上移后 Conversation 底座完全纯净 |
| **D9** | PendingPlanStore 改为 EventBus 发布订阅 | 避免把领域概念下沉到 Infrastructure；Planning 的 pending 状态是该模块的私有业务状态 |
| **D10** | 事件 payload 全部走 `DomainEventMap` 判别联合 | 消除 11+ 处 `as Record<string, ...>` 断言；IDE 自动补全；Schema 变更编译期暴露 |
| **D11** | Conversation.metadata 按 type 判别联合 | inquiry/planning/adhoc 各有结构化元数据；unknown bag 代码里到处是 `as` 断言 |
| **D12** | Run.target 判别联合 + DB CHECK | Task execution / Inquiry response / Planning / Adhoc 四种合法组合由类型和 DB 共同保证，杜绝非法状态 |
| **D13** | Orchestrator 从 1 拆 3 | 222 行 / 10 订阅 / 14 依赖已逼近 god object 临界；三种事件域语义不同，拆分后每个 <100 行 |
| **D14** | 暂停状态从内存 Set 持久化到 `tasks.paused_reason` | 应用重启后调度行为一致；避免"审批中"任务重启后丢失暂停标志被误调度 |
| **D15** | Transactional Outbox 替代直接 emit | 消除幽灵事件风险；事务回滚时事件一起回滚 |
| **D16** | Greenfield 合并迁移为单一 v1 baseline | 当前项目无用户数据、无向后兼容压力；保留 9 条历史迁移只会让新开发环境启动慢、阅读困难 |
| **D17** | 未来迁移严格增量 + 备份先行 | 一次性整合后，未来严禁 DROP TABLE 业务表；每次 v>current 迁移前自动备份 DB 文件 |

---

## 12. Non-Goals（v2.1 明确）

为了避免 scope creep，v2.1 **不包含**以下变更：

- 不改 IPC 命名空间整体结构（只做 §8 Phase 5 提到的 approval 合并）
- 不改 Workflow / Organization 的核心实体字段
- 不引入新模块（Skills、Knowledge Base 等未来特性）
- 不做 UI 层重写（属于 Renderer；Phase 12 以后）
- 不引入外部消息队列（outbox 用 SQLite 表本地实现即可）

---

## 13. Risk Assessment（v2.1 新章节）

| 风险 | 严重度 | 概率 | 缓解 |
|------|-------|------|------|
| Outbox 引入延迟使事件处理变慢 | 低 | 中 | 单进程同步 flush，延迟在 ms 级 |
| 判别联合类型改造触及 Repository 多处 | 中 | 高 | Phase 0 集中做；Zod schema 作为单一真相源减少手写 |
| InquiryRouter 迁移破坏现有路由语义 | 中 | 低 | 完整集成测试覆盖 inquiry 全流程 |
| Greenfield 合并 v1 baseline 若有开发者本地有测试数据会丢失 | 低 | 中 | 首次启动对话框 + README 说明 |
| 三个 sub-Orchestrator 之间产生事件级联环 | 中 | 中 | 拓扑测试 + 禁止同步自环规则 + Outbox 异步化 |
| paused_reason 字段枚举发散 | 低 | 中 | 枚举由类型定义 + CHECK 约束 |

---

## 14. Summary of Changes from v2.0

| 类别 | v2.0 | v2.1 |
|------|------|------|
| **底座独立原则** | 允许 Conversation → Organization 例外 | 完全独立，无例外 |
| **InquiryRouter** | Layer 1 内（conversation 模块） | Layer 2（coordination 模块） |
| **PendingPlanStore** | Infrastructure 共享 Store | 删除，改 EventBus + Planning 私有状态 |
| **事件 payload 类型** | `DomainEvent<T = unknown>` | `DomainEventMap` 判别联合 |
| **Conversation.metadata** | `Record<string, unknown>` | 按 type 判别联合 |
| **Run.target** | 两字段独立可空 | 判别联合 + DB CHECK + 唯一索引 |
| **Orchestrator** | 单体，保留 | 拆为 Task / Conversation / Run 三个 |
| **暂停状态** | 内存 Set | DB 列 `tasks.paused_reason` |
| **事件发射** | service 内同步 emit | Transactional Outbox |
| **EventDigester** | 保留 | 删除（死代码） |
| **数据迁移** | 未定义 | Greenfield 合并 v1 + 未来严格增量 + 备份先行 |
| **并发/事务边界** | 未提及 | §5 明确声明 |
| **Phase 计划** | 6 phases，按 v2.0 文本估算 | 7 phases（0-6），基于真实代码现状 |

---

*End of Plan — v2.1*
