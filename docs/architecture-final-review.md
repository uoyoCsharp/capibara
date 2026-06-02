# Capibara 架构基线评估报告 — 对 `architecture-final.md` 的审核

> 评估日期: 2026-06-02
> 评估对象: `docs/architecture-final.md`（Final 1.0，决策定稿基线）
> 评估方法: **逐条对照 `apps/electron/src/core/` 实际代码验证**，而非纯文档推演
> 基线分支: acp-refactor
> 评估人: 架构审核（独立第三方视角）

---

## 0. 一句话结论

**这是一份质量高于平均水准的架构文档**：核心论证（角色+稳定性分层、Hexagonal 骨架、"AI 交互 ≠ infra" 的领域/基础设施判据）站得住脚，绝大多数代码实证经核对**属实**。8 项决策中 7 项合理，路线图排序正确。

但存在 **1 处事实性错误、1 处路线图与代码现状脱节、1 处架构权衡未闭环、1 处疑似过度设计**，需在开工前修正。下表是总览，详见后文。

| 维度 | 结论 |
|------|------|
| 事实准确性 | 9/10 模块计数与依赖边**完全属实**；仅"循环 re-export"一项定性错误 |
| 决策合理性 | D-1~D-5、D-7、D-8 合理；**D-6（级联删除事件化）需重新权衡** |
| 路线图准确性 | **OP-4 实际已完成**，路线图把它列为待办，高估了剩余工作量 |
| 最大隐患 | D-1 放弃"层=依赖秩"后，**未指定依赖方向的强制手段**，存在架构腐蚀风险 |

---

## 1. 代码实证核对结果（事实层）

我对文档第 4.2、5、7 节的所有"代码实证"逐一在代码中核对。

### 1.1 完全属实的部分 ✅

| 文档声称 | 代码核对结果 |
|---------|-------------|
| 9 个模块的文件数 / repo 数（Org 12/3、WF 10/2、Exec 10/2、acp 26/4、Conv 9/3、Plan 4/1、Prompt 6/0、Coord 3/0、Orch 9/1） | **逐一吻合，无一偏差** |
| Planning 单文件 `planning.service.ts` 528 行 | **正好 528 行** |
| Workflow→Conversation 隐藏 setter（仅级联删除用） | 属实：`workflow/services/task.service.ts` 有 `setConversationRepository()`，且 `convRepo` 仅在 `delete()` 中遍历 `findByTaskId` 后逐条删除 |
| IExecutor 端口归属：Execution 定义、AcpExecutor 实现 | 属实：`execution/interfaces/i-executor.ts` 定义；`acp/client/acp-executor.ts` `implements IExecutor` |
| Planning 对 AI **零引用** | 属实：`modules/planning/` 全目录无 ACP/Executor 引用 → D-7 成立 |
| `task:deleted` 是新增事件 | 属实：`foundation/events.ts` 当前无此事件 |
| 共享调度组件均存在 | 属实：WakeGateValidator / TaskScheduler / RetryScheduler / RunCoordinator / IPendingWakeRepository 全部存在 |
| 跨模块导入"具体类"（DIP 债） | **属实**。见下方专门澄清 |

**关于"具体类导入"的澄清（重要）**：代码中这些导入写法是 `import type { TaskService } from '.../services/task.service'`。`import type` 只擦除**运行期**导入，**不改变对具体实现类的结构性耦合**——编译期依然钉死在 `TaskService` 这个实现上，而非接口。因此文档"8 个具体类跨模块导入"的定性**正确**，OP-1/OP-2 接口提取是真实债务。（实测 planning/mcp/coordination 三模块共 11 处 service/engine 类导入，去重约 5 个类；"8"为约数，不影响结论。）

### 1.2 事实性错误 ❌（须修正）

**文档第 7.1 节待清理项 #4 与第 9.2 节，把 `acp.types ↔ execution.types` 描述为"循环 re-export"。这是错的。**

代码实际情况：

- `acp/types/acp.types.ts:8` 单向 re-export：`export type { LifecycleIntent } from '.../execution.types'`
- `execution/types/execution.types.ts` **没有任何**对 acp.types 的反向引用
- 且 `acp.types` 第 14 行有注释明说：此 re-export 是**为了避免依赖环**

也就是说：**当前不存在循环依赖**，这条 re-export 恰恰是规避循环的手段。有意思的是，本文档的前序版本 `architecture-design-v3.md §8.2` 的措辞是准确的（"re-export 避免依赖环"），但到了 `architecture-final.md` 反而退化成"循环 re-export / ↔"。

