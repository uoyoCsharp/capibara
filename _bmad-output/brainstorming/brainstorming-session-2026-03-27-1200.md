---
stepsCompleted: [1, 2, 3, 4]
inputDocuments: ['docs/functional-analysis.md', 'docs/project background.md', 'Refer Project Introduce.md', 'refer project/']
session_topic: 'Capibara complete redesign and refactoring with new task hierarchy and discussion group features'
session_goals: 'Architecture redesign, four-level task system (Epic->UserStory->Task->Subtask), Epic-based discussion groups, full code refactoring plan'
selected_approach: 'ai-recommended'
techniques_used: ['Question Storming', 'Six Thinking Hats']
ideas_generated: 52
context_file: 'docs/functional-analysis.md'
session_active: false
workflow_completed: true
---

# Brainstorming Session Results

**Facilitator:** uoyo
**Date:** 2026-03-27

## Session Overview

**Topic:** Capibara complete redesign - from fixed pipeline to company-grade org-architecture AI assistant, with new four-level task hierarchy and Epic-based discussion groups

**Goals:**

- Architecture redesign based on functional-analysis.md (14 functional modules)
- New Feature A: Epic -> User Story -> Task -> Subtask hierarchy with AI auto-creation, assignment, tracking, and status flow
- New Feature B: AI auto-created Epic-based discussion groups for role collaboration and progress visibility

### Context Guidance

_Based on functional-analysis.md: 15 sections covering org modeling, task system, execution engine, approval & governance, wake-up loop, inter-role communication, knowledge & skill management, automation rules, resilience, observability, CLI design, and config system. Key design decisions D-ORG-1 through D-RESIL-2 documented. AgentCompany reference project (25+ tables, dual-channel communication, automation rules engine) used as design reference._

### Session Setup

_Full redesign brainstorming session initialized with project context from functional analysis, project background, and AgentCompany reference project (Refer Project Introduce.md)._

## Technique Selection

**Approach:** AI-Recommended Techniques
**Analysis Context:** Capibara complete redesign with focus on architecture, task hierarchy, and discussion groups

**Recommended Techniques:**

- **Question Storming:** Discover hidden design blind spots and critical architecture questions before generating solutions
- **Six Thinking Hats:** Systematically generate solutions from six perspectives (facts, intuition, benefits, risks, creativity, process)

**AI Rationale:** Complex system redesign with reference project requires first exposing unknowns (Question Storming), then multi-perspective ideation (Six Thinking Hats).

## Technique Execution Results

### Question Storming (Phase 1 - Seed Questions)

5 seed questions generated to expose design blind spots:

- **#1 Task ownership**: Who owns each level of Epic->US->Task->Subtask? Fixed role mapping or flexible?
- **#2 Task-org mapping**: Does 4-level task hierarchy bind to 3-level org tree? What if org has 2 or 4 levels?
- **#3 Discussion vs approval boundary**: Are discussion group messages and approval chain revise feedback two systems or one?
- **#4 Discussion group lifecycle**: What happens to Epic-based discussion groups after Epic completion?
- **#5 AgentCompany dual-channel vs Capibara discussion groups**: Is Epic discussion group closer to `agent_messages` channels, `task_comments`, or a new third model?

### Six Thinking Hats (Phase 2 - Full Execution)

#### White Hat (Facts)

- **#6** Current system is fixed 5-phase pipeline; target is dynamic org tree + variable task hierarchy + discussion groups. Data model requires fundamental rebuild.
- **#7** AgentCompany uses 25+ tables, 100+ DB methods, 70+ IPC channels. CLI form factor allows significant simplification (no real-time UI refresh needed).
- **#8** Epic->US->Task->Subtask is standard agile; AgentCompany uses Goal->Project->Task->Subtask. May need both: Goal (vision) drives Epic (delivery unit).
- **#9** AgentCompany's `project` channel is closest to Epic discussion groups, but Epic groups are more delivery-focused. This is an original Capibara concept.

#### Red Hat (Intuition) - User Resonance: #10, #11, #12, #13

- **#10** Four-level task hierarchy feels too heavy for AI agents. Variable-depth task tree is better than fixed layers.
- **#11** Discussion groups are the most exciting feature - they make Capibara feel like "a real company". Should be core decision engine input, not just communication.
- **#12** Users want narrative ("CTO is discussing architecture with Tech Manager") not tables. Status display should be narrative-driven.
- **#13** Deep BMAD binding is concerning. Skill layer should be a pluggable adapter with BMAD as default implementation.
- **#14** Correct refactoring strategy: keep infrastructure layer, rebuild application layer.

#### Yellow Hat (Benefits) - User Selected: #15, #16, #17, #18, #20

