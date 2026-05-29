---
id: 'implement-output'
version: '1.0'
skill: 'mvt-implement'
change-id: '20260528-acp-session-lifecycle'
task: 't9-renderer-history-and-rehydration'
---

# Implementation: ACP Session Lifecycle — t9 (Planning History List + Page Rehydration)

## Implementation Summary

t9 adds the planning conversation history surface (REQ-P2) and flicker-free page rehydration
(REQ-P4, BR-13), completing the change. A new `capibara:planning:history` IPC channel returns a
lean read model (`PlanningHistoryEntry`: id, derived title, state, timestamps) sourced entirely
from the conversation table (D-2 — `session/list` is only a loadability check, never the listing
source). `ConversationService.findPlanningHistory(orgId)` filters planning-type conversations,
sorts newest-first, and derives each title from the conversation's first human message (first line,
truncated to 80 chars). A new `PlanningHistory.tsx` renders the list; `PlanningPage` now lands on
this history view (instead of jumping straight into pick-agent), from which the user resumes a past
conversation (by id, via the existing `getConversation`) or starts a new session. Resuming a
selected entry flows through the already-built session-manager dispatch (load → rebuild fallback),
so no new resume logic was needed at this layer.

For rehydration, `conversation.store` gained a per-conversation `messageCache` plus
`getCachedMessages`/`setCachedMessages`. `PlanningChat` seeds its `messages` state synchronously
from the cache on mount and on conversation switch, then refreshes from disk and writes back to the
cache — so re-entering a conversation paints its history immediately with no empty-then-fill reset.

## Files Touched

| Path | Action | Intent |
|------|--------|--------|
| `conversation/types/conversation.types.ts` | modify | Add `PlanningHistoryEntry` read model |
| `conversation/services/conversation.service.ts` | modify | `findPlanningHistory(orgId)` + title derivation |
| `ipc-handlers/conversation.handlers.ts` | modify | `capibara:planning:history` handler |
| `core/shared/types.ts` | modify | `PlanningHistoryRecord` contract mirror |
| `core/shared/api.ts` | modify | `getPlanningHistory` on the renderer API |
| `core/preload/index.ts` | modify | Map `getPlanningHistory` → channel |
| `renderer/store/conversation.store.ts` | modify | `planningHistory`, `messageCache`, load/get/set + `loadPlanningHistory` |
| `renderer/components/planning/PlanningHistory.tsx` | create | History list UI |
| `renderer/components/planning/PlanningPage.tsx` | modify | `history` phase, entry points, resume-by-select |
| `renderer/components/planning/PlanningChat.tsx` | modify | Seed messages from cache for no-flicker rehydration |
| `shared/locale/types.ts`, `en-US.ts`, `zh-CN.ts` | modify | `planning.history.*` strings (typed + both locales) |
| `tests/unit/conversation/conversation-service.test.ts` | modify | findPlanningHistory cases (filter/sort/title/truncate/fallback) |
| `tests/unit/ipc/planning-handlers.test.ts` | modify | `capibara:planning:history` ok + INTERNAL cases |
| `tests/unit/renderer/conversation.store.test.ts` | modify | loadPlanningHistory + message cache cases |
| `tests/unit/renderer/mock-capibara-api.ts` | modify | Add `getPlanningHistory` to the API double |

## Design Compliance

- **Change Tracking**: matches the design's t9 rows — `renderer/components/planning/PlanningHistory.tsx`
  (new), `PlanningPage.tsx`, `conversation.store.ts`, and the IPC/preload/shared channel for the
  history list. The conversation service/types additions are the backing read model for that
  channel (noted below).
- **D-2 honored**: the history list is sourced from the conversation table, not `session/list`.
- **REQ-P2**: history list shows past planning conversations with title + timestamp.
- **REQ-P4 / BR-13**: re-entering a conversation rehydrates from the message cache before first
  paint — no visible reset/flicker.
- **Layer compliance**: renderer talks only through `window.capibara`; the new channel follows the
  exact `capibara:{domain}:{op}` convention and the `ok()/err()` handler wrapper. No forbidden
  imports.
- **Error handling**: only at the IPC boundary (`try/catch` → `err('INTERNAL', …)`), matching the
  sibling handlers.

## Deviations from Design

- **Backing read model added to the conversation module** (`PlanningHistoryEntry` type +
  `findPlanningHistory` service method). The design's Change Tracking named the renderer/IPC/preload/
  shared files for the history channel but not the service method behind it; a dedicated read model
  (lean projection with a derived title) is cleaner than shipping full `ConversationRecord[]` to the
  renderer and matches the "lean projection" spirit of the rest of the change.
- **Default landing view changed to the history list.** Previously `PlanningPage` auto-resumed the
  single active planning conversation, else jumped to pick-agent. Now it resumes an active
  conversation if one exists (unchanged for the common case) but otherwise lands on the history list
  rather than pick-agent. This is the REQ-P2 entry point; "new session" from the list reaches
  pick-agent as before.

## Self-Check Results

- **tsc --noEmit**: clean (exit 0, whole project).
- **Tests**: service + ipc-handler + store suites → 60 passed; full renderer + ipc suites → 145
  passed. Run via the electron ABI runner. New cases: findPlanningHistory (filter to planning,
  newest-first sort, title-from-first-human-message, 80-char truncation, empty-title fallback);
  `capibara:planning:history` (ok passthrough, INTERNAL on throw); store loadPlanningHistory +
  message-cache get/set.
