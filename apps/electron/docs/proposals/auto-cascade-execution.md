# Capibara 自动级联执行机制 — 设计提案 v3

## 1. 问题陈述

当前系统存在三个问题阻碍自动化执行：

1. **事件流只向上传播**：子任务完成可以通知父任务，但父任务审批通过后，子任务无人唤醒
2. **PendingWake 队列无消费者**：wake 被写入队列后，没有代码在 run 结束后消费它
3. **BehaviorEngine 无法工作**：JSON 配置与 TypeScript 代码完全不对齐，且从未被调用

---

## 2. 设计原则

| 原则 | 说明 |
|------|------|
| Schema 驱动 | 所有自动行为由 schema 的 behaviorRules 定义，代码中不硬编码任何状态名 |
| 用户可自定义 | 用户通过组合字段表达式编写条件，不需要改代码 |
| 事件驱动调度 | TaskScheduler 不轮询，由 Orchestrator 在事件中调用 |
| 幂等决策 | scheduleNext() 每次从当前状态重新计算 |
| 阻塞等待 | 子任务无 assigneeRoleId 时阻塞调度链，保证执行顺序完整性 |

---

## 3. BehaviorEngine 重写

### 3.1 设计思路

BehaviorEngine 的三个层面各有不同的灵活性需求：

- **Trigger**：系统事件，引擎层面的事实，保持枚举
- **Condition**：用户需要灵活组合，改为通用字段表达式
- **Action**：系统能力，保持枚举，参数数据驱动

### 3.2 Trigger 定义

Trigger 是系统可检测的事件，固定枚举：

| Trigger | 含义 | 调用时机 |
|---------|------|---------|
| `on_status_enter` | 任务进入某个状态 | TaskStateMachine.transition() 之后 |
| `on_all_children_terminal` | 所有子任务都到达 terminal | Orchestrator.onTaskCompleted() 中检查 |

### 3.3 Condition 表达式系统

#### 可引用字段

引擎从当前任务 + schema 自动计算所有字段，用户不需要知道底层实现：

| 字段路径 | 类型 | 说明 | 来源 |
|----------|------|------|------|
| `task.type` | string | 任务类型名 | Task.type |
| `task.status` | string | 当前状态名 | Task.status |
| `task.depth` | number | 层级深度 | Task.depth |
| `task.hasChildren` | boolean | 是否有子任务 | taskRepo.findChildren().length > 0 |
| `task.hasAssignee` | boolean | 是否有指派角色 | Task.assigneeRoleId !== null |
| `status.category` | string | 当前状态的 category | schema.statuses lookup |
| `type.isLeaf` | boolean | 是否叶子类型 | schema.workItemTypes lookup |
| `type.canDecompose` | boolean | 是否可拆分 | schema.workItemTypes lookup |

#### 操作符

| 操作符 | 含义 | 适用类型 |
|--------|------|---------|
| `eq` | 等于 | 所有类型 |
| `neq` | 不等于 | 所有类型 |
| `in` | 在列表中 | string, number |
| `not_in` | 不在列表中 | string, number |
| `gt` | 大于 | number |
| `lt` | 小于 | number |

#### 组合逻辑

| 组合 | 含义 | 语法 |
|------|------|------|
| `all` | AND，所有条件都满足 | `{ "all": [ ...conditions ] }` |
| `any` | OR，任一条件满足 | `{ "any": [ ...conditions ] }` |
| `not` | NOT，取反 | `{ "not": condition }` |

#### 无条件

省略 `condition` 字段或设为 `null`，表示始终匹配。

#### 示例

```json
// 单条件
{ "field": "type.isLeaf", "op": "eq", "value": true }

// AND 组合
{
  "all": [
    { "field": "status.category", "op": "eq", "value": "terminal" },
    { "field": "type.isLeaf", "op": "eq", "value": true }
  ]
}

// OR + NOT 嵌套
{
  "any": [
    { "field": "task.type", "op": "eq", "value": "bug" },
    { "not": { "field": "task.depth", "op": "gt", "value": 3 } }
  ]
}
```

