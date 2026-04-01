---
version: '2.0'
project_name: 'capibara'
user_name: 'uoyo'
date: '2026-03-31'
status: 'approved'
inputDocuments:
  - _bmad-output/planning-artifacts/prd.md
  - docs/functional-analysis.md
  - _bmad-output/project-context.md
---

# Capibara Architecture Document

> **Capibara** — Company-grade AI Organization Orchestration Platform
>
> This document defines the authoritative architecture for implementation. All AI agents and human developers MUST follow these decisions.

---

## 1. System Overview

### 1.1 Architecture Vision

Capibara is an Electron desktop application that simulates a company's organizational structure. Users input requirements, and the system automatically coordinates AI roles through requirement analysis, task decomposition, execution, review, and approval — driven by an event-based wake-up loop and discussion-driven consensus.

### 1.2 Four Architecture Pillars

| # | Pillar | Description |
|---|--------|-------------|
| 1 | **Variable-Depth Task Tree** | Flexible tree with type labels (epic/story/task/subtask/spike/bug/chore), not fixed layers |
| 2 | **Discussion-Driven Consensus** | DiscussionGroup is both the communication channel and the decision mechanism |
| 3 | **Narrative Engine** | System generates human-readable status reports (DB query → template → LLM polish) |
| 4 | **Pluggable Skill System** | External prompt frameworks (BMAD, etc.) integrated via `/command` references, not content management |

### 1.3 Unified Agent Model

Every role in the organization tree is a single Agent entity. There are no separate Worker/Evaluator/Conductor/Messenger types. Behavior is determined by:

- **Persona** — Identity, expertise, communication style (user-editable)
- **Skills** — `/command` references to Claude Code installed skills (user-selectable)
- **Organization Position** — Who to report to, who to delegate to
- **Task Type** — Which skill to activate for a specific task

A single Agent can: execute tasks, decompose tasks, review others' work, vote in discussions, delegate new tasks, and escalate issues — all driven by prompt composition and MCP tool invocation.

---

## 2. Technology Stack

| Category | Technology | Version |
|----------|-----------|---------|
| Platform | Electron | 41.1.0 |
| Language | TypeScript (strict, ESM) | 5.x |
| Runtime | Node.js | >= 22 LTS |
| Build | electron-vite | 5.0.0 |
| Packaging | electron-builder | 26.8.1 |
| UI Framework | React | 19.x |
| State Management | Zustand | 5.x |
| Styling | TailwindCSS | 4.x |
| Database | SQLite (better-sqlite3) | 12.8.0 |
| Validation | Zod | 4.x |
| DI Container | tsyringe | 4.8.x |
| Event Bus | Emittery | 1.x |
| Logging | Pino | 9.x |
| Testing | Vitest (V8 coverage) | latest |
| E2E Testing | Playwright | latest |
| Package Manager | pnpm (monorepo) | latest |

---

## 3. Process Architecture

Capibara follows Electron's three-layer process model with an additional UtilityProcess layer for AI execution isolation.

```
┌─────────────────────────────────────────────────────────────┐
│                    Electron Main Process                     │
│                                                              │
│  ┌──────────┐  ┌───────────┐  ┌───────────┐  ┌───────────┐ │
│  │ Org      │  │ Consensus │  │ Narrative │  │ IPC       │ │
│  │Orchestr. │  │ Detector  │  │ Engine    │  │ Handlers  │ │
│  └────┬─────┘  └─────┬─────┘  └─────┬─────┘  └─────┬─────┘ │
│       │               │              │              │        │
│  ┌────┴───────────────┴──────────────┴──────────────┘        │
│  │              EventBus (Emittery)                           │
│  └────┬──────────────────────────────────────────────┐       │
│       │                                               │       │
│  ┌────┴─────────┐                              ┌─────┴─────┐ │
│  │ SQLite DB    │                              │ MCP Tool  │ │
│  │ (Repositories)│                              │ Handlers  │ │
│  └──────────────┘                              └─────┬─────┘ │
│                                                       │       │
└───────────────┬───────────────────────────────────────┼───────┘
                │ IPC (contextBridge)                   │ stdio
                ▼                                       ▼
┌───────────────────────┐          ┌────────────────────────────┐
│    Renderer Process   │          │     UtilityProcess(es)     │
│  ┌─────────────────┐  │          │  ┌──────────────────────┐  │
│  │ React + Zustand │  │          │  │  Claude Code CLI     │  │
│  │ + TailwindCSS   │  │          │  │  + MCP Bridge (stdio)│  │
│  └─────────────────┘  │          │  └──────────────────────┘  │
│                        │          │                            │
│  window.capibara.api   │          │  Agent invokes:            │
│  (Zod-validated RPC)   │          │  • /bmad-xxx (Skills)      │
│                        │          │  • MCP Tools (System Ops)  │
└───────────────────────┘          └────────────────────────────┘
```

