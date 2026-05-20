---
version: '3.0'
project_name: 'capibara'
user_name: 'uoyo'
date: '2026-05-14'
status: 'approved'
workflowType: 'architecture'
stepsCompleted:
  - tech_stack
  - process_model
  - layered_architecture
  - foundation_layer
  - persistence_layer
  - configuration
  - bootstrap_di
  - domain_modules
  - orchestration
  - execution_engine
  - mcp_protocol
  - ipc_layer
  - renderer_architecture
  - notification_layer
  - testing_strategy
inputDocuments:
  - apps/electron/src/core/bootstrap/composition-root.ts
  - apps/electron/src/core/foundation/events.ts
  - apps/electron/src/core/modules/conversation/services/conversation.service.ts
  - apps/electron/src/core/modules/orchestrator/orchestrators/*.ts
  - apps/electron/src/core/modules/coordination/routing/inquiry.router.ts
  - apps/electron/src/core/modules/execution/engines/run.engine.ts
  - apps/electron/src/core/modules/mcp/server/mcp-ipc.server.ts
  - apps/electron/src/core/modules/mcp/bridge/capibara-mcp-bridge.ts
  - apps/electron/src/core/infrastructure/persistence/sqlite/migrations.ts
  - _bmad-output/project-context.md
---

# Capibara Architecture Document

> **Capibara** — AI-Powered Organization Orchestration Platform
>
> Authoritative architecture for implementation. Single source of truth.
> When this document conflicts with older planning artifacts, **this wins**.

This document is self-contained. All older documents under `_bmad-output/planning-artifacts/` are superseded and may be deleted.

---

## 1. System Overview

Capibara is an Electron desktop application that simulates a real company:

- Users build an **organization** of AI **roles** (parent/child hierarchy, persona, skills).
- Roles execute **tasks** in a typed, variable-depth tree.
- A wake-loop dispatches one role at a time as a **Run** — a Claude CLI subprocess driven by a generated prompt and an MCP tool surface.
- Roles can **ask each other questions** (inquiry conversations), **plan together with the user** (planning conversations), or **submit decomposition trees** for review. Each is modelled as a `Conversation`.
- All state lives in a single local SQLite database. All cross-component communication flows through a typed event bus backed by a transactional outbox.

### 1.1 Architectural Pillars

| # | Pillar | Description |
|---|--------|-------------|
| 1 | **Single SQLite + Outbox** | Synchronous local DB, transactional outbox publishes events on commit; renderer is a read-only mirror via desktop events. |
| 2 | **Event-driven domain** | Modules talk through `DomainEventMap` events, never via direct cross-module calls. Layer-2 coordinators (routing, escalation) live outside the domains they orchestrate. |
| 3 | **One active Run per org** | `WakeGateValidator` enforces a unique active run per org; queued wakes are persisted as `pending_wakes` rows and drained on run-end. |
| 4 | **Asynchronous mailbox model** | Asking a question terminates the asker's Run; the asker is woken later by a fresh CLI when the answer arrives. No coroutines, no in-process waiting. |
| 5 | **Schema-driven workflow** | `ProcessSchema` defines statuses, transitions, work-item types, and behavior rules per org. The state machine is data, not code. |
| 6 | **Variable-depth task tree** | No fixed epic→story→task layers. Types declare `allowedChildren`, `isLeaf`, `allowedAtRoot`. |
| 7 | **MCP as the AI-facing contract** | Roles act on the system only through MCP tools (`capibara_*`); the bridge is a separate Node process spoken to over JSON-RPC stdio + HTTP. |

### 1.2 Repository Layout

```
capibara/
├── apps/electron/                 # the only active workspace package
│   ├── src/
│   │   ├── core/                  # main process — all backend logic
│   │   │   ├── bootstrap/         # composition root + per-module wiring
│   │   │   ├── config/            # Zod-validated config (defaults + user file)
│   │   │   ├── foundation/        # events, errors, logger, event bus interfaces
│   │   │   ├── infrastructure/    # adapters (CLI, observability), SQLite
│   │   │   ├── ipc-handlers/      # one file per domain
│   │   │   ├── modules/           # 10 domain modules
│   │   │   └── preload/           # contextBridge surface (built to .cjs)
│   │   ├── renderer/              # React 19 + Zustand + Tailwind v4
│   │   └── shared/                # locale + constants only (no contracts.ts here)
│   └── tests/                     # vitest, mirrors src/
└── _bmad-output/                  # planning artifacts (this file lives here)
```

### 1.3 Three-Process Model

Electron's main / preload / renderer split is augmented by **two additional Node child processes** spawned from main:

| Process | Entry | Purpose |
|---------|-------|---------|
| **Main** | `apps/electron/src/core/index.ts` | DI root, IPC handlers, SQLite, MCP HTTP server, orchestrators. Has full Node API. |
| **Renderer** | `apps/electron/src/renderer/main.tsx` | React UI. No Node API. All backend access via `window.capibara`. |
| **Preload** | `apps/electron/src/core/preload/index.ts` | `contextBridge.exposeInMainWorld('capibara', api)`. Built as CommonJS. |
| **Worker** (utilityProcess) | `apps/electron/src/core/modules/execution/workers/worker.ts` | Hosts `ICliAdapter` instances. Spawns `claude` CLI children. Communicates with main via `parentPort.postMessage`. One per app session. |
| **MCP Bridge** (child_process, spawned by claude CLI) | `apps/electron/src/core/modules/mcp/bridge/capibara-mcp-bridge.ts` | Independent Node process. JSON-RPC 2.0 stdio ↔ HTTP POST to main. One per Run. |

---

## 2. Technology Stack

| Layer | Choice | Notes |
|-------|--------|-------|
| Platform | Electron 41.1.0 | Three-process model + utilityProcess. |
| Runtime | Node ≥ 22, ESM (`"type": "module"`) | Bundler module resolution — no `.js` import suffixes. |
| Language | TypeScript 5.8 strict, ES2022 | `experimentalDecorators` + `emitDecoratorMetadata` for tsyringe. |
| DI | tsyringe 4.8 + reflect-metadata | All `@injectable()`; **no decorators on services constructed manually in composition-root**. |
| DB | better-sqlite3 12.8 | **Synchronous** — never wrap in `await`. WAL + FK on. |
| Validation | Zod 3.24 | Config + IPC inputs + outbox payloads. |
| Logging | pino 9 | Structured JSON. Levels: trace/debug/info/warn/error/fatal. |
| Frontend | React 19.2, Tailwind v4, Radix UI primitives, framer-motion | functional components, named exports. |
| State (renderer) | Zustand 5 | one store per domain, fine-grained selectors. |
| Build | electron-vite 5 + Vite 7 | three entry points: `index.ts`, `capibara-mcp-bridge.ts`, `capibara-worker.ts`. |
| Packaging | electron-builder 26 | NSIS / DMG / AppImage. |
| Test | Vitest 4.1 (v8 coverage) | Unit + integration. |
| Format | Prettier 3.4 only (no ESLint) | 100/120 width, single quotes, trailing commas. |
| Package mgr | pnpm 10 (workspace) | Currently only `apps/electron` is active. |

---

## 3. Layered Architecture (Main Process)

```
                ┌──────────────────────────────────────────────────────┐
                │                  ipc-handlers/                       │  ← thin: validate → call service → wrap DesktopResult
                └────────────────────────────┬─────────────────────────┘
                                             │ uses
                ┌────────────────────────────▼─────────────────────────┐
                │                  modules/                            │  ← 10 domain modules; services + state machines
                │  conversation │ coordination │ execution │ mcp       │
                │  notification │ orchestrator │ organization         │
                │  planning     │ prompt       │ workflow              │
                └─────────────┬──────────────────────────┬─────────────┘
                              │ depend only on           │ publish events
                ┌─────────────▼─────────────┐  ┌─────────▼──────────────┐
                │       foundation/         │  │   infrastructure/      │
                │  events.ts (DomainEventMap│  │  sqlite, adapters,     │
                │  + payloads), errors,     │  │  observability         │
                │  ILogger, IEventBus,      │  │                        │
                │  IEventPublisher          │  └────────────────────────┘
                └───────────────────────────┘
```

**Hard rules:**

- `modules/<X>/services/...` may NOT import `infrastructure/...` directly. They depend on `foundation/interfaces/` or `modules/<X>/interfaces/`.
- `foundation/` is contract-only — no runtime state, no DB.
- No barrel `index.ts` files anywhere. Always import the concrete file.
- No relative paths cross process boundaries. Use the path aliases `@core/*`, `@renderer/*`, `@preload/*`, `@shared/*`.

---

## 4. Foundation

### 4.1 Domain Events (`foundation/events.ts`)

Events are the only sanctioned cross-module integration. `DomainEventMap` is the single source of truth — every type is mapped to its payload interface and validated by Zod schemas in `event-schemas.ts` before re-emission from the outbox.

Categories (full table at the file):

- **Organization** — `org:created|updated|deleted`, `role:created|updated|deleted`
- **Task** — `task:created`, `task:status-changed` (includes `triggeredBy: 'user' | 'system'`), `task:entered-approval`, `task:auto-approved`, `task:approval-confirmed`, `task:approval-rejected`, `task:completed`
- **Conversation** — `conversation:created`, `conversation:message-added`, `conversation:response-needed`, `conversation:needs-routing`, `conversation:respondent-assigned`, `conversation:resolved`, `conversation:escalated`, `conversation:timed-out`, `conversation:cancelled`, `conversation:completed`
- **Run** — `run:queued|started|succeeded|failed|cancelled|log|assistant-text|status`
- **Plan tree** — `plan-tree:submitted|ready|discarded|approved`

`run:log`, `run:assistant-text`, `run:status` are **streaming events**: ephemeral, high-volume, never go through the outbox — they are emitted directly via `IEventBus` (`run.engine.ts:229-231`). Everything else flows through the outbox.

### 4.2 EventBus vs EventPublisher

| Interface | Implementation | Use |
|-----------|----------------|-----|
| `IEventBus` | `EmitteryEventBus` (`infrastructure/observability/emittery-event-bus.ts`) | In-process pub/sub for subscribers within main. |
| `IEventPublisher` | `OutboxEventPublisher` (`infrastructure/observability/outbox.publisher.ts`) | What domain services call. Inserts into `outbox` table; drains on microtask. |

**Why both exist:**
- Domain code calls `eventPublisher.publish(...)` so the event is durable and atomic with its DB writes.
- Layer-2 coordinators / orchestrators subscribe via `eventBus.on(...)` because they only react to commits.
- The outbox publisher uses `IEventBus.emit(...)` after marking rows published.

### 4.3 Errors (`foundation/errors/capibara.errors.ts`)

Single `CapibaraError` base with structured `code` + `cause`. All domain errors extend it: `NotFoundError`, `ValidationError`, `TaskStateError`, `ConversationStateError`, `BudgetExceededError`, `ExecutionError`. Never throw plain `Error` or strings.

### 4.4 Logger

`ILogger` with `trace/debug/info/warn/error/fatal`. Backed by `PinoLogger`. Always pass a structured second argument; log messages are not f-strings.

---

## 5. Persistence Layer

### 5.1 Connection

`SqliteConnection` (`infrastructure/persistence/sqlite/sqlite-connection.ts`) is a singleton lazily opening the DB with:

```sql
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;
PRAGMA busy_timeout = 5000;
```

`better-sqlite3` is **synchronous**. Never wrap in `async/await`. Never call `getDb()` inside hot loops — cache the prepared statements at the repo level.

### 5.2 Migrations

`migrations.ts` — single greenfield baseline (v1) that creates 14 tables in one transaction:

| # | Table | Purpose |
|---|-------|---------|
| 1 | `organizations` | tenant boundary, budget, workspacePath, autoStart, planningRoleId |
| 2 | `settings` | key/value system settings |
| 3 | `roles` | hierarchical (parent_id self-FK), persona, skills, can_approve, requires_human_approval, status |
| 4 | `skills` | builtin/template/custom skill metadata + `command` (`/foo`) |
| 5 | `tasks` | type, parent_id, status, assignee, depth, paused_reason, planning_mode (`preview`/`eager`) |
| 6 | `process_schemas` | per-org JSON schema with unique index on `is_active` |
| 7 | `conversations` | unified for `inquiry|planning|adhoc|plan_review`; state machine; `external_session_id` for CLI session resume |
| 8 | `conversation_messages` | author_role_id|author_type, intent (`question|reply|escalation|resolution|general`) |
| 9 | `conversation_events` | append-only audit log (separate from `outbox`) |
| 10 | `runs` | task_id OR conversation_id (CHECK), status, wake_reason, tokens, summary, error |
| 11 | `cost_entries` | per-run cost tracking |
| 12 | `pending_wakes` | queued wakes when WakeGate blocks; task_id OR conversation_id |
| 13 | `outbox` | event_type + JSON payload + published_at |
| 14 | `pending_plan_trees` | persistent decomposition trees with `version` (optimistic lock) and `status` |

**Critical indexes:**
- `idx_runs_active_per_role` UNIQUE WHERE status IN ('queued','running') → enforces 1 active Run per role at the DB level.
- `idx_pending_plan_trees_active_task|conv` UNIQUE WHERE status IN ('active','refining') → at most one in-flight tree per anchor.
- `idx_conversations_timeout` partial WHERE state='waiting' → fast escalation scans.

Migrations run inside a `db.transaction(...)` block. Pre-migration backup is written by `MigrationBackupService` if a real DB path is provided.

### 5.3 Repository Convention

- Interface in `modules/<X>/interfaces/i-<thing>.repository.ts` (or in `foundation/interfaces/` for cross-cutting like `IOutboxRepository`).
- Implementation in `modules/<X>/persistence/sqlite-<thing>.repository.ts` with `@injectable()` + an injected `ISqliteConnection`.
- Names follow `I{Entity}Repository`. One interface per file.
- DB row → domain object mapping is the repo's job — services never see `_id`/snake_case columns.

### 5.4 Transactional Outbox

The flow that makes events durable and atomic with state changes:

```
Domain service:
  db.transaction(() => {
     run.start(...);                 ← repo writes
     outboxRepo.enqueue('run:started', payload);   ← INSERT INTO outbox
  })()
                                ↓ on commit
            queueMicrotask drains unpublished rows
                                ↓
       eventBus.emit({type, timestamp, payload})
                                ↓
       Subscribers (orchestrators, coordinators, broadcaster) react
                                ↓
       outbox.markPublished(ids)
```

Properties:
- If the enclosing transaction rolls back, the outbox row vanishes — no subscriber sees the event.
- Microtask drain runs on the same tick after commit — UI-perceived latency is negligible.
- Drain is idempotent and re-entrant; `drainScheduled` flag prevents reentry.
- `BATCH_SIZE = 100`. Drain loops until empty.
- Streaming run events bypass this and emit directly on `IEventBus` — they have no transactional partner.

---

## 6. Configuration

`core/config/` —

- `config.types.ts` — `CapibaraConfig` shape.
- `config.schema.ts` — Zod schema with defaults for every field.
- `config.defaults.ts` — `DEFAULT_CONFIG` object.
- `config.loader.ts` — load order:
  1. `DEFAULT_CONFIG`
  2. Deep-merge `<userData>/capibara/config.json` if exists.
  3. Deep-merge `<projectDir>/capibara.config.json` if a `projectDir` is passed.
  4. Inject `database.sqlitePath`, `logging.logDir` if missing.
  5. Apply `CAPIBARA_LOG_LEVEL` / `LOG_LEVEL` env override.
  6. `configSchema.parse(merged)` (throws on invalid).

Top-level keys: `organization`, `execution`, `skills`, `database`, `cli`, `logging`.

`execution` block holds the wake-loop limits: `maxReviseAttempts`, `maxRetryOnFailure`, `maxConsecutiveWakes`, `budgetLimit`, `maxDecompositionDepth`, `retryBackoffMs`.

**Config is immutable after load.** Don't mutate `config.*` at runtime.

---

## 7. Bootstrap & DI Composition

`core/bootstrap/composition-root.ts` is the one place where services are wired. The pattern is **manual instantiation** (constructor injection by hand) rather than the tsyringe container's `resolve()`. tsyringe is still used for `@injectable()` metadata, but services are `new`'d in a deterministic order.

### 7.1 Order

```
1. config = loadConfig()
2. logger = new PinoLogger(level)
3. sqliteConn = new SqliteConnection(path) ; runMigrations()
4. eventBus = new EmitteryEventBus()
5. outboxRepo = new SqliteOutboxRepository(conn)
6. eventPublisher = new OutboxEventPublisher(outboxRepo, eventBus, logger)
7. registerOrganizationModule(...)
8. registerWorkflowModule(...)
9. registerConversationModule(...)
10. registerCoordinationModule(...)
11. registerExecutionModule(...)
12. registerPlanningModule(...)
13. registerMcpModule(...) → start MCP HTTP server, generate mcp config file → wire path into runEngine
14. registerPromptModule(...)
15. registerOrchestratorModule(...)
16. registerNotificationModule(...)
17. register*Handlers(...) for each IPC domain
18. wire late dependencies (planning.setWaker, runContext.setFeedbackProvider, orgTemplateService.setProcessSchemaProvider)
19. seed (skills + org templates + workflow templates)
20. start orchestrators (taskOrchestrator, conversationOrchestrator, runOrchestrator, eventBroadcaster, inquiryRouter, planningService.init)
21. eventPublisher.start()  ← finally drain pending outbox rows (e.g. seed events)
```

### 7.2 Per-module registration files

Each `bootstrap/<module>.module.ts` exports a `register<Name>Module(...)` function that:
- constructs the module's repos with the injected `SqliteConnection`,
- constructs services with their dependencies,
- returns a flat object with the public surface needed by other modules.

This avoids circular imports and gives a clear "what does each module own" contract.

### 7.3 Late binding

Two cycles are broken with property setters wired after both sides exist:

- `PlanningService.setWaker(taskOrchestrator)` — planning needs to wake roles; `TaskOrchestrator` needs planning's events to drive scheduling.
- `RunContext.setFeedbackProvider(planningService.consumePendingFeedback)` — prompts need pending tree feedback.
- `OrgTemplateService.setProcessSchemaProvider(processEngine)` — templates seed schemas.

---

## 8. Domain Modules

Each module owns a slice of domain logic, repos for its tables, and an explicit set of events it publishes / subscribes to. Modules **never import each other's implementations** — they cross only through `foundation/events.ts` and `modules/<X>/interfaces/`.

### 8.1 organization

Tables: `organizations`, `roles`, `skills`.
Services: `OrganizationService`, `RoleService`, `SkillService`, `OrgTemplateService`, `SkillSeeder`.
Key shapes: `Organization { id, name, budgetLimit, workspacePath, autoStartOnCreate, planningRoleId, ... }`, `Role { parentId, persona, skillIds, canApprove, canDelegate, requiresHumanApproval, isSystemRole, status, consecutiveWakeCount, ... }`.
Org templates load YAML/JSON from `resources/templates/`. A seeded org gets:
- a `ProcessSchema` (default workflow),
- a tree of roles (parentId edges encode hierarchy),
- a `planning_role_id` (the role used for conversational planning).

### 8.2 workflow

Tables: `tasks`, `process_schemas`.
Services: `TaskService`, `ProcessTemplateService`.
Engines:
- **`ProcessEngine`** — caches `ProcessSchema` per org; validates types/statuses/transitions; computes status category (`initial|active|approval|terminal`); persists schema with `validateSchema()`. Transition validation is **mode-aware**: `validateTransition(orgId, from, to, mode: 'manual'|'system')` and `getAvailableTransitions(orgId, from, mode)` filter edges by `TransitionDefinition.mode` (defaults to `'manual'` when omitted in the schema).
- **`TaskStateMachine`** — `transition(taskId, newStatus, opts?: { triggeredBy })` validates against `ProcessEngine` using `mode = triggeredBy === 'system' ? 'system' : 'manual'`. Blocks non-leaf tasks from approval states, writes the row, emits `task:status-changed` (with `triggeredBy`) / `task:entered-approval` / `task:completed`. Auto-approval logic: AI roles whose role does not require human approval are advanced past approval statuses automatically (`task:auto-approved`).
- **`BehaviorEngine`** — schema-defined rules (`on_status_enter`, `on_all_children_terminal`) with `all/any/not/eq/neq/in/not_in/gt/lt` operators. Action `transition` calls back into `TaskStateMachine`. A re-entrancy `evaluating` set prevents infinite cascades.

Schema `TransitionMode`:
- `'manual'` (default) — walkable by user/AI via MCP tools or the orchestrator.
- `'system'` — walkable only by `RunEngine` (task lifecycle) or bootstrap reconcile. Hidden from AI tooling.

Key invariants:
- **R1**: For leaf tasks, `status.category === 'active'` is strictly equivalent to "has an active run". Non-leaf containers can be active without a run (their subtree is in flight).
- **R2**: `RunEngine` is the sole authority on initial→active transitions for tasks.
- **R3**: `RunEngine` rolls back active tasks to initial on run termination (unless the agent already moved the task to terminal/approval — R5).
- **R4**: Bootstrap `reconcileOrphanedActiveTasks` handles cross-restart: any active task with no backing run is rolled back to initial.
- **R5**: Approval/terminal transitions remain under AI/user control.
- A task in an `approval`-category status must be a leaf (`hasChildren = false`).
- `paused_reason='approval'` is the persistent flag that suppresses wakes; `TaskOrchestrator` reads this in `onTaskStatusChanged`.

### 8.3 conversation

Tables: `conversations`, `conversation_messages`, `conversation_events`.
Service: `ConversationService` (`modules/conversation/services/conversation.service.ts`).
Types: `inquiry | planning | adhoc | plan_review`.
States: `active → waiting → resolved | escalated | timed_out | cancelled`, plus `escalated → resolved|cancelled`, `timed_out → escalated|cancelled`, `active → completed`. Transition table is enforced by `CONVERSATION_TRANSITIONS`.
Message intents: `question | reply | escalation | resolution | general`.

Key methods:
- `createInquiry(orgId, askingRoleId, taskId, content)` — writes conv (state=`active`, no respondent yet) + first message + emits `conversation:needs-routing`. Returns the conversation. The respondent is **not** decided here — Layer-2 `InquiryRouter` writes it back.
- `assignRespondent(...)` — write-back from `InquiryRouter`. Sets `respondent_role_id`, transitions to `waiting`, emits `conversation:respondent-assigned` + `conversation:response-needed`.
- `createPlanning(orgId, agentRoleId, firstHumanMessage)` — for the conversational planning flow. State stays `active`; the agent role is woken via `conversation:response-needed`.
- `createPlanReview(...)` — opens a plan_review conversation (respondentType='human') so the user can review a submitted plan tree.
- `addMessage(...)` — emits `conversation:message-added` and conditionally `conversation:response-needed` per `determineResponseNeeded`:
  - inquiry + human author → wake the **initiator** (asker is unblocked).
  - inquiry + ai author + intent='question' + state='waiting' → wake the respondent.
  - inquiry + ai author + intent='reply' → no wake (the reply itself does not loop).
  - non-inquiry + human author → wake the respondent.
- `resolve / cancel / complete / escalate` — state transitions with matching events.

Conversation prompt (`prompt/strategies/conversation-prompt.strategy.ts`) feeds the full message history, role persona, optional task context, and (for planning) the type schema + available roles.

### 8.4 coordination — Layer 2 routing

Two services that orchestrate cross-domain decisions but **own no domain data**:

- **`InquiryRouter`** (`modules/coordination/routing/inquiry.router.ts`)
  Subscribes to `conversation:needs-routing`. Routing strategy:
  1. If the asking role doesn't exist or `requiresHumanApproval` → **human fallback**.
  2. Else if it has an active `parentId` → route to **parent**.
  3. Else search **siblings** under the same parent (or org root if no parent) for an active non-system role.
  4. Else human fallback.
  Calls back into `ConversationService.assignRespondent(...)`.

- **`InquiryEscalationService`** — periodic scan that fetches `findTimedOutInquiries()`, marks them `timed_out`, and walks the role hierarchy upward to escalate.

The conversation module has zero knowledge of these classes — coupling is event-only.

### 8.5 orchestrator — wake loop

The runtime brain. Three orchestrators + supporting helpers:

- **`TaskOrchestrator`** (`task.orchestrator.ts`) — subscribes to `task:created`, `task:status-changed`, `task:entered-approval`, `task:approval-confirmed`, `task:completed`, `plan-tree:approved`. Drives:
  - **root auto-start** on org creation (if `autoStartOnCreate`).
  - **wake gating** on every status transition into an `active`-category status, skipping paused tasks. Ignores `triggeredBy:'system'` echoes (avoids double-waking from RunEngine bookkeeping).
  - **scheduleNext(orgId)**: ask `TaskScheduler` for the next eligible task and wake the assignee role via `tryWake`. Does **not** transition the task — `RunEngine` is the sole authority on initial→active (R2).
  - **tryWake(roleId, orgId, reason, taskId)** — the public wake API. If `WakeGateValidator` denies, persists a `pending_wakes` row.
- **`ConversationOrchestrator`** — subscribes to `conversation:response-needed` and `conversation:resolved`.
  - On response-needed: validate the wake gate, dispatch via `RunCoordinator.executeForConversation`. If gate blocks (i.e. another run is active), persist a `pending_wakes` row anchored to the conversation. **Without this, AI→AI inquiries silently vanish during the asker's run.**
  - On resolved: if the conversation has both `taskId` and `initiatorRoleId`, call `taskOrchestrator.tryWake(initiator, org, 'conversation_reply', taskId)`. This is the unblocking step that lets Role-A continue after Role-B answers.
- **`RunOrchestrator`** — subscribes to `run:succeeded|failed|cancelled`. On any run end:
  - If failed → schedule retry via `RetryScheduler`.
  - **`drainPendingWakes(orgId)`** — fetch `pending_wakes.findNext(orgId)`, delete it, re-validate the wake gate, dispatch by target (conversation or task). If gate still blocks, re-enqueue.
  - Also kicks `taskOrchestrator.scheduleNext(orgId)` so any eligible task moves forward.

Helpers:
- **`WakeGateValidator`** — central admission control:
  1. role exists and `status !== 'paused'`.
  2. `runRepo.findActiveByOrgId(orgId)` returns null. **Single concurrency boundary.**
  3. budget not exceeded (only if `budgetLimit > 0`).
  4. `consecutiveWakeCount < maxConsecutiveWakes` (circuit breaker).
- **`RunCoordinator`** — translates a wake into a Run:
  - `executeForTask`: builds task prompt, looks up `org.workspacePath` for cwd, calls `runEngine.execute(...)`.
  - `executeForConversation`: builds conversation prompt, threads `externalSessionId` (Claude session resume), calls `runEngine.execute(...)`. After a successful run, **writes the run summary as a `reply` message** with `intent='reply'` — that is how Role-B's answer reaches the conversation.
- **`TaskScheduler`** — chooses the next schedulable task per org (depth-first, oldest-root first). Descends through non-leaf containers regardless of their category (they aggregate in-flight subtrees), and only blocks on active **leaf** nodes (R1). Returns `{ task, wakeReason }` for initial-category leaves with an `assigneeRoleId`.
- **`RetryScheduler`** — exponential backoff retry wired to `retryBackoffMs` and `maxRetryOnFailure`.

### 8.6 execution

Tables: `runs`, `cost_entries`.
Services: `CostTracker`, `FileLogService`.
Engine: **`RunEngine`** (`modules/execution/engines/run.engine.ts`).
Workers: `WorkerService`, `UtilityProcessExecutor`, `worker.ts`, `StreamJsonParser`.
Adapters: `ClaudeCliAdapter`.

Run lifecycle inside `RunEngine.execute`:

1. Budget check + DB-level "no other active run for this org" assertion (`findActiveByOrgId`).
2. Insert `runs` row (status='queued') keyed on either taskId, conversationId, or both.
3. Emit `run:queued`, write input log file (`fileLogService.writeInput`).
4. Update status='running', emit `run:started`.
5. **R2 — `advanceTaskToActive(taskId, orgId)`**: if the task is in an initial-category status, transition it to the first active status via `taskStateMachine.transition(taskId, target.to, { triggeredBy: 'system' })`. Idempotent (no-op if already active, or if taskId is null / not found / in approval/terminal).
6. Call `executor.execute(...)` (`UtilityProcessExecutor` → `WorkerService.enqueueRun`).
6. Worker spawns the CLI via `ClaudeCliAdapter` with `claude --print --output-format stream-json --verbose --dangerously-skip-permissions [--mcp-config <path> --strict-mcp-config] [--model X] [--max-turns N] [--effort E] [--resume sessionId]`. The prompt is piped via stdin.
7. CLI streams JSON lines to stdout. `StreamJsonParser` parses them into:
   - `onText(text)` → emit `run:assistant-text` (streaming).
   - `onStatus(status)` → emit `run:status` (streaming).
8. Stderr / stdout chunks → `run:log` streaming events + appended to a per-run file log.
9. CLI exits → adapter returns `{ exitCode, status, summary, sessionId, inputTokens, outputTokens, errorMessage, ... }`.
10. `runRepo.finish(runId, status, tokens, ..., sessionId, summary, errorMessage)`.
11. Cost accrued via `costTracker.recordCost(...)`.
12. **R3 — `rollbackTaskIfActive(taskId)`**: if the task is still in an active-category status (agent didn't advance it to terminal/approval itself), roll it back to the schema's first initial status via `taskStateMachine.transition(taskId, initial.name, { triggeredBy: 'system' })`. This frees the task for re-scheduling.
13. Emit `run:succeeded | run:failed | run:cancelled` (lifecycle, **outbox**).
14. `cleanupRun(runId)` — flush parser, log file, in-memory ctx.

`StreamJsonParser` is line-buffered, line-by-line JSON-decoded, and tolerates non-JSON lines (CLI debug noise) by routing them to `onParseError`.

`WorkerService` is a singleton `utilityProcess`. The `worker.ts` enforces **one active run per role** in-process via `activeByRole: Map<roleId, runId>`. Anything queued behind a busy role is held until that role's run finishes — but the org-level "one active run" constraint at `WakeGateValidator` is the primary boundary; the worker's per-role queue is a defense-in-depth.

Cancel path: `runEngine.cancelRun(runId)` → `executor.abort(runId)` → worker → adapter → `taskkill /T /F /PID` on Windows or `SIGTERM` then `SIGKILL` on Unix. Also calls `rollbackTaskIfActive(taskId)`.

**R4 — Bootstrap reconcile** (`composition-root.ts:reconcileOrphanedActiveTasks`): After `markOrphanedAsInterrupted` sweeps ghost runs at startup, any task still in an `active` status has no backing run. `reconcileOrphanedActiveTasks` iterates all orgs, finds active tasks, and rolls them back to the schema's initial status via `taskStateMachine.transition(id, initial, { triggeredBy: 'system' })`. This is the cross-restart counterpart of RunEngine's per-run rollback (R3).

`ClaudeCliAdapter.isSessionError()` detects "unknown session" / "session not found" responses and **automatically retries once without `--resume`** (`doExecute(ctx, true)`), so a corrupted session id is recoverable.

### 8.7 mcp — AI's tool surface

Three pieces:

- **`McpToolRegistry`** — tool name → `{description, inputSchema, handler}` map. `dispatch(name, params, runId)` is what the HTTP server calls. Logs every dispatch.
- **`McpIpcServer`** — local HTTP server bound to `127.0.0.1:0` (dynamic free port). Single route `POST /tool-call` accepts `{toolName, arguments}` and returns `{success, data}` or `{success: false, error}`. Body limit 1 MB.
- **`McpConfigGenerator`** — writes a temporary MCP configuration file containing the bridge command + port. Returns the path; `RunEngine.setMcpConfigPath(...)` stores it for every Run's `--mcp-config`.

**MCP bridge** (`mcp/bridge/capibara-mcp-bridge.ts`) is its own Node entry point. Claude CLI spawns it as a stdio MCP server. It speaks JSON-RPC 2.0 on stdin/stdout. On `tools/list` it returns the static tool list (kept in sync with the registry). On `tools/call` it HTTP-POSTs `{toolName, arguments}` to the main process and pipes back the result.

Why a bridge process instead of in-process tools? Claude CLI's MCP plumbing only speaks stdio. The bridge converts stdio JSON-RPC ↔ HTTP, while letting the actual handlers live in the main Electron process where domain services exist. The bridge holds **no state**.

Tool handlers (`mcp/handlers/`):

- **`task-tools.ts`** — `capibara_task_transition`, `capibara_task_create_child`.
- **`conversation-tools.ts`** — `capibara_ask_question` (calls `ConversationService.createInquiry`, returns `{conversationId, respondentRoleId, state}` immediately — non-blocking).
- **`context-tools.ts`** — `capibara_context` (read-only queries: tasks/roles/task_detail/role_detail).
- **`plan-tree-tools.ts`** — `capibara_plan_submit_tree` with full server-side validation (type compatibility, leaf rules, assignee roles, ≤500 nodes, ≤10 depth, exactly one of `rootTaskId | conversationId`).

### 8.8 prompt

Two strategies + a context aggregator:

- **`RunContext`** (`modules/prompt/context/run.context.ts`) — assembles the data prompt strategies need: role, role's skills, current task with parent chain + siblings, workflow schema info, conversation history, etc. Reads from repos; never writes.
- **`buildTaskPrompt`** (`modules/prompt/strategies/task-prompt.strategy.ts`) — composes prompt sections (role, skills, org instructions, current task, execution sequence, type schema, knowledge base, workflow schema, system context, ID bindings, tool guidance, scenario instructions, language). Scenario is one of: `terminal_noop | preview_decomposition | eager_decomposition | execute_leaf | revision | review_approve | task_completed | conversation_reply | retry_failed`.
- **`buildConversationPrompt`** (`modules/prompt/strategies/conversation-prompt.strategy.ts`) — sections for role, skills, task context (if any), full conversation history (`[author] (intent): content`), context label (Inquiry / Planning Session / Conversation), and for `planning` type, an additional sub-prompt with the work-item type schema, available roles, pending feedback, and structural rules for `capibara_plan_submit_tree`.

The wake reason determines which prompt scenario fires. `'conversation_reply'` on a non-decomposable task produces:

> "You previously started a conversation and have received a reply. Read the reply, then continue your work. If you need more information, continue the conversation; otherwise, use `capibara_task_transition` to advance."

### 8.9 planning

Tables: `pending_plan_trees`.
Service: `PlanningService` (`modules/planning/planning.service.ts`).

Two anchoring modes:

| Anchor | When | Behaviour |
|--------|------|-----------|
| **Task-anchored** (`rootTaskId`) | Decomposition during normal execution. `planning_mode='preview'` requires user approval; `planning_mode='eager'` persists immediately. | On approve, children are created under the existing root task; root's status advances post-decomposition. On preview-mode submit, a `plan_review` conversation is opened in the user's inbox. |
| **Conversation-anchored** (`sourceConversationId`) | Conversational planning sessions. Always `preview` mode. | On approve, the tree's top-level children become **root tasks** (parentId=null), the planning conversation is resolved. |

Optimistic locking: `pending_plan_trees.version`. Approve / refine / discard accept an `expectedVersion` and return `VERSION_MISMATCH` if a concurrent submission already replaced the tree.

`refine` → writes feedback into the row + posts a `human` message into the relevant conversation + wakes the AI to re-submit.

`MAX_AGE_MS = 24h` — older `active|refining` trees are considered expired.

Subscribes to `plan-tree:submitted` (emitted by `capibara_plan_submit_tree` MCP handler) and persists the tree.

### 8.10 notification

Two pieces:

- **`EventBroadcaster`** — a domain → desktop event mapping table. Subscribes to selected `DomainEvent`s and emits the user-facing `DesktopEvent` (defined inline in `event-broadcaster.ts`). Sends via the `sendFn` injected at runtime (the IPC `webContents.send('capibara:desktop-event', evt)` callback).
- **`NotificationService`** — OS toast / native notifications.

Mapping highlights:
- `org:*` / `role:*` / `task:*` → `org:changed | role:changed | task:changed` (orgId only — renderer reloads).
- `task:entered-approval` → keeps `taskId` (renderer pops the approval card directly).
- `run:queued|started` → `run:changed`.
- `run:succeeded|failed|cancelled` → `run:completed` (with status + tokenCount).
- `run:log|assistant-text|status` → forwarded as-is for live UI streaming.
- `conversation:created|message-added|completed` → `conversation:changed` (orgId only).
- `conversation:response-needed` with `roleId=null` (i.e. waiting for the human) → `conversation:response-needed` (notify the user).
- `plan-tree:ready|discarded|approved` → corresponding desktop events.

This single mapping is the only place that decides which renderer-visible refreshes happen for which domain change.

---

## 9. Async Inquiry Execution Model

This is the core behaviour to internalise.

When an AI role asks a question via `capibara_ask_question`, **its CLI process keeps running until that role's overall Run ends naturally**. Role-A is then **awakened later** by a fresh CLI when Role-B's answer is delivered. There is no in-process waiting, no coroutine, no resumed handle.

### 9.1 Full timeline (Role-A asks Role-B)

```
T0   Role-A is mid-Run for taskId=t1.
     CLI invokes capibara_ask_question(orgId, A, t1, "...?").
T1   MCP bridge HTTP-POSTs to main → ConversationService.createInquiry()
       inserts conversation conv-1 (state='active', respondent=null)
       inserts first message (intent='question', author=A, type='ai')
       emits conversation:needs-routing (outbox)
T2   capibara_ask_question handler returns {conversationId, respondentRoleId=null, state='active'}.
     Role-A's CLI receives the result. Role-A is free to call more tools or finish.
     (typically Role-A finishes its turn — there is no answer yet.)
T3   InquiryRouter (subscribed) routes conv-1 to Role-B (parent role typically).
       ConversationService.assignRespondent(conv-1, B, 'ai', reason)
         updateRespondent + transition to 'waiting'
         emits conversation:respondent-assigned + conversation:response-needed (outbox)
T4   ConversationOrchestrator handles response-needed.
       wakeGate.validate(B, org) — denied because Role-A's Run is still active.
       Persists pending_wakes(roleId=B, conversationId=conv-1, reason='respondent_woken').
T5   Role-A's CLI exits (turn ended). RunEngine emits run:succeeded.
T6   RunOrchestrator.onRunEnded(orgId) → drainPendingWakes(orgId)
       finds the queued wake for B → wakeGate now allows
       runCoordinator.executeForConversation(conv-1, B, org, locale)
         → builds conversation prompt with full history
         → runEngine.execute → spawns a NEW Claude CLI for B.
T7   Role-B's CLI runs. Produces a reply. CLI exits.
       runCoordinator writes the run summary as a 'reply' message:
         conversationService.addMessage(conv-1, {author=B, type='ai', intent='reply'})
       inside addMessage:
         determineResponseNeeded → false (waiting + ai author + intent='reply')
       so no further wake fires from the reply itself.
T8   Either:
       - Role-B's CLI also called resolve via tooling, OR
       - downstream code calls conversationService.resolve(conv-1).
       → emits conversation:resolved (outbox).
T9   ConversationOrchestrator.onResolved
       conv has taskId=t1 + initiatorRoleId=A
       taskOrchestrator.tryWake(A, org, 'conversation_reply', t1)
       wakeGate now permits (no active run).
T10  RunCoordinator.executeForTask(t1, A, org, 'conversation_reply', locale)
       → buildTaskPrompt with scenario='conversation_reply'
       → spawns a new Claude CLI for A. Role-A continues, sees the reply
         in the conversation history, and uses capibara_task_transition.
```

### 9.2 Why this model

- **One process per turn** keeps memory + cost bounded. Long waits would lock a CLI for hours.
- **Stateless wakes** mean a crash mid-conversation is recoverable: the event log + `pending_wakes` table reconstruct the queue.
- **Single-active-run constraint** means we never burn budget on parallel fights for the same workspace.
- The **prompt history** carries the entire conversation back into Role-A's next CLI, so Role-A reads what Role-B said as plain context. No special protocol.

---

## 10. IPC Layer

### 10.1 Channels

Channel names follow `capibara:{domain}:{action}` (e.g. `capibara:org:create`, `capibara:conversation:add-message`). Defined inline in `core/preload/index.ts` and corresponding handler files in `core/ipc-handlers/`. **There is no `contracts.ts` in the current code** — the preload `api` object is the de-facto schema.

### 10.2 Result type

All `ipcMain.handle` handlers return a `DesktopResult<T>`:

```ts
type DesktopResult<T> = { ok: true; data: T } | { ok: false; error: { code: string; message: string } };
```

Renderer code always `if (result.ok) ... else ...`.

### 10.3 Handlers

Files in `core/ipc-handlers/`:
- `organization.handlers.ts` — orgs / roles / skills / templates.
- `workflow.handlers.ts` — tasks / process schemas / approvals.
- `conversation.handlers.ts` — list/get/messages/resolve/cancel/createInquiry/createAdhoc.
- `execution.handlers.ts` — runs/logs/cost.
- `plan-tree.handlers.ts` — task-anchored + conversation-anchored approve/discard/refine + planning start.
- `system.handlers.ts` — health, dep checks, dialogs, scheduler pause/resume.

Handlers must:
1. Validate input (Zod or shape checks).
2. Call exactly one service method.
3. Wrap into `DesktopResult`.
4. Never contain business logic.

### 10.4 Renderer event channel

`capibara:desktop-event` — single channel, payload is a `DesktopEvent` discriminated union. Renderer subscribes via `window.capibara.subscribe(callback)` which returns an unsubscribe function.

### 10.5 Auto-update channel

`capibara:auto-update` — one-way push from main to renderer for `electron-updater` events. No invoke surface.

---

## 11. Renderer Architecture

### 11.1 React 19 + Tailwind v4 + Radix

- Functional components, named exports (`export function ComponentName(...)`).
- Tailwind utility classes; conditional classes via `cn()` (clsx + tailwind-merge).
- Radix primitives wrapped in `src/renderer/components/ui/` with project styling.
- Phosphor icons exclusively.

### 11.2 Zustand stores (`src/renderer/store/`)

One store per domain:
- `app.store.ts` — global app state (sidebar, current org).
- `organization.store.ts` — orgs/roles/skills.
- `task.store.ts` — tasks for current org.
- `conversation.store.ts` — conversations + messages + waiting flags.
- `run.store.ts` — runs, live log buffers, assistant text.
- `plan-tree.store.ts` — pending trees for both anchoring modes.
- `toast.store.ts` — toast queue.

Pattern:
- State + actions on the same interface; actions are async, call `window.capibara.*`, then `set(...)`.
- Each store has `init()` that calls `subscribeToEvents({ ... })` once and stores the unsubscribe in a module-scope variable.
- `init()` is invoked from a top-level hook (`useAppSnapshot` etc.) guarded by `useRef` so React Strict Mode double-renders don't double-subscribe.
- **Always use fine-grained selectors** (`useStore((s) => s.field)`). Never destructure the whole store.

### 11.3 `subscribeToEvents` (`renderer/lib/subscribe-to-events.ts`)

Type-safe map from `DesktopEvent.type` to handler. Internally calls `window.capibara.subscribe`, filters by event type, dispatches to the registered handler. Returns the underlying unsubscribe.

Stores use the pattern:
```ts
init: () => {
  if (get().isInitialized) return;
  conversationUnsubscribe = subscribeToEvents({
    'conversation:changed': (e) => { if (e.orgId === get().currentOrgId) get().loadConversations(e.orgId); },
    'conversation:response-needed': (e) => get().markWaitingForUser(e.conversationId),
  });
  set({ isInitialized: true });
}
```

### 11.4 Hooks (`src/renderer/hooks/`)

- `useAppSnapshot` — top-level boot hook called once in `App.tsx`. Triggers all stores' `init()`.
- `useEventSubscription` — generic subscriber for one-off feature components.
- `useRunLogs` — bounded log buffer per runId.
- `useLocale` — i18n provider hook.
- `useOnboardingGate` — first-launch redirect logic.
- `useSectionShortcuts` / `useAutoUpdateToasts` / `useCrossCuttingToasts` / `useWorkflowSchema` — feature-specific.

### 11.5 i18n

`src/shared/locale/types.ts` defines the `LocaleMessages` interface. `en-US` and `zh-CN` files implement it; missing keys are compile errors. Access via `useT()`.

---

## 12. Testing Strategy

- **Framework**: Vitest 4.1, v8 coverage.
- **Layout**: `apps/electron/tests/{unit,integration,diagnostic}/...` mirrors `src/`.
- **Mocking DI**: provide fake objects implementing the relevant `core/foundation/interfaces/` or module-local `interfaces/`. Never mock the tsyringe container.
- **Integration tests**: build a `Harness` that wires the real domain services (`ConversationService`, `InquiryRouter`, `ConversationOrchestrator`) with in-memory fakes for repos, an in-memory `EventBus`, and stub `RunCoordinator` / `TaskOrchestrator`. Pattern is established in `tests/integration/inquiry-happy-path.test.ts` — full ask → route → respond → resolve → wake-initiator loop with assertion of event ordering.
- **Diagnostic tests**: non-automated scripts under `tests/diagnostic/` for manual external-integration smoke tests (real `claude` CLI, real DB).
- **Coverage exclusions**: `core/index.ts` and `core/bootstrap/composition-root.ts`.

---

## 13. Critical Implementation Rules (must-follow)

These are derived from `_bmad-output/project-context.md` and the current code. They override personal preference:

- **ESM only**, no `.js` extensions, use path aliases.
- **No `any`, no implicit returns, strict null checks.**
- **All interfaces** prefix with `I`, one per file, in `modules/<X>/interfaces/` or `foundation/interfaces/`.
- **All DI tokens** as `Symbol` constants in `foundation/tokens.ts`, `SCREAMING_SNAKE_CASE_TOKEN`.
- **No default exports.** No barrel `index.ts`.
- **Validate at boundaries** with Zod (config + IPC + outbox).
- **Custom errors** extending `CapibaraError` with `code` + `cause`.
- **Domain code → application layer**: `application/` (handlers + module registration) may depend on `modules/` and `foundation/`. `modules/` may not depend on `application/`. Nothing in `modules/` may import `infrastructure/` directly — go through `foundation/interfaces/`.
- **No `new`** outside `composition-root.ts` and `bootstrap/<x>.module.ts`.
- **No Node API in renderer.** Always `window.capibara`.
- **No business logic in IPC handlers.** Validate → service → wrap.
- **No store-wide destructuring.** Fine-grained selectors only.
- **Add new IPC channels in three places**: preload (`api` map) + `ipc-handlers/<domain>.handlers.ts` + the matching service. Update `event-broadcaster.ts` if it triggers a renderer refresh.
- **Add new domain events**: payload interface + `DomainEventMap` entry + Zod parser in `event-schemas.ts` + (if user-visible) mapping in `event-broadcaster.ts`.
- **Add new MCP tools**: handler in `mcp/handlers/`, registration in `mcp.module.ts`, **and** mirror the static list in `mcp/bridge/capibara-mcp-bridge.ts` (the bridge does not auto-discover).
- **i18n keys**: add to BOTH `en-US.ts` and `zh-CN.ts`. The `LocaleMessages` interface enforces it.
- **Config is immutable after load.** No runtime mutation.
- **Preload builds to CommonJS (`.cjs`).** Don't use ESM-only deps in preload unless externalised.
- **better-sqlite3 is synchronous.** No `await`.
- **Native modules** (better-sqlite3): rebuild via `pnpm --filter @capibara/electron postinstall` if rebuild errors appear.

---

## 14. End-to-End Reference Flows

### 14.1 New org → first task running

1. User imports an org template → `OrgTemplateService` writes `organizations`, `roles`, `process_schemas`, then publishes `org:created`, `role:created`s, etc.
2. The template seeds a root task → `task:created`.
3. `TaskOrchestrator.onTaskCreated` sees `parentId=null` and `org.autoStartOnCreate=true` → `scheduleNext(orgId)`.
4. `TaskScheduler` returns the root pending task; orchestrator calls `tryWake(assignee, org, 'task_scheduled', taskId)`. The task stays in `pending`.
5. Gate ok → `RunCoordinator.executeForTask` → `RunEngine.execute(...)`.
6. RunEngine records the run as `running`, then **R2**: `advanceTaskToActive` transitions the task from `pending` → `in_progress` (`triggeredBy:'system'`). This emits `task:status-changed` with `triggeredBy:'system'`, which `TaskOrchestrator` ignores (no double-wake).
7. CLI runs to completion → RunEngine **R3**: `rollbackTaskIfActive` — if the agent already moved the task to terminal/approval, no-op; otherwise rolls back to `pending`. Then emits `run:succeeded`.
8. `RunOrchestrator.onRunEnded` → drain pending wakes (none) + `scheduleNext` (no further work).

### 14.2 Decomposition — preview mode (human-approved)

1. Role's CLI calls `capibara_plan_submit_tree({rootTaskId, tree})`.
2. Handler validates structure, persists `pending_plan_trees` with `status='active'`, version=1.
3. Emits `plan-tree:submitted` → `PlanningService.onTreeSubmitted` opens a `plan_review` conversation in the inbox.
4. `EventBroadcaster` fires `plan-tree:ready` to the renderer; the user sees the inbox card.
5. User approves → IPC `capibara:plan-tree:approve` → `PlanningService.approvePlanTree(rootTaskId, expectedVersion)`:
   - inserts child tasks with the existing rootTaskId as parent,
   - updates pending status to `approved`,
   - completes the `plan_review` conversation,
   - emits `plan-tree:approved`.
6. `TaskOrchestrator.onPlanTreeApproved` → `scheduleNext(orgId)` to start the first child.

### 14.3 Conversational planning (no task yet)

1. User opens the planning composer → IPC `capibara:planning:start(orgId, agentRoleId, firstMessage)`.
2. `ConversationService.createPlanning(...)` writes the `planning` conversation, emits `conversation:created` + `conversation:response-needed`.
3. `ConversationOrchestrator` wakes the planning role → CLI runs with the conversation prompt that includes the type schema + available roles.
4. AI replies via the conversation (`addMessage`) — possibly several rounds, with the user replying via the UI (each user message triggers `addMessage` with `authorType='human'`, which wakes the agent again).
5. Eventually the AI calls `capibara_plan_submit_tree({conversationId, tree})`.
6. `PlanningService` persists the pending tree anchored to the conversation. User reviews + approves.
7. On approve, the tree's top-level children become root tasks; the planning conversation is `resolved`.

### 14.4 AI ↔ AI inquiry

See **Section 9** for the full timeline.

### 14.5 Failure + retry

1. CLI exits non-zero → `run:failed`.
2. `RunOrchestrator.onRunFailed` schedules a retry via `RetryScheduler` with backoff.
3. After `retryBackoffMs`, `RetryScheduler` calls `tryWake(roleId, orgId, 'retry_failed', taskId)`.
4. Up to `maxRetryOnFailure` retries; afterwards the task remains in its current status and the user must intervene.

---

## 15. Open Architectural Notes

These are present in the code but worth flagging for future evolution:

- **No global `contracts.ts`.** IPC channel strings live in two places (preload + handlers). Centralising them is a known clean-up — not a blocker.
- **Process schema editor** is in the renderer but there is no in-app schema migration tool — schema changes require manual edits + reload.
- **Single-active-run-per-org** is a deliberate constraint; concurrent execution within an org would require a richer scheduler and is out of scope for v1.
- **MCP bridge** holds a hard-coded static tool list (`bridge/capibara-mcp-bridge.ts`). When tools are added, both the registry AND the bridge must be updated. Long term, the bridge could fetch tools from the HTTP server at startup.
- **`external_session_id`** lets conversation runs resume a Claude CLI session, but session corruption is handled only with a one-shot retry without `--resume`. There is no quota / rotation for sessions.
- **Outbox table is unbounded.** Published rows are never deleted. Add a periodic GC if storage becomes a concern.
- **Workflow schema cache** in `ProcessEngine` is per-process, in-memory. If schemas were ever changed by another process, this cache would be stale — not currently possible since main is the only writer.

---

*This is the authoritative architecture. All older `_bmad-output/planning-artifacts/*.md` files are superseded.*