### 3.4 Action 定义

Action 是系统能力，固定枚举，参数数据驱动：

| Action type | 参数 | 含义 |
|------------|------|------|
| `transition` | `{ targetStatus: string }` | 自动转换到目标状态 |

后续可扩展的 action（不在本次实现范围）：

| Action type | 参数 | 含义 |
|------------|------|------|
| `notify` | `{ channel, message }` | 发送通知 |
| `wake_role` | `{ roleId }` | 唤醒指定角色 |

### 3.5 完整 BehaviorRule Schema

```typescript
// ── Trigger ─────────────────────────────────────

type BehaviorTrigger = 'on_status_enter' | 'on_all_children_terminal';

// ── Condition ───────────────────────────────────

interface FieldCondition {
  field: string;
  op: 'eq' | 'neq' | 'in' | 'not_in' | 'gt' | 'lt';
  value: unknown;
}

interface AllCondition {
  all: BehaviorCondition[];
}

interface AnyCondition {
  any: BehaviorCondition[];
}

interface NotCondition {
  not: BehaviorCondition;
}

type BehaviorCondition = FieldCondition | AllCondition | AnyCondition | NotCondition;

// ── Action ──────────────────────────────────────

type BehaviorActionType = 'transition';

interface BehaviorAction {
  type: BehaviorActionType;
  params?: Record<string, unknown>;
}

// ── Rule ────────────────────────────────────────

interface BehaviorRule {
  id: string;
  name: string;
  priority: number;
  trigger: BehaviorTrigger;
  condition?: BehaviorCondition | null;  // null / 省略 = 始终匹配
  action: BehaviorAction;
}
```

### 3.6 default.json 重写

```json
"behaviorRules": [
  {
    "id": "default-auto-done-leaf",
    "name": "Auto-complete leaf on terminal entry",
    "priority": 10,
    "trigger": "on_status_enter",
    "condition": {
      "all": [
        { "field": "status.category", "op": "eq", "value": "terminal" },
        { "field": "type.isLeaf", "op": "eq", "value": true }
      ]
    },
    "action": { "type": "transition", "params": { "targetStatus": "done" } }
  },
  {
    "id": "default-propagate-parent",
    "name": "Auto-complete parent when all children terminal",
    "priority": 20,
    "trigger": "on_all_children_terminal",
    "action": { "type": "transition", "params": { "targetStatus": "done" } }
  }
]
```

用户自定义示例（极简 schema：`open → working → closed`）：

```json
"behaviorRules": [
  {
    "id": "auto-close-leaf",
    "name": "Auto-close leaf on terminal entry",
    "priority": 10,
    "trigger": "on_status_enter",
    "condition": {
      "all": [
        { "field": "status.category", "op": "eq", "value": "terminal" },
        { "field": "type.isLeaf", "op": "eq", "value": true }
      ]
    },
    "action": { "type": "transition", "params": { "targetStatus": "closed" } }
  },
  {
    "id": "auto-close-parent",
    "name": "Auto-close parent when children all done",
    "priority": 20,
    "trigger": "on_all_children_terminal",
    "action": { "type": "transition", "params": { "targetStatus": "closed" } }
  }
]
```

不引用 `approved`、不引用 `done`，完全基于自己的 schema 编写。

### 3.7 BehaviorEngine 实现