**影响**：待清理项 #4 的问题陈述是伪命题——没有环要破。如果团队照此去"提取共享类型到中性位置"，是在解决一个不存在的问题（YAGNI）。建议：要么删除此项，要么改为"低优先：消除 acp→execution 的类型 re-export 以减少跨模块类型耦合（注意当前并无循环）"。

---

## 2. 路线图与代码现状脱节 ⚠️

**OP-4（Orchestrator 拆 3）在代码中实际上已经完成。**

文档把 OP-4 列为 **Phase 3 待办**（§12.2），措辞是"Orchestrator 拆 3（理由：职责隔离/可测试）"，似乎暗示当前是一个大编排器待拆。但代码现状：

- `orchestrator/orchestrators/` 下已是 **3 个独立类**：`TaskOrchestrator` / `ConversationOrchestrator` / `RunOrchestrator`
- 共享组件已抽出：WakeGateValidator / TaskScheduler / RetryScheduler / RunCoordinator
- `bootstrap/orchestrator.module.ts` 已分别 `new` 三者并各自注册 DI token

文档自身也自相矛盾：§5.5 标题"Orchestrator **拆分后**保留"、§10.2 前门/后门表都把三者当**既存事实**描述，唯独路线图 §12.2 把它当待办。

**建议**：将 OP-4 标注为"✅ 已完成（acp-refactor 分支）"，从 Phase 3 工作量中移除；保留其"理由=职责隔离/可测试"的论述作为既成事实的追认即可。这关系到工期估算的准确性。

---

## 3. 决策合理性逐条评估（判断层）

| 决策 | 评估 | 理由 |
|------|:----:|------|
| **D-1** 分层轴=角色+稳定性 | ✅ 合理（但有未闭环风险，见 §4） | 用 Stable Dependencies Principle 替代"依赖数"是成熟做法；"依赖数是结果非原则"的批评准确 |
| **D-2** MCP=入站适配器 | ✅ 合理 | 与 IPC Handlers 同构论证强；"耦合业务=天职"正确 |
| **D-3** ACP 内部一分为二 | ✅ 合理 | "依赖 IRoleRepository ⇒ 携带领域知识 ⇒ 不可整体下沉 infra"是漂亮的判据；代码确认 client/ 为协议、collaboration+policies 为领域 |
| **D-4** Planning=领域非门面 | ✅ 合理 | 528 行内的 500 节点/深度/乐观锁/一次性反馈等均为硬不变量，已核实，非"组合翻译" |
| **D-5** Coordination 上移 D3 | ✅ 合理（低风险） | 3 文件/0 实体/0 持久化/事件进出，与 orchestrator 同物种，分类调整成本极低 |
| **D-6** 级联删除事件化 | ⚠️ **需重新权衡** | 见 §5，疑似过度设计 |
| **D-7** 不造共享 AI 抽象 | ✅ 合理 | Planning 对 AI 零引用已核实，IExecutor 已是边界；避免投机性泛化 |
| **D-8** Orchestrator 后缀 | ✅ 合理（低风险） | 命名契约自洽；附带要求重命名 `InquiryEscalationService` 也合理（它是被动的，留 Service 正确——文档此处需注意：该类**确实被动**，无需改名；需改名/标注的是 active 的 `InquiryRouter`） |

> **D-8 的一个小订正**：文档 §10.1 说"`InquiryEscalationService` 后缀与被动矛盾，重命名去 Service"。但代码核对显示 `InquiryEscalationService` **本就是被动**（靠 `scanAndEscalate()` 被周期性调用，不订阅事件），保留 `Service` 反而正确。真正与契约冲突的是 **`InquiryRouter`**——它订阅 `conversation:needs-routing` 事件、是 active 的，却既不叫 Orchestrator 也不叫 Coordinator。建议把改名/归类的焦点对准 `InquiryRouter`。

---

## 4. 最大隐患：D-1 放弃"层=依赖秩"后缺少强制手段

这是本评估最想让团队正视的一点。

D-1 的核心取舍是：**层退化为"角色标签"，依赖方向的唯一真相交给 §7 的 DAG 图**（文档 §4.3 明确承认"允许同层依赖"）。这个取舍本身合理——它换来了边界稳定、消除了 `L2-F` 补丁。

**但代价被低估了**：一旦"层"不再编码"只能向下依赖"，分层就**失去了作为架构约束的强制力**。原来"L1 不许 import L3"这种可以静态检查的规则没有了。文档把依赖真相托付给一张**手画的 mermaid DAG 图**——而图是会过时的，下一个 PR 引入一条 D1→D3 的反向边时，没有任何机制会报错。

