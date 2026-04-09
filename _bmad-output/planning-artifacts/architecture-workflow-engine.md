---
stepsCompleted: [1, 2, 3, 4, 5, 6, 7, 8]
lastStep: 8
status: 'complete'
completedAt: '2026-04-09'
inputDocuments:
  - _bmad-output/planning-artifacts/prd.md
  - _bmad-output/planning-artifacts/architecture.md
  - _bmad-output/project-context.md
workflowType: 'architecture'
project_name: 'capibara'
user_name: 'uoyo'
date: '2026-04-09'
---

# Architecture Decision Document: Schema-Driven Workflow Engine

_This document defines the architecture for transforming Capibara's hardcoded work item types and workflow into a fully user-customizable, schema-driven system._

## 1. Project Context Analysis

### 1.1 Requirements Overview

**Functional Requirements (Workflow Engine Scope):**

This architecture document addresses the extraction and generalization of Capibara's work item type system and workflow engine, transforming hardcoded task types (epic/story/task/subtask/spike/bug/chore), statuses (pending/in_progress/awaiting_review/revision/approved/done/blocked/cancelled), hierarchy rules, state transitions, and auto-propagation behaviors into a fully user-customizable, schema-driven system at the organization level.

Key PRD references:
- FR-02 (Task System): Variable-depth task tree with type labels — currently hardcoded, to be made dynamic
- FR-05 (Consensus Detection): Hardcoded vote processing rules — to be driven by workflow schema behaviors
- FR-07 (Wake-Up Loop): Wake target calculation tied to task type semantics — to be schema-driven
- PRD Section 9 V2: "Declarative automation rules engine" — this document designs that engine

**Non-Functional Requirements:**

- NFR-03 (Extensibility): Schema-driven workflow directly serves the extensibility goal
- NFR-05 (Data Integrity): Schema changes must not corrupt existing task state
- Performance: BehaviorEngine rule evaluation must not introduce perceptible latency in the wake-up loop

**Scale & Complexity:**

- Primary domain: State machine engine + Rules engine + Event-driven orchestration
- Complexity level: High
- Estimated new architectural components: 5-7 (WorkflowSchema types, WorkflowEngine, BehaviorEngine, SchemaRepository, schema migration utilities, dynamic prompt builder adapter, schema CRUD API)

### 1.2 Technical Constraints & Dependencies

| Constraint | Source | Impact |
|-----------|--------|--------|
| Layered architecture (app -> core <- infra) | Existing architecture ADR | WorkflowEngine in `application/`, schema types in `core/types/`, persistence in `infrastructure/` |
| DI via tsyringe | Project conventions | All new services must be `@injectable()`, registered in `composition-root.ts` |
| EventBus (Emittery) | Existing architecture | Behavior rule execution triggers via typed events |
| SQLite (synchronous) | Tech stack | Schema storage follows Repository pattern with `Promise<T>` |
| MCP tool bridge (stdio) | ADR-04 | Tool descriptions must be dynamically generated from active schema |
| ESM + strict TypeScript | Project rules | `.js` import extensions, no `any` types |
| Greenfield — no backward compatibility | User directive | No migration shims, compatibility layers, or default fallbacks required |

### 1.3 Cross-Cutting Concerns

1. **Schema Availability**: Every service that currently references TaskType/TaskStatus must obtain the active WorkflowSchema — this affects orchestrator, state machine, task service, prompt builder, MCP handlers, discussion service, and execution context builder
2. **Type Safety Trade-off**: Moving from compile-time union types to runtime string validation reduces TypeScript safety — must be compensated by comprehensive runtime validation in WorkflowEngine
3. **AI Prompt Generation**: PromptBuilder must dynamically describe available task types, hierarchy rules, and workflow states to AI agents — prompt quality directly affects system behavior
4. **Frontend Dynamic Rendering**: React components must render status options, type selectors, and workflow visualizations from schema data, not hardcoded enums
5. **Schema Versioning**: Active tasks reference the schema version under which they were created — schema evolution must handle in-flight tasks

## 2. Core Architectural Decisions

### 2.1 Data Architecture

**ADR-WE-01: Schema Storage — JSON Column**

