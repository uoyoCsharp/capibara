---
stepsCompleted: ['step-01-validate-prerequisites', 'step-02-design-epics', 'step-03-create-stories']
inputDocuments:
  - '_bmad-output/planning-artifacts/architecture-session-layer.md'
  - '_bmad-output/planning-artifacts/architecture.md'
  - '_bmad-output/planning-artifacts/prd-conversational-task-planning.md'
  - '_bmad-output/planning-artifacts/epics-conversational-task-planning.md'
feature: 'Session Layer + RunEngine Refactoring'
status: 'approved'
date: '2026-04-14'
supersedes:
  - 'epics-conversational-task-planning.md (Epic 1 completely replaced; Epic 2/3 partially revised)'
---

# Session Layer + RunEngine Refactoring - Epic Breakdown

## Overview

This document provides the complete epic and story breakdown for the **Session Layer + RunEngine Refactoring**, decomposing the approved architecture (`architecture-session-layer.md`) into implementable stories.

This refactoring **supersedes** the original `epics-conversational-task-planning.md` Epic 1 (Planning Run Infrastructure). Epic 2 (Chat Experience) and Epic 3 (Plan Output & Batch Creation) from the original document remain valid with modifications noted in Epic 4 of this document.

## Architecture Context

The refactoring introduces three layers:
- **Interaction Layer**: Session (human-AI) + ConversationWorkflow (AI-AI routing)
- **Execution Layer**: RunEngine (pure AI execution, no domain knowledge)
- **Work Management Layer**: TaskService + OrgOrchestrator (unchanged)

Key ADRs: ADR-SESSION-01 (Session entity), ADR-SESSION-02 (ExecutionEngine split), ADR-SESSION-03 (Late materialization), ADR-SESSION-04 (MCP tool filtering)

---

## Epic List

### Epic 1: Foundation - Data Model & RunEngine Extraction
Extract the pure execution engine from the monolithic `ExecutionEngine` and create the Session data layer.
**ADRs covered:** ADR-SESSION-01 (data model), ADR-SESSION-02 (RunEngine interface)

### Epic 2: Coordinators & Composition Root Rewiring
Create `TaskRunCoordinator` and `SessionRunCoordinator`, delete `ExecutionEngine`, and rewire the DI container.
**ADRs covered:** ADR-SESSION-02 (coordinators)

### Epic 3: Planning Migration & MCP Tool Filtering
Rewrite `PlanningService` to use Sessions, add MCP tool context filtering, and create session IPC handlers.
**ADRs covered:** ADR-SESSION-01 (service layer), ADR-SESSION-03 (late materialization), ADR-SESSION-04 (tool filtering)

### Epic 4: Frontend Migration & Integration
Migrate `PlanningChatPage.tsx` to session-based IPC, add session events, and validate end-to-end.
**ADRs covered:** All (integration)

---

## Epic 1: Foundation - Data Model & RunEngine Extraction

Extract the Session data model (tables, repositories, types) and the pure RunEngine from the monolithic ExecutionEngine. After this epic, the new foundation exists but is not yet wired into the application flow.

### Story 1.1: Session Domain Types and Interfaces

As a **developer**,
I want **Session and SessionMessage domain types and repository interfaces defined**,
So that **the Session data layer has a clear contract before implementation**.

**Scope:**
- Create `core/types/session.types.ts` with `Session`, `SessionMessage`, `SessionType`, `SessionStatus` types
- Create `core/interfaces/i-session.repository.ts` with `ISessionRepository` (CRUD + `findActiveByOrgAndType`, `updateCliSessionId`, `updateStatus`)
- Create `core/interfaces/i-session-message.repository.ts` with `ISessionMessageRepository` (CRUD + `findBySessionId`)
- Add DI tokens: `SESSION_REPO_TOKEN`, `SESSION_MESSAGE_REPO_TOKEN`

**Acceptance Criteria:**
- [ ] `SessionType` = `'planning' | 'adhoc'`
- [ ] `SessionStatus` = `'active' | 'completed' | 'cancelled'`
- [ ] `Session` has fields: `id`, `orgId`, `roleId`, `type`, `status`, `cliSessionId`, `metadata`, `createdAt`, `updatedAt`
- [ ] `SessionMessage` has fields: `id`, `sessionId`, `authorType` (`'human' | 'ai' | 'system'`), `content`, `createdAt`
- [ ] Repository interfaces follow existing `ITaskRepository` / `IRunRepository` patterns

**Files:**
- NEW: `apps/electron/src/main/core/types/session.types.ts`
- NEW: `apps/electron/src/main/core/interfaces/i-session.repository.ts`
- NEW: `apps/electron/src/main/core/interfaces/i-session-message.repository.ts`
- MODIFY: `apps/electron/src/main/core/tokens.ts`

