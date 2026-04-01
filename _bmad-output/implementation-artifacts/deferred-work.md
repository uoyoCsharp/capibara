# Deferred Work

## Organization Deletion with Safety Confirmation (Story 2.7)

**Deferred from:** Sprint Change Proposal 2026-04-01
**Reason:** Split from workspace binding goal for single-goal focus

**Scope:**
- Implement cascade delete in IOrganizationRepository
- Add `capibara:org:delete` IPC channel with Zod validation
- Build confirmation dialog UI (type org name to confirm)
- Redirect after deletion + success notification

## CreateOrgModal Missing isCreating Guard

**Deferred from:** Workspace Binding Review (2026-04-01)
**Reason:** Pre-existing pattern issue, not caused by this change

**Scope:**
- Add `isCreating` state to CreateOrgModal to prevent double-submit during async creation
- Consistent with TemplateSelectorModal which already has this guard
