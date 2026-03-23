# Code Review Report

> Change ID: `20260320-progress-feedback-human-intervention`
> Reviewer: Code Quality Guardian
> Date: 2026-03-21

---

## Summary

- **Overall Assessment**: Good
- **Files Reviewed**: 8
- **Critical Issues**: 0
- **Warnings**: 3
- **Suggestions**: 4

---

## ADR Compliance Check

| ADR | Decision | Status | Notes |
|-----|----------|--------|-------|
| ADR-001 | JSON Lines 存储格式 | ✅ Compliant | `JsonExecutionLogStore` 使用 `.jsonl` 格式 |
| ADR-001 | 按 pipelineId 分文件 | ✅ Compliant | `getFilePath()` 按 pipelineId 分文件 |
| ADR-001 | 输出最大 10KB | ✅ Compliant | `MAX_OUTPUT_SIZE = 10240` |
| ADR-002 | PipelineContext.interactionHistory | ✅ Compliant | 已添加到 `PipelineContext` |
| ADR-002 | 最近 3 轮记录 | ✅ Compliant | `interactionHistory.length > 3` 时 `pop()` |
| ADR-003 | 构造函数注入 HumanInteractionHandler | ✅ Compliant | `WorkerNodeHandler` 构造函数注入 |
| ADR-003 | mode 判定时机 | ✅ Compliant | manual: Worker 后, semi-auto: escalate 后 |
| ADR-004 | 事件 payload 增强 | ✅ Compliant | `output` + `outputTruncated` 字段 |

---

## Critical Issues

无

---

## Warnings

### W1: JsonExecutionLogStore.query() 性能问题

**File**: `src/infrastructure/persistence/json-execution-log-store.ts:37-76`

**Issue**: `query()` 方法调用 `loadAllLogs()` 加载所有日志文件到内存，然后过滤。当日志量大时会严重影响性能。

**Suggestion**: 按设计 ADR-001 采用"按 pipelineId 分文件"，query 应该只加载目标 pipeline 的日志文件。

```typescript
// Current
async query(query: ExecutionLogQuery): Promise<ExecutionLogEntry[]> {
  const allLogs = await this.loadAllLogs();  // ❌ 加载所有文件
  // ...
}

// Suggested fix
async query(query: ExecutionLogQuery): Promise<ExecutionLogEntry[]> {
  let logs: ExecutionLogEntry[];

  if (query.pipelineId) {
    // ✅ 只加载目标 pipeline 的日志文件
    logs = await this.loadLogsByPipeline(query.pipelineId);
  } else {
    logs = await this.loadAllLogs();
  }
  // ... filtering
}
```

**Severity**: Warning (非关键路径，但影响可扩展性)

---

### W2: ProgressQueryService.getInteractionHistory() 逻辑复杂

**File**: `src/application/progress/progress-query.service.ts:113-158`

**Issue**: 该方法从日志重建 InteractionRecord，逻辑复杂且可能与 WorkerNodeHandler 中实际记录不一致。

**Suggestion**: 既然 InteractionRecord 已经存储在 `PipelineContext.interactionHistory` 中，应该直接从 StateStore 读取，而不是从日志重建。

```typescript
// Current - 从日志重建 (复杂且可能不一致)
async getInteractionHistory(pipelineId: string, phase: Phase, count: number): Promise<InteractionRecord[]> {
  const logs = await this.logStore.query({...});
  // ... 复杂的重建逻辑
}

// Suggested - 直接从 context 读取
async getInteractionHistory(pipelineId: string, phase: Phase, count: number): Promise<InteractionRecord[]> {
  const state = await this.stateStore.load(pipelineId);
  if (!state) return [];
  // 从持久化的 context 中获取
  return state.context.interactionHistory?.slice(0, count) ?? [];
}
```

**Severity**: Warning (功能正确但架构不优)

---

### W3: HumanInteractionHandler 未初始化 strategy

