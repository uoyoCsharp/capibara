---
document_type: 'implementation-roadmap'
parent_prd: 'prd-conversational-task-planning.md'
project_name: 'capibara'
feature_name: 'Conversational Task Planning — MVP Slice'
version: '0.2 (conversation-only; no planning task)'
date: '2026-05-06'
status: 'awaiting-review'
authors: ['uoyo', 'Winston (Architect)']
---

# Roadmap: Conversational Task Planning (MVP)

> **目的**：把 PRD `prd-conversational-task-planning.md` 切成一个**最小可用切片**，先让"聊几句 → AI 拆树 → 人审 → 批量创建 → 自动执行"这条主路径跑通。BMAD 三阶段、复杂编辑、phase indicator 等放到 P1。

---

## 1. 范围界定

### 1.0 核心建模原则（v0.2 修订）

**Planning 对话不是一个 task**。它是一次独立的、任务树之外的 human↔AI 自由对话，目的是产出任务树（作为其产物），而不是成为任务树的一部分。

具体含义：
- Planning 对话对应一个 `conversation` 记录，**`taskId = null`**
- 驱动 Planning Agent 的 run 走 **conversation-only run** 路径（`RunCoordinator.executeForConversation`，已存在）
- approve 后批量创建出的任务都是 **root-level tasks**（parentId = null），它们和 planning 对话**无父子关系**
- Planning 对话在 approve/discard 后进入终态，UI 侧可选择保留历史或归档，但**不出现在 Tasks 视图**
- Tasks 视图 永远只显示真实的执行任务，绝不混入 "Planning" 这种语义

### 1.1 MVP 必须有（In）

| 能力 | 说明 |
|---|---|
| 一个"Planning"入口 | Dashboard 或空态 CTA，点击进入对话页 |
| 对话页 | 多轮 human ↔ AI，基于 conversation-only run（无 task） |
| AI 自主判断交树 | 对话中 AI 决定"信息够了"就调 MCP 工具交一棵 tree |
| 树预览 + approve/discard/refine | 复用现有 `PlanTreeReview` 流程 |
| 批量创建 + 自动执行 | approve 后 depth-first 建 **root tasks** → scheduleNext |

### 1.2 MVP 明确推迟（Out — 放 P1）

| 能力 | 推迟理由 |
|---|---|
| BMAD 三阶段 prompt 注入（Diverge/Focus/Structure） | 工程量大，阶段化逻辑未验证产品价值；MVP 用单一 prompt 让 Agent 自由发挥 |
| `PlanningPhaseIndicator` UI | 没有阶段概念时无需展示 |
| 树预览的 inline 编辑 / delete | `PlanTreeReview` 现有 refine 循环能覆盖基本修改需求 |
| 自动识别 PM 角色 | MVP 用用户显式选择 Planning Agent 角色，避免做不准时黑盒失败 |
| 会话中断恢复 | 依赖现有对话持久化，无额外工作；但明确的 "resume UI" 推迟 |
| i18n 中英双语 | MVP 只先过英文，文案 stub 化，i18n 整体迁移另做 |

### 1.3 明确的非目标

- **不新建** Planning 专用 run 类型或特殊 ExecutionEngine 分支 —— 复用 task-scheduled run
- **不引入** 独立的 "planning" 状态机 —— 复用 conversation workflow
- **不动** 现有 preview/eager 模式 —— 它们作为"我已经有清晰需求，直接拆"的快速通道并存

---

## 2. 目标用户路径（MVP 版）

```
1. Dashboard 点 "Start with AI Planning"
   ↓
2. 弹出 "Pick planning agent" 选择器（一次性）
   ↓
3. 跳转到 Planning 页（新增 section）
   - 左：对话消息流
   - 右：tree preview 占位（AI 还没交树时显示提示）
   ↓
4. 用户输入第一条消息："I want to build a note-taking app"
   ↓
5. Planning Agent 多轮追问（2-6 轮）
   - 项目目标、用户、核心功能、约束
   ↓
6. AI 调 capibara_plan_tasks 交树 → 右侧 tree preview 显亮
   - 对话继续可用（AI 等 human 反馈）
   ↓
7. 用户在 tree preview 点 Approve
   - 批量创建 tasks → 自动执行启动
   - 跳到 Tasks 页看进度
```

---

