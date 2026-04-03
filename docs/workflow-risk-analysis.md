# Capibara 工作流程风险分析与潜在 Bug 报告

> 生成日期: 2026-04-03
> 严重程度: P0 (数据损坏/流程卡死) > P1 (逻辑错误) > P2 (边界问题) > P3 (健壮性)

---

## P0 — 流程卡死 / 数据一致性

### Bug 1: 非 epic/story 任务设置 requiresHumanApproval 后永久卡死

**文件**: `task.service.ts:127-170`, `approval.handlers.ts:61-95`

**现象**: 当 `task`/`subtask`/`bug`/`chore` 类型的任务分配给 `requiresHumanApproval=true` 的角色时，任务会永久卡在 `awaiting_review` 状态，无法被审批。

**原因链**:
1. 讨论组（Discussion Group）只在 `epic`/`story` 创建时自动生成（`discussion.service.ts:63`）
2. `task`/`subtask` 等类型不会创建讨论组
3. 当任务进入 `awaiting_review` 且无父角色审核时，由于 `requiresHumanApproval=true`，不会自动审批（`task.service.ts:161`）
4. `getPendingApprovals` 接口过滤条件 `if (!group) continue`（`approval.handlers.ts:77`）—— 没有讨论组就不会出现在待审批列表
5. 人工无法看到需要审批的任务，也无法投票

**影响**: 任务卡死，子任务永远无法推进，整条执行链阻塞。

**修复建议**:
- 方案 A: 对所有需要人工审批的任务类型也创建讨论组
- 方案 B: `getPendingApprovals` 不依赖讨论组，对没有讨论组的任务单独列出直接审批入口
- 方案 C: 在任务创建时校验——如果角色 `requiresHumanApproval=true`，不允许分配到无讨论组的任务类型

---

### Bug 2: ExecutionEngine 重复发射 `task:status-changed` 事件

**文件**: `execution.engine.ts:229-238`

**现象**: 任务从 `in_progress` 转为 `awaiting_review` 时，编排器会收到两次 `task:status-changed` 事件，可能导致重复唤醒。

**原因**:
```typescript
// execution.engine.ts:231 — 这里调用 transition() 已经发射了一次事件
await this.taskStateMachine.transition(taskNodeId, 'awaiting_review');

// execution.engine.ts:233-237 — 手动又发射了一次
this.eventBus.emit({
  type: 'task:status-changed',
  payload: { taskId: taskNodeId, oldStatus: 'in_progress', newStatus: 'awaiting_review' },
});
```

`TaskStateMachine.transition()` 内部已经 emit 了 `task:status-changed`（`task.state-machine.ts:40-44`），ExecutionEngine 又手动 emit 了一次，导致 `OrgOrchestrator.handleEvent` 被触发两次。

**影响**: 可能导致唤醒逻辑执行两次、PendingWake 重复入队、或在串行门控下产生竞态。

**修复**: 删除 `execution.engine.ts:233-237` 的手动 emit。

---

### Bug 3: 共识投票无去重 — 历史投票污染新一轮评估

**文件**: `consensus.detector.ts:33-70`, `discussion.service.ts`

**现象**: 共识检测器基于讨论组内**所有历史投票**的统计来判定结果，不区分修改轮次。

**场景**:
1. 轮次 1: AI-RoleA 投票 REVISE → 任务进入 revision
2. 角色修改后重新提交 → 任务回到 awaiting_review
3. 轮次 2: AI-RoleB 投票 APPROVE
4. 此时 `getVoteStats` 返回 `{APPROVE: 1, REVISE: 1}` → 因为 REVISE > 0，共识判定为 `revision`
5. 第一轮的 REVISE 投票永远阻止审批通过

**影响**: 任务经过一次修改后可能永远无法通过审批（REVISE 计数永远 > 0）。

**修复建议**:
- 方案 A: 每轮修改后清除讨论组的投票统计（或标记旧投票为 archived）
- 方案 B: `getVoteStats` 只统计最新一轮的投票（基于时间戳或轮次标记）
- 方案 C: 每个角色只取最新一次投票进行统计

