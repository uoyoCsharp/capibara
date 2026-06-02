# Requirements Analysis: Capibara Architecture Refactor (per architecture-final-v2)

> Source baseline: `docs/architecture-final-v2.md` (Final 2.0, 2026-06-02)
> Target branch: `acp-refactor`
> Scope decision (confirmed with user): **Full roadmap — Phase 0 through Phase 4**
> Delivery decision (confirmed with user): **Analysis artifact only; execution path to be decided later**
>
> Note: The v2 document is a *ratified architecture baseline* — its 8 decisions (D-1..D-8) and 3 business-correctness prerequisites (A-1/A-2/A-3) are settled. This analysis does NOT re-open those decisions. It captures *what work the refactor entails, what the current code actually looks like, and which assumptions must be verified before each work order (OP) lands*.

## Feature Overview

Restructure the Capibara Electron main process (`apps/electron/src/core/`) to conform to the Final 2.0 hexagonal architecture baseline. The refactor is organized as a sequence of independently-revertable work orders (OPs) grouped into 5 phases, preceded by 4 mandatory safety-net prerequisites (G-1..G-4).

The refactor is **structure- and correctness-oriented, not feature-oriented**: no new product capability is added. The goals are (1) enforce layer dependency direction mechanically, (2) move domain invariants out of protocol adapters into domain services, (3) make cascade-delete and event-subscriber semantics correct and honest, and (4) relocate protocol mechanics into `infrastructure/` while keeping business-facing adapters on the primary side.

### Phase / OP map (full roadmap)

| Phase | Work orders | Theme |
|-------|-------------|-------|
| **Phase 0 (prerequisite safety net)** | G-1, G-2, G-3, G-4 | Layering CI guard + 3 business-correctness fixes. Must merge before any refactor OP. |
| **Phase 1** | OP-1, OP-2 | Interface extraction (Service x4, Engine x3) |
| **Phase 2** | OP-3, OP-6, OP-10 | Decoupling (Coordination eventization, Notification -> Secondary, Workflow->Conversation FK CASCADE) |
| **Phase 3** | OP-5, OP-8 | Splits (MCP split + move out of modules/, ACP internal layering) |
| **Phase 4** | OP-7, OP-9 | Layer reclassification (D0-D3) + naming alignment (InquiryRouter) |
| (done) | ~~OP-4~~ | Orchestrator split into 3 — **already complete on acp-refactor**, verified in code. |

## Actors

| Actor | Role in this refactor |
|-------|----------------------|
| Development team | Implements each OP as an independent, revertable PR |
| CI pipeline | Runs `arch:check` (dependency-cruiser) as a per-PR merge gate (introduced by G-1) |
| PR reviewer | Enforces idempotency-declaration checklist on any new `eventBus.on(...)` (G-4 / §12.4) |
| Electron main process (runtime) | Single-threaded serialization currently backs the "one active run per org" invariant (A-4, informational) |
| AI agent (MCP client) | Consumes MCP tools; after OP-5 these become thin ToolProviders with zero domain validation |
| Renderer (human) | Unaffected — IPC channels and renderer are explicitly out of scope (DB schema is the only exception) |

## Requirements

### Phase 0 — Prerequisite safety net (must land before any refactor OP)

- **G-1 — Layering CI guard (dependency-cruiser).** Add `apps/electron/.dependency-cruiser.cjs` encoding the §7 DAG as 4 forbidden rules + a whitelist of allowed cross-layer edges (§8.2). Add `arch:check` script to `package.json`; non-zero exit blocks CI. This is the single biggest gap in Final 1.0 — without it the dependency DAG is only a hand-drawn diagram with no enforcement.
- **G-2 — Sink plan-tree node/depth invariants into Planning.** Move `MAX_TREE_NODES = 500` / `MAX_TREE_DEPTH = 10` and their validation out of the MCP adapter into `PlanningService`, enforced at **both** entry points (submit + approvePending). MCP handler becomes a thin forwarder.
- **G-3 — Cascade delete: FK `ON DELETE CASCADE` + remove app-layer cascade.** Change `conversations.task_id` FK and delete `task.service.ts`'s `setConversationRepository` / `convRepo` / cascade loop. **(See Ambiguity Q1 — current FK is `ON DELETE SET NULL`, not the doc's implied behavior.)**
- **G-4 — Subscriber idempotency contract + fix `onResponseNeeded`.** Add `UNIQUE` constraint to `pending_wakes`, switch insert to `INSERT OR IGNORE`/upsert, and adopt the §12.4 idempotency contract as a team standard + PR checklist item.

### Phase 1 — Interface extraction

- **OP-1 — Extract 4 Service interfaces** (`ITaskService`, `IConversationCommandService`, `IRoleQueryService`, `IPlanningService`) so cross-module callers depend on `foundation`/`interfaces` rather than concrete classes. Prerequisite for D-2 / D-4 and for OP-5.
- **OP-2 — Extract 3 Engine interfaces** (e.g. `TaskStateMachine`, `ProcessEngine`, `BehaviorEngine`). Prerequisite for OP-5.

