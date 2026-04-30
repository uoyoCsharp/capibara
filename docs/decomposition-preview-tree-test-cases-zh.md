# 验收测试用例：一次性拆分预览 + 任务级规划模式

> 版本：v1 · 对应架构文档 `decomposition-preview-tree-architecture-zh.md`
>
> 用途：编码完成后作为验收标准。每条用例标注 **ID / 层级 / 优先级 / 前置 / 步骤 / 期望**。
>
> 层级：`U`=单元, `I`=集成, `E`=端到端, `UI`=前端交互
>
> 优先级：`P0`=必须通过, `P1`=应通过, `P2`=次要

---

## 0. 用例分组总览

| 分组 | 用例数 | 说明 |
|------|--------|------|
| A. 数据模型与 Schema | 6 | Task.planningMode、SQLite 约束、PlanTaskDraft 收紧 |
| B. Scenario 路由 | 10 | resolveScenario 的矩阵覆盖 |
| C. Prompt 构造 | 5 | 两个新场景 instructions + tool 白名单 |
| D. MCP 工具结构校验 | 18 | capibara_plan_submit_tree 边界 |
| E. PlanningService 分支 | 8 | eager / preview / refine / discard |
| F. IPC 层 | 7 | 4 个新 handler + task create 扩展 |
| G. 前端组件 | 10 | TaskCreateModal + PlanTreeReview |
| H. 端到端 | 8 | Layered / Eager / Preview / Refine / Discard 全链路 |
| I. 边界与故障注入 | 12 | 并发、超时、LLM 错误、数据损坏 |
| J. 回归 | 4 | Layered 模式不受影响 |
| **总计** | **88** | |

---

## A. 数据模型与 Schema（6 条）

### A-U-01 / P0 · `planning_mode` 列默认值
- **步骤**：插入一条 task，不指定 planning_mode。
- **期望**：列值为 `'layered'`；`SELECT planning_mode FROM tasks WHERE id=?` 返回 `'layered'`。

### A-U-02 / P0 · CHECK 约束拒绝非法值
- **步骤**：执行 `UPDATE tasks SET planning_mode='random' WHERE id=?`。
- **期望**：SQLite 抛出 constraint 错误；原值保持。

### A-U-03 / P0 · `Task` 类型字段暴露
- **步骤**：读取任一 task 的领域对象。
- **期望**：`task.planningMode` 字段存在且属于 `PlanningMode` 联合类型。

### A-U-04 / P0 · `PlanTaskDraft` 必填字段
- **步骤**：构造 `PlanTaskDraft`，省略 `description`/`assigneeRoleId`/`children` 任一字段。
- **期望**：TypeScript 编译失败；运行时 Zod 校验报错。

### A-U-05 / P1 · `CreateTaskInput` 接受 planningMode
- **步骤**：通过 `TaskService.create` 传入 `planningMode: 'eager'`。
- **期望**：落库后该字段为 `'eager'`。

### A-U-06 / P1 · 非 canDecompose 类型强制 layered
- **步骤**：对 `type='subtask'`（canDecompose=false）传入 `planningMode='preview'`。
- **期望**：`TaskService.create` 拒绝并返回错误 `INVALID_PLANNING_MODE_FOR_TYPE`。

---

## B. Scenario 路由（10 条）

通用前置：`ctx.task.isDecomposable` 由 `typeDef.canDecompose` 决定。

| ID | 优先级 | `isDecomposable` | `planningMode` | `wakeReason` | 期望 scenario |
|---|---|---|---|---|---|
| B-U-01 | P0 | true | layered | (空/default) | `propose_decomposition` |
| B-U-02 | P0 | true | preview | (default) | `preview_decomposition` |
| B-U-03 | P0 | true | eager | (default) | `eager_decomposition` |
| B-U-04 | P0 | false | layered | (default) | `execute_leaf` |
| B-U-05 | P0 | false | preview | (default) | `execute_leaf`（planningMode 对叶子类型无效） |
| B-U-06 | P0 | true | layered | `conversation_reply` | `execute_decomposition` |
| B-U-07 | P0 | true | preview | `conversation_reply` | `preview_decomposition`（refine 回路） |
| B-U-08 | P0 | true | eager | `conversation_reply` | `eager_decomposition`（refine 回路） |
| B-U-09 | P1 | true | preview | `review_revise` | `revision`（优先级高于 planningMode） |
| B-U-10 | P1 | true | eager | `retry_failed` | `retry_failed` |