```typescript
export class BehaviorEngine {
  constructor(
    private readonly taskRepo: ITaskRepository,
    private readonly processEngine: ProcessEngine,
    private readonly taskStateMachine: TaskStateMachine,
    private readonly logger: ILogger,
  ) {}

  // ── 公开方法：由各调用方在正确时机调用 ──────────

  /**
   * 任务进入新状态时调用。
   * 由 TaskStateMachine.transition() 在状态更新后调用。
   */
  onStatusEnter(task: Task): void {
    this.evaluateAndExecute('on_status_enter', task);
  }

  /**
   * 子任务完成时调用，检查是否所有兄弟都已完成。
   * 由 Orchestrator.onTaskCompleted() 调用。
   */
  onChildCompleted(childTask: Task): void {
    if (!childTask.parentId) return;

    const siblings = this.taskRepo.findChildren(childTask.parentId);
    const allTerminal = siblings.every(s =>
      this.processEngine.getStatusCategory(s.orgId, s.status) === 'terminal'
    );

    if (!allTerminal) return;

    const parent = this.taskRepo.findById(childTask.parentId);
    if (!parent) return;

    this.evaluateAndExecute('on_all_children_terminal', parent);
  }

  // ── 内部逻辑 ─────────────────────────────────

  private evaluating = new Set<string>();

  private evaluateAndExecute(trigger: BehaviorTrigger, task: Task): void {
    // 重入防护
    const key = `${task.id}:${trigger}`;
    if (this.evaluating.has(key)) return;
    this.evaluating.add(key);

    try {
      const schema = this.processEngine.getSchema(task.orgId);
      if (!schema) return;

      const context = this.buildContext(task, schema);
      const rules = schema.behaviorRules
        .filter(r => r.trigger === trigger)
        .sort((a, b) => a.priority - b.priority);

      for (const rule of rules) {
        if (this.evaluateCondition(rule.condition, context)) {
          this.logger.info('Behavior rule matched', { ruleId: rule.id, taskId: task.id, trigger });
          this.executeAction(rule.action, task);
        }
      }
    } finally {
      this.evaluating.delete(key);
    }
  }

  private buildContext(task: Task, schema: ProcessSchema): Record<string, unknown> {
    const statusDef = schema.statuses.find(s => s.name === task.status);
    const typeDef = schema.workItemTypes.find(t => t.name === task.type);
    const children = this.taskRepo.findChildren(task.id);

    return {
      'task.type': task.type,
      'task.status': task.status,
      'task.depth': task.depth,
      'task.hasChildren': children.length > 0,
      'task.hasAssignee': task.assigneeRoleId !== null,
      'status.category': statusDef?.category ?? null,
      'type.isLeaf': typeDef?.isLeaf ?? false,
      'type.canDecompose': typeDef?.canDecompose ?? false,
    };
  }

  private evaluateCondition(condition: BehaviorCondition | null | undefined, context: Record<string, unknown>): boolean {
    if (condition == null) return true;

    // ALL
    if ('all' in condition) {
      return condition.all.every(c => this.evaluateCondition(c, context));
    }

    // ANY
    if ('any' in condition) {
      return condition.any.some(c => this.evaluateCondition(c, context));
    }

    // NOT
    if ('not' in condition) {
      return !this.evaluateCondition(condition.not, context);
    }

    // FieldCondition
    const { field, op, value } = condition as FieldCondition;
    const actual = context[field];

    switch (op) {
      case 'eq':     return actual === value;
      case 'neq':    return actual !== value;
      case 'in':     return Array.isArray(value) && value.includes(actual);
      case 'not_in': return Array.isArray(value) && !value.includes(actual);
      case 'gt':     return typeof actual === 'number' && typeof value === 'number' && actual > value;
      case 'lt':     return typeof actual === 'number' && typeof value === 'number' && actual < value;
      default:       return false;
    }
  }

  private executeAction(action: BehaviorAction, task: Task): void {
    switch (action.type) {
      case 'transition': {
        const targetStatus = action.params?.targetStatus as string;
        if (!targetStatus) {
          this.logger.warn('Behavior action missing targetStatus', { taskId: task.id });
          return;
        }
        this.taskStateMachine.transition(task.id, targetStatus);
        break;
      }
      default:
        this.logger.warn('Unknown behavior action type', { type: action.type, taskId: task.id });
    }
  }
}
```

### 3.8 调用方接入

#### TaskStateMachine.transition()

