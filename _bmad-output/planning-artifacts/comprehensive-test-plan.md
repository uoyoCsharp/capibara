# Capibara Comprehensive Test Plan (with Edge Cases)

> **Date**: 2026-04-20  
> **Scope**: Phase 2 ~ Phase 11  
> **Prerequisite**: [Acceptance Test Plan](./acceptance-test-plan.md), [Implementation Plan](./implementation-plan.md)  
> **Testing Framework**: Vitest  
> **Principle**: 覆盖核心正向用例（golden path）+ 各 Phase 关键 edge cases。每个 Phase 通过全部验收标准后方可进入下一 Phase。

---

## Test Strategy Overview

### Test Types

| Type | Description | Scope |
|------|-------------|-------|
| **Unit** | 单个组件隔离测试，mock 所有外部依赖 | Service, Engine, Repository |
| **Integration** | 多组件协作测试，真实 DB + EventBus | Module 内部跨组件 |
| **Cross-Module** | 跨模块集成测试 | Checkpoint A/B/C/D |
| **E2E** | IPC → Module → DB 全链路 | Phase 11 |

### Mock Strategy

| Layer | Mock Level |
|-------|-----------|
| Infrastructure | 真实 SQLite (in-memory), 真实 EventBus |
| Repository | 对 Service/Engine 测试时 mock repository interface |
| External | Claude CLI 始终 mock（IExecutor interface） |
| EventBus | 对事件验证使用 spy/capture，不 mock 掉 |

### File Naming Convention

```
tests/unit/{module}/{component}.test.ts           # 单元测试
tests/integration/{module}/{scenario}.test.ts     # 模块内集成
tests/integration/cross-module/{checkpoint}.test.ts  # 跨模块
```

---

## Phase 2 — Execution (Layer 0)

### Golden Path Tests

| ID | Test Case | Expected |
|----|-----------|----------|
| T2.1 | Run 完整生命周期 — 成功 | status: queued→running→succeeded; tokenCount>0; events emitted in order |
| T2.2 | Run 完整生命周期 — 失败 | status=failed; `run:failed` event with error |
| T2.3 | Run 取消 | status=cancelled; `run:cancelled` event; worker terminated |
| T2.4 | SqliteRunRepository CRUD | create, findById, updateStatus, findByOrgId 正确 |
| T2.5 | SqliteCostEntryRepository 记录 | CostEntry 正确持久化 |
| T2.6 | StreamJsonParser 流式解析 | chunked JSON → 正确解析为完整对象 |
| T2.7 | FileLogService 写入 | 日志文件创建在正确路径 |
| T2.8 | WorkerService 线程池 | worker 正确 spawn, return, recycle |

### Edge Case Tests

| ID | Test Case | Scenario | Expected |
|----|-----------|----------|----------|
| E2.1 | Run 双重取消 | cancel 一个已经 cancelled 的 Run | 幂等处理，不抛异常，不重复发事件 |
| E2.2 | Run 已完成后取消 | cancel 一个 status=succeeded 的 Run | 忽略请求，返回当前状态（不改变 succeeded） |
| E2.3 | 并发 Run 状态更新 | 两个并发请求更新同一 Run 的 status | 只有第一个成功，第二个失败或被忽略（乐观锁/幂等） |
| E2.4 | Worker 超时 | Worker 执行超过 maxTimeout | Run status=failed, error 信息包含 timeout; worker 进程被 kill |
| E2.5 | Worker 进程意外崩溃 | Worker 进程 exit code 非 0 | Run status=failed; WorkerService 从池中移除该 worker; 不影响其他 Run |
| E2.6 | StreamJsonParser 不完整 JSON | 流中断导致 JSON 被截断 | Parser 不抛异常；已解析的部分正确返回；Run 标记为 failed |
| E2.7 | StreamJsonParser 空流 | Executor 返回空 output | Run status=failed; error 标记为 empty_response |
| E2.8 | 超大 token 输出 | Claude 返回超大 response (>100KB) | FileLogService 正确写入不 OOM; tokenCount 正确记录 |
| E2.9 | FileLogService 磁盘满 | 写入日志时磁盘空间不足 | Run 本身不因日志失败而 fail; 错误被 logger 记录 |
| E2.10 | RunEngine — prompt 为空字符串 | execute('', config) | 立即返回 failed 状态; 不调用 executor |
| E2.11 | RunEngine — config 缺少必填字段 | execute(prompt, {}) 缺少 model | 验证失败; Run status=failed; 不调用 executor |
| E2.12 | CostTracker — tokenCount=0 | AI 返回无 usage 信息 | CostEntry 记录 tokenCount=0; 不抛异常 |
| E2.13 | 并发 Run 池满 | 提交超过 maxConcurrency 的 Run | 超出部分 queued; 前序完成后自动 dequeue |
| E2.14 | Run interrupted 状态 | Worker 被系统中断（SIGTERM） | status=interrupted; 不触发 retry（与 failed 不同） |

---

## Phase 3 — Organization (Layer 1)

### Golden Path Tests