**File**: `src/application/human-interaction/human-interaction.handler.ts:22-34`

**Issue**: `strategy` 初始为 `null`，如果在调用 `setStrategy()` 之前调用 `requestApproval()`，会自动批准。这可能导致意外行为。

**Suggestion**:
1. 在构造函数中注入默认策略 (TerminalStrategy)
2. 或在 `bootstrap()` 中自动设置默认策略

```typescript
// Current
private strategy: IHumanInteractionStrategy | null = null;

// Suggested - 构造函数注入默认策略
constructor(
  // ...
  @inject('IHumanInteractionStrategy') private strategy: IHumanInteractionStrategy,
) {}
```

**Severity**: Warning (可能导致意外行为)

---

## Suggestions

### S1: 缺少 ExecutionLogEntry 的 JSDoc 示例

**File**: `src/core/types/execution-log.types.ts`

**Suggestion**: 为 `ExecutionLogEntry` 添加使用示例注释，便于理解各字段用途。

---

### S2: truncateOutput 返回值可简化

**File**: `src/core/types/execution-log.types.ts:44-55`

**Suggestion**: 当前返回对象，可考虑直接返回截断后的字符串并使用输出参数返回 truncated 标志。

```typescript
// Current
function truncateOutput(output: string, maxSize: number): { output: string; truncated: boolean }

// Alternative (simpler usage)
function truncateOutput(output: string, maxSize: number): string  // 返回截断后的字符串
function isTruncated(original: string, truncated: string): boolean  // 单独判断
```

**Severity**: Suggestion (可选改进)

---

### S3: WorkerNodeHandler.emitLogEvent 使用 `as any`

**File**: `src/application/pipeline/worker-node-handler.ts:440, 449`

**Issue**: 使用 `as any` 类型断言绕过类型检查，可能隐藏类型问题。

```typescript
this.eventBus.emit({
  ...event,
  role,
} as any);  // ❌

// eventType: eventType as any  // ❌
```

**Suggestion**: 定义更完整的事件类型或使用类型守卫。

---

### S4: TerminalStrategy 缺少超时处理

**File**: `src/application/human-interaction/strategies/terminal.strategy.ts:14-36`

**Suggestion**: 当前 `requestApproval()` 无限期等待用户输入。可考虑添加超时机制，超时后自动拒绝或使用默认行为。

---

## Highlights

- ✅ **ADR 合规性**: 所有 4 个 ADR 决策均已正确实现
- ✅ **类型安全**: 接口定义清晰，使用 `tsyringe` DI 模式
- ✅ **错误处理**: `JsonExecutionLogStore` 中有 JSON 解析错误处理
- ✅ **日志完整**: `WorkerNodeHandler.emitLogEvent` 同时发布事件和持久化日志
- ✅ **上下文展示**: `TerminalStrategy.displayContext()` 格式化清晰，包含所有必要信息
- ✅ **截断策略**: 统一使用 `truncateOutput` 函数，避免内存问题

---

## Architecture Compliance

- [x] Follows established architecture pattern (Clean Architecture)
- [x] Correct layer assignment (Types → Interfaces → Infrastructure → Application)
- [x] Proper dependency direction (Application depends on Core, not vice versa)
- [x] Module boundaries respected

---

## Test Coverage Recommendations

| Module | Test Scenarios |
|--------|----------------|
| `JsonExecutionLogStore` | append, query with filters, purge, concurrent writes |
| `ProgressQueryService` | getProgress, getInteractionHistory, getLatestOutput |
| `HumanInteractionHandler` | requestApproval with/without strategy, event emission |
| `TerminalStrategy` | requestApproval approve/reject, context display |
| `WorkerNodeHandler` | manual/semi-auto/auto mode flows, interaction recording |

---

**Suggested Next Steps**:
- 考虑修复 W1 (性能) 和 W2 (架构简化)
- 添加默认 strategy 或在 bootstrap 中初始化
- `#test` 添加单元测试
