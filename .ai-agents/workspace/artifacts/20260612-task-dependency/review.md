# Code Review Report

## Review Scope

| Axis | Detail |
|------|--------|
| Change | 20260612-task-dependency (Task Dependency System) |
| Depth | Full review (all axes) |
| Aspect | All (architecture, quality, errors, edge-cases, security) |
| Files | 19 files across t1-t6 (all tasks except t7-unit-tests) |
| Fallbacks | None -- design.md, implementation.md, and project-context.md all available |

## Summary

| Severity | Count |
|----------|-------|
| Critical | 1 |
| Warning | 2 |
| Suggestion | 2 |

**Verdict: Request changes**

A critical bug in `BehaviorEngine.onDependencyResolved` will prevent dependency resolution from ever triggering. The method filters for tasks in `initial` status category, but tasks with dependencies should be in `blocked` status category per ADR-02. This means the core feature -- automatically unblocking dependent tasks when prerequisites complete -- will not work.

## Critical Issues

### C-1: `onDependencyResolved` filters wrong status category

| Field | Value |
|-------|-------|
| File | `apps/electron/src/core/modules/workflow/engines/behavior.engine.ts` |
| Line | 61 |
| Severity | Critical |

**Observation**: The code checks `getStatusCategory(...) !== 'initial'` and skips non-initial tasks. Per ADR-02, tasks with unresolved dependencies are transitioned to `blocked` status, which belongs to the `blocked` category -- not `initial`. This means the `continue` on line 61 will skip every blocked task, and `onDependencyResolved` will never transition any task from blocked to pending.

```ts
// Current (broken):
if (this.processEngine.getStatusCategory(dependentTask.orgId, dependentTask.status) !== 'initial') continue;

// Should be (one of):
if (this.processEngine.getStatusCategory(dependentTask.orgId, dependentTask.status) === 'terminal') continue;
// OR:
if (dependentTask.status !== 'blocked') continue;
```

**Impact**: Core feature non-functional. Dependent tasks will remain `blocked` indefinitely even after all prerequisites complete. Users would need to manually transition tasks.

**Recommendation**: Change the filter to skip terminal tasks (or specifically check for `blocked` status). Run `/mvt-fix` to apply the fix.

## Warnings

### W-1: `hasUnresolvedDependencies` hardcodes terminal statuses

| Field | Value |
|-------|-------|
| File | `apps/electron/src/core/modules/workflow/persistence/sqlite-task-dependency.repository.ts` |
| Line | 92 |
| Severity | Warning |

**Observation**: The SQL query hardcodes `NOT IN ('done', 'cancelled')` for terminal status detection. If the process schema defines additional terminal statuses (e.g., `failed`, `archived`), they won't be recognized as resolved.

**Impact**: Dependencies may be considered "unresolved" even when the dependency task is in a terminal status that isn't `done` or `cancelled`.

**Recommendation**: Consider passing terminal status list as a parameter, or use the process engine to determine terminal statuses. Alternatively, document that only `done` and `cancelled` are considered terminal for dependency resolution.

### W-2: `loadAllDependencies` performs N+1 queries

| Field | Value |
|-------|-------|
| File | `apps/electron/src/renderer/store/task.store.ts` |
| Line | 56-66 |
| Severity | Warning |

**Observation**: `loadAllDependencies` iterates over all tasks in an org and makes a separate API call for each task. For an org with 100 tasks, this results in 100 IPC round-trips.

**Impact**: Slow UI performance for large orgs. Each `getTaskDependencies` call crosses the IPC boundary.

**Recommendation**: Add a batch endpoint `getDependenciesByOrgId(orgId)` that returns all dependencies for all tasks in one query. The repository already has `findByOrgId`.

## Suggestions

### S-1: `canReach` uses O(n) `queue.shift()`

| Field | Value |
|-------|-------|
| File | `apps/electron/src/core/modules/workflow/persistence/sqlite-task-dependency.repository.ts` |
| Line | 107 |
| Severity | Suggestion |

**Observation**: BFS uses `queue.shift()` which is O(n) on JavaScript arrays. For large dependency graphs this could be slow.

**Recommendation**: Use an index pointer instead: `let head = 0; while (head < queue.length) { const current = queue[head++]; ... }`. In practice, task dependency graphs are small so this is unlikely to matter.

### S-2: `DependencySelector` could debounce task search

| Field | Value |
|-------|-------|
| File | `apps/electron/src/renderer/components/tasks/DependencySelector.tsx` |
| Line | N/A |
| Severity | Suggestion |

**Observation**: The task dropdown uses a static `Select` component that shows all available tasks. For orgs with many tasks, this could be overwhelming.

**Recommendation**: Consider a searchable/combobox-style input for better UX when there are many tasks. This is a polish improvement, not a blocker.

## Highlights

- Clean separation of concerns: repository handles persistence, service handles validation/cycle detection, engines handle state transitions
- Consistent use of interfaces across module boundaries (ITaskDependencyRepository, ITaskService, IBehaviorEngine)
- Good error handling at IPC boundaries with specific error codes
- `batchCreate` dependency resolution correctly builds title-to-id map before resolving, avoiding ordering issues
- UI components follow existing patterns (shadcn/ui, Zustand store, toast notifications)

## Skipped Checks

None -- all review inputs were available.

## Recommended Next Skill

`/mvt-fix` -- Fix C-1 (BehaviorEngine status category filter) before proceeding to tests.
