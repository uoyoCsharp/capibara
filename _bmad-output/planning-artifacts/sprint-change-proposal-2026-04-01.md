# Sprint Change Proposal — 2026-04-01

**Project:** Capibara — AI Organization Orchestration Platform
**Proposed by:** uoyo
**Date:** 2026-04-01
**Status:** Approved

---

## 1. Issue Summary

Two new requirements were identified after development completion:

1. **Organization Workspace Binding:** Each organization must specify a workspace directory path at creation time. All task artifacts, CLI executions, and file operations are scoped to this directory. Currently, the system uses a global `cli.projectDir` config, which does not support per-organization isolation.

2. **Organization Deletion with Safety Confirmation:** Users need the ability to delete organizations they no longer need. To prevent accidental data loss, deletion requires the user to manually type the exact organization name as confirmation. This is a basic CRUD operation that was missing from the original requirements.

**Discovery context:** Post-development requirement supplement — identified during workflow review.

---

## 2. Impact Analysis

### 2.1 Epic Impact

| Epic | Impact Level | Description |
|------|-------------|-------------|
| Epic 1 | Low | `organizations` table schema needs `workspace_path` column |
| Epic 2 | Medium | New Story 2.7 (deletion), modify Story 2.1 (cascade delete), modify Story 2.6 (folder picker) |
| Epic 6 | Low | Stories 6.3/6.4 use org workspace_path instead of global projectDir |
| Epic 3-5, 7-10 | None | No impact |

### 2.2 Artifact Impact

| Artifact | Sections Affected | Change Type |
|----------|-------------------|-------------|
| PRD | FR-01, Section 7 (Data Model) | Add workspace_path field + deletion requirement |
| Architecture | Section 5.2 (Data Model), 7.2 (MCP Bridge), 7.5 (Executor), 13.2 (Config) | Add column, update execution context, remove global projectDir |
| UX Design | Organization Setup Journey | Add folder picker step + deletion confirmation dialog |
| Epics | Epic 1 (1.3), Epic 2 (2.1, 2.6, new 2.7), Epic 6 (6.3, 6.4) | Schema + logic + UI changes |

### 2.3 Technical Impact

- Database migration: Add `workspace_path TEXT NOT NULL` to `organizations` table
- Foreign key cascade: Ensure all org-dependent tables cascade on delete (or use explicit transactional cleanup)
- IPC: New channel `capibara:org:delete` with Zod payload validation
- Config: Remove `cli.projectDir` global config, replaced by per-org `workspace_path`
- Electron API: Use `dialog.showOpenDialog` with `properties: ['openDirectory']` for folder picker

---

## 3. Recommended Approach

**Selected path:** Direct Adjustment — modify existing stories and add one new story within Epic 2.

**Rationale:**
- Changes are localized and well-scoped (3 epics, ~6 stories affected)
- No architectural pattern changes — same layered architecture, same DI, same IPC patterns
- No epic reordering or scope reduction needed
- Low effort, low risk
- All changes follow existing conventions and patterns

**Effort estimate:** Low
**Risk level:** Low
**Timeline impact:** Minimal — no structural changes to project plan

---

## 4. Detailed Change Proposals

### 4.1 PRD Changes

#### Change P1: FR-01 Organization Modeling

**Section:** FR-01

**OLD:**
```
- Role Tree: Unlimited nesting depth via parentId recursion
```

**NEW:**
```
- Role Tree: Unlimited nesting depth via parentId recursion
- Workspace Binding: Each organization must specify a workspace directory path at creation time. All task artifacts, CLI executions, and file operations are scoped to this directory.
- Organization Deletion: Users can delete an organization. Deletion requires manual confirmation by typing the exact organization name to prevent accidental data loss. Deletion cascades to all associated roles, tasks, discussions, runs, and cost entries.
```

#### Change P2: Section 7 Data Model

**OLD:**
```
| Organization | Project root | id, name, description, status, budgetLimit, orgTemplateId |
```

**NEW:**
```
| Organization | Project root | id, name, description, status, budgetLimit, orgTemplateId, workspacePath |
```

---

### 4.2 Architecture Changes

#### Change A1: Section 5.2 Data Model

**OLD:**
```
| Organization | organizations | Project root | id, name, description, status, budget_limit, org_template_id |
```

**NEW:**
```
| Organization | organizations | Project root | id, name, description, status, budget_limit, org_template_id, workspace_path |
```

- `workspace_path` is `TEXT NOT NULL`
- Must be a valid, writable directory path

#### Change A2: Section 13.2 Configuration

**OLD:**
```yaml
cli:
  defaultExecutor: claude-cli
  projectDir: ./
```

**NEW:**
```yaml
cli:
  defaultExecutor: claude-cli
  # projectDir removed — workspace path is now per-organization, stored in organizations.workspace_path
```

#### Change A3: Section 7.2 MCP Server Bridge

**Addition:**
```
McpConfigGenerator resolves workspace_path from the Run's associated organization (via orgId).
The MCP config and CLI execution use the organization's workspace_path as the working directory.
```

#### Change A4: Section 7.5 UtilityProcess Executor

**Addition:**
```
The CLI process working directory (cwd) is set to the organization's workspace_path.
```

---

### 4.3 UX Design Changes

