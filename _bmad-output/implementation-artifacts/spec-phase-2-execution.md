---
title: 'Phase 2 — Execution Module (Layer 0)'
type: 'feature'
created: '2026-04-17'
status: 'done'
baseline_commit: '1ed35b6'
context:
  - '_bmad-output/planning-artifacts/refactoring-architecture-plan.md'
  - '_bmad-output/planning-artifacts/implementation-plan.md'
  - '_bmad-output/project-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** No module can call Claude AI yet. The Execution layer (Layer 0) is the pure AI runtime that all higher layers depend on — without it, no Run can be created, no cost tracked, and no AI output captured.

**Approach:** Create the `src/core/modules/execution/` module with domain types, repository interfaces + SQLite implementations, RunEngine orchestration, Worker process management (Electron utilityProcess), stream parsers for Claude CLI output, file-based logging, cost tracking, and a DI bootstrap module. Adapts patterns from legacy `src/main/` with new naming conventions (wakeReason, taskId, conversationId).

## Boundaries & Constraints

**Always:**
- All code under `apps/electron/src/core/modules/execution/` + `src/core/bootstrap/execution.module.ts`
- Import shared infrastructure from `@core/foundation/` and `@core/infrastructure/`
- Use new naming: `wakeReason` (not trigger), `taskId` (not taskNodeId), `conversationId` (not sessionId for DB FK)
- RunEngine is pure runtime — no task transitions, no conversation state changes, no orchestration logic
- better-sqlite3 is synchronous — no unnecessary async/await in repositories
- Worker uses Electron `utilityProcess.fork()` for isolated process

**Ask First:**
- If RunEngine needs to generate MCP configs/JWT tokens (may defer to Phase 7)
- If any new npm dependency is needed

**Never:**
- No task lifecycle logic (Phase 8)
- No conversation state management (Phase 5)
- No orchestration decisions (Phase 8)
- Do not modify `src/main/`, `src/shared/`, or `src/renderer/`

</frozen-after-approval>

## Code Map

- `modules/execution/types/execution.types.ts` -- Run, RunStatus, CostEntry, WakeReason, ExecutorInput/Output, RunExecutionParams, RunResult
- `modules/execution/interfaces/i-run.repository.ts` -- IRunRepository (CRUD + queries)
- `modules/execution/interfaces/i-cost-entry.repository.ts` -- ICostEntryRepository
- `modules/execution/interfaces/i-executor.ts` -- IExecutor (execute, abort, onLog)
- `modules/execution/interfaces/i-run-engine.ts` -- IRunEngine (execute, cancelRun, onLog, onAssistantText)
- `modules/execution/persistence/sqlite-run.repository.ts` -- SqliteRunRepository
- `modules/execution/persistence/sqlite-cost-entry.repository.ts` -- SqliteCostEntryRepository
- `modules/execution/engines/run.engine.ts` -- RunEngine: budget check → create Run → call executor → parse → cost → events
- `modules/execution/workers/worker-protocol.ts` -- ParentMessage/ChildMessage types
- `modules/execution/workers/worker-service.ts` -- WorkerService (utilityProcess lifecycle)
- `modules/execution/workers/worker.ts` -- Worker (per-role serial queue + adapter execution)
- `modules/execution/workers/utility-process.executor.ts` -- UtilityProcessExecutor implements IExecutor
- `modules/execution/workers/stream-json-parser.ts` -- Real-time NDJSON parser
- `modules/execution/workers/claude-stream-parser.ts` -- Batch result parser (cost/session extraction)
- `modules/execution/logging/file-log.service.ts` -- JSONL file logging with write queue
- `modules/execution/services/cost-tracker.ts` -- CostTracker (post-run cost recording)
- `bootstrap/execution.module.ts` -- DI registration for all execution components

## Tasks & Acceptance

**Execution:**
- [x] `modules/execution/types/execution.types.ts` -- Define Run, RunStatus, CostEntry, WakeReason, ExecutorInput, ExecutorOutput, RunExecutionParams, RunResult, AdapterCliConfig
- [x] `modules/execution/interfaces/i-run.repository.ts` -- IRunRepository: findById, findByOrgId, findByTaskId, findActiveByRoleId, findActiveByOrgId, create, updateStatus, finish
- [x] `modules/execution/interfaces/i-cost-entry.repository.ts` -- ICostEntryRepository: findByRunId, findByOrgId, getTotalTokensByOrgId, create
- [x] `modules/execution/interfaces/i-executor.ts` -- IExecutor: execute(ExecutorInput) → Promise<ExecutorOutput>, abort(runId), onLog(callback)
- [x] `modules/execution/interfaces/i-run-engine.ts` -- IRunEngine: execute(RunExecutionParams) → Promise<RunResult>, cancelRun(runId), onLog(cb), onAssistantText(cb)
- [x] `modules/execution/persistence/sqlite-run.repository.ts` -- SqliteRunRepository implements IRunRepository using better-sqlite3
- [x] `modules/execution/persistence/sqlite-cost-entry.repository.ts` -- SqliteCostEntryRepository implements ICostEntryRepository
- [x] `modules/execution/engines/run.engine.ts` -- RunEngine: per-org serial guard, budget check, Run lifecycle (queued→running→terminal), stream parsing, cost recording, event emission
- [x] `modules/execution/workers/worker-protocol.ts` -- Define ParentMessage (enqueue-run, cancel-run) and ChildMessage (run-log, run-status, run-finished) types
- [x] `modules/execution/workers/worker-service.ts` -- WorkerService: start/stop utilityProcess, message routing, crash recovery with in-flight run failure
- [x] `modules/execution/workers/worker.ts` -- Worker: per-role serial queue, adapter resolution, CLI execution, cancel support
- [x] `modules/execution/workers/utility-process.executor.ts` -- UtilityProcessExecutor: IExecutor adapter delegating to WorkerService
- [x] `modules/execution/workers/stream-json-parser.ts` -- Real-time NDJSON parser: feed(chunk), flush(), onText/onStatus callbacks
- [x] `modules/execution/workers/claude-stream-parser.ts` -- parseClaudeStreamJson(stdout): extract model, sessionId, usage, summary, errors
- [x] `modules/execution/logging/file-log.service.ts` -- FileLogService: writeInput, append (per-run write queue), readRaw, readParsed, sanitizeName
- [x] `modules/execution/services/cost-tracker.ts` -- CostTracker: recordCost(runId, roleId, orgId, tokenCount), getBudgetUsage(orgId)
- [x] `bootstrap/execution.module.ts` -- Register RUN_ENGINE_TOKEN, EXECUTOR_TOKEN, WORKER_SERVICE_TOKEN, RUN_REPO_TOKEN, COST_ENTRY_REPO_TOKEN

**Acceptance Criteria:**
- Given RunEngine receives a prompt and config, when executor completes, then Run record transitions queued→running→succeeded with correct tokenCount
- Given a Worker receives an enqueue-run message, when the CLI adapter executes, then stdout/stderr chunks are streamed back via run-log messages
- Given a Run fails, when RunEngine processes the failure, then Run record status is 'failed' and run:failed event is emitted
- Given cancelRun is called, when a Run is active, then the executor is aborted and Run status is 'cancelled'
- Given StreamJsonParser receives NDJSON chunks, when assistant text is detected, then onText callback fires with extracted text
- Given FileLogService.append is called for a run, when multiple concurrent appends occur, then writes are serialized via per-run queue
- Given CostTracker.recordCost is called with tokenCount > 0, then a CostEntry is persisted and budget total is updated

## Verification

**Commands:**
- `pnpm --filter @capibara/electron typecheck` -- expected: zero new type errors