## 3. 实施切片（按依赖顺序）

### Slice 1 — Backend 骨架（~1 天）

**目标**：IPC + conversation-only run + MCP 工具三条腿立起来，能用 devtools 级别的测试脚本从"建对话"走到"交树"。

| 任务 | 文件 | 产出 |
|---|---|---|
| 1.1 新增 `ConversationService.createPlanning(orgId, agentRoleId, firstMessage)` | `src/core/modules/conversation/services/conversation.service.ts` | 创建 type=`'planning'`、**taskId=null** 的 conversation，写入首条消息 |
| 1.2 新增 IPC `capibara:planning:start` → 创建 conversation + 调用 `RunCoordinator.executeForConversation()` | `src/core/ipc-handlers/planning.handlers.ts`（新文件） | 前端可以发起 planning 会话；无需创建 task |
| 1.3 **改造**现有 MCP 工具 `capibara_plan_submit_tree`：参数支持 `rootTaskId` 或 `conversationId` 二选一；conversation 场景下 mode 固定 `preview`、跳过 root 类型校验；事件载荷扩展 | `src/core/modules/mcp/handlers/plan-tree-tools.ts` | 同一工具支持两种锚点；AI 使用一致、验证逻辑零重复 |
| 1.4 `pending_plan_trees` schema 扩展：允许 `source_task_id` 为 null，新增 `source_conversation_id` 列 + 至少一个非空的 CHECK 约束 | `src/core/infrastructure/persistence/sqlite/migrations.ts` | 接受 conversation-only 来源的 tree |
| 1.5 组装 planning prompt | `src/core/modules/prompt/strategies/`（conversation-prompt 分支新增 planning scenario） | 一份通用 planning prompt（MVP 不分阶段）|
| 1.6 验证 conversation-only 的 `conversation_workflow` 工作：AI ask_question → human reply → AI resumes | `src/core/modules/conversation/...`（已有基建，只需验证）| 多轮对话能跑 |

**验收**：手动 (via devtools) 调 `startPlanning` → 触发 AI run → conversation 出现 AI 回复 → 多轮后 AI 调 `capibara_plan_tasks` → `pending_plan_trees` 表有记录（`source_task_id=null, source_conversation_id=<id>`）+ conversation 仍可继续；同期**不会在 tasks 表产生任何记录**。

---

### Slice 2 — Batch 创建 + 自动执行（~半天）

**目标**：approve pending tree 后，任务**作为 root-level tasks** 批量落地并自动启动。

| 任务 | 文件 | 产出 |
|---|---|---|
| 2.1 扩展 `PlanningService.approvePlanTree()`：检测到 conversation-only 来源时，调 `TaskService.batchCreate(orgId, parentId=null, items)` | `src/core/modules/planning/planning.service.ts` | 树的根节点变为 root tasks，没有虚拟 parent |
| 2.2 batchCreate 完成后，emit `task:created` 事件并调 `TaskOrchestrator.scheduleNext(orgId)` | 同上 | 第一个可执行的叶子任务被调度，用户无需手动点 |
| 2.3 conversation 状态收敛：approve 成功 → 标记 conversation 为 `resolved` 并 resolve workflow | `PlanningService` + `ConversationService` | 对话闭合，不会继续 wake |
| 2.4 补单测：approve 后 N 个 root task 落库（parentId = null）+ scheduleNext 被调用 + conversation → resolved | `tests/unit/planning/planning.service.test.ts` | 回归防线 |

**验收**：单测覆盖 approve → batchCreate → scheduleNext → conversation resolved；手动验证 approve 后 Tasks 页能看到**多棵 root task 树**（不是挂在某个 planning 容器下）+ 第一个任务进入 `in_progress` + Planning 页显示"已完成，任务已创建"终态。

---

### Slice 3 — UI 主路径（~1.5 天）

**目标**：从 Dashboard 能点进去、能聊、能看到树、能批准。

