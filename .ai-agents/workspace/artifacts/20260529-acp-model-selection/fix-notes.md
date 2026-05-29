---
skill: 'mvt-fix'
change-id: '20260529-acp-model-selection'
source: 'Review artifact'
---

# Fix Notes: ACP Model Selection (W1, W2, S1)

## Symptom

Two warnings and one suggestion from code review of t1+t2:

- **W1**: `liveModelState` returns the first Map-insertion-order match, which is the oldest session rather than the most recent.
- **W2**: `set-model` IPC handler performs its own BR-3 validation and then calls `setSelectedModel` which also validates -- the handler's catch maps the manager's thrown error to `INTERNAL` instead of `VALIDATION`, creating a semantic TOFU gap.
- **S1**: `normalizeModelState` does not guard against a `configOptions` entry with `options: undefined`.

## Input Source

Review artifact (`.ai-agents/workspace/artifacts/20260529-acp-model-selection/review.md`).

## Reproduction

Not applicable (code quality / edge-case warnings, not runtime bugs).

## Root Cause

- W1: `Map.values()` iterates in insertion order. The first match for `agentId` is the oldest live session.
- W2: The handler was performing validation before calling the manager, then catching any manager throw as `INTERNAL`. The manager's validation error was indistinguishable from an internal error.
- S1: Missing defensive fallback for the `options` field.

## Patch Summary

| File | Change |
|------|--------|
| `acp/client/acp-session.manager.ts` | W1: `liveModelState` iterates in reverse to prefer the most recently created session. W2: `setSelectedModel` sets `error.name = 'ValidationError'` on its thrown error. |
| `ipc-handlers/acp.handlers.ts` | W2: Removed the redundant handler-level `getModelState` check; the handler now calls `setSelectedModel` directly and maps `error.name === 'ValidationError'` to `err('VALIDATION')`. |
| `acp/client/model-state.ts` | S1: Added `?? []` guard on `configModel.options`. |
| `tests/unit/acp/acp-session.manager.test.ts` | W2: Added assertion that the thrown error has `name === 'ValidationError'`. |

## Regression Risk

- `liveModelState` change: the only callers are `getModelState` and `setSelectedModel`, both tested. Reverse iteration produces the same result when there is a single session (the common case), so no regression.
- `setSelectedModel` error naming: the handler now correctly maps to `VALIDATION`. The manager's `catch` in `applyModelPreference` does not catch `setSelectedModel` errors (different code path), so no interaction.
- `configModel.options ?? []`: purely additive guard; no behavior change when `options` is defined.

## Follow-ups

None. All review warnings addressed.
