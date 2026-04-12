---
stepsCompleted: [1, 2, 3, 4]
inputDocuments:
  - _bmad-output/planning-artifacts/prd.md
  - _bmad-output/planning-artifacts/prd-conversation-system.md
  - _bmad-output/planning-artifacts/architecture.md
  - _bmad-output/planning-artifacts/architecture-workflow-engine.md
  - _bmad-output/planning-artifacts/architecture-conversation-system.md
  - _bmad-output/planning-artifacts/ux-design-specification.md
  - _bmad-output/planning-artifacts/ux-final-wireframes.md
  - _bmad-output/planning-artifacts/ux-redesign-proposal-organization-flow.md
project_name: capibara
scope: ux-redesign-refactor
---

# Capibara UX Redesign: Epics and User Stories

**Date:** 2026-04-12
**Status:** Final Draft for Review
**Scope:** 本次重构仅涉及 UX 重新设计所引发的全栈变更（前端 + 后端 IPC/查询/状态支撑），不含核心引擎（WorkflowEngine/BehaviorEngine/ExecutionEngine）的重写。

---

## 0. 变更范围总览 (Scope Summary)

| 层级 | 涉及内容 | 是否新增 |
|------|---------|---------|
| **Renderer (React)** | 新增 Onboarding Wizard、重构 App Shell（去组织化）、新增 Inbox 页、重构 Task Discussion Panel、新增 Team Sandbox 页 | 大量新增/重构 |
| **Preload (IPC Contracts)** | 新增 `system:check-deps`、`conversations:list-grouped`、`conversation:resolve`、`discussion:get-summary` 等 IPC Channel | 新增 |
| **Main (Services)** | 新增环境探测服务、扩展 DiscussionRepository 查询、新增会话聚合查询、摘要推送生命周期调整 | 扩展/调整 |
| **SQLite Schema** | 无新表，但需确认 `conversation_workflows.resolved_at` 和 `discussion_groups.summary` 字段可正确被前端消费 | 验证/微调 |

---

## 1. Epics and Stories

### Epic 1: 沉浸式新手引导 (Immersive Onboarding)
*弃用传统"创建组织"表单，使用分步向导降低首次使用认知负荷。*

---

**Story 1.1: [后端] 系统环境探测服务**
* **描述:** 在 Main Process 中新增 `SystemCheckService`，暴露 IPC Channel `system:check-deps`，探测 Node.js 版本、网络连通性、`claude-code` CLI 是否全局安装。
* **技术要点:**
  - 使用 `child_process.execFile` 探测 `node -v` 和 `claude --version`。
  - 返回 Zod 校验的结构体 `{ nodejs: { ok, version }, claudeCli: { ok, version }, network: { ok } }`。
  - 在 `composition-root.ts` 中注册为 DI Token `SYSTEM_CHECK_SERVICE_TOKEN`。
* **验收标准:**
  - [ ] IPC `system:check-deps` 返回结构化的探测结果。
  - [ ] 未安装 `claude-code` 时 `claudeCli.ok = false`，不抛异常。
  - [ ] 探测总耗时 < 5s。

---

**Story 1.2: [前端] 环境自检向导页 (Health Check Wizard)**
* **描述:** 实现全屏 Onboarding 向导第一步：环境自检界面。调用 `system:check-deps`，逐项显示探测结果。
* **技术要点:**
  - React 全屏组件，无左侧导航栏。
  - 逐步动画展示各项状态（勾选 ✓ 或警告 !）。
  - 对于 `claudeCli.ok = false`，渲染可复制的安装命令卡片 + [Retry Check] 按钮。
  - [Continue Anyway] 跳过（标记为手工配置模式）。
* **验收标准:**
  - [ ] 所有项目通过时，自动高亮 [Continue ->] 按钮。
  - [ ] Claude Code 未安装时，复制按钮可将命令写入剪贴板。
  - [ ] 点击 [Retry Check] 重新触发 IPC 调用并刷新界面。

---

