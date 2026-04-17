# Capibara Refactoring Architecture Plan

> **Version**: 2.0  
> **Date**: 2026-04-17  
> **Status**: Approved Direction  
> **Changes from v1**: Fixed layer assignments (Prompt/MCP Bridge → L1.5), added RunCoordinator, 6 design corrections applied.

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
| **底座独立** | Workflow、Organization 彼此不直接依赖。Conversation → Organization 允许单向只读依赖（用于 InquiryRouter 查询角色层级和能力），无循环依赖 |
| **事件驱动协调** | 底座只发出事件，Orchestrator 消费事件后统一调度 |
| **底座不调用 AI** | 底座只产生"需要 AI 做什么"的意图，由 Runtime 层执行 |
| **依赖向下** | 上层可依赖下层，下层不依赖上层 |

### 1.3 Inter-Module Dependency Rules

```
允许的依赖方向：
  Layer 3  → Layer 2, Layer 1.5, Layer 1, Layer 0, Infrastructure
  Layer 2  → Layer 1.5, Layer 1, Layer 0, Infrastructure
  Layer 1.5 → Layer 1, Layer 0, Infrastructure
  Layer 1  → Layer 0, Infrastructure
  Layer 0  → Infrastructure

底座间：
  Conversation → Organization（单向只读：查询 Role 层级/能力/状态）
  Workflow ✕ Organization（不互相依赖）
  Workflow ✕ Conversation（不互相依赖）
```

---

## 2. Architecture Overview

```
┌──────────────────────────────────────────────────────────────┐
│ Layer 3 — Features（上层功能）                                │
│                                                              │
│   Planning                        Notification               │
│   (Conversation(planning)         (事件广播 +                │
│    + plan extraction              桌面通知)                   │
│    + Workflow.batchCreate)                                    │
└────────────────────────┬─────────────────────────────────────┘
                         │ depends on
┌────────────────────────┴─────────────────────────────────────┐
│ Layer 2 — Coordination（协调层）                              │
│                                                              │
│   Orchestrator              RunCoordinator                   │
│   (中枢调度：               (Run 生命周期：                    │
│    WHEN & WHETHER)           准备上下文 → prompt → 执行 →     │
│   ├── WakeGateValidator      处理结果)                        │
│   ├── RetryScheduler                                         │
│   └── BudgetGuard                                            │
└──────────────────────────┬───────────────────────────────────┘
                           │ depends on
┌──────────────────────────┴───────────────────────────────────┐
│ Layer 1.5 — Integration（集成层）                             │
│                                                              │
│   Prompt               MCP Bridge                            │
│   (底座 → AI:          (AI → 底座:                            │
│    聚合上下文            分发 Claude 回调)                     │
│    组装提示词)                                                │
└──┬──────────────────────┬─────────────────────┬──────────────┘
   │ reads                │ reads               │ reads
   ▼                      ▼                     ▼
┌─────────────────┐ ┌─────────────────┐ ┌──────────────────────┐
│ Layer 1          │ │ Layer 1          │ │ Layer 1               │
│ Workflow         │ │ Organization     │ │ Conversation          │
│                  │ │                  │ │                       │
│ ProcessSchema    │ │ Role hierarchy   │ │ Unified dialog engine │
│ Status machine   │ │ Permissions      │ │ ├─ Inquiry (AI↔AI)   │
│ Transitions      │ │ Persona          │ │ ├─ Planning (H↔AI)   │
│ BehaviorRules    │ │ Skills           │ │ └─ Adhoc (H↔AI)     │
│ Approval (status)│ │                  │ │ Routing & Escalation │
│                  │ │                  │←── reads (single-dir)  │
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
│   Logging        PendingPlanStore                            │
└──────────────────────────────────────────────────────────────┘
```

---

## 3. Module Specifications

### 3.1 Layer 0 — Execution

**职责:** 纯粹的 AI 调用运行时。给定 prompt + 配置 → 调用 Claude → 返回结果。

**Core Concepts:**

| Concept | Description |
|---------|-------------|
| `Run` | 一次原子 AI 调用记录（一次 prompt → 一次 response） |
| `RunStatus` | `queued` \| `running` \| `succeeded` \| `failed` \| `cancelled` \| `interrupted` |
| `CostEntry` | Token 消耗和费用记录 |

**Run Entity:**

```typescript
interface Run {
  id: string;
  orgId: string;
  taskId: string | null;              // 为 Task 执行（task execution 场景）
  conversationId: string | null;       // 为 Conversation 执行（inquiry/planning/adhoc 场景）
  roleId: string;
  status: RunStatus;
  wakeReason: WakeReason;
  startedAt: string | null;
  finishedAt: string | null;
  tokenCount: number;
  createdAt: string;
}
```

**Run ↔ Task/Conversation 关联规则：**

| Scenario | taskId | conversationId |
|----------|--------|----------------|
| Task execution（任务执行） | set | null |
| Inquiry response（AI 回复质询） | set (inquiry 关联的 task) | set |
| Planning（规划对话） | null | set |
| Adhoc（自由对话） | null | set |

**Components:**