---

### Story 1.2: SQLite Migrations for Session Tables

As a **developer**,
I want **the `sessions` and `session_messages` tables created via SQLite migrations**,
So that **Session data can be persisted across app restarts**.

**Scope:**
- Migration: Create `sessions` table with indexes (`idx_sessions_org_status`, `idx_sessions_org_type`)
- Migration: Create `session_messages` table with index (`idx_session_messages_session`)
- Migration: Alter `runs` table — make `task_node_id` nullable, add `session_id` column with FK to `sessions`

**Acceptance Criteria:**
- [ ] `sessions` table has columns: `id`, `org_id`, `role_id`, `type`, `status`, `cli_session_id`, `metadata`, `created_at`, `updated_at`
- [ ] `session_messages` table has columns: `id`, `session_id`, `author_type`, `content`, `created_at`
- [ ] `session_messages.session_id` has `ON DELETE CASCADE`
- [ ] `runs.task_node_id` is nullable (existing runs with values unaffected)
- [ ] `runs.session_id` added with FK to `sessions(id)`
- [ ] Migrations are idempotent and follow existing migration numbering

**Files:**
- NEW: `apps/electron/src/main/infrastructure/persistence/sqlite/migrations/xxx-create-sessions.ts`
- NEW: `apps/electron/src/main/infrastructure/persistence/sqlite/migrations/xxx-alter-runs-session.ts`

**Dependencies:** Story 1.1

---

### Story 1.3: SQLite Session Repositories

As a **developer**,
I want **SQLite implementations of `ISessionRepository` and `ISessionMessageRepository`**,
So that **Session entities can be persisted and queried**.

**Scope:**
- Implement `SqliteSessionRepository` following existing `SqliteTaskRepository` patterns
- Implement `SqliteSessionMessageRepository` following existing `SqliteDiscussionMessageRepository` patterns
- Register in composition root with respective DI tokens

**Acceptance Criteria:**
- [ ] `SqliteSessionRepository` implements all `ISessionRepository` methods
- [ ] `SqliteSessionMessageRepository` implements all `ISessionMessageRepository` methods
- [ ] `findActiveByOrgAndType(orgId, type)` returns the most recent active session or null
- [ ] `updateCliSessionId(id, cliSessionId)` updates only the `cli_session_id` field
- [ ] JSON serialization for `metadata` field (same pattern as existing repos)

**Files:**
- NEW: `apps/electron/src/main/infrastructure/persistence/sqlite/sqlite-session.repository.ts`
- NEW: `apps/electron/src/main/infrastructure/persistence/sqlite/sqlite-session-message.repository.ts`
- MODIFY: `apps/electron/src/main/composition-root.ts` (register repos)

**Dependencies:** Story 1.1, Story 1.2

---

### Story 1.4: RunEngine Interface Definition

As a **developer**,
I want **the `IRunEngine` interface defined with clear execution contracts**,
So that **both coordinators can depend on a stable execution API**.

**Scope:**
- Create `core/interfaces/i-run-engine.ts` with `IRunEngine`, `RunExecutionParams`, `RunResult`, `McpExecutionContext`
- Add DI token: `RUN_ENGINE_TOKEN`
- `McpExecutionContext` = `'session:planning' | 'session:adhoc' | 'task:execution'`

**Acceptance Criteria:**
- [ ] `IRunEngine.execute(params: RunExecutionParams): Promise<RunResult>`
- [ ] `IRunEngine.cancelRun(runId: string): Promise<void>`
- [ ] `IRunEngine.getRunSessionId(runId: string): string | null`
- [ ] `IRunEngine.onLog(callback)` and `IRunEngine.onAssistantText(callback)` for streaming
- [ ] `RunExecutionParams` includes: `roleId`, `orgId`, `prompt`, `contextId`, `contextLabel`, optional `sessionId`, optional `mcpContext`
- [ ] `RunResult` includes: `status`, `sessionId`, `summary`, `inputTokens`, `outputTokens`, `model`, `exitCode`, `errorMessage`

**Files:**
- NEW: `apps/electron/src/main/core/interfaces/i-run-engine.ts`
- MODIFY: `apps/electron/src/main/core/tokens.ts`

---

### Story 1.5: RunEngine Implementation — Extract from ExecutionEngine

As a **developer**,
I want **a `RunEngine` class extracted from `ExecutionEngine` containing only pure execution logic**,
So that **AI execution is decoupled from task lifecycle and orchestration concerns**.

