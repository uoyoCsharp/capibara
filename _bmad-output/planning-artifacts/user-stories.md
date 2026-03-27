---
document_type: 'user-stories'
project_name: 'capibara'
version: '2.0'
date: '2026-03-27'
status: 'draft'
total_stories: 25
categories: 9
---

# Capibara User Stories (Detailed)

> Complete user story scenarios with step-by-step system walkthrough for design validation.

---

## 1. Project & Organization Setup

### US-01: Template-Based Project Creation

> **As a** new user, **I want to** select the BMAD Method template to quickly create a project, **so that** I can start using the system without configuring from scratch.

**Preconditions:** Electron app installed, no existing project

**Scenario:**

```
1. User opens Electron app, clicks "Create New Project"
2. Enters project name, description, associated code directory path
3. Selects organization template: "BMAD Software Team"
4. System auto-creates 6 roles, each pre-filled with:
   - persona (role definition text)
   - knowledgeBaseRefs (BMAD-related knowledge document references)
   - skillIds (corresponding BMAD skills)
   Roles include: Analyst (CTO-level), Architect (Manager-level), Developer, QA, UX Designer...
5. User sees the tree structure displayed in "Organization" panel
6. User can click any role to modify three elements (persona/knowledge/skills)
7. User checks requiresHumanApproval=true for top-level role (Analyst)
8. Project creation complete, ready to input requirements
```

**Acceptance Criteria:**
- All template roles created with non-empty persona, knowledge, and skills
- Organization tree visualized correctly in UI
- requiresHumanApproval toggle works per role
- User can modify any role's three elements after creation

---

### US-02: AI-Assisted Custom Organization Creation

> **As a** user unfamiliar with organization design, **I want to** describe my project to an AI assistant and receive organization structure recommendations, **so that** I get a suitable team structure without domain expertise.

**Preconditions:** User selects "Custom Team" template

**Scenario:**

```
1. User selects "Custom Team" template
2. Enters AI assistant conversation interface
3. User inputs: "I want to develop a React-based SaaS project management tool"
4. AI assistant responds:
   "Based on your needs, I suggest the following team structure:
   - Tech Director (global architecture decisions + final approval)
   - Product Manager (requirements analysis + user story decomposition)
   - Frontend Architect (React technical solutions + code review)
   - Frontend Developer (page implementation)
   - Backend Developer (API + database)
   - QA Engineer (test strategy + automated testing)

   I've pre-filled recommended role definitions and skills for each.
   Shall I create this structure?"
5. User confirms → system batch-creates roles
6. User adjusts in org panel: sets "Frontend Architect" requiresHumanApproval=true
7. User adds their project README to "Tech Director" knowledge base
```

**Acceptance Criteria:**
- AI assistant generates reasonable org structure based on project description
- All generated roles have meaningful persona and skill pre-fills
- User can modify/delete/add roles after AI generation
- Conversation history preserved for reference

---

### US-03: Manual Role Creation with Three Elements

> **As an** experienced user, **I want to** manually create roles and precisely configure persona, knowledge base, and skills, **so that** roles match my exact workflow.

**Preconditions:** Project exists with at least one role

**Scenario:**

```
1. User clicks "Add Role" in organization panel
2. Fills in basic info: name="Security Auditor", parent=Tech Director
3. Configures three elements:
   - Persona: User enters in text editor:
     "You are a senior security engineer specializing in OWASP Top 10,
      penetration testing, and secure coding practices..."
   - Knowledge: Adds files via file picker:
     security-guidelines.md, company-security-policy.md
   - Skills: Selects from skill library:
     [Builtin] Code Review + [Custom] uploads security-audit-prompt.md
4. Configures permissions: canApprove=true, requiresHumanApproval=false
5. Saves → role appears in organization tree under Tech Director
```