| ID | Test Case | Expected |
|----|-----------|----------|
| T3.1 | Organization CRUD | create/findById/update/delete 正确; events 正确发出 |
| T3.2 | Organization status 转换 | active→paused→active→archived 各步成功 |
| T3.3 | Role 创建（含 parent） | parentId 正确关联 |
| T3.4 | Role 层级查询 | getChildren/getAncestors 正确返回 |
| T3.5 | Skill CRUD + 分配 | Skill 创建并分配到 Role |
| T3.6 | Skill search | searchByCategory 正确过滤 |
| T3.7 | OrgTemplateService 模板实例化 | Org + Roles + Skills 全创建 |
| T3.8 | SkillSeeder 初始化 | builtin skills 写入 DB |

### Edge Case Tests

| ID | Test Case | Scenario | Expected |
|----|-----------|----------|----------|
| E3.1 | Organization 非法状态转换 | archived → active | 抛出 InvalidTransitionError; status 不变 |
| E3.2 | Organization 非法状态转换 | paused → archived（跳过 active） | 允许（paused → archived 是合法的降级路径），或按业务规则拒绝 |
| E3.3 | 删除有 Roles 的 Organization | delete org 时 org 下仍有 roles | 级联删除所有 roles 和 skills，或拒绝删除（取决于策略）; 确保数据一致性 |
| E3.4 | Role 自循环 parent | create role with parentId = self.id | 拒绝; 抛出 CircularDependencyError |
| E3.5 | Role 循环层级 | A.parent=B, B.parent=C, C.parent=A | 在创建/更新 C.parent=A 时拒绝; 检测到循环 |
| E3.6 | 删除有子 Role 的 Role | delete parent role with existing children | 拒绝删除（children 先迁移或删除），或级联处理 |
| E3.7 | Role getAncestors 深层级 | Role 层级 depth=10 | 正确返回全部祖先链; 不 stack overflow |
| E3.8 | Skill 重复分配 | 同一 Skill 分配给同一 Role 两次 | 幂等处理; skillIds 不包含重复 |
| E3.9 | 分配不存在的 Skill | 将 non-existent skillId 分配给 Role | 抛出 SkillNotFoundError; Role 不变 |
| E3.10 | OrgTemplate 无效 JSON | 加载格式不正确的 template JSON | 抛出 TemplateValidationError; 不创建任何数据 |
| E3.11 | OrgTemplate 部分失败 | 模板中第 3 个 Role 创建失败 | 事务回滚; 不留下部分创建的数据 |
| E3.12 | Organization name 重复 | 创建同名 Organization | 允许（name 非唯一约束），或拒绝（取决于业务规则） |
| E3.13 | Role 跨 Org 引用 parent | Role(orgA).parentId = Role(orgB).id | 拒绝; parentId 必须属于同一 orgId |
| E3.14 | SkillSeeder 重复执行 | 第二次调用 seed() | 幂等; 不创建重复的 builtin skills |
| E3.15 | Org budgetLimit=0 | budgetLimit 设为 0 | Org 创建成功; BudgetGuard 在首次 Run 时即拒绝 |
| E3.16 | Paused org 下的 Role 操作 | org status=paused 时创建 Role | 允许（Org pause 只影响调度，不影响 CRUD）|

---

## Phase 4 — Workflow (Layer 1)

### Golden Path Tests

| ID | Test Case | Expected |
|----|-----------|----------|
| T4.1 | ProcessSchema 加载和验证 | Schema 对象完整解析 |
| T4.2 | ProcessEngine 转换合法性 — 通过 | 返回 true |
| T4.3 | ProcessEngine 转换非法性 — 拒绝 | 返回 false / throw |
| T4.4 | Task 创建（含 parent） | depth = parent.depth + 1; event 发出 |
| T4.5 | Task 状态转换 — 正常 | status 更新; `task:status-changed` 发出 |
| T4.6 | Task 进入 Approval 状态 | `task:entered-approval` 发出 |
| T4.7 | Approval 确认 | `task:approval-confirmed`; 状态继续 |
| T4.8 | Approval 拒绝 | `task:approval-rejected`; 状态回退 |
| T4.9 | Task 完成 | `task:status-changed` + `task:completed` |
| T4.10 | BehaviorEngine TCA 执行 | 规则触发; 动作正确执行 |
| T4.11 | batchCreate 批量创建 | 树状 Task 全创建; 关系正确 |
| T4.12 | ProcessTemplateService 模板加载 | 返回完整 Schema |

### Edge Case Tests