- **Decision**: Store the complete WorkflowSchema as a single `schema_json TEXT` column in the `workflow_schemas` table
- **Rationale**: Schema is always loaded as a whole object, never queried by individual fields. Write frequency is extremely low (user configuration only). SQLite `json_extract` available for ad-hoc queries if needed.
- **Affects**: `infrastructure/persistence/sqlite/`, `core/interfaces/i-workflow-schema.repository.ts`

**ADR-WE-02: Schema-TaskNode Relationship — Single Active Schema Per Org**

- **Decision**: Each organization has one active WorkflowSchema. TaskNodes do not reference a schema version — they inherit the organization's current active schema via `orgId`.
- **Rationale**: Greenfield project with no backward compatibility requirement. Simplest model — avoids version tracking complexity. If a user modifies the schema in a way that conflicts with existing tasks, the Schema Editor UI validates and warns before saving.
- **Affects**: `task_nodes` table (no schema_version column), `workflow_schemas` table (unique active per org)

**ADR-WE-03: Schema Caching — In-Process Cache with EventBus Refresh**

- **Decision**: WorkflowEngine loads the active schema into an in-memory `Map<orgId, WorkflowSchema>` on first access. Schema mutations emit a `schema:updated` event on EventBus, which triggers cache invalidation.
- **Rationale**: Schema reads are extremely high frequency (every task operation), writes are extremely low frequency (user configuration). In-process cache eliminates redundant DB reads. EventBus refresh ensures consistency.
- **Affects**: `application/workflow/workflow-engine.ts`, `core/types/event.types.ts`

### 2.2 Work Item Type System

**ADR-WE-04: WorkItemTypeDefinition Model**

- **Decision**: Each user-defined work item type is described by the following properties:

```typescript
interface WorkItemTypeDefinition {
  name: string;                // Unique identifier, kebab-case enforced (e.g. 'user-story')
  label: string;               // Display name, supports i18n (e.g. 'User Story', '用户故事')
  icon?: string;               // Icon identifier for UI
  color?: string;              // Color identifier for UI
  isLeaf: boolean;             // Leaf node — cannot have children, auto-completes on approval
  allowedChildren: string[];   // Allowed child type names (empty for leaf types)
  allowedAtRoot: boolean;      // Can be created as root-level item
  canDecompose: boolean;       // Supports decomposition behavior (Phase 2 wake-up)
  hasDiscussionGroup: boolean; // Auto-creates a DiscussionGroup when task of this type is created
}
```

- **Rationale**: Each property maps to a specific behavioral semantic that was previously hardcoded. `isLeaf` replaces the `leafTypes.includes()` check. `canDecompose` replaces `type === 'epic' || type === 'story'`. `hasDiscussionGroup` replaces the auto-creation condition. `allowedChildren` replaces the `ALLOWED_CHILDREN` constant.
- **Affects**: Replaces `TaskType` union in `domain.types.ts`, `ALLOWED_CHILDREN` in `task.service.ts`

**ADR-WE-05: Type Name Convention — kebab-case Identifier + Free Label**

- **Decision**: `name` field is enforced as kebab-case (validated by Zod regex). `label` field is free-form string supporting any language.
- **Rationale**: `name` is used in database storage, API payloads, event payloads, and MCP tool parameters — must be machine-safe. `label` is UI-only and supports i18n.
- **Affects**: `shared/contracts.ts` (Zod validation), `core/types/workflow-schema.types.ts`

### 2.3 Status & Workflow

**ADR-WE-06: Status Category Model — Four Categories**

- **Decision**: Each status definition carries a `category` field with four possible values:

```typescript
interface StatusDefinition {
  name: string;                                        // e.g. 'in-progress'
  label: string;                                       // Display name
  category: 'initial' | 'active' | 'review' | 'terminal';
}
```

  - `initial`: The default status for newly created tasks. Exactly one status must have this category.
  - `active`: In-progress working states.
  - `review`: States where review/approval is pending.
  - `terminal`: End states (done, cancelled equivalents). Used by BehaviorEngine to determine "task is complete".

- **Rationale**: Replaces hardcoded checks like `status === 'done' || status === 'cancelled'` with `category === 'terminal'`. Four categories cover all current behavioral semantics without over-granularity.
- **Affects**: Replaces `TaskStatus` union in `domain.types.ts`, `TASK_TRANSITIONS` in `task.constants.ts`

