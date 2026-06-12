# Implementation: Task Dependency System

## Task: t1-migration-types -- Database migration and domain types

### Implementation Summary

Added the foundational database schema and TypeScript domain types for the task dependency system. Migration v3 creates the `task_dependencies` table with proper foreign key constraints and indexes. Domain types `TaskDependency`, `CreateTaskDependencyInput` were added to `workflow.types.ts`, and `BatchCreateTaskInput` was extended with an optional `dependsOn` field for planning mode support.

### Files Touched

| Path | Action | Intent |
|------|--------|--------|
| `apps/electron/src/core/infrastructure/persistence/sqlite/migrations.ts` | modify | Add migration v3 for `task_dependencies` table |
| `apps/electron/src/core/modules/workflow/types/workflow.types.ts` | modify | Add `TaskDependency`, `CreateTaskDependencyInput` types; extend `BatchCreateTaskInput` |

### Design Compliance

| Check | Result |
|-------|--------|
| Files touched == Change Tracking | Passed -- both files from plan's `artifacts.files` |
| Module/layer assignment | Passed -- migration in infrastructure (Secondary), types in Workflow (D1) |
| Public interfaces match Key Interfaces | Passed -- `TaskDependency`, `CreateTaskDependencyInput`, extended `BatchCreateTaskInput` match design |
| Forbidden cross-layer imports | Passed -- no new imports introduced |
| Error handling at boundaries only | N/A -- no runtime code added yet |
| No new external deps | Passed -- no package.json changes |

### Deviations from Design

None.

### Self-Check Results

- **TypeScript**: `tsc --noEmit` passes with 0 errors
- **Tests**: 1116 passed, 4 failed (pre-existing failures in `run-coordinator.test.ts` unrelated to this change)
- **Migration**: v3 adds `task_dependencies` table with correct schema, FK constraints, and indexes

### Open TODOs

- t3: Integrate dependency checks into `TaskStateMachine` and `BehaviorEngine`

---

## Task: t2-repository-service -- Dependency repository and service with cycle detection

### Implementation Summary

Created the dependency repository interface, SQLite implementation, and service layer with DFS-based cycle detection. `ITaskDependencyRepository` defines the contract for CRUD operations and graph queries. `SqliteTaskDependencyRepository` implements all methods including `canReach` (BFS-based reachability check for cycle detection) and `hasUnresolvedDependencies` (joins with tasks table to check terminal status). `TaskDependencyService` orchestrates dependency creation with validation: self-dependency rejection, cycle detection via `canReach`, same-org enforcement, and duplicate prevention.

### Files Touched

| Path | Action | Intent |
|------|--------|--------|
| `apps/electron/src/core/modules/workflow/interfaces/i-task-dependency.repository.ts` | create | Define repository interface for dependency CRUD and graph queries |
| `apps/electron/src/core/modules/workflow/persistence/sqlite-task-dependency.repository.ts` | create | SQLite implementation with BFS reachability and unresolved dependency check |
| `apps/electron/src/core/modules/workflow/services/task-dependency.service.ts` | create | Service layer with cycle detection, validation, and dependency management |

### Design Compliance

| Check | Result |
|-------|--------|
| Files touched == Change Tracking | Passed -- all 3 files from plan's `artifacts.files` |
| Module/layer assignment | Passed -- interface in Workflow/interfaces, persistence in Workflow/persistence, service in Workflow/services (all D1) |
| Public interfaces match Key Interfaces | Passed -- `ITaskDependencyRepository` matches design spec exactly |
| Forbidden cross-layer imports | Passed -- only imports from `@core/foundation` (errors) and local types |
| Error handling at boundaries only | Passed -- validation errors thrown at service boundary, DB errors propagate naturally |
| No new external deps | Passed -- no package.json changes |

### Deviations from Design

None.

### Self-Check Results

- **TypeScript**: `tsc --noEmit` passes with 0 errors
- **Tests**: 1116 passed, 4 failed (pre-existing failures in `run-coordinator.test.ts` unrelated to this change)
- **Cycle detection**: BFS-based `canReach` correctly identifies direct and transitive cycles
- **hasUnresolvedDependencies**: SQL join with tasks table checks for non-terminal status