**这正是文档想消灭的"边界抖动"换了一种形式回归**：从"加一条边就换层"变成"加一条边没人拦得住"。

**建议（开工前补齐）**：
- 把 §7 的 DAG 升级为**机器可校验的规则**，用 `dependency-cruiser` 或 `eslint-plugin-import` 的 `no-restricted-paths` 落地，纳入 CI。
- 规则至少应锁住：(a) Secondary Adapter 不被 Domain Core 反向 import；(b) 明确列出 D 层之间**允许**的边（白名单），其余一律红线。
- 否则 D-1 是"好理念 + 无护栏"，2~3 个迭代后 DAG 图与代码必然背离，分层沦为文档摆设。

§12.3 的验收里只有 `grep` 跨模块具体类导入这一条静态检查，**不足以**守住分层。这是路线图的一个缺口。

---

## 5. D-6 / OP-10 级联删除事件化：疑似过度设计

文档对 D-6 已有良好的风险意识（§1 提示需确认"删完立即查对话应为空"的同步预期）。但我认为权衡的天平摆错了方向，理由：

1. **问题规模很小**。文档自己实证：这个 setter **全类仅 `delete()` 一处使用**。为消除"一处"直接调用，引入 `task:deleted` 新事件 + Conversation 侧订阅者 + **异步最终一致**语义，复杂度/收益比偏高。

2. **事件化引入了原本没有的失败模式**。走 Outbox 后，任务删除提交与对话清理之间若崩溃，会出现"悬挂对话"窗口（至少一次投递最终会清理，但期间存在脏读风险）。需要额外确认：此窗口内是否有查询会读到孤儿对话、如何处理。文档的"确认同步预期"是必要的，但**不充分**——还需确认异步窗口内的读路径安全。

3. **被否决的方案 C（DB 外键 CASCADE）理由偏弱**。文档以"绕过领域事件、审计无感知"否决之。但对于"删任务连带删对话"这种**纯结构性级联**，外键 CASCADE 恰是最可靠、最省代码、零时序风险的方案；"审计无感知"只在确有"对话删除需独立审计"需求时才成立——而文档未给出该需求存在的证据。

**建议**：
- 若无"对话删除需进领域事件审计/通知 Renderer"的真实需求 → 优先考虑**方案 C（FK CASCADE）**或**方案 B（编排层 use-case 同步协调）**，而非默认事件化。
- 若坚持事件化，必须在文档补上"异步窗口内孤儿对话读路径"的处置，而不仅是"是否有同步删后即查"。
- 无论选哪个，D-6 的优先级可下调——它是这批改进里**收益最小、新增语义复杂度最高**的一项。

---

## 6. 其余观察（轻量）

| # | 观察 | 性质 |
|---|------|------|
| 1 | 文档提到的 `ToolProviders` / `*.provider.ts` / `mcp-protocol` 目前**尚不存在**，现状是 `mcp/handlers/*-tools.ts` + `register*Tools()` 函数式注册。文档把目标结构描述得略像现状，应明确标注"目标态" | 措辞 |
| 2 | OP-1 所需的 `ITaskService`/`IConversationCommandService`/`IRoleQueryService`/`IPlanningService` 接口**均不存在**，证实 OP-1 确为未动工的前置依赖，排在 Phase 1 正确 | 确认无误 |
| 3 | ACP 的协议/领域拆分目前是"逻辑已分（client/ vs collaboration/+policies/）、物理未分"。OP-8 是把 client/ 物理移到 `infrastructure/acp-protocol/`，工作量中等、收益真实 | 确认无误 |
| 4 | 风险/回滚章节（每 OP 独立 PR、可 `git revert`、不级联回滚）是良好工程纪律，值得保留 | 优点 |
| 5 | 路线图依赖排序（接口提取 Phase 1 → 解耦 → 拆分 → 归类落地）整体正确，OP-5/OP-8 置于接口提取之后符合依赖关系 | 优点 |

---

## 7. 修改建议清单（按优先级）

**必须改（阻断性）**
1. **修正"循环 re-export"事实错误**（§1.2）：当前为单向且为规避环而设，待清理项 #4 是伪命题，删除或重写。
2. **补齐分层强制手段**（§4）：用 dependency-cruiser/eslint 把 §7 DAG 落成 CI 可校验规则，否则 D-1 失去护栏。
3. **OP-4 标注为已完成**（§2）：修正路线图工作量。