| ID | Test Case | Scenario | Expected |
|----|-----------|----------|----------|
| E4.1 | Task 非法状态转换 | pending → done（跳过 in_progress） | 拒绝; 抛出 IllegalTransitionError |
| E4.2 | Task 从 terminal 状态转换 | done → in_progress | 拒绝; terminal 状态不可逆 |
| E4.3 | Task Approval 重复确认 | confirmApproval 在已确认后再次调用 | 幂等或拒绝; 不重复触发事件 |
| E4.4 | Task Approval 超时未处理 | Task 长时间停留在 approval 状态 | Orchestrator 层面处理; Workflow 模块本身不主动超时 |
| E4.5 | Task depth 超限 | 创建嵌套 > maxDepth 层的 Task | 拒绝创建; 抛出 MaxDepthExceededError |
| E4.6 | Task 循环 parent | Task A.parentId = Task B, Task B.parentId = Task A | 在设置时拒绝; 检测循环引用 |
| E4.7 | 删除有子 Task 的 Task | delete parent task with children | 拒绝或级联; 保证数据一致性 |
| E4.8 | ProcessSchema — 空 transitions | Schema 中没有定义任何 transition | Schema 验证时警告或拒绝; 所有状态转换都被阻止 |
| E4.9 | ProcessSchema — 孤立状态 | 某 status 没有任何 inbound/outbound transition | Schema 验证通过（允许终态没有 outbound）; 但标记警告 |
| E4.10 | ProcessSchema — 重复 transition | from=A, to=B 定义两次 | Schema 验证拒绝; 不允许重复定义 |
| E4.11 | BehaviorEngine — 规则冲突 | 两条规则同时触发且动作矛盾 | 按 priority 执行高优先级规则; 低优先级被跳过 |
| E4.12 | BehaviorEngine — 规则循环 | 规则 A 触发 → 状态变更 → 触发规则 B → 状态变更 → 触发规则 A | 设置最大规则链深度 (maxChainDepth); 超出后中断并记录错误 |
| E4.13 | BehaviorEngine — condition 求值失败 | condition 表达式引用不存在的字段 | condition 求值为 false; 规则不触发; 错误被 logger 记录 |
| E4.14 | batchCreate — 空数组 | batchCreate(orgId, []) | 不创建任何 Task; 不抛异常; 返回空数组 |
| E4.15 | batchCreate — 部分失败 | 5 tasks 中第 3 个 type 不在 schema 中 | 事务回滚; 全部不创建; 返回明确错误 |
| E4.16 | batchCreate — 超大批次 | 一次创建 1000 个 tasks | 性能可接受 (<5s); 不 OOM; 事务完整 |
| E4.17 | Task assignee 不存在 | assigneeRoleId 指向已删除的 Role | 允许创建（弱引用）; Orchestrator 唤醒时发现 Role 不存在则跳过 |
| E4.18 | 并发状态转换 | 两个请求同时 transition 同一 Task | 只有一个成功; 另一个收到 ConcurrentModificationError |
| E4.19 | Schema hot-reload | 更新 ProcessSchema 后，已有 Task 的状态转换按新 schema 执行 | 旧 Task 使用新 schema 规则; 若旧状态在新 schema 中不存在 → 标记 orphaned |

---

## Phase 5 — Conversation (Layer 1)

### Golden Path Tests

| ID | Test Case | Expected |
|----|-----------|----------|
| T5.1 | 创建 Inquiry 对话 | state=waiting; routing 完成; response-needed 发出 |
| T5.2 | 创建 Planning 对话 | state=active; message 持久化; response-needed 发出 |
| T5.3 | 创建 Adhoc 对话 | 同 T5.2, type=adhoc |
| T5.4 | 添加消息 — AI 回复 inquiry | message 持久化; event 发出 |
| T5.5 | 添加消息 — Human 发送 planning | response-needed 再次发出 |
| T5.6 | Inquiry 解决 | state → resolved; event 发出 |
| T5.7 | InquiryRouter 路由决策 | 正确返回 respondent |
| T5.8 | Inquiry 超时升级 | state → timed_out → escalated |
| T5.9 | externalSessionId 存储 | planning/adhoc 有值; inquiry 为 null |
| T5.10 | ConversationContextBuilder | 正确构建完整对话历史上下文 |
| T5.11 | State machine 非法转换拒绝 | resolved → active 被拒绝 |
| T5.12 | 按 org 和 state 查询 | 正确过滤 |

### Edge Case Tests

| ID | Test Case | Scenario | Expected |
|----|-----------|----------|----------|
| E5.1 | Inquiry 无可用 respondent | 所有 Role 都是 paused 或不具备相关 skill | Router 升级到 human (respondentType='human'); 或返回 escalation decision |
| E5.2 | Inquiry 路由到自己 | InquiryRouter 选择了 initiator 自己 | 排除 initiator; 选择下一个候选人 |
| E5.3 | Inquiry 嵌套深度超限 | depth > maxInquiryDepth（如对话中再发起对话） | 拒绝创建新 inquiry; 强制升级到 human |
| E5.4 | 并发消息添加 | 两个 addMessage 同时写入同一 conversation | 两条消息都持久化; 按 createdAt 排序; 不丢消息 |
| E5.5 | 向 resolved 对话添加消息 | conversation.state='resolved' 时 addMessage | 拒绝; 抛出 ConversationClosedError |
| E5.6 | 向 cancelled 对话添加消息 | conversation.state='cancelled' 时 addMessage | 同 E5.5 |
| E5.7 | Planning 对话 — AI 连续回复 | AI 连续发两条消息（无 human 中间回复） | 允许（AI 可分段回复）; 不触发 response-needed |
| E5.8 | Adhoc 对话 — human 连续发送 | Human 连续发多条消息再等 AI | 每条都触发 response-needed; Orchestrator 去重（或只响应最新一条） |
| E5.9 | InquiryEscalation — 扫描间隔内解决 | Inquiry 在超时窗口内解决 | 扫描时跳过已 resolved 的 conversation; 不误升级 |
| E5.10 | InquiryEscalation — 升级链断裂 | 超时升级时 parent role 不存在 | 直接升级到 human; 不无限循环 |
| E5.11 | externalSessionId 冲突 | 两个 conversation 使用同一 externalSessionId | 允许（sessionId 可复用）; 按 conversationId 区分 |
| E5.12 | Conversation 消息为空 | addMessage with content='' | 拒绝; content 不能为空字符串 |
| E5.13 | Inquiry 创建时 taskId 不存在 | 引用已删除的 task | 允许创建（弱引用 + null 安全）; 或拒绝（取决于策略） |
| E5.14 | 超长对话历史 | conversation 有 500+ messages | ConversationContextBuilder 正确截断/摘要; 不超出 prompt 限制 |
| E5.15 | Conversation metadata 非法 JSON | metadata 字段存入非 JSON 格式 | 序列化时验证; 拒绝非法格式 |
| E5.16 | 并发 resolve | 两个请求同时 resolve 同一 conversation | 只有一个成功; 幂等或第二个返回 already-resolved |
| E5.17 | Adhoc 对话无 initial message | create adhoc without initialMessage | 拒绝; planning/adhoc 必须有首条 human 消息 |
| E5.18 | InquiryRouter — Org 只有一个 Role | org 只有 initiator 一个 Role | 直接升级到 human |

