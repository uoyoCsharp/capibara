# Capibara 重构架构评估报告

> **对象**: `refactoring-architecture-plan.md` v2.0
> **日期**: 2026-04-24
> **评估人**: Winston (System Architect)
> **状态**: 待 uoyo 审核
> **方法**: 方案文档审读 + 当前代码库实证核查

---

## 摘要

重构方案 v2.0 的**核心判断全部正确**：三底座切分、事件驱动协调、删除 Discussion/Narrative、Session 合并入 Conversation — 这些是扎实的架构动作。

但代码实证核查发现一个**关键事实**：方案里我之前担心的几个"未来风险"（跨底座耦合、metadata 类型不安全、Run 字段互斥缺失），**当前代码里已经存在**。这份评估的目的不是批判 v2.0 方案，而是提醒：**重构如果不主动修正这些点，它们会原封不动继承到新架构里**。

### 核查结论一览

| # | 评估项 | 方案处理方式 | 代码现状 | 风险 |
|---|--------|---------------|----------|------|
| 1 | Conversation→Organization 耦合 | 方案允许"单向只读"例外 | ✅ 已存在（直接调 `IRoleRepository`） | 🔴 高 |
| 2 | PendingPlanStore 分层归属 | 方案下沉到 Infrastructure | ✅ 已实现，但为纯内存易失 | 🟡 中 |
| 3 | metadata: Record\<string, unknown\> | 方案未讨论 | ✅ 已广泛存在，含 15+ 处不安全类型断言 | 🔴 高 |
| 4 | Run.taskId / conversationId 互斥 | 方案用表格描述 | ✅ 字段独立可空，无约束 | 🟡 中 |
| 5 | 数据迁移安全 | 方案未讨论 | ❌ 迁移 v8 直接 `DROP TABLE runs` + `DELETE cost_entries` | 🔴 高 |
| 6 | 并发与事务边界 | 方案完全未提 | ❌ 无显式锁；事件在事务内发射 | 🟡 中 |
| 7 | Orchestrator 膨胀 | 方案保留单体设计 | ⚠️ 222 行 / 11 订阅 / 14 依赖，逼近临界 | 🟡 中 |
| 8 | EventDigester 必要性 | 方案保留在 Notification | ❌ **当前代码中完全未被调用（死代码）** | 🟢 低 |
| 9 | Approval / Discussion 状态 | 方案计划重新建模 | ✅ Discussion 从未存在；Approval 已实现 | 🟢 低 |
| 10 | Session → Conversation 合并 | 方案安排在 Phase 2 | ✅ **已合并完成**（v8 迁移已 DROP sessions） | 🟢 低 |

**关键洞察**：方案的 Phase 2 所描述的"合并 Session 到 Conversation"**已经在主代码中完成**。v2.0 方案部分描述的是**当前代码已是的状态**而非"未来要做的状态"，这意味着 Phase 编号和工作量需要重新评估。

---

## 详细核查

### 🔴 项 1 — Conversation → Organization 已经直接耦合

**方案 v2.0 表述**：
> "Conversation → Organization 允许单向只读依赖（用于 InquiryRouter 查询角色层级和能力），无循环依赖"

**代码现状**：
文件 `apps/electron/src/core/modules/conversation/routing/inquiry.router.ts:1-69`

```typescript
// line 2
import type { IRoleRepository } from '@core/modules/organization/interfaces/i-role.repository';

// line 7-11 — 构造器直接注入 organization 的 repository
@injectable()
export class InquiryRouter {
  constructor(
    private readonly roleRepo: IRoleRepository,
    private readonly logger: ILogger,
  ) {}

  route(request: RoutingRequest): RoutingDecision {
    // line 14 - 直接调用 organization 层
    const askingRole = this.roleRepo.findById(request.askingRoleId);
    // line 29 - 再调
    const parent = this.roleRepo.findById(askingRole.parentId);
    // line 41-42 - 再调
    const siblings = askingRole.parentId
      ? this.roleRepo.findChildren(askingRole.parentId)
      : this.roleRepo.findByOrgId(askingRole.orgId);
```

