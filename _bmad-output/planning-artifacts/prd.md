---
document_type: 'product-requirements'
project_name: 'capibara'
version: '2.0'
date: '2026-03-27'
status: 'draft'
authors: ['uoyo', 'AI Facilitator']
sources:
  - 'docs/project background.md'
  - 'docs/functional-analysis.md'
  - '_bmad-output/brainstorming/brainstorming-session-2026-03-27-1200.md'
  - 'Refer Project Introduce.md (AgentCompany reference)'
---

# Capibara Product Requirements Document

> **Capibara** — Company-grade AI Organization Orchestration Platform

---

## 1. Product Vision

### 1.1 Problem Statement

Modern AI Agents can complete most code development work, but it is difficult to fully automate a development process. From "requirements analysis -> design -> coding -> testing", although AI Agents can do most of the work, humans need to continuously interact with AI to drive the process forward.

### 1.2 Solution

Capibara is a **company-grade organization architecture AI assistant** that simulates a real company's organizational structure. Users input requirements, and the system automatically completes the entire closed loop of requirement analysis, task decomposition, assignment, execution, review, and approval through coordinated AI roles.

### 1.3 Core Value Proposition

- **Organizational Simulation**: AI roles form a hierarchical tree (CTO -> Manager -> Developer), each with distinct persona, knowledge, and skills
- **Discussion-Driven Decision Making**: Roles collaborate through Epic-based discussion groups, forming consensus through structured voting rather than isolated approval chains
- **Narrative Status**: System generates human-readable narrative reports instead of cold task tables
- **Pluggable Skills**: Three-layer skill provider interface enables ecosystem extensibility beyond any single prompt framework
- **Flexible Human Intervention**: Per-role configurable human approval, not global mode switches

### 1.4 Target Users

- Software developers and tech leads who want to automate multi-step development workflows
- Teams exploring AI-assisted software development with human oversight at configurable control points
- Power users who want to create custom AI organization structures for domain-specific workflows

### 1.5 Reference Project

**AgentCompany** — An Electron desktop application that creates autonomously running AI companies. Capibara adopts its three-layer process architecture (Main/Preload/Renderer), ServiceGraph pattern, Snapshot refresh model, and UtilityProcess worker isolation, while introducing original concepts: discussion-driven consensus, variable-depth task trees, and narrative engine.

---

## 2. System Architecture Overview

### 2.1 Platform

- **Primary UI**: Electron desktop application (Main/Preload/Renderer three-layer process model)
- **Monorepo**: pnpm workspace with adapter packages

### 2.2 Unified Agent Model

Capibara replaces the traditional fixed-role pipeline (Worker/Evaluator/Conductor/Messenger/Trigger) with a **unified Agent model**:

Every role in the organization tree is a single Agent entity. Its behavior is determined by:

| Factor | Determines |
|--------|-----------|
| **Persona** (user-defined) | Identity, expertise, communication style |
| **Knowledge Base** (user-configured) | Reference documents, standards, context |
| **Skills** (user-selected) | Execution capabilities, prompt instructions |
| **Organization Position** | Who to report to, who to review, who to delegate to |
| **Task Type** | Which skill to activate for this specific task |

A single Agent can: execute tasks, decompose tasks, review others' work, vote in discussions, delegate new tasks, and escalate issues — all driven by prompt composition, not by separate system role types.

### 2.3 Four Architecture Pillars

1. **Variable-Depth Task Tree + Type Labels** — Flexible replacement for fixed four-layer hierarchy
2. **Discussion-Driven Decision Making** — Communication IS the decision process
3. **Narrative Engine** — System actively tells the story
4. **Pluggable Three-Layer Skill Adapter** — From tool to platform

---

## 3. Functional Requirements

### FR-01: Organization Modeling

**Priority: MVP**

The system shall support dynamic organization tree modeling:

- **Role Tree**: Unlimited nesting depth via `parentId` recursion
- **Role Three-Element Model**: Each role defined by:
  - `persona` — Role definition text (user-editable, becomes part of system prompt)
  - `knowledgeBaseRefs` — References to knowledge documents (user-configurable)
  - `skillIds` — Selected skills from skill library (user-selectable from builtin/template/custom)
