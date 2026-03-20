# Architecture Design: Evaluator / Messenger 职责重新设计

> Change ID: `20260320-evaluator-messenger-redesign`
> Date: 2026-03-20

---

## Architecture Overview

核心变更：将 Evaluator 从"结构化判定者"回归为"纯文本评估者"，将 Messenger 升级为 Worker↔Evaluator↔Conductor 之间的中央路由与整合枢纽，同时彻底移除 Dimension 体系。

## 新数据流

```
Worker 产出 WorkerResult
       ↓
  Messenger.shouldEvaluate(workerResult, context)
       │
       ├── No ──→ Messenger.prepareForConductor(content, context) → string
       │                              ↓
       │                     Conductor.decide(string)
       │
       └── Yes ─→ [Evaluator×N 并行].evaluate(artifact, evalContext) → string[]
                        ↓
                  Messenger.synthesize(string[], context) → string
                        ↓
                  Messenger.prepareForConductor(string, context) → string
                        ↓
                  Conductor.decide(string)
```

---

## Interface Definitions

### IEvaluator (simplified)

```typescript
// src/core/interfaces/evaluator.interface.ts
import type { EvaluationContext } from '../types/evaluation.types.js';

export interface IEvaluator {
  /** 评估 artifact，返回纯文本评估结果 */
  evaluate(artifact: string, context: EvaluationContext): Promise<string>;
}
```

### IMessenger (enhanced)

```typescript
// src/core/interfaces/messenger.interface.ts
import type { Phase } from '../types/phase.types.js';
import type { PipelineContext } from '../types/pipeline.types.js';
import type { WorkerCommand, WorkerResult } from '../types/worker.types.js';
import type { ConductorDecision } from '../types/conductor.types.js';

export interface IMessenger {
  /** 构建 Worker 执行指令 */
  formatForWorker(phase: Phase, context: PipelineContext): Promise<WorkerCommand>;

  /** 判断 Worker 结果是否需要交给 Evaluator 评估 */
  shouldEvaluate(workerResult: WorkerResult, context: PipelineContext): Promise<boolean>;

  /** 整合多个 Evaluator 的纯文本结果为统一文本 */
  synthesize(evaluatorResults: string[], context: PipelineContext): Promise<string>;

  /** 将内容格式化为 Conductor 输入 */
  prepareForConductor(content: string, context: PipelineContext): Promise<string>;

  /** 根据 Conductor 决策更新上下文（纯逻辑，无 LLM） */
  updateContext(decision: ConductorDecision, context: PipelineContext): PipelineContext;
}
```

### IConductor (simplified)

```typescript
// src/core/interfaces/conductor.interface.ts
import type { ConductorDecision } from '../types/conductor.types.js';

export interface IConductor {
  /** 基于 Messenger 整合后的纯文本做出决策 */
  decide(input: string): Promise<ConductorDecision>;
}
```

---

## Type Definitions

### evaluation.types.ts (rewrite)

```typescript
// src/core/types/evaluation.types.ts
import type { Phase } from './phase.types.js';

export interface EvaluationContext {
  pipelineId: string;
  phase: Phase;
  projectDir: string;
}
```

Removed: EvaluationDimension, EvaluationVerdict, IssueSeverity, EvaluationIssue, EvaluationInput, EvaluationResult

### conductor.types.ts (simplified)

```typescript
// src/core/types/conductor.types.ts
export type ConductorAction = 'approve' | 'revise' | 'escalate';

export interface ConductorDecision {
  action: ConductorAction;
  reason: string;
  feedback?: string[];
  priority?: 'critical' | 'normal';
}
```

Removed: notes?: EvaluationIssue[] (decoupled from evaluation.types)

### messenger.types.ts (simplified)

```typescript
// src/core/types/messenger.types.ts
export interface OutputSchema {
  type: string;
  properties: Record<string, unknown>;
  required?: string[];
}

export type StructuredData = Record<string, unknown>;
```

Removed: SummaryStyle, SummaryFormat

### config.types.ts (modified)

```typescript
// EvaluatorConfig — removed dimensions
export interface EvaluatorConfig {
  maxTurns: number;
  parseRetries: number;
}
```

### pipeline.types.ts (modified)

```typescript
// PipelineState.context.evaluations changed from Record<Phase, EvaluationResult[]> to Record<Phase, string[]>
// PipelineContext: remove EvaluationResult import
```

---

## WorkerNodeHandler — New Orchestration

```typescript
// Pseudocode for the core loop
while (!approved) {
  // 1. Worker 执行
  const workerResult = await this.executeWorker(phase, node, context);

  // 2. Messenger 路由判断
  const needsEvaluation = await this.messenger.shouldEvaluate(workerResult, context);

  let conductorInput: string;

  if (needsEvaluation) {
    // 3a. Evaluator 并行评估
    const artifact = workerResult.artifact || workerResult.output;
    const evalContext = { pipelineId: context.pipelineId, phase, projectDir: config.cli.projectDir };
    const evalResults = await Promise.all(
      this.evaluators.map(e => e.evaluate(artifact, evalContext))
    );
    // 3b. Messenger 整合
    const synthesized = await this.messenger.synthesize(evalResults, context);
    conductorInput = await this.messenger.prepareForConductor(synthesized, context);
  } else {
    // 3c. 跳过评估
    conductorInput = await this.messenger.prepareForConductor(
      workerResult.artifact || workerResult.output, context
    );
  }

  // 4. Conductor 决策
  const decision = await this.conductor.decide(conductorInput);

  // 5. Handle decision (approve/revise/escalate)
  // ...
}
```