另见 `apps/electron/src/core/modules/conversation/services/inquiry-escalation.service.ts:3` 也直接引用 `IRoleRepository`。

**评估**：
- 当前并非"未来风险"，而是**已落地的设计选择**
- 代码通过直接服务调用（非事件）读取 organization 数据，耦合点是**同步、编译时的**
- 如果 v2.0 维持现状，那么"底座独立"只是纸面原则

**对重构的影响**：
- 如果想真正独立底座，需要把 `InquiryRouter` 和 `InquiryEscalationService` 从 `modules/conversation/` 迁出到 `modules/orchestrator/`（协调层）
- 不改则需诚实修改方案文档的"依赖规则"一节，承认这是结构性依赖

**建议（优先级：P0）**：
- **方案 A（推荐）**：把 `InquiryRouter` 上移到 Layer 2。Conversation 发 `conversation:needs-routing` 事件 → InquiryRouter 消费 → 读 Organization → 回写 respondent
- **方案 B**：接受现状，在方案文档的"依赖规则"中删除"底座独立"的绝对表述，改为"Conversation 保留只读查询 Organization 的能力，且该能力不得被滥用为写依赖"

---

### 🟡 项 2 — PendingPlanStore 已在 Infrastructure，但是纯内存

**方案 v2.0 表述**：
> "PendingPlanStore 位于 Infrastructure 层 — MCP Bridge (L1.5) 写入 PendingPlanStore，Planning (L3) 读取。两者互不依赖，解决了 L1.5 → L3 的逆向依赖问题。"

**代码现状**：
文件 `apps/electron/src/core/infrastructure/stores/pending-plan.store.ts`

- 位置：✅ 在 `infrastructure/stores/` 下，方向正确
- 实现：**纯内存 Map**，无 SQLite 持久化
- Reader：`modules/planning/planning.service.ts:40-54`（`getPendingPlan` + `confirmPlan`）
- Writer：`modules/mcp/bridge/capibara-mcp-bridge.ts:80-92` 接入 `capibara_plan_tasks` 工具

**评估**：
- 分层归属是对的
- 但纯内存 Store 意味着：应用重启、崩溃 → pending plan 丢失
- 同时这个设计违反了 Capibara 自己的原则 — 领域概念（一个"待确认的计划"）被伪装成基础设施

**对重构的影响**：
- 低 — 功能上能跑
- 中 — 长期会有"PendingApprovalStore / PendingReviewStore" 等同型号兄弟陆续堆积到 Infrastructure

**建议（优先级：P1）**：
- 短期：在文档里说清楚"纯内存"是刻意选择（pending plan 是易失工作状态，重启丢失是可接受的）
- 长期考虑用 **EventBus 解耦**替代共享 Store：
  ```
  MCP Bridge → emit('plan:submitted', { conversationId, plan })
  Planning Service → on('plan:submitted') → 维护自己的私有 pendingPlans
  ```
  这样 Infrastructure 层没有领域概念，且共享可变状态消失

---

### 🔴 项 3 — metadata 类型不安全已经系统性存在

**方案 v2.0 表述**：
> `metadata: Record<string, unknown>; // 类型特定的扩展数据`

方案既没讨论该字段如何演进，也没提供类型安全化方案。

**代码现状**：
- **Conversation.metadata**: `modules/conversation/types/conversation.types.ts:21`
- **Repository 反序列化**: `modules/conversation/persistence/sqlite-conversation.repository.ts:42`
  ```typescript
  metadata: JSON.parse(row.metadata || '{}') as Record<string, unknown>
  ```
- **Orchestrator 事件消费**（`modules/orchestrator/orchestrator.ts`）：发现 **11+ 处**把 `event.payload` 强断言为 `Record<string, string>`：
  ```typescript
  // line 64, 75, 88, 94, 102, 114, 129, 137, 142...
  const { taskId } = event.payload as Record<string, string>;
  ```