### 3.1 Process Responsibilities

| Process | Responsibilities | Constraint |
|---------|-----------------|------------|
| **Main** | Business logic, SQLite, EventBus, IPC handlers, MCP tool routing | No LLM/CLI execution |
| **Preload** | ContextBridge whitelist, Zod-validated RPC, subscription relay | No business logic |
| **Renderer** | React UI, Zustand state slices, snapshot rendering | No Node.js APIs, no direct DB |
| **UtilityProcess** | Claude Code CLI execution, MCP bridge, stream processing | Isolated per Run |

### 3.2 Why UtilityProcess

Running LLM CLI tools blocks the Node.js event loop. In Main Process, this freezes IPC, rendering, and window interactions. UtilityProcess provides a separate V8 isolate with `parentPort` messaging, ensuring Main Process stays responsive.

---

## 4. Layered Architecture

```
┌────────────────────────────────────────────────┐
│                  shared/                        │  ← IPC contracts, Zod schemas, locale
├────────────────────────────────────────────────┤
│            Renderer (React UI)                  │  ← Components, hooks, Zustand stores
├────────────────────────────────────────────────┤
│              Preload (Bridge)                   │  ← contextBridge whitelist
├────────────────────────────────────────────────┤
│                                                 │
│   ┌─────────────┐     ┌──────────────────┐     │
│   │ application/ │ ──► │     core/        │     │  core = interfaces, types,
│   │ (use cases)  │     │  (contracts)     │     │         constants, errors
│   └──────┬──────┘     └────────▲─────────┘     │
│          │                      │                │
│          ╳ FORBIDDEN            │ implements     │
│          │                      │                │
│   ┌──────▼──────────────────────┴──────────┐    │
│   │          infrastructure/                │    │  = SQLite repos, MCP bridge,
│   │   (persistence, executors, mcp, etc.)   │    │    executors, event bus impl
│   └─────────────────────────────────────────┘    │
│                                                  │
│                Main Process                      │
└──────────────────────────────────────────────────┘
```

### 4.1 Layer Rules

| Layer | Can Import | CANNOT Import | Contains |
|-------|-----------|---------------|----------|
| `core/` | Nothing (leaf) | application/, infrastructure/ | Interfaces, types, constants, errors, DI tokens |
| `application/` | `core/` only | `infrastructure/` | Use cases, orchestrator, state machine, consensus, prompt builder |
| `infrastructure/` | `core/` only | `application/` | SQLite repos, MCP bridge, executors, event bus impl |
| `ipc-handlers/` | `application/`, `core/` | `infrastructure/` | Zod-validated IPC entry points |
| `shared/` | Nothing (leaf) | All main layers | IPC channel enums, Zod payload schemas, locale strings |

### 4.2 Dependency Injection

All service wiring happens in `composition-root.ts` via tsyringe:

- Every injectable class MUST have `@injectable()` decorator
- Services are NEVER instantiated with `new` outside `composition-root.ts`
- DI Tokens defined as `Symbol` in `tokens.ts` using `SCREAMING_SNAKE_CASE` + `_TOKEN` suffix
- `reflect-metadata` imported at entry point before any DI resolution

---

## 5. Data Architecture

### 5.1 Database Strategy

**MVP:** SQLite via better-sqlite3 (synchronous, WAL mode)
**Future:** PostgreSQL support via Repository Pattern swap

**Key Decision (ADR-01):** All Repository interfaces use `Promise<T>` return types — even though SQLite is synchronous internally. This enables future PostgreSQL migration without breaking the application layer.