---

## Phase 6 — Prompt (Layer 1.5)

### Golden Path Tests

| ID | Test Case | Expected |
|----|-----------|----------|
| T6.1 | RunContext.buildForTask | PromptContext 包含 task, role, skills, settings |
| T6.2 | RunContext.buildForConversation | ConversationPromptContext 包含 messages, role, skills |
| T6.3 | PromptBuilder — Task 场景 | 输出包含 [Persona], [Task], [Skills], [Tools] |
| T6.4 | PromptBuilder — Conversation 场景 | 输出包含 [Persona], [History], [Tools] |
| T6.5 | TaskPromptStrategy — Skills 注入 | skill command 正确嵌入 prompt |
| T6.6 | ConversationPromptStrategy — 历史组装 | 对话按时间排序，标记角色 |

### Edge Case Tests

| ID | Test Case | Scenario | Expected |
|----|-----------|----------|----------|
| E6.1 | RunContext — Task 不存在 | buildForTask with deleted taskId | 抛出 TaskNotFoundError; 不返回空 context |
| E6.2 | RunContext — Role 不存在 | buildForTask with deleted roleId | 抛出 RoleNotFoundError |
| E6.3 | RunContext — Role 无 Skills | Role.skillIds = [] | PromptContext.skills 为空数组; prompt 中无 [Skills] 段落 |
| E6.4 | RunContext — Task 无 assignee | Task.assigneeRoleId = null | 使用传入的 roleId; 不报错 |
| E6.5 | Prompt 超长 — 超过 model context window | 组装后 prompt 超过 200k tokens | PromptBuilder 截断/摘要策略; 保留最重要部分（persona + recent context） |
| E6.6 | ConversationPromptStrategy — 空对话历史 | conversation 只有 system message | 正确构建; 不因空历史而崩溃 |
| E6.7 | RunContext — Settings 缺失 | settings 表为空（首次运行） | 使用默认 config; 不抛异常 |
| E6.8 | Prompt 中特殊字符 | Task description 包含 prompt injection 尝试 | 正确转义或包裹在 user content 中; 不影响 system prompt |
| E6.9 | Skills 命令含模板变量 | skill.command 包含 `{{taskTitle}}` 占位符 | 变量正确替换; 未定义变量保留原文或标记 |
| E6.10 | 多语言 prompt 组装 | settings.locale='zh-CN' | 系统指令部分使用对应语言模板 |

---

## Phase 7 — MCP Bridge (Layer 1.5)

### Golden Path Tests

| ID | Test Case | Expected |
|----|-----------|----------|
| T7.1 | capibara_task_complete | TaskService.transition 正确调用 |
| T7.2 | capibara_task_create_child | TaskService.create 正确调用 |
| T7.3 | capibara_task_review | Task 进入 approval 状态 |
| T7.4 | capibara_ask_question | ConversationService.create(inquiry) 正确调用 |
| T7.5 | capibara_plan_tasks | PendingPlanStore.store 正确写入 |
| T7.6 | capibara_context | 返回 Task + Org + Role 信息 |
| T7.7 | McpToolRegistry 分发 | 正确路由到对应 handler |
| T7.8 | McpConfigGenerator 输出 | 有效 JSON config |

### Edge Case Tests