**建议改（实质性）**
4. **重新权衡 D-6**（§5）：优先评估 FK CASCADE / 编排层同步方案；若坚持事件化，补异步窗口读路径处置；下调其优先级。
5. **D-8 改名焦点订正**（§3）：保留被动的 `InquiryEscalationService`，把归类/改名对准 active 的 `InquiryRouter`。

**可选改（措辞）**
6. 明确区分 MCP 目标态（ToolProviders/mcp-protocol）与现状（handlers 函数式注册），避免读者误以为已存在。

---

## 8. 详细修复建议（可直接落地）

本节把 §7 清单的每一项展开为**具体改法**：改哪个文件、写什么、如何验证。验收命令均按本仓 win32 + bash 环境给出。

### 修复 1 — 修正"循环 re-export"事实错误【必须 / 文档改动】

**现状**：`architecture-final.md` §7.1 待清理项 #4、§9.2 把 `acp.types ↔ execution.types` 称为"循环 re-export"。代码实测为单向、且注释明说是**为规避环**而设。

**改法（改 `architecture-final.md`，二选一）**：

- 方案 A（推荐，直接删项）：从 §7.1 表中删除第 4 行，因为"环"不存在，无债可清。
- 方案 B（保留为低优先类型整洁项）：把该行问题列改写为——

  > | 4 | `acp.types` 单向 re-export `LifecycleIntent`（**注：当前无循环，此 re-export 即为规避循环而设**） | 可选：将 `LifecycleIntent` 等共享类型提取到中性位置（如 `foundation/types/`），消除跨模块类型 re-export | Phase 2 低优先 |

  同时把 §9.2"两个可选改进"表里"execution.types ↔ acp.types"的 `↔` 改为 `→`，并去掉"循环"字样。

**验证**：
```bash
# 确认确实只有单向，没有反向引用（第二条应无输出）
grep -n "execution" apps/electron/src/core/modules/acp/types/acp.types.ts
grep -n "acp"       apps/electron/src/core/modules/execution/types/execution.types.ts
```

---

### 修复 3 — OP-4 标注为"已完成"【必须 / 文档改动】

**现状**：代码中 `TaskOrchestrator`/`ConversationOrchestrator`/`RunOrchestrator` 已是三个独立类并在 `bootstrap/orchestrator.module.ts` 分别装配；文档 §12.2 仍把 OP-4 列为 Phase 3 待办。

**改法（改 `architecture-final.md` §12.2 OP 总表）**：把 OP-4 行的 Phase 列由 `3` 改为标注：

> | OP-4 | Orchestrator 拆 3（职责隔离/可测试） | D-1 | ~~3~~ **✅ 已完成（acp-refactor）** |

并在 §12.1 阶段图中，把 Phase 3 的 `OP-4` 去掉（仅留 OP-5/OP-8），避免工期把已完成项计入。§5.5、§10.2 已按"既存事实"叙述，无需改。

**验证**：
```bash
ls apps/electron/src/core/modules/orchestrator/orchestrators/
# 应见 task.orchestrator.ts / conversation.orchestrator.ts / run.orchestrator.ts
grep -c "new \(Task\|Conversation\|Run\)Orchestrator" apps/electron/src/core/bootstrap/orchestrator.module.ts
# 应为 3
```

---

### 修复 4 — 重新权衡 D-6 级联删除【建议 / 决策 + 文档改动】

**目标**：用最小复杂度实现"删任务连带删对话"，并显式化异步窗口风险。

**决策树（建议写入文档替换现 D-6 描述）**：

```
是否存在"对话删除需进领域事件审计 / 通知 Renderer"的真实需求？
├─ 否（很可能）──→ 采用方案 C：SQLite FK ON DELETE CASCADE
│                   · 在 conversation 表 task_id 外键加 ON DELETE CASCADE
│                   · 删除 task.service.ts 的 setConversationRepository / convRepo / 级联循环
│                   · 零时序风险、零新事件、最少代码
│
└─ 是 ──→ 是否存在"删任务后同一调用栈内立即查对话应为空"的同步预期？
          ├─ 否 ──→ 方案 A 事件化（task:deleted），但必须补：
          │          异步窗口内孤儿对话的读路径处置（见下）
          └─ 是 ──→ 方案 B：编排层 use-case 同步协调删除
```

**若最终选方案 A，文档须补的"异步窗口处置"**：
- 列出所有"按 taskId 查对话"的读路径，确认在 `task:deleted` 投递完成前读到孤儿对话时的行为（过滤 / 容忍 / 标记 stale）。
- 明确 Outbox 至少一次投递下，Conversation 订阅者的删除须**幂等**（重复 `task:deleted` 不报错）。

