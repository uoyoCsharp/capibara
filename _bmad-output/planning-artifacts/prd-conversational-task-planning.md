---
document_type: 'feature-prd'
parent_prd: 'prd.md'
project_name: 'capibara'
feature_name: 'Conversational Task Planning'
version: '1.0'
date: '2026-04-13'
status: 'draft'
authors: ['uoyo', 'John (PM Agent)']
references:
  - 'prd.md (Capibara main PRD v2.2)'
  - 'architecture.md'
  - 'ux-final-wireframes.md'
  - 'BMAD Method skills (brainstorming, product-brief, create-epics-and-stories)'
---

# Feature PRD: Conversational Task Planning

> Turn a vague idea into an executable task tree through AI-guided conversation.

---

## 1. Problem Statement

### 1.1 Current State

Capibara's task creation flow requires users to manually create Epics, decompose them into Stories/Tasks, assign roles, and fill in structured fields (type, title, description, assignee). This assumes users understand:

- The Epic/Story/Task/Subtask type hierarchy
- How to structure and decompose requirements
- Which AI role should handle which work item

### 1.2 Pain Points

| Friction Layer | Description | Affected Users |
|----------------|-------------|----------------|
| **Cognitive** | Users must understand work item type semantics and decomposition strategy | Non-technical users, new users |
| **Decision** | Users must choose task types, assignees, and decomposition depth for every node | All users in unfamiliar domains |
| **Operational** | Creating a multi-level task tree requires repetitive form-filling across many screens | All users |

### 1.3 Impact

Users with a vague idea ("I want to build a note-taking app") abandon the product at the task creation step. The gap between "having an idea" and "AI team starts working" is too wide.

---

## 2. Solution Overview

### 2.1 Core Concept

Introduce a **Conversational Task Planning** flow where users describe their idea in natural language. An AI Planning Agent — running as a full ExecutionEngine run — guides users through structured discovery using BMAD methodology, then generates a complete task tree that is batch-created in Capibara.

### 2.2 User Journey (End-to-End)

```
Step 1: Entry Point
  User clicks "Start New Project" on Dashboard (or empty state)

Step 2: Template Selection
  User picks an org template (e.g., BMAD Software Team)
  OR continues with existing organization

Step 3: AI-Guided Conversation (Planning Run)
  Phase A — Diverge: AI uses brainstorming techniques to expand the idea
  Phase B — Focus: AI uses product-brief framework to clarify scope
  Phase C — Structure: AI generates Epic/Story breakdown with role assignments

Step 4: Task Plan Preview
  Tree visualization of proposed Epics -> Stories -> Tasks
  Each node shows: title, type, assigned role, acceptance criteria count

Step 5: Confirm & Execute
  User confirms plan -> batch task creation -> automatic execution begins
  User redirected to Tasks page to observe progress
```

### 2.3 Key Design Decision: ExecutionEngine-Based

The planning conversation runs through the existing `ExecutionEngine` as a full agent run, not as a lightweight frontend-only chat. This gives the Planning Agent access to:

- MCP tools (file reading, workspace awareness)
- Session resume (conversation continuity across multiple rounds)
- Token tracking and budget enforcement
- Full prompt construction pipeline (persona + skills + context)

The conversation between AI and user is implemented via the existing **Conversation Workflow** system (`conversation_workflow` state machine: `waiting_for_reply -> reply_received -> resumed -> resolved`).

---

## 3. Functional Requirements

### FR-CTP-01: Planning Entry Point

**Priority: MVP**

The system shall provide a prominent entry point for conversational task planning:

- **Dashboard Button**: "Start New Project" button on Dashboard page, visible when organization has no active tasks OR always accessible in header area
- **Empty State CTA**: When task list is empty, display a call-to-action: "Describe what you want to build and let AI plan it for you"
- **Navigation**: Clicking the entry point navigates to the Planning Chat page (`SectionId: 'planning'`)

**Acceptance Criteria:**
- Entry point visible on Dashboard for all users
- Entry point navigates to Planning Chat page
- Entry point disabled (with tooltip) when no organization is selected

### FR-CTP-02: Planning Chat Page

**Priority: MVP**

The system shall provide a dedicated full-page chat interface for the planning conversation:

