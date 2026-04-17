# Capibara Terminology Rename Proposal

> **Version**: 1.0  
> **Date**: 2026-04-17  
> **Status**: Draft — Pending Review

---

## Proposal Overview

本方案将 10 个术语歧义领域分为三个优先级：

| Priority | Category | Reason |
|----------|----------|--------|
| **P0 — Must Fix** | 语义冲突、已造成理解障碍 | 不修会持续导致新代码写错 |
| **P1 — Should Fix** | 不一致但可推断 | 影响可读性，重构时顺便修 |
| **P2 — Nice to Have** | 命名风格偏好 | 影响小，可后续优化 |

---

## P0 — Must Fix

### 1. "Workflow" 语义分裂 → 拆分为两个不同的词

**Current Problem:**  
`WorkflowSchema` = 任务生命周期定义（抽象的 schema）  
`ConversationWorkflow` = 角色间 Q&A 实例（具体的运行时对象）  
两个完全不同的领域共享 "Workflow" 一词，造成严重歧义。

**Proposal:**

| Current | Proposed | Rationale |
|---------|----------|-----------|
| `WorkflowSchema` | **`ProcessSchema`** | "Process" 表达"流程定义"，与 "Workflow" 脱钩 |
| `WorkflowEngine` | **`ProcessEngine`** | 对应 ProcessSchema 的运行时引擎 |
| `WorkflowTemplateService` | **`ProcessTemplateService`** | 加载流程模板 |
| `workflow_schemas` (DB) | **`process_schemas`** | DB table rename |
| `WORKFLOW_ENGINE_TOKEN` | **`PROCESS_ENGINE_TOKEN`** | DI token |
| `WORKFLOW_SCHEMA_REPO_TOKEN` | **`PROCESS_SCHEMA_REPO_TOKEN`** | DI token |
| `capibara:schema:*` (IPC) | **`capibara:process:*`** | IPC channel namespace |
| `ConversationWorkflow` | **`Inquiry`** | 见下方 #2 |

**Impact:**  
- WorkflowSchema: 20 files  
- WorkflowEngine: 23 files  
- ConversationWorkflow: 23 files  

---

### 2. Discussion / Conversation / Review / Approval → 明确边界

**Current Problem:**  
四个词描述交叉关联的概念，且 `ConversationWorkflow` 的消息实际存储在 `DiscussionMessage` 表中，进一步模糊边界。

**Proposal — 确立四层语义模型：**

```
Review（评审）= 整个流程概念
  └── Discussion（讨论）= 评审中的消息论坛
        ├── DiscussionMessage（投票/评论/...）
        └── Inquiry（质询）= 角色间结构化 Q&A（原 ConversationWorkflow）

Approval（审批）= 需要人工签字的特殊 Review 分支
```

**Rename Map:**

| Current | Proposed | Rationale |
|---------|----------|-----------|
| `ConversationWorkflow` | **`Inquiry`** | "质询" — 一个 Role 向另一个 Role 发起的结构化问答；短、清晰、不与 Discussion/Conversation 混淆 |
| `ConversationWorkflowService` | **`InquiryService`** | |
| `ConversationWorkflowState` | **`InquiryState`** | |
| `ConversationWorkflowRecord` | **`InquiryRecord`** | |
| `ConversationContextBuilder` | **`InquiryContextBuilder`** | |
| `conversation_workflows` (DB) | **`inquiries`** | |
| `conversation_events` (DB) | **`inquiry_events`** | |
| `ConversationEventLogger` | **`InquiryEventLogger`** | |
| `RoutingPolicyEngine` | **`InquiryRouter`** | 更直白：它负责路由 Inquiry 给谁 |
| `TimeoutEscalationService` | **`InquiryEscalationService`** | 明确它只处理 Inquiry 的超时升级 |
| `capibara:conversation:*` (IPC) | **`capibara:inquiry:*`** | IPC channel namespace |
| UI: `ConversationPage` | **`InquiryPage`** 或 **`InboxPage`** | 取决于 UI 设计方向 |
| `DiscussionGroup` | **Keep** | 不变 — "讨论组"语义清晰 |
| `DiscussionMessage` | **Keep** | 不变 — 消息实体同时承载讨论和质询内容 |
| `DiscussionService` | **Keep** | 不变 |
| `capibara:discussion:*` (IPC) | **Keep** | 不变 |
| `capibara:approval:*` (IPC) | **Keep** | 不变 — Approval 是独立的审批概念 |

