---
stepsCompleted: [1, 2, 3, 4]
status: 'complete'
completedAt: '2026-04-09'
inputDocuments:
  - _bmad-output/planning-artifacts/architecture-workflow-engine.md
  - _bmad-output/planning-artifacts/prd.md
  - _bmad-output/planning-artifacts/architecture.md
---

# Capibara Workflow Engine - Epic Breakdown

## Overview

This document provides the complete epic and story breakdown for Capibara's Schema-Driven Workflow Engine, decomposing the requirements from the architecture decision document into implementable stories.

## Requirements Inventory

### Functional Requirements

FR-WE-01: The system shall support user-defined work item types at the organization level, including name, label, icon, color, isLeaf, allowedChildren, allowedAtRoot, canDecompose, and hasDiscussionGroup properties
FR-WE-02: The system shall support user-defined workflow statuses, each carrying name, label, and category (initial/active/review/terminal)
FR-WE-03: The system shall support user-defined state transition rules, each annotated with trigger type (manual/auto/system)
FR-WE-04: The system shall implement a Trigger-Condition-Action behavior rules engine supporting 4 trigger types, 9 condition types (including and/or/not composition), and 5 action types
FR-WE-05: Behavior rules shall execute grouped by trigger, ordered by priority, with skip_propagation action short-circuiting subsequent rules in the same group
FR-WE-06: The system shall store WorkflowSchema as JSON in a workflow_schemas table, with exactly one active schema per organization
FR-WE-07: WorkflowEngine shall implement in-process caching with EventBus schema:updated event refresh
FR-WE-08: WorkflowEngine shall serve as the sole schema access gateway, exposing semantic methods for type validation, transition validation, and behavior evaluation
FR-WE-09: Schema save operations shall perform integrity validation (unique initial status, at least one terminal status, reference consistency, no orphan statuses)
FR-WE-10: Schema save operations shall analyze impact on in-flight tasks and return an impact report for user confirmation
FR-WE-11: TaskStateMachine shall delegate state transition validation to WorkflowEngine, replacing hardcoded TASK_TRANSITIONS
FR-WE-12: TaskService shall delegate type hierarchy validation to WorkflowEngine and auto-propagation logic to BehaviorEngine
FR-WE-13: OrgOrchestrator shall query type semantics (canDecompose, etc.) via WorkflowEngine, replacing hardcoded type checks
FR-WE-14: PromptBuilder shall dynamically generate type hierarchy and status descriptions from WorkflowEngine for AI prompts
FR-WE-15: MCP tool handlers shall dynamically obtain valid type and status lists from WorkflowEngine for tool validation and descriptions
FR-WE-16: TaskType and TaskStatus in domain.types.ts shall change from union literals to string types
FR-WE-17: task_nodes table shall remove CHECK constraints on type and status fields
FR-WE-18: Zod schemas in shared/contracts.ts shall change from z.enum to z.string validation
FR-WE-19: The system shall provide Schema CRUD IPC channels for frontend schema editing

### NonFunctional Requirements

NFR-WE-01: Schema cache shall ensure zero perceptible latency for high-frequency read operations
NFR-WE-02: BehaviorEngine rule evaluation shall maintain O(n) complexity (n = rules per trigger group, typically < 10)
NFR-WE-03: All new services must use @injectable() decorator and register in composition-root.ts
NFR-WE-04: All new type definitions must reside in core/types/, no inline types in implementation files
NFR-WE-05: All new files must use .js import extensions following ESM conventions

### Additional Requirements

AR-01: Add workflow_schemas database table (id, org_id, schema_json, is_active, created_at, updated_at)
AR-02: Add WORKFLOW_ENGINE_TOKEN, BEHAVIOR_ENGINE_TOKEN, WORKFLOW_SCHEMA_REPO_TOKEN DI tokens
AR-03: Add WorkflowSchemaError hierarchy (InvalidTypeError, InvalidTransitionError, SchemaValidationError)
AR-04: Add schema:updated and behavior:executed event types
AR-05: Delete TASK_TRANSITIONS constant from task.constants.ts

### UX Design Requirements

N/A - This module is backend/engine focused. Frontend Schema Editor UI will be a separate epic.