- UI not visually verified in-browser (type-check + unit only) — flagged for manual QA.

## Open TODOs

- **Wire review W1 (forceFullContext on rebuild)**: t8 shipped the `forceFullContext` capability but
  no caller invokes it. The natural home is the resume path — when `RunCoordinator.executeForConversation`
  resolves a bound session whose `resumeStrategy === 'rebuild'` (or status `expired`), it should call
  `promptBuilder.buildForConversation(..., { forceFullContext: true })`. This needs a RunCoordinator↔
  SessionManager seam (read the bound session's strategy) — a small orchestrator change deferred to
  `/mvt-fix` rather than done unscoped here.
- Manual QA of the history list + no-flicker rehydration in the running app.
- Carry-over: t5/t6 review W1/W2 (null-suspensionManager orphan; cancelled→closeReason 'error') still
  open for `/mvt-fix`.

---

# Implementation: ACP Session Lifecycle — t7 (Startup Reconcile + Idle Sweeper) + t8 (Collaboration Liveness + PromptBuilder forceFullContext)

## Implementation Summary

t7 wires the ADR-7 recovery hooks into the application lifecycle. `reconcileOnStartup()` (implemented
in t3) is now invoked during bootstrap right after the ACP module is constructed, marking every
persisted non-terminal session `expired` (agent subprocesses died with the previous app process;
rebuild happens lazily on next use, no eager reconnect). A new `AcpSessionSweeper` owns the periodic
timer that drives `sessionManager.sweepIdle(now)`; it is started at the end of bootstrap and stopped
on shutdown. `sweepIdle` was extended to reclaim two classes in one pass: idle suspensions past
`sessionTtlMs` (default 30 min) and — newly — collaboration suspensions past the absolute liveness
cap `collaborationCapMs` (default 2 h), backed by a new `findCollaborationExpired` repository query.
Idle TTL and the collaboration cap are distinct cutoffs, preserving ADR-5's exemption (collaboration
is not idle-timed, only capped).

t8 adds `forceFullContext` for rebuild reconstruction (ADR-6). `PromptBuilder.buildForConversation`
and `RunContext.buildForConversation` gained an optional `{ forceFullContext }` flag; when set, the
context builder loads the full persisted message history (`ConversationContextBuilder.build` treats
`maxMessages <= 0` as "no cap", using `findByConversationId`) instead of the recent 20-message
window. This lets a rebuilt session reconstruct complete conversational context from persisted
messages, since the agent-side history is gone after a rebuild.

The collaboration liveness *tag* itself (REQ-C6) is already applied on the lifecycle axis:
`acp_sessions.suspendReason = 'collaboration'` is written by the t5 executor's suspend dispatch, and
the sweeper now enforces its TTL-exemption + cap. Per ADR-5's orthogonal-axes decision, this is kept
out of `session-suspension.manager.ts` (the collaboration-waiting axis), which is therefore
intentionally untouched.

## Files Touched

