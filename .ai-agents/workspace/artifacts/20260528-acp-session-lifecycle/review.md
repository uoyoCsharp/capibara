---
id: 'review-output'
version: '1.0'
skill: 'mvt-review'
change-id: '20260528-acp-session-lifecycle'
task: 't9-renderer-history-and-rehydration'
---

# Code Review: ACP Session Lifecycle — t9 (Planning History List + Page Rehydration)

## Review Scope

- **Depth**: full review, all axes (Groups A–E). No `--aspect` filter.
- **Files reviewed** (from `implementation.md` → Files Touched, t9 section):
  - `conversation/types/conversation.types.ts` (PlanningHistoryEntry)
  - `conversation/services/conversation.service.ts` (findPlanningHistory + derivePlanningTitle)
  - `ipc-handlers/conversation.handlers.ts` (capibara:planning:history)
  - `core/shared/types.ts`, `core/shared/api.ts`, `core/preload/index.ts` (contract chain)
  - `renderer/store/conversation.store.ts` (planningHistory, messageCache, load/get/set)
  - `renderer/components/planning/PlanningHistory.tsx` (new)
  - `renderer/components/planning/PlanningPage.tsx` (history phase + routing)
  - `renderer/components/planning/PlanningChat.tsx` (cache rehydration)
  - `shared/locale/types.ts`, `en-US.ts`, `zh-CN.ts`
  - tests: conversation-service, planning-handlers, conversation.store, mock-capibara-api
- **Inputs available**: `design.md` (REQ-P2/P4, BR-13, D-2) + `implementation.md` present → Group A
  ran in full. Not a code-only review; verdict not capped.
- **Fallbacks applied**: none.

## Summary

| Severity | Count |
|----------|-------|
| Critical | 0 |
| Warning | 2 |
| Suggestion | 4 |

**Verdict: Approve with comments.**

t9 is a clean vertical slice. The IPC→preload→contract→store→UI chain follows the established
conventions exactly, the history list is correctly sourced from the conversation table (D-2, not
`session/list`), and the rehydration cache delivers the no-flicker re-entry that BR-13/REQ-P4 ask
for. The lean `PlanningHistoryEntry` projection is the right shape. No critical issues. Two warnings:
an N+1 message query behind title derivation, and the history list letting the user re-enter a
terminal-state planning conversation as if it were live. Both are bounded and non-blocking. The t8
`forceFullContext`-on-rebuild wiring (prior review W1) remains correctly deferred and is now
documented as the natural companion to this task's resume path.

## Critical Findings

None.

## Warnings

### W1 — `findPlanningHistory` issues one message-table query per planning conversation (N+1)

- **File**: `conversation.service.ts` — `findPlanningHistory` → `derivePlanningTitle`
- **Observation**: `findPlanningHistory` maps over every planning conversation and calls
  `derivePlanningTitle(c.id)`, which runs `msgRepo.findByConversationId(conversationId)` — a full
  message-table read per conversation, then `.find(human)` in JS. For an org with N planning
  conversations this is N queries on every history-list load (and the list reloads on mount, on
  "back to history", and after cancel). It also fetches *all* messages per conversation only to read
  the first human one.
- **Reachability**: Active on every `getPlanningHistory` call; cost grows linearly with planning
  history size. Fine at MVP volumes, a latency cliff as history accumulates.
- **Recommendation**: Push title derivation into the repository as a single query — e.g. a join/
  subselect that returns each planning conversation with its first human message content in one
  statement, or store a denormalized title on the conversation at creation. At minimum, fetch only
  the first human message (`LIMIT 1` ordered by createdAt with an author-type filter) instead of the
  whole thread. Non-blocking; suggest `/mvt-fix` or a follow-up.

### W2 — History can re-enter a terminal-state planning conversation as if it were live

- **Files**: `PlanningPage.tsx` (`handleSelectHistory`), `PlanningHistory.tsx`, `PlanningChat.tsx`
- **Observation**: `findPlanningHistory` returns planning conversations in *any* state
  (`resolved`, `cancelled`, `completed`, …) and the list renders all of them. Selecting any entry
  calls `getConversation` and drops straight into `phase = 'chatting'`. `PlanningChat`'s composer is
  gated only on `isAIBusy`/`isSending` — not on conversation state — so a user can open a
  `cancelled` or `resolved` planning conversation and send a new message into it. Depending on the
  orchestrator, that either silently does nothing or revives a conversation the user explicitly
  discarded. The design's REQ-P2 frames history as resumable past conversations, but the terminal
  states arguably should be read-only (or excluded / visually distinguished).
- **Recommendation**: Decide the intended semantics: either (a) make terminal-state conversations
  read-only in `PlanningChat` (disable the composer when `conversation.state` is terminal), (b)
  exclude terminal states from the resumable list, or (c) allow re-opening but show state clearly and
  confirm before reviving. The list already surfaces `state` as text, which helps, but the composer
  gating is the functional gap. Suggest `/mvt-fix` once the product intent is confirmed.

## Suggestions

### S1 — `messageCache` grows unbounded for the session