- **Chat History Panel**: Displays the full conversation between user and Planning Agent as a scrollable message list
- **Message Input**: Text input area at the bottom for user replies
- **Phase Indicator**: Visual indicator showing current planning phase (Diverge / Focus / Structure) and progress
- **Loading State**: While the Planning Agent is executing (run in `running` status), display:
  - Animated typing indicator in the chat area
  - Disabled input with "AI is thinking..." placeholder
  - Elapsed time counter
- **Session Persistence**: If user navigates away and returns, conversation history is preserved (via discussion group messages + session resume)
- **Cancel Action**: User can cancel the planning run at any time, returning to Dashboard

**Acceptance Criteria:**
- Chat messages render in real-time as discussion messages are posted
- Loading state is shown during AI execution with typing indicator
- User input is disabled during AI execution and enabled during `waiting_for_reply`
- Conversation persists across page navigation within the same session
- Cancel button aborts the active run and returns to Dashboard

### FR-CTP-03: Planning Agent Role

**Priority: MVP**

The system shall designate a Planning Agent role within each organization to execute planning runs:

- **Role Selection**: When using a template (e.g., BMAD Software Team), the role with Product Manager skills is automatically selected as the Planning Agent
- **Fallback**: If no PM-like role exists, the root role (highest in org tree) is used
- **Planning Prompt**: The Planning Agent receives a specialized system prompt that includes:
  - BMAD methodology guidance (brainstorming techniques, product-brief question framework, epic/story decomposition rules)
  - Organization context (available roles, their skills, the template structure)
  - Output format specification (structured JSON task tree)
  - Phase transition instructions (when to move from Diverge -> Focus -> Structure)

**Acceptance Criteria:**
- System automatically identifies an appropriate Planning Agent role from the org template
- Planning prompt includes BMAD methodology extracts relevant to each phase
- Planning prompt includes the list of available roles and their capabilities for assignment

### FR-CTP-04: Multi-Round Conversation via Conversation Workflow

**Priority: MVP**

The planning conversation shall use the existing Conversation Workflow system for human-AI interaction:

- **Workflow Creation**: When the Planning Agent needs user input, it calls `capibara_conversation(action="ask", recipientTarget={type:"human"})` to post a question
- **Human Reply**: User replies via the Planning Chat Page input. The reply is posted as a discussion message, triggering `handleReply` which creates a `PendingWake` for the Planning Agent
- **Resume**: The Planning Agent resumes with `discussion_reply` trigger, receiving the user's answer in context via session resume
- **Multi-Round**: This cycle repeats for each phase of planning (typically 4-8 rounds total)
- **Conversation Resolution**: When the Planning Agent has gathered enough information and generated the task plan, it calls `capibara_conversation(action="resolve")` to close the conversation
- **Phase 1 Advancement Exemption**: Planning runs with active conversations must NOT be advanced to `awaiting_review` (leverages the fix implemented in ExecutionEngine)

**Acceptance Criteria:**
- Each AI question creates a conversation workflow in `waiting_for_reply` state
- User reply transitions workflow to `reply_received` and wakes the Planning Agent
- Planning Agent resumes with full conversation context via session resume
- Conversation resolves when plan generation is complete
- Task status remains `in_progress` while conversation is active (not `awaiting_review`)

### FR-CTP-05: BMAD Methodology Integration

**Priority: MVP**

The Planning Agent's prompt shall incorporate BMAD methodology in three phases:

**Phase A — Diverge (Brainstorming):**
- Inject a curated subset of brainstorming techniques from `bmad-brainstorming` skill (SCAMPER, What-If Scenarios, First Principles, Reversal Inversion)
- Agent asks open-ended questions to expand the user's idea
- Goal: Generate breadth of possibilities (2-3 conversation rounds)

**Phase B — Focus (Product Brief):**
- Inject the product-brief question framework from `bmad-product-brief` skill (Problem, Solution, Target Users, Differentiators, Scope, Success Criteria)
- Agent asks targeted questions to narrow scope and clarify requirements
- Goal: Define clear MVP boundaries (2-3 conversation rounds)

**Phase C — Structure (Epic Decomposition):**
- Inject epic/story decomposition rules from `bmad-create-epics-and-stories` skill (BDD acceptance criteria format, type hierarchy rules, role assignment logic)
- Agent generates the task tree based on gathered context
- Output: Structured JSON representing the task plan
- Goal: Produce actionable, assignable work items (1-2 conversation rounds for confirmation)

