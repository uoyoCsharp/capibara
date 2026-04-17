# Capibara Acceptance & Core Test Plan

> **Date**: 2026-04-17  
> **Scope**: Phase 2 ~ Phase 11  
> **Prerequisite**: [Implementation Plan](./implementation-plan.md)  
> **Testing Framework**: Vitest  
> **Principle**: 只覆盖核心正向用例（golden path），不覆盖 edge cases。每个 Phase 通过全部验收标准后方可进入下一 Phase。

---

## Phase 2 — Execution (Layer 0)

**Goal:** 纯 AI 调用运行时，不含任何业务逻辑。

### 验收标准

| # | Criteria | Verification |
|---|----------|-------------|
| 2.1 | RunEngine 接收 prompt string + config，创建 Run 记录并返回 AI 输出 | 集成测试 |
| 2.2 | Worker 可通过 UtilityProcess 调用 Claude CLI 并流式返回结果 | 集成测试 |
| 2.3 | Run 记录正确持久化：status 从 `queued → running → succeeded` 全链路转换 | 单元测试 + DB 验证 |
| 2.4 | CostEntry 在 Run 完成后正确记录 tokenCount | DB 验证 |
| 2.5 | FileLogService 将 Run 输出写入 `~/.capibara/logs/{runId}.log` | 文件检查 |
| 2.6 | Run 失败时 status 为 `failed`，错误信息记录在日志中 | 单元测试 |
| 2.7 | Run 取消时 status 为 `cancelled`，Worker 进程被终止 | 单元测试 |
| 2.8 | 事件 `run:queued`, `run:started`, `run:succeeded`, `run:failed` 在正确时机发出 | 单元测试 |

### 核心测试用例

| ID | Test Case | Input | Expected Output |
|----|-----------|-------|----------------|
| T2.1 | Run 完整生命周期 — 成功 | `RunEngine.execute(prompt, config)` with mock executor returning success | Run record: status=`succeeded`, tokenCount>0; CostEntry created; events emitted in order: queued→started→succeeded |
| T2.2 | Run 完整生命周期 — 失败 | `RunEngine.execute(prompt, config)` with mock executor throwing error | Run record: status=`failed`; `run:failed` event emitted with error info |
| T2.3 | Run 取消 | Start a run, then call `RunEngine.cancel(runId)` | Run record: status=`cancelled`; `run:cancelled` event emitted |
| T2.4 | SqliteRunRepository CRUD | `create`, `findById`, `updateStatus`, `findByOrgId` | Records correctly persisted and queryable |
| T2.5 | SqliteCostEntryRepository 记录 | `create(runId, roleId, orgId, tokenCount)` | CostEntry persisted with correct fields |
| T2.6 | StreamJsonParser 流式解析 | Feed chunked JSON stream | Correctly parsed complete JSON objects emitted per chunk |
| T2.7 | FileLogService 写入 | `log(runId, stream, chunk)` | File created at expected path with correct content |
| T2.8 | WorkerService 线程池 | `execute(config)` with mock Claude CLI | Worker spawned, result returned, worker recycled |

---

## Phase 3 — Organization (Layer 1)

**Goal:** 角色组织架构、权限体系、能力分配。

### 验收标准

| # | Criteria | Verification |
|---|----------|-------------|
| 3.1 | Organization CRUD 功能完整 | 单元测试 |
| 3.2 | Organization status 转换合法（active ↔ paused → archived） | 单元测试 |
| 3.3 | Role CRUD + parent/child 层级关系正确维护 | 单元测试 |
| 3.4 | Role 层级查询可用：getChildren, getParent, getAncestors | 单元测试 |
| 3.5 | Skill CRUD + search by category/source 可用 | 单元测试 |
| 3.6 | OrgTemplateService 可从 JSON 模板一次性创建完整的 Org + Roles + Skills | 集成测试 |
| 3.7 | SkillSeeder 启动时自动创建 builtin skills | 集成测试 |
| 3.8 | 事件 `org:created`, `role:created`, `role:updated` 正确发出 | 单元测试 |

### 核心测试用例