### FR Coverage Map

FR-WE-01: Epic 1, Story 1.1 - WorkItemTypeDefinition type model
FR-WE-02: Epic 1, Story 1.1 - StatusDefinition type model
FR-WE-03: Epic 1, Story 1.1 - TransitionDefinition type model
FR-WE-04: Epic 1, Story 1.4 - BehaviorEngine TCA rule engine
FR-WE-05: Epic 1, Story 1.4 - Grouped execution with short-circuit
FR-WE-06: Epic 1, Story 1.2 - Schema JSON storage + single active schema
FR-WE-07: Epic 1, Story 1.3 - WorkflowEngine in-process cache
FR-WE-08: Epic 1, Story 1.3 - WorkflowEngine gateway interface
FR-WE-09: Epic 1, Story 1.5 - Schema integrity validation
FR-WE-10: Epic 1, Story 1.5 - In-flight task impact analysis
FR-WE-11: Epic 2, Story 2.1 - TaskStateMachine delegation
FR-WE-12: Epic 2, Stories 2.2 + 2.3 - TaskService type validation + behavior-driven propagation
FR-WE-13: Epic 3, Story 3.1 - OrgOrchestrator schema-driven semantics
FR-WE-14: Epic 3, Story 3.2 - PromptBuilder dynamic descriptions
FR-WE-15: Epic 3, Story 3.3 - MCP tool handlers dynamic validation
FR-WE-16: Epic 1, Story 1.1 - domain.types.ts type generalization
FR-WE-17: Epic 1, Story 1.2 - Database CHECK constraint removal
FR-WE-18: Epic 1, Story 1.6 - Zod schema adaptation
FR-WE-19: Epic 1, Story 1.6 - Schema CRUD IPC channels

AR-01: Epic 1, Story 1.2 - workflow_schemas table
AR-02: Epic 1, Story 1.1 - DI tokens
AR-03: Epic 1, Story 1.1 - Error hierarchy
AR-04: Epic 1, Story 1.3 - Event types
AR-05: Epic 2, Story 2.1 - Delete TASK_TRANSITIONS

NFR-WE-01 ~ NFR-WE-05: Enforced across all stories

## Epic List

### Epic 1: Custom Workflow Definition Engine
Users can define, validate, and persist custom workflow schemas with work item types, statuses, transitions, and behavior rules at the organization level.
**FRs covered:** FR-WE-01 ~ FR-WE-10, FR-WE-16 ~ FR-WE-19, AR-01 ~ AR-05

### Epic 2: Schema-Driven Task Lifecycle
Tasks are created, transitioned, and auto-propagated using the custom workflow schema instead of hardcoded rules.
**FRs covered:** FR-WE-11, FR-WE-12

### Epic 3: Schema-Driven Orchestration & AI Integration
AI agents receive dynamically generated prompts and tools reflecting the custom workflow, and the orchestrator uses schema-driven type semantics for wake-up decisions.
**FRs covered:** FR-WE-13, FR-WE-14, FR-WE-15

---

## Epic 1: Custom Workflow Definition Engine

Users can define, validate, and persist custom workflow schemas — including work item types with behavioral properties, statuses with semantic categories, state transitions with trigger types, and behavior rules with composable conditions — at the organization level.

### Story 1.1: Core Type Definitions, Error Hierarchy & Domain Type Generalization

As a developer,
I want all workflow schema type definitions, error classes, and DI tokens to be established in the core layer,
So that all subsequent implementation has a stable type foundation to build upon.

**Acceptance Criteria:**

**Given** the core/types/ directory exists
**When** workflow-schema.types.ts is created
**Then** it exports WorkflowSchema, WorkItemTypeDefinition, StatusDefinition, and TransitionDefinition interfaces matching the architecture document (ADR-WE-04, ADR-WE-06, ADR-WE-07)
**And** all type name fields enforce kebab-case convention in their documentation

**Given** the core/types/ directory exists
**When** behavior.types.ts is created
**Then** it exports BehaviorRule, BehaviorTrigger (4 types), BehaviorCondition (9 types including and/or/not), and BehaviorAction (5 types) as tagged unions using `type` as the discriminator field
**And** BehaviorCondition supports recursive nesting via and/or/not composition

