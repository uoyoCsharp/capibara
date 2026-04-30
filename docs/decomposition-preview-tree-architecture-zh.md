# 架构设计：一次性拆分预览 + 任务级规划模式（A+C）

> 版本：Draft v2 · 面向 code review
>
> 目标：在 Capibara 工作流体系上引入 `planningMode`，允许用户在发起任务时选择拆分策略。`preview` 模式下 AI 一次性输出完整可执行子孙树，用户在 UI 审阅确认后批量落库；`eager` 模式下 AI 一次拆到叶子并自动落库；`layered` 保留分层提议/批准流程作为默认。
>
> **项目状态**：全新项目，**允许破坏性更改**，不需要考虑向后兼容、数据迁移回填、feature flag 灰度。

---

## 1. 需求与范围

### 1.1 用户故事

- **US-1** — 作为 PM，在发起 Epic 时选择 `preview` 模式，AI 一次性生成 Story → Task → Subtask 全树方案。我在 UI 审阅后一键落库。
- **US-2** — 作为 Tech Lead，对范围明确的 Story 选择 `eager` 模式，AI 一次性拆到叶子并自动落库，无人工 gate。
- **US-3** — 默认 `layered` 模式保持现状。

### 1.2 明确不做的事

- 不修改工作项类型 schema（`default.json`）。Epic/Story/Task/Subtask 定义不变。
- 不引入新角色（Planner role 留给未来方案 D）。
- 不改动 review/approve 流程本身。
- 不改动 `task.scheduler.ts:35` 的 10 层硬上限（在业务层新增声明式校验）。
- **不保留 eager 模式下的任何人工 review gate**（含叶子完成时的 review）。用户选 eager 就是主动放弃所有审阅，完全信任 AI。

### 1.3 非功能需求

- **节点数上限 500**（单次 preview/eager 拆分）。
- **叶子节点必须指定 `assigneeRoleId`**（非空）。
- **并发安全**：同一 `rootTaskId` 的 pending tree 不能被并发覆盖。
- **不做兼容层**：schema 直接按目标形态设计，破坏性更改视为正常。

---

## 2. 现有代码锚点

| 能力 | 位置 |
|------|------|
| Task 数据模型 | `apps/electron/src/core/modules/workflow/types/workflow.types.ts:7-21` |
| Task 表结构 | `apps/electron/src/core/infrastructure/persistence/sqlite/migrations.ts:81-95` |
| Scenario 路由 | `apps/electron/src/core/modules/prompt/strategies/scenario.ts:13-28` |
| Prompt 构造 | `apps/electron/src/core/modules/prompt/strategies/task-prompt.strategy.ts:85-184` |
| `PromptContext` | `apps/electron/src/core/modules/prompt/types/prompt.types.ts:5-83` |
| 上下文构建 | `apps/electron/src/core/modules/prompt/context/run.context.ts:23-139`（`isDecomposable` @ line 120） |
| **PlanTaskDraft（已是树结构）** | `apps/electron/src/core/foundation/events.ts:161-179` |
| **TaskService.batchCreate（已支持递归落库）** | `apps/electron/src/core/modules/workflow/services/task.service.ts:74` |
| PlanningService | `apps/electron/src/core/modules/planning/planning.service.ts:26-90` |
| IPC handler 模板 | `apps/electron/src/core/ipc-handlers/planning.handlers.ts:7-34` |
| Preload bridge | `apps/electron/src/core/preload/index.ts:78-85` |
| PlanningPage | `apps/electron/src/renderer/components/planning/PlanningPage.tsx:1-213` |
| planning.store | `apps/electron/src/renderer/store/planning.store.ts:26-91` |
| TaskCreateModal | `apps/electron/src/renderer/components/tasks/TaskCreateModal.tsx:23-166` |
| `capibara_task_create_child` | `apps/electron/src/core/modules/mcp/handlers/task-tools.ts:62-89` |
| `capibara_ask_question` | `apps/electron/src/core/modules/mcp/handlers/conversation-tools.ts:9-35` |
| 事件总线 | `apps/electron/src/core/foundation/interfaces/i-event-bus.ts:5-9` |
| 事件 schema | `apps/electron/src/core/foundation/events.ts:185-226` |

> **关键前置条件**：`PlanTaskDraft` 已是嵌套树结构，`TaskService.batchCreate` 已能递归落库。本方案复用现有 planning 基础设施。

---

## 3. 顶层架构