**ADR-WE-07: Transition Definitions — With Trigger Type**

- **Decision**: Each transition carries a `trigger` classification:

```typescript
interface TransitionDefinition {
  from: string;       // Source status name
  to: string;         // Target status name
  trigger: 'manual' | 'auto' | 'system';
}
```

  - `manual`: User or AI agent explicitly requests this transition (e.g. start work, submit for review)
  - `auto`: BehaviorEngine triggers automatically (e.g. leaf auto-complete, parent auto-propagate)
  - `system`: System-level transitions (e.g. timeout → blocked, budget exceeded → cancelled)

- **Rationale**: Distinguishes who/what can invoke a transition. MCP tools and UI only expose `manual` transitions. `auto` transitions are reserved for BehaviorEngine. `system` transitions are reserved for infrastructure-level events.
- **Affects**: `application/workflow/workflow-engine.ts`, `application/state-machine/task.state-machine.ts`

### 2.4 Behavior Rules Engine

**ADR-WE-08: Trigger-Condition-Action Rule Model**

- **Decision**: Behavior rules follow a Trigger-Condition-Action (TCA) pattern:

```typescript
interface BehaviorRule {
  id: string;
  name: string;
  priority: number;            // Lower number = higher priority (executed first)
  trigger: BehaviorTrigger;
  condition: BehaviorCondition;
  action: BehaviorAction;
}
```

**Triggers** (when to evaluate):

| Trigger Type | Parameters | Semantics |
|-------------|-----------|-----------|
| `on_status_enter` | `{ status: string }` | Task enters a specific status |
| `on_task_created` | `{}` | A new task is created |
| `on_all_children_terminal` | `{}` | All child nodes reach terminal category |
| `on_children_of_type_terminal` | `{ childTypes: string[] }` | All children of specified types reach terminal category |

**Conditions** (whether to execute):

| Condition Type | Parameters | Semantics |
|---------------|-----------|-----------|
| `always` | `{}` | Unconditional |
| `item_is_leaf` | `{}` | Current item's type definition has `isLeaf: true` |
| `item_has_no_children` | `{}` | Current item has zero child tasks |
| `item_type_in` | `{ types: string[] }` | Current item's type matches one of the listed types |
| `item_in_status` | `{ statuses: string[] }` | Current item's status matches |
| `parent_in_status` | `{ statuses: string[] }` | Parent item's status matches |
| `and` | `{ conditions: BehaviorCondition[] }` | All sub-conditions must be true |
| `or` | `{ conditions: BehaviorCondition[] }` | Any sub-condition must be true |
| `not` | `{ condition: BehaviorCondition }` | Negation |

**Actions** (what to do):

| Action Type | Parameters | Semantics |
|------------|-----------|-----------|
| `auto_transition` | `{ targetStatus: string }` | Transition current task to target status |
| `wake_assignee` | `{ trigger: string }` | Wake current task's assignee role |
| `wake_parent_assignee` | `{ trigger: string }` | Wake parent task's assignee role |
| `skip_propagation` | `{}` | Prevent auto-propagation for this event cycle |
| `create_discussion_group` | `{}` | Create a DiscussionGroup bound to current task |

- **Rationale**: This model is expressive enough to encode all current hardcoded behaviors (leaf auto-complete, Phase 2 hold, parent auto-propagation, discussion group creation) while being extensible for user-defined rules. The composable condition system (and/or/not) supports complex cross-level rules without building a full scripting engine.
- **Affects**: New files `core/types/behavior.types.ts`, `application/workflow/behavior-engine.ts`

**ADR-WE-09: Rule Execution Strategy — Grouped Execution with Short-Circuit**

- **Decision**: Rules are grouped by trigger type. Within each group, all matching rules execute in priority order. The `skip_propagation` action acts as a short-circuit — it prevents subsequent rules in the same trigger group from executing.
- **Rationale**: Mirrors the implicit priority of current if/else branches in `updateStatus()`. The "Phase 2 hold" behavior (skip propagation when decomposer has no children) must take precedence over "parent auto-propagate", which is naturally expressed by giving it higher priority and using short-circuit.
- **Affects**: `application/workflow/behavior-engine.ts`

### 2.5 Integration Architecture