| ID | Test Case | Input | Expected Output |
|----|-----------|-------|----------------|
| T3.1 | Organization 完整 CRUD | create → findById → update name → delete | 每步 DB 状态正确；create 发出 `org:created` |
| T3.2 | Organization status 转换 | active → paused → active → archived | 每步转换成功，DB 更新 |
| T3.3 | Role 创建（含 parent） | `RoleService.create({ orgId, name, parentId })` | Role 记录持久化，parentId 正确关联 |
| T3.4 | Role 层级查询 | 创建 root → child → grandchild，然后 `getChildren(rootId)`, `getAncestors(grandchildId)` | getChildren 返回 [child]；getAncestors 返回 [child, root] |
| T3.5 | Skill CRUD + 分配 | 创建 Skill → 将 skillId 分配到 Role.skillIds → 查询 Role | Role.skillIds 包含已分配的 Skill |
| T3.6 | Skill search | 创建多个不同 category 的 Skill → `searchByCategory('analysis')` | 只返回 category=analysis 的 Skill |
| T3.7 | OrgTemplateService 模板实例化 | `loadAndCreate(templatePath)` with a valid JSON template | Organization + Roles (with hierarchy) + Skills 全部创建完成 |
| T3.8 | SkillSeeder 初始化 | `seed()` on empty DB | builtin skills 全部写入 DB |

---

## Phase 4 — Workflow (Layer 1)

**Goal:** 任务类型定义、状态机、流转规则、行为引擎。

### 验收标准

| # | Criteria | Verification |
|---|----------|-------------|
| 4.1 | ProcessSchema 可加载、验证、持久化 | 单元测试 |
| 4.2 | Task CRUD + 树状层级（parent/child, depth tracking）正确 | 单元测试 |
| 4.3 | TaskStateMachine 强制只允许 ProcessSchema 中定义的合法状态转换 | 单元测试 |
| 4.4 | Approval status category 进入时触发 `task:entered-approval` 事件 | 单元测试 |
| 4.5 | Approval 确认后触发 `task:approval-confirmed` 并继续状态转换 | 单元测试 |
| 4.6 | BehaviorEngine TCA 规则正确评估和执行 | 单元测试 |
| 4.7 | TaskService.batchCreate 可从计划结构批量创建任务树 | 单元测试 |
| 4.8 | ProcessTemplateService 可从磁盘加载模板 JSON | 集成测试 |
| 4.9 | 事件 `task:created`, `task:status-changed`, `task:completed` 正确发出 | 单元测试 |

### 核心测试用例

| ID | Test Case | Input | Expected Output |
|----|-----------|-------|----------------|
| T4.1 | ProcessSchema 加载和验证 | `ProcessEngine.load(schemaJson)` with valid schema | Schema 对象正确解析，workItemTypes/statuses/transitions/behaviorRules 完整 |
| T4.2 | ProcessEngine 转换合法性检查 | `validateTransition(orgId, 'pending', 'in_progress')` — schema 中存在该转换 | 返回 true |
| T4.3 | ProcessEngine 转换非法性拒绝 | `validateTransition(orgId, 'pending', 'done')` — schema 中不存在该转换 | 返回 false / throw |
| T4.4 | Task 创建（含 parent） | `TaskService.create({ orgId, parentId, type: 'story', title, status: 'pending' })` | Task 持久化，depth = parent.depth + 1；`task:created` 事件发出 |
| T4.5 | Task 状态转换 — 正常 | `TaskStateMachine.transition(taskId, 'in_progress')` from 'pending' | Task.status 更新；`task:status-changed` 发出 |
| T4.6 | Task 进入 Approval 状态 | `TaskStateMachine.transition(taskId, 'awaiting_approval')` where category='approval' | Task.status 更新；`task:entered-approval` 发出（非 `task:status-changed`） |
| T4.7 | Approval 确认 | `TaskStateMachine.confirmApproval(taskId)` → transition to next status | `task:approval-confirmed` 发出；状态流转继续 |
| T4.8 | Approval 拒绝 | `TaskStateMachine.rejectApproval(taskId)` → transition back | `task:approval-rejected` 发出；状态回退 |
| T4.9 | Task 完成 | `TaskStateMachine.transition(taskId, 'done')` where category='terminal' | `task:status-changed` + `task:completed` 发出 |
| T4.10 | BehaviorEngine TCA 执行 | 配置规则 `on_status_enter('in_progress') → auto_assign(roleId)` → Task 进入 in_progress | BehaviorEngine 触发，Task.assigneeRoleId 被更新 |
| T4.11 | batchCreate 批量创建 | `TaskService.batchCreate(orgId, planTree)` with nested structure | 树状 Task 全部创建，parent/child 关系正确，depth 正确 |
| T4.12 | ProcessTemplateService 模板加载 | `loadTemplate('default-agile')` | 返回完整 ProcessSchema 对象 |

