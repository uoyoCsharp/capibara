# 需求分析：Worker 与 Pipeline 抽象改进

> Change ID: `20260320-worker-pipeline-abstraction`
> 日期: 2026-03-20
> 阶段: analyze

---

## 识别的功能特性

| ID | 特性 | 描述 | 优先级 |
|----|------|------|--------|
| F1 | Worker 执行策略抽象 | Worker 的 `executeCommand` 应可插拔，通过 `IExecutionStrategy` 支持 CLI/API/Shell/自定义等多种执行方式，而非硬编码 Claude CLI | 高 |
| F2 | Pipeline 拓扑抽象 | 用 DAG（有向无环图）的 `PipelineDefinition` 替代固定线性 `Phase[]`，支持并行、条件分支、扇出/汇聚等流程模式 | 高 |
| F3 | MVP 默认配置 | 系统开箱即用提供合理默认值，当前 Claude CLI 行为作为"默认策略"，现有用户零配置即可使用 | 高 |
| F4 | 用户自定义 Worker 行为 | 用户通过 UI 配置 Worker 执行方式 - 如 WorkerA 用 CLI 执行 `claude -p #analyze ...`，WorkerB 调用 HTTP API 接口 | 中 |
| F5 | 用户自定义编排流程 | 用户通过 UI 配置交互流程 - 如 3 个 Worker 并行执行后输出汇总，由 Evaluator 统一评估 | 中 |
| F6 | Evaluator 聚合节点 | 支持专用的聚合步骤，收集多个 Worker 的输出并送入 Evaluator 进行统一评估 | 中 |

---

## 参与者

| 参与者 | 描述 | 行为 |
|--------|------|------|
| 系统 (Capibara) | 自动化编排引擎 | 执行 Pipeline、管理 Worker、评估产物 |
| 终端用户 | 使用系统的开发者 | 配置 Worker、定义 Pipeline、触发运行 |
| Worker 策略 | 可插拔的执行后端 | 通过 CLI/API/脚本/自定义方式执行任务 |
| Evaluator | 质量关卡 | 评估 Worker 输出、聚合多源结果 |

---

## 问题分析：当前架构差距

### 问题 1：Worker 执行方式硬编码为 Claude CLI

**当前状态** (`src/roles/worker/claude-cli.worker.ts`):
- `ClaudeCliWorker.executeCommand()` 直接调用 `this.cliAdapter.execute()`，参数固定
- `IWorker` 接口仅定义 `executeCommand(command: WorkerCommand): Promise<WorkerResult>`
- "执行什么"和"怎么执行"之间没有抽象层
- `WorkerCommand` 类型混杂了与执行方式无关的字段（`command`, `input`）和 CLI 特有字段（`sessionId`, `resume`, `maxTurns`, `allowedTools`）

**影响**:
- 无法在不替换整个 Worker 的情况下切换执行后端
- 无法在同一 Pipeline 中混用不同执行策略（如 WorkerA 用 CLI，WorkerB 调 API）
- 用户无法在不编写 TypeScript 代码的情况下自定义 Worker 行为

**涉及文件**:
- `src/core/interfaces/worker.interface.ts`
- `src/core/types/worker.types.ts`
- `src/roles/worker/claude-cli.worker.ts`
- `src/composition-root.ts`（硬编码 `ClaudeCliWorker` 注册）

### 问题 2：Pipeline 拓扑固定为线性执行

**当前状态** (`src/application/pipeline/pipeline.service.ts`):
- `PipelineService.run()` 用简单 `for` 循环遍历 `config.pipeline.phases`（第 100 行）
- 阶段顺序是来自配置的扁平 `Phase[]` 数组（`PipelineConfig.phases`）
- 不支持并行执行、条件分支或扇出/汇聚模式
- 状态机（`states.ts`）硬编码了阶段特有的状态（如 `Analyzing`, `Designing`），而非通用化

**影响**:
- 无法并行运行阶段（如同时进行安全审查 + 质量审查）
- 无法定义条件流程（如纯文档变更时跳过测试阶段）
- 无法在评估前聚合多个 Worker 的输出
- 新增阶段需要修改 `PipelineStateName` 枚举、`TRANSITIONS` 数组和 `PipelineService`