**ADR-WE-10: WorkflowEngine as Sole Schema Gateway**

- **Decision**: All schema access goes through WorkflowEngine's public API. No service directly reads WorkflowSchema objects. WorkflowEngine exposes semantic methods:

```typescript
interface IWorkflowEngine {
  // Type validation
  validateType(orgId: string, type: string, parentType: string | null): Promise<boolean>;
  getItemTypeDefinition(orgId: string, type: string): Promise<WorkItemTypeDefinition | null>;
  getAllItemTypes(orgId: string): Promise<WorkItemTypeDefinition[]>;
  getRootTypes(orgId: string): Promise<WorkItemTypeDefinition[]>;

  // Status & transition validation
  canTransition(orgId: string, from: string, to: string): Promise<boolean>;
  getManualTransitions(orgId: string, from: string): Promise<TransitionDefinition[]>;
  getAllStatuses(orgId: string): Promise<StatusDefinition[]>;
  getInitialStatus(orgId: string): Promise<string>;
  isTerminalStatus(orgId: string, status: string): Promise<boolean>;

  // Behavior rule evaluation
  evaluateBehaviors(orgId: string, trigger: BehaviorTrigger, context: BehaviorContext): Promise<BehaviorAction[]>;

  // Schema CRUD
  getActiveSchema(orgId: string): Promise<WorkflowSchema>;
  saveSchema(orgId: string, schema: WorkflowSchema): Promise<void>;

  // Cache management
  invalidateCache(orgId: string): void;
}
```

- **Rationale**: Single point of access ensures cache consistency, centralizes validation logic, and isolates downstream services from schema structure changes. Services like TaskService, OrgOrchestrator, and PromptBuilder call WorkflowEngine methods instead of checking types/statuses directly.
- **Affects**: All services that currently reference `TaskType`, `TaskStatus`, `ALLOWED_CHILDREN`, or `TASK_TRANSITIONS`

### 2.6 Decision Impact Analysis

**Implementation Sequence:**

1. Define core types in `core/types/` (WorkflowSchema, WorkItemTypeDefinition, StatusDefinition, TransitionDefinition, BehaviorRule)
2. Define `IWorkflowEngine` interface and `IWorkflowSchemaRepository` interface in `core/interfaces/`
3. Implement `SqliteWorkflowSchemaRepository` in `infrastructure/persistence/sqlite/`
4. Implement `WorkflowEngine` (type/status validation + cache) in `application/workflow/`
5. Implement `BehaviorEngine` (rule evaluation) in `application/workflow/`
6. Refactor `TaskStateMachine` to delegate to `WorkflowEngine`
7. Refactor `TaskService` to delegate type validation and behavior execution
8. Refactor `OrgOrchestrator` to use `WorkflowEngine` for type semantics
9. Refactor `PromptBuilder` for dynamic type/status descriptions
10. Refactor `MCP tool handlers` for dynamic validation and descriptions
11. Update `shared/contracts.ts` Zod schemas
12. Update database migrations
13. Add Schema CRUD IPC handlers and frontend UI

**Cross-Component Dependencies:**

- WorkflowEngine depends on: IWorkflowSchemaRepository, IEventBus
- BehaviorEngine depends on: WorkflowEngine, ITaskRepository, IEventBus
- TaskStateMachine depends on: WorkflowEngine (replaces TASK_TRANSITIONS)
- TaskService depends on: WorkflowEngine (replaces ALLOWED_CHILDREN), BehaviorEngine (replaces hardcoded auto-propagation)
- OrgOrchestrator depends on: WorkflowEngine (replaces type checks)
- PromptBuilder depends on: WorkflowEngine (dynamic descriptions)
- MCP tool handlers depends on: WorkflowEngine (dynamic validation)

## 3. Implementation Patterns & Consistency Rules

### 3.1 Workflow Engine Module Conflict Points

5 critical areas where AI agents could make divergent choices when implementing the workflow engine.

### 3.2 Type Definition Organization

Schema-related types split into two files in `core/types/`:

| File | Contains |
|------|----------|
| `workflow-schema.types.ts` | `WorkflowSchema`, `WorkItemTypeDefinition`, `StatusDefinition`, `TransitionDefinition` |
| `behavior.types.ts` | `BehaviorRule`, `BehaviorTrigger`, `BehaviorCondition`, `BehaviorAction` |