---

## P1 — 逻辑错误

### Bug 4: 委派目标角色解析错误 — 共识检测器返回投票人而非目标

**文件**: `consensus.detector.ts:43-49`

**现象**: 当 AI 投票 DELEGATE 时，共识检测器将**投票人 (`authorRoleId`)** 作为委派目标返回，而不是实际的委派目标。

```typescript
// consensus.detector.ts:47 — authorRoleId 是投票人，不是委派目标
return { outcome: 'delegated', targetRoleId: delegateMsg.authorRoleId ?? '' };
```

**对比**: 人工投票路径从消息内容中解析目标（`discussion.service.ts:251`），两个路径逻辑不一致。

**影响**: AI 委派会把任务委派给投票发起者自己，形成死循环或无效委派。

**修复建议**: DELEGATE 投票需要携带 `targetRoleId` 元数据。可以在 `DiscussionMessage` 中增加 `metadata` 字段，或约定消息内容格式统一解析。

---

### Bug 5: 人工 DELEGATE 投票的目标解析过于脆弱

**文件**: `discussion.service.ts:249-256`

**现象**: 人工委派的目标角色通过正则 `/role\s+(\S+)/` 从消息内容中提取。

```typescript
const targetRoleId = latestMsg[0]?.content?.match(/role\s+(\S+)/)?.[1] ?? '';
```

但 UI 组件 `ApprovalPanelCard.tsx` 的 `onDelegate(targetRoleId)` 传递的是角色 ID。如果消息内容是用户自由输入的 feedback 或者前端传递格式不匹配，正则将无法匹配。

**影响**: `targetRoleId` 解析为空字符串 → `if (targetRoleId)` 判断失败 → 委派被静默丢弃，用户无感知。

**修复建议**: 委派目标应作为结构化字段传递，而非从自由文本中解析。建议在 `postMessage` 的 schema 中增加可选的 `delegateTargetRoleId` 字段。

---

### Bug 6: `wake:triggered` 事件可能唤醒错误的任务

**文件**: `org.orchestrator.ts:277-304`

**现象**: 当 `wake:triggered` 事件到达时，编排器通过 `findByAssignee(roleId)` 查找角色的所有任务，然后取第一个处于 eligible 状态的。

```typescript
const roleTasks = await this.taskRepo.findByAssignee(roleId);
const activeTask = roleTasks.find(t => eligibleStatuses.includes(t.status));
```

**问题**: 一个角色可能被分配了多个任务（例如在不同 Story 下）。`findByAssignee` 按 `created_at` 排序，`.find()` 取第一个匹配的——这可能不是触发唤醒的那个任务。

**场景**:
1. RoleA 被分配了 TaskX (in_progress) 和 TaskY (pending)
2. TaskY 的父任务被批准，触发 `wake:triggered` 给 RoleA
3. 编排器查找 RoleA 的任务，`.find()` 先匹配到 TaskX (in_progress)
4. Run 在 TaskX 上执行，TaskY 被忽略

**修复建议**: `wake:triggered` 事件应携带 `taskNodeId`，编排器直接使用指定的任务，不要通过角色反查。

---

### Bug 7: `checkAutoPropagate` 中 approved 叶子任务的判定不严谨

**文件**: `task.service.ts:218-271`

**问题**: 在检查"所有兄弟是否完成"时：

```typescript
if (s.status === 'approved') {
  const children = await this.taskRepo.findByParentId(s.id);
  if (children.length > 0) {
    const childrenDone = children.every(
      (c) => c.status === 'done' || c.status === 'approved' || c.status === 'cancelled',
    );
    if (!childrenDone) { allComplete = false; break; }
  }
  continue; // approved 且无子任务 = 完成
}
```

对于 `approved` 状态且有子任务的兄弟，检查子任务是否完成。但这个检查**只看了一层**——如果子任务也是 `approved` 状态且有自己的子任务，不会递归检查。

**场景**: Story(approved) → Task(approved) → Subtask(in_progress)。Story 被视为完成，但实际上 Subtask 还没做完。