**涉及文件**:
- `src/application/pipeline/pipeline.service.ts`
- `src/application/pipeline/phase-executor.ts`
- `src/application/state-machine/states.ts`（硬编码阶段状态）
- `src/application/state-machine/transitions.ts`（硬编码状态转移表）
- `src/core/types/pipeline.types.ts`
- `src/core/types/config.types.ts`（`PipelineConfig`）

### 问题 3：PhaseExecutor 将编排逻辑与角色交互耦合

**当前状态** (`src/application/pipeline/phase-executor.ts`):
- `PhaseExecutor.execute()` 硬编码了循环流程：Worker -> Messenger -> Evaluator -> Conductor -> (approve|revise)
- 评估聚合模式（并行评估 + 综合反馈）写死在这一个方法中
- 无法为不同阶段或不同用户配置注入不同的执行模式

**影响**:
- 无法实现跳过评估的阶段（如简单通知阶段）
- 无法实现多 Worker 并行执行后聚合输出的阶段
- 无法按阶段自定义反馈循环行为

---

## 改进方案

### 方案 1：Worker 执行策略模式

引入 `IExecutionStrategy` 接口，将"做什么"与"怎么做"解耦：

```typescript
// 新增：执行策略接口
interface IExecutionStrategy {
  readonly type: string; // 'claude-cli' | 'http-api' | 'shell-command' | 'custom'
  execute(request: ExecutionRequest): Promise<ExecutionResponse>;
  validate?(): Promise<boolean>;
}

// 与执行方式无关的请求/响应
interface ExecutionRequest {
  input: string;
  systemPrompt?: string;
  metadata: Record<string, unknown>; // 策略特有参数
  timeout?: number;
}

interface ExecutionResponse {
  success: boolean;
  output: string;
  metadata: Record<string, unknown>; // 策略特有结果（成本、token数等）
  duration: number;
}
```

**具体策略实现**：
- `ClaudeCliStrategy` - 当前行为（MVP 默认）
- `HttpApiStrategy` - 调用外部 API 端点
- `ShellCommandStrategy` - 执行任意 Shell 命令
- `CompositeStrategy` - 链式组合多个策略

**Worker 变成轻量级分发器**：
```typescript
class Worker implements IWorker {
  constructor(private strategyRegistry: Map<string, IExecutionStrategy>) {}

  async executeCommand(command: WorkerCommand): Promise<WorkerResult> {
    const strategy = this.strategyRegistry.get(command.strategyType ?? 'claude-cli');
    const response = await strategy.execute(toRequest(command));
    return toWorkerResult(response);
  }
}
```

### 方案 2：Pipeline 改为 DAG（有向无环图）

用基于 DAG 的 Pipeline 定义替代线性 `Phase[]`：

```typescript
// Pipeline 节点 - 每个节点是 Pipeline 中的一个步骤
interface PipelineNode {
  id: string;
  type: 'worker' | 'evaluator' | 'aggregator' | 'gate' | 'notification';
  config: NodeConfig;       // 节点特有配置
  strategyType?: string;    // 使用哪种执行策略
  dependsOn?: string[];     // 本节点依赖的节点 ID（DAG 边）
}

// Pipeline 定义
interface PipelineDefinition {
  id: string;
  name: string;
  nodes: PipelineNode[];
  edges: PipelineEdge[];    // 显式边，可附带条件
}

interface PipelineEdge {
  from: string;
  to: string;
  condition?: string;       // 可选的条件表达式
}
```

**优势**：
- 并行节点：无依赖关系的节点自动并发执行
- 扇出/汇聚：一个节点的输出分发给多个下游节点，再聚合结果
- 条件分支：边可以带条件表达式
- 状态机变为通用型 —— 追踪节点完成状态而非硬编码阶段名

### 方案 3：通用状态机

用动态状态机替代硬编码的 `PipelineStateName`：

```typescript
// 状态由 Pipeline 定义动态生成，而非硬编码
interface DynamicState {
  nodeId: string;
  status: 'pending' | 'running' | 'evaluating' | 'decided' | 'completed' | 'failed';
}

// 状态机追踪 DAG 执行状态
interface PipelineExecutionState {
  nodes: Map<string, DynamicState>;
  getReadyNodes(): string[];  // 获取所有依赖已完成的就绪节点
  markCompleted(nodeId: string): void;
  isTerminal(): boolean;
}
```

### 方案 4：用户可配置的 Worker 定义（未来 UI）

Worker 通过配置定义，而非代码：