```typescript
transition(taskId: string, newStatus: TaskStatus): Task {
  // ... existing: validate, updateStatus, emit events ...

  // ★ 调用 BehaviorEngine
  const updated = this.taskRepo.findById(taskId)!;
  this.behaviorEngine.onStatusEnter(updated);

  return this.taskRepo.findById(taskId)!;
}
```

#### Orchestrator.onTaskCompleted()

```typescript
private onTaskCompleted(event: DomainEvent<unknown>): void {
  const { taskId, orgId } = event.payload as Record<string, string>;
  this.pausedTasks.delete(taskId);

  const task = this.taskRepo.findById(taskId);
  if (!task) return;

  // ★ 调用 BehaviorEngine（检查兄弟是否全部完成 → 父任务自动转换）
  this.behaviorEngine.onChildCompleted(task);

  // ★ 调度下一个任务
  this.scheduleNext(orgId);
}
```

---

## 4. TaskScheduler — 调度决策引擎

### 4.1 接口

```typescript
export interface ScheduleResult {
  task: Task;
  wakeReason: WakeReason;
}

export class TaskScheduler {
  constructor(
    private readonly taskRepo: ITaskRepository,
    private readonly processEngine: ProcessEngine,
    private readonly logger: ILogger,
  ) {}

  findNextTask(orgId: string): ScheduleResult | null;
}
```

### 4.2 调度算法

策略：**深度优先 + createdAt 排序**（Task 无 priority 字段，使用创建顺序）

```typescript
findNextTask(orgId: string): ScheduleResult | null {
  const roots = this.taskRepo.findByOrgId(orgId)
    .filter(t => t.parentId === null)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));

  for (const root of roots) {
    const result = this.findInSubtree(root, 0);
    if (result) return result;
  }
  return null;
}

private findInSubtree(task: Task, depth: number): ScheduleResult | null {
  if (depth > 10) return null;

  const category = this.processEngine.getStatusCategory(task.orgId, task.status);

  // initial（如 pending）+ 有 assignee → 可调度
  if (category === 'initial' && task.assigneeRoleId) {
    return { task, wakeReason: 'task_scheduled' };
  }

  // initial + 无 assignee → 阻塞
  if (category === 'initial' && !task.assigneeRoleId) {
    this.logger.warn('Task blocked: no assigneeRoleId', { taskId: task.id });
    return null;
  }

  // terminal → 自身完成，递归查子任务
  if (category === 'terminal') {
    return this.findInChildren(task.id, depth);
  }

  // active / approval → 正在执行或等待审批，跳过
  return null;
}

private findInChildren(parentId: string, depth: number): ScheduleResult | null {
  const children = this.taskRepo.findChildren(parentId)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));

  for (const child of children) {
    const result = this.findInSubtree(child, depth + 1);
    if (result) return result;
  }
  return null;
}
```

### 4.3 调度决策表

| 状态 category | assigneeRoleId | 调度动作 |
|--------------|---------------|---------|
| initial | 有 | **返回此任务** |
| initial | 无 | **阻塞返回 null** |
| active | — | 跳过 |
| approval | — | 跳过 |
| terminal | — | 递归查子任务 |

### 4.4 阻塞语义

当某个子任务无 assigneeRoleId 时，调度链阻塞：

```
Story A (done)
  ├── Task 1 (done)
  ├── Task 2 (pending, 无角色)  ← 阻塞点
  └── Task 3 (pending, 有角色)  ← 不会被调度
```

用户在 UI 中为 Task 2 分配角色后，下一次 scheduleNext 调用会找到它。

---

## 5. Orchestrator 改动

### 5.1 新增依赖

```typescript
export class Orchestrator {
  constructor(
    // ... existing ...
    private readonly taskScheduler: TaskScheduler,       // ★ NEW
    private readonly taskStateMachine: TaskStateMachine,  // ★ NEW
    private readonly processEngine: ProcessEngine,        // ★ NEW
    private readonly behaviorEngine: BehaviorEngine,      // ★ NEW
  ) {}
}
```