**Scope:**
Extract the following responsibilities from `ExecutionEngine` (~565 lines) into `RunEngine`:
- Budget check (lines 154-161)
- Serial execution lock per org (lines 163-167)
- Run record create/finish (lines 170, 366-465)
- MCP config generation (lines 272-275) — now accepts `McpExecutionContext`
- JWT token generation (lines 548-564)
- Executor invocation (lines 337-355)
- Log streaming + file writing (lines 80-106, 318-332)
- Stream JSON parsing (lines 93-105)
- Cost entry recording (lines 414-421, 449-455)
- Cleanup (lines 492-528) — simplified, no task/planning context cleanup

**What stays OUT of RunEngine:**
- Task state transitions → TaskRunCoordinator (Epic 2)
- Post-run Phase 1 advancement → TaskRunCoordinator (Epic 2)
- Conversation workflow resume → TaskRunCoordinator (Epic 2)
- Planning context maps → SessionRunCoordinator (Epic 2)

**Acceptance Criteria:**
- [ ] `RunEngine` implements `IRunEngine`
- [ ] `RunEngine` has zero setter-injected dependencies
- [ ] `RunEngine` has no imports from `task.service`, `task.state-machine`, `workflow-engine`, `conversation-workflow`
- [ ] `RunEngine` creates Run records with nullable `taskNodeId` (for session runs) or populated `taskNodeId` (for task runs, passed via `RunExecutionParams`)
- [ ] Budget check, serial lock, MCP config, JWT, executor, log streaming, cost recording all function as before
- [ ] `RunEngine` does NOT call any post-run hooks (returns `RunResult` to caller)
- [ ] `McpExecutionContext` parameter is passed to `McpConfigGenerator.generate()`

**Files:**
- NEW: `apps/electron/src/main/application/execution/run.engine.ts`
- READ (reference): `apps/electron/src/main/application/execution/execution.engine.ts`

**Dependencies:** Story 1.4

---

## Epic 2: Coordinators & Composition Root Rewiring

Create the two coordinators that wrap RunEngine with domain-specific pre/post processing, delete the monolithic ExecutionEngine, and rewire the DI container.

### Story 2.1: TaskRunCoordinator — Extract Task Logic from ExecutionEngine

As a **developer**,
I want **a `TaskRunCoordinator` that orchestrates AI runs within a Task context**,
So that **task lifecycle, review routing, and conversation workflow logic is separated from execution**.

**Scope:**
Extract the following from `ExecutionEngine.executeRun()` (lines 211-465):
- Task state transition to `in_progress` (lines 216-229)
- Conversation workflow resume transition (lines 254-269)
- Session resume for `discussion_reply` trigger (lines 292-311)
- Prompt construction via `ExecutionContext` (existing)
- Call `RunEngine.execute()`
- Post-run Phase 1 advancement to review (lines 372-411)
- Active conversation skip logic (lines 386-409)
- Run succeeded/failed/cancelled event emission

**Acceptance Criteria:**
- [ ] `TaskRunCoordinator.executeForTask(roleId, taskNodeId, orgId, trigger)` replaces `ExecutionEngine.startRun()`
- [ ] All post-run task logic (Phase 1 advancement, review, conversation check) behaves identically to current
- [ ] Only 1 setter injection: `setWorkflowEngine` (retained from current circular dep)
- [ ] Task execution end-to-end flow produces identical results to current `ExecutionEngine`

**Files:**
- NEW: `apps/electron/src/main/application/execution/task-run.coordinator.ts`
- READ (reference): `apps/electron/src/main/application/execution/execution.engine.ts`

**Dependencies:** Story 1.5 (RunEngine)

---

### Story 2.2: SessionService — Session CRUD and Lifecycle

As a **developer**,
I want **a `SessionService` that manages Session entity lifecycle**,
So that **planning conversations can be created, queried, and completed independently of the Task system**.

**Scope:**
- `startSession(orgId, type, roleId, initialMessage)`: Create Session + first SessionMessage
- `getActiveSession(orgId, type)`: Find active session or null
- `getSessionMessages(sessionId)`: Return all messages ordered by createdAt
- `addMessage(sessionId, authorType, content)`: Append message
- `completeSession(sessionId)`: Transition to 'completed'
- `cancelSession(sessionId)`: Transition to 'cancelled'
- `switchRole(sessionId, newRoleId)`: Update role assignment

**Acceptance Criteria:**
- [ ] `startSession` creates Session with `status: 'active'` and stores initial human message
- [ ] `getActiveSession` returns null when no active session exists for the org+type
- [ ] `completeSession` and `cancelSession` are idempotent (no error if already terminal)
- [ ] Domain events emitted: `session:created`, `session:completed`, `session:cancelled`
- [ ] Zero setter injection