**Given** the core/errors/ directory exists
**When** workflow.errors.ts is created
**Then** it exports WorkflowSchemaError extending CapibaraError, plus InvalidTypeError, InvalidTransitionError, and SchemaValidationError subclasses
**And** each error includes descriptive messages with the invalid values

**Given** domain.types.ts contains TaskType as a union literal and TaskStatus as a union literal
**When** the types are generalized
**Then** TaskType becomes `string` and TaskStatus becomes `string`
**And** all existing references in core/interfaces/ compile without errors

**Given** tokens.ts exists
**When** new DI tokens are added
**Then** WORKFLOW_ENGINE_TOKEN, BEHAVIOR_ENGINE_TOKEN, and WORKFLOW_SCHEMA_REPO_TOKEN are defined as Symbol constants with SCREAMING_SNAKE_CASE naming

### Story 1.2: Schema Persistence & Database Migration

As a developer,
I want workflow schemas to be stored in SQLite and retrievable by organization,
So that the WorkflowEngine has a persistence layer to load and save schemas.

**Acceptance Criteria:**

**Given** the migrations.ts file exists
**When** database migration runs
**Then** a workflow_schemas table is created with columns: id (TEXT PK), org_id (TEXT NOT NULL FK), schema_json (TEXT NOT NULL), is_active (INTEGER DEFAULT 1), created_at (TEXT NOT NULL), updated_at (TEXT NOT NULL)
**And** a UNIQUE constraint exists on (org_id, is_active)
**And** org_id references organizations(id) with ON DELETE CASCADE

**Given** the migrations.ts file manages task_nodes table
**When** database migration runs
**Then** the CHECK constraints on type and status columns are removed
**And** existing data is preserved

**Given** core/interfaces/ directory exists
**When** i-workflow-schema.repository.ts is created
**Then** it exports IWorkflowSchemaRepository with methods: findActiveByOrgId(orgId): Promise<WorkflowSchema | null>, save(orgId, schema): Promise<void>, delete(id): Promise<void>

**Given** infrastructure/persistence/sqlite/ directory exists
**When** sqlite-workflow-schema.repository.ts is created
**Then** it implements IWorkflowSchemaRepository with @injectable() decorator
**And** save() serializes WorkflowSchema to JSON and stores in schema_json column
**And** findActiveByOrgId() deserializes JSON back to WorkflowSchema
**And** all methods return Promise<T> per project conventions

**Given** composition-root.ts exists
**When** the new repository is registered
**Then** WORKFLOW_SCHEMA_REPO_TOKEN is bound to SqliteWorkflowSchemaRepository

### Story 1.3: WorkflowEngine Implementation (Validation & Cache)

As a developer,
I want a WorkflowEngine service that validates types, statuses, and transitions against the active schema with in-process caching,
So that all downstream services have a single, performant gateway to access workflow configuration.

**Acceptance Criteria:**

**Given** no schema has been accessed for an organization yet
**When** any WorkflowEngine method is called with an orgId
**Then** the engine loads the active schema from IWorkflowSchemaRepository and caches it in an in-memory Map
**And** subsequent calls for the same orgId return from cache without DB access

**Given** a schema is cached for an organization
**When** a `schema:updated` event is emitted on EventBus with that orgId
**Then** the cached schema for that orgId is invalidated
**And** the next access triggers a fresh load from the repository

**Given** a cached schema with item types defined
**When** validateType(orgId, 'task', 'story') is called
**Then** it returns true if 'story' type's allowedChildren includes 'task'
**And** returns false otherwise

**Given** a cached schema with item types defined
**When** validateType(orgId, 'epic', null) is called (root-level creation)
**Then** it returns true only if 'epic' type has allowedAtRoot: true

**Given** a cached schema with statuses and transitions
**When** canTransition(orgId, 'pending', 'in-progress') is called
**Then** it returns true if a TransitionDefinition exists with from='pending' and to='in-progress'

**Given** a cached schema with statuses
**When** getManualTransitions(orgId, 'pending') is called
**Then** it returns only transitions with trigger='manual' from 'pending' status