### 5.2 新增事件监听

```typescript
start(): void {
  // ... existing listeners ...

  // ★ run 结束后：消费队列 + 调度下一个
  this.subscribe('run:succeeded', (e) => this.onRunEnded(e));
  this.subscribe('run:failed', (e) => {
    this.onRunFailed(e);
    this.onRunEnded(e);
  });
  this.subscribe('run:cancelled', (e) => this.onRunEnded(e));
}
```

### 5.3 修改 onTaskApprovalConfirmed

```typescript
private onTaskApprovalConfirmed(event: DomainEvent<unknown>): void {
  const { taskId, orgId } = event.payload as Record<string, string>;
  this.pausedTasks.delete(taskId);
  this.logger.info('Task scheduling resumed after approval', { taskId });

  // ★ 审批通过后调度子任务（不再唤醒已审批任务自身）
  this.scheduleNext(orgId);
}
```

### 5.4 修改 onTaskCompleted

```typescript
private onTaskCompleted(event: DomainEvent<unknown>): void {
  const { taskId, orgId } = event.payload as Record<string, string>;
  this.pausedTasks.delete(taskId);

  const task = this.taskRepo.findById(taskId);
  if (!task) return;

  // ★ BehaviorEngine: 检查兄弟全部完成 → 父任务自动转换
  this.behaviorEngine.onChildCompleted(task);

  // ★ 调度下一个任务
  this.scheduleNext(orgId);
}
```

### 5.5 新增 onRunEnded

```typescript
private onRunEnded(event: DomainEvent<unknown>): void {
  const { orgId } = event.payload as Record<string, string>;

  // ★ 消费 PendingWake 队列（修复已有 bug）
  this.drainPendingWakes(orgId);

  // ★ 调度下一个任务
  this.scheduleNext(orgId);
}
```

### 5.6 新增 drainPendingWakes

```typescript
private drainPendingWakes(orgId: string): void {
  const next = this.pendingWakeRepo.findNext(orgId);
  if (!next) return;

  this.pendingWakeRepo.delete(next.id);

  const gate = this.wakeGateValidator.validate(next.roleId, orgId);
  if (!gate.allowed) {
    // 仍然被阻塞，放回队列
    this.pendingWakeRepo.create({
      roleId: next.roleId, orgId, reason: next.reason,
      taskId: next.taskId, priority: next.priority,
    });
    return;
  }

  this.logger.info('Draining pending wake', { roleId: next.roleId, taskId: next.taskId });
  this.runCoordinator.executeForTask(
    next.taskId!, next.roleId, orgId,
    next.reason as WakeReason, this.locale,
  ).catch((err) => {
    this.logger.error('Pending wake execution failed', { error: String(err) });
  });
}
```

### 5.7 新增 scheduleNext

```typescript
private scheduledTaskIds = new Set<string>();

private scheduleNext(orgId: string): void {
  const result = this.taskScheduler.findNextTask(orgId);
  if (!result) {
    this.logger.debug('No schedulable tasks', { orgId });
    return;
  }

  const { task } = result;

  // 从 schema 获取 initial → active 的第一个合法 transition 目标
  const transitions = this.processEngine.getAvailableTransitions(orgId, task.status);
  const activeTarget = transitions.find(t => {
    const cat = this.processEngine.getStatusCategory(orgId, t.to);
    return cat === 'active';
  });

  if (!activeTarget) {
    this.logger.warn('No active transition from initial status', { taskId: task.id, status: task.status });
    return;
  }

  this.scheduledTaskIds.add(task.id);
  // transition 会发出 task:status-changed → onTaskStatusChanged → tryWake
  this.taskStateMachine.transition(task.id, activeTarget.to);
}

private onTaskStatusChanged(event: DomainEvent<unknown>): void {
  const { taskId, assigneeRoleId, orgId } = event.payload as Record<string, string>;
  if (!assigneeRoleId || this.pausedTasks.has(taskId)) return;

  // ★ 区分手动 vs 自动调度
  const reason: WakeReason = this.scheduledTaskIds.has(taskId)
    ? 'task_scheduled'
    : 'task_assigned';
  this.scheduledTaskIds.delete(taskId);

  this.tryWake(assigneeRoleId, orgId, reason, taskId);
}
```