**文档改动**：在 §1 D-6 注意点之外，新增上面的决策树；并在 §12.2 把 OP-10 的优先级注记为"低（收益最小，待 D-6 重新表决后再排期）"。

**验证（若选方案 C）**：
```bash
# 迁移后，task.service 不应再持有 convRepo
grep -n "convRepo\|ConversationRepository" apps/electron/src/core/modules/workflow/services/task.service.ts
# 应无输出
```

---

### 修复 5 — D-8 改名焦点订正【建议 / 文档 + 小幅代码改动】

**现状**：文档 §10.1 要求给被动的 `InquiryEscalationService` 去 `Service` 后缀，但该类实为被动（`scanAndEscalate()` 被周期调用），保留 `Service` 正确；真正违反契约的是 active 的 `InquiryRouter`（订阅 `conversation:needs-routing`）。

**改法**：
1. 文档 §10.1：删除"`InquiryEscalationService` 重命名去 Service"一句；改为——
   > `InquiryEscalationService` 为被动周期任务，保留 `Service` 后缀正确。
   > **`InquiryRouter` 订阅事件、属 active D3，命名未体现**：建议改 `InquiryOrchestrator`，或保留 `Router` 但在目录/文档显式标注归 D3 主动单元。
2. 代码（随 OP-9 一并做，归 Phase 4）：若选改名，`coordination/routing/inquiry.router.ts` → `inquiry.orchestrator.ts`，类名同步，更新 DI token 与 import。

**验证**：
```bash
grep -rn "needs-routing\|on('conversation" apps/electron/src/core/modules/coordination/
# 确认订阅事件的是 InquiryRouter（active），而 InquiryEscalationService 无事件订阅
```

---

### 修复 6 — MCP 目标态 vs 现状措辞澄清【可选 / 文档改动】

**改法**：在 §5.1 与 §6 目录结构图处加一句脚注：

> 注：`adapters/capibara-mcp/*.provider.ts` 与 `mcp-protocol/` 为 **OP-5 目标态**。现状为 `modules/mcp/handlers/*-tools.ts` + `register*Tools()` 函数式注册，尚未拆分。

避免读者把目标结构误读为已存在结构。

---

### 修复优先级与排期建议

| 修复 | 类型 | 工作量 | 建议时机 |
|------|------|:-----:|---------|
| 1 循环 re-export 订正 | 文档 | 5 min | 立即 |
| 3 OP-4 标完成 | 文档 | 5 min | 立即 |
| 2 分层 CI 护栏 | 工程 | 0.5~1 天 | **Phase 1 开工前**（最高优先） |
| 5 D-8 改名焦点 | 文档+小代码 | 文档即时 / 代码随 OP-9 | 文档即时 |
| 6 MCP 措辞 | 文档 | 5 min | 立即 |
| 4 D-6 重新权衡 | 决策+文档 | 评审会 0.5h | 下次评审会表决 |

> 文档类（1/3/5/6）可在一次提交内完成；工程类修复 2 应在任何 OP 动工前落地，作为后续所有重构的安全网。

---

## 9. 总评

| 评分维度 | 评价 |
|---------|------|
| 论证严谨度 | ★★★★☆ 代码实证比例高，绝大多数可复核且属实 |
| 决策合理性 | ★★★★☆ 7/8 决策合理，仅 D-6 权衡存疑 |
| 路线图可执行性 | ★★★☆☆ 排序正确，但 OP-4 已完成未标、缺分层强制手段 |
| 事实准确性 | ★★★★☆ 仅 1 处定性错误（循环 re-export） |

**总体可作为开发基线采纳**，但请在开工前完成 §7 的"必须改"三项——尤其是**分层强制手段（第 2 项）**，它决定了 D-1 这条"最根本的决策"究竟是真护栏还是纸面理念。

> （§1-§9 为结构维度评估。业务正确性维度见下方 §10，系应需求补充。）

---

## 10. 业务正确性维度评估（补充）

> 前九节评估的是"结构对不对"（模块/分层/职责/交互）。本节评估**业务正确性**：这套架构所做的决策与所提的改动，会不会**破坏或忽视系统真正要保证的业务规则**（计划树不变量、任务审批状态机、Run 并发与重试、ACP 协作链深/挂起恢复、事件投递语义）。
>
> 评估方法同前：逐条读领域代码、quote 实证。**关键区分**：下面分两类——
> - **A 类（架构级）**：架构文档的*决策本身*基于一个错误的业务前提，或其*提议的改动*会引入业务错误。**这类直接影响本基线能否照单实施。**
> - **B 类（实现级）**：既存代码里的业务缺陷，与架构重构不直接冲突，但重构时会被一并搬动，应顺带修。列出供团队知情。

