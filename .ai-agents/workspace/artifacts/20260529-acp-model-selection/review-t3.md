---
id: 'review-output'
version: '1.0'
skill: 'mvt-review'
change-id: '20260529-acp-model-selection'
task: 't3-settings-ui'
---

# Code Review Report: ACP Model Selection -- Settings UI (t3)

## Review Scope

Files reviewed (6 total):

| # | File | Lines | Role |
|---|------|-------|------|
| 1 | `renderer/components/settings/ModelSelector.tsx` | 77 | New component -- model selector UI |
| 2 | `renderer/components/settings/AgentConfigPanel.tsx` | 96 | Modified -- mount ModelSelector |
| 3 | `shared/locale/types.ts` | 590 | Modified -- modelSelector type keys |
| 4 | `shared/locale/en-US.ts` | 582 | Modified -- English strings |
| 5 | `shared/locale/zh-CN.ts` | 578 | Modified -- Chinese strings |
| 6 | `tests/unit/renderer/mock-capibara-api.ts` | 178 | Modified -- getModelState/setSelectedModel mocks |

Depth: full review (design.md available, all check groups exercised).
Fallbacks: none.

## Summary

| Severity | Count |
|----------|-------|
| Critical | 0 |
| Warning | 2 |
| Suggestion | 1 |

**Verdict: Approve with comments** (0 critical, 2 warnings).

The implementation is clean, well-structured, and compliant with all 5 ADRs. The component follows
the existing settings-panel patterns (useT, api(), section layout), uses the shared Radix Select
correctly, and has proper locale coverage in both languages. The two warnings are about error-path
UX and an edge-case empty-value state -- neither is a bug today, but both are worth addressing
before the feature ships.

## Critical Issues

None.

## Warnings

### W1: `handleChange` silently swallows API errors -- user gets no feedback on save failure

- **File**: `ModelSelector.tsx:22-27`
- **Observation**: When `api().setSelectedModel(modelId)` returns `{ ok: false }`, the component
  does not update `state` (correct -- preserves the prior value), but also provides zero feedback
  to the user. The selector re-enables (`setSaving(false)`) and the Radix Select may visually
  revert to the prior value depending on how Radix reconciles the controlled `value` prop. The
  user has no indication that their selection was rejected (e.g., by the VALIDATION error code
  if the model list changed between mount and change).
- **Recommendation**: On `result.ok === false`, set a local error state and render a small
  inline message (e.g., the `result.error.message` or a generic "Failed to save" string from
  locale). Clear the error on the next successful change or after a timeout. This matches the
  existing error-pattern in the settings page (language save shows toast-like feedback).

### W2: Select `value` can be `undefined` when both `selectedModelId` and `currentModelId` are null

- **File**: `ModelSelector.tsx:48`
- **Observation**: `const value = state.selectedModelId ?? state.currentModelId ?? undefined;`
  When the agent advertises models but reports no `currentModelId` and the user has not yet
  selected a model, `value` is `undefined`. The Radix Select with `value={undefined}` behaves
  as an uncontrolled select -- the trigger renders an empty `SelectValue` and the user cannot
  tell what is selected. This is an edge case (most agents set `currentModelId`), but it is
  reachable on a fresh install where the cache was populated by a session that did not report
  `currentModelId` in its configOptions.
- **Recommendation**: When `value` resolves to `undefined`, render a placeholder in the trigger
  (e.g., "Select a model..." from locale) by using Radix's `SelectValue placeholder={...}` prop.
  Alternatively, default to the first model in the list, though that would be a semantic choice
  (implying a selection that was not made). The placeholder approach is neutral and matches the
  existing language-select pattern.

## Suggestions

### S1: No dedicated test coverage for ModelSelector render paths or interaction

- **File**: N/A (missing test file)
- **Observation**: The t3 acceptance criteria in `plan.yaml` are:
  - "Selector lists advertised models with the saved preference selected and the agent-active model annotated"
  - "When no models are available, the selector is disabled with an explanatory message and saving is impossible"
  - "All new strings exist in both en-US and zh-CN; types.ts compiles; renderer tests pass"

  The locale symmetry test covers the third criterion. The DOM smoke test
  (`settings-page.dom.test.tsx`) only verifies that the page renders without crashing -- it does
  not assert the ModelSelector's supported/unsupported render paths, the "Active" badge, or the
  `setSelectedModel` call on change. The first two acceptance criteria are untested mechanically.
- **Recommendation**: Add a `ModelSelector.dom.test.tsx` (or extend the settings-page DOM test)
  with at least: (1) unsupported state renders disabled selector + hint text, (2) supported state
  renders dropdown with model names and "Active" badge on currentModelId, (3) changing the
  dropdown calls `setSelectedModel` with the selected modelId. This can be deferred to `/mvt-test`
  if the team prefers to ship and test later.

## Highlights

- **Clean ADR compliance**: The component faithfully implements ADR-4 (cache-backed render,
  cold-start disabled state), REQ-5 (disabled selector for unsupported), and REQ-6 (persist-only,
  hint text explaining "next session" semantics).
- **Locale pattern**: All display strings use `useT()` with properly typed keys -- zero hard-coded
  strings. The `modelSelector` sub-object is well-organized and the `unsupportedHint` string
  correctly covers both "unsupported agent" and "cold-start no cache" per ADR-4.
- **Consistent styling**: The section layout, icon size, heading class, and spacing match the
  existing `AgentConfigPanel` sections exactly.

## Skipped Checks

- Group F (Security): not applicable -- no auth/data sensitivity concerns for this feature.
