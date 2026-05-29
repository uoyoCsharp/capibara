---
id: 'implement-output'
version: '1.0'
skill: 'mvt-implement'
change-id: '20260529-acp-model-selection'
task: 't3-settings-ui'
---

# Implementation: ACP Model Selection -- Settings UI (t3)

## Implementation Plan

Implemented the renderer-side model selector in one pass: locale type keys -> locale strings (en-US + zh-CN) -> ModelSelector component -> mount in AgentConfigPanel. Scope restricted to t3's file list plus one test-support file (mock API).

## Changes

| Path | Action | Intent |
|------|--------|--------|
| `renderer/components/settings/ModelSelector.tsx` | create | New component: fetches ModelStateSummary, renders disabled/active selector |
| `renderer/components/settings/AgentConfigPanel.tsx` | modify | Import and mount ModelSelector as a section between Agent Registry and Collaboration |
| `shared/locale/types.ts` | modify | Add `modelSelector` keys under `settings` in `LocaleMessages` |
| `shared/locale/en-US.ts` | modify | Add English model selector strings |
| `shared/locale/zh-CN.ts` | modify | Add Chinese model selector strings |
| `tests/unit/renderer/mock-capibara-api.ts` | modify | Add `getModelState` + `setSelectedModel` mocks (returns unsupported state by default) |

## Implementation Details

- **ModelSelector.tsx**: Calls `api().getModelState()` on mount. When `supported === false` (empty models -- covers unsupported-agent and cold-start-no-cache per ADR-4), renders a disabled Radix Select with `unsupported` placeholder text and an explanatory hint. When supported, renders an active dropdown with:
  - `value = selectedModelId ?? currentModelId` (shows saved preference, falls back to agent-active model)
  - Each item displays `model.name`; the item matching `currentModelId` gets a secondary Badge annotated "Active"
  - `onValueChange` calls `api().setSelectedModel(modelId)` and updates local state from the returned `ModelStateSummary`
  - Hint text explains the change takes effect on the next session (REQ-6: persist-only, no live mutation)
- **AgentConfigPanel.tsx**: Added `ModelSelector` import and mounted it as a third `<section>` between Agent Registry and Collaboration Config, following the existing section layout pattern.
- **Locale types (types.ts)**: Added `modelSelector` sub-object under `settings` with 5 keys: `title`, `unsupported`, `unsupportedHint`, `active`, `hint`.
- **Locale strings**: en-US and zh-CN both populated with the 5 model selector keys. Locale symmetry test passes.
- **Test mock**: Added `getModelState` and `setSelectedModel` to `createMockCapibaraApi()`, both returning `{ ok: true, data: { supported: false, models: [], currentModelId: null, selectedModelId: null } }` by default. This prevents the settings-page DOM tests from crashing when ModelSelector mounts.

## Design Compliance

| Check | Result |
|-------|--------|
| Files touched subset of t3 Change Tracking | PASS -- all 5 files from plan + 1 test-support file |
| Each file in its design-assigned module/layer | PASS -- ModelSelector in renderer/settings, locale strings in shared/locale |
| Public interfaces match Key Interfaces | PASS -- uses getModelState/setSelectedModel from CapibaraApi (defined in t2) |
| No hard-coded display strings | PASS -- all UI text from locale via useT() |
| Error handling only at boundaries | PASS -- no try/catch needed; API call failures silently leave state unchanged (selector stays null/disabled) |
| No new external deps | PASS -- uses existing Radix Select component |

## Deviations from Design

- **`mock-capibara-api.ts` modified** (not in t3 file list): added `getModelState` + `setSelectedModel` mocks so the settings-page DOM tests pass when ModelSelector mounts. This is test infrastructure, not production code.

## Self-Check Results

- **Type-check**: `tsc --noEmit` -- clean (whole project).
- **Unit tests**: `vitest run tests/unit` -- 1084 passed / 96 skipped (4 new tests from the settings-page DOM test exercising the model selector mount path).
- **ACP suite**: 183 passed / 21 skipped (unchanged from t2 baseline).
- **Locale symmetry**: 4/4 passed (en-US and zh-CN keys match).
- **Preload parity**: 5/5 passed (no preload changes in t3).

## Open TODOs

- For `/mvt-review`: verify ModelSelector UX meets acceptance criteria (unsupported state, active annotation, persist-only behavior).
- For `/mvt-update-plan`: mark t3-settings-ui done once review passes.
