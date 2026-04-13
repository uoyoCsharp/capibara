---
stepsCompleted: ['step-01-validate-prerequisites', 'step-02-design-epics', 'step-03-create-stories']
inputDocuments:
  - '_bmad-output/planning-artifacts/prd-conversational-task-planning.md'
  - '_bmad-output/planning-artifacts/architecture.md'
  - '_bmad-output/planning-artifacts/ux-final-wireframes.md'
  - '_bmad-output/planning-artifacts/ux-design-specification.md'
feature: 'Conversational Task Planning'
status: 'draft'
date: '2026-04-13'
---

# Conversational Task Planning - Epic Breakdown

## Overview

This document provides the complete epic and story breakdown for the **Conversational Task Planning** feature of Capibara, decomposing the requirements from `prd-conversational-task-planning.md` into implementable stories.

## Requirements Inventory

### Functional Requirements

- FR-CTP-01: Planning entry point on Dashboard with "Start New Project" button and empty state CTA
- FR-CTP-02: Dedicated full-page Planning Chat interface with message history, input, phase indicator, loading states, session persistence, and cancel action
- FR-CTP-03: Planning Agent role auto-selection from org template (PM role preferred, fallback to root role) with phase-aware BMAD methodology prompt
- FR-CTP-04: Multi-round conversation via existing Conversation Workflow system (ask/reply/resume cycle), with Phase 1 advancement exemption
- FR-CTP-05: BMAD methodology integration in 3 phases: Diverge (brainstorming), Focus (product-brief), Structure (epic decomposition) with skip capability
- FR-CTP-06: Structured task plan output via new MCP tool `capibara_plan_tasks` with JSON schema, role resolution, type validation, and temporary storage
- FR-CTP-07: Task plan preview UI with tree visualization, inline title editing, node deletion, confirm/reject actions
- FR-CTP-08: Batch task creation via new IPC `batchCreateTasks` with depth-first ordering, role resolution, behavior rule firing, auto-execution trigger, atomic rollback
- FR-CTP-09: Planning run lifecycle: dedicated planning task, standard run trigger, completion on plan output, failure handling with retry, budget tracking

### Non-Functional Requirements

- NFR-CTP-01: Loading indicator within 500ms; typing animation at 60fps; elapsed time counter after 30s
- NFR-CTP-02: Planning conversations complete within 8-12 rounds; phase-specific prompt injection <= 8000 tokens
- NFR-CTP-03: Maximum 50 tasks per plan; maximum 3 nesting levels; split plans if exceeded
- NFR-CTP-04: Conversation state persists across app restarts; resume incomplete conversations on next launch
- NFR-CTP-05: All UI strings translated (zh-CN + en-US); conversation language follows user setting; task output follows document language

### Additional Requirements

- Must run through existing `ExecutionEngine.startRun()` lifecycle
- Conversation uses existing `ConversationWorkflow` state machine
- New MCP tool registered in `capibara-mcp-bridge.ts` tool definitions
- New IPC channels follow existing pattern: Zod validation + typed contracts in `contracts.ts`
- Batch creation uses `TaskService.create()` sequentially (respects behavior rules and event emission)
- Session resume via `askingSessionId` for conversation continuity

### UX Design Requirements

- UX-DR-01: Planning Chat page follows existing chat pattern (message bubbles, scroll-to-bottom, avatar indicators)
- UX-DR-02: Phase indicator component: 3-step progress bar (Diverge / Focus / Structure) with active state highlighting
- UX-DR-03: Loading state: animated typing indicator (3-dot pulse), disabled input with placeholder text, elapsed timer
- UX-DR-04: Plan preview: expandable/collapsible tree matching existing TaskTree visual style, with type badges and role name tags
- UX-DR-05: Entry point: prominent CTA button on Dashboard, disabled state with tooltip when no org selected

### FR Coverage Map