| Path | Action | Intent |
|------|--------|--------|
| `acp/interfaces/i-acp-session.repository.ts` | modify | t7: add `findCollaborationExpired(beforeIso)` |
| `acp/persistence/sqlite-acp-session.repository.ts` | modify | t7: implement `findCollaborationExpired` |
| `acp/client/acp-session.manager.ts` | modify | t7: `sweepIdle` reclaims idle (TTL) + collaboration (absolute cap) |
| `acp/client/acp-session.sweeper.ts` | create | t7: periodic driver for `sweepIdle` (timer only; unref'd) |
| `bootstrap/acp.module.ts` | modify | t7: construct + expose `sessionSweeper` |
| `bootstrap/composition-root.ts` | modify | t7: `reconcileOnStartup()` at boot; start sweeper; stop on shutdown |
| `prompt/builder/prompt.builder.ts` | modify | t8: `forceFullContext` option on `buildForConversation` |
| `prompt/context/run.context.ts` | modify | t8: thread `forceFullContext` → context builder (maxMessages=0) |
| `conversation/context/conversation-context.builder.ts` | modify | t8: `maxMessages <= 0` loads full history |
| `tests/unit/acp/acp-session.manager.test.ts` | modify | t7: collaboration-cap sweep case; FakeRepo gains `findCollaborationExpired` |
| `tests/unit/acp/acp-session.sweeper.test.ts` | create | t7: runOnce, error-swallow, periodic/stop, idempotent-start |
| `tests/unit/prompt/run-context.test.ts` | modify | t8: default vs forceFullContext builder call |
| `tests/unit/prompt/prompt-builder.test.ts` | modify | t8: forwards forceFullContext options |
| `tests/unit/conversation/conversation-context-builder.test.ts` | modify | t8: full-history when maxMessages <= 0 |

## Design Compliance

- **Files touched == Change Tracking**: t7 maps to the design's `bootstrap/*` + session-manager rows;
  t8 maps to `prompt/builder/prompt.builder.ts`. Additions beyond the literal list (`acp-session.sweeper.ts`,
  `run.context.ts`, `conversation-context.builder.ts`, repo `findCollaborationExpired`) are noted as
  deviations below — all implied by ADR-6/7.
- **Layer compliance**: sweeper depends only on the manager interface + logger; bootstrap is the
  composition root (allowed to wire everything); prompt layer changes stay within the prompt module
  and its existing dependency on the conversation context builder. No forbidden imports.
- **Key Interfaces**: `sweepIdle(nowIso)` / `reconcileOnStartup()` signatures unchanged (ADR-7);
  `PromptBuilder.buildForConversation(..., { forceFullContext })` matches ADR-6's documented signature.
- **Error handling**: only at boundaries — the sweeper swallows+logs sweep errors so the periodic
  timer survives (documented one-liner); no other interior catches added.
- **No new external deps.**

## Deviations from Design

- **New `acp-session.sweeper.ts`** (not literally in Change Tracking). ADR-7 calls for "a new sweeper
  task"; the design's File Structure folded it into `bootstrap/*`. Extracted as a small class so the
  wall-clock timer lives outside the manager and the reclamation policy stays unit-testable with an
  injected `nowIso`. Pure addition, no interface break.
- **`run.context.ts` + `conversation-context.builder.ts` touched for t8** (design named only
  `prompt.builder.ts`). The `forceFullContext` flag has to reach the message-fetch site to take
  effect; threading it one level deeper is mechanical and within the same module chain.
- **`session-suspension.manager.ts` intentionally NOT modified** (the plan's t8 note mentioned "light
  edits" there). Per ADR-5's orthogonal-axes decision, the collaboration liveness tag belongs on the
  lifecycle axis (`acp_sessions.suspendReason`), already written by the t5 executor and now enforced
  by the sweeper's cap. Coupling it into the collaboration-waiting manager would re-entangle the two
  axes the design deliberately split. Cycle/depth/aggregation logic is therefore untouched and its
  tests are unaffected.

## Self-Check Results

- **tsc --noEmit**: clean (exit 0, whole project).
- **Tests**: ACP + prompt + conversation-context-builder + run-coordinator suites → 325 passed / 1
  skipped (the documented better-sqlite3 ABI skip), run via the electron ABI runner. New cases:
  collaboration-cap sweep; sweeper runOnce/error-swallow/periodic-stop/idempotent-start; run-context
  default-window vs forceFullContext; prompt-builder option forwarding; context-builder full-history.
- **Pre-existing unrelated failures (NOT introduced here)**: `sqlite-run-repository`,
  `sqlite-cost-entry-repository`, `sqlite-pending-wake-repository` fail in their own `beforeEach` seed
  (`CHECK constraint failed: task_id IS NOT NULL OR conversation_id IS NOT NULL`). Verified identical
  failures on the baseline with this change stashed — these touch none of the files in this task.

## Open TODOs

- `reconcileOnStartup()` currently expires non-terminal sessions unconditionally (no eager
  `session/load` attempt). ADR-7 permits a future optimization to try `load` first; deferred as the
  lazy-rebuild path already covers correctness.
- The sweep interval (5 min) and reconcile are not yet surfaced in `CapibaraConfig`; the sweeper takes
  an injectable interval but bootstrap uses the default. Wire to config if operations needs tuning.
- Review W1/W2 from the t5/t6 review remain open for `/mvt-fix` (unrelated to t7/t8).

---

# Implementation: ACP Session Lifecycle — t5 (Executor decideLifecycle Dispatch) + t6 (Intent Threading)

## Implementation Summary

Replaced the root-cause bug — `AcpExecutor.executePrompt()` calling `closeSession()` on every
exit path — with explicit `decideLifecycle()` dispatch (ADR-2/3), and threaded the caller-supplied
`LifecycleIntent` from `RunCoordinator` through `RunEngine` to the executor (ADR-8). The executor
now holds no lifecycle policy: it calls the pure `decideLifecycle({ intent, stopReason,
hasPendingInquiry })` and dispatches to `suspend('collaboration')`, `suspend('idle')`, or
`close(reason)`. The pending-inquiry path now **suspends** (agent-side session kept alive) instead
of closing; planning continuation (`keep_alive`) suspends idle; task completion
(`close_on_complete`) closes; an abnormal stop reason closes with `'error'`. The resume entry path
now calls `sessionManager.resume()` (dispatches resume|load|rebuild), skips closed sessions, and
logs resume-fallback at **INFO** rather than WARN (REQ-X2). The two deprecated shims
(`resumeSession`/`closeSession`) left by t3 were removed along with their interface declarations —
t5 was their last caller.

For t6, the canonical `LifecycleIntent` type was moved to the execution layer
(`execution.types.ts`) — the shared lower layer that ACP already depends on — and `acp.types.ts`
re-exports it, avoiding a dependency cycle. `ExecutorInput` and `RunExecutionParams` gained an
optional `lifecycleIntent` (defaulting to `close_on_complete`). `RunCoordinator.executeForTask` →
`close_on_complete`, `executeForConversation` → `keep_alive`, and `executeResume` inherits the
original intent (derived from task-vs-conversation context, since intent is not persisted on the
lean record).

## Files Touched

| Path | Action | Intent |
|------|--------|--------|
| `execution/types/execution.types.ts` | modify | Define canonical `LifecycleIntent`; add `lifecycleIntent` to `ExecutorInput`/`RunExecutionParams` |
| `acp/types/acp.types.ts` | modify | Re-export `LifecycleIntent` from execution layer (was locally defined) |
| `execution/engines/run.engine.ts` | modify | Thread `lifecycleIntent` into the `executor.spawn()` call |
| `orchestrator/run.coordinator.ts` | modify | Set intent per entry method (task→close_on_complete, conversation→keep_alive, resume→inherit) |
| `acp/client/acp-executor.ts` | modify | `decideLifecycle` dispatch; remove unconditional close; resume→`resume()`; INFO fallback; skip closed |
| `acp/interfaces/i-acp-session.manager.ts` | modify | Remove deprecated `resumeSession`/`closeSession` declarations |
| `acp/client/acp-session.manager.ts` | modify | Remove deprecated `resumeSession`/`closeSession` shim implementations |
| `tests/unit/acp/acp-executor.test.ts` | modify | New suspend/close/collaboration/resume-fallback cases; drop shim mocks; add `findByAcpSessionId` |
| `tests/unit/orchestrator/run-coordinator.test.ts` | modify | Assert per-method intent; add `executeResume` intent-inheritance cases |

## Design Compliance

- **Files touched == Change Tracking**: matches the design's t5 (`acp-executor.ts`,
  `i-acp-session.manager.ts`) and t6 (`execution.types.ts`, `run.engine.ts`, `run.coordinator.ts`)
  rows. `acp.types.ts` + `acp-session.manager.ts` touched additionally to relocate `LifecycleIntent`
  and remove the t3 shims — both are deviations noted below.
- **Layer compliance**: `LifecycleIntent` placed in the execution layer (lower) and re-exported by
  ACP (higher) — direction-correct, no cycle. ACP executor calls only the session-manager interface
  and the pure policy; no new cross-layer import.
- **Key Interfaces**: `decideLifecycle` consumed exactly per ADR-2 signature; `IAcpSessionManager`
  now matches the design's method set (deprecated shims gone). `ExecutorInput`/`RunExecutionParams`
  gain `lifecycleIntent` per ADR-8.
- **Error handling**: only at the existing executor try/catch boundary (agent I/O); no new interior
  catches.
- **No new external deps.**

## Deviations from Design

- **`LifecycleIntent` relocated to `execution.types.ts`** (re-exported by `acp.types.ts`). The design
  listed the type on `acp.types.ts`, but `RunExecutionParams`/`ExecutorInput` (execution layer) must
  reference it, and the execution layer must not import from ACP. Placing the canonical definition in
  the lower layer and re-exporting upward keeps both layers compiling without a cycle. Type identity
  is preserved, so all existing ACP imports are unaffected.
- **Deprecated shims removed in this task.** t3 deliberately kept `resumeSession`/`closeSession` so
  the executor compiled before t5. t5 is their last caller, so they were removed now (interface +
  impl) rather than left dangling — consistent with the plan's t5 acceptance ("clear t3's deprecated
  shim callers").
- **`executeResume` intent inheritance derived, not persisted.** ADR-8 says resume "inherits the
  suspended session's original intent." The lean `AcpSessionRecord` does not store intent, so it is
  re-derived from the resume decision's context (`taskId` present → `close_on_complete`, else
  `keep_alive`) — the same mapping the original entry methods use. Documented here; if a future task
  needs exact persistence it can add a column.

