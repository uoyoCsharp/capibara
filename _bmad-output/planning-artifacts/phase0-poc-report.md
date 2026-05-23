# ACP Phase 0 PoC 验证报告

> **日期**: 2026-05-23
> **版本**: v1.0
> **状态**: ✅ 通过 — 可进入 Phase 1

---

## 1. 执行摘要

Phase 0 PoC 验证了 ACP (Agent Client Protocol) 的所有核心能力，确认 Capibara 执行引擎从 CLI-based 迁移到 ACP-based 的架构可行。

**最终结果: 10 通过 / 0 失败 / 2 跳过**

| 测试项 | 状态 | 说明 |
|--------|------|------|
| T1-initialize | ✅ | Protocol v1 连接成功 |
| T1-capabilities | ✅ | 完整能力矩阵获取 |
| T2-session-new | ✅ | 会话创建成功 |
| T3-prompt | ✅ | `stopReason=end_turn` 正确返回 |
| T3-updates | ✅ | 10 个 `session/update` 通知正确接收 |
| T3-text-streaming | ✅ | 6 个文本 chunk 流式传输 |
| T6-fs-read | ⏭️ | Agent 使用内置 Read File 而非 ACP fs 通道 |
| T7-permission | ⏭️ | `skipPermissions` 模式下无权限请求 |
| T6-tool-calls | ✅ | 工具调用更新正确观测到 |
| T4-close | ✅ | `session/close` 成功 |
| T5-resume | ✅ | `session/resume` 成功 |
| T5-context-retained | ✅ | 恢复后上下文保留 |

---

## 2. 环境配置

| 组件 | 版本 | 路径 |
|------|------|------|
| Node.js | 22.14.0 | `C:\nvm4w\nodejs` |
| claude-code CLI | **2.1.150** | `C:\nvm4w\nodejs\node_modules\@anthropic-ai\claude-code\bin\claude.exe` |
| claude-agent-acp | 0.37.0 | `C:\nvm4w\nodejs\node_modules\@agentclientprotocol\claude-agent-acp` |
| claude-agent-sdk | 0.3.146 | (claude-agent-acp 依赖) |
| @agentclientprotocol/sdk | 0.22.1 | workspace devDep |
| OS | Windows x64 | AMD Ryzen AI 9 H 365 |

---

## 3. Agent 能力矩阵

```json
{
  "protocolVersion": 1,
  "loadSession": true,
  "sessionCapabilities": {
    "close": {},
    "delete": {},
    "fork": {},
    "list": {},
    "resume": {},
    "additionalDirectories": {}
  },
  "mcpCapabilities": { "http": true, "sse": true },
  "promptCapabilities": { "image": true, "embeddedContext": true },
  "_meta": { "claudeCode": { "promptQueueing": true } }
}
```

### 能力对 Capibara 架构的映射

| ACP 能力 | Capibara 用途 | 状态 |
|----------|---------------|------|
| `session/new` | 创建新对话 | ✅ 直接使用 |
| `session/prompt` + streaming | 发送消息、接收流式响应 | ✅ 直接使用 |
| `session/close` | 关闭对话 | ✅ 直接使用 |
| `session/resume` | 恢复对话（含上下文） | ✅ 直接使用 |
| `session/fork` | 分支对话 | ✅ 可用（未测试） |
| `session/list` | 列出历史会话 | ✅ 可用（未测试） |
| `session/delete` | 删除会话 | ✅ 可用（未测试） |
| `loadSession` | 加载历史会话 | ✅ 可用（未测试） |
| `mcpCapabilities.http/sse` | MCP 服务器连接 | ✅ 可用（未测试） |
| `promptCapabilities.image` | 图片输入 | ✅ 可用（未测试） |
| `promptCapabilities.embeddedContext` | 嵌入上下文 | ✅ 可用（未测试） |
| `promptQueueing` | 消息队列 | ✅ 可用（未测试） |
| `fs/readTextFile` | 客户端文件系统 | ⚠️ 通道存在，但 Agent 优先用内置工具 |
| `requestPermission` | 权限控制 | ⚠️ 通道存在，需要配置 permissionMode |

---

## 4. 关键发现与解决的问题

### 4.1 ✅ 已解决：`connection.prompt()` 永不 resolve

**根因**: `claude-code@2.1.71` 不支持 `CLAUDE_CODE_EMIT_SESSION_STATE_EVENTS` 环境变量。ACP adapter 等待 `session_state_changed: idle` 事件来完成 prompt，但旧版 CLI 不发出此事件。

**修复**: 升级 `claude-code` 到 `2.1.150`。

**验证路径**:
1. SDK debug 日志显示 "Stop" hook 在 2 秒内触发，但 adapter 无限等待
2. 搜索 `cli.js` (2.1.71) — 无 `EMIT_SESSION_STATE` 引用
3. 确认 `acp-agent.js` 的 prompt handler 依赖 `session_state_changed: idle` 事件
4. 升级后事件正常发出，所有 prompt 在 5 秒内完成

