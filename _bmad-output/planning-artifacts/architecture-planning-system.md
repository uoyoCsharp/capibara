---
version: '1.0'
project_name: 'capibara'
feature_name: 'Planning System Architecture'
user_name: 'uoyo'
date: '2026-04-13'
status: 'draft'
inputDocuments:
  - '_bmad-output/planning-artifacts/prd-conversational-task-planning.md'
  - '_bmad-output/planning-artifacts/architecture.md'
  - '_bmad-output/planning-artifacts/epics-conversational-task-planning.md'
---

# Planning System Architecture

> Architectural decisions for the Conversational Task Planning subsystem of Capibara.
> Addresses the separation of planning sessions from workflow tasks, planning role management, and role switching.

---

## Table of Contents

1. [Problem Statement](#1-problem-statement)
2. [ADR Record](#2-adr-record)
3. [Planning Task Type](#3-planning-task-type)
4. [Planning Role Model](#4-planning-role-model)
5. [Template Planning Role Configuration](#5-template-planning-role-configuration)
6. [Planning Role Switching](#6-planning-role-switching)
7. [Data Model Changes](#7-data-model-changes)
8. [Lifecycle Flow](#8-lifecycle-flow)
9. [UI Impact](#9-ui-impact)
10. [Implementation Phasing](#10-implementation-phasing)

---

## 1. Problem Statement

### 1.1 Current Behavior

When a user initiates a planning session, `PlanningService.startPlanningRun()` creates a task using the workflow schema's first root-allowed type (typically `epic`). This task serves as a container for the AI planning conversation.

**User-visible problem**: The user sees an `epic` appear in the Task Tree immediately after submitting their idea, creating the impression that the system has already created a deliverable epic rather than entering a multi-round conversation to help them plan.

### 1.2 Additional Gaps

| Gap | Description |
|-----|-------------|
| **Role selection is heuristic** | `selectPlanningRole()` scans role skills for PM-related commands. Fragile and non-deterministic. |
| **No user agency in role choice** | Users cannot choose which AI persona guides their planning session. |
| **No system fallback role** | If no PM role is found, fallback to root role provides suboptimal planning quality. |
| **Planning tasks pollute Task Tree** | The temporary planning container task is indistinguishable from real work items. |

---

## 2. ADR Record

### ADR-PLAN-01: Dedicated `plan` Task Type

**Status**: Proposed

**Context**: Planning sessions need a task entity for the ExecutionEngine to operate on (runs require a taskNodeId). Using a workflow schema type (e.g., `epic`) conflates planning containers with deliverable work items.

**Decision**: Introduce a system-reserved task type `plan`. This type is:
- NOT defined in the user's WorkflowSchema
- Accepted by `TaskService.create()` via a special bypass for system types
- Filtered out of the Task Tree UI
- Used exclusively as the container for planning conversation sessions

**Consequences**:
- `TaskService.create()` needs a system-type allowlist that bypasses schema validation
- `TaskTreeView` filters tasks where `type === 'plan'`
- `WorkflowEngine.isTerminalStatus()` needs a fallback for `plan` type tasks (not in schema)
- Planning tasks use hardcoded statuses: `in_progress` and `done` (no schema-driven transitions)

**Alternatives considered**:
- *Add `plan` to WorkflowSchema*: Rejected. Pollutes user-editable schema. Users could accidentally delete or modify it.
- *Separate PlanningSession entity*: Rejected. Requires new repository, table, and extensive ExecutionEngine changes. Disproportionate effort for the isolation gained.

---

### ADR-PLAN-02: Dual Planning Role Model

**Status**: Proposed

**Context**: Users need flexibility in choosing who guides their planning session. Some prefer a generic assistant; others want a domain-specific persona (e.g., BMAD Product Manager). The system must work even when no template-specific planning role exists.

**Decision**: Support exactly two planning role sources:

1. **System Planning Role** — Auto-injected into every organization at creation time. Provides generic planning capabilities without domain-specific methodology. Marked with `isSystemRole: true` to distinguish from user-created roles.

2. **Template Planning Role** — Optionally defined in organization templates via a `planningRole` configuration block. Provides methodology-specific planning (e.g., BMAD-driven PM persona). Created as a regular role during template loading, linked to the org.

Users can choose between these two roles when starting a planning session, and switch between them mid-conversation (when the AI is waiting for a reply).

**Consequences**:
- `Role` entity gains an `isSystemRole: boolean` field (default: `false`)
- Organization creation logic injects the system planning role
- Template schema gains an optional `planningRole` configuration
- Team page UI filters out `isSystemRole === true` roles
- Planning Chat UI shows a role selector when both roles are available

**Alternatives considered**:
- *Virtual role (not persisted)*: Rejected. ExecutionEngine requires a real roleId for runs. Would need special-casing throughout the run lifecycle.
- *Allow switching between any org role*: Rejected. Overly complex. Planning is a specific interaction mode, not general role delegation.

---

### ADR-PLAN-03: Mid-Conversation Role Switching

**Status**: Proposed

**Context**: Users may realize during a planning conversation that the other planning role would be more helpful (e.g., switching from generic assistant to BMAD PM for methodology-driven structure).

**Decision**: Allow role switching only when the conversation workflow is in `waiting_for_reply` state (AI is not running). Switching:
1. Updates the `plan` task's `assigneeRoleId` to the new role
2. Does NOT create a new discussion group — conversation history is preserved
3. The user's next message triggers a wake for the new role
4. The new role receives full conversation context via the existing `conversationContext` mechanism
5. A system message is inserted into the discussion: "Switched planning role to {roleName}"

**Consequences**:
- New IPC channel: `switchPlanningRole({ taskId, newRoleId })`
- `PlanningService` gains a `switchRole()` method
- Frontend disables the role selector while AI is thinking
- No run termination or context rebuild needed — the conversation workflow naturally handles the role change

---

## 3. Planning Task Type

### 3.1 System Type Constant

```typescript
// src/main/core/constants/planning.constants.ts
export const PLANNING_TASK_TYPE = 'plan';
export const SYSTEM_TASK_TYPES = new Set([PLANNING_TASK_TYPE]);
```

### 3.2 TaskService Bypass

In `TaskService.create()`, before schema validation:

```typescript
if (SYSTEM_TASK_TYPES.has(input.type)) {
  // Skip WorkflowEngine type validation for system-reserved types
} else {
  // Existing schema validation
}
```

### 3.3 Status Management

Planning tasks do not participate in the workflow schema's status machine. They use two hardcoded statuses:
- `in_progress` — planning session active
- `done` — planning session completed or discarded

`TaskStateMachine.transition()` should bypass schema validation for `plan` type tasks, allowing direct `in_progress` -> `done` transition.

---

## 4. Planning Role Model

### 4.1 System Planning Role

Auto-injected into every organization at creation time.

```typescript
{
  name: 'Plan Assistant',
  persona: `You are a Planning Assistant. You help users explore ideas,
    define project scope, and create structured task plans.
    You are methodical, flexible, and adapt your approach to the user's
    level of clarity. You ask clarifying questions before jumping to conclusions.`,
  skillIds: [],              // No BMAD skills — generic planning
  knowledgeBaseRefs: [],
  canApprove: false,
  canDelegate: false,
  requiresHumanApproval: false,
  isSystemRole: true,        // Hidden from Team page
  parentId: null,            // Root level (no reporting line)
  status: 'active',
}
```

Key characteristics:
- No methodology-specific prompts (no BMAD, no SCAMPER references)
- Phase-aware planning instructions come from `PromptBuilder.instructPlanning()` which applies to ALL planning roles
- Generic persona that works for any domain
- Always available, even in blank organizations without templates

### 4.2 Template Planning Role

Defined in the template's `planningRole` block and created as a regular org role during template loading. Has domain-specific persona and skills.

Example for BMAD template: Uses the Product Manager role with BMAD methodology skills (`/bmad-create-prd`, `/bmad-product-brief`).

The template planning role is a **regular role** (`isSystemRole: false`) with no special flags. It is distinguished solely by the template configuration pointing to it.

### 4.3 Role Resolution at Planning Time

```typescript
// PlanningService
async getAvailablePlanningRoles(orgId: string): Promise<PlanningRoleOption[]> {
  const roles = await this.roleRepo.findByOrgId(orgId);
  const options: PlanningRoleOption[] = [];

  // 1. System planning role (always present)
  const systemRole = roles.find(r => r.isSystemRole && r.name === 'Plan Assistant');
  if (systemRole) {
    options.push({ roleId: systemRole.id, roleName: systemRole.name, source: 'system' });
  }

  // 2. Template planning role (if configured)
  const org = await this.orgRepo.findById(orgId);
  if (org?.planningRoleId) {
    const templateRole = roles.find(r => r.id === org.planningRoleId);
    if (templateRole && templateRole.status === 'active') {
      options.push({ roleId: templateRole.id, roleName: templateRole.name, source: 'template' });
    }
  }

  return options;
}
```

---

## 5. Template Planning Role Configuration

### 5.1 Template Schema Extension

```json
{
  "id": "bmad-software-team",
  "name": "BMAD Software Team",
  "description": "...",
  "planningRole": {
    "roleRef": "Product Manager"
  },
  "rootRoles": [...]
}
```

- `planningRole` is optional. If absent, only the system planning role is available.
- `roleRef` is a string matching one of the role names defined in `rootRoles` (or nested children). The template loader resolves this to the created role's ID after template instantiation.

### 5.2 Organization Model Extension

```typescript
// Organization entity gains:
interface Organization {
  // ...existing fields
  planningRoleId: string | null;  // Resolved from template, or null
}
```

Set during template loading:
1. Template loader creates all roles from `rootRoles`
2. If `planningRole.roleRef` is present, find the created role matching that name
3. Set `organization.planningRoleId = matchedRole.id`

---

## 6. Planning Role Switching

### 6.1 Preconditions

Role switching is allowed only when:
- A planning session is active (`plan` task in `in_progress`)
- The conversation workflow is in `waiting_for_reply` state
- The target role is one of the available planning roles (system or template)

### 6.2 Switch Operation

```
User clicks role selector → switchPlanningRole IPC
  → Validate preconditions
  → Update plan task: assigneeRoleId = newRoleId
  → Insert system message into discussion group: "Switched to {roleName}"
  → Return success
  → User sends next message → wake triggers for newRoleId
  → New role resumes with full conversation context
```

### 6.3 IPC Contract

```typescript
// New IPC channel
switchPlanningRole: 'capibara:planning:switch-role'

// Schema
const switchPlanningRoleSchema = z.object({
  taskId: z.string().min(1),
  newRoleId: z.string().min(1),
});

// Response
DesktopResult<{ previousRoleId: string; newRoleId: string }>
```

### 6.4 Conversation Context Continuity

No special handling needed. The existing `ConversationWorkflow` and `conversationContext` mechanisms already support:
- Discussion group messages are role-agnostic (any role can read them)
- `conversationContext` is built from the discussion group, not from the role
- The new role's prompt includes its own persona + the shared conversation context

The only difference is the new role's persona/skills in the prompt. The conversation history flows through naturally.

---

## 7. Data Model Changes

### 7.1 Role Entity

```sql
ALTER TABLE roles ADD COLUMN is_system_role INTEGER NOT NULL DEFAULT 0;
```

```typescript
interface Role {
  // ...existing 13 fields
  isSystemRole: boolean;  // NEW: true for system-injected roles
}
```

### 7.2 Organization Entity

```sql
ALTER TABLE organizations ADD COLUMN planning_role_id TEXT DEFAULT NULL;
```

```typescript
interface Organization {
  // ...existing fields
  planningRoleId: string | null;  // NEW: template-configured planning role
}
```

### 7.3 Template Schema

```typescript
interface OrgTemplate {
  // ...existing fields
  planningRole?: {
    roleRef: string;  // Name of a role defined in rootRoles tree
  };
}
```

### 7.4 Contracts (Renderer Types)

```typescript
interface RoleRecord {
  // ...existing fields
  isSystemRole: boolean;
}

interface PlanningRoleOption {
  roleId: string;
  roleName: string;
  source: 'system' | 'template';
}

// New IPC methods on CapibaraApi
getAvailablePlanningRoles: (orgId: string) => Promise<DesktopResult<PlanningRoleOption[]>>;
switchPlanningRole: (input: SwitchPlanningRoleInput) => Promise<DesktopResult<{ previousRoleId: string; newRoleId: string }>>;

// Updated
startPlanningRun: (input: { orgId: string; initialMessage: string; roleId: string }) => Promise<...>;
// roleId is now explicit (user-selected), not auto-detected
```

---

## 8. Lifecycle Flow

### 8.1 Complete Planning Flow (Revised)

```
1. User clicks "Start New Project"
         │
2. UI calls getAvailablePlanningRoles(orgId)
         │
         ▼
   ┌─────────────────────────────────┐
   │  Role selector (if 2 options):  │
   │  [Plan Assistant]               │  ← system, always available
   │  [Product Manager]              │  ← template, if configured
   └────────────────┬────────────────┘
                    │
3. User types idea + selects role + sends
         │
         ▼
   startPlanningRun({ orgId, initialMessage, roleId })
         │
   ┌─────┴──────────────────────────────────────┐
   │  TaskService.create({                       │
   │    type: 'plan',           ← system type    │
   │    title: 'Planning: ...',                  │
   │    assigneeRoleId: selectedRoleId,          │
   │  })                                         │
   └─────┬──────────────────────────────────────┘
         │
         ▼
   ExecutionEngine.startRun() → AI conversation begins
         │
         ▼
   Phase A (Diverge) ←→ Phase B (Focus) ←→ Phase C (Structure)
         │                                       │
         │  [User can switch role at any          │
         │   waiting_for_reply point]             │
         │                                       │
         ▼                                       ▼
   AI calls capibara_plan_tasks → PendingPlanStore
         │
         ▼
   PlanPreview UI → User confirms
         │
         ▼
   batchCreateTasks() → Creates real epics/stories/tasks
         │
         ▼
   Plan task → status: 'done' (hidden from Task Tree)
   Real tasks → behavior rules fire → auto-execution begins
```

### 8.2 Role Switch Sub-Flow

```
   AI asks question → waiting_for_reply
         │
   User clicks role selector → picks "Product Manager"
         │
         ▼
   switchPlanningRole({ taskId, newRoleId })
         │
   ┌─────┴──────────────────────────────────────┐
   │  1. Validate: workflow in waiting_for_reply │
   │  2. Update task.assigneeRoleId              │
   │  3. Post system message to discussion       │
   │  4. Return success                          │
   └─────┬──────────────────────────────────────┘
         │
   User types reply → replyToConversation()
         │
         ▼
   Wake triggers for NEW role → new run starts
   New role receives full conversation history + its own persona
```

---

## 9. UI Impact

### 9.1 Planning Chat Page Changes

| Component | Change |
|-----------|--------|
| **Role Selector** | New dropdown above chat input, shows available planning roles. Disabled while AI is thinking. |
| **System Message** | When role is switched, display a centered system message: "Switched to {roleName}" |
| **Role Avatar** | Chat bubble avatar and name update to reflect the current planning role |

### 9.2 Task Tree Filtering

```typescript
// TaskTreeView: filter out plan-type tasks
const visibleTasks = tasks.filter(t => t.type !== 'plan');
```

### 9.3 Team Page Filtering

```typescript
// TeamPage: filter out system roles
const visibleRoles = roles.filter(r => !r.isSystemRole);
```

---

## 10. Implementation Phasing

### Phase 1: Core Isolation (Required)

- [ ] Define `PLANNING_TASK_TYPE = 'plan'` constant
- [ ] `TaskService.create()` bypass schema validation for system types
- [ ] `startPlanningRun()` uses `'plan'` type instead of root workflow type
- [ ] `TaskTreeView` filters out `type === 'plan'` tasks
- [ ] `TaskStateMachine` bypass for plan-type transitions

### Phase 2: Dual Role Model (Required)

- [ ] Add `isSystemRole` column to roles table (migration)
- [ ] Add `planningRoleId` column to organizations table (migration)
- [ ] Auto-inject system planning role on org creation
- [ ] Template schema: add optional `planningRole` config
- [ ] Template loader: resolve `roleRef` and set `org.planningRoleId`
- [ ] New IPC: `getAvailablePlanningRoles`
- [ ] Update `startPlanningRun` to accept explicit `roleId`
- [ ] Team page: filter `isSystemRole` roles

### Phase 3: Role Switching (Required)

- [ ] New IPC: `switchPlanningRole`
- [ ] `PlanningService.switchRole()` method
- [ ] Planning Chat: role selector dropdown
- [ ] Planning Chat: system message on switch
- [ ] Disable selector while AI is thinking

### Phase 4: Polish (Optional)

- [ ] Persist user's last-used planning role preference per org
- [ ] Show role description tooltip in selector
- [ ] Allow users to customize system planning role persona in workspace settings