**Files:**
- NEW: `apps/electron/src/main/application/session/session.service.ts`
- ADD DI token: `SESSION_SERVICE_TOKEN`

**Dependencies:** Story 1.1, Story 1.3

---

### Story 2.3: SessionRunCoordinator — Session Execution Orchestration

As a **developer**,
I want **a `SessionRunCoordinator` that orchestrates AI runs within a Session context**,
So that **planning conversations are executed without touching the Task system**.

**Scope:**
- `executeInSession(sessionId, userMessage)`:
  1. Store human message via `SessionMessageRepository`
  2. Build prompt via `PromptBuilder.buildForSession()` (Story 2.4)
  3. Call `RunEngine.execute()` with `mcpContext: 'session:planning'`
  4. Store AI response as SessionMessage
  5. Update `cliSessionId` on Session for `--resume`
  6. Emit `session:run-completed` event
- Planning phase detection from message count (diverge → focus → structure)
- Build org roles context for planning prompt

**Acceptance Criteria:**
- [ ] `executeInSession` does NOT create any Task
- [ ] `executeInSession` does NOT trigger OrgOrchestrator, ConversationWorkflow, or RoutingPolicyEngine
- [ ] Session resume works: first round has no `--resume`, subsequent rounds use stored `cliSessionId`
- [ ] Planning phase progresses based on AI message count: 0-1 = diverge, 2-3 = focus, 4+ = structure
- [ ] Zero setter injection
- [ ] AI response text stored as SessionMessage with `authorType: 'ai'`

**Files:**
- NEW: `apps/electron/src/main/application/session/session-run.coordinator.ts`
- ADD DI token: `SESSION_RUN_COORDINATOR_TOKEN`

**Dependencies:** Story 1.5 (RunEngine), Story 2.2 (SessionService), Story 2.4 (PromptBuilder)

---

### Story 2.4: PromptBuilder — Add `buildForSession()` Method

As a **developer**,
I want **the PromptBuilder to support session-based prompt construction**,
So that **planning sessions get appropriate prompts without task-related content**.

**Scope:**
- Add `buildForSession(session: Session, planningCtx: PlanningPromptContext): string` to `IPromptBuilder`
- Session prompt includes: role persona, communication language, planning mode instructions, org roles list, available tools (planning-specific only), conversation history (first round), phase-specific BMAD content
- Session prompt does NOT include: task context, review instructions, discussion thread

**Acceptance Criteria:**
- [ ] `buildForSession` produces a prompt with role persona + planning instructions
- [ ] Phase-specific BMAD content injected based on `planningCtx.phase`
- [ ] Org roles list included for role assignment guidance
- [ ] No task-related prompt sections (no "Your assigned task is...", no review instructions)
- [ ] Prompt respects locale setting for communication language

**Files:**
- MODIFY: `apps/electron/src/main/application/skills/prompt-builder.ts`
- MODIFY: `apps/electron/src/main/core/interfaces/i-prompt-builder.ts` (if exists, add method)

**Dependencies:** Story 1.1 (Session types)

---

### Story 2.5: Delete ExecutionEngine & Rewire Composition Root

As a **developer**,
I want **the monolithic `ExecutionEngine` deleted and all references replaced with RunEngine + coordinators**,
So that **the three-layer separation is fully realized**.

**Scope:**
- Delete `execution.engine.ts`
- Update `composition-root.ts`:
  - Register `RunEngine` as `RUN_ENGINE_TOKEN`
  - Register `TaskRunCoordinator` as `TASK_RUN_COORDINATOR_TOKEN`
  - Register `SessionRunCoordinator` as `SESSION_RUN_COORDINATOR_TOKEN`
  - Register `SessionService` as `SESSION_SERVICE_TOKEN`
  - Remove `ExecutionEngine` registration
  - Update setter injection: only `TaskRunCoordinator.setWorkflowEngine` remains
- Update `OrgOrchestrator`: replace `ExecutionEngine` dependency with `TaskRunCoordinator`
- Update any other files that import `ExecutionEngine`

**Acceptance Criteria:**
- [ ] `execution.engine.ts` deleted
- [ ] No file imports `ExecutionEngine` or `EXECUTION_ENGINE_TOKEN`
- [ ] `OrgOrchestrator` calls `TaskRunCoordinator.executeForTask()` instead of `ExecutionEngine.startRun()`
- [ ] Setter injection count: 1 total (down from 10)
- [ ] Application boots successfully with new DI wiring
- [ ] Task execution (non-planning) works end-to-end through TaskRunCoordinator → RunEngine