**Given** a cached schema with statuses
**When** getInitialStatus(orgId) is called
**Then** it returns the name of the status with category='initial'

**Given** a cached schema with statuses
**When** isTerminalStatus(orgId, 'done') is called
**Then** it returns true if the status named 'done' has category='terminal'

**Given** event.types.ts exists
**When** new event types are added
**Then** 'schema:updated' and 'behavior:executed' events are defined with proper payload types including orgId

**Given** composition-root.ts exists
**When** WorkflowEngine is registered
**Then** WORKFLOW_ENGINE_TOKEN is bound to WorkflowEngine with @injectable() decorator
**And** WorkflowEngine is injected with WORKFLOW_SCHEMA_REPO_TOKEN and EVENT_BUS_TOKEN

### Story 1.4: BehaviorEngine Implementation (TCA Rule Engine)

As a developer,
I want a BehaviorEngine that evaluates Trigger-Condition-Action rules from the active schema,
So that automated behaviors (auto-complete, auto-propagate, skip-propagation, discussion group creation) are driven by user-defined rules instead of hardcoded logic.

**Acceptance Criteria:**

**Given** a schema with behavior rules defined
**When** evaluateBehaviors(orgId, trigger, context) is called
**Then** only rules matching the trigger type are considered
**And** matching rules are sorted by priority (lower number = higher priority)
**And** each rule's condition is evaluated against the provided context

**Given** a rule with condition { type: 'item_is_leaf' }
**When** the condition is evaluated for a task whose type definition has isLeaf: true
**Then** the condition evaluates to true

**Given** a rule with condition { type: 'and', conditions: [c1, c2] }
**When** c1 evaluates to true and c2 evaluates to false
**Then** the 'and' condition evaluates to false

**Given** a rule with condition { type: 'or', conditions: [c1, c2] }
**When** c1 evaluates to false and c2 evaluates to true
**Then** the 'or' condition evaluates to true

**Given** a rule with condition { type: 'not', condition: c1 }
**When** c1 evaluates to true
**Then** the 'not' condition evaluates to false

**Given** a rule with condition { type: 'item_type_in', types: ['epic', 'story'] }
**When** the current task's type is 'story'
**Then** the condition evaluates to true

**Given** a rule with condition { type: 'parent_in_status', statuses: ['approved'] }
**When** the parent task's status is 'approved'
**Then** the condition evaluates to true

**Given** multiple rules match with priorities 10, 20, 30
**When** rule with priority 10 has action { type: 'skip_propagation' }
**Then** rules with priority 20 and 30 are NOT evaluated (short-circuit)
**And** only the skip_propagation action is returned

**Given** multiple rules match with priorities 10, 20
**When** rule with priority 10 has action { type: 'auto_transition', targetStatus: 'done' }
**Then** both rules are evaluated (no short-circuit for non-skip actions)
**And** both actions are returned in priority order

**Given** composition-root.ts exists
**When** BehaviorEngine is registered
**Then** BEHAVIOR_ENGINE_TOKEN is bound to BehaviorEngine with @injectable() decorator
**And** BehaviorEngine is injected with WORKFLOW_ENGINE_TOKEN, TASK_REPO_TOKEN, and EVENT_BUS_TOKEN

### Story 1.5: Schema Integrity Validation & Impact Analysis

As a user editing a workflow schema,
I want the system to validate my schema for structural correctness and warn me about impacts on existing tasks,
So that I don't accidentally create an invalid configuration or break in-progress work.

**Acceptance Criteria:**

**Given** a schema being saved with zero statuses having category='initial'
**When** saveSchema() is called
**Then** a SchemaValidationError is thrown listing "exactly one initial status required"

**Given** a schema being saved with two statuses having category='initial'
**When** saveSchema() is called
**Then** a SchemaValidationError is thrown listing "exactly one initial status required, found 2"

**Given** a schema being saved with zero statuses having category='terminal'
**When** saveSchema() is called
**Then** a SchemaValidationError is thrown listing "at least one terminal status required"

**Given** a schema where type 'story' has allowedChildren: ['task', 'nonexistent']
**When** saveSchema() is called
**Then** a SchemaValidationError is thrown listing "type 'story' references unknown child type 'nonexistent'"

