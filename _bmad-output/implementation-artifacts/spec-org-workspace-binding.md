---
title: 'Organization Workspace Binding'
type: 'feature'
created: '2026-04-01'
status: 'done'
baseline_commit: '7ac2e56'
context:
  - '_bmad-output/planning-artifacts/sprint-change-proposal-2026-04-01.md'
  - '_bmad-output/project-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** All organizations share a single global `cli.projectDir` from config. Each organization needs its own workspace directory so CLI executions and artifacts are isolated per-org. Currently there is no way to specify a per-org workspace path.

**Approach:** Add `workspace_path` field to the Organization entity, database schema, IPC contracts, and creation UI (folder picker). Thread the org-specific path through the execution engine so MCP config and CLI processes use it as their working directory.

## Boundaries & Constraints

**Always:**
- `workspace_path` is required (NOT NULL) when creating an organization
- Use Electron's `dialog.showOpenDialog` with `properties: ['openDirectory']` for native folder picker
- Validate that the selected path exists and is a writable directory
- All existing patterns preserved: Zod validation, DI, layered architecture, `.js` import extensions

**Ask First:**
- Whether to remove `cli.projectDir` from global config entirely or keep it as a fallback default

**Never:**
- Do not change how the UtilityProcess spawning mechanism works — only change what `cwd` value is passed
- Do not modify unrelated tables or entities
- Do not add organization deletion logic (deferred to separate spec)

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Happy: create org with workspace | Valid name + existing writable dir | Org created with workspace_path persisted | N/A |
| Happy: template load with workspace | Template + existing dir | Org + roles created, workspace_path set | N/A |
| Invalid path: non-existent dir | Path to dir that doesn't exist | Reject creation | Return DesktopResult error: `INVALID_WORKSPACE_PATH` |
| Invalid path: file not directory | Path points to a file | Reject creation | Return DesktopResult error: `INVALID_WORKSPACE_PATH` |
| Happy: CLI execution uses org path | Run created for org with workspace_path | CLI spawned with cwd = org.workspace_path | N/A |

</frozen-after-approval>

## Code Map

- `apps/electron/src/main/core/types/domain.types.ts` -- Organization interface definition
- `apps/electron/src/main/infrastructure/persistence/sqlite/migrations.ts` -- DB schema migrations
- `apps/electron/src/main/infrastructure/persistence/sqlite/sqlite-organization.repository.ts` -- SQLite org repo
- `apps/electron/src/shared/contracts.ts` -- IPC channels + Zod schemas
- `apps/electron/src/main/ipc-handlers/organization.handlers.ts` -- IPC handlers for org operations
- `apps/electron/src/renderer/components/organization/CreateOrgModal.tsx` -- Org creation UI
- `apps/electron/src/renderer/components/organization/TemplateSelectorModal.tsx` -- Template selector UI
- `apps/electron/src/main/application/execution/execution.engine.ts` -- Execution engine (resolves projectDir)
- `apps/electron/src/main/infrastructure/mcp/mcp-config-generator.ts` -- MCP config generation

## Tasks & Acceptance

**Execution:**
- [x] `domain.types.ts` -- Add `workspacePath: string` to Organization interface
- [x] `migrations.ts` -- Add migration v12: `ALTER TABLE organizations ADD COLUMN workspace_path TEXT NOT NULL DEFAULT ''`
- [x] `sqlite-organization.repository.ts` -- Include workspace_path in INSERT/SELECT/UPDATE queries and entity mapping
- [x] `contracts.ts` -- Add `workspacePath: z.string().min(1)` to createOrganizationSchema; add optional `workspacePath` to updateOrganizationSchema
- [x] `organization.handlers.ts` -- Pass workspacePath through create/update flows; add server-side path validation (exists + is directory)
- [x] `CreateOrgModal.tsx` -- Add folder picker button that invokes Electron dialog via IPC; display selected path; require path before submit
- [x] `TemplateSelectorModal.tsx` -- Add same folder picker integration before template creation
- [x] `execution.engine.ts` -- Resolve projectDir from org's workspacePath instead of global config; fetch org by run's orgId

**Acceptance Criteria:**
- Given a user creates an organization, when they must select a workspace folder via native OS dialog before the org is saved
- Given an org with workspacePath, when a Run executes, then the CLI process cwd is set to that org's workspacePath
- Given an invalid path (non-existent or not a directory), when creating an org, then creation fails with a descriptive error

## Verification

**Commands:**
- `pnpm dev` -- expected: app launches, org creation flow includes folder picker
- `pnpm test` -- expected: existing tests pass with updated schema

**Manual checks:**
- Create org with folder picker, verify workspace_path stored in SQLite
- Trigger a run, verify CLI process cwd matches org's workspace_path