| Component | Suffix | Responsibility |
|-----------|--------|---------------|
| `RunEngine` | Engine | 纯 AI 执行：创建 Run → 调用 Worker → 流式解析 → 记录结果 |
| `WorkerService` | Service | Worker 线程池管理 |
| `FileLogService` | Service | Run 输出日志写入文件 |
| `CostTracker` | Service | Token 消耗记录 |

**No Business Logic.** 不知道 Task、Role、Conversation 是什么。只接收 prompt string 和 config，返回 AI 输出。

---

### 3.2 Layer 1 — Workflow

**职责:** 定义和管理任务类型、状态、流转规则和自动化行为。

**Core Concepts:**

| Concept | Description |
|---------|-------------|
| `ProcessSchema` | 定义 work item types、statuses、transitions、behavior rules |
| `Task` | 树状层级任务实例（epic → story → task → subtask） |
| `Status` | 有四类 category: `initial`, `active`, `approval`, `terminal` |
| `Transition` | 状态间流转规则，mode: `manual`, `auto`, `system` |
| `BehaviorRule` | TCA 模型（Trigger-Condition-Action）自动化规则 |

**Approval as Status Category:**

Discussion/Review 系统被移除。人工审批建模为 Workflow 的一种状态类别：

```
Status categories:
  initial     — 任务起始状态（如 pending）
  active      — 任务执行中（如 in_progress）
  approval    — 等待人工审批确认（如 awaiting_approval）
  terminal    — 任务结束状态（如 done, cancelled）
```

当 Task 进入 `approval` 类别的状态时：
- Workflow 模块发出事件（如 `task:entered-approval`）
- Orchestrator 收到事件后暂停该 Task 相关调度
- 人类在 UI 上确认/拒绝
- 确认后 Workflow 状态转换继续，Orchestrator 恢复调度

**Components:**

| Component | Suffix | Responsibility |
|-----------|--------|---------------|
| `ProcessEngine` | Engine | Schema 加载、验证、状态转换合法性检查 |
| `TaskService` | Service | Task CRUD + 状态转换 + 校验 |
| `TaskStateMachine` | Engine | 执行状态转换、发出事件 |
| `BehaviorEngine` | Engine | TCA 规则评估与执行 |
| `ProcessTemplateService` | Service | 从磁盘加载流程模板 |

**Emitted Events:**
- `task:created`
- `task:status-changed`
- `task:completed`
- `task:entered-approval`
- `task:approval-confirmed`
- `task:approval-rejected`

**No Dependencies On:** Organization, Conversation（不知道谁在用它，只管任务和状态）

---

### 3.3 Layer 1 — Organization

**职责:** 管理 AI 角色组织架构、权限体系和能力分配。

**Core Concepts:**

| Concept | Description |
|---------|-------------|
| `Organization` | 顶层容器，代表一个项目上下文 |
| `Role` | AI Agent 或人类团队成员的角色定义 |
| `Skill` | 角色能力模板（persona enrichment + command） |

**Role Hierarchy:**

```
Organization
  └── Role (root, e.g., "Tech Lead")
        ├── Role (child, e.g., "Frontend Dev")
        └── Role (child, e.g., "Backend Dev")
              └── Role (grandchild, e.g., "DB Specialist")
```

层级关系决定：
- 升级路径（子 → 父）
- 委派方向（父 → 子）
- 审批权限（`canApprove`）

**Components:**

| Component | Suffix | Responsibility |
|-----------|--------|---------------|
| `OrganizationService` | Service | Organization CRUD |
| `RoleService` | Service | Role CRUD + hierarchy management |
| `SkillService` | Service | Skill CRUD + assignment |
| `OrgTemplateService` | Service | 模板加载和实例化 |

**Emitted Events:**
- `org:created` / `org:updated` / `org:deleted`
- `role:created` / `role:updated` / `role:deleted`

**No Dependencies On:** Workflow, Conversation（不知道任务和对话的存在）

---

### 3.4 Layer 1 — Conversation

**职责:** 统一管理所有类型的结构化对话 — AI↔AI 质询、Human↔AI 规划、Human↔AI 自由对话。

**Dependency:** Conversation → Organization（单向只读）。InquiryRouter 需要查询 Role 层级关系、技能、可用状态来做路由决策。Organization 不知道 Conversation 的存在。

**Core Concepts:**

| Concept | Description |
|---------|-------------|
| `Conversation` | 一次完整的对话实例 |
| `ConversationType` | `inquiry` \| `planning` \| `adhoc` |
| `ConversationMessage` | 对话中的一条消息 |
| `ConversationState` | 对话状态机 |

**Conversation Entity:**

```typescript
interface Conversation {
  id: string;
  orgId: string;
  type: ConversationType;              // inquiry | planning | adhoc
  state: ConversationState;            // active | waiting | resolved | escalated | cancelled | completed
  initiatorRoleId: string;             // 发起方
  respondentRoleId: string | null;     // 响应方（inquiry 需路由；planning/adhoc 预指定）
  respondentType: 'ai' | 'human';
  taskId: string | null;               // 关联 Task（inquiry 必有；planning/adhoc 可选）
  parentConversationId: string | null;  // 嵌套对话
  depth: number;
  priority: number;
  timeoutAt: string | null;            // 仅 inquiry 有效
  externalSessionId: string | null;    // Claude CLI --resume session ID（planning/adhoc 用于多轮上下文保持）
  metadata: Record<string, unknown>;   // 类型特定的扩展数据
  createdAt: string;
  updatedAt: string;
}
```

