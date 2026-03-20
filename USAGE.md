# Capibara 使用手册 V2

> **版本**: 0.2.0
> **更新日期**: 2026-03-20

---

## 1. 项目概述

Capibara（CLI 前缀 `cpbr`）是一个**自动化 Agent 工作流引擎**，将 AI 辅助开发流程（analyze → design → implement → review → test）升级为自动化软件开发管道。

**V2 新增**：多项目管理、需求池、自动消费编排器。

### 核心架构

```
需求池 → 编排器(自动消费) → 管道(DAG) → [Worker → Evaluator → Conductor] × N阶段 → 完成
```

五个协作角色：**Worker**（执行任务）、**Evaluator**（多维评估）、**Conductor**（决策）、**Messenger**（上下文传递）、**Trigger**（外部触发）。

### 交互模式

| 模式 | 说明 |
|------|------|
| `auto` | 全自动，达到最大重试后强制通过 |
| `semi-auto` | 默认，升级时需人工审批 |
| `manual` | 每阶段需人工确认 |

---

## 2. 环境准备

```bash
# 系统要求：Node.js >= 22, pnpm, Claude Code CLI (claude 命令可用)

# 安装依赖（含 better-sqlite3 原生模块）
pnpm install

# 复制环境变量
cp .env.example .env
```

| 环境变量 | 默认值 | 说明 |
|----------|--------|------|
| `CLAUDE_CLI_PATH` | `claude` | Claude CLI 路径 |
| `PROJECT_DIR` | `.` | 工作目录 |
| `LOG_LEVEL` | `info` | 日志级别 |
| `GITHUB_TOKEN` | — | GitHub Token（可选） |

---

## 3. 配置

基础配置通过 `automation.config.json` 管理（zod 校验，所有字段有默认值）。

项目级配置存储在 SQLite 数据库中，运行时与基础配置合并。合并优先级：

```
zod 默认值 ← automation.config.json ← 项目 SQLite config
```

配置结构详见 V1 文档，此处不再重复。

---

## 4. 数据存储

- **SQLite 数据库**：`~/.capibara/capibara.db`（自动创建）
  - `projects` 表：多项目注册信息
  - `requirements` 表：需求池
- **管道状态**：`.pipeline/state/`（JSON 文件）
- **日志**：`.pipeline/logs/`

---

## 5. CLI 命令

构建后通过 `node dist/main.js` 运行，开发时用 `pnpm dev`。

### 5.1 项目管理

```bash
# 添加项目（首个项目自动激活）
cpbr project add -n "my-app" --dir /path/to/project

# 列出所有项目
cpbr project list

# 切换活跃项目（支持 ID 前缀或项目名）
cpbr project switch <id或名称>

# 删除项目（级联删除其需求）
cpbr project remove <id或名称>
```

### 5.2 需求池管理

需求操作作用于当前**活跃项目**。

```bash
# 添加需求
cpbr pool add -t "用户登录功能" -d "实现邮箱密码登录" -p 10

# 列出需求（可按状态过滤）
cpbr pool list
cpbr pool list -s pending

# 更新需求
cpbr pool update <id> -s completed
cpbr pool update <id> -t "新标题" -p 5

# 删除需求
cpbr pool remove <id>
```

需求状态：`pending` → `in-progress` → `completed` / `failed`

### 5.3 启动编排器（自动消费）

```bash
# 启动：自动消费活跃项目的 pending 需求，空闲时进入待机轮询
cpbr start

# 自定义轮询间隔（毫秒）
cpbr start --poll-interval 30000

# 指定配置文件
cpbr start -c path/to/config.json
```

编排器状态机：`idle → consuming → running → standby`

- 按优先级降序、创建时间升序取出 pending 需求
- 执行完成后自动标记为 `completed` 或 `failed`
- 无 pending 需求时进入 standby，定期轮询
- 支持 `Ctrl+C` 优雅关闭（等待当前管道完成）

### 5.4 手动触发（Legacy）

```bash
# 单次执行，不经过需求池
cpbr run -t "需求标题" -d "需求描述" -m auto
```

### 5.5 管道状态与恢复

```bash
# 查看所有管道状态
cpbr status

# 恢复中断的管道
cpbr resume -i <pipelineId>
```

---

## 6. 典型工作流

```bash
# 1. 注册项目
cpbr project add -n "my-api" --dir /home/user/projects/my-api

# 2. 添加需求
cpbr pool add -t "用户认证模块" -d "实现 JWT 登录注册" -p 10
cpbr pool add -t "数据导出功能" -d "支持 CSV/Excel 导出" -p 5

# 3. 启动编排器（自动按优先级消费）
cpbr start

# 4. 查看进度
cpbr pool list
cpbr status
```

---

## 7. 调试

### VS Code 调试

按 `F5`，选择 **"Debug CLI (tsx)"**。默认参数可在 `.vscode/launch.json` 的 `args` 中修改。

### 日志调试

```bash
LOG_LEVEL=debug cpbr start
LOG_LEVEL=trace cpbr run -t "测试" -d "测试"
```

---

## 8. 构建与测试

```bash
pnpm build          # 编译 TypeScript
pnpm test           # 运行测试
pnpm test:watch     # 监视模式
pnpm format         # 格式化代码
pnpm lint           # 类型检查
```

---

## 9. 常见问题

| 问题 | 解决方案 |
|------|----------|
| `spawn claude ENOENT` | 确认 Claude CLI 已安装，或设置 `CLAUDE_CLI_PATH` |
| `No active project` | 先 `cpbr project add` 再 `cpbr project switch` |
| 管道中断 | `cpbr status` 查看 ID，`cpbr resume -i <id>` 恢复 |
| `BudgetExceededError` | 提高 `pipeline.budgetLimit` 或减少评估维度 |
| SQLite 锁定 | 确保没有多个 `cpbr start` 实例同时运行 |