---

## 6. 新增 WakeReason

```typescript
export type WakeReason =
  | 'task_assigned'           // 用户手动分配/触发
  | 'task_scheduled'          // ★ NEW: TaskScheduler 自动调度
  | 'task_completed'
  | 'review_requested'
  | 'review_approve'
  | 'review_revise'
  | 'review_delegate'
  | 'delegation_completed'
  | 'retry_failed'
  | 'dispute_detected'
  | 'conversation_reply'
  | 'conversation_escalation';
```

在 prompt 中 `task_scheduled` 与 `task_assigned` 使用相同的指令模板。区别体现在日志和 Run 记录中。

---

## 7. TypeScript 类型改动

### 7.1 workflow.types.ts — 替换

```typescript
// ── 旧类型（删除） ───────────────────────

type BehaviorTrigger = 'on_status_enter' | 'on_status_exit' | 'on_task_created'
  | 'on_task_completed' | 'on_approval_confirmed' | 'on_approval_rejected';  // ← 旧的

interface BehaviorCondition {
  field: string;
  operator: 'equals' | 'not_equals' | 'in' | 'not_in';
  value: unknown;
}

type BehaviorActionType = 'transition' | 'wake_role' | 'create_child_task' | 'notify';

interface BehaviorAction {
  type: BehaviorActionType;
  params: Record<string, unknown>;
}

interface BehaviorRule {
  id: string; name: string; priority: number;
  trigger: BehaviorTrigger;
  condition: BehaviorCondition | null;
  action: BehaviorAction;
}

// ── 新类型（替换） ───────────────────────

type BehaviorTrigger = 'on_status_enter' | 'on_all_children_terminal';

interface FieldCondition {
  field: string;
  op: 'eq' | 'neq' | 'in' | 'not_in' | 'gt' | 'lt';
  value: unknown;
}

interface AllCondition {
  all: BehaviorCondition[];
}

interface AnyCondition {
  any: BehaviorCondition[];
}

interface NotCondition {
  not: BehaviorCondition;
}

type BehaviorCondition = FieldCondition | AllCondition | AnyCondition | NotCondition;

type BehaviorActionType = 'transition';

interface BehaviorAction {
  type: BehaviorActionType;
  params?: Record<string, unknown>;
}

interface BehaviorRule {
  id: string;
  name: string;
  priority: number;
  trigger: BehaviorTrigger;
  condition?: BehaviorCondition | null;
  action: BehaviorAction;
}
```

### 7.2 ProcessSchema 不变

```typescript
interface ProcessSchema {
  workItemTypes: WorkItemTypeDefinition[];
  statuses: StatusDefinition[];
  transitions: TransitionDefinition[];
  behaviorRules: BehaviorRule[];  // 类型变了，字段不变
}
```

---

## 8. default.json 改动

改动 `behaviorRules` 部分（移除旧的 3 条规则，替换为 2 条），同时移除 workItemTypes 中的 `hasDiscussionGroup` 字段：

```json
"behaviorRules": [
  {
    "id": "default-auto-done-leaf",
    "name": "Auto-complete leaf on terminal entry",
    "priority": 10,
    "trigger": "on_status_enter",
    "condition": {
      "all": [
        { "field": "status.category", "op": "eq", "value": "terminal" },
        { "field": "type.isLeaf", "op": "eq", "value": true }
      ]
    },
    "action": { "type": "transition", "params": { "targetStatus": "done" } }
  },
  {
    "id": "default-propagate-parent",
    "name": "Auto-complete parent when all children terminal",
    "priority": 20,
    "trigger": "on_all_children_terminal",
    "action": { "type": "transition", "params": { "targetStatus": "done" } }
  }
]
```