---

## Phase 5 — Conversation (Layer 1)

**Goal:** 统一对话引擎 — Inquiry + Planning + Adhoc。

### 验收标准

| # | Criteria | Verification |
|---|----------|-------------|
| 5.1 | Conversation CRUD 支持三种类型（inquiry/planning/adhoc） | 单元测试 |
| 5.2 | State machine 强制合法状态转换 | 单元测试 |
| 5.3 | Inquiry: InquiryRouter 基于 Role 层级/技能/状态正确路由 respondent | 单元测试 |
| 5.4 | Inquiry: `conversation:response-needed` 在 respondent 确定后发出 | 单元测试 |
| 5.5 | Planning/Adhoc: `conversation:response-needed` 在 human 发送消息后发出 | 单元测试 |
| 5.6 | externalSessionId 正确存储（planning/adhoc 有值，inquiry 为 null） | 单元测试 |
| 5.7 | InquiryEscalationService 超时扫描和升级正确执行 | 单元测试 |
| 5.8 | ConversationEventLogger 正确写入 audit log | DB 验证 |
| 5.9 | ConversationContextBuilder 正确构建对话上下文 | 单元测试 |

### 核心测试用例

| ID | Test Case | Input | Expected Output |
|----|-----------|-------|----------------|
| T5.1 | 创建 Inquiry 对话 | `ConversationService.create({ type: 'inquiry', orgId, initiatorRoleId, taskId, questionContent })` | Conversation 持久化 (state=waiting)；InquiryRouter 分配 respondent；`conversation:respondent-assigned` + `conversation:response-needed` 发出 |
| T5.2 | 创建 Planning 对话 | `ConversationService.create({ type: 'planning', orgId, initiatorRoleId: humanRoleId, respondentRoleId: aiRoleId, initialMessage })` | Conversation 持久化 (state=active)；Message 持久化；`conversation:created` + `conversation:response-needed` 发出 |
| T5.3 | 创建 Adhoc 对话 | `ConversationService.create({ type: 'adhoc', orgId, initiatorRoleId: humanRoleId, respondentRoleId: aiRoleId, initialMessage })` | 同 T5.2，type=adhoc |
| T5.4 | 添加消息 — AI 回复 inquiry | `addMessage(conversationId, { authorType: 'ai', content, intent: 'reply' })` on waiting inquiry | Message 持久化；`conversation:message-added` 发出 |
| T5.5 | 添加消息 — Human 发送 planning | `addMessage(conversationId, { authorType: 'human', content, intent: 'general' })` on active planning | Message 持久化；`conversation:message-added` + `conversation:response-needed` 发出 |
| T5.6 | Inquiry 解决 | `ConversationService.resolve(conversationId)` on waiting inquiry | state → resolved；`conversation:resolved` 发出 |
| T5.7 | InquiryRouter 路由决策 | `InquiryRouter.route({ askingRoleId, orgId, taskId, recipientTarget })` with available roles in hierarchy | 返回 RoutingDecision{ respondentRoleId, respondentType, priority, auditReason } |
| T5.8 | Inquiry 超时升级 | 创建 inquiry（timeoutAt = 过去时间）→ `InquiryEscalationService.scan()` | state → timed_out → escalated；`conversation:timed-out` + `conversation:escalated` 发出 |
| T5.9 | externalSessionId 存储 | 创建 planning conversation with externalSessionId='sess_abc' → findById | externalSessionId 正确返回 |
| T5.10 | ConversationContextBuilder 构建 | `build(conversationId)` on conversation with 3 messages | 返回结构化上下文，包含完整对话历史 |
| T5.11 | State machine 非法转换拒绝 | `ConversationService.resolve(conversationId)` on already resolved conversation | 抛出错误 / 返回 false |
| T5.12 | 查询 — 按 org 和 state | `findByOrgAndState(orgId, 'waiting')` | 只返回该 org 下 state=waiting 的 conversations |

