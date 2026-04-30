# 手工冒烟走查清单 · Preview Tree + Planning Mode

> 配套交付：`docs/decomposition-preview-tree-architecture-zh.md` · `docs/decomposition-preview-tree-test-cases-zh.md`
>
> 用途：Phase 1 + Phase 2 开发完成后的手工验收走查。所有自动化测试之前先走一遍，用于快速发现集成 bug。
>
> 预计耗时：约 90 分钟

---

## 前置准备

- [ ] 启动 app (`pnpm dev` / `npm run dev`)，进入一个已初始化的 workspace
- [ ] 至少存在 1 个 `canDecompose=true` 的工作项类型（Epic / Story）
- [ ] 至少存在 2 个以上 role（含叶子执行者）
- [ ] 打开 DevTools Console 与主进程日志，全程观察有无报错
- [ ] 确认数据库 schema 已更新：

  ```sql
  PRAGMA table_info(tasks);
  -- 期望看到 planning_mode 列，默认值 'layered'，CHECK 约束限制为 layered/eager/preview
  ```

---

## Part A · Layered 回归（确保旧路径不受影响）

**目的**：Phase 1/2 改动不应影响原有行为。

- [ ] **A1** 点右上角 "Create Task" → 选类型 `Epic` → **确认 Decomposition Mode 区块出现**，默认选中 `Layered`
- [ ] **A2** 保持 `Layered`，填完字段提交 → 任务成功创建，状态 `pending`
- [ ] **A3** 任务详情页 → 点 `Start` → 正常进入 `in_progress`
- [ ] **A4** 观察 AI run：LLM 应该走 `propose_decomposition` scenario（通过 `capibara_ask_question` 提交提案），**不应**调用 `capibara_plan_submit_tree`
- [ ] **A5** 创建一个类型为 `Subtask` 的任务 → **确认 Decomposition Mode 区块不出现**（canDecompose=false 类型无此选项）

---

## Part B · Eager 模式端到端

**目的**：验证一次性拆分直接落库。

- [ ] **B1** Create Task → 类型选 Epic → **切换到 Eager** → 标题/描述/assignee 填好 → 提交
- [ ] **B2** DB 中确认该 task `planning_mode = 'eager'`
- [ ] **B3** 点 Start → LLM 运行
- [ ] **B4** 观察 LLM 日志：应看到 **只有一次** `capibara_plan_submit_tree` 调用，**不应**看到 `capibara_task_create_child`
- [ ] **B5** 调用成功后：任务列表应立刻出现多个子任务（Story / Task / Subtask）
- [ ] **B6** root 任务状态应自动推进到 `in_progress`（而非停留 `pending`）
- [ ] **B7** 所有叶子 subtask 的 `assignee_role_id` 非空
- [ ] **B8** 深度检查：tree 不应超过 10 层；节点数不超过 500

**异常路径**：

- [ ] **B9** 让 LLM 返回非法 type（比如 prompt 诱导错误）→ tool 应返回 `TYPE_NOT_IN_ALLOWED_CHILDREN` 错误，LLM 自动重试
- [ ] **B10** 如果 3 次都失败 → run 应标记 failed，root 回 `pending`，主进程日志有 `Eager plan tree apply failed`

---

## Part C · Preview 模式端到端

**目的**：验证预览 → 审阅 → 落库流程。

- [ ] **C1** Create Task → 类型 Epic → **切换到 Preview Tree** → 提交
- [ ] **C2** DB 中确认 `planning_mode = 'preview'`
- [ ] **C3** 点 Start → LLM 运行 → **数据库中的 tasks 表不应**新增任何子任务
- [ ] **C4** 任务详情页顶部应出现横幅：`AI has drafted a decomposition plan · N nodes pending review · version 1`
- [ ] **C5** 右上角或 UI 某处应有通知 / badge 提示预览就绪（`plan-tree:ready` 事件）
- [ ] **C6** 点击横幅 → 嵌套抽屉打开 `PlanTreeReview`
- [ ] **C7** 树视图检查：
  - [ ] 节点数 / 深度 / 版本号显示正确
  - [ ] Role distribution badge 汇总所有 role 的分配次数
  - [ ] 递归展开 / 折叠按钮工作
  - [ ] 每个节点显示 type badge + title + assignee badge + description
  - [ ] 100+ 节点时默认只展开根层

---

## Part D · Approve 路径

- [ ] **D1** 在 PlanTreeReview 中点 **Approve & Commit** → 按钮进入 `Committing…` loading
- [ ] **D2** 成功后：抽屉关闭，横幅消失，任务列表立刻出现所有子任务
- [ ] **D3** root 状态推进到 `in_progress`
- [ ] **D4** DB 里确认子任务 `parent_id` 正确链接到 root

---

## Part E · Discard 路径

- [ ] **E1** 新建一个 Preview Epic → 等预览就绪
- [ ] **E2** 点 **Discard** → 弹出原因输入框
- [ ] **E3** 不填原因 → 点 Cancel → 弹窗关闭，预览仍在
- [ ] **E4** 再点 Discard → 填原因 `too large` → 点 Discard plan
- [ ] **E5** 抽屉关闭，横幅消失
- [ ] **E6** DB 中 root 状态回到 `pending`（如果之前被切过状态）
- [ ] **E7** 子任务未被创建（DB `tasks` 表无新行）
- [ ] **E8** 主进程日志有 `Plan tree discarded` 记录，含 reason

---

## Part F · Refine 路径（关键）