### 10.1 总评（业务正确性）

**结论：从业务正确性看，这套架构"方向不破坏业务、但有两处决策建立在错误前提上，且一处系统性假设未被文档认领"。** 不能简单说"没问题"。三处 A 类问题必须在实施前处理。

| 严重度 | 问题 | 类别 | 触及决策 |
|:------:|------|:----:|---------|
| 🔴 高 | **D-4 的论据与代码矛盾**：Planning 的"硬不变量"（500 节点/深度 10）实际**不在 Planning 领域模块里，而在 MCP 适配器里** | A 架构级 | D-4 |
| 🔴 高 | **D-6 级联删除事件化会引入业务回归**：Conversation 有"仅终端态可删"的状态守卫，事件化后会与之冲突 | A 架构级 | D-6/OP-10 |
| 🔴 高 | **架构重度依赖 Outbox 至少一次投递，却从未要求订阅者幂等**：已确认存在非幂等订阅者 | A 架构级 | P5 事件优先 / 全局 |
| 🟡 中 | "每组织一个活跃 Run"不变量非原子保证，靠单线程兜底 | A/B 边界 | TaskOrch 门控 |
| 🟡 中 | ACP `resume()` 失败无回退到 rebuild，挂起会话可能永久卡死 | B 实现级 | D-3 涉及 |
| 🟡 中 | inquiry `aggregationMode='all'` 无聚合级超时，一个应答者不回则挂起 | B 实现级 | acp-domain |
| 🟢 低 | 任务深度 10 在创建时未校验（仅调度器忽略） | B 实现级 | — |

---

### 10.2 🔴 A-1：D-4 的核心论据与代码矛盾（最重要）

**决策 D-4 的定稿依据是**（文档 §1）："Planning = D1 能力领域（非门面），因为它有 **500 节点/深度/乐观锁等硬领域不变量**"。这是 Planning 被判为"真领域模块"而非"门面"的**唯一支撑论据**。

**代码实证推翻了这条依据的一半**：

- `MAX_TREE_NODES = 500`、`MAX_TREE_DEPTH = 10` 及其**校验逻辑**定义在 **`modules/mcp/handlers/plan-tree-tools.ts:7,8,104-118`** —— 即 **MCP 适配器层**。
- `planning.service.ts` 里确有 `countNodes()`/`measureDepth()`（518-526 行），但**仅用于在事件里报告 `nodeCount`（139/144/363/419 行），不做任何拒绝校验**。
- 也就是说：**500 节点 / 深度 10 这两条"硬不变量"，真正的守门人是 MCP 工具处理器，不是 Planning 领域服务。** 真正在 Planning 域内强制的，只有乐观锁、一次性反馈、24h 过期、`allowedChildren`。

**为什么这是架构级问题，而不只是"放错文件"**：
1. **它削弱了 D-4 自己的论证**。文档用"拥有硬不变量"证明 Planning 是领域模块；而最硬的两条不变量恰恰不在领域里。论据需要修正——好在 D-4 的**结论仍成立**（乐观锁/过期/allowedChildren 足以判定 Planning 是领域），但定稿表里的"500节点/深度"举例**必须换掉或加注**，否则是用一个错误事实支撑正确结论。
2. **它本身就是业务正确性漏洞**。按 D-2，MCP 是"薄转发"入站适配器。把核心领域不变量放在适配器里意味着：**任何不经 MCP 工具的路径（IPC、测试、未来其他入站适配器、计划树审批 `approvePending`）都绕过了 500/深度校验**。子代理已确认 `approvePending()` 与 `TaskService.create()` 路径上没有这两条限制的兜底。
3. **它与即将做的 OP-5（MCP 拆分/移出 modules）正面相撞**。当 MCP 被拆成"纯协议核心 + 薄 ToolProviders"时，这段领域校验逻辑该往哪放？文档没有回答——因为文档不知道它在那儿。

**建议（必须在实施前处理）**：
- 把 `MAX_TREE_NODES`/`MAX_TREE_DEPTH` 的**校验**从 `plan-tree-tools.ts` 下沉到 `PlanningService`（提交/审批两个入口都校验），MCP 处理器只做转发。这样 D-4 的论据才与代码自洽，且堵住非 MCP 路径绕过。
- 修订 D-4 定稿依据措辞：去掉"500节点/深度"作为"已在领域强制"的举例，或改为"应下沉至领域强制（见本评估 A-1）"。

