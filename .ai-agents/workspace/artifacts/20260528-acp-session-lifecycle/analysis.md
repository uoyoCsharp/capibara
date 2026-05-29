# Requirements Analysis: ACP Session Lifecycle Fix

## Feature Overview

Establish a correct, mode-aware ACP session lifecycle so that conversational state and tool state are preserved when they should be, and released when they should be. Today `AcpExecutor.executePrompt()` calls `closeSession()` on **every** exit path, which sends a protocol-level `closeSession` to the agent and permanently destroys the agent-side session. This makes every resume attempt fail and silently fall back to a fresh session, losing tool state and producing latency and WARN-log noise on every round.

The fix is organized in four layers:

1. **Foundation** — fix the ACP base code: distinguish *suspend* (keep agent-side session alive) from *close* (terminate it), wire up `session/list` capability, and provide a working `rebuild` strategy. Both modes depend on this.
2. **Planning mode** — Claude Code / Copilot-style UX: re-entering an existing conversation continues it (session + page state preserved); a history list lets users pick a past conversation to resume; no prior conversation means a fresh one.
3. **Task execution mode** — one session per task; close the session when the task completes.
4. **AI↔AI collaboration** — the exception to "close on completion": when a task pauses mid-execution to inquire another role, the session must be suspended (kept alive), not closed.

## Key Architectural Facts (grounding for scope)

- **Agents run as subprocesses** of the Electron main process (`AgentProcess.child: ChildProcess`, spawned in `AcpAgentSpawner.getOrSpawn`). When the app exits, every agent subprocess is killed with it; in-memory `AcpSession` state is also lost (`AcpSessionManager.sessions` is a plain `Map`).
- **The agent is the source of truth for session history.** The ACP `session/list` + `session/load` methods let a freshly re-spawned agent surface sessions it persisted to its own storage. Therefore Capibara does **not** need to persist full `AcpSession` metadata to reconstruct sessions — it only needs to persist the **binding** between a business conversation/task and its `acpSessionId`. That binding already exists for planning (`conversation.externalSessionId`) and for collaboration (`session_suspensions.acp_session_id`).
- Within a single app run, a suspended session's agent-side state is still alive, so resume is a direct `resumeSession()` (or `loadSession()`); `session/load` is only needed after a restart or for history entries not currently in memory.

## Actors

| Actor | Description |
|-------|-------------|
| User (Planning Mode) | Holds multi-round conversations with a role; expects the conversation and the page state to persist across re-entry, and a history list to revisit past conversations. |
| User (Task Mode) | Assigns tasks; expects each task to run as one session that is cleaned up on completion. |
| Role A (Task Initiator) | Executes a task; may pause mid-task to inquire another role, then resume with the reply. |
| Role B / C (Collaborators) | Answer inquiries in their own sessions; their sessions follow the same suspend/close rules. |
| RunCoordinator | Orchestrates runs; knows the **mode** (planning vs task) and passes a lifecycle **intent** to the executor. |
| AcpExecutor | Executes the prompt; combines the intent with observed `stopReason` and pending-inquiry detection to decide suspend vs close. |
| AcpSessionManager | Owns the session state machine (`active`/`suspended`/`closed`/`expired`); performs resume/load/rebuild/close. |
| ACP Agent Process | Subprocess holding live session state; persists session history to its own storage; advertises `resume`/`load`/`list` capabilities. |

## Requirements

### Layer 1 — Foundation (shared base code)

#### REQ-F1: Distinguish Suspend from Close
The executor must stop calling `closeSession()` unconditionally. Two distinct operations:
- **Suspend** — mark the session `suspended` locally; do **not** send protocol `closeSession`; the agent-side session stays alive for direct resume.
- **Close** — send protocol `closeSession`; mark `closed`; release the agent-side session.

- **Current behavior**: `executePrompt()` calls `closeSession()` at the suspend path (was line ~211) and on normal completion (was line ~242). The comment "Close the ACP session (preserving state for resume)" contradicts the action.
- **Expected behavior**: the decision is driven by intent + context (see REQ-F2), not hard-coded to always close.

