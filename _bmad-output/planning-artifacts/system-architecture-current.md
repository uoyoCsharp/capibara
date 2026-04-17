# Capibara System Architecture Document (Current State)

> **Version**: 1.0  
> **Date**: 2026-04-17  
> **Purpose**: Record the current system architecture, clarify terminology ambiguities, and serve as a baseline reference for backend refactoring.

---

## Table of Contents

1. [Project Overview](#1-project-overview)
2. [Terminology Glossary & Ambiguity Analysis](#2-terminology-glossary--ambiguity-analysis)
3. [Architecture Overview](#3-architecture-overview)
4. [Core Domain Model](#4-core-domain-model)
5. [Module Breakdown](#5-module-breakdown)
6. [Data Flow & Key Processes](#6-data-flow--key-processes)
7. [Infrastructure Layer](#7-infrastructure-layer)
8. [IPC Contract Layer](#8-ipc-contract-layer)
9. [Known Architecture Issues](#9-known-architecture-issues)
10. [Appendix: File Structure Reference](#10-appendix-file-structure-reference)

---

## 1. Project Overview

**Capibara** is an AI-driven task orchestration and team coordination system. It enables AI Agents and human team members to collaborate on complex workflows with structured task planning, peer review (discussion + consensus), and automated execution orchestration.

### Tech Stack

| Layer | Technology |
|-------|------------|
| Runtime | Electron (Desktop App) |
| Language | TypeScript (ES2022) |
| Frontend | React + shadcn/ui + Zustand |
| Database | SQLite (better-sqlite3) |
| DI Container | tsyringe (Microsoft) |
| Event Bus | Emittery |
| Logging | Pino (structured JSON) |
| Validation | Zod |
| Build | electron-vite + pnpm monorepo |
| Testing | Vitest |
| AI Integration | Claude CLI (via child process) |
| Tool Protocol | MCP (Model Context Protocol) over WebSocket |

### Monorepo Structure

```
capibara/
  apps/
    electron/
      src/
        main/           # Electron main process (backend)
        renderer/        # React frontend
        shared/          # Shared contracts & locale
      resources/         # Templates, workflows, roles
      tests/             # Vitest unit tests
  packages/
    shared/              # Cross-package shared utilities
```

---

## 2. Terminology Glossary & Ambiguity Analysis

This section is the critical reference for the refactoring. It documents every term currently used in the codebase, identifies naming inconsistencies, and proposes unified terminology.

### 2.1 Ambiguity Summary Table

| Domain | Current Terms (Ambiguous) | Usage Locations | Core Issue |
|--------|---------------------------|-----------------|------------|
| AI Agent | Role, Team | Backend: `Role`; UI: `TeamPage` | "Team" page displays "Roles" — semantic mismatch |
| Execution Unit | Run, Execution, Session | Three overlapping concepts | No clear hierarchy or boundary |
| Task Entity | TaskNode, Task | Internal: `TaskNode`; External: `Task` | Internal/external naming split |
| Peer Review | Discussion, Conversation, Review, Approval | Four terms for related concepts | Overlapping semantics, unclear boundaries |
| Component Suffix | Orchestrator, Coordinator, Engine, Service | Application layer classes | No systematic naming convention |
| Activation | Wake, Trigger, Event | Three terms for related mechanisms | Overloaded terminology |
| Workflow Definition | Workflow, WorkflowSchema | Schema vs instance | "Workflow" means both abstract and concrete |
| Capability | Skill, Tool, Command | Domain model vs MCP layer | Three terms for agent capabilities |
| Container | Organization, Org, Workspace | Backend/API/UI | Abbreviation inconsistency + Workspace ambiguity |

---

### 2.2 Detailed Terminology Analysis

#### 2.2.1 Role vs Team vs Agent

**Current State:**

| Location | Term Used | Example |
|----------|-----------|---------|
| Domain type | `Role` | `interface Role` in `domain.types.ts:77` |
| Database | `roles` | `CREATE TABLE roles` in `migrations.ts` |
| IPC channel | `role` | `capibara:role:get-by-org` |
| DI token | `ROLE_REPO_TOKEN` | `tokens.ts:13` |
| UI page | **Team** | `TeamPage.tsx` — but displays Role list |
| UI drawer | `Role` | `RoleDrawer.tsx` |
| Contract record | `RoleRecord` | `contracts.ts:627` |

**Issue:** The UI navigation says "Team" but the underlying entity is always "Role". The word "Agent" (as in AI Agent) never appears in code, yet this is conceptually what a Role represents. There's a conceptual gap between "Role" (a position definition) and "Agent" (an active executor).

**Semantic Clarification:**
- **Role** = A position with persona, skills, and permissions (the "who")
- **Team** = A UI-only concept referring to the collection of Roles under an Organization
- **Agent** = Not used in code, but conceptually what a Role becomes when executing

---

#### 2.2.2 Run vs Execution vs Session

**Current State:**

| Term | Definition | Type | Location |
|------|-----------|------|----------|
| **Run** | A single AI invocation record | Entity | `interface Run` in `domain.types.ts:142` |
| **Execution** | Global orchestration control | Concept | `capibara:execution:pause/resume` in `contracts.ts:74-76` |
| **Execution** | A folder name | Directory | `application/execution/` contains RunEngine + TaskRunCoordinator |
| **Execution** | A context label | Type | `McpExecutionContext = 'task:execution'` |
| **Session** | Multi-turn human-AI conversation state | Entity | `interface Session` in `session.types.ts:8` |

**Overlap Points:**
1. `RunEngine` lives in `application/execution/` — is it an "execution" engine or a "run" engine?
2. `pauseExecution` pauses the entire Orchestrator, not individual Runs — "Execution" here means "global run scheduling"
3. A Session creates multiple Runs (each `sendSessionMessage` may trigger a Run)
4. `Run.sessionId` links a Run back to its Session, but a Run can also exist without a Session (task-triggered)
5. `ExecutionContext` (`execution.context.ts`) builds prompt context — naming implies "execution" but it's really "prompt preparation context"

**Semantic Clarification:**
- **Run** = A single, atomic AI invocation (one prompt → one response). Has status, cost, and log.
- **Session** = A stateful multi-turn conversation container. Types: `planning` (task decomposition) or `adhoc` (freeform). Contains multiple Runs.
- **Execution** = An overloaded term used for:
  - Global orchestration state (`pauseExecution` / `resumeExecution`)
  - The act of running AI (`application/execution/` directory)
  - Prompt preparation context (`ExecutionContext`)

---

#### 2.2.3 TaskNode vs Task

**Current State:**

| Location | Term | Example |
|----------|------|---------|
| Domain type | `TaskNode` | `interface TaskNode` in `domain.types.ts:95` |
| Database table | `task_nodes` | `CREATE TABLE task_nodes` in `migrations.ts` |
| DB column (FK) | `task_node_id` | `discussion_groups.task_node_id`, `runs.task_node_id` |
| IPC channel | `task` | `capibara:task:get-by-org` |
| Contract record | `TaskRecord` | `contracts.ts:663` (NOT `TaskNodeRecord`) |
| UI components | `Task*` | `TaskTreeView.tsx`, `TaskDetailDrawer.tsx` |
| Service class | `TaskService` | `task.service.ts` |
| Repository interface | `ITaskRepository` | NOT `ITaskNodeRepository` |
| DI token | `TASK_REPO_TOKEN` | NOT `TASK_NODE_REPO_TOKEN` |
| Parameters | Mixed | `taskNodeId` in some places, `taskId` in others |

**Issue:** The domain entity is called `TaskNode` (emphasizing it's a tree node), but everything else uses `Task`. This creates a persistent translation mismatch. FK columns say `task_node_id` but service methods receive `taskId`.

**Semantic Clarification:**
- **TaskNode** = The official domain entity name, emphasizing the hierarchical tree structure
- **Task** = The simplified external name used in APIs, UI, and most service interfaces
- These are the same thing — the naming just isn't unified

---

#### 2.2.4 Discussion vs Conversation vs Review vs Approval

**Current State:**

This is the most complex terminology tangle in the system. Four related but distinct concepts share overlapping vocabulary:

| Term | Domain | Entity/Types | Location |
|------|--------|-------------|----------|
| **Discussion** | Task-level peer feedback forum | `DiscussionGroup`, `DiscussionMessage` | `domain.types.ts:110-140` |
| **Conversation** | Role-to-role Q&A workflow | `ConversationWorkflow` | `conversation.types.ts:22` |
| **Review** | Part of discussion (voting) | `WakeTrigger: 'review_requested' / 'review_approve' / 'review_revise'` | `domain.types.ts:33-36` |
| **Approval** | Human sign-off for task progression | IPC: `capibara:approval:*`, Handler: `approval.handlers.ts` | `contracts.ts:67-68` |

**How They Actually Relate:**

```
Discussion (Forum)
  ├── Contains: DiscussionMessage[] (messages with votes)
  ├── Purpose: Peer review of task artifacts
  ├── Voting: APPROVE / REVISE / CONCERN / DELEGATE
  ├── Consensus: ConsensusDetector determines when review closes
  └── ConversationWorkflow (nested Q&A within a discussion)
       ├── One Role asks a question → routed to another Role
       ├── Has its own state machine (waiting → replied → resolved)
       ├── Can escalate, timeout, or be cancelled
       └── Messages are stored as DiscussionMessages (shared storage!)

Review = The process of Discussion voting → Consensus
Approval = A subset: when a task requires human sign-off (requiresHumanApproval)
```

**Key Confusion Points:**
1. `ConversationWorkflow` stores its messages as `DiscussionMessage` records — they share the same table
2. `review_requested` is a `WakeTrigger`, but "review" has no dedicated entity
3. `approval.handlers.ts` handles human approval, which is triggered by "review" consensus in "discussions"
4. IPC channel prefix `capibara:approval:*` vs `capibara:discussion:*` — are they separate features?
5. UI has both `DiscussionPage` and `ConversationPage` as separate navigation destinations

**Semantic Clarification:**
- **Discussion** = A forum attached to a TaskNode where Roles post messages and vote
- **Conversation** = A structured Q&A workflow between two Roles, triggered during AI execution, stored within a Discussion
- **Review** = The abstract process of Roles voting in a Discussion to reach consensus
- **Approval** = The specific case where human sign-off is required before a task can proceed

---

#### 2.2.5 Component Naming: Orchestrator vs Coordinator vs Engine vs Service

**Current State:**

| Suffix | Instances | Implied Responsibility |
|--------|-----------|----------------------|
| **Orchestrator** | `OrgOrchestrator` (1) | Top-level event-driven scheduler, manages cross-entity coordination |
| **Coordinator** | `TaskRunCoordinator`, `SessionRunCoordinator` (2) | Bridges between orchestrator and execution, manages lifecycle of one entity type |
| **Engine** | `RunEngine`, `WorkflowEngine`, `NarrativeEngine`, `BehaviorEngine`, `RoutingPolicyEngine` (5) | Core computation/logic, stateless or nearly so |
| **Service** | `TaskService`, `DiscussionService`, `SessionService`, `ConversationWorkflowService`, `TimeoutEscalationService`, `NotificationService`, `PlanningService`, `SystemCheckService`, `WorkflowTemplateService`, `OrgTemplateService`, `FileLogService`, `WorkerService` (12) | CRUD + business rules + lifecycle management |

**Issue:** No documented rule distinguishes these suffixes. Examples of inconsistency:
- `RoutingPolicyEngine` and `ConversationWorkflowService` are at the same architectural level but use different suffixes
- `WorkerService` is infrastructure, but `TaskService` is application — both use "Service"
- `NarrativeEngine` generates summaries (could be a Service); `BehaviorEngine` evaluates rules (could also be called BehaviorEvaluator)

**Semantic Clarification (proposed convention):**
- **Orchestrator** = Exactly one per bounded context; event-driven, manages the global wake/execution loop
- **Coordinator** = Mediates between orchestrator and engines for a specific entity lifecycle
- **Engine** = Pure logic / computation, ideally stateless; takes input, returns output
- **Service** = Stateful business operations; wraps repositories with business rules

---

#### 2.2.6 Wake vs Trigger vs Event

**Current State:**

| Term | Type Definition | Purpose |
|------|----------------|---------|
| **WakeTrigger** | `'task_assigned' \| 'review_approve' \| ...` | The *reason* a Role should be activated |
| **TransitionTrigger** | `'manual' \| 'auto' \| 'system'` | The *mechanism* of a workflow status change |
| **BehaviorTrigger** | `{ type: 'on_status_enter' } \| ...` | The *condition* that activates a behavior rule |
| **DomainEventType** | `'task:status-changed' \| 'run:succeeded' \| ...` | The *fact* that something happened in the system |
| **PendingWake** | Entity: `{ roleId, trigger, taskNodeId }` | A queued activation request waiting to be processed |

**Issue:** The word "trigger" appears in three completely different contexts:
1. `WakeTrigger` — why should a Role wake up
2. `TransitionTrigger` — how does a status transition happen
3. `BehaviorTrigger` — when should a behavior rule fire

These are distinct concepts that share a name. Additionally, the relationship between "Event" (domain events) and "Wake" (Role activation) is implicit: an Event may *cause* a Wake, but this is wired in the Orchestrator, not in the type system.

---

#### 2.2.7 Workflow vs WorkflowSchema

**Current State:**

| Term | Meaning | Location |
|------|---------|----------|
| `WorkflowSchema` | Abstract definition of task types, statuses, transitions, and behavior rules | `workflow-schema.types.ts:33` |
| `WorkflowEngine` | Runtime engine that validates against a schema | `workflow-engine.ts` |
| `ConversationWorkflow` | A concrete instance of a role-to-role Q&A process | `conversation.types.ts:22` |
| `workflow_schemas` table | Stores schema definitions per org | `migrations.ts` |
| `conversation_workflows` table | Stores Q&A workflow instances | `migrations.ts` |
| `WorkflowTemplateService` | Loads schema templates from disk | `workflow-template.service.ts` |

**Issue:** "Workflow" is severely overloaded:
- `WorkflowSchema` + `WorkflowEngine` = Task lifecycle rules (abstract schema)
- `ConversationWorkflow` = A concrete Q&A instance (completely different domain)
- `WorkflowTemplateService` = Loads schema templates (related to WorkflowSchema, not ConversationWorkflow)

---

#### 2.2.8 Skill vs Tool vs Command

**Current State:**

| Term | Meaning | Location |
|------|---------|----------|
| **Skill** | A capability record stored in DB, assigned to Roles | `interface Skill` in `domain.types.ts:187` |
| **Skill.command** | The executable command string within a Skill | `domain.types.ts:190` |
| **MCP Tool** | A system-level function callable by Claude during execution | `McpToolHandlers`, `McpToolRegistry` |
| **Tool** (in prompts) | Prompt section listing available system tools | `SessionPromptStrategy: buildTools()` |

**Issue:**
- `Skill` is the domain concept (has name, category, description), but `Skill.command` is just a string field
- MCP Tools (like `capibara_plan_tasks`, `capibara_context`) are NOT Skills — they're system-level functions
- In prompt building, `buildTools()` and `buildSkills()` are separate methods, but the user-facing concept doesn't distinguish them
- Skills inform Role behavior (persona enrichment), while Tools enable Claude to call back into Capibara

**Semantic Clarification:**
- **Skill** = A stored domain capability assigned to Roles; enriches persona and prompt context
- **Command** = The CLI command string associated with a Skill (e.g., `claude code --review`)
- **Tool** = An MCP-callable system function that Claude can invoke during execution (e.g., `capibara_plan_tasks`)

---

#### 2.2.9 Organization vs Org vs Workspace

**Current State:**

| Location | Term | Example |
|----------|------|---------|
| Domain type | `Organization` | `interface Organization` in `domain.types.ts:63` |
| Database | `organizations` | Table name |
| IPC channel | `org` | `capibara:org:get-all` |
| DB FK column | `org_id` | Used in all child tables |
| DI token | `ORGANIZATION_REPO_TOKEN` | Full name |
| UI page | `Organization` + `Workspace` | Two separate pages |
| Entity field | `workspacePath` | `Organization.workspacePath` in `domain.types.ts:72` |
| UI navigation | `workspace` | `SectionId = 'workspace'` in `contracts.ts:886` |

**Issue:**
- Code mixes `Organization` (full) and `org` (abbreviated) with no rule for when to use which
- `workspacePath` is a *field on Organization*, yet there's a separate `WorkspacePage` in the UI
- Is "Workspace" the same as "Organization"? Or is it the filesystem directory that an Organization points to?

**Semantic Clarification:**
- **Organization** = The top-level domain entity containing Roles, Tasks, and all other sub-entities
- **Org** = Abbreviation used in IPC channels, DB columns, and variable names
- **Workspace** = The filesystem directory path associated with an Organization (stored as `Organization.workspacePath`)

---

### 2.3 Type Duplication: Domain vs Contract

The codebase maintains two parallel type hierarchies:

| Domain Type (main process) | Contract Type (shared) | Difference |
|---|---|---|
| `Organization` | `OrganizationRecord` | Identical fields |
| `Role` | `RoleRecord` | Identical fields |
| `TaskNode` | `TaskRecord` | Name difference! `TaskNode` → `TaskRecord` |
| `DiscussionGroup` | `DiscussionGroupRecord` | Identical fields |
| `DiscussionMessage` | `DiscussionMessageRecord` | Identical fields |
| `Run` | `RunRecord` | Run has `sessionId`; RunRecord doesn't |
| `Skill` | `SkillRecord` | Identical fields |
| `ConversationWorkflow` | `ConversationWorkflowRecord` | CW has `askingSessionId` + `auditReason`; Record doesn't |
| `Session` | `SessionRecord` | Identical fields |
| `SessionMessage` | `SessionMessageRecord` | Identical fields |

**Issues:**
- `TaskNode` → `TaskRecord` name change across the boundary
- Some fields are intentionally omitted from Records (e.g., `Run.sessionId`), but the omission is not documented
- Both hierarchies re-declare the same type aliases (`OrgStatus`, `RunStatus`, `WakeTrigger`, etc.)

---

## 3. Architecture Overview

### 3.1 Layer Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        Renderer (React)                         │
│  Components: Dashboard, Tasks, Team, Discussion, Conversation,  │
│              Planning, Settings, Workspace, Onboarding          │
│  State: Zustand stores                                          │
└────────────────────────────┬────────────────────────────────────┘
                             │ Electron IPC (DesktopResult<T>)
                             │ 50+ channels defined in contracts.ts
┌────────────────────────────┴────────────────────────────────────┐
│                     IPC Handler Layer (16 files)                │
│  org / role / skill / task / discussion / run / approval /      │
│  narrative / settings / conversation / schema / system /        │
│  session / planning / template / snapshot                       │
└────────────────────────────┬────────────────────────────────────┘
                             │
┌────────────────────────────┴────────────────────────────────────┐
│                     Application Layer                           │
│                                                                 │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │            Orchestration & Execution                      │   │
│  │  OrgOrchestrator ──→ TaskRunCoordinator ──→ RunEngine    │   │
│  │                  ──→ SessionRunCoordinator ──→ RunEngine  │   │
│  │  Policy: WakeGateValidator, RetryScheduler, BudgetGuard  │   │
│  └──────────────────────────────────────────────────────────┘   │
│                                                                 │
│  ┌──────────────────┐  ┌──────────────────┐  ┌──────────────┐  │
│  │  Task Domain      │  │  Discussion      │  │ Conversation │  │
│  │  TaskService      │  │  DiscussionSvc   │  │ CW Service   │  │
│  │  TaskStateMachine │  │  ConsensusDet.   │  │ RoutingEng.  │  │
│  │  Decomposition    │  │                  │  │ TimeoutEsc.  │  │
│  │  WorkflowEngine   │  │                  │  │ ContextBld.  │  │
│  │  BehaviorEngine   │  │                  │  │              │  │
│  └──────────────────┘  └──────────────────┘  └──────────────┘  │
│                                                                 │
│  ┌──────────────────┐  ┌──────────────────┐  ┌──────────────┐  │
│  │  Planning         │  │  Prompt & Ctx    │  │  Progress    │  │
│  │  PlanningService  │  │  PromptBuilder   │  │  NarrativeEng│  │
│  │  PendingPlanStore │  │  TaskPromptStrat │  │  EventDigest │  │
│  │                   │  │  SessionPromptSt │  │  EventBcast  │  │
│  │                   │  │  ExecutionContext │  │  Notification│  │
│  └──────────────────┘  └──────────────────┘  └──────────────┘  │
└────────────────────────────┬────────────────────────────────────┘
                             │
┌────────────────────────────┴────────────────────────────────────┐
│                     Infrastructure Layer                        │
│                                                                 │
│  Persistence:  13 SQLite Repositories + Migrations              │
│  Executors:    UtilityProcessExecutor, WorkerService, Worker    │
│  MCP:          McpIpcServer, McpToolHandlers, McpToolRegistry   │
│  Observability: PinoLogger, EmitteryEventBus, CostTracker      │
│  Adapters:     ClaudeLocalAdapter, StreamJsonParser             │
│  Logging:      FileLogService                                   │
└─────────────────────────────────────────────────────────────────┘
```

### 3.2 Dependency Injection

- **Container:** tsyringe with token-based registration
- **Token Count:** 43+ symbols defined in `core/tokens.ts`
- **Registration:** All manual in `composition-root.ts` (460 lines, single file)
- **Circular Dependency Resolution:** Post-construction setter injection (e.g., `workflowEngine.setTaskRepo(taskRepo)`)

### 3.3 Event-Driven Architecture

- **Event Bus:** `EmitteryEventBus` implementing `IEventBus`
- **Event Types:** 56 `DomainEventType` values (e.g., `task:status-changed`, `run:succeeded`, `conversation:escalated`)
- **Event Flow:** Domain events published by services → consumed by Orchestrator, Digester, Broadcaster, NotificationService
- **Desktop Events:** Separate `DesktopEvent` type for Main → Renderer communication (26 event types)

---

## 4. Core Domain Model

### 4.1 Entity Relationship Diagram

```
Organization
 │
 ├── 1:N ── Role
 │           ├── N:M ── Skill (via skillIds[])
 │           ├── 1:N ── Run
 │           │           └── 1:N ── CostEntry
 │           └── parent/child hierarchy (Role.parentId)
 │
 ├── 1:N ── TaskNode
 │           ├── parent/child hierarchy (TaskNode.parentId, tree depth)
 │           ├── 1:N ── DiscussionGroup
 │           │           └── 1:N ── DiscussionMessage
 │           └── 1:N ── ConversationWorkflow
 │                       └── 1:N ── ConversationEvent (audit)
 │
 ├── 1:N ── WorkflowSchema (task lifecycle definitions)
 │
 ├── 1:N ── Session
 │           └── 1:N ── SessionMessage
 │
 ├── 1:N ── PendingWake (queued Role activations)
 │
 └── 1:N ── Narrative (progress summaries)

Standalone:
 - Setting (key-value configuration)
```

### 4.2 Entity Definitions

#### Organization
Top-level container for all other entities. Represents a project context.

| Field | Type | Note |
|-------|------|------|
| id | string | UUID |
| name | string | |
| description | string | |
| customInstructions | string | Extra prompt context |
| status | `active \| paused \| archived` | |
| budgetLimit | number | Token budget cap |
| orgTemplateId | string? | Source template |
| planningRoleId | string? | Default planning Role |
| workspacePath | string | Filesystem project directory |

#### Role
An AI Agent or human team member position within an Organization.

| Field | Type | Note |
|-------|------|------|
| id | string | UUID |
| orgId | string | FK → Organization |
| name | string | Display name |
| parentId | string? | Hierarchical parent Role |
| persona | string | AI persona prompt text |
| knowledgeBaseRefs | string[] | External knowledge references |
| skillIds | string[] | Assigned Skills (soft FK) |
| canApprove | boolean | Permission to approve tasks |
| canDelegate | boolean | Permission to delegate |
| requiresHumanApproval | boolean | Tasks need human sign-off |
| consecutiveWakeCount | number | Circuit breaker counter |
| isSystemRole | boolean | Built-in system Role |
| status | `active \| paused \| idle` | |

#### TaskNode
A work item in a hierarchical tree (epic → story → task → subtask).

| Field | Type | Note |
|-------|------|------|
| id | string | UUID |
| orgId | string | FK → Organization |
| parentId | string? | Parent in tree |
| type | string | Schema-driven (e.g., `epic`, `story`, `task`) |
| title | string | |
| description | string | |
| status | string | Schema-driven (e.g., `pending`, `in_progress`, `done`) |
| assigneeRoleId | string? | FK → Role |
| depth | number | Tree depth (0 = root) |
| artifactPaths | string[]? | Output file paths |

#### Run
A single AI invocation record.

| Field | Type | Note |
|-------|------|------|
| id | string | UUID |
| orgId | string | FK → Organization |
| taskNodeId | string? | FK → TaskNode (null for Session-only Runs) |
| roleId | string | FK → Role (the executing agent) |
| status | `queued \| running \| succeeded \| failed \| cancelled \| interrupted` | |
| trigger | WakeTrigger | Why this Run was started |
| sessionId | string? | FK → Session (if part of multi-turn) |
| tokenCount | number | Total tokens consumed |

#### Session
A multi-turn conversation container.

| Field | Type | Note |
|-------|------|------|
| id | string | UUID |
| orgId | string | FK → Organization |
| roleId | string | FK → Role |
| type | `planning \| adhoc` | |
| status | `active \| completed \| cancelled` | |
| cliSessionId | string? | Claude CLI `--resume` session ID |

#### DiscussionGroup
A review forum attached to a TaskNode.

| Field | Type | Note |
|-------|------|------|
| id | string | UUID |
| taskNodeId | string | FK → TaskNode |
| orgId | string | FK → Organization |
| status | `active \| archived` | |
| summary | string? | Generated after completion |
| currentRound | number | Review round counter |
| reviseCount | number | Number of REVISE votes received |

#### DiscussionMessage
A message within a DiscussionGroup (also used by ConversationWorkflow).

| Field | Type | Note |
|-------|------|------|
| id | string | UUID |
| groupId | string | FK → DiscussionGroup |
| authorRoleId | string? | FK → Role (null for system) |
| authorType | `ai \| human \| system` | |
| content | string | |
| voteTag | `APPROVE \| REVISE \| CONCERN \| DELEGATE \| null` | |
| intent | `question \| reply \| escalation \| resolution \| vote \| general` | |
| inReplyToMessageId | string? | Thread reply FK |
| reviewRound | number | Which round this message belongs to |

#### ConversationWorkflow
A structured Q&A workflow between two Roles.

| Field | Type | Note |
|-------|------|------|
| id | string | UUID |
| orgId | string | FK → Organization |
| taskNodeId | string | FK → TaskNode |
| discussionGroupId | string | FK → DiscussionGroup (shared message storage) |
| askingRoleId | string | FK → Role (questioner) |
| askingRunId | string | FK → Run (the Run that asked) |
| respondentRoleId | string? | FK → Role (answerer, null until routed) |
| respondentType | `ai \| human` | |
| state | `waiting_for_reply \| reply_received \| resumed \| resolved \| escalated \| timed_out \| cancelled` | |
| depth | number | Nested conversation depth |
| parentWorkflowId | string? | FK → self (nested Q&A) |
| priority | number | Routing priority |
| timeoutAt | string? | Escalation deadline |

#### WorkflowSchema
Dynamic task type + status definitions (schema-driven, not hardcoded).

```typescript
interface WorkflowSchema {
  workItemTypes: WorkItemTypeDefinition[];  // e.g., epic, story, task, subtask
  statuses: StatusDefinition[];             // e.g., pending, in_progress, done
  transitions: TransitionDefinition[];      // e.g., pending → in_progress (manual)
  behaviorRules: BehaviorRule[];            // TCA rules (Trigger-Condition-Action)
}
```

#### Skill
A capability that can be assigned to Roles.

| Field | Type | Note |
|-------|------|------|
| id | string | UUID |
| name | string | Display name |
| command | string | Executable CLI command |
| description | string | |
| category | `analysis \| design \| implementation \| review \| test \| general` | |
| source | `builtin \| template \| custom` | |
| customPromptContent | string? | Extra prompt content when this Skill is active |

---

## 5. Module Breakdown

### 5.1 Orchestration & Execution

**Purpose:** Central event-driven scheduling and AI execution.

| Component | Type | File | Responsibility |
|-----------|------|------|---------------|
| `OrgOrchestrator` | Orchestrator | `application/orchestrator/org.orchestrator.ts` | Central event loop, per-org queues, global pause/resume |
| `WakeGateValidator` | Policy | `application/orchestrator/wake-gate.validator.ts` | Validates whether a Role can be woken |
| `RetryScheduler` | Policy | `application/orchestrator/retry-scheduler.ts` | Manages retry timing for failed Runs |
| `BudgetGuard` | Policy | `application/orchestrator/budget-guard.ts` | Enforces token budget limits |
| `RunEngine` | Engine | `application/execution/run.engine.ts` | Pure AI execution: prompt + config → result |
| `TaskRunCoordinator` | Coordinator | `application/execution/task-run.coordinator.ts` | Task lifecycle around a Run (pre/post-run logic) |
| `SessionRunCoordinator` | Coordinator | `application/session/session-run.coordinator.ts` | Multi-turn conversation state management |

**Execution Chain:**
```
DomainEvent → OrgOrchestrator.processWake()
  → WakeGateValidator.check() → allowed?
  → BudgetGuard.check() → within budget?
  → TaskRunCoordinator.execute(taskNodeId, roleId, trigger)
    → ExecutionContext.build() → PromptBuilder.build()
    → RunEngine.execute(prompt, config)
      → UtilityProcessExecutor → Worker → Claude CLI
    → Handle result: update Run status, emit events
```

### 5.2 Task Management

| Component | Type | File | Responsibility |
|-----------|------|------|---------------|
| `TaskService` | Service | `application/tasks/task.service.ts` | Task CRUD + validation against WorkflowEngine |
| `TaskStateMachine` | Engine | `application/state-machine/task.state-machine.ts` | Enforces valid status transitions, emits events |
| `WorkflowEngine` | Engine | `application/workflow/workflow-engine.ts` | Schema-driven validation: allowed types, statuses, transitions |
| `BehaviorEngine` | Engine | `application/workflow/behavior-engine.ts` | TCA rule evaluation (Trigger-Condition-Action) |
| `DecompositionAdvisor` | Service | `application/tasks/decomposition.advisor.ts` | LLM-assisted task breakdown |
| `WorkflowTemplateService` | Service | `application/workflow/workflow-template.service.ts` | Loads workflow templates from disk |

### 5.3 Discussion & Consensus

| Component | Type | File | Responsibility |
|-----------|------|------|---------------|
| `DiscussionService` | Service | `application/discussion/discussion.service.ts` | Discussion lifecycle, message handling, review coordination |
| `ConsensusDetector` | Engine | `application/consensus/consensus.detector.ts` | Analyzes votes to determine consensus |

### 5.4 Conversation System

| Component | Type | File | Responsibility |
|-----------|------|------|---------------|
| `ConversationWorkflowService` | Service | `application/conversation/conversation-workflow.service.ts` | Q&A workflow state machine management |
| `RoutingPolicyEngine` | Engine | `application/conversation/routing-policy.engine.ts` | Determines which Role should answer a question |
| `TimeoutEscalationService` | Service | `application/conversation/timeout-escalation.service.ts` | Monitors timeouts, handles escalation + orphan recovery |
| `ConversationContextBuilder` | Builder | `application/conversation/conversation-context.builder.ts` | Builds conversation context for prompts |
| `ConversationEventLogger` | Logger | `infrastructure/persistence/sqlite/conversation-event.logger.ts` | Append-only audit log |

### 5.5 Planning

| Component | Type | File | Responsibility |
|-----------|------|------|---------------|
| `PlanningService` | Service | `application/planning/planning.service.ts` | Multi-turn planning session management |
| `PendingPlanStore` | Store | `application/planning/pending-plan.store.ts` | In-memory cache for plan drafts before user confirmation |

### 5.6 Prompt & Context

| Component | Type | File | Responsibility |
|-----------|------|------|---------------|
| `PromptBuilder` | Builder | `application/prompt/prompt-builder.ts` | Assembles final prompt from context |
| `TaskPromptStrategy` | Strategy | `application/prompt/task-prompt-strategy.ts` | Task-specific prompt sections |
| `SessionPromptStrategy` | Strategy | `application/prompt/session-prompt-strategy.ts` | Session/planning prompt sections |
| `ExecutionContext` | Context | `application/context/execution.context.ts` | Aggregates all data needed for prompt building |
| `OrgContext` | Context | `application/context/org.context.ts` | Organization-level context aggregation |

### 5.7 Progress & Notification

| Component | Type | File | Responsibility |
|-----------|------|------|---------------|
| `NarrativeEngine` | Engine | `application/progress/narrative.engine.ts` | Generates progress summaries from events |
| `EventDigester` | Processor | `application/progress/event.digester.ts` | Dual-window event batching (300ms IPC / 30s notification) |
| `EventBroadcaster` | Broadcaster | `application/notifications/event-broadcaster.ts` | Forwards domain events to Renderer via IPC |
| `NotificationService` | Service | `application/notifications/notification.service.ts` | Desktop notification management |

---

## 6. Data Flow & Key Processes

### 6.1 Task Execution Flow

```
[User / Orchestrator]
    │
    ▼
TaskRunCoordinator.execute(taskNodeId, roleId, trigger)
    │
    ├──→ ExecutionContext.buildForTask()
    │      ├── Load TaskNode, Role, Skills, Settings
    │      ├── Load DiscussionGroup + recent messages
    │      ├── Load active ConversationWorkflow (if any)
    │      └── Return PromptContext
    │
    ├──→ PromptBuilder.build(context)
    │      └── TaskPromptStrategy assembles prompt sections
    │
    ├──→ RunEngine.execute(prompt, config)
    │      ├── Create Run record (status: queued → running)
    │      ├── Start MCP IPC server for tool calls
    │      ├── Spawn Worker via UtilityProcessExecutor
    │      │      └── Worker calls Claude CLI
    │      ├── Stream output via StreamJsonParser
    │      │      ├── Emit 'run:log' events
    │      │      └── Emit 'run:assistant-text' events
    │      └── On completion:
    │           ├── Record CostEntry
    │           ├── Update Run status (succeeded/failed)
    │           └── Emit 'run:succeeded' or 'run:failed'
    │
    └──→ Post-execution:
           ├── TaskStateMachine may transition task status
           └── OrgOrchestrator reacts to events, may trigger next wake
```

### 6.2 Discussion & Consensus Flow

```
[Role posts message/vote]
    │
    ▼
DiscussionService.onMessageAdded(groupId, message)
    │
    ├──→ Persist DiscussionMessage
    ├──→ Emit 'discussion:message-added'
    │
    ├──→ If message has VoteTag:
    │      └── ConsensusDetector.evaluate(groupId)
    │           ├── Count votes by tag
    │           ├── Check consensus rules
    │           └── If consensus reached:
    │                ├── TaskStateMachine.transition(taskId, newStatus)
    │                ├── Emit 'task:status-changed'
    │                └── Archive DiscussionGroup
    │
    └──→ If message has intent='question' from different Role:
           └── ConversationWorkflowService.create(...)
                ├── RoutingPolicyEngine.route(request)
                ├── Create ConversationWorkflow record
                ├── Create PendingWake for respondent
                └── Emit 'conversation:question-posted'
```

### 6.3 Planning Flow

```
[User starts planning]
    │
    ▼
PlanningService.start(orgId, initialMessage, roleId)
    │
    ├──→ SessionService.create(orgId, roleId, 'planning')
    │
    └──→ SessionRunCoordinator.execute(session, message)
           ├── Build planning-specific prompt
           ├── RunEngine.execute(prompt)
           ├── MCP Tool: capibara_plan_tasks → PendingPlanStore
           └── Emit 'planning:plan-ready'

[User reviews pending plan]
    │
    ▼
PlanningHandlers.batchCreateTasks(orgId, plan)
    │
    └──→ TaskService.batchCreate(orgId, planTasks)
           ├── Validate types against WorkflowEngine
           ├── Resolve assigneeRoleName → roleId
           └── Create TaskNode tree recursively
```

### 6.4 Conversation Q&A Flow

```
[Role A asks question during Run]
    │ (via MCP Tool: capibara_ask_question)
    ▼
ConversationWorkflowService.create(request)
    │
    ├──→ RoutingPolicyEngine.route()
    │      ├── Check recipient target type
    │      ├── Find best respondent Role
    │      └── Return RoutingDecision
    │
    ├──→ Create ConversationWorkflow (state: waiting_for_reply)
    ├──→ Store question as DiscussionMessage
    ├──→ Enqueue PendingWake for respondent
    └──→ Emit 'conversation:question-posted'

[Respondent (Role B or Human) replies]
    │
    ▼
ConversationWorkflowService.handleReply(workflowId, content)
    │
    ├──→ Transition state: waiting_for_reply → reply_received
    ├──→ Store reply as DiscussionMessage
    ├──→ Wake original Role A to resume
    └──→ Emit 'conversation:reply-posted'

[TimeoutEscalationService (periodic scan)]
    │
    ├──→ Find workflows past timeoutAt
    ├──→ Escalate: route to supervisor or human
    └──→ Emit 'conversation:timed-out' / 'conversation:escalated'
```

---

## 7. Infrastructure Layer

### 7.1 Persistence

| Repository | Table | Entity |
|------------|-------|--------|
| `SqliteOrganizationRepository` | `organizations` | Organization |
| `SqliteRoleRepository` | `roles` | Role |
| `SqliteTaskRepository` | `task_nodes` | TaskNode |
| `SqliteDiscussionRepository` | `discussion_groups`, `discussion_messages` | DiscussionGroup, DiscussionMessage |
| `SqliteRunRepository` | `runs` | Run |
| `SqliteSkillRepository` | `skills` | Skill |
| `SqliteCostEntryRepository` | `cost_entries` | CostEntry |
| `SqliteNarrativeRepository` | `narratives` | Narrative |
| `SqlitePendingWakeRepository` | `pending_wakes` | PendingWake |
| `SqliteSettingsRepository` | `settings` | Setting |
| `SqliteConversationWorkflowRepository` | `conversation_workflows` | ConversationWorkflow |
| `SqliteWorkflowSchemaRepository` | `workflow_schemas` | WorkflowSchema |
| `SqliteSessionRepository` | `sessions` | Session |
| `SqliteSessionMessageRepository` | `session_messages` | SessionMessage |

**Database Location:** `~/.capibara/capibara.sqlite`

### 7.2 Executor Pipeline

```
RunEngine
  └── UtilityProcessExecutor (IExecutor interface)
        └── WorkerService (thread pool management)
              └── Worker (actual thread)
                    └── ClaudeLocalAdapter → Claude CLI process
                          └── StreamJsonParser / ClaudeStreamParser
```

### 7.3 MCP (Model Context Protocol)

```
McpIpcServer (WebSocket)
  ├── McpToolRegistry (tool registration)
  └── McpToolHandlers (20+ tool implementations)
        ├── Task tools: create, update, query
        ├── Role tools: query, transition
        ├── Discussion tools: post message, vote
        ├── Planning tools: submit plan, query context
        └── Conversation tools: ask question
```

---

## 8. IPC Contract Layer

### 8.1 Channel Namespaces

| Namespace | Count | Example |
|-----------|-------|---------|
| `capibara:org:*` | 5 | `capibara:org:create` |
| `capibara:role:*` | 5 | `capibara:role:get-by-org` |
| `capibara:skill:*` | 6 | `capibara:skill:search` |
| `capibara:task:*` | 6 | `capibara:task:update-status` |
| `capibara:discussion:*` | 6 | `capibara:discussion:post-message` |
| `capibara:run:*` | 7 | `capibara:run:start` |
| `capibara:execution:*` | 3 | `capibara:execution:pause` |
| `capibara:session:*` | 7 | `capibara:session:start` |
| `capibara:planning:*` | 8 | `capibara:planning:batch-create` |
| `capibara:conversation:*` | 10 | `capibara:conversation:reply` |
| `capibara:schema:*` | 5 | `capibara:schema:save` |
| `capibara:approval:*` | 2 | `capibara:approval:get-pending` |
| `capibara:narrative:*` | 3 | `capibara:narrative:generate` |
| `capibara:cost:*` | 2 | `capibara:cost:get-summary` |
| `capibara:budget:*` | 1 | `capibara:budget:resume-roles` |
| `capibara:settings:*` | 3 | `capibara:settings:update` |
| `capibara:system:*` | 1 | `capibara:system:check-deps` |
| `capibara:template:*` | 2 | `capibara:template:load` |
| `capibara:snapshot:*` | 1 | `capibara:snapshot:load` |
| **Total** | **~83** | |

### 8.2 Response Convention

All IPC responses use the `DesktopResult<T>` wrapper:
```typescript
type DesktopResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: { code: string; message: string } };
```

---

## 9. Known Architecture Issues

### 9.1 Structural Issues

| # | Issue | Impact | Location |
|---|-------|--------|----------|
| 1 | `composition-root.ts` is 460+ lines with all DI registration in one file | Hard to maintain, order-dependent, fragile | `composition-root.ts` |
| 2 | Circular dependencies resolved via setter injection (15+ `set*` calls) | Startup order is fragile; dependency graph is hidden | `composition-root.ts:193-362` |
| 3 | Per-org event serialization queue may bottleneck | Large orgs may experience event processing delays | `org.orchestrator.ts` |
| 4 | No explicit database transaction boundaries | Data consistency risk in multi-step operations | All repositories |
| 5 | Only 6 unit test files | Thin safety net for refactoring | `tests/unit/` |
| 6 | `McpToolHandlers` is a single large class with 20+ handlers | Hard to maintain and test | `mcp-tool-handlers.ts` |

### 9.2 Naming Issues (Summary)

| # | Issue | Affected Area |
|---|-------|---------------|
| 1 | `TaskNode` (internal) vs `Task` (external) naming split | Domain ↔ Contract boundary |
| 2 | "Workflow" overloaded: WorkflowSchema vs ConversationWorkflow | Task lifecycle vs Q&A |
| 3 | "Trigger" overloaded: WakeTrigger, TransitionTrigger, BehaviorTrigger | Three unrelated concepts |
| 4 | "Execution" overloaded: global control, folder name, context type | Orchestration vs single-run |
| 5 | Discussion/Conversation/Review/Approval terminology tangle | Peer review domain |
| 6 | No consistent Engine/Service/Coordinator naming convention | Application layer |
| 7 | Skill vs Tool vs Command — agent capability naming | Domain vs MCP |
| 8 | Organization vs Org vs Workspace | Container entity |
| 9 | Duplicate type hierarchies (domain types + contract record types) | Type maintenance |
| 10 | UI "Team" page vs backend "Role" entity | User-facing vs internal |

### 9.3 Type Duplication

Domain types (`core/types/*.ts`) and contract record types (`shared/contracts.ts`) are maintained in parallel with near-identical definitions. Changes must be synchronized manually, and some fields are intentionally omitted in contract types without documentation.

---

## 10. Appendix: File Structure Reference

```
apps/electron/src/main/
├── index.ts                              # Electron entry point
├── composition-root.ts                   # DI bootstrap (460 lines)
├── config/
│   ├── config.loader.ts                  # Multi-source config loading
│   ├── config.schema.ts                  # Zod validation schema
│   └── config.defaults.ts                # Default values
├── core/
│   ├── tokens.ts                         # 43 DI token symbols
│   ├── types/
│   │   ├── domain.types.ts               # Core entities (Organization, Role, TaskNode, Run, etc.)
│   │   ├── event.types.ts                # 56 DomainEventType values
│   │   ├── config.types.ts               # CapibaraConfig interface
│   │   ├── session.types.ts              # Session, SessionMessage
│   │   ├── conversation.types.ts         # ConversationWorkflow, routing, state machine
│   │   ├── workflow-schema.types.ts      # WorkflowSchema, WorkItemType, transitions
│   │   └── behavior.types.ts             # BehaviorRule (TCA model)
│   ├── interfaces/                       # 15+ I* repository/service interfaces
│   ├── constants/                        # Planning, run, etc. constants
│   └── errors/                           # Custom error classes
├── application/
│   ├── orchestrator/                     # OrgOrchestrator + WakeGateValidator + RetryScheduler + BudgetGuard
│   ├── execution/                        # RunEngine + TaskRunCoordinator
│   ├── session/                          # SessionService + SessionRunCoordinator
│   ├── planning/                         # PlanningService + PendingPlanStore
│   ├── workflow/                         # WorkflowEngine + BehaviorEngine + WorkflowTemplateService
│   ├── conversation/                     # ConversationWorkflowService + RoutingPolicyEngine + TimeoutEscalation + ContextBuilder
│   ├── discussion/                       # DiscussionService
│   ├── consensus/                        # ConsensusDetector
│   ├── tasks/                            # TaskService + DecompositionAdvisor
│   ├── state-machine/                    # TaskStateMachine
│   ├── prompt/                           # PromptBuilder + TaskPromptStrategy + SessionPromptStrategy
│   ├── context/                          # ExecutionContext + OrgContext
│   ├── notifications/                    # NotificationService + EventBroadcaster
│   ├── progress/                         # NarrativeEngine + EventDigester
│   ├── templates/                        # OrgTemplateService
│   ├── skills/                           # SkillSeeder
│   └── system/                           # SystemCheckService
├── infrastructure/
│   ├── persistence/sqlite/               # 14 repositories + migrations + ConversationEventLogger
│   ├── mcp/                              # McpIpcServer + McpToolHandlers + McpToolRegistry + McpConfigGenerator
│   ├── executors/                        # UtilityProcessExecutor + WorkerService + Worker
│   ├── adapters/                         # ClaudeLocalAdapter + AdapterRegistry
│   ├── observability/                    # PinoLogger + EmitteryEventBus + CostTracker
│   └── logging/                          # FileLogService
├── ipc-handlers/                         # 16 handler registration files
└── preload/index.ts                      # Electron IPC bridge

apps/electron/src/shared/
├── contracts.ts                          # 83 IPC channels + Zod schemas + Record types + DesktopEvent
└── locale/                               # i18n (en-US, zh-CN)

apps/electron/src/renderer/
├── main.tsx                              # React entry
├── App.tsx                               # Root component + routing
├── components/
│   ├── layout/                           # App shell, sidebar, navigation
│   ├── organization/                     # Org management, RoleDrawer
│   ├── tasks/                            # TaskTreeView, TaskDetailDrawer
│   ├── team/                             # TeamPage (displays Roles)
│   ├── discussion/                       # DiscussionPage
│   ├── conversations/                    # ConversationPage
│   ├── planning/                         # Planning UI
│   ├── execution/                        # Execution control UI
│   ├── dashboard/                        # Dashboard
│   ├── skills/                           # Skills management
│   ├── settings/                         # Settings page
│   ├── workspace/                        # WorkspacePage
│   ├── onboarding/                       # First-launch setup
│   ├── shared/                           # Common components
│   └── ui/                               # shadcn/ui primitives
├── hooks/                                # React hooks
└── store/                                # Zustand stores

apps/electron/tests/unit/                 # 6 test files
apps/electron/resources/
├── templates/                            # Organization template JSONs
├── workflows/                            # Workflow schema templates
└── roles/                                # Role template definitions
```

---

*This document captures the current state of the Capibara system as of 2026-04-17. It is intended as a baseline reference for the upcoming backend architecture refactoring.*