```typescript
// core/interfaces/i-task.repository.ts
interface ITaskRepository {
  findById(id: string): Promise<TaskNode | null>;
  findByParentId(parentId: string): Promise<TaskNode[]>;
  create(task: CreateTaskInput): Promise<TaskNode>;
  updateStatus(id: string, status: TaskStatus): Promise<void>;
  // ...
}

// infrastructure/persistence/sqlite/sqlite-task.repository.ts
@injectable()
class SqliteTaskRepository implements ITaskRepository {
  async findById(id: string): Promise<TaskNode | null> {
    // better-sqlite3 is sync, wrapped in Promise.resolve()
    const row = this.db.prepare('SELECT * FROM task_nodes WHERE id = ?').get(id);
    return Promise.resolve(row ? this.mapToEntity(row) : null);
  }
}
```

**DI Switching:**
```typescript
// composition-root.ts
if (config.database.driver === 'sqlite') {
  container.register(TASK_REPO_TOKEN, { useClass: SqliteTaskRepository });
}
// future: else if (config.database.driver === 'postgres') { ... }
```

### 5.2 Data Model (Core Entities)

| Entity | Table | Purpose | Key Fields |
|--------|-------|---------|------------|
| Organization | `organizations` | Project root | id, name, description, status, budget_limit, org_template_id, workspace_path |
| Role | `roles` | Org tree node | id, org_id, name, parent_id, persona, skill_ids (JSON), can_approve, can_delegate, requires_human_approval, status |
| Skill | `skills` | Skill reference | id, name, command, description, category, source, org_template_id, custom_prompt_content (NULL for non-custom) |
| TaskNode | `task_nodes` | Variable-depth task tree | id, org_id, parent_id, type, title, description, status, assignee_role_id, depth |
| DiscussionGroup | `discussion_groups` | Epic-bound discussion | id, task_node_id (epic), org_id, status, summary, last_summary_at |
| DiscussionMessage | `discussion_messages` | Message with vote tag | id, group_id, author_role_id, author_type (ai/human), content, vote_tag (APPROVE/REVISE/CONCERN/DELEGATE/null), created_at |
| Run | `runs` | Execution instance | id, org_id, task_node_id, role_id, status, trigger, started_at, finished_at, cost_usd |
| CostEntry | `cost_entries` | Token cost tracking | id, run_id, role_id, org_id, token_count, cost_usd |
| Narrative | `narratives` | Generated status snapshot | id, org_id, template_data (JSON), rendered_text, generated_at |
| PendingWake | `pending_wakes` | Wake event queue | id, role_id, org_id, trigger, created_at |

### 5.3 Database Conventions

- Table names: plural `snake_case` (e.g., `task_nodes`, `discussion_messages`)
- Column names: `snake_case` (e.g., `assignee_role_id`, `created_at`)
- All SQL hand-written — no ORM auto-naming
- WAL mode enabled for concurrent read/write safety
- Foreign keys enforced
- Migrations via version table + `CREATE TABLE IF NOT EXISTS` pattern (SQLite)

### 5.4 Snapshot Strategy (Sparse ProfileSnapshot)

Frontend never queries the database directly. Main Process builds **sparse snapshots** at three levels:

| Level | Content | Trigger |
|-------|---------|---------|
| L1 Skeleton | Epic list with status counts only | Dashboard load |
| L2 Branch | Expanded task tree for one Epic | User clicks to expand |
| L3 Detail | Full discussion messages for one group | User opens discussion panel |

Discussion data in L1/L2 is always aggregated (e.g., `{ APPROVE: 2, REVISE: 1 }`), never full message lists.

---

## 6. Core Engine Architecture

### 6.1 Event-Driven Wake-Up Loop

The orchestration engine is fully event-driven. No polling, no hardcoded step sequences.

```
Event Source                    EventBus                  OrgOrchestrator
─────────────                  ────────                  ───────────────
MCP: task_complete ──────►  task:completed  ──────►  calculateWakeTargets()
MCP: discussion_post ────►  discussion:vote-added ─►  checkConsensus()
Run: succeeded ──────────►  run:succeeded  ────────►  processRunResult()
Run: failed ─────────────►  run:failed  ───────────►  retryOrEscalate()
Timer: timeout ──────────►  run:timed-out  ────────►  handleTimeout()
```

### 6.2 Wake-Up Flow

