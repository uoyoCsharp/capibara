---
title: 'Workflow Schema Template Selection on Org Creation'
type: 'feature'
created: '2026-04-10'
status: 'in-review'
baseline_commit: '85de94d'
context:
  - _bmad-output/planning-artifacts/architecture-workflow-engine.md
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Organizations are hardcoded to use `DEFAULT_WORKFLOW_SCHEMA`. Users cannot choose alternative workflow configurations (e.g. Kanban, Scrum, custom) when creating an org. The schema is buried in TypeScript code rather than being user-selectable.

**Approach:** Store workflow schema templates as JSON files in `resources/workflows/`, load them at startup (like org templates), expose them via IPC, and add a workflow selector dropdown to both the blank-org and template-org creation flows. The selected schema is applied to the new org instead of the hardcoded default.

## Boundaries & Constraints

**Always:**
- JSON files must be valid `WorkflowSchema` shape — validate on load, skip invalid files with a warning log.
- A `default.json` must always exist as fallback.
- Existing `DEFAULT_WORKFLOW_SCHEMA` constant becomes the content of `default.json` and is removed from code.
- Both org creation paths (blank org via `CreateOrgModal` and template via `TemplateSelectorModal`) must support the workflow selector.

**Ask First:**
- Adding new IPC channels beyond `getWorkflowTemplates`.

**Never:**
- Do not change the runtime `WorkflowEngine` or schema persistence logic — this is purely template selection at creation time.
- Do not allow editing workflow templates from the UI in this spec.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Happy path | User selects "Kanban" workflow, creates org | Org created with Kanban schema saved | N/A |
| No selection | User doesn't pick a workflow (default pre-selected) | `default.json` schema applied | N/A |
| Invalid JSON file | `resources/workflows/bad.json` has wrong shape | File skipped, warning logged, other templates still load | Log warning, skip file |
| No workflow files | `resources/workflows/` is empty or missing | Fallback to inline `DEFAULT_WORKFLOW_SCHEMA` | Log warning, use fallback |
| Template org creation | User loads org template + selects workflow | Both role hierarchy from template AND selected workflow schema applied | N/A |

</frozen-after-approval>

## Code Map

- `apps/electron/resources/workflows/default.json` -- Default workflow schema (migrated from DEFAULT_WORKFLOW_SCHEMA constant)
- `apps/electron/resources/workflows/kanban.json` -- Example alternative: simplified Kanban flow
- `apps/electron/src/main/application/workflow/workflow-template.service.ts` -- NEW: loads JSON workflow templates from disk, validates, serves list
- `apps/electron/src/main/application/workflow/default-workflow-schema.ts` -- REMOVE: replaced by JSON file
- `apps/electron/src/shared/contracts.ts` -- Add IPC channel, record type, and preload API
- `apps/electron/src/preload/index.ts` -- Expose new IPC call
- `apps/electron/src/main/composition-root.ts` -- Wire new service, register IPC handler
- `apps/electron/src/main/ipc-handlers/organization.handlers.ts` -- Accept workflowSchemaId, load and apply selected template
- `apps/electron/src/main/application/templates/org-template.service.ts` -- Accept workflowSchemaId parameter in loadTemplate
- `apps/electron/src/renderer/components/organization/CreateOrgModal.tsx` -- Add workflow dropdown
- `apps/electron/src/renderer/components/organization/TemplateSelectorModal.tsx` -- Add workflow dropdown
- `apps/electron/src/shared/locale/en-US.ts` -- Add workflow selector labels
- `apps/electron/src/shared/locale/zh-CN.ts` -- Add workflow selector labels (Chinese)
- `apps/electron/src/shared/locale/types.ts` -- Add workflow section to LocaleMessages

## Tasks & Acceptance

**Execution:**
- [x] `apps/electron/resources/workflows/default.json` -- Create JSON file from current DEFAULT_WORKFLOW_SCHEMA constant content
- [x] `apps/electron/resources/workflows/kanban.json` -- Create example Kanban workflow template (todo/doing/done, flat task type)
- [x] `apps/electron/src/main/application/workflow/workflow-template.service.ts` -- Create service: loadFromDisk, getTemplates, getById, with validation
- [x] `apps/electron/src/main/application/workflow/default-workflow-schema.ts` -- Remove file (replaced by JSON)
- [x] `apps/electron/src/shared/contracts.ts` -- Add `getWorkflowTemplates` IPC channel, `WorkflowTemplateRecord` type, preload API entry
- [x] `apps/electron/src/preload/index.ts` -- Add `getWorkflowTemplates` IPC invoke
- [x] `apps/electron/src/main/composition-root.ts` -- Instantiate WorkflowTemplateService, register IPC handler, pass to org creation handlers
- [x] `apps/electron/src/main/ipc-handlers/organization.handlers.ts` -- Use selected workflow template on org creation instead of hardcoded default
- [x] `apps/electron/src/main/application/templates/org-template.service.ts` -- Accept workflow schema from caller instead of hardcoded default
- [x] `apps/electron/src/renderer/components/organization/CreateOrgModal.tsx` -- Add workflow template dropdown, pass selection to IPC
- [x] `apps/electron/src/renderer/components/organization/TemplateSelectorModal.tsx` -- Add workflow template dropdown, pass selection to IPC
- [x] `apps/electron/src/shared/locale/en-US.ts`, `zh-CN.ts`, `types.ts` -- Add workflow selector locale strings

**Acceptance Criteria:**
- Given a user opens Create Org dialog, when the dialog loads, then a workflow dropdown is visible with all valid templates from `resources/workflows/` and `default` is pre-selected.
- Given a user selects "Kanban" workflow and creates an org, when the org is created, then `getActiveSchema(orgId)` returns the Kanban schema.
- Given `resources/workflows/bad.json` contains invalid data, when the app starts, then the file is skipped with a warning log and other templates still load.
- Given a user creates an org via template, when workflow "Kanban" is selected, then the org gets both the template roles AND the Kanban workflow schema.

## Verification

**Commands:**
- `cd apps/electron && npx tsc --noEmit` -- expected: zero errors
