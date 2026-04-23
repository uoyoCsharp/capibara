# 自动级联执行 — 测试计划

基于 `auto-cascade-execution.md` v3 提案，覆盖三个新/重写模块和一个集成场景。

---

## 1. BehaviorEngine 单元测试

文件：`tests/unit/workflow/behavior-engine.test.ts`

### 1.1 条件表达式 — FieldCondition

| # | 用例 | 输入 | 期望 |
|---|------|------|------|
| 1 | `eq` 字符串匹配 | `field:'task.type', op:'eq', value:'bug'` context:`task.type='bug'` | true |
| 2 | `eq` 字符串不匹配 | `field:'task.type', op:'eq', value:'bug'` context:`task.type='task'` | false |
| 3 | `eq` 布尔值匹配 | `field:'type.isLeaf', op:'eq', value:true` context:`type.isLeaf=true` | true |
| 4 | `eq` 布尔值不匹配 | `field:'type.isLeaf', op:'eq', value:true` context:`type.isLeaf=false` | false |
| 5 | `eq` 数字匹配 | `field:'task.depth', op:'eq', value:2` context:`task.depth=2` | true |
| 6 | `neq` 匹配 | `field:'task.type', op:'neq', value:'epic'` context:`task.type='task'` | true |
| 7 | `neq` 不匹配 | `field:'task.type', op:'neq', value:'task'` context:`task.type='task'` | false |
| 8 | `in` 值在列表中 | `field:'task.type', op:'in', value:['bug','chore']` context:`task.type='bug'` | true |
| 9 | `in` 值不在列表中 | `field:'task.type', op:'in', value:['bug','chore']` context:`task.type='epic'` | false |
| 10 | `not_in` 值不在列表中 | `field:'status.category', op:'not_in', value:['terminal']` context:`status.category='active'` | true |
| 11 | `not_in` 值在列表中 | `field:'status.category', op:'not_in', value:['terminal']` context:`status.category='terminal'` | false |
| 12 | `gt` 大于 | `field:'task.depth', op:'gt', value:2` context:`task.depth=3` | true |
| 13 | `gt` 等于（不满足） | `field:'task.depth', op:'gt', value:2` context:`task.depth=2` | false |
| 14 | `gt` 小于 | `field:'task.depth', op:'gt', value:2` context:`task.depth=1` | false |
| 15 | `lt` 小于 | `field:'task.depth', op:'lt', value:3` context:`task.depth=2` | true |
| 16 | `lt` 等于（不满足） | `field:'task.depth', op:'lt', value:2` context:`task.depth=2` | false |
| 17 | 未知 field 返回 false | `field:'nonexistent', op:'eq', value:'x'` | false |
| 18 | 未知 operator 返回 false | `field:'task.type', op:'regex' as any, value:'.*'` | false |
| 19 | `in` 的 value 不是数组时返回 false | `field:'task.type', op:'in', value:'bug'` | false |
| 20 | `gt` 的 actual 不是 number 返回 false | `field:'task.type', op:'gt', value:1` context:`task.type='bug'` | false |
| 21 | `gt` 的 value 不是 number 返回 false | `field:'task.depth', op:'gt', value:'high'` context:`task.depth=3` | false |

### 1.2 条件表达式 — 组合逻辑

| # | 用例 | 输入 | 期望 |
|---|------|------|------|
| 22 | `all` 全部为 true | `all: [eq(isLeaf,true), eq(category,'terminal')]` | true |
| 23 | `all` 部分为 false | `all: [eq(isLeaf,true), eq(category,'active')]` | false |
| 24 | `all` 空数组 | `all: []` | true（every 在空数组上返回 true） |
| 25 | `any` 至少一个为 true | `any: [eq(type,'bug'), eq(type,'task')]` context:`type='task'` | true |
| 26 | `any` 全部为 false | `any: [eq(type,'bug'), eq(type,'chore')]` context:`type='task'` | false |
| 27 | `any` 空数组 | `any: []` | false（some 在空数组上返回 false） |
| 28 | `not` 取反 true → false | `not: eq(isLeaf, true)` context:`isLeaf=true` | false |
| 29 | `not` 取反 false → true | `not: eq(isLeaf, true)` context:`isLeaf=false` | true |
| 30 | 三层嵌套 `all > any > not` | `all: [any: [not: eq(depth,0), eq(type,'bug')], eq(isLeaf,true)]` | 按逻辑计算 |
| 31 | `not` 嵌套 `all` | `not: all: [eq(isLeaf,true), eq(category,'terminal')]` | 全满足时返回 false |
| 32 | condition 为 null | `condition: null` | true |
| 33 | condition 为 undefined | `condition: undefined` | true |
| 34 | condition 省略 | rule 中不含 condition 字段 | true |

