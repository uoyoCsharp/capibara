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

## Phase 1 Review Deferred Items (2026-04-17)

### Add Missing DB Indexes on High-Frequency Query Columns
- `runs` table: indexes on `org_id`, `task_id`, `conversation_id`, `role_id`
- `tasks` table: indexes on `org_id`, `assignee_role_id`
- Evaluate during Phase 2-5 when query patterns are concrete

### Config Schema Strictness
- Add `.strict()` to Zod schema to reject unknown config keys (typo protection)
- Resolve relative paths in `sqlitePath`/`logDir`/`projectDir` to absolute
- Log warning on malformed JSON config files instead of silent fallback

### ValidatedConfig vs CapibaraConfig Type Drift
- Consider removing manual `CapibaraConfig` interface and using Zod-inferred `ValidatedConfig` as canonical type
- Or add compile-time assignability check

### EventBus Error Handling
- Route handler errors through ILogger instead of console.error
- Consider whether critical event handlers should surface errors to callers
