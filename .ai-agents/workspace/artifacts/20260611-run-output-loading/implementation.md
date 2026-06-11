# Implementation: Run Output Loading UX Redesign

## Implementation Plan

Single file modification to `RunOutputPanel.tsx`:
1. Add `LIVE_WINDOW_SIZE = 5` constant
2. Extract `RunOutputHeader` sub-component (run selector + log dir button)
3. Extract `LiveLoadingView` sub-component (loading animation + rolling log window)
4. Restructure `RunOutputPanel` to use early-return for `isRunning` state
5. Remove all `isRunning` conditional branches from historical view

## Changes

| File | Action | Intent |
|------|--------|--------|
| `apps/electron/src/renderer/components/tasks/RunOutputPanel.tsx` | Modified | Binary display mode: live-loading during execution, full historical view on completion |

## Implementation Details

### `RunOutputHeader` (lines 264-309)
Shared sub-component rendered in both running and historical modes. Contains:
- Run selector buttons (when multiple runs exist)
- "Open Logs Folder" button

### `LiveLoadingView` (lines 311-370)
Sub-component rendered only during `isRunning === true`. Contains:
- Card header with spinning `CircleNotch` icon (24px, blue, duotone), status badge, and start time
- Terminal-styled log area (`bg-zinc-950`, monospace) showing last 5 entries via `entries.slice(-LIVE_WINDOW_SIZE)`
- Auto-scroll to bottom on new entries (via `useEffect` on `visibleEntries.length`)
- "Waiting for output" state when entries are empty

### `RunOutputPanel` Restructure (lines 26-262)
- Early-return at line 135: if `isRunning && selectedRun`, render `RunOutputHeader` + `LiveLoadingView`
- Historical view (lines 156-261): unchanged layout, but all `isRunning` conditional branches removed
- `ToolCallTimeline` now always receives `isRunning={false}` (only rendered in historical mode)
- `AuditLogPanel` now always rendered when `selectedRunId` exists (no `!isRunning` guard needed)

## Design Compliance

| Check | Status |
|-------|--------|
| Files touched == Change Tracking | PASS (1 file modified) |
| Module/layer assignment (Renderer) | PASS |
| Public interfaces match design | PASS (`RunOutputHeader`, `LiveLoadingView` match Key Interfaces) |
| No forbidden cross-layer imports | PASS |
| No new external dependencies | PASS |
| `LIVE_WINDOW_SIZE = 5` as specified | PASS |
| Early-return branch pattern (ADR-2) | PASS |
| `useRunLogs` hook unchanged (ADR-1) | PASS |

## Change Tracking

| File | Action |
|------|--------|
| `apps/electron/src/renderer/components/tasks/RunOutputPanel.tsx` | Modified |

Total: 1 file modified, 0 files created, 0 files deleted.