---

## C. Prompt 构造（5 条）

### C-U-01 / P0 · preview 场景工具白名单
- **步骤**：构造 ctx 让 scenario=`preview_decomposition`，调用 `buildToolGuidance`。
- **期望**：输出仅包含 `capibara_plan_submit_tree` 与 `capibara_context`；**不含** `capibara_task_create_child` 与 `capibara_ask_question`。

### C-U-02 / P0 · eager 场景工具白名单
- 同上，scenario=`eager_decomposition`。
- **期望**：与 C-U-01 相同的白名单。

### C-U-03 / P0 · preview instructions 关键措辞
- **步骤**：构造 preview 场景的完整 prompt。
- **期望**：包含以下关键短语（至少匹配一处）：`review the tree`、`500`、`isLeaf=true`、`assigneeRoleId`、`do not call capibara_task_create_child`（大小写不敏感）。

### C-U-04 / P0 · eager instructions 关键措辞
- **期望**：包含 `no human review`、`directly actionable`、`500`、`isLeaf=true`、`assigneeRoleId`。

### C-U-05 / P1 · org hierarchy skills 注入
- **步骤**：preview/eager 场景下 subordinates 列表带 skillDescriptions。
- **期望**：prompt 的 Org Context 段落渲染 subordinate name + skills（与 `task-prompt.strategy.ts:198-212` 一致）。

---

## D. MCP 工具：`capibara_plan_submit_tree` 结构校验（18 条）

通用前置：
- 组织含 role `R-arch`、`R-dev-a`、`R-dev-b`、`R-qa`。
- 根任务 root = Epic (canDecompose=true)，planningMode=`preview`。
- Workflow schema 使用 default.json。

### D-U-01 / P0 · 合法最小树（只有根）
- **Input**：`{ rootTaskId, tree: { type:'epic', title, description, assigneeRoleId:'R-arch', children:[] } }`
- **期望**：拒绝。原因：Epic 非叶子但 children 为空。错误码 `NON_LEAF_MUST_HAVE_CHILDREN`。

### D-U-02 / P0 · 合法标准树（Epic → Story → Task → Subtask）
- **Input**：3 层嵌套，每层合法 child type，叶子为 subtask。
- **期望**：`ok:true`，`nodeCount` 正确，发 `plan-tree:submitted`。

### D-U-03 / P0 · 非法 type（层级错乱）
- **Input**：Epic 直接挂 Subtask child。
- **期望**：拒绝。错误码 `TYPE_NOT_IN_ALLOWED_CHILDREN`，错误信息列出合法 child types。

### D-U-04 / P0 · 非法 type（不存在）
- **Input**：某节点 type=`'foo'`。
- **期望**：拒绝。错误码 `UNKNOWN_WORK_ITEM_TYPE`。

### D-U-05 / P0 · 叶子类型却有 children
- **Input**：Subtask 节点带 children。
- **期望**：拒绝。错误码 `LEAF_CANNOT_HAVE_CHILDREN`。

### D-U-06 / P0 · 根节点 type 与 rootTask 不一致
- **Input**：rootTask 是 Epic，但 tree.type=`'story'`。
- **期望**：拒绝。错误码 `ROOT_TYPE_MISMATCH`。

### D-U-07 / P0 · 空 title
- **Input**：任一节点 title=''。
- **期望**：Zod 校验失败（`min(1)`）。

### D-U-08 / P0 · 空 description
- **Input**：任一节点 description=''。
- **期望**：Zod 校验失败。

### D-U-09 / P0 · 空 assigneeRoleId
- **Input**：任一节点 assigneeRoleId=''。
- **期望**：Zod 校验失败。

### D-U-10 / P0 · 非法 assigneeRoleId
- **Input**：assigneeRoleId=`'R-not-exist'`。
- **期望**：拒绝。错误码 `UNKNOWN_ROLE_ID`，错误信息列出合法 subordinates。

### D-U-11 / P0 · 跨组织 assigneeRoleId
- **Input**：roleId 属于别的 org。
- **期望**：拒绝。错误码 `UNKNOWN_ROLE_ID`（不泄漏跨组织信息）。

### D-U-12 / P0 · 节点数 = 500
- **Input**：精确 500 节点。
- **期望**：通过。

### D-U-13 / P0 · 节点数 = 501
- **Input**：501 节点。
- **期望**：拒绝。错误码 `TOO_MANY_NODES`，消息 `Too many nodes (501/500).`