| ID | Test Case | Scenario | Expected |
|----|-----------|----------|----------|
| E7.1 | 调用不存在的 tool | `dispatch('capibara_nonexistent', args)` | 返回 tool_not_found 错误; 不崩溃 |
| E7.2 | Tool 参数缺失必填字段 | `capibara_task_complete({})` 缺少 taskId | 返回 validation_error; handler 不执行 |
| E7.3 | Tool 参数类型错误 | `capibara_task_complete({ taskId: 123 })` number 而非 string | 返回 validation_error |
| E7.4 | Tool handler 内部异常 | TaskService.transition 抛出异常 | 返回结构化错误给 Claude; 不影响 MCP server 运行 |
| E7.5 | 并发 tool 调用 | Claude 同时调用 task_complete 和 ask_question | 两者独立执行; 无竞态条件 |
| E7.6 | capibara_task_complete — Task 不存在 | taskId 引用已删除 task | 返回 task_not_found; 不崩溃 |
| E7.7 | capibara_task_complete — 非法转换 | Task 当前 status 不允许转到 done | 返回 illegal_transition; 解释当前状态和可用转换 |
| E7.8 | capibara_ask_question — recipientTarget 无可用 Role | 目标 skill 无人持有 | 返回 no_available_respondent; 建议升级 |
| E7.9 | capibara_plan_tasks — plan 格式非法 | tasks 数组中含无效结构 | 返回 validation_error; PendingPlanStore 不写入 |
| E7.10 | capibara_plan_tasks — 覆盖已有 plan | orgId 已有 pending plan | 覆盖旧 plan; 返回 warning (plan_overwritten) |
| E7.11 | McpIpcServer — WebSocket 连接断开 | Claude CLI 进程意外退出 | Server 清理连接; 不影响其他连接; 资源正确释放 |
| E7.12 | McpIpcServer — 恶意大 payload | 接收超大 JSON payload (>10MB) | 拒绝; 返回 payload_too_large; 不 OOM |
| E7.13 | capibara_context — Role 跨 Org 请求 | 请求 task 不属于当前 org | 返回 access_denied 或 not_found; 不泄露跨 org 数据 |
| E7.14 | Tool 调用超时 | handler 执行超过 30s | MCP server 返回 timeout; 不挂起连接 |

---

## Phase 8 — Orchestrator & RunCoordinator (Layer 2)

### Golden Path Tests

| ID | Test Case | Expected |
|----|-----------|----------|
| T8.1 | Task 事件 → 唤醒 assignee | WakeGateValidator pass → RunCoordinator called |
| T8.2 | Conversation 事件 → 唤醒 respondent | RunCoordinator.executeForConversation called |
| T8.3 | WakeGateValidator — Role paused | RunCoordinator NOT called; PendingWake created |
| T8.4 | WakeGateValidator — Budget exceeded | RunCoordinator NOT called; budget:exceeded |
| T8.5 | RunCoordinator.executeForTask | 全链路: context → prompt → execute → result |
| T8.6 | RunCoordinator.executeForConversation | 全链路完成 |
| T8.7 | Approval 暂停和恢复 | 暂停期间不执行; 确认后恢复 |
| T8.8 | Run 失败 → 重试 | RetryScheduler 调度重试 |
| T8.9 | Conversation resolved → 恢复 initiator | initiator 的 pending task 恢复调度 |
| T8.10 | BudgetGuard 检查 | cost > limit → 返回 false |

### Edge Case Tests

| ID | Test Case | Scenario | Expected |
|----|-----------|----------|----------|
| E8.1 | 事件风暴 — 批量 task 创建 | batchCreate 50 tasks 导致 50 个 task:status-changed 事件 | Orchestrator 正确排队处理; 不丢事件; 不 OOM; 按序执行 |
| E8.2 | WakeGateValidator — Role 被删除 | 事件触发时 role 已不存在 | 跳过; 不创建 PendingWake; 记录 warning |
| E8.3 | WakeGateValidator — consecutiveWakeCount 超限 | Role 连续唤醒次数超过阈值（熔断） | 拒绝唤醒; 标记 role 为 circuit_broken; 等待冷却期 |
| E8.4 | RunCoordinator — RunEngine 返回 interrupted | AI 调用被中断 | 不触发 retry（interrupted ≠ failed）; 记录状态; 等待手动恢复 |
| E8.5 | RunCoordinator — prompt 构建失败 | RunContext.buildForTask 抛出异常 | Run 不创建; 错误记录; retry 不被触发 |
| E8.6 | RetryScheduler — 最大重试次数 | Run 连续失败 3 次（maxRetries=3） | 第 3 次失败后不再重试; 标记为 permanently_failed; 通知 |
| E8.7 | RetryScheduler — 指数退避 | 重试间隔 | 1st: 5s, 2nd: 15s, 3rd: 45s (exponential backoff) |
| E8.8 | Approval — 同一 Task 重复 entered-approval | 由于事件重复投递 | 幂等; 不重复暂停; 不产生多个 pendingWake |
| E8.9 | Approval — Org 暂停期间收到 approval-confirmed | org.status=paused | 状态更新成功; 但 Orchestrator 不恢复调度（org 暂停优先级更高） |
| E8.10 | BudgetGuard — 预算更新 | budgetLimit 被管理员提高 | 下次检查时使用新 limit; 之前因 budget 暂停的 role 可被恢复 |
| E8.11 | 并发唤醒同一 Role | 两个事件同时尝试唤醒同一 Role | 串行化执行; 第二个排队等待第一个完成; 或 PendingWake |
| E8.12 | Conversation resolved — initiator 无 pending task | 对话解决但发起方没有等待的任务 | 正确处理; 不抛异常; 记录 info 日志 |
| E8.13 | Orchestrator start/stop 幂等 | 连续调用两次 start() 或 stop() | 幂等; 不重复订阅事件; 不重复取消订阅 |
| E8.14 | 事件处理中 Orchestrator stop | 正在处理事件时收到 shutdown 信号 | 当前事件处理完成; 后续事件不处理; graceful shutdown |
| E8.15 | PendingWake 恢复 — 应用重启 | 应用重启后 DB 中有未处理的 PendingWake | Orchestrator.start() 时扫描并恢复 pending wakes |
| E8.16 | RunCoordinator — Run 执行中 org 被暂停 | 正在执行的 Run 期间 org.status → paused | 当前 Run 继续完成; 后续不再调度新 Run |

