---
version: '1.0'
project_name: 'capibara'
feature_name: 'Session Layer + RunEngine Refactoring'
user_name: 'uoyo'
date: '2026-04-14'
status: 'approved'
supersedes:
  - 'architecture-planning-system.md (ADR-PLAN-01, ADR-PLAN-02, ADR-PLAN-03 remain valid; lifecycle flow revised)'
inputDocuments:
  - '_bmad-output/planning-artifacts/prd-conversational-task-planning.md'
  - '_bmad-output/planning-artifacts/architecture.md'
  - '_bmad-output/planning-artifacts/architecture-planning-system.md'
  - '_bmad-output/planning-artifacts/architecture-conversation-system.md'
  - '_bmad-output/project-context.md'
---

# Session Layer + RunEngine Refactoring Architecture

> Decouple interactive human-AI conversations from the task execution pipeline by introducing **Session** as a first-class concept and splitting the monolithic **ExecutionEngine** into a pure **RunEngine** plus domain-specific coordinators.

---

## Table of Contents

1. [Problem Statement](#1-problem-statement)
2. [Design Principles](#2-design-principles)
3. [Architecture Overview](#3-architecture-overview)
4. [ADR Record](#4-adr-record)
5. [Session Model](#5-session-model)
6. [RunEngine (Execution Layer)](#6-runengine-execution-layer)
7. [SessionRunCoordinator](#7-sessionruncoordinator)
8. [TaskRunCoordinator](#8-taskruncoordinator)
9. [MCP Tool Filtering](#9-mcp-tool-filtering)
10. [Prompt Builder Changes](#10-prompt-builder-changes)
11. [Data Model](#11-data-model)
12. [IPC Contract Changes](#12-ipc-contract-changes)
13. [Event Model](#13-event-model)
14. [Composition Root Rewiring](#14-composition-root-rewiring)
15. [Migration from Current Architecture](#15-migration-from-current-architecture)
16. [Code Structure](#16-code-structure)
17. [Implementation Phasing](#17-implementation-phasing)
18. [Acceptance Checklist](#18-acceptance-checklist)

---

## 1. Problem Statement

### 1.1 Root Cause

The current architecture models every AI invocation as **"a role executing a task"**:

```
Task creation -> ExecutionEngine.startRun() -> AI executes
  -> Post-run hooks (status advancement, review routing, conversation workflow)
  -> OrgOrchestrator consumes next wake
```

Planning Mode is **"a human having an exploratory conversation with AI"** -- categorically different. But it is forced through the same pipeline, causing:

| Symptom | Root Cause |
|---------|-----------|
| Task created on every conversation start | `PlanningService` calls `TaskService.create()` then `ExecutionEngine.startRun()` |
| AI response routed to supervisor (CTO) for review | `ExecutionEngine` post-run Phase 1 advancement + `RoutingPolicyEngine` resolves parent |
| Conversation polluted by workflow state machine | `ConversationWorkflow` + `TaskStateMachine` operate simultaneously on the same entity |
| MCP tools expose task_complete/task_review during planning | No tool filtering by interaction mode |

### 1.2 Deeper Architectural Smell

The `ExecutionEngine` is a **monolithic god class** (~565 lines, 15+ responsibilities):

- Pre-execution gates (budget, serial execution, role status)
- Run record lifecycle (create, update status, finish)
- Prompt construction orchestration
- MCP config generation and JWT token management
- Session resume logic
- Log streaming to file and renderer
- Stream JSON parsing for assistant text extraction
- Post-run Task state advancement (Phase 1 -> review)
- Post-run conversation workflow checks (active conversation skips advancement)
- Cost entry recording
- Planning context management (run-level and task-level maps)
- Cleanup (log flush, MCP cleanup, token revocation, parser cleanup, context expiry)

This violates SRP and creates a web of setter-injected circular dependencies in `composition-root.ts`.

### 1.3 What This Refactoring Achieves

1. **Planning Mode works correctly** -- no Task, no supervisor routing, no review
2. **ExecutionEngine split** -- pure RunEngine + domain coordinators
3. **Circular dependency reduction** -- setter injection minimized
4. **Future-ready** -- "adhoc conversation" mode trivially addable via Session
5. **MCP tool isolation** -- planning sees only planning tools

---

## 2. Design Principles

| # | Principle | Implication |
|---|-----------|-------------|
| P1 | **Conversation != Task** | A multi-turn dialog has no deliverable, no status machine, no reviewer. It is its own entity. |
| P2 | **Execution is orthogonal to orchestration** | Running an AI prompt (RunEngine) is independent of what happens before/after (Task state, Session messages). |
| P3 | **Late materialization** | Planning conversations produce Task nodes only when the user explicitly confirms the plan. |
| P4 | **Minimum viable abstraction** | No new base classes, no generic "interaction mode" enum. Session and Task coordinators are concrete, separate classes. |
| P5 | **Extend, don't fork** | Reuse existing patterns (EventBus, DI tokens, Repository interfaces, SQLite persistence). |

---

## 3. Architecture Overview

### 3.1 Three-Layer Separation

```
+-----------------------------------------------------------+
|                   Interaction Layer                         |
|  +-------------------+     +----------------------------+  |
|  | Session            |     | ConversationWorkflow       |  |
|  | (Human <-> AI)     |     | (AI <-> AI/Human routing)  |  |
|  | No Task, no review |     | Routing, timeout, escalate |  |
|  +--------+-----------+     +-------------+--------------+  |
|           |                               |                  |
+-----------+-------------------------------+------------------+
            |  both call                    |
            v                               v
+-----------------------------------------------------------+
|                    Execution Layer                          |
|  +-----------------------------------------------------+  |
|  | RunEngine                                            |  |
|  | Pure: prompt -> executor -> result -> cost           |  |
|  | No Task awareness, no review, no orchestration       |  |
|  +-----------------------------------------------------+  |
+----------------------------+------------------------------+
                             |
         +-------------------+-------------------+
         |                                       |
         v                                       v
+--------------------+              +------------------------+
| SessionRunCoord.   |              | TaskRunCoordinator     |
| - Session messages |              | - Task state machine   |
| - Phase detection  |              | - Phase 1 advancement  |
| - Planning context |              | - Review routing       |
| - Session resume   |              | - Conversation check   |
+--------------------+              +------------------------+
                                             |
                                             v
+-----------------------------------------------------------+
|                 Work Management Layer                       |
|  TaskService | TaskStateMachine | OrgOrchestrator          |
|  (Unchanged -- only receives calls from TaskRunCoordinator)|
+-----------------------------------------------------------+
```

### 3.2 Interaction Patterns

| Pattern | Entry Point | Execution | Post-Processing |
|---------|-------------|-----------|-----------------|
| **Planning** | `SessionService.startSession()` | `SessionRunCoordinator` -> `RunEngine` | Append AI message to session, detect plan submission |
| **Adhoc Chat** (future) | `SessionService.startSession(type='adhoc')` | `SessionRunCoordinator` -> `RunEngine` | Append AI message, no plan |
| **Task Execution** | `OrgOrchestrator` wake | `TaskRunCoordinator` -> `RunEngine` | Task state advancement, review, wake consumption |

### 3.3 What Each Layer Knows

| Component | Knows About | Does NOT Know About |
|-----------|------------|-------------------|
| **RunEngine** | Executor, MCP config, budget, cost, log streaming | Task, Session, ConversationWorkflow, review, wake |
| **SessionRunCoordinator** | Session, SessionMessage, RunEngine, planning context | Task, OrgOrchestrator, TaskStateMachine, review |
| **TaskRunCoordinator** | Task, TaskStateMachine, WorkflowEngine, RunEngine, ConversationWorkflow | Session |
| **OrgOrchestrator** | TaskRunCoordinator (via wake triggers) | Session, RunEngine internals |

---

## 4. ADR Record

### ADR-SESSION-01: Session as First-Class Entity

**Status**: Proposed

**Context**: Planning conversations require a persistent context (message history, AI session ID for --resume, role assignment) but do not need Task lifecycle management. The previous architecture (ADR-PLAN-01) used a `plan` Task type as a workaround. This creates all the problems described in Section 1.

**Decision**: Introduce `Session` as an independent domain entity, persisted in its own SQLite table. A Session:
- Belongs to an Organization (budget enforcement)
- Has a Role assignment (determines persona + prompt)
- Stores message history (`session_messages` table)
- Tracks claude-cli session ID for `--resume`
- Has a simple lifecycle: `active` -> `completed` | `cancelled`
- Does NOT have a TaskNode, does NOT participate in WorkflowEngine

**Consequences**:
- New `sessions` + `session_messages` tables
- New `ISessionRepository` + `SessionService`
- `PlanningService` rewired to use SessionService instead of TaskService
- Planning tasks (`type='plan'`) no longer created
- Frontend `PlanningChatPage` talks to session-based IPC instead of conversation workflow IPC

**Alternatives rejected**:
- *Keep `plan` Task type with routing bypass*: Rejected. Band-aid that doesn't address the fundamental model mismatch. Every new bypass adds fragility.
- *Virtual session (in-memory only)*: Rejected. Must survive app restart (NFR-CTP-04 resilience requirement).

---

### ADR-SESSION-02: Split ExecutionEngine into RunEngine + Coordinators

**Status**: Proposed

**Context**: `ExecutionEngine` (565 lines) handles execution, task lifecycle, conversation workflow, planning context, log streaming, cost tracking, and cleanup. It has 6 setter-injected dependencies creating circular dependency chains in `composition-root.ts`.

**Decision**: Extract three components:

1. **RunEngine** -- Pure execution. Accepts a prompt and execution config, returns a result.
   - Owns: budget check, serial execution lock, Run record lifecycle, MCP config, executor invocation, cost recording, log streaming, stream parsing, cleanup
   - Does NOT own: Task state, Session messages, ConversationWorkflow, review logic, planning context

2. **TaskRunCoordinator** -- Orchestrates runs in the context of a Task.
   - Owns: Task state advancement, Phase 1 review routing, conversation workflow resume, session resume for `discussion_reply`, planning context (legacy, for MCP tool `capibara_plan_tasks`)
   - Calls RunEngine.execute()

3. **SessionRunCoordinator** -- Orchestrates runs in the context of a Session.
   - Owns: Session message management, planning phase detection, session resume via Session entity, planning prompt context
   - Calls RunEngine.execute()

**Consequences**:
- `ExecutionEngine` class deleted (replaced by 3 classes)
- Circular setter injection reduced: RunEngine has zero setter deps; coordinators have one-directional deps
- `OrgOrchestrator` calls `TaskRunCoordinator` (not RunEngine directly)
- `PlanningService` calls `SessionRunCoordinator` (not RunEngine directly)
- Test surface area improves: RunEngine testable with mock executor, coordinators testable with mock RunEngine

---

### ADR-SESSION-03: Late Materialization of Tasks

**Status**: Proposed

**Context**: Current flow creates a `plan` Task immediately when a planning conversation starts. The refactored flow should only create real Tasks when the user confirms the generated plan.

**Decision**: The planning conversation lifecycle is:
1. User sends message -> `SessionService.startSession()` creates a Session (no Task)
2. AI responds via `SessionRunCoordinator` -> `RunEngine` -> result stored as SessionMessage
3. Multi-round conversation continues (session resume via Session.cliSessionId)
4. AI submits plan via `capibara_plan_tasks` MCP tool -> stored in `PendingPlanStore` (existing, unchanged)
5. User confirms plan -> `batchCreateTasks()` creates real Tasks -> Session marked `completed`

**No Task exists until step 5.**

**Consequences**:
- `PlanningService.startPlanningRun()` rewritten to use SessionService
- `PLANNING_TASK_TYPE = 'plan'` and `SYSTEM_TASK_TYPES` constants retained for backward compatibility but no longer actively created
- Task Tree UI no longer needs to filter `type === 'plan'` (no such tasks created going forward)
- Existing `plan` tasks in database remain; `getActivePlanningSession()` handles legacy detection

---

### ADR-SESSION-04: MCP Tool Filtering by Execution Context

**Status**: Proposed

**Context**: During a planning session, the AI has access to all MCP tools including `capibara_task_complete`, `capibara_task_review`, and `capibara_task_create_child`. These are meaningless in a planning context and could cause errors if invoked.

**Decision**: `McpConfigGenerator` accepts an execution context parameter that determines which tools are registered:

| Context | Available Tools |
|---------|----------------|
| `session:planning` | `capibara_plan_tasks`, `capibara_context` |
| `session:adhoc` (future) | `capibara_context` |
| `task:execution` | All tools (existing behavior) |

Tool filtering happens at MCP config generation time -- excluded tools are simply not listed in the config file, so the AI agent never sees them.

**Consequences**:
- `McpConfigGenerator.generate()` gains an `executionContext` parameter
- `McpToolRegistry` gains a `getToolsForContext()` method
- Each tool in the registry tagged with applicable contexts
- No runtime validation needed -- tools physically absent from MCP config

---

## 5. Session Model

### 5.1 Session Entity

```typescript
// core/types/session.types.ts

type SessionType = 'planning' | 'adhoc';
type SessionStatus = 'active' | 'completed' | 'cancelled';

interface Session {
  id: string;                    // UUID
  orgId: string;                 // Organization scope (for budget)
  roleId: string;                // AI role persona
  type: SessionType;             // Determines prompt template + MCP tools
  status: SessionStatus;
  cliSessionId: string | null;   // claude-cli --resume session ID
  metadata: Record<string, unknown>;  // Planning context, phase, etc.
  createdAt: string;
  updatedAt: string;
}

interface SessionMessage {
  id: string;                    // UUID
  sessionId: string;
  authorType: 'human' | 'ai' | 'system';
  content: string;
  createdAt: string;
}
```

### 5.2 Session Lifecycle

```
User sends first message
  |
  v
SessionService.startSession()
  -> Create Session { status: 'active', type: 'planning' }
  -> Create SessionMessage { authorType: 'human', content: userMessage }
  -> SessionRunCoordinator.executeInSession(sessionId)
      -> Build prompt (role persona + planning context + message history)
      -> RunEngine.execute() -> AI result
      -> Create SessionMessage { authorType: 'ai', content: aiResponse }
      -> Store cliSessionId on Session (for --resume)
  |
  v
User sends reply
  -> Create SessionMessage { authorType: 'human' }
  -> SessionRunCoordinator.executeInSession(sessionId)
      -> Build prompt (with --resume, injecting new message)
      -> RunEngine.execute() -> AI result
      -> Create SessionMessage { authorType: 'ai' }
  |
  v  (repeat until AI submits plan or user cancels)
  |
  v
AI calls capibara_plan_tasks
  -> PendingPlanStore.set(orgId, plan)
  -> Emit 'planning:plan-ready'
  -> Session remains 'active' (user hasn't confirmed yet)
  |
  v
User confirms plan
  -> batchCreateTasks() (existing, unchanged)
  -> SessionService.completeSession(sessionId)
  -> Session status -> 'completed'
```

### 5.3 Session vs ConversationWorkflow

| Aspect | Session | ConversationWorkflow |
|--------|---------|---------------------|
| **Initiator** | Human | AI agent (via MCP tool) |
| **Participants** | Fixed: Human <-> one AI role | Dynamic: routed via RoutingPolicyEngine |
| **Lifecycle** | active -> completed/cancelled | waiting_for_reply -> reply_received -> resumed -> resolved/escalated/timed_out |
| **Routing** | None (role pre-selected by user) | Full routing pipeline (supervisor, skill-match, human gate) |
| **Task binding** | None | Bound to a TaskNode |
| **Timeout** | None (human controls pace) | Configurable (5 min normal, 1 min urgent) |
| **Escalation** | None | Up to 3 levels |
| **Message storage** | `session_messages` table | `discussion_messages` table |

These are intentionally separate systems. ConversationWorkflow remains unchanged for AI-to-AI communication during task execution.

---

## 6. RunEngine (Execution Layer)

### 6.1 Responsibility

Pure AI execution: accept a prompt + config, invoke executor, return result. No domain knowledge.

### 6.2 Interface

```typescript
// core/interfaces/i-run-engine.ts

interface RunExecutionParams {
  roleId: string;
  orgId: string;
  prompt: string;
  contextId: string;           // For log file path: sessionId or taskId
  contextLabel: string;        // For log file path: org name
  sessionId?: string;          // claude-cli --resume
  mcpContext?: McpExecutionContext;  // Determines which tools are available
}

interface RunResult {
  status: 'succeeded' | 'failed' | 'cancelled' | 'interrupted';
  sessionId: string | null;    // claude-cli session ID from output
  summary: string | null;
  inputTokens: number;
  outputTokens: number;
  model: string | null;
  exitCode: number | null;
  errorMessage: string | null;
}

type McpExecutionContext = 'session:planning' | 'session:adhoc' | 'task:execution';

interface IRunEngine {
  execute(params: RunExecutionParams): Promise<RunResult>;
  cancelRun(runId: string): Promise<void>;
  getRunSessionId(runId: string): string | null;

  /** Register callback for log streaming */
  onLog(callback: (runId: string, stream: 'stdout' | 'stderr', chunk: string) => void): void;
  /** Register callback for parsed assistant text */
  onAssistantText(callback: (runId: string, text: string) => void): void;
}
```

### 6.3 What Moves INTO RunEngine (from ExecutionEngine)

| Responsibility | Lines in current ExecutionEngine | Notes |
|---------------|------|-------|
| Budget check | 154-161 | Retained as-is |
| Serial execution lock | 163-167 | Per-org, retained |
| Run record create/finish | 170, 366-465 | Retained |
| MCP config generation | 272-275 | Now accepts `McpExecutionContext` |
| JWT token generation | 548-564 | Retained |
| Executor invocation | 337-355 | Retained |
| Log streaming + file writing | 80-106, 318-332 | Retained |
| Stream JSON parsing | 93-105 | Retained |
| Cost entry recording | 414-421, 449-455 | Retained |
| Cleanup | 492-528 | Simplified: no task/planning context cleanup |

### 6.4 What Moves OUT of RunEngine

| Responsibility | Moved To |
|---------------|----------|
| Task state transition (in_progress) | TaskRunCoordinator |
| Post-run Phase 1 advancement to review | TaskRunCoordinator |
| Active conversation check (skip advancement) | TaskRunCoordinator |
| Conversation workflow resume transition | TaskRunCoordinator |
| Planning context maps (runPlanningCtx, taskPlanningCtx) | SessionRunCoordinator |
| Planning phase detection | SessionRunCoordinator |
| Locale setting injection into planning context | SessionRunCoordinator |
| Session resume for discussion_reply | TaskRunCoordinator |
| Task-level planning context persistence | Removed (sessions manage own context) |

### 6.5 Callback Pattern for Post-Execution

RunEngine does NOT call coordinators. Instead, it returns `RunResult` and the coordinator handles post-processing:

```typescript
// SessionRunCoordinator
const result = await this.runEngine.execute(params);
if (result.status === 'succeeded') {
  await this.sessionRepo.updateCliSessionId(sessionId, result.sessionId);
  // Store AI response as SessionMessage (extracted from run output)
}

// TaskRunCoordinator
const result = await this.runEngine.execute(params);
if (result.status === 'succeeded') {
  await this.handleTaskPostRun(taskId, roleId, orgId, result);
  // Phase 1 advancement, review routing, etc.
}
```

---

## 7. SessionRunCoordinator

### 7.1 Responsibility

Orchestrates AI execution within a Session context. Manages session messages, prompt construction, planning phase detection, and session resume.

### 7.2 Interface

```typescript
// application/session/session-run.coordinator.ts

@injectable()
class SessionRunCoordinator {
  constructor(
    private readonly runEngine: IRunEngine,
    private readonly sessionRepo: ISessionRepository,
    private readonly sessionMessageRepo: ISessionMessageRepository,
    private readonly promptBuilder: IPromptBuilder,
    private readonly roleRepo: IRoleRepository,
    private readonly orgRepo: IOrganizationRepository,
    private readonly eventBus: IEventBus,
    private readonly logger: ILogger,
  ) {}

  /**
   * Execute an AI run within a session context.
   * Called when user sends a message (first or subsequent).
   */
  async executeInSession(sessionId: string, userMessage: string): Promise<void> {
    const session = await this.sessionRepo.findById(sessionId);
    // 1. Store user message
    await this.sessionMessageRepo.create({
      sessionId, authorType: 'human', content: userMessage,
    });
    // 2. Build prompt
    const messages = await this.sessionMessageRepo.findBySessionId(sessionId);
    const planningCtx = await this.buildPlanningContext(session, messages);
    const prompt = this.promptBuilder.buildForSession(session, planningCtx);
    // 3. Execute
    const org = await this.orgRepo.findById(session.orgId);
    const result = await this.runEngine.execute({
      roleId: session.roleId,
      orgId: session.orgId,
      prompt,
      contextId: session.id,
      contextLabel: org?.name ?? session.orgId,
      sessionId: session.cliSessionId ?? undefined,
      mcpContext: this.getMcpContext(session.type),
    });
    // 4. Store AI response + update session
    if (result.status === 'succeeded') {
      if (result.sessionId) {
        await this.sessionRepo.updateCliSessionId(sessionId, result.sessionId);
      }
      // AI response is extracted from run output (via stream parsing callback)
      // or from the summary field
    }
    // 5. Emit completion event
    this.eventBus.emit({
      type: 'session:run-completed',
      timestamp: new Date().toISOString(),
      payload: { sessionId, status: result.status },
    });
  }

  private getMcpContext(type: SessionType): McpExecutionContext {
    switch (type) {
      case 'planning': return 'session:planning';
      case 'adhoc': return 'session:adhoc';
    }
  }

  private async buildPlanningContext(
    session: Session, messages: SessionMessage[],
  ): Promise<PlanningPromptContext> {
    // Phase detection from message count (same heuristic as current)
    const aiMessageCount = messages.filter(m => m.authorType === 'ai').length;
    const phase: PlanningPhase =
      aiMessageCount >= 4 ? 'structure' :
      aiMessageCount >= 2 ? 'focus' : 'diverge';
    // Build org roles context (same as current PlanningService.buildPlanningContext)
    const orgRoles = await this.buildOrgRolesContext(session.orgId);
    return { orgRoles, phase };
  }
}
```

### 7.3 Session Resume Strategy

| Round | cliSessionId | Behavior |
|-------|-------------|----------|
| First message | null | Fresh run, no --resume |
| AI responds | Stored from RunResult | Session entity updated |
| Second message | Non-null | --resume with stored ID |
| Subsequent | Updated each round | Always --resume latest |

No ConversationWorkflow involved. No `discussion_reply` trigger. No RoutingPolicyEngine. Pure session resume.

---

## 8. TaskRunCoordinator

### 8.1 Responsibility

Orchestrates AI execution within a Task context. Handles all the post-run logic currently in `ExecutionEngine.executeRun()`.

### 8.2 Interface

```typescript
// application/execution/task-run.coordinator.ts

@injectable()
class TaskRunCoordinator {
  constructor(
    private readonly runEngine: IRunEngine,
    private readonly taskRepo: ITaskRepository,
    private readonly taskStateMachine: TaskStateMachine,
    private readonly taskService: TaskService,
    private readonly workflowEngine: IWorkflowEngine,
    private readonly roleRepo: IRoleRepository,
    private readonly conversationWorkflowRepo: IConversationWorkflowRepository,
    private readonly promptBuilder: IPromptBuilder,
    private readonly executionContext: ExecutionContext,
    private readonly eventBus: IEventBus,
    private readonly logger: ILogger,
  ) {}

  /**
   * Execute an AI run for a task. Called by OrgOrchestrator.
   * This is the direct replacement for ExecutionEngine.startRun() + executeRun().
   */
  async executeForTask(
    roleId: string,
    taskNodeId: string,
    orgId: string,
    trigger: WakeTrigger,
  ): Promise<Run> {
    // 1. Transition task to in_progress (same as current)
    // 2. Build prompt via ExecutionContext
    // 3. Resolve session resume (conversation workflow or previous run)
    // 4. Call RunEngine.execute()
    // 5. Post-run: Phase 1 advancement, review routing, conversation check
    // 6. Emit run events
  }
}
```

### 8.3 What Stays the Same

All post-run logic from current `ExecutionEngine.executeRun()` lines 211-465 moves here **unchanged in behavior**:

- Task state transition to first active status (lines 216-229)
- Conversation workflow resume transition (lines 254-269)
- Session resume for `discussion_reply` trigger (lines 292-311)
- Post-run Phase 1 advancement to review (lines 372-411)
- Active conversation skip logic (lines 386-409)
- Run succeeded/failed/cancelled event emission

The only difference: these are now methods on `TaskRunCoordinator` calling `this.runEngine.execute()` instead of `this.executor.execute()`.

---

## 9. MCP Tool Filtering

### 9.1 Tool Context Tags

```typescript
// infrastructure/mcp/mcp-tool-registry.ts

interface McpToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  handler: McpToolHandler;
  contexts: McpExecutionContext[];  // NEW: which contexts this tool is available in
}

// Registration:
registry.register({
  name: 'capibara_plan_tasks',
  contexts: ['session:planning'],  // Only available in planning sessions
  // ...
});

registry.register({
  name: 'capibara_context',
  contexts: ['session:planning', 'session:adhoc', 'task:execution'],  // Always available
  // ...
});

registry.register({
  name: 'capibara_task_complete',
  contexts: ['task:execution'],  // Only available during task execution
  // ...
});
```

### 9.2 Tool Availability Matrix

| Tool | `session:planning` | `session:adhoc` | `task:execution` |
|------|:-:|:-:|:-:|
| `capibara_plan_tasks` | Y | - | - |
| `capibara_context` | Y | Y | Y |
| `capibara_conversation` | - | - | Y |
| `capibara_task_complete` | - | - | Y |
| `capibara_task_create_child` | - | - | Y |
| `capibara_task_review` | - | - | Y |
| `capibara_discussion_post` | - | - | Y |

### 9.3 Config Generation

```typescript
// McpConfigGenerator.generate()
generate(runId: string, bridgePath: string, token: string, context: McpExecutionContext): string {
  const tools = this.registry.getToolsForContext(context);
  // Generate MCP config JSON with only the filtered tools
  // ...
}
```

---

## 10. Prompt Builder Changes

### 10.1 New Method: buildForSession

```typescript
// application/skills/prompt-builder.ts

interface IPromptBuilder {
  // Existing: for task execution
  build(context: PromptContext): string;

  // NEW: for session-based execution
  buildForSession(session: Session, planningCtx: PlanningPromptContext): string;
}
```

### 10.2 Session Prompt Structure

```markdown
[System Prompt]
You are {role.name}. {role.persona}

## Communication Language
Respond in {locale}.

## Planning Mode
You are in a planning conversation with a user. Your goal is to help them
define their project and create a structured task plan.

{phase-specific BMAD methodology content -- same as current}

## Available Roles in Organization
{orgRoles list -- same as current}

## Available System Tools
- capibara_plan_tasks: Submit a structured task plan for user review
- capibara_context: Query organization structure and task information

## Conversation History
{session messages -- injected directly, NOT via --resume for first round}

## Instructions
{phase-specific instructions -- same as current}
```

### 10.3 Key Difference from Current

Currently, conversation history flows through `discussion_messages` and the `ConversationWorkflow` state machine. In the new architecture, session messages are:

1. **First round**: Injected directly into the prompt (user's initial message)
2. **Subsequent rounds**: Flow via `--resume` (claude-cli remembers the conversation) + new user message injected into prompt

This eliminates the need for `ConversationWorkflow` entirely for planning.

---

## 11. Data Model

### 11.1 New Table: `sessions`

```sql
CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL REFERENCES organizations(id),
  role_id TEXT NOT NULL REFERENCES roles(id),
  type TEXT NOT NULL CHECK(type IN ('planning', 'adhoc')),
  status TEXT NOT NULL CHECK(status IN ('active', 'completed', 'cancelled')) DEFAULT 'active',
  cli_session_id TEXT,
  metadata TEXT DEFAULT '{}',  -- JSON
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_sessions_org_status ON sessions(org_id, status);
CREATE INDEX idx_sessions_org_type ON sessions(org_id, type, status);
```

### 11.2 New Table: `session_messages`

```sql
CREATE TABLE session_messages (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  author_type TEXT NOT NULL CHECK(author_type IN ('human', 'ai', 'system')),
  content TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_session_messages_session ON session_messages(session_id, created_at);
```

### 11.3 Existing Tables: No Changes

The following tables are **not modified**:
- `task_nodes` -- no more `plan` type tasks created (existing ones remain)
- `runs` -- RunEngine still creates Run records (now without mandatory taskNodeId for session runs)
- `conversation_workflows` -- unchanged, still used for AI-AI conversations
- `discussion_groups` / `discussion_messages` -- unchanged
- `pending_wakes` -- unchanged

### 11.4 Run Table Extension

The `runs` table currently requires `task_node_id`. For session runs, we need to make this optional and add a session reference:

```sql
-- Make task_node_id nullable (session runs have no task)
-- Add session_id column
ALTER TABLE runs ADD COLUMN session_id TEXT REFERENCES sessions(id);
```

Run record now has either `task_node_id` (task execution) or `session_id` (session execution), never both.

### 11.5 Domain Types

```typescript
// core/types/session.types.ts

export type SessionType = 'planning' | 'adhoc';
export type SessionStatus = 'active' | 'completed' | 'cancelled';

export interface Session {
  id: string;
  orgId: string;
  roleId: string;
  type: SessionType;
  status: SessionStatus;
  cliSessionId: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface SessionMessage {
  id: string;
  sessionId: string;
  authorType: 'human' | 'ai' | 'system';
  content: string;
  createdAt: string;
}
```

---

## 12. IPC Contract Changes

### 12.1 New IPC Channels (Session-based)

| Channel | Direction | Input | Output |
|---------|-----------|-------|--------|
| `capibara:session:start` | Renderer -> Main | `{ orgId, type, roleId, initialMessage }` | `DesktopResult<{ sessionId, roleId }>` |
| `capibara:session:send-message` | Renderer -> Main | `{ sessionId, content }` | `DesktopResult<void>` |
| `capibara:session:get-active` | Renderer -> Main | `{ orgId, type }` | `DesktopResult<SessionRecord \| null>` |
| `capibara:session:get-messages` | Renderer -> Main | `{ sessionId }` | `DesktopResult<SessionMessageRecord[]>` |
| `capibara:session:cancel` | Renderer -> Main | `{ sessionId }` | `DesktopResult<void>` |
| `capibara:session:switch-role` | Renderer -> Main | `{ sessionId, newRoleId }` | `DesktopResult<void>` |

### 12.2 Deprecated IPC Channels

These channels become unused once frontend migrates but remain functional for backward compatibility during transition:

| Channel | Replaced By |
|---------|------------|
| `capibara:planning:start` | `capibara:session:start` |
| `capibara:planning:get-active` | `capibara:session:get-active` |
| `capibara:planning:discard` | `capibara:session:cancel` |
| `capibara:planning:switch-role` | `capibara:session:switch-role` |

### 12.3 Unchanged IPC Channels

| Channel | Reason |
|---------|--------|
| `capibara:planning:get-pending-plan` | PendingPlanStore unchanged |
| `capibara:planning:batch-create` | batchCreateTasks unchanged |
| `capibara:planning:get-roles` | Role selection logic unchanged |

### 12.4 New DesktopEvent Types

```typescript
// Add to DesktopEvent union in contracts.ts:
| { type: 'session:message-added'; sessionId: string; authorType: 'human' | 'ai' | 'system' }
| { type: 'session:run-completed'; sessionId: string; status: 'succeeded' | 'failed' | 'cancelled' }
| { type: 'session:completed'; sessionId: string; orgId: string }
```

### 12.5 New Renderer Types

```typescript
// Add to contracts.ts

export interface SessionRecord {
  id: string;
  orgId: string;
  roleId: string;
  roleName: string;        // Resolved for UI
  type: SessionType;
  status: SessionStatus;
  messageCount: number;    // For display
  createdAt: string;
  updatedAt: string;
}

export interface SessionMessageRecord {
  id: string;
  sessionId: string;
  authorType: 'human' | 'ai' | 'system';
  content: string;
  createdAt: string;
}

export const startSessionSchema = z.object({
  orgId: z.string().min(1),
  type: z.enum(['planning', 'adhoc']),
  roleId: z.string().min(1),
  initialMessage: z.string().min(1).max(10000),
});

export const sendSessionMessageSchema = z.object({
  sessionId: z.string().min(1),
  content: z.string().min(1).max(10000),
});
```

---

## 13. Event Model

### 13.1 New Domain Events

```typescript
// Add to DomainEventType
| 'session:created'
| 'session:message-added'
| 'session:run-completed'
| 'session:completed'
| 'session:cancelled'
```

### 13.2 EventBroadcaster Extensions

```typescript
// In EventBroadcaster.broadcast()
case 'session:message-added':
  desktopEvent = {
    type: 'session:message-added',
    sessionId: payload.sessionId,
    authorType: payload.authorType,
  };
  break;

case 'session:run-completed':
  desktopEvent = {
    type: 'session:run-completed',
    sessionId: payload.sessionId,
    status: payload.status,
  };
  break;
```

### 13.3 OrgOrchestrator: No Changes

Session events do NOT trigger the OrgOrchestrator. The orchestrator only cares about Task-related events. This is a key design boundary -- sessions operate independently of the wake loop.

---

## 14. Composition Root Rewiring

### 14.1 New DI Tokens

```typescript
// core/tokens.ts
export const RUN_ENGINE_TOKEN = Symbol('RUN_ENGINE');
export const SESSION_REPO_TOKEN = Symbol('SESSION_REPO');
export const SESSION_MESSAGE_REPO_TOKEN = Symbol('SESSION_MESSAGE_REPO');
export const SESSION_RUN_COORDINATOR_TOKEN = Symbol('SESSION_RUN_COORDINATOR');
export const TASK_RUN_COORDINATOR_TOKEN = Symbol('TASK_RUN_COORDINATOR');
```

### 14.2 Dependency Graph (After Refactoring)

```
RunEngine
  <- CONFIG_TOKEN, LOGGER_TOKEN, EVENT_BUS_TOKEN
  <- ORG_REPO_TOKEN, RUN_REPO_TOKEN, COST_ENTRY_REPO_TOKEN
  <- EXECUTOR_TOKEN
  <- McpConfigGenerator, McpIpcServer, FileLogService
  (Zero setter injection needed)

SessionRunCoordinator
  <- RUN_ENGINE_TOKEN
  <- SESSION_REPO_TOKEN, SESSION_MESSAGE_REPO_TOKEN
  <- PROMPT_BUILDER_TOKEN, ROLE_REPO_TOKEN, ORG_REPO_TOKEN
  <- EVENT_BUS_TOKEN, LOGGER_TOKEN
  (Zero setter injection needed)

TaskRunCoordinator
  <- RUN_ENGINE_TOKEN
  <- TASK_REPO_TOKEN, ROLE_REPO_TOKEN
  <- TaskStateMachine, TaskService, WorkflowEngine
  <- ConversationWorkflowRepo
  <- PROMPT_BUILDER_TOKEN, ExecutionContext
  <- EVENT_BUS_TOKEN, LOGGER_TOKEN
  (One setter: setWorkflowEngine -- retained because WorkflowEngine
   depends on schema repo which depends on task repo)

OrgOrchestrator
  <- TASK_RUN_COORDINATOR_TOKEN (replaces EXECUTION_ENGINE_TOKEN)
  <- WakeGateValidator, RetryScheduler, BudgetGuard
  (Unchanged structure)

PlanningService
  <- SESSION_RUN_COORDINATOR_TOKEN (replaces ExecutionEngine)
  <- SessionService
  <- ROLE_REPO_TOKEN, SKILL_REPO_TOKEN
  (Simplified: no TaskService, no WorkflowEngine, no ConversationWorkflowRepo)
```

### 14.3 Setter Injection Reduction

| Component | Before (setters) | After (setters) |
|-----------|:-:|:-:|
| ExecutionEngine | 4 (conversationWorkflowRepo, workflowEngine, taskService, settingsRepo) | Deleted |
| RunEngine | - | 0 |
| SessionRunCoordinator | - | 0 |
| TaskRunCoordinator | - | 1 (workflowEngine) |
| PlanningService | 6 (executionEngine, taskService, workflowEngine, conversationWorkflowRepo, orgRepo, discussionRepo) | 0 |
| **Total** | **10** | **1** |

---

## 15. Migration from Current Architecture

### 15.1 Backward Compatibility

| Aspect | Strategy |
|--------|---------|
| Existing `plan` type tasks in DB | `getActivePlanningSession()` still checks for legacy `plan` tasks. Returns session-based session if found, falls back to legacy task-based detection. |
| In-flight planning conversations | On upgrade, any `plan` task in `in_progress` with an active ConversationWorkflow will be detected by legacy code path. User can complete or discard it before the new flow takes over. |
| Run records with `task_node_id` | `task_node_id` becomes nullable. Existing runs retain their task references. New session runs use `session_id` instead. |
| PendingPlanStore | Unchanged. Still stores plans in-memory with 24h TTL. Both old and new flows write to it via `capibara_plan_tasks` MCP tool. |

### 15.2 Frontend Migration

`PlanningChatPage.tsx` changes:

| Current | New |
|---------|-----|
| `window.capibara.startPlanningRun()` | `window.capibara.startSession()` |
| `window.capibara.getActivePlanningSession()` | `window.capibara.getActiveSession()` |
| `window.capibara.replyToConversation()` | `window.capibara.sendSessionMessage()` |
| `window.capibara.discardPlanningSession()` | `window.capibara.cancelSession()` |
| Listens for `conversation:*` events | Listens for `session:*` events |
| Reads `workflowState` for AI thinking detection | Reads `session:run-completed` event |
| Uses `discussionGroupId` for message history | Uses `sessionId` for message history |

---

## 16. Code Structure

### 16.1 New Files

```text
apps/electron/src/main/
  core/
    types/
      session.types.ts                    # Session, SessionMessage, SessionType, SessionStatus
    interfaces/
      i-session.repository.ts             # ISessionRepository
      i-session-message.repository.ts     # ISessionMessageRepository
      i-run-engine.ts                     # IRunEngine, RunExecutionParams, RunResult
    tokens.ts                             # + RUN_ENGINE_TOKEN, SESSION_REPO_TOKEN, etc.

  application/
    execution/
      run.engine.ts                       # RunEngine (extracted from ExecutionEngine)
      task-run.coordinator.ts             # TaskRunCoordinator (post-run task logic)
    session/
      session.service.ts                  # SessionService (CRUD + lifecycle)
      session-run.coordinator.ts          # SessionRunCoordinator (session execution)

  infrastructure/
    persistence/sqlite/
      sqlite-session.repository.ts        # SQLite Session persistence
      sqlite-session-message.repository.ts # SQLite SessionMessage persistence
      migrations/
        xxx-create-sessions.ts            # sessions + session_messages tables
        xxx-alter-runs-nullable-task.ts   # runs.task_node_id nullable + session_id

  ipc-handlers/
    session.handlers.ts                   # Session IPC endpoints
```

### 16.2 Modified Files

```text
application/execution/execution.engine.ts    # DELETED (split into run.engine.ts + task-run.coordinator.ts)
application/planning/planning.service.ts     # Rewritten to use SessionService + SessionRunCoordinator
application/skills/prompt-builder.ts         # Add buildForSession() method
infrastructure/mcp/mcp-tool-registry.ts      # Add context tags to tool definitions
infrastructure/mcp/mcp-config-generator.ts   # Accept McpExecutionContext param
application/orchestrator/org.orchestrator.ts # Replace ExecutionEngine ref with TaskRunCoordinator
application/notifications/event-broadcaster.ts # Add session:* event forwarding
shared/contracts.ts                          # New types, IPC channels, events
shared/locale/en-US.ts                       # Session-related UI strings
shared/locale/zh-CN.ts                       # Session-related UI strings
shared/locale/types.ts                       # Session locale keys
composition-root.ts                          # Rewire DI (major change)
renderer/components/planning/PlanningChatPage.tsx  # Migrate to session IPC
```

### 16.3 Unchanged Files

```text
application/conversation/*                    # Entire conversation system unchanged
application/orchestrator/wake-gate.validator.ts
application/state-machine/task.state-machine.ts
application/tasks/task.service.ts
application/workflow/workflow-engine.ts
infrastructure/mcp/mcp-tool-handlers.ts      # Tool handlers themselves unchanged
infrastructure/mcp/capibara-mcp-bridge.ts
application/planning/pending-plan.store.ts
```

---

## 17. Implementation Phasing

### Phase 1: Foundation (Data + RunEngine)

| Step | Deliverable |
|------|------------|
| 1.1 | `session.types.ts` -- Session, SessionMessage, SessionType, SessionStatus |
| 1.2 | `i-session.repository.ts`, `i-session-message.repository.ts` |
| 1.3 | SQLite migration: `sessions` + `session_messages` tables |
| 1.4 | SQLite migration: `runs.task_node_id` nullable + `session_id` column |
| 1.5 | `sqlite-session.repository.ts`, `sqlite-session-message.repository.ts` |
| 1.6 | `i-run-engine.ts` -- interface definition |
| 1.7 | `run.engine.ts` -- extract from ExecutionEngine (pure execution) |
| 1.8 | DI tokens for new components |

### Phase 2: Coordinators

| Step | Deliverable |
|------|------------|
| 2.1 | `task-run.coordinator.ts` -- extract post-run task logic from ExecutionEngine |
| 2.2 | `session.service.ts` -- Session CRUD + lifecycle |
| 2.3 | `session-run.coordinator.ts` -- session execution orchestration |
| 2.4 | `prompt-builder.ts` -- add `buildForSession()` method |
| 2.5 | OrgOrchestrator: replace ExecutionEngine with TaskRunCoordinator |
| 2.6 | Delete `execution.engine.ts` |
| 2.7 | Rewire `composition-root.ts` |

### Phase 3: Planning Migration

| Step | Deliverable |
|------|------------|
| 3.1 | Rewrite `PlanningService` to use SessionService + SessionRunCoordinator |
| 3.2 | MCP tool registry: add context tags |
| 3.3 | McpConfigGenerator: accept McpExecutionContext |
| 3.4 | Session IPC handlers (`session.handlers.ts`) |
| 3.5 | Update `contracts.ts` with new types, schemas, events |
| 3.6 | EventBroadcaster: add session event forwarding |
| 3.7 | Locale strings for session UI |

### Phase 4: Frontend + Integration

| Step | Deliverable |
|------|------------|
| 4.1 | Migrate `PlanningChatPage.tsx` to session-based IPC |
| 4.2 | Remove conversation workflow dependencies from planning UI |
| 4.3 | End-to-end test: planning conversation without Task creation |
| 4.4 | End-to-end test: task execution still works through TaskRunCoordinator |
| 4.5 | Legacy cleanup: deprecation warnings on old planning IPC channels |

---

## 18. Acceptance Checklist

### Functional Acceptance

| # | Question | Expected Answer |
|---|----------|----------------|
| F1 | Does starting a planning conversation create a Task? | **No** -- only a Session is created |
| F2 | Does the planning AI response get routed to a supervisor? | **No** -- no ConversationWorkflow or RoutingPolicyEngine involved |
| F3 | Can the user have a multi-round planning conversation? | **Yes** -- via session resume (--resume cliSessionId) |
| F4 | Does the AI see task_complete/task_review tools during planning? | **No** -- MCP context filtering excludes them |
| F5 | Does confirming a plan create real Tasks? | **Yes** -- batchCreateTasks() unchanged |
| F6 | Does task execution (non-planning) still work? | **Yes** -- TaskRunCoordinator handles same logic as current ExecutionEngine |
| F7 | Does AI-to-AI conversation during task execution still work? | **Yes** -- ConversationWorkflow system completely unchanged |
| F8 | Does planning session survive app restart? | **Yes** -- Session + SessionMessages persisted in SQLite |
| F9 | Can user switch planning role mid-conversation? | **Yes** -- via `session:switch-role` IPC |
| F10 | Is budget enforced for planning runs? | **Yes** -- RunEngine retains budget check |

### Engineering Acceptance

| # | Question | Expected Answer |
|---|----------|----------------|
| E1 | Is ExecutionEngine deleted? | **Yes** -- replaced by RunEngine + TaskRunCoordinator + SessionRunCoordinator |
| E2 | Are setter injections reduced? | **Yes** -- from 10 to 1 |
| E3 | Does RunEngine have zero domain knowledge? | **Yes** -- no Task, Session, Workflow awareness |
| E4 | Is the conversation system (AI-AI) modified? | **No** -- zero changes to conversation-workflow.service.ts, routing-policy.engine.ts, timeout-escalation.service.ts |
| E5 | Are all new classes following DI patterns? | **Yes** -- @injectable, token-based registration |
| E6 | Are all new tables using async Promise<T> repository pattern? | **Yes** |
| E7 | Is MCP tool filtering at config-generation time (not runtime)? | **Yes** -- tools excluded from MCP config JSON |
| E8 | Does the refactoring break any existing IPC contracts? | **No** -- old channels deprecated but functional |

---

## Design Rationale Summary

| Decision | Why |
|----------|-----|
| Session as independent entity (not Task wrapper) | Fundamental model mismatch: conversation != task. Band-aids (plan task type + routing bypass) proved insufficient in practice. |
| RunEngine as pure execution | SRP: execution logic has no reason to know about task lifecycle or conversation workflow. Enables reuse across session and task contexts. |
| Coordinator pattern (not strategy/plugin) | Two concrete coordinators is simpler and more explicit than a generic plugin system. YAGNI -- we have exactly two interaction modes. |
| MCP tool filtering at config time | Safest: AI literally cannot call excluded tools. Runtime checks would require error handling and add complexity. |
| Separate session_messages table (not reuse discussion_messages) | Different lifecycles, different query patterns, different access controls. Forcing them into one table would require intent-based filtering everywhere. |
| Nullable task_node_id on runs (not separate session_runs table) | Runs are the same entity regardless of context. Budget, cost tracking, and log management all key on run_id. Splitting would duplicate infrastructure. |
| Late materialization of tasks | The entire purpose of planning is exploration. Creating tasks early forces premature commitment and pollutes the task tree. |