---

### 10.3 🔴 A-2：D-6 级联删除事件化会引入业务回归

**决策 D-6 提议**：删任务时发 `task:deleted` 事件，Conversation 订阅后**自行删除关联对话**。文档把风险点只识别为"异步最终一致 / 删后即查"。

**但代码里藏着一条它没看到的业务规则**——`conversation.service.ts:292-302`：

```typescript
delete(conversationId: string): void {
  const conv = this.convRepo.findById(conversationId);
  if (!conv) throw new NotFoundError('Conversation', conversationId);
  const terminal = ['resolved','cancelled','completed','timed_out','escalated'];
  if (!terminal.includes(conv.state)) {
    throw new ConversationStateError(conversationId, conv.state, 'delete'); // ← 非终端态拒绝删除
  }
  this.convRepo.delete(conversationId);
}
```

**冲突在哪**：
- **当前**的隐藏 setter 走的是 `convRepo.delete()`（仓储层，**绕过**上面这条 service 守卫），所以删任务能连带删掉**任意状态**的对话。
- **事件化后**若 Conversation 订阅者改调 `ConversationService.delete()`（领域正道），则**非终端态对话会抛 `ConversationStateError`** → 级联删除静默失败（异步路径里异常只会被 log 吞掉）→ **产生孤儿对话**。这恰恰是 D-6 想消灭的问题，反而被它制造出来。
- 若订阅者继续走 `convRepo.delete()` 绕过守卫，那么"事件化"只是把一个绕过守卫的隐藏边，换成了另一个绕过守卫的隐藏订阅者——**所有权方向并没有如文档所说"回正"**。

**这是 A 类问题**：D-6 的"推荐路径（事件化）"在不澄清这条状态守卫的前提下，无论怎么实现都有业务缺陷。文档对 D-6 的风险分析（§1 仅"删后即查"）**不完整**。

**建议**：
- D-6 实施前必须回答：删任务时，**非终端态**的关联对话应当（a）强制删除、（b）先迁移到终端态再删、还是（c）拒绝删任务？这是**业务决策**，不是技术细节。
- 结合 §5 的既有建议：若答案是"无脑级联删"，**FK CASCADE（方案 C）反而最契合**——它就是绕过领域守卫的纯结构级联，语义诚实、零异步窗口。事件化在这里是最差选项。

---

### 10.4 🔴 A-3：架构依赖"至少一次"，却未认领"幂等"这个义务

**架构原则 P5"事件优先"+ §11 Outbox 模式**是这套设计的骨干：跨模块写、级联删除、路由、唤醒调度全部事件化，并明确写明 Outbox 保证**至少一次投递**（§11.1 "异步投递保证至少一次"）。

**"至少一次"在分布式/崩溃恢复语义下意味着：同一事件可能被投递两次。** 这是 Outbox 模式的固有代价。其**唯一**安全前提是：**所有事件订阅者必须幂等**。而——

- 文档全文（含 §11 事件章节、术语表、设计原则）**没有任何一处提到"幂等"或对订阅者提出幂等要求**。
- 代码实证：订阅者**并非都幂等**。已确认 `ConversationOrchestrator.onResponseNeeded()`（`conversation.orchestrator.ts:54-83`）在 gate 阻塞时**无条件 `pendingWakeRepo.create()`**，无去重键。`conversation:response-needed` 若被重投一次（崩溃后 Outbox 重放），就会**插入两条相同 pending_wake** → RunOrchestrator 排水时对同一对话**唤醒两次** → 重复 Run、重复消息、Token 双计。
- （公允起见：`onResolved()` 的 ACP 恢复路径**碰巧幂等**——靠 `findSuspensionByInquiry()` + 状态检查挡住重放，但这是"意外正确"，非设计保证。）

**这是 A 类、且是这套架构最系统性的业务正确性隐患**：架构把"至少一次"当成卖点写进文档，却没把它的对偶义务（幂等）变成架构约束。随着 P5 推动越来越多的写操作事件化，非幂等订阅者只会越来越多。

**建议（架构文档需补章节，不只是改代码）**：
- 在 §11 增加一节**"订阅者幂等契约"**：所有 `eventBus.on(...)` 处理器必须对重复投递安全。给出标准手段：(a) 事件带幂等键（如 `eventId`），订阅侧记录已处理集；或 (b) 写操作用"存在即跳过"语义（如 pending_wake 加 `UNIQUE(orgId,roleId,taskId,conversationId,reason)` 约束 + upsert）。
- 把"订阅者幂等"加入 §12.3 验收要点与 code review checklist。
- 立即修 `onResponseNeeded` 的重复 pending_wake（最小修法：pending_wakes 唯一约束 + `INSERT OR IGNORE`）。