### Phase 2 — Decoupling

- **OP-3 — Eventize Coordination -> Conversation write-back.** Replace the concrete-class write-back with a `conversation:route-resolved` event. **Subscriber must be idempotent** (per G-4 contract).
- **OP-6 — Move Notification to a Secondary Adapter** under `infrastructure/notification/` (event-broadcaster + notification.service).
- **OP-10 — Workflow->Conversation cascade delete -> FK CASCADE.** Removes the hidden Workflow->Conversation edge in the dependency DAG. Overlaps with G-3 (the doc lists the FK change under both — see Ambiguity Q2).

### Phase 3 — Splits

- **OP-5 — Split MCP and move out of `modules/`.** Protocol core -> `infrastructure/mcp-protocol/`; ToolProviders -> `mcp/providers/` (primary side, depends on domain interfaces). **Depends on G-2 completing first** so domain validation isn't stranded in the adapter. Current state: `modules/mcp/handlers/*-tools.ts` + `register*Tools()` functional registration.
- **OP-8 — ACP internal layering.** `client/` (spawn/wire/transport/sweeper) -> `infrastructure/acp-protocol/` (Secondary); `collaboration/` + `policies/` + session lifecycle stay in `modules/acp/` (D1). Fix B-1/B-2/B-4 in passing.

### Phase 4 — Reclassification & naming

- **OP-7 — Relayer modules into D0-D3** per §4.
- **OP-9 — Move Coordination up to D3 + naming alignment.** Rename the active `InquiryRouter` (subscribes `conversation:needs-routing`) to `InquiryOrchestrator`, or keep `Router` but explicitly document it as a D3 active unit. The passive `InquiryEscalationService` keeps its `Service` suffix (correct — it is polled, not event-driven).

### Cross-cutting acceptance requirements (§14.3)

- Every OP PR must pass `arch:check` (exit code 0) as a merge gate.
- Cross-module concrete-class imports reduced from ~11 to 0.
- Plan-tree invariants verified present in `PlanningService`, absent from MCP handler (grep checks per §13.1).
- `pending_wakes` has a uniqueness constraint + conflict-ignore (§13.3).
- No regression: vitest suite + startup smoke test pass.
- Each OP is an independent PR, independently `git revert`-able, producing no cascading rollback.

## Domain Concepts

| Concept | Meaning in this refactor |
|---------|--------------------------|
| Hexagonal skeleton | Primary (inbound/driving) + Domain Core + Secondary (outbound/driven) adapters. Conceptual roles by control-flow direction. |
| Folder convention (C-7) | Top-level folders group by **technical-vs-business**, NOT inbound-vs-outbound. `infrastructure/` = all technical/framework mechanics (both mcp-protocol and acp-protocol live here). |
| D0-D3 layers | Domain Core role labels: D0 structural core (Organization), D1 capability domains (Conversation/Workflow/acp-domain/Execution/Planning), D2 derived services (Prompt), D3 reactive orchestration (Coordination + 3 Orchestrators). |
| Layer = role label | Layers explain "why a module is here", NOT strict dependency rank. Same-layer dependencies allowed. The dependency *truth* is the §7 DAG, *enforced* by §8 dependency-cruiser. |
| Dependency guard | dependency-cruiser CI rules promoting the dependency DAG from a diagram to an enforced, machine-checked rule set. |
| At-least-once / idempotency | Outbox delivery semantics; the dual obligation is that every subscriber is idempotent (§12.4). |
| Transactional Outbox | Write event to outbox table in the same tx as business data, publish asynchronously. |
| Port / Adapter | Domain-defined interface / concrete class implementing it. |
| Front door / Back door | TaskOrchestrator (pre-Run admission) / RunOrchestrator (post-Run continuation). |
| `IExecutor` | The existing AI abstraction boundary; Execution touches AI only via this port (D-7). Planning has **zero** AI references. |

## Business Rules

These are the invariants the refactor must preserve or relocate (not change):

### Must relocate (moved by an OP)
- Plan-tree node/depth limits (500 / 10 / no self-nesting) — **move from MCP adapter to PlanningService**, enforce at submit + approve (A-1 / G-2).

### Must preserve (cannot break during a move)
- Conversation: only terminal-state conversations (resolved/cancelled/completed/timed_out/escalated) are deletable *standalone*. FK CASCADE intentionally bypasses this guard for owner-cascade (owner = task); these are two independent rules (A-2 / §13.2).
- Workflow: only leaf tasks enter approval; AI roles skip approval; depth = parent + 1, max 10 (B-3: not validated at create() today — fix with OP-2).
- acp-domain: chain depth max 5; circular detection; resume > load > rebuild; three-layer file protection (B-1: resume() lacks try-catch fallback today — fix with OP-8).
- Execution: backoff retry <= 3; orphaned runs marked interrupted; suspension does not roll back task.
- Planning: optimistic locking; one-shot feedback; 24h expiration.
- Concurrency: one active run per org — currently backed by single-threaded main process (A-4, informational; needs DB-level `UNIQUE(org_id) WHERE status='running'` if worker/multiprocess is ever introduced).