```
Event arrives
  │
  ▼
OrgOrchestrator.handleEvent(event)
  │
  ├── Calculate wake target role(s) based on event type
  │
  ▼
wakeRoleIfPossible(roleId, trigger)
  │
  ├── Gate checks:
  │   ├── 1. Role status === 'active'
  │   ├── 2. Budget not exceeded
  │   ├── 3. CLI connector available
  │   ├── 4. No active Run for this role
  │   └── 5. Self-wake count < MAX_CONSECUTIVE_WAKES (circuit breaker)
  │
  ├── All pass + role idle → createRun() + execute()
  ├── All pass + role busy → enqueuePendingWake() (don't lose signal)
  └── Gate fail → log reason, skip
  │
  ▼
Run completes
  │
  ├── Consume pending wakes for this role
  └── Emit next event → cycle continues
```

### 6.3 Wake Trigger Types (MVP)

| Trigger | Source | Wake Target |
|---------|--------|-------------|
| `task_assigned` | Subtask creation | Assignee role |
| `task_completed` | MCP tool call | Parent role (reviewer) |
| `review_approve` | Consensus detected | Parent task assignee (if all siblings done) |
| `review_revise` | Vote with REVISE tag | Original assignee role |
| `review_delegate` | Vote with DELEGATE tag | Delegated target role |
| `delegation_completed` | Delegated task done | Original blocked task's reviewer |
| `retry_failed` | Retry limit exhausted | Parent role (escalation) |
| `dispute_detected` | N CONCERNs + 0 APPROVEs | Parent role (intervention) |

### 6.4 Consensus State Machine

```
pending ────► in_progress ────► awaiting_review ────► approved ────► done
                  ▲                    │
                  │                    ▼
                  └──────────── revision (REVISE vote)

awaiting_review ────► blocked (DELEGATE vote, waiting for delegated task)
```

Transitions are **computed results** of DiscussionMessage votes, not direct status writes:

1. Agent completes task → calls `capibara_task_complete` (MCP) → task moves to `awaiting_review`
2. Reviewer executes → posts `capibara_discussion_post` with `voteTag=APPROVE` (MCP)
3. ConsensusDetector scans all `canApprove` role votes → unanimous APPROVE → task moves to `approved`
4. If all sibling tasks `approved`/`done` → parent role awakened for summarization

### 6.5 Circuit Breakers

| Mechanism | Threshold | Action |
|-----------|-----------|--------|
| Self-wake limit | `MAX_CONSECUTIVE_WAKES` (default 5) | Escalate to parent role |
| REVISE cycle | `maxReviseAttempts` (default 3) | Escalate to parent role |
| Run failure retry | `maxRetryOnFailure` (default 3) | Escalate to parent role |
| Top-level escalation | parentId === null | **Mandatory** human notification (regardless of requiresHumanApproval) |
| Global budget | `budgetLimit` per org | Pause all roles |

---

## 7. Agent Execution & Communication

### 7.1 Dual Action Channels

AI Agents running in Claude Code have two categories of actions:

| Channel | Mechanism | Examples |
|---------|-----------|---------|
| **Prompt Framework Skills** | `/command` instructions in Claude Code | `/bmad-create-architecture`, `/bmad-dev-story`, `/bmad-code-review` |
| **System Operations** | MCP Tools (auto-discovered by Claude Code) | `capibara_task_complete`, `capibara_task_create_subtask`, `capibara_discussion_post` |

**Key Distinction:**
- `/bmad-xxx` skills are managed by the prompt framework (BMAD). Capibara only stores `command` + `description` as references. BMAD autonomously retrieves knowledge, artifacts, and project files.
- MCP Tools are Capibara system operations. They allow the Agent to interact with the orchestration engine in real-time during execution.

### 7.2 MCP Server Bridge (ADR-04)

**Transport:** stdio (not SSE/HTTP)

```
Run Created
  │
  ├── 1. McpConfigGenerator creates temp config file:
  │     {
  │       "mcpServers": {
  │         "capibara": {
  │           "command": "node",
  │           "args": ["capibara-mcp-bridge.js", "--run-id=<id>", "--token=<jwt>"]
  │         }
  │       }
  │     }
  │
  ├── 2. UtilityProcess spawns Claude Code CLI with MCP config
  │     claude --mcp-config /tmp/capibara-mcp-<runId>.json ...
  │
  ├── 3. Claude Code auto-discovers capibara MCP tools
  │
  ├── 4. Agent calls MCP tools as needed during execution
  │     (real-time, not post-execution)
  │
  └── 5. Run ends → MCP bridge terminates → temp config cleaned up
```

**Workspace:** McpConfigGenerator resolves `workspace_path` from the Run's associated organization (via orgId). The CLI execution working directory is set to the organization's `workspace_path`.