**Given** a schema where a TransitionDefinition references from='nonexistent-status'
**When** saveSchema() is called
**Then** a SchemaValidationError is thrown listing the invalid status reference

**Given** a schema where a BehaviorRule references a status name that doesn't exist in the schema
**When** saveSchema() is called
**Then** a SchemaValidationError is thrown listing the invalid reference

**Given** a schema with a status unreachable from the initial status via any transition path
**When** saveSchema() is called
**Then** a SchemaValidationError is thrown listing the orphan status name

**Given** an organization has 5 active tasks with type='story' and a modified schema removes the 'story' type
**When** saveSchema() is called and passes integrity validation
**Then** a SchemaImpactReport is returned containing: affectedTaskCount=5, details listing each affected task's id and type
**And** the schema IS saved (not blocked) — the report is informational for frontend display

### Story 1.6: Schema CRUD IPC Channels & Contract Adaptation

As a frontend developer,
I want IPC channels to create, read, update, and delete workflow schemas,
So that the Schema Editor UI can manage workflow configurations.

**Acceptance Criteria:**

**Given** shared/contracts.ts exists
**When** new IPC channels are added
**Then** the following channels are defined: capibara:schema:get-active, capibara:schema:save, capibara:schema:validate, capibara:schema:impact-analysis
**And** Zod payload schemas use z.string() for type and status fields (not z.enum)

**Given** shared/contracts.ts contains createTaskSchema
**When** the type field validation is updated
**Then** type uses z.string().min(1) instead of z.enum([...])

**Given** shared/contracts.ts contains updateTaskStatusSchema
**When** the status field validation is updated
**Then** status uses z.string().min(1) instead of z.enum([...])

**Given** ipc-handlers/ directory exists
**When** workflow-schema.handlers.ts is created
**Then** it registers handlers for all schema IPC channels
**And** each handler validates input with Zod, delegates to WorkflowEngine, and returns DesktopResult<T>
**And** the get-active handler returns the active schema for an orgId
**And** the save handler calls WorkflowEngine.saveSchema() and returns validation errors or impact report
**And** the validate handler calls validateSchemaIntegrity() without saving

---

## Epic 2: Schema-Driven Task Lifecycle

Tasks are created, transitioned, and auto-propagated using the custom workflow schema. All hardcoded type checks and state transition logic in TaskStateMachine and TaskService are replaced with WorkflowEngine and BehaviorEngine delegations.

### Story 2.1: TaskStateMachine Delegation to WorkflowEngine

As a developer,
I want TaskStateMachine to validate state transitions through WorkflowEngine instead of the hardcoded TASK_TRANSITIONS constant,
So that users' custom status transitions are enforced at runtime.

**Acceptance Criteria:**

**Given** TaskStateMachine currently imports TASK_TRANSITIONS from task.constants.ts
**When** the refactoring is complete
**Then** TaskStateMachine injects WorkflowEngine via WORKFLOW_ENGINE_TOKEN
**And** canTransition() calls this.workflowEngine.canTransition(orgId, from, to) instead of reading TASK_TRANSITIONS
**And** transition() uses the same delegation for validation before updating status
**And** the surrounding control flow (event emission, error throwing) remains unchanged

**Given** task.constants.ts contains only the TASK_TRANSITIONS constant
**When** the constant is no longer referenced
**Then** task.constants.ts is deleted
**And** no other file imports from task.constants.ts

**Given** a task in status 'pending' and a schema where 'pending' can only transition to 'active'
**When** transition(taskId, 'review') is called
**Then** an InvalidTransitionError is thrown (using the new error class from workflow.errors.ts)

### Story 2.2: TaskService Type Validation via WorkflowEngine

As a developer,
I want TaskService.create() to validate type hierarchies through WorkflowEngine instead of the hardcoded ALLOWED_CHILDREN constant,
So that users' custom work item type hierarchies are enforced when creating tasks.

**Acceptance Criteria:**

**Given** TaskService.create() currently uses the ALLOWED_CHILDREN constant for type validation
**When** the refactoring is complete
**Then** TaskService injects WorkflowEngine via WORKFLOW_ENGINE_TOKEN
**And** type hierarchy validation calls this.workflowEngine.validateType(orgId, type, parentType)
**And** root-level validation calls this.workflowEngine.validateType(orgId, type, null)
**And** the ALLOWED_CHILDREN constant is no longer referenced in task.service.ts