No barrel exports. Import directly from specific files.

### 3.3 Tagged Union Serialization Pattern

All discriminated unions (Trigger, Condition, Action) use `type` as the discriminator field. This applies to both TypeScript type definitions and JSON storage format.

```typescript
// CORRECT: type discriminator
{ type: 'item_type_in', types: ['epic'] }

// WRONG: kind, tag, or other discriminators
{ kind: 'item_type_in', types: ['epic'] }
```

Zod validation uses `z.discriminatedUnion('type', [...])` for all behavior rule components.

### 3.4 Error Hierarchy

New error classes extend the existing `CapibaraError` base:

```
CapibaraError
  +-- WorkflowSchemaError (base for all workflow engine errors)
        +-- InvalidTypeError        (type validation failures)
        +-- InvalidTransitionError  (state transition violations)
        +-- SchemaValidationError   (schema structure validation failures)
```

All errors include descriptive messages with the invalid values for debugging.

### 3.5 Service Refactoring Pattern: Delegate, Don't Rewrite

When refactoring existing services to use WorkflowEngine:

**Rule**: Replace hardcoded checks with WorkflowEngine method calls. Do NOT restructure surrounding logic, change control flow, or rewrite methods.

```typescript
// Pattern: Surgical replacement
// BEFORE:
const leafTypes: TaskType[] = ['subtask', 'spike', 'bug', 'chore'];
if (leafTypes.includes(task.type)) { ... }

// AFTER:
const typeDef = await this.workflowEngine.getItemTypeDefinition(task.orgId, task.type);
if (typeDef?.isLeaf) { ... }
```

This minimizes blast radius and keeps git diffs reviewable.

### 3.6 Event Naming for Schema Module

New events follow existing `entity:lifecycle` convention:

| Event | Payload | When |
|-------|---------|------|
| `schema:updated` | `{ orgId }` | Schema saved successfully |
| `behavior:executed` | `{ orgId, ruleId, ruleName, taskId, action }` | A behavior rule fires |

All event payloads include `orgId` as the first field for consistency with existing events.

### 3.7 Enforcement Rules

**All AI Agents implementing the workflow engine MUST:**

1. Never reference hardcoded type names ('epic', 'story', etc.) — always query WorkflowEngine
2. Never reference hardcoded status names ('done', 'cancelled', etc.) — use `isTerminalStatus()` or `getInitialStatus()`
3. Use `type` as the discriminator for all tagged unions in behavior rules
4. Extend `WorkflowSchemaError` for all new error types
5. Follow delegate-not-rewrite pattern when modifying existing services

## 4. Project Structure & Boundaries

### 4.1 New & Modified Files

```
apps/electron/src/main/
+-- core/
|   +-- types/
|   |   +-- workflow-schema.types.ts        [NEW] Schema, ItemType, Status, Transition types
|   |   +-- behavior.types.ts               [NEW] BehaviorRule, Trigger, Condition, Action types
|   |   +-- domain.types.ts                 [MOD] TaskType/TaskStatus unions -> string
|   +-- interfaces/
|   |   +-- i-workflow-engine.ts            [NEW] IWorkflowEngine interface
|   |   +-- i-workflow-schema.repository.ts [NEW] IWorkflowSchemaRepository interface
|   |   +-- i-task.repository.ts            [MOD] TaskType/TaskStatus references -> string
|   +-- errors/
|   |   +-- workflow.errors.ts              [NEW] WorkflowSchemaError hierarchy
|   +-- constants/
|   |   +-- task.constants.ts               [DEL] TASK_TRANSITIONS removed (schema-driven)
|   +-- tokens.ts                           [MOD] Add WORKFLOW_ENGINE_TOKEN, BEHAVIOR_ENGINE_TOKEN, WORKFLOW_SCHEMA_REPO_TOKEN
|
+-- application/
|   +-- workflow/                            [NEW] Entire directory
|   |   +-- workflow-engine.ts              [NEW] Schema cache + validation + query
|   |   +-- behavior-engine.ts             [NEW] TCA rule engine
|   +-- tasks/
|   |   +-- task.service.ts                 [MOD] Delegate to WorkflowEngine/BehaviorEngine
|   +-- state-machine/
|   |   +-- task.state-machine.ts           [MOD] Delegate to WorkflowEngine.canTransition()
|   +-- orchestrator/
|   |   +-- org.orchestrator.ts             [MOD] Type semantics via WorkflowEngine
|   +-- skills/
|   |   +-- prompt-builder.ts              [MOD] Dynamic type/status descriptions
|   +-- context/
|       +-- execution.context.ts            [MOD] Type references via WorkflowEngine
|
+-- infrastructure/
|   +-- persistence/sqlite/
|   |   +-- sqlite-workflow-schema.repository.ts  [NEW] Schema CRUD persistence
|   |   +-- migrations.ts                          [MOD] Add workflow_schemas table, remove CHECK constraints
|   |   +-- sqlite-task.repository.ts              [MOD] type/status field adaptation
|   +-- mcp/
|       +-- mcp-tool-handlers.ts                   [MOD] Dynamic validation and tool descriptions
|
+-- ipc-handlers/
|   +-- workflow-schema.handlers.ts                [NEW] Schema CRUD IPC entry
|
+-- composition-root.ts                            [MOD] Register new DI bindings

apps/shared/
+-- contracts.ts                                   [MOD] z.enum -> z.string, add Schema CRUD IPC channels
```