**Acceptance Criteria:**
- Planning prompt is phase-aware: only relevant BMAD methodology content is injected per phase
- Phase A produces expanded understanding of the user's idea
- Phase B produces clearly scoped requirements
- Phase C produces a structured task tree with role assignments
- User can say "skip to planning" at any point to jump to Phase C

### FR-CTP-06: Task Plan Output Format

**Priority: MVP**

The Planning Agent shall output a structured task plan via a new MCP tool:

- **MCP Tool**: `capibara_plan_tasks` — accepts a JSON task tree and stores it as a pending plan
- **Plan Structure**:
  ```json
  {
    "summary": "Brief project description",
    "tasks": [
      {
        "title": "Epic title",
        "type": "epic",
        "description": "Epic description",
        "assigneeRoleName": "Product Manager",
        "children": [
          {
            "title": "Story title",
            "type": "story",
            "description": "User story in As-a/I-want/So-that format",
            "assigneeRoleName": "Senior Developer",
            "acceptanceCriteria": ["Given/When/Then..."],
            "children": []
          }
        ]
      }
    ]
  }
  ```
- **Role Resolution**: `assigneeRoleName` is resolved to `assigneeRoleId` by matching against the organization's role names
- **Type Validation**: Task types are validated against the organization's WorkflowSchema
- **Storage**: The pending plan is stored temporarily (in-memory or Settings table) until user confirmation

**Acceptance Criteria:**
- MCP tool validates the task tree structure (required fields, valid types, resolvable role names)
- Invalid role names fall back to unassigned (null assignee)
- Invalid task types are rejected with an error message to the agent
- Plan is retrievable by the frontend via IPC after the planning run completes

### FR-CTP-07: Task Plan Preview UI

**Priority: MVP**

The system shall display an interactive preview of the generated task plan before creation:

- **Tree Visualization**: Render the task plan as an expandable/collapsible tree matching the existing TaskTree component style
- **Node Details**: Each node displays: title, type badge, assigned role name, acceptance criteria count
- **Edit Capabilities (MVP)**: User can:
  - Delete individual nodes (and their children)
  - Edit task titles inline
- **Confirm Button**: "Create All Tasks" button that triggers batch creation
- **Reject Button**: "Start Over" button that discards the plan and returns to chat
- **Task Count Summary**: Header showing total count by type (e.g., "2 Epics, 7 Stories, 3 Tasks")

**Acceptance Criteria:**
- Tree renders all levels of the plan with correct parent-child relationships
- User can delete nodes; child nodes are removed with parent
- User can edit task titles inline
- "Create All Tasks" triggers batch creation and navigates to Tasks page
- "Start Over" discards plan and resets the planning chat

### FR-CTP-08: Batch Task Creation

**Priority: MVP**

The system shall create all tasks from a confirmed plan in a single operation:

- **IPC Channel**: `batchCreateTasks` — accepts the confirmed task plan and creates all TaskNodes
- **Creation Order**: Parent tasks created before children (depth-first traversal) to establish correct `parentId` references
- **Role Assignment**: Each task's `assigneeRoleName` is resolved to a `roleId` from the current organization. Unresolved names result in unassigned tasks.
- **Status**: All created tasks start in the initial status defined by the WorkflowSchema
- **Behavior Rules**: `on_task_created` behavior rules fire for each created task (e.g., discussion group creation)
- **Auto-Execution Trigger**: After batch creation, emit `wake:triggered` for the first actionable task's assignee role to begin execution

**Acceptance Criteria:**
- All tasks in the plan are created with correct parent-child hierarchy
- Role assignments are resolved correctly; unresolved names result in null assignee
- Behavior rules (discussion group creation) fire for applicable task types
- At least one execution run is triggered automatically after creation
- Batch creation is atomic: if any task fails validation, no tasks are created (rollback)

### FR-CTP-09: Planning Run Lifecycle

**Priority: MVP**

The system shall manage planning runs with proper lifecycle integration:

- **Task Type**: Planning uses a dedicated task of type `epic` (or the first root-allowed type in the schema) with a title like "Project Planning: {user's first message summary}"
- **Run Trigger**: Planning runs use trigger `task_assigned` (same as normal execution)
- **Completion**: When the Planning Agent outputs the task plan via `capibara_plan_tasks`, the run succeeds. The planning task transitions to a terminal status.
- **Failure Handling**: If the planning run fails (executor error, timeout), the user sees an error state in the Planning Chat with a "Retry" button
- **Budget**: Planning runs consume tokens and are tracked against the organization's budget like any other run