### Naming contract (D-8)
- D3 active orchestration units use the `Orchestrator` suffix; never `Service`.
- `InquiryEscalationService` is passive (polled via `scanAndEscalate()`) — keeps `Service`.
- `InquiryRouter` is active (subscribes events) — to be renamed/reclassified (OP-9).

## Ambiguities & Questions

> The v2 decisions are settled, so these are **execution-level clarifications**, surfaced from cross-checking the doc against the actual code on `acp-refactor`. They affect *how* an OP lands, not *whether*. They do not block producing this analysis; they should be resolved before the relevant OP is implemented.

**Q1 (A-2 / G-3 — affects migration design). [RESOLVED 2026-06-02]** The doc implies the current cascade "force-deletes non-terminal conversations by bypassing the guard". **Code reality:** `conversations.task_id` is currently `ON DELETE SET NULL` (verified, migrations.ts:124). The actual app-layer cascade lives in `task.service.ts:114-117` (`convRepo.delete()` loop). Switching to `ON DELETE CASCADE` changes behavior from "orphan + null out task_id" to "delete the conversation row". This is the intended end state, but: (a) the migration must alter an existing FK (SQLite requires table rebuild, not a simple ALTER), and (b) this area was just touched by change `20260601-planning-history-delete`.
> **DECISION:** Force delete — adopt FK `ON DELETE CASCADE` so deleting a task **deletes the conversation row** (not SET NULL orphaning). A **SQLite table-rebuild migration is accepted** (create new table with the corrected FK, copy rows, drop old, rename). G-3 / OP-10 implement this; the app-layer `convRepo` cascade loop in `task.service.ts` is then removed.

**Q2 (G-3 vs OP-10 overlap).** The FK CASCADE change appears as both a Phase 0 prerequisite (G-3) and a Phase 2 work order (OP-10). **Confirm:** should the FK migration land once in Phase 0 (G-3) with OP-10 reduced to "remove the now-dead `convRepo` setter/loop", or are these genuinely two separate steps?

**Q3 (G-4 — pending_wakes UNIQUE key with NULLs). [RESOLVED 2026-06-02]** The proposed `UNIQUE(org_id, role_id, task_id, conversation_id, reason)` includes nullable columns (`task_id`, `conversation_id`). In SQLite, NULLs are distinct in unique indexes, so two rows with the same non-null values but NULL task_id would NOT collide — defeating the dedup.
> **DECISION:** Use the COALESCE-to-sentinel approach for nullable columns in the uniqueness key — e.g. a unique index over `(org_id, role_id, COALESCE(task_id,''), COALESCE(conversation_id,''), reason)` — so rows with NULL task_id still dedup correctly. Insert path switches to `INSERT OR IGNORE` / upsert against this index. G-4 implements this.

**Q4 (G-1 — dependency-cruiser rule 4 capture-group backref).** The "same-module allowed, cross-module forbidden" rule relies on capture-group backreference (`pathNot: '$1'`), which the doc itself flags as possibly unstable. **Confirm:** acceptable to fall back to explicit per-module whitelist edges (§8.2) if the backref form proves flaky in our dependency-cruiser version?

**Q5 (OP-7 path-rename blast radius).** OP-7/OP-5/OP-8 move files across folders, changing import paths broadly. The codebase uses `@core/...` path aliases. **Confirm:** is a per-OP "move + fix imports + run arch:check + test" loop the accepted cadence, accepting that each such PR will have a large diff?

## Change Tracking

- **change-id:** `20260602-architecture-refactor`
- **title:** Capibara Architecture Refactor (architecture-final-v2)
- **scope:** Full roadmap, Phase 0-4 (G-1..G-4 + OP-1/2/3/5/6/7/8/9/10). OP-4 already complete.
- **delivery:** Analysis artifact only; execution path (plan.yaml vs. direct implement) to be decided later.
- **source baseline:** `docs/architecture-final-v2.md`
- **code-verification state (acp-refactor branch, 2026-06-02):**
  - OP-4: ✅ done (3 orchestrators + shared components present).
  - G-1: ❌ no `.dependency-cruiser.cjs`, no `arch:check`.
  - G-2 (A-1): ❌ MAX_TREE_* still only in `modules/mcp/handlers/plan-tree-tools.ts`.
  - G-3 (A-2): ❌ `conversations.task_id` is `ON DELETE SET NULL`; `task.service.ts` still has `convRepo` + cascade loop.
  - G-4 (A-3): ❌ `pending_wakes` has no UNIQUE constraint; `onResponseNeeded` present in `conversation.orchestrator.ts`.
  - D-8: ❌ both `inquiry.router.ts` (active) and `inquiry-escalation.service.ts` (passive) present, naming not yet aligned.
