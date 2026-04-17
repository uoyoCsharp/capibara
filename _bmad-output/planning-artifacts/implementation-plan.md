# Capibara Implementation Plan

> **Date**: 2026-04-17  
> **Prerequisite**: [Refactoring Architecture Plan v2.0](./refactoring-architecture-plan.md)  
> **Assumption**: Greenfield rewrite — no migration, no backwards compatibility.  
> **Code Location**: All new code under `apps/electron/src/core/`. Legacy `src/main/` is preserved untouched.

---

## Build Order Rationale

依赖关系决定了构建顺序 — 每个 Phase 只依赖已完成的 Phase：

```
Phase 1: Infrastructure          (无依赖)
Phase 2: Execution (Layer 0)     (依赖 Infrastructure)
Phase 3: Organization (Layer 1)  (依赖 Infrastructure)
Phase 4: Workflow (Layer 1)      (依赖 Infrastructure)
Phase 5: Conversation (Layer 1)  (依赖 Infrastructure + Organization[只读])
Phase 6: Prompt (Layer 1.5)      (依赖 三底座)
Phase 7: MCP Bridge (Layer 1.5)  (依赖 三底座 + Infrastructure.PendingPlanStore)
Phase 8: Orchestrator (Layer 2)  (依赖 三底座 + Prompt + Execution)
Phase 9: Planning (Layer 3)      (依赖 Conversation + Workflow + Infrastructure.PendingPlanStore)
Phase 10: Notification (Layer 3) (依赖 EventBus)
Phase 11: IPC + Electron Shell   (依赖 全部模块)
Phase 12: UI                     (依赖 IPC)
```

Phase 3/4 无依赖关系，可并行开发。

---

## Phase 1 — Infrastructure

**Goal:** 搭建项目骨架和所有模块共享的基础设施。

### 1.1 Project Scaffold

All new code lives under `apps/electron/src/core/`. The legacy `src/main/` directory is preserved as-is for reference during development and will be removed after the rewrite is complete.

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
│   │   │   ├── composition-root.ts      # DI container setup
│   │   │   ├── workflow.module.ts
│   │   │   ├── organization.module.ts
│   │   │   ├── conversation.module.ts
│   │   │   ├── execution.module.ts
│   │   │   ├── prompt.module.ts
│   │   │   ├── mcp.module.ts
│   │   │   ├── orchestrator.module.ts
│   │   │   ├── planning.module.ts
│   │   │   └── notification.module.ts
│   │   ├── foundation/
│   │   │   ├── tokens.ts               # All DI token symbols
│   │   │   ├── events.ts               # DomainEventType definitions
│   │   │   └── errors/
│   │   ├── modules/
│   │   │   ├── workflow/
│   │   │   ├── organization/
│   │   │   ├── conversation/
│   │   │   ├── execution/
│   │   │   ├── prompt/
│   │   │   ├── mcp/
│   │   │   ├── orchestrator/
│   │   │   ├── planning/
│   │   │   └── notification/
│   │   ├── ipc-handlers/
│   │   ├── infrastructure/
│   │   │   ├── persistence/sqlite/
│   │   │   ├── observability/
│   │   │   ├── stores/
│   │   │   └── adapters/
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

### 1.2 Persistence

| Deliverable | Description |
|-------------|-------------|
| `SqliteConnection` | better-sqlite3 连接封装 |
| `migrations.ts` | 全量 schema DDL（全部表一次性创建，无增量迁移） |
| DB tables | `organizations`, `roles`, `skills`, `tasks`, `process_schemas`, `conversations`, `conversation_messages`, `conversation_events`, `runs`, `cost_entries`, `pending_wakes`, `settings` |

**Full Schema DDL:**

```sql
-- Organization Module
CREATE TABLE organizations (...);
CREATE TABLE roles (...);
CREATE TABLE skills (...);

-- Workflow Module
CREATE TABLE tasks (...);
CREATE TABLE process_schemas (...);

-- Conversation Module
CREATE TABLE conversations (...);
CREATE TABLE conversation_messages (...);
CREATE TABLE conversation_events (...);

-- Execution Module
CREATE TABLE runs (...);
CREATE TABLE cost_entries (...);

-- Orchestrator
CREATE TABLE pending_wakes (...);

-- Infrastructure
CREATE TABLE settings (...);
```

### 1.3 Observability

| Deliverable | Description |
|-------------|-------------|
| `ILogger` interface + `PinoLogger` | Structured JSON logging |
| `IEventBus` interface + `EmitteryEventBus` | Domain event pub/sub |
| `DomainEventType` | 所有事件类型枚举定义 |