## Self-Check Results

- **tsc --noEmit**: clean (exit 0, whole project).
- **Tests**: `acp-executor` + `run-coordinator` + `run-engine` → 56 passed. Full `tests/unit/acp`
  dir → 168 passed / 1 skipped (the documented better-sqlite3 ABI skip). Run via the electron ABI
  runner.
- New cases: executor close-on-complete, keep_alive idle-suspend, default intent, abnormal-stop
  close('error'), collaboration suspend (no close), resume-via-manager, INFO resume fallback,
  closed-session skip; coordinator per-method intent + executeResume inheritance (task vs planning).

## Open TODOs

- t8 will reconstruct conversational context on rebuild (`PromptBuilder.forceFullContext`); the
  executor's resume path already tolerates a rebuild transparently via `resume()`.
- If exact resume-intent fidelity is ever required, persist intent on `acp_sessions` (currently
  re-derived in `executeResume`).

---

# Implementation: ACP Session Lifecycle — t4 (Spawner Per-Prompt Context + session/list)

## Implementation Summary

Removed the global `__current__` session sentinel (ADR-4). fs/permission callbacks — which carry
no session id — now resolve their context against the ACP session whose prompt is *in flight on
that specific agent connection*, tracked in a per-agent `inFlightByAgent` map. The session manager
sets/clears the in-flight marker around each `prompt()` turn (in a `finally`), and its context
resolver simplified to a plain acpSessionId→context lookup with no global state. The spawner's
`initialize()` now detects `sessionCapabilities.list` and surfaces it as `AgentCapabilities.supportsList`.

## Files Touched

| Path | Action | Intent |
|------|--------|--------|
| `apps/electron/src/core/modules/acp/types/acp.types.ts` | modify | `AgentCapabilities.supportsList: boolean` |
| `apps/electron/src/core/modules/acp/client/acp-agent.spawner.ts` | modify | `inFlightByAgent` map + `setInFlightSession()` + private `resolveInFlightContext(agentId)`; fs/permission callbacks resolve via in-flight session (closure captures `agentId`); removed `resolveContextForFsRequest`/`__current__`; `supportsList` detection; cleanup on exit/shutdown |
| `apps/electron/src/core/modules/acp/client/acp-session.manager.ts` | modify | Dropped `activeAcpSessionId` global; resolver is now a direct acpSessionId lookup; `prompt()` brackets the turn with `setInFlightSession(agentId, id)` / `(…, null)`; `evict` simplified |
| `apps/electron/tests/unit/acp/acp-agent.spawner.test.ts` | create | 4 cases: two simultaneous connections resolve their own role/cwd/allowedPaths; null when nothing in flight / cleared / no resolver |
| `apps/electron/tests/unit/acp/acp-session.manager.test.ts` | modify | Spawner mock gains `setInFlightSession`; new case asserts prompt marks then clears the in-flight session |