**Keep 原因：**  
- `Discussion` 本身语义是准确的（基于 TaskNode 的消息论坛）
- `Approval` 本身也是独立概念（人工审批节点）
- 只有 `Conversation` 一词过于宽泛，需要替换为更精确的 `Inquiry`

**DiscussionMessage 共享存储的处理：**  
Inquiry 的问答消息继续存储在 `discussion_messages` 表中（通过 `DiscussionGroup` 关联），这在数据模型上是合理的 — Inquiry 是 Discussion 内部的一种结构化子流程。重命名不影响存储结构。

---

### 3. "Trigger" 一词三义 → 区分为三个不同的词

**Current Problem:**  

| Current | Context | Meaning |
|---------|---------|---------|
| `WakeTrigger` | 角色激活 | **为什么**唤醒一个 Role |
| `TransitionTrigger` | 状态流转 | **怎样**发生状态转换 |
| `BehaviorTrigger` | 行为规则 | **什么时候**触发行为规则 |

三个完全不同的语义共享 "Trigger"。

**Proposal:**

| Current | Proposed | Rationale |
|---------|----------|-----------|
| `WakeTrigger` | **`WakeReason`** | 它表达的是"原因"，不是"触发器" |
| `TransitionTrigger` | **`TransitionMode`** | `manual / auto / system` 描述的是"方式"，不是"触发" |
| `BehaviorTrigger` | **Keep `BehaviorTrigger`** | 在 TCA (Trigger-Condition-Action) 模型中 "Trigger" 是标准术语 |

**Cascade Changes:**

| Current | Proposed |
|---------|----------|
| `WakeTrigger` type | `WakeReason` |
| `Run.trigger` field | `Run.wakeReason` |
| `PendingWake.trigger` field | `PendingWake.reason` |
| `startRunSchema.trigger` | `startRunSchema.wakeReason` |
| `WakeTarget.trigger` | `WakeTarget.reason` |
| DB column `runs.trigger` | `runs.wake_reason` |
| DB column `pending_wakes.trigger` | `pending_wakes.reason` |
| `TransitionTrigger` type | `TransitionMode` |
| `TransitionDefinition.trigger` | `TransitionDefinition.mode` |

---

## P1 — Should Fix

### 4. TaskNode / Task 内外分裂 → 统一为 Task

**Current Problem:**  
内部用 `TaskNode`（26 files PascalCase + 40 files camelCase），外部 API/UI 全用 `Task`。参数命名混用 `taskNodeId` 和 `taskId`。

**Proposal: 统一为 `Task`**

| Current | Proposed | Rationale |
|---------|----------|-----------|
| `interface TaskNode` | **`interface Task`** | 树结构由 `parentId` + `depth` 字段隐含，不需要名字来体现 |
| `task_nodes` (DB) | **`tasks`** | |
| `task_node_id` (DB FK) | **`task_id`** | |
| `taskNodeId` (params) | **`taskId`** | 统一参数命名 |
| `TaskRecord` (contract) | **Keep `TaskRecord`** | 已经是对的 |
| `ITaskRepository` | **Keep** | 已经是对的 |
| `TASK_REPO_TOKEN` | **Keep** | 已经是对的 |

**NOTE:** 大部分外部代码（IPC channel, API, UI, Service, Repository interface, DI token）已经使用 `Task`。只需要改 domain type 定义和 DB schema。

**Impact:** 主要是 `domain.types.ts` 的 interface 名 + `migrations.ts` 的表名 + 散布在各文件的 `taskNodeId` → `taskId`。

---

### 5. "Execution" 过载 → 拆分用途

**Current Problem:**  
"Execution" 同时表示：
1. 全局调度控制（`pauseExecution / resumeExecution`）
2. 目录名（`application/execution/`）
3. 上下文对象（`ExecutionContext`）
4. MCP context label（`task:execution`）

**Proposal:**

| Current | Proposed | Rationale |
|---------|----------|-----------|
| `pauseExecution` / `resumeExecution` | **`pauseScheduler`** / **`resumeScheduler`** | 暂停的是调度器（Orchestrator），不是单个执行 |
| `getExecutionState` | **`getSchedulerState`** | |
| `capibara:execution:*` (IPC) | **`capibara:scheduler:*`** | |
| `ExecutionStateRecord` | **`SchedulerStateRecord`** | |
| `DesktopEvent: 'execution:paused'` | **`'scheduler:paused'`** | |
| `DesktopEvent: 'execution:resumed'` | **`'scheduler:resumed'`** | |
| `ExecutionContext` | **`RunContext`** | 它为一次 Run 准备上下文数据 |
| `application/execution/` directory | **`application/run/`** | 包含 RunEngine + TaskRunCoordinator |
| `McpExecutionContext` | **`McpRunMode`** | `'task:run' \| 'session:planning' \| 'session:adhoc'` |