**externalSessionId 说明：**
- `planning` / `adhoc` 类型需要此字段来支持 Claude CLI 的 `--resume` 多轮对话上下文保持
- `inquiry` 类型不需要（单轮问答）
- 此字段替代了原 `Session.cliSessionId` 的功能

**ConversationMessage Entity:**

```typescript
interface ConversationMessage {
  id: string;
  conversationId: string;
  authorRoleId: string | null;         // null for system messages
  authorType: 'ai' | 'human' | 'system';
  content: string;
  intent: MessageIntent;               // question | reply | escalation | resolution | general
  inReplyToMessageId: string | null;
  createdAt: string;
}
```

**Three Conversation Types — Behavior Matrix:**

| Behavior | Inquiry | Planning | Adhoc |
|----------|---------|----------|-------|
| Initiator | AI (Role) | Human | Human |
| Respondent | AI/Human (routed) | AI (specified Role) | AI (specified Role) |
| Requires routing? | Yes | No | No |
| Requires timeout/escalation? | Yes | No | No |
| Has structured output? | No | Yes (Plan via MCP) | No |
| Uses externalSessionId? | No | Yes | Yes |
| End condition | resolved / escalated | plan confirmed / cancelled | human closes |
| Linked to Task? | Always | Optional | Optional |

**Components:**

| Component | Suffix | Responsibility |
|-----------|--------|---------------|
| `ConversationService` | Service | Conversation CRUD + 状态转换 + 消息管理 |
| `InquiryRouter` | Router | Inquiry 类型的响应方路由决策（依赖 Organization 模块只读查询 Role 数据） |
| `InquiryEscalationService` | Service | Inquiry 超时监控 + 升级 |
| `ConversationContextBuilder` | Builder | 构建对话上下文（给 Prompt 模块用） |

**State Machine:**

```
         ┌─────────── active ───────────┐
         │               │              │
         ▼               ▼              ▼
     waiting ──→ resolved       cancelled
     (inquiry    (conversation     (any time)
      only)       completed)
         │
         ├──→ escalated ──→ resolved
         │                      │
         └──→ timed_out ──→ escalated
```

**Emitted Events:**
- `conversation:created`
- `conversation:message-added`
- `conversation:response-needed` — **统一触发事件**（所有类型的 Conversation 需要 AI 响应时发出）
- `conversation:respondent-assigned` (inquiry routing 完成)
- `conversation:resolved`
- `conversation:escalated`
- `conversation:timed-out`
- `conversation:cancelled`

**`conversation:response-needed` 统一触发机制：**

| Scenario | When emitted |
|----------|-------------|
| Inquiry | InquiryRouter 确定 respondent 后 |
| Planning | Human 发送新消息后 |
| Adhoc | Human 发送新消息后 |

Orchestrator 统一监听此事件来决定是否唤醒 AI Role 执行：

```
Conversation emits conversation:response-needed(conversationId, roleId)
  → Orchestrator checks gates (budget, role status, etc.)
  → RunCoordinator executes
```

**No Dependencies On:** Workflow（不知道任务的内部逻辑，只存储 taskId 作为关联标识）

---

### 3.5 Layer 1.5 — Prompt

**职责:** 从各底座聚合上下文数据，组装成结构化的 prompt 文本。

**为什么在 Layer 1.5 而非 Layer 0：** Prompt 模块需要读取三个底座（Workflow、Organization、Conversation）的数据来组装上下文。它依赖 Layer 1，因此必须在 Layer 1 之上。

**Components:**

| Component | Suffix | Responsibility |
|-----------|--------|---------------|
| `PromptBuilder` | Builder | 组装最终 prompt |
| `TaskPromptStrategy` | Strategy | Task 执行场景的 prompt 结构 |
| `ConversationPromptStrategy` | Strategy | 对话场景的 prompt 结构（替代原 SessionPromptStrategy） |
| `RunContext` | Context | 从各底座聚合数据，准备 PromptContext |

**Data Sources:**

```
RunContext 从各底座读取（只读）：
  Workflow     → Task details, status, artifact history
  Organization → Role persona, skills, knowledge refs
  Conversation → Conversation history, context window
  Settings     → Locale, model config
```

---

### 3.6 Layer 1.5 — MCP Bridge

**职责:** AI 执行过程中的回调通道。让 Claude 能操作 Capibara 系统。

**为什么在 Layer 1.5 而非 Layer 0：** MCP Tool handlers 需要调用各底座模块的 Service（Workflow.TaskService、Conversation.ConversationService 等）。它依赖 Layer 1，因此必须在 Layer 1 之上。

**Components:**

| Component | Suffix | Responsibility |
|-----------|--------|---------------|
| `McpIpcServer` | Server | WebSocket server for MCP 调用 |
| `McpToolRegistry` | Registry | Tool 注册表 |
| `McpToolHandlers` | Handler | Tool 实现（调用各底座模块的 Service） |

**MCP Tools（Claude 可调用）:**