### Open TODOs

- t3: Integrate dependency checks into `TaskStateMachine` and `BehaviorEngine`
- t3: Wire `TaskDependencyRepository` and `TaskDependencyService` in `workflow.module.ts` and `composition-root.ts`

---

## Task: t3-state-machine-behavior -- State machine and behavior engine integration

### Implementation Summary

Integrated the dependency system into the core workflow engines. `TaskStateMachine` now injects `ITaskDependencyRepository` and checks for unresolved dependencies before allowing transitions to active status (defense in depth per ADR-05). After emitting `task:completed`, it calls `behaviorEngine.onDependencyResolved()` to trigger dependency resolution. `BehaviorEngine` gained `onDependencyResolved()` method that queries dependents of the completed task, checks if all their dependencies are terminal, and transitions qualifying tasks from blocked to pending. `ITaskService` and `TaskService` were extended with dependency CRUD methods (`addDependency`, `removeDependency`, `getDependencies`, `getDependents`). `workflow.module.ts` wires all new dependencies including `TaskDependencyRepository`, `TaskDependencyService`, and setter methods on `TaskStateMachine`, `BehaviorEngine`, and `TaskService`. New DI tokens `TASK_DEPENDENCY_REPO_TOKEN` and `TASK_DEPENDENCY_SERVICE_TOKEN` were added to `tokens.ts`.

### Files Touched

| Path | Action | Intent |
|------|--------|--------|
| `apps/electron/src/core/modules/workflow/engines/task.state-machine.ts` | modify | Inject dep repo, add blocked status check, call onDependencyResolved |
| `apps/electron/src/core/modules/workflow/engines/behavior.engine.ts` | modify | Add onDependencyResolved method with dependency resolution logic |
| `apps/electron/src/core/modules/workflow/interfaces/i-task.service.ts` | modify | Add dependency CRUD method signatures |
| `apps/electron/src/core/modules/workflow/interfaces/i-behavior.engine.ts` | modify | Add onDependencyResolved signature |
| `apps/electron/src/core/modules/workflow/services/task.service.ts` | modify | Add dependency CRUD methods and setDependencyRepo setter |
| `apps/electron/src/core/bootstrap/workflow.module.ts` | modify | Wire TaskDependencyRepository, TaskDependencyService, and setters |
| `apps/electron/src/core/foundation/tokens.ts` | modify | Add TASK_DEPENDENCY_REPO_TOKEN and TASK_DEPENDENCY_SERVICE_TOKEN |

### Design Compliance

| Check | Result |
|-------|--------|
| Files touched == Change Tracking | Passed -- all 7 files from plan's `artifacts.files` |
| Module/layer assignment | Passed -- all changes in Workflow module (D1) and Foundation |
| Public interfaces match Key Interfaces | Passed -- all interface extensions match design spec |
| Forbidden cross-layer imports | Passed -- no layer violations |
| Error handling at boundaries only | Passed -- dependency check at transition boundary, behavior engine handles errors internally |
| No new external deps | Passed -- no package.json changes |

### Deviations from Design

None.

### Self-Check Results

- **TypeScript**: `tsc --noEmit` passes with 0 errors
- **Tests**: 1116 passed, 4 failed (pre-existing failures in `run-coordinator.test.ts` unrelated to this change)
- **Dependency check**: TaskStateMachine rejects transition to active when unresolved dependencies exist
- **Dependency resolution**: BehaviorEngine transitions blocked->pending when all deps terminal

### Open TODOs

- t4: Add events, IPC handlers, preload, and shared API contract
- t5: Build UI dependency selector and blocked status display
- t6: Add planning mode dependency support

---

## Task: t4-api-ipc -- Events, IPC handlers, preload, and shared API contract

### Implementation Summary