---

## Phase 6 — Prompt (Layer 1.5)

**Goal:** 从三个底座聚合上下文数据，组装 prompt。

### 验收标准

| # | Criteria | Verification |
|---|----------|-------------|
| 6.1 | RunContext.buildForTask 正确聚合 Task + Role + Skills + Settings 数据 | 单元测试 |
| 6.2 | RunContext.buildForConversation 正确聚合 Conversation history + Role + Skills + Task(if any) 数据 | 单元测试 |
| 6.3 | PromptBuilder 输出完整的结构化 prompt string | 单元测试 |
| 6.4 | TaskPromptStrategy 输出包含 persona, task details, skills, available tools 四部分 | 单元测试 |
| 6.5 | ConversationPromptStrategy 输出包含 persona, conversation history, tools 三部分 | 单元测试 |

### 核心测试用例

| ID | Test Case | Input | Expected Output |
|----|-----------|-------|----------------|
| T6.1 | RunContext.buildForTask | `buildForTask(taskId, roleId)` with mock repos returning Task, Role, Skills, Settings | PromptContext 包含：task.title, task.description, task.status, role.persona, skills[], settingsConfig |
| T6.2 | RunContext.buildForConversation | `buildForConversation(conversationId, roleId)` with mock repos returning Conversation (3 messages), Role, Skills | ConversationPromptContext 包含：conversation.messages[], role.persona, skills[], task(if linked) |
| T6.3 | PromptBuilder — Task 场景 | `build(taskPromptContext)` | 输出 string 包含 `[Persona]`, `[Task]`, `[Skills]`, `[Tools]` 等结构化段落 |
| T6.4 | PromptBuilder — Conversation 场景 | `buildForConversation(conversationPromptContext)` | 输出 string 包含 `[Persona]`, `[Conversation History]`, `[Tools]` 等段落 |
| T6.5 | TaskPromptStrategy — Skills 注入 | context 中 skills = [{name: 'code-review', command: '...'}] | prompt 中包含该 skill 的 command 内容 |
| T6.6 | ConversationPromptStrategy — 历史组装 | context 中 messages = [human: "Q1", ai: "A1", human: "Q2"] | prompt 中对话历史按时间顺序组装，标记发言角色 |

---

## Phase 7 — MCP Bridge (Layer 1.5)

**Goal:** Claude 执行过程中的回调通道。

### 验收标准

| # | Criteria | Verification |
|---|----------|-------------|
| 7.1 | McpIpcServer 可启动 WebSocket 并接收 tool invocation 请求 | 集成测试 |
| 7.2 | McpToolRegistry 正确注册所有 tool handlers | 单元测试 |
| 7.3 | `capibara_task_complete` 正确调用 Workflow.TaskService.transition | 单元测试 |
| 7.4 | `capibara_task_create_child` 正确调用 Workflow.TaskService.create | 单元测试 |
| 7.5 | `capibara_ask_question` 正确调用 Conversation.ConversationService.create(type: 'inquiry') | 单元测试 |
| 7.6 | `capibara_plan_tasks` 正确写入 PendingPlanStore | 单元测试 |
| 7.7 | `capibara_context` 正确从 Organization + Workflow 读取上下文 | 单元测试 |
| 7.8 | McpConfigGenerator 生成有效的 MCP server 配置 | 单元测试 |

### 核心测试用例