| Tool | Description | Calls Into |
|------|-------------|------------|
| `capibara_task_complete` | 标记任务完成 | Workflow.TaskService |
| `capibara_task_create_child` | 创建子任务 | Workflow.TaskService |
| `capibara_task_review` | 提交审阅 | Workflow.TaskService |
| `capibara_ask_question` | 向另一个 Role 提问 | Conversation.ConversationService |
| `capibara_plan_tasks` | 提交结构化计划 | Infrastructure.PendingPlanStore |
| `capibara_context` | 查询上下文信息 | Organization + Workflow (read-only) |

**PendingPlanStore 位于 Infrastructure 层** — MCP Bridge (L1.5) 写入 PendingPlanStore，Planning (L3) 读取。两者互不依赖，解决了 L1.5 → L3 的逆向依赖问题。

**NOTE:** MCP Bridge 是允许跨模块调用的集成点。但每个 tool handler 内部只调用一个模块的 Service。

---

### 3.7 Layer 2 — Orchestrator & RunCoordinator

**职责分工：**

| Component | Responsibility |
|-----------|---------------|
| **Orchestrator** | 决策层 — WHEN & WHETHER：监听底座事件，决定是否唤醒 Role |
| **RunCoordinator** | 执行层 — HOW：一次完整 Run 的生命周期管理 |

**为什么保留 RunCoordinator：** 如果把 Run 生命周期逻辑（准备上下文 → 构建 prompt → 调用 RunEngine → 处理结果 → 更新状态）直接塞进 Orchestrator，它会膨胀为 god object。RunCoordinator 将"执行细节"从 Orchestrator 中分离，保持 Orchestrator 作为纯决策层的简洁性。

**Orchestrator Core Logic:**

```
EventBus.on('task:status-changed')               → 判断是否唤醒 assignee
EventBus.on('task:entered-approval')              → 暂停该 Task 调度
EventBus.on('task:approval-confirmed')            → 恢复调度
EventBus.on('conversation:response-needed')       → 判断是否唤醒 respondent（统一入口）
EventBus.on('conversation:resolved')              → 恢复发起方 Role 的执行
EventBus.on('run:failed')                         → RetryScheduler 决定重试
```

**RunCoordinator Flow:**

```
Orchestrator 决定唤醒 Role
  → RunCoordinator.executeForTask(taskId, roleId, wakeReason)
      ├── RunContext.buildForTask() — 聚合上下文
      ├── PromptBuilder.build() — 构建 prompt
      ├── RunEngine.execute() — 调用 Claude
      └── 处理结果、发出事件

  → RunCoordinator.executeForConversation(conversationId, roleId)
      ├── RunContext.buildForConversation() — 聚合上下文
      ├── PromptBuilder.buildForConversation() — 构建 prompt
      ├── RunEngine.execute() — 调用 Claude
      └── 处理结果、发出事件
```

**Components:**

| Component | Suffix | Responsibility |
|-----------|--------|---------------|
| `Orchestrator` | Orchestrator | 事件监听 → 调度决策 → 委派 RunCoordinator |
| `RunCoordinator` | Coordinator | Run 生命周期：上下文准备 → prompt → 执行 → 后处理 |
| `WakeGateValidator` | Validator | 检查 Role 是否可被唤醒（状态、权限、熔断） |
| `RetryScheduler` | Scheduler | 失败重试策略 |
| `BudgetGuard` | Guard | 预算检查 |

**Coordination Patterns:**

```
Pattern 1: Task Execution
  Workflow emits task:status-changed(in_progress)
  → Orchestrator checks gates (budget, role status, etc.)
  → RunCoordinator.executeForTask(taskId, roleId, wakeReason)

Pattern 2: Conversation Response (unified for all types)
  Conversation emits conversation:response-needed(conversationId, roleId)
  → Orchestrator checks gates
  → RunCoordinator.executeForConversation(conversationId, roleId)

Pattern 3: Approval
  Workflow emits task:entered-approval(taskId)
  → Orchestrator pauses scheduling for this task
  → Human confirms in UI
  → Workflow emits task:approval-confirmed(taskId)
  → Orchestrator resumes scheduling
```

---

### 3.8 Layer 3 — Planning

**职责:** 人机多轮对话 → 结构化任务计划 → 批量创建任务。

**Implementation:** 基于 Conversation 底座构建的上层功能。

```
Planning = Conversation(type: 'planning') + PendingPlanStore(Infra) + Workflow.batchCreate
```

**Components:**

| Component | Suffix | Responsibility |
|-----------|--------|---------------|
| `PlanningService` | Service | 发起 planning conversation、管理 pending plan、batch create |

**PendingPlanStore 位于 Infrastructure 层：**

```
MCP Bridge (L1.5) ──write──→ PendingPlanStore (Infrastructure) ←──read── Planning (L3)
```

这避免了 MCP Bridge → Planning 的逆向依赖。MCP Bridge 在 AI 提交计划时写入 PendingPlanStore，PlanningService 读取并管理确认流程。

**Flow:**

