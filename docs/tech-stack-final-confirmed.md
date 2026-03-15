# My Virtual Tech Team — 确认版技术栈文档

> 版本: v1.0  
> 日期: 2026-03-15  
> 状态: 已确认（Confirmed）

---

## 1. 决策结论

本项目初期（CLI MVP 阶段）采用“轻量工程化 + 可演进架构”路线，最终确认如下：

1. 采用 TypeScript 作为核心语言。
2. 采用 CLI 作为第一阶段交互形态，后续演进到 Electron 可视化 UI。
3. 采用轻量依赖注入方案，并明确选择 tsyringe。
4. 不在 MVP 阶段引入重型应用框架（如 NestJS 全家桶）。

---

## 2. 最终技术栈（Confirmed Stack）

### 2.1 运行时与语言

1. Node.js: 22 LTS（推荐）
2. TypeScript: 5.x（strict 模式）
3. 模块系统: ESM
4. 包管理: pnpm

### 2.2 CLI 与交互入口

1. commander（CLI 命令解析与入口组织）

### 2.3 依赖注入与模块装配

1. tsyringe（已确认）
2. reflect-metadata（tsyringe 装饰器能力支持）
3. Composition Root（统一依赖装配入口）

### 2.4 配置与数据校验

1. zod（配置、外部输入、结构化输出校验）
2. dotenv（环境变量加载）

### 2.5 日志与事件

1. pino（结构化日志）
2. emittery（事件总线）

### 2.6 测试

1. vitest（单元 + 集成测试）

### 2.7 流程编排

1. 自研轻量状态机（MVP 阶段）
2. 复杂度提升后再评估 XState（暂不引入）

---

## 3. 选型冻结清单

以下内容在 MVP 阶段冻结，不做频繁变更：

1. DI 框架: tsyringe
2. CLI 框架: commander
3. 校验方案: zod
4. 日志方案: pino
5. 测试框架: vitest

冻结原则：

1. 若非阻断性问题，不在 MVP 期间替换核心基础设施。
2. 变更必须通过 ADR 文档记录原因、影响、回滚策略。

---

## 4. 架构约束（执行标准）

1. 依赖注入仅发生在应用装配层，领域层不依赖容器 API。
2. 业务层禁止直接 new 基础设施实现，统一通过接口注入。
3. 每个 Role 保持接口稳定：IWorker、IEvaluator、IConductor、IMessenger、ITrigger。
4. CLI 仅作为入口层，不承载核心业务流程。
5. Electron 阶段复用 domain 与 application 层，不重写主流程。

---

## 5. tsyringe 使用规范（项目约定）

1. 容器注册集中在 composition-root 模块。
2. 依赖标识优先使用 Token，避免字符串散落。
3. 默认使用 singleton 生命周期，必要时显式 transient。
4. 避免在深层业务代码中直接调用全局容器。
5. 单元测试中优先注入 mock 实现，不依赖真实容器。

---

## 7. 里程碑实施顺序

### Phase A: 工程底座（优先）

1. 初始化 TypeScript strict + pnpm + vitest + eslint。
2. 建立分层目录与核心接口。
3. 落地 tsyringe + composition-root。
4. 打通 analyze -> design -> implement 主流程（手动触发）。

### Phase B: 评估反馈环

1. 接入 evaluator 并行评估。
2. 接入 conductor 规则决策。
3. 补齐日志、状态持久化、重试机制。

### Phase C: 自动触发与产品化

1. 接入 GitHub Issues Trigger。
2. 完成 auto/semi/manual 三种模式。
3. 预留 Electron 壳层对接接口。

---

## 8. 风险与对策（确认版）

1. 风险: tsyringe 使用分散导致容器污染。  
   对策: 强制 composition-root 集中注册。
2. 风险: CLI 入口与业务逻辑耦合。  
   对策: 入口层仅做参数解析与调用应用服务。
3. 风险: 配置漂移导致运行异常。  
   对策: zod 启动时强校验，未通过直接 fail fast。
4. 风险: 过早引入重框架影响交付节奏。  
   对策: MVP 阶段保持轻量栈冻结。

---

## 9. 最终确认

本次确认后，项目技术基线为：

1. TypeScript + Node.js + pnpm
2. commander（CLI）
3. tsyringe（DI，已确认）
4. zod + dotenv（配置与输入校验）
5. pino + emittery（可观测性与事件）
6. vitest（测试）
7. 自研状态机（MVP）

该基线用于后续开发、评审与架构变更管理。