---

## 9. 完整事件流示例

以 `Epic → 2 Story → 各 2 Task` 为例：

```
 1. 用户创建 Epic (pending, assignee=PM)

 2. 用户在 UI 触发 Epic → in_progress
    → task:status-changed → onTaskStatusChanged → tryWake(PM, 'task_assigned')
    → Claude CLI 执行

 3. AI PM 拆分: 创建 Story A, Story B (pending)
    → AI: capibara_task_transition(epic, 'awaiting_review')
    → task:entered-approval → pausedTasks.add(epic)

 4. 用户审批 Epic → approved
    → BehaviorEngine.onStatusEnter(epic):
      → status.category=terminal, type.isLeaf=false → Rule 1 不匹配（非叶子）
    → task:approval-confirmed → onTaskApprovalConfirmed
    → scheduleNext(orgId)
    → TaskScheduler: Epic(terminal) → Story A(pending, assignee=Dev) ✓
    → transition(Story A, 'in_progress') → tryWake(Dev, 'task_scheduled')

 5. AI Dev 拆分 Story A → Task A1, A2
    → Story A → awaiting_review → pause
    → run:succeeded → onRunEnded → drainPendingWakes + scheduleNext
    → scheduleNext: Story A(approval) 跳过, Story B(pending) 可调度
    → transition(Story B, 'in_progress') → tryWake(Dev, 'task_scheduled')
    → WakeGate: 如有 activeRun → PendingWake

 6. 用户审批 Story A → approved
    → BehaviorEngine.onStatusEnter(storyA):
      → type.isLeaf=false → Rule 1 不匹配
    → scheduleNext → Task A1(pending) → 执行

 7. Task A1 (叶子) → approved
    → BehaviorEngine.onStatusEnter(taskA1):
      → status.category=terminal, type.isLeaf=true → Rule 1 匹配
      → action: transition(taskA1, 'done')
    → task:completed(taskA1)
    → BehaviorEngine.onChildCompleted(taskA1):
      → siblings: [A1(done), A2(pending)] → 非全部 terminal
    → scheduleNext → Task A2(pending) → 执行

 8. Task A2 → done（同上流程）
    → task:completed(taskA2)
    → BehaviorEngine.onChildCompleted(taskA2):
      → siblings: [A1(done), A2(done)] → 全部 terminal → Rule 2 匹配
      → action: transition(Story A, 'done')
    → task:completed(storyA)
    → BehaviorEngine.onChildCompleted(storyA):
      → siblings: [Story A(done), Story B(?)] → 检查
      → 如果 Story B 也 done → transition(Epic, 'done') ✅
      → 否则 → scheduleNext → 继续调度 Story B 的子任务

 9. 全部完成 → Epic → done ✅
```

---

## 10. 防护机制

### 10.1 BehaviorEngine 重入防护

```typescript
private evaluating = new Set<string>();
// key = `${taskId}:${trigger}` → 同一任务同一 trigger 不会重入
```

防止场景：`transition(task, 'done')` → `onStatusEnter` → Rule 匹配 → `transition(task, X)` → `onStatusEnter` 循环

### 10.2 TaskScheduler 深度限制

```typescript
if (depth > 10) return null;
```

### 10.3 scheduleNext 幂等性

多个事件同时触发 `scheduleNext` 不会导致重复调度：
- 第一次调用 `transition(task, activeTarget)` 成功，task 离开 initial
- 第二次调用时 task 已不是 initial，`findNextTask` 不会返回它
- WakeGate 保证同时只有一个 run

### 10.4 已有防护（无需改动）

| 防护 | 说明 |
|------|------|
| 单 run 约束 | WakeGateValidator:28 `findActiveByOrgId` |
| 预算控制 | WakeGateValidator + RunEngine 双重检查 |
| 重试熔断 | RetryScheduler maxRetries + 指数退避 |
| 角色熔断 | WakeGateValidator consecutiveWakeCount |

