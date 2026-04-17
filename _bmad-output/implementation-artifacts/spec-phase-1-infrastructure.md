---
title: 'Phase 1 — Infrastructure Foundation'
type: 'feature'
created: '2026-04-17'
status: 'done'
baseline_commit: '24e013a'
context:
  - '_bmad-output/planning-artifacts/refactoring-architecture-plan.md'
  - '_bmad-output/planning-artifacts/implementation-plan.md'
  - '_bmad-output/project-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The new architecture (three-pillar design) requires a fresh `src/core/` directory with shared infrastructure — DB schema, DI tokens, event bus, logger, config, error hierarchy, and in-memory stores. No module can be built until this foundation exists.

**Approach:** Create the `src/core/` skeleton with all cross-cutting infrastructure: Foundation layer (tokens, events, errors, shared interfaces), SQLite persistence with the new greenfield schema (12 tables using renamed terminology), observability (Pino logger + Emittery event bus), config loader, PendingPlanStore, and a `@core/*` path alias. Each file follows existing patterns from `src/main/` but applies the new naming conventions from the architecture plan.

## Boundaries & Constraints

**Always:**
- All new code under `apps/electron/src/core/` — never modify `src/main/`
- Follow existing code style: `@injectable()`, Symbol-based DI tokens, `SCREAMING_SNAKE_CASE_TOKEN`, kebab-case filenames, `I` prefix for interfaces
- DB schema is greenfield (single migration v1) — renamed tables (`tasks` not `task_nodes`, `process_schemas` not `workflow_schemas`, `conversations` not `conversation_workflows`), renamed columns (`wake_reason` not `trigger`, `task_id` not `task_node_id`)
- ESM imports, no `.js` extensions (Bundler resolution), no default exports
- `better-sqlite3` is synchronous — no unnecessary async/await

**Ask First:**
- If any new npm dependency is needed beyond what's in package.json
- If the config schema needs fields not present in the existing config

**Never:**
- Do not create module-specific code (services, repositories, engines) — only shared infrastructure
- Do not modify any file in `src/main/`, `src/shared/`, or `src/renderer/`
- Do not create IPC handlers or bootstrap module registration files (those come in later phases)

</frozen-after-approval>

## Code Map

- `apps/electron/tsconfig.json` -- Add `@core/*` path alias
- `apps/electron/electron.vite.config.ts` -- Add `@core/*` resolve alias
- `src/core/foundation/tokens.ts` -- All DI token symbols (per architecture plan Section 8)
- `src/core/foundation/events.ts` -- DomainEventType union + DomainEvent interface (new event names)
- `src/core/foundation/errors/capibara.errors.ts` -- Error hierarchy (CapibaraError base + domain errors)
- `src/core/foundation/interfaces/i-logger.ts` -- ILogger interface
- `src/core/foundation/interfaces/i-event-bus.ts` -- IEventBus interface
- `src/core/foundation/interfaces/i-sqlite-connection.ts` -- ISqliteConnection interface
- `src/core/infrastructure/persistence/sqlite/sqlite-connection.ts` -- SqliteConnection implementation
- `src/core/infrastructure/persistence/sqlite/migrations.ts` -- Full greenfield DDL (12 tables, 1 migration)
- `src/core/infrastructure/observability/pino-logger.ts` -- PinoLogger implementation
- `src/core/infrastructure/observability/emittery-event-bus.ts` -- EmitteryEventBus implementation
- `src/core/infrastructure/stores/pending-plan.store.ts` -- PendingPlanStore (in-memory Map)
- `src/core/config/config.types.ts` -- CapibaraConfig type definition
- `src/core/config/config.schema.ts` -- Zod validation schema
- `src/core/config/config.defaults.ts` -- Default values
- `src/core/config/config.loader.ts` -- Multi-source config loading
- `src/core/index.ts` -- Entry point stub (placeholder for Electron app init)

## Tasks & Acceptance