#### REQ-F2: Mode-Aware Lifecycle Decision (unified decision path)
The suspend-vs-close decision is made by a **single, unified mechanism**: `RunCoordinator` supplies a lifecycle **intent** derived from the mode (planning → default keep-alive; task → default terminate-on-completion); `AcpExecutor` combines that intent with the observed `stopReason` and whether pending inquiries exist, and produces the final decision. The executor never silently overrides the intent without an observable reason (pending inquiry, error, cancellation).

#### REQ-F3: Make Resume / Load / Rebuild Actually Work
- `resume` and `load` strategies must succeed once sessions are no longer prematurely closed.
- `rebuild` must be a working implementation (currently `warn('Rebuild strategy not yet implemented')`): create a fresh agent-side session and reconstruct context via `PromptBuilder` from persisted messages/inquiry replies. Used when resume/load are impossible (e.g., agent no longer knows the session after a restart).

#### REQ-F4: Detect and Use `session/list` Capability
`AcpAgentSpawner.initialize()` must detect `sessionCapabilities.list` and expose it on `AgentCapabilities` (alongside the existing `supportsResume`/`supportsLoad`). `session/list` is used as a **validation/discovery** tool, not as the source of business history (see REQ-P2).

#### REQ-F5: Session State Machine
A session is exactly one of: `active`, `suspended`, `closed`, `expired`. Transitions: `active —suspend→ suspended`, `suspended —resume/load→ active`, `active —close→ closed`, `suspended —TTL expiry→ expired` (agent-side closed). The `AcpSessionStatus` type must include `suspended` and `expired` (currently `'active' | 'suspended' | 'closed' | 'error'`; `expired` is missing, `error` semantics to be confirmed).

### Layer 2 — Planning Mode

#### REQ-P1: Continue an Open Conversation on Re-entry
While the app is running, re-entering a previously opened conversation must continue it (not start a new one). The session stays `suspended` in memory; re-entry triggers a direct `resume` + prompt. If no prior conversation exists for the entry point, start a fresh session (current behavior via empty `externalSessionId`).

#### REQ-P2: Conversation History List
Provide a history list so users can pick a past conversation to resume. The list is sourced from **Capibara's conversation table** (business semantics: role, org, title, timestamps). `session/list` is used only to **validate** whether a given `acpSessionId` is still loadable on the agent side; entries not loadable fall back to `rebuild`.

#### REQ-P3: Resume Across App Restart
After an app restart, selecting a history conversation must still continue it: re-spawn the agent, attempt `session/load` for the bound `acpSessionId`; on success continue with full history, on failure `rebuild` from persisted messages.

#### REQ-P4: Preserve Page/UI State (in scope)
Re-entering a planning conversation must restore the page state, not just the backend session. This requires the renderer to retain or rehydrate the conversation view (messages, tool-call panels, working context) when a conversation is reopened. The backend contract: reopening a conversation returns enough state (persisted messages + session status) for the UI to rehydrate without a visible reset/flicker.

### Layer 3 — Task Execution Mode

#### REQ-T1: One Session per Task, Close on Completion
A task maps to a single session. On genuine task completion (`end_turn` with no pending inquiry), the session is **closed** (protocol close + `closed` status). This is the default terminate-on-completion intent for task mode.

#### REQ-T2: Suspend (not Close) When Pausing for Collaboration
If a task pauses mid-execution to inquire another role, the task is **not** complete — the session must be **suspended** and kept alive, not closed. This is the explicit exception to REQ-T1 and the bridge into Layer 4.

### Layer 4 — AI↔AI Collaboration

#### REQ-C1: Suspend the Initiator, Keep Agent-Side Alive
When `detectPendingInquiries()` finds unresolved inquiries after a prompt, the initiator's session is suspended (no protocol close), a `SessionSuspension` + `SuspensionAwaiting` records are created, and the suspension is tagged as a **collaboration** suspension (distinct from an idle/planning suspension).

#### REQ-C2: Collaborator Lifecycle Mirrors the Same Rules
The responding role's session follows the same suspend/close logic: if its inquiry conversation may continue (`state` active/waiting) it is suspended for direct resume; if the inquiry is resolved/closed it is closed.