```
┌──────────────────────────────────────────────────────────────┐
│ Renderer                                                     │
│   TaskCreateModal  (planningMode 三选一)                      │
│        │ create-task(planningMode)                           │
│        ▼                                                     │
│   Task 详情 / PlanningPage                                    │
│   └─ 预览树视图 ◀── 'plan-tree:ready' 事件 ◀──┐              │
│   └─ Approve / Discard / Refine(会话) ──────┼──┐             │
└─────────────────────────────────────────────┼──┼─────────────┘
                                              │  │
┌─────────────────────────────────────────────┼──┼─────────────┐
│ Main / Core                                  ▼  │             │
│   TaskService.create → 持久化 planning_mode    │             │
│   Scheduler picks up task                      │             │
│        │                                       │             │
│        ▼                                       │             │
│   RunCoordinator → PromptBuilder              │             │
│        scenario 根据 planningMode 路由         │             │
│        │                                       │             │
│        ▼ (preview/eager 场景)                  │             │
│     LLM → tool: capibara_plan_submit_tree      │             │
│        │                                       │             │
│        ▼                                       │             │
│   PlanningService.onTreeSubmitted              │             │
│   ├─ eager  : 立即 batchCreate 落库            │             │
│   └─ preview: 存入 pendingTrees + 发事件 ──────┘             │
│              用户 approve → batchCreate                      │
│              用户 discard → root 回 pending                  │
│              用户 refine  → 复用 conversation 会话           │
└──────────────────────────────────────────────────────────────┘
```

**核心原则**：

1. **复用 planning 流水线**：`preview` 即是 planning 的任务作用域延伸。
2. **真实落库由批准触发**：`eager` 是"自动批准自己"的 `preview`。
3. **LLM 使用单一树提交工具**（`capibara_plan_submit_tree`），避免递归调 `create_child` 带来的 id/parent 幻觉。
4. **Refine 走 conversation**：用户不满意时向 LLM 发反馈消息，LLM 重新提交一棵树覆盖旧 tree（复用现有 conversation reply 流）。

---

## 4. 数据模型

### 4.1 `Task` 实体

`workflow.types.ts`：

```ts
export type PlanningMode = 'layered' | 'eager' | 'preview';

export interface Task {
  id: string;
  orgId: string;
  parentId: string | null;
  type: string;
  title: string;
  description: string;
  status: string;
  assigneeRoleId: string | null;
  depth: number;
  artifactPaths: string[];
  pausedReason: string | null;
  planningMode: PlanningMode;   // ← 新增
  createdAt: string;
  updatedAt: string;
}
```

### 4.2 SQLite Schema

直接在 `migrations.ts:81-95` 的 tasks 表定义里加列（破坏性更改，不写 ALTER 迁移）：

```sql
planning_mode TEXT NOT NULL DEFAULT 'layered'
  CHECK (planning_mode IN ('layered','eager','preview'))
```

### 4.3 事件 payload

`events.ts` 改为**显式区分** planning-session 提交 与 task-scoped tree 提交：

```ts
// 原 PlanSubmittedPayload 保留（planning session 多根任务）
// 新增：
export interface PlanTreeSubmittedPayload {
  rootTaskId: string;
  orgId: string;
  roleId: string;
  mode: 'preview' | 'eager';
  tree: PlanTaskDraft;          // 以 rootTask 为根，children 递归
  submittedAt: string;
}

export interface PlanTreeReadyPayload {   // 仅 preview 模式触发
  rootTaskId: string;
  orgId: string;
  nodeCount: number;
  maxDepth: number;
}
```

`DomainEventMap`（`events.ts:185-226`）增加 `plan-tree:submitted`、`plan-tree:ready`、`plan-tree:discarded` 三项。

### 4.4 `PendingTree` 存储

在 `PlanningService` 新增内存 map（和 `pendingPlans` 并列）：

```ts
interface PendingTree {
  rootTaskId: string;
  orgId: string;
  roleId: string;
  mode: 'preview' | 'eager';
  tree: PlanTaskDraft;
  submittedAt: string;
}

private readonly pendingTrees = new Map<string /* rootTaskId */, PendingTree>();
```

键用 `rootTaskId`（每个任务最多一棵待审阅树）。TTL 24h。

### 4.5 `PlanTaskDraft` 约束收紧

`events.ts:161-167` 修改：