---

## 11. 文件变更清单

### 新增

| 文件 | 说明 |
|------|------|
| `src/core/modules/orchestrator/task.scheduler.ts` | 调度决策引擎 |
| `tests/unit/orchestrator/task-scheduler.test.ts` | TaskScheduler 单元测试 |
| `tests/unit/workflow/behavior-engine.test.ts` | BehaviorEngine 单元测试 |

### 修改

| 文件 | 说明 |
|------|------|
| `src/core/modules/workflow/engines/behavior.engine.ts` | 完全重写 |
| `src/core/modules/workflow/types/workflow.types.ts` | 替换 Behavior 相关类型 |
| `src/core/modules/orchestrator/orchestrator.ts` | 集成调度器 + 队列消费 + BehaviorEngine |
| `src/core/modules/workflow/engines/task.state-machine.ts` | 接入 BehaviorEngine.onStatusEnter |
| `src/core/modules/execution/types/execution.types.ts` | 新增 task_scheduled |
| `src/core/modules/prompt/strategies/task-prompt.strategy.ts` | 处理 task_scheduled |
| `src/core/bootstrap/orchestrator.module.ts` | 注入 TaskScheduler + 新依赖 |
| `src/core/bootstrap/workflow.module.ts` | BehaviorEngine 新构造参数 |
| `resources/workflows/default.json` | behaviorRules 重写 |

### 测试补充

| 文件 | 说明 |
|------|------|
| `tests/unit/orchestrator/task-scheduler.test.ts` | DFS、阻塞、深度限制、createdAt 排序 |
| `tests/unit/workflow/behavior-engine.test.ts` | 条件表达式（all/any/not）、action 执行、重入防护 |
| `tests/unit/orchestrator/orchestrator.test.ts` | 级联调度、队列消费、scheduleNext 幂等 |
| `tests/unit/workflow/task.state-machine.test.ts` | 追加 BehaviorEngine 接入用例 |

---

## 12. 实现顺序

### Phase 1: 类型 + BehaviorEngine 重写

1. `workflow.types.ts` — 替换 Behavior 相关类型
2. `behavior.engine.ts` — 完全重写
3. `default.json` — behaviorRules 重写
4. `tests/unit/workflow/behavior-engine.test.ts` — 条件表达式全覆盖

### Phase 2: BehaviorEngine 接入

5. `task.state-machine.ts` — 注入 BehaviorEngine，transition() 末尾调用 onStatusEnter
6. `workflow.module.ts` — 更新 BehaviorEngine 构造参数

### Phase 3: TaskScheduler + Orchestrator

7. `execution.types.ts` — 新增 `task_scheduled`
8. `task.scheduler.ts` — 实现调度算法
9. `orchestrator.ts` — 新增依赖 + scheduleNext + drainPendingWakes + 新事件监听
10. `orchestrator.module.ts` — 注入 TaskScheduler 及新依赖

### Phase 4: Prompt + 测试

11. `task-prompt.strategy.ts` — task_scheduled 指令
12. 所有测试文件

---

## 13. 风险与缓解

| 风险 | 影响 | 缓解 |
|------|------|------|
| 自定义 schema 的 behaviorRules 配置错误 | targetStatus 不存在于 transitions 中 | ProcessEngine.saveSchema() 增加 behaviorRules 校验 |
| 子任务无 assigneeRoleId | 调度链阻塞 | 设计决策，UI 需提示用户分配角色 |
| BehaviorEngine transition action 触发循环 | 死循环 | 重入防护 Set |
| onTaskCompleted 递归冒泡 | 栈溢出 | parentId===null 终止 + 实际深度不超过 4-5 层 |
| drainPendingWakes 与 scheduleNext 竞争 | 调度冲突 | drain 先执行，scheduleNext 被 WakeGate 阻断 |
| default.json behaviorRules 格式变更 | 旧数据不兼容 | 全新项目，无迁移负担 |