### 1.3 Context 构建

| # | 用例 | 期望 |
|---|------|------|
| 35 | 构建包含所有 8 个字段的完整 context | context 包含 task.type, task.status, task.depth, task.hasChildren, task.hasAssignee, status.category, type.isLeaf, type.canDecompose |
| 36 | task.hasChildren 有子任务时为 true | taskRepo.findChildren 返回非空 → true |
| 37 | task.hasChildren 无子任务时为 false | taskRepo.findChildren 返回空数组 → false |
| 38 | task.hasAssignee 有角色时为 true | task.assigneeRoleId = 'role-1' → true |
| 39 | task.hasAssignee 无角色时为 false | task.assigneeRoleId = null → false |
| 40 | status.category 查找失败返回 null | task.status 不在 schema.statuses 中 → null |
| 41 | type.isLeaf 查找失败返回 false | task.type 不在 schema.workItemTypes 中 → false |
| 42 | type.canDecompose 查找失败返回 false | 同上 → false |

### 1.4 Trigger 匹配与 Rule 排序

| # | 用例 | 期望 |
|---|------|------|
| 43 | 只匹配指定 trigger 的规则 | schema 有 on_status_enter 和 on_all_children_terminal 规则，调用 onStatusEnter → 只执行 on_status_enter 规则 |
| 44 | 规则按 priority 升序执行 | priority 10 先于 priority 20 |
| 45 | 相同 priority 保持原始顺序 | 两条 priority=10 规则按数组顺序执行 |
| 46 | 无匹配规则时不报错 | trigger 无对应规则 → 返回空，无异常 |
| 47 | schema 不存在时静默返回 | processEngine.getSchema 返回 null → 不执行任何规则 |

### 1.5 Action 执行 — transition

| # | 用例 | 期望 |
|---|------|------|
| 48 | transition action 调用 taskStateMachine.transition | action: `{type:'transition', params:{targetStatus:'done'}}` → taskStateMachine.transition(taskId, 'done') 被调用 |
| 49 | transition action 缺少 targetStatus | action: `{type:'transition', params:{}}` → 记录 warn，不调用 transition |
| 50 | transition action 缺少 params | action: `{type:'transition'}` → 记录 warn，不调用 transition |
| 51 | 未知 action type | action: `{type:'notify'}` → 记录 warn，不崩溃 |

### 1.6 onStatusEnter

| # | 用例 | 期望 |
|---|------|------|
| 52 | 叶子任务进入 terminal → 匹配默认 Rule 1 | task(type=subtask, status=approved), schema=default → transition(task, 'done') |
| 53 | 非叶子任务进入 terminal → 不匹配 Rule 1 | task(type=epic, status=approved), schema=default → 不调用 transition |
| 54 | 任务进入 active 状态 → 不匹配 Rule 1 | task(status=in_progress) → condition: status.category='active' ≠ 'terminal' → 不执行 |
| 55 | 多条匹配规则依次执行 | 两条 on_status_enter 规则都匹配 → 按 priority 顺序执行两次 |

### 1.7 onChildCompleted

| # | 用例 | 期望 |
|---|------|------|
| 56 | 所有兄弟 terminal → 匹配 Rule 2 | 3 个 sibling 都 terminal → evaluateAndExecute('on_all_children_terminal', parent) |
| 57 | 部分兄弟非 terminal → 不触发 | 2/3 terminal → 不调用 evaluateAndExecute |
| 58 | child 没有 parentId → 直接返回 | childTask.parentId = null → 不执行任何操作 |
| 59 | parent 查找失败 → 直接返回 | taskRepo.findById(parentId) = null → 不执行 |
| 60 | 单个子任务完成 → 触发（因为是唯一 sibling） | parent 只有一个 child，该 child terminal → all terminal → 触发 |

### 1.8 重入防护

