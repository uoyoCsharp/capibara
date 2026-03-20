# Capibara 使用手册

> **版本**: 0.1.0
> **更新日期**: 2026-03-19

---

## 1. 项目概述

Capibara（CLI 命令前缀 `cpbr`）是一个**自动化 Agent 工作流引擎**，用于将传统的手动 AI 辅助开发流程（`#analyze → #design → #implement → #review → #test`）升级为全自动或半自动的软件开发管道。

### 1.1 核心思路

项目通过 **Claude Code CLI** 作为底层 LLM 执行引擎，定义了五个协作角色：

| 角色 | 职责 | 实现方式 |
|------|------|----------|
| **Worker** | 执行开发阶段的核心任务（分析、设计、编码等） | Claude CLI（完整工具集） |
| **Evaluator** | 多维度评估 Worker 产出（质量/安全/一致性） | Claude CLI（只读模式） |
| **Conductor** | 根据评估结果做出决策（通过/修改/升级） | 本地规则引擎 |
| **Messenger** | 格式化角色间的上下文传递 | Claude CLI + TypeScript 逻辑 |
| **Trigger** | 从外部事件触发管道（GitHub Issues / 手动） | 纯 TypeScript |

### 1.2 管道执行流程

```
需求输入 → [analyze] → [design] → [implement] → [review] → [test] → 完成
              ↓           ↓            ↓             ↓           ↓
           每个阶段内部循环:
           Worker 执行 → Evaluator 评估 → Conductor 决策
                                              ↓
                                    approve → 进入下一阶段
                                    revise  → 重试当前阶段（最多 N 次）
                                    escalate → 人工介入
```

### 1.3 三种交互模式

| 模式 | 说明 | 适用场景 |
|------|------|----------|
| `auto` | 全自动执行，达到最大重试次数后强制通过 | 信任度高的简单任务 |
| `semi-auto` | 默认模式，升级时需要人工审批 | 日常开发（推荐） |
| `manual` | 每个阶段都需要人工确认 | 关键功能开发 |

---

## 2. 环境准备

### 2.1 系统要求

- **Node.js**: >= 22.0.0（LTS 推荐）
- **包管理器**: pnpm
- **Claude Code CLI**: 需要已安装并可在终端中通过 `claude` 命令访问

### 2.2 安装依赖

```bash
pnpm install
```

### 2.3 环境变量配置

复制 `.env.example` 为 `.env`，按需修改：

```bash
cp .env.example .env
```

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `CLAUDE_CLI_PATH` | `claude` | Claude CLI 可执行文件路径 |
| `PROJECT_DIR` | `.` | Claude CLI 的工作目录 |
| `LOG_LEVEL` | `info` | 日志级别：`trace` / `debug` / `info` / `warn` / `error` / `fatal` |
| `NODE_ENV` | `development` | 运行环境 |
| `GITHUB_TOKEN` | （空） | GitHub Token（仅 `github_issues` 触发模式需要） |

---

## 3. 配置说明

项目配置通过 `automation.config.json`（项目根目录）管理，所有字段均有默认值，通过 zod 在启动时强校验。

### 3.1 完整配置项

```jsonc
{
  // Claude CLI 相关
  "cli": {
    "cliPath": "claude",           // CLI 可执行文件路径
    "projectDir": ".",             // 工作目录
    "maxConcurrentProcesses": 3    // 最大并发进程数（1-10）
  },

  // Worker 角色配置
  "worker": {
    "defaultMaxTurns": 25,         // 默认最大对话轮次
    "defaultTimeout": 600000       // 默认超时（毫秒，10分钟）
  },

  // Evaluator 角色配置
  "evaluator": {
    "dimensions": ["quality"],     // 评估维度: quality / security / consistency
    "maxTurns": 3,                 // 评估最大轮次
    "parseRetries": 2              // 解析重试次数
  },

  // Messenger 角色配置
  "messenger": {
    "maxTurns": 2,                 // 消息格式化最大轮次
    "summarizeThreshold": 5000,    // 超过此字符数触发摘要
    "fallbackToRaw": true          // 格式化失败时回退到原始内容
  },

  // Conductor 角色配置
  "conductor": {
    "maxAttemptsPerPhase": 3,      // 每阶段最大重试次数
    "autoApproveThreshold": 80,    // 自动通过的分数阈值（0-100）
    "escalateThreshold": 2,        // 连续失败多少次后升级到人工
    "maxTurns": 1                  // 决策最大轮次
  },

  // 触发器配置
  "trigger": {
    "type": "manual"               // manual（手动）/ github_issues（GitHub Issues 轮询）
    // 如果 type 为 github_issues，需要额外配置:
    // "github": {
    //   "owner": "your-org",
    //   "repo": "your-repo",
    //   "labels": ["auto-dev"],
    //   "pollInterval": 60,
    //   "token": "从 GITHUB_TOKEN 环境变量读取"
    // }
  },

  // 管道配置
  "pipeline": {
    "mode": "semi-auto",           // auto / semi-auto / manual
    "phases": ["analyze", "design", "implement", "review", "test"],
    "budgetLimit": 50              // 总预算上限（美元）
  },

  // 持久化配置
  "persistence": {
    "stateDir": ".pipeline/state", // 管道状态存储目录
    "logDir": ".pipeline/logs"     // 日志存储目录
  },

  // Prompt 框架配置
  "promptFramework": {
    "type": "ai-agents",           // 框架类型
    "rootDir": ".ai-agents"        // 框架根目录
  }
}
```