- **Stream 解析器**（`modules/execution/workers/stream-json-parser.ts`）：2 处类似断言

**评估**：
- 这是**当前代码的系统性问题**，不是未来风险
- 每个 Orchestrator handler 开头第一行都是类型强断言 — 任何事件 payload schema 变更无法被编译器捕获
- Conversation 的三种类型（inquiry/planning/adhoc）各自有结构化的元数据需求（respondent 路由信息、pending plan id、外部 session id 等），混在一个 `unknown` 包里

**对重构的影响**：
- 高 — 重构本身就是 schema 大动的时机。不借此机会解决，之后每次微调都要写 runtime 断言
- Capibara 的 `CLAUDE.md` 约定"使用 Zod 校验所有外部输入"，但事件 payload 和 metadata 恰恰没有走 Zod

**建议（优先级：P0）**：
1. **事件 payload 类型化**：在 `foundation/events.ts` 为每个事件类型定义 typed payload：
   ```typescript
   type DomainEventMap = {
     'task:status-changed': { taskId: string; orgId: string; from: string; to: string; assigneeRoleId: string | null };
     'conversation:response-needed': { conversationId: string; orgId: string; roleId: string };
     // ...
   };
   type DomainEvent<T extends keyof DomainEventMap> = { type: T; timestamp: string; payload: DomainEventMap[T] };
   ```
2. **metadata 改判别联合**：按 ConversationType 拆分
   ```typescript
   type Conversation =
     | (ConversationBase & { type: 'inquiry'; metadata: InquiryMetadata })
     | (ConversationBase & { type: 'planning'; metadata: PlanningMetadata })
     | (ConversationBase & { type: 'adhoc'; metadata: AdhocMetadata });
   ```
3. Zod schema 与 TS 类型一体化，Repository 反序列化走 Zod `parse` 而非 `as`

---

### 🟡 项 4 — Run.taskId / conversationId 互斥无任何保障

**方案 v2.0 表述**：
> 表格说明四种场景：Task execution (taskId set, conv null), Inquiry response (both set), Planning / Adhoc (taskId null, conv set)

**代码现状**：
- 类型定义 `modules/execution/types/execution.types.ts:26-27`：
  ```typescript
  taskId: string | null;
  conversationId: string | null;
  ```
- 数据库 schema `infrastructure/persistence/sqlite/migrations.ts:172-173`:
  ```sql
  task_id TEXT REFERENCES tasks(id) ON DELETE CASCADE,
  conversation_id TEXT REFERENCES conversations(id) ON DELETE SET NULL,
  ```
  **无 CHECK 约束**

**评估**：
- 四种合法组合里，其中"两个都 null" 和 "两个都 set 但不是 inquiry 场景" 都是非法状态，当前**既无编译期保证也无运行时保证**
- 一次 bug 就可能写入畸形数据，污染历史

**对重构的影响**：
- 低 — 功能正确性目前靠"约定"维护
- 但重构就是加约束的最好时机

**建议（优先级：P1）**：
1. **数据库加 CHECK**:
   ```sql
   CHECK (task_id IS NOT NULL OR conversation_id IS NOT NULL)
   ```
   至少排除"两者都 null"这种最糟情况
2. **类型用判别联合**:
   ```typescript
   type RunTarget =
     | { taskId: string; conversationId: null }
     | { taskId: string; conversationId: string }
     | { taskId: null; conversationId: string };
   type Run = RunBase & RunTarget;
   ```
3. **Repository 写入时 Zod 校验组合合法性**

---

### 🔴 项 5 — 数据迁移已经在做破坏性操作

**方案 v2.0 表述**：Phase 0 提到"Write migration plan"，但方案正文**未涉及迁移安全策略**。

**代码现状**：
文件 `infrastructure/persistence/sqlite/migrations.ts`