### D-U-14 / P0 · 深度 = 10
- **Input**：恰好 10 层深。
- **期望**：通过。

### D-U-15 / P0 · 深度 = 11
- **期望**：拒绝。错误码 `DEPTH_EXCEEDED`。

### D-U-16 / P1 · rootTask 是 layered 模式
- **前置**：root 的 planningMode=`'layered'`。
- **期望**：工具调用拒绝，错误码 `TOOL_NOT_ALLOWED_IN_MODE`。

### D-U-17 / P1 · rootTaskId 不存在
- **期望**：拒绝。错误码 `ROOT_TASK_NOT_FOUND`。

### D-U-18 / P1 · children 字段缺失（非 []）
- **Input**：某非叶节点 `children` 字段不存在。
- **期望**：Zod 校验失败（children 为必填）。

---

## E. PlanningService 分支（8 条）

### E-U-01 / P0 · Eager 立即落库
- **前置**：eager 模式 root，收到合法 `plan-tree:submitted`。
- **期望**：调用 `taskService.batchCreate(orgId, rootTaskId, tree.children)` 一次；root 状态推进到下一 status；**不写入 pendingTrees**。

### E-U-02 / P0 · Preview 写入 pendingTrees
- **期望**：`pendingTrees.get(rootTaskId)` 返回对应 entry；发出 `plan-tree:ready`，payload 含 nodeCount 与 maxDepth；**不调用 batchCreate**。

### E-U-03 / P0 · Approve 触发落库
- **步骤**：Preview 已 pending → 调 `approvePlanTree(rootTaskId)`。
- **期望**：`batchCreate` 被调一次；pending 删除；root 状态推进。

### E-U-04 / P0 · Discard 清理并回 pending
- **步骤**：Preview 已 pending → 调 `discardPlanTree(rootTaskId, 'too large')`。
- **期望**：pending 删除；root 状态回到 `pending`；`planningMode` **保留不变**；发出 `plan-tree:discarded`。

### E-U-05 / P0 · Refine 保留 pending 并发会话消息
- **步骤**：Preview 已 pending → 调 `refinePlanTree(rootTaskId, 'split auth more')`。
- **期望**：pending **保留**；conversation 新增一条 human 消息内容为反馈；触发 wakeReason=`conversation_reply` 的新 run；**不立即清 pending**（等新 tree 覆盖）。

### E-U-06 / P0 · 并发 submit 后者覆盖
- **步骤**：同一 rootTaskId 的 preview 状态下连续收到两次 `plan-tree:submitted`。
- **期望**：pending 最终值 = 第二次；无 race；第一次的数据被 GC。

### E-U-07 / P1 · TTL 过期清理
- **步骤**：pending 写入后 mock 时钟 >24h，调用 `getPlanTree`。
- **期望**：返回 null；pending 被删除；root 回 `pending` 状态；UI 收到 `plan-tree:discarded` 事件。

### E-U-08 / P1 · Eager 落库中途失败
- **前置**：batchCreate 抛错（mock DB 故障）。
- **期望**：事务回滚（不部分落库）；root 进入 `revision` 或 `retry_failed` 状态；错误写日志。

---

## F. IPC 层（7 条）

### F-I-01 / P0 · `capibara:task:create` 接受 planningMode
- **步骤**：renderer 调 `createTask({ ..., planningMode:'preview' })`。
- **期望**：返回 ok；DB 该 task planning_mode=`'preview'`。

### F-I-02 / P0 · `plan-tree:get` 返回 pending
- 前置：pending 存在。期望：返回含 tree 的 PendingTree 对象。

### F-I-03 / P0 · `plan-tree:get` 无 pending
- 期望：返回 `null`（不是报错）。

### F-I-04 / P0 · `plan-tree:approve` 成功
- 期望：落库 + 返回 ok + 后续 `plan-tree:get` 返回 null。

### F-I-05 / P0 · `plan-tree:approve` 无 pending
- 期望：返回 err 码 `NO_PENDING_TREE`。

### F-I-06 / P0 · `plan-tree:discard` 成功
- 期望：pending 清除；root 回 pending；返回 ok。

### F-I-07 / P1 · `plan-tree:refine` 空 feedback
- **步骤**：feedback=''。
- **期望**：返回 err 码 `EMPTY_FEEDBACK`。

---

## G. 前端组件（10 条）

### G-UI-01 / P0 · TaskCreateModal：canDecompose=true 显示 PlanningModeSelector
- 期望：选择 type=Epic 时出现三选一；默认选中 Layered。