**影响**: 父任务可能被过早推进到 done。

**修复建议**: 递归检查或只信任 `done` 状态作为真正完成的标志。

---

## P2 — 边界条件 / 竞态

### Risk 8: 事件处理的并发竞态

**文件**: `org.orchestrator.ts:67-78`

**现象**: 所有事件监听使用 `void this.handleEvent(e)`，即 fire-and-forget 异步执行。多个事件可能并发修改同一任务状态。

**场景**:
1. 两个子任务几乎同时完成，各自触发 `task:status-changed`
2. 两个 `handleEvent` 并发执行 `checkAutoPropagate`
3. 两者都读到"所有兄弟完成"，都尝试推进父任务
4. 第二次 `transition()` 可能失败（重复转换）或产生重复事件

**缓解**: 由于"每组织串行执行"约束，两个子任务不会真正同时完成。但 `checkAutoPropagate` 是在状态变更后同步调用的，而事件处理是异步的——如果 `task:status-changed` 的处理和 `checkAutoPropagate` 交叉执行，仍可能竞态。

**修复建议**: 考虑在 `OrgOrchestrator` 中加入每组织的事件处理队列（串行处理同一组织的事件）。

---

### Risk 9: `reviseCounts` 和 `selfWakeCounts` 为内存状态，重启后丢失

**文件**: `discussion.service.ts:31`, `org.orchestrator.ts:40-41`

**现象**: 修改循环计数器和自唤醒熔断计数器都存储在内存中。应用重启后：
- 修改循环保护失效 → 可能产生无限 REVISE 循环
- 自唤醒熔断失效 → 可能产生无限唤醒循环

**影响**: 在应用频繁重启的场景下（如开发调试、崩溃恢复），安全机制被绕过。

**修复建议**: 将计数器持久化到 SQLite，或在任务/讨论组记录中维护 `revise_count` 字段。

---

### Risk 10: 角色暂停后恢复时，PendingWake 不会被自动消费

**文件**: `approval.handlers.ts:98-111`, `org.orchestrator.ts:444-456`

**现象**: `resumeOrgRoles()` 只恢复角色状态到 `active`，但不触发消费 PendingWake 队列。

**场景**:
1. 预算超限 → 所有角色暂停，后续唤醒进入 PendingWake 队列
2. 用户提高预算并调用 `resumeOrgRoles`
3. 角色恢复为 active，但 PendingWake 队列中的任务不会被自动执行
4. 流程停滞，直到有新事件触发 `consumePendingWakes`

**修复建议**: `resumeOrgRoles` 完成后，主动触发一次 `consumePendingWakes` 或发射一个 `roles:resumed` 事件让编排器消费队列。

---

### Risk 11: `canApprove` 字段未参与共识评估

**文件**: `consensus.detector.ts`, `domain.types.ts:79`

**现象**: `Role` 接口定义了 `canApprove` 字段，但 `ConsensusDetector.evaluate()` 完全没有使用它。

- 不检查投票人是否有 `canApprove` 权限
- 不检查是否所有 `canApprove=true` 的角色都已投票（法定人数）

**影响**:
- 没有 `canApprove` 权限的角色投票也能影响共识结果
- 只需要 1 个 APPROVE 就算通过，没有法定人数要求

**修复建议**: 评估时过滤有效投票人，并实现法定人数逻辑（例如需要所有 `canApprove=true` 的角色都投票）。

---

## P3 — 健壮性 / 体验

### Risk 12: 人工 REVISE 投票对 `awaiting_review` 状态的遗漏处理

**文件**: `discussion.service.ts:224-246`

**现象**: 人工 REVISE 投票只对 `in_progress` 状态做了特殊处理（Phase 1 修改）。对于 `awaiting_review` 状态的任务，走的是通用 `handleRevision(group, feedback)` 路径。

但 `handleRevision` 内部调用 `taskStateMachine.transition(task.id, 'revision')`——如果任务已经是 `revision` 状态（例如前一次修改还未完成），`awaiting_review → revision` 是合法的，但再次触发 `review_revise` 唤醒可能在 Run 串行锁下被阻塞。