- **Role Permissions**: `canApprove`, `canDelegate`, `requiresHumanApproval` per role
- **Role Status**: `active` / `paused` / `idle`
- **Preset Organization Templates**: e.g., "BMAD Software Team" with pre-filled roles, personas, knowledge, and skills
- **Custom Organization**: Users can create roles from scratch via Electron UI
- **AI-Assisted Organization Creation**: System-level AI assistant helps new users design organization structures through conversational guidance

### FR-02: Task System

**Priority: MVP**

The system shall support a variable-depth task tree:

- **Task Node Types**: `epic` / `story` / `task` / `subtask` / `spike` / `bug` / `chore` (type labels, not fixed layers)
- **Variable Depth**: Tree depth is free; "Epic -> Task" and "Epic -> Story -> Task -> Subtask" are both valid
- **Task State Machine**: `pending` -> `in_progress` -> `awaiting_review` -> `revision` -> `approved` -> `done` + `blocked` / `cancelled`
- **AI Auto-Creation**: AI roles create and assign sub-tasks via Agent API
- **Auto Status Propagation**: When all sibling tasks complete, parent role is automatically awakened for review/summarization
- **Task Assignment**: Each TaskNode has an `assigneeRoleId` binding to one organization role
- **Artifact Storage**: Each task's output artifacts are stored and referenced by downstream tasks

### FR-03: Smart Decomposition Advisor

**Priority: MVP**

The system shall provide intelligent task decomposition guidance:

- **Complexity Assessment**: Evaluate task complexity based on description keywords, estimated module count, dependency relationships
- **Depth Recommendation**: Suggest decomposition depth (1-4 levels) based on complexity score
- **Over-Decomposition Prevention**: Warn when AI attempts to decompose low-complexity tasks
- **Under-Decomposition Detection**: Suggest further decomposition for high-complexity tasks assigned to leaf roles

### FR-04: Discussion-Driven Decision Making

**Priority: MVP**

The system shall support Epic-based discussion groups as the primary collaboration and decision mechanism:

- **Auto-Creation**: When a TaskNode with `type=epic` is created, a DiscussionGroup is automatically created and bound to it
- **Auto-Membership**: Epic assignee + direct subordinates auto-join; roles are added when assigned tasks within the Epic
- **Structured Vote Tags**: Messages carry a `voteTag` field (structured data, not text parsing):
  - `APPROVE` — Approve the deliverable or proposal
  - `REVISE` — Request changes (message content contains revision requirements)
  - `CONCERN` — Raise an issue or disagreement (non-blocking, requires response)
  - `DELEGATE` — Request creation of a new task for another role (message content contains task description)
  - `null` — Regular discussion message
- **Consensus-as-Approval**: When all roles with `canApprove=true` in a discussion group have voted `APPROVE`, the associated task is automatically marked as approved. No separate approval step needed.
- **Dispute Detection**: When N CONCERN votes accumulate with 0 APPROVE votes over M rounds, the parent role is automatically awakened to intervene
- **Discussion Auto-Summary**: System auto-generates/updates discussion summaries. When a role is awakened, its prompt receives the summary + last 3 messages, not the full history
- **Human Participation**: Human users can send messages and vote in any discussion group with equal authority to AI roles
- **Discussion Group Lifecycle**: Active while Epic is in progress; archived when Epic reaches `done` status

### FR-05: Consensus Detection & Vote Processing

**Priority: MVP**

The system shall implement hardcoded consensus detection logic:

- `APPROVE` processing: Track all `canApprove` role votes; auto-approve when unanimous
- `REVISE` processing: Set task status to `revision`, awaken assignee with revision feedback
- `REVISE` cycle protection: Track REVISE count per task; escalate to parent role after `maxReviseAttempts` (default 3)
- `CONCERN` processing: Non-blocking; accumulate for dispute detection
- `DELEGATE` processing: Create new TaskNode, set original task to `blocked`, awaken target role
- MVP: Rules hardcoded in ConsensusDetector and OrgOrchestrator services
- V2: Abstract into declarative rules engine

