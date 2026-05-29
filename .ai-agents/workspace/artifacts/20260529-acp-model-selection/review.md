---
id: 'review-output'
version: '1.0'
skill: 'mvt-review'
change-id: '20260529-acp-model-selection'
---

# Code Review: ACP Model Selection (t1 + t2)

## Review Scope

| File | Task | Depth |
|------|------|-------|
| `acp/types/acp.types.ts` | t1 | full |
| `acp/client/model-state.ts` | t1 | full |
| `acp/interfaces/i-model-preference.store.ts` | t1 | full |
| `acp/persistence/sqlite-model-preference.store.ts` | t1 | full |
| `acp/client/acp-session.manager.ts` | t1 | full |
| `acp/interfaces/i-acp-session.manager.ts` | t1 | full |
| `bootstrap/acp.module.ts` | t1 | full |
| `ipc-handlers/acp.handlers.ts` | t2 | full |
| `core/shared/types.ts` | t2 | full |
| `core/shared/api.ts` | t2 | full |
| `core/preload/index.ts` | t2 | full |
| `bootstrap/composition-root.ts` | t2 | wiring line only |
| `tests/unit/acp/model-state.test.ts` | t1 | full |
| `tests/unit/acp/sqlite-model-preference.store.test.ts` | t1 | full |
| `tests/unit/acp/acp-session.manager.test.ts` | t1 | full |

Design reference: `design.md` (5 ADRs). Aspect: full review (architecture, quality, errors, edge cases, tests).

## Summary

| Severity | Count |
|----------|-------|
| Critical | 0 |
| Warning | 2 |
| Suggestion | 4 |

**Verdict: Approve with comments.** The implementation is clean, follows the ADRs faithfully, and the code is well-tested. Two warnings are non-blocking but worth addressing before the renderer lands (t3) since they affect the data the UI will consume.

## Critical Issues

None.

## Warnings

### W1: `liveModelState` returns the first matching session's model state, which may be stale

**Location**: `acp-session.manager.ts:404-408`
**Severity**: Warning
**Observation**: `liveModelState(agentId)` iterates all live sessions and returns the first one matching `agentId` that has a `modelState`. If two sessions exist for the same agent (e.g., one active, one suspended), the returned state depends on `Map` insertion order -- which is the session created first, not necessarily the most recent or active one. `getModelState()` and the IPC `model-state` channel both rely on this.
**Impact**: The Settings UI could display a stale model list from an older session if the agent's model list changed between sessions. In practice, all sessions from the same agent version should advertise identical models, so this is a low-probability issue.
**Recommendation**: Consider filtering to `status === 'active'` sessions only, or preferring the most recently created session. Alternatively, document the "first match" semantics and that it is correct under the single-session-per-agent assumption. This was also noted in t1's Open TODOs.

### W2: `set-model` handler calls `getModelState` then `setSelectedModel` -- TOFU gap

**Location**: `acp.handlers.ts:69-76`
**Severity**: Warning
**Observation**: The `capibara:acp:set-model` handler first calls `sessionManager.getModelState(defaultAgentId)` to validate the modelId, then calls `sessionManager.setSelectedModel(defaultAgentId, modelId)`. Between these two calls, the model list could theoretically change (e.g., a concurrent session creation writes a new cache). `setSelectedModel` also performs its own membership check and throws, but the handler's catch treats any throw as `INTERNAL` -- so a TOFU race would produce an `INTERNAL` error rather than `VALIDATION`.
**Impact**: Extremely unlikely in practice (main process is single-threaded; both calls are synchronous), but the double-check is semantically misleading.
**Recommendation**: Either (a) let `setSelectedModel` own all validation and map its thrown error to `VALIDATION` in the handler (remove the handler-level check), or (b) remove the membership check from `setSelectedModel` since the handler is the sole caller and already validates. Option (a) is safer for defense-in-depth but requires the manager to throw a typed/distinguishable error.

## Suggestions

### S1: `normalizeModelState` does not guard against `configOptions` with no `options` property

**Location**: `model-state.ts:22`
**Severity**: Suggestion
**Observation**: If a `configOptions` entry has `category: 'model'` and `type: 'select'` but `options` is `undefined` or an empty array, `flattenSelectOptions(undefined)` would throw. The SDK types may guarantee `options` is always present, but an explicit fallback to `[]` would be defensive.
**Recommendation**: Consider `options: configModel.options ?? []` in the spread to `flattenSelectOptions`.

### S2: `UNSUPPORTED` constant is shared across all calls to `normalizeModelState`

**Location**: `model-state.ts:5`
**Severity**: Suggestion
**Observation**: The `UNSUPPORTED` object is a shared mutable reference. While `normalizeModelState` never mutates it and callers only read properties, returning a frozen object or a fresh copy would eliminate any risk of accidental mutation (especially since `ModelState` is an interface with mutable fields by default).
**Recommendation**: Low priority. Consider `Object.freeze(UNSUPPORTED)` or documenting that the return value must not be mutated.

### S3: `acp.handlers.ts` signature now takes 4 positional parameters

**Location**: `acp.handlers.ts:10-14`
**Severity**: Suggestion
**Observation**: `registerAcpHandlers` now takes 4 positional parameters (`auditRepo`, `suspensionRepo`, `sessionManager`, `defaultAgentId`). This is approaching the threshold where an options object would be clearer.
**Recommendation**: Consider refactoring to `registerAcpHandlers(deps: { auditRepo, suspensionRepo, sessionManager, defaultAgentId })` in a future cleanup pass. Not blocking.

### S4: `ModelStateSummary.supported` is a derived boolean from `models.length > 0`

**Location**: `acp.types.ts:85-86`, `acp-session.manager.ts:324`
**Severity**: Suggestion
**Observation**: `supported` is always `models.length > 0` and can be derived by the renderer. Adding it to the API surface saves the renderer a trivial computation but couples the type definition.
**Recommendation**: Acceptable for convenience and readability. No change needed.

## Highlights

- `normalizeModelState` is a well-designed pure function with clean precedence logic (ADR-1) and proper handling of the `SessionConfigSelectGroup` flattening edge case.
- `SqliteModelPreferenceStore` correctly handles corrupt JSON cache entries (returning `null` rather than propagating an error into the manager) -- a thoughtful boundary guard.
- `applyModelPreference` is best-effort with proper WARN logging on agent rejection -- consistent with the ADR-3 mandate that model selection must never fail a run.
- The `setSelectedModel`/REQ-6 contract (persist-only, no live mutation) is cleanly implemented and explicitly tested.
- The IPC handler performs server-side BR-3 validation before calling the manager, producing a clean `err('VALIDATION')` code -- consistent with the project's "validate input -> call service -> ok/err" handler pattern.
- The preload parity test passes without modification -- the new channels are correctly wired across all three layers (handler, preload, CapibaraApi).

## Skipped Checks

None. All review groups (A-F) were applied. Design reference (`design.md`) was available for Group A compliance checks.

## Recommended Next Skill

- `/mvt-implement` -- proceed to t3-settings-ui (ModelSelector + locale strings), the final task in the plan.
- `/mvt-fix` -- if W1 or W2 are addressed before t3.
- `/mvt-update-plan` -- mark t2 as done and advance `current_task` to t3 before implementing.