### 3.2 配置优先级

```
环境变量（.env） > automation.config.json > zod 默认值
```

目前通过环境变量可覆盖的字段：`cli.cliPath`、`cli.projectDir`、`trigger.github.token`。

---

## 4. 运行方式

### 4.1 构建项目

```bash
# 编译 TypeScript 到 dist/
pnpm build
```

### 4.2 CLI 命令

编译后通过 `node dist/main.js` 或 `pnpm start` 运行。开发时可直接用 `pnpm dev`。

#### `run` — 手动触发一个需求进入开发管道

```bash
# 基本用法
pnpm dev -- run -t "需求标题" -d "需求的详细描述"

# 指定交互模式
pnpm dev -- run -t "用户登录功能" -d "实现邮箱密码登录" -m auto

# 指定配置文件
pnpm dev -- run -t "需求标题" -d "需求描述" -c path/to/config.json
```

| 参数 | 必填 | 说明 |
|------|:----:|------|
| `-t, --title <title>` | 是 | 需求标题 |
| `-d, --description <desc>` | 是 | 需求描述 |
| `-m, --mode <mode>` | 否 | 交互模式（默认 `semi-auto`） |
| `-c, --config <path>` | 否 | 配置文件路径（默认 `automation.config.json`） |

执行完成后输出：
```
Pipeline completed: 20260319-user-login
   Total cost: $2.35
   Duration: 185.2s
```

#### `resume` — 恢复中断的管道

```bash
pnpm dev -- resume -i <pipelineId>
```

| 参数 | 必填 | 说明 |
|------|:----:|------|
| `-i, --id <pipelineId>` | 是 | 管道 ID（UUID 格式） |
| `-c, --config <path>` | 否 | 配置文件路径 |

#### `status` — 查看所有管道状态

```bash
pnpm dev -- status
```

输出示例：
```
Active Pipelines:
────────────────────────────────────────────────────────────────────────────────
  a1b2c3d4...  running    phase=implement cost=$ 1.20 20260319-user-login
  e5f6g7h8...  paused     phase=review    cost=$ 0.85 20260319-api-refactor
```

### 4.3 编译后运行

```bash
# 构建
pnpm build

# 通过 Node 直接运行
node dist/main.js run -t "标题" -d "描述"

# 如果全局安装（npm link / pnpm link），可直接使用 cpbr 命令
cpbr run -t "标题" -d "描述"
cpbr status
cpbr resume -i <id>
```

---

## 5. 调试方式

### 5.1 VS Code 调试（推荐）

项目已配置 `.vscode/launch.json`，可直接使用 VS Code 内置调试器：

1. 打开 VS Code
2. 按 `F5` 或进入 "Run and Debug" 面板
3. 选择 **"Debug CLI (tsx)"** 配置
4. 调试器将以 `tsx` 运行 `src/main.ts`，并传入默认参数

默认调试参数为 `run -t "测试需求" -d "测试描述"`。如需修改，编辑 `.vscode/launch.json` 中的 `args` 字段：

```jsonc
"args": [
    "run",
    "-t", "你的测试需求标题",
    "-d", "你的测试需求描述",
    "-m", "manual"  // 可选：指定模式
]
```

### 5.2 命令行调试

```bash
# 使用 Node.js --inspect 启动
node --inspect -r tsx/esm src/main.ts run -t "测试" -d "测试描述"

# 然后在 Chrome 中打开 chrome://inspect 连接调试器
```

### 5.3 日志调试

通过设置环境变量提升日志级别，查看详细执行信息：

```bash
# 查看完整调试日志
LOG_LEVEL=debug pnpm dev -- run -t "测试" -d "测试"

# 查看最详细的 trace 日志（包含 CLI 参数等）
LOG_LEVEL=trace pnpm dev -- run -t "测试" -d "测试"
```

日志由 `pino` 输出，开发环境下会通过 `pino-pretty` 格式化为可读形式。关键日志标记：