- FR-CTP-01 → Epic 2, Story 2.1
- FR-CTP-02 → Epic 2, Stories 2.2, 2.3, 2.4
- FR-CTP-03 → Epic 1, Story 1.1
- FR-CTP-04 → Epic 1, Story 1.2
- FR-CTP-05 → Epic 2, Story 2.5
- FR-CTP-06 → Epic 3, Story 3.1
- FR-CTP-07 → Epic 3, Story 3.2
- FR-CTP-08 → Epic 3, Story 3.3
- FR-CTP-09 → Epic 1, Stories 1.3, 1.4
- NFR-CTP-01 → Epic 2, Story 2.3
- NFR-CTP-02 → Epic 2, Story 2.5
- NFR-CTP-03 → Epic 3, Story 3.1
- NFR-CTP-04 → Epic 1, Story 1.4
- NFR-CTP-05 → Epic 2, Story 2.6
- UX-DR-01 → Epic 2, Story 2.2
- UX-DR-02 → Epic 2, Story 2.4
- UX-DR-03 → Epic 2, Story 2.3
- UX-DR-04 → Epic 3, Story 3.2
- UX-DR-05 → Epic 2, Story 2.1

## Epic List

### Epic 1: Planning Run Infrastructure
Users can start a planning session that runs as a full AI agent with multi-round conversation, proper lifecycle management, and session persistence.
**FRs covered:** FR-CTP-03, FR-CTP-04, FR-CTP-09
**NFRs covered:** NFR-CTP-04

### Epic 2: Planning Chat Experience
Users can interact with the AI Planning Agent through a dedicated, responsive chat interface with BMAD methodology guidance, loading feedback, and i18n support.
**FRs covered:** FR-CTP-01, FR-CTP-02, FR-CTP-05
**NFRs covered:** NFR-CTP-01, NFR-CTP-02, NFR-CTP-05
**UX-DRs covered:** UX-DR-01, UX-DR-02, UX-DR-03, UX-DR-05

### Epic 3: Plan Output, Review & Batch Creation
The AI generates a structured task plan that users can review, edit, and confirm to create all tasks at once with automatic execution.
**FRs covered:** FR-CTP-06, FR-CTP-07, FR-CTP-08
**NFRs covered:** NFR-CTP-03
**UX-DRs covered:** UX-DR-04

---

## Epic 1: Planning Run Infrastructure

Users can start a planning session that runs as a full AI agent with multi-round conversation, proper lifecycle management, and session persistence — even without the dedicated Planning Chat UI (conversations can be replied to via the existing Inbox).

### Story 1.1: Planning Agent Role Selection and Prompt Construction

As a **system administrator**,
I want the system to **automatically identify a Planning Agent role from the organization and construct a phase-aware planning prompt**,
So that **planning runs have a designated agent with BMAD methodology guidance built into its prompt**.

**Acceptance Criteria:**

**Given** an organization created from the BMAD Software Team template
**When** a planning run is initiated
**Then** the system selects the role whose skills include PM-related capabilities (e.g., `/bmad-create-prd`, `/bmad-product-brief`)
**And** if no PM role is found, the root role (parentId = null) is selected as fallback

**Given** a Planning Agent role has been selected
**When** the planning prompt is constructed
**Then** the prompt includes: the role's persona, a list of all organization roles with their names and skill descriptions, and the planning output format specification
**And** the prompt does NOT include the full BMAD skill file contents (phase-specific content is injected in Story 2.5)

**Given** an organization with no roles
**When** a planning run is requested
**Then** the system returns an error indicating that at least one role is required

---

### Story 1.2: Multi-Round Planning Conversation via Conversation Workflow

As a **user participating in a planning conversation**,
I want the Planning Agent to **ask me questions and wait for my replies using the existing Conversation Workflow system**,
So that **the conversation flows naturally across multiple AI execution rounds with full context preservation**.

**Acceptance Criteria:**

**Given** a planning run is executing
**When** the Planning Agent calls `capibara_conversation(action="ask", recipientTarget={type:"human"})`
**Then** a ConversationWorkflow is created in `waiting_for_reply` state
**And** a discussion message is posted with the agent's question
**And** the run completes with `succeeded` status (the agent has finished its turn)

**Given** a ConversationWorkflow is in `waiting_for_reply` state for a planning conversation
**When** the user posts a reply via `replyToConversation` IPC
**Then** the workflow transitions to `reply_received`
**And** a PendingWake is created for the Planning Agent with trigger `discussion_reply`