```ts
export interface PlanTaskDraft {
  type: string;
  title: string;
  description: string;           // 由可选改为必填
  assigneeRoleId: string;        // 由可选 + null 改为必填非空
  children: PlanTaskDraft[];     // 由可选改为必填（叶子为 []）
}
```

叶子节点必须满足类型的 `isLeaf=true`，校验在 submit 时执行。

---

## 5. Scenario 与 Prompt

### 5.1 枚举扩展

`scenario.ts:3-11`：

```ts
export type PromptScenario =
  | 'propose_decomposition'
  | 'execute_decomposition'
  | 'preview_decomposition'     // 新增
  | 'eager_decomposition'       // 新增
  | 'execute_leaf'
  | 'revision'
  | 'review_approve'
  | 'task_completed'
  | 'conversation_reply'
  | 'retry_failed';
```

### 5.2 路由

`scenario.ts:resolveScenario`：

```ts
if (wakeReason === 'conversation_reply' && ctx.task.isDecomposable) {
  // refine: 用户对 pending tree 给反馈 → 同 mode 重新跑一遍
  if (ctx.task.planningMode === 'preview') return 'preview_decomposition';
  if (ctx.task.planningMode === 'eager')   return 'eager_decomposition';
  return 'execute_decomposition';
}

if (ctx.task.isDecomposable) {
  if (ctx.task.planningMode === 'preview') return 'preview_decomposition';
  if (ctx.task.planningMode === 'eager')   return 'eager_decomposition';
  return 'propose_decomposition';
}

return 'execute_leaf';
```

### 5.3 Prompt Instructions（`task-prompt.strategy.ts:149-184`）

**preview_decomposition**
> Produce the complete decomposition tree for this task in a single call. Every leaf node's type MUST have `isLeaf=true`. Every node's type MUST appear in its parent's `allowedChildren`. Every node MUST include a non-empty `assigneeRoleId` selected from the subordinates listed in the Org Hierarchy section. Submit via `capibara_plan_submit_tree`. Do NOT call `capibara_task_create_child` — the user will review the tree and approve it before it is persisted. Max 500 nodes, max depth 10.

**eager_decomposition**
> Produce the complete decomposition tree for this task in a single call. Same structural rules as preview mode. Submit via `capibara_plan_submit_tree`. The tree will be persisted immediately with NO human review — make sure every node is directly actionable and every assignee is correct.

两者都通过 `conversation_reply` wakeReason 进入 refine 回路时，系统消息会注入用户反馈。

### 5.4 工具白名单

`task-prompt.strategy.ts:85-95`：

```ts
preview_decomposition: ['capibara_plan_submit_tree', 'capibara_context'],
eager_decomposition:   ['capibara_plan_submit_tree', 'capibara_context'],
```

### 5.5 PromptContext 扩展

`prompt.types.ts` 的 `task` 子结构：

```ts
task: {
  id: string;
  type: string;
  title: string;
  description: string;
  status: string;
  isDecomposable: boolean;
  planningMode: PlanningMode;   // ← 新增
  allowedChildTypes: string[];
  hasChildren: boolean;
  siblings: ...;
  parentChain: ...;
}
```

`run.context.ts:120` 旁边读取 `task.planningMode` 透传。

---

## 6. MCP 工具：`capibara_plan_submit_tree`

新文件：`apps/electron/src/core/modules/mcp/handlers/plan-tree-tools.ts`

### 6.1 入参 schema（Zod）

```ts
const PlanDraftNode: z.ZodType<PlanTaskDraft> = z.lazy(() => z.object({
  type: z.string(),
  title: z.string().min(1),
  description: z.string().min(1),
  assigneeRoleId: z.string().min(1),
  children: z.array(PlanDraftNode),
}));

const InputSchema = z.object({
  rootTaskId: z.string(),
  tree: PlanDraftNode,
});
```

### 6.2 Handler 流程

1. 加载 root task；若 `planningMode === 'layered'`：拒绝调用。
2. **结构校验**，任一失败抛出结构化错误，LLM 最多自动重试 2 次：
   - 根节点 type == rootTask.type。
   - 每个非根节点的 type ∈ parent type 的 `allowedChildren`。
   - `children.length === 0` 当且仅当类型 `isLeaf === true`。
   - 每个节点的 `assigneeRoleId` 是组织内合法 roleId。
   - 总节点数 ≤ 500。
   - 最大深度 ≤ 10。
3. 发 `plan-tree:submitted` 事件。
4. 返回 `{ ok: true, nodeCount, maxDepth }`。

