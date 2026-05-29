---
id: 'implement-output'
version: '1.0'
skill: 'mvt-implement'
change-id: '20260529-acp-model-selection'
task: 't1-backend-model-support'
---

# Implementation: ACP Model Selection — Backend (t1)

## Implementation Plan

Implemented the entire main-process model-selection backend in one cohesive pass per plan task
`t1-backend-model-support`, dependency-ordered: types → pure normalizer → store
(interface + impl) → session manager (apply/cache/get/set) → bootstrap DI wiring → tests.

Scope was restricted to `t1`'s files. IPC/preload/shared-API (t2) and the renderer selector (t3)
were intentionally NOT touched.

## Changes

| Path | Action | Intent |
|------|--------|--------|
| `acp/types/acp.types.ts` | modify | Add `AgentModelMechanism`, `AvailableModel`, `ModelState`, `ModelStateSummary` |
| `acp/client/model-state.ts` | create | Pure `normalizeModelState(response)` — configOptions(model) > models > empty; flatten groups |
| `acp/interfaces/i-model-preference.store.ts` | create | `IModelPreferenceStore` contract |
| `acp/persistence/sqlite-model-preference.store.ts` | create | `settings`-table-backed store (ADR-2) |
| `acp/client/acp-session.manager.ts` | modify | Inject store; `modelState` on runtime ctx; apply+cache on create/rebuild; `getModelState`/`setSelectedModel` |
| `acp/interfaces/i-acp-session.manager.ts` | modify | Add `getModelState`/`setSelectedModel` signatures |
| `bootstrap/acp.module.ts` | modify | Construct `SqliteModelPreferenceStore`, inject into manager |
| `tests/unit/acp/model-state.test.ts` | create | 7 cases: precedence, group-flatten, models-fallback, ignore non-model, empty, empty-list |
| `tests/unit/acp/sqlite-model-preference.store.test.ts` | create | 9 cases: selected get/set/overwrite/clear, cache round-trip/isolation/corrupt |
| `tests/unit/acp/acp-session.manager.test.ts` | modify | +10 model cases; threaded fake store + mock connection methods |

## Implementation Details

- **Mechanism normalization (ADR-1)**: `normalizeModelState` is a pure function. Precedence is a
  `configOptions` entry with `category==='model' && type==='select'` (stable mechanism) over the
  experimental `models` field; grouped select options (`SessionConfigSelectGroup`) are flattened
  via `'options' in entry` discrimination. Returns an empty `{mechanism: null}` state when neither
  is present or `availableModels` is empty.
- **Apply is best-effort (ADR-3, BR-3)**: `AcpSessionManager.applyModelPreference` runs after every
  `connection.newSession` (in both `createSession` and `rebuild`): normalize → write-through cache
  → if the stored preference is in the advertised list and a mechanism exists, call
  `setSessionConfigOption` (config_option) or `unstable_setSessionModel` (set_model). An agent that
  rejects the call is caught, logged at WARN, and the session continues on the agent default — never
  fails the run.
- **No live mutation (REQ-6)**: `setSelectedModel` only validates membership and persists via the
  store; it issues no protocol call on any live session. Verified by test.
- **Persistence (ADR-2)**: the `settings` table already exists (no migration). Keys
  `acp:default-model` and `acp:models-cache:<agentId>` (JSON). A corrupt cache row is treated as
  absent rather than throwing into the manager.
- **`getModelState`** reads live runtime model state (any live session on the agent) falling back to
  the persisted cache, merged with the stored `selectedModelId` into a `ModelStateSummary`.

## Design Compliance

| Check | Result |
|-------|--------|
| Files touched ⊆ Change Tracking (t1 subset) | PASS — all within t1 scope |
| Each file in its design-assigned module/layer | PASS — all under `modules/acp/*` + `bootstrap/` |
| Public interfaces match Key Interfaces | PASS — `normalizeModelState`, `IModelPreferenceStore`, `ModelState(Summary)`, manager methods match design signatures |
| Forbidden cross-layer imports absent | PASS — new files import only `@core/foundation/*`, own module, and the ACP SDK |
| Error handling only at boundaries | PASS — try/catch only around the protocol set call (external) and JSON.parse of a persisted row (IO boundary) |
| No new external deps | PASS — SDK already present; no manifest change |

## Deviations from Design

- **`composition-root.ts` not modified**: the design's Change Tracking listed it, but
  `registerAcpModule` already receives `sqliteConn`, so the store is constructed inside
  `acp.module.ts` with no composition-root change needed. Net-narrower than designed.
- **No migration file**: the `settings` table already exists (created in the base migration), so
  ADR-2's store needed no schema change. (Design implied reuse; confirmed.)
- **`ModelStateSummary` defined in `acp.types.ts`** (re-exported by t2's shared types) rather than
  authored in `core/shared/types.ts`. Keeps t1 self-contained; matches the prior change's pattern of
  locating canonical types in the owning module. t2 will re-export it on the renderer-facing surface.

## Self-Check Results

- **Type-check**: `npx tsc --noEmit` — clean (whole project).
- **Tests**:
  - New/changed files: `npx vitest run tests/unit/acp/model-state.test.ts
    tests/unit/acp/sqlite-model-preference.store.test.ts
    tests/unit/acp/acp-session.manager.test.ts` → 31 passed, 8 skipped.
  - Full ACP suite: `npx vitest run tests/unit/acp/` → 178 passed, 21 skipped, 0 failed.
  - The 8/21 skips are the better-sqlite3 ABI guard (`skipIf(!canUseSqlite)`) under system Node —
    the same guard the existing `sqlite-acp-session.repository.test.ts` uses; they pass under the
    electron ABI runner.

## Open TODOs

- **t2-ipc-and-api**: add `capibara:acp:model-state` / `:set-model` channels (extend
  `registerAcpHandlers` to receive the session manager + default agentId), re-export
  `ModelStateSummary`/`AvailableModel` on `core/shared/types.ts`, add `getModelState`/
  `setSelectedModel` to `CapibaraApi` + preload, update preload-api-parity test.
- **t3-settings-ui**: `ModelSelector.tsx` + mount in `AgentConfigPanel.tsx`; locale strings.
- For `/mvt-review`: confirm the `liveModelState(agentId)` loop is acceptable (all live sessions on
  one agent share a model state — first match wins); confirm `unstable_setSessionModel` use is
  intentional given its `@experimental` SDK marker (it is the fallback by design, ADR-1).