#### REQ-C3: Resume the Initiator with Aggregated Replies
On `onInquiryResolved`, replies are aggregated per `aggregationMode` (`all` waits for every awaiting to reach resolved/timed_out; `any` triggers on the first). `RunCoordinator.executeResume()` resumes the initiator (in-run: direct `resumeSession`; cross-restart: `session/load` else `rebuild`) and injects the aggregated reply so the task continues with tool state intact (in-run case).

#### REQ-C4: Chain Collaboration Guards (A→B→C)
Chains are tracked via `parentSuspensionId` / `chainDepth` (already present). Two guards:
- **Depth limit**: reject new inquiries beyond `CollaborationConfig.maxChainDepth`.
- **Cycle detection** (NEW — not currently implemented): walk up `parentSuspensionId`; if the same role/inquiry subject already appears in the chain, treat as a cycle and reject (or force `rebuild`) to prevent A→B→A deadlock.

#### REQ-C5: Inquiry Timeout & Graceful Aggregation
If a collaborator does not reply within `inquiryTimeoutMs`, mark that awaiting `timed_out` and let aggregation proceed with a "no answer" placeholder so the initiator can still resume — never deadlock permanently.

#### REQ-C6: Collaboration Suspension is TTL-Exempt
Collaboration suspensions must **not** expire on the idle TTL used for planning. Their liveness is bound to the state of their `awaiting` records: kept alive while any awaiting is `pending`/`in_progress`; they enter the normal lifecycle only once all awaitings are `resolved`/`timed_out`/`cancelled`. A generous absolute upper bound guards against leaks.

### Cross-cutting

#### REQ-X1: Suspended-Session TTL & Cleanup (idle suspensions only)
Idle/planning suspensions have a configurable TTL (new `sessionTtlMs` on `CollaborationConfig`, default to be set in design). On expiry: close on the agent side, mark `expired` locally. Prevents leaked agent subprocesses now that sessions are no longer closed every round. **Does not apply** to collaboration suspensions (REQ-C6).

#### REQ-X2: Graceful Fallback on Resume Failure
When a session is known to be unavailable (`closed`/`expired`), skip the resume attempt and go straight to `rebuild`/fresh. When a resume attempt fails unexpectedly, fall back at **INFO** level (not WARN) with minimal latency.

#### REQ-X3: Accurate Suspension/Binding State
- `conversation.externalSessionId` remains the planning binding.
- `session_suspensions` records reflect current resumability via their status; on agent-side close/expiry the related state is updated so `onInquiryResolved` does not attempt to resume a dead session.

## Resolved Design Decisions (formerly ambiguities)

| ID | Decision |
|----|----------|
| D-1 (decision authority) | **Unified**: `RunCoordinator` passes a mode-derived lifecycle intent; `AcpExecutor` finalizes using intent + `stopReason` + pending-inquiry detection. (REQ-F2) |
| D-2 (history source) | **Capibara conversation table is primary**; `session/list` only validates whether an `acpSessionId` is still loadable. (REQ-P2) |
| D-3 (UI state) | **In scope**: page/UI state preservation on conversation re-entry is part of this change. (REQ-P4) |
| D-4 (collaboration TTL) | **TTL-exempt**: collaboration suspensions are not idle-timed; liveness is bound to awaiting state with a generous absolute cap. (REQ-C6) |
| D-5 (persistence scope) | **Binding-only**: persist the conversation/task → `acpSessionId` binding (already present); rely on agent `session/list`+`load` for history. No full `AcpSession` serialization to SQLite. |
| D-6 (restart reconnection) | Agent subprocess dies with the app; on restart re-spawn agent and use `session/load` (success) or `rebuild` (failure). No attempt to reconnect to a still-running old process. |

## Domain Concepts

