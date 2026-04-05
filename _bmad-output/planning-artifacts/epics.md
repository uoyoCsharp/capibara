---
stepsCompleted: [1, 2, 3, 4]
inputDocuments:
  - _bmad-output/planning-artifacts/prd.md
  - _bmad-output/planning-artifacts/architecture.md
  - _bmad-output/planning-artifacts/ux-design-specification.md
  - _bmad-output/planning-artifacts/prd-conversation-system.md
  - _bmad-output/planning-artifacts/architecture-conversation-system.md
  - _bmad-output/project-context.md
  - docs/functional-analysis.md
---

# Capibara - Epic Breakdown

## Overview

This document provides the complete epic and story breakdown for Capibara, decomposing the requirements from the PRD, UX Design Specification, and Architecture Document into implementable stories. Capibara is a company-grade AI Organization Orchestration Platform that simulates organizational hierarchies to automate software development workflows.

## Requirements Inventory

### Functional Requirements

- FR-01: Organization Modeling — Dynamic organization tree with unlimited nesting, role three-element model (persona/knowledge/skills), permissions, status, preset templates, custom creation, AI-assisted creation
- FR-02: Task System — Variable-depth task tree with type labels (epic/story/task/subtask/spike/bug/chore), task state machine, auto-creation, auto-status propagation, assignment, artifact storage
- FR-03: Smart Decomposition Advisor — Complexity assessment, depth recommendation, over/under-decomposition detection
- FR-04: Discussion-Driven Decision Making — Auto-created Epic discussion groups, auto-membership, structured vote tags (APPROVE/REVISE/CONCERN/DELEGATE/null), consensus-as-approval, dispute detection, auto-summary, human participation, lifecycle
- FR-05: Consensus Detection & Vote Processing — APPROVE tracking, REVISE processing with cycle protection, CONCERN accumulation, DELEGATE with task creation and blocking
- FR-06: Execution Engine — Run lifecycle, pre-execution gate checks, prompt construction, UtilityProcess isolation, workspace binding, execution logging, serial execution
- FR-07: Wake-Up Loop — Event-driven wake triggers, gate checks, pending wake queue, self-wake circuit breaker, wake target calculation
- FR-08: Human Intervention (Per-Role) — Per-role requiresHumanApproval config, approval panel UI with narrative summary, human votes as discussion messages, mandatory top-level notification
- FR-09: Narrative Engine — Three-layer architecture (DB query → template → LLM polish), dashboard narrative, approval summary, auto-refresh
- FR-10: Event Digester — Time window aggregation, event merge by Epic, single aggregated notification, throttling
- FR-11: Pluggable Skill System — L1/L2/L3 provider interfaces, builtin/template/custom sources, skill library UI, zero business code change for provider swap
- FR-12: Resilience — Failure retry, escalation chain, top-level safety valve, global budget protection, REVISE cycle protection
- FR-13: Observability — Execution log storage, cost tracking, org tree visualization, task tree visualization, discussion group panel, activity timeline, dashboard

### NonFunctional Requirements

- NFR-01: Cost Control — Global budget limit with auto-pause, per-role tracking, discussion token budgets, decomposition depth limits
- NFR-02: Security — Electron three-layer process isolation, Zod IPC validation, org-scoped data access, JWT run token + run ID MCP auth, SecretVault
- NFR-03: Extensibility — Pluggable skill providers, pluggable command executors, replaceable org templates, monorepo adapters
- NFR-04: Performance — Event digestion, discussion auto-summary, IPC batching, snapshot-based data access
- NFR-05: Data Integrity — SQLite WAL mode with foreign keys, deterministic narrative generation, structured vote tags

### Additional Requirements

- Electron three-layer process model (Main/Preload/Renderer) + UtilityProcess for AI execution isolation
- SQLite via better-sqlite3 with WAL mode; Repository Pattern with async Promise<T> interfaces (ADR-01)
- tsyringe DI container with composition-root.ts assembly
- Emittery typed event bus for all internal events
- MCP Server Bridge via stdio for Agent ↔ Capibara system operations (ADR-04)
- Skill model stores command + description references, not content (ADR-05)
- Lightweight prompt construction — no artifact/knowledge injection (ADR-02)
- Discussion Group as MVP approval container, V2 full communication (ADR-03)
- Sparse ProfileSnapshot strategy (L1 Skeleton → L2 Branch → L3 Detail) for frontend data
- IPC Protocol with DesktopResult<T> and Zod-validated payloads
- IPC Channel naming: namespace:entity:action format
- Event Digester for IPC batching (200-500ms window)
- All imports use .js extensions (ESM NodeNext)
- No barrel exports, no default exports, no ORM
- Prettier formatting: 100 char width, single quotes, trailing commas, 2-space indent

### UX Design Requirements

- UX-DR01: Global Navigation Shell — Fixed left navigation bar with Dashboard, Organization, Tasks & Epics, Skills & Knowledge sections. Must be the primary navigation entry point
- UX-DR02: Dashboard with Narrative Engine — Landing screen showing narrative project progress story, minimalist budget bars, blocked task alerts with clickable hyperlinks to corresponding areas
- UX-DR03: Organization Tree Visualization — Interactive hierarchical tree visualization with drag-and-drop role creation, click-to-open contextual drawer for role configuration (persona, knowledge, skills)
- UX-DR04: Task Tree Visualization — Hierarchical task view with status indicators, progress tracking, animated node spawning during auto-decomposition
- UX-DR05: Discussion Group Panel — Real-time message flow with vote tag highlighting (color-coded: green=APPROVE, orange=REVISE, red=CONCERN), structured voting action cards
- UX-DR06: Chat-as-Action Cards — Rich embed-style cards for structured votes (APPROVE/REVISE/DELEGATE) within discussion groups, supporting in-card click interactions that drive the backend event state machine
- UX-DR07: Contextual Drawers — Slide-out drawers for deep-dive configuration without losing page context (role config, narrative summaries, artifact inspection)
- UX-DR08: Human Approval Panel — Aggregated approval card above latest discussion message showing: narrative summary, task tree overview, discussion key decisions, artifact links, three action buttons (APPROVE / REVISE with feedback input / DELEGATE)
- UX-DR09: Design System Foundation — Headless UI component library (Radix UI / Shadcn/ui) + TailwindCSS. Light mode minimalist design, generous whitespace, clear typography. Status colors: Green (done), Orange (blocked/wait), Red (concern/alert), Blue/Indigo primary
- UX-DR10: Desktop Notifications — System-level Electron notifications for approval requests, escalations, and blocked task alerts
- UX-DR11: Micro-Animations — Restrained animations for agent execution lifecycle states (LLM inferencing), page transitions, and task tree node spawning
- UX-DR12: Organization Template Loading — Visual template selector with preview of hierarchical structure, one-click load with pre-filled roles/personas/skills

### FR Coverage Map

- FR-01 (Organization Modeling): Epic 2
- FR-02 (Task System): Epic 4
- FR-03 (Smart Decomposition Advisor): Epic 4
- FR-04 (Discussion-Driven Decision Making): Epic 5
- FR-05 (Consensus Detection & Vote Processing): Epic 5
- FR-06 (Execution Engine): Epic 6
- FR-07 (Wake-Up Loop): Epic 7
- FR-08 (Human Intervention): Epic 8
- FR-09 (Narrative Engine): Epic 9
- FR-10 (Event Digester): Epic 7
- FR-11 (Pluggable Skill System): Epic 3
- FR-12 (Resilience): Epic 10
- FR-13 (Observability): Epic 9
- FR-14 (Internationalization): Epic 1

#### Conversation System FR Coverage

- Conv-FR1-FR3 (Conversation Initiation): Epic 11
- Conv-FR5-FR9 (Conversation Wake & Resume): Epic 11
- Conv-FR10-FR14 (Agent-to-Agent Conversation): Epic 11, Epic 15
- Conv-FR15-FR18 (Conversation Orchestration): Epic 13, Epic 15
- Conv-FR19-FR22 (Timeout & Escalation): Epic 13
- Conv-FR23-FR26 (Concurrent Conversation Management): Epic 14
- Conv-FR27-FR31 (Human Interaction): Epic 12
- Conv-FR32-FR35 (Audit & Observability): Epic 14

## Epic List

### Epic 1: Electron Application Shell & Core Infrastructure
Users can launch the Capibara desktop application and see a functional application shell with global navigation, establishing the Electron three-layer process model, DI container, SQLite database, event bus, and IPC foundation that all subsequent epics build upon.
**FRs covered:** Foundation for all FRs; FR-14 (Internationalization); NFR-02 (Security — process isolation, IPC validation), NFR-05 (Data Integrity — SQLite WAL); UX-DR01 (Navigation Shell), UX-DR09 (Design System Foundation)

### Epic 2: Organization Modeling & Role Management
Users can create, visualize, and configure AI organization trees with roles defined by the three-element model (persona, knowledge base, skills), load preset templates, and customize organizational structures through an interactive tree UI.
**FRs covered:** FR-01; UX-DR03, UX-DR07, UX-DR12

### Epic 3: Skill Library & Management
Users can browse, search, and manage skills from builtin, template, and custom sources, assign skills to roles, and upload custom prompt templates — enabling the pluggable skill system.
**FRs covered:** FR-11; NFR-03 (Extensibility)

### Epic 4: Task System & Smart Decomposition
Users can create task trees with variable depth and type labels, the system manages task state transitions, and a smart decomposition advisor guides appropriate task breakdown complexity.
**FRs covered:** FR-02, FR-03; UX-DR04

### Epic 5: Discussion Groups & Consensus Decision Making
AI roles collaborate through auto-created Epic discussion groups with structured voting (APPROVE/REVISE/CONCERN/DELEGATE), and the system detects consensus and disputes to drive automated approval decisions.
**FRs covered:** FR-04, FR-05; UX-DR05, UX-DR06

### Epic 6: Agent Execution Engine
AI roles execute assigned tasks via Claude Code CLI in isolated UtilityProcess workers, with MCP bridge for real-time system operations, prompt construction from role context, and full run lifecycle management.
**FRs covered:** FR-06; NFR-02 (MCP auth)

### Epic 7: Orchestration & Wake-Up Loop
The system autonomously drives the entire workflow through an event-driven wake-up cycle with gate checks, pending wake queues, and event digestion, enabling end-to-end automation from requirement input to delivery.
**FRs covered:** FR-07, FR-10; NFR-04 (Performance)

### Epic 8: Human Intervention & Approval
Humans can participate in AI discussion groups with equal authority, receive desktop notifications for approval requests, and make APPROVE/REVISE/DELEGATE decisions through a rich aggregated approval panel at per-role configurable control points.
**FRs covered:** FR-08; UX-DR08, UX-DR10

### Epic 9: Narrative Engine & Dashboard
Users see human-readable narrative project status on a rich dashboard with cost tracking, activity timeline, and full observability — replacing cold data tables with a narrative engine that tells the project story.
**FRs covered:** FR-09, FR-13; NFR-01 (Cost Control — tracking), UX-DR02, UX-DR11

### Epic 10: Resilience & Safety
The system handles failures gracefully with configurable retry logic, escalation chains along the org tree, global budget protection, REVISE cycle circuit breakers, and a mandatory top-level safety valve to protect against runaway costs and infinite loops.
**FRs covered:** FR-12; NFR-01 (Cost Control — budget limits)

### Epic 11: Conversation Core — Durable Workflow & Routing Engine
AI roles can ask questions during task execution via MCP tools, the system routes questions to the appropriate supervisor AI role, the supervisor is automatically woken to respond, and the original asking role resumes execution with full conversation context — enabling the fundamental Agent-to-Agent multi-turn conversation loop.
**FRs covered:** Conv-FR1-FR3, Conv-FR5-FR14; ADR-v2-01, ADR-v2-02, ADR-v2-04, ADR-v2-05, ADR-v2-06

### Epic 12: Conversation Human Interaction
Human users can participate in Agent conversations through the UI — receiving notifications when roles with `requiresHumanApproval=true` ask questions, replying directly in the discussion panel, marking conversations as resolved, and intervening in any Agent-to-Agent conversation.
**FRs covered:** Conv-FR3, Conv-FR27-FR31; ADR-v2-03 (Human Gate)

### Epic 13: Conversation Timeout, Escalation & Safety
Conversations that stall without a reply are automatically escalated through the role hierarchy. Circular conversation patterns are detected and broken. Orphaned workflow states are recovered after system restart.
**FRs covered:** Conv-FR17-FR22; ADR-v2-01 (Crash Recovery)

