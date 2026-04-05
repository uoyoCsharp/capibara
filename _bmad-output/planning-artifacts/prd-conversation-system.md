---
stepsCompleted: [step-01-init, step-02-discovery, step-02b-vision, step-02c-executive-summary, step-03-success, step-04-journeys, step-05-domain, step-06-innovation-skipped, step-07-project-type-skipped, step-08-scoping-skipped, step-09-functional, step-10-nonfunctional, step-11-polish]
inputDocuments:
  - prd.md
  - architecture.md
  - workflow-analysis.md
  - workflow-risk-analysis.md
workflowType: 'prd'
briefCount: 0
researchCount: 0
brainstormingCount: 0
projectDocsCount: 4
classification:
  projectType: desktop_app
  domain: ai-agent-orchestration
  complexity: high
  projectContext: brownfield
---

# Product Requirements Document - Capibara Multi-turn Conversation System

**Author:** xiangjie.liu
**Date:** 2026-04-03

## Executive Summary

Capibara is an Electron-based AI multi-agent collaboration desktop platform that allows users to create virtual software teams (with hierarchical roles such as CTO, Engineering Manager, Developer, etc.) to autonomously collaborate on software development tasks through LLM-driven Agents.

The current system uses a single-shot execution model: each Agent receives a prompt, invokes the LLM via CLI once, and returns a result. This model cannot support scenarios where an Agent needs to ask questions during execution, wait for replies, and continue working after receiving clarification. The multi-turn conversation interaction system defined in this PRD fills this core gap, evolving Agents from "one-shot executors" to "persistent conversation participants."

Target users are software team managers using structured methodologies like BMAD, who need AI Agents to engage in multi-turn interactions such as requirements clarification, design discussions, and code reviews — just like real team members.

### What Makes This Special

Existing AI Agent tools (Devin, Cursor Agent, etc.) primarily offer single-user, single-Agent linear interactions. Capibara's core differentiation is **multi-role hierarchical collaboration**: a virtual organization contains multiple AI roles with supervisor-subordinate relationships, approval chains, and discussion mechanisms.

Multi-turn conversation capability is the critical missing piece for realizing this differentiation:
- **Human-to-Agent conversation**: Users can reply to Agent questions; the Agent is woken with full context to continue working
- **Agent-to-Agent conversation**: AI roles can ask questions to supervisors or peers; target Agents are automatically woken to respond
- **Mixed participation**: In the same discussion thread, Humans and multiple AI roles can naturally take turns participating
- **Full context**: Agents receive complete conversation history upon each wake, not just truncated recent messages

## Project Classification

- **Project Type:** Desktop Application (Electron + React + SQLite)
- **Domain:** AI Agent Orchestration
- **Complexity:** High — involves multi-process communication (Main <-> Renderer <-> CLI Worker), async event-driven architecture, LLM session state management, multi-role concurrent conversation conflict control
- **Project Context:** Brownfield — extending a mature existing system, requiring deep integration with existing wake trigger mechanism, MCP bridge, discussion system, and execution engine

## Success Criteria

### User Success

- Agent asks a question during task execution; by default the question is routed to the supervisor AI role, and only roles with `requiresHumanApproval=true` can require Human reply; Agent is woken with full conversation context and continues working — no manual restart or re-submission needed
- Agent is woken within 30 seconds after a reply is posted in the discussion
- Agent receives complete conversation history (not truncated) upon each wake, ensuring conversation coherence
- Multi-role discussions (e.g., Analyst asks -> PM replies -> Analyst continues) flow naturally without manual intervention

### Business Success

- Supports multi-turn requirements clarification workflows in structured methodologies like BMAD, making Capibara a truly usable AI team collaboration tool
- Conversation interaction mechanism becomes the platform's core capability, providing the foundation for future template and workflow extensions
- 3 months: core conversation flows running stably; 6 months: support for complex multi-role cascading conversation scenarios

### Technical Success