### 1.4 Config

| Deliverable | Description |
|-------------|-------------|
| `CapibaraConfig` type | Config schema definition |
| `config.schema.ts` | Zod validation |
| `config.defaults.ts` | Default values |
| `config.loader.ts` | Multi-source loading (global + project) |

### 1.5 Shared Stores

| Deliverable | Description |
|-------------|-------------|
| `PendingPlanStore` | In-memory plan cache（位于 `src/core/infrastructure/stores/`） |

### 1.6 Foundation Types & Tokens

| Deliverable | Description |
|-------------|-------------|
| `src/core/foundation/tokens.ts` | 全部 DI token symbol 定义 |
| `src/core/foundation/events.ts` | `DomainEventType` 完整枚举 |
| `src/core/foundation/errors/` | `BudgetExceededError`, `ExecutionError` 等 |

### Acceptance Criteria

- [ ] `pnpm build` 编译通过
- [ ] SQLite 数据库可创建并通过 schema 验证
- [ ] Logger 可输出到 file 和 console
- [ ] EventBus 可 emit/subscribe 事件
- [ ] Config loader 可加载并合并配置
- [ ] PendingPlanStore 可 read/write

---

## Phase 2 — Execution (Layer 0)

**Goal:** 纯 AI 调用运行时，不含任何业务逻辑。

### 2.1 Types

```typescript
// src/core/modules/execution/types/
interface Run { id, orgId, taskId?, conversationId?, roleId, status, wakeReason, startedAt?, finishedAt?, tokenCount, createdAt }
type RunStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled' | 'interrupted'
interface CostEntry { id, runId, roleId, orgId, tokenCount, createdAt }
```

### 2.2 Components

| Deliverable | File | Description |
|-------------|------|-------------|
| `IRunRepository` | `interfaces/` | Run CRUD interface |
| `ICostEntryRepository` | `interfaces/` | CostEntry CRUD interface |
| `SqliteRunRepository` | `persistence/` | SQLite implementation |
| `SqliteCostEntryRepository` | `persistence/` | SQLite implementation |
| `IExecutor` | `interfaces/` | Executor abstraction |
| `RunEngine` | `engines/run.engine.ts` | Core: create Run → call executor → stream parse → record cost → update status |
| `WorkerService` | `workers/worker-service.ts` | Worker thread pool management |
| `Worker` | `workers/worker.ts` | Actual worker thread — calls Claude CLI |
| `UtilityProcessExecutor` | `workers/utility-process.executor.ts` | IExecutor implementation using WorkerService |
| `StreamJsonParser` | `workers/stream-json-parser.ts` | 流式 JSON 解析 |
| `ClaudeStreamParser` | `workers/claude-stream-parser.ts` | Claude API stream 格式解析 |
| `FileLogService` | `logging/file-log.service.ts` | Run 输出日志写入磁盘 |
| `CostTracker` | `services/cost-tracker.ts` | Token 消耗记录 |
| `execution.module.ts` | `bootstrap/` | DI registration |

### 2.3 Emitted Events

```
run:queued, run:started, run:succeeded, run:failed, run:cancelled
run:log, run:assistant-text, run:status, run:timed-out
```

### Acceptance Criteria

- [ ] RunEngine 可接收 prompt string + config，返回 AI 输出
- [ ] Worker 可调用 Claude CLI 并流式返回结果
- [ ] Run record 正确持久化（status transitions, token count）
- [ ] CostEntry 正确记录
- [ ] FileLogService 输出日志到 `~/.capibara/logs/`
- [ ] 单元测试：RunEngine mock executor

---

## Phase 3 — Organization (Layer 1)

**Goal:** 角色组织架构、权限体系、能力分配。

### 3.1 Types

```typescript
// src/core/modules/organization/types/
interface Organization { id, name, description, customInstructions, status, budgetLimit, orgTemplateId?, planningRoleId?, workspacePath, createdAt, updatedAt }
type OrgStatus = 'active' | 'paused' | 'archived'

interface Role { id, orgId, name, parentId?, persona, knowledgeBaseRefs[], skillIds[], canApprove, canDelegate, requiresHumanApproval, consecutiveWakeCount, isSystemRole, status, createdAt, updatedAt }
type RoleStatus = 'active' | 'paused' | 'idle'

interface Skill { id, name, command, description, category, source, orgTemplateId?, customPromptContent?, createdAt }
type SkillCategory = 'analysis' | 'design' | 'implementation' | 'review' | 'test' | 'general'
type SkillSource = 'builtin' | 'template' | 'custom'
```

### 3.2 Components