### Epic 14: Concurrent Conversation Management & Observability
Multiple conversations can be active simultaneously within an organization with deterministic priority-based scheduling. Conversation metrics are available for monitoring and analysis.
**FRs covered:** Conv-FR23-FR26, Conv-FR32-FR35

### Epic 15: Advanced Conversation Features
Skill-based intelligent routing, cascaded multi-role discussions with full context propagation, token budget truncation for long conversations, and conversation pattern analytics.
**FRs covered:** Conv-FR12, Conv-FR15-FR16

---

## Epic 1: Electron Application Shell & Core Infrastructure

Users can launch the Capibara desktop application and see a functional application shell with global navigation. This epic establishes the Electron three-layer process model, DI container, SQLite database, event bus, IPC protocol, and UI design system that all subsequent epics build upon.

### Story 1.1: Initialize Electron Project Structure from Reference

As a developer,
I want to set up the Electron project with the three-layer process model (Main/Preload/Renderer) and essential build tooling,
So that I have a working Electron application shell to build features upon.

**Acceptance Criteria:**

**Given** the capibara monorepo workspace exists
**When** the project scaffolding is created
**Then** the following directory structure exists under `src/`: `main/`, `preload/`, `renderer/`, `shared/`
**And** `electron-vite` is configured as the build tool with proper Main/Preload/Renderer entries
**And** `electron-builder` is configured for packaging (electron-builder.yml)
**And** `package.json` includes `dev`, `build`, `preview` scripts for the Electron app
**And** TypeScript strict mode with ESM (`"type": "module"`) and `.js` import extensions is enforced
**And** `tsconfig.json` enables `experimentalDecorators` + `emitDecoratorMetadata` for tsyringe
**And** the application launches successfully with `pnpm dev` showing a blank Electron window
**And** Renderer has `contextIsolation: true` and `nodeIntegration: false`

### Story 1.2: Set Up DI Container and Core Layer Contracts

As a developer,
I want to establish the tsyringe DI container, core layer interfaces, DI tokens, and composition root,
So that all services follow dependency inversion and can be wired without `new` outside composition-root.

**Acceptance Criteria:**

**Given** the Electron project structure from Story 1.1
**When** the core contracts layer is created
**Then** `src/main/core/` contains `interfaces/`, `types/`, `constants/`, `errors/` subdirectories
**And** `src/main/core/tokens.ts` defines DI token Symbols using `SCREAMING_SNAKE_CASE_TOKEN` convention
**And** `src/main/composition-root.ts` is the single DI assembly point using tsyringe
**And** `reflect-metadata` is imported at the Main process entry point before any DI resolution
**And** layer import rules are enforced: `application/` → `core/` only, `infrastructure/` → `core/` only, `core/` imports nothing
**And** no barrel exports (`index.ts` re-exports) exist
**And** all exports are named exports (no default exports)

### Story 1.3: Set Up SQLite Database and Repository Pattern Foundation

As a developer,
I want to initialize the SQLite database with WAL mode, foreign key enforcement, and a migration system,
So that data persistence is ready for entity repositories with async Promise<T> interfaces.

**Acceptance Criteria:**

**Given** the DI container from Story 1.2
**When** the SQLite infrastructure is created
**Then** `better-sqlite3` is configured in `src/main/infrastructure/persistence/sqlite/` with WAL mode and foreign keys enabled
**And** a `sqlite-connection.ts` service manages the database connection lifecycle (open/close)
**And** the connection service is registered in composition-root.ts via DI token
**And** a version-based migration system exists using `CREATE TABLE IF NOT EXISTS` pattern
**And** all repository interfaces in `core/interfaces/` use `Promise<T>` return types (per ADR-01)
**And** the `organizations` table is created as the first migration (id, name, description, status, budget_limit, org_template_id, workspace_path, created_at, updated_at)
**And** `workspace_path` is `TEXT NOT NULL` and must be a valid directory path
**And** table names use plural `snake_case`, column names use `snake_case`
**And** database file path is configurable (default: `~/.capibara/capibara.sqlite`)

### Story 1.4: Implement Emittery Event Bus and IPC Protocol

As a developer,
I want to set up the typed internal event bus and the IPC communication protocol between Main and Renderer,
So that services can communicate via events and the Renderer can safely invoke Main process operations.

**Acceptance Criteria:**

**Given** the DI container and SQLite from Stories 1.2-1.3
**When** the event bus and IPC are implemented
**Then** `EmitteryEventBus` in `src/main/infrastructure/observability/` implements `IEventBus` interface from core
**And** event names follow `entity:lifecycle` format (e.g., `task:completed`, `run:succeeded`)
**And** `src/shared/contracts.ts` defines IPC channel enums using `namespace:entity:action` format (e.g., `capibara:org:snapshot`)
**And** `src/shared/contracts.ts` defines Zod payload schemas for each IPC channel
**And** all IPC responses use `DesktopResult<T>` type: `{ ok: true; data: T } | { ok: false; error: { code: string; message: string } }`
**And** `src/preload/index.ts` exposes a `window.capibara.api` whitelist via `contextBridge` with Zod-validated RPC methods
**And** preload contains NO business logic — only bridging
**And** IPC handlers in `src/main/ipc-handlers/` validate all incoming payloads with Zod before forwarding to application services

### Story 1.5: Implement Renderer Shell with Global Navigation

As a user,
I want to see a polished application shell with global navigation when I launch Capibara,
So that I can navigate between Dashboard, Organization, Tasks, and Skills sections.

**Acceptance Criteria:**

**Given** the IPC protocol and Preload bridge from Story 1.4
**When** the Renderer application shell is created
**Then** React 19 is configured with Zustand for state management and TailwindCSS 4 for styling
**And** a design system foundation exists with Shadcn/ui (or Radix UI) headless components
**And** the main layout includes a fixed left navigation sidebar with icons and labels for: Dashboard, Organization, Tasks & Epics, Skills & Knowledge
**And** clicking each nav item renders the corresponding page container (placeholder content is acceptable)
**And** the visual design follows light mode, minimalist style with generous whitespace
**And** status semantic colors are defined: Green (done/approve), Orange (blocked/wait), Red (concern/alert), Blue/Indigo (primary)
**And** the navigation highlights the currently active section
**And** the application uses `window.capibara.api` for all Main process communication — no direct Node.js APIs
**And** Zustand store slices follow `.slice.ts` naming convention

### Story 1.6: Implement Application Configuration System

As a user,
I want the application to load configuration from a hierarchy of defaults, global config, and project config,
So that I can customize behavior without modifying code.

**Acceptance Criteria:**

**Given** the application shell from Story 1.5
**When** the configuration system is implemented
**Then** `config.defaults.ts` provides default values for all configuration fields
**And** `config.schema.ts` defines Zod schemas for configuration validation
**And** `config.loader.ts` loads config with hierarchy: defaults ← global (`~/.capibara/config.yaml`) ← project (`<projectDir>/capibara.config.yaml`)
**And** configuration is immutable after load and accessible via DI token
**And** key config fields include: `organization.template`, `execution.maxReviseAttempts` (3), `execution.maxRetryOnFailure` (3), `execution.maxConsecutiveWakes` (5), `execution.budgetLimit` (50.0), `database.driver` (sqlite), `cli.defaultExecutor`, `logging.level` (info)
**And** invalid configuration fails fast with descriptive Zod validation errors
**And** Pino logger is initialized from config and registered in DI

### Story 1.7: Implement Internationalization (i18n) Infrastructure

As a user,
I want the application to display in my preferred language (Chinese or English),
So that I can use the system comfortably in my native language.

**Acceptance Criteria:**

**Given** the application shell and config system from Stories 1.5-1.6
**When** the i18n infrastructure is created
**Then** `shared/locale/` module exists with `types.ts`, `en-US.ts`, `zh-CN.ts`, and `index.ts`
**And** `SupportedLocale` type is defined as `'en-US' | 'zh-CN'`
**And** `LocaleMessages` interface defines typed keys for all UI strings
**And** both `en-US.ts` and `zh-CN.ts` implement the full `LocaleMessages` interface
**And** existing hardcoded strings in `shared/locale.ts` are migrated to the new structure
**And** `ISettingsRepository` interface is defined in `core/interfaces/` with `get(key)`, `set(key, value)`, `getAll()` methods
**And** `SqliteSettingsRepository` implements the interface using the existing `settings` table
**And** the repository is registered in composition-root.ts via `SETTINGS_REPO_TOKEN`
**And** on first launch, Main Process detects OS locale via `app.getLocale()` and stores in Settings as `locale` key
**And** locale detection maps `zh*` prefixes to `zh-CN`, all others to `en-US`
**And** IPC channels `capibara:settings:get` and `capibara:settings:update` are defined in `shared/contracts.ts` with Zod schemas
**And** IPC channel `capibara:settings:locale-changed` pushes locale changes to Renderer
**And** Renderer provides `LocaleProvider` React Context wrapping `App.tsx`
**And** `useLocale()` hook returns current `SupportedLocale`
**And** `useT()` hook returns the `LocaleMessages` object for the current locale
**And** a language selector is available in the navigation sidebar (bottom area or settings dropdown)
**And** switching language immediately updates all UI strings without page reload
**And** language preference persists across application restarts

---

## Epic 2: Organization Modeling & Role Management

Users can create, visualize, and configure AI organization trees with roles defined by the three-element model (persona, knowledge base, skills), load preset templates, and customize organizational structures through the Electron UI.

### Story 2.1: Implement Organization and Role Domain Entities

As a developer,
I want to define the Organization and Role domain entities with their repository interfaces and SQLite implementations,
So that org tree data can be persisted and queried.

**Acceptance Criteria:**

**Given** the SQLite foundation from Epic 1
**When** the org domain entities are created
**Then** `IOrganizationRepository` interface defines CRUD operations with `Promise<T>` return types
**And** `IOrganizationRepository` includes a `delete(id)` method that cascades to all associated data (roles, tasks, discussion_groups, discussion_messages, runs, cost_entries, pending_wakes, narratives)
**And** cascade deletion uses SQLite foreign key `ON DELETE CASCADE` or explicit transaction-based cleanup
**And** deletion is atomic — performed within a single database transaction
**And** `IRoleRepository` interface defines: `findById`, `findByOrgId`, `findByParentId`, `findChildren`, `create`, `update`, `updateStatus`, `delete`
**And** `roles` table is created via migration with columns: id, org_id, name, parent_id, persona, knowledge_base_refs (JSON), skill_ids (JSON), can_approve, can_delegate, requires_human_approval, status (active/paused/idle), created_at, updated_at
**And** `SqliteOrganizationRepository` and `SqliteRoleRepository` implement the interfaces
**And** parentId recursion supports unlimited nesting depth
**And** both repositories are registered in composition-root.ts via DI tokens

### Story 2.2: Implement Organization Template System

As a user,
I want to load a preset organization template (e.g., "BMAD Software Team") to quickly create a project with pre-filled roles,
So that I can start using the system without configuring everything from scratch.

**Acceptance Criteria:**