**Security:** Every MCP tool call validates `runId` + JWT token. Only the active Run can invoke tools.

### 7.3 MCP Tools (MVP)

| Tool | Input Schema | Description |
|------|-------------|-------------|
| `capibara_task_complete` | `{ taskId, summary, artifactPaths? }` | Mark task completed with deliverables |
| `capibara_task_create_subtask` | `{ parentTaskId, title, description, type, assigneeRoleId }` | Create and assign a subtask |
| `capibara_discussion_post` | `{ discussionGroupId, content, voteTag? }` | Post message/vote to discussion group |
| `capibara_context_get_task` | `{ taskId }` | Query task details, status, artifacts |
| `capibara_context_get_org_tree` | `{ orgId }` | Query organization tree with role statuses |
| `capibara_context_get_discussion_summary` | `{ discussionGroupId }` | Get discussion summary + vote stats |
| `capibara_escalate` | `{ taskId, reason }` | Escalate task to parent role |

### 7.4 Prompt Construction (ADR-02)

PromptBuilder is a lightweight service. It does NOT inject knowledge base content or upstream artifacts — those are handled autonomously by the prompt framework (BMAD).

**What Capibara constructs:**

```markdown
[System Prompt]
You are {role.name}. {role.persona}

## Organization Context
- Your superior: {parentRole.name} ({parentRole.persona summary})
- Your subordinates: {subordinates list}
- Your peers: {peer roles list}

## Current Task
- Task: {task.title}
- Type: {task.type}
- Description: {task.description}
- Status: {task.status}

## Available Skills (invoke via / command)
{role.skills.map(s => `- ${s.command}: ${s.description}`)}

## System Tools (available as MCP tools)
- capibara_task_complete: Mark your task as completed
- capibara_task_create_subtask: Decompose work to subordinates
- capibara_discussion_post: Post to discussion group / vote
- capibara_escalate: Escalate to your superior

## Discussion Context (if any)
{discussionSummary: last 3 messages + vote statistics}

## Instructions
Complete your task, then use capibara_task_complete to submit results.
If you need to decompose work, use capibara_task_create_subtask.
For review tasks, use capibara_discussion_post with the appropriate voteTag.
```

### 7.5 UtilityProcess Executor

All LLM/CLI execution runs in Electron's UtilityProcess:

- Inherits from reference project's WorkerService pattern
- CLI process working directory (`cwd`) is set to the organization's `workspace_path`
- Communicates with Main Process via `parentPort` messaging
- Stream processing: stdout/stderr via StringDecoder with chunked splitting
- GBK encoding fallback for CJK environments
- Full output logged and stored per Run

---

## 8. Skill System (ADR-05, ADR-06)

### 8.1 Skill Model: Command Reference

Capibara does NOT manage the actual prompt content of framework skills. The `skills` table stores only references:

| Field | Type | Description |
|-------|------|-------------|
| `id` | TEXT PK | Unique identifier |
| `name` | TEXT | Human-readable name |
| `command` | TEXT | Trigger command (e.g., `/bmad-create-architecture`) |
| `description` | TEXT | What the skill does (injected into agent prompt) |
| `category` | TEXT | `analysis` / `design` / `implementation` / `review` / `test` / `general` |
| `source` | TEXT | `builtin` / `template` / `custom` |
| `org_template_id` | TEXT NULL | Which org template installed this |
| `custom_prompt_content` | TEXT NULL | Only for `source='custom'` — actual prompt text |

### 8.2 Skill Sources

| Source | Content Storage | Invocation Method |
|--------|----------------|-------------------|
| `builtin` | Command + description only | Agent uses `/command` in Claude Code |
| `template` | Command + description, installed with org template | Agent uses `/command` in Claude Code |
| `custom` | Full prompt text in `custom_prompt_content` | PromptBuilder injects content into agent prompt directly |

### 8.3 Skill Selection

SkillSelector maps task type → skill category → role's available skills:

```
Task type 'epic'     → category 'analysis'       → /bmad-analyst or /bmad-pm
Task type 'story'    → category 'design'          → /bmad-create-story
Task type 'task'     → category 'implementation'  → /bmad-dev-story
Task type 'bug'      → category 'implementation'  → /bmad-dev-story (with fix context)
Review action        → category 'review'          → /bmad-code-review
```

### 8.4 Framework Extensibility

