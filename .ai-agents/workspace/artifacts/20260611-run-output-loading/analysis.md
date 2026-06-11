# Requirements Analysis: Run Output Loading UX Redesign

## Feature Overview

Redesign the "Run Output" tab on the task detail page to improve the user experience during active AI agent execution. Currently, the panel displays three separate sections (AI assistant text, tool call timeline, execution log terminal) during a running execution, all backed by transient React state that is lost when the user navigates away. The redesign replaces the entire running-state display with a single, visually appealing loading animation that scrolls the latest log entry into view. Once the run completes, the panel automatically transitions to the full historical view with persisted logs, tool calls, audit data, and summary.

**Core insight**: The log file (persisted via `fileLogService.append` in `run.engine.ts`) already captures all streaming output. The issue is purely visual -- the current running-state display is cluttered and provides a poor first-impression. A clean, focused loading experience is preferable to showing raw streaming data in real time.

## Actors

| Actor | Description |
|-------|-------------|
| User (Human) | Views the task detail page to monitor AI agent execution progress. Opens the "Run Output" tab to see what the agent is doing. |
| AI Agent (indirect) | The run executor that produces log output, assistant text, and tool calls. Its output is already fully persisted to the log file. |

## Requirements

### FR-1: Running-State Display

When the selected run has status `running`, the RunOutputPanel shall display a single unified view consisting of:

1. A visually appealing loading/waiting animation indicating that execution is in progress.
2. The latest log entry (from `run:log` streaming events) displayed prominently on the loading interface.
3. Automatic scrolling to reveal the newest entry as it arrives.

The following sections shall be **hidden** during the running state:
- AI assistant text (Markdown panel)
- Tool call timeline
- Audit log panel
- Run summary (status/tokens/time/AI summary/error)

### FR-2: Completion Transition

When the run transitions from `running` to a terminal status (`succeeded`, `failed`, `cancelled`, `interrupted`) or `suspended`, the panel shall automatically switch to the full historical view, which includes:

1. Run summary (status badge, token count, start time, AI summary, error message)
2. AI assistant text (rendered as Markdown)
3. Tool call timeline (historic)
4. Audit log panel (tool calls + file access tables)
5. Execution log terminal (persisted logs from `api().getRunLogs()`, with truncation for large logs)

### FR-3: Run Selector Preservation

The run selector (shown when multiple runs exist for a task) shall remain visible regardless of run status, allowing the user to switch between runs at any time.

### FR-4: Log Directory Access

The "Open Logs Folder" button shall remain accessible during both running and completed states.

### FR-5: No-Data Waiting State

When a run has just started and no log entries have arrived yet, the loading animation shall display without any log entry text -- just the waiting indicator.

### FR-6: Data Source

During the running state, the latest log entry shall be sourced from the real-time `run:log` IPC streaming events (via the existing `useRunLogs` hook). No changes to the persistence layer are required.

### FR-7: Auto-Scroll Behavior

The display shall automatically scroll to show the latest log entry when new entries arrive. Manual scroll-up by the user should not be interrupted (auto-scroll should only engage when the user is already at the bottom, or always scroll to latest -- to be determined in design).

## Domain Concepts

| Concept | Description |
|---------|-------------|
| Run State Display Mode | Binary display mode: `live-loading` (run is active) vs `historical` (run is terminal). Determines which UI layout is rendered. |
| Live Log Entry | A single log chunk received via `run:log` streaming event during execution. Contains `stream` (stdout/stderr) and `chunk` (text content). |
| Loading Animation | A visual indicator (spinner, pulse, or similar) that communicates "execution in progress" to the user. |

## Business Rules

### BR-1: Display Mode Determination

The display mode is determined solely by the selected run's `status` field:
- `status === 'running'` -> `live-loading` mode
- `status !== 'running'` -> `historical` mode

### BR-2: Transition Trigger

The transition from `live-loading` to `historical` mode is triggered by:
- The `run:completed` IPC event (covers `succeeded`, `failed`, `cancelled`)
- The `run:suspended` IPC event
- Manual re-fetch when the user selects a different run

### BR-3: Log Entry Display Strategy

During `live-loading` mode, only the latest log entry (or a small rolling window of recent entries) is displayed. The full accumulated log is NOT shown during execution -- it becomes available only in `historical` mode via `api().getRunLogs()`.

### BR-4: No Persistence Changes Required

This feature does not modify any backend persistence, event emission, or log file writing logic. The change is entirely within the renderer layer (`RunOutputPanel.tsx` and potentially `use-run-logs.ts`).

## Ambiguities & Questions

### A-1: Loading Animation Style [LOW IMPACT]

The specific visual design of the "beautiful loading effect" is not prescribed. Options include:
- Pulsing/breathing animation with a centered spinner
- A terminal-style cursor blink with the latest entry
- A card-based layout with a subtle loading indicator and the latest entry below it

**Resolution**: To be determined during `/mvt-design` phase. The analyst recommends a clean, minimal design consistent with the existing Tailwind/shadcn design system.

### A-2: Rolling Window Size [LOW IMPACT]

How many recent log entries should be visible during the live-loading state? Options:
- Only the single latest entry
- A small rolling window (e.g., last 5-10 entries) for context

**Resolution**: The user's description says "latest record" (singular), suggesting a single entry. However, a small rolling window may provide better context. To be decided in design.

### A-3: Suspended State Display [LOW IMPACT]

When a run is `suspended` (waiting for AI-to-AI inquiry response), should it show the `live-loading` mode (since the run is still active) or the `historical` mode (since output is paused)?

**Resolution**: Based on the business rule BR-1, `suspended` !== `running`, so it would show `historical` mode. This seems correct -- the user can see what the agent did before suspension.

## Change Tracking

| Field | Value |
|-------|-------|
| Change ID | `20260611-run-output-loading` |
| Title | Run Output Loading UX Redesign |
| Status | Analyzed |
| Scope | Renderer only -- `RunOutputPanel.tsx`, `use-run-logs.ts` |
| Affected files (estimate) | 2-3 files |
| Backend changes | None |
| Dependencies | None |
