---
id: 'implement-output'
version: '1.0'
skill: 'mvt-implement'
change_id: '20260602-architecture-refactor'
task_ids: ['t3-fk-cascade-migration', 't4-pending-wakes-idempotency']
---

# Implementation: G-3 FK CASCADE Migration v6 + G-4 Pending Wakes Idempotency v7

## Implementation Plan

Two Phase 0 database migrations appended to the existing migrations array (v1-v5 unchanged), plus one repository code change for idempotent INSERT.

## Changes

| File | Action | Intent |
|------|--------|--------|
| `infrastructure/persistence/sqlite/migrations.ts` | modify | Append migration v6 (FK CASCADE table rebuild) and v7 (pending_wakes dedup + unique index) |
| `modules/orchestrator/persistence/sqlite-pending-wake.repository.ts` | modify | Change INSERT to INSERT OR IGNORE; return existing row on duplicate |

## Implementation Details

### Migration v6 -- FK CASCADE (ADR-04/ADR-11)

SQLite table-rebuild in a single transaction:
1. `PRAGMA foreign_keys=OFF` so the DROP doesn't cascade mid-migration
2. `CREATE TABLE conversations_new` with `task_id REFERENCES tasks(id) ON DELETE CASCADE` (changed from SET NULL)
3. `INSERT INTO conversations_new SELECT * FROM conversations`
4. `DROP TABLE conversations; ALTER TABLE conversations_new RENAME TO conversations`
5. Recreate all 4 indexes that existed on conversations
6. `PRAGMA foreign_keys=ON`

All other columns unchanged. Migrations v1-v5 are never edited.

### Migration v7 -- pending_wakes idempotency (ADR-05/ADR-06)

1. De-duplicate pre-existing rows: `DELETE FROM pending_wakes WHERE id NOT IN (SELECT MIN(id) ... GROUP BY natural key)`
2. `CREATE UNIQUE INDEX ux_pending_wakes_dedup ON pending_wakes(org_id, role_id, COALESCE(task_id,''), COALESCE(conversation_id,''), reason)`
   - COALESCE-to-sentinel because SQLite treats NULLs as distinct in unique indexes

### Repository code change

`SqlitePendingWakeRepository.create()`:
- Changed `INSERT INTO` to `INSERT OR IGNORE INTO` against `ux_pending_wakes_dedup`
- On `changes === 0` (duplicate ignored), queries and returns the existing row
- This makes `onResponseNeeded()` idempotent under event re-delivery

## Design Compliance

| Check | Result |
|-------|--------|
| Files touched match Change Tracking | Passed -- migrations.ts + sqlite-pending-wake.repository.ts |
| Each file in assigned module/layer | Passed -- infrastructure/persistence and modules/orchestrator/persistence |
| Public interfaces match Key Interfaces | Passed -- no interface changes; repository contract unchanged (create still returns PendingWake) |
| Forbidden cross-layer imports absent | Passed -- no new imports |
| Error handling at boundaries only | Passed -- migration uses transaction (runMigrations wraps each in db.transaction) |
| No new external deps | Passed |

## Deviations from Design

1. **`create()` returns existing row on duplicate** -- The design says `INSERT OR IGNORE`. Simply ignoring the insert would return a stale `findById(id)` that doesn't exist. The implementation queries the existing row so callers always get a valid PendingWake, preserving the interface contract.

2. **`PRAGMA foreign_keys=OFF` in v6** -- Not explicitly specified in design SQL but required for SQLite table rebuilds; the `DROP TABLE conversations` would cascade-delete dependent rows from `conversation_messages`, `conversation_events`, `runs`, etc. if FK checks were ON during the intermediate state.

## Self-Check Results

- **TypeScript**: `tsc --noEmit` -- passed (exit 0)
- **arch:check**: `pnpm arch:check` -- passed (exit 0, 21 warnings unchanged)

## Open TODOs

- App-layer cascade loop removal in TaskService.delete() is deferred to t6 (OP-10)
- Idempotency contract codification as team standard + PR template field (ADR-06) -- process/checklist item, not code