Adding a new prompt framework (e.g., "FrameworkX"):
1. User installs FrameworkX as a Claude Code skill/extension
2. User adds skill entries (command + description) via org template or UI
3. Roles reference these skills via `skillIds`
4. PromptBuilder lists them in agent prompt → Agent invokes via `/frameworkx-xxx`
5. **Zero business code change** — OrgOrchestrator, ConsensusDetector, etc. are unaffected

### 8.5 Skill Provider Interfaces (Future Advanced Use)

For scenarios where Capibara itself needs to manage prompt construction:

```typescript
// L1: Simple prompt generation
interface IPromptProvider {
  buildPrompt(context: SkillContext): string;
}

// L2: Multi-step with validation
interface ISkillProvider extends IPromptProvider {
  execute(context: SkillContext): Promise<SkillResult>;
  validate?(output: string): ValidationResult;
}

// L3: Full workflow orchestration
interface IWorkflowProvider extends ISkillProvider {
  getWorkflowDefinition(): WorkflowDefinition;
  executeStep(stepId: string, context: SkillContext): Promise<StepResult>;
  getNextStep(currentStep: string, result: StepResult): string | null;
}
```

These interfaces are available for `custom` source skills and future advanced scenarios, but are NOT the primary integration path for framework-class providers like BMAD.

---

## 9. Discussion System (ADR-03)

### 9.1 MVP: Structured Approval Container

DiscussionGroup serves as the structured record of all approval actions within an Epic. It is NOT a free-form chat system in MVP.

### 9.2 Lifecycle

```
Epic created
  → DiscussionGroup auto-created (bound to epic task_node_id)
  → Auto-members: epic assignee + direct subordinates

Task assigned within Epic
  → Assignee auto-joins discussion group

Agent completes task
  → Posts completion message (via MCP tool)

Reviewer votes
  → Posts message with voteTag (via MCP tool)
  → ConsensusDetector evaluates

All voting complete + Epic done
  → DiscussionGroup archived
```

### 9.3 Discussion Summary for Prompt Injection

When a role is awakened, it receives a **rule-based extract** (not LLM summary) of the discussion:
- Last 3 messages with content
- Vote statistics: `{ APPROVE: N, REVISE: N, CONCERN: N, DELEGATE: N }`
- Latest REVISE feedback (if task is in revision state)

### 9.4 V2 Forward Compatibility

Data model already supports:
- `voteTag=null` free-form messages
- `authorType` field (`ai`/`human`)
- No schema migration needed for V2 multi-round discussion expansion

---

## 10. IPC & Communication Patterns

### 10.1 IPC Protocol

All Renderer ↔ Main communication uses `DesktopResult<T>`:

```typescript
type DesktopResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: { code: string; message: string } };
```

### 10.2 IPC Channel Naming

Format: `namespace:entity:action` (all lowercase)

Examples:
- `capibara:task:expand-branch`
- `capibara:narrative:updated`
- `capibara:org:snapshot`
- `capibara:discussion:vote-added`

Defined in `shared/contracts.ts` as string enums with Zod payload schemas.

### 10.3 Event Digester (IPC Batching)

High-frequency events are aggregated before reaching the Renderer:

- Time window: 200-500ms (configurable)
- Events merged by Epic scope
- Delta patches instead of full-tree serialization
- Prevents notification storms during rapid parallel execution

### 10.4 Frontend State Management

- Zustand for snapshot-based state slices
- No Redux-Saga/Thunk — all remote actions via `window.capibara.api`
- IPC Batcher coalesces rapid domain-changed events before triggering Zustand updates
- Pure slice-based state operations

### 10.5 Internal Event Bus

Main Process uses Emittery with typed events:

Format: `entity:lifecycle` (e.g., `task:completed`, `discussion:vote-added`, `run:succeeded`)

Most side effects (narrative generation, wake calculations, cost tracking) are triggered via event subscriptions.

---

## 11. Project Structure