---

## Phase 9 — Planning (Layer 3)

### Golden Path Tests

| ID | Test Case | Expected |
|----|-----------|----------|
| T9.1 | PlanningService.start | conversation 创建; response-needed 发出 |
| T9.2 | PlanningService.sendMessage | message 追加; response-needed 再次发出 |
| T9.3 | 获取 Pending Plan | plan 正确从 store 读取 |
| T9.4 | confirmPlan → 批量创建 | tasks 全部创建; 层级关系正确 |
| T9.5 | discardPlan | store 清空; 返回 null |
| T9.6 | 完整 Planning Flow | 端到端全链路通过 |

### Edge Case Tests

| ID | Test Case | Scenario | Expected |
|----|-----------|----------|----------|
| E9.1 | Planning — 无 planningRoleId | org.planningRoleId = null | 使用默认 planning role 或拒绝; 返回明确错误 |
| E9.2 | confirmPlan — plan 已过期 | 确认时 plan 已被 discard 或被新 plan 覆盖 | 返回 plan_not_found; 不创建 tasks |
| E9.3 | confirmPlan — plan 中引用不存在的 type | plan task type 不在 ProcessSchema 中 | 验证失败; 拒绝创建; 返回具体哪些 type 不合法 |
| E9.4 | Planning conversation 意外关闭 | conversation 被 cancel 但 pending plan 已存在 | PendingPlan 保留; 人类可手动 confirm 或 discard |
| E9.5 | 并发 Planning | 同一 org 同时发起两个 planning conversation | 允许（不同对话可产出不同 plan）; PendingPlanStore 以 orgId+conversationId 为 key |
| E9.6 | confirmPlan — 部分 task 创建失败 | 批量创建中某个 task 验证失败 | 事务回滚; 全部不创建; plan 保留（可修改后再确认） |
| E9.7 | Planning 多轮对话 — AI 未提交 plan | 多轮对话后 AI 未调用 capibara_plan_tasks | 无 pending plan; getPendingPlan 返回 null; 人类可继续对话或结束 |
| E9.8 | Plan 结构过深 | plan 包含 depth>maxDepth 的嵌套 | 验证时拒绝; 返回 max_depth_exceeded |
| E9.9 | Plan 结构为空 | capibara_plan_tasks 提交 tasks=[] | 拒绝存入 PendingPlanStore; 返回 empty_plan |
| E9.10 | sendMessage — conversation 不属于 planning | conversationId 对应的 type='inquiry' | 拒绝; 只能对 planning 类型操作 |

---

## Phase 10 — Notification (Layer 3)

### Golden Path Tests

| ID | Test Case | Expected |
|----|-----------|----------|
| T10.1 | Task 事件广播 | Renderer 收到 DesktopEvent |
| T10.2 | Run 日志流广播 | Renderer 收到 log chunk |
| T10.3 | Approval 通知 | Renderer 收到 + 桌面通知弹出 |
| T10.4 | Conversation 需要响应 | Renderer 收到事件 |
| T10.5 | EventDigester 批处理 | 300ms 内多事件合并为一次 IPC |
| T10.6 | Planning plan ready 通知 | Renderer 收到 + 桌面通知 |
| T10.7 | Scheduler 暂停通知 | Renderer 收到事件 |

### Edge Case Tests

| ID | Test Case | Scenario | Expected |
|----|-----------|----------|----------|
| E10.1 | Renderer 未连接 | BrowserWindow 未创建或已关闭时事件触发 | 事件不丢失（缓存到队列）或安全丢弃; 不抛异常 |
| E10.2 | EventDigester — 窗口边界 | 事件恰好在 300ms 窗口边界到达 | 事件归入当前窗口或下一窗口; 不丢失 |
| E10.3 | EventDigester — 大量事件堆积 | 1000 个事件在 300ms 内涌入 | 正确批处理; 不 OOM; IPC payload 合理大小 |
| E10.4 | 桌面通知权限被拒绝 | OS 级别拒绝通知权限 | NotificationService 优雅降级; 仅 IPC 广播; 不抛异常 |
| E10.5 | IPC 发送失败 | webContents.send 失败（renderer crashed） | 错误被捕获; EventBroadcaster 继续处理后续事件 |
| E10.6 | 事件类型未注册 | EventBus 发出未在 EventBroadcaster 中映射的事件 | 安全忽略; 不广播; 不报错 |
| E10.7 | 高频 run:log 事件 | 流式输出每 10ms 发出一个 log chunk | EventDigester 合并; Renderer 收到合理频率的批量更新 |
| E10.8 | 通知内容过长 | task.title 超过桌面通知字符限制 | 截断显示; 不导致通知失败 |

---

## Phase 11 — IPC Handlers + Electron Shell

### Golden Path Tests

| ID | Test Case | Expected |
|----|-----------|----------|
| T11.1-14 | 所有 IPC channel 可用 | 参见 acceptance-test-plan.md Phase 11.A |
| T11.15-18 | Bootstrap & Lifecycle | 参见 acceptance-test-plan.md Phase 11.B |
| T11.19-20 | Contracts Validation | 参见 acceptance-test-plan.md Phase 11.C |