| # | 用例 | 期望 |
|---|------|------|
| 61 | 同一 taskId + trigger 重入 → 第二次跳过 | Rule 1 的 transition action 触发 onStatusEnter → 重入检测到 key 已存在 → 跳过 |
| 62 | 不同 taskId 同一 trigger → 不阻塞 | task-1:on_status_enter 正在执行 → task-2:on_status_enter 不受影响 |
| 63 | 同一 taskId 不同 trigger → 不阻塞 | task-1:on_status_enter 正在执行 → task-1:on_all_children_terminal 不受影响 |
| 64 | 执行完毕后 key 被清除 | 第一次执行完 → 同一 key 第二次可以正常执行 |
| 65 | action 执行抛异常 → key 仍被清除 | taskStateMachine.transition 抛错 → finally 块清除 key → 后续调用不被永久阻塞 |

### 1.9 自定义 Schema 兼容性

| # | 用例 | 期望 |
|---|------|------|
| 66 | 极简 schema (open→working→closed) 的 behaviorRules 正确执行 | 叶子进入 closed(terminal) → transition → 不执行（closed 已是最终态，但 targetStatus 指定为 closed，同状态不操作） |
| 67 | schema 无 behaviorRules 字段 → 不报错 | behaviorRules=[] 或 undefined → 静默返回 |
| 68 | 自定义 condition 引用自定义类型字段 | condition: `eq(task.type, 'custom_type')` → 正确匹配 |

---

## 2. TaskScheduler 单元测试

文件：`tests/unit/orchestrator/task-scheduler.test.ts`

### 2.1 基本调度 — 单根任务

| # | 用例 | 任务树 | 期望 |
|---|------|--------|------|
| 1 | initial + 有 assignee → 返回 | root(initial, assignee=R1) | `{ task: root, wakeReason: 'task_scheduled' }` |
| 2 | initial + 无 assignee → 阻塞 | root(initial, assignee=null) | null，记录 warn |
| 3 | active 状态 → 跳过 | root(active) | null |
| 4 | approval 状态 → 跳过 | root(approval) | null |
| 5 | terminal + 无子任务 → 跳过 | root(terminal, 无 children) | null |
| 6 | terminal + 有 initial 子任务 → 返回子任务 | root(terminal) → child(initial, R1) | `{ task: child }` |
| 7 | 组织无任务 → null | findByOrgId 返回空 | null |

### 2.2 深度优先遍历

| # | 用例 | 任务树 | 期望 |
|---|------|--------|------|
| 8 | 优先深入第一个子树 | root(terminal) → [A(terminal)→[A1(initial,R1), A2(initial,R1)], B(initial,R1)] | 返回 A1（不是 B） |
| 9 | 第一个子树全完成 → 进入第二个 | root(terminal) → [A(terminal)→[A1(terminal), A2(terminal)], B(initial,R1)] | 返回 B |
| 10 | 三层深度 epic→story→task | epic(terminal)→story(terminal)→task(initial,R1) | 返回 task |
| 11 | 四层深度 epic→story→task→subtask | 类似但多一层 | 返回 subtask |

### 2.3 createdAt 排序

| # | 用例 | 任务树 | 期望 |
|---|------|--------|------|
| 12 | 根任务按 createdAt 排序 | root-B(earlier), root-A(later) 都是 initial | 返回 root-B |
| 13 | 子任务按 createdAt 排序 | parent(terminal) → child-B(earlier,initial), child-A(later,initial) | 返回 child-B |
| 14 | createdAt 相同时稳定排序 | 两个同时创建的任务 | 不崩溃，返回其中一个 |

### 2.4 阻塞语义

| # | 用例 | 任务树 | 期望 |
|---|------|--------|------|
| 15 | 无 assignee 阻塞当前及后续兄弟 | parent(terminal) → [T1(terminal), T2(initial,无assignee), T3(initial,R1)] | null（T2 阻塞，T3 不可达） |
| 16 | 第一个有 assignee、第二个无 → 返回第一个 | parent(terminal) → [T1(initial,R1), T2(initial,无assignee)] | 返回 T1 |
| 17 | 无 assignee 阻塞仅限当前 subtree | root(terminal) → [A(terminal)→[A1(initial,无assignee)], B(initial,R1)] | null（A1 阻塞返回 null，但 B 是兄弟不是 A1 的兄弟...需要明确）|

