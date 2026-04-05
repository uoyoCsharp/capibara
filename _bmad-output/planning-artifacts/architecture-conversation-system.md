---
version: '2.0'
project_name: 'capibara-conversation-system'
user_name: 'uoyo'
date: '2026-04-04'
status: 'draft-v2'
inputDocuments:
  - _bmad-output/planning-artifacts/prd-conversation-system.md
  - _bmad-output/planning-artifacts/architecture.md
  - _bmad-output/project-context.md
designPremise: greenfield
stepsCompleted: [1, 2, 3, 4, 5, 6, 7, 8]
---

# Capibara Conversation System — Architecture v2 (Greenfield)

> **Premise**: This is a brand-new project with no live users. No legacy compatibility constraints apply. Bold new patterns are encouraged, provided they earn their complexity.

---

## Table of Contents

1. [Design Principles](#1-design-principles)
2. [Architecture Overview](#2-architecture-overview)
3. [ADR Record](#3-adr-record)
4. [Conversation Model](#4-conversation-model)
5. [Conversation State Machine](#5-conversation-state-machine)
6. [Routing Policy Engine](#6-routing-policy-engine)
7. [Wake Trigger Extension](#7-wake-trigger-extension)
8. [MCP Tool Extensions](#8-mcp-tool-extensions)
9. [Context Injection](#9-context-injection)
10. [Timeout & Escalation](#10-timeout--escalation)
11. [Cycle Detection & Safety](#11-cycle-detection--safety)
12. [Concurrent Conversation Management](#12-concurrent-conversation-management)
13. [Human Interaction Model](#13-human-interaction-model)
14. [Data Model Extensions](#14-data-model-extensions)
15. [Event Extensions](#15-event-extensions)
16. [Code Structure](#16-code-structure)
17. [Prompt Builder Extensions](#17-prompt-builder-extensions)
18. [Audit & Observability](#18-audit--observability)
19. [Non-Functional Requirements](#19-non-functional-requirements)
20. [Implementation Phasing](#20-implementation-phasing)
21. [Acceptance Checklist](#21-acceptance-checklist)

---

## 1. Design Principles

### 1.1 Premises

1. **No legacy compatibility burden**: existing data models and execution flows can be replaced or extended freely.
2. **Deliverability first**: build what ships reliably first, then enhance.
3. **Complexity must pay rent**: every abstraction must justify itself with concrete, traced value.

### 1.2 Core Principles

| # | Principle | Implication |
|---|-----------|-------------|
| P1 | **Simple Core, Pluggable Edge** | Conversation kernel stays minimal. Routing strategies, timeout policies, and escalation rules are injected, never hardcoded. |
| P2 | **Conversation = Durable Workflow** | A multi-turn conversation is NOT a message queue. It is a recoverable, auditable workflow instance with explicit state transitions. |
| P3 | **Default-to-AI Hierarchy** | Unless gated by `requiresHumanApproval=true`, all routing defaults to supervisor AI. Human is the exception, not the rule. |
| P4 | **Local-First Reliability** | All state in SQLite. No network dependency. Crash-recover from persisted workflow state. |
| P5 | **Event-Driven Integration** | Conversation system integrates with existing OrgOrchestrator via the EventBus, not by forking the event loop. |

---

## 2. Architecture Overview

### 2.1 Architecture Style

- **Modular Monolith** — domain modules with explicit boundaries inside a single Main Process.
- **Event-Driven Kernel** — conversation lifecycle events flow through the existing Emittery EventBus.
- **Durable Workflow Runtime** — conversation state persisted to SQLite before any side effect; recoverable after crash.

### 2.2 What We Do NOT Introduce

- Microservice decomposition (unnecessary at current scale).
- External message queues (SQLite + EventBus is sufficient for single-user desktop).
- Heavy DDD ceremony (aggregates, domain events bus, saga orchestrators).
- Separate ORM layer (hand-written SQL maintained).

### 2.3 Integration with Base Architecture

The conversation system **extends** — not replaces — the base architecture (v2.0). Specifically:

| Base Architecture Component | How Conversation System Integrates |
|---|---|
| `OrgOrchestrator` | Subscribes to new `conversation:*` events. Unchanged event loop structure. |
| `WakeTrigger` type | Extended with `discussion_reply` and `conversation_escalation` triggers. |
| `PromptBuilder` | Extended with conversation context section (full history + token budget). |
| `DiscussionGroup / DiscussionMessage` | Reused as conversation message storage. New fields added. |
| `PendingWake` | Reused for conversation wake queueing with new priority field. |
| `MCP Tool Registry` | New tools registered via existing `McpToolRegistry` pattern. |
| `ExecutionEngine` | `--resume <sessionId>` leveraged for cross-run conversation continuity. |

### 2.4 High-Level Flow

```
Agent executing task
  |
  +-- Encounters blocker -> calls MCP `capibara_ask_question`
  |                           |
  |                           v
  |                     ConversationWorkflowService
  |                           |
  |                           +-- 1. Persist question as DiscussionMessage
  |                           +-- 2. Create/update ConversationWorkflow -> WAITING_FOR_REPLY
  |                           +-- 3. RoutingPolicyEngine resolves recipient
  |                           |       +-- human gate check
  |                           |       +-- supervisor resolution
  |                           |       +-- skill-match resolution
  |                           +-- 4. Create PendingWake for recipient
  |                           +-- 5. Emit conversation:question-posted
  |
  +-- Agent run ends (CLI exits after ask_question)
  |
  v
Recipient woken (AI role or Human)
  |
  +-- AI: ExecutionEngine creates Run with trigger=discussion_reply
  |        PromptBuilder injects full conversation history
  |        Agent replies -> MCP `capibara_discussion_post` or inline
  |        System detects reply -> wakes original asker
  |
  +-- Human: UI notification -> human types reply -> triggers discussion_reply wake
```

---

## 3. ADR Record

### ADR-v2-01: Conversation as Durable Workflow

**Context**: Multi-turn conversation involves asynchronous waits (seconds to hours), process restarts, and potential crashes between question and reply.

**Decision**: Model each conversation as a `ConversationWorkflow` instance with an explicit state machine (`IDLE -> WAITING_FOR_REPLY -> REPLY_RECEIVED -> RESUMED -> RESOLVED | ESCALATED | TIMED_OUT`), persisted to SQLite before any side effect.

**Consequences**:
- Crash recovery: on restart, scan for workflows in `WAITING_FOR_REPLY` or `REPLY_RECEIVED` and resume processing.
- Auditable: every state transition is logged.
- Testable: state machine is pure function, trivially unit-testable.

### ADR-v2-02: Unified Routing Policy Engine

**Context**: Routing decisions (who should respond?) involve multiple rules — role hierarchy, skill matching, human gating, availability checks, cycle detection. Scattering these in multiple services creates inconsistency.

**Decision**: Introduce `RoutingPolicyEngine` as the single-entry-point service that evaluates all routing rules in a deterministic pipeline:

```
recipientTarget resolution
  -> human gate check
  -> availability check
  -> cycle detection
  -> fallback escalation
  -> final recipient
```

**Consequences**:
- All routing logic auditable from one code path.
- New routing rules added as pipeline steps, not scattered conditionals.

### ADR-v2-03: Human Gate as System-Level Constraint

**Context**: PRD requires that only roles with `requiresHumanApproval=true` can request human replies. All others must route to supervisor AI.

**Decision**: Enforce this as a hard gate in `RoutingPolicyEngine`, not as a UI-level filter. If an agent specifies `target=human` but their role lacks the flag, the system silently rewrites to `supervisor` and logs an audit reason.

**Consequences**:
- No agent can bypass the gate regardless of prompt injection.
- Audit trail records every gate enforcement.
- Human notifications are guaranteed relevant (no spam from non-gated roles).

### ADR-v2-04: Reuse DiscussionGroup for Conversation Messages

**Context**: The existing `DiscussionGroup` / `DiscussionMessage` model already stores messages with author, type, and metadata.

**Decision**: Reuse `DiscussionMessage` for conversation messages by adding:
- `intent` field (`question` | `reply` | `escalation` | `resolution` | `vote` | `general`)
- `recipientTarget` stored in `metadata` JSON
- `inReplyToMessageId` for threading

Do NOT create a separate `conversation_messages` table. One message table, one source of truth.

**Consequences**:
- Zero data migration for existing discussion features.
- Conversation and review messages live in the same timeline — natural for UI rendering.
- Slightly more complex query filters (where `intent = 'question'`), but this is trivial with SQL.

### ADR-v2-05: Priority-Based Dispatch Queue

**Context**: Multiple conversations may be active simultaneously. An urgent escalation should preempt a routine question.

**Decision**: Add `priority` column to `pending_wakes` table. Orchestrator drains queue by `priority DESC, created_at ASC`.

Priority levels:

| Priority | Meaning |
|----------|---------|
| 0 | Normal task wake (task_assigned, task_completed, etc.) |
| 1 | Conversation question (discussion_reply) |
| 2 | Escalation (conversation_escalation, timeout) |
| 3 | System-critical (top-level escalation, human intervention) |

**Consequences**:
- Urgent conversations bypass the queue naturally.
- No separate "priority queue" infrastructure needed — just a SQL ORDER BY.

### ADR-v2-06: Session Resume for Conversation Continuity

**Context**: Claude Code CLI supports `--resume <sessionId>` to continue a previous session with full context.

**Decision**: When an agent is woken by `discussion_reply`, the system MUST pass the original `sessionId` from the asking Run. This allows the agent to resume with full memory of what it was working on when it asked the question.

**Consequences**:
- Agent sees its own previous thought process + the new reply.
- No need to re-inject the entire task description — session context handles it.
- `sessionId` must be stored on the `Run` entity and propagated to the wake target.

---

## 4. Conversation Model

### 4.1 ConversationWorkflow Entity

A `ConversationWorkflow` represents a single question-reply cycle within a task's discussion.

```typescript
interface ConversationWorkflow {
  id: string;                       // UUID
  orgId: string;                    // Organization scope
  taskNodeId: string;               // Task that triggered the conversation
  discussionGroupId: string;        // Discussion group where messages live
  askingRoleId: string;             // Role that asked the question
  askingRunId: string;              // Run that was active when question was asked
  askingSessionId: string | null;   // CLI sessionId for --resume
  questionMessageId: string;        // The DiscussionMessage that contains the question
  replyMessageId: string | null;    // The DiscussionMessage that contains the reply (when received)
  respondentRoleId: string | null;  // Resolved responder (null until routing completes)
  respondentType: 'ai' | 'human';  // Whether responder is AI or human
  state: ConversationWorkflowState; // Current state machine state
  depth: number;                    // Conversation chain depth (for cycle detection)
  parentWorkflowId: string | null;  // If this is a cascaded question from another conversation
  priority: number;                 // Dispatch priority (0-3)
  timeoutAt: string | null;         // When this workflow should escalate
  resolvedAt: string | null;        // When this workflow was resolved
  auditReason: string | null;       // Routing audit trail
  createdAt: string;
  updatedAt: string;
}
```

### 4.2 Relationship to Existing Entities

```
Organization (1) --* ConversationWorkflow
TaskNode (1) --* ConversationWorkflow     (one task may have multiple Q&A rounds)
DiscussionGroup (1) --* ConversationWorkflow (workflows link to their discussion)
DiscussionMessage (1) --0..1 questionMessageId
DiscussionMessage (1) --0..1 replyMessageId
Run (1) --0..1 askingRunId                (the Run that asked)
Role (1) --* askingRoleId
Role (0..1) --* respondentRoleId
ConversationWorkflow (0..1) --* parentWorkflowId (cascade chain)
```

### 4.3 Message Intent Extension

Existing `DiscussionMessage` gains an `intent` field to distinguish conversation messages from review votes:

```typescript
type MessageIntent =
  | 'question'    // Agent asks a question
  | 'reply'       // Agent or Human replies to a question
  | 'escalation'  // System escalates due to timeout or cycle
  | 'resolution'  // Conversation marked resolved
  | 'vote'        // Existing review vote (APPROVE / REVISE / etc.)
  | 'general';    // Free-form discussion message
```

Default for legacy messages: `intent = 'vote'` if `voteTag` is non-null, otherwise `intent = 'general'`.

---

## 5. Conversation State Machine

### 5.1 States

```typescript
type ConversationWorkflowState =
  | 'waiting_for_reply'   // Question posted, waiting for response
  | 'reply_received'      // Reply posted, ready to wake asker
  | 'resumed'             // Asker has been woken with reply context
  | 'resolved'            // Conversation completed successfully
  | 'escalated'           // Escalated to higher role due to timeout or cycle
  | 'timed_out'           // Timed out without reply (terminal)
  | 'cancelled';          // Manually cancelled by human (terminal)
```

### 5.2 State Transition Diagram

```
                           +--------------------------------------+
                           |          [ask_question]              |
                           |                                       |
                           v                                       |
                  +-----------------+                              |
                  | waiting_for_reply|---- timeout ---->+-----------+--+
                  +--------+--------+                  | timed_out    |
                           |                           +-------------+
                           | reply posted
                           v
                  +-----------------+
                  | reply_received   |
                  +--------+--------+
                           | asker woken
                           v
                  +-----------------+
                  | resumed          |
                  +--------+--------+
                           |
                +----------+----------+
                v          v          v
         +----------+ +----------+ +--------------+
         | resolved  | | escalated| |waiting_for_  | (ask follow-up
         +----------+ +----------+ |reply [new WF] |  -> new workflow)
                                    +--------------+

         +----------+
         | cancelled | (human intervention at any non-terminal state)
         +----------+
```

### 5.3 Transition Rules

| From | To | Trigger | Side Effects |
|------|-----|---------|-------------|
| -- | `waiting_for_reply` | MCP `ask_question` called | Persist question message, create PendingWake for respondent |
| `waiting_for_reply` | `reply_received` | Reply message posted | Update workflow, cancel timeout timer |
| `waiting_for_reply` | `escalated` | Timeout or cycle detected | Create new workflow targeting next-level, notify human if top-level |
| `waiting_for_reply` | `cancelled` | Human cancels conversation | Mark resolved, no wake |
| `reply_received` | `resumed` | Asker woken with `discussion_reply` trigger | Create Run with `--resume <sessionId>` |
| `resumed` | `resolved` | Asker completes task or calls `mark_resolved` | Archive workflow |
| `resumed` | `waiting_for_reply` (new WF) | Asker asks follow-up question | Create child workflow with incremented depth |
| `resumed` | `escalated` | Asker decides reply is insufficient, escalates | Route to next level |

### 5.4 Implementation

The state machine is a pure function with no side effects:

```typescript
interface ConversationTransition {
  from: ConversationWorkflowState;
  to: ConversationWorkflowState;
  guard?: (workflow: ConversationWorkflow, context: TransitionContext) => boolean;
}

const CONVERSATION_TRANSITIONS: ConversationTransition[] = [
  { from: 'waiting_for_reply', to: 'reply_received' },
  { from: 'waiting_for_reply', to: 'escalated' },
  { from: 'waiting_for_reply', to: 'timed_out' },
  { from: 'waiting_for_reply', to: 'cancelled' },
  { from: 'reply_received', to: 'resumed' },
  { from: 'resumed', to: 'resolved' },
  { from: 'resumed', to: 'escalated' },
  // Note: follow-up creates a NEW workflow, not a state transition on this one
];

function canTransition(
  current: ConversationWorkflowState,
  target: ConversationWorkflowState,
  workflow: ConversationWorkflow,
  context: TransitionContext,
): boolean {
  const transition = CONVERSATION_TRANSITIONS.find(
    (t) => t.from === current && t.to === target
  );
  if (!transition) return false;
  return transition.guard ? transition.guard(workflow, context) : true;
}
```

---

## 6. Routing Policy Engine

### 6.1 Responsibility

Single entry point for all "who should respond?" decisions. Evaluates a deterministic pipeline of rules, producing a `RoutingDecision`.

### 6.2 Interface

```typescript
interface RoutingRequest {
  askingRoleId: string;
  orgId: string;
  taskNodeId: string;
  recipientTarget: RecipientTarget;
  questionContent: string;
  conversationDepth: number;
}

type RecipientTarget =
  | { type: 'supervisor' }
  | { type: 'human' }
  | { type: 'role'; roleId: string }
  | { type: 'any' };       // System determines best responder

interface RoutingDecision {
  respondentRoleId: string | null;   // null only when routed to human
  respondentType: 'ai' | 'human';
  priority: number;
  auditReason: string;               // Human-readable explanation of routing chain
  wasRewritten: boolean;             // true if recipientTarget was changed by a gate
}

interface IRoutingPolicyEngine {
  resolve(request: RoutingRequest): Promise<RoutingDecision>;
}
```

### 6.3 Pipeline Steps (evaluated in order)

```
Step 1: Human Gate Check
  | if target=human AND askingRole.requiresHumanApproval !== true
  |   -> rewrite to supervisor, log 'human_target_blocked_by_role_gate'
  |
Step 2: Specific Role Resolution
  | if target=role AND role is active AND not in active conversation
  |   -> route to specified role
  | else -> fall through to supervisor
  |
Step 3: Supervisor Resolution
  | if target=supervisor OR rewritten from human/role
  |   -> resolve askingRole.parentId
  |   -> if parent exists and active -> route to parent
  |   -> if parent busy -> enqueue with priority
  |   -> if no parent (top-level) -> see Step 6
  |
Step 4: Skill-Match Resolution (for target=any)
  | find peer roles with matching skill categories
  | rank by: skill relevance > current load (fewer active runs = better)
  | -> route to best match
  | -> if no match -> fall through to supervisor (Step 3)
  |
Step 5: Cycle Detection
  | if respondent appeared in conversation chain within last N hops
  |   -> skip, escalate to respondent's parent
  | if depth >= maxConversationDepth
  |   -> force escalation
  |
Step 6: Top-Level Fallback
  | if no AI role available (top of hierarchy reached)
  |   -> route to human (mandatory, regardless of requiresHumanApproval)
  |   -> emit 'escalation:top-level' event
  |   -> priority = 3 (system-critical)
```

### 6.4 Routing Decision Examples

| Scenario | Asking Role | Target | Gate Result | Final Respondent |
|----------|-------------|--------|-------------|-----------------|
| Dev asks supervisor | Developer | supervisor | -- | Engineering Manager (AI) |
| Dev asks human (no flag) | Developer (requiresHumanApproval=false) | human | BLOCKED | Engineering Manager (AI) |
| Analyst asks human (has flag) | Analyst (requiresHumanApproval=true) | human | ALLOWED | Human |
| Dev asks specific peer | Developer | role:QA | -- | QA (if available) |
| Cascaded: EM asks CTO | EM | supervisor | -- | CTO |
| Top-level: CTO has no parent | CTO | supervisor | -- | Human (forced) |
| Cycle: A->B->A detected | A | supervisor (B) | cycle break | B's parent |

---

## 7. Wake Trigger Extension

### 7.1 New Triggers

Add to the existing `WakeTrigger` union:

```typescript
type WakeTrigger =
  // ... existing 9 triggers ...
  | 'discussion_reply'           // A reply was posted to a conversation the role is waiting on
  | 'conversation_escalation';   // A conversation was escalated to this role
```

### 7.2 Integration with OrgOrchestrator

The existing `OrgOrchestrator.handleEvent()` subscribes to new event types:

```typescript
// In OrgOrchestrator.start()
this.eventBus.on('conversation:reply-posted', (e) => void this.handleEvent(e));
this.eventBus.on('conversation:escalated', (e) => void this.handleEvent(e));
this.eventBus.on('conversation:timed-out', (e) => void this.handleEvent(e));
```

Wake target calculation for conversation events:

```typescript
// In OrgOrchestrator.calculateWakeTargets()
case 'conversation:reply-posted': {
  const workflow = payload.workflow as ConversationWorkflow;
  return [{
    roleId: workflow.askingRoleId,
    orgId: workflow.orgId,
    taskNodeId: workflow.taskNodeId,
    trigger: 'discussion_reply',
  }];
}
case 'conversation:escalated': {
  const workflow = payload.workflow as ConversationWorkflow;
  return [{
    roleId: workflow.respondentRoleId!,
    orgId: workflow.orgId,
    taskNodeId: workflow.taskNodeId,
    trigger: 'conversation_escalation',
  }];
}
```

### 7.3 Session Resume on `discussion_reply`

When `ExecutionEngine` creates a Run for a `discussion_reply` wake, it MUST use the original asking Run's `sessionId`:

```typescript
// In ExecutionEngine, when creating a Run for discussion_reply trigger
if (trigger === 'discussion_reply') {
  const workflow = await conversationWorkflowRepo.findActiveByRoleAndTask(roleId, taskNodeId);
  if (workflow?.askingSessionId) {
    // Resume the CLI session so the agent has full prior context
    cliArgs.push('--resume', workflow.askingSessionId);
  }
}
```

---

## 8. MCP Tool Extensions

### 8.1 New Tools

| Tool | Input Schema | Description |
|------|-------------|-------------|
| `capibara_ask_question` | `{ taskId, question, recipientTarget?, urgency? }` | Post a question and pause execution |
| `capibara_mark_conversation_resolved` | `{ taskId, summary? }` | Mark current conversation as resolved |

### 8.2 `capibara_ask_question` Specification

**Input:**

```typescript
interface AskQuestionInput {
  taskId: string;                    // Current task ID
  question: string;                  // The question content
  recipientTarget?: {                // Optional - defaults to supervisor
    type: 'supervisor' | 'human' | 'role' | 'any';
    roleId?: string;                 // Required when type='role'
  };
  urgency?: 'normal' | 'urgent';    // Affects timeout and priority
}
```

**Behavior:**

1. Validate `taskId` matches the active Run's task.
2. Find or create `DiscussionGroup` for the task.
3. Persist question as `DiscussionMessage` with `intent='question'`.
4. Create `ConversationWorkflow` in `waiting_for_reply` state.
5. Call `RoutingPolicyEngine.resolve()` to determine respondent.
6. Create `PendingWake` for respondent with appropriate priority.
7. Set timeout timer based on urgency.
8. Emit `conversation:question-posted` event.
9. Return `{ status: 'question_posted', respondentInfo, timeoutSeconds }`.
10. The current CLI run exits naturally after receiving this response (agent's process ends).

**Security:**
- Validates `runId` + JWT token (existing pattern).
- `taskId` must match the current Run's task — agents cannot ask questions on behalf of other tasks.

### 8.3 `capibara_mark_conversation_resolved` Specification

**Input:**

```typescript
interface MarkResolvedInput {
  taskId: string;
  summary?: string;     // Optional resolution summary
}
```

**Behavior:**

1. Find active `ConversationWorkflow` for the task where `askingRoleId` matches current role.
2. Transition state to `resolved`.
3. Log resolution event.
4. If `summary` provided, post as `DiscussionMessage` with `intent='resolution'`.

### 8.4 Existing Tool Extension: `capibara_discussion_post`

The existing `capibara_discussion_post` tool is enhanced to detect conversation replies:

```typescript
// After persisting the new message:
if (message.intent === 'reply' || isReplyToQuestion(message, discussionGroup)) {
  // Check for active ConversationWorkflow waiting on this discussion
  const workflow = await workflowRepo.findWaitingByDiscussionGroup(message.groupId);
  if (workflow) {
    await workflowService.handleReply(workflow.id, message.id);
    // This triggers conversation:reply-posted event
  }
}
```

---

## 9. Context Injection

### 9.1 Strategy

When an agent is woken by `discussion_reply`, the `PromptBuilder` constructs an extended conversation context section. Two sources of context work together:

1. **CLI `--resume` session**: Agent's own prior thought process, code changes, etc.
2. **Injected conversation history**: Full discussion timeline with structured formatting.

### 9.2 Conversation Context Section

```markdown
## Conversation Context

You previously asked a question and have received a reply. Continue your work based on this conversation.

### Conversation History
[1] You (Developer) [question]: Architecture doesn't specify payment gateway retry strategy.
    Should we use exponential backoff or fixed interval?
    -- 2026-04-04 10:23:15

[2] Engineering Manager [reply]: Use exponential backoff, max 3 retries, initial 1s, max 30s.
    -- 2026-04-04 10:24:02

### Wake Reason
- Trigger: discussion_reply
- You are resuming your previous session. Your prior work context is preserved.
- Continue from where you left off, incorporating the reply above.
```

### 9.3 Token Budget Management

```typescript
interface ContextBudgetConfig {
  maxConversationTokens: number;     // Default: 8000
  reserveForTaskContext: number;     // Default: 2000
  reserveForPromptTemplate: number;  // Default: 1000
  truncationStrategy: 'oldest_first' | 'summarize_oldest';
}
```

**Algorithm:**

1. Calculate total available tokens = model context window - prompt template - task context.
2. Allocate up to `maxConversationTokens` for conversation history.
3. If history exceeds budget:
   - `oldest_first`: drop oldest messages, keep most recent N.
   - `summarize_oldest` (future): compress older messages into a summary header.
4. Always preserve: the original question + the latest reply (never truncated).

### 9.4 Full History Retrieval

For conversations with 20 or fewer messages, inject ALL messages. For longer threads:

```typescript
async function buildConversationContext(
  workflow: ConversationWorkflow,
  config: ContextBudgetConfig,
): Promise<string> {
  const messages = await discussionRepo.findMessagesByGroupId(workflow.discussionGroupId);
  const conversationMessages = messages.filter(
    (m) => m.intent === 'question' || m.intent === 'reply' || m.intent === 'escalation'
  );

  if (estimateTokens(conversationMessages) <= config.maxConversationTokens) {
    return formatAllMessages(conversationMessages);
  }

  // Truncation: keep first question + last N messages
  const firstQuestion = conversationMessages[0];
  const recentMessages = conversationMessages.slice(-10);
  const truncatedCount = conversationMessages.length - 11;
  return formatTruncatedMessages(firstQuestion, truncatedCount, recentMessages);
}
```

---

## 10. Timeout & Escalation

### 10.1 Timeout Configuration

```typescript
interface TimeoutConfig {
  normalTimeoutMs: number;       // Default: 300_000 (5 minutes)
  urgentTimeoutMs: number;       // Default: 60_000 (1 minute)
  maxEscalationLevels: number;   // Default: 3
  humanNotifyOnTopLevel: boolean; // Default: true
}
```

### 10.2 Timeout Scanner

A periodic scanner runs in the Main Process (no separate process needed):

```typescript
@injectable()
class TimeoutEscalationService {
  private intervalHandle: ReturnType<typeof setInterval> | null = null;

  start(intervalMs: number = 15_000): void {
    this.intervalHandle = setInterval(() => void this.scan(), intervalMs);
  }

  private async scan(): Promise<void> {
    const expired = await this.workflowRepo.findExpiredWorkflows(new Date().toISOString());
    for (const workflow of expired) {
      await this.escalate(workflow);
    }
  }

  private async escalate(workflow: ConversationWorkflow): Promise<void> {
    if (workflow.depth >= this.config.maxEscalationLevels) {
      // Force human notification
      await this.workflowService.transitionState(workflow.id, 'timed_out');
      this.eventBus.emit({
        type: 'escalation:top-level',
        timestamp: new Date().toISOString(),
        payload: { workflowId: workflow.id, orgId: workflow.orgId, reason: 'max_escalation_reached' },
      });
      return;
    }

    // Escalate: create new workflow targeting next-level supervisor
    const currentRespondent = await this.roleRepo.findById(workflow.respondentRoleId!);
    if (!currentRespondent?.parentId) {
      // Top of hierarchy -- force human
      await this.forceHumanEscalation(workflow);
      return;
    }

    await this.workflowService.transitionState(workflow.id, 'escalated');
    await this.workflowService.createEscalatedWorkflow(workflow, currentRespondent.parentId);
  }
}
```

### 10.3 Escalation Chain

```
Developer asks EM (timeout)
  -> New workflow: Developer asks CTO (timeout)
    -> New workflow: Developer asks Human (forced, top-level)
      -> Human notified with full escalation history
```

Each escalation creates a **new** `ConversationWorkflow` with:
- `parentWorkflowId` = previous workflow
- `depth` = previous depth + 1
- `priority` = 2 (escalation priority)
- Full conversation history propagated

---

## 11. Cycle Detection & Safety

### 11.1 Detection Layers

| Layer | What It Detects | Threshold | Resolution |
|-------|----------------|-----------|------------|
| **Depth Limit** | Total conversation chain too long | `maxConversationDepth = 10` | Force escalation to human |
| **Pair Cycle** | A->B->A->B loop | Same role pair within 2 consecutive hops | Skip B, route to B's parent |
| **Budget Gate** | Org spending too much on conversations | `conversationBudgetLimit` per org | Pause all conversations, notify human |
| **Self-Wake** | Role asking itself (pathological) | Asking role = resolved respondent | Reject with error, route to supervisor |

### 11.2 Implementation in RoutingPolicyEngine

```typescript
private detectCycle(request: RoutingRequest, respondentRoleId: string): CycleCheckResult {
  // Layer 1: Depth limit
  if (request.conversationDepth >= this.config.maxConversationDepth) {
    return { hasCycle: true, reason: 'max_depth_exceeded', action: 'force_human' };
  }

  // Layer 2: Self-wake
  if (respondentRoleId === request.askingRoleId) {
    return { hasCycle: true, reason: 'self_reference', action: 'route_to_supervisor' };
  }

  // Layer 3: Pair cycle (check recent conversation chain)
  const recentChain = await this.getRecentConversationChain(request.taskNodeId, 4);
  const pair = `${request.askingRoleId}:${respondentRoleId}`;
  const reversePair = `${respondentRoleId}:${request.askingRoleId}`;
  if (recentChain.includes(pair) || recentChain.includes(reversePair)) {
    return { hasCycle: true, reason: 'pair_cycle_detected', action: 'escalate_respondent_parent' };
  }

  return { hasCycle: false };
}
```

---

## 12. Concurrent Conversation Management

### 12.1 Problem

Multiple conversations may be active within one organization simultaneously:
- Dev A asks EM about retry strategy
- Dev B asks EM about database schema
- QA asks Senior Dev about test coverage

### 12.2 Solution: Priority Queue + Role Locking

**Rule 1: One active Run per role.** If a role is currently executing a Run, incoming conversation wakes are queued in `pending_wakes` with priority.

**Rule 2: Priority ordering.** When a role's Run completes, the next pending wake is selected by `priority DESC, created_at ASC`.

**Rule 3: No parallel conversations for same role.** A role cannot be woken twice simultaneously. The queue ensures serialization.

```typescript
// OrgOrchestrator: enhanced wakeRoleIfPossible
async wakeRoleIfPossible(
  roleId: string, orgId: string, taskNodeId: string, trigger: WakeTrigger
): Promise<void> {
  // Gate checks (existing)
  const role = await this.roleRepo.findById(roleId);
  if (!role || role.status !== 'active') return;

  const activeRun = await this.runRepo.findActiveByRoleId(roleId);
  if (activeRun) {
    // Role busy -- enqueue with priority based on trigger type
    const priority = this.triggerToPriority(trigger);
    await this.pendingWakeRepo.create({ roleId, orgId, trigger, taskNodeId, priority });
    this.eventBus.emit({
      type: 'wake:pending-enqueued',
      timestamp: new Date().toISOString(),
      payload: { roleId, trigger, priority },
    });
    return;
  }

  // Additional gate checks (budget, circuit breaker, etc.)
  // ...

  // Create and execute Run
  await this.createAndExecuteRun(roleId, orgId, taskNodeId, trigger);
}

private triggerToPriority(trigger: WakeTrigger): number {
  switch (trigger) {
    case 'conversation_escalation': return 2;
    case 'discussion_reply': return 1;
    default: return 0;
  }
}
```

### 12.3 Consuming Pending Wakes

After a Run completes, the orchestrator drains the highest-priority pending wake:

```typescript
// After Run completion
const nextWake = await this.pendingWakeRepo.findHighestPriority(roleId, orgId);
if (nextWake) {
  await this.pendingWakeRepo.delete(nextWake.id);
  await this.wakeRoleIfPossible(nextWake.roleId, nextWake.orgId, nextWake.taskNodeId!, nextWake.trigger);
}
```

---

## 13. Human Interaction Model

### 13.1 When Humans Are Involved

| Scenario | Trigger | Gate Required? |
|----------|---------|---------------|
| Role has `requiresHumanApproval=true` and asks `target=human` | Agent MCP call | Yes -- must pass gate |
| Top-level role with no parent | Escalation / timeout | No -- mandatory fallback |
| Human proactively replies to discussion | UI action | No -- always allowed |
| Human marks conversation resolved | UI action | No -- always allowed |
| Human cancels conversation | UI action | No -- always allowed |

### 13.2 Human Notification

When a conversation requires human input, the system:

1. Emits `approval:required` event with conversation details.
2. `EventBroadcaster` relays to Renderer via IPC.
3. UI shows notification badge on the organization and discussion panel.
4. Notification includes: asking role name, question preview, urgency level, escalation chain if any.

### 13.3 Human Reply Flow

```
Human types reply in Discussion UI
  |
  v
IPC: capibara:discussion:post-message
  |
  +-- Zod-validate input
  +-- DiscussionService.postMessage({ authorType: 'human', intent: 'reply' })
  +-- Emit 'discussion:message-added'
  |
  v
ConversationWorkflowService.handleReply(workflowId, messageId)
  |
  +-- Transition workflow -> reply_received
  +-- Create PendingWake for askingRoleId with trigger=discussion_reply
  +-- Emit 'conversation:reply-posted'
  |
  v
OrgOrchestrator handles event -> wakes asking role
```

### 13.4 Human Override Capabilities

- **Reply to any conversation**: Human can post in any discussion, even Agent-to-Agent.
- **Cancel conversation**: Human can mark any active workflow as `cancelled`.
- **Override routing**: Human can directly assign a conversation to a specific role via UI.
- **View all conversations**: Unified view of all active conversations across the organization.

---

## 14. Data Model Extensions

### 14.1 New Table: `conversation_workflows`

```sql
CREATE TABLE conversation_workflows (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL REFERENCES organizations(id),
  task_node_id TEXT NOT NULL REFERENCES task_nodes(id),
  discussion_group_id TEXT NOT NULL REFERENCES discussion_groups(id),
  asking_role_id TEXT NOT NULL REFERENCES roles(id),
  asking_run_id TEXT NOT NULL REFERENCES runs(id),
  asking_session_id TEXT,
  question_message_id TEXT NOT NULL REFERENCES discussion_messages(id),
  reply_message_id TEXT REFERENCES discussion_messages(id),
  respondent_role_id TEXT REFERENCES roles(id),
  respondent_type TEXT NOT NULL CHECK(respondent_type IN ('ai', 'human')),
  state TEXT NOT NULL CHECK(state IN (
    'waiting_for_reply', 'reply_received', 'resumed',
    'resolved', 'escalated', 'timed_out', 'cancelled'
  )),
  depth INTEGER NOT NULL DEFAULT 0,
  parent_workflow_id TEXT REFERENCES conversation_workflows(id),
  priority INTEGER NOT NULL DEFAULT 0,
  timeout_at TEXT,
  resolved_at TEXT,
  audit_reason TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_conv_wf_org_state ON conversation_workflows(org_id, state);
CREATE INDEX idx_conv_wf_task ON conversation_workflows(task_node_id, state);
CREATE INDEX idx_conv_wf_asking_role ON conversation_workflows(asking_role_id, state);
CREATE INDEX idx_conv_wf_respondent ON conversation_workflows(respondent_role_id, state);
CREATE INDEX idx_conv_wf_timeout ON conversation_workflows(timeout_at)
  WHERE state = 'waiting_for_reply';
```

### 14.2 Extended Table: `discussion_messages`

Add columns:

```sql
ALTER TABLE discussion_messages ADD COLUMN intent TEXT NOT NULL DEFAULT 'general'
  CHECK(intent IN ('question', 'reply', 'escalation', 'resolution', 'vote', 'general'));
ALTER TABLE discussion_messages ADD COLUMN in_reply_to_message_id TEXT
  REFERENCES discussion_messages(id);
```

### 14.3 Extended Table: `pending_wakes`

Add column:

```sql
ALTER TABLE pending_wakes ADD COLUMN priority INTEGER NOT NULL DEFAULT 0;
```

**Query change**: existing `findNextForRole` must change ORDER BY to `priority DESC, created_at ASC`.

### 14.4 New Table: `conversation_events` (Append-Only Audit Log)

```sql
CREATE TABLE conversation_events (
  id TEXT PRIMARY KEY,
  workflow_id TEXT NOT NULL REFERENCES conversation_workflows(id),
  event_type TEXT NOT NULL,
  event_payload TEXT,  -- JSON
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_conv_events_workflow ON conversation_events(workflow_id, created_at);
```

Event types: `question_posted`, `reply_posted`, `state_changed`, `routing_decided`, `timeout_triggered`, `escalation_created`, `human_gate_enforced`, `cancelled`, `resolved`.

### 14.5 Entity Type Updates

```typescript
// Add to domain.types.ts
export type ConversationWorkflowState =
  | 'waiting_for_reply'
  | 'reply_received'
  | 'resumed'
  | 'resolved'
  | 'escalated'
  | 'timed_out'
  | 'cancelled';

export type MessageIntent =
  | 'question' | 'reply' | 'escalation' | 'resolution' | 'vote' | 'general';

export type RecipientTargetType = 'supervisor' | 'human' | 'role' | 'any';

// Extend WakeTrigger
export type WakeTrigger =
  | 'task_assigned'
  | 'task_completed'
  | 'review_requested'
  | 'review_approve'
  | 'review_revise'
  | 'review_delegate'
  | 'delegation_completed'
  | 'retry_failed'
  | 'dispute_detected'
  | 'discussion_reply'           // NEW
  | 'conversation_escalation';   // NEW

// Extend DiscussionMessage
export interface DiscussionMessage {
  // ... existing fields ...
  intent: MessageIntent;                    // NEW
  inReplyToMessageId: string | null;        // NEW
}

// Extend PendingWake
export interface PendingWake {
  // ... existing fields ...
  priority: number;                         // NEW
}
```

---

## 15. Event Extensions

### 15.1 New Domain Events

Add to `DomainEventType`:

```typescript
export type DomainEventType =
  // ... existing events ...
  | 'conversation:question-posted'    // Agent asked a question
  | 'conversation:reply-posted'       // Reply received for a waiting conversation
  | 'conversation:state-changed'      // Workflow state transitioned
  | 'conversation:escalated'          // Conversation escalated to next level
  | 'conversation:timed-out'          // Conversation timed out
  | 'conversation:resolved'           // Conversation marked resolved
  | 'conversation:cancelled';         // Conversation cancelled by human
```

### 15.2 Event Payloads

```typescript
interface ConversationQuestionPostedPayload {
  workflowId: string;
  orgId: string;
  taskNodeId: string;
  askingRoleId: string;
  respondentRoleId: string | null;
  respondentType: 'ai' | 'human';
  priority: number;
}

interface ConversationReplyPostedPayload {
  workflowId: string;
  orgId: string;
  askingRoleId: string;
  messageId: string;
  replierRoleId: string | null;
  replierType: 'ai' | 'human';
}

interface ConversationStateChangedPayload {
  workflowId: string;
  orgId: string;
  previousState: ConversationWorkflowState;
  newState: ConversationWorkflowState;
  reason: string;
}
```

### 15.3 OrgOrchestrator Event Subscription

```typescript
// Add to OrgOrchestrator.start()
this.eventBus.on('conversation:reply-posted', (e) => void this.handleEvent(e));
this.eventBus.on('conversation:escalated', (e) => void this.handleEvent(e));
this.eventBus.on('conversation:timed-out', (e) => void this.handleEvent(e));
```

---

## 16. Code Structure

### 16.1 New Files

```text
apps/electron/src/main/
  core/
    types/
      conversation.types.ts             # ConversationWorkflow, ConversationWorkflowState,
                                        # MessageIntent, RecipientTarget, RoutingDecision
    interfaces/
      i-conversation-workflow.repository.ts
      i-routing-policy-engine.ts
      i-conversation-workflow.service.ts
    tokens.ts                           # + CONVERSATION_WORKFLOW_REPO_TOKEN
                                        # + ROUTING_POLICY_ENGINE_TOKEN
                                        # + CONVERSATION_WORKFLOW_SERVICE_TOKEN
                                        # + TIMEOUT_ESCALATION_SERVICE_TOKEN

  application/
    conversation/
      conversation-workflow.service.ts  # Core conversation orchestration
      routing-policy.engine.ts          # Unified routing decisions
      timeout-escalation.service.ts     # Timeout scanner + escalation logic
      conversation-context.builder.ts   # Conversation history formatting for prompt

  infrastructure/
    persistence/sqlite/
      sqlite-conversation-workflow.repository.ts
    mcp/
      tools/
        ask-question.handler.ts         # capibara_ask_question MCP tool
        mark-resolved.handler.ts        # capibara_mark_conversation_resolved MCP tool

  ipc-handlers/
    conversation.ipc-handler.ts         # IPC endpoints for UI conversation actions
```

### 16.2 Modified Files

```text
core/types/domain.types.ts         # Extend WakeTrigger, DiscussionMessage, PendingWake
core/types/event.types.ts          # Add conversation:* event types
application/orchestrator/org.orchestrator.ts  # Subscribe to conversation events
application/skills/prompt-builder.ts         # Add conversation context section
application/execution/execution.engine.ts    # Session resume for discussion_reply
application/discussion/discussion.service.ts # Detect conversation replies
infrastructure/mcp/mcp-tool-registry.ts      # Register new MCP tools
infrastructure/mcp/mcp-tool-handlers.ts      # Route new MCP tool calls
composition-root.ts                          # Register new DI tokens
```

### 16.3 Module Dependencies

```
conversation-workflow.service
  +-- depends on: IConversationWorkflowRepository
  +-- depends on: IRoutingPolicyEngine
  +-- depends on: IDiscussionRepository
  +-- depends on: IEventBus
  +-- depends on: TimeoutEscalationService

routing-policy.engine
  +-- depends on: IRoleRepository
  +-- depends on: IRunRepository
  +-- depends on: IConversationWorkflowRepository
  +-- depends on: config (maxConversationDepth, etc.)

timeout-escalation.service
  +-- depends on: IConversationWorkflowRepository
  +-- depends on: IRoutingPolicyEngine (for escalation routing)
  +-- depends on: IRoleRepository
  +-- depends on: IEventBus

conversation-context.builder
  +-- depends on: IDiscussionRepository
  +-- depends on: IConversationWorkflowRepository
  +-- depends on: config (token budget)
```

---

## 17. Prompt Builder Extensions

### 17.1 Conversation Section in Prompt

When trigger is `discussion_reply` or `conversation_escalation`, `PromptBuilder` adds:

```typescript
// In PromptBuilder.build()
if (context.trigger === 'discussion_reply' || context.trigger === 'conversation_escalation') {
  const conversationContext = await this.conversationContextBuilder.build(
    context.conversationWorkflow!,
    this.config.contextBudget,
  );
  lines.push(conversationContext);
}
```

### 17.2 MCP Tool Listing Update

When an active conversation exists for the task:

```markdown
## System Tools (available as MCP tools)
- capibara_task_complete: Mark your task as completed
- capibara_task_create_child: Create child tasks
- capibara_discussion_post: Post to discussion group / vote
- capibara_ask_question: Ask a question and wait for a reply       <-- NEW
- capibara_mark_conversation_resolved: Mark conversation resolved  <-- NEW
- capibara_context_get_task: Get details about any task
- capibara_context_get_org_tree: Get org tree
- capibara_escalate: Escalate to your superior
```

### 17.3 Conversation Resume Instructions

```markdown
## Instructions
You were previously working on this task and asked a question. A reply has been received.

1. Review the Conversation Context above.
2. Continue your work, incorporating the reply.
3. If the reply is sufficient, proceed with task completion.
4. If you need further clarification, use capibara_ask_question to ask a follow-up.
5. When done with the conversation, use capibara_mark_conversation_resolved.
```

---

## 18. Audit & Observability

### 18.1 Conversation Event Log

Every significant action is recorded in `conversation_events`:

| Event Type | When | Payload |
|------------|------|---------|
| `question_posted` | Agent calls `ask_question` | question content, recipient target |
| `routing_decided` | Routing engine resolves respondent | pipeline steps, final decision, audit reason |
| `human_gate_enforced` | Human target blocked by gate | original target, rewritten target, role config |
| `reply_posted` | Reply received | replier info, response time |
| `state_changed` | Any state transition | from state, to state, trigger |
| `timeout_triggered` | Workflow times out | elapsed time, escalation target |
| `escalation_created` | New escalation workflow | parent workflow, new respondent |
| `resolved` | Conversation resolved | resolution summary |
| `cancelled` | Human cancels | cancellation reason |

### 18.2 Metrics (Computed on Demand)

```typescript
interface ConversationMetrics {
  orgId: string;
  totalConversations: number;
  avgResponseTimeMs: number;
  escalationRate: number;          // % of conversations that escalated
  timeoutRate: number;             // % that timed out
  humanInterventionRate: number;   // % requiring human input
  avgDepth: number;                // average conversation chain depth
  cycleDetectionCount: number;     // times cycle detection fired
}
```

Computed from `conversation_workflows` and `conversation_events` tables via SQL aggregation queries. No separate metrics table needed — queries are fast on SQLite for desktop-scale data.

### 18.3 IPC for UI

```typescript
// New IPC channels
'capibara:conversation:list-active'      // List active conversations for an org
'capibara:conversation:get-history'      // Get full conversation history for a workflow
'capibara:conversation:cancel'           // Cancel an active conversation
'capibara:conversation:get-metrics'      // Get conversation metrics for an org
```

---

## 19. Non-Functional Requirements

### 19.1 Performance Targets

| Metric | Target | Measurement |
|--------|--------|-------------|
| Reply -> Wake latency | P95 < 10s (local) | Time from reply persistence to Run creation |
| Context assembly | P95 < 500ms | Time to build conversation prompt section |
| Workflow state transition | < 50ms | Single SQLite write + event emit |
| Timeout scan cycle | < 100ms per scan | Periodic scan of expired workflows |
| Event log write | < 10ms | Single append to conversation_events |

### 19.2 Reliability

- **Zero message loss**: question and reply messages written to SQLite before any side effect (event emit, wake creation).
- **Crash recovery**: on Main Process restart, `TimeoutEscalationService.start()` scans for orphaned `waiting_for_reply` workflows and either resumes timeout or triggers escalation.
- **No orphaned states**: if a Run fails during conversation, the workflow remains in `waiting_for_reply` and the timeout scanner handles it.
- **Graceful degradation**: if routing fails entirely, fall back to human notification.

### 19.3 Data Integrity

- All conversation data in SQLite with WAL mode.
- `conversation_events` is append-only — no UPDATE or DELETE.
- Foreign key constraints enforced on all workflow references.
- State transitions validated by state machine before persistence.

---

## 20. Implementation Phasing

### Phase 1: Conversation Core (MVP)

**Goal**: Agent can ask a question, system routes to supervisor AI, supervisor replies, original agent resumes.

| Step | Deliverable | Dependencies |
|------|------------|--------------|
| 1.1 | `conversation.types.ts` -- types, states, interfaces | None |
| 1.2 | `conversation_workflows` table + migration | 1.1 |
| 1.3 | `discussion_messages` schema extension (intent, inReplyToMessageId) | None |
| 1.4 | `pending_wakes` schema extension (priority) | None |
| 1.5 | `IConversationWorkflowRepository` + SQLite implementation | 1.1, 1.2 |
| 1.6 | `ConversationWorkflowService` -- create, state transitions | 1.1, 1.5 |
| 1.7 | `RoutingPolicyEngine` -- supervisor resolution + human gate | 1.1 |
| 1.8 | `capibara_ask_question` MCP tool | 1.6, 1.7 |
| 1.9 | `WakeTrigger` extension + `OrgOrchestrator` event subscription | 1.1 |
| 1.10 | `ExecutionEngine` session resume for `discussion_reply` | 1.9 |
| 1.11 | `PromptBuilder` conversation context section | 1.6 |
| 1.12 | Integration test: Dev asks -> EM replies -> Dev resumes | All above |

### Phase 2: Human Interaction

**Goal**: Roles with `requiresHumanApproval=true` can request human input. Human can reply via UI.

| Step | Deliverable | Dependencies |
|------|------------|--------------|
| 2.1 | Human gate enforcement in `RoutingPolicyEngine` | Phase 1 |
| 2.2 | `conversation.ipc-handler.ts` -- IPC endpoints for UI | 1.5 |
| 2.3 | `DiscussionService` reply detection for human messages | 1.6 |
| 2.4 | UI notification for human-required conversations | 2.2 |
| 2.5 | `capibara_mark_conversation_resolved` MCP tool | 1.6 |
| 2.6 | Integration test: Analyst asks human -> human replies -> Analyst resumes | 2.1-2.5 |

### Phase 3: Timeout, Escalation & Safety

**Goal**: Conversations that stall are automatically escalated. Cycles are detected and broken.

| Step | Deliverable | Dependencies |
|------|------------|--------------|
| 3.1 | `TimeoutEscalationService` -- periodic scan + escalation | 1.6 |
| 3.2 | Cycle detection in `RoutingPolicyEngine` | 1.7 |
| 3.3 | `conversation_events` audit table | 1.2 |
| 3.4 | Crash recovery -- orphaned workflow scan on startup | 1.6, 3.1 |
| 3.5 | Integration test: timeout -> escalation chain -> human forced | 3.1-3.4 |

### Phase 4: Concurrency & Observability

**Goal**: Multiple concurrent conversations work correctly. Metrics available.

| Step | Deliverable | Dependencies |
|------|------------|--------------|
| 4.1 | Priority-based pending wake consumption | 1.4 |
| 4.2 | Conversation metrics queries | 3.3 |
| 4.3 | UI: active conversation list + conversation timeline | 2.2, 4.2 |
| 4.4 | Human override: cancel, reassign conversations | 2.2 |
| 4.5 | Stress test: 5 concurrent conversations in same org | 4.1 |

### Phase 5: Advanced Features

**Goal**: Skill-based routing, cascaded multi-role discussions, conversation intelligence.

| Step | Deliverable | Dependencies |
|------|------------|--------------|
| 5.1 | Skill-match routing in `RoutingPolicyEngine` | Phase 4 |
| 5.2 | Multi-hop cascade: Dev -> EM -> CTO with full context propagation | 5.1 |
| 5.3 | Token budget truncation strategy for long conversations | Phase 4 |
| 5.4 | Conversation pattern analytics (aggregated insights) | 4.2 |

---

## 21. Acceptance Checklist

### Business Acceptance

| # | Question | Expected Answer |
|---|----------|----------------|
| B1 | Does default routing always go to supervisor AI? | Yes -- `RecipientTarget.supervisor` is the default |
| B2 | Can a role without `requiresHumanApproval=true` request human reply? | No -- gate rewrites to supervisor, audit logged |
| B3 | Can a role with `requiresHumanApproval=true` request human reply? | Yes -- gate passes, human notified |
| B4 | Is multi-turn context preserved across resume? | Yes -- CLI `--resume` + injected conversation history |
| B5 | Can human reply to any conversation? | Yes -- no gate on human-initiated replies |
| B6 | Does timeout escalation work through the hierarchy? | Yes -- up to `maxEscalationLevels`, then forced human |
| B7 | Are Agent-to-Agent conversations fully automatic? | Yes -- routing + wake + resume all automated |
| B8 | Is the complete conversation chain auditable? | Yes -- `conversation_events` append-only log |

### Engineering Acceptance

| # | Question | Expected Answer |
|---|----------|----------------|
| E1 | Is conversation state recoverable after crash? | Yes -- SQLite-persisted, timeout scanner recovers |
| E2 | Is routing logic centralized? | Yes -- `RoutingPolicyEngine` single entry point |
| E3 | Does the system avoid distributed infrastructure? | Yes -- SQLite + EventBus, no external queues |
| E4 | Is the state machine pure and testable? | Yes -- `canTransition()` is a pure function |
| E5 | Is cycle detection provably sound? | Yes -- depth + pair + self-wake, 3-layer defense |
| E6 | Does the design extend (not fork) the existing architecture? | Yes -- new events, new triggers, same patterns |
| E7 | Is priority scheduling deterministic? | Yes -- `priority DESC, created_at ASC` |
| E8 | Are all conversation actions Zod-validated? | Yes -- MCP inputs and IPC inputs |

---

## Sequence Diagrams

### Sequence 1: Agent Asks Supervisor (Default Flow)

```
Developer           MCP Bridge          ConvWorkflowSvc     RoutingEngine       OrgOrchestrator     EM (AI)
    |                    |                     |                  |                    |                |
    | ask_question()     |                     |                  |                    |                |
    |------------------->|                     |                  |                    |                |
    |                    | createWorkflow()     |                  |                    |                |
    |                    |-------------------->|                  |                    |                |
    |                    |                     | resolve(target)  |                    |                |
    |                    |                     |----------------->|                    |                |
    |                    |                     |                  | -> supervisor=EM   |                |
    |                    |                     |<-----------------|                    |                |
    |                    |                     |                  |                    |                |
    |                    |                     | emit(question-posted)                 |                |
    |                    |                     |-------------------------------------->|                |
    |                    |                     |                  |                    |                |
    | { status: ok }     |                     |                  |                    | wake(EM)       |
    |<-------------------|                     |                  |                    |--------------->|
    |                    |                     |                  |                    |                |
    | [CLI exits]        |                     |                  |                    |                |
    |                    |                     |                  |                    |                |
    |                    |                     |                  |                    |   EM executes  |
    |                    |                     |                  |                    |   reads context|
    |                    |                     |                  |                    |   posts reply  |
    |                    |                     |<------------------------------------------------------|
    |                    |                     | handleReply()    |                    |                |
    |                    |                     | transition->reply_received            |                |
    |                    |                     | emit(reply-posted)                    |                |
    |                    |                     |-------------------------------------->|                |
    |                    |                     |                  |                    |                |
    |                    |                     |                  |                    | wake(Dev)      |
    | [resumed with      |                     |                  |                    | --resume       |
    |  --resume sessionId]                     |                  |                    |--------------->|
    |<--------------------------------------------------------------------------|                     |
    |                    |                     |                  |                    |                |
    | continues work...  |                     |                  |                    |                |
```

### Sequence 2: Agent Asks Human (Gate Allowed)

```
Analyst              MCP Bridge          ConvWorkflowSvc     RoutingEngine       UI (Human)
(requiresHumanApproval=true)
    |                    |                     |                  |                    |
    | ask_question       |                     |                  |                    |
    | target=human       |                     |                  |                    |
    |------------------->|                     |                  |                    |
    |                    | createWorkflow()     |                  |                    |
    |                    |-------------------->|                  |                    |
    |                    |                     | resolve(human)   |                    |
    |                    |                     |----------------->|                    |
    |                    |                     |                  | gate: PASS         |
    |                    |                     |                  | -> route to human  |
    |                    |                     |<-----------------|                    |
    |                    |                     |                  |                    |
    |                    |                     | emit(question-posted, respondent=human)|
    |                    |                     |-------------------------------------->|
    |                    |                     |                  |     [notification] |
    | { status: ok }     |                     |                  |                    |
    |<-------------------|                     |                  |                    |
    | [CLI exits]        |                     |                  |                    |
    |                    |                     |                  |                    |
    |                    |                     |                  |     Human replies  |
    |                    |                     |<--------------------------------------|
    |                    |                     | handleReply()    |                    |
    |                    |                     | emit(reply-posted)                   |
    | [resumed]          |                     |                  |                    |
    |<--------------------------------------- wake(Analyst) -----|                    |
```

### Sequence 3: Agent Asks Human (Gate Blocked)

```
Developer            MCP Bridge          ConvWorkflowSvc     RoutingEngine
(requiresHumanApproval=false)
    |                    |                     |                  |
    | ask_question       |                     |                  |
    | target=human       |                     |                  |
    |------------------->|                     |                  |
    |                    | createWorkflow()     |                  |
    |                    |-------------------->|                  |
    |                    |                     | resolve(human)   |
    |                    |                     |----------------->|
    |                    |                     |                  | gate: BLOCKED
    |                    |                     |                  | rewrite -> supervisor
    |                    |                     |                  | audit: human_target_blocked
    |                    |                     |<-----------------|
    |                    |                     |                  |
    |                    |                     | route to EM (supervisor)
    |                    |                     | emit(question-posted, respondent=EM, wasRewritten=true)
    | { status: ok,      |                     |                  |
    |   rewrittenTo:EM } |                     |                  |
    |<-------------------|                     |                  |
    | [CLI exits]        |                     |                  |
```

### Sequence 4: Timeout Escalation Chain

```
TimeoutScanner       ConvWorkflowSvc     RoutingEngine       OrgOrchestrator
    |                     |                  |                    |
    | scan()              |                  |                    |
    | find expired WF     |                  |                    |
    |------------------->|                  |                    |
    |                     | escalate()       |                    |
    |                     | transition->escalated                 |
    |                     |                  |                    |
    |                     | createEscalatedWorkflow()              |
    |                     | resolve(supervisor of original respondent)
    |                     |----------------->|                    |
    |                     |                  | -> CTO             |
    |                     |<-----------------|                    |
    |                     |                  |                    |
    |                     | create PendingWake(CTO, priority=2)   |
    |                     | emit(conversation:escalated)           |
    |                     |-------------------------------------->|
    |                     |                  |                    | wake(CTO)
```

---

## Design Rationale Summary

| Decision | Why |
|----------|-----|
| Reuse `DiscussionMessage` instead of new table | One source of truth for all messages; zero migration for existing features |
| Conversation as explicit workflow entity | Crash-recoverable, auditable, clear lifecycle vs scattered flags |
| Routing as pipeline engine | Single audit path, new rules added without touching orchestrator |
| Session resume (`--resume`) | Agent retains its own thought process; minimal re-injection needed |
| Priority queue via SQL column | No new infrastructure; simple ORDER BY change |
| Timeout via periodic scan | Simple, debuggable, no timer leak risk from in-memory timers |
| Human gate as hard constraint | Can't be bypassed by prompt injection or agent misbehavior |
| Existing patterns preserved | EventBus, DI tokens, repository interfaces -- team stays productive |