| 任务 | 文件 | 产出 |
|---|---|---|
| 3.1 `SectionId` 加 `'planning'` + 路由 | `src/core/shared/types.ts` + 渲染层路由配置 | 新 section 可访问 |
| 3.2 新组件 `PlanningPage` | `src/renderer/components/planning/PlanningPage.tsx` | 两栏布局：左对话 右树 |
| 3.3 `PlanningChat` 子组件（复用 `InboxPage` 的消息渲染）| `src/renderer/components/planning/PlanningChat.tsx` | 消息列表 + 输入框 |
| 3.4 `PlanPreviewPane` 子组件（复用 `PlanTreeReview`）| `src/renderer/components/planning/PlanPreviewPane.tsx` | 树展示 + approve/discard/refine 按钮；AI 未交树时显空态提示 |
| 3.5 Dashboard 加 "Start with AI Planning" 按钮 | `src/renderer/components/dashboard/DashboardPage.tsx` | 入口；点击弹 Agent Picker |
| 3.6 `PlanningAgentPicker` modal | `src/renderer/components/planning/PlanningAgentPicker.tsx` | 列出 org 所有非系统角色供选择 |
| 3.7 Preload 暴露新 IPC | `src/core/preload/index.ts` + `src/core/shared/api.ts` | `startPlanning` 入口 |
| 3.8 订阅 `plan-tree:submitted` 事件 → 刷新右侧树 | 组件内 `useEventSubscription` | AI 交树后实时出现 |

**验收**：E2E 手动 —— 从 Dashboard 点按钮 → 选 agent → 聊几轮 → 看到树 → approve → Tasks 页出现任务树 + 自动跑起来。

---

### Slice 4 — 边界与状态收敛（~半天）

**目标**：常见出错路径不崩；Planning 页重进能恢复。

| 任务 | 产出 |
|---|---|
| 4.1 Planning 页首次进入时，若已有未完成 planning conversation（该 org）→ 直接恢复，不再新建 | 断网/刷新场景不丢对话 |
| 4.2 AI 调 `capibara_plan_tasks` 失败（类型/角色 ID 无效）时，把错误原样回给 AI → 它能再试 | 已有 PlanTree 验证机制可复用 |
| 4.3 approve 批量创建中途失败 → 事务回滚 + 给用户明确错误提示 | `TaskService.batchCreate` 用 sqlite transaction 包一层 |
| 4.4 loading 态：AI 思考中 / 批量创建中 显 spinner，禁用输入 | 防止用户焦虑与重复操作 |

**验收**：列一张手工测试清单，每条跑一遍。

---

## 4. 关键架构决策（待你拍板）

这几处 MVP 选型偏向"最简"，但都会影响未来扩展。请逐条确认。

| ID | 决策点 | 我推荐 | 权衡 |
|---|---|---|---|
| **M-01** | Planning Agent 角色选择 | 用户从 org 角色列表里**显式选**一个 | vs 自动选 PM 角色。显式选 → 零黑盒；自动选 → 省一步但依赖 role skills 元数据 |
| **M-02** | Planning 对话和树的绑定 | `pending_plan_trees` 表**增加 `source_conversation_id` 列**；approve 时清理该 conversation | vs 在 conversation metadata 里存 pendingTreeId。选前者是因为：一个 conversation 可能交多棵树（refine），倒置的 1:N 更自然 |
| **M-03** | Planning Agent 的 prompt | MVP 用**单一通用 planning prompt**，不分 BMAD 阶段 | 未来可加 `phase` 字段驱动阶段化注入 |
| **M-04** | Planning 的建模 | **Conversation-only，无 task**。Planning 对话是独立实体，`taskId = null`，走 `RunCoordinator.executeForConversation` 路径 | vs 伪造 Planning task 挂在树上。用户明确要求不引入 Planning task 概念 —— 更符合产品语义："聊天产出树"，不是"聊天是一个任务" |
| **M-05** | Approve 后产出的 tree 的根挂在哪 | **产出 tree 的根节点直接作为 root tasks**（parentId = null）批量创建 | 树可能是多棵并行的，也可能是单棵。MVP 不加虚拟容器 |
| **M-06** | Batch 创建失败策略 | **全部回滚**（事务） | vs 部分创建 + 报错。全回滚更安全，PRD 原文也是原子创建 |
| **M-07** | `capibara_plan_submit_tree` 的处理 | **改造现有工具复用**（不新建、不改名）。`rootTaskId` 变可选，新增可选 `conversationId`，二者必须恰好一个非空；conversation 场景下 mode 固定 preview、跳过 root 类型校验；事件载荷 rootTaskId/conversationId 二选一 | vs 新建独立工具 / 改名。复用可让 AI 使用一致、验证逻辑零重复；单一工具承载两种锚点的代价是 schema 分支，属可控复杂度 |
| **M-08** | Preview/Eager 模式的未来 | **不动**，作为"我已有清晰需求"的快速路径继续存在 | 和新 Planning flow 并存；之后看数据决定是否合并 |
| **M-09** | `pending_plan_trees` 表的 source 建模 | **source_task_id 允许 null**，新增 `source_conversation_id`，CHECK 约束至少一个非空 | 现有表只认 task 来源；需要破坏性迁移（MVP 项目全新，M2 直接改 schema）|
| **M-10** | Planning conversation 在 approve 后的命运 | **resolve** 并保留历史，可在"Planning History"次要视图回看；MVP 不做"resume 未完成对话"以外的导航 | vs 删除对话。保留有利于 debug / 审计 / 之后做 analytics |