对 #17 的澄清：DFS 遍历中 A1 无 assignee 返回 null → A 子树无结果 → 继续遍历 B → B 是 initial+R1 → **返回 B**。阻塞仅限当前节点，不阻塞父级的兄弟子树。

| 17 | 无 assignee 阻塞仅限当前 subtree | root(terminal) → [A(terminal)→[A1(initial,无)], B(initial,R1)] | 返回 B |
| 18 | 同一父下阻塞：T2 无 assignee 阻塞 T3 | parent(terminal) → [T1(terminal), T2(initial,无), T3(initial,R1)] | null（findInChildren 遇到 T2 返回 null，不继续到 T3... 不对，是 for 循环继续）|

对 #18 的再澄清：`findInChildren` 中 for 循环遍历每个 child，`findInSubtree(T2)` 返回 null → **继续循环到 T3** → 返回 T3。**阻塞不传播给兄弟**。

重新定义阻塞行为测试：

| # | 用例 | 任务树 | 期望 |
|---|------|--------|------|
| 15 | 无 assignee 的任务被跳过，不阻塞兄弟 | parent(terminal) → [T1(terminal), T2(initial,无assignee), T3(initial,R1)] | 返回 T3 |
| 16 | 所有子任务都无 assignee → null | parent(terminal) → [T1(initial,无), T2(initial,无)] | null |
| 17 | 子树 A 全阻塞，子树 B 可调度 | root(terminal) → [A(terminal)→[A1(initial,无)], B(initial,R1)] | 返回 B |
| 18 | 有 assignee 的优先被找到（createdAt 较早） | parent(terminal) → [T1(initial,R1,earlier), T2(initial,无,later)] | 返回 T1 |

### 2.5 深度限制

| # | 用例 | 期望 |
|---|------|------|
| 19 | depth=10 的任务仍可调度 | 10 层嵌套 → 最深的 initial 任务被返回 |
| 20 | depth=11 → 不调度 | 11 层嵌套的 initial 任务 → null，记录 warn |

### 2.6 混合状态场景

| # | 用例 | 任务树 | 期望 |
|---|------|--------|------|
| 21 | active 子任务跳过，initial 子任务返回 | parent(terminal) → [T1(active), T2(initial,R1)] | 返回 T2 |
| 22 | approval 子任务跳过 | parent(terminal) → [T1(approval), T2(initial,R1)] | 返回 T2 |
| 23 | 全部子任务 terminal 且无孙任务 → null | parent(terminal) → [T1(terminal), T2(terminal)] | null |
| 24 | 全部子任务 active → null | parent(terminal) → [T1(active), T2(active)] | null |
| 25 | category 查找返回 null（未知状态） → 跳过 | task.status 不在 schema 中 → getStatusCategory 返回 null → 跳过 |

### 2.7 多根任务

| # | 用例 | 期望 |
|---|------|------|
| 26 | 多个根任务按 createdAt 排序 | root-A(terminal,earlier), root-B(initial,R1,later) → 先查 A 子树，无结果 → 返回 B |
| 27 | 第一个根任务有可调度子任务 → 返回它 | root-A(terminal)→[child(initial,R1)], root-B(initial,R1) → 返回 child（DFS 先深入 A） |

---

## 3. Orchestrator 单元测试

文件：`tests/unit/orchestrator/orchestrator.test.ts`

### 3.1 scheduleNext

| # | 用例 | 期望 |
|---|------|------|
| 1 | TaskScheduler 返回可调度任务 → transition 到 active 状态 | findNextTask 返回 task → getAvailableTransitions 找到 active 目标 → taskStateMachine.transition 被调用 |
| 2 | TaskScheduler 返回 null → 不操作 | findNextTask 返回 null → transition 不被调用 |
| 3 | 无 active transition 目标 → 记录 warn 不操作 | getAvailableTransitions 返回空 或 全部非 active → 不调用 transition |
| 4 | transition 成功 → taskId 加入 scheduledTaskIds | transition 后 onTaskStatusChanged 使用 'task_scheduled' |
| 5 | transition 抛异常 → 不崩溃 | taskStateMachine.transition 抛 TaskStateError → 被捕获，不影响 Orchestrator |

### 3.2 onTaskStatusChanged — wakeReason 区分

