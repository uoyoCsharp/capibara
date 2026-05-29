---
id: 'fix-notes'
version: '1.0'
skill: 'mvt-fix'
change-id: '20260528-acp-session-lifecycle'
---

# Fix Notes: ACP Session Lifecycle — Accumulated Review Findings

## Symptom

Three `/mvt-review` passes (t5/t6, t7/t8, t9) accumulated 6 warnings. This pass addresses the four
that are tractable as targeted fixes; two are deferred with concrete plans (one cross-architecture,
one wide-impact perf).

## Input Source

Review artifacts: `review.md` (t9 pass, current) plus the t5/t6 and t7/t8 warnings carried in
`plan.yaml` task result notes and prior `review.md` revisions.

## Reproduction

Not-applicable — these are review findings (static), not runtime defects. Each fix is guarded by a
new or updated unit test instead.

## Root Cause & Fixes Applied

### W-A (t5/t6-W2) — Cancelled run persisted with `closeReason: 'error'`
- **Root cause**: `decideLifecycle` mapped every non-`end_turn` stop reason (including the clean
  `cancelled`) to `close('error')`, conflating user cancellation with genuine faults in the
  persisted diagnostic record.
- **Fix**: Added `'cancelled'` to the `CloseReason` union (`acp.types.ts`) and the `acp_sessions`
  `close_reason` CHECK constraint (`migrations.ts`, edited in place — greenfield, table introduced
  this same unshipped change). `decideLifecycle` now returns `close('cancelled')` for a `cancelled`
  stop before the generic `error` branch.

### W-B (t5/t6-W1) — Collaboration suspend orphaned the session when no suspension manager wired
- **Root cause**: the executor's collaboration branch was gated on `&& this.suspensionManager`;
  when null, control fell through to the generic idle-suspend branch, marking the session
  `suspended('collaboration')` (TTL-exempt) with no awaiting record to ever resume it, while
  reporting the run `succeeded`.
- **Fix** (`acp-executor.ts`): the collaboration branch now triggers on outcome alone; if
  `suspensionManager` is absent it logs an error and `close()`s the session instead of orphaning it,
  returning `succeeded` honestly. The happy path (manager present) is unchanged.

### W-C (t9-W1) — N+1 message query behind planning-history title derivation
- **Root cause**: `derivePlanningTitle` called `msgRepo.findByConversationId(id)` (full thread read)
  per planning conversation, then `.find(human)` in JS — N full-table reads per history-list load.
- **Fix**: Added `findFirstHuman(conversationId)` to the message repository
  (interface + SQLite impl: `SELECT ... WHERE author_type='human' ORDER BY created_at LIMIT 1`).
  `derivePlanningTitle` now issues that single bounded query. Still one query per row, but each is
  O(1) indexed lookup instead of fetching the whole thread; a future batch/denormalization is noted.

### W-D (t9-W2) — History could re-enter a terminal-state conversation with a live composer
- **Root cause**: `findPlanningHistory` returns conversations in any state; selecting one dropped
  into `chatting` and `PlanningChat`'s composer was gated only on `isAIBusy`, so a user could send
  into a `cancelled`/`resolved`/`completed`/`timed_out` conversation.
- **Fix**: `PlanningPage` computes `isTerminal` from `conversation.state`
  (`TERMINAL_CONVERSATION_STATES`) and passes `readOnly` to `PlanningChat`; in read-only mode the
  composer is replaced by a notice (`planningChat.readOnlyNotice`, both locales) and `handleSend`
  early-returns. The cancel-session button is hidden for terminal conversations.

## Patch Summary

| File | Change |
|------|--------|
| `acp/types/acp.types.ts` | `CloseReason` gains `'cancelled'` |
| `infrastructure/persistence/sqlite/migrations.ts` | acp_sessions `close_reason` CHECK gains `'cancelled'` |
| `acp/client/session-lifecycle.ts` | `decideLifecycle` maps `cancelled` → `close('cancelled')` |
| `acp/client/acp-executor.ts` | collaboration suspend without manager → close, not orphan |
| `conversation/interfaces/i-conversation-message.repository.ts` | add `findFirstHuman` |
| `conversation/persistence/sqlite-conversation-message.repository.ts` | implement `findFirstHuman` |
| `conversation/services/conversation.service.ts` | `derivePlanningTitle` uses `findFirstHuman` |
| `renderer/components/planning/PlanningPage.tsx` | terminal-state detection + `readOnly` + hide cancel |
| `renderer/components/planning/PlanningChat.tsx` | `readOnly` prop: notice instead of composer, guard send |
| `shared/locale/{types,en-US,zh-CN}.ts` | `planningChat.readOnlyNotice` |
| tests: session-lifecycle, acp-executor, conversation-service, sqlite-repositories | new/updated cases |

## Regression Risk

- **`CloseReason` widening**: additive enum + CHECK; no existing value changed. Existing rows
  unaffected.
- **decideLifecycle**: only the `cancelled` outcome changed (error → cancelled); run status mapping
  in the executor is independent and unchanged, so user-visible run status is identical. Covered by a
  new dedicated test + the updated abnormal-stop test.
- **Executor null-manager branch**: only reachable when `suspensionManager` is unset (never in
  production wiring, `acp.module.ts:71`). New test covers it.
- **`findFirstHuman`**: new method, no existing caller changed; `derivePlanningTitle` output is
  identical for all tested cases. New repo-level tests.
- **PlanningChat `readOnly`**: defaults to `false`, so all existing call sites (active conversations)
  behave exactly as before. Verified by full renderer suite.

## Tests

Affected suites: 256 passed / 2 skipped, run via the electron ABI runner.
One pre-existing failure remains: `sqlite-repositories.test.ts > stores and retrieves metadata`
(inquiry-metadata schema defaults — `{escalationPath, routingAttempts}` vs `{key}`). Confirmed
identical on baseline with this change stashed; it touches none of these files and is out of scope.

## Follow-ups

- **DEFERRED — t8-W1 (`forceFullContext` on rebuild)**: the capability exists end-to-end
  (PromptBuilder → RunContext → ConversationContextBuilder) but no caller sets it. Correctly wiring
  it needs `RunCoordinator.executeForConversation` to know the bound session's resume strategy
  (rebuild vs resume/load) before building the prompt — a signal only `AcpSessionManager` holds.
  That requires a new read seam (e.g. `IAcpSessionManager.getResumePlan(conversationId)` or exposing
  the bound record) injected into `RunCoordinator`. This is a cross-module structural change beyond a
  targeted fix; recommend `/mvt-design` for the seam, then a follow-up `/mvt-implement`. Until then,
  rebuilt planning sessions reconstruct from the recent-window context (functional, just not full
  history).
- **DEFERRED — t9-W1 batch optimization**: `findFirstHuman` removed the whole-thread read but still
  issues one query per planning conversation. If history lists grow large, fold title derivation
  into a single join/subselect in the conversation repository, or denormalize a title column at
  conversation creation.
- Pre-existing `stores and retrieves metadata` test failure — unrelated; worth a separate fix for
  the inquiry-metadata fixture/schema.
- Carried-over suggestions (S1–S4 across reviews: messageCache LRU, sweeper failure escalation,
  grapheme-safe truncation, PlanningHistory DOM test) remain optional polish.