- **File**: `conversation.store.ts` (`messageCache`)
- Every opened conversation's full message list stays cached for the app session with no eviction.
  Memory is modest (text), but a long session browsing many conversations accumulates it all.
  Consider an LRU cap (e.g. last ~10 conversations) if this ever shows up in profiling. Low priority.

### S2 — `handleSelectHistory` error ternary is convoluted

- **File**: `PlanningPage.tsx:89`
- `toast.error(res.ok ? t.planning.history.notFound : (res.error?.message ?? t.planning.history.notFound))`
  handles "ok-but-null" and "not-ok" in one nested ternary. A small `if (res.ok && res.data) {...}
  else {...}` with a single `notFound` fallback (the not-ok message is rarely useful to a user here)
  would read more cleanly. Taste-level.

### S3 — Title truncation counts UTF-16 code units, not grapheme clusters

- **File**: `conversation.service.ts` — `derivePlanningTitle` (`slice(0, 80)`)
- `firstLine.slice(0, 80)` can split a surrogate pair or combining sequence mid-character for emoji/
  CJK-with-marks content (the `…` still appends, so it won't crash, just a cosmetically odd cut).
  Given titles are display-only and 80 is generous, this is minor; flagging for awareness since the
  config's interaction language is zh-CN. Optional.

### S4 — No DOM/component test for `PlanningHistory` or the PlanningPage `history` phase

- **Files**: `PlanningHistory.tsx`, `PlanningPage.tsx`
- The store and service paths are well covered, but the new list component (empty state, entry
  click → onSelect, new-session button) and PlanningPage's mount routing (active → chatting vs none
  → history) have no DOM test. The project has jsdom DOM tests (e.g. inbox-plan-review.dom.test).
  A small render test would lock the REQ-P2 entry behavior. Suggest `/mvt-test`.

## Design / Layer Compliance (Group A)

- **REQ-P2 (history list)**: Satisfied — past planning conversations listed with title + timestamp,
  newest first.
- **REQ-P4 / BR-13 (rehydration, no flicker)**: Satisfied — `PlanningChat` seeds `messages`
  synchronously from `messageCache` on mount and conversation switch, before the async reload, so
  re-entry paints history with no empty-then-fill reset.
- **D-2 (conversation table is the source; session/list only validates loadability)**: Honored —
  `findPlanningHistory` reads only the conversation/message tables; no `session/list` call.
- **Resume path**: Selecting an entry routes through the existing `getConversation` → chatting →
  session-manager dispatch (load → rebuild). The "falls back to rebuild" acceptance is met by the
  t3/t5 machinery; t9 adds no parallel resume logic — correct.
- **Layer direction**: renderer talks only through `window.capibara`; the new channel follows the
  `capibara:planning:history` convention and the `ok()/err()` wrapper. No forbidden imports.
- **Documented deviations**: the backing read model in the conversation module and the
  default-landing-view change are both recorded in `implementation.md` and are reasonable.

## Code Quality / Error Handling / Edge Cases (Groups B–D)

- **B**: `PlanningHistory` is small and focused; `derivePlanningTitle` is a clean single-purpose
  helper. `PlanningPage` grew a phase but stays a readable state machine. No dead code; no premature
  abstraction. Naming consistent with siblings.
- **C**: Error handling only at the IPC boundary (`try/catch → err('INTERNAL', …)`), matching sibling
  handlers. Renderer surfaces failures via `toast`. No swallowed errors.
- **D**: Empty history → explicit empty state (good). Empty/whitespace title → empty-string fallback
  (tested). Reset effect deps (`conversationId`, stable `loadMessages`/`getCachedMessages`) mean it
  re-runs only on conversation switch — no stomp of streamed state. The terminal-state re-entry is
  the one unhandled edge (W2). Sorting uses string `localeCompare` on ISO timestamps — correct for
  ISO-8601.

## Tests (Group E)

- New cases: `findPlanningHistory` (filter to planning, newest-first, title-from-first-human,
  80-char truncation, empty-title fallback); `capibara:planning:history` (ok passthrough, INTERNAL on
  throw); store `loadPlanningHistory` + `messageCache` get/set; mock API extended with
  `getPlanningHistory` (keeps the `CapibaraApi`-implements contract honest). Behavior-asserting,
  well-named.
- Result: 60 passed (service+ipc+store) / 145 passed (full renderer+ipc).
- Gaps: no DOM test for the list component or PlanningPage routing (S4); no test asserting terminal-
  state handling (W2).

## Skipped Checks

- **Group F (Security)**: not triggered — no auth/data-sensitivity surface, no `--aspect security`.
  (Titles are user-authored text rendered via React text nodes / MarkdownContent, which escape by
  default — no injection surface introduced.)

## Recommended Next Skill

- **`/mvt-fix`** — address W1 (single-query title derivation) and W2 (terminal-state composer gating /
  list semantics); both small once intent is confirmed. Good moment to also wire the carried-over t8
  W1 (`forceFullContext` on the rebuild resume path) since it lives in the same resume flow this task
  exercises.
- **`/mvt-update-plan`** — no blocking issues; mark t9 done (completes the plan 9/9).
- **`/mvt-test`** — add the PlanningHistory/PlanningPage DOM test (S4).