**Execution:**
- [x] `apps/electron/tsconfig.json` -- Add `@core/*` path alias pointing to `src/core/*`
- [x] `apps/electron/electron.vite.config.ts` -- Add `@core/*` resolve alias in main and preload builds
- [x] `src/core/foundation/tokens.ts` -- Create all DI tokens from architecture plan Section 8 (~30 tokens)
- [x] `src/core/foundation/events.ts` -- Create DomainEventType with new event names (conversation:*, process:*, approval:*, removed discussion/narrative/session events)
- [x] `src/core/foundation/errors/capibara.errors.ts` -- Create error hierarchy: CapibaraError, NotFoundError, ValidationError, TaskStateError, BudgetExceededError, ExecutionError, ConversationStateError, ConversationRoutingError, ConversationTimeoutError (drop ConsensusError, CircuitBreakerError)
- [x] `src/core/foundation/interfaces/i-logger.ts` -- Copy ILogger from legacy (info/warn/error/debug/child)
- [x] `src/core/foundation/interfaces/i-event-bus.ts` -- Copy IEventBus from legacy (emit/on/off)
- [x] `src/core/foundation/interfaces/i-sqlite-connection.ts` -- Copy ISqliteConnection from legacy (getDb/close)
- [x] `src/core/infrastructure/persistence/sqlite/sqlite-connection.ts` -- Adapt SqliteConnection from legacy (WAL mode, foreign keys, busy timeout)
- [x] `src/core/infrastructure/persistence/sqlite/migrations.ts` -- Greenfield DDL with 12 tables: organizations, roles, skills, tasks, process_schemas, conversations, conversation_messages, conversation_events, runs, cost_entries, pending_wakes, settings
- [x] `src/core/infrastructure/observability/pino-logger.ts` -- Adapt PinoLogger from legacy
- [x] `src/core/infrastructure/observability/emittery-event-bus.ts` -- Adapt EmitteryEventBus from legacy
- [x] `src/core/infrastructure/stores/pending-plan.store.ts` -- Create PendingPlanStore (in-memory Map with get/set/delete/has)
- [x] `src/core/config/config.types.ts` -- Create CapibaraConfig type (same structure as legacy, reviewed for completeness)
- [x] `src/core/config/config.schema.ts` -- Create Zod schema matching CapibaraConfig
- [x] `src/core/config/config.defaults.ts` -- Create DEFAULT_CONFIG
- [x] `src/core/config/config.loader.ts` -- Create loadConfig with global + project merge + Zod validation
- [x] `src/core/index.ts` -- Minimal entry point stub

**Acceptance Criteria:**
- Given `src/core/` is created, when `pnpm build` runs, then compilation succeeds with zero errors
- Given the new DDL, when SQLite database is created, then all 12 tables exist with correct columns, constraints, and indexes
- Given PinoLogger is instantiated, when info/warn/error/debug are called, then structured JSON output is produced
- Given EmitteryEventBus is instantiated, when emit + on are called for a DomainEventType, then the handler receives the event
- Given loadConfig is called, when global and project config files exist, then they are deep-merged, Zod-validated, and runtime paths resolved
- Given PendingPlanStore, when set/get/delete/has are called, then in-memory state is correctly managed

## Verification

**Commands:**
- `pnpm --filter @capibara/electron build` -- expected: compilation succeeds with no errors
- `pnpm --filter @capibara/electron typecheck` -- expected: zero type errors

## Suggested Review Order

**Foundation — Core contracts and cross-cutting definitions**

- All DI tokens following architecture plan Section 8 (~30 symbols)
  [`tokens.ts:1`](../../apps/electron/src/core/foundation/tokens.ts#L1)

- New event taxonomy: conversation:*, process:*, approval:* (replaces discussion/session)
  [`events.ts:1`](../../apps/electron/src/core/foundation/events.ts#L1)

- Error hierarchy — dropped ConsensusError/CircuitBreakerError, fixed BudgetExceededError units
  [`capibara.errors.ts:1`](../../apps/electron/src/core/foundation/errors/capibara.errors.ts#L1)

- Shared interfaces: ILogger, IEventBus, ISqliteConnection
  [`i-logger.ts:1`](../../apps/electron/src/core/foundation/interfaces/i-logger.ts#L1)

**Persistence — Greenfield DDL with renamed tables and columns**

- 12-table schema with partial unique index fix, nullable respondent_type
  [`migrations.ts:14`](../../apps/electron/src/core/infrastructure/persistence/sqlite/migrations.ts#L14)

- SQLite connection wrapper — now throws CapibaraError instead of plain Error
  [`sqlite-connection.ts:1`](../../apps/electron/src/core/infrastructure/persistence/sqlite/sqlite-connection.ts#L1)

**Observability — Logger and event bus**

- PinoLogger with child() level propagation fix
  [`pino-logger.ts:36`](../../apps/electron/src/core/infrastructure/observability/pino-logger.ts#L36)

- EmitteryEventBus — fire-and-forget with console.error fallback
  [`emittery-event-bus.ts:1`](../../apps/electron/src/core/infrastructure/observability/emittery-event-bus.ts#L1)

**Shared Stores**

- PendingPlanStore with 24h TTL auto-expiry on get()
  [`pending-plan.store.ts:12`](../../apps/electron/src/core/infrastructure/stores/pending-plan.store.ts#L12)

**Config Pipeline**

- Config type with precise logging.level union
  [`config.types.ts:1`](../../apps/electron/src/core/config/config.types.ts#L1)

- Zod validation schema
  [`config.schema.ts:1`](../../apps/electron/src/core/config/config.schema.ts#L1)

- Multi-source config loader (global + project merge)
  [`config.loader.ts:43`](../../apps/electron/src/core/config/config.loader.ts#L43)

**Build Configuration**

- @core/* path alias added to both main and preload builds
  [`electron.vite.config.ts:13`](../../apps/electron/electron.vite.config.ts#L13)

- TypeScript path alias
  [`tsconfig.json:22`](../../apps/electron/tsconfig.json#L22)