```
1. Human → PlanningService.start(orgId, roleId, message)
2. PlanningService → ConversationService.create(type: 'planning', ...)
3. Conversation emits conversation:response-needed
4. Orchestrator → RunCoordinator.executeForConversation(conversationId, roleId)
5. AI 通过 MCP Tool capibara_plan_tasks 提交计划
6. MCP Bridge → PendingPlanStore.store(plan)  [Infrastructure layer]
7. PlanningService 检测到 pending plan → 通知 UI
8. Human 在 UI 确认
9. PlanningService → Workflow.TaskService.batchCreate(tasks)
```

---

### 3.9 Layer 3 — Notification

**职责:** 事件广播到 Renderer + 桌面通知。

**Components:**

| Component | Suffix | Responsibility |
|-----------|--------|---------------|
| `EventBroadcaster` | Broadcaster | 领域事件 → IPC → Renderer |
| `NotificationService` | Service | 桌面系统通知 |
| `EventDigester` | Processor | 事件批处理和聚合（窗口化） |

---

## 4. Removed Features

| Feature | Reason | Replacement |
|---------|--------|-------------|
| **Discussion** (DiscussionGroup, DiscussionMessage, ConsensusDetector, VoteTag) | 过度设计，UI 已无入口，AI 场景下多轮投票共识机制鸡肋 | **Approval** 建模为 Workflow 的一种 status category |
| **Narrative** (NarrativeEngine, EventDigester for narrative) | 价值不足 | 移除 |
| **Review/Consensus System** | Discussion 移除的连带 | **Approval** status |
| **Session** (Session, SessionMessage) | 被 Conversation 模块统一吸收 | `Conversation` (type: planning/adhoc) + `externalSessionId` |

---

## 5. Terminology (Final)

### 5.1 Unified Glossary

| Term | Definition | Module |
|------|-----------|--------|
| **Organization** | 顶层容器，代表一个项目上下文 | Organization |
| **Role** | AI Agent 或人类角色定义（persona + skills + permissions） | Organization |
| **Skill** | 角色能力模板（enriches persona + command） | Organization |
| **Task** | 工作项实例，树状层级结构 | Workflow |
| **ProcessSchema** | 任务类型、状态、流转规则和行为规则的动态定义 | Workflow |
| **BehaviorRule** | TCA（Trigger-Condition-Action）自动化规则 | Workflow |
| **TransitionMode** | 状态转换方式：manual / auto / system | Workflow |
| **BehaviorTrigger** | TCA 规则触发条件（保持不变） | Workflow |
| **Approval** | 需要人工确认的特殊任务状态类别 | Workflow (status category) |
| **Conversation** | 一次完整的对话实例（统一三种类型） | Conversation |
| **ConversationType** | `inquiry` \| `planning` \| `adhoc` | Conversation |
| **ConversationMessage** | 对话中的一条消息 | Conversation |
| **Inquiry** | AI↔AI 结构化 Q&A 对话子类型 | Conversation (type) |
| **Run** | 一次原子 AI 调用记录 | Execution |
| **Tool** | MCP 可调用的系统函数（Claude 回调） | MCP Bridge |
| **WakeReason** | 为什么唤醒一个 Role | Orchestrator |
| **Team** | UI-only 概念：Organization 下所有 Roles 的集合视图 | UI |

### 5.2 Removed Terms

| Removed Term | Replaced By |
|-------------|-------------|
| `Discussion` / `DiscussionGroup` / `DiscussionMessage` | Removed entirely |
| `ConsensusDetector` / `VoteTag` / `ReviewRound` | `Approval` status category |
| `ConversationWorkflow` | `Conversation` (type: inquiry) |
| `WorkflowSchema` / `WorkflowEngine` | `ProcessSchema` / `ProcessEngine` |
| `ExecutionContext` | `RunContext` |
| `WakeTrigger` | `WakeReason` |
| `TransitionTrigger` | `TransitionMode` |
| `TaskNode` | `Task` |
| `Narrative` / `NarrativeEngine` | Removed |
| `Session` / `SessionMessage` | `Conversation` / `ConversationMessage` (+ `externalSessionId`) |
| `TaskRunCoordinator` / `SessionRunCoordinator` | Unified `RunCoordinator` |

### 5.3 Component Suffix Convention

| Suffix | Definition | Criteria |
|--------|-----------|----------|
| **Orchestrator** | Top-level event-driven scheduler | Exactly one; controls the wake/dispatch loop |
| **Coordinator** | Run lifecycle mediator | Bridges Orchestrator → Prompt → Execution |
| **Engine** | Stateless computation core | Pure logic: input → output |
| **Service** | Stateful business operations | CRUD + business rules + repository interaction |
| **Builder** | Data assembly | Aggregates data from multiple sources |
| **Router** | Routing decision maker | Determines "who" receives something |
| **Guard** | Gate check | Validates whether an operation is allowed |
| **Validator** | Rule validation | Checks data or state against rules |
| **Scheduler** | Timing decisions | Determines "when" something should happen |
| **Store** | In-memory transient state | Holds data not persisted to DB |
| **Strategy** | Behavioral variant | Same interface, different implementation per scenario |

---

## 6. Database Schema (Post-Refactoring)

### 6.1 Table Map