**Files:**
- DELETE: `apps/electron/src/main/application/execution/execution.engine.ts`
- MODIFY: `apps/electron/src/main/composition-root.ts`
- MODIFY: `apps/electron/src/main/application/orchestrator/org.orchestrator.ts`
- MODIFY: Any other files importing ExecutionEngine

**Dependencies:** Story 2.1 (TaskRunCoordinator), Story 2.3 (SessionRunCoordinator)

---

## Epic 3: Planning Migration & MCP Tool Filtering

Rewrite PlanningService to use the new Session system, add MCP tool context filtering, create session IPC handlers, and update contracts.

### Story 3.1: MCP Tool Context Filtering

As a **developer**,
I want **MCP tools tagged with execution contexts and filtered at config generation time**,
So that **planning sessions only see planning tools and task executions see all tools**.

**Scope:**
- Add `contexts: McpExecutionContext[]` to `McpToolDefinition`
- Tag each tool with applicable contexts (see tool availability matrix in architecture doc)
- Add `getToolsForContext(context: McpExecutionContext)` to `McpToolRegistry`
- Update `McpConfigGenerator.generate()` to accept and use `McpExecutionContext`

**Tool Availability Matrix:**
| Tool | `session:planning` | `session:adhoc` | `task:execution` |
|------|:-:|:-:|:-:|
| `capibara_plan_tasks` | Y | - | - |
| `capibara_context` | Y | Y | Y |
| `capibara_conversation` | - | - | Y |
| `capibara_task_complete` | - | - | Y |
| `capibara_task_create_child` | - | - | Y |
| `capibara_task_review` | - | - | Y |
| `capibara_discussion_post` | - | - | Y |