**Given** a PendingWake exists for the Planning Agent with trigger `discussion_reply`
**When** the wake is consumed and a new run starts
**Then** the run resumes the previous session (via `askingSessionId`) so the agent has full conversation context
**And** the ConversationWorkflow transitions from `reply_received` to `resumed`

**Given** a planning run succeeds and there is an active ConversationWorkflow for the same role and task
**When** Phase 1 advancement logic runs in ExecutionEngine
**Then** the task status is NOT advanced to `awaiting_review` (conversation-aware check)
**And** the task remains in `in_progress` status

---

### Story 1.3: Planning Run Lifecycle and IPC Channel

As a **user**,
I want to **start a planning run via a dedicated IPC channel that creates a planning task and triggers the Planning Agent**,
So that **the planning process is tracked as a proper run with budget enforcement and lifecycle management**.

**Acceptance Criteria:**

**Given** a valid organization with at least one role
**When** the renderer calls `startPlanningRun({ orgId, initialMessage })`
**Then** the system creates a new TaskNode with type = first root-allowed type in schema (e.g., `epic`), title = "Project Planning: {first 50 chars of initialMessage}", assignee = selected Planning Agent role
**And** a Run is created and started via `ExecutionEngine.startRun()`
**And** the IPC returns `{ ok: true, data: { runId, taskId } }`

**Given** a planning run is in progress
**When** the user calls `startPlanningRun` again for the same organization
**Then** the system returns an error (only one planning session per org at a time, enforced by existing serial execution)

**Given** a planning run is in progress
**When** the user calls `cancelRun` with the planning run ID
**Then** the run is cancelled via existing `ExecutionEngine.cancelRun()`
**And** any active ConversationWorkflow is transitioned to `cancelled`

**Given** a planning run token consumption
**When** budget tracking aggregates costs
**Then** planning run tokens are counted toward the organization's budget like any other run

---

### Story 1.4: Planning Session Resume on App Restart

As a **user who closed the app during a planning conversation**,
I want the system to **detect the incomplete planning session and allow me to resume**,
So that **I don't lose my planning progress**.

**Acceptance Criteria:**

**Given** an organization has a planning task in `in_progress` status with an active ConversationWorkflow in `waiting_for_reply` state
**When** the app restarts and the user navigates to the Planning Chat page
**Then** the system detects the incomplete session by querying for active conversation workflows on planning tasks
**And** the conversation history is loaded from discussion group messages

**Given** an incomplete planning session is detected
**When** the user sends a reply
**Then** the reply is posted to the existing discussion group
**And** the existing ConversationWorkflow handles it normally (reply → wake → resume)

**Given** an incomplete planning session is detected
**When** the user clicks "Discard and Start Over"
**Then** the active ConversationWorkflow is cancelled
**And** the planning task is transitioned to a terminal status
**And** the user can start a fresh planning session

---

## Epic 2: Planning Chat Experience

Users interact with the AI Planning Agent through a dedicated, responsive chat interface that provides real-time feedback, phase progression visibility, and BMAD methodology-driven guidance — all in their preferred language.

### Story 2.1: Planning Entry Point on Dashboard

As a **user on the Dashboard page**,
I want to see a **prominent "Start New Project" button that navigates me to the Planning Chat**,
So that **I can easily begin planning without navigating through menus**.

**Acceptance Criteria:**

**Given** I am on the Dashboard page and have an organization selected
**When** I look at the page header area
**Then** I see a "Start New Project" button with a visually prominent style (primary variant)

**Given** I click the "Start New Project" button
**When** I have an organization selected
**Then** I am navigated to the Planning Chat page (`SectionId: 'planning'`)

**Given** I am on the Dashboard with no organization selected
**When** I look at the "Start New Project" button
**Then** the button is disabled
**And** a tooltip explains "Select or create a workspace first"

**Given** I am on the Tasks page and there are no tasks
**When** the empty state is displayed
**Then** I see a CTA: "Describe what you want to build and let AI plan it for you"
**And** clicking it navigates to the Planning Chat page

---

### Story 2.2: Planning Chat Page — Message Display