**Acceptance Criteria:**
- Planning run appears in the Runs list with correct metadata
- Planning run token consumption is tracked and visible
- Failed planning runs show error state with retry option
- Completed planning run's task reaches terminal status
- Planning task is visually distinguishable from user-created tasks (e.g., tag or icon)

---

## 4. Non-Functional Requirements

### NFR-CTP-01: Response Time Perception

- Planning Agent responses must show a loading indicator within 500ms of user sending a message
- Typing indicator animation must be smooth (60fps) and not block the UI thread
- If the Planning Agent takes longer than 30 seconds to respond, show an elapsed time counter ("Thinking... 32s")

### NFR-CTP-02: Conversation Context Limit

- Planning conversations should complete within 8-12 rounds (4-8 user messages)
- Planning prompt (including BMAD methodology extracts) must not exceed 8,000 tokens to leave room for conversation context
- Phase-specific prompt injection keeps per-round context lean

### NFR-CTP-03: Plan Size Limits

- Maximum 50 tasks per plan (prevents oversized batch creation)
- Maximum 3 levels of nesting (Epic -> Story -> Task)
- If the Planning Agent generates more, it must split into multiple plans with user confirmation

### NFR-CTP-04: Resilience

- If the user closes the app during a planning conversation, the conversation state persists in the database (conversation workflow + discussion messages)
- On next launch, the Planning Chat page detects the incomplete conversation and offers to resume
- Network/executor failures during planning run trigger automatic retry (existing `maxRetryOnFailure` mechanism)

### NFR-CTP-05: i18n

- All Planning Chat UI strings (phase labels, buttons, loading text, error messages) must be translated in both zh-CN and en-US
- The Planning Agent's conversation language follows the user's `communication_language` setting
- Generated task titles and descriptions follow `document_output_language` setting

---

## 5. User Stories

### US-CTP-01: First-Time User Creates Project via Conversation

As a **non-technical user** who has just installed Capibara and selected the BMAD Software Team template,
I want to **describe my project idea in natural language and have AI guide me through planning**,
So that **I get a structured task plan without needing to understand Epic/Story/Task decomposition**.

**Acceptance Criteria (BDD):**
- Given I have selected an org template and have no tasks
- When I click "Start New Project" on the Dashboard
- Then I see a Planning Chat page with a welcome message from the AI
- And the AI asks me to describe my project idea

- Given I have described my idea
- When the AI finishes asking clarifying questions
- Then I see a task plan preview with Epics, Stories, and role assignments
- And I can confirm to create all tasks with one click

### US-CTP-02: Experienced User Adds Feature to Existing Project

As an **experienced user** with an existing organization and completed tasks,
I want to **start a new planning conversation to add a feature**,
So that **the new feature's tasks are created with the same structure and role assignments as existing work**.

**Acceptance Criteria (BDD):**
- Given I have an existing organization with roles and completed tasks
- When I start a new planning conversation
- Then the Planning Agent is aware of the existing organization structure and roles
- And the generated plan assigns tasks to existing roles appropriately

### US-CTP-03: User Skips Brainstorming Phase

As a **user who already has clear requirements**,
I want to **skip the brainstorming phase and go directly to task decomposition**,
So that **I don't waste time on discovery when I already know what I want**.

**Acceptance Criteria (BDD):**
- Given I am in the Planning Chat during Phase A (Diverge)
- When I say "I already know what I want, skip to planning"
- Then the AI acknowledges and moves to Phase C (Structure)
- And the AI generates a task plan based on the information provided so far

### US-CTP-04: User Edits Generated Plan Before Creation

As a **user reviewing the generated task plan**,
I want to **delete unnecessary tasks and edit titles before confirming**,
So that **the created tasks match my actual needs, not just the AI's suggestions**.

**Acceptance Criteria (BDD):**
- Given I see a task plan preview
- When I delete a Story node
- Then the Story and all its child tasks are removed from the preview
- And the task count summary updates

- Given I see a task plan preview
- When I click on a task title and edit it
- Then the title updates in the preview
- And the edited title is used when tasks are created

### US-CTP-05: Planning Conversation Handles AI Execution Delay

As a **user waiting for the AI to respond**,
I want to **see clear feedback that the AI is processing**,
So that **I don't think the app is frozen or broken**.

