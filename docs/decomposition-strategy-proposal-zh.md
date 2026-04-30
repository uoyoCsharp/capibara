# 任务一次性拆分到可执行粒度 — 方案建议

> 目标：让用户可以（可选地）在一次规划里把 Epic/Story 直接拆到原子可执行的 Subtask，而不是被迫走 Epic → Story → Task → Subtask 的多轮分层委派。
>
> 作用范围：仅影响 AI Role 的 decomposition 行为与提示策略，**不改动工作项类型 schema 的语义**（Epic 仍是 Epic，Subtask 仍是 Subtask）。

---

## 1. 现状回顾

### 1.1 决定"拆 / 不拆"的关键链路

| 环节 | 文件:行 | 行为 |
|------|--------|------|
| 工作项类型 schema | `apps/electron/resources/workflows/default.json:6-14` | 每个类型声明 `canDecompose` / `allowedChildren` / `isLeaf` |
| 类型定义接口 | `apps/electron/src/core/modules/workflow/types/workflow.types.ts:23-32` | `WorkItemTypeDefinition` 契约 |
| 上下文构建 | `apps/electron/src/core/modules/prompt/context/run.context.ts:120` | `isDecomposable: typeDef?.canDecompose ?? false` |
| 场景路由 | `apps/electron/src/core/modules/prompt/strategies/scenario.ts:27` | `ctx.task.isDecomposable ? 'propose_decomposition' : 'execute_leaf'` |
| 提示构造 | `apps/electron/src/core/modules/prompt/strategies/task-prompt.strategy.ts:149-184` | 针对 scenario 注入不同 Instructions 与工具白名单 |
| 下级工具 | `apps/electron/src/core/modules/mcp/handlers/task-tools.ts:62-89` | `capibara_task_create_child` 仅允许 `allowedChildren` 里的类型 |
| 深度上限 | `apps/electron/src/core/modules/orchestrator/task.scheduler.ts:34-38` | 硬编码 `depth > 10` 告警 |

### 1.2 问题

- Epic → Story → Task → Subtask **每层都要一轮"提议 → 批准 → 执行"**，对确定性高、范围小的需求是浪费。
- 用户看不到"全景"，只能等 AI 一层层往下走。
- `canDecompose: false` 的 Task 类型本身 `allowedChildren: ["subtask"]`，但由于 scenario 直接走 `execute_leaf`，永远不会主动拆出 subtask —— 当前行为与 schema 存在不一致。

### 1.3 保留的现有优势（任何方案都应尽量保留）

- 分层 review gate：每层都能被上级通过 `capibara_ask_question` 捕获方向错误。
- 角色专业化：不同 role 的 `subordinates.skillDescriptions` 用于选择委派对象（`task-prompt.strategy.ts:198-212`）。
- Lazy planning 抗变更：上游调整后，下游还没落库的子任务不需要作废。

---

## 2. 方案概览

下面列出 4 个方案，按"改动侵入性"从低到高排列。可单独采用，也可叠加（尤其 A+C、B+D）。

| 方案 | 核心思路 | 侵入性 | 适合 |
|------|----------|--------|------|
| A. 预览树（dry-run） | 一次性生成全量树但不落库，用户审阅后一次落库 | 低 | 想看全景、仍保留分层 review |
| B. 类型级深度声明 | 工作项类型新增 `decomposeDepth` 字段 | 中 | 想对小型 Task 允许直接拆到底，Epic 仍分层 |
| C. 任务级 `planningMode` | 单个任务上标记"一次性拆到底" | 中 | 用户按需选择，不改全局策略 |
| D. 新增 `planner` 角色 | 独立的 Planner role 承担全量拆分职责 | 高 | 有明确分工诉求、希望引入 Architect 式专职 role |

---

## 3. 方案详解

### 方案 A：预览树（dry-run decomposition）

**核心机制**