**迁移 v8（已运行过的迁移）的破坏性操作**：
```typescript
// line 347 — 清空所有成本记录（等于抹掉所有消费审计）
db.exec('DELETE FROM cost_entries WHERE 1=1');

// line 348 — 直接删 runs 表（等于抹掉所有历史运行记录）
db.exec('DROP TABLE IF EXISTS runs');

// line 399-400 — 删除 session 遗留表
db.exec('DROP TABLE IF EXISTS sessions');
db.exec('DROP TABLE IF EXISTS session_messages');
```

附带注释：`// Old run history is not critical for the new architecture`

**评估**：
- **v8 迁移已经跑过了**。这解释了为什么项 10（Session 合并）显示"已完成"：sessions 表已经被 drop 掉
- 但这种"出了问题也回不来"的模式还保留在 migration runner 里
- 方案 Phase 2 再做一次 Conversation 表大改，会继承同样的风险
- `better-sqlite3` 的 transaction 提供原子性，但不提供 **业务数据回滚**（一旦事务提交成功但结果不对，数据就真没了）

**对重构的影响**：
- Capibara 是本地桌面应用，用户数据仅存在用户机器上的 SQLite 里。迁移失败 = 用户数据丢失，且**无任何云端兜底**

**建议（优先级：P0）**：
1. **迁移前自动备份**：在 migration runner 的外层包一层逻辑，每次首次运行新迁移前复制 SQLite 文件为 `capibara.db.backup.v{N}`
2. **保留迁移前旧表 N 个版本**（rename 而非 drop）：
   ```sql
   ALTER TABLE sessions RENAME TO sessions_legacy_v8;
   -- 在 v12 再真正 DROP sessions_legacy_v8
   ```
3. **Phase 0 的迁移计划**必须包含：备份策略、迁移失败的用户侧行为（回滚到备份 / 进入只读维护模式）、迁移日志落地点
4. 对用户透明：首次启动新版本时给出对话框"即将进行数据库升级，是否备份"

---

### 🟡 项 6 — 并发/事务边界隐式且缺文档

**方案 v2.0 表述**：完全未涉及。

**代码现状**：
- **DB 层**：`infrastructure/persistence/sqlite/sqlite-connection.ts:12-29` 启用 WAL + 5s busy timeout
- **应用层**：无任何显式 lock / mutex / queue
- **并发控制**：`modules/orchestrator/wake-gate.validator.ts:28`
  ```typescript
  const activeRun = this.runRepo.findActiveByOrgId(orgId);
  ```
  靠"查一下有没有 active run"做门禁，这是**check-then-act** pattern，本身非原子
- **事件发射时机**：`modules/conversation/services/conversation.service.ts:195-197`
  ```typescript
  private emitEvent(type: DomainEventType, payload: Record<string, unknown>): void {
    this.eventBus.emit({ type, timestamp: new Date().toISOString(), payload });
  }
  ```
  事件在 service 方法中直接同步发射，**在 DB 事务内**。如果事务最终回滚，事件监听者已经看到的副作用无法撤销

**评估**：
- Electron 主进程是单线程 JS，这缓解了大部分并发问题
- 但 `better-sqlite3` 是同步阻塞的，长事务会阻塞整个主进程；而 Orchestrator 事件 handler 可能触发重入（handler 里调 service → service emit 事件 → 下一个 handler 同步执行）
- 事件在事务内 emit 是最主要的**幽灵事件**风险来源

**对重构的影响**：
- 重构后 Orchestrator 订阅更多事件，链路更长，重入风险更高

**建议（优先级：P1）**：
1. **事件发射改为事务后**：引入 outbox 模式，或至少让 `eventBus.emit` 延迟到 service 方法返回之后（`queueMicrotask` / `setImmediate`）
2. **在 `refactoring-architecture-plan.md` 增加 §11 Concurrency & Consistency 章节**，至少声明：
   - 同 Role 并发策略（单 Role 串行）
   - 同 Task 并发策略（单 assignee）
   - 事件发射时机（commit 后）
   - Orchestrator handler 重入策略