**Given** a schema where 'epic' allows children ['story', 'spike']
**When** create() is called with type='task' under a parent of type='epic'
**Then** an InvalidTypeError is thrown with message indicating 'task' is not allowed under 'epic'

**Given** a schema where only 'epic' has allowedAtRoot=true
**When** create() is called with type='story' and parentId=null
**Then** an InvalidTypeError is thrown with message indicating 'story' cannot be created at root level

**Given** TaskService.create() emits task:created events
**When** a task is successfully created using schema-driven validation
**Then** the event payload is unchanged — type is now a string but the event structure is identical

### Story 2.3: TaskService Behavior-Driven Auto-Propagation

As a developer,
I want TaskService.updateStatus() to use BehaviorEngine for auto-propagation logic instead of hardcoded if/else branches,
So that users' custom behavior rules drive leaf auto-complete, Phase 2 hold, and parent propagation.

**Acceptance Criteria:**

**Given** TaskService.updateStatus() currently contains hardcoded leaf auto-complete logic (leafTypes.includes check)
**When** the refactoring is complete
**Then** after a status transition succeeds, TaskService calls behaviorEngine.evaluateBehaviors() with the appropriate trigger and context
**And** returned actions are executed sequentially (auto_transition calls stateMachine.transition, wake_assignee emits wake event, etc.)

**Given** a schema with a behavior rule: trigger=on_status_enter('approved'), condition=item_is_leaf, action=auto_transition('done')
**When** a leaf task transitions to 'approved'
**Then** the BehaviorEngine returns auto_transition('done') action
**And** TaskService executes it, transitioning the task to 'done'

**Given** a schema with a behavior rule: trigger=on_status_enter('approved'), condition=and(item_type_in(['epic']), item_has_no_children), action=skip_propagation
**When** an epic with no children transitions to 'approved'
**Then** the BehaviorEngine returns skip_propagation action
**And** TaskService does NOT auto-propagate to parent

**Given** a schema with a behavior rule: trigger=on_all_children_terminal, condition=always, action=auto_transition('done')
**When** the last child of a parent task reaches terminal status
**Then** the BehaviorEngine evaluates with on_all_children_terminal trigger
**And** returns auto_transition('done') for the parent
**And** TaskService transitions the parent to 'done'

**Given** a schema with a behavior rule: trigger=on_children_of_type_terminal({childTypes: ['story']}), condition=item_type_in(['epic']), action=auto_transition('done')
**When** all 'story' children of an 'epic' reach terminal status but a 'spike' child is still active
**Then** the on_children_of_type_terminal trigger fires (only story children checked)
**And** the epic auto-transitions to 'done'

**Given** the hardcoded checkAutoPropagate method in TaskService
**When** the refactoring is complete
**Then** the recursive propagation logic is preserved but driven by BehaviorEngine rule evaluation instead of hardcoded status checks

---

## Epic 3: Schema-Driven Orchestration & AI Integration

AI agents receive dynamically generated prompts and MCP tool descriptions reflecting the user's custom workflow. The orchestrator uses schema-driven type semantics for wake-up decisions, replacing all hardcoded type checks.

### Story 3.1: OrgOrchestrator Schema-Driven Type Semantics

As a developer,
I want OrgOrchestrator to query WorkflowEngine for type semantics instead of hardcoded type checks,
So that wake-up decisions correctly reflect users' custom work item type definitions.

**Acceptance Criteria:**

**Given** OrgOrchestrator.calculateWakeTargets() currently checks `task.type === 'epic' || task.type === 'story'` for decomposition detection
**When** the refactoring is complete
**Then** the check is replaced with: `const typeDef = await this.workflowEngine.getItemTypeDefinition(task.orgId, task.type); if (typeDef?.canDecompose)`
**And** the surrounding wake target calculation logic remains unchanged

**Given** OrgOrchestrator currently checks terminal statuses with hardcoded strings ('done', 'cancelled', 'approved')
**When** the refactoring is complete
**Then** terminal status checks use: `await this.workflowEngine.isTerminalStatus(task.orgId, task.status)`