| Deliverable | File | Description |
|-------------|------|-------------|
| `IOrganizationRepository` | `interfaces/` | Org CRUD |
| `IRoleRepository` | `interfaces/` | Role CRUD + hierarchy queries (getChildren, getParent, getAncestors) |
| `ISkillRepository` | `interfaces/` | Skill CRUD + search |
| `SqliteOrganizationRepository` | `persistence/` | |
| `SqliteRoleRepository` | `persistence/` | |
| `SqliteSkillRepository` | `persistence/` | |
| `OrganizationService` | `services/` | Org lifecycle management |
| `RoleService` | `services/` | Role CRUD + hierarchy validation |
| `SkillService` | `services/` | Skill CRUD + assignment |
| `OrgTemplateService` | `services/` | 模板加载和实例化 |
| `SkillSeeder` | `services/` | 内置 Skill 初始化 |
| `organization.module.ts` | `bootstrap/` | DI registration |

### 3.3 Emitted Events

```
org:created, org:updated, org:deleted
role:created, role:updated, role:deleted
```

### 3.4 Resources

```
resources/
  templates/        # Organization template JSONs (role hierarchies + skills)
  roles/            # Role template definitions (planning-assistant, etc.)
```

### Acceptance Criteria

- [ ] Organization CRUD + status transitions
- [ ] Role CRUD + parent/child hierarchy enforcement
- [ ] Skill CRUD + search by category/source
- [ ] OrgTemplateService 可从 JSON 模板创建完整的 Org + Roles + Skills
- [ ] SkillSeeder 初始化 builtin skills
- [ ] 单元测试：hierarchy validation, template loading

---

## Phase 4 — Workflow (Layer 1)

**Goal:** 任务类型定义、状态机、流转规则、行为引擎。

**可与 Phase 3 并行。**

### 4.1 Types

```typescript
// src/core/modules/workflow/types/
interface Task { id, orgId, parentId?, type, title, description, status, assigneeRoleId?, depth, artifactPaths?, createdAt, updatedAt }
type TaskType = string  // schema-driven
type TaskStatus = string  // schema-driven

interface ProcessSchema { workItemTypes[], statuses[], transitions[], behaviorRules[] }
interface WorkItemTypeDefinition { name, label, icon?, color?, isLeaf, allowedChildren[], allowedAtRoot, canDecompose }
interface StatusDefinition { name, label, category: StatusCategory }
type StatusCategory = 'initial' | 'active' | 'approval' | 'terminal'
interface TransitionDefinition { from, to, mode: TransitionMode }
type TransitionMode = 'manual' | 'auto' | 'system'
interface BehaviorRule { id, name, priority, trigger: BehaviorTrigger, condition: BehaviorCondition, action: BehaviorAction }
// BehaviorTrigger, BehaviorCondition, BehaviorAction — 同 architecture plan
```

### 4.2 Components

| Deliverable | File | Description |
|-------------|------|-------------|
| `ITaskRepository` | `interfaces/` | Task CRUD + tree queries (getChildren, getByOrg, getAncestors) |
| `IProcessSchemaRepository` | `interfaces/` | Schema CRUD per org |
| `SqliteTaskRepository` | `persistence/` | |
| `SqliteProcessSchemaRepository` | `persistence/` | |
| `ProcessEngine` | `engines/process.engine.ts` | Schema 加载、验证 type/status 合法性、transition 合法性检查、获取特定 category 状态 |
| `TaskStateMachine` | `engines/task.state-machine.ts` | 执行状态转换 + 发出事件（包括 `task:entered-approval`） |
| `BehaviorEngine` | `engines/behavior.engine.ts` | TCA 规则评估：根据事件触发 → 检查条件 → 执行动作 |
| `TaskService` | `services/task.service.ts` | Task CRUD + validation + batchCreate |
| `ProcessTemplateService` | `services/process-template.service.ts` | 从磁盘加载 workflow 模板 |
| `workflow.module.ts` | `bootstrap/` | DI registration |

### 4.3 Emitted Events

```
task:created, task:status-changed, task:completed
task:entered-approval, task:approval-confirmed, task:approval-rejected
schema:updated, behavior:executed
```

### 4.4 Resources

```
resources/
  workflows/        # ProcessSchema template JSONs (e.g., default-agile.json)
```

### 4.5 Key Logic: Approval Flow

```
TaskStateMachine.transition(taskId, newStatus):
  1. ProcessEngine.validateTransition(orgId, currentStatus, newStatus)
  2. Update task status in DB
  3. Check: ProcessEngine.getStatusCategory(orgId, newStatus) === 'approval'?
     → Yes: emit 'task:entered-approval'
     → No:  emit 'task:status-changed'
  4. Check: isTerminal(newStatus)?
     → Yes: emit 'task:completed'
  5. BehaviorEngine.evaluate(context) → may trigger auto-transitions or wakes
```