3. 长期考虑引入事件队列（内存 queue）把同步 emit 改为异步消费

---

### 🟡 项 7 — Orchestrator 已逼近单体临界

**方案 v2.0 表述**：保留单一 Orchestrator，引入 RunCoordinator 来分担执行细节。

**代码现状**：
文件 `modules/orchestrator/orchestrator.ts`（222 行）

指标清点：
- **行数**：222
- **依赖**：14 个（构造器参数）— eventBus, logger, taskRepo, roleRepo, orgRepo, convRepo, pendingWakeRepo, wakeGateValidator, retryScheduler, runCoordinator, taskScheduler, taskStateMachine, processEngine, behaviorEngine
- **事件订阅**：10 种（line 43-55）
- **状态字段**：3 处（`pausedTasks`, `scheduledTaskIds`, `locale`）
- **Handler 方法**：9 个（onTaskCreated / onTaskStatusChanged / onTaskEnteredApproval / onTaskApprovalConfirmed / onTaskCompleted / onConversationResponseNeeded / onConversationResolved / onRunFailed / onRunEnded）

**评估**：
- 现在还可读，但**已经在"god object"的边缘**
- 重构后方案还要加 approval 流程处理、可能增加 planning 相关事件 handler — 超过 15 个订阅后就难读了
- Orchestrator 本身持有状态（`pausedTasks` 内存 Set）— 这些状态是"内存真相"，重启丢失；重构会需要持久化它们或者用 DB 状态代替

**对重构的影响**：
- 方案 v2.0 保留单 Orchestrator 的决策本身没错，但需要前置"拆分阈值"约定

**建议（优先级：P1）**：
1. **现在就拆**（不等阈值）：
   - `TaskOrchestrator` — task:* 事件 + scheduleNext + pausedTasks
   - `ConversationOrchestrator` — conversation:* 事件
   - `RunOrchestrator` — run:* 事件 + retry
   - 三者共享 `WakeGateValidator` / `BudgetGuard` / `RunCoordinator`
2. **pausedTasks 状态持久化**：把"因审批而暂停的任务"落到 DB（例如 tasks.paused_reason 列），而不是内存 Set。这样应用重启后调度行为一致
3. **事件订阅抽离成声明**：每个 sub-orchestrator 用一个 `subscriptions(): EventSubscription[]` 方法返回，再由 bootstrap 注册；避免 `start()` 方法膨胀

---

### 🟢 项 8 — EventDigester 是死代码

**方案 v2.0 表述**：列在 Notification 模块下，标注"事件批处理和聚合（窗口化）"

**代码现状**：
文件 `modules/notification/event-digester.ts`
- 有 buffer + 窗口化 flush 的代码结构
- **全代码库搜索：无任何地方 `import EventDigester`**
- `EventBroadcaster`（`modules/notification/event-broadcaster.ts`）直接实时映射事件，没用 digester

**评估**：
- EventDigester 是之前为 Narrative 服务的遗留代码
- Narrative 已规划移除（方案 §4 Removed Features 确认），digester 也就失去唯一消费者
- 列在方案架构图里会误导未来维护者

**建议（优先级：P2）**：
- 方案文档删除 EventDigester 的组件条目
- 代码中在 Phase 1 删除 `event-digester.ts`

---

### 🟢 项 9 — Discussion 从未存在；Approval 已实现

**方案 v2.0 表述**：Phase 3 描述"移除 Discussion、新建 Approval"

**代码现状**：
- Discussion：grep `DiscussionGroup`, `ConsensusDetector`, `discussion_messages` — **全部零结果**
- Approval：**已经实现**
  - 事件：`foundation/events.ts:6-8` 已定义 `task:entered-approval`, `task:approval-confirmed`, `task:approval-rejected`
  - Status category: `modules/workflow/types/workflow.types.ts:3` 枚举已含 `'approval'`
  - State machine: `modules/workflow/engines/task.state-machine.ts:45-52` 有 confirmApproval / rejectApproval
  - IPC：`ipc-handlers/workflow.handlers.ts` 有 `capibara:approval:confirm` / `capibara:approval:reject`