### Edge Case Tests

| ID | Test Case | Scenario | Expected |
|----|-----------|----------|----------|
| E11.1 | IPC — 未知 channel | Renderer 调用不存在的 channel | 返回 DesktopResult with error: channel_not_found |
| E11.2 | IPC — 并发高频调用 | 100 个 IPC 请求同时到达 | 全部正确处理; 不死锁; 响应合理时延 |
| E11.3 | IPC — Handler 异常 | Handler 内部抛出未捕获异常 | 返回 DesktopResult with error; 不 crash main process |
| E11.4 | IPC — Payload 超大 | 请求 payload 为 50MB 的 JSON | 拒绝; 返回 payload_too_large; 不 OOM |
| E11.5 | Bootstrap — DB 文件锁定 | SQLite 文件被其他进程锁定 | 明确错误提示; 不静默失败; 建议关闭其他实例 |
| E11.6 | Bootstrap — 模块初始化失败 | Organization module 初始化时抛出 | 应用启动失败; 明确错误日志; 不 silent crash |
| E11.7 | Bootstrap — 部分模块缺失 | DI token 未注册 | 启动时抛出 DI resolution error; 不延迟到运行时 |
| E11.8 | Shutdown — 正在执行的 Run | shutdown 时有 Run status=running | Run 标记为 interrupted; worker 被 kill; DB 记录完整 |
| E11.9 | Shutdown — 超时 | shutdown 后 10s 仍有组件未停止 | 强制退出; 记录哪些组件未正常关闭 |
| E11.10 | Preload — contextBridge 隔离 | Renderer 尝试访问 main process 模块 | contextBridge 正确隔离; 只有 CapibaraApi 方法可用 |
| E11.11 | Zod schema — 额外字段 | 请求含有 schema 未定义的额外字段 | 额外字段被 strip; handler 正常执行（passthrough） |
| E11.12 | Zod schema — 深层嵌套验证 | 嵌套对象中的字段类型错误 | 返回精确的 validation error path |
| E11.13 | 多窗口场景 | 应用有多个 BrowserWindow | 所有窗口收到事件广播; IPC 不混乱 |
| E11.14 | DevTools open 时的 IPC | DevTools 打开时发送 IPC | 正常工作; 不受 DevTools 影响 |
| E11.15 | 数据库迁移失败 | migrations.ts 中有语法错误 | 启动失败; 明确提示迁移问题; DB 保持原状态 |

---

## Cross-Phase Integration Edge Cases

### Checkpoint A — 三底座完成后（Phase 3 + 4 + 5）

| ID | Test Case | Scenario | Expected |
|----|-----------|----------|----------|
| EA.1 | Task 删除 → Inquiry 孤立 | 删除 Task 后，关联的 Inquiry conversations | Conversation 保持 (taskId 为弱引用); 状态可正常转换 |
| EA.2 | Role 删除 → Conversation 影响 | 删除 respondent Role 后的 active conversation | Conversation 可被 escalated 或 cancelled; 不卡死 |
| EA.3 | Org 删除 → 级联影响 | 删除 Organization | 所有关联的 Tasks, Roles, Conversations 级联处理 |
| EA.4 | 事件循环检测 | BehaviorRule 触发 task:status-changed → 新 behavior 触发 | 有最大链深度保护; 不无限循环 |

### Checkpoint B — 集成层完成后（Phase 6 + 7）

| ID | Test Case | Scenario | Expected |
|----|-----------|----------|----------|
| EB.1 | RunContext 数据一致性 | buildForTask 时 task 被并发删除 | 抛出明确错误; 不返回部分数据 |
| EB.2 | MCP Tool 调用期间数据变更 | tool handler 执行中途 task 被别的请求修改 | 乐观锁或最终一致; 不产生脏数据 |
| EB.3 | MCP + PendingPlanStore 并发 | 两个 Claude 实例同时写 capibara_plan_tasks | 后写入的覆盖前者; 或以 conversationId 隔离 |

### Checkpoint C — 调度层完成后（Phase 8）

| ID | Test Case | Scenario | Expected |
|----|-----------|----------|----------|
| EC.1 | 连锁唤醒 | Task A 完成 → 触发 parent task 唤醒 → parent 完成 → 触发 grandparent | 全链正确执行; 不无限唤醒; 有合理间隔 |
| EC.2 | Inquiry 阻塞 Task 执行 | Role 在执行 Task 中发起 Inquiry → 等待回复 → 收到回复 → 恢复 | 全生命周期正确; Task Run 不因 Inquiry 而 timeout |
| EC.3 | Budget 超限中途 | Run 执行到一半时 budget 刚好超限 | 当前 Run 完成; 后续 Run 被 BudgetGuard 拒绝 |
| EC.4 | 全局暂停/恢复 | scheduler:pause → 所有 pending runs cancelled → scheduler:resume | 暂停时不新建 Run; 恢复后从 PendingWake 恢复 |

### Checkpoint D — 全模块完成后（Phase 11）