### 4.2 Architectural Boundary Diagram

```
                    IPC Boundary (Zod validated)
                           |
    Renderer --------------+-------- workflow-schema.handlers.ts
                           |
                    +------v------------------------------+
                    |       Application Layer              |
                    |                                      |
                    |  +-------------------------------+   |
                    |  |     WorkflowEngine            |   |  <-- Sole gateway to schema
                    |  |  (cache + validate + query)   |   |
                    |  +---------------+---------------+   |
                    |                  |                    |
                    |  +---------------v---------------+   |
                    |  |     BehaviorEngine            |   |  <-- Rule evaluation
                    |  |  (trigger -> condition -> act) |   |
                    |  +-------------------------------+   |
                    |                  |                    |
                    |  +---------------v-------------------------------------------+
                    |  | TaskService | TaskStateMachine | Orchestrator             |
                    |  | PromptBuilder | DiscussionService | ExecutionContext      |  <-- Consumers
                    |  +----------------------------------------------------------+
                    |                                      |
                    +------------------+-------------------+
                                       | core/ interfaces only
                    +------------------v-------------------+
                    |     Infrastructure Layer              |
                    |  SqliteWorkflowSchemaRepository       |
                    +--------------------------------------+
```

**Boundary Rules:**

1. WorkflowEngine is the sole schema access gateway — all application layer services obtain type/status/rule information through it
2. BehaviorEngine obtains schema through WorkflowEngine — never accesses Repository directly
3. Infrastructure layer only implements core/interfaces — `SqliteWorkflowSchemaRepository` implements `IWorkflowSchemaRepository`
4. IPC handlers only call application layer services — never manipulate Schema objects directly

### 4.3 Database Changes

```sql
-- New table
CREATE TABLE workflow_schemas (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  schema_json TEXT NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(org_id, is_active)
);

-- Modified: task_nodes table removes CHECK constraints
-- type TEXT NOT NULL       (no CHECK — validated by WorkflowEngine at runtime)
-- status TEXT NOT NULL     (no CHECK — validated by WorkflowEngine at runtime)
```

### 4.4 Requirements to Structure Mapping

| Requirement | New/Modified Files | Layer |
|-------------|-------------------|-------|
| Custom work item types | `workflow-schema.types.ts`, `workflow-engine.ts` | core + application |
| Custom status transitions | `workflow-schema.types.ts`, `workflow-engine.ts`, `task.state-machine.ts` | core + application |
| Behavior rules engine | `behavior.types.ts`, `behavior-engine.ts` | core + application |
| Cross-level condition rules | `behavior-engine.ts` (`on_children_of_type_terminal` trigger) | application |
| Schema persistence | `sqlite-workflow-schema.repository.ts`, `migrations.ts` | infrastructure |
| Schema CRUD API | `workflow-schema.handlers.ts`, `contracts.ts` | ipc-handlers + shared |
| Dynamic AI prompts | `prompt-builder.ts` | application |
| Dynamic MCP tools | `mcp-tool-handlers.ts` | infrastructure |
| Existing service adaptation | `task.service.ts`, `org.orchestrator.ts`, `discussion.service.ts` | application |