### G-UI-02 / P0 · TaskCreateModal：canDecompose=false 隐藏 selector
- 期望：选择 type=Subtask 时不渲染 selector；提交时不带 planningMode（默认 layered）。

### G-UI-03 / P0 · TaskCreateModal：切换 type 重置 mode 为 layered
- **步骤**：Epic+preview → 改选 Subtask → 再改回 Epic。
- **期望**：最后 mode 回到 Layered 默认。

### G-UI-04 / P0 · 横幅提示 pending tree
- 前置：task 详情页对应 rootTaskId 有 pending。
- 期望：页面顶部横幅 "AI 已生成拆分方案（N 节点），点击审阅"；点击进入 PlanTreeReview。

### G-UI-05 / P0 · PlanTreeReview 递归渲染
- 前置：mock 4 层树。
- 期望：DOM 中每层按缩进渲染；折叠按钮工作；节点徽标显示 type/assignee。

### G-UI-06 / P0 · Approve 按钮调 IPC
- 期望：点击触发 `approvePlanTree`；loading 态；成功后横幅消失。

### G-UI-07 / P0 · Discard 弹 confirm
- 期望：点击 Discard 弹原因输入框；取消则不调 IPC；确认则调用并清空预览。

### G-UI-08 / P0 · Refine 文本框
- 期望：输入反馈 → 提交 → loading "Waiting for AI…" → 新 tree 到达后替换。

### G-UI-09 / P1 · 空 feedback 阻止提交
- 期望：Refine 提交按钮 disabled。

### G-UI-10 / P1 · 节点 > 100 时默认折叠
- 期望：PlanTreeReview 打开后二级及以下折叠，头部提示"已折叠 X 个深层节点"。

---

## H. 端到端链路（8 条）

### H-E-01 / P0 · Layered 模式未受影响（回归）
- **步骤**：创建 Epic 不选 mode → 走现有 propose/approve 链路。
- **期望**：行为与实现前一致（见 §J 回归）。

### H-E-02 / P0 · Eager 完整链路
- **步骤**：创建 Epic 选 Eager → 观察 LLM 调 tool → 自动落库 → 子任务 scheduler 可调度。
- **期望**：DB 中 Epic 下挂 Story/Task/Subtask 完整树；root 状态推进；UI 列表立即刷新。

### H-E-03 / P0 · Preview 完整链路
- **步骤**：创建 Epic 选 Preview → LLM 提交 → UI 审阅 → Approve → 落库。
- **期望**：Approve 前 DB 无子任务；Approve 后完整落库；事件顺序 `plan-tree:submitted` → `plan-tree:ready` →（用户动作）→ `task:created` * N。

### H-E-04 / P0 · Preview → Refine → 重提交
- **步骤**：Preview 提交 → Refine 发反馈 → LLM 重交 → UI 自动刷新为新树 → Approve。
- **期望**：旧树被新树完全替换；DB 按新树落库。

### H-E-05 / P0 · Preview → Discard → 重发
- **步骤**：Preview 提交 → Discard → root 回 pending → scheduler 再次调度 → 新 LLM run → 新树提交。
- **期望**：新树与旧树独立；不污染历史。

### H-E-06 / P1 · Eager 模式 LLM 提交非法树后重试通过
- **步骤**：首次提交违反 type 规则 → LLM 收到错误 → 第二次提交合法树。
- **期望**：最终落库成功；首次错误记录在 run 日志。

### H-E-07 / P1 · Eager 模式 LLM 连续提交 3 次非法
- **期望**：run 标记 failed；root 回 pending 可手工重试；错误堆栈可查。

### H-E-08 / P2 · 同一 org 并发创建多个 preview 任务
- **步骤**：同时创建 3 个 Epic（不同 rootTaskId）全部 preview。
- **期望**：pendingTrees map 含 3 个独立条目；互不干扰。

---

## I. 边界与故障注入（12 条）

### I-U-01 / P0 · 树总节点数 = 500（刚好）
- 同 D-U-12，但走完 eager 落库：**期望** DB 精确落入 500 条任务（含 root 的 children）。

### I-U-02 / P0 · 树深度 = 10
- 同 D-U-14 + 走 eager 落库：**期望** 最深任务 depth=10；不超过 `task.scheduler.ts:35` 硬上限告警。