| ID | Test Case | Input | Expected Output |
|----|-----------|-------|----------------|
| T7.1 | capibara_task_complete | `invoke('capibara_task_complete', { taskId, status: 'done' })` | TaskService.transition 被调用，返回 success |
| T7.2 | capibara_task_create_child | `invoke('capibara_task_create_child', { parentId, type, title, description })` | TaskService.create 被调用，返回新 taskId |
| T7.3 | capibara_task_review | `invoke('capibara_task_review', { taskId, status: 'awaiting_approval' })` | TaskService.transition 被调用，Task 进入 approval 状态 |
| T7.4 | capibara_ask_question | `invoke('capibara_ask_question', { askingRoleId, taskId, question, recipientTarget })` | ConversationService.create(type: 'inquiry') 被调用，返回 conversationId |
| T7.5 | capibara_plan_tasks | `invoke('capibara_plan_tasks', { orgId, tasks: [...planTree] })` | PendingPlanStore.store 被调用，plan 可通过 get(orgId) 读取 |
| T7.6 | capibara_context | `invoke('capibara_context', { taskId })` | 返回 Task 详情 + 所属 Org + assigned Role 信息 |
| T7.7 | McpToolRegistry 分发 | `registry.dispatch('capibara_task_complete', args)` | 正确路由到 task-tools handler |
| T7.8 | McpConfigGenerator 输出 | `generate(taskId, roleId)` | 返回有效 JSON config，包含 server address + tool list |

---

## Phase 8 — Orchestrator & RunCoordinator (Layer 2)

**Goal:** 中枢调度 + Run 生命周期管理。

### 验收标准

| # | Criteria | Verification |
|---|----------|-------------|
| 8.1 | Orchestrator 正确监听所有底座事件并作出调度决策 | 集成测试 |
| 8.2 | WakeGateValidator 拦截不合法唤醒（paused role, budget exceeded） | 单元测试 |
| 8.3 | RunCoordinator.executeForTask 完成完整 Run 生命周期 | 集成测试 |
| 8.4 | RunCoordinator.executeForConversation 完成完整 Run 生命周期 | 集成测试 |
| 8.5 | BudgetGuard 超预算时暂停 Org 下所有 Role 调度 | 单元测试 |
| 8.6 | RetryScheduler 失败后按策略调度重试 | 单元测试 |
| 8.7 | Approval flow: task:entered-approval → 暂停调度 → 确认 → 恢复 | 集成测试 |
| 8.8 | PendingWake 持久化和查询正确 | 单元测试 |

### 核心测试用例

| ID | Test Case | Input | Expected Output |
|----|-----------|-------|----------------|
| T8.1 | Task 事件 → 唤醒 assignee | emit `task:status-changed(taskId)` where task.assigneeRoleId is set | Orchestrator → WakeGateValidator (pass) → RunCoordinator.executeForTask called with correct taskId, roleId, wakeReason |
| T8.2 | Conversation 事件 → 唤醒 respondent | emit `conversation:response-needed(conversationId, roleId)` | Orchestrator → WakeGateValidator (pass) → RunCoordinator.executeForConversation called |
| T8.3 | WakeGateValidator — Role paused | emit `task:status-changed` where assignee role status='paused' | RunCoordinator NOT called; PendingWake created for later retry |
| T8.4 | WakeGateValidator — Budget exceeded | emit `task:status-changed` where org budget exceeded | RunCoordinator NOT called; `budget:exceeded` event emitted |
| T8.5 | RunCoordinator.executeForTask | `executeForTask(taskId, roleId, 'task_assigned')` with mock RunEngine | RunContext.buildForTask called → PromptBuilder.build called → RunEngine.execute called → Run record created |
| T8.6 | RunCoordinator.executeForConversation | `executeForConversation(conversationId, roleId)` with mock RunEngine | RunContext.buildForConversation called → PromptBuilder.buildForConversation called → RunEngine.execute called |
| T8.7 | Approval 暂停和恢复 | emit `task:entered-approval(taskId)` → later emit `task:approval-confirmed(taskId)` | 暂停期间该 Task 相关唤醒不执行；确认后恢复正常调度 |
| T8.8 | Run 失败 → 重试 | emit `run:failed(runId)` | RetryScheduler.schedule 被调用；延迟后 RunCoordinator 重新执行 |
| T8.9 | Conversation resolved → 恢复 initiator | emit `conversation:resolved(conversationId)` where initiator has pending task | Orchestrator 恢复 initiator Role 的任务调度 |
| T8.10 | BudgetGuard 检查 | `BudgetGuard.check(orgId)` where total cost > budgetLimit | 返回 false；Orchestrator 暂停该 Org |