As a **user in a planning conversation**,
I want to see **the full conversation between me and the Planning Agent as a scrollable chat**,
So that **I can follow the conversation flow and review previous exchanges**.

**Acceptance Criteria:**

**Given** I navigate to the Planning Chat page with no active planning session
**When** the page loads
**Then** I see a welcome state with an input field and placeholder "Describe your project idea..."
**And** no previous messages are displayed

**Given** a planning run has been started and the agent has posted a question
**When** I view the Planning Chat page
**Then** I see the agent's message displayed as a chat bubble with the Planning Agent's role name and avatar
**And** the message area auto-scrolls to the most recent message

**Given** I submit a reply in the Planning Chat
**When** the reply is sent
**Then** my message appears as a chat bubble on the right side (user messages)
**And** the input field is cleared

**Given** the planning conversation has multiple rounds of exchange
**When** I scroll up in the chat
**Then** I can see the full conversation history
**And** a "scroll to bottom" button appears when not at the latest message

---

### Story 2.3: Planning Chat Page — Loading States and Input Management

As a **user waiting for the AI to respond**,
I want to see **clear visual feedback that the AI is processing and know when I can type**,
So that **I don't think the app is frozen**.

**Acceptance Criteria:**

**Given** I have sent a message and the Planning Agent's run is in `running` status
**When** I look at the chat area
**Then** I see an animated typing indicator (3-dot pulse animation) in the agent's message area
**And** the indicator appears within 500ms of the run starting

**Given** the Planning Agent's run is in `running` status
**When** I look at the input area
**Then** the input field is disabled with placeholder text "AI is thinking..."
**And** the send button is disabled

**Given** the Planning Agent's run has been `running` for more than 30 seconds
**When** I look at the typing indicator
**Then** an elapsed time counter is displayed next to or below the indicator (e.g., "Thinking... 32s")

**Given** the Planning Agent's run completes and a conversation workflow is in `waiting_for_reply`
**When** the new question message appears in the chat
**Then** the typing indicator is removed
**And** the input field is enabled with placeholder "Type your reply..."
**And** the input field receives focus automatically

**Given** a planning run is active
**When** I click the "Cancel" button
**Then** a confirmation dialog appears ("Cancel planning session?")
**And** on confirm, the run is cancelled and I am navigated back to the Dashboard

---

### Story 2.4: Planning Phase Indicator

As a **user in a planning conversation**,
I want to see **which phase of planning I'm in (Diverge / Focus / Structure)**,
So that **I understand the progression and know what to expect next**.

**Acceptance Criteria:**

**Given** I am on the Planning Chat page with an active session
**When** I look at the top of the chat area
**Then** I see a 3-step progress indicator showing: "Diverge" → "Focus" → "Structure"
**And** the current phase is visually highlighted (active state)

**Given** the Planning Agent's messages contain a phase transition marker (e.g., the agent mentions moving to the next phase)
**When** the phase changes
**Then** the progress indicator updates to highlight the new active phase
**And** the completed phases show a check mark

**Given** the Planning Agent is in the Structure phase and outputs a plan
**When** the plan is generated
**Then** all three phases show as completed
**And** the UI transitions to the Plan Preview (Epic 3)

---

### Story 2.5: BMAD Methodology Phase-Specific Prompt Injection

As a **system**,
I want to **inject the relevant BMAD methodology content into the Planning Agent's prompt based on the current conversation phase**,
So that **the agent uses appropriate techniques at each stage without exceeding token limits**.

**Acceptance Criteria:**

**Given** a planning run is starting for the first time (no previous conversation)
**When** the prompt is constructed
**Then** the Phase A (Diverge) methodology extract is injected, containing: SCAMPER technique, What-If Scenarios, First Principles, Reversal Inversion
**And** the total methodology injection does not exceed 2000 tokens

**Given** the Planning Agent determines it should move to Phase B (Focus)
**When** the next run's prompt is constructed (after a conversation round)
**Then** the Phase B methodology extract is injected, containing: Product-brief question framework (Problem, Solution, Users, Differentiators, Scope, Success Criteria)
**And** Phase A content is no longer included