Added the IPC/API layer for the task dependency system. Three new domain events (`task:dependency-added`, `task:dependency-removed`, `task:dependency-resolved`) were added to `events.ts` with corresponding Zod schemas in `event-schemas.ts`. `TaskDependencyRecord` was added to `shared/types.ts` with denormalized title/status fields for UI convenience. Four new IPC channels (`capibara:dependency:list`, `capibara:dependency:dependents`, `capibara:dependency:add`, `capibara:dependency:remove`) were registered in `workflow.handlers.ts`, which now accepts `TaskDependencyService` as a parameter. Matching preload methods were added to `preload/index.ts`, and `CapibaraApi` in `shared/api.ts` was extended with 4 typed dependency methods. `composition-root.ts` was updated to pass `taskDependencyService` to `registerWorkflowHandlers`.

### Files Touched

| Path | Action | Intent |
|------|--------|--------|
| `apps/electron/src/core/foundation/events.ts` | modify | Add 3 dependency payload types + DomainEventMap entries |
| `apps/electron/src/core/foundation/event-schemas.ts` | modify | Add Zod schemas for 3 dependency events |
| `apps/electron/src/core/shared/types.ts` | modify | Add `TaskDependencyRecord` with denormalized fields |
| `apps/electron/src/core/shared/api.ts` | modify | Add 4 dependency API methods to `CapibaraApi` |
| `apps/electron/src/core/ipc-handlers/workflow.handlers.ts` | modify | Add `TaskDependencyService` param + 4 IPC handlers with denormalization |
| `apps/electron/src/core/preload/index.ts` | modify | Add 4 dependency preload methods |
| `apps/electron/src/core/bootstrap/composition-root.ts` | modify | Pass `taskDependencyService` to `registerWorkflowHandlers` |

### Design Compliance