---

## Phase 9 — Planning (Layer 3)

**Goal:** 人机规划对话 → 结构化任务计划 → 批量创建。

### 验收标准

| # | Criteria | Verification |
|---|----------|-------------|
| 9.1 | PlanningService.start 正确创建 planning conversation 并发出消息 | 集成测试 |
| 9.2 | PlanningService.sendMessage 正确追加 human 消息并触发 AI 响应 | 集成测试 |
| 9.3 | AI 通过 MCP Tool 提交的 plan 出现在 PendingPlanStore | 集成测试 |
| 9.4 | PlanningService.confirmPlan 调用 Workflow.batchCreate 正确创建任务树 | 集成测试 |
| 9.5 | PlanningService.discardPlan 清理 PendingPlanStore | 单元测试 |

### 核心测试用例

| ID | Test Case | Input | Expected Output |
|----|-----------|-------|----------------|
| T9.1 | 发起 Planning | `PlanningService.start(orgId, roleId, "请帮我规划登录模块")` | Planning conversation 创建 (type=planning, state=active)；initial message 持久化；`conversation:response-needed` 发出 |
| T9.2 | 继续 Planning 对话 | `PlanningService.sendMessage(conversationId, "加上 OAuth 支持")` | Message 追加；`conversation:response-needed` 再次发出 |
| T9.3 | 获取 Pending Plan | AI 执行后，MCP tool `capibara_plan_tasks` 写入 store → `PlanningService.getPendingPlan(orgId)` | 返回 plan 对象，包含 tasks 树结构 |
| T9.4 | 确认 Plan → 批量创建 | `PlanningService.confirmPlan(orgId, plan)` where plan has 3 tasks (1 epic + 2 stories) | Workflow.batchCreate 被调用；3 个 Task 创建完成（层级关系正确）；PendingPlanStore 被清空 |
| T9.5 | 丢弃 Plan | `PlanningService.discardPlan(orgId)` | PendingPlanStore.get(orgId) 返回 null |
| T9.6 | 完整 Planning Flow（端到端） | start → AI responds → plan submitted via MCP → getPendingPlan → confirmPlan | 全链路通过：conversation 创建 → AI 调用 → plan 存储 → 确认 → tasks 创建 |

---

## Phase 10 — Notification (Layer 3)

**Goal:** 事件广播到 Renderer + 桌面通知。

### 验收标准

| # | Criteria | Verification |
|---|----------|-------------|
| 10.1 | EventBroadcaster 将 domain events 转换为 DesktopEvent 并通过 IPC 发送到 Renderer | 集成测试 |
| 10.2 | EventDigester 在 300ms 窗口内批处理多个事件 | 单元测试 |
| 10.3 | NotificationService 在关键事件时触发桌面系统通知 | 集成测试 |
| 10.4 | DesktopEvent 类型覆盖所有需要通知前端的事件 | 代码审查 |

### 核心测试用例

| ID | Test Case | Input | Expected Output |
|----|-----------|-------|----------------|
| T10.1 | Task 事件广播 | emit `task:status-changed(taskId, orgId)` | Renderer 收到 `{ type: 'task:changed', orgId }` via IPC |
| T10.2 | Run 日志流广播 | emit `run:log(runId, stream, chunk)` | Renderer 收到 `{ type: 'run:log', runId, stream, chunk }` |
| T10.3 | Approval 通知 | emit `task:entered-approval(taskId, taskTitle, orgId)` | Renderer 收到 `{ type: 'task:entered-approval', taskId, taskTitle, orgId }`；Desktop notification 弹出 |
| T10.4 | Conversation 需要响应 | emit `conversation:response-needed(orgId, conversationId)` | Renderer 收到 `{ type: 'conversation:response-needed', orgId, conversationId }` |
| T10.5 | EventDigester 批处理 | 300ms 内连续 emit 5 个 `task:status-changed` | Renderer 只收到 1 次批量 IPC（包含 `{ type: 'task:changed' }`），而非 5 次 |
| T10.6 | Planning plan ready 通知 | PendingPlanStore 写入后触发 | Renderer 收到 `{ type: 'planning:plan-ready', orgId, taskCount }`；Desktop notification 弹出 |
| T10.7 | Scheduler 暂停通知 | emit `scheduler:paused(cancelledRunCount)` | Renderer 收到 `{ type: 'scheduler:paused', cancelledRunCount }` |