- **#15** Variable-depth task tree releases flexibility. AI decides decomposition depth based on complexity. Differentiator vs AgentCompany and standard agile.
- **#16** Discussion-driven collective decision-making. Roles debate in groups, form consensus, then approve. Discussion records become knowledge assets.
- **#17** Narrative status = natural project report. No separate progress reports needed - system auto-generates from discussions and task progress.
- **#18** Pluggable Skill layer opens ecosystem. Community can contribute skill providers. Capibara becomes a general AI org orchestration engine, not a BMAD wrapper.
- **#19** Infrastructure reuse reduces refactoring risk.
- **#20** Discussion groups naturally solve context passing. Instead of complex 7-9 layer prompt assembly, inject discussion summaries as context.

#### Black Hat (Risks) - User Flagged: #21, #23, #24, #25, #26

- **#21** Variable-depth tree may cause over-decomposition or under-decomposition without constraints. Needs a "decomposition strategy engine".
- **#22** Discussion groups may become token black holes - 5 roles x 3 rounds = 15 LLM calls per Epic discussion.
- **#23** Narrative generation hallucination risk. LLM may fabricate progress. Must be based on structured data, not free generation.
- **#24** Skill adapter abstraction leakage. Different providers have vastly different capabilities. Interface too thin = can't use advanced features; too thick = simple providers can't implement.
- **#25** Discussion + approval = process duplication. If roles already agree in discussion, why approve again separately?
- **#26** Variable-depth + discussion groups = state explosion. Every micro status change may trigger discussion messages and wake events.
- **#27** CLI UX challenge for discussion groups - hundreds of lines of messages in terminal is poor experience.

#### Green Hat (Creativity) - All Selected by User

- **#28** Smart Decomposition Depth Advisor: complexity-based dynamic recommendation (keyword density, module count, dependency count). Not free choice, not fixed constraint.
- **#29** Consensus-as-Approval: structured vote tags `[APPROVE]`/`[REVISE: reason]`/`[CONCERN: issue]` in discussion. When all `canApprove` roles vote APPROVE, auto-approve task. Eliminates separate approval step.
- **#30** Event Digester: aggregation layer between event bus and discussion groups. Collects events in configurable time window (e.g., 30s), merges into single summary notification. Inspired by database WAL batch flush.
- **#31** Narrative Template Engine: structured data query -> template fill -> LLM polish. LLM only responsible for "speaking naturally", not "what to say". Fact layer is deterministic DB queries.
- **#32** Three-Layer Skill Provider Interface:
  - L1 `IPromptProvider`: simplest - input task description, output system prompt string
  - L2 `ISkillProvider extends IPromptProvider`: multi-step execution, intermediate artifacts, validation rules
  - L3 `IWorkflowProvider extends ISkillProvider`: full workflow orchestration, conditional branches, loops
  - BMAD implements L3, custom prompt templates only need L1.
- **#33** Task Node Type Labels: nodes tagged with `epic`/`story`/`task`/`subtask`/`spike`/`bug`/`chore`. Tree depth is free, semantics via type label. "Epic -> Task" and "Epic -> Story -> Task" both valid.
- **#34** Discussion Auto-Summary & Context Injection: auto-generate/update discussion summary on new messages. Prompt injects latest summary + last 3 messages. Discussion group becomes self-compressing knowledge base.

#### Blue Hat (Process & Framework)

- **#35** Four Architecture Pillars: (1) Variable-depth task tree + type labels, (2) Discussion-driven decision-making, (3) Narrative engine, (4) Pluggable three-layer Skill adapter.
- **#36** New Domain Model Core Entities: Organization -> Role (+ pluggable Skill) -> TaskNode (variable depth, type-labeled) -> DiscussionGroup (auto-created for Epic-level TaskNodes) -> DiscussionMessage (with structured vote tags) -> Run (execution instance) -> Narrative (status snapshot).
- **#37** Information Flow Redesign: Requirement input -> Epic TaskNode created -> Discussion group auto-created -> AI roles analyze in discussion -> Decomposition advisor suggests depth -> Sub-TaskNodes created -> Role execution (Skill Provider) -> Artifact submission -> Structured voting in discussion -> Consensus auto-approval -> Event digester aggregates notifications -> Narrative engine generates status report.
- **#38** MVP Must-Solve Risks: Decomposition advisor (#28), Narrative template engine (#31), Three-layer Skill interface (#32), Consensus-as-approval (#29), Event digester (#30). These are architecture-level infrastructure, not V2 enhancements.
- **#39** Refactoring Strategy: Keep infrastructure (SQLite store, CLI adapter, EventBus, Logger, DI container). Rebuild application layer (OrgOrchestrator, TaskTreeService, DiscussionService, NarrativeEngine, DecompositionAdvisor). Redefine core layer (new domain model, interfaces, types).
- **#40** Success Metrics: (1) User inputs requirement -> system completes full loop, (2) Discussion groups have >3 rounds of meaningful inter-role debate, (3) `cpbr status` narrative lets outsider understand status in 30 seconds, (4) Switching Skill Provider requires zero business code changes.

