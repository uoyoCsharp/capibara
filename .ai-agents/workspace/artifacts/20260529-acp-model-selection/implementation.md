---
id: 'implement-output'
version: '1.0'
skill: 'mvt-implement'
change-id: '20260529-acp-model-selection'
task: 't2-ipc-and-api'
---

# Implementation: ACP Model Selection -- IPC & API (t2)

## Implementation Plan

Implemented the IPC layer for model selection in one pass: shared type re-exports
-> CapibaraApi additions -> IPC handlers (with server-side validation) -> preload
passthroughs -> composition-root wiring. Scope restricted to t2's files plus the
necessary composition-root.ts wiring call (deviation noted).

## Changes

| Path | Action | Intent |
|------|--------|--------|
| `core/shared/types.ts` | modify | Re-export `AvailableModel`, `ModelStateSummary` from ACP types |
| `core/shared/api.ts` | modify | Add `getModelState` / `setSelectedModel` to `CapibaraApi` |
| `core/ipc-handlers/acp.handlers.ts` | modify | Extend signature with `sessionManager` + `defaultAgentId`; add `capibara:acp:model-state` / `:set-model` handlers (ADR-5) |
| `core/preload/index.ts` | modify | Add passthrough for `capibara:acp:model-state` / `:set-model` |
| `core/bootstrap/composition-root.ts` | modify | Pass `sessionManager` + `defaultAgentId` to `registerAcpHandlers` |

## Implementation Details

- **Shared types (re-export)**: `AvailableModel` and `ModelStateSummary` are re-exported from
  `acp.types.ts` via `core/shared/types.ts` so the renderer can import them from the shared
  surface without depending on ACP internals. The canonical definitions remain in `acp.types.ts`
  (placed there by t1).
- **CapibaraApi**: two additive methods -- `getModelState(): Promise<DesktopResult<ModelStateSummary>>`
  and `setSelectedModel(modelId: string): Promise<DesktopResult<ModelStateSummary>>`. Both match
  the design's Key Interfaces exactly.
- **IPC handlers (ADR-5)**: `registerAcpHandlers` signature extended with `sessionManager:
  IAcpSessionManager` and `defaultAgentId: string`. Two new channels:
  - `capibara:acp:model-state` -- calls `sessionManager.getModelState(defaultAgentId)`, wraps
    in `DesktopResult`.
  - `capibara:acp:set-model` -- validates `modelId` is in the advertised model list
    (server-side BR-3 check at the IPC boundary), returns `err('VALIDATION')` if not, else
    delegates to `sessionManager.setSelectedModel(defaultAgentId, modelId)`.
- **Validation placement**: The handler performs the BR-3 membership check explicitly before
  calling `setSelectedModel`, rather than relying on the manager's thrown error. This keeps
  validation at the IPC boundary (consistent with the design's "validate input -> call service
  -> ok/err" handler pattern) and produces a clean `err('VALIDATION')` code.
- **Preload**: pure passthroughs for both channels. `getModelState` takes no args;
  `setSelectedModel` passes `modelId` through.
- **Composition root**: updated `registerAcpHandlers` call to pass `acpModule.sessionManager`
  and `agentConfig.defaultAgent`.

## Design Compliance

| Check | Result |
|-------|--------|
| Files touched subset of Change Tracking (t2 + 1 deviation) | PASS -- all within t2 scope except composition-root.ts wiring |
| Each file in its design-assigned module/layer | PASS -- shared types/api in shared, handlers in ipc-handlers, preload in preload |
| Public interfaces match Key Interfaces | PASS -- `ModelStateSummary`, `CapibaraApi` additions, channel names match design |
| Forbidden cross-layer imports absent | PASS -- handler imports only IAcpSessionManager (interface, not impl) |
| Error handling only at boundaries | PASS -- try/catch in IPC handlers (external boundary) only |
| No new external deps | PASS |

## Deviations from Design

- **`composition-root.ts` modified** (not listed in t2's file list): the `registerAcpHandlers`
  call needed updating to pass `sessionManager` + `defaultAgentId`. Without this change the
  new handlers cannot be wired. The change is one line -- extending the existing call args.
- **Validation in handler rather than relying on manager throw**: the handler explicitly checks
  model membership before calling `setSelectedModel`, producing `err('VALIDATION')`. The
  manager still validates as a safety net (throws if called with a bad modelId), but the IPC
  boundary owns the user-facing error code. This is consistent with the existing handler
  pattern (validate input -> call service -> ok/err) and avoids fragile error-message parsing.

## Self-Check Results

- **Type-check**: `npx tsc --noEmit` -- clean (whole project).
- **Parity test**: `npx vitest run tests/unit/preload-api-parity.test.ts` -- 5/5 passed.
  All three invariants hold: channels match, preload methods match CapibaraApi, counts equal.
- **ACP suite**: `npx vitest run tests/unit/acp/` -- 178 passed / 21 skipped (baseline unchanged).
  The 21 skips are the better-sqlite3 ABI guard under system Node.

## Open TODOs

- **t3-settings-ui**: `ModelSelector.tsx` + mount in `AgentConfigPanel.tsx`; locale strings
  in en-US/zh-CN/types.ts.
- For `/mvt-review`: confirm the handler-level validation approach is acceptable (duplicates
  the manager's membership check, but produces a cleaner VALIDATION error code at the IPC
  boundary).