```text
capibara/
├── src/
│   ├── main/                           # Main Process (Node.js / Electron)
│   │   ├── core/                       # Layer 1: Contracts (NO runtime state)
│   │   │   ├── constants/              # vote-tag.constants.ts, run.constants.ts
│   │   │   ├── errors/                 # organization.error.ts, task.error.ts
│   │   │   ├── interfaces/            # All I-prefixed interfaces
│   │   │   │   ├── i-organization.repository.ts
│   │   │   │   ├── i-task.repository.ts
│   │   │   │   ├── i-discussion.repository.ts
│   │   │   │   ├── i-run.repository.ts
│   │   │   │   ├── i-skill.repository.ts
│   │   │   │   ├── i-prompt-builder.ts
│   │   │   │   ├── i-mcp-tool-handler.ts
│   │   │   │   ├── i-event-bus.ts
│   │   │   │   └── i-executor.ts
│   │   │   ├── types/                  # All shared type definitions
│   │   │   └── tokens.ts              # DI tokens (SCREAMING_SNAKE_CASE_TOKEN)
│   │   │
│   │   ├── application/                # Layer 2: Business Logic
│   │   │   ├── orchestrator/           # org.orchestrator.ts (core event loop)
│   │   │   ├── state-machine/          # task.state-machine.ts
│   │   │   ├── consensus/             # consensus.detector.ts
│   │   │   ├── skills/                 # skill.selector.ts, prompt-builder.ts
│   │   │   ├── context/               # org.context.ts, execution.context.ts
│   │   │   └── progress/              # narrative.engine.ts, event.digester.ts
│   │   │
│   │   ├── infrastructure/             # Layer 3: Implementations
│   │   │   ├── persistence/
│   │   │   │   └── sqlite/
│   │   │   │       ├── sqlite-connection.ts
│   │   │   │       ├── sqlite-organization.repository.ts
│   │   │   │       ├── sqlite-task.repository.ts
│   │   │   │       ├── sqlite-discussion.repository.ts
│   │   │   │       ├── sqlite-run.repository.ts
│   │   │   │       ├── sqlite-skill.repository.ts
│   │   │   │       └── migrations/
│   │   │   ├── mcp/                    # MCP Server Bridge
│   │   │   │   ├── capibara-mcp-bridge.ts
│   │   │   │   ├── mcp-tool-registry.ts
│   │   │   │   ├── mcp-tool-handlers.ts
│   │   │   │   └── mcp-config-generator.ts
│   │   │   ├── executors/              # UtilityProcess executor, adapter factory
│   │   │   └── observability/          # emittery-event-bus.ts, cost-tracker.ts
│   │   │
│   │   ├── ipc-handlers/               # IPC Boundary (Zod-validated)
│   │   ├── composition-root.ts         # tsyringe DI registry
│   │   └── index.ts                    # Main process entry
│   │
│   ├── preload/
│   │   └── index.ts                    # contextBridge whitelist + subscription relay
│   │
│   ├── renderer/
│   │   ├── components/
│   │   │   ├── dashboard/              # Narrative display, metrics
│   │   │   ├── organization/           # Role tree visualization
│   │   │   ├── execution/             # Run queue, approval UI
│   │   │   └── discussion/            # Discussion group panel
│   │   ├── hooks/                      # useCapibaraSnapshot.ts, etc.
│   │   ├── store/                      # Zustand slices (.slice.ts)
│   │   └── App.tsx
│   │
│   └── shared/                         # Cross-process shared (Main + Renderer)
│       ├── contracts.ts                # IPC channel enums + Zod payload schemas
│       └── locale.ts                   # Shared locale strings
│
├── packages/                           # Monorepo adapter packages
│   ├── adapter-claude-local/
│   ├── adapter-codex-local/
│   └── adapter-utils/
│
├── tests/                              # Mirror of src/ structure
│   ├── unit/
│   └── e2e/
│
├── electron.vite.config.ts
├── vitest.config.ts
└── package.json                        # pnpm workspaces
```

---

## 12. Implementation Rules

### 12.1 Critical Rules (MUST Follow)

| # | Rule | Violation Consequence |
|---|------|-----------------------|
| 1 | **All imports use `.js` extension** (even for `.ts` files) | Runtime `ERR_MODULE_NOT_FOUND` |
| 2 | **Never import `infrastructure/` from `application/`** | Breaks dependency inversion |
| 3 | **Every DI-registered class has `@injectable()`** | Cryptic tsyringe resolution errors |
| 4 | **Never `new` services outside `composition-root.ts`** | State divergence, unmockable |
| 5 | **All IPC payloads Zod-validated** | Renderer can crash Main with bad data |
| 6 | **No business logic in `src/main/index.ts`** | Entry point delegates to services only |
| 7 | **No runtime state in `core/`** | Core is contracts only |
| 8 | **All Repository methods return `Promise<T>`** | Breaks future PostgreSQL migration |