**Given** the organization repositories from Story 2.1
**When** a user selects a template
**Then** the system provides at least one built-in template: "BMAD Software Team" with hierarchical roles (CTO → Manager → Developers)
**And** templates are defined as YAML/JSON files with pre-filled role definitions (name, persona, skillIds, canApprove, canDelegate, requiresHumanApproval)
**And** loading a template creates an Organization record and all Role records with parent-child relationships
**And** an `OrgTemplateService` in `application/` handles template discovery and instantiation
**And** template roles include pre-configured knowledge base references and skill assignments
**And** users can modify the instantiated org after loading (it's a starting point, not locked)

### Story 2.3: Implement Organization Tree Visualization UI

As a user,
I want to see an interactive hierarchical tree visualization of my AI organization,
So that I can understand the structure and relationships between roles at a glance.

**Acceptance Criteria:**

**Given** the organization and role data from Stories 2.1-2.2
**When** the user navigates to the Organization page
**Then** all roles are displayed as a hierarchical tree with parent-child connections
**And** each role node shows: name, status indicator light (green=active, gray=idle, orange=paused), and role persona summary
**And** the tree supports expand/collapse of branches
**And** the tree uses IPC to request org snapshot data from Main process via `capibara:org:snapshot`
**And** the visualization updates when role data changes
**And** role avatars or icons provide the "human touch" organic feel per UX spec

### Story 2.4: Implement Role Configuration Contextual Drawer

As a user,
I want to click on any role in the organization tree to open a side drawer for configuring its persona, knowledge base, and skills,
So that I can precisely define each role's behavior without leaving the tree view.

**Acceptance Criteria:**

**Given** the organization tree visualization from Story 2.3
**When** the user clicks on a role node
**Then** a contextual drawer slides in from the right side
**And** the drawer displays editable fields for: role name, persona (multiline text), knowledge base references (list with add/remove), skill assignments (selectable from skill library), permissions (canApprove, canDelegate, requiresHumanApproval checkboxes), status toggle
**And** changes are saved via IPC call to Main process
**And** the tree view remains visible behind the drawer for context
**And** the drawer includes a "Delete Role" action with confirmation dialog
**And** validation errors (e.g., empty name) are shown inline

### Story 2.5: Implement Manual Role Creation and Tree Editing

As an experienced user,
I want to manually create new roles, set their parent relationships, and arrange the org tree,
So that I can build custom organization structures for my specific workflow.

**Acceptance Criteria:**

**Given** the tree visualization and role drawer from Stories 2.3-2.4
**When** the user creates a new role
**Then** an "Add Role" action is available on the org page and within parent role context menus
**And** new roles can be added as children of any existing role (unlimited nesting)
**And** role creation requires at minimum: name and parent role selection
**And** the tree visualization immediately updates to show the new role
**And** roles can be reordered (change parent) via the drawer or context menu
**And** deleting a role with children prompts the user to reassign or delete children

### Story 2.6: Implement Organization Template Selector UI

As a new user,
I want to browse and select from available organization templates with a visual preview,
So that I can quickly understand and choose the right starting structure.

**Acceptance Criteria:**

**Given** the template system from Story 2.2
**When** the user creates a new organization
**Then** a template selector modal displays available templates as cards
**And** each card shows: template name, description, and a preview of the hierarchical structure
**And** before or after template selection, the user must specify a workspace directory path via a folder picker dialog (Electron's `dialog.showOpenDialog` with `properties: ['openDirectory']`)
**And** the workspace path is validated: must be an existing directory, must be writable
**And** selecting a template creates the organization with the specified `workspace_path` and all pre-filled roles
**And** an option to start with a blank organization (no template) is available
**And** after template selection and workspace configuration, the user lands on the Organization page with the populated tree

### Story 2.7: Implement Organization Deletion with Safety Confirmation

As a user,
I want to delete an organization I no longer need, with a safety confirmation requiring me to type the organization name,
So that I am protected from accidental deletion of important data.

**Acceptance Criteria:**

**Given** an existing organization
**When** the user initiates a delete action from the organization settings or context menu
**Then** a confirmation dialog appears requiring the user to type the exact organization name
**And** the delete button is disabled until the typed name matches exactly (case-sensitive)
**And** upon confirmation, the organization and ALL associated data are deleted: roles, tasks, discussion groups, discussion messages, runs, cost entries, pending wakes, narratives
**And** the deletion is performed within a single database transaction for atomicity
**And** after deletion, the user is redirected to the organization list or creation page
**And** a success notification confirms the deletion
**And** the IPC channel `capibara:org:delete` is defined in `shared/contracts.ts` with Zod-validated payload
**And** the Zod schema validates: `{ orgId: string, confirmName: string }`
**And** the IPC handler verifies `confirmName` matches the actual organization name before proceeding

---

## Epic 3: Skill Library & Management

Users can browse, search, and manage skills from builtin, template, and custom sources, assign skills to roles, and upload custom prompt templates.

### Story 3.1: Implement Skill Domain Entity and Repository

As a developer,
I want to define the Skill entity with its repository interface and SQLite implementation,
So that skills from all sources can be stored and queried.

**Acceptance Criteria:**

**Given** the SQLite foundation from Epic 1
**When** the skill entity is created
**Then** `skills` table is created via migration with columns: id, name, command, description, category (analysis/design/implementation/review/test/general), source (builtin/template/custom), org_template_id (nullable), custom_prompt_content (nullable), created_at
**And** `ISkillRepository` interface defines: `findById`, `findBySource`, `findByCategory`, `findAll`, `create`, `update`, `delete`, `search(query)`
**And** `SqliteSkillRepository` implements the interface
**And** the repository is registered in composition-root.ts via DI token

### Story 3.2: Seed Builtin Skills and Template Skills

As a user,
I want the system to include a set of built-in skills and template skills (BMAD Method) out of the box,
So that I have useful capabilities available immediately.

**Acceptance Criteria:**

**Given** the skill repository from Story 3.1
**When** the application starts for the first time
**Then** builtin skills are seeded: task decomposition, code review, security audit, test generation, API design (at minimum)
**And** BMAD template skills are seeded when an org template referencing BMAD is loaded (e.g., `/bmad-create-architecture`, `/bmad-dev-story`, `/bmad-code-review`, `/bmad-create-story`, `/bmad-analyst`)
**And** each skill has: name, command reference, description, and category
**And** builtin/template skills have `custom_prompt_content = NULL` (content managed externally)
**And** seeding is idempotent — re-running does not create duplicates

### Story 3.3: Implement Skill Library Browse and Search UI

As a user,
I want to browse and search the skill library with filtering by source and category,
So that I can discover available skills for my roles.

**Acceptance Criteria:**

**Given** the seeded skills from Story 3.2
**When** the user navigates to the Skills & Knowledge page
**Then** all skills are displayed in a searchable, filterable list/grid
**And** filters include: source (builtin/template/custom), category (analysis/design/implementation/review/test/general)
**And** search matches against skill name, command, and description
**And** each skill card shows: name, command, description, source badge, category tag
**And** skill data is fetched via IPC from Main process

### Story 3.4: Implement Custom Skill Upload

As an advanced user,
I want to upload my own prompt templates as custom skills,
So that I can extend the system with domain-specific capabilities.

**Acceptance Criteria:**

**Given** the skill library UI from Story 3.3
**When** the user creates a custom skill
**Then** a creation form collects: name, command, description, category, and prompt content (multiline text editor)
**And** the skill is saved with `source = 'custom'` and `custom_prompt_content` populated
**And** custom skills appear in the skill library alongside builtin and template skills
**And** custom skills can be edited and deleted (builtin/template skills cannot be deleted)
**And** validation ensures name and command are unique

### Story 3.5: Implement Skill Selector for Role Configuration

As a user,
I want to select skills from the library when configuring a role,
So that I can assign the right capabilities to each AI agent.

**Acceptance Criteria:**

**Given** the role configuration drawer from Epic 2 and skill library from this epic
**When** the user configures skills for a role in the contextual drawer
**Then** a skill selector widget shows all available skills grouped by category
**And** skills can be toggled on/off for the role via checkboxes or tags
**And** selected skills are persisted as `skillIds` JSON array in the role record
**And** the skill selector supports search/filter within the widget
**And** selected skills are shown as tags/badges on the role node in the tree visualization

---

## Epic 4: Task System & Smart Decomposition

Users can create task trees with variable depth and type labels, the system manages task state transitions, and a smart decomposition advisor guides appropriate task breakdown.

### Story 4.1: Implement TaskNode Domain Entity and Repository

As a developer,
I want to define the TaskNode entity with variable-depth tree support, its repository interface, and SQLite implementation,
So that task trees can be persisted with all required fields.

**Acceptance Criteria:**

**Given** the SQLite foundation from Epic 1
**When** the task entity is created
**Then** `task_nodes` table is created via migration with columns: id, org_id, parent_id (nullable), type (epic/story/task/subtask/spike/bug/chore), title, description, status (pending/in_progress/awaiting_review/revision/approved/done/blocked/cancelled), assignee_role_id (nullable), depth, artifact_paths (JSON, nullable), created_at, updated_at
**And** `ITaskRepository` interface defines: `findById`, `findByOrgId`, `findByParentId`, `findByAssigneeRoleId`, `findByStatus`, `create`, `update`, `updateStatus`, `delete`
**And** `SqliteTaskRepository` implements the interface
**And** depth is auto-calculated on creation based on parent's depth + 1 (root = 0)
**And** foreign key references org_id and assignee_role_id

### Story 4.2: Implement Task State Machine

As a developer,
I want to enforce valid task state transitions through a state machine,
So that tasks follow the defined lifecycle without invalid state changes.

**Acceptance Criteria:**

**Given** the task entity from Story 4.1
**When** a task status change is requested
**Then** `TaskStateMachine` in `application/state-machine/` validates transitions per the defined flow: `pending` → `in_progress` → `awaiting_review` → `approved` → `done`, with `revision` (from `awaiting_review`), `blocked` (from `awaiting_review` on DELEGATE), and `cancelled` (from any state)
**And** `in_progress` → `awaiting_review` transition requires that the task execution is complete
**And** `revision` → `in_progress` transition is valid (re-execution after REVISE)
**And** invalid transitions throw a typed `TaskStateError`
**And** status changes emit events on the EventBus (`task:status-changed`)
**And** the state machine is a pure application service with no infrastructure dependencies

### Story 4.3: Implement Auto-Status Propagation

As a user,
I want parent tasks to automatically progress when all child tasks are completed,
So that I don't need to manually update parent task status.

**Acceptance Criteria:**

**Given** the task state machine from Story 4.2
**When** a child task transitions to `approved` or `done` status
**Then** the system checks if all sibling tasks under the same parent are `approved` or `done`
**And** if all siblings complete, the parent task's assignee role is automatically awakened for review/summarization
**And** auto-propagation is triggered via EventBus subscription in OrgOrchestrator (stub for now, full implementation in Epic 7)
**And** the propagation chain works recursively up the tree

### Story 4.4: Implement Task Tree Visualization UI

As a user,
I want to view and interact with the task tree in a hierarchical visualization,
So that I can see the full breakdown of work with status indicators.

**Acceptance Criteria:**

**Given** the task entity and state machine from Stories 4.1-4.2
**When** the user navigates to the Tasks & Epics page
**Then** all epics are listed with expandable task tree branches
**And** each task node shows: title, type badge, status indicator (color-coded per UX spec), assignee role name
**And** expanding a node reveals child tasks at the next depth level
**And** the tree uses the sparse snapshot strategy: L1 (epic list with status counts) on page load, L2 (expanded branch) on click
**And** status colors follow the design system: green=done/approved, orange=in_progress/revision/blocked, gray=pending, red=cancelled

### Story 4.5: Implement Manual Task Creation UI

As a user,
I want to create new tasks (epics, stories, tasks, subtasks) through the UI,
So that I can input requirements for the AI organization to work on.

**Acceptance Criteria:**

**Given** the task tree visualization from Story 4.4
**When** the user creates a new task
**Then** a creation form collects: title, description, type (selectable from epic/story/task/subtask/spike/bug/chore), parent task (optional, for nesting), assignee role (selectable from org tree)
**And** type defaults to `epic` when no parent is selected, `task` when a parent is selected
**And** the new task appears in the tree visualization immediately
**And** creating a task with `type=epic` triggers downstream discussion group creation (stub event for Epic 5)
**And** validation ensures title is non-empty and assignee role exists in the org

### Story 4.6: Implement Smart Decomposition Advisor

As the system,
I want to assess task complexity and recommend appropriate decomposition depth,
So that AI agents don't over-decompose simple tasks or under-decompose complex ones.

**Acceptance Criteria:**

**Given** the task system from Stories 4.1-4.5
**When** an AI role attempts to decompose a task (via MCP tool, stubbed for now)
**Then** `DecompositionAdvisor` in `application/` evaluates task complexity based on: description keyword analysis, estimated module count, dependency relationships
**And** the advisor recommends decomposition depth (1-4 levels) based on a complexity score
**And** a warning is generated when: low-complexity task is decomposed to >2 levels (over-decomposition), or high-complexity task is assigned to a leaf role without decomposition (under-decomposition)
**And** warnings are logged and can be surfaced in the UI (advisory, not blocking)
**And** complexity thresholds are configurable

---

## Epic 5: Discussion Groups & Consensus Decision Making

AI roles collaborate through auto-created Epic discussion groups with structured voting, and the system detects consensus and disputes to drive automated approval decisions.

### Story 5.1: Implement DiscussionGroup and Message Domain Entities

As a developer,
I want to define the DiscussionGroup and DiscussionMessage entities with their repository interfaces and SQLite implementations,
So that discussion data can be persisted and queried.

**Acceptance Criteria:**

**Given** the SQLite foundation from Epic 1
**When** the discussion entities are created
**Then** `discussion_groups` table: id, task_node_id (FK to task_nodes, must be epic type), org_id, status (active/archived), summary (nullable), last_summary_at (nullable), created_at
**And** `discussion_messages` table: id, group_id (FK), author_role_id (nullable for system), author_type (ai/human/system), content, vote_tag (APPROVE/REVISE/CONCERN/DELEGATE/null), created_at
**And** `IDiscussionRepository` interface defines: group CRUD, message CRUD, findMessagesByGroupId, findByVoteTag, getVoteStatistics(groupId), getLatestMessages(groupId, limit)
**And** `SqliteDiscussionRepository` implements the interface
**And** vote_tag is a structured data field, not parsed from text

### Story 5.2: Implement Discussion Group Auto-Creation and Membership

As the system,
I want to automatically create a discussion group when an epic task is created and manage membership as roles are assigned tasks,
So that all relevant roles are included in the collaboration context.

**Acceptance Criteria:**

**Given** the discussion entities from Story 5.1 and task events from Epic 4
**When** a TaskNode with `type=epic` is created
**Then** a DiscussionGroup is automatically created and bound to it (status=active)
**And** the epic's assignee role + direct subordinates in the org tree are automatically added as members
**And** when a new role is assigned a task within the epic, they auto-join the discussion group
**And** auto-creation is triggered via EventBus subscription to `task:created` events
**And** membership is tracked (either via a join table or computed from task assignments)

### Story 5.3: Implement Consensus Detection Service

As the system,
I want to automatically detect when all approving roles in a discussion group have voted APPROVE,
So that task approval happens through consensus without a separate approval step.

**Acceptance Criteria:**

**Given** the discussion entities from Story 5.1
**When** a message with `voteTag=APPROVE` is posted to a discussion group
**Then** `ConsensusDetector` scans all messages from roles with `canApprove=true` in that group
**And** when all `canApprove` roles have voted `APPROVE`, the associated task is automatically marked as `approved`
**And** `REVISE` processing: sets task status to `revision`, awakens assignee with revision feedback content
**And** `REVISE` cycle protection: tracks REVISE count per task; after `maxReviseAttempts` (default 3), escalates to parent role
**And** `CONCERN` processing: non-blocking; accumulated for dispute detection
**And** `DELEGATE` processing: creates a new TaskNode, sets original task to `blocked`, awakens target role
**And** consensus detection is triggered via EventBus subscription to `discussion:vote-added`

### Story 5.4: Implement Dispute Detection

As the system,
I want to detect when N CONCERN votes accumulate with 0 APPROVE votes over M rounds,
So that the parent role is automatically awakened to intervene in unresolvable disputes.

**Acceptance Criteria:**

**Given** the consensus detection from Story 5.3
**When** CONCERN votes accumulate in a discussion group
**Then** dispute detection triggers when: configurable threshold of CONCERN votes is reached AND zero APPROVE votes exist
**And** the parent role in the org tree is automatically awakened with a dispute summary
**And** the dispute summary includes: accumulated CONCERN messages, vote statistics, original task context
**And** dispute detection emits a `dispute:detected` event on the EventBus

### Story 5.5: Implement Discussion Auto-Summary

As a role being awakened,
I want to receive a discussion summary instead of the full message history,
So that I can quickly understand context without processing all messages.

**Acceptance Criteria:**

**Given** the discussion entities from Story 5.1
**When** a role is awakened and needs discussion context
**Then** the system generates a rule-based extract (not LLM summary in MVP): last 3 messages with content, vote statistics `{ APPROVE: N, REVISE: N, CONCERN: N, DELEGATE: N }`, latest REVISE feedback if task is in revision
**And** the summary is stored in the discussion_groups `summary` field and `last_summary_at` is updated
**And** the summary is injected into the role's prompt context (integration with Epic 6)
**And** summary generation is deterministic (reproducible from same data)

### Story 5.6: Implement Discussion Group Panel UI

As a user,
I want to view discussion group messages in real-time with vote tag highlighting,
So that I can observe the AI collaboration process and decision-making.

**Acceptance Criteria:**

**Given** the discussion entities and IPC from previous stories
**When** the user opens a discussion group from the task tree
**Then** messages are displayed in a chronological chat-like panel
**And** vote tags are color-highlighted: green=APPROVE, orange=REVISE, red=CONCERN, blue=DELEGATE
**And** structured vote messages display as rich "Chat-as-Action Cards" with the vote type prominently shown
**And** vote statistics (counts per tag) are displayed at the top or sidebar of the panel
**And** new messages appear in real-time via IPC subscription to `capibara:discussion:message-added`
**And** the panel uses L3 detail snapshot (full messages for one group) loaded on demand
**And** discussion group lifecycle: panel shows "archived" state when epic reaches `done`

---

## Epic 6: Agent Execution Engine

AI roles execute assigned tasks via Claude Code CLI in isolated UtilityProcess workers, with MCP bridge for real-time system operations, prompt construction from role context, and full run lifecycle management.

### Story 6.1: Implement Run Domain Entity and Repository

As a developer,
I want to define the Run entity with its repository interface and SQLite implementation,
So that execution instances and their lifecycle can be tracked.

**Acceptance Criteria:**

**Given** the SQLite foundation from Epic 1
**When** the run entity is created
**Then** `runs` table: id, org_id, task_node_id (FK), role_id (FK), status (queued/running/succeeded/failed/cancelled/interrupted), trigger (the wake trigger type), output_log (TEXT), started_at (nullable), finished_at (nullable), cost_usd (default 0), created_at
**And** `cost_entries` table: id, run_id (FK), role_id, org_id, token_count, cost_usd, created_at
**And** `IRunRepository` interface defines: `create`, `findById`, `findByTaskId`, `findByRoleId`, `findActiveByRoleId`, `updateStatus`, `updateCost`, `appendLog`
**And** `SqliteRunRepository` implements the interface
**And** serial execution constraint: only one active Run per role at a time (enforceable via query)

### Story 6.2: Implement PromptBuilder Service

As a developer,
I want to construct the system prompt for AI agent execution from role context, task details, org structure, and discussion summary,
So that agents receive all necessary context to perform their work.

**Acceptance Criteria:**

**Given** the role, task, and discussion entities from previous epics
**When** a Run is about to execute
**Then** `PromptBuilder` in `application/skills/` constructs a system prompt containing:
  - Role identity: name, persona
  - Organization context: superior role, subordinates, peers
  - Current task: title, type, description, status
  - Available skills: list of `/command: description` for each role skill
  - System MCP tools: `capibara_task_complete`, `capibara_task_create_subtask`, `capibara_discussion_post`, `capibara_escalate`
  - Discussion context: summary + last 3 messages + vote statistics (if discussion group exists)
  - Instructions: how to use tools based on task type
**And** PromptBuilder does NOT inject knowledge base content or upstream artifacts (per ADR-02 — BMAD handles this)
**And** PromptBuilder is a lightweight service with no infrastructure dependencies
**And** custom skills (`source='custom'`) have their `custom_prompt_content` injected directly

### Story 6.3: Implement MCP Server Bridge

As a developer,
I want to set up the MCP Server Bridge that allows AI agents to invoke Capibara system operations in real-time during execution,
So that agents can complete tasks, create subtasks, post to discussions, and escalate.

**Acceptance Criteria:**

**Given** the run entity and prompt builder from Stories 6.1-6.2
**When** a Run is created
**Then** `McpConfigGenerator` creates a temporary MCP config file per Run: `{ "mcpServers": { "capibara": { "command": "node", "args": ["capibara-mcp-bridge.js", "--run-id=<id>", "--token=<jwt>"] } } }`
**And** `capibara-mcp-bridge.ts` implements an MCP server (stdio transport) exposing tools: `capibara_task_complete`, `capibara_task_create_subtask`, `capibara_discussion_post`, `capibara_context_get_task`, `capibara_context_get_org_tree`, `capibara_context_get_discussion_summary`, `capibara_escalate`
**And** every tool call validates `runId` + JWT token before execution
**And** MCP tools route to application services via the DI container
**And** temp config files are cleaned up after Run ends
**And** MCP communication uses stdio transport only (no network ports)
**And** McpConfigGenerator resolves `workspace_path` from the Run's associated organization via orgId
**And** the MCP config specifies the organization's `workspace_path` as the working directory for CLI execution

### Story 6.4: Implement UtilityProcess Executor

As a developer,
I want to execute Claude Code CLI in Electron's UtilityProcess to avoid blocking the Main process,
So that the UI stays responsive during AI execution.

**Acceptance Criteria:**

**Given** the MCP bridge from Story 6.3
**When** a Run transitions to `running` status
**Then** `UtilityProcessExecutor` spawns an Electron UtilityProcess
**And** the UtilityProcess launches Claude Code CLI with the MCP config and constructed prompt
**And** the CLI process working directory (`cwd`) is set to the organization's `workspace_path`
**And** stdout/stderr streams are processed via StringDecoder with chunked splitting
**And** GBK encoding fallback is included for CJK environments
**And** output is streamed back to Main process via `parentPort` messaging
**And** full output is logged and stored in the Run record
**And** process lifecycle is managed: spawn, monitor, terminate (on cancel), cleanup
**And** the executor implements an `IExecutor` interface from core

### Story 6.5: Implement Run Lifecycle Management

As a developer,
I want to manage the full Run lifecycle from creation through completion,
So that execution status, cost tracking, and cleanup are handled consistently.

**Acceptance Criteria:**

**Given** the executor from Story 6.4
**When** a Run is created and executed
**Then** Run transitions through: `queued` → `running` → `succeeded`/`failed`/`cancelled`/`interrupted`
**And** pre-execution gate checks verify: role status is `active`, budget not exceeded, CLI connector available, no active Run for this role
**And** on success: Run status → `succeeded`, output stored, cost entry created, events emitted
**And** on failure: Run status → `failed`, error logged, retry logic triggered (delegated to Epic 10)
**And** on cancel: Run status → `cancelled`, UtilityProcess terminated, cleanup performed
**And** cost tracking: token count and USD cost calculated from CLI output and stored in `cost_entries`
**And** `run:succeeded`, `run:failed` events emitted on EventBus

---

## Epic 7: Orchestration & Wake-Up Loop

The system autonomously drives the entire workflow through an event-driven wake-up cycle with gate checks, pending wake queues, event digestion, and circuit breakers.

### Story 7.1: Implement OrgOrchestrator Core Event Loop

As a developer,
I want to implement the central OrgOrchestrator that handles all events and calculates wake targets,
So that the system autonomously progresses the workflow from requirement to delivery.

**Acceptance Criteria:**

**Given** the EventBus, task system, discussion system, and execution engine from previous epics
**When** events are emitted on the EventBus
**Then** `OrgOrchestrator` in `application/orchestrator/` subscribes to all relevant events: `task:completed`, `discussion:vote-added`, `run:succeeded`, `run:failed`, `run:timed-out`
**And** for each event, `calculateWakeTargets()` determines which role(s) to wake based on trigger type mapping:
  - `task_assigned` → assignee role
  - `task_completed` → parent role (reviewer)
  - `review_approve` → parent task assignee (if all siblings done)
  - `review_revise` → original assignee role
  - `review_delegate` → delegated target role
  - `delegation_completed` → original blocked task's reviewer
  - `retry_failed` → parent role (escalation)
  - `dispute_detected` → parent role (intervention)
**And** OrgOrchestrator emits new events that trigger downstream actions (Run creation, wake processing)

### Story 7.2: Implement Wake-Up Gate Checks and Role Activation

As the system,
I want to perform gate checks before waking a role to ensure it's safe to execute,
So that the system doesn't execute when preconditions are not met.

**Acceptance Criteria:**

**Given** the orchestrator from Story 7.1
**When** `wakeRoleIfPossible(roleId, trigger)` is called
**Then** the following gate checks are performed in order:
  1. Role status === `active`
  2. Budget not exceeded (org budget limit check)
  3. CLI connector available (executor ready)
  4. No active Run for this role (serial execution)
  5. Self-wake count < `MAX_CONSECUTIVE_WAKES` (circuit breaker, default 5)
**And** if all checks pass and role is idle: `createRun()` + dispatch to executor
**And** if all checks pass but role is busy: enqueue `PendingWake`
**And** if any gate check fails: log the reason and skip (do not lose the event)
**And** gate check results are observable for debugging

### Story 7.3: Implement PendingWake Queue

As the system,
I want to queue wake events when a role is busy and consume them when the role becomes idle,
So that wake signals are never lost during concurrent execution.

**Acceptance Criteria:**

**Given** the gate checks from Story 7.2
**When** a wake event arrives for a busy role
**Then** a `PendingWake` record is created: id, role_id, org_id, trigger, created_at
**And** `pending_wakes` table stores the queue in SQLite
**And** when a Run completes for a role, the system checks for pending wakes
**And** pending wakes are consumed in FIFO order (oldest first)
**And** consumed pending wakes are deleted from the table
**And** if multiple pending wakes exist for the same role, they are processed sequentially

### Story 7.4: Implement Event Digester

As a user,
I want rapid state changes aggregated into single summary notifications,
So that I'm not overwhelmed by notification storms during parallel execution.

**Acceptance Criteria:**

**Given** the event-driven system
**When** multiple events fire in rapid succession
**Then** `EventDigester` in `application/progress/` aggregates events within a configurable time window (default 30 seconds for notifications, 200-500ms for IPC batching)

---

## Conversation System Epics (Architecture v2)

> The following epics implement the Multi-turn Conversation System defined in `architecture-conversation-system.md` v2 and `prd-conversation-system.md`. They extend the base architecture (Epics 1-10) and are sequenced according to the 5-phase implementation plan.

### Conversation System FR Coverage Map

- Conv-FR1-FR3 (Conversation Initiation): Epic 11
- Conv-FR5-FR9 (Conversation Wake & Resume): Epic 11
- Conv-FR10-FR14 (Agent-to-Agent Conversation): Epic 11, Epic 15
- Conv-FR15-FR18 (Conversation Orchestration): Epic 13, Epic 15
- Conv-FR19-FR22 (Timeout & Escalation): Epic 13
- Conv-FR23-FR26 (Concurrent Conversation Management): Epic 14
- Conv-FR27-FR31 (Human Interaction): Epic 12
- Conv-FR32-FR35 (Audit & Observability): Epic 14

---

## Epic 11: Conversation Core — Durable Workflow & Routing Engine

AI roles can ask questions during task execution via MCP tools, the system routes questions to the appropriate supervisor AI role, the supervisor is automatically woken to respond, and the original asking role resumes execution with full conversation context — enabling the fundamental Agent-to-Agent multi-turn conversation loop.

**Architecture Ref:** Phase 1 (§4-§9, §14-§17)
**PRD FRs covered:** FR1-FR3, FR5-FR14
**ADRs implemented:** ADR-v2-01 (Durable Workflow), ADR-v2-02 (Routing Engine), ADR-v2-04 (Reuse DiscussionMessage), ADR-v2-05 (Priority Queue), ADR-v2-06 (Session Resume)

### Story 11.1: Define Conversation Domain Types and Interfaces

As a developer,
I want to define the conversation workflow types, state machine, repository interface, and DI tokens,
So that all conversation components have a shared contract to build upon.

**Acceptance Criteria:**

**Given** the existing core layer structure
**When** conversation domain types are created
**Then** `core/types/conversation.types.ts` defines: `ConversationWorkflowState` (7 states: waiting_for_reply, reply_received, resumed, resolved, escalated, timed_out, cancelled), `MessageIntent` (6 values: question, reply, escalation, resolution, vote, general), `RecipientTargetType` (supervisor, human, role, any), `RecipientTarget` discriminated union, `RoutingDecision`, `RoutingRequest`, `ConversationWorkflow` entity interface, `ConversationTransition`, `ContextBudgetConfig`, `TimeoutConfig`
**And** `core/types/domain.types.ts` is extended: `WakeTrigger` gains `discussion_reply` and `conversation_escalation`, `DiscussionMessage` gains `intent: MessageIntent` and `inReplyToMessageId: string | null`, `PendingWake` gains `priority: number`
**And** `core/types/event.types.ts` is extended with 7 new `conversation:*` event types and their payload interfaces
**And** `core/tokens.ts` gains 4 new tokens: `CONVERSATION_WORKFLOW_REPO_TOKEN`, `ROUTING_POLICY_ENGINE_TOKEN`, `CONVERSATION_WORKFLOW_SERVICE_TOKEN`, `TIMEOUT_ESCALATION_SERVICE_TOKEN`
**And** `core/interfaces/i-conversation-workflow.repository.ts` defines: `findById`, `findByTaskNodeId`, `findActiveByRoleAndTask`, `findWaitingByDiscussionGroup`, `findExpiredWorkflows`, `findByOrgId`, `create`, `updateState`, `updateReply`, `updateRespondent`
**And** `core/interfaces/i-routing-policy-engine.ts` defines: `resolve(request: RoutingRequest): Promise<RoutingDecision>`
**And** `core/interfaces/i-conversation-workflow.service.ts` defines: `createWorkflow`, `handleReply`, `transitionState`, `createEscalatedWorkflow`
**And** all exports are named exports, all imports use `.js` extensions

### Story 11.2: Implement Database Schema Extensions and Migrations

As a developer,
I want to create the `conversation_workflows` table, extend `discussion_messages` and `pending_wakes` tables, and create the `conversation_events` audit table,
So that conversation state can be persisted and recovered after crashes.

**Acceptance Criteria:**

**Given** the existing SQLite migration system
**When** conversation schema migrations run
**Then** `conversation_workflows` table is created with all columns per Architecture §14.1 (id, org_id, task_node_id, discussion_group_id, asking_role_id, asking_run_id, asking_session_id, question_message_id, reply_message_id, respondent_role_id, respondent_type, state, depth, parent_workflow_id, priority, timeout_at, resolved_at, audit_reason, created_at, updated_at)
**And** the table has CHECK constraints on `respondent_type` and `state` values
**And** 5 indexes are created: org_id+state, task_node_id+state, asking_role_id+state, respondent_role_id+state, partial index on timeout_at WHERE state='waiting_for_reply'
**And** `discussion_messages` table gains `intent` column (TEXT NOT NULL DEFAULT 'general' with CHECK constraint) and `in_reply_to_message_id` column (TEXT FK to self)
**And** `pending_wakes` table gains `priority` column (INTEGER NOT NULL DEFAULT 0)
**And** `conversation_events` table is created (id, workflow_id FK, event_type TEXT, event_payload TEXT/JSON, created_at) with index on workflow_id+created_at
**And** all foreign key constraints are enforced
**And** migrations are idempotent (safe to run multiple times)

### Story 11.3: Implement Conversation Workflow Repository

As a developer,
I want a SQLite repository implementation for `ConversationWorkflow` entities,
So that conversation state is persisted and queryable.

**Acceptance Criteria:**

**Given** the schema from Story 11.2 and interfaces from Story 11.1
**When** `SqliteConversationWorkflowRepository` is implemented
**Then** it implements `IConversationWorkflowRepository` in `infrastructure/persistence/sqlite/`
**And** `findById` returns a single workflow or null
**And** `findActiveByRoleAndTask` finds workflows in non-terminal states for a given role+task combination
**And** `findWaitingByDiscussionGroup` finds workflows in `waiting_for_reply` state for a given discussion group
**And** `findExpiredWorkflows(now: string)` returns all workflows where `timeout_at < now` AND `state = 'waiting_for_reply'`
**And** `create` inserts a new workflow record and returns the entity
**And** `updateState` updates state and updated_at, validates transition legality via state machine rules before writing
**And** `updateReply` sets reply_message_id and transitions state atomically
**And** the repository is registered in `composition-root.ts` via `CONVERSATION_WORKFLOW_REPO_TOKEN`
**And** all methods return `Promise<T>` (per ADR-01)

### Story 11.4: Implement Routing Policy Engine

As a developer,
I want a unified routing engine that evaluates all routing rules in a deterministic pipeline,
So that "who should respond?" decisions are centralized, auditable, and consistent.

**Acceptance Criteria:**

**Given** the domain types and repository from Stories 11.1-11.3
**When** `RoutingPolicyEngine` is implemented in `application/conversation/`
**Then** it implements `IRoutingPolicyEngine` interface
**And** the pipeline evaluates 6 steps in order per Architecture §6.3:
  1. Human Gate Check — if `target=human` AND `askingRole.requiresHumanApproval !== true` → rewrite to supervisor, set `auditReason='human_target_blocked_by_role_gate'`, set `wasRewritten=true`
  2. Specific Role Resolution — if `target=role` AND role is active → route to that role; else fall through
  3. Supervisor Resolution — resolve `askingRole.parentId`; if parent active → route; if no parent → Step 6
  4. Skill-Match Resolution (for `target=any`) — find peers with matching skill categories, rank by load → route to best; if no match → Step 3
  5. Cycle Detection — depth limit (10), self-wake rejection, pair cycle detection within last 4 hops → escalate if detected
  6. Top-Level Fallback — if no AI available → route to human (forced, priority=3), emit `escalation:top-level`
**And** the method returns a `RoutingDecision` with: respondentRoleId, respondentType, priority, auditReason, wasRewritten
**And** dependencies are injected via DI: IRoleRepository, IRunRepository, IConversationWorkflowRepository, config
**And** the engine is registered via `ROUTING_POLICY_ENGINE_TOKEN`
**And** each pipeline step logs its decision for audit

### Story 11.5: Implement Conversation Workflow Service

As a developer,
I want a core service that manages conversation workflow lifecycles — creation, reply handling, state transitions, and escalation,
So that all conversation operations flow through a single, coherent orchestration service.

**Acceptance Criteria:**

**Given** the repository and routing engine from Stories 11.3-11.4
**When** `ConversationWorkflowService` is implemented in `application/conversation/`
**Then** `createWorkflow(input)` performs: persist question as DiscussionMessage (intent='question'), create ConversationWorkflow in 'waiting_for_reply', call RoutingPolicyEngine.resolve(), set respondent on workflow, create PendingWake for respondent with priority, set timeout_at based on urgency config, emit 'conversation:question-posted', log conversation_event 'question_posted'
**And** `handleReply(workflowId, messageId)` performs: validate workflow is in 'waiting_for_reply', update replyMessageId, transition to 'reply_received', cancel timeout, create PendingWake for askingRoleId with trigger='discussion_reply', emit 'conversation:reply-posted', log conversation_event 'reply_posted'
**And** `transitionState(workflowId, targetState)` validates transition legality via state machine before persisting, emits 'conversation:state-changed', logs conversation_event 'state_changed'
**And** `createEscalatedWorkflow(parentWorkflow, newRespondentRoleId)` creates a new workflow with parentWorkflowId set, depth incremented, priority=2, and routes to the new respondent
**And** all operations write to SQLite before emitting events (crash safety)
**And** the service is registered via `CONVERSATION_WORKFLOW_SERVICE_TOKEN`

### Story 11.6: Implement `capibara_ask_question` MCP Tool

As an AI agent,
I want to call `capibara_ask_question` during task execution to post a question and pause,
So that I can get clarification from my supervisor or another role before continuing.

**Acceptance Criteria:**

**Given** the ConversationWorkflowService from Story 11.5
**When** the MCP tool is registered and invoked
**Then** `ask-question.handler.ts` is created in `infrastructure/mcp/tools/`
**And** input is Zod-validated: `{ taskId: string, question: string, recipientTarget?: { type, roleId? }, urgency?: 'normal' | 'urgent' }`
**And** `taskId` is validated against the active Run's task (security: agents cannot ask for other tasks)
**And** `runId` + JWT token are validated (existing auth pattern)
**And** the handler delegates to `ConversationWorkflowService.createWorkflow()`
**And** it returns `{ status: 'question_posted', respondentInfo: { roleId?, type }, timeoutSeconds }`
**And** the tool is registered in `McpToolRegistry` as `capibara_ask_question`
**And** the handler finds or creates a DiscussionGroup for the task if one doesn't exist
**And** the default recipientTarget is `{ type: 'supervisor' }` when not specified

### Story 11.7: Extend Wake Triggers and OrgOrchestrator for Conversation Events

As a developer,
I want the OrgOrchestrator to subscribe to conversation events and calculate wake targets for conversation replies and escalations,
So that the existing event-driven wake loop handles conversation flows seamlessly.

**Acceptance Criteria:**

**Given** the existing OrgOrchestrator event subscription pattern
**When** conversation event support is added
**Then** `OrgOrchestrator.start()` subscribes to: `conversation:reply-posted`, `conversation:escalated`, `conversation:timed-out`
**And** `calculateWakeTargets()` handles `conversation:reply-posted` by returning askingRoleId with trigger `discussion_reply`
**And** `calculateWakeTargets()` handles `conversation:escalated` by returning respondentRoleId with trigger `conversation_escalation`
**And** `wakeRoleIfPossible()` uses `triggerToPriority()` to map triggers: conversation_escalation=2, discussion_reply=1, all others=0
**And** when creating PendingWake, the priority is persisted
**And** when consuming pending wakes after Run completion, `findHighestPriority(roleId, orgId)` selects by `priority DESC, created_at ASC` instead of FIFO
**And** the `pending_wakes` ordered consumption is updated in `IPendingWakeRepository` and its SQLite implementation

### Story 11.8: Implement Session Resume for `discussion_reply` Wake

As a developer,
I want the ExecutionEngine to use `--resume <sessionId>` when waking an agent for a conversation reply,
So that the agent retains its full prior thought process and can continue seamlessly.

**Acceptance Criteria:**

**Given** the Run creation flow in ExecutionEngine
**When** a Run is created with trigger `discussion_reply`
**Then** the ExecutionEngine queries `ConversationWorkflowRepository.findActiveByRoleAndTask(roleId, taskNodeId)`
**And** if the workflow has a non-null `askingSessionId`, the CLI is invoked with `--resume <askingSessionId>`
**And** the `askingSessionId` is sourced from the `Run.sessionId` of the asking run at workflow creation time
**And** if `askingSessionId` is null (edge case), the agent is started as a fresh session with full context injection
**And** the session resume mechanism logs which sessionId is being resumed for audit

### Story 11.9: Implement Conversation Context Builder for Prompt Injection

As a developer,
I want a `ConversationContextBuilder` that formats conversation history into a structured prompt section with token budget management,
So that agents woken by `discussion_reply` receive complete and well-formatted conversation context.

**Acceptance Criteria:**

**Given** the ConversationWorkflow and DiscussionMessage data
**When** `ConversationContextBuilder` is invoked
**Then** it is implemented in `application/conversation/conversation-context.builder.ts`
**And** it retrieves all messages from the workflow's discussion group filtered by intent (question, reply, escalation)
**And** messages are formatted as a numbered timeline: `[N] RoleName [intent]: Content -- timestamp`
**And** a wake reason section is appended explaining the trigger and resume context
**And** if total token estimate <= `maxConversationTokens` (default 8000), all messages are included
**And** if exceeding budget, the first question + last 10 messages are preserved; older messages are summarized as `[N messages omitted]`
**And** the original question and latest reply are NEVER truncated
**And** token estimation uses a simple char/4 heuristic (no external tokenizer needed for MVP)

### Story 11.10: Extend PromptBuilder for Conversation Context

As a developer,
I want the existing PromptBuilder to include conversation context and updated MCP tool listings when an agent is woken for a conversation,
So that agents have all the information they need to continue work after receiving a reply.

**Acceptance Criteria:**

**Given** the ConversationContextBuilder from Story 11.9
**When** `PromptBuilder.build()` is called with trigger `discussion_reply` or `conversation_escalation`
**Then** the conversation context section is appended to the prompt after Discussion Context
**And** the MCP tool listing includes `capibara_ask_question` and `capibara_mark_conversation_resolved`
**And** the Instructions section is replaced with conversation resume instructions per Architecture §17.3
**And** for `conversation_escalation` trigger, the prompt explains the agent received an escalated question from a subordinate conversation
**And** the prompt context type `PromptContext` is extended with optional `conversationWorkflow: ConversationWorkflow` field

### Story 11.11: Extend DiscussionService for Conversation Reply Detection

As a developer,
I want the existing DiscussionService to detect when a posted message is a reply to an active conversation,
So that conversation workflow state transitions happen automatically when agents or humans reply.

**Acceptance Criteria:**

**Given** the ConversationWorkflowService from Story 11.5
**When** a message is posted via `DiscussionService.postMessage()` or `capibara_discussion_post` MCP tool
**Then** after persisting the message, the service checks if there is an active ConversationWorkflow in `waiting_for_reply` for the message's discussion group
**And** if an active workflow exists and the message intent is 'reply' (or the message's author matches the workflow's respondentRoleId), `ConversationWorkflowService.handleReply()` is called
**And** the detection logic handles both AI replies (via MCP tool) and human replies (via IPC)
**And** if no active workflow exists, the message is persisted normally without triggering conversation logic

### Story 11.12: Integration Test — Dev Asks EM, EM Replies, Dev Resumes

As a developer,
I want an integration test verifying the complete conversation loop: Developer asks → Engineering Manager replies → Developer resumes with context,
So that I have confidence the end-to-end flow works correctly.

**Acceptance Criteria:**

**Given** all Phase 1 components from Stories 11.1-11.11
**When** the integration test runs
**Then** it creates an Organization with Developer (child) and Engineering Manager (parent) roles
**And** it simulates a Developer Run that calls `capibara_ask_question` with a question
**And** it verifies a ConversationWorkflow is created in `waiting_for_reply` state
**And** it verifies a PendingWake exists for the EM role with the appropriate trigger
**And** it simulates EM run and posting a reply message
**And** it verifies the workflow transitions to `reply_received` then to `resumed`
**And** it verifies a new PendingWake exists for the Developer with trigger `discussion_reply`
**And** it verifies the Developer's resumed Run would use `--resume` with the original sessionId
**And** it verifies conversation_events contains entries for: question_posted, routing_decided, reply_posted, state_changed
**And** the test uses mocked CLI execution (no actual LLM calls)

---

## Epic 12: Conversation Human Interaction

Human users can participate in Agent conversations through the UI — receiving notifications when roles with `requiresHumanApproval=true` ask questions, replying directly in the discussion panel, marking conversations as resolved, and intervening in any Agent-to-Agent conversation.

**Architecture Ref:** Phase 2 (§13, §8.3)
**PRD FRs covered:** FR3, FR27-FR31
**ADRs implemented:** ADR-v2-03 (Human Gate)

### Story 12.1: Implement Human Gate Enforcement in Routing Engine

As a system,
I want the RoutingPolicyEngine to enforce the human gate as a hard system-level constraint,
So that only roles with `requiresHumanApproval=true` can send questions to human users.

**Acceptance Criteria:**

**Given** the RoutingPolicyEngine from Story 11.4
**When** an agent specifies `recipientTarget = { type: 'human' }`
**Then** if `askingRole.requiresHumanApproval === true`, the gate passes and routes to human
**And** if `askingRole.requiresHumanApproval !== true`, the gate blocks, rewrites target to `supervisor`, sets `auditReason = 'human_target_blocked_by_role_gate'` and `wasRewritten = true`
**And** a `conversation_event` with type `human_gate_enforced` is logged with original target, rewritten target, and role config
**And** the blocked agent receives no error — the rewrite is transparent
**And** no amount of prompt crafting by the agent can bypass this gate (it's server-side enforcement)

### Story 12.2: Implement Conversation IPC Handlers

As a developer,
I want IPC endpoints for conversation operations so the Renderer UI can interact with conversation workflows,
So that humans can view, reply to, cancel, and manage conversations from the desktop UI.

**Acceptance Criteria:**

**Given** the existing IPC handler pattern
**When** `conversation.ipc-handler.ts` is created in `ipc-handlers/`
**Then** the following IPC channels are implemented with Zod-validated payloads:
  - `capibara:conversation:list-active` — list active conversations for an org (returns workflows with state not in terminal states)
  - `capibara:conversation:get-history` — get full conversation message history for a workflow
  - `capibara:conversation:cancel` — cancel an active conversation (transitions to 'cancelled')
  - `capibara:conversation:get-metrics` — get conversation metrics for an org
**And** all responses use `DesktopResult<T>` format
**And** the IPC handler delegates to `ConversationWorkflowService` and repository
**And** channel names follow `capibara:conversation:action` naming convention
**And** channels are registered in `shared/contracts.ts`

### Story 12.3: Implement Human Reply Detection in DiscussionService

As a developer,
I want the system to detect when a human posts a reply in a discussion that has an active conversation workflow,
So that human replies automatically trigger the conversation reply flow and wake the asking agent.

**Acceptance Criteria:**

**Given** the DiscussionService reply detection from Story 11.11
**When** a message is posted via IPC with `authorType = 'human'`
**Then** the system checks for active ConversationWorkflow waiting on that discussion group
**And** if found, calls `ConversationWorkflowService.handleReply()` which transitions workflow, creates PendingWake for the asking role
**And** the human reply message is persisted with `intent = 'reply'` and `inReplyToMessageId` pointing to the question message
**And** the flow works identically whether the reply comes from an AI agent or human — same handleReply path

### Story 12.4: Implement Human Notification for Conversation Questions

As a human user,
I want to receive a desktop notification when an AI role with `requiresHumanApproval=true` asks a question requiring my input,
So that I know there's an action requiring my attention.

**Acceptance Criteria:**

**Given** the conversation workflow creates a human-targeted question
**When** the `conversation:question-posted` event fires with `respondentType = 'human'`
**Then** `EventBroadcaster` relays the event to the Renderer via IPC
**And** the Renderer shows a notification badge on the organization in the sidebar
**And** the notification includes: asking role name, question preview (first 100 chars), urgency level
**And** the notification in the discussion panel highlights the question message with a "Needs your reply" indicator
**And** clicking the notification navigates to the relevant discussion panel

### Story 12.5: Implement `capibara_mark_conversation_resolved` MCP Tool

As an AI agent,
I want to call `capibara_mark_conversation_resolved` after incorporating a reply,
So that the conversation workflow is properly closed and no further wake triggers fire.

**Acceptance Criteria:**

**Given** the ConversationWorkflowService from Story 11.5
**When** the MCP tool is registered and invoked
**Then** `mark-resolved.handler.ts` is created in `infrastructure/mcp/tools/`
**And** input is Zod-validated: `{ taskId: string, summary?: string }`
**And** the handler finds the active ConversationWorkflow for the task where `askingRoleId` matches the current role
**And** transitions workflow state to `resolved`, sets `resolvedAt`
**And** if `summary` is provided, posts a DiscussionMessage with `intent = 'resolution'`
**And** emits `conversation:resolved` event
**And** logs conversation_event 'resolved'
**And** the tool is registered in `McpToolRegistry` as `capibara_mark_conversation_resolved`

### Story 12.6: Implement Human Override — Cancel and Intervene

As a human user,
I want to cancel any active conversation or intervene in an Agent-to-Agent conversation by posting a direct reply,
So that I maintain ultimate control over the conversation flow.

**Acceptance Criteria:**

**Given** the conversation IPC handlers from Story 12.2
**When** a human cancels a conversation via `capibara:conversation:cancel`
**Then** the workflow transitions to `cancelled` state
**And** any pending wakes related to this workflow are cleaned up
**And** a conversation_event 'cancelled' is logged
**When** a human posts a reply in an Agent-to-Agent discussion
**Then** the reply is accepted (no gate check — humans can always reply)
**And** if there's an active `waiting_for_reply` workflow, the human reply triggers `handleReply()` (human reply preempts the AI respondent)
**And** the original AI respondent's pending wake is cancelled (first-reply-wins)

### Story 12.7: Integration Test — Analyst Asks Human, Human Replies, Analyst Resumes

As a developer,
I want an integration test verifying the human interaction flow: Analyst (requiresHumanApproval=true) asks human → human replies via IPC → Analyst resumes,
So that the human gate and reply flow work end-to-end.

**Acceptance Criteria:**

**Given** all Phase 2 components
**When** the integration test runs
**Then** it creates an Analyst role with `requiresHumanApproval=true`
**And** Analyst calls `capibara_ask_question` with `target=human`
**And** routing engine passes the gate, workflow respondentType is 'human'
**And** a simulated human reply is posted via IPC `capibara:discussion:post-message`
**And** workflow transitions: waiting_for_reply → reply_received → resumed
**And** PendingWake for Analyst is created with trigger `discussion_reply`
**And** a separate test verifies gate blocking: Developer (requiresHumanApproval=false) asks `target=human` → gets rewritten to supervisor

---

## Epic 13: Conversation Timeout, Escalation & Safety

Conversations that stall without a reply are automatically escalated through the role hierarchy. Circular conversation patterns are detected and broken. Orphaned workflow states are recovered after system restart.

**Architecture Ref:** Phase 3 (§10, §11, §18)
**PRD FRs covered:** FR17-FR22
**ADRs leveraged:** ADR-v2-01 (Crash Recovery), ADR-v2-02 (Cycle Detection in Routing)

### Story 13.1: Implement Timeout Escalation Service

As a developer,
I want a periodic scanner that detects timed-out conversations and automatically escalates them to the next level in the role hierarchy,
So that stalled conversations are not left indefinitely waiting.

**Acceptance Criteria:**

**Given** the ConversationWorkflow with `timeout_at` field
**When** `TimeoutEscalationService` is implemented in `application/conversation/`
**Then** it starts a periodic scan interval (default 15 seconds, configurable)
**And** each scan queries `findExpiredWorkflows(now)` from the repository
**And** for each expired workflow: if `depth < maxEscalationLevels` (default 3), it transitions the workflow to `escalated` and calls `createEscalatedWorkflow()` with the respondent's parent role
**And** if `depth >= maxEscalationLevels`, it transitions to `timed_out` and emits `escalation:top-level` event for mandatory human notification
**And** if the current respondent has no parent (top of hierarchy), it forces human escalation regardless of depth
**And** each escalation creates a new ConversationWorkflow with: parentWorkflowId, depth+1, priority=2, new timeout_at
**And** the service emits `conversation:escalated` event for each escalation
**And** the service logs conversation_event `timeout_triggered` and `escalation_created`
**And** the service is registered via `TIMEOUT_ESCALATION_SERVICE_TOKEN` and started in `composition-root.ts`
**And** the scan interval handle is properly cleaned up on application shutdown

### Story 13.2: Implement Cycle Detection in Routing Policy Engine

As a developer,
I want the RoutingPolicyEngine to detect and break circular conversation patterns,
So that Agent-to-Agent conversations never enter infinite loops.

**Acceptance Criteria:**

**Given** the RoutingPolicyEngine from Story 11.4
**When** the cycle detection pipeline step is fully implemented
**Then** **Depth Limit**: if `conversationDepth >= maxConversationDepth` (10), returns `{ hasCycle: true, action: 'force_human' }`
**And** **Self-Wake**: if `respondentRoleId === askingRoleId`, returns `{ hasCycle: true, action: 'route_to_supervisor' }`
**And** **Pair Cycle**: retrieves the last 4 conversation hops for the task, checks if the asking↔respondent pair has appeared → if so, returns `{ hasCycle: true, action: 'escalate_respondent_parent' }`
**And** cycle detection logs `conversation_event` with type `routing_decided` including cycle detection results
**And** when a cycle is detected, the routing falls through to the next pipeline step (escalation or top-level fallback)

### Story 13.3: Implement Conversation Events Audit Logging

As a developer,
I want all significant conversation actions logged to the `conversation_events` append-only table,
So that the complete conversation decision trail is auditable and debuggable.

**Acceptance Criteria:**

**Given** the `conversation_events` table from Story 11.2
**When** conversation operations occur
**Then** the following events are logged with JSON payloads:
  - `question_posted`: question content, recipient target, workflow ID
  - `routing_decided`: pipeline steps evaluated, final decision, audit reason, wasRewritten flag
  - `human_gate_enforced`: original target, rewritten target, role requiresHumanApproval value
  - `reply_posted`: replier info, response time (createdAt diff from question)
  - `state_changed`: from state, to state, trigger reason
  - `timeout_triggered`: elapsed time, escalation target, depth
  - `escalation_created`: parent workflow ID, new respondent, new depth
  - `resolved`: resolution summary if provided
  - `cancelled`: cancellation source (human or system)
**And** events are written via a `ConversationEventLogger` helper injected into ConversationWorkflowService
**And** the logger never throws — failures are logged to Pino but do not block the main flow
**And** `conversation_events` table is strictly append-only (no UPDATE or DELETE operations)

### Story 13.4: Implement Crash Recovery for Orphaned Workflows

As a developer,
I want the system to scan for and recover orphaned conversation workflows on startup,
So that conversations interrupted by crashes are properly resumed or escalated.

**Acceptance Criteria:**

**Given** the TimeoutEscalationService and ConversationWorkflowService
**When** the Main Process starts up
**Then** the system queries all ConversationWorkflows in `waiting_for_reply` state
**And** for each: if `timeout_at` has passed → immediately escalate (reuse escalation logic)
**And** for each: if `timeout_at` has not passed → re-arm timeout (the periodic scanner will handle it)
**And** the system queries all ConversationWorkflows in `reply_received` state
**And** for each: create PendingWake for the asking role with trigger `discussion_reply` (the wake was lost in the crash)
**And** recovery actions are logged at INFO level
**And** recovery runs before the OrgOrchestrator starts processing events (to avoid race conditions)

### Story 13.5: Integration Test — Timeout Escalation Chain to Human

As a developer,
I want an integration test verifying the timeout → escalation chain → forced human notification flow,
So that I have confidence the safety mechanisms work correctly.

**Acceptance Criteria:**

**Given** all Phase 3 components
**When** the integration test runs
**Then** it creates a 3-level hierarchy: Developer → EM → CTO (no parent)
**And** Developer asks EM a question with a very short timeout (e.g., 100ms for testing)
**And** EM does not reply within the timeout
**And** the system escalates: original workflow → escalated, new workflow created for CTO
**And** CTO does not reply within timeout
**And** the system reaches max depth → transitions to `timed_out`, emits `escalation:top-level`
**And** conversation_events contains: question_posted, timeout_triggered, escalation_created, timeout_triggered, escalation:top-level
**And** a separate test verifies crash recovery: create a workflow, simulate restart, verify recovery actions

---

## Epic 14: Concurrent Conversation Management & Observability

Multiple conversations can be active simultaneously within an organization with deterministic priority-based scheduling. Conversation metrics are available for monitoring and analysis.

**Architecture Ref:** Phase 4 (§12, §18)
**PRD FRs covered:** FR23-FR26, FR32-FR35

### Story 14.1: Implement Priority-Based Pending Wake Consumption

As a developer,
I want the OrgOrchestrator to consume pending wakes in priority order instead of FIFO,
So that urgent conversations and escalations are processed before routine task wakes.

**Acceptance Criteria:**

**Given** the `pending_wakes` table with `priority` column from Story 11.2
**When** a role's Run completes and pending wakes exist
**Then** `IPendingWakeRepository.findHighestPriority(roleId, orgId)` returns the wake with highest priority (DESC) and earliest creation time (ASC)
**And** `SqlitePendingWakeRepository` query uses `ORDER BY priority DESC, created_at ASC LIMIT 1`
**And** the consumed wake is deleted atomically before processing
**And** if multiple wakes have the same priority, FIFO ordering is preserved
**And** priority values follow the convention: 0=normal, 1=conversation, 2=escalation, 3=system-critical

### Story 14.2: Implement Conversation Metrics Queries

As a developer,
I want SQL aggregation queries that compute conversation metrics from existing tables,
So that observability data is available without maintaining a separate metrics table.

**Acceptance Criteria:**

**Given** `conversation_workflows` and `conversation_events` tables
**When** metrics are queried via `capibara:conversation:get-metrics` IPC
**Then** the following metrics are computed per organization:
  - `totalConversations`: COUNT of all workflows
  - `avgResponseTimeMs`: AVG of (reply_posted.created_at - question_posted.created_at) from events
  - `escalationRate`: COUNT(state='escalated') / COUNT(total) as percentage
  - `timeoutRate`: COUNT(state='timed_out') / COUNT(total) as percentage
  - `humanInterventionRate`: COUNT(respondent_type='human') / COUNT(total) as percentage
  - `avgDepth`: AVG(depth) across all workflows
  - `cycleDetectionCount`: COUNT of events where event_type='routing_decided' AND payload contains 'cycle'
**And** queries are efficient using existing indexes
**And** results are returned as a `ConversationMetrics` object

### Story 14.3: Implement Active Conversation List UI

As a human user,
I want to see all active conversations across my organization in a unified list view,
So that I can monitor ongoing Agent interactions and intervene when needed.

**Acceptance Criteria:**

**Given** the conversation IPC endpoints from Story 12.2
**When** the user navigates to the organization's conversation view
**Then** a list displays all active (non-terminal) conversations sorted by priority DESC, created_at DESC
**And** each item shows: asking role name, question preview, respondent info, current state, time elapsed, priority badge
**And** conversations requiring human reply are highlighted with a distinct indicator
**And** clicking a conversation navigates to the relevant discussion panel with conversation history
**And** the list auto-refreshes when `conversation:state-changed` events arrive via IPC
**And** terminal-state conversations can be shown via a "Show resolved" toggle

### Story 14.4: Implement Conversation Timeline View

As a human user,
I want to see a conversation timeline showing the complete flow of a multi-role discussion including routing decisions,
So that I can audit the full conversation chain and understand why routing decisions were made.

**Acceptance Criteria:**

**Given** the conversation_events audit log from Story 13.3
**When** the user opens a conversation detail view
**Then** a timeline displays all events chronologically: question posted, routing decided, reply posted, state changes, escalations
**And** routing decisions show the audit reason (e.g., "Routed to EM as supervisor", "Human gate blocked — rewritten to supervisor")
**And** escalation chains show the parent→child workflow links visually
**And** the timeline uses semantic colors: question=blue, reply=green, escalation=orange, timeout=red
**And** timestamps show relative time (e.g., "2 min ago") with full timestamp on hover

### Story 14.5: Stress Test — 5 Concurrent Conversations

As a developer,
I want a stress test verifying 5 simultaneous conversations within one organization work correctly without deadlocks or lost wakes,
So that I have confidence in the concurrent conversation management.

**Acceptance Criteria:**

**Given** all Phase 4 components
**When** the stress test runs
**Then** it creates an organization with 6 roles (5 developers + 1 manager)
**And** all 5 developers simultaneously ask questions to the manager
**And** the manager's pending_wakes queue contains 5 entries at peak
**And** the manager processes each conversation sequentially (one Run at a time)
**And** each conversation completes successfully (reply → resume)
**And** no pending wakes are lost
**And** the total order of processing matches priority DESC, created_at ASC
**And** conversation metrics show 5 total conversations with 0% timeout and 0% escalation rate

---

## Epic 15: Advanced Conversation Features

Skill-based intelligent routing, cascaded multi-role discussions with full context propagation, token budget truncation for long conversations, and conversation pattern analytics.

**Architecture Ref:** Phase 5 (§6.3 Step 4, §9.3-9.4)
**PRD FRs covered:** FR12, FR15-FR16

### Story 15.1: Implement Skill-Match Routing in Routing Policy Engine

As a developer,
I want the routing engine to match questions to peer roles based on skill category relevance,
So that questions like "How should I test this?" are routed to a QA role rather than a generic supervisor.

**Acceptance Criteria:**

**Given** the RoutingPolicyEngine with the `target=any` path (Step 4)
**When** skill-match routing is triggered
**Then** the engine queries all peer roles (same parent) with active status
**And** it compares the question content keywords against role skill descriptions and categories
**And** roles are ranked by: skill relevance score (keyword match count) → current load (fewer active runs = better)
**And** the highest-ranked peer is selected as respondent
**And** if no peer matches, the routing falls through to supervisor resolution (Step 3)
**And** skill matching is lightweight (keyword-based, not LLM-based) for MVP
**And** routing decision audit includes the skill match scores

### Story 15.2: Implement Multi-Hop Cascade with Context Propagation

As a developer,
I want the system to support multi-hop conversation cascades (Dev→EM→CTO) where each hop's respondent can ask further questions with full conversation chain context,
So that complex questions can flow up the hierarchy with complete information.

**Acceptance Criteria:**

**Given** the ConversationWorkflow's `parentWorkflowId` and `depth` fields
**When** a respondent (EM) receives a question and asks their own supervisor (CTO)
**Then** a new ConversationWorkflow is created with `parentWorkflowId` pointing to the original workflow
**And** `depth` is incremented (original=0, EM's question=1, etc.)
**And** the CTO's context injection includes the FULL cascade chain: Developer's original question → EM's analysis → EM's question to CTO
**And** when CTO replies, EM is woken with CTO's reply + full cascade context
**And** when EM replies to Developer, Developer is woken with the entire conversation chain
**And** cycle detection prevents A→B→A loops within the cascade
**And** the maximum cascade depth is enforced by `maxConversationDepth`

### Story 15.3: Implement Token Budget Truncation for Long Conversations

As a developer,
I want the ConversationContextBuilder to intelligently truncate long conversation histories while preserving critical messages,
So that agents always receive the most relevant context within token limits.

**Acceptance Criteria:**

**Given** the ConversationContextBuilder from Story 11.9
**When** a conversation history exceeds `maxConversationTokens` (8000)
**Then** the truncation strategy `oldest_first` is applied:
  1. The original question message is always preserved (anchor)
  2. The latest reply is always preserved (anchor)
  3. The most recent 10 messages are preserved
  4. Older messages between anchors and recent window are dropped
  5. A summary line `[{N} earlier messages omitted]` is inserted at the truncation point
**And** the token count includes the summary line
**And** if even the anchored messages + recent 10 exceed budget, the recent window is reduced to 5
**And** the truncation is deterministic — same input always produces same output
**And** a future `summarize_oldest` strategy placeholder exists in the interface but is not implemented yet

### Story 15.4: Implement Conversation Pattern Analytics

As a human user,
I want to see aggregated insights about conversation patterns across my organization,
So that I can identify bottlenecks, optimize role configurations, and improve team efficiency.

**Acceptance Criteria:**

**Given** the conversation metrics from Story 14.2
**When** the user views the organization analytics
**Then** the following insights are computed and displayed:
  - **Most asked role**: which role receives the most questions
  - **Slowest responder**: which role has the highest avg response time
  - **Escalation hotspots**: which role→role pairs escalate most frequently
  - **Human intervention frequency**: how often humans need to step in
  - **Conversation depth distribution**: histogram of conversation depths (1-hop, 2-hop, etc.)
**And** analytics cover a configurable time range (last 7 days, 30 days, all time)
**And** data is computed from existing tables via SQL queries (no pre-aggregation table)
**And** the UI presents insights as simple data cards with numbers and optional mini-charts
**And** events are grouped by Epic scope
**And** a single aggregated notification is produced instead of multiple individual ones
**And** state transitions within the window are summarized (e.g., "3 tasks completed, 1 review pending")
**And** IPC-level digestion coalesces rapid `domain-changed` events before triggering Zustand updates in Renderer
**And** throttling prevents notification storms during high-throughput execution

### Story 7.5: Implement End-to-End Workflow Integration Test

As a developer,
I want to verify the complete automation loop works from epic creation to task completion,
So that the wake-up cycle, consensus detection, and orchestration work together correctly.

**Acceptance Criteria:**

**Given** all Epic 1-7 services are wired together
**When** an integration test creates an epic, assigns it to a role, and simulates execution
**Then** the orchestrator correctly wakes the assigned role
**And** after simulated task completion, the parent role is awakened for review
**And** after simulated APPROVE vote, consensus detection marks the task as approved
**And** after all sibling tasks complete, the parent is awakened for summarization
**And** pending wakes are correctly queued and consumed
**And** the self-wake circuit breaker triggers after MAX_CONSECUTIVE_WAKES
**And** the test uses mocked executors (no actual CLI calls)

---

## Epic 8: Human Intervention & Approval

Humans can participate in AI discussion groups with equal authority, receive desktop notifications for approval requests, and make decisions through a rich approval panel at per-role configurable control points.

### Story 8.1: Implement Per-Role Human Approval Configuration

As a user,
I want to configure which roles require human approval before their work products are accepted,
So that I maintain control at the organizational nodes I choose.

**Acceptance Criteria:**

**Given** the role configuration from Epic 2
**When** the user toggles `requiresHumanApproval` on a role
**Then** the setting is persisted in the role record
**And** when the consensus detection in a discussion group reaches all AI APPROVE votes, if the reviewer role has `requiresHumanApproval=true`, the task stays in `awaiting_review` and a human approval is requested instead of auto-approving
**And** quick presets are available in the organization settings: "All Auto" (all false), "Top-Level Human Only" (only root role true), "Custom" (individual toggle)
**And** the per-role setting replaces any global semi-auto/full-auto mode switch

### Story 8.2: Implement Human Approval Panel UI

As a human user,
I want to see a rich approval panel with narrative summary, task context, and action buttons when approval is needed,
So that I can make informed decisions quickly.

**Acceptance Criteria:**

**Given** the per-role config from Story 8.1 and discussion panel from Epic 5
**When** a task reaches human approval
**Then** an approval panel card appears directly above the latest discussion message
**And** the panel displays: narrative approval summary (concise, decision-focused), task tree overview for the epic, discussion key decisions summary (vote statistics + key REVISE/CONCERN issues), links to deliverable artifacts
**And** three action buttons: [APPROVE], [REVISE] (activates inline feedback text input), [DELEGATE] (opens role selector)
**And** the user's action is injected as a discussion message with `authorType='human'` and the appropriate `voteTag`
**And** human votes have equal authority to AI votes in consensus detection

### Story 8.3: Implement Desktop Notifications for Approvals

As a human user,
I want to receive system-level desktop notifications when my approval is needed,
So that I don't miss time-sensitive intervention points.

**Acceptance Criteria:**

**Given** the human approval mechanism from Stories 8.1-8.2
**When** a task reaches a role with `requiresHumanApproval=true`
**Then** an Electron native desktop notification is shown with: task title, role requiring approval, a brief summary line — all text localized per the user's language preference
**And** clicking the notification brings the Capibara window to focus and navigates to the relevant discussion group's approval panel
**And** the corresponding epic in the Tasks & Epics page shows a notification badge (red dot)
**And** notifications also fire for: escalation reaching top-level role, budget threshold warnings

### Story 8.4: Implement Human Direct Participation in Discussions

As a human user,
I want to send messages and cast votes in any discussion group with equal authority to AI roles,
So that I can intervene or contribute to any collaboration process.

**Acceptance Criteria:**

**Given** the discussion panel from Epic 5
**When** the human user interacts with a discussion group
**Then** a message input field is available at the bottom of the discussion panel
**And** the user can type free-form messages (`voteTag=null`, `authorType='human'`)
**And** the user can cast structured votes via buttons: APPROVE, REVISE (with feedback), CONCERN, DELEGATE
**And** human messages trigger the same consensus detection logic as AI messages
**And** human votes are visually distinguished in the discussion panel (different avatar/badge for human vs AI)

### Story 8.5: Implement Mandatory Top-Level Human Notification

As the system,
I want to force-notify the human user when escalation reaches the top-level role and still fails,
So that no critical failure goes unnoticed regardless of `requiresHumanApproval` settings.

**Acceptance Criteria:**

**Given** the escalation chain from orchestration (Epic 7)
**When** an escalation reaches a role with `parentId=null` (top-level) and the issue remains unresolved
**Then** the system sends a mandatory human notification regardless of the role's `requiresHumanApproval` setting
**And** the notification is high-priority (persistent, not dismissible until acknowledged)
**And** the notification includes: full escalation chain path, original failure reason, all retry/escalation attempts
**And** this acts as the ultimate safety valve for the autonomous system

---

## Epic 9: Narrative Engine & Dashboard

Users see human-readable narrative project status on a rich dashboard with cost tracking, activity timeline, and full observability.

### Story 9.1: Implement Narrative Engine Three-Layer Architecture

As a developer,
I want to build the narrative engine that generates human-readable status from data, templates, and LLM polish,
So that project status is presented as a story rather than dry data tables.

**Acceptance Criteria:**

**Given** the task, discussion, run, and cost data from previous epics
**When** a narrative is generated
**Then** Layer 1 (Data Query): deterministic DB queries extract task states, discussion summaries, role activities, budget usage, blocked items
**And** Layer 2 (Template): Markdown templates with placeholders are populated with structured data (e.g., `{completed_count}` tasks done, `{budget_used}/{budget_limit}` spent)
**And** Layer 3 (LLM Polish): a single LLM call converts the structured template into natural language narrative prose in the user's preferred language (read from Settings `locale` key)
**And** `narratives` table stores: id, org_id, template_data (JSON raw data), rendered_text (final narrative), generated_at
**And** facts come from DB queries (no hallucination risk); LLM only responsible for natural language styling
**And** narrative generation is idempotent given the same input data

### Story 9.2: Implement Dashboard Narrative Display

As a user,
I want to see a narrative project progress story on my dashboard when I open Capibara,
So that I can understand the project state in 30 seconds like reading a morning report.

**Acceptance Criteria:**

**Given** the narrative engine from Story 9.1
**When** the user navigates to the Dashboard page
**Then** the dashboard displays a formatted narrative "Project Progress Story" as the primary content
**And** the narrative includes: overall health summary, active work in progress, recent completions, blocked items requiring attention, budget consumption
**And** highlighted hyperlinks within the narrative text navigate to corresponding areas (task tree, discussion groups)
**And** the narrative auto-refreshes when significant state changes occur (via IPC subscription)
**And** the visual design is clean and readable with generous whitespace (not a dense data table)

### Story 9.3: Implement Approval Summary Narrative Template

As a human user,
I want to see a specialized concise narrative summary in the approval panel,
So that I can quickly grasp the context needed to make an APPROVE/REVISE/DELEGATE decision.

**Acceptance Criteria:**

**Given** the narrative engine from Story 9.1
**When** a task reaches human approval
**Then** a specialized "Approval Summary" narrative template is used
**And** the summary includes: what was requested (task description), what was done (execution summary from completed child tasks), key decisions made (discussion vote highlights), remaining concerns (any CONCERN votes), recommended action
**And** the summary is concise (target: readable in under 1 minute)
**And** the summary is injected into the approval panel UI from Epic 8

### Story 9.4: Implement Cost Tracking Dashboard

As a user,
I want to see real-time cost tracking with per-role and global budget visualization,
So that I can monitor spending and avoid budget overruns.

**Acceptance Criteria:**

**Given** the cost entries from Epic 6
**When** the user views the dashboard
**Then** a global budget progress bar shows: current spend vs. budget limit
**And** a per-role cost breakdown is available (expandable section or dedicated tab)
**And** budget threshold warnings are visually highlighted (yellow at 80%, red at 95%)
**And** cost data updates in real-time via IPC subscription
**And** historical cost trends are shown (per-run cost entries over time)

### Story 9.5: Implement Activity Timeline and Observability

As a user,
I want to see an activity timeline of recent events, state changes, and run logs,
So that I can trace what happened and debug issues.

**Acceptance Criteria:**

**Given** the EventBus events and run logs from previous epics
**When** the user views the dashboard activity section
**Then** a chronological timeline shows recent events: task status changes, run completions/failures, consensus decisions, escalations
**And** each event entry shows: timestamp, event type icon, description, affected role/task
**And** clicking an event navigates to the relevant context (task detail, discussion group, run log)
**And** execution logs are queryable by task or role via a search/filter interface
**And** the timeline supports pagination for large event histories

---

## Epic 10: Resilience & Safety

The system handles failures gracefully with configurable retry logic, escalation chains, global budget protection, and circuit breakers.

### Story 10.1: Implement Failure Retry Logic

As the system,
I want to automatically retry failed runs with configurable limits,
So that transient failures don't require manual intervention.

**Acceptance Criteria:**

**Given** a Run that transitions to `failed` status
**When** the failure handler processes the event
**Then** if retry count < `maxRetryOnFailure` (default 3 from config), a new Run is created for the same task/role with retry trigger
**And** retry count is tracked per task (not per run)
**And** a backoff interval is applied between retries (configurable, e.g., exponential backoff)
**And** each retry is logged as a separate Run record for full traceability
**And** if retry succeeds, the task continues normal flow

### Story 10.2: Implement Escalation Chain

As the system,
I want to escalate to parent roles when retry limits are exhausted,
So that failures are handled at progressively higher levels of the organization.

**Acceptance Criteria:**

**Given** a task that has exhausted all retry attempts
**When** the escalation handler is triggered
**Then** the parent role in the org tree is awakened with an `retry_failed` trigger
**And** the parent role receives context: original task details, failure reasons from all retry attempts, child role info
**And** the parent role can: attempt to fix the issue, reassign to a different subordinate, or escalate further
**And** if the parent also fails and exhausts retries, escalation continues up the org tree
**And** escalation path is logged for observability

### Story 10.3: Implement Global Budget Protection

As the system,
I want to pause all roles when the project budget limit is exceeded,
So that runaway costs are prevented.

**Acceptance Criteria:**

**Given** the cost tracking from Epic 6/9
**When** cumulative cost_usd across all runs exceeds the organization's `budgetLimit`
**Then** all roles in the organization are paused (status → `paused`)
**And** all queued and pending wakes are suspended (not deleted)
**And** any active Run is allowed to complete but no new Runs are created
**And** a mandatory human notification is sent regardless of any role's `requiresHumanApproval`
**And** the notification includes: total spend, budget limit, list of active/pending work
**And** the user can increase the budget and resume operations via the UI
**And** budget check is a gate check in the wake-up flow (Story 7.2)

### Story 10.4: Implement REVISE Cycle Circuit Breaker

As the system,
I want to escalate when the same task is revised more than the configured limit,
So that infinite REVISE loops between roles are prevented.

**Acceptance Criteria:**

**Given** the REVISE processing in consensus detection (Epic 5)
**When** a task's REVISE count exceeds `maxReviseAttempts` (default 3)
**Then** instead of sending the task back for another revision, it is escalated to the parent role
**And** the parent role receives: task details, all REVISE feedback from previous cycles, revision count
**And** the circuit breaker event is logged and visible in the activity timeline
**And** the REVISE counter resets if the parent role re-structures or reassigns the task

### Story 10.5: Implement Self-Wake Circuit Breaker

As the system,
I want to prevent infinite wake loops by limiting consecutive self-wakes per role,
So that runaway orchestration loops don't consume unbounded resources.

**Acceptance Criteria:**

**Given** the wake-up loop from Epic 7
**When** a role's consecutive self-wake count reaches `MAX_CONSECUTIVE_WAKES` (default 5)
**Then** the role is NOT awakened further; instead, the issue is escalated to the parent role
**And** the self-wake counter tracks consecutive wakes without intervening idle periods
**And** the counter resets when a different trigger type wakes the role or after a cooldown period
**And** the circuit breaker event is logged and emitted as `circuit-breaker:self-wake` on EventBus
**And** if escalation also hits the circuit breaker at the top level, mandatory human notification