| # | 用例 | 期望 |
|---|------|------|
| 6 | scheduledTaskIds 中存在 → reason='task_scheduled' | scheduleNext 添加 taskId → onTaskStatusChanged → tryWake 使用 'task_scheduled' |
| 7 | scheduledTaskIds 中不存在 → reason='task_assigned' | 用户手动触发 → tryWake 使用 'task_assigned' |
| 8 | 使用后从 Set 中删除 | scheduledTaskIds.has(taskId) 第一次 true → delete → 第二次 false |
| 9 | 无 assigneeRoleId → 不 tryWake | assigneeRoleId 为空 → 跳过 |
| 10 | pausedTasks 中 → 不 tryWake | taskId 在 pausedTasks 中 → 跳过 |

### 3.3 onTaskApprovalConfirmed — 级联触发

| # | 用例 | 期望 |
|---|------|------|
| 11 | 审批通过 → 从 pausedTasks 移除 + scheduleNext | pausedTasks.delete(taskId) 被调用 + scheduleNext(orgId) 被调用 |
| 12 | 不再直接 tryWake 自身 | 旧逻辑 tryWake(task.assigneeRoleId, ...) 不被调用 |

### 3.4 onTaskCompleted — 自动冒泡

| # | 用例 | 期望 |
|---|------|------|
| 13 | 任务完成 → behaviorEngine.onChildCompleted 被调用 | 事件 payload 包含 taskId → findById → onChildCompleted(task) |
| 14 | 任务完成 → scheduleNext 被调用 | onChildCompleted 之后 scheduleNext(orgId) |
| 15 | task 未找到 → 直接返回 | findById 返回 null → 不调用 behaviorEngine |
| 16 | 从 pausedTasks 中移除 | pausedTasks.delete(taskId) |

### 3.5 onRunEnded — 队列消费 + 调度

| # | 用例 | 期望 |
|---|------|------|
| 17 | run:succeeded → drainPendingWakes + scheduleNext | 两者都被调用 |
| 18 | run:failed → onRunFailed + drainPendingWakes + scheduleNext | 三者都被调用 |
| 19 | run:cancelled → drainPendingWakes + scheduleNext | 两者都被调用 |

### 3.6 drainPendingWakes

| # | 用例 | 期望 |
|---|------|------|
| 20 | 队列有 wake + gate 允许 → 执行 | findNext 返回 wake → validate 返回 allowed → executeForTask 被调用 |
| 21 | 队列有 wake + gate 阻塞 → 重新入队 | validate 返回 not allowed → delete 旧的 + create 新的（放回） |
| 22 | 队列为空 → 不操作 | findNext 返回 null → 不调用 validate |
| 23 | executeForTask 失败 → 记录 error 不崩溃 | promise reject → catch 记录日志 |
| 24 | 消费后 wake 从队列移除 | delete(wake.id) 被调用 |

### 3.7 事件订阅完整性

| # | 用例 | 期望 |
|---|------|------|
| 25 | start() 订阅所有必要事件 | task:status-changed, task:entered-approval, task:approval-confirmed, task:completed, conversation:response-needed, conversation:resolved, run:failed, run:succeeded, run:cancelled 都被订阅 |
| 26 | 重复调用 start() 不重复订阅 | 或者至少不导致 handler 执行两次 |

### 3.8 幂等性

| # | 用例 | 期望 |
|---|------|------|
| 27 | 并发 scheduleNext 不重复调度 | 两次 scheduleNext：第一次 transition 成功 → 任务离开 initial → 第二次 findNextTask 不返回同一任务 |
| 28 | drainPendingWakes 消费一个 wake 后 scheduleNext 被 gate 阻塞 | drain 启动 run → scheduleNext → tryWake → WakeGate: activeRun exists → PendingWake |

---

## 4. TaskStateMachine 追加测试

文件：`tests/unit/workflow/task.state-machine.test.ts`（追加到已有文件）

### 4.1 BehaviorEngine 接入

