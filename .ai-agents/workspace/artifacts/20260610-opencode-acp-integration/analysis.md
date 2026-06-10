# Requirements Analysis: OpenCode ACP Integration

## Feature Overview

Integrate OpenCode as a second ACP-compatible agent backend in Capibara, alongside the existing Claude Code agent. OpenCode natively supports ACP via the `opencode acp` command (JSON-RPC over stdio), so no adapter or bridge is needed. The existing ACP infrastructure (spawner, session manager, executor) is already agent-agnostic and supports multiple registered agents through its registry pattern. The primary work is in the bootstrap/wiring layer to register OpenCode and allow users to switch the default agent.

**Key Discovery**: OpenCode has first-class ACP support (`opencode.acp/docs/acp/`). It is launched via `opencode acp` and communicates over JSON-RPC via stdio, exactly matching the protocol that Capibara's `AcpAgentSpawner` already implements via `@agentclientprotocol/sdk`.

## Actors

| Actor | Description |
|-------|-------------|
| Developer (User) | Configures which agent backend to use; switches between Claude Code and OpenCode via settings or config file |
| AcpAgentSpawner | Infrastructure component that spawns and manages agent subprocesses; already agent-agnostic |
| AcpExecutor | IExecutor implementation that resolves the default agent from the registry; already supports fallback logic |
| AcpSessionManager | Manages ACP session lifecycle per agent; performs capability negotiation during initialize handshake |

## Requirements

### Functional Requirements

| ID | Requirement | Priority |
|----|-------------|----------|
| FR-1 | Register OpenCode as a second agent in the agent registry with id `opencode-agent` | Must |
| FR-2 | Resolve the OpenCode executable path: check `OPENCODE_EXECUTABLE` env var first, then fall back to `opencode` on PATH | Must |
| FR-3 | Support switching the default agent via config file (`agents.defaultAgent: 'opencode-agent'`) | Must |
| FR-4 | Support switching the default agent at runtime via Settings UI | Should |
| FR-5 | OpenCode agent sessions must support the same MCP transport configuration as Claude agent (HTTP preferred) | Must |
| FR-6 | AI-to-AI collaboration (inquiries) must work across agent types (e.g., Claude agent asks OpenCode agent) | Must |
| FR-7 | Display both registered agents in the AgentConfigPanel with clear default indicator | Should |
| FR-8 | Gracefully handle the case where `opencode` is not installed (log warning, skip registration) | Should |

### Non-Functional Requirements

| ID | Requirement |
|----|-------------|
| NFR-1 | No regression to existing Claude Code agent functionality |
| NFR-2 | Agent switching should take effect on next session creation (no need to restart app for config change) |
| NFR-3 | OpenCode agent stderr output should be logged at debug level (same as Claude agent) |

## Domain Concepts

| Concept | Description |
|---------|-------------|
| Agent Registry | Data-driven registry of `AgentRegistryEntry` objects; each entry defines an agent subprocess (command, args, env, capabilities, mcpTransport) |
| Agent Discovery | The process of resolving an agent executable path from env vars or system PATH |
| ACP Compatibility | An agent's ability to speak the Agent Client Protocol (ndjson over stdin/stdout, initialize handshake, session/new, prompt, etc.) |
| Default Agent | The globally configured agent ID used when `AcpExecutor.spawn()` resolves which agent to use for a run |
| Capability Negotiation | The ACP initialize handshake where the agent reports its capabilities (resume, load, list, MCP transports) |

## Business Rules

### Agent Registration
- Each agent in the registry must have a unique `id`
- The `defaultAgent` config value must match a registered agent `id`; if not, fall back to the first registered agent (existing behavior)
- If `opencode` executable is not found on PATH and `OPENCODE_EXECUTABLE` is not set, the OpenCode agent entry should still be registered but with a warning logged at startup

### Agent Execution
- `AcpExecutor.spawn()` resolves the agent via `agentConfig.defaultAgent` -- no change needed to execution flow
- Each agent subprocess is spawned lazily on first use and reused across sessions (existing behavior via `AcpAgentSpawner.getOrSpawn()`)
- OpenCode agent uses the same ACP protocol callbacks (sessionUpdate, requestPermission, readTextFile, writeTextFile) as Claude agent