---

### 6. Component Suffix Convention → 建立命名规则

**Current Problem:**  
Engine / Service / Coordinator / Orchestrator 四种后缀无系统化规则。

**Proposal — 确立后缀规范：**

| Suffix | Definition | Criteria | Examples |
|--------|-----------|----------|----------|
| **Orchestrator** | Top-level event-driven scheduler | Controls the wake/dispatch loop across multiple entities; exactly one per bounded context | `OrgOrchestrator` |
| **Coordinator** | Lifecycle mediator | Bridges Orchestrator ↔ Engine for one entity's full lifecycle (preparation → execution → post-processing) | `TaskRunCoordinator`, `SessionRunCoordinator` |
| **Engine** | Stateless computation core | Pure logic: input → output, no side effects to DB, no lifecycle management | `RunEngine`, `ProcessEngine`, `BehaviorEngine`, `NarrativeEngine` |
| **Service** | Stateful business operations | CRUD + business rules + repository interaction; the standard "application service" | `TaskService`, `DiscussionService`, `SessionService`, `InquiryService` |
| **Builder** | Data assembly | Aggregates data from multiple sources into a structured output | `PromptBuilder`, `InquiryContextBuilder` |
| **Store** | In-memory state | Holds transient state not persisted to DB | `PendingPlanStore` |

**Rename based on convention:**

| Current | Proposed | Reason |
|---------|----------|--------|
| `RoutingPolicyEngine` | **`InquiryRouter`** | 不是 stateless computation；是 routing decision service。但 "Router" 比 "Service" 更精确 |
| `ConsensusDetector` | **Keep** | "Detector" 是合适的 — 检测共识状态 |
| `NarrativeEngine` | **Keep** | Stateless text generation — 符合 Engine 定义 |
| `WorkerService` | **Keep** | Infrastructure service — 管理 worker pool |

---

### 7. Role vs Team → 统一 UI 概念

**Current Problem:**  
后端统一用 `Role`，但 UI 导航显示 "Team"。

**Proposal:**

| Option | Description | Recommendation |
|--------|-------------|----------------|
| A: UI rename to "Roles" | 导航标签改为 "Roles" | **Not recommended** — "Roles" 对用户太抽象 |
| B: Keep "Team" in UI | 保持 "Team" 作为 UI 概念 | **Recommended** — "Team" 是用户友好的集合名词 |
| C: Backend rename to "Agent" | 将 `Role` 改为 `Agent` | **Not recommended** — 改动范围太大，且 Role 在权限模型中更精确 |

**Decision: Keep current split, but document it.**

- **`Role`** = Backend domain entity（角色定义：persona + skills + permissions）
- **"Team"** = UI-only concept（"Team" 页面展示 Organization 下所有 Roles 的集合视图）
- 不需要代码改动，但需要在 glossary 中明确记录这个映射关系

---

## P2 — Nice to Have

### 8. Organization / Org / Workspace → 规范化

**Current State:**
- Full name `Organization` → types, interfaces
- Abbreviation `org` → IPC channels, DB columns, variable prefix
- `Workspace` → `Organization.workspacePath` + UI `WorkspacePage`

**Proposal:**

| Rule | Example |
|------|---------|
| Type/interface/class name: **Always `Organization`** (full) | `interface Organization`, `OrganizationRecord` |
| IPC channel / DB column / variable prefix: **Always `org`** (abbreviated) | `capibara:org:*`, `org_id`, `orgId` |
| **Workspace = Organization 的设置/配置页面** | UI label: "Workspace Settings" 或改为 "Organization Settings" |

**Optional UI Rename:**

| Current | Proposed | Rationale |
|---------|----------|-----------|
| `WorkspacePage` | **`OrgSettingsPage`** | 更明确：这是 Organization 的设置/配置页 |
| Navigation `workspace` | **`org-settings`** | 区别于 "workspacePath"（文件系统路径） |

---

### 9. Skill / Tool / Command → 保持区分，补充文档

**Analysis Result:** 这三个词在代码中已经有明确的不同含义：