**Acceptance Criteria (BDD):**
- Given I have sent a message to the Planning Agent
- When the AI is processing (run in `running` status)
- Then I see a typing indicator animation in the chat
- And the input field is disabled with "AI is thinking..." placeholder
- And after 30 seconds, an elapsed time counter appears

### US-CTP-06: Resume Interrupted Planning Session

As a **user who closed the app during a planning conversation**,
I want to **resume where I left off when I reopen the app**,
So that **I don't lose my planning progress**.

**Acceptance Criteria (BDD):**
- Given I had an active planning conversation and closed the app
- When I reopen the app and navigate to the Planning Chat
- Then I see the full conversation history
- And the conversation resumes from where it stopped (either waiting for my reply or AI continues)

---

## 6. Technical Design Notes

### 6.1 New IPC Channels

| Channel | Direction | Input | Output |
|---------|-----------|-------|--------|
| `startPlanningRun` | Renderer -> Main | `{ orgId, initialMessage }` | `{ ok, data: { runId, taskId } }` |
| `getPendingPlan` | Renderer -> Main | `{ orgId }` | `{ ok, data: PlanTree \| null }` |
| `batchCreateTasks` | Renderer -> Main | `{ orgId, plan: PlanTree }` | `{ ok, data: { createdCount } }` |

### 6.2 New MCP Tool

| Tool | Description | Called By |
|------|-------------|----------|
| `capibara_plan_tasks` | Submit structured task plan JSON for user review | Planning Agent |

### 6.3 New UI Components

| Component | Location | Purpose |
|-----------|----------|---------|
| `PlanningChatPage` | `renderer/components/planning/` | Full-page chat interface for planning conversation |
| `PlanPreview` | `renderer/components/planning/` | Tree visualization of pending task plan |
| `PlanningPhaseIndicator` | `renderer/components/planning/` | Visual phase progress (Diverge/Focus/Structure) |

### 6.4 Prompt Architecture

The Planning Agent prompt is composed in three layers, injected per-phase:

```
Layer 1 (Always): Base planning persona + org context + available roles
Layer 2 (Phase-specific):
  - Phase A: Brainstorming techniques extract (~1500 tokens)
  - Phase B: Product-brief question framework (~1000 tokens)
  - Phase C: Epic decomposition rules + JSON output format (~2000 tokens)
Layer 3 (Always): Conversation history (via session resume, not prompt injection)
```

### 6.5 Integration with Existing Systems

| System | Integration Point |
|--------|-------------------|
| ExecutionEngine | Planning run uses `startRun()` with standard lifecycle |
| ConversationWorkflow | Multi-round human interaction via existing `ask/reply/resolve` flow |
| TaskService | Batch creation via repeated `create()` calls in depth-first order |
| WorkflowEngine | Type and status validation for generated plan |
| BehaviorEngine | `on_task_created` rules fire for each created task |
| Phase 1 Advancement | Active conversation prevents premature `awaiting_review` transition |
| EventBroadcaster | Planning events broadcast to renderer for real-time UI updates |

---

## 7. Scope Boundaries

### In Scope (MVP)

- Single planning conversation per organization at a time
- AI-guided 3-phase conversation (Diverge/Focus/Structure)
- BMAD methodology embedded in planning prompt
- Task plan preview with delete and title editing
- Batch task creation with auto-execution trigger
- Full ExecutionEngine lifecycle for planning runs
- Loading states and conversation persistence

### Out of Scope (Future Iterations)

| Feature | Rationale for Deferral |
|---------|----------------------|
| Drag-and-drop reordering in plan preview | Adds complexity; delete + re-plan achieves same goal |
| In-plan role reassignment UI | Can be done post-creation in existing Task detail view |
| Multiple concurrent planning sessions | Single session sufficient for MVP; add if users request |
| Planning templates (pre-filled conversation starters) | Wait for user feedback on which scenarios are common |
| Deep BMAD integration (full PRD/Architecture generation) | Phase 2: BMAD artifacts saved to workspace + injected into agent context |
| Plan versioning / history | Overkill for MVP; plan is ephemeral until confirmed |
| Voice input for planning conversation | Platform limitation; revisit when Electron supports speech APIs |

---

## 8. Success Metrics