| # | 用例 | 期望 |
|---|------|------|
| 1 | transition 成功后调用 behaviorEngine.onStatusEnter | transition('task-1', 'approved') → behaviorEngine.onStatusEnter 被调用，参数为更新后的 task |
| 2 | transition 验证失败 → 不调用 onStatusEnter | validateTransition 返回 false → 抛 TaskStateError → onStatusEnter 不被调用 |
| 3 | 同状态 transition → 不调用 onStatusEnter | currentStatus === newStatus → 直接返回 → onStatusEnter 不被调用 |
| 4 | onStatusEnter 抛异常 → transition 自身的状态更新和事件已完成 | BehaviorEngine 异常不影响 transition 核心逻辑（或需确认错误传播策略） |
| 5 | BehaviorEngine 触发二次 transition → 级联执行 | subtask transition→approved → onStatusEnter → Rule: transition→done → transition 再次被调用 |

---

## 5. 集成测试 — 级联执行场景

文件：`tests/integration/cascade-execution.test.ts`

这些测试使用 mock 但模拟完整的事件链，验证多个模块协同工作。

### 5.1 Default Schema — 完整级联

| # | 场景 | 步骤 | 期望结果 |
|---|------|------|---------|
| 1 | Epic → 2 Story → 各 2 Task 全自动完成 | 1. 创建 epic(initial,PM) 2. scheduleNext → epic active 3. 模拟 AI 创建 2 story 4. epic→approval 5. 审批 epic→approved 6. BehaviorEngine: epic 非叶子不自动转 7. scheduleNext→storyA active 8. 模拟创建 2 task 9. storyA→approval 10. 审批→approved 11. scheduleNext→taskA1 12. taskA1→approved→auto done 13. scheduleNext→taskA2 14. taskA2→done 15. allChildrenTerminal→storyA done 16. scheduleNext→storyB... 17. 最终 epic→done | 所有任务最终都是 terminal |
| 2 | 叶子任务 approved → 自动 done | subtask→approved → BehaviorEngine → transition→done | 状态变为 done |
| 3 | 所有子任务完成 → 父任务自动 done | storyA 下 2 个 task 都 done → onChildCompleted → story→done | story 状态变为 done |

### 5.2 审批流相关

| # | 场景 | 期望 |
|---|------|------|
| 4 | Epic 进入 approval → 暂停调度 | epic → awaiting_review → pausedTasks.add → scheduleNext 不会调度 epic |
| 5 | 审批通过后恢复调度 | confirmApproval → onTaskApprovalConfirmed → pausedTasks.delete → scheduleNext 找到子任务 |
| 6 | 审批拒绝 → 不触发调度 | rejectApproval → task:approval-rejected → 不调用 scheduleNext |

### 5.3 故障与恢复

| # | 场景 | 期望 |
|---|------|------|
| 7 | 子任务被 cancel → 不阻塞兄弟调度 | T1(cancelled=terminal) → T2(initial) → scheduleNext 返回 T2 |
| 8 | 子任务 cancel + 兄弟完成 → allChildrenTerminal 仍触发 | T1(cancelled), T2(done) → 全部 terminal → 父任务自动 done |
| 9 | 子任务部分 cancel 部分 done → 父任务仍自动完成 | 因为 cancelled 也是 terminal |
| 10 | run:failed → retry → 最终成功 → 继续调度 | onRunFailed → retryScheduler → 成功后 run:succeeded → onRunEnded → scheduleNext |
| 11 | budget 耗尽 → 调度停止 | WakeGate: budget exceeded → PendingWake 入队 → 不执行 |

### 5.4 边界与退化

| # | 场景 | 期望 |
|---|------|------|
| 12 | 空组织（无任务） | scheduleNext → null → 不操作 |
| 13 | 单个叶子根任务 | task(initial,R1) → 调度 → 完成 → 无 parent → 结束 |
| 14 | 所有任务已完成 | 全部 terminal → findNextTask 返回 null |
| 15 | 深度 10 层可调度 | 10 层 terminal 嵌套 → 第 11 层 initial → 返回它 |
| 16 | 深度 11 层不可调度 | 11 层 terminal 嵌套 → 最深 initial → null |

### 5.5 PendingWake 队列

| # | 场景 | 期望 |
|---|------|------|
| 17 | gate 阻塞 → wake 入队 → run 结束 → drain 执行 | tryWake blocked → create PendingWake → run:succeeded → drainPendingWakes → executeForTask |
| 18 | 多个 PendingWake → drain 只消费一个 | 队列有 2 个 wake → findNext 返回优先级最高的一个 → 只执行一个 |
| 19 | drain 后仍阻塞 → 放回队列 | drain → validate → still blocked → create 放回 |