**Acceptance Criteria:**
- Persona supports rich text editing (markdown)
- Knowledge base supports file references (not inline content)
- Skill selection shows all three sources (builtin/template/custom) in unified list
- Role appears in correct position in org tree after save

---

## 2. Task Decomposition & Execution

### US-04: Simple Requirement Auto-Decomposition and Execution

> **As a** user, **I want to** input a simple requirement "Add remember-me checkbox to login page", **so that** the system automatically decomposes and completes it end-to-end.

**Preconditions:** Organization with roles set up, all roles requiresHumanApproval=false

**Scenario:**

```
1. User enters requirement in requirement panel
2. System creates Epic TaskNode (type=epic, title="Add remember-me to login")
3. System auto-creates DiscussionGroup bound to this Epic
4. Top-level role (Tech Director) + direct subordinates auto-join discussion group
5. Tech Director awakened (trigger: task_assigned)
6. Prompt construction:
   [Tech Director persona] + [Tech Director knowledge] + [Tech Director skills]
   + [Org context: subordinates are Frontend Dev, Backend Dev, QA]
   + [Task: remember-me feature]
   + [Available actions: send message / create subtask / vote]
7. Tech Director AI executes → via Agent API creates 2 Tasks:
   - Task-1: "Frontend: remember-me UI and localStorage logic" (assignee: Frontend Dev)
   - Task-2: "Security review: local storage of sensitive data" (assignee: QA)
   → Posts in discussion: "Decomposed into frontend implementation and security review"
8. Decomposition Advisor log: complexity=low, depth=2 (Epic->Task), within recommendation
9. Frontend Dev and QA auto-join discussion group, each awakened
10. Frontend Dev executes coding task → stores artifacts
    → Posts in discussion: "UI and logic complete, using encrypted localStorage"
11. QA awakened → executes security review
    → Posts (voteTag: APPROVE): "Storage strategy is sound, suggest adding expiration"
12. Frontend Dev sees feedback → posts: "Added 30-day expiration"
    → Posts (voteTag: APPROVE): "Implementation complete"
13. Tech Director awakened (all child tasks complete)
    → Reviews discussion context + artifacts
    → Posts (voteTag: APPROVE): "Feature complete, code quality good"
14. ConsensusDetector: all canApprove roles have voted APPROVE
    → Epic auto-marked as done
15. Narrative engine generates: "Remember-me feature delivered. Frontend Dev implemented
    encrypted localStorage solution. QA reviewed and approved with 30-day expiration added."
```

**Acceptance Criteria:**
- Epic → Task decomposition happens automatically
- Discussion group created and members managed automatically
- All vote tags correctly tracked by ConsensusDetector
- Consensus triggers auto-approval
- Narrative generated reflects actual events

---

### US-05: Complex Multi-Layer Decomposition

> **As a** user, **I want to** input "Build complete payment system (registration/payment/refund/OAuth)", **so that** the system decomposes it into multiple levels executed by the team.

**Preconditions:** Organization with multiple roles at different levels

**Scenario:**

```
1. User inputs requirement → Epic: "Payment System"
2. Tech Director awakened
3. Decomposition Advisor evaluates complexity: HIGH, suggests depth=3
4. Tech Director decomposes into 3 Stories (type=story):
   - Story-1: "Payment gateway integration" (assignee: Backend Architect)
   - Story-2: "Payment page UI" (assignee: Frontend Dev)
   - Story-3: "Payment security compliance" (assignee: Security Auditor)
5. Backend Architect awakened, further decomposes "Payment gateway integration":
   - Task-1: "Stripe API integration" (assignee: Backend Dev)
   - Task-2: "Payment callback handling" (assignee: Backend Dev)
   - Task-3: "Refund logic" (assignee: Backend Dev)
6. Tasks not further decomposed — direct execution
7. Backend Dev executes 3 Tasks serially (MVP: single active Run per role)
8. Each Task completion → discussion group message
9. All Tasks under Story-1 done → Backend Architect awakened for review
10. All Stories done → Tech Director awakened for final review
11. Consensus reached → Epic marked done
```