### Acceptance Criteria

- [ ] ProcessSchema 可加载、验证、持久化
- [ ] Task CRUD + 树状层级（parent/child, depth tracking）
- [ ] TaskStateMachine 强制合法状态转换
- [ ] Approval status category 正确触发 `task:entered-approval` 事件
- [ ] BehaviorEngine TCA 规则评估正确
- [ ] batchCreate 可从 plan 结构批量创建任务树
- [ ] 单元测试：state machine transitions, behavior rules, schema validation

---

## Phase 5 — Conversation (Layer 1)

**Goal:** 统一对话引擎 — Inquiry + Planning + Adhoc。

**依赖 Phase 3（Organization）— InquiryRouter 需要只读查询 Role 数据。**

### 5.1 Types

```typescript
// src/core/modules/conversation/types/
type ConversationType = 'inquiry' | 'planning' | 'adhoc'
type ConversationState = 'active' | 'waiting' | 'resolved' | 'escalated' | 'timed_out' | 'cancelled' | 'completed'
type MessageIntent = 'question' | 'reply' | 'escalation' | 'resolution' | 'general'

interface Conversation { id, orgId, type, state, initiatorRoleId, respondentRoleId?, respondentType, taskId?, parentConversationId?, depth, priority, timeoutAt?, externalSessionId?, metadata, createdAt, updatedAt }
interface ConversationMessage { id, conversationId, authorRoleId?, authorType, content, intent, inReplyToMessageId?, createdAt }

// State machine transitions
const CONVERSATION_TRANSITIONS: Array<{ from, to }>

// Routing
interface RoutingRequest { askingRoleId, orgId, taskId, recipientTarget, questionContent, conversationDepth }
interface RoutingDecision { respondentRoleId?, respondentType, priority, auditReason }
```

### 5.2 Components

| Deliverable | File | Description |
|-------------|------|-------------|
| `IConversationRepository` | `interfaces/` | Conversation CRUD + queries (byOrg, byTask, active, byState) |
| `IConversationMessageRepository` | `interfaces/` | Message CRUD + queries (byConversation, latest) |
| `SqliteConversationRepository` | `persistence/` | |
| `SqliteConversationMessageRepository` | `persistence/` | |
| `ConversationService` | `services/conversation.service.ts` | 统一 CRUD + state machine + message management |
| `InquiryRouter` | `routing/inquiry.router.ts` | Inquiry 路由决策（读取 Organization.RoleService） |
| `InquiryEscalationService` | `services/inquiry-escalation.service.ts` | 超时扫描 + 升级 + 孤儿恢复 |
| `ConversationContextBuilder` | `context/conversation-context.builder.ts` | 构建对话上下文（给 Prompt 用） |
| `ConversationEventLogger` | `persistence/conversation-event.logger.ts` | Append-only audit log |
| `conversation.module.ts` | `bootstrap/` | DI registration |

### 5.3 Emitted Events

```
conversation:created
conversation:message-added
conversation:response-needed        # 统一触发：所有类型需要 AI 响应时
conversation:respondent-assigned     # inquiry routing 完成
conversation:resolved
conversation:escalated
conversation:timed-out
conversation:cancelled
```

### 5.4 Key Logic: Unified Response Trigger

```
ConversationService.addMessage(conversationId, message):
  1. Persist message
  2. Emit 'conversation:message-added'
  3. Determine if AI response is needed:
     - inquiry: after respondent assigned and not yet replied
     - planning/adhoc: after human sends message (authorType === 'human')
  4. If response needed → emit 'conversation:response-needed' { conversationId, roleId }

ConversationService.create(type: 'inquiry', ...):
  1. Persist conversation (state: 'active')
  2. InquiryRouter.route(request) → RoutingDecision
  3. Update respondentRoleId
  4. Transition state: active → waiting
  5. Emit 'conversation:respondent-assigned'
  6. Emit 'conversation:response-needed' { conversationId, respondentRoleId }

ConversationService.create(type: 'planning' | 'adhoc', ...):
  1. Persist conversation (state: 'active')
  2. Persist initial message (from human)
  3. Emit 'conversation:created'
  4. Emit 'conversation:response-needed' { conversationId, respondentRoleId }
```

### 5.5 Key Logic: Escalation