## 5. Architecture Validation Results

### 5.1 Coherence Validation: PASSED

**Decision Compatibility:**

All 10 architectural decisions (ADR-WE-01 through ADR-WE-10) are mutually compatible:

- JSON storage + in-process cache: JSON column deserialized once, cached in memory Map, EventBus refresh on mutation
- Single active schema + cache invalidation: `schema:updated` event triggers `invalidateCache()`, guarantees consistency
- TCA rule model + grouped execution: Rules grouped by trigger, priority-ordered, short-circuit mechanism aligns with existing if/else semantics
- WorkflowEngine gateway + DI: Token-based injection, all consumers depend on `IWorkflowEngine` interface not implementation
- Tagged union + Zod discriminatedUnion: TypeScript types and Zod validation share `type` discriminator, serialization path unified

**Pattern Consistency:**

- All new files follow kebab-case naming (`workflow-engine.ts`, `behavior-engine.ts`)
- All new interfaces follow `I` prefix (`IWorkflowEngine`, `IWorkflowSchemaRepository`)
- All new DI tokens follow `SCREAMING_SNAKE_CASE_TOKEN`
- Event naming follows `entity:lifecycle` pattern
- Error classes follow `CapibaraError` inheritance hierarchy

**Structure Alignment:**

- New `application/workflow/` directory follows existing feature-based organization
- New infrastructure files follow existing `sqlite-*.repository.ts` naming
- New IPC handlers follow existing handler registration pattern
- All layer boundary rules respected (no cross-layer imports)

### 5.2 Requirements Coverage Validation: PASSED

| Requirement | Architecture Coverage | ADR |
|-------------|----------------------|-----|
| Custom work item types | `WorkItemTypeDefinition` + `WorkflowEngine.validateType()` | ADR-WE-04, ADR-WE-05 |
| Custom statuses | `StatusDefinition` + 4-category model | ADR-WE-06 |
| Custom state transitions | `TransitionDefinition` with trigger types | ADR-WE-07 |
| Hierarchy rules (parent-child) | `allowedChildren` + `allowedAtRoot` properties | ADR-WE-04 |
| Cross-level condition rules | `on_children_of_type_terminal` trigger + `item_type_in` condition | ADR-WE-08 |
| Leaf node auto-complete | `isLeaf` property + `on_status_enter` trigger + `item_is_leaf` condition | ADR-WE-04, ADR-WE-08 |
| Decomposition behavior (Phase 2) | `canDecompose` property + `skip_propagation` action | ADR-WE-04, ADR-WE-08 |
| Discussion group auto-creation | `hasDiscussionGroup` property + `create_discussion_group` action | ADR-WE-04, ADR-WE-08 |
| Organization-level configuration | Schema bound to `orgId`, single active schema per org | ADR-WE-02 |
| Dynamic AI prompts | `PromptBuilder` queries `WorkflowEngine` for type/status descriptions | ADR-WE-10 |
| Dynamic MCP tools | `mcp-tool-handlers.ts` queries `WorkflowEngine` for validation | ADR-WE-10 |
| Schema persistence | `SqliteWorkflowSchemaRepository` + JSON column | ADR-WE-01 |
| Schema caching | In-process `Map<orgId, WorkflowSchema>` + EventBus refresh | ADR-WE-03 |

**Non-Functional Requirements:**

- NFR-03 (Extensibility): Fully addressed — schema-driven system is inherently extensible
- NFR-05 (Data Integrity): Addressed via schema validation on save + impact analysis for in-flight tasks
- Performance: In-process cache eliminates DB reads for high-frequency operations; rule evaluation is O(n) where n = number of rules per trigger group (typically < 10)

### 5.3 Implementation Readiness Validation: PASSED

**Decision Completeness:**

- All 10 ADRs documented with rationale and affected components
- Type definitions include complete TypeScript interfaces with field-level documentation
- `IWorkflowEngine` interface fully specified with all method signatures

**Structure Completeness:**

- All new files listed with [NEW] tag and layer assignment
- All modified files listed with [MOD] tag and change description
- One file marked [DEL] (`task.constants.ts`)
- Database migration SQL provided