---

### 10.5 🟡 A/B 边界：并发不变量靠单线程兜底（知情即可）

"每组织一个活跃 Run"（TaskOrchestrator 门控的核心不变量）的实现是：`WakeGateValidator` 先查 `findActiveByOrgId`，通过后才 `RunEngine.execute()` 创建 Run——**查与建之间非原子**。理论上两个唤醒可同时过闸建两个 Run。

实践中由 Electron 主进程**单线程 + RunEngine 内存 `activeOrgs` Set 二次防护**兜住，当前**不是现实风险**。但：这个核心业务不变量**不由代码逻辑保证，而由运行时单线程假设保证**。架构文档把它列为铁律不变量（§5.3"每组织一活跃 Run"），却未声明这层依赖。

**建议**：低优先。在文档为该不变量加一句"依赖主进程单线程串行；若未来引入 worker/多进程调度需改为 DB 层 `UNIQUE(org_id) WHERE status='running'` 约束"。属知情备案，非阻断。

---

### 10.6 🟡🟢 B 类实现缺陷（重构时顺带修，不阻断架构）

这些是既存领域代码的正确性缺陷，与架构决策不直接冲突，但**OP-8（ACP 拆分）等会搬动这些文件**，建议搬动时一并修：

| # | 缺陷 | 位置 | 业务后果 |
|---|------|------|---------|
| 1 | `resume()` 调 `resumeSession()`/`loadSession()` **无 try-catch 回退到 rebuild**；失败则记录停在 suspended | `acp-session.manager.ts:176-208` | 协议层一次抖动 → 挂起会话永久卡死，对话再不恢复（与文档宣称的"resume>load>rebuild 优雅降级"不符——降级只在创建时选策略，运行时失败不降级） |
| 2 | `aggregationMode='all'` 无聚合级超时；一个应答者崩溃则永远不 ready | `session-suspension.manager.ts` / `inquiry-aggregator.ts` | 多方询问只要一方失联，发起方会话挂起至 session TTL（默认 30min）才被动回收 |
| 3 | 任务 `depth = parent+1` 在 `create()` **不校验 ≤10**，仅调度器 `depth>10` 时 warn 跳过 | `task.service.ts:57` / `task.scheduler.ts:46` | 可创建深度 >10 的任务，永不被调度，静默堆积（违背"深度最大 10"宣称） |
| 4 | `restrictive` 工具策略**未实现**，回退为 `permissive`；denylist 仅 5 条且可绕过 | `tool-permission.policy.ts:55,74` | 设为 restrictive 的角色实际无限制（安全/正确性，按产品定位评估严重度） |
| 5 | 计划树状态合法性靠仓储查询 `findActiveByRootTaskId` 隐式保证，无显式状态机守卫 | `planning.service.ts:87` | 已 discarded/expired 的树若被其它路径取到仍可能被审批；当前靠查询过滤兜住，脆弱 |

> 注：B 类清单不求穷尽——它来自针对性抽查，目的是说明"架构重构会搬动的领域代码里存在哪些类型的正确性债"，供团队在对应 OP 中知情处理。**若需要完整的业务正确性审计，应作为独立任务另行展开**，不在本架构评估范围内。

---

### 10.7 业务正确性维度——回答"是否没问题"

**不是"没问题"。** 分三层说清：

1. **架构的结构决策本身不破坏业务逻辑**——模块怎么分、放哪一层，不改变运行时行为，这一层是安全的（§1-§9 已述）。
2. **但有两条决策（D-4、D-6）的业务前提与代码矛盾**：D-4 的"硬不变量在领域内"不属实，D-6 的事件化会撞上对话删除状态守卫。**这两条必须在实施前修正前提，否则会照着错误前提施工。**
3. **更系统的是 A-3**：整套架构的事件驱动骨干依赖"至少一次"，却从未把"订阅者幂等"写成约束，且已存在非幂等订阅者。这是会随重构放大的隐患。

**底线建议**：在 §7/§8 的修复清单基础上，**新增三项 A 类业务正确性修复（A-1/A-2/A-3）为开工前置**，与"分层 CI 护栏"同级。B 类缺陷随对应 OP 搬动时修复即可。

> 业务正确性评估结束。本节结论基于针对 Planning/Workflow/Execution/Orchestrator/ACP/Coordination/事件系统的领域代码抽查，非全量审计；标记为"已确认"者均经直接读码 + quote 验证。