#### Change U1: Organization Setup Journey

**OLD:**
```
Enter [Organization Panel] -> Load preset templates -> Interface visualizes the hierarchical structure map -> ...
```

**NEW:**
```
Enter [Organization Panel] -> Load preset templates -> Select workspace folder via native OS folder picker -> Interface visualizes the hierarchical structure map -> ...
```

#### Change U2: Organization Deletion UX

**Addition:**
```
- Organization context menu or settings includes a "Delete Organization" action
- Clicking "Delete" opens a confirmation dialog with:
  - Warning text explaining all data will be permanently deleted
  - Text input field requiring the exact organization name (case-sensitive)
  - Delete button is disabled until the typed name matches exactly
  - Cancel button to abort
- After successful deletion, user is redirected to the organization list or creation page
- Success notification confirms the deletion
```

---

### 4.4 Epic & Story Changes

#### Change E1: Epic 1, Story 1.3 — SQLite Database

**OLD acceptance criteria:**
```
And the organizations table is created as the first migration (id, name, description, status, budget_limit, org_template_id, created_at, updated_at)
```

**NEW:**
```
And the organizations table is created as the first migration (id, name, description, status, budget_limit, org_template_id, workspace_path, created_at, updated_at)
And workspace_path is TEXT NOT NULL and must be a valid directory path
```

#### Change E2: Epic 2, Story 2.1 — Organization Repository

**Addition to acceptance criteria:**
```
And IOrganizationRepository includes a delete(id) method that cascades to all associated data (roles, tasks, discussion_groups, discussion_messages, runs, cost_entries, pending_wakes, narratives)
And cascade deletion uses SQLite foreign key ON DELETE CASCADE or explicit transaction-based cleanup
And deletion is atomic — performed within a single database transaction
```

#### Change E3: Epic 2, Story 2.6 — Organization Template Selector UI

**OLD acceptance criteria:**
```
And selecting a template instantly creates the organization with all pre-filled roles
And an option to start with a blank organization (no template) is available
And after template selection, the user lands on the Organization page with the populated tree
```

**NEW:**
```
And before or after template selection, the user must specify a workspace directory path via a folder picker dialog (Electron's dialog.showOpenDialog with properties: ['openDirectory'])
And the workspace path is validated: must be an existing directory, must be writable
And selecting a template creates the organization with the specified workspace_path and all pre-filled roles
And an option to start with a blank organization (no template) is available
And after template selection and workspace configuration, the user lands on the Organization page with the populated tree
```

#### Change E4: Epic 2 — New Story 2.7

```
### Story 2.7: Implement Organization Deletion with Safety Confirmation

As a user,
I want to delete an organization I no longer need, with a safety confirmation requiring me to type the organization name,
So that I am protected from accidental deletion of important data.

**Acceptance Criteria:**

**Given** an existing organization
**When** the user initiates a delete action from the organization settings or context menu
**Then** a confirmation dialog appears requiring the user to type the exact organization name
**And** the delete button is disabled until the typed name matches exactly (case-sensitive)
**And** upon confirmation, the organization and ALL associated data are deleted:
  roles, tasks, discussion groups, discussion messages, runs, cost entries, pending wakes, narratives
**And** the deletion is performed within a single database transaction for atomicity
**And** after deletion, the user is redirected to the organization list or creation page
**And** a success notification confirms the deletion
**And** the IPC channel capibara:org:delete is defined in shared/contracts.ts with Zod-validated payload
**And** the Zod schema validates: { orgId: string, confirmName: string }
**And** the IPC handler verifies confirmName matches the actual organization name before proceeding
```

#### Change E5: Epic 6, Story 6.3 — MCP Server Bridge

**Addition to acceptance criteria:**
```
And McpConfigGenerator resolves workspace_path from the Run's associated organization via orgId
And the MCP config specifies the organization's workspace_path as the working directory for CLI execution
```

#### Change E6: Epic 6, Story 6.4 — UtilityProcess Executor

**Addition to acceptance criteria:**
```
And the CLI process working directory (cwd) is set to the organization's workspace_path
And workspace_path is resolved from the Run's associated organization
```

---

## 5. Implementation Handoff

### 5.1 Change Scope Classification

**Minor** — Direct implementation by development team. No backlog reorganization or architectural replan needed.

### 5.2 Handoff Plan

| Recipient | Responsibility |
|-----------|---------------|
| Developer | Implement all story changes (schema, repository, UI, IPC, executor) |
| Developer | Update existing tests to account for workspace_path field |
| Developer | Add tests for deletion cascade and name confirmation validation |

### 5.3 Implementation Order

1. Schema migration: Add `workspace_path` to `organizations` table
2. Repository: Add delete method with cascade, update create to accept workspace_path
3. IPC: Add `capibara:org:delete` channel and Zod schemas
4. UI: Add folder picker to org creation flow
5. UI: Add deletion confirmation dialog
6. Executor: Update MCP config and UtilityProcess to use org workspace_path
7. Config: Remove global `cli.projectDir`

### 5.4 Success Criteria

- Organization creation requires and persists a workspace_path
- All CLI executions use the organization's workspace_path as cwd
- Organization deletion removes all associated data atomically
- Deletion is blocked until user types exact organization name
- Existing tests pass with updated schema