---

## Phase 11 — IPC Handlers + Electron Shell

**Goal:** 完成 Main ↔ Renderer 通信层和 Electron 应用壳。

### 验收标准

| # | Criteria | Verification |
|---|----------|-------------|
| 11.1 | 所有 IPC channel 可被 Renderer 调用并返回 `DesktopResult<T>` | 集成测试 |
| 11.2 | Electron app 启动、创建 BrowserWindow、加载 Renderer | 手动验证 |
| 11.3 | Preload bridge 通过 contextBridge 正确暴露 CapibaraApi | 集成测试 |
| 11.4 | Bootstrap 按正确顺序初始化所有模块（Infrastructure → L0 → L1 → L1.5 → L2 → L3） | 集成测试 |
| 11.5 | App shutdown 时正确关闭所有 services（Orchestrator, MCP, Worker, EscalationService） | 手动验证 |
| 11.6 | shared/contracts.ts 中所有 Zod schema 可正确验证 IPC 请求 payload | 单元测试 |

### 核心测试用例

#### 11.A — IPC Handlers

| ID | Test Case | IPC Channel | Expected |
|----|-----------|-------------|----------|
| T11.1 | Task 列表查询 | `capibara:task:list` `{ orgId }` | DesktopResult<TaskRecord[]> with tasks for this org |
| T11.2 | Task 创建 | `capibara:task:create` `{ orgId, type, title, status }` | DesktopResult<TaskRecord> with new task |
| T11.3 | Task 状态转换 | `capibara:task:transition` `{ taskId, newStatus }` | DesktopResult<TaskRecord> with updated status |
| T11.4 | Approval 确认 | `capibara:approval:confirm` `{ taskId }` | DesktopResult<void>; `task:approval-confirmed` event triggered |
| T11.5 | Org 创建 | `capibara:org:create` `{ name, workspacePath }` | DesktopResult<OrganizationRecord> |
| T11.6 | Role 列表查询 | `capibara:role:list` `{ orgId }` | DesktopResult<RoleRecord[]> |
| T11.7 | Conversation 创建（inquiry） | `capibara:conversation:create` `{ type: 'inquiry', orgId, ... }` | DesktopResult<ConversationRecord> |
| T11.8 | Conversation 消息列表 | `capibara:conversation:messages` `{ conversationId }` | DesktopResult<ConversationMessageRecord[]> |
| T11.9 | Planning 发起 | `capibara:planning:start` `{ orgId, roleId, message }` | DesktopResult<{ conversationId }> |
| T11.10 | Planning 确认 | `capibara:planning:confirm` `{ orgId }` | DesktopResult<{ taskCount }> |
| T11.11 | Scheduler 暂停 | `capibara:scheduler:pause` | DesktopResult<{ cancelledRunCount }> |
| T11.12 | Scheduler 恢复 | `capibara:scheduler:resume` | DesktopResult<void> |
| T11.13 | Settings 获取 | `capibara:settings:get` | DesktopResult<SettingsRecord> |
| T11.14 | System 依赖检查 | `capibara:system:check-deps` | DesktopResult<{ claude: boolean, git: boolean }> |

#### 11.B — Bootstrap & Lifecycle