| Module | Table | Entity |
|--------|-------|--------|
| Organization | `organizations` | Organization |
| Organization | `roles` | Role |
| Organization | `skills` | Skill |
| Workflow | `tasks` | Task (renamed from task_nodes) |
| Workflow | `process_schemas` | ProcessSchema (renamed from workflow_schemas) |
| Conversation | `conversations` | Conversation (new, replaces conversation_workflows + sessions) |
| Conversation | `conversation_messages` | ConversationMessage (new, replaces discussion_messages + session_messages) |
| Conversation | `conversation_events` | ConversationEvent (audit log) |
| Execution | `runs` | Run |
| Execution | `cost_entries` | CostEntry |
| Orchestrator | `pending_wakes` | PendingWake |
| Infrastructure | `settings` | Setting |

### 6.2 Removed Tables

| Table | Reason |
|-------|--------|
| `discussion_groups` | Discussion removed |
| `discussion_messages` | Replaced by `conversation_messages` |
| `sessions` | Merged into `conversations` |
| `session_messages` | Merged into `conversation_messages` |
| `narratives` | Narrative removed |

### 6.3 Renamed Tables

| Old | New |
|-----|-----|
| `task_nodes` | `tasks` |
| `workflow_schemas` | `process_schemas` |
| `conversation_workflows` | `conversations` |

### 6.4 Column Changes

| Table | Old Column | New Column / Notes |
|-------|-----------|------------|
| all tables with FK | `task_node_id` | `task_id` |
| `runs` | `trigger` | `wake_reason` |
| `runs` | `session_id` | `conversation_id` (new FK → conversations) |
| `pending_wakes` | `trigger` | `reason` |
| `process_schemas` (transitions) | `trigger` | `mode` |
| `conversations` (new) | — | `external_session_id` (for Claude CLI --resume) |

### 6.5 New Table: `conversations`

```sql
CREATE TABLE conversations (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL REFERENCES organizations(id),
  type TEXT NOT NULL CHECK(type IN ('inquiry', 'planning', 'adhoc')),
  state TEXT NOT NULL CHECK(state IN ('active', 'waiting', 'resolved', 'escalated', 'timed_out', 'cancelled', 'completed')),
  initiator_role_id TEXT NOT NULL,
  respondent_role_id TEXT,
  respondent_type TEXT NOT NULL CHECK(respondent_type IN ('ai', 'human')),
  task_id TEXT REFERENCES tasks(id),
  parent_conversation_id TEXT REFERENCES conversations(id),
  depth INTEGER NOT NULL DEFAULT 0,
  priority INTEGER NOT NULL DEFAULT 0,
  timeout_at TEXT,
  external_session_id TEXT,
  metadata TEXT DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
```

### 6.6 New Table: `conversation_messages`

```sql
CREATE TABLE conversation_messages (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES conversations(id),
  author_role_id TEXT,
  author_type TEXT NOT NULL CHECK(author_type IN ('ai', 'human', 'system')),
  content TEXT NOT NULL,
  intent TEXT NOT NULL CHECK(intent IN ('question', 'reply', 'escalation', 'resolution', 'general')),
  in_reply_to_message_id TEXT REFERENCES conversation_messages(id),
  created_at TEXT NOT NULL
);
```

---

## 7. IPC Channel Namespaces (Post-Refactoring)

| Namespace | Description |
|-----------|-------------|
| `capibara:org:*` | Organization CRUD |
| `capibara:role:*` | Role CRUD |
| `capibara:skill:*` | Skill CRUD |
| `capibara:task:*` | Task CRUD + status transitions |
| `capibara:process:*` | ProcessSchema management (renamed from schema:*) |
| `capibara:approval:*` | Approval actions (confirm / reject / list pending) |
| `capibara:conversation:*` | Conversation management (unified: inquiry + planning + adhoc) |
| `capibara:run:*` | Run management |
| `capibara:scheduler:*` | Global scheduling control (renamed from execution:*) |
| `capibara:planning:*` | Planning-specific actions (batch create, pending plan) |
| `capibara:cost:*` | Cost/budget queries |
| `capibara:settings:*` | Settings management |
| `capibara:system:*` | System checks |
| `capibara:template:*` | Template loading |

**Removed Namespaces:**
- `capibara:discussion:*` (Discussion removed)
- `capibara:narrative:*` (Narrative removed)
- `capibara:session:*` (Merged into conversation:*)
- `capibara:budget:*` (Merged into cost:*)

---

## 8. DI Token Map (Post-Refactoring)

