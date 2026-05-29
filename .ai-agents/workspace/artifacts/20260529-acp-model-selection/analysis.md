# Requirements Analysis: ACP Model Selection in Settings

## Feature Overview

Add a model selector to the Settings page that lets the user choose which AI model the
ACP agent should use. The list of selectable models is **not hard-coded**; it is discovered
dynamically from the ACP agent over the protocol when an agent session is established.

Scope decisions confirmed with the user:

- **Scope**: Global default — a single application-wide model preference shared by every AI
  role/run. (Not per-role; no per-role override in this change.)
- **Apply semantics**: The Settings page sets a *preference*. It is applied to the next ACP
  session created (via the protocol's model-selection mechanism). It does **not** retroactively
  switch a session that is already running.
- **Degradation**: When the connected ACP agent advertises no model list, the selector is
  hidden/disabled with an explanatory message ("current agent does not support model selection").

This change builds on the existing ACP session lifecycle work (see
`[[20260528-acp-session-lifecycle]]`). The protocol/SDK groundwork already exists: the project
ships `@agentclientprotocol/sdk@0.22.1`, which exposes both the model APIs and the config-option
APIs described below.

### Protocol Background (verified against installed SDK 0.22.1)

The ACP protocol exposes model information at the **session level** (in the `session/new`
response), not at the `initialize` level. Two mechanisms exist:

1. **`SessionModelState` + `session/set_model`** — purpose-built for models. The `session/new`
   response MAY carry a `models` field of shape
   `{ availableModels: ModelInfo[], currentModelId: ModelId }`, where
   `ModelInfo = { modelId, name, description? }`. The client switches with
   `connection.unstable_setSessionModel({ sessionId, modelId })`.
   **Caveat**: the SDK marks this `unstable_` / `@experimental` ("not part of the spec yet,
   may be removed or changed").

2. **`SessionConfigOption` + `session/set_config_option`** — the documented "preferred way to
   expose session-level configuration", which supersedes the legacy Session Modes API. The
   `session/new` response MAY carry `configOptions: SessionConfigOption[]`; a model selector is
   represented by an option with the reserved `category: "model"`, `type: "select"`,
   a `currentValue`, and a list of selectable `options`. The client switches with
   `connection.setSessionConfigOption({ sessionId, configId, value })` (no `unstable_` prefix).

Both `models` and `configOptions` are **optional ("MAY")** fields returned by the agent, so the
availability of model selection is a per-agent capability that must be detected at runtime —
exactly like the existing `supportsResume` / `supportsLoad` detection in `acp-agent.spawner.ts`.

## Actors

| Actor | Role in this feature |
|-------|----------------------|
| **User (operator)** | Opens Settings, sees the available models for the active agent, picks one, and saves it as the global default. |
| **Renderer (Settings page)** | Reads current preference + available models via IPC; renders the selector (or the disabled/hidden state); writes the chosen modelId back. |
| **ACP Session Manager** | Captures the agent-advertised model list/current model from the `session/new` response; applies the configured model preference when a session is created. |
| **ACP Agent (subprocess)** | The source of truth for which models exist and which is active. MAY advertise `models`/`configOptions`; MAY accept `set_model`/`set_config_option`. |
| **Config store** | Persists the chosen global model preference (alongside `agents.defaultAgent`). |

## Requirements

### Functional

- **REQ-1 (Discover models)**: The system MUST surface the list of models the active ACP agent
  advertises, obtained from the protocol (`session/new` response), not from a hard-coded list.
  Each model exposes at least `modelId` and a human-readable `name` (optional `description`).
- **REQ-2 (Show current selection)**: The Settings page MUST display which model is currently
  selected as the global default, and which model the agent reports as active (`currentModelId`).
- **REQ-3 (Set preference)**: The user MUST be able to select a model from the advertised list
  and persist it as the global default preference.
- **REQ-4 (Apply on next session)**: When a new ACP session is created, the system MUST apply the
  persisted model preference to that session via the protocol (set-model / set-config-option),
  provided the agent supports it and the preference is one of the advertised models.
- **REQ-5 (Graceful degradation)**: When the active agent advertises no model list, the Settings
  page MUST hide/disable the selector and show an explanatory message; saving a model preference
  MUST be impossible in that state.
- **REQ-6 (No retroactive switch)**: Changing the preference in Settings MUST NOT mutate a session
  that is already active/running. It takes effect from the next session creation onward.

### Non-Functional

- **REQ-N1 (Layering)**: New cross-process access MUST go through the existing IPC pattern
  (`capibara:<domain>:<action>` channel → thin handler → core service → `DesktopResult`), with the
  preload remaining a pure passthrough. No business logic in preload/renderer.
- **REQ-N2 (Capability detection parity)**: Model-support detection MUST follow the same shape as
  the existing `AgentCapabilities` detection in `acp-agent.spawner.ts` — runtime-derived,
  config-overridable where it makes sense, never assumed.
- **REQ-N3 (Forward-compatible API choice)**: The implementation SHOULD prefer the stable
  `setSessionConfigOption` (`category: "model"`) path and treat `unstable_setSessionModel` as a
  fallback, mirroring the existing `resume > load > rebuild` degradation chain. (Final mechanism
  choice is a design-phase decision — see Ambiguities.)
- **REQ-N4 (i18n)**: All new user-facing strings MUST be added to both `en-US` and `zh-CN` locale
  files; no hard-coded display strings.

## Domain Concepts

| Concept | Definition |
|---------|------------|
| **Model preference** | The user-chosen global default `modelId`, persisted in config. Applied to new sessions. Distinct from the *active model* the agent currently runs. |
| **Available models** | The set of `ModelInfo` the active agent advertises in its `session/new` response. Empty/absent ⇒ model selection unsupported by that agent. |
| **Current model** | The `currentModelId` the agent reports for a session — the model actually in use right now. |
| **Model-selection capability** | A runtime-detected boolean: does the active agent advertise a model list (and accept a set call)? Parallels `supportsResume`/`supportsLoad`. |
| **Set-model mechanism** | The protocol method used to apply a model: `setSessionConfigOption` (preferred, stable) or `unstable_setSessionModel` (fallback). |

## Business Rules

- **BR-1**: Model information is session-scoped. It is read from the `session/new` response and is
  not available at `initialize` time. Therefore "available models" can only be known once at least
  one session has been created for the active agent.
- **BR-2**: `models` and `configOptions` are optional agent-advertised fields. Absence ⇒ the agent
  does not support model selection ⇒ selector is hidden/disabled (REQ-5).
- **BR-3**: A model preference is only applied if its `modelId` is present in the agent's advertised
  `availableModels`. A stale/unknown preference MUST be ignored (agent keeps its default), not
  forced — consistent with the protocol's "agent MUST always supply a default" rule.
- **BR-4**: The preference is global and shared by all roles/runs in this change (single-model
  scope). Per-role override is explicitly out of scope.
- **BR-5**: Setting the preference is non-destructive to live sessions (REQ-6): only `createSession`
  reads and applies it; existing live sessions are untouched.
- **BR-6**: The persisted preference lives alongside `agents.defaultAgent` in the layered config
  (`CapibaraConfig.agents`), validated by the existing Zod schema.

## Ambiguities & Questions

Resolved during analysis (recorded for traceability):

- **[RESOLVED] Scope** → Global default, single model (not per-role).
- **[RESOLVED] Apply semantics** → Preference applied on next session; no retroactive switch.
- **[RESOLVED] Degradation** → Hide/disable selector + message when no models advertised.

Open — to be decided in `/mvt-design` (not blocking analysis):

- **Q-1 (Mechanism)**: `setSessionConfigOption` (stable, `category: "model"`) vs
  `unstable_setSessionModel` (purpose-built but experimental) vs supporting both with a degradation
  chain. Recommendation leans to "prefer config-option, fall back to set-model", but the exact
  capability-detection logic and whether to support both is a design decision.
- **Q-2 (Where preference is read/applied)**: The cleanest seam is `AcpExecutor.spawn` (which already
  resolves `agentId`, `mcpServers`, `allowedPaths` before calling `createSession`) passing a
  `modelId` into `CreateSessionParams`, with `AcpSessionManager.createSession` applying it
  post-`newSession`. Final placement is a design decision.
- **Q-3 (Discovery before first session)**: Because models are session-scoped (BR-1), the Settings
  page cannot show a list until a session has run at least once for the active agent. Design must
  decide how to surface models when none has been created yet (e.g., empty-state prompt, a
  lightweight probe session, or cache the last-seen list from the most recent session).
- **Q-4 (Persisting last-seen models)**: Whether to cache the last-advertised `availableModels` so
  the Settings page can render between app restarts (before any new session), or always show live.

## Change Tracking

Estimated impact (for `/mvt-design` and complexity gating). This exceeds the quick-path threshold
(>3 files, new IPC contract, new config field), so the standard workflow applies.

| Area | File(s) | Nature of change |
|------|---------|------------------|
| Config schema | `core/config/config.types.ts`, `config.schema.ts`, `config.defaults.ts` | Add `agents.defaultModel?` (or similar) field + Zod validation + default. |
| ACP types | `core/modules/acp/types/acp.types.ts` | Extend `AgentCapabilities` (model-selection support), `SessionRuntimeContext`/`AcpSession` (availableModels, currentModelId), `CreateSessionParams` (modelId). |
| Session manager | `core/modules/acp/client/acp-session.manager.ts` | Capture `response.models`/`configOptions` after `newSession`; apply configured `modelId` via set-model/set-config-option; new method to expose available models. |
| Spawner (maybe) | `core/modules/acp/client/acp-agent.spawner.ts` | If model-support is partly initialize-derivable; otherwise unchanged. |
| Executor | `core/modules/acp/client/acp-executor.ts` | Read configured model preference, thread `modelId` into `createSession`. |
| IPC contract | `core/ipc-handlers/system.handlers.ts` (or new acp handler), `core/shared/*` (CapibaraApi), `preload/` | New channels: get available models / get+set model preference. |
| Renderer | `renderer/components/settings/AgentConfigPanel.tsx` (+ possibly new sub-component) | Model selector UI with disabled/empty state; wire to new IPC. |
| Locale | `shared/locale/en-US.ts`, `zh-CN.ts`, `types.ts` | New strings for the model selector + degraded state. |
| Tests | `tests/unit/acp/*`, renderer tests | Cover capture, apply, degradation, IPC parity. |

Estimated: ~8–10 files across config, ACP core, IPC, renderer, locale. New module boundary: none
(fits existing ACP + settings structure). New external dependency: none (SDK already present).
Breaking change: none.