**Acceptance Criteria:**
- [ ] Each MCP tool has a `contexts` array in its registration
- [ ] `getToolsForContext('session:planning')` returns only `capibara_plan_tasks` + `capibara_context`
- [ ] `getToolsForContext('task:execution')` returns all tools (existing behavior)
- [ ] MCP config JSON generated for planning context does NOT include task tools
- [ ] AI agent physically cannot call excluded tools (they're absent from config)

**Files:**
- MODIFY: `apps/electron/src/main/infrastructure/mcp/mcp-tool-registry.ts`
- MODIFY: `apps/electron/src/main/infrastructure/mcp/mcp-config-generator.ts`
- MODIFY: `apps/electron/src/main/infrastructure/mcp/capibara-mcp-bridge.ts` (tool registration)

**Dependencies:** Story 1.4 (McpExecutionContext type)

---

### Story 3.2: Rewrite PlanningService to Use Sessions

As a **developer**,
I want **`PlanningService` rewritten to use `SessionService` + `SessionRunCoordinator`**,
So that **planning conversations no longer create Tasks or trigger the workflow pipeline**.

**Scope:**
- `startPlanningRun()` → `SessionService.startSession()` + `SessionRunCoordinator.executeInSession()`
- `replyToPlanningSession()` → `SessionRunCoordinator.executeInSession()` (with existing session)
- `getActivePlanningSession()` → `SessionService.getActiveSession(orgId, 'planning')` + legacy fallback
- `discardPlanningSession()` → `SessionService.cancelSession()`
- `switchPlanningRole()` → `SessionService.switchRole()` + reset `cliSessionId`
- Remove all setter-injected dependencies (executionEngine, taskService, workflowEngine, conversationWorkflowRepo, orgRepo, discussionRepo)
- Replace with constructor injection of SessionService + SessionRunCoordinator

**Acceptance Criteria:**
- [ ] `startPlanningRun` does NOT call `TaskService.create()`
- [ ] `startPlanningRun` does NOT call `ExecutionEngine.startRun()`
- [ ] No ConversationWorkflow created during planning
- [ ] No RoutingPolicyEngine invoked during planning
- [ ] Setter injection on PlanningService: 0 (down from 6)
- [ ] Legacy detection: `getActivePlanningSession` still finds old `plan` type tasks for backward compat
- [ ] Plan confirmation (via `batchCreateTasks`) still creates real Tasks (unchanged)

**Files:**
- MODIFY: `apps/electron/src/main/application/planning/planning.service.ts`
- MODIFY: `apps/electron/src/main/composition-root.ts` (update PlanningService DI)

**Dependencies:** Story 2.2 (SessionService), Story 2.3 (SessionRunCoordinator), Story 2.5 (composition root)

---

### Story 3.3: Session IPC Handlers

As a **developer**,
I want **new IPC handlers for session operations**,
So that **the renderer can start, message, and manage sessions via typed IPC channels**.

**Scope:**
New IPC channels:
- `capibara:session:start` → `SessionService.startSession()` + `SessionRunCoordinator.executeInSession()`
- `capibara:session:send-message` → `SessionRunCoordinator.executeInSession()`
- `capibara:session:get-active` → `SessionService.getActiveSession()`
- `capibara:session:get-messages` → `SessionService.getSessionMessages()`
- `capibara:session:cancel` → `SessionService.cancelSession()`
- `capibara:session:switch-role` → `SessionService.switchRole()`

**Acceptance Criteria:**
- [ ] All 6 IPC channels registered and functional
- [ ] Zod validation on all inputs (`startSessionSchema`, `sendSessionMessageSchema`, etc.)
- [ ] Returns `DesktopResult<T>` consistent with existing IPC patterns
- [ ] Old planning IPC channels (`capibara:planning:start`, etc.) still functional during transition
- [ ] Preload API exposes `window.capibara.startSession()`, `sendSessionMessage()`, etc.

**Files:**
- NEW: `apps/electron/src/main/ipc-handlers/session.handlers.ts`
- MODIFY: `apps/electron/src/shared/contracts.ts` (new types, schemas, IPC channels)
- MODIFY: `apps/electron/src/main/ipc-handlers/index.ts` (register new handlers)
- MODIFY: `apps/electron/src/preload/index.ts` (expose to renderer)

**Dependencies:** Story 2.2 (SessionService), Story 2.3 (SessionRunCoordinator)

---

### Story 3.4: Session Domain Events & EventBroadcaster

As a **developer**,
I want **session domain events forwarded to the renderer via EventBroadcaster**,
So that **the frontend can reactively update when sessions change**.

**Scope:**
New domain events: `session:created`, `session:message-added`, `session:run-completed`, `session:completed`, `session:cancelled`

EventBroadcaster mappings:
- `session:message-added` → `{ type: 'session:message-added', sessionId, authorType }`
- `session:run-completed` → `{ type: 'session:run-completed', sessionId, status }`
- `session:completed` → `{ type: 'session:completed', sessionId, orgId }`

**Acceptance Criteria:**
- [ ] All 5 session domain event types added to `DomainEventType`
- [ ] EventBroadcaster forwards session events to renderer via `IPC_CHANNELS.rendererEvent`
- [ ] `DesktopEvent` union in `contracts.ts` includes session event types
- [ ] Session events do NOT trigger OrgOrchestrator (key boundary)

**Files:**
- MODIFY: `apps/electron/src/main/core/types/event.types.ts`
- MODIFY: `apps/electron/src/main/application/notifications/event-broadcaster.ts`
- MODIFY: `apps/electron/src/shared/contracts.ts` (DesktopEvent union)

**Dependencies:** Story 2.2 (SessionService emits events)

---

### Story 3.5: Contracts & Locale Updates

As a **developer**,
I want **shared contracts and locale strings updated for the session system**,
So that **the frontend has typed interfaces and translated strings for session UI**.

**Scope:**
- Add to `contracts.ts`: `SessionRecord`, `SessionMessageRecord`, `startSessionSchema`, `sendSessionMessageSchema`, new `IPC_CHANNELS` entries
- Add locale keys for session UI: `session.starting`, `session.thinking`, `session.cancelled`, `session.completed`, `session.switchRole`, `session.noActive`, etc.
- Both `en-US.ts` and `zh-CN.ts`

**Acceptance Criteria:**
- [ ] `SessionRecord` and `SessionMessageRecord` exported from contracts
- [ ] All new IPC channels added to `IPC_CHANNELS` constant
- [ ] Zod schemas exported for input validation
- [ ] Locale keys added to both `en-US` and `zh-CN` with type-safe keys in `types.ts`

**Files:**
- MODIFY: `apps/electron/src/shared/contracts.ts`
- MODIFY: `apps/electron/src/shared/locale/en-US.ts`
- MODIFY: `apps/electron/src/shared/locale/zh-CN.ts`
- MODIFY: `apps/electron/src/shared/locale/types.ts`

**Dependencies:** Story 1.1 (Session types)

---

## Epic 4: Frontend Migration & Integration

Migrate the Planning Chat UI to use session-based IPC, validate end-to-end flows, and clean up deprecated code.

### Story 4.1: Migrate PlanningChatPage to Session-Based IPC

As a **user**,
I want **the Planning Chat page to work with the new session system**,
So that **planning conversations no longer create tasks or route to supervisors**.

**Scope:**
Frontend changes in `PlanningChatPage.tsx`:
| Current | New |
|---------|-----|
| `window.capibara.startPlanningRun()` | `window.capibara.startSession()` |
| `window.capibara.getActivePlanningSession()` | `window.capibara.getActiveSession()` |
| `window.capibara.replyToConversation()` | `window.capibara.sendSessionMessage()` |
| `window.capibara.discardPlanningSession()` | `window.capibara.cancelSession()` |
| Listen `conversation:*` events | Listen `session:*` events |
| Read `workflowState` for AI thinking | Read `session:run-completed` event |
| Use `discussionGroupId` for messages | Use `sessionId` for messages |

**Acceptance Criteria:**
- [ ] Starting a planning conversation creates a Session (not a Task)
- [ ] AI responses appear in chat without supervisor routing
- [ ] Multi-round conversation works via session resume
- [ ] Role switching works via `session:switch-role`
- [ ] Cancel/discard works via `session:cancel`
- [ ] Loading states (typing indicator, elapsed timer) work with `session:run-completed` events
- [ ] Conversation history loads from `session:get-messages`
- [ ] Plan preview transition works when `capibara_plan_tasks` is called by AI

**Files:**
- MODIFY: `apps/electron/src/renderer/components/planning/PlanningChatPage.tsx`
- MODIFY: Any related planning UI components

**Dependencies:** Story 3.3 (Session IPC), Story 3.4 (Session events), Story 3.5 (Contracts)

---

### Story 4.2: End-to-End Validation — Planning Without Task Creation

As a **developer**,
I want **end-to-end validation that planning conversations work correctly with the new architecture**,
So that **the core problem (Task creation + supervisor routing) is confirmed resolved**.

**Scope:**
Manual + automated validation:
1. Start a planning conversation → verify NO `"Planning task created"` in logs
2. AI responds → verify NO `"Conversation workflow created"` in logs
3. AI responds → verify NO `"routed_to_supervisor"` in logs
4. Multi-round conversation → verify `--resume` works via session `cliSessionId`
5. AI calls `capibara_plan_tasks` → verify plan stored in `PendingPlanStore`
6. AI does NOT see `capibara_task_complete` or `capibara_task_review` tools
7. User confirms plan → verify real Tasks created via `batchCreateTasks`
8. Session marked `completed` after plan confirmation
9. App restart → active session detected and resumable

**Acceptance Criteria:**
- [ ] F1: Starting a planning conversation does NOT create a Task
- [ ] F2: Planning AI response is NOT routed to supervisor
- [ ] F3: Multi-round planning conversation works with session resume
- [ ] F4: AI only sees `capibara_plan_tasks` + `capibara_context` tools during planning
- [ ] F5: Confirming plan creates real Tasks
- [ ] F6: Session survives app restart
- [ ] F7: Budget tracking works for session runs

**Dependencies:** All previous stories

---

### Story 4.3: End-to-End Validation — Task Execution Unchanged

As a **developer**,
I want **validation that the task execution pipeline (non-planning) works identically after refactoring**,
So that **the RunEngine + TaskRunCoordinator replacement introduces no regressions**.

**Scope:**
Verify through existing task execution flow:
1. OrgOrchestrator consumes PendingWake → calls `TaskRunCoordinator.executeForTask()`
2. Task transitions to `in_progress`
3. AI executes with full MCP tool set (`task:execution` context)
4. Post-run: Phase 1 advancement to `awaiting_review` works
5. AI-to-AI conversation workflow works (ConversationWorkflow + RoutingPolicyEngine)
6. Run succeeded/failed/cancelled events emitted correctly
7. Budget and cost tracking works
8. Serial execution lock works

**Acceptance Criteria:**
- [ ] E1: Task execution produces identical behavior to pre-refactoring
- [ ] E2: Post-run advancement logic unchanged
- [ ] E3: ConversationWorkflow system completely untouched
- [ ] E4: OrgOrchestrator wake loop functions correctly
- [ ] E5: All MCP tools available during task execution

**Dependencies:** Story 2.5 (ExecutionEngine deleted, coordinators wired)

---

### Story 4.4: Legacy Cleanup and Deprecation

As a **developer**,
I want **deprecated planning IPC channels marked with deprecation warnings and legacy plan task detection handled**,
So that **the codebase is clean while maintaining backward compatibility**.

**Scope:**
- Add deprecation logging to old planning IPC handlers (`capibara:planning:start`, `capibara:planning:get-active`, `capibara:planning:discard`, `capibara:planning:switch-role`)
- `getActivePlanningSession` legacy fallback: check for old `plan` type tasks with active ConversationWorkflow
- Remove `PLANNING_TASK_TYPE` usage from new code paths (constants retained for legacy detection)
- Clean up any dead code from `ExecutionEngine` removal

**Acceptance Criteria:**
- [ ] Old planning IPC channels log deprecation warning but still function
- [ ] Legacy `plan` type tasks in database can be detected and completed/discarded
- [ ] No dead imports or unused code from ExecutionEngine split
- [ ] `PLANNING_TASK_TYPE` constant retained but not used in new flows

**Files:**
- MODIFY: `apps/electron/src/main/ipc-handlers/planning.handlers.ts`
- MODIFY: `apps/electron/src/main/application/planning/planning.service.ts` (legacy detection)
- CLEANUP: Remove dead code across affected files

**Dependencies:** Story 4.1 (Frontend migrated)

---

## Dependency Graph

```
Epic 1 (Foundation)
  Story 1.1: Session types + interfaces              ← standalone
  Story 1.2: SQLite migrations                        ← depends on 1.1
  Story 1.3: SQLite repositories                      ← depends on 1.1, 1.2
  Story 1.4: IRunEngine interface                     ← standalone
  Story 1.5: RunEngine implementation                 ← depends on 1.4

Epic 2 (Coordinators)                                 ← depends on Epic 1
  Story 2.1: TaskRunCoordinator                       ← depends on 1.5
  Story 2.2: SessionService                           ← depends on 1.1, 1.3
  Story 2.3: SessionRunCoordinator                    ← depends on 1.5, 2.2, 2.4
  Story 2.4: PromptBuilder.buildForSession()          ← depends on 1.1
  Story 2.5: Delete ExecutionEngine + rewire DI       ← depends on 2.1, 2.3

Epic 3 (Planning Migration)                           ← depends on Epic 2
  Story 3.1: MCP tool context filtering               ← depends on 1.4
  Story 3.2: Rewrite PlanningService                  ← depends on 2.2, 2.3, 2.5
  Story 3.3: Session IPC handlers                     ← depends on 2.2, 2.3
  Story 3.4: Session events + EventBroadcaster        ← depends on 2.2
  Story 3.5: Contracts + locale updates               ← depends on 1.1

Epic 4 (Frontend + Integration)                       ← depends on Epic 3
  Story 4.1: Migrate PlanningChatPage                 ← depends on 3.3, 3.4, 3.5
  Story 4.2: E2E validation — planning                ← depends on all
  Story 4.3: E2E validation — task execution          ← depends on 2.5
  Story 4.4: Legacy cleanup                           ← depends on 4.1
```

## Parallelization Opportunities

Within each epic, some stories can be developed in parallel:

**Epic 1:**
- Story 1.1 + Story 1.4 can run in parallel (independent type definitions)
- Story 1.2 + Story 1.3 sequential (migration before repo)
- Story 1.5 can start once 1.4 is done

**Epic 2:**
- Story 2.1 + Story 2.2 + Story 2.4 can run in parallel (all depend on Epic 1 but not each other)
- Story 2.3 waits for 2.2 and 2.4
- Story 2.5 waits for 2.1 and 2.3

**Epic 3:**
- Story 3.1 can run in parallel with Epic 2 (only depends on 1.4)
- Story 3.4 + Story 3.5 can run in parallel with 3.2 and 3.3
- Story 3.2 and 3.3 can run in parallel (both depend on 2.2, 2.3)

**Epic 4:**
- Story 4.1 is the critical path
- Story 4.2 + Story 4.3 can run in parallel after 4.1
- Story 4.4 runs last

## Risk Assessment

| Risk | Impact | Mitigation |
|------|--------|------------|
| RunEngine extraction misses a responsibility | Task execution regression | Story 4.3 validates identical behavior |
| Circular dependency resurfaces in new DI wiring | App fails to boot | Story 2.5 explicitly verifies boot |
| Legacy `plan` type tasks in DB cause confusion | User sees stale planning session | Story 4.4 handles legacy detection |
| MCP tool filtering breaks tool handler registration | Tools unavailable | Story 3.1 validates both contexts |
| `--resume` behavior changes with session-based flow | Conversation context lost | Story 2.3 explicitly tests resume across rounds |

## Acceptance Summary

| # | Acceptance Criterion | Story |
|---|---------------------|-------|
| F1 | Planning conversation does NOT create a Task | 4.2 |
| F2 | Planning AI response NOT routed to supervisor | 4.2 |
| F3 | Multi-round planning with session resume | 4.2 |
| F4 | Planning AI only sees planning MCP tools | 3.1, 4.2 |
| F5 | Plan confirmation creates real Tasks | 4.2 |
| F6 | Session survives app restart | 4.2 |
| F7 | Budget enforced for session runs | 4.2 |
| E1 | ExecutionEngine deleted | 2.5 |
| E2 | Setter injection reduced to 1 | 2.5 |
| E3 | RunEngine has zero domain knowledge | 1.5 |
| E4 | Conversation system unchanged | 4.3 |
| E5 | Task execution unchanged | 4.3 |
