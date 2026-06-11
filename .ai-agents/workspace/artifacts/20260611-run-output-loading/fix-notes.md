# Fix Notes: Run Output Loading UX - Dead Code Cleanup

## Symptom
Code review identified two dead code warnings in `RunOutputPanel.tsx` after the binary display mode refactor.

## Input Source
Review artifact (`review.md` from `/mvt-review`)

## Reproduction
Not applicable (static analysis findings)

## Root Cause
The refactor to binary display mode (live-loading vs historical) left behind code that was only relevant to the previous implementation:
- `logEndRef` was used for auto-scroll in the old unified view, but the new scroll logic uses `logContainerRef.scrollTop` directly
- `assistantText` display in historical view was unreachable because `useRunLogs(null)` clears the text when the run completes

## Patch Summary
| File | Change |
|------|--------|
| `RunOutputPanel.tsx` | Removed `logEndRef` declaration and sentinel `<div>` |
| `RunOutputPanel.tsx` | Removed unreachable `assistantText` block in historical view |
| `RunOutputPanel.tsx` | Removed unused `assistantText` from `useRunLogs` destructuring |

## Regression Risk
Low. All changes are dead code removal:
- `logEndRef` was never read after the scroll effect was simplified
- `assistantText` was always empty in historical mode due to `useRunLogs(null)` clearing it
- Completed run AI output is still displayed via `selectedRun.summary`

## Follow-ups
None. Typecheck passes.