1. Scenario 新增 `preview_decomposition`：role 在一次调用里产出**完整子孙树的 JSON 提议**（含 Story → Task → Subtask 全层），但**只调用 `capibara_ask_question`**，不调用 `capibara_task_create_child`。
2. 用户在 Planning UI 审阅这棵树，通过/调整后触发批量落库。
3. 批量落库由一个新的后端服务完成（而不是 LLM 自己逐个调 create_child），避免 LLM 幻觉落错层级。

**需改动位置**

- `scenario.ts`：新增 `preview_decomposition` 枚举值；当任务设置了 `planningMode === 'preview'` 时走此分支。
- `task-prompt.strategy.ts:149-184`：为新 scenario 写 Instructions，要求输出结构化 JSON 树。
- 新增 IPC handler：`capibara:planning:applyPreviewTree(orgId, parentTaskId, tree)` → 批量插入任务。
- UI：`PlanningPage.tsx:54-69` 附近新增"预览树 / 一键落库"交互。

**优点**

- 改动最小：不动 workflow schema、不动类型系统。
- 保留分层 review gate（人工一次审阅等效于多层批准）。
- 错误成本低：预览树还在内存，改起来没代价。

**缺点**

- LLM 在单轮里要产出深层 JSON，上下文压力仍然存在（但比"真落库"的错误要小）。
- 需要新增一套 tree schema + 前端渲染组件。

**推荐度：⭐⭐⭐⭐**（首选，风险低，收益明显）

---

### 方案 B：类型级深度声明

**核心机制**

给 `WorkItemTypeDefinition` 增加字段 `decomposeDepth?: number`，语义为"本类型任务在一次 decomposition 里最多生成多少层子孙"。默认 1（当前行为）。

例如在 `default.json` 里：

```json
{ "name": "task", "allowedChildren": ["subtask"], "canDecompose": true, "decomposeDepth": 1 },
{ "name": "story", "allowedChildren": ["task","bug","chore","spike"], "canDecompose": true, "decomposeDepth": 2 }
```

**需改动位置**

- `workflow.types.ts:23-32`：加可选字段 `decomposeDepth`。
- `default.json:6-14`：声明各类型深度。
- `run.context.ts:120`：把 `decomposeDepth` 一并带入 PromptContext。
- `task-prompt.strategy.ts:155-158`（execute_decomposition 分支）：Instructions 根据 `decomposeDepth` 动态引导"请在这次调用中创建最多 N 层子孙"。
- `capibara_task_create_child` handler (`task-tools.ts:62-89`)：允许在同一次 run 里被多次调用并支持 `parentTaskId` 指向当前 run 新创建的任务（已支持或需小改）。

**优点**

- 声明式，按类型集中管控。
- 顺带修复了现在"Task 允许 subtask 却永不创建"的不一致。

**缺点**

- 深度大时，`execute_decomposition` 阶段的 prompt 爆炸风险与 A 相同，但没有预览 gate。
- 错了要回滚真实落库的任务（可用 `cancelled` 状态，但污染历史）。

**推荐度：⭐⭐⭐**（适合你信任 AI 在小范围内一次拆准的场景）

---

### 方案 C：任务级 `planningMode` 开关

**核心机制**

在 Task 表新增字段 `planningMode: 'layered' | 'eager' | 'preview'`（默认 `layered` = 现状）。UI 在"发起新任务"时让用户选择。

- `layered`：当前行为。
- `eager`：跳过 propose/approve 两阶段，直接进入 `execute_decomposition`，并在 prompt 里追加"一次性拆到叶子"。
- `preview`：触发方案 A 的预览流程。

**需改动位置**

- Task schema / ORM 新增列（+ migration）。
- `run.context.ts:120` 附近读取并透传给 PromptContext。
- `scenario.ts:27`：根据 `planningMode` 分支。
- UI：`TaskCreateModal.tsx:23-36` 新增 radio 或下拉。
- `PlanningPage.tsx:54-69`：把用户选择写入创建请求。

