# Requirements Analysis: Evaluator / Messenger 职责重新设计

> Change ID: `20260320-evaluator-messenger-redesign`
> Date: 2026-03-20

---

## 问题背景

当前 Evaluator / Messenger / Conductor 三个角色的抽象设计偏离了最初的需求意图：

1. **Evaluator 职责过重** — 包含了维度绑定、结构化打分、数据转换，偏离了"只负责评估并回答"的定位
2. **Messenger 缺少关键职责** — 缺少评估路由判断和多 Evaluator 结果整合能力
3. **Dimension 概念冗余** — `quality / security / consistency` 维度体系在实际需求中不存在

---

## Features

| ID | Feature | Description | Priority |
|----|---------|-------------|----------|
| F1 | Evaluator 职责简化 | Evaluator 仅负责评估并返回纯文本答案，不做数据转换，直接交给 Messenger | High |
| F2 | Messenger 评估路由 | Messenger 判断 Worker 结果是否需要交给 Evaluator（MVTT: LLM 分析是否有"问题"） | High |
| F3 | Messenger 结果整合 | Messenger 对多个 Evaluator 纯文本结果进行整合，统一交给 Conductor | High |
| F4 | 移除 Dimension 体系 | 去除 dimension 类型、子类、工厂注册等全部 dimension 相关代码 | Medium |

---

## 澄清结果

| ID | Question | Answer |
|----|----------|--------|
| C1 | Evaluator 数量 | 支持多个并行（便于扩充），MVP 仅一个 Evaluator |
| C2 | Evaluator 输出格式 | **纯文本**，取决于不同 implementation 的具体实现 |
| C3 | Messenger 路由判断标准 | 取决于 implementation；MVTT 实现：调用 LLM 分析文本，判断是否有"问题" |
| C4 | Conductor 输入格式 | **纯文本**，取决于不同 implementation 的具体实现 |

---

## 期望数据流

```
Worker 产出结果
       ↓
  Messenger.shouldEvaluate(workerResult)
       │
       ├── No ──→ Messenger.formatForConductor(workerResult)
       │                    ↓
       │              Conductor.decide(text)
       │
       └── Yes ─→ [Evaluator×N 并行] → 纯文本回答[]
                        ↓
                  Messenger.synthesize(纯文本回答[])
                        ↓
                  Conductor.decide(整合后纯文本)
```

---

## 接口变更要点

### IEvaluator (简化)

- 移除 `getDimension()` 方法
- `evaluate()` 返回纯文本 `string` 而非结构化 `EvaluationResult`
- 入参待 design 阶段确定（可能简化为 string 或轻量结构）

### IMessenger (增强)

- **新增** `shouldEvaluate(workerResult, context)` → 判断是否需要评估
- **新增/重构** `synthesize(evaluatorResults: string[], context)` → 整合多个 Evaluator 纯文本结果
- **新增** `formatForConductor(...)` → 构建 Conductor 输入（无论是否经过 Evaluator）
- **移除** `formatForEvaluator()` — 可能不再需要，或简化
- **移除** `synthesizeFeedback()` — 被 `synthesize()` 替代

### IConductor (简化)

- `decide()` 入参从 `EvaluationResult[]` 改为纯文本 `string`

---

## 受影响文件

| 文件 | 影响 | 说明 |
|------|------|------|
| `src/core/interfaces/evaluator.interface.ts` | **重写** | 简化接口，去除 dimension |
| `src/core/interfaces/messenger.interface.ts` | **重写** | 增加路由、整合方法 |
| `src/core/interfaces/conductor.interface.ts` | **修改** | decide() 入参改为 string |
| `src/core/types/evaluation.types.ts` | **重写** | 去除 dimension/verdict/score 体系 |
| `src/core/types/conductor.types.ts` | **可能修改** | 适配新输入格式 |
| `src/core/types/messenger.types.ts` | **修改** | 新增/调整类型 |
| `src/implementations/mvtt/mvtt-evaluator.ts` | **重写** | 去除基类模板，简化实现 |
| `src/implementations/mvtt/mvtt-quality-evaluator.ts` | **删除** | dimension 子类移除 |
| `src/implementations/mvtt/mvtt-security-evaluator.ts` | **删除** | dimension 子类移除 |
| `src/implementations/mvtt/mvtt-consistency-evaluator.ts` | **删除** | dimension 子类移除 |
| `src/implementations/mvtt/mvtt-messenger.ts` | **重写** | 增加路由和整合逻辑 |
| `src/implementations/mvtt/mvtt-conductor.ts` | **修改** | 适配 string 输入，调整规则引擎 |
| `src/implementations/mvtt/mvtt-output-parser.ts` | **修改** | 移除 parseEvaluationResult() |
| `src/implementations/mvtt/index.ts` | **修改** | 去除 dimension 工厂，简化注册 |
| `src/application/pipeline/worker-node-handler.ts` | **重写** | 重新编排流程，引入路由分支 |
| `src/tokens.ts` | **可能修改** | EVALUATOR_TOKEN 类型调整 |
| 配置类型 | **修改** | 去除 evaluator.dimensions 配置 |

---

## Assumptions

| ID | Assumption | Reason |
|----|------------|--------|
| A1 | Messenger 成为 Worker↔Evaluator↔Conductor 之间的唯一中介 | 用户描述中 Messenger 负责路由和整合 |
| A2 | Conductor 不再直接接触 Evaluator 的原始输出 | "Messenger 将所有答案交给 Conductor" |
| A3 | MVP 阶段注册单个 Evaluator，接口设计为数组以支持扩展 | C1 澄清结果 |
| A4 | 所有角色间传递的内容均为纯文本，结构化由 implementation 自行决定 | C2/C4 澄清结果 |
