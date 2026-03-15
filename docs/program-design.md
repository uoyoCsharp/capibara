# My Virtual Tech Team — 程序设计文档

> **版本**: v1.0  
> **日期**: 2026-03-15  
> **状态**: 待开发  
> **前置文档**: [详细设计文档](detailed-design.md) · [技术栈确认](tech-stack-final-confirmed.md)

---

## 目录

1. [概述](#1-概述)
2. [工程结构](#2-工程结构)
3. [分层架构与依赖规则](#3-分层架构与依赖规则)
4. [DI 容器与 Composition Root](#4-di-容器与-composition-root)
5. [核心类型定义](#5-核心类型定义)
6. [核心接口定义](#6-核心接口定义)
7. [CLI 适配层](#7-cli-适配层)
8. [角色实现层](#8-角色实现层)
9. [状态机引擎](#9-状态机引擎)
10. [Pipeline 编排层](#10-pipeline-编排层)
11. [持久化层](#11-持久化层)
12. [配置层](#12-配置层)
13. [可观测性层](#13-可观测性层)
14. [CLI 入口层](#14-cli-入口层)
15. [错误处理策略](#15-错误处理策略)
16. [开发顺序与交付检查清单](#16-开发顺序与交付检查清单)

---

## 1. 概述

### 1.1 目标

本文档面向开发者，提供从代码结构到具体类/接口签名的完整程序设计，覆盖 MVP（Phase A）及评估反馈环（Phase B）两个里程碑的实现细节。

### 1.2 技术基线

| 项目 | 选型 |
|------|------|
| 运行时 | Node.js 22 LTS |
| 语言 | TypeScript 5.x (strict) |
| 模块系统 | ESM |
| 包管理 | pnpm |
| DI 框架 | tsyringe + reflect-metadata |
| CLI 框架 | commander |
| 校验 | zod |
| 日志 | pino |
| 事件总线 | emittery |
| 测试 | vitest |
| 状态机 | 自研轻量实现 |

### 1.3 命名规约

| 对象 | 规则 | 示例 |
|------|------|------|
| 接口 | `I` 前缀 + PascalCase | `IWorker`, `IEvaluator` |
| 类型/枚举 | PascalCase | `Phase`, `EvaluationVerdict` |
| 类 | PascalCase | `ClaudeCliWorker`, `RuleEngineConductor` |
| DI Token | UPPER_SNAKE + `_TOKEN` 后缀 | `WORKER_TOKEN`, `CLI_ADAPTER_TOKEN` |
| 文件 | kebab-case | `claude-cli.worker.ts`, `pipeline.service.ts` |
| 目录 | kebab-case | `cli-adapter/`, `state-machine/` |

---

## 2. 工程结构

```
my-virtual-techteam/
├── src/
│   ├── core/                            # ① 核心领域层（零外部依赖）
│   │   ├── interfaces/
│   │   │   ├── worker.interface.ts       # IWorker
│   │   │   ├── evaluator.interface.ts    # IEvaluator
│   │   │   ├── conductor.interface.ts    # IConductor
│   │   │   ├── messenger.interface.ts    # IMessenger
│   │   │   ├── trigger.interface.ts      # ITrigger
│   │   │   ├── state-store.interface.ts  # IStateStore
│   │   │   ├── artifact-store.interface.ts # IArtifactStore
│   │   │   ├── event-bus.interface.ts    # IEventBus
│   │   │   └── index.ts                 # barrel export
│   │   ├── types/
│   │   │   ├── phase.types.ts            # Phase, PhaseConfig
│   │   │   ├── pipeline.types.ts         # PipelineContext, PipelineResult, PipelineState
│   │   │   ├── evaluation.types.ts       # EvaluationInput/Result/Issue, EvaluationDimension
│   │   │   ├── requirement.types.ts      # Requirement
│   │   │   ├── conductor.types.ts        # ConductorDecision, ConductorAction
│   │   │   ├── messenger.types.ts        # SummaryFormat, OutputSchema
│   │   │   ├── worker.types.ts           # WorkerCommand, WorkerResult
│   │   │   ├── cli.types.ts              # ClaudeCliOptions, ClaudeCliResult, ClaudeCliJsonOutput
│   │   │   ├── config.types.ts           # AutomationConfig（类型定义，不含 zod）
│   │   │   ├── events.types.ts           # PipelineEvent
│   │   │   └── index.ts                 # barrel export
│   │   ├── errors/
│   │   │   ├── base.error.ts             # AppError 基类
│   │   │   ├── cli.errors.ts             # CliExecutionError, CliParseError, CliTimeoutError
│   │   │   ├── pipeline.errors.ts        # PipelineError, PhaseError, BudgetExceededError
│   │   │   ├── evaluation.errors.ts      # EvaluationParseError
│   │   │   └── index.ts
│   │   └── constants/
│   │       ├── phases.ts                 # PHASES 数组, PHASE_AGENT_MAP
│   │       ├── permissions.ts            # WORKER_PHASE_PERMISSIONS, ROLE_PERMISSIONS
│   │       └── index.ts
│   │
│   ├── infrastructure/                   # ② 基础设施层（外部依赖集中此处）
│   │   ├── cli-adapter/
│   │   │   ├── claude-cli.adapter.ts     # ClaudeCliAdapter 实现
│   │   │   ├── process-pool.ts           # CliProcessPool (Semaphore)
│   │   │   └── output-parser.ts          # CliOutputParser (多策略)
│   │   ├── persistence/
│   │   │   ├── json-state-store.ts       # IStateStore 的 JSON 文件实现
│   │   │   ├── fs-artifact-store.ts      # IArtifactStore 的文件系统实现
│   │   │   └── wal-journal.ts            # WriteAheadLog 保证写入一致性
│   │   ├── observability/
│   │   │   ├── pino-logger.ts            # pino 日志封装
│   │   │   ├── emittery-event-bus.ts     # IEventBus 的 emittery 实现
│   │   │   └── cost-tracker.ts           # 费用追踪器
│   │   ├── prompt/
│   │   │   └── prompt-loader.ts          # .ai-agents/ 文件加载器
│   │   └── github/
│   │       └── github-client.ts          # Octokit 封装
│   │
│   ├── application/                      # ③ 应用服务层（编排 + 用例）
│   │   ├── pipeline/
│   │   │   ├── pipeline.service.ts       # PipelineService（主编排）
│   │   │   ├── phase-executor.ts         # PhaseExecutor（单阶段执行）
│   │   │   └── feedback-loop.ts          # FeedbackLoop（评估反馈环）
│   │   ├── state-machine/
│   │   │   ├── states.ts                 # 状态枚举
│   │   │   ├── transitions.ts            # 转移规则表
│   │   │   └── state-machine.ts          # StateMachine 实现
│   │   ├── context/
│   │   │   ├── context-builder.ts        # ContextBuilder（为不同 Role 构建上下文）
│   │   │   └── session-manager.ts        # WorkerSessionManager（会话生命周期）
│   │   └── human-interaction/
│   │       ├── human-interaction.handler.ts  # HumanInteractionHandler
│   │       └── strategies/
│   │           ├── github-comment.strategy.ts
│   │           └── terminal.strategy.ts
│   │
│   ├── roles/                            # ④ 角色实现层
│   │   ├── worker/
│   │   │   └── claude-cli.worker.ts      # ClaudeCliWorker
│   │   ├── evaluator/
│   │   │   ├── claude-cli.evaluator.ts   # ClaudeCliEvaluator（基类）
│   │   │   ├── quality.evaluator.ts      # QualityEvaluator
│   │   │   ├── security.evaluator.ts     # SecurityEvaluator
│   │   │   └── consistency.evaluator.ts  # ConsistencyEvaluator
│   │   ├── conductor/
│   │   │   └── rule-engine.conductor.ts  # RuleEngineConductor
│   │   ├── messenger/
│   │   │   └── claude-cli.messenger.ts   # ClaudeCliMessenger
│   │   └── trigger/
│   │       └── github-issues.trigger.ts  # GitHubIssuesTrigger
│   │
│   ├── config/                           # ⑤ 配置层
│   │   ├── config.schema.ts              # zod schema 定义
│   │   ├── config.loader.ts              # 加载 + 校验 + 合并
│   │   └── config.defaults.ts            # 默认值
│   │
│   ├── composition-root.ts               # ⑥ DI 容器装配（唯一容器注册点）
│   ├── tokens.ts                         # ⑦ 所有 DI Token 定义
│   └── main.ts                           # ⑧ CLI 入口 (commander)
│
├── tests/
│   ├── unit/                             # 单元测试（mock 外部依赖）
│   ├── integration/                      # 集成测试（真实 CLI 调用）
│   └── fixtures/                         # 测试数据
│
├── .env.example                          # 环境变量模板
├── tsconfig.json
├── vitest.config.ts
├── package.json
└── README.md
```

---

## 3. 分层架构与依赖规则

```
┌──────────────────────────────────────────────────┐
│                  main.ts (CLI 入口)               │
│            commander 解析 → 调用 application       │
└──────────────────┬───────────────────────────────┘
                   │ 依赖
┌──────────────────▼───────────────────────────────┐
│             composition-root.ts                   │
│         tsyringe 容器装配（唯一注册点）              │
└──────┬──────────────┬──────────────┬─────────────┘
       │              │              │
┌──────▼──────┐┌──────▼──────┐┌──────▼──────┐
│ application ││   roles     ││infrastructure│
│ (编排/用例)  ││ (角色实现)   ││ (外部适配)    │
└──────┬──────┘└──────┬──────┘└──────┬──────┘
       │              │              │
       └──────────────┼──────────────┘
                      │ 全部依赖
              ┌───────▼───────┐
              │     core      │
              │ (接口/类型/常量)│
              │ 零外部依赖     │
              └───────────────┘
```

**依赖铁律**：
1. `core` 层不可 import 任何其他层，不可 import 任何第三方库（纯 TS 定义）
2. `infrastructure` 层只可 import `core`
3. `roles` 层只可 import `core` + `infrastructure`（仅通过接口）
4. `application` 层可 import `core` + 通过 DI 注入 `roles` 与 `infrastructure`
5. `composition-root.ts` 是唯一可以 import 所有层的文件
6. `main.ts` 仅 import `composition-root` + `commander`

---

## 4. DI 容器与 Composition Root

### 4.1 Token 定义

```typescript
// src/tokens.ts
import { InjectionToken } from 'tsyringe';
import type { IWorker } from './core/interfaces/worker.interface.js';
import type { IEvaluator } from './core/interfaces/evaluator.interface.js';
import type { IConductor } from './core/interfaces/conductor.interface.js';
import type { IMessenger } from './core/interfaces/messenger.interface.js';
import type { ITrigger } from './core/interfaces/trigger.interface.js';
import type { IStateStore } from './core/interfaces/state-store.interface.js';
import type { IArtifactStore } from './core/interfaces/artifact-store.interface.js';
import type { IEventBus } from './core/interfaces/event-bus.interface.js';
import type { AutomationConfig } from './core/types/config.types.js';
import type { ClaudeCliAdapter } from './infrastructure/cli-adapter/claude-cli.adapter.js';
import type { CliProcessPool } from './infrastructure/cli-adapter/process-pool.js';
import type { CliOutputParser } from './infrastructure/cli-adapter/output-parser.js';
import type { PromptLoader } from './infrastructure/prompt/prompt-loader.js';
import type { CostTracker } from './infrastructure/observability/cost-tracker.js';
import type { Logger } from 'pino';

// ---------- 核心角色 ----------
export const WORKER_TOKEN = new InjectionToken<IWorker>('IWorker');
export const EVALUATOR_TOKEN = new InjectionToken<IEvaluator[]>('IEvaluator[]');
export const CONDUCTOR_TOKEN = new InjectionToken<IConductor>('IConductor');
export const MESSENGER_TOKEN = new InjectionToken<IMessenger>('IMessenger');
export const TRIGGER_TOKEN = new InjectionToken<ITrigger>('ITrigger');

// ---------- 基础设施 ----------
export const CLI_ADAPTER_TOKEN = new InjectionToken<ClaudeCliAdapter>('ClaudeCliAdapter');
export const PROCESS_POOL_TOKEN = new InjectionToken<CliProcessPool>('CliProcessPool');
export const OUTPUT_PARSER_TOKEN = new InjectionToken<CliOutputParser>('CliOutputParser');
export const STATE_STORE_TOKEN = new InjectionToken<IStateStore>('IStateStore');
export const ARTIFACT_STORE_TOKEN = new InjectionToken<IArtifactStore>('IArtifactStore');
export const EVENT_BUS_TOKEN = new InjectionToken<IEventBus>('IEventBus');
export const PROMPT_LOADER_TOKEN = new InjectionToken<PromptLoader>('PromptLoader');
export const COST_TRACKER_TOKEN = new InjectionToken<CostTracker>('CostTracker');

// ---------- 横切关注 ----------
export const CONFIG_TOKEN = new InjectionToken<AutomationConfig>('AutomationConfig');
export const LOGGER_TOKEN = new InjectionToken<Logger>('Logger');
```

### 4.2 Composition Root

```typescript
// src/composition-root.ts
import 'reflect-metadata';
import { container } from 'tsyringe';

import { loadConfig } from './config/config.loader.js';
import { createLogger } from './infrastructure/observability/pino-logger.js';
import {
  CONFIG_TOKEN, LOGGER_TOKEN, CLI_ADAPTER_TOKEN, PROCESS_POOL_TOKEN,
  OUTPUT_PARSER_TOKEN, STATE_STORE_TOKEN, ARTIFACT_STORE_TOKEN,
  EVENT_BUS_TOKEN, PROMPT_LOADER_TOKEN, COST_TRACKER_TOKEN,
  WORKER_TOKEN, EVALUATOR_TOKEN, CONDUCTOR_TOKEN, MESSENGER_TOKEN, TRIGGER_TOKEN,
} from './tokens.js';

// Infrastructure
import { ClaudeCliAdapter } from './infrastructure/cli-adapter/claude-cli.adapter.js';
import { CliProcessPool } from './infrastructure/cli-adapter/process-pool.js';
import { CliOutputParser } from './infrastructure/cli-adapter/output-parser.js';
import { JsonStateStore } from './infrastructure/persistence/json-state-store.js';
import { FsArtifactStore } from './infrastructure/persistence/fs-artifact-store.js';
import { EmitteryEventBus } from './infrastructure/observability/emittery-event-bus.js';
import { PromptLoader } from './infrastructure/prompt/prompt-loader.js';
import { CostTracker } from './infrastructure/observability/cost-tracker.js';

// Roles
import { ClaudeCliWorker } from './roles/worker/claude-cli.worker.js';
import { QualityEvaluator } from './roles/evaluator/quality.evaluator.js';
import { SecurityEvaluator } from './roles/evaluator/security.evaluator.js';
import { ConsistencyEvaluator } from './roles/evaluator/consistency.evaluator.js';
import { RuleEngineConductor } from './roles/conductor/rule-engine.conductor.js';
import { ClaudeCliMessenger } from './roles/messenger/claude-cli.messenger.js';
import { GitHubIssuesTrigger } from './roles/trigger/github-issues.trigger.js';

// Application
import { PipelineService } from './application/pipeline/pipeline.service.js';

export function bootstrap(): PipelineService {
  // 1. 配置
  const config = loadConfig();
  container.register(CONFIG_TOKEN, { useValue: config });

  // 2. 日志
  const logger = createLogger(config);
  container.register(LOGGER_TOKEN, { useValue: logger });

  // 3. 基础设施
  container.registerSingleton(CLI_ADAPTER_TOKEN, ClaudeCliAdapter);
  container.registerSingleton(OUTPUT_PARSER_TOKEN, CliOutputParser);
  container.register(PROCESS_POOL_TOKEN, {
    useFactory: (c) => new CliProcessPool(
      c.resolve(CLI_ADAPTER_TOKEN),
      config.cli.maxConcurrentProcesses,
    ),
  });
  container.registerSingleton(STATE_STORE_TOKEN, JsonStateStore);
  container.registerSingleton(ARTIFACT_STORE_TOKEN, FsArtifactStore);
  container.registerSingleton(EVENT_BUS_TOKEN, EmitteryEventBus);
  container.registerSingleton(PROMPT_LOADER_TOKEN, PromptLoader);
  container.registerSingleton(COST_TRACKER_TOKEN, CostTracker);

  // 4. 角色
  container.registerSingleton(WORKER_TOKEN, ClaudeCliWorker);
  container.registerSingleton(CONDUCTOR_TOKEN, RuleEngineConductor);
  container.registerSingleton(MESSENGER_TOKEN, ClaudeCliMessenger);

  // Evaluator 数组注册（按配置的 dimensions 动态组装）
  const evaluatorMap: Record<string, new (...args: any[]) => any> = {
    quality: QualityEvaluator,
    security: SecurityEvaluator,
    consistency: ConsistencyEvaluator,
  };
  const evaluators = config.evaluator.dimensions.map((dim) => {
    const Ctor = evaluatorMap[dim];
    return container.resolve(Ctor);
  });
  container.register(EVALUATOR_TOKEN, { useValue: evaluators });

  // Trigger（按配置的 type 选择）
  if (config.trigger.type === 'github_issues') {
    container.registerSingleton(TRIGGER_TOKEN, GitHubIssuesTrigger);
  }
  // manual mode 不注册 trigger

  // 5. 应用服务
  return container.resolve(PipelineService);
}
```

---

## 5. 核心类型定义

以下类型均位于 `src/core/types/` 下，不依赖任何第三方库。

### 5.1 阶段与模式

```typescript
// src/core/types/phase.types.ts

/** 开发生命周期阶段 */
export type Phase = 'analyze' | 'design' | 'implement' | 'review' | 'test';

/** 交互模式 */
export type InteractionMode = 'auto' | 'semi-auto' | 'manual';

/** 阶段-Agent 映射关系 */
export interface PhaseAgentMapping {
  phase: Phase;
  agentFile: string;     // agents/{agent}.md
  commandFile: string;   // agents/_commands/{command}.md
}
```

### 5.2 需求

```typescript
// src/core/types/requirement.types.ts

export type RequirementSource = 'github_issue' | 'notion' | 'manual';

export interface Requirement {
  id: string;
  title: string;
  description: string;
  source: RequirementSource;
  metadata: Record<string, unknown>;
  createdAt: string;
}
```

### 5.3 Worker 类型

```typescript
// src/core/types/worker.types.ts

export interface WorkerCommand {
  command: string;              // "#analyze" 等
  input: string;                // 用户 prompt
  systemPrompt: string;         // 角色 + 规则 + 命令 + 知识库
  sessionId?: string;
  resume?: boolean;
  maxTurns?: number;
  allowedTools?: string[];
  disallowedTools?: string[];
  cwd?: string;
  timeout?: number;
}

export interface WorkerResult {
  success: boolean;
  output: string;
  artifact: string;
  sessionId: string;
  tokensUsed: number;
  costUsd: number;
  duration: number;
}
```

### 5.4 评估类型

```typescript
// src/core/types/evaluation.types.ts

export type EvaluationDimension = 'quality' | 'security' | 'consistency';

export type EvaluationVerdict =
  | 'pass'
  | 'pass_with_notes'
  | 'needs_revision'
  | 'critical_issues';

export type IssueSeverity = 'critical' | 'major' | 'minor' | 'suggestion';

export interface EvaluationIssue {
  severity: IssueSeverity;
  category: string;
  description: string;
  suggestion?: string;
}

export interface EvaluationInput {
  projectSummary: string;
  phaseSummary: string;
  artifact: string;
  evaluationCriteria: string;
  pipelineId: string;
  phase: Phase;
  projectDir: string;
}

export interface EvaluationResult {
  dimension: EvaluationDimension;
  verdict: EvaluationVerdict;
  score: number;
  issues: EvaluationIssue[];
  summary: string;
}
```

### 5.5 Conductor 类型

```typescript
// src/core/types/conductor.types.ts

export type ConductorAction = 'approve' | 'revise' | 'escalate';

export interface ConductorDecision {
  action: ConductorAction;
  reason: string;
  feedback?: string[];
  notes?: EvaluationIssue[];
  priority?: 'critical' | 'normal';
}
```

### 5.6 Messenger 类型

```typescript
// src/core/types/messenger.types.ts
import type { Phase } from './phase.types.js';
import type { WorkerCommand, WorkerResult } from './worker.types.js';
import type { EvaluationInput, EvaluationResult } from './evaluation.types.js';
import type { ConductorDecision } from './conductor.types.js';
import type { PipelineContext } from './pipeline.types.js';

export type SummaryStyle = 'evaluation-ready' | 'context-recovery' | 'feedback-synthesis';

export interface SummaryFormat {
  style: SummaryStyle;
  template: string;
  maxLength?: number;
}

export interface OutputSchema {
  type: string;
  properties: Record<string, unknown>;
  required?: string[];
}

export type StructuredData = Record<string, unknown>;
```

### 5.7 Pipeline 类型

```typescript
// src/core/types/pipeline.types.ts
import type { Phase, InteractionMode } from './phase.types.js';
import type { Requirement } from './requirement.types.js';
import type { EvaluationResult } from './evaluation.types.js';
import type { ConductorDecision } from './conductor.types.js';

export type PipelineStatus = 'running' | 'paused' | 'completed' | 'failed';

export interface PipelineContext {
  pipelineId: string;
  requirement: Requirement;
  changeId: string;
  currentPhase: Phase;
  completedPhases: Phase[];
  phaseAttempts: Record<Phase, number>;
  workerSessionId: string;
  revisionFeedback?: string[];
  artifacts: Record<Phase, string>;
  mode: InteractionMode;
}

export interface PipelineResult {
  success: boolean;
  changeId: string;
  phases: Record<Phase, PhaseResult>;
  totalCost: number;
  totalDuration: number;
}

export interface PhaseResult {
  attempts: number;
  finalScore: number;
  duration: number;
  tokenCost: number;
}

/** 持久化用的完整状态快照 */
export interface PipelineState {
  id: string;
  requirementId: string;
  changeId: string;
  currentState: string;
  currentPhase: Phase;
  phaseAttempts: Record<Phase, number>;
  context: {
    requirement: Requirement;
    artifacts: Record<Phase, string>;
    evaluations: Record<Phase, EvaluationResult[]>;
    decisions: Record<Phase, ConductorDecision[]>;
  };
  sessions: {
    workerSessionId: string;
    workerSessionPhase: Phase;
  };
  metadata: {
    createdAt: string;
    updatedAt: string;
    status: PipelineStatus;
    mode: InteractionMode;
    totalTokensUsed: number;
    totalCost: number;
  };
}
```

### 5.8 CLI 类型

```typescript
// src/core/types/cli.types.ts

export interface ClaudeCliOptions {
  prompt: string;
  systemPrompt?: string;
  appendSystemPrompt?: string;
  sessionId?: string;
  resume?: boolean;
  outputFormat?: 'json' | 'text' | 'stream-json';
  maxTurns?: number;
  allowedTools?: string[];
  disallowedTools?: string[];
  cwd?: string;
  timeout?: number;
}

export interface ClaudeCliResult {
  success: boolean;
  output: string;
  sessionId: string;
  tokensUsed?: number;
  costUsd?: number;
  exitCode: number;
  duration: number;
}

/** claude --output-format json 返回结构 */
export interface ClaudeCliJsonOutput {
  type: 'result';
  subtype: 'success' | 'error_max_turns';
  is_error: boolean;
  duration_ms: number;
  duration_api_ms: number;
  num_turns: number;
  result: string;
  total_cost_usd: number;
  session_id: string;
}
```

### 5.9 事件类型

```typescript
// src/core/types/events.types.ts
import type { Phase } from './phase.types.js';

export type PipelineEventType =
  | 'pipeline:started'
  | 'pipeline:completed'
  | 'pipeline:failed'
  | 'phase:started'
  | 'phase:completed'
  | 'phase:retry'
  | 'worker:started'
  | 'worker:completed'
  | 'evaluator:started'
  | 'evaluator:completed'
  | 'conductor:decided'
  | 'messenger:summarized'
  | 'human:intervention_requested'
  | 'human:response_received'
  | 'cost:threshold_warning';

export interface PipelineEvent {
  timestamp: string;
  pipelineId: string;
  phase?: Phase;
  role?: string;
  eventType: PipelineEventType;
  data: Record<string, unknown>;
}
```

### 5.10 配置类型

```typescript
// src/core/types/config.types.ts
import type { Phase, InteractionMode } from './phase.types.js';
import type { EvaluationDimension } from './evaluation.types.js';

export interface CliConfig {
  cliPath: string;
  projectDir: string;
  maxConcurrentProcesses: number;
}

export interface WorkerConfig {
  defaultMaxTurns: number;
  defaultTimeout: number;
}

export interface EvaluatorConfig {
  dimensions: EvaluationDimension[];
  maxTurns: number;
  parseRetries: number;
}

export interface MessengerConfig {
  maxTurns: number;
  summarizeThreshold: number;
  fallbackToRaw: boolean;
}

export interface ConductorConfig {
  maxAttemptsPerPhase: number;
  autoApproveThreshold: number;
  escalateThreshold: number;
  maxTurns: number;
}

export interface GitHubTriggerConfig {
  owner: string;
  repo: string;
  labels: string[];
  pollInterval: number;
  token: string;
}

export interface TriggerConfig {
  type: 'github_issues' | 'manual';
  github?: GitHubTriggerConfig;
}

export interface PipelineConfig {
  mode: InteractionMode;
  phases: Phase[];
  budgetLimit: number;
}

export interface PersistenceConfig {
  stateDir: string;
  logDir: string;
}

export interface AutomationConfig {
  cli: CliConfig;
  worker: WorkerConfig;
  evaluator: EvaluatorConfig;
  messenger: MessengerConfig;
  conductor: ConductorConfig;
  trigger: TriggerConfig;
  pipeline: PipelineConfig;
  persistence: PersistenceConfig;
}
```

---

## 6. 核心接口定义

所有接口位于 `src/core/interfaces/`，不依赖具体实现。

### 6.1 IWorker

```typescript
// src/core/interfaces/worker.interface.ts
import type { WorkerCommand, WorkerResult } from '../types/worker.types.js';

export interface IWorker {
  /** 执行一个阶段命令 */
  executeCommand(command: WorkerCommand): Promise<WorkerResult>;
  /** 获取当前绑定的 session ID */
  getSessionId(): string | undefined;
}
```

### 6.2 IEvaluator

```typescript
// src/core/interfaces/evaluator.interface.ts
import type { EvaluationInput, EvaluationResult, EvaluationDimension } from '../types/evaluation.types.js';

export interface IEvaluator {
  /** 执行评估 */
  evaluate(input: EvaluationInput): Promise<EvaluationResult>;
  /** 返回该评估器负责的维度 */
  getDimension(): EvaluationDimension;
}
```

### 6.3 IConductor

```typescript
// src/core/interfaces/conductor.interface.ts
import type { EvaluationResult } from '../types/evaluation.types.js';
import type { ConductorDecision } from '../types/conductor.types.js';

export interface IConductor {
  /** 根据评估结果做出决策 */
  decide(evaluations: EvaluationResult[]): Promise<ConductorDecision>;
}
```

### 6.4 IMessenger

```typescript
// src/core/interfaces/messenger.interface.ts
import type { Phase } from '../types/phase.types.js';
import type { PipelineContext } from '../types/pipeline.types.js';
import type { WorkerCommand, WorkerResult } from '../types/worker.types.js';
import type { EvaluationInput, EvaluationResult } from '../types/evaluation.types.js';
import type { ConductorDecision } from '../types/conductor.types.js';
import type { SummaryFormat, StructuredData, OutputSchema } from '../types/messenger.types.js';

export interface IMessenger {
  /** 为 Worker 构建指令（复用 .ai-agents/ prompt） */
  formatForWorker(phase: Phase, context: PipelineContext): WorkerCommand;

  /** 为 Evaluator 构建评估输入 */
  formatForEvaluator(workerOutput: WorkerResult, context: PipelineContext): EvaluationInput;

  /** 【LLM】将内容汇总为精简摘要 */
  summarize(content: string, format: SummaryFormat): Promise<string>;

  /** 【LLM】将非结构化文本转换为结构化 JSON */
  structurize(rawOutput: string, schema: OutputSchema): Promise<StructuredData>;

  /** 【LLM】整合多个 Evaluator 反馈为统一的修改建议 */
  synthesizeFeedback(evaluations: EvaluationResult[], context: PipelineContext): Promise<string>;

  /** 根据 Conductor 决策更新上下文（纯逻辑，无需 LLM） */
  updateContext(decision: ConductorDecision, context: PipelineContext): PipelineContext;
}
```

### 6.5 ITrigger

```typescript
// src/core/interfaces/trigger.interface.ts
import type { Requirement } from '../types/requirement.types.js';

export interface ITrigger {
  /** 监听需求源，yield 新需求 */
  watch(): AsyncIterable<Requirement>;
  /** 标记需求已开始处理 */
  acknowledge(requirementId: string): Promise<void>;
  /** 标记需求处理完成 */
  close(requirementId: string, status: string): Promise<void>;
}
```

### 6.6 IStateStore

```typescript
// src/core/interfaces/state-store.interface.ts
import type { PipelineState } from '../types/pipeline.types.js';

export interface IStateStore {
  save(state: PipelineState): Promise<void>;
  load(pipelineId: string): Promise<PipelineState | null>;
  list(): Promise<PipelineState[]>;
  delete(pipelineId: string): Promise<void>;
}
```

### 6.7 IArtifactStore

```typescript
// src/core/interfaces/artifact-store.interface.ts
import type { Phase } from '../types/phase.types.js';

export interface Artifact {
  phase: Phase;
  path: string;
  content: string;
}

export interface IArtifactStore {
  save(changeId: string, phase: Phase, content: string): Promise<string>;
  load(changeId: string, phase: Phase): Promise<Artifact | null>;
  loadAll(changeId: string): Promise<Artifact[]>;
  detectChangedFiles(since?: string): Promise<string[]>;
}
```

### 6.8 IEventBus

```typescript
// src/core/interfaces/event-bus.interface.ts
import type { PipelineEvent, PipelineEventType } from '../types/events.types.js';

export interface IEventBus {
  emit(event: PipelineEvent): void;
  on(eventType: PipelineEventType, handler: (event: PipelineEvent) => void): void;
  off(eventType: PipelineEventType, handler: (event: PipelineEvent) => void): void;
}
```

---

## 7. CLI 适配层

### 7.1 ClaudeCliAdapter

核心职责：封装 `claude` CLI 进程的 spawn、参数构建、输出收集。

```typescript
// src/infrastructure/cli-adapter/claude-cli.adapter.ts
import { spawn } from 'node:child_process';
import { inject, injectable } from 'tsyringe';
import { CONFIG_TOKEN, LOGGER_TOKEN } from '../../tokens.js';
import type { AutomationConfig } from '../../core/types/config.types.js';
import type { ClaudeCliOptions, ClaudeCliResult } from '../../core/types/cli.types.js';
import type { Logger } from 'pino';
import { CliExecutionError, CliTimeoutError } from '../../core/errors/cli.errors.js';

@injectable()
export class ClaudeCliAdapter {
  private readonly cliPath: string;

  constructor(
    @inject(CONFIG_TOKEN) private config: AutomationConfig,
    @inject(LOGGER_TOKEN) private logger: Logger,
  ) {
    this.cliPath = config.cli.cliPath;
  }

  async execute(options: ClaudeCliOptions): Promise<ClaudeCliResult> {
    const args = this.buildArgs(options);
    const startTime = Date.now();

    this.logger.debug({ args: this.redactArgs(args) }, 'CLI execute');

    return new Promise<ClaudeCliResult>((resolve, reject) => {
      const proc = spawn(this.cliPath, args, {
        cwd: options.cwd ?? this.config.cli.projectDir,
        env: { ...process.env },
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      let stdout = '';
      let stderr = '';

      proc.stdout.on('data', (data: Buffer) => { stdout += data.toString(); });
      proc.stderr.on('data', (data: Buffer) => { stderr += data.toString(); });

      const timer = options.timeout
        ? setTimeout(() => {
            proc.kill('SIGTERM');
            reject(new CliTimeoutError(options.timeout!));
          }, options.timeout)
        : null;

      proc.on('close', (code) => {
        if (timer) clearTimeout(timer);
        const duration = Date.now() - startTime;
        resolve({
          success: code === 0,
          output: stdout,
          sessionId: this.extractSessionId(stdout, options),
          exitCode: code ?? 1,
          duration,
        });
      });

      proc.on('error', (err) => {
        if (timer) clearTimeout(timer);
        reject(new CliExecutionError(err.message));
      });
    });
  }

  private buildArgs(options: ClaudeCliOptions): string[] {
    const args: string[] = [
      '--print',
      '--output-format', options.outputFormat ?? 'json',
    ];

    if (options.systemPrompt) args.push('--system-prompt', options.systemPrompt);
    if (options.appendSystemPrompt) args.push('--append-system-prompt', options.appendSystemPrompt);
    if (options.sessionId) args.push('--session-id', options.sessionId);
    if (options.resume) args.push('--resume');
    if (options.maxTurns) args.push('--max-turns', String(options.maxTurns));
    if (options.allowedTools?.length) args.push('--allowedTools', options.allowedTools.join(','));
    if (options.disallowedTools?.length) args.push('--disallowedTools', options.disallowedTools.join(','));
    args.push('--dangerously-skip-permissions');
    args.push(options.prompt);

    return args;
  }

  private extractSessionId(stdout: string, options: ClaudeCliOptions): string {
    if (options.sessionId) return options.sessionId;
    try {
      const parsed = JSON.parse(stdout);
      return parsed.session_id ?? '';
    } catch {
      return '';
    }
  }

  /** 日志中隐藏 system-prompt 的具体内容 */
  private redactArgs(args: string[]): string[] {
    return args.map((a, i) =>
      args[i - 1] === '--system-prompt' ? '[REDACTED]' : a,
    );
  }
}
```

### 7.2 CliProcessPool

控制 CLI 并行进程数量，防止资源耗尽。

```typescript
// src/infrastructure/cli-adapter/process-pool.ts
import type { ClaudeCliAdapter } from './claude-cli.adapter.js';
import type { ClaudeCliOptions, ClaudeCliResult } from '../../core/types/cli.types.js';

/**
 * 简易信号量，限制最大并行 CLI 进程数。
 * 不引入第三方库，手动实现以保持轻量。
 */
class Semaphore {
  private current = 0;
  private queue: Array<() => void> = [];

  constructor(private readonly max: number) {}

  async acquire(): Promise<void> {
    if (this.current < this.max) {
      this.current++;
      return;
    }
    return new Promise<void>((resolve) => {
      this.queue.push(() => { this.current++; resolve(); });
    });
  }

  release(): void {
    this.current--;
    const next = this.queue.shift();
    if (next) next();
  }
}

export class CliProcessPool {
  private semaphore: Semaphore;

  constructor(
    private adapter: ClaudeCliAdapter,
    maxConcurrent: number,
  ) {
    this.semaphore = new Semaphore(maxConcurrent);
  }

  async execute(options: ClaudeCliOptions): Promise<ClaudeCliResult> {
    await this.semaphore.acquire();
    try {
      return await this.adapter.execute(options);
    } finally {
      this.semaphore.release();
    }
  }

  async executeParallel(optionsList: ClaudeCliOptions[]): Promise<ClaudeCliResult[]> {
    return Promise.all(optionsList.map((opts) => this.execute(opts)));
  }
}
```

### 7.3 CliOutputParser

负责从 CLI JSON 输出中提取结构化数据，提供多策略降级。

```typescript
// src/infrastructure/cli-adapter/output-parser.ts
import { injectable, inject } from 'tsyringe';
import { LOGGER_TOKEN } from '../../tokens.js';
import type { Logger } from 'pino';
import type { ClaudeCliResult, ClaudeCliJsonOutput } from '../../core/types/cli.types.js';
import { CliParseError } from '../../core/errors/cli.errors.js';

@injectable()
export class CliOutputParser {
  constructor(@inject(LOGGER_TOKEN) private logger: Logger) {}

  /**
   * 解析 CLI JSON 输出元信息
   * CLI 使用 --output-format json 时，整体输出是 ClaudeCliJsonOutput
   */
  parseCliMeta(raw: string): ClaudeCliJsonOutput {
    return JSON.parse(raw) as ClaudeCliJsonOutput;
  }

  /**
   * 多策略提取结构化 JSON
   * 策略顺序: JSON 代码块 → 整体 JSON → result 字段 JSON
   */
  extractJson<T>(cliResult: ClaudeCliResult, validator?: (data: unknown) => data is T): T {
    const strategies = [
      () => this.tryJsonCodeBlock(cliResult.output),
      () => this.tryDirectParse(cliResult.output),
      () => this.tryResultFieldParse(cliResult.output),
    ];

    for (const strategy of strategies) {
      try {
        const parsed = strategy();
        if (parsed !== null) {
          if (validator && !validator(parsed)) continue;
          return parsed as T;
        }
      } catch { /* 继续下一策略 */ }
    }

    this.logger.warn({ output: cliResult.output.slice(0, 500) }, 'All parse strategies failed');
    throw new CliParseError('Failed to extract JSON from CLI output');
  }

  private tryJsonCodeBlock(output: string): unknown | null {
    const match = output.match(/```json\n([\s\S]*?)\n```/);
    return match ? JSON.parse(match[1]) : null;
  }

  private tryDirectParse(output: string): unknown | null {
    const parsed = JSON.parse(output);
    // CLI JSON output 的 result 字段可能包含我们要的 JSON
    if (typeof parsed === 'object' && parsed !== null && 'result' in parsed) {
      return this.tryDirectParse((parsed as ClaudeCliJsonOutput).result);
    }
    return parsed;
  }

  private tryResultFieldParse(output: string): unknown | null {
    try {
      const meta = JSON.parse(output) as ClaudeCliJsonOutput;
      return JSON.parse(meta.result);
    } catch {
      return null;
    }
  }
}
```

---

## 8. 角色实现层

### 8.1 ClaudeCliWorker

```typescript
// src/roles/worker/claude-cli.worker.ts
import { inject, injectable } from 'tsyringe';
import type { IWorker } from '../../core/interfaces/worker.interface.js';
import type { WorkerCommand, WorkerResult } from '../../core/types/worker.types.js';
import { CLI_ADAPTER_TOKEN, CONFIG_TOKEN, LOGGER_TOKEN, EVENT_BUS_TOKEN } from '../../tokens.js';
import type { ClaudeCliAdapter } from '../../infrastructure/cli-adapter/claude-cli.adapter.js';
import type { AutomationConfig } from '../../core/types/config.types.js';
import type { IEventBus } from '../../core/interfaces/event-bus.interface.js';
import type { Logger } from 'pino';

@injectable()
export class ClaudeCliWorker implements IWorker {
  private currentSessionId?: string;

  constructor(
    @inject(CLI_ADAPTER_TOKEN) private cliAdapter: ClaudeCliAdapter,
    @inject(CONFIG_TOKEN) private config: AutomationConfig,
    @inject(LOGGER_TOKEN) private logger: Logger,
    @inject(EVENT_BUS_TOKEN) private eventBus: IEventBus,
  ) {}

  async executeCommand(command: WorkerCommand): Promise<WorkerResult> {
    this.logger.info({ command: command.command, sessionId: command.sessionId }, 'Worker executing');

    const result = await this.cliAdapter.execute({
      prompt: command.input,
      systemPrompt: command.systemPrompt,
      sessionId: command.sessionId,
      resume: command.resume,
      maxTurns: command.maxTurns ?? this.config.worker.defaultMaxTurns,
      allowedTools: command.allowedTools,
      disallowedTools: command.disallowedTools,
      cwd: command.cwd ?? this.config.cli.projectDir,
      timeout: command.timeout ?? this.config.worker.defaultTimeout,
      outputFormat: 'json',
    });

    this.currentSessionId = result.sessionId;

    let meta: { costUsd: number; tokensUsed: number } = { costUsd: 0, tokensUsed: 0 };
    try {
      const parsed = JSON.parse(result.output);
      meta = { costUsd: parsed.total_cost_usd ?? 0, tokensUsed: 0 };
    } catch { /* 无法解析 cost，保留默认值 */ }

    return {
      success: result.success,
      output: result.output,
      artifact: '', // 产物通过 ArtifactStore 从文件系统读取
      sessionId: result.sessionId,
      tokensUsed: meta.tokensUsed,
      costUsd: meta.costUsd,
      duration: result.duration,
    };
  }

  getSessionId(): string | undefined {
    return this.currentSessionId;
  }
}
```

### 8.2 ClaudeCliEvaluator

```typescript
// src/roles/evaluator/claude-cli.evaluator.ts
import { inject } from 'tsyringe';
import type { IEvaluator } from '../../core/interfaces/evaluator.interface.js';
import type { EvaluationInput, EvaluationResult, EvaluationDimension } from '../../core/types/evaluation.types.js';
import { PROCESS_POOL_TOKEN, OUTPUT_PARSER_TOKEN, CONFIG_TOKEN, LOGGER_TOKEN } from '../../tokens.js';
import type { CliProcessPool } from '../../infrastructure/cli-adapter/process-pool.js';
import type { CliOutputParser } from '../../infrastructure/cli-adapter/output-parser.js';
import type { AutomationConfig } from '../../core/types/config.types.js';
import type { Logger } from 'pino';
import { ROLE_PERMISSIONS } from '../../core/constants/permissions.js';

/**
 * 基类：所有 CLI 只读 Evaluator 的通用逻辑。
 * 子类只需实现 buildSystemPrompt() 以提供评估维度的差异化 prompt。
 */
export abstract class ClaudeCliEvaluator implements IEvaluator {
  protected abstract readonly dimension: EvaluationDimension;

  constructor(
    @inject(PROCESS_POOL_TOKEN) protected processPool: CliProcessPool,
    @inject(OUTPUT_PARSER_TOKEN) protected outputParser: CliOutputParser,
    @inject(CONFIG_TOKEN) protected config: AutomationConfig,
    @inject(LOGGER_TOKEN) protected logger: Logger,
  ) {}

  async evaluate(input: EvaluationInput): Promise<EvaluationResult> {
    const systemPrompt = this.buildSystemPrompt();
    const userPrompt = this.buildUserPrompt(input);
    const permissions = ROLE_PERMISSIONS.evaluator;

    const result = await this.processPool.execute({
      prompt: userPrompt,
      systemPrompt,
      sessionId: `eval-${input.pipelineId}-${input.phase}-${this.dimension}`,
      disallowedTools: permissions.disallowed,
      maxTurns: this.config.evaluator.maxTurns,
      outputFormat: 'json',
      cwd: input.projectDir,
    });

    return this.parseResult(result, input);
  }

  getDimension(): EvaluationDimension {
    return this.dimension;
  }

  /** 子类实现：构建评估维度的 system prompt */
  protected abstract buildSystemPrompt(): string;

  private buildUserPrompt(input: EvaluationInput): string {
    return [
      `## 项目概要\n${input.projectSummary}`,
      `## 当前阶段: ${input.phase}\n${input.phaseSummary}`,
      `## 待评估产出物\n${input.artifact}`,
      `## 评估标准\n${input.evaluationCriteria}`,
      `请按照 system prompt 中要求的 JSON 格式输出评估结果。`,
    ].join('\n\n');
  }

  private parseResult(cliResult: any, input: EvaluationInput): EvaluationResult {
    const retries = this.config.evaluator.parseRetries;
    for (let i = 0; i <= retries; i++) {
      try {
        const parsed = this.outputParser.extractJson<Omit<EvaluationResult, 'dimension'>>(cliResult);
        return { ...parsed, dimension: this.dimension };
      } catch {
        if (i === retries) {
          this.logger.warn({ dimension: this.dimension, phase: input.phase }, 'Evaluation parse failed, returning fallback');
          return this.fallbackResult();
        }
      }
    }
    return this.fallbackResult();
  }

  private fallbackResult(): EvaluationResult {
    return {
      dimension: this.dimension,
      verdict: 'needs_revision',
      score: 0,
      issues: [{ severity: 'major', category: 'parse_error', description: '评估结果解析失败，需要人工审查' }],
      summary: '评估输出格式异常，无法自动解析',
    };
  }
}
```

子类示例：

```typescript
// src/roles/evaluator/quality.evaluator.ts
import { injectable, inject } from 'tsyringe';
import { ClaudeCliEvaluator } from './claude-cli.evaluator.js';
import type { EvaluationDimension } from '../../core/types/evaluation.types.js';
import { PROCESS_POOL_TOKEN, OUTPUT_PARSER_TOKEN, CONFIG_TOKEN, LOGGER_TOKEN } from '../../tokens.js';

@injectable()
export class QualityEvaluator extends ClaudeCliEvaluator {
  protected readonly dimension: EvaluationDimension = 'quality';

  constructor(
    @inject(PROCESS_POOL_TOKEN) processPool: any,
    @inject(OUTPUT_PARSER_TOKEN) outputParser: any,
    @inject(CONFIG_TOKEN) config: any,
    @inject(LOGGER_TOKEN) logger: any,
  ) {
    super(processPool, outputParser, config, logger);
  }

  protected buildSystemPrompt(): string {
    return `你是一个代码质量评估专家。重点关注：代码设计合理性、可读性、可维护性、模式遵循度。

规则：
1. 只评估，绝对不要修改任何文件
2. 你可以使用 Read 工具读取项目中的文件来验证产出物的真实性
3. 输出必须为以下 JSON 格式（使用 \`\`\`json 代码块）：
{
  "verdict": "pass|pass_with_notes|needs_revision|critical_issues",
  "score": 0-100,
  "issues": [{"severity": "critical|major|minor|suggestion", "category": "...", "description": "...", "suggestion": "..."}],
  "summary": "一句话总结"
}`;
  }
}
```

`SecurityEvaluator` 和 `ConsistencyEvaluator` 结构完全相同，仅 `dimension` 字段和 `buildSystemPrompt()` 内容不同。

### 8.3 RuleEngineConductor

```typescript
// src/roles/conductor/rule-engine.conductor.ts
import { inject, injectable } from 'tsyringe';
import type { IConductor } from '../../core/interfaces/conductor.interface.js';
import type { EvaluationResult } from '../../core/types/evaluation.types.js';
import type { ConductorDecision } from '../../core/types/conductor.types.js';
import { PROCESS_POOL_TOKEN, OUTPUT_PARSER_TOKEN, CONFIG_TOKEN, LOGGER_TOKEN } from '../../tokens.js';
import type { CliProcessPool } from '../../infrastructure/cli-adapter/process-pool.js';
import type { CliOutputParser } from '../../infrastructure/cli-adapter/output-parser.js';
import type { AutomationConfig } from '../../core/types/config.types.js';
import type { Logger } from 'pino';
import { ROLE_PERMISSIONS } from '../../core/constants/permissions.js';

@injectable()
export class RuleEngineConductor implements IConductor {
  constructor(
    @inject(PROCESS_POOL_TOKEN) private processPool: CliProcessPool,
    @inject(OUTPUT_PARSER_TOKEN) private outputParser: CliOutputParser,
    @inject(CONFIG_TOKEN) private config: AutomationConfig,
    @inject(LOGGER_TOKEN) private logger: Logger,
  ) {}

  async decide(evaluations: EvaluationResult[]): Promise<ConductorDecision> {
    // 阶段 1: 规则引擎快速决策
    const ruleDecision = this.applyRules(evaluations);
    if (ruleDecision) {
      this.logger.info({ action: ruleDecision.action }, 'Conductor decided by rules');
      return ruleDecision;
    }

    // 阶段 2: CLI LLM 兜底
    this.logger.info('Conductor falling back to LLM');
    return this.llmDecide(evaluations);
  }

  private applyRules(evaluations: EvaluationResult[]): ConductorDecision | null {
    const criticalIssues = evaluations.flatMap((e) =>
      e.issues.filter((i) => i.severity === 'critical'),
    );
    if (criticalIssues.length > 0) {
      return {
        action: 'revise',
        reason: `发现 ${criticalIssues.length} 个关键问题`,
        feedback: criticalIssues.map((i) => `[${i.category}] ${i.description}${i.suggestion ? `: ${i.suggestion}` : ''}`),
        priority: 'critical',
      };
    }

    if (evaluations.every((e) => e.verdict === 'pass')) {
      return { action: 'approve', reason: '所有评估通过' };
    }

    if (evaluations.every((e) => ['pass', 'pass_with_notes'].includes(e.verdict))) {
      const notes = evaluations.flatMap((e) => e.issues.filter((i) => i.severity === 'suggestion'));
      return { action: 'approve', reason: '通过（附建议）', notes };
    }

    // 分数高于阈值也放行
    const avgScore = evaluations.reduce((s, e) => s + e.score, 0) / evaluations.length;
    if (avgScore >= this.config.conductor.autoApproveThreshold) {
      return { action: 'approve', reason: `平均分${avgScore.toFixed(0)} ≥ 阈值${this.config.conductor.autoApproveThreshold}` };
    }

    return null; // 交给 LLM
  }

  private async llmDecide(evaluations: EvaluationResult[]): Promise<ConductorDecision> {
    const permissions = ROLE_PERMISSIONS.conductor;

    const result = await this.processPool.execute({
      prompt: `请分析以下评估结果并做出决策。\n\n评估结果：\n${JSON.stringify(evaluations, null, 2)}\n\n请输出 JSON：\n\`\`\`json\n{"action":"approve|revise|escalate","reason":"...","feedback":["..."],"priority":"critical|normal"}\n\`\`\``,
      systemPrompt: '你是决策协调者。根据多方评估结果做出综合决策。分析冲突点，权衡利弊，给出明确的行动建议。输出必须为 JSON 格式。',
      disallowedTools: permissions.disallowed,
      maxTurns: this.config.conductor.maxTurns,
      outputFormat: 'json',
    });

    return this.outputParser.extractJson<ConductorDecision>(result);
  }
}
```

### 8.4 ClaudeCliMessenger

```typescript
// src/roles/messenger/claude-cli.messenger.ts
import { inject, injectable } from 'tsyringe';
import type { IMessenger } from '../../core/interfaces/messenger.interface.js';
import type { Phase } from '../../core/types/phase.types.js';
import type { PipelineContext } from '../../core/types/pipeline.types.js';
import type { WorkerCommand, WorkerResult } from '../../core/types/worker.types.js';
import type { EvaluationInput, EvaluationResult } from '../../core/types/evaluation.types.js';
import type { ConductorDecision } from '../../core/types/conductor.types.js';
import type { SummaryFormat, StructuredData, OutputSchema } from '../../core/types/messenger.types.js';
import {
  PROCESS_POOL_TOKEN, OUTPUT_PARSER_TOKEN, PROMPT_LOADER_TOKEN,
  CONFIG_TOKEN, LOGGER_TOKEN,
} from '../../tokens.js';
import type { CliProcessPool } from '../../infrastructure/cli-adapter/process-pool.js';
import type { CliOutputParser } from '../../infrastructure/cli-adapter/output-parser.js';
import type { PromptLoader } from '../../infrastructure/prompt/prompt-loader.js';
import type { AutomationConfig } from '../../core/types/config.types.js';
import type { Logger } from 'pino';
import { WORKER_PHASE_PERMISSIONS, ROLE_PERMISSIONS } from '../../core/constants/permissions.js';
import { PHASE_AGENT_MAP } from '../../core/constants/phases.js';

const MESSENGER_SYSTEM_PROMPT = `你是一个专业的内容处理助手。你的职责是将输入内容进行汇总、摘要或结构化转换。
规则：
1. 严格按照要求的格式输出
2. 保留关键信息，去除冗余
3. 不要添加主观评价或额外建议
4. 输出必须是程序可解析的格式`;

@injectable()
export class ClaudeCliMessenger implements IMessenger {
  constructor(
    @inject(PROCESS_POOL_TOKEN) private processPool: CliProcessPool,
    @inject(OUTPUT_PARSER_TOKEN) private outputParser: CliOutputParser,
    @inject(PROMPT_LOADER_TOKEN) private promptLoader: PromptLoader,
    @inject(CONFIG_TOKEN) private config: AutomationConfig,
    @inject(LOGGER_TOKEN) private logger: Logger,
  ) {}

  formatForWorker(phase: Phase, context: PipelineContext): WorkerCommand {
    const mapping = PHASE_AGENT_MAP[phase];
    const systemPrompt = [
      this.promptLoader.load(mapping.agentFile),
      this.promptLoader.load('agents/_shared.md'),
      this.promptLoader.load(mapping.commandFile),
      this.promptLoader.loadKnowledge(phase),
      '当前为自动化模式，不要等待用户确认，直接执行。不要输出"建议下一步"。',
    ].join('\n\n---\n\n');

    const input = this.buildUserPrompt(phase, context);
    const permissions = WORKER_PHASE_PERMISSIONS[phase];

    return {
      command: `#${phase}`,
      input,
      systemPrompt,
      sessionId: context.workerSessionId,
      resume: context.completedPhases.length > 0,
      maxTurns: this.config.worker.defaultMaxTurns,
      disallowedTools: permissions.disallowed,
      cwd: this.config.cli.projectDir,
      timeout: this.config.worker.defaultTimeout,
    };
  }

  formatForEvaluator(workerOutput: WorkerResult, context: PipelineContext): EvaluationInput {
    return {
      projectSummary: this.extractProjectSummary(context),
      phaseSummary: this.extractPhaseSummary(context),
      artifact: workerOutput.artifact || workerOutput.output,
      evaluationCriteria: this.promptLoader.loadEvaluationCriteria(context.currentPhase),
      pipelineId: context.pipelineId,
      phase: context.currentPhase,
      projectDir: this.config.cli.projectDir,
    };
  }

  async summarize(content: string, format: SummaryFormat): Promise<string> {
    // 快速路径：内容短于阈值，不调用 LLM
    if (content.length < this.config.messenger.summarizeThreshold) {
      return content;
    }

    try {
      const result = await this.processPool.execute({
        prompt: `请将以下内容汇总为${format.style}格式，保留关键信息，去除冗余细节：\n\n${content}\n\n输出格式要求：${format.template}`,
        systemPrompt: MESSENGER_SYSTEM_PROMPT,
        disallowedTools: ROLE_PERMISSIONS.messenger.disallowed,
        maxTurns: this.config.messenger.maxTurns,
        outputFormat: 'json',
        cwd: this.config.cli.projectDir,
      });

      const parsed = this.outputParser.extractJson<{ summary: string }>(result);
      return parsed.summary;
    } catch (err) {
      this.logger.warn({ err }, 'Messenger summarize failed, falling back to raw');
      return this.config.messenger.fallbackToRaw ? content : '';
    }
  }

  async structurize(rawOutput: string, schema: OutputSchema): Promise<StructuredData> {
    const result = await this.processPool.execute({
      prompt: `请将以下内容转换为指定的 JSON 格式。\n\n原始内容：\n${rawOutput}\n\n目标 JSON Schema：\n${JSON.stringify(schema)}\n\n请严格按照 Schema 输出 JSON，不要包含额外文字。`,
      systemPrompt: MESSENGER_SYSTEM_PROMPT,
      disallowedTools: ROLE_PERMISSIONS.messenger.disallowed,
      maxTurns: this.config.messenger.maxTurns,
      outputFormat: 'json',
      cwd: this.config.cli.projectDir,
    });

    return this.outputParser.extractJson<StructuredData>(result);
  }

  async synthesizeFeedback(evaluations: EvaluationResult[], context: PipelineContext): Promise<string> {
    const rawFeedback = evaluations
      .map((e) => `[${e.dimension}评估 - ${e.verdict}]\n${e.issues.map((i) => `- [${i.severity}] ${i.category}: ${i.description}${i.suggestion ? ` → ${i.suggestion}` : ''}`).join('\n')}`)
      .join('\n\n');

    // 如果反馈内容短，直接返回
    if (rawFeedback.length < this.config.messenger.summarizeThreshold) {
      return rawFeedback;
    }

    try {
      const result = await this.processPool.execute({
        prompt: `请将以下多个评估者的反馈整合为一份统一的修改建议。\n1. 合并重复问题\n2. 按严重程度排序\n3. 为每个问题给出明确的修改指导\n\n评估反馈：\n${rawFeedback}`,
        systemPrompt: MESSENGER_SYSTEM_PROMPT,
        disallowedTools: ROLE_PERMISSIONS.messenger.disallowed,
        maxTurns: this.config.messenger.maxTurns,
        outputFormat: 'json',
        cwd: this.config.cli.projectDir,
      });

      const parsed = this.outputParser.extractJson<{ feedback: string }>(result);
      return parsed.feedback;
    } catch {
      return rawFeedback; // 降级为原始反馈
    }
  }

  updateContext(decision: ConductorDecision, context: PipelineContext): PipelineContext {
    if (decision.action === 'approve') {
      const phases: Phase[] = ['analyze', 'design', 'implement', 'review', 'test'];
      const currentIdx = phases.indexOf(context.currentPhase);
      const nextPhase = phases[currentIdx + 1];
      return {
        ...context,
        completedPhases: [...context.completedPhases, context.currentPhase],
        currentPhase: nextPhase ?? context.currentPhase,
      };
    }
    return {
      ...context,
      revisionFeedback: decision.feedback,
      phaseAttempts: {
        ...context.phaseAttempts,
        [context.currentPhase]: (context.phaseAttempts[context.currentPhase] ?? 0) + 1,
      },
    };
  }

  // ---- 私有辅助方法 ----

  private buildUserPrompt(phase: Phase, context: PipelineContext): string {
    const parts: string[] = [`#${phase} ${context.requirement.description}`];
    if (context.revisionFeedback?.length) {
      parts.push(`\n\n## 修改要求\n${context.revisionFeedback.join('\n')}`);
    }
    return parts.join('');
  }

  private extractProjectSummary(context: PipelineContext): string {
    return `项目: ${context.requirement.title}\n需求: ${context.requirement.description}`;
  }

  private extractPhaseSummary(context: PipelineContext): string {
    return `阶段: ${context.currentPhase}, 尝试次数: ${context.phaseAttempts[context.currentPhase] ?? 0}`;
  }
}
```

---

## 9. 状态机引擎

自研轻量实现，不引入 XState。

```typescript
// src/application/state-machine/states.ts
export enum PipelineStateName {
  Idle = 'idle',
  Triggered = 'triggered',
  Analyzing = 'analyzing',
  AnalyzeEvaluating = 'analyze_evaluating',
  AnalyzeDecision = 'analyze_decision',
  Designing = 'designing',
  DesignEvaluating = 'design_evaluating',
  DesignDecision = 'design_decision',
  Implementing = 'implementing',
  ImplementEvaluating = 'implement_evaluating',
  ImplementDecision = 'implement_decision',
  Reviewing = 'reviewing',
  ReviewEvaluating = 'review_evaluating',
  ReviewDecision = 'review_decision',
  Testing = 'testing',
  TestEvaluating = 'test_evaluating',
  TestDecision = 'test_decision',
  HumanIntervention = 'human_intervention',
  Completed = 'completed',
  Failed = 'failed',
}
```

```typescript
// src/application/state-machine/transitions.ts
import { PipelineStateName as S } from './states.js';

export interface Transition {
  from: S;
  event: string;
  to: S;
}

/**
 * 全量转移规则表。
 * 添加新状态/事件时，在此注册即可。
 */
export const TRANSITIONS: Transition[] = [
  { from: S.Idle,               event: 'new_requirement',       to: S.Triggered },
  { from: S.Triggered,          event: 'start_analyze',         to: S.Analyzing },

  { from: S.Analyzing,          event: 'phase_complete',        to: S.AnalyzeEvaluating },
  { from: S.AnalyzeEvaluating,  event: 'evaluations_complete',  to: S.AnalyzeDecision },
  { from: S.AnalyzeDecision,    event: 'revise',                to: S.Analyzing },
  { from: S.AnalyzeDecision,    event: 'approve',               to: S.Designing },

  { from: S.Designing,          event: 'phase_complete',        to: S.DesignEvaluating },
  { from: S.DesignEvaluating,   event: 'evaluations_complete',  to: S.DesignDecision },
  { from: S.DesignDecision,     event: 'revise',                to: S.Designing },
  { from: S.DesignDecision,     event: 'approve',               to: S.Implementing },

  { from: S.Implementing,       event: 'phase_complete',        to: S.ImplementEvaluating },
  { from: S.ImplementEvaluating, event: 'evaluations_complete', to: S.ImplementDecision },
  { from: S.ImplementDecision,  event: 'revise',                to: S.Implementing },
  { from: S.ImplementDecision,  event: 'approve',               to: S.Reviewing },

  { from: S.Reviewing,          event: 'phase_complete',        to: S.ReviewEvaluating },
  { from: S.ReviewEvaluating,   event: 'evaluations_complete',  to: S.ReviewDecision },
  { from: S.ReviewDecision,     event: 'revise',                to: S.Reviewing },
  { from: S.ReviewDecision,     event: 'approve',               to: S.Testing },

  { from: S.Testing,            event: 'phase_complete',        to: S.TestEvaluating },
  { from: S.TestEvaluating,     event: 'evaluations_complete',  to: S.TestDecision },
  { from: S.TestDecision,       event: 'revise',                to: S.Testing },
  { from: S.TestDecision,       event: 'approve',               to: S.Completed },

  // 人工介入（任意 working 状态均可触发）
  { from: S.Analyzing,          event: 'needs_human',           to: S.HumanIntervention },
  { from: S.Designing,          event: 'needs_human',           to: S.HumanIntervention },
  { from: S.Implementing,       event: 'needs_human',           to: S.HumanIntervention },

  { from: S.Completed,          event: 'reset',                 to: S.Idle },
];
```

```typescript
// src/application/state-machine/state-machine.ts
import { inject, injectable } from 'tsyringe';
import { PipelineStateName } from './states.js';
import { TRANSITIONS, type Transition } from './transitions.js';
import { LOGGER_TOKEN, EVENT_BUS_TOKEN } from '../../tokens.js';
import type { Logger } from 'pino';
import type { IEventBus } from '../../core/interfaces/event-bus.interface.js';

@injectable()
export class StateMachine {
  private current: PipelineStateName = PipelineStateName.Idle;
  private transitionMap: Map<string, Transition>;

  constructor(
    @inject(LOGGER_TOKEN) private logger: Logger,
    @inject(EVENT_BUS_TOKEN) private eventBus: IEventBus,
  ) {
    this.transitionMap = new Map(
      TRANSITIONS.map((t) => [`${t.from}::${t.event}`, t]),
    );
  }

  getState(): PipelineStateName {
    return this.current;
  }

  setState(state: PipelineStateName): void {
    this.current = state;
  }

  /**
   * 触发状态转移。
   * @throws Error 如不存在合法转移
   */
  transition(event: string): PipelineStateName {
    const key = `${this.current}::${event}`;
    const t = this.transitionMap.get(key);
    if (!t) {
      throw new Error(`No transition from "${this.current}" on event "${event}"`);
    }

    const from = this.current;
    this.current = t.to;

    this.logger.info({ from, event, to: this.current }, 'State transition');
    this.eventBus.emit({
      timestamp: new Date().toISOString(),
      pipelineId: '',
      eventType: 'phase:started',
      data: { from, event, to: this.current },
    });

    return this.current;
  }
}
```

---

## 10. Pipeline 编排层

### 10.1 PipelineService

```typescript
// src/application/pipeline/pipeline.service.ts
import { inject, injectable } from 'tsyringe';
import type { IWorker } from '../../core/interfaces/worker.interface.js';
import type { IEvaluator } from '../../core/interfaces/evaluator.interface.js';
import type { IConductor } from '../../core/interfaces/conductor.interface.js';
import type { IMessenger } from '../../core/interfaces/messenger.interface.js';
import type { IStateStore } from '../../core/interfaces/state-store.interface.js';
import type { IArtifactStore } from '../../core/interfaces/artifact-store.interface.js';
import type { IEventBus } from '../../core/interfaces/event-bus.interface.js';
import type { AutomationConfig } from '../../core/types/config.types.js';
import type { Requirement } from '../../core/types/requirement.types.js';
import type { InteractionMode, Phase } from '../../core/types/phase.types.js';
import type { PipelineContext, PipelineResult } from '../../core/types/pipeline.types.js';
import type { CostTracker } from '../../infrastructure/observability/cost-tracker.js';
import type { Logger } from 'pino';
import { StateMachine } from '../state-machine/state-machine.js';
import { PhaseExecutor } from './phase-executor.js';
import {
  WORKER_TOKEN, EVALUATOR_TOKEN, CONDUCTOR_TOKEN, MESSENGER_TOKEN,
  STATE_STORE_TOKEN, ARTIFACT_STORE_TOKEN, EVENT_BUS_TOKEN,
  CONFIG_TOKEN, LOGGER_TOKEN, COST_TRACKER_TOKEN,
} from '../../tokens.js';
import { PHASES } from '../../core/constants/phases.js';
import { BudgetExceededError } from '../../core/errors/pipeline.errors.js';

@injectable()
export class PipelineService {
  private phaseExecutor: PhaseExecutor;

  constructor(
    @inject(WORKER_TOKEN) private worker: IWorker,
    @inject(EVALUATOR_TOKEN) private evaluators: IEvaluator[],
    @inject(CONDUCTOR_TOKEN) private conductor: IConductor,
    @inject(MESSENGER_TOKEN) private messenger: IMessenger,
    @inject(STATE_STORE_TOKEN) private stateStore: IStateStore,
    @inject(ARTIFACT_STORE_TOKEN) private artifactStore: IArtifactStore,
    @inject(EVENT_BUS_TOKEN) private eventBus: IEventBus,
    @inject(CONFIG_TOKEN) private config: AutomationConfig,
    @inject(LOGGER_TOKEN) private logger: Logger,
    @inject(COST_TRACKER_TOKEN) private costTracker: CostTracker,
  ) {
    this.phaseExecutor = new PhaseExecutor(
      worker, evaluators, conductor, messenger,
      artifactStore, eventBus, config, logger, costTracker,
    );
  }

  /**
   * 执行完整 Pipeline:
   * analyze → design → implement → review → test
   */
  async run(requirement: Requirement, mode?: InteractionMode): Promise<PipelineResult> {
    const pipelineMode = mode ?? this.config.pipeline.mode;
    const context = this.createInitialContext(requirement, pipelineMode);
    const stateMachine = new StateMachine(this.logger, this.eventBus);

    this.eventBus.emit({
      timestamp: new Date().toISOString(),
      pipelineId: context.pipelineId,
      eventType: 'pipeline:started',
      data: { requirement: requirement.id, mode: pipelineMode },
    });

    stateMachine.transition('new_requirement');

    const phases = this.config.pipeline.phases;
    const phaseResults: Record<string, any> = {};

    for (const phase of phases) {
      // 预算检查
      if (this.costTracker.getTotalCost() >= this.config.pipeline.budgetLimit) {
        throw new BudgetExceededError(this.config.pipeline.budgetLimit);
      }

      const startEvent = phase === phases[0] ? `start_${phase}` : 'approve';
      stateMachine.transition(startEvent);

      const result = await this.phaseExecutor.execute(
        phase, context, stateMachine, pipelineMode,
      );
      phaseResults[phase] = result;

      await this.stateStore.save(this.toState(context, stateMachine));
    }

    this.eventBus.emit({
      timestamp: new Date().toISOString(),
      pipelineId: context.pipelineId,
      eventType: 'pipeline:completed',
      data: { changeId: context.changeId },
    });

    return {
      success: true,
      changeId: context.changeId,
      phases: phaseResults as any,
      totalCost: this.costTracker.getTotalCost(),
      totalDuration: 0, // 由调用方计算
    };
  }

  /** 从持久化状态恢复 Pipeline */
  async resume(pipelineId: string): Promise<PipelineResult> {
    const state = await this.stateStore.load(pipelineId);
    if (!state) throw new Error(`Pipeline ${pipelineId} not found`);
    // 从 state 恢复 context 和 stateMachine，继续执行
    // 实现略，遵循同样的 phase 循环逻辑
    throw new Error('Not implemented yet');
  }

  private createInitialContext(requirement: Requirement, mode: InteractionMode): PipelineContext {
    const now = new Date();
    const slug = requirement.title.toLowerCase().replace(/\s+/g, '-').slice(0, 30);
    const changeId = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}-${slug}`;

    return {
      pipelineId: crypto.randomUUID(),
      requirement,
      changeId,
      currentPhase: 'analyze',
      completedPhases: [],
      phaseAttempts: { analyze: 0, design: 0, implement: 0, review: 0, test: 0 },
      workerSessionId: `worker-${changeId}`,
      artifacts: {} as any,
      mode,
    };
  }

  private toState(context: PipelineContext, sm: StateMachine): any {
    // 将 PipelineContext + StateMachine 转为可持久化的 PipelineState
    return {
      id: context.pipelineId,
      requirementId: context.requirement.id,
      changeId: context.changeId,
      currentState: sm.getState(),
      currentPhase: context.currentPhase,
      phaseAttempts: context.phaseAttempts,
      context: { requirement: context.requirement, artifacts: context.artifacts, evaluations: {}, decisions: {} },
      sessions: { workerSessionId: context.workerSessionId, workerSessionPhase: context.currentPhase },
      metadata: {
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        status: 'running',
        mode: context.mode,
        totalTokensUsed: 0,
        totalCost: this.costTracker.getTotalCost(),
      },
    };
  }
}
```

### 10.2 PhaseExecutor

```typescript
// src/application/pipeline/phase-executor.ts
import type { IWorker } from '../../core/interfaces/worker.interface.js';
import type { IEvaluator } from '../../core/interfaces/evaluator.interface.js';
import type { IConductor } from '../../core/interfaces/conductor.interface.js';
import type { IMessenger } from '../../core/interfaces/messenger.interface.js';
import type { IArtifactStore } from '../../core/interfaces/artifact-store.interface.js';
import type { IEventBus } from '../../core/interfaces/event-bus.interface.js';
import type { AutomationConfig } from '../../core/types/config.types.js';
import type { Phase, InteractionMode } from '../../core/types/phase.types.js';
import type { PipelineContext } from '../../core/types/pipeline.types.js';
import type { PhaseResult } from '../../core/types/pipeline.types.js';
import type { StateMachine } from '../state-machine/state-machine.js';
import type { CostTracker } from '../../infrastructure/observability/cost-tracker.js';
import type { Logger } from 'pino';

/**
 * 执行单个阶段的完整循环：
 * Worker执行 → Messenger汇总 → Evaluator评估 → Conductor决策 → (approve | revise)
 */
export class PhaseExecutor {
  constructor(
    private worker: IWorker,
    private evaluators: IEvaluator[],
    private conductor: IConductor,
    private messenger: IMessenger,
    private artifactStore: IArtifactStore,
    private eventBus: IEventBus,
    private config: AutomationConfig,
    private logger: Logger,
    private costTracker: CostTracker,
  ) {}

  async execute(
    phase: Phase,
    context: PipelineContext,
    stateMachine: StateMachine,
    mode: InteractionMode,
  ): Promise<PhaseResult> {
    const startTime = Date.now();
    context.currentPhase = phase;
    let approved = false;
    let lastScore = 0;

    while (!approved) {
      // 1. Worker 执行
      const workerCommand = this.messenger.formatForWorker(phase, context);
      const workerResult = await this.worker.executeCommand(workerCommand);
      this.costTracker.add(workerResult.costUsd);

      stateMachine.transition('phase_complete');

      // 2. Messenger 汇总 + Evaluator 并行评估
      const evalInput = this.messenger.formatForEvaluator(workerResult, context);
      const evaluations = await Promise.all(
        this.evaluators.map((e) => e.evaluate(evalInput)),
      );

      stateMachine.transition('evaluations_complete');

      // 3. Messenger 整合反馈 + Conductor 决策
      await this.messenger.synthesizeFeedback(evaluations, context);
      const decision = await this.conductor.decide(evaluations);

      lastScore = evaluations.reduce((s, e) => s + e.score, 0) / evaluations.length;

      this.logger.info({ phase, action: decision.action, score: lastScore }, 'Phase decision');

      // 4. 处理决策
      if (decision.action === 'approve') {
        approved = true;
        const updated = this.messenger.updateContext(decision, context);
        Object.assign(context, updated);
        stateMachine.transition('approve');
      } else {
        const attempts = (context.phaseAttempts[phase] ?? 0) + 1;
        context.phaseAttempts[phase] = attempts;

        if (attempts >= this.config.conductor.maxAttemptsPerPhase) {
          this.logger.warn({ phase, attempts }, 'Max attempts reached');
          // 超限：根据模式处理
          if (mode === 'auto') {
            // 自动模式下仍然通过，避免死锁
            approved = true;
            this.logger.warn({ phase }, 'Auto-approving after max retries');
          }
          // semi-auto / manual: 等待人工介入（由调用方处理）
          break;
        }

        const updated = this.messenger.updateContext(decision, context);
        Object.assign(context, updated);
        stateMachine.transition('revise');
      }
    }

    return {
      attempts: context.phaseAttempts[phase] ?? 0,
      finalScore: lastScore,
      duration: Date.now() - startTime,
      tokenCost: 0, // 由 CostTracker 追踪
    };
  }
}
```

---

## 11. 持久化层

### 11.1 JsonStateStore

```typescript
// src/infrastructure/persistence/json-state-store.ts
import { inject, injectable } from 'tsyringe';
import { readFile, writeFile, readdir, unlink, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { IStateStore } from '../../core/interfaces/state-store.interface.js';
import type { PipelineState } from '../../core/types/pipeline.types.js';
import { CONFIG_TOKEN } from '../../tokens.js';
import type { AutomationConfig } from '../../core/types/config.types.js';

@injectable()
export class JsonStateStore implements IStateStore {
  private dir: string;

  constructor(@inject(CONFIG_TOKEN) config: AutomationConfig) {
    this.dir = config.persistence.stateDir;
  }

  async save(state: PipelineState): Promise<void> {
    await mkdir(this.dir, { recursive: true });
    const filePath = join(this.dir, `${state.id}.json`);
    await writeFile(filePath, JSON.stringify(state, null, 2), 'utf-8');
  }

  async load(pipelineId: string): Promise<PipelineState | null> {
    try {
      const filePath = join(this.dir, `${pipelineId}.json`);
      const raw = await readFile(filePath, 'utf-8');
      return JSON.parse(raw) as PipelineState;
    } catch {
      return null;
    }
  }

  async list(): Promise<PipelineState[]> {
    try {
      const files = await readdir(this.dir);
      const states = await Promise.all(
        files
          .filter((f) => f.endsWith('.json'))
          .map(async (f) => {
            const raw = await readFile(join(this.dir, f), 'utf-8');
            return JSON.parse(raw) as PipelineState;
          }),
      );
      return states;
    } catch {
      return [];
    }
  }

  async delete(pipelineId: string): Promise<void> {
    try {
      await unlink(join(this.dir, `${pipelineId}.json`));
    } catch { /* 文件不存在则忽略 */ }
  }
}
```

---

## 12. 配置层

### 12.1 Zod Schema

```typescript
// src/config/config.schema.ts
import { z } from 'zod';

const cliSchema = z.object({
  cliPath: z.string().default('claude'),
  projectDir: z.string(),
  maxConcurrentProcesses: z.number().int().min(1).max(10).default(3),
});

const workerSchema = z.object({
  defaultMaxTurns: z.number().int().min(1).default(25),
  defaultTimeout: z.number().int().min(10_000).default(600_000),
});

const evaluatorSchema = z.object({
  dimensions: z.array(z.enum(['quality', 'security', 'consistency'])).default(['quality']),
  maxTurns: z.number().int().default(3),
  parseRetries: z.number().int().default(2),
});

const messengerSchema = z.object({
  maxTurns: z.number().int().default(2),
  summarizeThreshold: z.number().int().default(5000),
  fallbackToRaw: z.boolean().default(true),
});

const conductorSchema = z.object({
  maxAttemptsPerPhase: z.number().int().min(1).default(3),
  autoApproveThreshold: z.number().min(0).max(100).default(80),
  escalateThreshold: z.number().int().default(2),
  maxTurns: z.number().int().default(1),
});

const githubTriggerSchema = z.object({
  owner: z.string(),
  repo: z.string(),
  labels: z.array(z.string()).default(['auto-dev']),
  pollInterval: z.number().int().min(10).default(60),
  token: z.string(),
});

const triggerSchema = z.object({
  type: z.enum(['github_issues', 'manual']).default('manual'),
  github: githubTriggerSchema.optional(),
});

const pipelineSchema = z.object({
  mode: z.enum(['auto', 'semi-auto', 'manual']).default('semi-auto'),
  phases: z.array(z.enum(['analyze', 'design', 'implement', 'review', 'test'])).default(['analyze', 'design', 'implement', 'review', 'test']),
  budgetLimit: z.number().min(0).default(50),
});

const persistenceSchema = z.object({
  stateDir: z.string().default('.pipeline/state'),
  logDir: z.string().default('.pipeline/logs'),
});

export const automationConfigSchema = z.object({
  cli: cliSchema,
  worker: workerSchema.default({}),
  evaluator: evaluatorSchema.default({}),
  messenger: messengerSchema.default({}),
  conductor: conductorSchema.default({}),
  trigger: triggerSchema.default({}),
  pipeline: pipelineSchema.default({}),
  persistence: persistenceSchema.default({}),
});

export type AutomationConfigInput = z.input<typeof automationConfigSchema>;
```

### 12.2 Config Loader

```typescript
// src/config/config.loader.ts
import { config as dotenvConfig } from 'dotenv';
import { readFileSync, existsSync } from 'node:fs';
import { automationConfigSchema } from './config.schema.js';
import type { AutomationConfig } from '../core/types/config.types.js';

/**
 * 加载配置：.env → config.json → zod 校验 → 返回类型安全的配置对象。
 * 校验失败直接抛出，fail fast。
 */
export function loadConfig(configPath?: string): AutomationConfig {
  dotenvConfig();

  const filePath = configPath ?? 'automation.config.json';
  let fileConfig = {};

  if (existsSync(filePath)) {
    const raw = readFileSync(filePath, 'utf-8');
    fileConfig = JSON.parse(raw);
  }

  // 合并环境变量
  const merged = {
    ...fileConfig,
    cli: {
      ...(fileConfig as any).cli,
      cliPath: process.env.CLAUDE_CLI_PATH ?? (fileConfig as any).cli?.cliPath,
      projectDir: process.env.PROJECT_DIR ?? (fileConfig as any).cli?.projectDir,
    },
    trigger: {
      ...(fileConfig as any).trigger,
      github: {
        ...(fileConfig as any).trigger?.github,
        token: process.env.GITHUB_TOKEN ?? (fileConfig as any).trigger?.github?.token,
      },
    },
  };

  const result = automationConfigSchema.safeParse(merged);
  if (!result.success) {
    const formatted = result.error.format();
    throw new Error(`Configuration validation failed:\n${JSON.stringify(formatted, null, 2)}`);
  }

  return result.data as AutomationConfig;
}
```

---

## 13. 可观测性层

### 13.1 Pino Logger

```typescript
// src/infrastructure/observability/pino-logger.ts
import pino from 'pino';
import type { AutomationConfig } from '../../core/types/config.types.js';

export function createLogger(config: AutomationConfig): pino.Logger {
  return pino({
    level: process.env.LOG_LEVEL ?? 'info',
    transport: process.env.NODE_ENV !== 'production'
      ? { target: 'pino-pretty', options: { colorize: true } }
      : undefined,
  });
}
```

### 13.2 Emittery EventBus

```typescript
// src/infrastructure/observability/emittery-event-bus.ts
import { injectable } from 'tsyringe';
import Emittery from 'emittery';
import type { IEventBus } from '../../core/interfaces/event-bus.interface.js';
import type { PipelineEvent, PipelineEventType } from '../../core/types/events.types.js';

@injectable()
export class EmitteryEventBus implements IEventBus {
  private emitter = new Emittery<Record<PipelineEventType, PipelineEvent>>();

  emit(event: PipelineEvent): void {
    // fire-and-forget，不阻塞主流程
    void this.emitter.emit(event.eventType, event);
  }

  on(eventType: PipelineEventType, handler: (event: PipelineEvent) => void): void {
    this.emitter.on(eventType, handler);
  }

  off(eventType: PipelineEventType, handler: (event: PipelineEvent) => void): void {
    this.emitter.off(eventType, handler);
  }
}
```

### 13.3 CostTracker

```typescript
// src/infrastructure/observability/cost-tracker.ts
import { inject, injectable } from 'tsyringe';
import { LOGGER_TOKEN, EVENT_BUS_TOKEN } from '../../tokens.js';
import type { Logger } from 'pino';
import type { IEventBus } from '../../core/interfaces/event-bus.interface.js';

@injectable()
export class CostTracker {
  private totalCost = 0;

  constructor(
    @inject(LOGGER_TOKEN) private logger: Logger,
    @inject(EVENT_BUS_TOKEN) private eventBus: IEventBus,
  ) {}

  add(costUsd: number): void {
    this.totalCost += costUsd;
    this.logger.debug({ costUsd, totalCost: this.totalCost }, 'Cost tracked');
  }

  getTotalCost(): number {
    return this.totalCost;
  }

  reset(): void {
    this.totalCost = 0;
  }
}
```

---

## 14. CLI 入口层

```typescript
// src/main.ts
import 'reflect-metadata';
import { Command } from 'commander';
import { bootstrap } from './composition-root.js';
import type { InteractionMode } from './core/types/phase.types.js';

const program = new Command();

program
  .name('vtt')
  .description('My Virtual Tech Team - 自动化软件开发管道')
  .version('0.1.0');

program
  .command('run')
  .description('手动触发一个需求进入开发流水线')
  .requiredOption('-t, --title <title>', '需求标题')
  .requiredOption('-d, --description <desc>', '需求描述')
  .option('-m, --mode <mode>', '交互模式: auto | semi-auto | manual', 'semi-auto')
  .action(async (opts) => {
    const pipeline = bootstrap();
    const result = await pipeline.run(
      {
        id: `manual-${Date.now()}`,
        title: opts.title,
        description: opts.description,
        source: 'manual',
        metadata: {},
        createdAt: new Date().toISOString(),
      },
      opts.mode as InteractionMode,
    );
    console.log(`Pipeline completed: ${result.changeId}, cost: $${result.totalCost.toFixed(2)}`);
  });

program
  .command('resume')
  .description('恢复一个中断的 Pipeline')
  .requiredOption('-i, --id <pipelineId>', 'Pipeline ID')
  .action(async (opts) => {
    const pipeline = bootstrap();
    const result = await pipeline.resume(opts.id);
    console.log(`Pipeline resumed: ${result.changeId}`);
  });

program
  .command('status')
  .description('查看所有 Pipeline 状态')
  .action(async () => {
    // 从 StateStore 加载并展示
    console.log('Not implemented yet');
  });

program.parse();
```

---

## 15. 错误处理策略

### 15.1 错误基类

```typescript
// src/core/errors/base.error.ts
export class AppError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly recoverable: boolean = false,
  ) {
    super(message);
    this.name = this.constructor.name;
  }
}
```

### 15.2 分类错误

```typescript
// src/core/errors/cli.errors.ts
import { AppError } from './base.error.js';

export class CliExecutionError extends AppError {
  constructor(detail: string) {
    super(`CLI execution failed: ${detail}`, 'CLI_EXEC_ERROR', true);
  }
}

export class CliTimeoutError extends AppError {
  constructor(timeout: number) {
    super(`CLI timed out after ${timeout}ms`, 'CLI_TIMEOUT', true);
  }
}

export class CliParseError extends AppError {
  constructor(detail: string) {
    super(`CLI output parse failed: ${detail}`, 'CLI_PARSE_ERROR', true);
  }
}
```

```typescript
// src/core/errors/pipeline.errors.ts
import { AppError } from './base.error.js';

export class BudgetExceededError extends AppError {
  constructor(limit: number) {
    super(`Budget exceeded: limit $${limit}`, 'BUDGET_EXCEEDED', false);
  }
}

export class PhaseError extends AppError {
  constructor(phase: string, detail: string) {
    super(`Phase "${phase}" failed: ${detail}`, 'PHASE_ERROR', true);
  }
}
```

### 15.3 恢复策略

| 错误类型 | recoverable | 处理 |
|---------|------------|------|
| `CliExecutionError` | ✅ | 自动重试（最多 2 次） |
| `CliTimeoutError` | ✅ | 增加 timeout 后重试 |
| `CliParseError` | ✅ | 用 fallback 解析策略，不行则重试 |
| `BudgetExceededError` | ❌ | Pipeline 立即终止，通知用户 |
| `PhaseError` | ✅ | 进入 Conductor 决策，可能触发人工介入 |

---

## 16. 开发顺序与交付检查清单

### Phase A: 工程底座（MVP 主线）

| # | 任务 | 产出文件 | 验收标准 |
|---|------|---------|---------|
| A1 | 项目初始化 | `package.json`, `tsconfig.json`, `vitest.config.ts` | `pnpm build` + `pnpm test` 通过 |
| A2 | Core 类型全量定义 | `src/core/types/*.ts` | 编译通过，所有类型无 `any` |
| A3 | Core 接口全量定义 | `src/core/interfaces/*.ts` | 编译通过，接口签名与本文档一致 |
| A4 | Core 常量与错误 | `src/core/constants/*.ts`, `src/core/errors/*.ts` | 编译通过 |
| A5 | DI Token + Composition Root | `src/tokens.ts`, `src/composition-root.ts` | `bootstrap()` 不抛异常 |
| A6 | Config 层 (zod) | `src/config/*.ts` | 缺少必填字段时抛明确错误 |
| A7 | CLI Adapter | `src/infrastructure/cli-adapter/*.ts` | 单元测试覆盖 buildArgs、多策略解析 |
| A8 | State Store | `src/infrastructure/persistence/*.ts` | save/load/list/delete 测试通过 |
| A9 | Logger + EventBus | `src/infrastructure/observability/*.ts` | 事件发布与订阅、日志输出正常 |
| A10 | PromptLoader | `src/infrastructure/prompt/prompt-loader.ts` | 可加载 `.ai-agents/agents/*.md` |
| A11 | Messenger 实现 | `src/roles/messenger/claude-cli.messenger.ts` | `formatForWorker` 输出正确 prompt 结构 |
| A12 | Worker 实现 | `src/roles/worker/claude-cli.worker.ts` | 真实 CLI 调用通过（集成测试） |
| A13 | StateMachine | `src/application/state-machine/*.ts` | 所有转移规则测试覆盖 |
| A14 | Pipeline + PhaseExecutor | `src/application/pipeline/*.ts` | 手动触发完整 5 阶段无评估环 |
| A15 | CLI 入口 | `src/main.ts` | `pnpm start run -t "test" -d "desc"` 可执行 |

### Phase B: 评估反馈环

| # | 任务 | 产出文件 | 验收标准 |
|---|------|---------|---------|
| B1 | Evaluator 基类 + Quality | `src/roles/evaluator/*.ts` | CLI 只读调用 + JSON 解析通过 |
| B2 | Security + Consistency Evaluator | `src/roles/evaluator/*.ts` | 三维度并行评估 |
| B3 | Conductor | `src/roles/conductor/*.ts` | 规则命中 + LLM 兜底 |
| B4 | Messenger LLM 能力 | `summarize`, `structurize`, `synthesizeFeedback` | 汇总/结构化输出正确 |
| B5 | PhaseExecutor 反馈环 | revise 循环逻辑 | 不合格 → 重试 → 超限暂停 |
| B6 | CostTracker + Budget | `cost-tracker.ts` | 超预算 Pipeline 终止 |
| B7 | Crash Recovery | `resume` command | 中断后恢复到最后状态 |

---

> **文档结束**  
> 开发者应按照 Phase A → Phase B 的顺序逐项交付，每项完成后对照验收标准自检。