| ID | Test Case | Input | Expected |
|----|-----------|-------|----------|
| T11.15 | Bootstrap 完整启动 | `bootstrap()` | 所有模块注册成功；Orchestrator.start() 被调用；McpIpcServer.start() 被调用；无未处理异常 |
| T11.16 | Bootstrap 顺序验证 | 检查 DI container 注册日志 | Infrastructure → Execution → Organization → Workflow → Conversation → Prompt → MCP → Orchestrator → Planning → Notification 顺序 |
| T11.17 | Preload bridge 暴露 | `window.capibara` in Renderer context | CapibaraApi 对象可用，包含 invoke/subscribe 方法 |
| T11.18 | Graceful shutdown | `app.on('before-quit')` triggered | Orchestrator.stop()、McpIpcServer.stop()、WorkerService.stop()、InquiryEscalationService.stop() 按顺序调用；SQLite connection closed |

#### 11.C — Contracts Validation

| ID | Test Case | Input | Expected |
|----|-----------|-------|----------|
| T11.19 | Zod schema — 有效 payload | 发送符合 schema 的 IPC 请求 | 验证通过，handler 正常执行 |
| T11.20 | Zod schema — 无效 payload | 发送缺少必填字段的 IPC 请求 | 返回 DesktopResult with error（validation error），handler 不执行 |

---

## Cross-Phase Integration Checkpoints

除各 Phase 自身的验收标准外，以下跨 Phase 集成测试在对应 Phase 完成后执行：

### Checkpoint A — 三底座完成后（Phase 3 + 4 + 5 完成）

| ID | Test Case | Span | Expected |
|----|-----------|------|----------|
| TA.1 | Task 创建 → BehaviorRule 触发 | Workflow 内部 | Task 创建后 BehaviorEngine 正确触发配置的规则 |
| TA.2 | Inquiry 创建 → Router 使用 Role 数据 | Conversation → Organization | InquiryRouter 正确读取 Role 层级和能力数据，返回合理路由决策 |
| TA.3 | 三底座事件独立性 | Workflow + Organization + Conversation | 各底座事件互不影响，无循环依赖 |

### Checkpoint B — 集成层完成后（Phase 6 + 7 完成）

| ID | Test Case | Span | Expected |
|----|-----------|------|----------|
| TB.1 | RunContext 聚合三底座数据 | Prompt → Workflow + Organization + Conversation | 正确读取并组装 Task、Role、Skills、Conversation 数据 |
| TB.2 | MCP Tool → 底座 Service | MCP Bridge → Workflow/Conversation | capibara_task_complete 正确驱动状态转换；capibara_ask_question 正确创建 inquiry |
| TB.3 | MCP Plan → PendingPlanStore | MCP Bridge → Infrastructure | capibara_plan_tasks 写入后可从 PendingPlanStore 读取 |

### Checkpoint C — 调度层完成后（Phase 8 完成）

| ID | Test Case | Span | Expected |
|----|-----------|------|----------|
| TC.1 | Task 完整生命周期 | Workflow → Orchestrator → Execution | Task 状态变更 → Orchestrator 唤醒 → RunCoordinator 执行 → Run 完成 |
| TC.2 | Inquiry 完整生命周期 | Conversation → Orchestrator → Execution | Inquiry 创建 → response-needed → Orchestrator 唤醒 → RunCoordinator 执行 → AI 回复 |
| TC.3 | Approval 暂停恢复 | Workflow → Orchestrator | Task 进入 approval → 调度暂停 → 确认 → 调度恢复 |

### Checkpoint D — 全模块完成后（Phase 11 完成）

| ID | Test Case | Span | Expected |
|----|-----------|------|----------|
| TD.1 | 完整 Planning Flow（端到端） | UI → IPC → Planning → Conversation → Orchestrator → Execution → MCP → PendingPlanStore → Workflow | start → 多轮对话 → plan submitted → confirm → tasks created |
| TD.2 | 完整 Task Execution Flow | UI → IPC → Workflow → Orchestrator → Execution → MCP → Workflow | Task 创建 → 分配 → 状态变更 → AI 执行 → MCP 回调 → 完成 |
| TD.3 | Approval + Notification | Workflow → Orchestrator → Notification → Renderer | Task 进入 approval → 暂停 → 桌面通知 → UI 确认 → 恢复 |

---

*End of Acceptance & Core Test Plan*