```
// Infrastructure
CONFIG_TOKEN
LOGGER_TOKEN
SQLITE_CONNECTION_TOKEN
EVENT_BUS_TOKEN
PENDING_PLAN_STORE_TOKEN            // Infrastructure — shared between MCP Bridge and Planning

// Organization Module
ORGANIZATION_REPO_TOKEN
ROLE_REPO_TOKEN
SKILL_REPO_TOKEN

// Workflow Module
TASK_REPO_TOKEN
TASK_SERVICE_TOKEN
TASK_STATE_MACHINE_TOKEN
PROCESS_ENGINE_TOKEN
BEHAVIOR_ENGINE_TOKEN
PROCESS_SCHEMA_REPO_TOKEN
PROCESS_TEMPLATE_SERVICE_TOKEN

// Conversation Module
CONVERSATION_REPO_TOKEN
CONVERSATION_MESSAGE_REPO_TOKEN
CONVERSATION_SERVICE_TOKEN
INQUIRY_ROUTER_TOKEN
INQUIRY_ESCALATION_SERVICE_TOKEN
CONVERSATION_CONTEXT_BUILDER_TOKEN

// Execution (Runtime)
RUN_ENGINE_TOKEN
EXECUTOR_TOKEN
WORKER_SERVICE_TOKEN
RUN_REPO_TOKEN
COST_ENTRY_REPO_TOKEN

// Prompt (Integration)
PROMPT_BUILDER_TOKEN
RUN_CONTEXT_TOKEN

// MCP Bridge (Integration)
MCP_IPC_SERVER_TOKEN
MCP_TOOL_REGISTRY_TOKEN

// Orchestrator & RunCoordinator
ORCHESTRATOR_TOKEN
RUN_COORDINATOR_TOKEN
PENDING_WAKE_REPO_TOKEN

// Planning
PLANNING_SERVICE_TOKEN

// Notification
NOTIFICATION_SERVICE_TOKEN
EVENT_BROADCASTER_TOKEN
EVENT_DIGESTER_TOKEN

// System
SETTINGS_REPO_TOKEN
SYSTEM_CHECK_SERVICE_TOKEN
```

---

## 9. Directory Structure (Post-Refactoring)

```
apps/electron/
├── src/
│   ├── main/                            # ← LEGACY (preserved, do not modify)
│   │   ├── index.ts
│   │   ├── composition-root.ts
│   │   ├── application/
│   │   ├── core/
│   │   └── infrastructure/
│   │
│   ├── core/                            # ← NEW (all rewrite code goes here)
│   │   ├── index.ts                     # Electron entry point (new)
│   │   ├── bootstrap/
│   │   │   ├── composition-root.ts      # Orchestrates module registrations
│   │   │   ├── workflow.module.ts
│   │   │   ├── organization.module.ts
│   │   │   ├── conversation.module.ts
│   │   │   ├── execution.module.ts
│   │   │   ├── prompt.module.ts
│   │   │   ├── mcp.module.ts
│   │   │   ├── orchestrator.module.ts
│   │   │   ├── planning.module.ts
│   │   │   └── notification.module.ts
│   │   │
│   │   ├── foundation/
│   │   │   ├── tokens.ts               # All DI tokens
│   │   │   ├── events.ts               # All DomainEventType definitions
│   │   │   └── errors/
│   │   │
│   │   ├── modules/
│   │   │   ├── workflow/
│   │   │   │   ├── types/              # Task, ProcessSchema, BehaviorRule, TransitionMode
│   │   │   │   ├── interfaces/         # ITaskRepository, IProcessSchemaRepository
│   │   │   │   ├── services/           # TaskService, ProcessTemplateService
│   │   │   │   ├── engines/            # ProcessEngine, TaskStateMachine, BehaviorEngine
│   │   │   │   └── persistence/        # SqliteTaskRepository, SqliteProcessSchemaRepository
│   │   │   │
│   │   │   ├── organization/
│   │   │   │   ├── types/              # Organization, Role, Skill
│   │   │   │   ├── interfaces/
│   │   │   │   ├── services/           # OrganizationService, RoleService, SkillService, OrgTemplateService
│   │   │   │   └── persistence/
│   │   │   │
│   │   │   ├── conversation/
│   │   │   │   ├── types/              # Conversation, ConversationMessage, ConversationType, ConversationState
│   │   │   │   ├── interfaces/
│   │   │   │   ├── services/           # ConversationService, InquiryEscalationService
│   │   │   │   ├── routing/            # InquiryRouter
│   │   │   │   ├── context/            # ConversationContextBuilder
│   │   │   │   └── persistence/
│   │   │   │
│   │   │   ├── execution/
│   │   │   │   ├── types/              # Run, RunStatus, CostEntry
│   │   │   │   ├── interfaces/
│   │   │   │   ├── engines/            # RunEngine
│   │   │   │   ├── workers/            # WorkerService, Worker
│   │   │   │   ├── logging/            # FileLogService
│   │   │   │   └── persistence/
│   │   │   │
│   │   │   ├── prompt/
│   │   │   │   ├── types/              # PromptContext
│   │   │   │   ├── context/            # RunContext
│   │   │   │   ├── builder/            # PromptBuilder
│   │   │   │   └── strategies/         # TaskPromptStrategy, ConversationPromptStrategy
│   │   │   │
│   │   │   ├── mcp/
│   │   │   │   ├── server/             # McpIpcServer
│   │   │   │   ├── registry/           # McpToolRegistry
│   │   │   │   └── handlers/           # task-tools, conversation-tools, planning-tools, context-tools
│   │   │   │
│   │   │   ├── orchestrator/
│   │   │   │   ├── orchestrator.ts
│   │   │   │   ├── run.coordinator.ts
│   │   │   │   ├── wake-gate.validator.ts
│   │   │   │   ├── retry.scheduler.ts
│   │   │   │   └── budget.guard.ts
│   │   │   │
│   │   │   ├── planning/
│   │   │   │   └── planning.service.ts
│   │   │   │
│   │   │   └── notification/
│   │   │       ├── event-broadcaster.ts
│   │   │       ├── notification.service.ts
│   │   │       └── event-digester.ts
│   │   │
│   │   ├── ipc-handlers/
│   │   │   ├── workflow.handlers.ts    # task + process + approval
│   │   │   ├── organization.handlers.ts # org + role + skill + template
│   │   │   ├── conversation.handlers.ts # conversation (all types)
│   │   │   ├── execution.handlers.ts   # run + scheduler
│   │   │   ├── planning.handlers.ts
│   │   │   └── system.handlers.ts      # settings + system checks
│   │   │
│   │   ├── infrastructure/
│   │   │   ├── persistence/sqlite/     # SqliteConnection, migrations
│   │   │   ├── observability/          # PinoLogger, EmitteryEventBus
│   │   │   ├── stores/                 # PendingPlanStore
│   │   │   └── adapters/               # ClaudeLocalAdapter, StreamJsonParser
│   │   │
│   │   ├── config/
│   │   └── preload/
│   │
│   ├── shared/                          # Shared contracts & locale (rewritten)
│   │   ├── contracts.ts
│   │   └── locale/
│   └── renderer/                        # React app (rewritten in Phase 12)
├── tests/
├── resources/
└── package.json
```

