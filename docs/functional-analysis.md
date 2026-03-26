# Capibara 功能分析文档

> **文档目标**：基于 AgentCompany 参考项目和 BMAD Method，完整梳理 Capibara 转型为「公司级组织架构全智能助手」的功能图谱、优先级和设计决策。
>
> **最后更新**：2026-03-26

---

## 目录

1. [系统定位与核心理念](#1-系统定位与核心理念)
2. [组织建模](#2-组织建模)
3. [任务体系](#3-任务体系)
4. [执行引擎](#4-执行引擎)
5. [审批与治理](#5-审批与治理)
6. [唤醒与闭环机制](#6-唤醒与闭环机制)
7. [角色间通信](#7-角色间通信)
8. [知识与技能管理](#8-知识与技能管理)
9. [自动化规则引擎](#9-自动化规则引擎)
10. [韧性与恢复](#10-韧性与恢复)
11. [可观测性与反馈](#11-可观测性与反馈)
12. [用户交互（CLI 命令设计）](#12-用户交互cli-命令设计)
13. [配置体系](#13-配置体系)
14. [功能优先级总结](#14-功能优先级总结)
15. [关键设计决策记录](#15-关键设计决策记录)

---

## 1. 系统定位与核心理念

### 1.1 转型目标

**从**：固定 5 角色流水线工具（Analyst -> Architect -> Developer -> Reviewer -> Tester）
**到**：基于「公司级组织架构」的全智能助手，支持动态角色层级、任务递归分解、审批闭环和 BMAD Method 技能体系。

### 1.2 核心价值

用户输入需求后，系统通过模拟公司组织架构，自动完成需求分析、任务拆解、分派执行、审核批准的完整闭环。每个角色拥有独立的知识库、技能和职责范围，通过层级审批机制保证产出质量。

### 1.3 两种运行模式

| 模式 | 决策节点行为 | 适用场景 |
|------|-------------|---------|
| **全智能（full-auto）** | 上级角色通过 LLM 自动审核和决策 | 信任度高的标准化任务 |
| **半智能（semi-auto）** | 在配置的「关键节点」暂停，等待人类决策 | 需要人工把关的重要项目 |

### 1.4 参考项目对比

| 维度 | Capibara (目标) | AgentCompany (参考) |
|------|----------------|-------------------|
| 形态 | CLI 工具（V3 演进为 Electron） | Electron 桌面应用 |
| 核心模型 | 动态组织架构树 + BMAD 技能 | Company -> Department -> Agent |
| 执行模式 | 事件驱动唤醒闭环 | 持续自治运转 + 唤醒闭环 |
| 技能体系 | BMAD Method 40+ skills | 自定义 prompt builder |
| LLM 适配 | MVP: Claude CLI；V3: 多连接器 | 多连接器 (Claude/Codex/Gemini) |
| 数据持久化 | SQLite 统一存储 | SQLite (25+ 表) |

---

## 2. 组织建模

### 2.1 AgentCompany 参考

- Company -> Department -> Agent 三层结构
- Agent 有 `reportsTo` 形成管理链
- Agent 有 `status`（active/paused/terminated）
- Agent 有 `budget` 上限
- 支持「招聘」（动态创建 Agent，需审批）

### 2.2 Capibara 功能矩阵

| 功能点 | 优先级 | 说明 |
|--------|--------|------|
| 角色树（无限层级） | **MVP** | CTO -> 经理 -> 开发，`parentId` 递归 |
| 角色属性：技能/知识库/职责 | **MVP** | 绑定 BMAD skills，注入 prompt |
| 角色状态管理 | **MVP** | active/paused/idle，控制是否可被分派 |
| 预设组织模板 | **MVP** | software-team, product-team 等 |
| 用户自定义组织架构 | **MVP** | YAML 定义 + CLI 加载 |
| 角色预算上限 | V2 | 每个角色的 LLM 消耗上限，超限自动暂停 |
| 动态角色创建（「招聘」） | V2 | 运行时由上级角色决定需要新增下属 |
| 部门分组 | V2 | 角色按部门归类（前端组、后端组） |

### 2.3 设计决策

**D-ORG-1: 角色与 BMAD persona 的关系是 1:N**

一个角色可以绑定多个 BMAD skill。例如「技术经理」角色绑定 `bmad-architect` 和 `bmad-code-review`，系统根据当前任务类型动态选择合适的 skill 执行。

**D-ORG-2: MVP 阶段角色实例 1:1**

一个角色定义对应一个执行实例。不支持「两个前端开发并行」。V2 再考虑同一角色定义的多实例支持。

### 2.4 预设组织模板示例

```yaml
# software-team template
id: software-dev-team
name: "Software Development Team"
description: "Standard team for full-stack software development"
roles:
  - id: cto
    name: "CTO"
    parentId: null
    skills: ["bmad-analyst", "bmad-pm", "bmad-architect"]
    knowledgeBase: ["project-context", "architecture"]
    responsibilities: "Global decision making, requirement analysis, architecture review, final approval"
    canApprove: true
    canDelegate: true

  - id: tech-manager
    name: "Tech Manager"
    parentId: cto
    skills: ["bmad-architect", "bmad-sm", "bmad-code-review"]
    knowledgeBase: ["architecture", "coding-standards"]
    responsibilities: "Technical design, task decomposition, code review, progress management"
    canApprove: true
    canDelegate: true

  - id: frontend-dev
    name: "Frontend Developer"
    parentId: tech-manager
    skills: ["bmad-dev"]
    knowledgeBase: ["frontend-patterns", "ui-guidelines"]
    responsibilities: "Frontend feature development, UI implementation"
    canApprove: false
    canDelegate: false

  - id: backend-dev
    name: "Backend Developer"
    parentId: tech-manager
    skills: ["bmad-dev"]
    knowledgeBase: ["api-design", "database-patterns"]
    responsibilities: "Backend service development, API implementation, data layer"
    canApprove: false
    canDelegate: false

  - id: ux-designer
    name: "UX Designer"
    parentId: tech-manager
    skills: ["bmad-ux-designer"]
    knowledgeBase: ["ux-guidelines"]
    responsibilities: "User experience design, interaction prototyping"
    canApprove: false
    canDelegate: false

  - id: qa-engineer
    name: "QA Engineer"
    parentId: tech-manager
    skills: ["bmad-qa"]
    knowledgeBase: ["testing-strategy"]
    responsibilities: "Testing strategy, test execution, quality assurance"
    canApprove: false
    canDelegate: false
```

---

## 3. 任务体系

### 3.1 AgentCompany 参考

- Goal -> Project -> Task -> Subtask 四层结构
- Task 有 `parentId` 支持递归分解
- Task 有完整状态机：backlog -> todo -> in_progress -> blocked -> in_review -> done -> cancelled
- Task 有 `assigneeId`, `taskType`（code/research/content/management/general）
- Task Comment 系统（围绕任务的讨论）
- 子任务全完成 -> 自动唤醒父任务负责人

### 3.2 Capibara 功能矩阵

| 功能点 | 优先级 | 说明 |
|--------|--------|------|
| 需求输入（顶层任务） | **MVP** | 用户输入需求，成为根任务 |
| 任务递归分解 | **MVP** | 上级角色将任务拆为子任务分派给下属 |
| 任务状态机 | **MVP** | pending -> in_progress -> awaiting_review -> revision -> approved -> done |
| 任务分配（assignee） | **MVP** | 每个任务绑定一个执行角色 |
| 任务类型标签 | **MVP** | analysis/design/code/review/test，用于匹配 BMAD skill |
| 任务产出物（artifacts） | **MVP** | 每个任务的输出存储和引用 |
| 子任务完成 -> 通知父任务 | **MVP** | 核心闭环驱动力 |
| 任务评论/讨论 | V2 | 角色间围绕任务的沟通记录 |
| 任务优先级 | V2 | 影响调度顺序 |
| 任务依赖（非父子关系） | V2 | 例如「后端 API 完成后前端才能集成」 |
| 任务超时机制 | V2 | 超时自动升级 |

### 3.3 任务状态机

```
pending ──────> in_progress ──────> awaiting_review ──────> approved ──────> done
                    ^                      |
                    |                      v
                    +<──────────── revision (被打回)
                                           |
                                           v
                                      delegated (上级分派新关联任务)
                                           |
                                           v
                                       blocked (等待关联任务完成)
```

### 3.4 设计决策

**D-TASK-1: 任务分解由 LLM 驱动**

全智能模式下，上级角色通过 LLM 自动分析任务并拆解为子任务。半智能模式下，LLM 提出分解方案让人类确认。参考 AgentCompany 的「提示词驱动拆分 + API 落库」模式。

**D-TASK-2: 角色串行执行任务**

MVP 阶段一个角色同一时间只执行一个任务，完成后才取下一个。与 AgentCompany 的「单 Agent 单活跃 run」一致。

**D-TASK-3: delegate 操作的语义**

delegate = 上级创建新的关联子任务分派给指定角色 + 原任务状态变为 `blocked`（等待关联任务完成后才能继续审核）。例如：技术经理审核前端产出后，决定还需要后端配合，创建子任务给后端开发，前端任务 blocked 直到后端完成。

---

## 4. 执行引擎

### 4.1 AgentCompany 参考

- OrchestrationService：调度决策（校验 agent/connector/budget/workspace）
- WorkerService + UtilityProcess：独立进程执行，避免阻塞
- Run 概念：每次任务执行是一个 Run，有完整生命周期
- Workspace lock：防止同工作区冲突
- 流式日志回传

### 4.2 Capibara 功能矩阵

| 功能点 | 优先级 | 说明 |
|--------|--------|------|
| Run 概念（任务执行实例） | **MVP** | 每次角色执行任务产生一个 Run，记录输入/输出/耗时/成本 |
| 执行前门控检查 | **MVP** | 角色状态、预算、连接器可用性 |
| 执行上下文构建 | **MVP** | 角色 prompt + 任务描述 + 父任务产物 + 知识库 |
| Workspace 绑定 | **MVP** | 代码类任务需要绑定项目目录 |
| 执行日志存储 | **MVP** | 记录每次 run 的完整输出 |
| 独立进程执行 | V2 | 当前用 ClaudeCliExecutor 同进程够用，V2 考虑 UtilityProcess |
| Workspace lock | V2 | 多角色并行操作同一代码目录时需要 |
| 流式日志 | V2 | 实时展示执行过程 |
| 并行执行 | V2 | 同级角色并行执行不同任务 |

### 4.3 设计决策

**D-EXEC-1: Capibara 包装 BMAD 执行**

角色执行任务时，不直接裸跑 BMAD skill，而是由 Capibara 构建完整的 system prompt（角色身份 + BMAD skill 指令 + 组织上下文 + 任务描述 + 上游产物），然后通过 `ICommandExecutor` 执行。这样可以注入组织层面的上下文。

**D-EXEC-2: Session 隔离与恢复策略**

每个角色的每次 Run 使用独立 session（符合 BMAD 推荐的「fresh chat between steps」）。但同一角色被打回重试（revise）时可以 resume session，保留之前的上下文以便高效修改。

---

## 5. 审批与治理

### 5.1 AgentCompany 参考

- ApprovalRecord：pending -> approved/rejected/expired
- ApprovalType：hire/deployment/social_post/document_review/deliverable_review/general
- approval-policy.ts：策略决策（哪些动作需要审批）
- HITL 决策点
- Deliverable review gate（待评审时阻断后续执行）

### 5.2 Capibara 功能矩阵

| 功能点 | 优先级 | 说明 |
|--------|--------|------|
| 审批链（子 -> 父） | **MVP** | 任务完成后自动提交给 parentRole 审核 |
| 审批决策：approve/revise/delegate | **MVP** | 三种操作覆盖核心场景 |
| 审批上下文展示 | **MVP** | 审核者能看到任务描述 + 执行产物 + 子任务状态 |
| 全智能审批（LLM 自动审核） | **MVP** | 审核角色用 BMAD review skill 自动评估 |
| 半智能审批（人工介入） | **MVP** | 关键节点暂停，展示上下文让人决策 |
| 审批记录持久化 | **MVP** | 记录每次审批的决策和反馈 |
| 关键节点标记 | **MVP** | 用户可配置哪些层级是「关键节点」，半智能模式下必须人工审批 |
| 审批超时 | V2 | 审批超时自动升级到更高层级 |
| 审批策略引擎 | V2 | 规则化定义哪些情况需要审批 |

### 5.3 审批流转示意

```
前端开发 完成任务
  -> 提交给技术经理审核 (awaiting_review)
    -> 技术经理审核 (全智能: LLM 自动 / 半智能: 人工)
      -> approve: 检查同级任务是否全部完成
        -> 全部完成: 技术经理汇总 -> 提交 CTO 审核
        -> 未全部完成: 等待其他同级任务
      -> revise: 打回前端开发，附带反馈 (revision)
      -> delegate: 创建新子任务给后端开发 (delegated -> blocked)
```

### 5.4 设计决策

**D-REVIEW-1: 半智能模式的关键节点配置**

通过 `criticalReviewLevels` 配置项控制哪些层级需要人工审批。`[0]` 表示只有顶层（CTO）需要人工审批，`[0, 1]` 表示 CTO 和经理层都需要人工审批。不在配置中的层级即使在半智能模式下也使用 LLM 自动审核。

**D-REVIEW-2: 审核 prompt 注入内容**

审核角色收到审核请求时，其 prompt 中需要包含：
1. 原始任务描述
2. 执行角色的产出物（完整内容或摘要）
3. 同级子任务的状态汇总
4. 审批历史（如果有之前的 revise 记录）
5. BMAD review skill 的评估指引

---

## 6. 唤醒与闭环机制

### 6.1 AgentCompany 参考（核心设计）

- 8+ 种唤醒触发源（消息/评论/任务创建/状态变化/审批结果/run 完成/心跳/重启恢复）
- `wakeAgentIfPossible`：门控检查后唤醒
- `pendingWake` 队列：agent 忙时不丢信号
- 心跳调度器：定时检查是否有可执行任务
- self-wake 熔断：防止无限循环（MAX_CONSECUTIVE_WAKES = 5）
- 子任务完成 -> 自动唤醒父任务 owner

### 6.2 Capibara 功能矩阵

| 功能点 | 优先级 | 说明 |
|--------|--------|------|
| 任务完成 -> 唤醒审核者 | **MVP** | 核心闭环：下属完成 -> 上级收到审核请求 |
| 审核完成 -> 唤醒执行者 | **MVP** | revise -> 唤醒原角色重做；approve -> 唤醒父任务角色 |
| 所有子任务完成 -> 唤醒父角色 | **MVP** | 技术经理的所有下属都完成 -> 唤醒技术经理汇总 |
| 新任务创建 -> 唤醒 assignee | **MVP** | 上级分派任务后自动唤醒下属 |
| 唤醒门控（角色状态/预算/连接器） | **MVP** | 只有满足条件才执行 |
| Pending wake 队列 | **MVP** | 角色忙时缓存唤醒信号 |
| self-wake 熔断 | **MVP** | 防止 revise 无限循环，最大重试次数后升级 |
| 心跳调度器 | V2 | 定时轮询是否有闲置角色 + 待执行任务 |
| 崩溃恢复 | V2 | 重启后恢复中断的 run |

### 6.3 唤醒闭环流程

```
事件触发
  -> wakeRoleIfPossible(roleId, trigger)
    -> 门控检查 (角色状态 / 预算 / 连接器)
      -> 通过且角色空闲: createRun + execute
      -> 通过但角色忙: enqueuePendingWake（不丢信号）
      -> 不通过: 记录原因，跳过
  -> Run 执行完成
    -> 消费 pendingWakes
    -> 触发后续事件 (task:completed / review:submitted)
    -> 事件驱动下一轮唤醒
```

### 6.4 唤醒触发源（MVP）

| 触发类型 | 触发点 | 目标角色 |
|----------|--------|---------|
| task_assigned | 新任务分派给角色 | assignee 角色 |
| task_completed | 角色完成任务执行 | parent 角色（审核者） |
| review_approve | 审核通过 | 父任务的 assignee 角色（如果子任务全完成） |
| review_revise | 审核打回 | 原执行角色 |
| review_delegate | 审核后分派 | 被分派的目标角色 |
| delegation_completed | 被分派的关联任务完成 | 原 blocked 任务的审核角色 |
| retry_failed | 重试耗尽 | 上级角色（升级） |

### 6.5 设计决策

**D-WAKE-1: 事件驱动 + 队列模式**

MVP 使用 `EventBus.emit('task:completed')` -> 监听器计算唤醒目标 -> 放入执行队列 -> 编排器消费。比 AgentCompany 的即时唤醒更简单但效果一致。

**D-WAKE-2: 兄弟任务完成判定**

每次子任务完成时检查所有兄弟任务状态，全部处于 `done` 或 `approved` 状态则唤醒父角色进行汇总。

---

## 7. 角色间通信

### 7.1 AgentCompany 参考

- 双通道：正式消息（agent_messages）+ 任务讨论（task_comments）
- 5 种频道：direct/department/company/project/incident
- 消息触发唤醒
- 已读机制

### 7.2 Capibara 功能矩阵

| 功能点 | 优先级 | 说明 |
|--------|--------|------|
| 任务评论（围绕任务的讨论） | **MVP** | 审核反馈、修改说明、问题澄清通过 comment 记录 |
| 角色间直接消息 | V2 | 不绑定任务的跨角色沟通 |
| 消息触发唤醒 | V2 | 收到消息自动唤醒角色处理 |
| 频道概念 | V3 | MVP 不需要复杂频道 |

### 7.3 设计决策

**D-COMM-1: MVP 通信通过审批链实现**

MVP 阶段通信主要通过「任务的 review 反馈」和「任务描述」来传递信息，不需要独立的消息系统。审批链本身就是一种结构化的通信机制：
- 上级 -> 下级：任务描述 + 分派说明
- 下级 -> 上级：任务产出物 + 完成报告
- 上级 -> 下级（打回）：审核反馈 + 修改要求

---

## 8. 知识与技能管理

### 8.1 AgentCompany 参考

- prompt-builder.ts 注入公司状态、目标、项目等动态上下文
- Agent 通过 API 读写知识库、文档

### 8.2 BMAD Method 提供的能力

- 9 个 persona（Analyst/PM/Architect/SM/Developer/QA/UX/Writer/Master）
- 40+ skills（agent skills + workflow skills + tools）
- 知识库三层：project-context.md + architecture ADRs + planning artifacts
- 自定义 `.customize.yaml`
- 标准 4 阶段 workflow：Analysis -> Planning -> Solutioning -> Implementation

### 8.3 Capibara 功能矩阵

| 功能点 | 优先级 | 说明 |
|--------|--------|------|
| BMAD skill 加载与执行 | **MVP** | 读取 `_bmad/` 目录的 persona 和 skill 文件 |
| 角色 -> skill 映射 | **MVP** | 组织模板中定义角色绑定哪些 skill |
| 任务类型 -> skill 自动匹配 | **MVP** | analysis 任务自动选 bmad-analyst skill |
| 项目知识库注入 | **MVP** | `_bmad-output/project-context.md` 注入 prompt |
| 产出物作为知识传递 | **MVP** | 上游任务的产出物作为下游任务的输入上下文 |
| 知识库动态更新 | V2 | 角色执行过程中更新 project-context |
| 自定义 skill 创建 | V2 | 用户定义新的 skill（利用 BMAD Builder） |
| 跨项目知识共享 | V3 | 多项目间共享通用知识 |

### 8.4 设计决策

**D-SKILL-1: BMAD 产出物与 Capibara 任务产出物共存**

Capibara 管理任务和产出物的元数据（存 SQLite），但实际文件存储在 `_bmad-output/` 目录中，保持和 BMAD 标准结构兼容。用户可以直接用 BMAD CLI 查看产出物。

**D-SKILL-2: 知识库双层架构**

- 静态层：BMAD 预设知识 + 用户配置的参考文档（不随执行变化）
- 动态层：本次项目中的产出物和审批记录（随执行累积）

两层知识在构建 prompt 时合并注入。

### 8.5 Prompt 构建上下文

角色执行任务时，prompt 由以下内容动态拼装：

```
1. 角色身份（from BMAD persona）
2. 职责范围 + 技能描述
3. 组织关系（上级是谁、下属是谁、同级有谁）
4. 当前任务描述 + 父任务上下文
5. 上游产出物（上游任务的 artifacts）
6. 如果是审核：下属提交的产出物
7. 如果是被打回：审核反馈 + 修改要求
8. 知识库内容（静态层 + 动态层）
9. 可用操作指令（完成/提交审核/分派子任务/打回）
```

---

## 9. 自动化规则引擎

### 9.1 AgentCompany 参考

- 声明式规则：trigger + condition + action
- 11 种触发器，7 种动作
- 默认规则模板（自动分配、blocked 升级、idle 自动派工等）
- Workflow Pipeline（多步骤顺序执行）

### 9.2 Capibara 功能矩阵

| 功能点 | 优先级 | 说明 |
|--------|--------|------|
| 内置流转规则 | **MVP** | 硬编码核心规则：完成 -> 审核 -> 通知父任务 -> 打回 |
| 失败自动重试 | **MVP** | run 失败自动重试 N 次 |
| 重试耗尽 -> 升级 | **MVP** | 超过重试次数自动升级到上级角色 |
| 声明式规则引擎 | V2 | 用户可配置自定义规则 |
| 默认规则模板 | V2 | 预设常用自动化规则 |
| Workflow Pipeline | V3 | 多步骤自动化流程 |

### 9.3 设计决策

**D-AUTO-1: MVP 硬编码核心规则**

MVP 把核心流转逻辑硬编码在 `OrgOrchestrator` 中，不引入规则引擎。核心规则包括：

```
task_completed       -> submit_for_review (唤醒 parent role)
review_approved      -> check_siblings_done -> wake_parent_role
review_revise        -> wake_assignee (with feedback)
review_delegate      -> create_subtask + wake_target_role
run_failed           -> retry (if < maxRetry) or escalate
all_siblings_done    -> wake_parent_role (summarize)
escalation_exhausted -> notify_human
```

V2 阶段将这些规则抽象为声明式配置，支持用户自定义。

---

## 10. 韧性与恢复

### 10.1 AgentCompany 参考

- Run 状态：queued/running/succeeded/failed/cancelled/timed_out/interrupted
- 失败重试（带冷却）
- 升级链：assignee -> manager -> CEO -> user
- Worker 崩溃恢复：running -> interrupted，重启后恢复
- Workspace lock 过期清理
- 心跳 stale 清理

### 10.2 Capibara 功能矩阵

| 功能点 | 优先级 | 说明 |
|--------|--------|------|
| Run 状态完整生命周期 | **MVP** | queued/running/succeeded/failed/cancelled |
| 失败重试（configurable max） | **MVP** | 默认 3 次 |
| 升级链（沿组织树向上） | **MVP** | 角色失败自动找上级处理 |
| self-wake 熔断 | **MVP** | revise 循环上限，超过后升级或通知人类 |
| 全局预算保护 | **MVP** | 项目级预算上限，超限停止所有执行 |
| 崩溃恢复 | V2 | 重启后检查 interrupted runs |
| 角色级预算 | V2 | 单角色消耗上限 |
| 执行超时 | V2 | 单次 run 最大执行时间 |

### 10.3 升级链流程

```
角色 run 失败
  -> retry count < maxRetry ?
    -> YES: 延时重试同角色
    -> NO: 升级到 parent role
      -> parent role 存在?
        -> YES: 唤醒 parent role (trigger: report_failed)
        -> NO (已到顶层):
          -> 通知人类介入（无论全智能还是半智能）
```

### 10.4 设计决策

**D-RESIL-1: 顶层失败必须通知人类**

当升级链到达顶层角色（parentId = null）仍然失败时，无论全智能还是半智能模式，都必须通知人类介入。这是系统的「安全阀」。

**D-RESIL-2: revise 循环上限**

可配置的 `maxReviseAttempts`，默认 3 次。超过 3 次 revise 后自动升级到更高层级角色处理，避免无效循环。

---

## 11. 可观测性与反馈

### 11.1 AgentCompany 参考

- ProfileSnapshot：全局状态快照
- Activity 记录
- Run log 流式回传
- 桌面通知
- Dashboard 指标（活跃工作、看板、告警）

### 11.2 Capibara 功能矩阵

| 功能点 | 优先级 | 说明 |
|--------|--------|------|
| 执行日志存储 | **MVP** | 每个 run 的完整输出记录 |
| 任务进度查询 | **MVP** | `cpbr status` 展示组织树 + 任务状态 |
| 成本追踪 | **MVP** | 已有 CostTracker，需扩展到角色维度 |
| 组织树可视化（CLI） | **MVP** | 树状展示角色层级和当前状态 |
| 审批历史查询 | **MVP** | 查看某任务的审批链记录 |
| 事件总线 | **MVP** | 已有 EventBus，扩展事件类型 |
| 实时进度通知 | V2 | 终端实时展示执行进度 |
| HTML 报告 | V2 | 生成项目执行报告 |
| Electron UI | V3 | 图形化展示组织架构 + 任务看板 |

### 11.3 CLI 状态展示示例

```
$ cpbr status

Project: My App (active)
Budget: $12.30 / $50.00 (24.6%)
Mode: semi-auto

Organization:
  CTO [idle]
  +-- Tech Manager [in_progress] -> Task: "Design API architecture"
      +-- Frontend Dev [awaiting_review] -> Task: "Implement login page"
      +-- Backend Dev [idle]
      +-- UX Designer [done] -> Task: "Create wireframes"
      +-- QA Engineer [idle]

Tasks (5 total, 2 active):
  #1 "Build user auth feature" [in_progress] assigned: CTO
    #1.1 "Design API architecture" [in_progress] assigned: Tech Manager
      #1.1.1 "Create wireframes" [approved] assigned: UX Designer
      #1.1.2 "Implement login page" [awaiting_review] assigned: Frontend Dev
      #1.1.3 "Implement auth API" [pending] assigned: Backend Dev

Recent Activity:
  14:32 Frontend Dev completed "Implement login page" -> awaiting Tech Manager review
  14:15 UX Designer completed "Create wireframes" -> approved by Tech Manager
  13:50 Tech Manager delegated tasks to Frontend Dev, Backend Dev, UX Designer
```

---

## 12. 用户交互（CLI 命令设计）

### 12.1 组织架构管理

```bash
cpbr org init [--template software-team]    # 从预设模板初始化组织架构
cpbr org load <yaml-file>                   # 从自定义 YAML 加载组织架构
cpbr org show                               # 树状展示组织架构
cpbr org reset                              # 重置组织架构
```

### 12.2 角色管理

```bash
cpbr role list                              # 列出所有角色及状态
cpbr role info <roleId>                     # 查看角色详情（技能、知识库、状态、成本）
cpbr role pause <roleId>                    # 暂停角色
cpbr role resume <roleId>                   # 恢复角色
cpbr role add <name> --parent <parentId> --skills <...>  # 动态添加角色 (V2)
```

### 12.3 任务管理

```bash
cpbr task create -t <title> -d <desc>       # 创建顶层任务（需求输入）
cpbr task list [--role <roleId>] [--status <status>]  # 列出任务
cpbr task info <taskId>                     # 任务详情 + 审批历史 + 产出物
cpbr task log <taskId>                      # 查看执行日志
```

### 12.4 执行控制

```bash
cpbr start [--mode full-auto|semi-auto]     # 启动编排器
cpbr stop                                   # 优雅停止（等待当前 run 完成）
cpbr status                                 # 全局状态总览
```

### 12.5 项目管理（保留现有）

```bash
cpbr project add -n <name> --dir <path>     # 添加项目
cpbr project list                           # 列出项目
cpbr project switch <id>                    # 切换活跃项目
cpbr project remove <id>                    # 移除项目
```

---

## 13. 配置体系

### 13.1 配置文件结构

```yaml
# capibara.config.yaml

organization:
  template: software-team             # 预设模板名 (software-team / product-team)
  customFile: null                    # 自定义组织文件路径 (优先于 template)

execution:
  mode: full-auto                     # full-auto | semi-auto
  criticalReviewLevels: [0]           # 半智能模式下需人工审批的层级深度 (0=顶层)
  maxReviseAttempts: 3                # 单任务最大打回次数
  maxRetryOnFailure: 3                # 执行失败最大重试次数
  budgetLimit: 50.0                   # 项目预算上限 (USD)

skills:
  provider: bmad                      # 技能提供者: bmad | custom
  bmadRoot: ./_bmad                   # BMAD 安装目录
  outputDir: ./_bmad-output           # 产出物目录

cli:
  defaultExecutor: claude-cli         # 默认命令执行器
  projectDir: ./                      # 代码项目目录

persistence:
  databasePath: ~/.capibara/capibara.sqlite  # SQLite 数据库路径
  logDir: ~/.capibara/logs                   # 执行日志目录

logging:
  level: info                         # debug | info | warn | error
  pretty: true                        # 美化日志输出
```

### 13.2 配置层级

```
默认值 (config.defaults.ts)
  <- 全局配置 (~/.capibara/config.yaml)
    <- 项目配置 (<projectDir>/capibara.config.yaml)
      <- CLI 参数 (--mode, --budget 等)
```

---

## 14. 功能优先级总结

### MVP（第一个可用版本）

核心目标：用户输入需求，组织架构自动运转完成任务。

1. **组织树建模 + 预设模板**：YAML 定义角色层级，绑定 BMAD skill
2. **BMAD skill 集成**：角色执行任务 = 构建组织上下文 prompt + 调用 BMAD skill
3. **任务递归分解**：上级角色通过 LLM 拆解任务分派给下属
4. **审批链**：完成 -> 提交审核 -> approve/revise/delegate
5. **唤醒闭环**：事件驱动的 完成 -> 审核 -> 分派 -> 执行 循环
6. **全智能/半智能两种模式**：关键节点可配置人工介入
7. **失败重试 + 升级链**：沿组织树向上升级
8. **CLI 交互 + 状态展示**：org/role/task/status 命令

### V2（核心增强）

- 声明式自动化规则引擎
- 角色级预算控制
- 并行执行 + workspace lock
- 崩溃恢复
- 动态角色创建（「招聘」）
- 自定义 BMAD skill 创建
- 任务依赖（非父子关系）
- 任务评论/讨论系统
- 心跳调度器
- 实时进度展示

### V3（平台化）

- Electron UI（组织架构图 + 任务看板）
- 多 LLM 连接器（Codex/Gemini 等）
- 角色间独立消息系统
- 跨项目知识共享
- 插件体系

---

## 15. 关键设计决策记录

| 编号 | 决策 | 选择 | 理由 |
|------|------|------|------|
| D-ORG-1 | 角色与 BMAD persona 关系 | 1:N（一个角色绑定多个 skill） | 技术经理需要在设计和审核间切换 |
| D-ORG-2 | 角色实例数量 | MVP 1:1，V2 多实例 | 简化 MVP 复杂度 |
| D-TASK-1 | 任务分解方式 | LLM 驱动 + 人工确认（半智能） | 参考 AgentCompany 的「提示词驱动拆分」 |
| D-TASK-2 | 角色并发 | MVP 串行（单角色单任务） | 避免资源冲突，简化调度 |
| D-TASK-3 | delegate 操作语义 | 创建关联子任务 + 原任务 blocked | 支持跨角色协作场景 |
| D-EXEC-1 | BMAD 执行方式 | Capibara 包装（注入组织上下文） | 不裸跑 BMAD，保留组织层面信息 |
| D-EXEC-2 | Session 策略 | 每次 Run 独立 session，revise 可 resume | 平衡上下文隔离和效率 |
| D-REVIEW-1 | 半智能关键节点 | 通过 criticalReviewLevels 配置 | 灵活控制人工介入粒度 |
| D-REVIEW-2 | 审核 prompt 内容 | 包含产出物 + 兄弟任务 + 审批历史 | 提供完整决策上下文 |
| D-WAKE-1 | 唤醒模式 | 事件驱动 + 队列 | 比即时唤醒更简单，MVP 够用 |
| D-WAKE-2 | 兄弟完成判定 | 每次完成时检查所有兄弟 | 简单可靠 |
| D-COMM-1 | MVP 通信方式 | 通过审批链传递信息 | 不需要独立消息系统 |
| D-SKILL-1 | 产出物存储 | 元数据在 SQLite，文件在 `_bmad-output/` | 兼容 BMAD 标准结构 |
| D-SKILL-2 | 知识库架构 | 静态层 + 动态层 | 区分预设知识和项目累积知识 |
| D-AUTO-1 | MVP 规则引擎 | 硬编码核心规则 | V2 再抽象为声明式配置 |
| D-RESIL-1 | 顶层失败处理 | 必须通知人类 | 系统安全阀，不可自动忽略 |
| D-RESIL-2 | revise 循环上限 | 可配置，默认 3 次 | 避免无效循环消耗预算 |