```yaml
# 示例：用户自定义 Worker 配置（通过 UI 或 YAML）
workers:
  analyst:
    strategy: claude-cli
    config:
      command: "#analyze"
      maxTurns: 10
      systemPrompt: "自定义提示词..."

  api-validator:
    strategy: http-api
    config:
      url: "https://api.example.com/validate"
      method: POST
      headers:
        Authorization: "Bearer ${API_TOKEN}"

  linter:
    strategy: shell-command
    config:
      command: "npx eslint --format json src/"
      parseOutput: json
```

### 方案 5：多 Worker 聚合评估节点

新增节点类型，收集多个 Worker 的输出：

```typescript
interface AggregatorNodeConfig {
  sourceNodes: string[];           // 需要收集输出的 Worker 节点
  aggregationStrategy: 'concat' | 'merge' | 'custom';
  evaluators?: string[];           // 对聚合输出运行哪些评估器
}
```

**示例流程**：
```
WorkerA (分析) ----\
WorkerB (调研) -----+--> 聚合器 --> 评估器 --> 决策器
WorkerC (对比) ----/
```

---

## 迁移策略（分阶段实施）

| 阶段 | 范围 | 是否有破坏性变更 |
|------|------|:----------------:|
| 阶段 1（MVP） | 引入 `ICommandExecutor`（全角色共享）+ `ClaudeCliExecutor` + `ShellExecutor`。全部角色实现迁移到 `implementations/mvtt/`。DAG Pipeline + 通用状态机。直接移除旧代码。 | N/A（全新） |
| 阶段 2 | 新增 `HttpApiExecutor`（含凭据管理设计）。 | 增量添加 |
| 阶段 3 | 新增聚合器节点类型。支持扇出/汇聚模式。 | 增量添加 |
| 阶段 4 | UI 配置层 —— 可视化 Pipeline 编辑器 + Worker 策略配置界面。 | 增量添加 |

---

## 约束条件

- 全新项目，**不需要向后兼容** —— 旧代码可直接移除替换
- DAG 执行应在无额外配置的情况下提供合理的默认线性 Pipeline
- 策略实现必须可独立测试
- 所有策略特有参数必须隔离在 `metadata`/`config` 对象中，不污染核心类型

---

## 澄清结果

| ID | 问题 | 决定 |
|----|------|------|
| C1 | 策略注册时机 | **启动时注册（DI 容器）**。用户更新配置后需要重启系统生效。不支持运行时动态注册。 |
| C2 | Pipeline 定义存储 | **本地文本文件（JSON 或 YAML）**。同时适用于所有需要持久化的场景（Pipeline 定义、状态快照等）。 |
| C3 | DAG 中的错误传播 | **取消兄弟节点并提示错误**。扇出并行执行时，任一节点失败则取消所有未完成的兄弟节点，Pipeline 终止并报错。 |
| C4 | 策略凭据管理 | **MVP 版本不考虑 HTTP API 策略**。凭据管理推迟到阶段 2 实现 `HttpApiStrategy` 时再设计。 |
| C5 | 输出格式归一化 | **由 Messenger 角色负责**。Messenger 的职责就是处理角色间的输出格式转换，策略本身只负责原始输出，归一化交给 Messenger。 |

---

## 已做的假设

| ID | 假设 | 原因 |
|----|------|------|
| A1 | 阶段 1 不需要 UI 变更 | MVP 仅关注代码层面的抽象 |
| A2 | ClaudeCliStrategy 仍为主要/默认策略 | 当前用户群依赖 Claude CLI |
| A3 | DAG 不允许循环 | 标准 Pipeline 语义；循环通过节点内的反馈循环处理 |
| A4 | 策略实现是无状态的 | 简化并发和测试 |
| A5 | Pipeline 定义在执行期间不可变 | 防止 DAG 遍历中的竞态条件 |
| A6 | MVP 阶段仅实现 `ClaudeCliStrategy` 和 `ShellCommandStrategy` | HTTP API 推迟到阶段 2（C4 澄清结果） |
| A7 | Messenger 负责所有输出格式归一化 | 符合现有角色职责划分（C5 澄清结果） |
| A8 | 配置变更需要重启系统 | 简化 DI 生命周期管理（C1 澄清结果） |

---

**建议的下一步**：
- 回答澄清问题 C1-C5
- `#design` 进行 `IExecutionStrategy`、DAG Pipeline 和通用状态机的详细架构设计