| Term | Meaning | Storage | Visibility |
|------|---------|---------|------------|
| **Skill** | 角色能力模板（persona enrichment） | DB `skills` table, assigned via `Role.skillIds` | UI: "Skills & Knowledge" page |
| **Tool** | MCP 系统函数（Claude 可调用） | Code only, registered in `McpToolRegistry` | AI: prompt "Available Tools" section |
| **Command** | Skill 的可执行命令字符串 | `Skill.command` field | AI: prompt "Available Skills" section |

**Decision: No rename needed.** 只需在 glossary 中正式记录这个三层区分。

---

### 10. Domain Type vs Contract Record 重复声明 → 标记为后续重构项

**Current Problem:**  
`domain.types.ts` 和 `contracts.ts` 各自维护一套几乎相同的类型定义和 type alias（如 `OrgStatus`, `RunStatus`, `WakeTrigger` 都声明了两次）。

**Proposal:**  
此问题属于代码架构层面，超出术语命名范围。标记为后续重构项：
- 考虑让 contracts.ts 的 Record 类型直接引用或继承自 domain types
- 或建立一个 shared schema layer 作为 single source of truth

---

## Rename Summary Table

### All Changes at a Glance

| # | Priority | Current | Proposed | Scope (Files) |
|---|----------|---------|----------|---------------|
| 1 | P0 | `WorkflowSchema` | `ProcessSchema` | ~20 |
| 2 | P0 | `WorkflowEngine` | `ProcessEngine` | ~23 |
| 3 | P0 | `WorkflowTemplateService` | `ProcessTemplateService` | ~5 |
| 4 | P0 | `ConversationWorkflow` | `Inquiry` | ~23 |
| 5 | P0 | `ConversationWorkflowService` | `InquiryService` | ~5 |
| 6 | P0 | `ConversationWorkflowState` | `InquiryState` | ~8 |
| 7 | P0 | `RoutingPolicyEngine` | `InquiryRouter` | ~5 |
| 8 | P0 | `TimeoutEscalationService` | `InquiryEscalationService` | ~5 |
| 9 | P0 | `ConversationContextBuilder` | `InquiryContextBuilder` | ~4 |
| 10 | P0 | `ConversationEventLogger` | `InquiryEventLogger` | ~5 |
| 11 | P0 | `WakeTrigger` | `WakeReason` | ~15 |
| 12 | P0 | `TransitionTrigger` | `TransitionMode` | ~8 |
| 13 | P1 | `TaskNode` (interface) | `Task` | ~26 |
| 14 | P1 | `task_nodes` (DB) | `tasks` | ~6 |
| 15 | P1 | `taskNodeId` (params) | `taskId` | ~40 |
| 16 | P1 | `ExecutionContext` | `RunContext` | ~8 |
| 17 | P1 | `pauseExecution` | `pauseScheduler` | ~3 |
| 18 | P1 | `capibara:execution:*` | `capibara:scheduler:*` | ~3 |
| 19 | P1 | `application/execution/` | `application/run/` | Directory |
| 20 | P2 | `WorkspacePage` | `OrgSettingsPage` | ~2 |

### IPC Channel Namespace Changes

| Current | Proposed |
|---------|----------|
| `capibara:schema:*` | `capibara:process:*` |
| `capibara:conversation:*` | `capibara:inquiry:*` |
| `capibara:execution:*` | `capibara:scheduler:*` |

### DB Table Changes

| Current | Proposed |
|---------|----------|
| `workflow_schemas` | `process_schemas` |
| `conversation_workflows` | `inquiries` |
| `conversation_events` | `inquiry_events` |
| `task_nodes` | `tasks` |
| Column: `task_node_id` (all tables) | `task_id` |
| Column: `runs.trigger` | `runs.wake_reason` |
| Column: `pending_wakes.trigger` | `pending_wakes.reason` |

### DI Token Changes

| Current | Proposed |
|---------|----------|
| `WORKFLOW_ENGINE_TOKEN` | `PROCESS_ENGINE_TOKEN` |
| `WORKFLOW_SCHEMA_REPO_TOKEN` | `PROCESS_SCHEMA_REPO_TOKEN` |
| `CONVERSATION_WORKFLOW_REPO_TOKEN` | `INQUIRY_REPO_TOKEN` |
| `CONVERSATION_WORKFLOW_SERVICE_TOKEN` | `INQUIRY_SERVICE_TOKEN` |
| `ROUTING_POLICY_ENGINE_TOKEN` | `INQUIRY_ROUTER_TOKEN` |
| `CONVERSATION_CONTEXT_BUILDER_TOKEN` | `INQUIRY_CONTEXT_BUILDER_TOKEN` |
| `TIMEOUT_ESCALATION_SERVICE_TOKEN` | `INQUIRY_ESCALATION_SERVICE_TOKEN` |

