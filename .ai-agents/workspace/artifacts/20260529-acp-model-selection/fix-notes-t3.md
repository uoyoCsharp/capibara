---
skill: 'mvt-fix'
change-id: '20260529-acp-model-selection'
source: 'Review artifact'
---

# Fix Notes: ACP Model Selection (W1, W2 from t3 review)

## Symptom

Two warnings from code review of t3-settings-ui:

- **W1**: `handleChange` silently swallows API errors when `setSelectedModel` returns `{ ok: false }` -- the user gets no feedback that the save failed.
- **W2**: When both `selectedModelId` and `currentModelId` are null and `supported` is true, the Radix Select `value` resolves to `undefined`, causing the trigger to render an empty `SelectValue` with no placeholder.

## Input Source

Review artifact (`.ai-agents/workspace/artifacts/20260529-acp-model-selection/review-t3.md`).

## Reproduction

Not applicable (UX quality / edge-case warnings, not runtime bugs).

## Root Cause

- W1: `handleChange` only updates state on `result.ok === true`; on failure it silently does nothing (state unchanged, saving cleared, no error message rendered).
- W2: `SelectValue` without a `placeholder` prop renders nothing when `value` is undefined; the unsupported path already uses `placeholder` but the supported path does not.

## Patch Summary

| File | Change |
|------|--------|
| `ModelSelector.tsx` | W1: Added `error` state (`string | null`), set on `result.ok === false` using `ms.saveError` locale string, clear on next `handleChange` invocation. Render `<p className="text-xs text-destructive">` when error is set. W2: Added `placeholder={ms.placeholder}` to the supported-path `SelectValue`. |
| `shared/locale/types.ts` | Added `placeholder: string` and `saveError: string` to `modelSelector` sub-object. |
| `shared/locale/en-US.ts` | Added `placeholder: 'Select a model...'` and `saveError: 'Failed to save model preference.'`. |
| `shared/locale/zh-CN.ts` | Added `placeholder: '选择模型...'` and `saveError: '保存模型偏好失败。'`. |

## Regression Risk

- `error` state addition: purely additive; `null` initial state means no visual change on the happy path. The `useCallback` dependency on `ms.saveError` is stable (locale strings don't change at runtime).
- `placeholder` prop: Radix `SelectValue` already supports `placeholder`; the unsupported path already uses it. No behavior change when `value` is defined.
- Both locale additions are string-only; locale symmetry test verified.

## Follow-ups

None. All review warnings addressed. S1 (no dedicated ModelSelector test) is a suggestion, not a warning -- can be deferred to `/mvt-test`.