**Given** the Planning Agent determines it should move to Phase C (Structure)
**When** the next run's prompt is constructed
**Then** the Phase C methodology extract is injected, containing: Epic decomposition rules, BDD acceptance criteria format, role assignment logic, JSON output schema for `capibara_plan_tasks`
**And** Phases A and B content are no longer included

**Given** the user says "skip to planning" or equivalent during Phase A or B
**When** the Planning Agent processes this message
**Then** the agent acknowledges and moves directly to Phase C in its next response
**And** the prompt injection switches to Phase C content

**Given** all phase-specific prompt content
**When** measured in tokens
**Then** no single phase's injection exceeds 2000 tokens
**And** the total planning prompt (base + phase + org context) does not exceed 8000 tokens

---

### Story 2.6: Planning Chat i18n Support

As a **user with a non-English locale**,
I want the **Planning Chat UI to be fully translated and the AI to converse in my language**,
So that **I can use the planning feature comfortably in my preferred language**.

**Acceptance Criteria:**

**Given** my locale is set to `zh-CN`
**When** I navigate to the Planning Chat page
**Then** all static UI strings are displayed in Chinese (button labels, placeholders, phase names, loading text, error messages)

**Given** my locale is set to `en-US`
**When** I navigate to the Planning Chat page
**Then** all static UI strings are displayed in English

**Given** my `communication_language` is set to Chinese
**When** the Planning Agent constructs its prompt
**Then** the prompt instructs the agent to converse in Chinese

**Given** the Planning Agent generates task titles and descriptions
**When** `document_output_language` is set to English
**Then** the generated task plan content (titles, descriptions, acceptance criteria) is in English regardless of conversation language

---

## Epic 3: Plan Output, Review & Batch Creation

The AI generates a structured task plan via a new MCP tool. Users review the plan in an interactive tree preview, can edit titles and remove items, and confirm to batch-create all tasks with automatic execution kickoff.

### Story 3.1: MCP Tool `capibara_plan_tasks` for Structured Plan Output

As a **Planning Agent**,
I want to **submit a structured task plan via an MCP tool call**,
So that **the plan is validated, stored, and made available to the frontend for user review**.

**Acceptance Criteria:**