**Acceptance Criteria:**
- Three-level decomposition (Epic -> Story -> Task) works correctly
- Decomposition Advisor provides appropriate depth recommendation
- Serial execution per role enforced in MVP
- Bottom-up completion triggers parent role awakening at each level

---

### US-06: Decomposition Advisor Prevents Over-Decomposition

> **As the** system, **I want to** warn when AI attempts to over-decompose simple tasks, **so that** unnecessary task tree complexity is avoided.

**Preconditions:** A simple task assigned to a role

**Scenario:**

```
1. Frontend Dev receives Task: "Fix button color from blue to red"
2. Frontend Dev's AI attempts to decompose into 3 Subtasks
3. Decomposition Advisor evaluates: complexity=VERY LOW, recommended depth=0
4. System posts advisory message in discussion group:
   "This task has low complexity. Recommended to execute directly without decomposition."
5. Frontend Dev executes task directly instead of decomposing
```

**Acceptance Criteria:**
- Decomposition Advisor evaluates before allowing decomposition
- Advisory message posted when recommendation differs from AI's intent
- AI can still override advisory (it's a suggestion, not a hard block in MVP)

---

## 3. Discussion & Collaboration

### US-07: Auto Discussion Group Creation & Membership

> **As the** system, **I want to** auto-create discussion groups for Epics and dynamically manage membership, **so that** relevant roles can collaborate immediately.

**Preconditions:** Organization with roles set up

**Scenario:**

```
1. Epic "User Authentication System" created
2. System auto-creates DiscussionGroup bound to this Epic
3. Initial members: Epic assignee (Tech Director) + Tech Director's direct subordinates
4. Tech Director decomposes, creates Story assigned to Frontend Dev
5. Frontend Dev auto-joins discussion group
6. Frontend Dev creates Task assigned to QA
7. QA auto-joins discussion group
8. Discussion group member list updates in real-time in Electron UI
9. All members can see full message history from the point they joined
```

**Acceptance Criteria:**
- Discussion group auto-created on Epic creation
- Members auto-added when assigned tasks within the Epic's subtree
- Member list displayed and updated in real-time in UI
- New members see existing discussion history

---

### US-08: Dispute Detection & Superior Intervention

> **As a** parent role, **I want to** be automatically awakened when subordinate roles have unresolved disputes, **so that** I can make a final decision.

**Preconditions:** Multiple roles assigned tasks under same Epic, all auto-mode

**Scenario:**

```
1. Frontend Dev posts (voteTag: CONCERN):
   "Approach A's SSR rendering will cause slow initial page load"
2. Backend Dev replies (voteTag: CONCERN):
   "But CSR approach can't satisfy SEO requirements"
3. System detects: 2 CONCERNs + 0 APPROVEs in same discussion group, exceeding 2 rounds
4. Dispute detection rule triggers → awakens parent role (Tech Director)
5. Tech Director's prompt injected with: discussion summary + both viewpoints
6. Tech Director posts (voteTag: null):
   "Considering both factors, adopting Next.js ISR approach for performance + SEO balance"
7. Tech Director posts (voteTag: APPROVE): confirms technical decision
8. Frontend Dev posts (voteTag: APPROVE)
9. Backend Dev posts (voteTag: APPROVE)
10. Consensus reached → related tasks proceed
```

**Acceptance Criteria:**
- Dispute detection triggers after configurable threshold (N CONCERNs, 0 APPROVEs, M rounds)
- Parent role awakened with full dispute context in prompt
- Parent role's decision resolves the dispute
- All participants can subsequently vote APPROVE

---

### US-09: Discussion Auto-Summary for Context Injection

> **As a** newly-joined role, **I want to** receive a discussion summary instead of full message history, **so that** I can quickly understand context without reading all messages.

**Preconditions:** Discussion group has 15+ messages from prior discussions

**Scenario:**

```
1. Discussion group has 15 messages (technical approach discussion + several CONCERN exchanges)
2. QA assigned a new task, auto-joins discussion group
3. QA awakened to execute task — prompt construction:
   - Discussion auto-summary: "Team discussed SSR vs CSR approach. Tech Director decided
     on ISR approach for performance + SEO balance..."
   - Last 3 messages (most recent context)
   - NOT the full 15 messages
4. QA begins testing work with sufficient context understanding
5. Discussion summary auto-updates when new messages are posted
```

**Acceptance Criteria:**
- Summary generated/updated automatically on new messages
- Summary is concise (controlled token size)
- Prompt injection uses summary + last N messages (configurable, default 3)
- Summary accurately reflects key decisions and current state

---

## 4. Approval & Consensus

### US-10: Automatic Consensus Approval (Full-Auto Role)

> **As the** system, **I want to** auto-approve tasks when all canApprove roles vote APPROVE, **so that** the workflow proceeds without unnecessary delays.

**Preconditions:** All relevant roles have requiresHumanApproval=false

**Scenario:**

```
1. Frontend Dev completes task, posts message + submits artifacts in discussion
2. Tech Manager awakened for review (requiresHumanApproval=false)
3. Tech Manager AI reviews → posts (voteTag: APPROVE): "Code quality good"
4. ConsensusDetector checks: all canApprove roles for this task (Tech Manager) have APPROVED
5. Task status auto-transitions: awaiting_review → approved → done
6. Event triggered: check if all sibling tasks are complete
7. If all siblings done → awaken parent role for aggregation/review
```

**Acceptance Criteria:**
- ConsensusDetector correctly identifies all canApprove roles for a task
- Unanimous APPROVE triggers auto-approval
- Task status transitions correctly through state machine
- Sibling completion check triggers parent awakening

---

### US-11: Per-Role Human Approval Intervention

> **As a** human user, **I want to** receive approval notifications for roles configured with requiresHumanApproval=true, with rich context for decision making.

**Preconditions:** Tech Director has requiresHumanApproval=true

**Scenario:**

```
1. All sub-tasks complete → flow reaches Tech Director for final review
2. Tech Director has requiresHumanApproval=true
3. System does NOT execute Tech Director's AI review. Instead:
   → Electron desktop notification: "Your approval needed"
   → Approval panel displays:
     a. Narrative Engine "approval summary" (concise, decision-focused, readable in 30 seconds)
     b. Task tree status overview (visual tree with status indicators)
     c. Discussion group key decisions summary
     d. Deliverable artifact links for each sub-task
     e. Action buttons: [APPROVE] [REVISE] [DELEGATE]
4. User clicks [REVISE], types in feedback: "Login page missing forgot-password link"
5. System injects human feedback as discussion message (voteTag: REVISE, authorType: human)
6. Relevant roles awakened to process revision
7. After revision complete, flow returns to Tech Director → approval notification again
8. User clicks [APPROVE] → Epic completed
```

**Acceptance Criteria:**
- No AI execution when requiresHumanApproval=true
- Desktop notification fires correctly
- Approval panel shows all required context
- Approval summary is concise and decision-focused (different from daily narrative)
- Human votes injected as discussion messages with authorType=human
- Flow correctly resumes after human decision

---

### US-12: DELEGATE for Cross-Role Collaboration

> **As a** reviewer role (AI or human), **I want to** delegate new tasks to other roles when additional work is needed, **so that** deliverables are complete.

**Preconditions:** Task under review, reviewer discovers need for additional work

**Scenario:**

```
1. Tech Manager reviews Frontend Dev's output, discovers need for backend API
2. Tech Manager posts (voteTag: DELEGATE):
   "Need Backend Dev to provide user profile update API.
    Endpoint spec: PUT /api/users/:id with fields: name, email, avatar"
3. System processes DELEGATE:
   - Creates new TaskNode (type=task, assignee: Backend Dev)
     with description from DELEGATE message content
   - Original task status → blocked (waiting for new task completion)
   - Backend Dev auto-joins discussion group
   - Backend Dev awakened (trigger: task_assigned)
4. Backend Dev completes API → posts (voteTag: APPROVE): "API implemented"
5. Tech Manager reviews → posts (voteTag: APPROVE)
6. New task done → original task unblocked
7. Frontend Dev awakened → integrates real API
8. Frontend Dev posts update → Tech Manager reviews → APPROVE
9. Full task flow complete
```

**Acceptance Criteria:**
- DELEGATE vote tag triggers new TaskNode creation
- Original task correctly set to blocked status
- New task assignee auto-joins discussion group
- Blocked task unblocks when delegated task completes
- Original task flow resumes after unblock

---

## 5. Execution & Failure Handling

### US-13: Normal Task Execution Flow

> **As an** AI role, **I want to** be awakened, receive a constructed prompt, execute via UtilityProcess, and report results, **so that** the workflow progresses.

**Preconditions:** Role is active, has assigned task, budget not exceeded

**Scenario:**

```
1. Frontend Dev awakened (trigger: task_assigned)
2. System runs pre-execution gate checks:
   - Role status = active ✓
   - Budget not exceeded ✓
   - No active Run for this role ✓
   - Worker process ready ✓
3. Creates Run instance (status: queued → running)
4. PromptBuilder constructs system prompt:
   [Frontend Dev's persona]
   [Frontend Dev's knowledge base document contents]
   [Frontend Dev's selected skill instructions]
   [Org context: parent is Tech Manager, siblings: Backend Dev, QA]
   [Task description + parent task context]
   [Discussion group latest summary + last 3 messages]
   [Available actions: POST messages with voteTags, complete task, report issues]
5. WorkerService dispatches Run to UtilityProcess
6. UtilityProcess invokes Skill Provider to get execution parameters
7. Executes via Claude CLI (working directory = project code directory)
8. Execution completes → Run status: succeeded
9. AI posts discussion message via Agent API: "Task complete, implemented xxx feature"
10. Cost entry recorded (token count + USD cost)
11. Event emitted: task:completed → triggers wake of reviewer role
```

**Acceptance Criteria:**
- All gate checks pass before Run creation
- Prompt includes all 7 components (3 user-configured + 4 system-injected)
- Execution happens in UtilityProcess (not Main process)
- Run lifecycle tracked correctly (queued → running → succeeded)
- Cost tracking per Run
- Discussion message posted on completion
- Wake event emitted for reviewer

---

### US-14: Execution Failure with Auto-Retry and Escalation

> **As the** system, **I want to** auto-retry failed runs and escalate to parent roles when limit is reached, **so that** transient failures are handled and persistent failures get human-like intervention.

**Preconditions:** maxRetryOnFailure=3 configured

**Scenario:**

```
1. Backend Dev assigned "Database migration script" task
2. Run-1 FAILED: SQL syntax error
   → Auto-retry (retry count: 1/3)
3. Run-2 FAILED: permission denied
   → Auto-retry (retry count: 2/3)
4. Run-3 FAILED: dependent table doesn't exist
   → Retry count reaches maxRetryOnFailure=3
5. System escalates: awakens parent role (Tech Manager) with trigger: retry_failed
6. Tech Manager's prompt includes: 3 failure log summaries + error analysis
7. Tech Manager posts in discussion: "Analyzed 3 failures — root cause is dependency table
   missing. Need to run migration for users table first before profiles table."
8. Tech Manager creates corrected Task with proper sequencing
9. Backend Dev re-executes with corrected approach → succeeds
```

**Acceptance Criteria:**
- Retry count tracked per task (not per Run)
- Each retry creates a new Run instance
- On retry exhaustion, parent role awakened with failure context
- Failure logs summarized and injected into parent's prompt
- Escalation event clearly marked in activity timeline

---

### US-15: Top-Level Failure Mandatory Human Notification

> **As the** system, **I want to** force-notify the human user when escalation reaches the top-level role and still fails, **so that** the system never enters an unrecoverable silent failure state.

**Preconditions:** Top-level role (parentId=null) has failed, retry exhausted

**Scenario:**

```
1. A task escalates to Tech Director (top-level, parentId=null)
2. Tech Director executes and also fails, retry exhausted
3. No higher level to escalate to
4. System forces desktop notification to human user:
   "System cannot automatically resolve this issue. Your intervention is required."
5. UI displays:
   - Complete failure chain (which roles failed and why)
   - All related Run logs
   - Discussion group context
   - Suggested actions
6. This notification fires regardless of Tech Director's requiresHumanApproval setting
7. Human reviews and provides guidance via discussion group
```

**Acceptance Criteria:**
- Top-level failure ALWAYS notifies human (override requiresHumanApproval)
- Full failure chain visible in UI
- All related logs accessible
- Human can respond via discussion group to guide resolution

---

## 6. Observability & Narrative

### US-16: Narrative-Driven Dashboard

> **As a** user, **I want to** see a narrative-form project status on the Dashboard, **so that** I can understand current progress in 30 seconds.

**Preconditions:** Project has active tasks and discussion history

**Scenario:**

```
1. User opens Electron app Dashboard
2. Narrative Engine queries current org Snapshot:
   - Active Epic count and progress percentages
   - Currently executing roles and their tasks
   - Recent discussion group key decisions
   - Budget consumption
3. Template rendering + LLM polish generates narrative:
   "Payment system feature is progressing (60%). Backend Dev has completed
    Stripe integration and callback handling, currently working on refund logic.
    Frontend payment page is waiting for backend API readiness.
    Security Auditor raised a CONCERN about PCI compliance — Tech Director
    has intervened in the discussion.
    Budget usage: $18.50 / $50.00 (37%)."
4. Dashboard simultaneously displays:
   - Organization tree visualization (status indicator per role)
   - Task tree status overview
   - Recent activity timeline
   - Budget gauge
```

**Acceptance Criteria:**
- Narrative generated from deterministic DB queries (no hallucination)
- Narrative readable and understandable in 30 seconds
- Dashboard shows narrative + visual components together
- Auto-refreshes on significant state changes (via domain-changed event)

---

### US-17: Real-Time Discussion Message Flow

> **As a** user, **I want to** see discussion group messages in real-time in the Electron UI, **so that** I can follow AI role collaboration as it happens.

**Preconditions:** Active discussion group with ongoing AI role activity

**Scenario:**

```
1. User clicks "Discussion" panel in sidebar
2. Sees discussion group list organized by Epic, each showing unread message count
3. Clicks a discussion group → message flow interface (chat-like)
4. Each message displays:
   - Sender role avatar and name
   - Message content
   - VoteTag badge (if present) in prominent color:
     APPROVE=green, REVISE=orange, CONCERN=yellow, DELEGATE=blue
   - Timestamp
   - authorType indicator (AI role vs Human)
5. New messages push in real-time (Main → Renderer via IPC new-message event)
6. User can type and send messages in the discussion group (as human identity)
7. User can click vote buttons [APPROVE] [REVISE] [CONCERN] [DELEGATE] to cast structured votes
```

**Acceptance Criteria:**
- Real-time message delivery via IPC events
- Vote tags displayed with distinct visual styling
- Human and AI messages visually distinguished
- User can send messages and vote with equal authority
- Unread count updates correctly

---

## 7. Skill Management

### US-18: Select Built-in Skills for Roles

> **As a** user, **I want to** browse and select system built-in skills for my roles, **so that** I can enhance role capabilities.

**Preconditions:** Role exists in organization

**Scenario:**

```
1. User edits "Backend Dev" role
2. Opens "Skills" tab, browses system built-in skill library:
   - [Builtin] Task Decomposition — Decompose complex tasks into subtasks
   - [Builtin] Code Review — Review code quality and best practices
   - [Builtin] Security Audit — Check OWASP Top 10 security issues
   - [Builtin] Test Generation — Auto-generate unit/integration tests
   - [Builtin] API Design — Design RESTful API specifications
3. User checks "Code Review" and "API Design"
4. Saves → Backend Dev's prompt will include these two skill instructions
```

**Acceptance Criteria:**
- Built-in skills listed with name and description
- Multiple skills can be selected per role
- Selected skills reflected in prompt construction
- Skills can be added/removed without affecting other role settings

---

### US-19: Use BMAD Preset Skills with Customization

> **As a** user using BMAD template, **I want to** have roles pre-configured with BMAD skills that I can adjust, **so that** I can start with best practices and customize as needed.

**Preconditions:** Project created with BMAD Software Team template

**Scenario:**

```
1. Project created with BMAD template
2. Architect role auto-bound with:
   - [BMAD] bmad-architect — System architecture design
   - [BMAD] bmad-code-review — Code review methodology
3. User wants to add security audit capability
4. In Skills tab, [BMAD] and [Builtin] skills shown in unified list
5. User additionally selects [Builtin] Security Audit
6. Final Architect prompt includes: bmad-architect + bmad-code-review + Security Audit
7. User can also remove pre-configured BMAD skills if not needed
```

**Acceptance Criteria:**
- Template pre-configures skills per role
- BMAD and Builtin skills mixable in same role
- Pre-configured skills can be removed
- Additional skills can be added on top of template defaults

---

### US-20: Upload Custom Skill Prompt

> **As an** advanced user, **I want to** upload my own prompt templates as custom skills, **so that** I can use my own prompt engineering methods.

**Preconditions:** User has custom prompt template files

**Scenario:**

```
1. User goes to "Skill Management" settings page
2. Clicks "Create Custom Skill"
3. Fills in: name="Domain-Driven Design Analysis", description="Analyze bounded contexts..."
4. Uploads or pastes prompt template content (markdown/text)
5. Saves → skill appears in skill library tagged as [Custom]
6. Can be selected in any role's Skills tab
7. When role executes, this custom prompt content is included in system prompt
```

**Acceptance Criteria:**
- Custom skill creation supports text input and file upload
- Custom skills tagged distinctly from builtin/template
- Custom skills available for selection in all roles
- Prompt content correctly injected during execution

---

## 8. Event & Notification

### US-21: Event Digester Batch Notification

> **As a** user, **I want to** have rapid state changes merged into single summary notifications, **so that** I'm not overwhelmed by high-frequency updates.

**Preconditions:** Multiple tasks completing in rapid succession

**Scenario:**

```
1. Backend Dev completes 3 Tasks within 30 seconds
2. Event Digester collects within time window:
   - task:completed (Task-1: Stripe integration)
   - task:completed (Task-2: Callback handling)
   - task:completed (Task-3: Refund logic)
3. Time window expires → merge into single summary:
   "Backend Dev completed 3 tasks: Stripe integration, Callback handling, Refund logic"
4. Single aggregated message posted to discussion group
5. UI shows one notification instead of 3 separate ones
6. Reviewer role awakened once (not 3 times) for batch review
```

**Acceptance Criteria:**
- Events within configurable time window (default 30s) are aggregated
- Aggregated notification is clear and includes all individual events
- Discussion group receives single summary message
- Wake events are coalesced (reviewer awakened once for batch)

---

## 9. Edge Cases & Safety

### US-22: Budget Exceeded Auto-Pause

> **As the** system, **I want to** pause all execution when project budget is exceeded, **so that** costs are controlled.

**Preconditions:** Project budget limit set

**Scenario:**

```
1. Project budget: $50.00, already consumed: $49.50
2. Backend Dev executes a Run, consuming $1.20
3. Total consumption: $50.70 > budget limit $50.00
4. System pauses ALL roles (all role status → paused)
5. All pending wakes queued (not lost)
6. Electron UI displays warning: "Project budget exceeded. All execution paused."
7. User can increase budget in Settings → roles resume to active
8. Pending wakes consumed → execution continues
```

**Acceptance Criteria:**
- Budget check after each Run completion
- All roles paused simultaneously on exceed
- Pending wakes preserved (not lost)
- Clear UI warning with action path (increase budget)
- Execution resumes correctly after budget increase

---

### US-23: Manual Role Pause and Resume

> **As a** user, **I want to** manually pause and resume individual roles, **so that** I can temporarily control which parts of the organization are active.

**Preconditions:** Role is active with pending or in-progress work

**Scenario:**

```
1. User right-clicks "Frontend Dev" in organization panel
2. Selects "Pause Role"
3. Frontend Dev status → paused
4. If Frontend Dev has an active Run → Run completes but no new Runs started
5. Any incoming wake events → stored in pendingWakes queue
6. User later selects "Resume Role" → status → active
7. System consumes pendingWakes → Frontend Dev resumes pending tasks
```

**Acceptance Criteria:**
- Active Run allowed to complete (not interrupted)
- New Runs blocked while paused
- Wake events queued, not lost
- Resume triggers pending wake consumption
- UI clearly shows paused status

---

### US-24: REVISE Cycle Circuit Breaker

> **As the** system, **I want to** escalate when the same task is revised more than 3 times, **so that** ineffective revision loops don't waste budget.

**Preconditions:** maxReviseAttempts=3 configured

**Scenario:**

```
1. Frontend Dev completes task → Tech Manager posts (voteTag: REVISE) — 1st
2. Frontend Dev revises → Tech Manager posts (voteTag: REVISE) — 2nd
3. Frontend Dev revises → Tech Manager posts (voteTag: REVISE) — 3rd
4. DiscussionService detects: REVISE count for this task = 3 = maxReviseAttempts
5. Auto-escalation to Tech Manager's parent (Tech Director)
6. Tech Director awakened with context:
   - All 3 REVISE messages with feedback content
   - Frontend Dev's 3 revision attempts
   - Discussion summary
7. Tech Director analyzes root cause of repeated failures
8. Tech Director may: reassign task, modify task scope, or provide detailed guidance
```

**Acceptance Criteria:**
- REVISE count tracked per TaskNode (not per discussion group)
- Escalation triggers at configurable threshold
- Parent role receives full revision history in prompt
- Escalation clearly logged in activity timeline

---

### US-25: Human Direct Participation in Discussions

> **As a** human user, **I want to** send messages and vote in any discussion group with equal authority, **so that** I can directly steer AI collaboration when needed.

**Preconditions:** Active discussion group with AI roles collaborating

**Scenario:**

```
1. User browses discussion group panel, reads AI roles' conversation
2. User notices discussion direction deviating from expectation
3. User types message: "Please note: our target users are enterprise clients, not individual users"
4. Message saved with authorType=human, displayed with distinct visual style
5. Next time any AI role is awakened, prompt includes user's message in discussion context
6. User can also click [APPROVE] / [REVISE] / [CONCERN] / [DELEGATE] buttons
   → Human votes injected as DiscussionMessage with voteTag + authorType=human
7. Human APPROVE vote counts equally in ConsensusDetector
8. If human is the only canApprove participant and votes APPROVE → task approved
```

**Acceptance Criteria:**
- Human messages clearly distinguished in UI (different style/badge)
- Human messages included in discussion summary and prompt injection
- Human votes have equal weight in consensus detection
- Human can vote without being a "role" in the org tree (system-level participant)
- Vote buttons available in discussion group UI