### 12.2 Naming Conventions

| Element | Convention | Example |
|---------|-----------|---------|
| Files | `kebab-case.ts` | `org.orchestrator.ts`, `sqlite-task.repository.ts` |
| Classes | `PascalCase` | `OrgOrchestrator`, `SqliteTaskRepository` |
| Interfaces | `I`-prefix `PascalCase` | `ITaskRepository`, `IPromptBuilder` |
| DI Tokens | `SCREAMING_SNAKE_CASE_TOKEN` | `TASK_REPO_TOKEN`, `EVENT_BUS_TOKEN` |
| DB tables | plural `snake_case` | `task_nodes`, `discussion_messages` |
| DB columns | `snake_case` | `assignee_role_id`, `created_at` |
| IPC channels | `namespace:entity:action` | `capibara:task:completed` |
| Events | `entity:lifecycle` | `task:completed`, `run:failed` |

### 12.3 Forbidden Patterns

- **No barrel exports** (`index.ts` re-exports) — import directly from specific files
- **No default exports** — named exports throughout
- **No ORM** — all SQL hand-written
- **No Redux-Saga/Thunk** in Renderer — Zustand + IPC only
- **No `contextBridge` write-back capabilities** — Renderer cannot mutate Main state directly
- **No inline type definitions in implementation files** — types go in `core/types/`

### 12.4 Code Quality

- Prettier: 100 char width (markdown/JSON: 120), single quotes, trailing commas, 2-space indent, LF
- No ESLint configured — Prettier only
- Minimal comments — code should be self-documenting
- Test files: `tests/unit/{feature}.test.ts` mirroring `src/` structure
- Vitest with V8 coverage provider

---

## 13. Configuration

### 13.1 Config Hierarchy

```
Default values (config.defaults.ts)
  ← Global config (~/.capibara/config.yaml)
    ← Project config (<projectDir>/capibara.config.yaml)
```

Loaded via `config.loader.ts`, validated with Zod schemas in `config.schema.ts`, accessed through DI token. Config is **immutable after load**.

### 13.2 Key Configuration Fields

```yaml
organization:
  template: software-team              # Preset template name
  customFile: null                     # Custom org YAML path (overrides template)

execution:
  maxReviseAttempts: 3                 # REVISE cycle limit per task
  maxRetryOnFailure: 3                 # Run failure retry limit
  maxConsecutiveWakes: 5               # Self-wake circuit breaker
  budgetLimit: 50.0                    # Project budget cap (USD)

skills:
  provider: bmad                       # Primary skill framework
  bmadRoot: ./_bmad                    # BMAD installation directory

database:
  driver: sqlite                       # sqlite | postgres (future)
  sqlitePath: ~/.capibara/capibara.sqlite

cli:
  defaultExecutor: claude-cli
  # projectDir removed — workspace path is now per-organization, stored in organizations.workspace_path

logging:
  level: info
```

---

## 14. Security

| Concern | Measure |
|---------|---------|
| Process isolation | Renderer has no `nodeIntegration`, strict `contextIsolation` |
| IPC validation | All payloads Zod-validated at entry point |
| MCP authentication | JWT token + runId per-tool-call validation |
| MCP network | stdio transport only, no network ports exposed |
| API tokens | SecretVault with encrypted `vault.key` |
| Data access | Organization-scoped queries (orgId filtering) |
| Preload safety | contextBridge whitelist — no write-back to Main state |

---

## 15. Architecture Decision Record Index

| ADR | Decision | Rationale |
|-----|----------|-----------|
| ADR-01 | Repository Pattern with async `Promise<T>` interfaces | Future PostgreSQL migration without application layer changes |
| ADR-02 | Lightweight prompt construction — no artifact/knowledge injection | BMAD autonomously retrieves context; reduces token budget complexity |
| ADR-03 | Discussion Group as MVP approval container, V2 full communication | Simplifies MVP while preserving forward-compatible data model |
| ADR-04 | MCP Server (stdio) for Agent ↔ Capibara system operations | Native Claude Code integration, typed schemas, real-time tool calls |
| ADR-05 | Skill model stores command + description, not content | BMAD manages its own prompts; Capibara only needs references |
| ADR-06 | Framework extensibility via Skill Registration model | Zero business code change when adding new prompt frameworks |