## Implementation Details

- **Per-connection in-flight tracking**: ACP fs/permission callbacks are created once per agent
  connection inside `getOrSpawn`, so each closure captures its own `agentId`. On a callback, the
  spawner looks up `inFlightByAgent.get(agentId)` and resolves *that* session's context. Because
  exactly one prompt is in flight per connection at a time, this is unambiguous and correct under
  multiple concurrent live sessions (the defect `__current__` caused).
- **Lifecycle of the marker**: `AcpSessionManager.prompt()` sets the marker before
  `connection.prompt()` and clears it in a `finally`, so a throwing turn cannot leak stale context
  into a later request. The marker is also dropped on process `exit`/`error` and `shutdown`.
- **`supportsList`**: detected as `!!sessionCaps?.list` (SDK `SessionCapabilities.list` is
  `SessionListCapabilities | null`; presence signals support). Surfaced on `AgentCapabilities` for
  the renderer history list (t9) to decide whether `session/list` validation is available.
- The manager's resolver no longer holds any "current session" state; correctness now lives
  entirely in the spawner's per-connection map.

## Design Compliance

| Check | Result |
|-------|--------|
| Files touched ⊆ Change Tracking | Pass — spawner + types in design `Change Tracking`; the two test files back the changed units; manager edit is the resolver half of ADR-4 (its file already in scope from t3) |
| Module/layer placement | Pass — all within `modules/acp` |
| Public interfaces match `Key Interfaces` | Pass — `supportsList` added per ADR-4/REQ-F4; resolver signature is internal |
| Forbidden cross-layer imports | Pass — no new imports |
| Error handling only at boundaries | Pass — `finally` cleanup around the agent prompt boundary; no new interior try/catch |
| No new external deps | Pass — none |

## Deviations from Design

- **None.** ADR-4 names the spawner as the owner of per-prompt resolution; the manager edit is the
  necessary counterpart (it owned the old `__current__`/`activeAcpSessionId` state that ADR-4
  removes). No new files beyond the two tests.

## Self-Check Results

- **Type-check**: `tsc --noEmit` clean across the whole project.
- **Unit tests**: full ACP dir → **149 passed / 13 skipped** (was 144 + 5 new ADR-4 cases; skips
  are the SQLite ABI-guarded repo tests).
- Suggested broader command before merge: `pnpm --filter electron test:unit`.

## Open TODOs

- t5: rewrite `AcpExecutor.executePrompt` to call `decideLifecycle` and dispatch to
  `suspend`/`close`, removing the deprecated manager shims' last callers.
- t9: use `AgentCapabilities.supportsList` to gate `session/list` loadability validation in the
  planning history list.

## Change Tracking

- Modified: `acp/types/acp.types.ts`, `acp/client/acp-agent.spawner.ts`,
  `acp/client/acp-session.manager.ts`, `tests/unit/acp/acp-session.manager.test.ts`
- Created: `tests/unit/acp/acp-agent.spawner.test.ts`
- Plan task `t4-spawner-concurrency-and-list`: ready to mark **done** via `/mvt-update-plan`.

---

# Implementation: ACP Session Lifecycle — t3 (Session Manager State Machine + Rebuild)

## Implementation Summary