**Story 1.3: [前端] 空间命名与模版选择页 (Naming & Template Selection)**
* **描述:** 实现 Onboarding 向导第二步：输入空间名称 + 可视化卡片选择协作模版。
* **技术要点:**
  - 单行大字体输入框，Placeholder 为 "e.g., Acme Corp Next-Gen MVP"。
  - 卡片组件：每张展示模版名称、描述、Agent 数量、复杂度标签。
  - 推荐模版标注 `[★ Recommended]` 徽章。
  - 点击 [Let's Go ->] 触发现有的 `organization:create` IPC（传入 name + templateId）。
* **验收标准:**
  - [ ] 未输入名称时 [Let's Go] 按钮禁用。
  - [ ] 选中模版卡片高亮，仅允许单选。
  - [ ] 创建成功后跳转到主工作台。

---

### Epic 2: 去组织化的应用壳 (De-organized App Shell)
*弱化"组织"概念，让用户沉浸在当前项目的工作流中。*

---

**Story 2.1: [前端] 主导航栏重构**
* **描述:** 重构左侧全局导航栏，使用 5 个核心入口：`[⚡] Dashboard`、`[📋] Tasks`、`[💬] Inbox`、`[👥] Team`、`[⚙] Settings`。移除任何顶部或侧边的组织切换 Dropdown。
* **技术要点:**
  - 顶部标题栏仅显示当前 Workspace 名称（只读/轻量 rename）。
  - 左下角 Avatar 组件，点击弹出 Popover 二级菜单。
  - Popover 包含：切换空间列表（标注 Active）、创建新空间入口、用户设置、登出。
* **验收标准:**
  - [ ] 主界面中不存在任何全局组织切换下拉框。
  - [ ] Avatar Popover 中可以看到所有空间并切换。
  - [ ] 切换空间后，所有页面数据 Scope 自动变更为目标组织。

---

**Story 2.2: [前端] i18n 自动检测与切换**
* **描述:** 首次启动时自动检测 OS Locale，设置 ZH-CN 或 EN-US。用户可在 Settings 中手动切换。
* **技术要点:**
  - Main Process 通过 `app.getLocale()` 采集系统 Locale。
  - 语言偏好持久化到 SQLite `settings` 表 (`key='locale'`)。
  - 使用 React i18n 库(如 react-i18next)，全部静态 UI 字符串走翻译文件。
* **验收标准:**
  - [ ] 首次启动在中文系统上默认中文界面，英文系统上默认英文界面。
  - [ ] Settings 页面切换语言后，无需重启即可全局生效。

---

### Epic 3: 统一会话收件箱 (Unified Conversations Inbox)
*为人类提供"全局对话总控台"，明确区分"需要你决策"和"可以旁观"的会话。*

---

**Story 3.1: [后端] 会话分组聚合查询 API**
* **描述:** 在 Main Process 中新增 IPC Channel `conversations:list-grouped`，返回分为两组的活跃会话列表。
* **技术要点:**
  - **Group A (Blocked by Human):** 查询 `conversation_workflows` 中 `state = 'waiting_for_reply'`，且关联角色的 `requiresHumanApproval = true`。JOIN `task_nodes` 获取任务标题，JOIN `discussion_messages` 获取最后一条提问内容。
  - **Group B (AI-to-AI Monitoring):** 查询 `conversation_workflows` 中 `state = 'waiting_for_reply'`，且关联角色的 `requiresHumanApproval = false`。附带 respondent 角色名和当前状态描述。
  - 返回 Zod 校验结构体 `{ blocked: ConversationSummary[], monitoring: ConversationSummary[] }`。
* **验收标准:**
  - [ ] 两组数据严格按 `requiresHumanApproval` 分离，无交叉。
  - [ ] 每条记录包含 `taskTitle`、`askingRoleName`、`questionPreview`、`waitingSince` 字段。
  - [ ] 查询耗时 < 200ms（单组织内 100 条活跃会话）。

---

**Story 3.2: [前端] Inbox 页面渲染**
* **描述:** 实现 `[💬] Inbox` 页面，调用 `conversations:list-grouped` 并渲染为两个分区列表。
* **技术要点:**
  - 上方分区标题 `[!] Needs Your Reply (Blocked)` + 红色徽章计数。
  - 下方分区标题 `[👀] Agent-to-Agent Discussions (Monitoring)`。
  - 每行显示：提问 Agent 名称、任务名称、等待对象、等待时长。
  - 点击列表项跳转到对应的 Task 页面并自动展开 Discussion Thread。
  - 左侧导航栏 `[💬] Inbox` 图标上显示 Blocked 数量红色 Badge。
* **验收标准:**
  - [ ] Blocked 分区置顶，视觉权重明显高于 Monitoring 分区。
  - [ ] 导航栏 Badge 实时反映当前 Blocked 数量（通过 EventBus 订阅更新）。
  - [ ] 点击跳转后，目标 Task 的 Discussion Thread 自动滚动到最新消息。

---

### Epic 4: 任务讨论与决策面板 (Task Discussion & Decision Panel)
*将原来平平无奇的消息列表，升级为带有 Auto-Summary、结构化投票和 Resolve 操作的全栈决策面板。*

---

**Story 4.1: [后端] 摘要按需生成与推送**
* **描述:** 调整 `DiscussionSummaryService` 的生命周期：在 review round 变更或消息数达到阈值时自动生成摘要，并将结果持久化到 `discussion_groups.summary`，同时通过 IPC Push 通知前端更新。
* **技术要点:**
  - 新增 IPC Channel `discussion:get-summary` 供前端主动拉取。
  - EventBus 监听 `discussion-message:created` 事件，判断是否需要重新生成摘要。
  - 摘要生成后 emit `discussion-summary:updated` 事件，Preload 层订阅并 push 到 Renderer。
* **验收标准:**
  - [ ] 前端首次打开 Discussion Thread 时可通过 `discussion:get-summary` 获取最新摘要。
  - [ ] 新消息触发摘要重生成后，前端无需手动刷新即可看到更新。
  - [ ] 摘要内容为纯文本，不超过 500 字。

---

**Story 4.2: [后端] 结构化投票 IPC 接口扩展**
* **描述:** 扩展现有 `discussion:post-message` IPC 接口，使其支持联合 Payload：`{ content: string, voteTag: 'APPROVE' | 'REVISE' | 'CONCERN' | 'DELEGATE' | null }`。确保 Consensus Detector 消费该字段。
* **技术要点:**
  - 修改 `PostMessagePayload` 的 Zod Schema，新增 `voteTag` 可选字段。
  - `ConsensusDetector.processMessage()` 读取 `voteTag` 字段（不做文本解析）。
  - 当 `authorType = 'human'` 且 `voteTag != null` 时，该投票与 AI 投票拥有同等权重。
* **验收标准:**
  - [ ] 人类发送 `voteTag: 'APPROVE'` 的消息后，ConsensusDetector 正确计入该投票。
  - [ ] 所有 `canApprove` 角色（含人类）投出 APPROVE 后，任务自动流转到 review/terminal 状态。
  - [ ] `voteTag: null` 的消息不影响共识计算。

---

**Story 4.3: [后端] 会话强制 Resolve API**
* **描述:** 新增 IPC Channel `conversation:resolve`，允许人类强制终止一个活跃会话。
* **技术要点:**
  - 接收参数 `{ conversationWorkflowId: string }`。
  - 将 `ConversationWorkflow.state` 更新为 `resolved`，设置 `resolvedAt`。
  - 从 `PendingWake` 队列中删除与该 workflow 关联的所有待唤醒项。
  - Emit `conversation:resolved` 事件通知 EventBus。
* **验收标准:**
  - [ ] Resolve 后，该会话不再触发任何 Agent 唤醒。
  - [ ] Resolve 操作在 `ConversationEvent` 表中留下审计记录 (`eventType: 'human_resolved'`)。
  - [ ] 前端 Inbox 中该条目立即从 Blocked/Monitoring 列表中消失。

---

**Story 4.4: [前端] Discussion Thread 决策面板 UI**
* **描述:** 重构任务详情页右侧的 Discussion Thread Panel，使其内含 Auto-Summary 顶栏、结构化投票按钮和 Mark Resolved 控件。
* **技术要点:**
  - **顶部 Auto-Summary 卡片:** 调用 `discussion:get-summary`，订阅 `discussion-summary:updated` 实时刷新。以 `[💡 Auto-Summary]` 标签呈现。
  - **消息时间线:** 每条消息展示发送者角色 + 时间戳。Agent 暂停标记 (`[⏸️ Agent paused. Waiting for: xxx]`) 和唤醒标记 (`[⚡ Triggered: discussion_reply]`) 作为系统事件穿插。
  - **底部操作区:**
    - 三个投票标签按钮 `[APPROVE]` `[REVISE]` `[DELEGATE]`，点击后高亮选中（单选），附加到提交 payload 的 `voteTag`。
    - 文本输入框用于填写回复内容/修改反馈。
    - 提交按钮明确提示 `[⚡ Reply will wake: {roleName}]`。
    - 右下角低调的文字链接 `(Mark Resolved)` 调用 `conversation:resolve`。
* **验收标准:**
  - [ ] Summary 卡片始终显示在 Thread 最上方，不随消息滚动。
  - [ ] 未选择 Vote Tag 时仅发送普通消息 (`voteTag: null`)。
  - [ ] 选中 APPROVE 后发送，ConsensusDetector 计票正确。
  - [ ] 点击 Mark Resolved 后弹出确认对话框，确认后会话终止。

---

### Epic 5: 团队配置沙盒 (Team Sandbox)
*为组织架构人员编辑提供直观的可视化沙盒视图。*

---

**Story 5.1: [前端] Team 页面卡片化可视**
* **描述:** 实现 `[👥] Team` 页面，以卡片或层级图形式展示当前组织所有角色。
* **技术要点:**
  - 调用现有 `roles:list-by-org` IPC 获取完整角色树。
  - 每张卡片显示：角色名称、`requiresHumanApproval` 标记、`Reports to` 上级名称。
  - 卡片之间用连线或缩进明确表达层级关系。
  - `[+ Add New Hire/Agent]` 按钮触发新增角色流程。
  - 点击卡片弹出右侧 Drawer 编辑 Persona、Knowledge Bases、Skills。
* **验收标准:**
  - [ ] 角色层级关系与 SQLite 中 `parentId` 数据完全一致。
  - [ ] `requiresHumanApproval = true` 的角色有明确的视觉标记（如红色边框或徽章）。
  - [ ] Drawer 中修改保存后，卡片实时更新。

---

### Epic 6: Dashboard 叙事面板 (Narrative Dashboard)
*项目着陆页，提供叙事驱动的全局概览。*

---

**Story 6.1: [前端] Dashboard 布局与叙事集成**
* **描述:** 实现 `[⚡] Dashboard` 着陆页面，将 Narrative Engine 的输出渲染为可阅读的项目摘要。
* **技术要点:**
  - 调用 `narrative:get-latest` IPC 获取最新的叙事文本。
  - 叙事区域为主体内容，下方/侧边展示：预算进度条、活跃任务数量、Blocked 会话数量。
  - 叙事中的超链接点击后跳转到对应 Tasks/Inbox 页面。
* **验收标准:**
  - [ ] Dashboard 加载时自动拉取最新叙事文本。
  - [ ] 预算数据来源于 `CostEntry` 聚合查询，精确到 USD 两位小数。
  - [ ] Blocked 会话数量与 Inbox Badge 数字保持一致。

---

## 2. 实施优先级建议

| 顺序 | Epic | 理由 |
|------|------|------|
| **P0** | Epic 2: 去组织化应用壳 | 所有新页面（Inbox, Team, Dashboard）的容器框架，必须先就位 |
| **P1** | Epic 1: 沉浸式引导 | 新用户入口，但可与 P0 并行开发 |
| **P2** | Epic 4: 任务讨论决策面板 | 核心交互改造，涉及前后端联动最密集 |
| **P3** | Epic 3: 统一会话收件箱 | 依赖 Story 4.3 的 Resolve API，建议在 E4 之后 |
| **P4** | Epic 5: 团队沙盒 | 独立页面，可并行开发 |
| **P5** | Epic 6: Dashboard 叙事面板 | 依赖 Narrative Engine 数据，优先级最低 |

---

## 3. 后端变更清单 (Backend Change Checklist)

| 编号 | IPC Channel / Service | 类型 | Story |
|------|----------------------|------|-------|
| B1 | `system:check-deps` | **新增** IPC | 1.1 |
| B2 | `conversations:list-grouped` | **新增** IPC + Repository 查询 | 3.1 |
| B3 | `conversation:resolve` | **新增** IPC + PendingWake 清理 | 4.3 |
| B4 | `discussion:get-summary` | **新增** IPC | 4.1 |
| B5 | `discussion:post-message` payload | **扩展** Zod Schema (新增 voteTag) | 4.2 |
| B6 | `DiscussionSummaryService` | **调整** 生命周期 (主动推送) | 4.1 |
| B7 | `ConsensusDetector` | **验证** 人类 voteTag 权重计入 | 4.2 |

---
*End of Document*