```
InquiryEscalationService (periodic scan):
  1. Find conversations WHERE type='inquiry' AND state='waiting' AND timeout_at < NOW()
  2. For each:
     a. Transition state → 'timed_out'
     b. Emit 'conversation:timed-out'
     c. Attempt escalation (find parent role or human)
     d. If escalated → transition → 'escalated', emit 'conversation:escalated'
```

### Acceptance Criteria

- [ ] Conversation CRUD for all three types
- [ ] State machine 强制合法转换
- [ ] InquiryRouter 正确路由（基于 Role 层级、技能、可用性）
- [ ] `conversation:response-needed` 在正确时机发出
- [ ] externalSessionId 正确存储和传递（planning/adhoc）
- [ ] InquiryEscalationService 超时扫描和升级
- [ ] ConversationEventLogger audit trail
- [ ] 单元测试：state machine, routing, escalation

---

## Phase 6 — Prompt (Layer 1.5)

**Goal:** 从三个底座聚合上下文数据，组装 prompt。

**依赖 Phase 3 + 4 + 5。**

### 6.1 Components

| Deliverable | File | Description |
|-------------|------|-------------|
| `PromptContext` type | `types/` | Task execution 场景的上下文数据结构 |
| `ConversationPromptContext` type | `types/` | Conversation 场景的上下文数据结构 |
| `RunContext` | `context/run.context.ts` | 从三底座聚合数据：Task + Role + Skills + Conversation history + Settings |
| `PromptBuilder` | `builder/prompt.builder.ts` | 组装最终 prompt string |
| `TaskPromptStrategy` | `strategies/task-prompt.strategy.ts` | Task 执行场景的 prompt 结构（persona + task details + skills + tools） |
| `ConversationPromptStrategy` | `strategies/conversation-prompt.strategy.ts` | 对话场景的 prompt 结构（persona + conversation history + tools） |
| `prompt.module.ts` | `bootstrap/` | DI registration |

### 6.2 RunContext Data Assembly

```
RunContext.buildForTask(taskId, roleId):
  Workflow     → Task (title, description, status, parent chain, siblings)
  Organization → Role (persona, knowledgeBaseRefs), Skills (by role.skillIds)
  Settings     → locale, model config
  → return PromptContext

RunContext.buildForConversation(conversationId, roleId):
  Conversation → Conversation (type, history, messages), ConversationContextBuilder
  Organization → Role (persona, knowledgeBaseRefs), Skills
  Workflow     → Task (if conversation.taskId is set)
  Settings     → locale, model config
  → return ConversationPromptContext
```

### Acceptance Criteria

- [ ] RunContext 正确聚合三底座数据
- [ ] PromptBuilder 输出结构化 prompt string
- [ ] TaskPromptStrategy 包含 persona, task details, skills, available tools
- [ ] ConversationPromptStrategy 包含 persona, conversation history, tools
- [ ] 单元测试：prompt assembly with mock data

---

## Phase 7 — MCP Bridge (Layer 1.5)

**Goal:** Claude 执行过程中的回调通道。

**依赖 Phase 3 + 4 + 5 + Infrastructure.PendingPlanStore。**

### 7.1 Components

| Deliverable | File | Description |
|-------------|------|-------------|
| `McpIpcServer` | `server/` | WebSocket server for MCP tool invocation |
| `McpToolRegistry` | `registry/` | Tool registration and dispatch |
| `McpConfigGenerator` | `server/` | 生成 MCP server 配置 |
| Task tools | `handlers/task-tools.ts` | `capibara_task_complete`, `capibara_task_create_child`, `capibara_task_review` |
| Conversation tools | `handlers/conversation-tools.ts` | `capibara_ask_question` |
| Planning tools | `handlers/planning-tools.ts` | `capibara_plan_tasks` → writes to PendingPlanStore |
| Context tools | `handlers/context-tools.ts` | `capibara_context` → reads from Organization + Workflow |
| `mcp.module.ts` | `bootstrap/` | DI registration |

### 7.2 Tool → Module Mapping

| Tool | Handler | Calls |
|------|---------|-------|
| `capibara_task_complete` | task-tools | Workflow.TaskService.transition(taskId, terminalStatus) |
| `capibara_task_create_child` | task-tools | Workflow.TaskService.create(parentId, ...) |
| `capibara_task_review` | task-tools | Workflow.TaskService.transition(taskId, reviewStatus) |
| `capibara_ask_question` | conversation-tools | Conversation.ConversationService.create(type: 'inquiry', ...) |
| `capibara_plan_tasks` | planning-tools | Infrastructure.PendingPlanStore.store(plan) |
| `capibara_context` | context-tools | Organization.RoleService + Workflow.TaskService (read-only) |

### Acceptance Criteria