**Given** the Planning Agent has gathered enough information from the conversation
**When** it calls `capibara_plan_tasks` with a JSON payload containing `summary` and `tasks` array
**Then** the tool validates the payload structure: each task must have `title` (string, non-empty), `type` (string, valid against org's WorkflowSchema), `description` (string), `assigneeRoleName` (string or null), and optional `children` array
**And** the tool returns `{ success: true, taskCount: N }` on valid input

**Given** a task in the plan has an `assigneeRoleName` that matches an organization role name
**When** the plan is stored
**Then** the `assigneeRoleName` is resolved to the corresponding `roleId`

**Given** a task in the plan has an `assigneeRoleName` that does not match any organization role
**When** the plan is stored
**Then** the `assigneeRoleName` is set to null (unassigned) and a warning is logged

**Given** a task in the plan has a `type` not defined in the organization's WorkflowSchema
**When** the tool validates the input
**Then** the tool returns `{ success: false, error: "Invalid task type: {type}" }`

**Given** the plan contains more than 50 tasks total (including nested children)
**When** the tool validates the input
**Then** the tool returns `{ success: false, error: "Plan exceeds maximum of 50 tasks" }`

**Given** the plan has nesting deeper than 3 levels
**When** the tool validates the input
**Then** the tool returns `{ success: false, error: "Plan exceeds maximum nesting depth of 3" }`

**Given** a valid plan is stored
**When** the renderer calls `getPendingPlan({ orgId })`
**Then** the IPC returns the stored plan with resolved role IDs and the original `assigneeRoleName` for display

---

### Story 3.2: Task Plan Preview UI

As a **user who has completed the planning conversation**,
I want to **review the generated task plan as an interactive tree before creating tasks**,
So that **I can verify, adjust, and approve the plan before committing**.

**Acceptance Criteria:**

**Given** the Planning Agent has submitted a plan via `capibara_plan_tasks` and the planning run has succeeded
**When** the Planning Chat page detects a pending plan (via `getPendingPlan`)
**Then** the UI transitions from chat view to plan preview view
**And** a header summary shows: plan summary text, total task count by type (e.g., "2 Epics, 5 Stories, 3 Tasks")

**Given** the plan preview is displayed
**When** I look at the tree
**Then** I see an expandable/collapsible tree with correct parent-child hierarchy
**And** each node displays: title, type badge (colored), assigned role name (or "Unassigned"), and acceptance criteria count (if present)

**Given** I click on a task title in the plan preview
**When** the title becomes editable (inline edit)
**Then** I can change the title and press Enter to confirm or Escape to cancel
**And** the edited title is reflected in the pending plan data

**Given** I click the delete button on a node in the plan preview
**When** I confirm the deletion
**Then** the node and all its children are removed from the preview
**And** the task count summary updates

**Given** I click "Start Over"
**When** I confirm the action
**Then** the pending plan is discarded
**And** the planning task is cancelled
**And** I am returned to the Planning Chat welcome state to start a new session

**Given** I click "Create All Tasks"
**When** the plan has at least one task
**Then** the batch creation process is triggered (Story 3.3)
**And** a loading state is shown ("Creating tasks...")

---

### Story 3.3: Batch Task Creation and Auto-Execution

As a **user who has confirmed the task plan**,
I want all tasks to be **created in the correct hierarchy with role assignments and behavior rules firing, then execution to start automatically**,
So that **my AI team begins working immediately without manual intervention**.

**Acceptance Criteria:**

**Given** the user confirms the plan in the preview UI
**When** the renderer calls `batchCreateTasks({ orgId, plan })`
**Then** the system creates all TaskNodes in depth-first order: parent tasks before children
**And** each task is created via `TaskService.create()` to ensure behavior rules fire (e.g., discussion group creation for epic/story types)
**And** `parentId` references are correctly established based on the tree hierarchy

**Given** a task in the plan has a resolved `roleId`
**When** the task is created
**Then** the `assigneeRoleId` is set to the resolved role ID

**Given** a task in the plan has a null `roleId` (unresolved or unassigned)
**When** the task is created
**Then** the `assigneeRoleId` is set to null

**Given** all tasks are created successfully
**When** the batch creation completes
**Then** the planning task (created in Story 1.3) is transitioned to a terminal status
**And** a `wake:triggered` event is emitted for the first actionable task's assignee role
**And** the IPC returns `{ ok: true, data: { createdCount: N } }`
**And** the user is navigated to the Tasks page

**Given** a task in the batch fails validation (e.g., invalid type after schema check)
**When** the error occurs during creation
**Then** all previously created tasks in this batch are deleted (rollback)
**And** the IPC returns `{ ok: false, error: { message: "..." } }`
**And** the user remains on the plan preview with an error toast

**Given** all tasks are created and the first execution run starts
**When** I navigate to the Tasks page
**Then** I see the full task tree created from the plan
**And** at least one task shows `in_progress` status with an active run

---

## Dependency Summary

```
Epic 1 (Infrastructure)
  Story 1.1: Planning Agent role selection + prompt ← standalone
  Story 1.2: Multi-round conversation workflow     ← standalone (uses existing ConversationWorkflow)
  Story 1.3: Planning run lifecycle + IPC           ← depends on 1.1
  Story 1.4: Session resume on restart              ← depends on 1.2, 1.3

Epic 2 (Chat Experience) ← depends on Epic 1
  Story 2.1: Dashboard entry point                  ← standalone (navigation only)
  Story 2.2: Chat page message display              ← depends on 1.3 (needs planning run data)
  Story 2.3: Loading states + input management      ← depends on 2.2
  Story 2.4: Phase indicator                        ← depends on 2.2
  Story 2.5: BMAD phase-specific prompt injection   ← depends on 1.1 (extends prompt construction)
  Story 2.6: i18n support                           ← depends on 2.2 (adds translations)

Epic 3 (Plan Output & Creation) ← depends on Epic 1
  Story 3.1: MCP tool capibara_plan_tasks           ← standalone (backend only)
  Story 3.2: Plan preview UI                        ← depends on 3.1 (needs plan data)
  Story 3.3: Batch creation + auto-execution        ← depends on 3.1, 3.2
```

No story depends on a future story within the same epic. All dependencies flow forward.
