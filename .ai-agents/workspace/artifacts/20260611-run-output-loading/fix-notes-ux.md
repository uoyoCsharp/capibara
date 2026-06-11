# Fix Notes: Live Loading View UX Improvements

## Symptom
User reported three issues with the live loading view:
1. Ugly visual effect (dark terminal style didn't match app aesthetic)
2. Displayed multiple log entries instead of latest activity
3. Raw JSON output was not user-friendly (e.g., `{"type":"tool_call_update","toolCallId":"call_825f9083552e437a9a074"...}`)

## Input Source
Direct user feedback after testing

## Root Cause
The `LiveLoadingView` component was designed with:
- Dark terminal styling (`bg-zinc-950`) that clashed with the app's clean design
- Rolling window of 5 entries (`LIVE_WINDOW_SIZE = 5`) showing historical logs
- Raw log chunks displayed without filtering structured markers
- `parseLogChunk()` fell back to `JSON.stringify()` for tool_call_update (which has no title field)

## Patch Summary
| File | Change |
|------|--------|
| `RunOutputPanel.tsx` | Redesigned `LiveLoadingView`: clean card design, single latest entry display, JSON parsing |
| `RunOutputPanel.tsx` | Added `isStructuredMarker()` to filter `tool_call_start`, `tool_call_update`, `plan` markers |
| `RunOutputPanel.tsx` | Updated `parseLogChunk()` to return `null` for structured markers |
| `RunOutputPanel.tsx` | Added `useToolCalls()` hook to get active tool call with proper title |
| `RunOutputPanel.tsx` | Display priority: active tool call title > latest plain-text log > waiting state |
| `RunOutputPanel.tsx` | Removed `LIVE_WINDOW_SIZE` constant (no longer needed) |
| `RunOutputPanel.tsx` | Moved spinner to header, activity indicator in content area with fade animation |

## Design Changes
- **Layout**: Spinner moved to header row with status; content area shows single activity line
- **Animation**: Smooth fade-out/fade-in transition when activity text changes:
  - Fade out current text (150ms) → swap text → fade in new text (150ms)
  - Uses `transition-opacity duration-150` with `isVisible` state toggle
  - Proper cleanup of pending timers on unmount
- **Filtering**: Structured markers (`tool_call_start`, `tool_call_update`, `plan`) filtered from log entries
- **Tool calls**: Use `useToolCalls()` hook to get the currently running tool's title
- **Priority**: Active tool call title takes precedence over plain-text logs
- **Styling**: Uses `bg-muted/30` and `bg-background` instead of dark terminal colors

## Regression Risk
Low. Changes are isolated to the running state display:
- Historical view (completed runs) unchanged
- Structured marker filtering is defensive (returns `null` on parse failure)
- Tool call title display uses existing `useToolCalls()` hook
- Animation uses existing Tailwind utilities (no new dependencies)

## Follow-ups
None. Typecheck passes.