- [ ] McpIpcServer 可启动 WebSocket
- [ ] 每个 tool handler 正确分发到对应模块
- [ ] `capibara_plan_tasks` 写入 PendingPlanStore
- [ ] `capibara_ask_question` 创建 inquiry conversation
- [ ] 集成测试：模拟 Claude 调用 MCP tool

---

## Phase 8 — Orchestrator & RunCoordinator (Layer 2)

**Goal:** 中枢调度 + Run 生命周期管理。

**依赖 Phase 2 + 3 + 4 + 5 + 6。**

### 8.1 Components

| Deliverable | File | Description |
|-------------|------|-------------|
| `IPendingWakeRepository` | `interfaces/` | PendingWake CRUD |
| `SqlitePendingWakeRepository` | `persistence/` (infra) | |
| `Orchestrator` | `orchestrator.ts` | Event listener → scheduling decisions → delegate to RunCoordinator |
| `RunCoordinator` | `run.coordinator.ts` | Run lifecycle: RunContext → PromptBuilder → RunEngine → post-process |
| `WakeGateValidator` | `wake-gate.validator.ts` | Role 可唤醒检查（status, permissions, circuit breaker） |
| `RetryScheduler` | `retry.scheduler.ts` | 失败重试策略和时机 |
| `BudgetGuard` | `budget.guard.ts` | Token 预算检查 |
| `WakeReason` type | `foundation/events.ts` | `'task_assigned' \| 'task_completed' \| 'review_approve' \| ...` |
| `orchestrator.module.ts` | `bootstrap/` | DI registration |

### 8.2 Orchestrator Event Subscriptions

```typescript
// Task events
eventBus.on('task:status-changed')           → maybeWakeAssignee(taskId)
eventBus.on('task:entered-approval')         → pauseTaskScheduling(taskId)
eventBus.on('task:approval-confirmed')       → resumeTaskScheduling(taskId)
eventBus.on('task:completed')                → maybeWakeParentAssignee(taskId)

// Conversation events
eventBus.on('conversation:response-needed')  → maybeWakeRespondent(conversationId, roleId)
eventBus.on('conversation:resolved')         → maybeResumeInitiator(conversationId)

// Run events
eventBus.on('run:failed')                    → retryScheduler.schedule(runId)
eventBus.on('run:succeeded')                 → handleRunCompletion(runId)

// Budget events
eventBus.on('budget:exceeded')               → pauseOrgRoles(orgId)
```

### 8.3 RunCoordinator Flow

```typescript
class RunCoordinator {
  async executeForTask(taskId, roleId, wakeReason):
    const context = await runContext.buildForTask(taskId, roleId)
    const prompt = promptBuilder.build(context)
    const mcpConfig = mcpConfigGenerator.generate(taskId, roleId)
    const run = await runEngine.execute(prompt, mcpConfig, { taskId, roleId, wakeReason })
    // post-process: run events already emitted by RunEngine

  async executeForConversation(conversationId, roleId):
    const conversation = await conversationRepo.findById(conversationId)
    const context = await runContext.buildForConversation(conversationId, roleId)
    const prompt = promptBuilder.buildForConversation(context)
    const mcpConfig = mcpConfigGenerator.generate(conversation.taskId, roleId)
    const run = await runEngine.execute(prompt, mcpConfig, { conversationId, roleId, wakeReason: 'conversation_response' })
}
```

### Acceptance Criteria

- [ ] Orchestrator 正确响应所有底座事件
- [ ] WakeGateValidator 拦截不合法的唤醒（paused role, budget exceeded, circuit breaker）
- [ ] RunCoordinator 完成完整 Run 生命周期（Task 和 Conversation 两种路径）
- [ ] BudgetGuard 超预算暂停
- [ ] RetryScheduler 失败后按策略重试
- [ ] Approval flow: task:entered-approval → 暂停 → 人工确认 → 恢复
- [ ] 集成测试：event → orchestrator → runCoordinator → mock runEngine

---

## Phase 9 — Planning (Layer 3)

**Goal:** 人机规划对话 → 结构化任务计划 → 批量创建。

**依赖 Phase 5 (Conversation) + Phase 4 (Workflow.batchCreate) + Infrastructure.PendingPlanStore。**

### 9.1 Components

| Deliverable | File | Description |
|-------------|------|-------------|
| `PlanningService` | `planning.service.ts` | 发起 planning conversation、监听 pending plan、管理确认/丢弃流程 |
| `planning.module.ts` | `bootstrap/` | DI registration |

### 9.2 PlanningService API