**教训**: `claude-agent-acp@0.37.0` 要求 `claude-code ≥ 2.1.x` 某个特定版本。版本矩阵需要在 Capibara 中记录和强制。

### 4.2 ✅ 已解决：Bundled native binary 无法执行

**问题**: `claude-agent-sdk` 捆绑的 `claude-agent-sdk-win32-x64/claude.exe` (39MB) 虽然是有效的 PE x64 binary，但 Windows 返回 "不是有效应用程序"（EFTYPE -4028）。

**修复**: 通过 `CLAUDE_CODE_EXECUTABLE` 环境变量指定 npm 安装的 `claude.exe`。

**教训**: 不依赖 bundled binary，总是使用 `CLAUDE_CODE_EXECUTABLE` 指定 CLI 路径。

### 4.3 ⚠️ 已知限制：ACP fs 通道未触发

Agent 使用内置 `Read File` 工具而非 ACP 的 `fs/readTextFile` 通道。这是因为：
- Agent 自带文件系统工具（Read、Write、Edit 等）
- ACP 的 `readTextFile` 是一个额外通道，Agent 模型不一定选择使用它
- 在 `allowDangerouslySkipPermissions` 模式下，Agent 直接执行内置工具

**影响**: Capibara 不能完全依赖 ACP fs 通道来拦截所有文件操作。但这不影响架构——Capibara 的 fs adapter 层（ADR-004）可以同时提供 ACP fs 回调和项目文件配置。

### 4.4 ⚠️ 已知限制：Permission 通道未触发

在 `allowDangerouslySkipPermissions: true`（非 root 用户默认）模式下，Agent 不发出 `requestPermission`。

**影响**: 要启用 Capibara 的权限审批 UI（ADR-005），需要设置 `permissionMode: "default"` 并确保 `allowDangerouslySkipPermissions` 为 false。这需要在 Phase 1 中通过 ACP adapter 配置实现。

---

## 5. 降级策略确认

| 场景 | 首选方案 | 降级方案 | 状态 |
|------|----------|----------|------|
| 会话恢复 | `session/resume` | `session/load`（重放历史） | ✅ 首选方案验证通过 |
| 文件系统 | ACP `fs/readTextFile` | Agent 内置工具 | ⚠️ 内置工具可用，ACP 通道需配置 |
| 权限控制 | ACP `requestPermission` | `permissionMode` 配置 | ⚠️ 需配置触发 |
| MCP 连接 | ACP `mcpCapabilities` | 直接 MCP stdio | ✅ 能力已确认 |

---

## 6. 架构确认与 ADR 验证

| ADR | 验证结果 | 备注 |
|-----|----------|------|
| ADR-001 ACP 优先 | ✅ 确认 | Protocol v1 稳定，所有核心操作可用 |
| ADR-002 分阶段迁移 | ✅ 确认 | CLI fallback 保留作为安全网 |
| ADR-003 连接管理 | ✅ 确认 | stdin/stdout ndJSON 传输工作正常 |
| ADR-004 文件系统 | ⚠️ 部分确认 | ACP fs 通道存在但 Agent 偏好内置工具 |
| ADR-005 权限映射 | ⚠️ 需调整 | 需要明确配置 permissionMode |
| ADR-006 错误恢复 | ✅ 确认 | close/resume 组合可实现 |
| ADR-007 流式传输 | ✅ 确认 | session/update 通知实时送达 |

---

## 7. Phase 1 前置条件

### 必须完成
1. **版本锁定**: `claude-code ≥ 2.1.150`（或确认支持 `EMIT_SESSION_STATE_EVENTS` 的最低版本）
2. **`CLAUDE_CODE_EXECUTABLE` 配置**: Capibara 启动时自动定位 claude.exe 或 cli.js
3. **Permission mode 配置**: 确认 ACP adapter 的 `permissionMode` 参数传递方式

### 建议完成
4. **ACP fs 通道验证**: 在限制内置工具的模式下测试 fs 回调是否触发
5. **MCP 集成验证**: 通过 `mcpServers` 参数连接 MCP server
6. **错误恢复测试**: 模拟网络中断、进程崩溃后的恢复

---

## 8. 测试脚本

测试脚本: `tests/acp-poc/acp-lifecycle.ts`

```bash
npx tsx tests/acp-poc/acp-lifecycle.ts
```

---

## 9. 结论

ACP 协议能力完全满足 Capibara 执行引擎的需求。核心生命周期（创建、提示、流式响应、关闭、恢复）全部验证通过。两个跳过的测试（fs/permission）是因为 Agent 配置偏好而非协议限制，可在 Phase 1 通过配置解决。

**建议: 进入 Phase 1 — AcpExecutionAdapter 实现。**
