# Implementation: Task Execution Status Reliability

## Implementation Summary

Fixed the task re-execution loop bug where AI agents fail to call `capibara_task_transition` at the end of execution, causing tasks to be rolled back to initial status and re-scheduled indefinitely. The fix involves three coordinated changes: (1) moving the task-to-active transition before prompt construction so agents see the correct status, (2) replacing unconditional rollback on success with smart auto-advance to approval/terminal, and (3) enhancing the prompt instruction to emphasize the mandatory nature of the final transition.

## Files Touched

| File | Action | Intent |
|------|--------|--------|
| `apps/electron/src/core/modules/execution/engines/run.engine.ts` | Modified | Added `autoAdvanceOnSuccess` method; success path now auto-advances task to approval/terminal instead of rolling back; failure/cancel paths retain rollback behavior |
| `apps/electron/src/core/modules/orchestrator/run.coordinator.ts` | Modified | Added `ITaskRepository`, `IProcessEngine`, `ITaskStateMachine` dependencies; added `advanceTaskToActive` private method; calls it before `promptBuilder.buildForTask()` in `executeForTask()` |
| `apps/electron/src/core/bootstrap/orchestrator.module.ts` | Modified | Wired `taskRepo`, `processEngine`, `taskStateMachine` into `RunCoordinator` constructor |
| `apps/electron/src/core/modules/prompt/strategies/task-prompt.strategy.ts` | Modified | Rewrote `execute_leaf` instruction to state system has already started the task, emphasize mandatory transition, and warn against redundant pending->in_progress calls |

## Design Compliance

| Check | Result |
|-------|--------|
| Files touched match Change Tracking | Passed -- all 4 source files modified as specified |
| Module/layer placement correct | Passed -- RunCoordinator (D3) -> ITaskRepository/IProcessEngine/ITaskStateMachine (D1) is permitted |
| Public interfaces match design | Passed -- `advanceTaskToActive` and `autoAdvanceOnSuccess` signatures match design's Key Interfaces |
| No forbidden cross-layer imports | Passed -- verified via type-check |
| No new external dependencies | Passed -- only existing internal interfaces used |

## Deviations from Design

- **orchestrator.module.ts instead of composition-root.ts**: The design listed `composition-root.ts` as the wiring target, but `RunCoordinator` is actually instantiated in `orchestrator.module.ts`. The wiring was done in the correct location.

## Self-Check Results

- **Type-check**: `tsc --noEmit` passed with zero errors
- **Suggested tests**: `pnpm --filter @capibara/electron test` to verify existing tests still pass; new tests recommended for `autoAdvanceOnSuccess` behavior

## Open TODOs

- Tests for `autoAdvanceOnSuccess`: task in `in_progress` auto-advances to `awaiting_review` on success
- Tests for `autoAdvanceOnSuccess` fallback to terminal when no approval transition exists
- Tests for rollback still working on failure/cancel
- Tests for `RunCoordinator.advanceTaskToActive` being called before prompt build
- Tests for prompt showing `in_progress` status in `execute_leaf` scenario