```typescript
class PlanningService {
  // 发起规划
  async start(orgId, roleId, initialMessage):
    conversation = await conversationService.create({
      type: 'planning',
      orgId, initiatorRoleId: humanRoleId?,
      respondentRoleId: roleId,
      respondentType: 'ai',
    })
    await conversationService.addMessage(conversation.id, { authorType: 'human', content: initialMessage })
    return { conversationId: conversation.id, roleId }

  // 继续对话
  async sendMessage(conversationId, message):
    await conversationService.addMessage(conversationId, { authorType: 'human', content: message })

  // 获取 pending plan（MCP tool 写入 PendingPlanStore 后）
  async getPendingPlan(orgId):
    return pendingPlanStore.get(orgId)

  // 确认计划 → 批量创建任务
  async confirmPlan(orgId, plan):
    await workflowTaskService.batchCreate(orgId, plan.tasks)
    pendingPlanStore.clear(orgId)

  // 丢弃计划
  async discardPlan(orgId):
    pendingPlanStore.clear(orgId)
}
```

### Acceptance Criteria

- [ ] PlanningService.start 创建 planning conversation
- [ ] AI 通过 MCP Tool 提交的 plan 出现在 PendingPlanStore
- [ ] confirmPlan 调用 Workflow.batchCreate 正确创建任务树
- [ ] discardPlan 清理 PendingPlanStore
- [ ] 完整 flow 测试：start → AI responds → plan submitted → confirm → tasks created

---

## Phase 10 — Notification (Layer 3)

**Goal:** 事件广播到 Renderer + 桌面通知。

### 10.1 Components

| Deliverable | File | Description |
|-------------|------|-------------|
| `EventBroadcaster` | `event-broadcaster.ts` | Domain events → IPC → Renderer |
| `NotificationService` | `notification.service.ts` | Desktop system notifications |
| `EventDigester` | `event-digester.ts` | 事件窗口化批处理（300ms IPC batching） |
| `notification.module.ts` | `bootstrap/` | DI registration |

### 10.2 DesktopEvent Types (Main → Renderer)

```typescript
type DesktopEvent =
  | { type: 'snapshot:updated' }
  | { type: 'org:changed'; orgId }
  | { type: 'role:changed'; orgId }
  | { type: 'skill:changed' }
  | { type: 'task:changed'; orgId }
  | { type: 'task:entered-approval'; taskId; taskTitle; orgId }
  | { type: 'run:changed'; orgId }
  | { type: 'run:log'; runId; stream; chunk }
  | { type: 'run:assistant-text'; runId; text }
  | { type: 'run:status'; runId; status }
  | { type: 'run:completed'; runId; orgId; taskId?; conversationId?; roleId; status; tokenCount }
  | { type: 'conversation:changed'; orgId }
  | { type: 'conversation:response-needed'; orgId; conversationId }
  | { type: 'scheduler:paused'; cancelledRunCount }
  | { type: 'scheduler:resumed' }
  | { type: 'planning:plan-ready'; orgId; taskCount }
  | { type: 'notification'; title; body }
```

### Acceptance Criteria

- [ ] Domain events 正确转发到 Renderer
- [ ] EventDigester 300ms 窗口批处理
- [ ] Desktop notification 触发

---

## Phase 11 — IPC Handlers + Electron Shell

**Goal:** 完成 Main ↔ Renderer 通信层和 Electron 应用壳。

### 11.1 IPC Handlers

| File | Covers |
|------|--------|
| `workflow.handlers.ts` | task CRUD, status transitions, process schema, approval |
| `organization.handlers.ts` | org CRUD, role CRUD, skill CRUD, template loading |
| `conversation.handlers.ts` | conversation CRUD (all types), messages, metrics |
| `execution.handlers.ts` | run CRUD, run logs, scheduler pause/resume |
| `planning.handlers.ts` | start, send message, pending plan, batch create, discard |
| `system.handlers.ts` | settings, system dep checks, locale |

### 11.2 Shared Contracts

```typescript
// shared/contracts.ts
export const IPC_CHANNELS = { ... }          // All channel definitions
export type DesktopResult<T> = ...           // Response wrapper
export type DesktopEvent = ...               // Event definitions
// Zod schemas for all IPC payloads
// Record types for all entities
```

### 11.3 Electron Shell

| Deliverable | Description |
|-------------|-------------|
| `index.ts` | Electron app lifecycle, window creation, preload |
| `preload/index.ts` | IPC bridge (contextBridge) |
| `bootstrap/composition-root.ts` | 完整的 DI registration — 调用各模块的 *.module.ts |

### 11.4 Bootstrap Sequence