- New `discussion_reply` wake trigger integrates seamlessly with existing wake mechanism
- Discussion context injection expands from fixed 3 messages to configurable full history (with token budget management)
- CLI `--resume` session mechanism is fully leveraged for cross-execution conversation continuity
- MCP bridge adds `wait_for_reply` tool allowing Agents to actively pause and wait for replies
- Concurrent conversations produce no deadlocks or circular wake loops

### Measurable Outcomes

- Human reply -> Agent wake latency < 30s
- Agent-to-Agent conversation auto-flow success rate > 95%
- Conversation context completeness: Agent can access all messages in the discussion thread upon wake
- Zero conversation loss: all conversation messages are persisted and auditable

## Product Scope

### MVP - Minimum Viable Product

1. **Discussion Reply Wake Trigger** — Reply messages in discussions trigger relevant Agent wake
2. **Full Conversation Context Injection** — Agent receives complete discussion history upon wake (with token budget truncation strategy)
3. **Agent Active Questioning** — MCP tool allows Agent to post a question and pause waiting for reply
4. **Conditional Human Reply -> Agent Wake Loop** — User replies in UI and relevant Agent is automatically woken, but only when the asking role has `requiresHumanApproval=true`; otherwise routing defaults to supervisor AI reply
5. **Conversation State Tracking** — Distinguish "waiting for reply" vs "replied, ready to continue" task states
6. **Agent-to-Agent Auto-conversation** — AI roles ask questions to supervisors/peers; target roles are automatically woken to respond
7. **Conversation Routing Strategy** — Based on role hierarchy and skill matching, automatically determine who should respond
8. **Concurrent Conversation Management** — Priority and conflict control when multiple discussion threads are active simultaneously
9. **Conversation Timeout & Escalation** — Auto-escalate to supervisor role when reply wait times out
10. **Intelligent Conversation Orchestration** — System automatically determines when multi-turn conversation is needed vs direct execution

### Vision (Future)

1. **Cross-organization Conversation** — Agent collaboration across different virtual organizations
2. **Conversation Pattern Learning** — Learn common Q&A patterns from conversation history to reduce unnecessary interaction rounds

## User Journeys

### Journey 1: Human Manager — Requirements Clarification with AI Analyst

**Alex** is a technical team lead who created a BMAD software team in Capibara to develop a new payment module.

**Opening Scene**: Alex creates a task "Design Payment Module" and assigns it to the Analyst role. The Analyst is woken, reads the task description, and discovers missing critical information — which payment methods? Is PCI compliance needed?

**Rising Action**: The Analyst role has `requiresHumanApproval=true`, so it can request direct Human input. The Analyst uses the MCP `ask_question` tool to post a question in the discussion: "Which payment methods need to be supported? Are there PCI DSS compliance requirements?" Then actively pauses execution. Alex sees a notification in the UI discussion panel and replies: "Support credit cards and PayPal, need PCI Level 1."