---

## Terms NOT Changed (with rationale)

| Term | Reason for Keeping |
|------|-------------------|
| `Role` | 准确描述"角色定义"；UI "Team" 仅为用户友好的集合名词 |
| `Run` | 清晰表达"单次 AI 调用"，无歧义 |
| `Session` | 清晰表达"多轮对话容器"，与 Run 边界明确 |
| `Discussion` / `DiscussionGroup` / `DiscussionMessage` | 语义准确，使用一致 |
| `Approval` | 独立的审批概念，不与 Discussion 混淆 |
| `Skill` / `Tool` / `Command` | 三者在代码中已有清晰区分，只需文档化 |
| `Organization` / `org` | Full name for types, abbreviation for channels/columns — 已是常见 convention |
| `BehaviorTrigger` | TCA 模型标准术语 |
| `ConsensusDetector` | "Detector" 后缀准确 |
| `NarrativeEngine` | 符合 Engine = stateless computation 定义 |
| `OrgOrchestrator` | 符合 Orchestrator = top-level scheduler 定义 |
| `TaskRunCoordinator` / `SessionRunCoordinator` | 符合 Coordinator 定义 |
| `PromptBuilder` | 符合 Builder 定义 |
| `PendingPlanStore` | 符合 Store 定义 |

---

## Unified Glossary (Post-Rename)

After all renames are applied, the system glossary should be:

| Term | Definition | Layer |
|------|-----------|-------|
| **Organization** | Top-level container for all project entities | Domain |
| **Role** | AI Agent or human team member position with persona and permissions | Domain |
| **Task** | A work item in a hierarchical tree (epic → story → task → subtask) | Domain |
| **Run** | A single, atomic AI invocation (one prompt → one response) | Domain |
| **Session** | A stateful multi-turn conversation container (planning or adhoc) | Domain |
| **Discussion** | A peer review forum attached to a Task; contains messages and votes | Domain |
| **DiscussionMessage** | A message within a Discussion (comment, vote, question, or reply) | Domain |
| **Inquiry** | A structured Q&A workflow between two Roles, initiated during a Run | Domain |
| **ProcessSchema** | Dynamic definition of task types, statuses, transitions, and behavior rules | Domain |
| **Skill** | A capability template assigned to Roles; enriches persona and prompt | Domain |
| **Tool** | An MCP-callable system function available to Claude during execution | Infrastructure |
| **WakeReason** | Why a Role should be activated (e.g., task_assigned, review_approve) | Domain |
| **TransitionMode** | How a status transition occurs (manual, auto, system) | Domain |
| **BehaviorTrigger** | When a TCA behavior rule fires (on_status_enter, on_task_created, ...) | Domain |
| **Approval** | Human sign-off required before a Task can proceed | Domain |
| **Narrative** | Auto-generated progress summary from domain events | Domain |
| **Team** | UI-only concept: the collection view of all Roles in an Organization | UI |
| **Workspace** | The filesystem directory path associated with an Organization | Config |

---

## Implementation Order Suggestion

```
Phase 1 (P0 — Semantic Conflicts):
  1. Rename ConversationWorkflow → Inquiry (all related types, services, DB)
  2. Rename WorkflowSchema/Engine → ProcessSchema/Engine
  3. Rename WakeTrigger → WakeReason, TransitionTrigger → TransitionMode

Phase 2 (P1 — Inconsistencies):
  4. Unify TaskNode → Task
  5. Rename Execution overloads (ExecutionContext → RunContext, etc.)
  6. Apply component suffix convention (RoutingPolicyEngine → InquiryRouter already done in Phase 1)

Phase 3 (P2 — Polish):
  7. Workspace UI rename
  8. Write glossary into project documentation
  9. Address Domain/Contract type duplication (architecture refactor)
```

**Migration Strategy for DB:**  
Each phase should include a DB migration that renames tables/columns. SQLite supports `ALTER TABLE ... RENAME TO` and `ALTER TABLE ... RENAME COLUMN` (SQLite 3.25+). Test migration on a copy of production DB before applying.

---

*End of Proposal*
