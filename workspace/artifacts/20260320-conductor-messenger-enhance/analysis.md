# Requirements Analysis: Conductor 工作流感知 + Messenger 反馈处理增强

> Change ID: `20260320-conductor-messenger-enhance`
> Date: 2026-03-20

---

## Features

| ID | Feature | Description | Priority |
|----|---------|-------------|----------|
| F1 | Conductor 工作流感知 | MvttConductor 自身维护 MVTT 工作流知识，在 system prompt 中注入阶段上下文，使决策能基于 phase 位置和下游需求 | Medium |
| F2 | Messenger 反馈处理增强 | 增强 Messenger 现有方法，在 Conductor→Worker 的 revise 路径中用 LLM 对 feedback 进行格式化、上下文补充、可执行性校验 | High |

---

## 澄清结果

| ID | Question | Answer |
|----|----------|--------|
| C1 | 工作流上下文注入位置 | 在 **MvttConductor** 内部维护 MVTT 工作流知识（不是 prepareForConductor） |
| C2 | 是否需要新接口方法 | **不需要**，增强现有方法 |
| C3 | 反馈处理是否需要 LLM | **需要** LLM 调用 |

---

## 现状问题详述

### F1: Conductor 缺乏工作流上下文

当前 `MvttConductor` 的 system prompt 是通用的决策指令，不包含任何关于 `analyze→design→implement→review→test` 工作流的信息。

**影响**：
- 无法判断"当前 phase 产出是否足以支撑下一个 phase"
- 对所有 phase 使用相同判断标准
- revise feedback 缺乏 phase 针对性

**期望**：MvttConductor 知道完整工作流，并在 decide() 时将当前 phase 在流程中的位置、上下游关系注入到 LLM prompt 中。

### F2: Messenger 反馈直通无处理

当前 revise 路径：
```
ConductorDecision.feedback (LLM 原始输出)
  → updateContext() 直接复制到 context.revisionFeedback
  → formatForWorker() 直接拼接为 "## Revision Requirements\n..."
```

中间**零处理**，风险：反馈模糊、与 phase 不匹配、格式不一致、缺少上下文。

**期望**：Messenger 在 `updateContext()` 中增强处理——用 LLM 将 Conductor 的原始 feedback 转化为 Worker 可执行的、带上下文的修订指令。

---

## 受影响文件

| 文件 | 影响 | 说明 |
|------|------|------|
| `src/implementations/mvtt/mvtt-conductor.ts` | **修改** | system prompt 注入工作流知识；decide() 时附加 phase 上下文 |
| `src/implementations/mvtt/mvtt-messenger.ts` | **修改** | updateContext() 增强——对 revise 场景用 LLM 处理 feedback |
| `src/core/interfaces/messenger.interface.ts` | **不变** | 不新增方法 |
| `src/core/interfaces/conductor.interface.ts` | **不变** | 接口签名不变 |

---

## Assumptions

| ID | Assumption | Reason |
|----|------------|--------|
| A1 | 工作流知识硬编码在 MvttConductor 中或从 MvttPromptFramework 获取 | MVTT 是特定实现，工作流是其自身知识 |
| A2 | updateContext() 签名不变，但内部实现从纯逻辑变为异步（含 LLM） | C2 明确不新增方法 |
| A3 | updateContext() 变为 async 需要同步更新 IMessenger 接口签名 | 当前 updateContext() 返回 PipelineContext（同步），增加 LLM 后需改为 Promise |