### Agent Switching
- Config file change to `agents.defaultAgent` takes effect on next app startup (registry is built once during bootstrap)
- Runtime switching via UI should update the in-memory `agentConfig.defaultAgent` and persist to config file
- Active sessions are NOT migrated when switching default agent; only new sessions use the new default

### Cross-Agent Collaboration
- AI-to-AI inquiries work at the ACP session level, not the agent process level -- each agent has its own session
- The suspension/aggregation mechanism is agent-agnostic (it operates on session IDs, not agent IDs)
- No special handling needed for cross-agent inquiries; the existing `SessionSuspensionManager` and `InquiryAggregator` work transparently

## Assumptions

| # | Assumption | Risk |
|---|-----------|------|
| A-1 | OpenCode's ACP implementation is compatible with `@agentclientprotocol/sdk` ClientSideConnection | Low -- both implement the same ACP spec; capability negotiation handles differences |
| A-2 | OpenCode supports the same ACP callbacks as Claude Code (sessionUpdate, requestPermission, readTextFile, writeTextFile) | Low -- these are core ACP protocol methods; OpenCode docs confirm full feature support |
| A-3 | OpenCode's MCP transport capability reporting matches what the spawner expects (`mcpCapabilities.http`) | Medium -- needs verification; if OpenCode only reports `stdio`, MCP config may need adjustment |
| A-4 | The `opencode` binary is available on the user's PATH or can be located via `OPENCODE_EXECUTABLE` env var | Low -- same pattern as `CLAUDE_CODE_EXECUTABLE` |
| A-5 | OpenCode's model selection mechanism (if any) is compatible with the `normalizeModelState()` abstraction | Medium -- OpenCode may not expose model selection via ACP the same way Claude Code does; model selector UI may not work for OpenCode agent |

## Ambiguities & Questions

| # | Ambiguity | Impact | Question |
|---|-----------|--------|----------|
| Q-1 | OpenCode ACP model selection | Medium | Does OpenCode support model selection via ACP session/new params? If not, the ModelSelector in settings would only apply to the Claude agent. Is this acceptable? |
| Q-2 | Runtime agent switching | Low | Should the default agent be switchable at runtime (via UI) without restarting the app? Or is config-file + restart sufficient for v1? |
| Q-3 | OpenCode executable resolution | Low | Should Capibara attempt to auto-detect the OpenCode installation path (e.g., via `which opencode` / `where opencode`), or is relying on PATH + env var sufficient? |

## Scope Assessment

### Files Likely Affected

| File | Change Type | Description |
|------|-------------|-------------|
| `core/bootstrap/composition-root.ts` | Modify | Add OpenCode agent registration to the registry array; add `OPENCODE_EXECUTABLE` env var resolution |
| `core/config/config.schema.ts` | Modify | No structural change needed; `defaultAgent` already accepts any string |
| `core/config/config.defaults.ts` | Modify | No change needed (default remains `claude-agent`) |
| `core/shared/types.ts` | Modify | Possibly extend `AgentConfigSummary` if we add status/availability info |
| `renderer/components/settings/AgentConfigPanel.tsx` | Modify | Add default-agent switching UI (radio/dropdown) |
| `core/ipc-handlers/system.handlers.ts` | Modify | Add IPC handler for runtime default-agent switching (if Q-2 = runtime) |
| `shared/locale/` | Modify | Add locale strings for new UI elements |

### Quick Path Assessment

| Criterion | Result | Reasoning |
|-----------|--------|-----------|
| Scope | PASS | ~5-7 files, mostly bootstrap + UI |
| No new concepts | PASS | Registry pattern already exists; no new domain entities |
| No architectural impact | PASS | Fits existing module/layer structure; no ADR needed |
| Clear specification | PASS | OpenCode has native ACP; requirements are clear |
| No integration concerns | BORDERLINE | New external binary dependency, but same ACP protocol |
| Single actor | PASS | Only the developer/user |

**Result**: 5/6 clear pass, 1 borderline. This qualifies for the quick development path.

## Change Tracking

| Field | Value |
|-------|-------|
| Change ID | `20260610-opencode-acp-integration` |
| Created | 2026-06-10 |
| Status | Analysis complete |
| Epic | None |