## Idea Organization and Prioritization

### Thematic Organization

#### Theme 1: Variable-Depth Task Tree

_Core idea: Flexible replacement for fixed four-layer hierarchy_

| # | Idea | Type |
|---|------|------|
| #10 | Variable-depth task tree instead of fixed four layers | Intuition |
| #15 | Flexibility release - AI decides decomposition depth | Benefit |
| #21 | Runaway risk - needs decomposition strategy engine | Risk |
| #28 | Smart Decomposition Depth Advisor - complexity-based recommendation | Solution |
| #33 | Task Node Type Labels - decouple depth from semantics | Solution |

#### Theme 2: Discussion-Driven Decision-Making

_Core idea: Communication IS the decision process_

| # | Idea | Type |
|---|------|------|
| #11 | Discussion groups are core decision engine input | Intuition |
| #16 | Collective intelligence via discussion + consensus + approval | Benefit |
| #20 | Discussion groups naturally solve context passing | Benefit |
| #25 | Discussion + approval = process duplication risk | Risk |
| #29 | Consensus-as-Approval via structured vote tags | Solution |
| #34 | Discussion auto-summary & context injection | Solution |

#### Theme 3: Narrative Engine

_Core idea: System actively tells the story_

| # | Idea | Type |
|---|------|------|
| #12 | Narrative-driven status display | Intuition |
| #17 | Narrative status = natural project report | Benefit |
| #23 | Hallucination risk - must base on structured data | Risk |
| #31 | Narrative Template Engine - LLM only polishes, doesn't decide content | Solution |

#### Theme 4: Pluggable Skill Ecosystem

_Core idea: From BMAD tool to universal orchestration platform_

| # | Idea | Type |
|---|------|------|
| #13 | BMAD deep-binding concern | Intuition |
| #18 | Pluggable Skill layer opens ecosystem imagination | Benefit |
| #24 | Abstraction leakage risk - capability gap | Risk |
| #32 | Three-Layer Skill Provider Interface (L1/L2/L3) | Solution |

#### Theme 5: System Resilience & Control

_Core idea: Flexible but controllable_

| # | Idea | Type |
|---|------|------|
| #22 | Discussion group token budget risk | Risk |
| #26 | State explosion risk | Risk |
| #27 | CLI UX challenge for discussion groups | Risk |
| #30 | Event Digester - batch aggregation before dispatch | Solution |

#### Theme 6: Architecture & Refactoring Strategy

_Core idea: Swap the engine, keep the chassis_

| # | Idea | Type |
|---|------|------|
| #14 | Keep infrastructure, rebuild application layer | Intuition |
| #19 | Infrastructure reuse reduces refactoring risk | Benefit |
| #35 | Four Architecture Pillars | Framework |
| #36 | New Domain Model Core Entities | Framework |
| #37 | Information Flow Redesign - discussion groups as main pipeline | Framework |
| #38 | 5 risks MVP must solve | Framework |
| #39 | Refactoring strategy - keep chassis, rebuild engine | Framework |
| #40 | Success metrics - user-perception based | Framework |

### Prioritization Results