### I-U-03 / P1 · 单节点 title / description 超长
- **Input**：某节点 title 100k 字符。
- **期望**：Zod 校验通过（无上限约束）或根据字段 schema 拒绝；若通过，DB 能存储（SQLite TEXT 无长度限制）。

### I-U-04 / P1 · 循环引用（理论上 JSON 不可能，但兜底）
- **Input**：构造带自引用的 JSON（通过手工修改内存对象）。
- **期望**：遍历校验使用深度保护，不会无限递归；返回 `DEPTH_EXCEEDED`。

### I-U-05 / P1 · children 为空数组但类型非叶子
- **Input**：Epic / Story / Task（canDecompose=true 或 allowedChildren 非空）的 children=[]。
- **期望**：拒绝 `NON_LEAF_MUST_HAVE_CHILDREN`。

### I-U-06 / P0 · 同一树多个叶子分配给同一 role
- **期望**：允许（不是唯一性约束）。

### I-U-07 / P0 · 根任务 isLeaf=true
- **前置**：某 org 自定义 workflow 把 Epic 标成 isLeaf=true + canDecompose=false。
- **期望**：TaskCreateModal 不显示 mode selector；用户绕过前端直接 IPC 传 planningMode 时后端拒绝（见 A-U-06）。

### I-I-01 / P0 · LLM 超时
- **步骤**：mock LLM 10 min 无响应。
- **期望**：run 进入 failed；pendingTrees 不含条目；root 回 pending。

### I-I-02 / P0 · Tool 调用中 DB 异常
- **步骤**：mock batchCreate 抛错。
- **期望**：事务回滚；无部分数据；事件不发出；root 回 pending；错误日志。

### I-I-03 / P0 · 重复 submit 相同 tree
- **步骤**：LLM 重试机制导致同一 run 内连续两次提交相同 tree。
- **期望**：后者覆盖；不落两份库；pending map 大小不变。

### I-I-04 / P1 · pending tree 存在时用户直接在 Task 详情页点击 "execute"
- **期望**：被拒绝，提示"先审阅待定的拆分方案"。

### I-I-05 / P1 · Approve 过程中收到新 submit
- **步骤**：用户点 Approve 的同时 LLM refine 回来新 tree。
- **期望**：以先达到的为准（通过 pending entry 上的 version 号互斥）；另一侧给 renderer 提示"方案已变更，请重新审阅"。

---

## J. 回归（Layered 模式不受影响）（4 条）

### J-E-01 / P0 · Layered Epic 走 propose/approve
- **期望**：现有链路 scenario=`propose_decomposition` → `capibara_ask_question` → 上级批准 → `execute_decomposition` → 调 `create_child`。行为、事件、DB 操作与实现前完全一致。

### J-E-02 / P0 · Layered Task 执行叶子
- **期望**：scenario=`execute_leaf`；允许调 `capibara_task_transition`；不触发 plan-tree 链路。

### J-E-03 / P0 · Layered 模式下工具白名单不含 `plan_submit_tree`
- **期望**：LLM 在 layered 场景下看不到此工具。

### J-E-04 / P1 · Layered 任务不出现在 PlanTreeReview
- **期望**：`plan-tree:get` 对 layered task 返回 null；UI 不渲染横幅。

---

## 验收准入门槛

| 优先级 | 通过率要求 |
|--------|----------|
| P0 | **100%** 通过，方可合并到 main |
| P1 | ≥ **95%** 通过 |
| P2 | ≥ **80%** 通过，余下登记为已知问题 |

全部 P0 用例必须有自动化实现（单元或集成测试），UI 用例可用 Playwright / RTL。
故障注入（§I）中 I-I-* 类必须至少有一个自动化用例，其余可以手工验收。

---

## 附：常见 Fixture 约定

- **org hierarchy**：1 个 admin role + 2 个 dev roles（R-dev-a/R-dev-b）+ 1 个 qa role（R-qa）；admin 的 subordinates = [arch, dev-a, dev-b]；arch 的 subordinates = [dev-a, dev-b, qa]。
- **workflow**：使用 `default.json`。
- **时钟**：所有 TTL 相关用例用 `vi.useFakeTimers()` 推进时间。
- **LLM mock**：用 `mockLlmRespondWithToolCall(name, args)` 模拟工具调用；不连真实 API。
- **seedRoot**：helper `seedTaskTree(orgId, { type, mode, children })` 批量构造前置数据。

---

## 相关文档

- 架构：`docs/decomposition-preview-tree-architecture-zh.md`
- 方案对比：`docs/decomposition-strategy-proposal-zh.md`