### FR-06: Execution Engine

**Priority: MVP**

The system shall execute AI role tasks through an isolated worker process:

- **Run Concept**: Each role execution creates a Run instance with full lifecycle (queued/running/succeeded/failed/cancelled/interrupted)
- **Pre-Execution Gate Checks**: Role status, budget, connector readiness
- **Prompt Construction**: Role's three elements (persona + knowledge + skills) + system-injected context (org relationships, task description, discussion summary, available actions)
- **UtilityProcess Isolation**: Worker runs in Electron UtilityProcess to avoid blocking Main process
- **Workspace Binding**: Code-type tasks bind to project directory
- **Execution Logging**: Full output recording per Run
- **Serial Execution**: MVP — one active Run per role at a time

### FR-07: Wake-Up Loop

**Priority: MVP**

The system shall implement an event-driven wake-up cycle:

- **Wake Triggers**: task_assigned, task_completed, review_approve, review_revise, review_delegate, delegation_completed, retry_failed, dispute_detected
- **Gate Checks**: Role status (active), budget not exceeded, no active Run
- **Pending Wake Queue**: If role is busy when wake event arrives, queue it (don't lose the signal)
- **Self-Wake Circuit Breaker**: MAX_CONSECUTIVE_WAKES limit to prevent infinite loops; escalate on breach
- **Wake Target Calculation**: Based on event type, determine which role(s) to wake

### FR-08: Human Intervention (Per-Role)

**Priority: MVP**

The system shall support per-role configurable human intervention:

- **Per-Role Configuration**: Each role with subordinates can set `requiresHumanApproval: true/false`
- **No Global Mode**: The global "semi-auto / full-auto" mode is replaced by per-role configuration. UI provides quick presets ("all auto", "top-level human only", "custom")
- **Human Approval UI**: When flow reaches a role with `requiresHumanApproval=true`:
  - Electron desktop notification
  - Approval panel showing: narrative approval summary, task tree overview, discussion key decisions summary, deliverable links
  - Action buttons: [APPROVE] / [REVISE] (with feedback input) / [DELEGATE]
- **Human votes injected as discussion messages** with the same authority as AI votes
- **Mandatory Human Notification**: When escalation reaches top-level role (parentId=null) and still fails, always notify human regardless of `requiresHumanApproval` setting

### FR-09: Narrative Engine

**Priority: MVP**

The system shall generate narrative-driven status reports:

- **Three-Layer Architecture**:
  1. Data Query Layer: Deterministic DB queries for task states, discussion summaries, role activities, budget usage
  2. Template Layer: Markdown templates with placeholders for structured data
  3. LLM Polish Layer: Single LLM call to convert structured template into natural language narrative
- **No Hallucination Risk**: Facts come from DB queries; LLM only responsible for natural language styling
- **Dashboard Narrative**: Auto-generated project progress narrative on Dashboard
- **Approval Summary**: Specialized narrative template for human approval context (concise, decision-focused)
- **Auto-Refresh**: Regenerated when significant state changes occur

### FR-10: Event Digester

**Priority: MVP**

The system shall aggregate rapid state changes before notification:

- **Time Window Aggregation**: Collect events within configurable window (default 30 seconds)
- **Event Merge Strategy**: Group by Epic, summarize state transitions
- **Summary Generation**: Produce single aggregated notification instead of multiple individual ones
- **Throttling**: Prevent notification storms during rapid parallel execution

### FR-11: Pluggable Skill System

**Priority: MVP**

The system shall support a three-layer skill provider interface:

- **L1 IPromptProvider**: Simplest — input task context, output system prompt string. Custom prompt templates implement this.
- **L2 ISkillProvider extends L1**: Multi-step execution, intermediate artifacts, output validation rules
- **L3 IWorkflowProvider extends L2**: Full workflow orchestration, conditional branches, loops. BMAD implements this level.
- **Skill Sources**:
  - `builtin` — System-provided skills (task decomposition, code review, security audit, test generation, API design)
  - `template` — Installed with organization templates (e.g., BMAD Method 40+ skills)
  - `custom` — User-uploaded prompt files or directly entered content
- **Skill Library UI**: Browse, search, and select skills from all three sources when configuring roles
- **Zero Business Code Change**: Switching skill providers requires no modification to orchestration, discussion, or task system code

### FR-12: Resilience

**Priority: MVP**

- **Failure Retry**: Configurable `maxRetryOnFailure` (default 3) per Run
- **Escalation Chain**: On retry exhaustion, escalate to parent role along org tree
- **Top-Level Safety Valve**: When escalation reaches top (parentId=null) and still fails, mandatory human notification
- **Global Budget Protection**: Project-level budget limit; all roles paused when exceeded
- **REVISE Cycle Protection**: `maxReviseAttempts` (default 3); escalate after limit

### FR-13: Observability

**Priority: MVP**

- **Execution Log Storage**: Full output per Run, queryable by task/role
- **Cost Tracking**: Per-run, per-role, and global budget tracking with UI display
- **Organization Tree Visualization**: Interactive tree in Electron UI showing role status, active tasks
- **Task Tree Visualization**: Hierarchical task view with status indicators and progress
- **Discussion Group Panel**: Real-time message flow with vote tag highlighting
- **Activity Timeline**: Recent events and state changes
- **Dashboard**: Narrative status + metrics + active work + alerts

---

## 4. Non-Functional Requirements

### NFR-01: Cost Control

- Global project budget limit with automatic pause on exceed
- Per-role budget tracking (V2: per-role limits)
- Discussion group token budgets (implicit via discussion summary compression)
- Decomposition depth limits to prevent over-splitting

### NFR-02: Security

- Electron three-layer process isolation (contextIsolation, no nodeIntegration)
- Zod validation on all IPC payloads
- Organization-scoped data access control
- Agent API: JWT run token + run ID double verification, 127.0.0.1 only
- SecretVault with encrypted vault.key for API tokens

### NFR-03: Extensibility

- Pluggable Skill Providers (L1/L2/L3 interface)
- Pluggable Command Executors (Claude CLI, future: Codex, Gemini)
- Replaceable organization templates
- Monorepo adapter packages

### NFR-04: Performance

- Event digestion with time-window aggregation
- Discussion auto-summary to control prompt token size
- IPC batching (domain-changed coalescing) for efficient UI refresh
- Snapshot-based data access pattern

### NFR-05: Data Integrity

- SQLite WAL mode with foreign keys
- Deterministic narrative generation (template + LLM polish)
- Structured vote tags as data fields (not text parsing)

---

## 5. User Stories

### 5.1 Project & Organization Setup

**US-01: Template-Based Project Creation**
As a new user, I want to select the BMAD Method template to quickly create a project, so that I can start using the system without configuring from scratch.

**US-02: AI-Assisted Custom Organization**
As a user unfamiliar with org design, I want to describe my project to an AI assistant and receive organization structure recommendations, so that I get a suitable team structure.

**US-03: Manual Role Creation with Three Elements**
As an experienced user, I want to manually create roles and precisely configure persona, knowledge base, and skills, so that roles match my exact workflow.

### 5.2 Task Decomposition & Execution

**US-04: Simple Requirement Auto-Decomposition**
As a user, I want to input a simple requirement and have the system automatically decompose and execute it end-to-end.

**US-05: Complex Multi-Layer Decomposition**
As a user, I want to input a complex requirement and have it decomposed into multiple Story and Task levels by different organizational roles.

**US-06: Decomposition Advisor Intervention**
As the system, I want to prevent over-decomposition of simple tasks and suggest further decomposition of complex ones.

### 5.3 Discussion & Collaboration

**US-07: Auto Discussion Group Creation & Membership**
As the system, I want to auto-create discussion groups for Epics and manage membership as roles are assigned tasks.

**US-08: Dispute Detection & Superior Intervention**
As a parent role, I want to be automatically awakened when subordinate roles have unresolved disputes, so I can make a final decision.

**US-09: Discussion Auto-Summary for Context Injection**
As a newly-joined role, I want to receive a discussion summary instead of full message history, so I can quickly understand context.

### 5.4 Approval & Consensus

**US-10: Automatic Consensus Approval**
As the system, I want to auto-approve tasks when all canApprove roles have voted APPROVE, with no separate approval step.

**US-11: Per-Role Human Approval**
As a human user, I want to receive approval notifications for roles configured with requiresHumanApproval, with a rich approval summary UI.

**US-12: DELEGATE Cross-Role Collaboration**
As a reviewer role, I want to delegate new tasks to other roles when I discover additional work is needed during review.

### 5.5 Execution & Failure Handling

**US-13: Normal Task Execution**
As an AI role, I want to be awakened, receive a constructed prompt, execute via UtilityProcess, and report results through the discussion group.

**US-14: Failure Retry & Escalation**
As the system, I want to auto-retry failed runs and escalate to parent roles when retry limit is reached.

**US-15: Top-Level Mandatory Human Notification**
As the system, I want to force-notify the human user when the top-level role fails, regardless of requiresHumanApproval settings.

### 5.6 Observability & Narrative

**US-16: Narrative Dashboard**
As a user, I want to see a narrative-form project status on the Dashboard that I can understand in 30 seconds.

**US-17: Real-Time Discussion Message Flow**
As a user, I want to see discussion group messages in real-time in the Electron UI, including vote tag highlighting.

### 5.7 Skill Management

**US-18: Select Built-in Skills for Roles**
As a user, I want to browse and select system built-in skills for my roles.

**US-19: Use BMAD Preset Skills**
As a user using BMAD template, I want roles pre-configured with BMAD skills that I can adjust.

**US-20: Upload Custom Skills**
As an advanced user, I want to upload my own prompt templates as custom skills.

### 5.8 Event & Notification

**US-21: Event Digester Batch Notification**
As a user, I want rapid state changes merged into single summary notifications.

### 5.9 Edge Cases & Safety

**US-22: Budget Exceeded Auto-Pause**
As the system, I want to pause all execution when project budget is exceeded.

**US-23: Manual Role Pause & Resume**
As a user, I want to manually pause/resume individual roles.

**US-24: REVISE Cycle Circuit Breaker**
As the system, I want to escalate when the same task is revised more than 3 times.

**US-25: Human Direct Participation in Discussions**
As a human user, I want to send messages and vote in any discussion group with equal authority to AI roles.

---

## 6. Key Design Decisions

| ID | Decision | Choice | Rationale |
|----|----------|--------|-----------|
| D-ARCH-1 | Agent model | Unified Agent (no separate Worker/Evaluator/Conductor/Messenger) | Each org role is a single entity; behavior driven by persona + skills + org position + task type |
| D-ARCH-2 | Task hierarchy | Variable-depth tree with type labels | Decouples tree depth from task semantics; more flexible than fixed four layers |
| D-ARCH-3 | Decision mechanism | Discussion group consensus-as-approval | Eliminates redundant separate approval step; discussion records become knowledge assets |
| D-ARCH-4 | Human intervention | Per-role `requiresHumanApproval` | Replaces global semi-auto/full-auto mode; more granular control per organizational branch |
| D-ARCH-5 | Vote tags | Structured data field (APPROVE/REVISE/CONCERN/DELEGATE) | Not text parsing; hardcoded consensus detection in MVP |
| D-ARCH-6 | Role definition | Three-element model (persona + knowledge + skills) | All user-editable; zero hardcoded prompts; maximum flexibility |
| D-ARCH-7 | Skill system | Three-layer interface (L1 Prompt / L2 Skill / L3 Workflow) | Progressive complexity; simple things simple, complex things possible |
| D-ARCH-8 | Status display | Narrative engine (DB query -> template -> LLM polish) | No hallucination risk; facts deterministic, LLM only styles prose |
| D-ARCH-9 | Event notification | Event digester with time-window aggregation | Prevents notification storms; inspired by database WAL batch flush |
| D-ARCH-10 | Prompt construction | User-configured 3 elements + system auto-injected 4 contexts | Separation of concerns: user controls identity/knowledge/skills, system handles org/task/discussion/actions |
| D-ARCH-11 | Organization creation | Templates + AI assistant conversational guidance | Lowers barrier for new users while maintaining flexibility for experts |
| D-ARCH-12 | Platform | Electron desktop application | Rich UI for discussions/narrative/org visualization |

---

## 7. Data Model (Core Entities)

| Entity | Purpose | Key Fields |
|--------|---------|------------|
| `Organization` | Project root | id, name, description, status, budgetLimit, orgTemplateId |
| `Role` | Org tree node | id, orgId, name, parentId, persona, knowledgeBaseRefs[], skillIds[], canApprove, canDelegate, requiresHumanApproval, status |
| `Skill` | Skill definition | id, name, source (builtin/template/custom), templateId, promptContent, description |
| `TaskNode` | Variable-depth task tree | id, orgId, parentId, type (epic/story/task/subtask/spike/bug/chore), title, description, status, assigneeRoleId, depth |
| `DiscussionGroup` | Epic-bound discussion | id, taskNodeId (epic), orgId, status (active/archived), summary, lastSummaryAt |
| `DiscussionMessage` | Message with vote tag | id, groupId, authorRoleId, authorType (ai/human), content, voteTag (APPROVE/REVISE/CONCERN/DELEGATE/null), createdAt |
| `Run` | Execution instance | id, orgId, taskNodeId, roleId, status, trigger, startedAt, finishedAt, costUsd |
| `CostEntry` | Token cost tracking | id, runId, roleId, orgId, tokenCount, costUsd |
| `Narrative` | Generated status snapshot | id, orgId, templateData (JSON), renderedText, generatedAt |
| `PendingWake` | Wake event queue | id, roleId, orgId, trigger, createdAt |
| `Settings` | Application settings | key, value |

---

## 8. Technology Stack

| Category | Technology | Version (verified 2026-03-27) |
|----------|-----------|-------------------------------|
| Platform | Electron | 41.1.0 |
| Language | TypeScript (strict, ESM) | 5.x |
| Runtime | Node.js | >= 22 LTS |
| Build | electron-vite | 5.0.0 |
| Packaging | electron-builder | 26.8.1 |
| UI Framework | React | 19.2.4 |
| State Management | Zustand | 5.0.12 |
| Styling | TailwindCSS | 4.2.2 |
| Animation | Framer Motion | 12.38.0 |
| Database | SQLite (better-sqlite3) | 12.8.0 |
| Validation | Zod | 4.3.6 |
| DI Container | tsyringe | (existing) |
| Event Bus | Emittery | (existing) |
| Logging | Pino | (existing) |
| Testing | Vitest + Playwright | latest + 1.58.2 |
| Package Manager | pnpm (monorepo) | latest |

---

## 9. MVP Scope vs Future

### MVP (V1)

All FR-01 through FR-13 as defined above.

### V2 Enhancements

- Declarative automation rules engine (replace hardcoded consensus/wake rules)
- Per-role budget limits
- Parallel execution (multiple roles executing simultaneously)
- Crash recovery (interrupted Run restoration)
- Dynamic role creation at runtime ("recruitment")
- Task dependencies (non-parent-child relationships)
- Heartbeat scheduler for idle role detection
- Real-time streaming execution logs
- Multi-LLM connector adapters (Codex, Gemini)

### V3 Platform

- Community skill provider marketplace
- Cross-project knowledge sharing
- Plugin system for custom automation actions
- Auto-update mechanism
- Advanced analytics and reporting

---

## 10. Success Metrics

1. **Full Loop**: User inputs a requirement → system completes analysis-to-delivery autonomously
2. **Meaningful Collaboration**: Discussion groups contain >3 rounds of substantive inter-role debate per Epic
3. **Narrative Clarity**: Dashboard narrative allows uninformed reader to understand project state in 30 seconds
4. **Skill Flexibility**: Switching Skill Provider (e.g., BMAD to custom prompts) requires zero business code changes
5. **Human Control**: Per-role human intervention works correctly; human votes have equal authority in discussions
