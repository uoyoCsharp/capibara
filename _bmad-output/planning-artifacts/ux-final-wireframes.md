# Capibara UX - Final Wireframe Specifications

**Author:** uoyo & Sally (UX Designer)
**Date:** 2026-04-12
**Status:** Final Draft for Review

这份文档汇总了我们通过多次讨论确立的 Capibara 平台核心体验架构。设计严格遵循了《多轮对话交互系统 PRD》的核心理念：去组织化、化繁为简、沉浸式自动化执行，以及分离宏观任务与微观对话的“双层多轮对话体系”。

---

## 1. 沉浸式新手引导 (Onboarding Flow)

抛弃传统的表单填报式“创建组织”，用极具体验感、向导式的流程让用户无缝进入状态。

### 界面 1: 系统环境自检 (Environment Health Check)
**场景：** 用户首次启动，或配置全新工作空间。系统自动探测依赖，对于缺失环境直接提供一键修复方案，降低上手门槛。

```text
+-----------------------------------------------------------------------------+
|                                                                             |
|                              [ Capibara Logo ]                              |
|                                                                             |
|                        "Welcome to your AI Workforce"                       |
|                                                                             |
|      -----------------------------------------------------------------      |
|                                                                             |
|      Running System Check...                                                |
|                                                                             |
|      [ ✓ ] Node.js Environment Detected  (v22.0.0)                          |
|      [ ✓ ] Network Connectivity                                             |
|      [ ✓ ] API Keys Verified                                                |
|                                                                             |
|      [ ! ] Claude Code CLI                                                  |
|          Wait, we couldn't find the Claude Code CLI installed globally.     |
|          Please run this in your terminal to install it:                    |
|                                                                             |
|          +---------------------------------------------------------+        |
|          | npm install -g @anthropic-ai/claude-code          [Copy]|        |
|          +---------------------------------------------------------+        |
|                                                                             |
|                                [ Retry Check ]                              |
|                                                                             |
|                                                    [ Continue Anyway -> ]   |
+-----------------------------------------------------------------------------+
```

### 界面 2: 空间命名 & 卡片式模版选择 (Naming & Template Selection)
**场景：** 将创建抽象“组织”的概念，转化为“挑选你要组建的 AI 梦之队”。

```text
+-----------------------------------------------------------------------------+
|  <- Back                                                                    |
|                                                                             |
|                    What are we building today?                              |
|                                                                             |
|         [  e.g., "Acme Corp Next-Gen MVP"                           ]       |
|                                                                             |
|                    Choose a Collaboration Template:                         |
|                                                                             |
|   +--------------------------+  +--------------------------+  +---------+   |
|   | [★ Recommended]          |  |                          |  |         |   |
|   | Agile Dev Team           |  | QA & Testing Crew        |  | UI/UX ..|   |
|   | ------------------------ |  | ------------------------ |  | ------- |   |
|   | PM, Arch, Dev, & QA bots |  | Specialized testing bots |  |         |   |
|   | ready for fast shipping. |  | for aggressive coverage. |  |         |   |
|   |                          |  |                          |  |         |   |
|   | Agents: 4  | Complexity: M|  | Agents: 2  | Complexity: S|  |         |   |
|   +--------------------------+  +--------------------------+  +---------+   |
|            (Selected)                                                       |
|                                                                             |
|                                                           [ Let's Go -> ]   |
+-----------------------------------------------------------------------------+
```

---

## 2. 去组织化的核心工作台 (De-organized Workspace)

弱化全局的组织切换下拉框，让用户产生“我的整个世界都在为这个项目运转”的沉浸包围感。

### 界面 3: 降级的组织切换视角 (Hidden Organization Switcher)
**场景：** “组织/空间切换”不再霸占顶部导航，而是收纳于左下角管理员头像的二级菜单中。

```text
+-----------------------------------------------------------------------------+
|    Capibara    |  Workspace: Acme Corp MVP                                  |
|----------------+------------------------------------------------------------|
|  [Search...]   |                                                            |
|                |                                                            |
|  [⚡] Dashboard |                                                            |
|  [📋] Tasks     |                                                            |
|  [💬] Inbox     |                                                            |
|  [👥] Team      |                                                            |
|  [⚙] Settings  |                                                            |
|                |                                                            |
|  ---           |                                                            |
|                |                                                            |
| [Avatar] uoyo ^|-------+                                                    |
+----------------|       |----------------------------------------------------+
                 |  uoyo (Admin)
                 |  ---
                 |  [Switch Workspace  >] ->  ( Acme Corp MVP (Active) )
                 |  [Workspace Settings ]     ( Side-Project X         )
                 |  [Create New Space   ]     ( + Create New...        )
                 |  ---
                 |  [User Preferences   ]
                 |  [Log Out            ]
                 +-------+
```

---

## 3. 多轮对话交互系统 (Multi-turn Conversation System)

根据 PRD 核心要求：平台需要一套能容纳人类干预审批、同时保持 Agent 级联协作不被打断的无缝会话引擎结构。

### 界面 4: 宏观层 - 统一会话收件箱 (Unified Inbox)
**场景：** （PRD FR26 & FR27）左侧导航 `[💬] Inbox`。全景呈现整个空间中所有进行中的 AI 讨论。明确区隔“需要人类阻塞性决策的审批任务”和“人类仅需旁观的自动沟通流”。