| Check | Result |
|-------|--------|
| Files touched == Change Tracking +/- deviation | Passed -- 7 files touched; `composition-root.ts` is a necessary wiring change (not in plan's `artifacts.files` hint but required by handler signature change) |
| Module/layer assignment | Passed -- events in Foundation, types in Shared, IPC in infrastructure, preload in infrastructure |
| Public interfaces match Key Interfaces | Passed -- all 4 API methods + `TaskDependencyRecord` match design spec |
| Forbidden cross-layer imports | Passed -- no layer violations |
| Error handling at boundaries only | Passed -- IPC handlers catch at boundary, services throw domain errors |
| No new external deps | Passed -- no package.json changes |

### Deviations from Design

- `composition-root.ts` added beyond plan's `artifacts.files` hint -- required because `registerWorkflowHandlers` signature changed to accept `TaskDependencyService`.

### Self-Check Results

- **TypeScript**: `tsc --noEmit` passes with 0 errors
- **Event schemas**: All 3 new events have matching Zod schemas in `event-schemas.ts`
- **Preload/API parity**: 4 preload methods match 4 `CapibaraApi` methods

### Open TODOs

- t5: Build UI dependency selector and blocked status display
- t6: Add planning mode dependency support
- t7: Write unit tests for dependency system

---

## Task: t5-ui-components -- UI dependency selector and blocked status display

### Implementation Summary

Extended the task store with dependency management capabilities: `dependencies` state array, `loadDependencies(taskId)` for per-task loading, `loadAllDependencies(orgId)` for batch loading, and `addDependency`/`removeDependency` actions with optimistic UI updates. Created `DependencySelector` component that displays current dependencies with status indicators (check/spin/lock/clock icons), allows adding new dependencies via a filtered task dropdown (excludes self, already-linked, terminal tasks), and shows error toast on cycle detection. Integrated `DependencySelector` into `TaskDetailDrawer` with automatic dependency loading on open. Added blocked status indicator (filled red lock icon) to `TasksPage` task rows alongside the existing status badge coloring.

### Files Touched

| Path | Action | Intent |
|------|--------|--------|
| `apps/electron/src/renderer/store/task.store.ts` | modify | Add `dependencies` state, `loadDependencies`, `loadAllDependencies`, `addDependency`, `removeDependency` actions |
| `apps/electron/src/renderer/components/tasks/DependencySelector.tsx` | create | New component for displaying and managing task dependencies with status indicators |
| `apps/electron/src/renderer/components/tasks/TaskDetailDrawer.tsx` | modify | Add `tasks` prop, import `DependencySelector`, add dependencies section, auto-load dependencies on open |
| `apps/electron/src/renderer/components/tasks/TasksPage.tsx` | modify | Add `Lock` icon import, add blocked indicator to task rows, pass `tasks` to `TaskDetailDrawer` |

### Design Compliance

| Check | Result |
|-------|--------|
| Files touched == Change Tracking +/- deviation | Passed -- all 4 files from plan's `artifacts.files` |
| Module/layer assignment | Passed -- store in renderer/store, components in renderer/components/tasks |
| Public interfaces match Key Interfaces | Passed -- uses `TaskDependencyRecord` from shared types, API methods from t4 |
| Forbidden cross-layer imports | Passed -- only imports from `@core/shared/types` (shared layer) and local renderer modules |
| Error handling at boundaries only | Passed -- error handling at API call boundaries, toast notifications for user feedback |
| No new external deps | Passed -- no package.json changes |

### Deviations from Design

None.

### Self-Check Results

- **TypeScript**: `tsc --noEmit` passes with 0 errors
- **DependencySelector**: Filters out self, already-linked, and terminal tasks from available options
- **Blocked indicator**: Red filled lock icon appears on task rows with `status === 'blocked'`
- **Store integration**: Dependencies load automatically when TaskDetailDrawer opens, update optimistically on add/remove

### Open TODOs

- t6: Add planning mode dependency support
- t7: Write unit tests for dependency system

---

## Task: t6-planning-mode -- Planning mode dependency support

### Implementation Summary

Extended the plan tree submission flow to support `dependsOn` field in tree nodes. `PlanTreeNode` interface in `events.ts` now includes optional `dependsOn?: string[]`. The Zod schema in `event-schemas.ts` was updated to validate the new field. `plan-tree-tool.provider.ts` was updated to recognize and pass through `dependsOn` during structural validation and normalization. `TaskService.batchCreate` was extended to build a title→id map from all created tasks, then resolve `dependsOn` title references to actual task IDs and create dependency relationships via `dependencyRepo.create()` with cycle detection using `canReach()`.

### Files Touched

| Path | Action | Intent |
|------|--------|--------|
| `apps/electron/src/core/foundation/events.ts` | modify | Add `dependsOn?: string[]` to `PlanTreeNode` interface |
| `apps/electron/src/core/foundation/event-schemas.ts` | modify | Add `dependsOn` to `PlanTreeNodeSchema` Zod schema |
| `apps/electron/src/core/mcp/providers/plan-tree-tool.provider.ts` | modify | Update `isDraftNode` and `normalizeDraftNode` to handle `dependsOn` |
| `apps/electron/src/core/modules/workflow/services/task.service.ts` | modify | Extend `batchCreate` with title→id map, dependency resolution, and cycle detection |

### Design Compliance

| Check | Result |
|-------|--------|
| Files touched == Change Tracking +/- deviation | Passed -- all 4 files from plan's `artifacts.files` |
| Module/layer assignment | Passed -- events in Foundation, schema in Foundation, MCP provider in infrastructure/mcp-protocol, service in Workflow (D1) |
| Public interfaces match Key Interfaces | Passed -- `PlanTreeNode` extended with `dependsOn`, `BatchCreateTaskInput` already had `dependsOn` from t1 |
| Forbidden cross-layer imports | Passed -- no layer violations |
| Error handling at boundaries only | Passed -- validation errors thrown at service boundary for invalid dependency targets and cycles |
| No new external deps | Passed -- no package.json changes |

### Deviations from Design

None.

### Self-Check Results

- **TypeScript**: `tsc --noEmit` passes with 0 errors
- **Plan tree schema**: `dependsOn` is optional, validated as `string[]` when present
- **MCP provider**: `isDraftNode` accepts nodes with or without `dependsOn`; `normalizeDraftNode` passes it through
- **batchCreate**: Builds title→id map, resolves dependencies after all tasks created, throws `ValidationError` on missing target or cycle

### Open TODOs

- t7: Write unit tests for dependency system