| 日志标记 | 含义 |
|----------|------|
| `Pipeline started` | 管道启动，显示 pipelineId、changeId、mode |
| `Phase starting` | 阶段开始，显示 phase 名称和序号 |
| `Worker executing` | Worker 开始执行 CLI 调用 |
| `Worker completed` | Worker 完成，显示 success、duration、cost |
| `Phase decision` | Conductor 决策结果，显示 action 和 score |
| `Pipeline completed` | 管道完成，显示 changeId 和总 cost |
| `Pipeline failed` | 管道失败，显示错误信息 |

### 5.4 管道状态文件

运行时的管道状态持久化在 `.pipeline/state/` 目录下（JSON 格式），包含：

- 当前阶段和状态机状态
- 每个阶段的重试次数
- 累计 Token 消耗和费用
- Worker 的 session ID（可用于恢复）

可直接查看这些文件来排查问题。

---

## 6. 测试

```bash
# 运行所有测试
pnpm test

# 监视模式（文件变更自动重跑）
pnpm test:watch
```

测试框架为 `vitest`，测试文件放在 `tests/` 目录。

---

## 7. 代码格式化

```bash
# 格式化所有代码
pnpm format

# 仅检查格式（不修改）
pnpm format:check

# 类型检查（不生成文件）
pnpm lint
```

---

## 8. 项目目录结构

```
capibara/
├── src/
│   ├── main.ts                    # CLI 入口（commander）
│   ├── composition-root.ts        # DI 容器装配（tsyringe）
│   ├── tokens.ts                  # DI Token 定义
│   ├── core/                      # 领域核心层（零外部依赖）
│   │   ├── interfaces/            #   角色接口: IWorker, IEvaluator, IConductor...
│   │   ├── types/                 #   类型定义: Phase, PipelineContext, Requirement...
│   │   ├── errors/                #   错误体系: AppError 基类 + 领域错误
│   │   └── constants/             #   常量: 阶段列表, 权限定义
│   ├── application/               # 应用编排层
│   │   ├── pipeline/              #   PipelineService（主编排）, PhaseExecutor（单阶段循环）
│   │   ├── state-machine/         #   状态机: 状态枚举 + 转换规则
│   │   ├── context/               #   上下文构建与会话管理
│   │   └── human-interaction/     #   人工介入处理（策略模式）
│   ├── roles/                     # 角色实现层
│   │   ├── worker/                #   ClaudeCliWorker
│   │   ├── evaluator/             #   QualityEvaluator, SecurityEvaluator, ConsistencyEvaluator
│   │   ├── conductor/             #   RuleEngineConductor
│   │   ├── messenger/             #   ClaudeCliMessenger
│   │   └── trigger/               #   GitHubIssuesTrigger
│   ├── infrastructure/            # 基础设施层
│   │   ├── cli-adapter/           #   Claude CLI 进程管理、输出解析、进程池
│   │   ├── github/                #   GitHub API 客户端
│   │   ├── persistence/           #   JSON 状态存储、文件系统 Artifact 存储
│   │   ├── observability/         #   Pino 日志、Emittery 事件总线、费用追踪
│   │   └── prompt-framework/      #   AI Agent 框架适配器
│   └── config/                    # 配置层
│       ├── config.loader.ts       #   配置加载（dotenv + JSON）
│       ├── config.schema.ts       #   Zod 校验 Schema
│       └── config.defaults.ts     #   默认值常量
├── .ai-agents/                    # AI Agent Prompt 框架（供 Worker 使用）
├── docs/                          # 设计文档
├── automation.config.json         # 运行配置
├── .env.example                   # 环境变量模板
├── package.json
├── tsconfig.json
└── .pipeline/                     # 运行时产生的状态和日志（已 gitignore）
    ├── state/                     #   管道状态 JSON
    └── logs/                      #   执行日志
```

---

## 9. 常见问题

### Q: Claude CLI 未安装或路径不对

**报错**: `spawn claude ENOENT`

**解决**: 确认 Claude Code CLI 已安装，或在 `.env` 中设置 `CLAUDE_CLI_PATH` 为正确路径。

### Q: 配置校验失败

**报错**: `Configuration validation failed: ...`

**解决**: 检查 `automation.config.json` 的字段是否符合类型要求。`cli.projectDir` 为必填项。

### Q: 管道中断后如何恢复

使用 `cpbr resume -i <pipelineId>` 恢复。管道 ID 可通过 `cpbr status` 查看。

### Q: 如何只执行部分阶段

修改 `automation.config.json` 中的 `pipeline.phases`，例如只执行分析和设计：

```json
"phases": ["analyze", "design"]
```

### Q: 预算超限

**报错**: `BudgetExceededError`

**解决**: 提高 `pipeline.budgetLimit`（单位：美元），或减少评估维度数量以降低成本。

### Q: 如何添加新的评估维度

1. 在 `src/roles/evaluator/` 下创建新的评估器（实现 `IEvaluator`）
2. 在 `src/composition-root.ts` 的 `evaluatorMap` 中注册
3. 在 `automation.config.json` 的 `evaluator.dimensions` 中启用