**Top Priority - Four Architecture Pillars (#35):**

1. Variable-depth task tree + type labels (#10, #15, #28, #33)
2. Discussion-driven decision-making (#11, #16, #29, #34)
3. Narrative engine (#12, #17, #31)
4. Pluggable three-layer Skill adapter (#13, #18, #32)

**MVP Must-Solve (#38):**

1. Decomposition Depth Advisor (#28)
2. Consensus-as-Approval protocol (#29)
3. Event Digester (#30)
4. Narrative Template Engine (#31)
5. Three-Layer Skill Provider Interface (#32)

**Breakthrough Concepts:**

- #29 Consensus-as-Approval - eliminates process duplication, makes discussion the primary workflow
- #33 Task Node Type Labels - elegantly decouples tree depth from task semantics
- #34 Discussion Auto-Summary - turns discussion groups into self-compressing knowledge bases
- #37 Discussion groups as main pipeline - not a side channel, but the core information flow

## Action Planning

### Step 1: Define New Domain Model

Based on #36, design core entities:

- `Organization` - org tree root with config
- `Role` - node in org tree with skills binding, permissions, status
- `TaskNode` - variable-depth tree node with type label (epic/story/task/subtask/spike/bug/chore)
- `DiscussionGroup` - auto-created for epic-level TaskNodes, lifecycle bound to Epic
- `DiscussionMessage` - messages with structured vote tags ([APPROVE]/[REVISE]/[CONCERN])
- `Run` - execution instance per role per task
- `Narrative` - generated status snapshot with timestamp

### Step 2: Design Skill Provider Three-Layer Interface

Based on #32:

- `IPromptProvider` (L1): `buildPrompt(context: TaskContext): string`
- `ISkillProvider` (L2): extends L1 + `executeSteps()`, `validateOutput()`, `getArtifacts()`
- `IWorkflowProvider` (L3): extends L2 + `getWorkflow()`, `evaluateConditions()`, `orchestrateFlow()`
- BMAD adapter implements L3, custom prompts implement L1

### Step 3: Design Discussion-Driven Decision Flow

Based on #29 + #37:

- Structured vote tag protocol: `[APPROVE]`, `[REVISE: reason]`, `[CONCERN: issue]`
- Consensus detection algorithm: all `canApprove` roles voted APPROVE -> auto-approve
- Discussion group auto-creation trigger: when TaskNode with type=epic is created
- Role auto-join rules: assignee + parent role + sibling task assignees

### Step 4: Design Event Digester

Based on #30:

- Configurable time window aggregation (default 30s)
- Event merge strategy: group by Epic, summarize state transitions
- Summary template system for notification generation
- Throttling rules to prevent notification storms

### Step 5: Design Narrative Template Engine

Based on #31:

- Data query layer: deterministic DB queries for task states, discussion summaries, role activities
- Template layer: Markdown templates with placeholders for structured data
- LLM polish layer: single LLM call to convert structured template into natural language narrative
- No hallucination risk: facts come from DB, LLM only styles the prose

### Step 6: Design Decomposition Depth Advisor

Based on #28:

- Complexity metrics: keyword density, estimated module count, dependency relationships, reference to prior similar tasks
- Depth recommendation: score -> suggested depth (1-4 levels)
- Semi-auto mode: depth suggestion requires human confirmation
- Full-auto mode: AI operates within recommended range

### Refactoring Path

**Keep (Infrastructure):**

- better-sqlite3 persistence layer
- tsyringe dependency injection container
- Emittery event bus
- Pino logger
- Commander CLI framework
- Zod validation
- dotenv configuration

**Rebuild (Application):**

- `OrgOrchestrator` replaces `PipelineService`
- `TaskTreeService` replaces DAG executor
- `DiscussionService` (new)
- `NarrativeEngine` (new)
- `DecompositionAdvisor` (new)
- `ConsensusDetector` (new)
- `EventDigester` (new)
- `SkillProviderRegistry` (new)

**Redefine (Core):**

- New domain model interfaces and types
- New service interfaces (ITaskTreeService, IDiscussionService, INarrativeEngine, etc.)
- New event types for discussion and consensus
- New error types for decomposition and consensus failures

### Success Metrics (#40)

1. User inputs a requirement -> system completes full analysis-to-delivery loop autonomously
2. Discussion groups contain >3 rounds of meaningful inter-role debate per Epic
3. `cpbr status` narrative allows uninformed reader to understand project state in 30 seconds
4. Switching Skill Provider (e.g., BMAD to custom prompts) requires zero business code changes

## Session Summary and Insights

**Key Achievements:**

- 40 breakthrough ideas generated across 6 thematic areas
- 4 core architecture pillars identified and validated through multi-perspective analysis
- 5 MVP must-solve risks identified with concrete creative solutions
- Clear refactoring path defined: keep infrastructure, rebuild application, redefine core
- Original concepts developed: Consensus-as-Approval, Event Digester, Narrative Template Engine, Task Node Type Labels

**Critical Design Decisions Emerged:**

- Variable-depth task tree with type labels replaces fixed four-layer hierarchy
- Discussion groups are the primary workflow pipeline, not a side communication channel
- Approval is an emergent result of discussion consensus, not a separate process
- Skill system uses three-layer progressive interface for maximum flexibility
- Narrative generation is template-driven with LLM polish, not free LLM generation

**Session Reflections:**

This session transformed the initial plan from "add two features to existing functional analysis" into a fundamentally rethought architecture. The key insight was that discussion groups should not be a communication addon but the central nervous system of the entire platform. Combined with variable-depth task trees and narrative-driven status, Capibara moves from being a "pipeline tool" to being a "living AI company" where roles genuinely collaborate, debate, and make collective decisions.

### Creative Facilitation Narrative

_The session began with structured question storming to expose blind spots, then progressed through Six Thinking Hats. The Red Hat (intuition) phase proved most generative - the user's strong resonance with ideas #10 (variable depth), #11 (discussion as decision engine), #12 (narrative status), and #13 (pluggable skills) established the creative direction. The Green Hat (creativity) phase then produced concrete solutions for every flagged risk, culminating in the Blue Hat framework that unified all insights into four architecture pillars with a clear action plan._