### 6.3 PlanningService 接收

`planning.service.ts` 新增：

```ts
onTreeSubmitted(e: DomainEvent<PlanTreeSubmittedPayload>) {
  const { mode, rootTaskId, tree, orgId, roleId, submittedAt } = e.payload;

  if (mode === 'eager') {
    this.applyTree(orgId, rootTaskId, tree);
    this.taskService.transitionToNext(rootTaskId);  // root 推进状态
    return;
  }

  // preview
  this.pendingTrees.set(rootTaskId, { rootTaskId, orgId, roleId, mode, tree, submittedAt });
  this.eventPublisher.publish('plan-tree:ready', {
    rootTaskId, orgId,
    nodeCount: countNodes(tree),
    maxDepth: measureDepth(tree),
  });
}

private applyTree(orgId: string, rootTaskId: string, tree: PlanTaskDraft) {
  // root 已经存在；只创建 children
  this.taskService.batchCreate(orgId, rootTaskId, tree.children);
}
```

---

## 7. IPC & Preload

### 7.1 新增 handler

`apps/electron/src/core/ipc-handlers/plan-tree.handlers.ts`：

| IPC channel | 参数 | 返回 | 行为 |
|-------------|-----|------|-----|
| `capibara:plan-tree:get` | `rootTaskId` | `PendingTree \| null` | 拉取当前 pending |
| `capibara:plan-tree:approve` | `rootTaskId` | `ok/err` | 调 `applyTree` + 清除 pending |
| `capibara:plan-tree:discard` | `rootTaskId, reason?` | `ok/err` | 清 pending + root 回 `pending` + 发 `plan-tree:discarded` |
| `capibara:plan-tree:refine` | `rootTaskId, feedback` | `ok/err` | 不清 pending；向原 conversation 发送 human 消息，触发 conversation_reply wakeReason；LLM 重跑后会覆盖 pending |

注册入口：`composition-root.ts:117-127` 附近。

### 7.2 Preload bridge

`preload/index.ts`：

```ts
getPlanTree: (rootTaskId: string) => ipc.invoke('capibara:plan-tree:get', rootTaskId),
approvePlanTree: (rootTaskId: string) => ipc.invoke('capibara:plan-tree:approve', rootTaskId),
discardPlanTree: (rootTaskId: string, reason?: string) =>
  ipc.invoke('capibara:plan-tree:discard', rootTaskId, reason),
refinePlanTree: (rootTaskId: string, feedback: string) =>
  ipc.invoke('capibara:plan-tree:refine', rootTaskId, feedback),
```

同时在 `TaskService.create` 接受 `planningMode` 字段，IPC `capibara:task:create` 扩展入参。

---

## 8. 前端

### 8.1 `TaskCreateModal`

新增 `PlanningModeSelector`（仅在所选类型 `canDecompose=true` 时显示）：

```
┌─ Decomposition Mode ───────────────────────────────┐
│ ● Layered       每层提议并审批（默认）              │
│ ○ Preview Tree  一次拆到叶子，我审阅后落库          │
│ ○ Eager         一次拆到叶子并自动落库（无审阅）    │
└────────────────────────────────────────────────────┘
```

提交时写入 `planningMode` 字段。类型 `canDecompose=false` 的不显示此区块。

### 8.2 预览树视图组件

新组件 `apps/electron/src/renderer/components/planning/PlanTreeReview.tsx`：

- 递归渲染 `<PlanDraftNode>`，支持折叠/展开、节点计数 badge。
- 顶部工具栏：节点数 / 最大深度 / 预估角色分配概览。
- 底部操作：**Approve & Commit** / **Discard** / **Refine (发消息)**。
- Refine 展开一个文本框，提交后调 `refinePlanTree`，进入"等待 AI 重新提交"loading 态。

### 8.3 入口

- Task 详情页顶部：当该 task 有 pending tree 时，显示横幅 "AI 已生成拆分方案（N 个节点），点击审阅"。
- 进入 `PlanTreeReview`。

### 8.4 Store

新 store `plan-tree.store.ts`（不要复用 `planning.store`，职责不同）：

```ts
{
  byRootTaskId: Map<string, PendingTree>;
  loadPlanTree(rootTaskId): Promise<void>;
  approve(rootTaskId): Promise<void>;
  discard(rootTaskId, reason?): Promise<void>;
  refine(rootTaskId, feedback): Promise<void>;
}
```

订阅 `plan-tree:ready` / `plan-tree:discarded` 事件，自动拉取。