### 5.6 自定义 Schema 兼容

| # | 场景 | 期望 |
|---|------|------|
| 20 | 极简 schema (open→working→closed) | 叶子进入 closed(terminal) → behaviorRule transition→closed → 但已经是 closed → 同状态跳过 |
| 21 | 自定义 schema 无 behaviorRules → 无自动行为 | 任务完成后不会自动冒泡 → 需要手动操作 |
| 22 | 自定义 schema 的 initial → active transition 名不同 | scheduleNext 从 getAvailableTransitions 动态查找 → 找到正确的 active 目标 |

### 5.7 递归冒泡终止

| # | 场景 | 期望 |
|---|------|------|
| 23 | 三层冒泡: task→done → story→done → epic→done | 每层 onChildCompleted → allTerminal → transition → task:completed → 下一层 onChildCompleted |
| 24 | 根任务完成 → 冒泡终止 | epic→done → onTaskCompleted → task.parentId=null → return（不继续冒泡） |
| 25 | 冒泡过程中不触发 scheduleNext 重复调度 | 每层 onTaskCompleted 都调用 scheduleNext → 但此时所有任务已 terminal → findNextTask 返回 null |

---

## 6. 测试工具函数

为测试文件提供通用工具：

```typescript
// tests/helpers/task-factory.ts

function createTask(overrides?: Partial<Task>): Task {
  return {
    id: 'task-1',
    orgId: 'org-1',
    parentId: null,
    type: 'task',
    title: 'Test Task',
    description: '',
    status: 'pending',
    assigneeRoleId: 'role-1',
    depth: 0,
    artifactPaths: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function createDefaultSchema(): ProcessSchema {
  // 返回 default.json 的 schema 对象
  // 包含新的 behaviorRules 格式
}

function createMinimalSchema(): ProcessSchema {
  // open → working → closed 的极简 schema
  // 用于自定义 schema 兼容性测试
}
```

---

## 7. 覆盖率要求

| 模块 | 行覆盖率目标 | 分支覆盖率目标 | 重点分支 |
|------|------------|------------|---------|
| BehaviorEngine | ≥95% | ≥90% | 每个 operator、每种组合逻辑、重入防护 |
| TaskScheduler | ≥95% | ≥90% | 每个 category 路径、阻塞分支、深度限制 |
| Orchestrator (新增部分) | ≥90% | ≥85% | scheduleNext 各分支、drainPendingWakes 各分支、wakeReason 区分 |
| 集成测试 | — | — | 至少覆盖提案第 9 节完整事件流 |

---

## 8. 测试用例总计

| 模块 | 用例数 |
|------|-------|
| BehaviorEngine — 条件表达式 | 34 |
| BehaviorEngine — Context 构建 | 8 |
| BehaviorEngine — Trigger/排序 | 5 |
| BehaviorEngine — Action 执行 | 4 |
| BehaviorEngine — onStatusEnter | 4 |
| BehaviorEngine — onChildCompleted | 5 |
| BehaviorEngine — 重入防护 | 5 |
| BehaviorEngine — 自定义 Schema | 3 |
| TaskScheduler — 基本调度 | 7 |
| TaskScheduler — DFS | 4 |
| TaskScheduler — 排序 | 3 |
| TaskScheduler — 阻塞语义 | 4 |
| TaskScheduler — 深度限制 | 2 |
| TaskScheduler — 混合状态 | 5 |
| TaskScheduler — 多根任务 | 2 |
| Orchestrator — scheduleNext | 5 |
| Orchestrator — wakeReason | 5 |
| Orchestrator — approval | 2 |
| Orchestrator — completed | 4 |
| Orchestrator — onRunEnded | 3 |
| Orchestrator — drainPendingWakes | 5 |
| Orchestrator — 事件订阅 | 2 |
| Orchestrator — 幂等性 | 2 |
| TaskStateMachine — BehaviorEngine 接入 | 5 |
| 集成 — 完整级联 | 3 |
| 集成 — 审批流 | 3 |
| 集成 — 故障恢复 | 5 |
| 集成 — 边界退化 | 5 |
| 集成 — PendingWake | 3 |
| 集成 — 自定义 Schema | 3 |
| 集成 — 递归冒泡 | 3 |
| **总计** | **148** |