| ID | Test Case | Scenario | Expected |
|----|-----------|----------|----------|
| ED.1 | 端到端 — Planning 到执行 | Plan → confirm → task created → assigned → executed → completed | 全链路无错误; 每步 IPC + Event 正确 |
| ED.2 | 端到端 — Inquiry 升级链 | Task 执行 → ask_question → timeout → escalate → human reply → resume | 全链路正确; human 可通过 UI 回复 |
| ED.3 | 端到端 — 应用重启后恢复 | 应用运行中重启 → PendingWake + active conversations | 重启后正确恢复所有待处理工作 |
| ED.4 | 端到端 — Budget exhaustion | 多个 Task 同时执行直到 budget 耗尽 | 耗尽时所有后续调度停止; 通知用户; 提高 budget 后恢复 |

---

## Performance & Stress Test Scenarios

| ID | Test Case | Threshold | Expected |
|----|-----------|-----------|----------|
| P1 | 单 Org 1000 Tasks 查询 | <200ms | findByOrg(orgId) 响应时间可接受 |
| P2 | batchCreate 100 tasks | <3s | 事务完整; 不超时 |
| P3 | Conversation 500 messages 加载 | <500ms | ConversationContextBuilder 正确处理 |
| P4 | EventBus 高频发射 | 1000 events/s | 不丢事件; 内存稳定 |
| P5 | 并发 10 Runs | <30s total | WorkerService 正确管理池; 不死锁 |
| P6 | SQLite 并发读写 | 10 并发连接 | WAL mode 正确工作; 不 SQLITE_BUSY |
| P7 | IPC 高频调用 | 100 calls/s | 全部正确响应; 不阻塞 main process |

---

## Test Data Fixtures

### 共享 Fixtures

```typescript
// test/fixtures/org.fixture.ts
const testOrg: Organization = {
  id: 'org-test-1',
  name: 'Test Org',
  status: 'active',
  budgetLimit: 10000,
  workspacePath: '/tmp/test-workspace',
  // ...
}

// test/fixtures/role.fixture.ts  
const testRoles = {
  root: { id: 'role-root', orgId: 'org-test-1', name: 'Tech Lead', parentId: null },
  child: { id: 'role-child', orgId: 'org-test-1', name: 'Frontend Dev', parentId: 'role-root' },
  grandchild: { id: 'role-gc', orgId: 'org-test-1', name: 'UI Specialist', parentId: 'role-child' },
}

// test/fixtures/task.fixture.ts
const testTasks = {
  epic: { id: 'task-epic', orgId: 'org-test-1', type: 'epic', status: 'in_progress', depth: 0 },
  story: { id: 'task-story', orgId: 'org-test-1', type: 'story', parentId: 'task-epic', depth: 1 },
}

// test/fixtures/process-schema.fixture.ts
const testSchema: ProcessSchema = {
  workItemTypes: [...],
  statuses: [
    { name: 'pending', category: 'initial' },
    { name: 'in_progress', category: 'active' },
    { name: 'awaiting_approval', category: 'approval' },
    { name: 'done', category: 'terminal' },
    { name: 'cancelled', category: 'terminal' },
  ],
  transitions: [
    { from: 'pending', to: 'in_progress', mode: 'auto' },
    { from: 'in_progress', to: 'awaiting_approval', mode: 'system' },
    { from: 'awaiting_approval', to: 'done', mode: 'system' },
    { from: 'awaiting_approval', to: 'in_progress', mode: 'system' },
    { from: 'in_progress', to: 'done', mode: 'manual' },
    { from: '*', to: 'cancelled', mode: 'manual' },
  ],
  behaviorRules: [...],
}
```

### Test Utilities

```typescript
// test/helpers/test-db.ts
export function createTestDb(): SqliteConnection  // in-memory SQLite
export function seedTestData(db: SqliteConnection): void

// test/helpers/event-spy.ts
export function createEventSpy(eventBus: IEventBus): EventSpy
// spy.waitFor('task:created', timeout)
// spy.getEmitted('task:status-changed')
// spy.assertOrder(['run:queued', 'run:started', 'run:succeeded'])

// test/helpers/mock-executor.ts
export function createMockExecutor(options?: {
  response?: string;
  delay?: number;
  shouldFail?: boolean;
  tokenCount?: number;
}): IExecutor
```

---

## Test Execution Order

```
Phase 2 tests → Phase 3 tests → Phase 4 tests
                                        ↓
            Checkpoint A ←── Phase 5 tests
                    ↓
            Phase 6 tests → Phase 7 tests
                    ↓
            Checkpoint B
                    ↓
            Phase 8 tests
                    ↓
            Checkpoint C
                    ↓
    Phase 9 tests → Phase 10 tests → Phase 11 tests
                                        ↓
                                  Checkpoint D
                                        ↓
                              Performance tests
```

---

## Coverage Requirements

| Module | Line Coverage Target | Branch Coverage Target |
|--------|---------------------|----------------------|
| Execution (L0) | 90% | 85% |
| Organization (L1) | 85% | 80% |
| Workflow (L1) | 90% | 85% |
| Conversation (L1) | 90% | 85% |
| Prompt (L1.5) | 80% | 75% |
| MCP Bridge (L1.5) | 85% | 80% |
| Orchestrator (L2) | 90% | 85% |
| Planning (L3) | 80% | 75% |
| Notification (L3) | 75% | 70% |
| IPC Handlers | 85% | 80% |

---

*End of Comprehensive Test Plan*