---

## 9. 错误与边界

| 场景 | 行为 |
|------|------|
| LLM 提交树含非法 type | tool 返回错误；LLM 重试；仍失败 run 标记 failed |
| 节点数 > 500 | tool 返回"Too many nodes (N/500). Split broader before refining."；失败 |
| 深度 > 10 | 同上 |
| 叶子未指定 `assigneeRoleId` | 结构校验失败，失败 |
| 非叶子类型却 children 为空 | 结构校验失败 |
| 叶子类型却 children 非空 | 结构校验失败 |
| `roleId` 在组织中不存在 | 结构校验失败，错误消息列出合法 subordinate 列表 |
| pending tree 过期 (>24h) | 清理；root 回 `pending`；UI 通知 |
| 并发 submit（LLM 重试） | 后者覆盖前者；日志记录版本号 |
| Refine 多次 | pending tree 每次被新提交覆盖；旧 tree 丢弃 |
| user discard | root 回 `pending`；保留 `planningMode`；可重新触发 |
| planningMode=preview/eager 但类型 canDecompose=false | TaskService.create 直接拒绝，UI 不显示该选项 |

---

## 10. 测试计划

**单元**

- `resolveScenario`：三种 planningMode × 多种 wakeReason 矩阵。
- 结构校验器：500 节点边界、10 层深度、非法 type、缺失 assignee 等 8 种错误。
- `PlanningService.onTreeSubmitted`：eager 立即落库 / preview 入 pending map。
- `TaskService.batchCreate` 扩展：带 rootTaskId 的嵌套树。

**集成**

- Eager 端到端：Epic 创建 → LLM 拆 → 自动落库 → 子任务可调度。
- Preview 端到端：Epic 创建 → LLM 提交 → UI 显示 → Approve → 落库。
- Refine：preview 提交 → user 发反馈 → LLM 重交 → UI 更新。
- Discard：preview → discard → root 回 pending → 可再次发起。

**UI 快照**

- `TaskCreateModal` 三种 radio。
- `PlanTreeReview` 不同规模（10/100/500 节点）。

---

## 11. 实现顺序（按 PR 拆分）

**所有 PR 都可直接修改 schema / 类型 / 行为，不需要兼容旧状态。**

1. **Schema + 类型** — tasks 表加 `planning_mode` 列（写入初始 migrations.ts）；`Task`、`CreateTaskInput`、`PromptContext.task` 加字段；`PlanTaskDraft` 收紧为必填。
2. **Scenario 路由** — 扩展 enum + `resolveScenario` + prompt instructions + 工具白名单。
3. **`capibara_plan_submit_tree` 工具 + 结构校验器**。
4. **PlanningService 扩展** — `pendingTrees` map + eager/preview 分支 + 新事件。
5. **IPC + Preload** — 4 个 plan-tree handler + TaskService.create 接受 planningMode。
6. **前端 TaskCreateModal** — `PlanningModeSelector` + IPC 调用。
7. **前端 PlanTreeReview + store** — 预览树 UI + 事件订阅。
8. **Refine 回路接通** — conversation reply → scenario 路由 → LLM 重提交 → UI 刷新。
9. **测试**（可与前述 PR 合并）。

---

## 12. 已确认决策

| # | 决策 | 值 |
|---|------|-----|
| 1 | 单次 preview/eager 节点数上限 | **500** |
| 2 | Eager 模式可见性 | **对所有用户开放**，不做 admin 限制 |
| 3 | Refine 路径 | **走 conversation**，复用现有会话流，LLM 重提交覆盖 pending tree |
| 4 | Assignee 指定 | **强制**：所有节点的 `assigneeRoleId` 必须是组织内合法 roleId |
| 5 | Review gate 保留 | **不保留**，eager 模式绕过所有（含叶子完成时的）review gate |
| 6 | 兼容性 | **不考虑**，schema 按目标形态直写，不做 ALTER 迁移、不做 feature flag、不做回填 |

---

## 13. 相关文档

- 方案对比：`docs/decomposition-strategy-proposal-zh.md`
- 工作流分析：`docs/workflow-analysis.md`
- 会话系统架构：`docs/architecture-conversation-system-zh.md`

---

**请你审阅**：第 4 节（数据模型破坏性更改）、第 5 节（scenario 契约）、第 6 节（tool 入参与校验）、第 8 节（UI 交互）。确认后可按 §11 开第一个 PR。