```typescript
async function bootstrap():
  // Infrastructure
  const config = loadConfig()
  const logger = new PinoLogger(config)
  const sqliteConn = new SqliteConnection(config)
  runMigrations(sqliteConn.getDb())
  const eventBus = new EmitteryEventBus()
  const pendingPlanStore = new PendingPlanStore()

  // Layer 0
  registerExecutionModule(container, { config, logger, eventBus })

  // Layer 1 (order: Organization first, then Workflow, then Conversation)
  registerOrganizationModule(container, { sqliteConn, logger, eventBus })
  registerWorkflowModule(container, { sqliteConn, logger, eventBus })
  registerConversationModule(container, { sqliteConn, logger, eventBus })  // reads Organization

  // Layer 1.5
  registerPromptModule(container)
  registerMcpModule(container, { logger, pendingPlanStore })

  // Layer 2
  registerOrchestratorModule(container, { config, logger, eventBus })

  // Layer 3
  registerPlanningModule(container, { pendingPlanStore })
  registerNotificationModule(container, { eventBus, logger })

  // IPC Handlers
  registerAllIpcHandlers(container)

  // Start services
  orchestrator.start()
  inquiryEscalationService.start()
  mcpIpcServer.start()
  workerService.start()
```

### Acceptance Criteria

- [ ] 所有 IPC channel 可调用并返回 DesktopResult
- [ ] Electron app 启动、创建窗口、加载 Renderer
- [ ] Preload bridge 正确暴露 CapibaraApi
- [ ] Bootstrap 顺序正确，所有模块初始化无报错
- [ ] Shutdown 正确关闭所有 services

---

## Phase 12 — UI (Renderer)

**Goal:** React 前端。

### 12.1 Pages & Components

| Page | IPC Namespace | Description |
|------|--------------|-------------|
| Dashboard | org, task, run, cost | 项目概览 + 进度 + 预算 |
| Tasks | task, process, approval | 任务树 + 状态管理 + 审批 |
| Team | role, skill | 角色管理 + 技能分配 |
| Inbox | conversation | 对话列表（inquiry 待处理 + 历史） |
| Planning | planning, conversation | 规划对话 + 计划预览/确认 |
| Settings | settings, system | 全局配置 + 依赖检查 |
| Organization | org | 组织设置 + workspace path |

### 12.2 State Management

- Zustand stores per domain（task store, role store, conversation store, etc.）
- IPC event subscription → store update
- Optimistic updates where appropriate

### 12.3 Acceptance Criteria

- [ ] 所有页面可正常渲染和交互
- [ ] IPC 调用和事件订阅正确
- [ ] Approval flow: task 进入审批 → UI 显示待审批 → 确认/拒绝
- [ ] Planning flow: 发起 → 多轮对话 → 计划预览 → 确认创建
- [ ] Conversation inbox: 查看/回复 inquiry
- [ ] i18n: 中英文切换

---

## Timeline Overview

| Phase | Module | Dependencies | Parallelizable |
|-------|--------|-------------|----------------|
| 1 | Infrastructure | — | — |
| 2 | Execution | Phase 1 | — |
| 3 | Organization | Phase 1 | **Phase 3 & 4 可并行** |
| 4 | Workflow | Phase 1 | **Phase 3 & 4 可并行** |
| 5 | Conversation | Phase 1 + 3 | — |
| 6 | Prompt | Phase 3 + 4 + 5 | **Phase 6 & 7 可并行** |
| 7 | MCP Bridge | Phase 3 + 4 + 5 | **Phase 6 & 7 可并行** |
| 8 | Orchestrator | Phase 2 + 3 + 4 + 5 + 6 | — |
| 9 | Planning | Phase 4 + 5 | **Phase 9 & 10 可并行** |
| 10 | Notification | Phase 1 | **Phase 9 & 10 可并行** |
| 11 | IPC + Shell | All modules | — |
| 12 | UI | Phase 11 | — |

```
        Phase 1 (Infrastructure)
            │
     ┌──────┼──────────┐
     ▼      ▼          ▼
  Phase 2  Phase 3 ═══ Phase 4    (2, 3, 4 并行)
     │      │          │
     │      ▼          │
     │   Phase 5 ◄─────┘
     │      │
     │   ┌──┴──┐
     │   ▼     ▼
     │ Ph 6 ═ Ph 7               (6, 7 并行)
     │   │     │
     └───┴──┬──┘
            ▼
         Phase 8
            │
       ┌────┴────┐
       ▼         ▼
    Phase 9 ═ Phase 10            (9, 10 并行)
       │         │
       └────┬────┘
            ▼
         Phase 11
            │
            ▼
         Phase 12
```

---

*End of Implementation Plan*