**Pattern Completeness:**

- 5 conflict points identified and resolved
- Enforcement rules clearly stated
- Delegate-not-rewrite pattern with concrete before/after examples

### 5.4 Gap Analysis

**Gap 1 (Important): Schema Self-Validation on Save**

`WorkflowEngine.saveSchema()` must validate schema integrity before persisting:

- Exactly one status with `category: 'initial'`
- At least one status with `category: 'terminal'`
- All `allowedChildren` reference existing type names in the same schema
- All `TransitionDefinition.from` and `.to` reference existing status names
- All `BehaviorRule` type/status references exist in schema
- No orphan statuses (unreachable from initial status via transitions)

Implementation: Add a `validateSchemaIntegrity(schema: WorkflowSchema): SchemaValidationError[]` method to WorkflowEngine. Called internally by `saveSchema()`. Throws `SchemaValidationError` with all violations if any found.

**Gap 2 (Nice-to-have): In-Flight Task Impact Analysis**

When saving a modified schema, `WorkflowEngine.saveSchema()` should check for active tasks that reference types/statuses being removed:

- Query `task_nodes` for non-terminal tasks whose `type` or `status` is absent in the new schema
- Return a `SchemaImpactReport` with affected task count and details
- Frontend displays confirmation dialog before proceeding
- Does not block save — user makes the final decision

### 5.5 Architecture Completeness Checklist

**Requirements Analysis**

- [x] Project context thoroughly analyzed
- [x] Scale and complexity assessed (High)
- [x] Technical constraints identified (7 constraints)
- [x] Cross-cutting concerns mapped (5 concerns)

**Architectural Decisions**

- [x] 10 ADRs documented with rationale
- [x] Data architecture fully specified (storage, caching, relationships)
- [x] Type system fully specified (properties, naming, validation)
- [x] State machine fully specified (categories, transitions, triggers)
- [x] Behavior engine fully specified (TCA model, execution strategy)
- [x] Integration architecture fully specified (gateway pattern)

**Implementation Patterns**

- [x] Type file organization defined
- [x] Tagged union serialization pattern established
- [x] Error hierarchy defined
- [x] Service refactoring pattern (delegate-not-rewrite) documented
- [x] Event naming conventions established
- [x] Enforcement rules documented

**Project Structure**

- [x] All new/modified/deleted files listed
- [x] Architectural boundary diagram provided
- [x] Database changes specified with SQL
- [x] Requirements-to-structure mapping complete

### 5.6 Architecture Readiness Assessment

**Overall Status:** READY FOR IMPLEMENTATION

**Confidence Level:** High

**Key Strengths:**

1. Clean separation — WorkflowEngine as sole gateway prevents schema leakage across services
2. Expressive yet bounded — TCA rule model covers all current behaviors without building a scripting engine
3. Minimal blast radius — delegate-not-rewrite pattern keeps existing service logic intact
4. Schema self-validation — prevents invalid configurations from corrupting runtime behavior

**Areas for Future Enhancement:**

1. Schema versioning with migration support (if backward compatibility becomes needed later)
2. Visual workflow editor in frontend (drag-and-drop state machine builder)
3. Rule execution audit log and debugging UI
4. Schema templates/presets for common workflows (Kanban, Scrum, etc.)
5. Conditional actions with multiple outputs (if/then/else within a single rule)

### 5.7 Implementation Handoff

**AI Agent Guidelines:**

- Follow all 10 ADRs exactly as documented
- Use implementation patterns consistently (tagged unions, error hierarchy, delegate pattern)
- Respect architectural boundaries (WorkflowEngine gateway, layer imports)
- Refer to Section 2.6 for implementation sequence

**Implementation Priority:**

1. Core types (`workflow-schema.types.ts`, `behavior.types.ts`)
2. Interfaces (`i-workflow-engine.ts`, `i-workflow-schema.repository.ts`)
3. Infrastructure (`sqlite-workflow-schema.repository.ts`, migrations)
4. Engine (`workflow-engine.ts`, `behavior-engine.ts`)
5. Service refactoring (TaskStateMachine -> TaskService -> OrgOrchestrator -> PromptBuilder -> MCP handlers)
6. IPC + Frontend (Schema CRUD UI)