**Given** OrgOrchestrator determines sibling completion by checking specific status strings
**When** the refactoring is complete
**Then** sibling completion checks use status category queries from WorkflowEngine
**And** the sequential execution gate logic (first pending sibling) remains unchanged in structure

**Given** a custom schema where type 'feature' has canDecompose=true
**When** a 'feature' task is approved with no children
**Then** OrgOrchestrator correctly identifies it as a decomposition task and wakes the assignee for Phase 2

### Story 3.2: PromptBuilder Dynamic Workflow Descriptions

As a developer,
I want PromptBuilder to generate type hierarchy and status descriptions dynamically from WorkflowEngine,
So that AI agents receive accurate prompts reflecting the user's custom workflow configuration.

**Acceptance Criteria:**

**Given** prompt-builder.ts currently hardcodes type hierarchy strings like "epic->story|spike, story->task|bug|chore|spike, task->subtask"
**When** the refactoring is complete
**Then** PromptBuilder calls workflowEngine.getItemTypeDefinition() to build the hierarchy string dynamically
**And** the generated string accurately reflects the active schema's allowedChildren relationships

**Given** prompt-builder.ts currently checks `ctx.task.type === 'epic'` to determine decomposition instructions
**When** the refactoring is complete
**Then** the check uses `typeDef?.canDecompose` from WorkflowEngine
**And** child type suggestions are dynamically generated from typeDef.allowedChildren

**Given** prompt-builder.ts currently generates labels like "const label = ctx.task.type === 'epic' ? 'Epic' : 'Story'"
**When** the refactoring is complete
**Then** labels are generated from typeDef.label

**Given** a custom schema with types 'initiative' (canDecompose=true, allowedChildren=['feature']) and 'feature' (allowedChildren=['work-item'])
**When** an AI agent is prompted for an 'initiative' task
**Then** the prompt includes: decomposition instructions referencing 'feature' as the child type
**And** the capibara_task_create_child tool description lists 'feature' as the valid child type

**Given** prompt-builder.ts references specific task types in scenario detection (prompt-scenario.ts, execution.context.ts)
**When** the refactoring is complete
**Then** all hardcoded type references in prompt-scenario.ts and execution.context.ts are replaced with WorkflowEngine queries
**And** discussion group lookups use typeDef.hasDiscussionGroup instead of hardcoded type checks

### Story 3.3: MCP Tool Handlers Dynamic Validation & Descriptions

As a developer,
I want MCP tool handlers to dynamically validate types and statuses against the active schema,
So that AI agents can only create valid task types and perform valid status transitions in a custom workflow.

**Acceptance Criteria:**

**Given** mcp-tool-handlers.ts taskCreateChild currently hardcodes validChildTypes as ['story', 'task', 'subtask', 'spike', 'bug', 'chore']
**When** the refactoring is complete
**Then** valid child types are obtained dynamically: `const parentTypeDef = await this.workflowEngine.getItemTypeDefinition(orgId, parentTask.type); const validChildTypes = parentTypeDef.allowedChildren;`
**And** error messages include the dynamically obtained list of valid types

**Given** mcp-tool-handlers.ts taskComplete currently hardcodes terminal status checks ('approved', 'done', 'cancelled')
**When** the refactoring is complete
**Then** terminal status checks use: `await this.workflowEngine.isTerminalStatus(orgId, currentTask.status)`

**Given** mcp-tool-handlers.ts taskReview currently hardcodes 'awaiting_review' status check
**When** the refactoring is complete
**Then** the review eligibility check queries WorkflowEngine for the status category (review category)

**Given** mcp-tool-handlers.ts discussionPost currently hardcodes validVoteTags
**When** the refactoring is complete
**Then** vote tags remain hardcoded (they are part of the discussion system, not the workflow schema)

**Given** a custom schema where 'feature' type allows children ['work-item', 'investigation']
**When** an AI agent calls capibara_task_create_child with parentTaskId pointing to a 'feature' task and type='bug'
**Then** the handler returns an error: "Invalid task type 'bug'. Must be one of: work-item, investigation"