```text
+-----------------------------------------------------------------------------+
|    Capibara    |  Workspace: Acme Corp MVP                                  |
|----------------+------------------------------------------------------------|
|  [Search...]   |                                                            |
|                |  Inbox: Active Conversations                               |
|  [⚡] Dashboard |  --------------------------------------------------------- |
|  [📋] Tasks     |  [!] Needs Your Reply (Blocked)                            |
| *[💬] Inbox     |                                                            |
|  [👥] Team      |  > Analyst: Missing payment methods in requirements        |
|  [⚙] Settings  |    Task: Design Payment Module | Waiting for: uoyo (Human)|
|                |                                                             |
|  ---           |  > CTO (Escalated): Concurrency approach approval           |
|                |    Task: Implement Auth | Waiting for: uoyo (Human)         |
|                |                                                             |
|                |  ---------------------------------------------------------  |
|                |  [👀] Agent-to-Agent Discussions (Monitoring)               |
|                |                                                             |
|                |  > Developer -> Architect: Retry strategy missing           |
|                |    Task: Payment Gateway | Status: Architect analyzing...   |
|                |                                                             |
|                |  > QA -> Senior Dev: Edge case found in login               |
|                |    Task: Login Pages | Status: Waiting for Dev reply        |
| [Avatar] uoyo  |                                                             |
+-----------------------------------------------------------------------------+
```

### 界面 5: 微观层 - 任务讨论与人机混合交互 (Task Context & Decision Thread)
**场景：** 对应 PRD (FR-04, FR31)。点击具体任务后，右侧展示与之绑定的完整会话线程。顶部展示系统自动生成的摘要；底部提供带有“结构化投票标签(Structured Vote Tags)”的富交互输入区。

```text
+-----------------------------------------------------------------------------+
|    Capibara    |  Workspace: Acme Corp MVP                                  |
|----------------+------------------------------------------------------------|
|  [Search...]   |                                                            |
|                |  Task Details: Design Payment Module                       |
|  [⚡] Dashboard |  --------------------------------------------------------- |
| *[📋] Tasks    |                       |  # Discussion Thread                |
|  [💬] Inbox     |  Assignee: Analyst    |  --------------------------------- |
|  [👥] Team      |  Status: PAUSED       |  [💡 Auto-Summary]                 |
|  [⚙] Settings  |                       |  Analyst needs PCI constraints and |
|                |  Descriptions:        |  supported gateways to proceed.    |
|  ---           |  Design the new...    |  --------------------------------- |
|                |                       |                                     |
|                |                       |  > [Analyst] asks a question:      |
|                |                       |  Which payment methods need to be  |
|                |                       |  supported? PCI level?             |
|                |                       |  [⏸️ Agent paused. Waiting for: you]|
|                |                       |                                     |
|                |                       |  > [uoyo (You)] tagged [APPROVE]    |
|                |                       |  Card & PayPal. PCI Level 1.        |
|                |                       |                                     |
|                |                       |  ---------------------------------  |
|                |                       |  [⚡ Reply will wake: Analyst ]     |
| [Avatar] uoyo  |                       |  [ APPROVE ] [ REVISE ] [ DELEGATE ]|
|                |                       |  [ Message / Feedback...         >] |
|                |                       |                     (Mark Resolved) |
+-----------------------------------------------------------------------------+
```

---

## 4. 虚拟劳动力配置沙盒 (Organization Sandbox)

### 界面 6: 团队层 - 组织架构与人员配置 (Team Sandbox)
**场景：** 当繁琐的组织切换被弱化后，`[👥] Team` 成为你专注搭建和调整 AI 部门的直观沙盒。展示 Agent 之间的汇报链路（Report to）和需要人类干预的审批链。

```text
+-----------------------------------------------------------------------------+
|    Capibara    |  Workspace: Acme Corp MVP                                  |
|----------------+------------------------------------------------------------|
|  [Search...]   |                                                            |
|                |  Your AI Workforce                                         |
|  [⚡] Dashboard |  --------------------------------------------------------- |
|  [📋] Tasks     |                                                            |
|  [💬] Inbox     |  [+ Add New Hire/Agent]                                    |
| *[👥] Team      |                                                            |
|  [⚙] Settings  |  +----------------+  +----------------+  +----------------+ |
|                |  | CTO            |  | PM             |  | Analyst        | |
|  ---           |  | requiresHuman  |  | Mary           |  | Alex           | |
|                |  | _Approval: Yes |  | ----------------| | ----------------| |
|                |  |                |  | Auto-approves: |  | Auto-approves: | |
|                |  | Oversees: ALL  |  | Design phase   |  | None           | |
|                |  | Reports to: You|  | Reports to: CTO|  | Reports to: PM | |
|                |  +----------------+  +----------------+  +----------------+ |
|                |          |                   |                   |          |
| [Avatar] uoyo  |          +-------------------+-------------------+          |
+-----------------------------------------------------------------------------+
```

---

## 5. 核心设计亮点与总结

1. **“反组织化”的最佳实践 (De-organization Focus):** 打破传统 SaaS “组织 -> 项目 -> 任务” 的嵌套界面，利用底部隐藏入口与无感边界，实现对具体项目的高度心流沉浸。
2. **极佳的开箱体验 (Frictionless Onboarding):** 将报错转化为向导式环境诊断；用带有情境的“团队模版卡片”代替干瘪的表单建构，大幅提升首次激活留存。
3. **宏微并存的双层沟通引擎 (Dual-layer Multi-turn Comm Engine):**
   * **宏观 `Inbox`:** 统一聚合所有需要人类决策阻断点及正在进行的 AI-To-AI 对话阵线，规避大规模并发中的认知过载。
   * **微观 `Task Context`:** 将对话嵌入具体任务流本身，Agent 休眠与唤醒的逻辑闭环在时间轴上直观可视化。
4. **游戏化的沙盒管理 (Gamified Sandbox):** 将人员配置抽象为清晰的树级架构卡片，不仅便于观察汇报线，也将复杂的权限和角色设定趣味化。