- [ ] **F1** 新建 Preview Epic → 等预览就绪 → 打开 PlanTreeReview
- [ ] **F2** 记下当前版本号（如 v1）
- [ ] **F3** 点 **Refine** → 文本框展开
- [ ] **F4** 清空输入 → 点 Send feedback → 按钮应 **disabled**
- [ ] **F5** 输入反馈 `请把 authentication story 拆得更细，至少 5 个 task` → 点 Send feedback
- [ ] **F6** 按钮显示 `Waiting for AI…` loading 态
- [ ] **F7** 观察主进程日志：应看到 `Plan tree refine requested` → `Waking agent for task` → 新 LLM run
- [ ] **F8** 检查 LLM prompt（如果有日志）：应包含 `## User Feedback on Previous Tree` 区块，引用你的反馈
- [ ] **F9** LLM 重提交后 → 预览自动刷新，版本号变为 v2
- [ ] **F10** 新树应体现反馈内容（auth story 被拆得更细）
- [ ] **F11** 如果再 Refine 一次 → 版本号变 v3

---

## Part G · 并发 / 竞态场景

- [ ] **G1** Approve 时带了旧 version：打开 PlanTreeReview 但不关 → 从另一路径触发 refine（或等 LLM 自发 refine）→ 回到审阅面板点 Approve → 应返回 `VERSION_MISMATCH` 错误（错误提示显示在底部）
- [ ] **G2** Pending tree 存在时点 root 任务的 **Start** 按钮 → 应返回错误 `PENDING_PLAN_TREE`，提示"先审阅 / 放弃"
- [ ] **G3** 同时开 3 个 Preview Epic（不同 rootTaskId）→ 每个都独立显示自己的预览，互不干扰

---

## Part H · 边界与错误

- [ ] **H1** 绕过 UI，直接通过 DevTools Console 调：

  ```js
  window.capibara.createTask({
    orgId: '<your-org-id>',
    parentId: null,
    type: 'subtask',
    title: 'x',
    description: 'x',
    assigneeRoleId: '<role-id>',
    planningMode: 'preview',
  });
  ```

  应返回错误 `INVALID_PLANNING_MODE_FOR_TYPE`

- [ ] **H2** 调 `window.capibara.getPlanTree('nonexistent')` → 返回 `{ ok: true, data: null }`（不是报错）
- [ ] **H3** 调 `window.capibara.approvePlanTree('nonexistent')` → 返回 `{ ok: false, error: { code: 'NO_PENDING_TREE' } }`
- [ ] **H4** 调 `window.capibara.refinePlanTree(rootId, '')` → 返回 `{ ok: false, error: { code: 'EMPTY_FEEDBACK' } }`
- [ ] **H5** 观察 `plan-tree:ready` 事件在 DevTools 的 console 里能否被前端 store 订阅到

---

## Part I · UI 细节

- [ ] **I1** TaskCreateModal：切换 type 从 Epic → Subtask → Epic → Planning Mode 应重置为 Layered
- [ ] **I2** TaskDetailDrawer：任务 `planningMode: 'preview'` 时应显示 `Preview plan` badge
- [ ] **I3** PlanTreeReview：Refine loading 中，Approve 和 Discard 按钮应 disabled
- [ ] **I4** Discard 弹窗打开时，Refine 表单应收起（两者互斥）
- [ ] **I5** 树很大时（>200 节点）UI 是否卡顿？注意 Chrome DevTools Performance

---

## Part J · 事件链路验证（DevTools 调试）

在主进程 console 开启 debug 日志，或在 renderer 里加临时监听：

```js
window.capibara.subscribe((e) => console.log('[event]', e));
```

对每个路径确认能看到对应的事件：

| 动作                                         | 期望事件                |
| -------------------------------------------- | ----------------------- |
| LLM 提交 preview 树                          | `plan-tree:ready`       |
| 用户 Approve                                 | `task:changed` ×N（N = 节点数） |
| 用户 Discard                                 | `plan-tree:discarded`   |
| TTL 到期（手工把 submittedAt 改成 25h 前）   | `plan-tree:discarded`   |
| Refine                                       | `plan-tree:ready`（新版本到达时） |

---

## 结束标准

- [ ] **核心功能可用**：Part A (5 项)、B (8+2 项)、C (7 项)、D (4 项)、E (8 项)、F (11 项) 全部通过
- [ ] **边界检查**：Part G、H、I 中任一项失败 → 记录为 bug，决定是否 block 上线
- [ ] **事件链路可观测**：Part J 全部符合预期 → 后续写自动化测试时心里有底

---

## 推荐走查顺序

1. **A** 冒烟回归（5 分钟）
2. **B** Eager 路径（15 分钟）
3. **C → D** Preview + Approve（15 分钟）
4. **E** Discard（5 分钟）
5. **F** Refine（20 分钟，最容易踩雷）
6. **G → H → I → J** 边界与细节（30 分钟）

**总计约 90 分钟。** 建议一边走一边记 bug 到 issue tracker，**不要当场修**。全部跑完后可以把失败项按 P0 / P1 分级统一处理。

---

## Bug 记录模板

| # | Part.ID | 严重度 | 现象 | 重现步骤 | 期望 vs 实际 | 备注 |
|---|---------|--------|------|----------|--------------|------|
|   |         |        |      |          |              |      |

---

## 相关文档

- 架构设计：`docs/decomposition-preview-tree-architecture-zh.md`
- 验收测试用例：`docs/decomposition-preview-tree-test-cases-zh.md`
- 方案对比：`docs/decomposition-strategy-proposal-zh.md`