---

## 5. 工作量估算

| Slice | 工时 | 依赖 |
|---|---|---|
| Slice 1 — Backend 骨架 | ~1 天 | 无 |
| Slice 2 — Batch + 自动执行 | ~0.5 天 | Slice 1 |
| Slice 3 — UI 主路径 | ~1.5 天 | Slice 1（IPC 已就位）|
| Slice 4 — 边界与状态 | ~0.5 天 | Slice 3 |
| **总计** | **~3.5 天** | 按单人连续投入 |

**假设**：不含 BMAD 阶段化、i18n 迁移、完整 E2E 测试套件。这三项做完再加 ~2 天。

---

## 6. 风险与预警

| 风险 | 概率 | 影响 | 应对 |
|---|---|---|---|
| AI 在对话中**忘记**它需要调 `capibara_plan_tasks`，无限聊 | 中 | 高 | prompt 明确"最多 N 轮后必须交树"；UI 给用户手动"Force plan now"按钮 |
| AI 交的树类型/角色 ID 不合法 | 中 | 低 | 已有树 validation；错误回给 AI 让它 retry |
| 用户中途关闭窗口 → conversation 挂住 | 低 | 低 | 现有 conversation 持久化已覆盖；重进恢复即可 |
| Batch 创建的 10+ 个任务一起触发 scheduleNext，gate 并发冲突 | 低 | 中 | 现有 `WakeGateValidator` 已限 org 级并发，多余 wake 进 `pending_wakes` 队列 |
| Planning task 自动 done（M-05）触发 behavior rule 异常 | 低 | 中 | 单测覆盖；BehaviorEngine 已加 try-catch 保护 |

---

## 7. 验收标准（整体）

MVP 成功的硬指标（手工验证）：

- [ ] 从 Dashboard 点按钮能进入 Planning 页
- [ ] 能选择 Planning Agent 并发起对话
- [ ] AI 能回复并在 2-6 轮内交出一棵合法 tree
- [ ] Tree preview 可见，approve 后 Tasks 页看到完整树
- [ ] **Tasks 表中没有任何 "Planning" 类型的任务 / 容器任务 / 虚拟父节点** —— tree 的根节点就是 Tasks 视图的 root
- [ ] 第一个叶子任务自动进入 `in_progress` 无需手动 Start
- [ ] approve 后 Planning conversation 状态为 `resolved`，UI 可回看历史但不再接收 AI 输出
- [ ] refine feedback 能把 AI 拉回来重交一棵树

**非硬指标但期望**：

- [ ] 对话中断关闭 app 后，重开能看到原对话历史
- [ ] AI 交树失败（类型错误）时，能自动 retry 不至崩溃
- [ ] 批量创建过程任何一步失败都能回滚

---

## 8. 下一步

**在动手之前**，希望你确认：

1. **路线本身**：Slice 1→4 的切分和顺序 OK 吗？有没有希望拆得更细 / 顺序调整？
2. **架构决策 M-01 到 M-08**：有没有想改的？特别关注 M-01（角色选择方式）和 M-05（Planning task 的命运）—— 这两点会影响 UX 手感
3. **范围 § 1.1/1.2**：有没有"我说 Out 了但你觉得必须 In"的？或者反过来？
4. **工时节奏**：3.5 天完整 MVP 是否符合你的节奏预期？如果想更极简我可以再剪一刀（比如把 PlanningAgentPicker 变成 settings 里预配置的 org-level 默认值）

拍完这 4 组问题我就开工 Slice 1。