**评估**：
- Phase 3 的 "Remove Discussion" 是**空工**
- Phase 3 的 "Build Approval" 也**已完成**

**对重构的影响**：
- Phase 3 整个可以删除，Phase 编号和预计工作量需重排

**建议（优先级：P1）**：
- 方案 Phase 3 移除 / 合并到 Phase 1 中的残余清理部分

---

### 🟢 项 10 — Session → Conversation 合并已完成

**方案 v2.0 表述**：Phase 2 整个围绕此合并展开

**代码现状**：
- `sessions` / `session_messages` 表已于迁移 v8 被 DROP（`migrations.ts:399-400`）
- `conversations` 表已含 `external_session_id TEXT` 字段（`migrations.ts:125`）
- 代码库中无 Session 实体，`ConversationService` 已处理三种 type
- `Conversation.type` CHECK 已含 `inquiry / planning / adhoc`（`migrations.ts:115`）

**评估**：
- 方案 Phase 2 描述的是**当前已是状态**
- 唯一还没做的子任务可能是 Prompt strategies 更新（方案列为 "Update Prompt strategies for new Conversation model"）

**对重构的影响**：
- Phase 2 大部分已完成；剩下只需核查 Prompt 侧的适配

**建议（优先级：P1）**：
- 方案 Phase 2 应重写为"核查并补齐 Conversation 相关的 Prompt、IPC、UI 适配残余工作"，工作量从大改为小
- **v2.1 修订版必须同步刷新 Phase 计划**以反映实际代码现状

---

## 对重构方案的结构性建议

### 必须前置处理（阻塞重构启动）

1. **P0 — 数据迁移安全策略**：未先定义备份/回滚机制前不得启动 Phase 2 及之后
2. **P0 — 事件 payload 类型化 + metadata 判别联合**：借 Phase 1 一并做完，否则重构只是搬代码不是升级
3. **P0 — InquiryRouter 归属决策**：要么上移到 Layer 2，要么承认依赖例外并更新方案文档

### 需并行推进（可与 Phase 1/2 同时）

4. **P1 — 并发与事务边界文档化**：新增方案 §11
5. **P1 — Phase 编号重排**：基于代码实况重新划定各 Phase 范围（Phase 2/3 大幅瘦身）
6. **P1 — Orchestrator 拆分**：推荐 Phase 1 就拆成 3 个子 Orchestrator

### 可作为清理项

7. **P2 — EventDigester 删除**
8. **P2 — Run 互斥约束落地**（DB CHECK + TS 判别联合）

---

## 结论

方案 v2.0 方向正确，但存在三类落差：

| 落差类型 | 表现 | 应对 |
|---------|------|------|
| **方案落后于代码** | Phase 2/3 描述的工作大部分已完成 | 更新 Phase 计划，避免产出"纸面工作量" |
| **方案忽略代码债** | metadata 不安全、Run 互斥无约束、事件在事务内 emit | 借重构清偿技术债 |
| **方案留有灰色地带** | 跨底座耦合、迁移安全、并发模型 | 在 v2.1 补全明确规则 |

**推荐下一步**：产出 `refactoring-architecture-plan.v2.1.md`，重点修订：
- Phase 0 增加迁移安全小节
- Phase 1 合并原 Phase 3 残余、补充事件/metadata 类型化任务
- Phase 2 重写为"补齐剩余 Conversation 适配"
- 架构文档新增 §11 并发与事务边界
- Appendix A Design Decisions Log 新增 D8（迁移策略）、D9（事件类型化）

评估结束。请 uoyo 审核并决定是否进入 v2.1 修订。

---

*Produced by Winston · 2026-04-24*