**优点**

- 用户按任务显式选择，不担心全局行为变化。
- 和方案 A/B 不冲突，可同时提供三种模式。

**缺点**

- UX 上要给用户解释三种模式的差别。
- 有 schema 迁移成本。

**推荐度：⭐⭐⭐⭐**（最灵活，和 A 组合是比较稳的终态）

---

### 方案 D：新增 Planner 角色

**核心机制**

引入一个专门的 `planner` 角色，职责就是"一次性读完需求，输出完整可执行 Subtask 列表"。其他 role 只做 execute_leaf。

- 任何 Epic/Story 创建后，先被 Planner 接手，生成整棵树（落库或预览）。
- 然后由 scheduler 把叶子 Subtask 分发给 Dev/QA 等执行 role。

**需改动位置**

- `run.context.ts:57-76`：`orgHierarchy` 增加 planner 角色；`subordinates` 结构上可能需要特例支持"跨层委派"。
- 新增一套 planner 专属 prompt 模板。
- Orchestrator 需要新的路由规则（Planner 产出后回到 scheduler 而非直接 exec）。

**优点**

- 最符合"专业化分工"的设计哲学，与现有 role hierarchy 自洽。
- Planner 可以独立迭代 prompt、独立 A/B 测试。

**缺点**

- 工程量最大，涉及 schema、orchestrator、prompt 模板三处改动。
- 用户可能需要配置 planner 角色身份（SPO）。

**推荐度：⭐⭐**（长期可做，短期不优先）

---

## 4. 推荐组合

### 4.1 稳健起步

**A（预览树）+ C（planningMode）**

- 在 Task 上加一个 `planningMode` 开关，默认 `layered`；
- 提供 `preview` 模式：一次拆到叶子但不落库，UI 让用户审阅后一键确认。
- 不动工作项 schema、不动角色体系。
- 落地工作：schema migration + scenario 分支 + 一个预览 API + 一块 UI。

### 4.2 激进但简洁

**B（decomposeDepth）**

- 如果你更信任 AI 自主拆分，并希望零 UI 改动：把 Story 的 `decomposeDepth` 改成 2（或更大），由 prompt 引导单次拆到 Subtask。
- 风险：没有中间审阅；建议配合更严格的 review_approve 流程。

### 4.3 长期目标

**A + C + D**：Planner role 做一次性拆分，产出预览树，用户在 `planningMode=preview` 下审阅确认。这是完整形态，工作量最大。

---

## 5. 关键风险与对策

| 风险 | 影响方案 | 对策 |
|------|---------|------|
| 单轮 prompt 爆炸 | A/B/D | 限制单次生成节点数（如 ≤30）；超限回退到分层模式 |
| 深度递归幻觉 | A/B | 在 prompt 里硬约束"叶子节点必须满足 isLeaf=true"，后端校验拒绝非法类型 |
| 用户理解成本 | C | 默认值保持 `layered`；文档与工具提示清楚说明三种模式 |
| 跨层 parentId 写入 | A/D | 后端批量落库时按 DFS 顺序分配 id，保证父子引用正确 |
| 已有深度上限 10 | 所有 | 如果引入一次性拆分，需在 `task.scheduler.ts:35` 附近加"声明式深度"校验，保持可观测 |

---

## 6. 下一步

请从下列选项里告诉我你倾向哪条路径，我可以继续细化：

1. **只做方案 A（预览树）** — 我会输出详细实现任务拆解（scenario/prompt/IPC/UI 四块）。
2. **做 A + C 组合** — 额外给出 schema migration 与 UI 交互草图。
3. **先做方案 B** — 我会给出最小改动 diff 清单（3 个文件）。
4. **规划长期 D（Planner role）** — 我会先出一份角色定义与 orchestrator 路由的 RFC。

或者如果你想改变优先级 / 删除某个方案，直接告诉我。