Reworked `AcpSessionManager` (ADR-1/2/3/5/6/7) from an in-memory `Map` into an explicit state
machine over the persisted `IAcpSessionRepository` (single source of lifecycle truth) plus a
write-through `live` cache holding only the non-persistable runtime context (agentId, cwd,
mcpServers, allowedPaths, capabilities) of connections that are currently alive. New methods:
`suspend`/`resume`/`close`/`expire` (transitions guarded by t1's `assertTransition`),
`reconcileOnStartup`, `sweepIdle`, plus a private `rebuild`. `IAcpSessionManager` was rewritten
to the new method set; the old `resumeSession`/`closeSession` survive as `@deprecated` shims so
the executor (t5's scope) and its tests keep compiling.

## Files Touched

| Path | Action | Intent |
|------|--------|--------|
| `apps/electron/src/core/modules/acp/client/acp-session.manager.ts` | modify | Full rewrite: repo-backed state machine + live cache; suspend(no protocol close)/resume(resume\|load\|rebuild)/close/expire; reconcileOnStartup; sweepIdle; rebuild; per-prompt `activeAcpSessionId`; `setSessionRebuilder` injection point |
| `apps/electron/src/core/modules/acp/interfaces/i-acp-session.manager.ts` | modify | New method set (`AcpSessionRecord` return type, suspend/resume/close/expire/reconcile/sweep); deprecated `resumeSession`/`closeSession` retained |
| `apps/electron/src/core/modules/acp/persistence/sqlite-acp-session.repository.ts` | modify | Added `acpSessionId` to `PATCHABLE_COLUMNS` (rebuild re-points the agent-side id) |
| `apps/electron/src/core/bootstrap/acp.module.ts` | modify | Construct `SqliteAcpSessionRepository`; inject repo + collaborationConfig into manager; expose `sessionRepository` on the module |
| `apps/electron/tests/unit/acp/acp-session.manager.test.ts` | modify | Rewritten around an in-memory `FakeAcpSessionRepository`; 16 cases over create/suspend/resume(resume\|load\|rebuild)/close/expire/reconcile/sweep/getActive/shutdown + illegal-transition rejection |
| `apps/electron/tests/unit/acp/acp-executor.test.ts` | modify | Added the 6 new manager methods to the mock so it satisfies `IAcpSessionManager` |

## Implementation Details

- **Suspend ≠ close (ADR-3)**: `suspend()` only flips status + records `suspendReason`; it never
  calls `connection.closeSession`. Protocol close happens solely in `close()`/`expire()` (via
  `protocolClose`, which no-ops when no live connection exists — e.g. post-restart).
- **Resume dispatch (ADR-6)**: `resume()` rebuilds when there is no live runtime, when
  `resumeStrategy === 'rebuild'`, or when the record is `expired`; otherwise it calls
  `resumeSession`/`loadSession`. It then transitions to `active`, clears `suspendReason`, and
  increments `resumeCount`.
- **Rebuild**: opens a fresh `newSession` and re-points the record's `acpSessionId`. Runtime
  context is taken from the live cache when present, else from an injected `SessionRebuilder`
  (`setSessionRebuilder`) — the role+org re-derivation and PromptBuilder context reconstruction
  are deferred to t7/t8, so this task throws a clear error if rebuild is needed without either.
- **Reconcile (ADR-7)**: `reconcileOnStartup()` marks every `findNonTerminal()` record `expired`
  directly via the repo, deliberately bypassing `assertTransition` — `active→expired` is illegal
  for *live* transitions but is the correct crash-recovery semantic (the agent died with the app).
  Documented inline.
- **Sweep (ADR-7)**: `sweepIdle(now)` computes `now - sessionTtlMs` (default 30 min when config
  absent — t7 wires the layered config) and expires each `findIdleExpired` row; collaboration
  suspensions are excluded at the SQL layer (t2), so they are untouched.
- **Concurrency note**: `activeAcpSessionId` is still set per prompt (kept for the unchanged
  spawner `__current__` resolver). The real per-prompt isolation fix is ADR-4 / t4; this task
  does not touch the spawner.

## Design Compliance

| Check | Result |
|-------|--------|
| Files touched ⊆ Change Tracking | Pass — manager, interface, bootstrap are listed; repo edit is a one-line extension of t2's file; the two test files back the changed units |
| Module/layer placement | Pass — all within `modules/acp` + its bootstrap wiring |
| Public interfaces match `Key Interfaces` | Pass — `IAcpSessionManager` matches ADR-2/3/5 (`suspend(reason)`, `resume`, `close(reason)`, `expire`, `reconcileOnStartup`, `sweepIdle`) |
| Forbidden cross-layer imports | Pass — manager imports SDK types, foundation `ILogger`, local interfaces/types/policy only |
| Error handling only at boundaries | Pass — try/catch only around the agent `closeSession` call and per-item sweep; pure transitions throw via the state machine |
| No new external deps | Pass — none |

## Deviations from Design

- **Deprecated `resumeSession`/`closeSession` shims retained on the manager + interface.**
  Rationale: t5 owns the executor rewrite (replace unconditional close with `decideLifecycle`
  dispatch). Keeping the shims lets the executor and its tests compile/pass after t3 in isolation;
  they delegate to `resume()` / `close('completed')` and will be removed in t5.
- **`reconcileOnStartup` bypasses `assertTransition`.** The live state machine forbids
  `active→expired`; crash recovery legitimately needs it. Done via the repo directly and
  documented inline, rather than widening the transition table (which would wrongly permit the
  edge for live sessions too).
- **Rebuild's context re-derivation is injected, not implemented here** (`SessionRebuilder`).
  Pulling role+org config + PromptBuilder into the manager is t7/t8 scope; t3 wires the seam and
  fails loudly if exercised without it.
- **`acpSessionId` added to t2's `PATCHABLE_COLUMNS`.** Necessary for rebuild to re-point the
  record; a minimal extension of the t2 file, not a new file.

## Self-Check Results

- **Type-check**: `tsc --noEmit` clean across the whole project (all breaking-change fallout from
  the new `IAcpSessionManager` resolved).
- **Unit tests (system Node)**: manager + executor + lifecycle → **41 passed**. Full ACP dir →
  **144 passed / 13 skipped** (skips are the SQLite ABI-guarded repo cases).
- Suggested broader command before merge: `pnpm --filter electron test:unit`.

## Open TODOs

- t4: spawner `__current__` removal + per-prompt context isolation (ADR-4); `sessionCapabilities.list`.
- t5: rewrite `AcpExecutor.executePrompt` to call `decideLifecycle` and dispatch to
  `suspend`/`close`, removing the deprecated shims' last callers.
- t7: register `reconcileOnStartup`/`sweepIdle` in bootstrap; layered `sessionTtlMs` config.
- t8: implement the real `SessionRebuilder` (role+org re-derivation) and PromptBuilder forceFullContext.

## Change Tracking

- Modified: `acp/client/acp-session.manager.ts`, `acp/interfaces/i-acp-session.manager.ts`,
  `acp/persistence/sqlite-acp-session.repository.ts`, `bootstrap/acp.module.ts`,
  `tests/unit/acp/acp-session.manager.test.ts`, `tests/unit/acp/acp-executor.test.ts`
- Plan task `t3-session-manager`: ready to mark **done** via `/mvt-update-plan`.

---

# Implementation: ACP Session Lifecycle — t2 (acp_sessions Table + Repository)

## Implementation Summary

Added the persisted lifecycle store from ADR-1: migration v5 creating the lean `acp_sessions`
table, the `IAcpSessionRepository` interface (+ `CreateAcpSessionInput`), and
`SqliteAcpSessionRepository`. The repository is the single source of truth for Capibara's
*view* of session lifecycle (status/binding/activity); the agent process still owns session
*history* content via `session/load`, so no derivable fields (cwd/mcpServers/allowedPaths/
capabilities) are stored.

## Files Touched

| Path | Action | Intent |
|------|--------|--------|
| `apps/electron/src/core/infrastructure/persistence/sqlite/migrations.ts` | modify | Migration v5: `acp_sessions` table + 4 indexes (acpSessionId, conversation binding, role/org/status, idle-sweep); CHECK constraints for status/reason/strategy enums and `suspended ⇒ suspend_reason NOT NULL` |
| `apps/electron/src/core/modules/acp/interfaces/i-acp-session.repository.ts` | create | `IAcpSessionRepository` + `CreateAcpSessionInput` (`Omit<AcpSessionRecord,'id'\|'createdAt'>`) |
| `apps/electron/src/core/modules/acp/persistence/sqlite-acp-session.repository.ts` | create | `SqliteAcpSessionRepository` — CRUD + `findByAcpSessionId`/`findByConversationId`/`findResumable`/`findIdleExpired`/`findNonTerminal`/`updateStatus`/`touchActivity` |
| `apps/electron/tests/unit/acp/sqlite-acp-session.repository.test.ts` | create | 13 cases: migration presence, CRUD round-trip, all query methods, `updateStatus` patch/null-clear, `touchActivity` |

## Implementation Details

- **Migration v5** follows the established additive pattern (numbered `Migration` entry,
  `db.exec` of `CREATE TABLE` + `CREATE INDEX`). Enum columns use `CHECK` constraints mirroring
  the TS unions. A table-level `CHECK (status != 'suspended' OR suspend_reason IS NOT NULL)`
  enforces ADR-5's invariant that every suspension carries a reason.
- **`create()`** generates `id` via `randomUUID()` and lets SQLite default `created_at`
  (`datetime('now')`), then re-reads via `findById` — matching `SqlitePendingWakeRepository`.
- **`updateStatus(id, status, patch?)`** builds a dynamic `SET` clause from a fixed
  `PATCHABLE_COLUMNS` allowlist (no arbitrary column writes); a key present in `patch` with
  value `undefined` is written as `NULL`, enabling explicit field-clearing (e.g.
  `suspendReason: null` on resume).
- **`findIdleExpired`/`findResumable`** encode the lifecycle filters in SQL: idle-sweep is
  restricted to `status='suspended' AND suspend_reason='idle'` (collaboration is TTL-exempt);
  resumable is `status IN ('active','suspended')` newest-activity-first.
- `@injectable()` is applied for the upcoming bootstrap DI wiring (t7), consistent with other
  repositories; no DI container changes are made in this task.

## Design Compliance

| Check | Result |
|-------|--------|
| Files touched ⊆ Change Tracking | Pass — migration, interface, repo, and its test all map to design `File Structure` (`persistence/sqlite-acp-session.repository.ts`, `persistence/migrations/*`, `interfaces/i-acp-session.repository.ts`) |
| Module/layer placement | Pass — repo+interface inside `modules/acp`, migration in `infrastructure/persistence/sqlite` |
| Public interfaces match `Key Interfaces` | Pass — method set matches ADR-1's `IAcpSessionRepository` (see deviation on `create` input shape) |
| Forbidden cross-layer imports | Pass — repo imports only `ISqliteConnection` (foundation), local interface, and local types |
| Error handling only at boundaries | Pass — SQLite enforces constraints; no interior try/catch added |
| No new external deps | Pass — none |

## Deviations from Design

- **`create(input: Omit<AcpSessionRecord,'id'\|'createdAt'>)`** instead of the design's literal
  `create(rec: Omit<AcpSessionRecord,'createdAt'>)`. Rationale: every other SQLite repository in
  the project generates the surrogate `id` internally via `randomUUID()` and defaults
  `created_at` in SQL. Following that convention keeps id-generation in one place and avoids
  callers minting ids. The exported `CreateAcpSessionInput` alias documents the shape.

## Self-Check Results

- **Type-check**: `tsc --noEmit` clean.
- **Unit tests (system Node)**: repo test's 13 SQLite cases are `skipped` (documented
  better-sqlite3 ABI mismatch — Electron ABI vs system Node), the skip-guard case passes.
- **Unit tests (electron ABI runner)**: ran via `ELECTRON_RUN_AS_NODE=1 electron
  node_modules/vitest/vitest.mjs run --pool=forks tests/unit/acp/sqlite-acp-session.repository.test.ts`
  → **13 passed / 1 skipped**, exercising real migration v5 + CRUD + all query methods.
- Suggested broader command before merge: `pnpm --filter electron test:electron`.

## Open TODOs

- t3: `AcpSessionManager` state machine consumes this repo as its write-through backing store.
- t7: register `SqliteAcpSessionRepository` in bootstrap DI; wire `findNonTerminal` (startup
  reconcile) and `findIdleExpired` (sweeper).

## Change Tracking

- Modified: `infrastructure/persistence/sqlite/migrations.ts` (v5)
- Created: `acp/interfaces/i-acp-session.repository.ts`,
  `acp/persistence/sqlite-acp-session.repository.ts`,
  `tests/unit/acp/sqlite-acp-session.repository.test.ts`
- Plan task `t2-session-repository`: ready to mark **done** via `/mvt-update-plan`.

---

# Implementation: ACP Session Lifecycle — t1 (Types + Pure Lifecycle Policy)

## Implementation Plan

Scope restricted to plan task **t1-types-and-policy** (the dependency-free foundation
step). Two work items:

1. Extend `acp.types.ts` with the lifecycle vocabulary: new status set, suspend reasons,
   lifecycle intent, close reasons, the lean persisted `AcpSessionRecord`, and TTL config
   fields.
2. Add `session-lifecycle.ts` — a pure, IO-free `decideLifecycle()` plus an explicit state
   machine — and its unit tests.

No runtime wiring (repository, manager, executor, bootstrap) is touched; those belong to
downstream tasks t2–t9.

## Changes

### Files Touched

| Path | Action | Intent |
|------|--------|--------|
| `apps/electron/src/core/modules/acp/types/acp.types.ts` | modify | `AcpSessionStatus` now `active\|suspended\|closed\|expired` (dropped `error`); added `SuspendReason`, `LifecycleIntent`, `CloseReason`, `AcpSessionRecord`; added optional `sessionTtlMs` / `collaborationCapMs` to `CollaborationConfig` |
| `apps/electron/src/core/modules/acp/client/session-lifecycle.ts` | create | Pure `decideLifecycle()` (4-row decision table) + `canTransition`/`assertTransition` state machine |
| `apps/electron/tests/unit/acp/session-lifecycle.test.ts` | create | 9 unit tests: full decision table (incl. inquiry-wins, all abnormal stop reasons) + legal/illegal transitions |

## Implementation Details

- **`decideLifecycle(ctx)`** implements the design's decision table, first-match-wins:
  pending inquiry → `suspend(collaboration)`; non-`end_turn` → `close(error)`;
  `end_turn`+`keep_alive` → `suspend(idle)`; `end_turn`+`close_on_complete` →
  `close(completed)`. `stopReason` is typed against the SDK's
  `StopReason = "end_turn" | "max_tokens" | "max_turn_requests" | "refusal" | "cancelled"`.
- **State machine** (`ALLOWED_TRANSITIONS`) encodes ADR-2/5: `active→{suspended,closed}`,
  `suspended→{active,expired,closed}`, `expired→{active}`, `closed→{}` (terminal).
- **`AcpSessionRecord`** is intentionally lean (ADR-1/6): no `cwd`/`mcpServers`/
  `allowedPaths`/`capabilities` — those are re-derived on rebuild, not persisted.
- No error handling added: this module is pure internal logic with no boundaries.

## Design Compliance

| Check | Result |
|-------|--------|
| Files touched ⊆ Change Tracking | Pass — all three map to design `File Structure` (acp.types.ts, session-lifecycle.ts, + its test) |
| Module/layer placement | Pass — types in `acp/types`, policy in `acp/client`, per Module Design table |
| Public interfaces match `Key Interfaces` | Pass — `LifecycleContext`, `LifecycleOutcome`, `decideLifecycle` match ADR-2 signatures; `AcpSessionRecord` matches the documented lean shape |
| Forbidden cross-layer imports | Pass — only imports SDK types + local `../types`; no infrastructure import |
| Error handling only at boundaries | Pass — none added (pure logic) |
| No new external deps | Pass — none added |

## Deviations from Design

- **`CollaborationConfig.sessionTtlMs` and `collaborationCapMs` are optional (`?`)** rather
  than required. Rationale: making them required would cascade into the layered config
  surface (`config.types.ts`, `config.schema.ts`, `config.defaults.ts`, locale files, and
  the settings UI), which is t7's (sweeper) wiring. Keeping them optional lets t1 compile
  standalone; t7 will add Zod schema + defaults and may tighten them to required then.

## Self-Check Results

- **Type-check**: `tsc --noEmit` clean (no fallout from removing the `error` status —
  confirmed no runtime consumers existed before the change).
- **Unit tests**: `vitest run tests/unit/acp/session-lifecycle.test.ts` → **9 passed / 9**.
- Suggested broader command before merge: `pnpm --filter electron test:unit`.

## Open TODOs

- t2: `acp_sessions` migration + `IAcpSessionRepository` + SQLite repo (consumes
  `AcpSessionRecord`).
- t3: `AcpSessionManager` state machine will consume `canTransition`/`assertTransition` and
  the new statuses; existing `AcpSession.status` usages migrate to the record there.
- t7: promote `sessionTtlMs`/`collaborationCapMs` into layered config with defaults
  (idle 30 min, collaboration cap 2 h) and decide whether to make them required.

## Change Tracking

- Modified: `acp/types/acp.types.ts`
- Created: `acp/client/session-lifecycle.ts`, `tests/unit/acp/session-lifecycle.test.ts`
- Plan task `t1-types-and-policy`: ready to mark **done** via `/mvt-update-plan`.