**Naming note:** `src/core/foundation/` holds cross-cutting definitions (tokens, events, errors) — named `foundation` to avoid confusion with the legacy `src/main/core/` directory.

---

## 10. Implementation Phases

```
Phase 0 — Preparation
  ├── Write migration plan for DB schema changes
  ├── Set up test coverage baseline
  └── Create branch strategy (feature branches per phase)

Phase 1 — Extract & Rename (foundation work)
  ├── Rename TaskNode → Task (types + DB + params)
  ├── Rename WorkflowSchema → ProcessSchema (types + DB + tokens)
  ├── Rename WakeTrigger → WakeReason, TransitionTrigger → TransitionMode
  ├── Rename ExecutionContext → RunContext
  ├── Rename execution IPC channels → scheduler
  ├── Add Run.conversationId field
  └── Split composition-root.ts into module files

Phase 2 — Build Conversation Module (new unified module)
  ├── Design Conversation + ConversationMessage entities (with externalSessionId)
  ├── Create conversations + conversation_messages tables
  ├── Implement ConversationService (unified state machine)
  ├── Implement conversation:response-needed unified event
  ├── Migrate Inquiry logic from old ConversationWorkflow
  ├── Migrate Session logic into Conversation (type: planning/adhoc)
  └── Update Prompt strategies for new Conversation model

Phase 3 — Remove Discussion & Build Approval
  ├── Remove DiscussionGroup, DiscussionMessage, ConsensusDetector
  ├── Remove discussion tables
  ├── Add 'approval' status category to ProcessSchema
  ├── Implement approval flow in TaskStateMachine
  ├── Wire Orchestrator to pause/resume on approval events
  └── Update UI: remove Discussion page, add Approval UI

Phase 4 — Restructure Orchestrator & RunCoordinator
  ├── Unify TaskRunCoordinator + SessionRunCoordinator → RunCoordinator
  ├── Refactor Orchestrator to delegate to RunCoordinator
  ├── Move PendingPlanStore to Infrastructure layer
  ├── Update MCP Bridge to write to PendingPlanStore via Infrastructure
  └── Update PlanningService to read from PendingPlanStore

Phase 5 — Restructure Directory Layout
  ├── Move files into modules/ structure
  ├── Update all imports
  ├── Split MCP handlers by domain
  ├── Group IPC handlers by module
  └── Verify all tests pass

Phase 6 — Cleanup & Polish
  ├── Remove dead code (Session, Discussion, Narrative, etc.)
  ├── Update IPC channel names
  ├── Update DI tokens
  ├── Final DB migration consolidation
  └── Write glossary into project docs
```

---

## Appendix A: Design Decisions Log

| # | Decision | Rationale |
|---|----------|-----------|
| D1 | Prompt, MCP Bridge 从 Layer 0 上移到 Layer 1.5 | 两者都依赖 Layer 1 底座数据，Layer 0 应仅包含无业务依赖的 Execution |
| D2 | Conversation → Organization 允许单向只读依赖 | InquiryRouter 需要查询 Role 层级和能力做路由；DDD 中 bounded context 间的单向查询是常见且合理的 |
| D3 | PendingPlanStore 下沉到 Infrastructure | 解决 MCP Bridge (L1.5) → Planning (L3) 的逆向依赖；两者通过共享 Infrastructure 存储解耦 |
| D4 | Conversation 加 externalSessionId 字段 | Session 合并入 Conversation 后，保留 Claude CLI `--resume` 多轮对话能力 |
| D5 | 保留统一的 RunCoordinator 在 Layer 2 | 避免 Orchestrator 膨胀为 god object；RunCoordinator 封装 Run 生命周期细节 |
| D6 | Run 加 conversationId 字段 | 建立 Run ↔ Conversation 关联，替代原 Run.sessionId |
| D7 | 统一 conversation:response-needed 事件 | Inquiry/Planning/Adhoc 三种类型共用一个触发事件，Orchestrator 统一监听 |

---

*End of Plan — v2.0*