| Concept | Definition |
|---------|------------|
| ACP Session | Bidirectional connection between the app and an agent subprocess, identified by `acpSessionId`; supports prompt, resume, load, list, close. |
| Session Lifecycle State | `active` / `suspended` / `closed` / `expired` (see REQ-F5). |
| Lifecycle Intent | Mode-derived hint from RunCoordinator: planning → keep-alive default, task → terminate-on-completion default. |
| Resume Strategy | `resume` (agent supports resume), `load` (agent supports session/load), `rebuild` (fresh session + PromptBuilder context reconstruction). |
| Idle Suspension | A planning session paused waiting for the **user**; subject to idle TTL. |
| Collaboration Suspension | A session paused waiting for **another AI**'s reply; TTL-exempt, bound to awaiting state. |
| session/list | ACP discovery method returning `{sessionId, cwd, title, updatedAt, _meta}`; gated by `sessionCapabilities.list`. Used here for validation/history augmentation, not as primary history. |

## Business Rules

| ID | Rule |
|----|------|
| BR-1 | `closeSession()` (protocol close) is called only on genuine termination: task completion, user closing a planning conversation, or TTL expiry of an idle suspension. |
| BR-2 | Planning: on normal completion the session is suspended (kept alive), not closed. |
| BR-3 | Task: on completion with no pending inquiry the session is closed. |
| BR-4 | Task with a pending inquiry: suspend (keep alive), never close. |
| BR-5 | Collaboration suspensions are TTL-exempt; liveness is bound to awaiting state. |
| BR-6 | Idle suspensions expire after a configurable TTL → agent-side close + `expired`. |
| BR-7 | When a session is known unavailable (`closed`/`expired`), skip resume and go to rebuild/fresh. |
| BR-8 | Resume failure in a plausibly-resumable scenario is logged at INFO, not WARN. |
| BR-9 | History list is sourced from the conversation table; `session/list` only validates loadability. |
| BR-10 | Chain collaboration must enforce a depth limit and detect cycles before suspending. |
| BR-11 | Inquiry timeout marks the awaiting `timed_out` and lets aggregation proceed; never deadlock. |
| BR-12 | Persistence is binding-only (conversation/task → acpSessionId); no full session serialization. |
| BR-13 | Reopening a planning conversation must let the UI rehydrate without a visible reset/flicker. |

## Change Tracking

| Path | Action | Why |
|------|--------|-----|
| `apps/electron/src/core/modules/acp/client/acp-executor.ts` | modify | Replace unconditional close with intent+context-driven suspend/close decision (REQ-F1/F2). |
| `apps/electron/src/core/modules/acp/client/acp-session.manager.ts` | modify | State machine, working `rebuild`, idle-TTL cleanup, expired status (REQ-F3/F5/X1). |
| `apps/electron/src/core/modules/acp/client/acp-agent.spawner.ts` | modify | Detect `sessionCapabilities.list` in `initialize()` (REQ-F4). |
| `apps/electron/src/core/modules/acp/types/acp.types.ts` | modify | Add `expired` status, `supportsList` capability, lifecycle intent, `sessionTtlMs` config (REQ-F5/F4/X1). |
| `apps/electron/src/core/modules/orchestrator/run.coordinator.ts` | modify | Pass mode-derived lifecycle intent; restart-aware resume (load/rebuild) (REQ-F2/P3/C3). |
| `apps/electron/src/core/modules/acp/persistence/sqlite-suspension.repository.ts` | modify | Collaboration vs idle suspension distinction; accurate resumability state (REQ-C1/C6/X3). |
| `apps/electron/src/core/modules/acp/collaboration/*` (suspension manager + types) | modify | Cycle detection, depth guard, TTL-exempt collaboration liveness, timeout aggregation (REQ-C4/C5/C6). |
| Renderer (planning conversation view) — exact path TBD in design | modify | Page/UI state preservation & rehydration on re-entry (REQ-P4/BR-13). |
| `session/list` discovery wiring (manager + interfaces) | add | Expose list for history validation (REQ-P2/P3). |

## Open Items for Design Phase

- **OPEN-1**: Exact renderer module(s) and the rehydration contract for REQ-P4 (needs a quick frontend scan in `/mvt-design`).
- **OPEN-2**: Default values — idle `sessionTtlMs`, collaboration absolute cap, `maxChainDepth` confirmation.
- **OPEN-3**: Semantics of the existing `error` status vs the new `expired` — keep both or fold `error` into `closed`.
- **OPEN-4**: Whether `wakeReason`/conversation `type` is sufficient for RunCoordinator to derive the lifecycle intent, or an explicit mode flag is needed on the execute input.
