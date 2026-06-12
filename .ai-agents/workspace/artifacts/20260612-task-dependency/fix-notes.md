# Fix Notes: Task Dependency System

## Symptom

Code review identified 1 critical bug and 2 warnings in the task dependency system implementation.

## Input Source

Review artifact (`.ai-agents/workspace/artifacts/20260612-task-dependency/review.md`).

## Reproduction

Not applicable -- bugs identified via static analysis during code review.

## Root Cause

### C-1: `onDependencyResolved` filters wrong status category

The method checked `getStatusCategory(...) !== 'initial'` and skipped non-initial tasks. Per ADR-02, tasks with unresolved dependencies are in `blocked` status category, not `initial`. This caused the `continue` to skip every blocked task, preventing dependency resolution from ever triggering.

### W-1: `hasUnresolvedDependencies` hardcodes terminal statuses

The SQL query hardcoded `NOT IN ('done', 'cancelled')` for terminal status detection. If the process schema defines additional terminal statuses (e.g., `failed`, `archived`), they wouldn't be recognized as resolved.

### W-2: `loadAllDependencies` performs N+1 queries

The renderer store iterated over all tasks in an org and made a separate IPC call for each task. For an org with 100 tasks, this resulted in 100 IPC round-trips.

## Patch Summary

### C-1 Fix
- `apps/electron/src/core/modules/workflow/engines/behavior.engine.ts`: Changed filter from `!== 'initial'` to `=== 'terminal'` so blocked tasks are processed and only terminal tasks are skipped.

### W-1 Fix
- `apps/electron/src/core/modules/workflow/interfaces/i-task-dependency.repository.ts`: Added optional `terminalStatuses?: string[]` parameter to `hasUnresolvedDependencies`.
- `apps/electron/src/core/modules/workflow/persistence/sqlite-task-dependency.repository.ts`: Updated implementation to accept dynamic terminal status list with default fallback.
- `apps/electron/src/core/modules/workflow/engines/task.state-machine.ts`: Updated caller to pass terminal statuses from `processEngine.getStatusesByCategory(orgId, 'terminal')`.

### W-2 Fix
- `apps/electron/src/core/modules/workflow/services/task-dependency.service.ts`: Added `getDependenciesByOrgId(orgId)` method.
- `apps/electron/src/core/ipc-handlers/workflow.handlers.ts`: Added `capibara:dependency:list-by-org` IPC handler.
- `apps/electron/src/core/preload/index.ts`: Added `getTaskDependenciesByOrgId` preload method.
- `apps/electron/src/core/shared/api.ts`: Added `getTaskDependenciesByOrgId` to `CapibaraApi` interface.
- `apps/electron/src/renderer/store/task.store.ts`: Replaced N+1 loop with single batch call to `getTaskDependenciesByOrgId`.

## Regression Risk

- **C-1**: High impact if regressed -- dependency resolution would silently fail. No existing tests cover this path (t7-unit-tests pending).
- **W-1**: Low risk -- default fallback preserves existing behavior; callers can now pass schema-aware terminal statuses.
- **W-2**: Low risk -- batch endpoint uses existing `findByOrgId` repository method; single query replaces N queries.

## Follow-ups

- t7-unit-tests should verify: (1) `onDependencyResolved` transitions blocked tasks to pending, (2) `hasUnresolvedDependencies` respects custom terminal statuses, (3) batch dependency loading returns correct results.