| Metric | Target | Measurement |
|--------|--------|-------------|
| **Idea-to-Execution Time** | < 10 minutes from first message to first task execution | Timestamp difference: planning run created -> first non-planning run started |
| **Planning Completion Rate** | > 70% of started planning conversations result in task creation | Count confirmed plans / count started planning runs |
| **Conversation Rounds** | Average 4-8 user messages per planning session | Count human replies per planning conversation workflow chain |
| **Plan Acceptance Rate** | > 80% of generated plans are confirmed without "Start Over" | Count confirmed / (confirmed + rejected) |
| **User Retention Impact** | Users who use planning have 2x higher 7-day retention than manual task creators | Cohort analysis (requires analytics, V2) |

---

## 9. Key Design Decisions

| ID | Decision | Choice | Rationale |
|----|----------|--------|-----------|
| D-CTP-1 | Execution model | Full ExecutionEngine run (not frontend-only chat) | Gives agent MCP tools, session resume, token tracking, budget enforcement |
| D-CTP-2 | Conversation mechanism | Existing ConversationWorkflow system | Reuses proven multi-turn human-AI interaction; no new state machine needed |
| D-CTP-3 | BMAD integration | Prompt injection (not runtime skill execution) | Keeps MVP simple; BMAD methodology as prompt guidance, not as executable workflow |
| D-CTP-4 | Planning role selection | Auto-select PM role from template; fallback to root role | Zero configuration for template users; works without templates too |
| D-CTP-5 | Plan output | New MCP tool `capibara_plan_tasks` with JSON schema | Structured output enables frontend preview; MCP tool validates before storage |
| D-CTP-6 | Batch creation | Sequential `TaskService.create()` in depth-first order | Reuses existing validation, behavior rules, and event emission; atomic rollback on failure |
| D-CTP-7 | Phase progression | AI-controlled with user override ("skip to planning") | Flexible for both exploration-oriented and goal-oriented users |
| D-CTP-8 | Loading UX | Typing indicator + elapsed timer + disabled input | Addresses user anxiety during 10-60 second AI processing windows |

---

## 10. Risks and Mitigations

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| AI generates low-quality task plans | Medium | High | Preview + edit UI gives user final control; prompt engineering with BMAD methodology provides guardrails |
| Planning conversation takes too many rounds | Low | Medium | Phase progression + "skip" capability; prompt instructs agent to converge within 8 rounds |
| Token cost of planning runs is too high | Low | Medium | Phase-specific prompt injection limits context size; budget enforcement applies normally |
| User confusion about planning vs. manual task creation | Medium | Low | Clear entry point differentiation; planning is the "easy path", manual creation remains for power users |
| Session resume fails after app restart | Low | High | Conversation state persists in DB; fallback: show conversation history read-only with "Start New" option |

---

## Appendix A: Relationship to Main PRD

This feature PRD extends the following main PRD requirements:

- **FR-01 (Organization Modeling)**: Adds AI-assisted organization creation flow for planning context
- **FR-02 (Task System)**: Adds batch task creation as a new entry point alongside manual creation
- **FR-06 (Execution Engine)**: Introduces "planning run" as a new run category
- **FR-08 (Human Intervention)**: Planning conversation is a new form of structured human-AI interaction
- **FR-11 (Pluggable Skill System)**: BMAD methodology skills provide the intellectual framework for planning

No existing FRs are modified or deprecated by this feature.

---

## Appendix B: BMAD Methodology Extracts for Prompt Injection

### Phase A — Diverge (from bmad-brainstorming)

Key techniques to inject:
- **SCAMPER**: Substitute, Combine, Adapt, Modify, Put to other use, Eliminate, Reverse
- **What-If Scenarios**: "What if budget was unlimited? What if timeline was 1 week?"
- **First Principles**: Break the problem down to fundamental truths
- **Reversal Inversion**: "What would make this project fail?"

### Phase B — Focus (from bmad-product-brief)

Question framework to inject:
1. What specific problem are you solving? (real scenarios, real frustrations)
2. Who are the target users? (primary + secondary with vivid detail)
3. What makes this different from existing solutions?
4. What does success look like? (measurable outcomes)
5. What is explicitly OUT of scope for V1?
6. What's your timeline and resource constraints?

### Phase C — Structure (from bmad-create-epics-and-stories)

Decomposition rules to inject:
- Epics represent major user-facing capabilities
- Stories follow "As a [user], I want [capability], so that [value]" format
- Acceptance criteria use BDD: "Given [precondition], When [action], Then [outcome]"
- Assign roles based on skill match (map role skills to task requirements)
- Maximum 3 levels deep for MVP plans
- Each Epic should have 2-5 Stories; each Story should be independently deliverable