这不是严格的 bug，但人工连续投 REVISE 的行为可能导致 PendingWake 堆积。

---

### Risk 13: 任务删除不清理关联讨论组和 PendingWake

**文件**: `task.service.ts:202-216`

**现象**: `TaskService.delete()` 递归删除子任务，但不清理：
- 关联的讨论组（`discussion_groups` 表）
- 关联的 PendingWake 记录
- 关联的 Run 记录

**影响**: 数据库残留孤儿记录；如果 PendingWake 引用了已删除任务，`consumePendingWakes` 可能尝试唤醒不存在的任务。

---

### Risk 14: Orchestrator 的 `task:status-changed` 处理中 approved 判定缺少 orgId 传播

**文件**: `org.orchestrator.ts:155-231`

**场景**: 当一个有子任务的 approved 任务的 status changed 事件到达时：

```typescript
if (newStatus === 'approved') {
  const children = await this.taskRepo.findByParentId(taskId);
  if (children.length > 0) {
    // ...跳过兄弟推进
    return targets;
  }
}
```

这段代码在 `return targets` 之前已经可能添加了子任务的唤醒目标（Check 1 的逻辑）。但如果父任务有子任务且有兄弟——它会同时唤醒子任务和跳过兄弟推进，这是正确的。但如果父任务的子任务都已经是非 pending 状态（比如全部 cancelled），`firstPendingChild` 为 null，不会唤醒任何子任务，也跳过了兄弟推进——此时兄弟应该继续推进。

---

## 风险汇总矩阵

| # | 严重程度 | 风险类型 | 概要 | 状态 |
|---|---------|---------|------|------|
| 1 | **P0** | 流程卡死 | 非 epic/story 任务 + requiresHumanApproval = 永久卡死 | 需修复 |
| 2 | **P0** | 重复事件 | ExecutionEngine 重复发射 task:status-changed | 需修复 |
| 3 | **P0** | 逻辑错误 | 历史投票污染共识判定，REVISE 后永远无法通过 | 需修复 |
| 4 | **P1** | 逻辑错误 | 共识 DELEGATE 返回投票人而非目标 | 需修复 |
| 5 | **P1** | 脆弱解析 | 人工 DELEGATE 目标用正则从内容提取 | 需修复 |
| 6 | **P1** | 逻辑错误 | wake:triggered 可能唤醒错误任务 | 需修复 |
| 7 | **P1** | 逻辑错误 | checkAutoPropagate 只看一层子任务状态 | 需修复 |
| 8 | **P2** | 竞态 | 事件并发处理可能导致重复状态转换 | 建议改进 |
| 9 | **P2** | 持久性 | 熔断计数器重启后丢失 | 建议改进 |
| 10 | **P2** | 流程缺陷 | 角色恢复后 PendingWake 不自动消费 | 建议改进 |
| 11 | **P2** | 功能缺失 | canApprove 字段未参与共识评估 | 建议改进 |
| 12 | **P3** | 边界 | 人工连续 REVISE 导致 PendingWake 堆积 | 低优先级 |
| 13 | **P3** | 数据清理 | 任务删除不清理关联记录 | 低优先级 |
| 14 | **P3** | 边界 | approved 任务子任务全 cancelled 时兄弟推进被跳过 | 低优先级 |

---

## 建议修复优先级

```
第一批 (P0 — 立即修复):
  Bug 1 → 非 epic/story 任务的人工审批路径
  Bug 2 → 删除重复事件发射
  Bug 3 → 投票按轮次统计

第二批 (P1 — 尽快修复):
  Bug 4+5 → 统一委派目标传递机制
  Bug 6 → wake:triggered 携带 taskNodeId
  Bug 7 → checkAutoPropagate 递归或只信任 done

第三批 (P2 — 迭代改进):
  Risk 8 → 组织级事件串行队列
  Risk 9 → 计数器持久化
  Risk 10 → 角色恢复触发队列消费
  Risk 11 → canApprove 参与共识
```