---

## MVTT Implementation Design

### MvttEvaluator (single class, replaces base + 3 subclasses)

- Calls LLM via ICommandExecutor with artifact as input
- Returns response.output directly as plain text
- No JSON parsing, no dimension binding

### MvttMessenger — New Methods

| Method | MVTT Strategy |
|--------|--------------|
| `shouldEvaluate()` | LLM call: analyze worker output, determine if there are "issues" needing evaluation → boolean |
| `synthesize()` | Single result: return directly. Multiple: LLM call to merge/deduplicate |
| `prepareForConductor()` | Brief formatting/summary of content for conductor decision-making |
| `formatForWorker()` | Unchanged from current implementation |
| `updateContext()` | Unchanged from current implementation |

### MvttConductor — Pure LLM Decision

- Remove rule engine (no scores/verdicts to match against)
- Single LLM call: analyze text input → output ConductorDecision JSON
- OutputParser.parseConductorDecision() still used for JSON extraction

### MvttOutputParser — Changes

- Remove: parseEvaluationResult(), isEvaluationOutput()
- Keep: extractJson<T>(), parseConductorDecision(), all parse strategies

### mvtt/index.ts — Simplified Registration

- Remove: dimension factory, evaluatorMap, 3 subclass imports
- Evaluator registration: `[new MvttEvaluator(executor, config, logger)]`

---

## Files Change List

| Action | File | Description |
|--------|------|-------------|
| REWRITE | `src/core/types/evaluation.types.ts` | Only EvaluationContext |
| MODIFY | `src/core/types/conductor.types.ts` | Remove notes field |
| SIMPLIFY | `src/core/types/messenger.types.ts` | Remove SummaryStyle, SummaryFormat |
| MODIFY | `src/core/types/config.types.ts` | EvaluatorConfig remove dimensions |
| MODIFY | `src/core/types/pipeline.types.ts` | evaluations → string[], remove EvaluationResult import |
| REWRITE | `src/core/interfaces/evaluator.interface.ts` | evaluate(artifact, context) → string |
| REWRITE | `src/core/interfaces/messenger.interface.ts` | +shouldEvaluate, +synthesize, +prepareForConductor; -formatForEvaluator, -summarize, -structurize, -synthesizeFeedback |
| MODIFY | `src/core/interfaces/conductor.interface.ts` | decide(string) |
| REWRITE | `src/implementations/mvtt/mvtt-evaluator.ts` | Single class, plain text return |
| DELETE | `src/implementations/mvtt/mvtt-quality-evaluator.ts` | Dimension subclass |
| DELETE | `src/implementations/mvtt/mvtt-security-evaluator.ts` | Dimension subclass |
| DELETE | `src/implementations/mvtt/mvtt-consistency-evaluator.ts` | Dimension subclass |
| REWRITE | `src/implementations/mvtt/mvtt-messenger.ts` | New methods, remove old ones |
| REWRITE | `src/implementations/mvtt/mvtt-conductor.ts` | Pure LLM decision, remove rule engine |
| MODIFY | `src/implementations/mvtt/mvtt-output-parser.ts` | Remove parseEvaluationResult |
| MODIFY | `src/implementations/mvtt/index.ts` | Simplified registration |
| REWRITE | `src/application/pipeline/worker-node-handler.ts` | New orchestration with routing |

---

## Technical Decisions (ADR)

| # | Decision | Choice | Rationale |
|---|----------|--------|-----------|
| 1 | Evaluator output format | Plain text string | Requirements: evaluator only evaluates and answers |
| 2 | Remove rule engine from Conductor | Pure LLM decision | No scores/verdicts for rule matching; text input suits LLM |
| 3 | Messenger.shouldEvaluate in MVTT | LLM analysis | Requirements: MVTT uses LLM to detect "issues" |
| 4 | Keep IEvaluator[] array registration | Extensibility | MVP has one, interface supports N parallel |
| 5 | Remove summarize/structurize from core IMessenger | Lean interface | Generic utilities, not role responsibilities; MVTT uses internally if needed |

---

## Implementation Plan

| Phase | Task | Dependencies | Complexity |
|-------|------|--------------|------------|
| 1 | Rewrite core types (evaluation, conductor, messenger, config, pipeline) | - | Low |
| 2 | Rewrite core interfaces (IEvaluator, IMessenger, IConductor) | Phase 1 | Low |
| 3 | Rewrite MvttEvaluator + delete 3 dimension subclasses | Phase 2 | Low |
| 4 | Rewrite MvttMessenger (shouldEvaluate, synthesize, prepareForConductor) | Phase 2 | Medium |
| 5 | Rewrite MvttConductor + modify MvttOutputParser | Phase 2 | Low |
| 6 | Modify mvtt/index.ts (simplified registration) | Phase 3-5 | Low |
| 7 | Rewrite WorkerNodeHandler (new orchestration) | Phase 2-6 | Medium |
