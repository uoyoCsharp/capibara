# Code Review Report

## Review Scope

| Field | Value |
|-------|-------|
| Files | `apps/electron/src/renderer/components/tasks/RunOutputPanel.tsx` |
| Depth | Full review (all axes) |
| Aspect | All (architecture, quality, errors, edge-cases) |
| Inputs | design.md, implementation.md, analysis.md present |

## Summary

| Severity | Count |
|----------|-------|
| Critical | 0 |
| Warning | 2 |
| Suggestion | 3 |

**Verdict: Approve with comments**

The implementation correctly follows the design's binary display mode pattern (ADR-2), keeps `useRunLogs` unchanged (ADR-1), and uses the specified `LIVE_WINDOW_SIZE = 5`. Two warnings relate to dead code left behind after the refactor. No critical issues found.

## Critical Issues

None.

## Warnings

### W-1: Dead code -- `logEndRef` unused after refactor

| Field | Value |
|-------|-------|
| File | `RunOutputPanel.tsx` |
| Lines | 37, 257 |
| Severity | Warning |

**Observation**: `logEndRef` is declared at line 37 (`useRef<HTMLDivElement>(null)`) and placed in the JSX at line 257 (`<div ref={logEndRef} />`), but no effect or handler reads it. The scroll effect at lines 74-81 was simplified to only use `logContainerRef.scrollTop`. The sentinel `<div>` at line 257 serves no purpose.

**Recommendation**: Remove `logEndRef` declaration (line 37) and the sentinel `<div ref={logEndRef} />` (line 257). The scroll-to-bottom for historic logs is handled by `logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight` at line 77.

### W-2: Dead code -- `assistantText` display in historical view unreachable

| Field | Value |
|-------|-------|
| File | `RunOutputPanel.tsx` |
| Lines | 201-208 |
| Severity | Warning |

**Observation**: The historical view renders `{assistantText && (...)}` at lines 201-208. However, when `isRunning` becomes `false`, `useRunLogs(null)` is called, which triggers `setAssistantText('')` in the hook (see `use-run-logs.ts:24`). The condition `assistantText &&` is therefore always `false` in historical mode, making this block unreachable dead code.

**Recommendation**: Remove lines 201-208. The completed run's AI output is already captured in `selectedRun.summary` (displayed at lines 185-189). If the full assistant text should be shown in historical mode, a different data source is needed (e.g., fetching from the run record or a dedicated IPC call), but that is outside the scope of this change.

## Suggestions

### S-1: `HistoricalView` not extracted as specified in design

| Field | Value |
|-------|-------|
| File | `RunOutputPanel.tsx` |
| Lines | 156-261 |
| Severity | Suggestion (non-blocking) |

**Observation**: The design's Key Interfaces section specified three sub-components: `RunOutputHeader`, `LiveLoadingView`, and `HistoricalView`. The implementation extracted the first two but kept the historical view inline in `RunOutputPanel`. This is a minor deviation from the design.

**Recommendation**: Acceptable as-is. The historical view is inherently coupled to the parent's state (historicLogs, loadingLogs, historicToolCalls, logContainerRef), so extracting it would require passing many props. The inline approach is simpler and the parent function is still readable.

### S-2: `statusLabel` and `statusIcon` recreated every render

| Field | Value |
|-------|-------|
| File | `RunOutputPanel.tsx` |
| Lines | 111-133 |
| Severity | Suggestion (non-blocking) |

**Observation**: `statusLabel` and `statusIcon` are defined inside the `RunOutputPanel` function body, so they are recreated on every render. They are passed as props to `RunOutputHeader` and `LiveLoadingView`, which may cause unnecessary re-renders of those children.

**Recommendation**: Consider wrapping with `useCallback` or extracting to module scope (they only depend on `t`, which is stable from `useT()`). Low priority -- these are lightweight functions and the component is not in a high-frequency render path.

### S-3: Unused `relative` class in `LiveLoadingView`

| Field | Value |
|-------|-------|
| File | `RunOutputPanel.tsx` |
| Line | 332 |
| Severity | Suggestion (non-blocking) |

**Observation**: The `<div className="relative">` wrapping the `CircleNotch` icon at line 332 has no absolutely-positioned children. The `relative` class has no effect.

**Recommendation**: Remove the `relative` class, or remove the wrapper `<div>` entirely and apply the classes directly to `CircleNotch` if needed.

## Highlights

- Clean early-return branch pattern makes the two display modes easy to understand in isolation.
- `RunOutputHeader` extraction eliminates duplication of run selector + log dir button across both modes.
- `LiveLoadingView` is well-scoped with clear props interface and self-contained auto-scroll logic.
- No new dependencies introduced; all styling uses existing Tailwind classes and `@phosphor-icons/react`.
- Type check passes with zero errors.