**Climax**: The system detects the Human reply, triggering the `discussion_reply` wake trigger. The Analyst is woken with full conversation context (original task description + question + Alex's reply), and continues to complete the requirements analysis, producing a comprehensive requirements document.

**Resolution**: Alex does not need to manually re-submit the task or restart the process. The entire interaction feels as natural as talking to a real Analyst. Full discussion history is auditable.

### Journey 2: AI Supervisor — Developer Asks Architect for Guidance

**Opening Scene**: The Developer role is assigned the task "Implement Payment Gateway Integration." After reading the story spec, the Developer finds no explicit retry strategy for the gateway specified in the architecture document.

**Rising Action**: The Developer uses the MCP `ask_question` tool to ask its supervisor, the Engineering Manager: "Architecture doesn't specify payment gateway retry strategy. Should we use exponential backoff or fixed interval?" The system identifies this as an Agent-to-Agent conversation and automatically routes it to the Engineering Manager.

**Climax**: The Engineering Manager is woken with full context (Developer's task details + question + relevant architecture document references), analyzes the situation, and replies: "Use exponential backoff, max 3 retries, initial interval 1s, max interval 30s." The system detects the reply and automatically wakes the Developer.

**Resolution**: The Developer continues implementation with clear technical guidance, no human intervention needed. The entire Agent-to-Agent conversation flows automatically. Human supervisors can view the complete conversation record in the UI.

### Journey 3: Human Manager — Monitoring Multi-role Cascade Discussion

**Opening Scene**: A complex architectural decision triggers a multi-role discussion. The QA Engineer discovers a potential concurrency issue during code review and initiates a discussion.

**Rising Action**: QA's question is routed to the Senior Developer (directly relevant party). The Senior Developer analyzes and determines this needs an architecture-level decision, escalating to the Engineering Manager. The EM evaluates and determines this impacts overall architecture, escalating to the CTO (requires Human Approval).

**Climax**: Alex receives a notification and sees the complete conversation chain: QA's finding -> Senior Dev's analysis -> EM's assessment. Alex replies in the CTO role's discussion with the decision: "Adopt optimistic locking approach, QA to add corresponding test cases." The system automatically propagates the decision downward, sequentially waking EM -> Senior Dev -> QA.

**Resolution**: A complete closed loop from bottom-level discovery to top-level decision to execution, with all intermediate discussions fully preserved and traceable.

### Journey 4: System — Intelligent Conversation Orchestration

**Opening Scene**: The system receives a new task assigned to a Developer. The intelligent orchestration module analyzes the task description, related discussion history, and role capabilities.

**Rising Action**: The orchestration module determines: (a) task description is sufficiently clear, story spec is complete, no ambiguity -> execute directly without initiating conversation; (b) task involves multi-role dependencies or lacks critical information -> pre-set conversation routing, prepare list of roles that may need to be consulted.

**Climax**: For scenario (b), the Developer encounters a blocker during execution. The system has already pre-computed the optimal responder (based on role hierarchy + skill matching + current load), immediately routing the question to minimize wait time.

**Resolution**: The system intelligently switches between "converse when needed, execute directly when not," avoiding unnecessary interaction delays while ensuring critical questions are not skipped.

### Journey Requirements Summary

| Capability | J1 | J2 | J3 | J4 |
|---|---|---|---|---|
| Discussion reply wake trigger | x | x | x | |
| Full context injection | x | x | x | |
| Agent ask_question MCP tool | x | x | x | |
| Agent-to-Agent auto routing | | x | x | x |
| Conversation state tracking | x | x | x | x |
| Role hierarchy routing | | x | x | x |
| Timeout & escalation | | | x | |
| Concurrent conversation mgmt | | | x | x |
| Intelligent orchestration | | | | x |
| Human notification & reply UI | x | | x | |

## Domain-Specific Requirements

### Technical Constraints

- **LLM Session Management**: CLI `--resume` with sessionId is the only mechanism for cross-run continuity; conversation system must work within this constraint
- **Token Budget**: Full conversation history injection must respect LLM context window limits; requires intelligent truncation/summarization strategy
- **Process Isolation**: Each Agent runs as a separate CLI process; no shared memory between Agents — all communication must go through SQLite + EventBus
- **Single-threaded Wake Loop**: OrgOrchestrator processes wakes sequentially; concurrent Agent-to-Agent conversations must not create circular wake dependencies

### Integration Requirements

- **Existing Wake Trigger System**: New `discussion_reply` trigger must integrate with the existing `WakeTrigger` type union and `OrgOrchestrator.processWake()` flow
- **MCP Bridge**: New tools (`ask_question`, `wait_for_reply`) must follow existing MCP tool registration pattern via `McpToolRegistry` and `McpToolHandlers`
- **Discussion Repository**: Must extend `SqliteDiscussionRepository` and `IDiscussionRepository` interface for new query patterns (full history, unread tracking)
- **EventBus**: New event types for conversation flow must integrate with existing `EmitteryEventBus` and `EventDigester`

### Risk Mitigations

- **Circular Wake Loop**: Agent A asks Agent B, B asks A -> infinite loop. Mitigation: conversation depth limit + cycle detection in routing
- **Conversation Starvation**: Agent waits for reply that never comes. Mitigation: configurable timeout with auto-escalation
- **Context Explosion**: Full history of long discussions exceeds token budget. Mitigation: sliding window + summarization of older messages
- **Race Condition**: Human and AI both reply simultaneously. Mitigation: first-reply-wins with conflict notification

## Functional Requirements

### Conversation Initiation

- FR1: Agent can post a question to the discussion thread of its current task via MCP tool and pause execution waiting for a reply
- FR2: Agent can specify the intended recipient of a question (specific role, supervisor, or "any")
- FR3: System enforces Human-input gating by role configuration: only roles with `requiresHumanApproval=true` can require Human reply; all other roles default to supervisor routing
- FR4: Human user can initiate a conversation with any Agent by posting a message in the task's discussion thread

### Conversation Wake & Resume

- FR5: System triggers a wake event when a new reply is posted to a discussion thread where an Agent is waiting
- FR6: Agent receives complete conversation history of the discussion thread upon wake (not just recent messages)
- FR7: System manages a token budget for conversation context injection, applying intelligent truncation when history exceeds limits
- FR8: Agent can resume its previous execution context after being woken by a reply, continuing where it left off
- FR9: System tracks conversation state per task, distinguishing "waiting_for_reply", "reply_received", and "in_progress" states

### Agent-to-Agent Conversation

- FR10: Agent can ask a question to its supervisor role; the supervisor Agent is automatically woken to respond
- FR11: Agent can ask a question to a peer role within the same organization; the target Agent is automatically woken
- FR12: System routes questions to the most appropriate responder based on role hierarchy, skill matching, and current availability
- FR13: System supports multi-hop conversation escalation (Developer -> EM -> CTO) with full context propagation at each hop
- FR14: Responding Agent receives the asker's task context, question, and relevant discussion history

### Conversation Orchestration

- FR15: System can analyze a task assignment to determine whether multi-turn conversation is likely needed before execution begins
- FR16: System pre-computes optimal conversation routing paths when multi-role dependencies are detected
- FR17: System enforces a maximum conversation depth limit to prevent infinite conversation chains
- FR18: System detects circular conversation patterns (A asks B, B asks A) and breaks the cycle with escalation

### Timeout & Escalation

- FR19: System monitors reply wait duration and triggers timeout after a configurable period
- FR20: On timeout, system automatically escalates the question to the next level in the role hierarchy
- FR21: Human user can configure timeout durations per organization or per role
- FR22: System notifies the Human user when a conversation has been escalated due to timeout

### Concurrent Conversation Management

- FR23: System supports multiple active conversation threads within the same organization simultaneously
- FR24: System prioritizes conversation wakes based on task priority and conversation urgency
- FR25: System prevents a single role from being woken for multiple conversations simultaneously (queue management)
- FR26: Human user can view all active conversations across the organization in a unified view

### Human Interaction

- FR27: Human user receives notifications only when an Agent with `requiresHumanApproval=true` asks a question requiring human input
- FR28: Human user can reply to Agent questions directly in the discussion UI
- FR29: Human user can view the complete conversation chain including all Agent-to-Agent interactions
- FR30: Human user can intervene in any Agent-to-Agent conversation by posting a reply
- FR31: Human user can mark a conversation as "resolved" to prevent further wake triggers

### Audit & Observability

- FR32: All conversation messages (Human and Agent) are persisted in SQLite with timestamps, sender role, and recipient
- FR33: System provides a conversation timeline view showing the complete flow of a multi-role discussion
- FR34: System logs all conversation routing decisions with reasoning for audit purposes
- FR35: System tracks conversation metrics (response times, escalation rates, completion rates) per organization

## Non-Functional Requirements

### Performance

- Wake-to-execution latency after reply: < 30 seconds (including context assembly)
- Conversation context assembly (full history retrieval + token budget application): < 2 seconds
- Discussion message persistence: < 100ms per message write

### Reliability

- Zero message loss: all conversation messages must survive process crashes (write-ahead to SQLite before acknowledgment)
- Conversation state consistency: no orphaned "waiting_for_reply" states after system restart
- Graceful degradation: if conversation routing fails, fall back to Human notification

### Data Integrity

- All conversation data stored locally in SQLite (no external dependencies)
- Conversation history immutable once written (append-only)
- Full conversation context reconstructable from persisted data at any point
