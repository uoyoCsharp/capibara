# Migration Failure Policy

> **Version**: 1.0
> **Date**: 2026-04-24
> **Applies to**: Phase 0 baseline (v1) and all future `runMigrations` invocations

---

## 1. Scope

Capibara runs on the user's local machine with a single SQLite file. Migration failures lose user data if not handled carefully. This document defines the protocol the application follows when a migration cannot be applied.

## 2. Pre-migration safety — Backup

Before any migration is applied against a **non-empty** database (i.e. `schema_version > 0`), `MigrationBackupService` copies the live SQLite file to:

```
{dbPath}.backup.pre-v{latestTargetVersion}-{ISO-timestamp-slug}
```

- Rolling retention: the 5 most recent backups are kept; older ones pruned.
- On a brand-new DB (version == 0), no backup is produced — nothing to protect.
- Copy uses synchronous `fs.copyFileSync`; on Windows SQLite locking is benign because the DB is not yet opened when backup runs.

## 3. Transactional application

Each migration's `up()` runs inside `db.transaction(() => …)`. On exception the transaction rolls back — the DB reverts to its pre-migration state **for that specific migration**. Earlier migrations in the same run remain committed.

## 4. On failure — three-phase protocol

### 4.1 Detect

- `runMigrations` catches the exception, logs `[migrations] Failed to apply migration v{N}: {error}` to console, and **rethrows**.
- `composition-root.bootstrap()` lets the rethrow propagate. Electron main fails to initialise.

### 4.2 Enter read-only maintenance mode

The Electron main process MUST:

1. Log the failure with full stack trace
2. Show a native modal dialog with:
   - Title: "Database upgrade failed"
   - Body: `Version v{prev} → v{target} failed. Your data has been preserved in a backup at {backupPath}. The application cannot start until this is resolved.`
   - Buttons: **Open backup folder** | **Quit**
3. Exit with non-zero code after the user dismisses

### 4.3 Manual recovery

A user or support staff can recover by:

1. Quitting Capibara
2. Replacing `{dbPath}` with any `{dbPath}.backup.*` file
3. Relaunching — Capibara sees the old `schema_version`, re-attempts migration

If the root cause was a bug in the migration itself, shipping a corrected version of the migration script will let the retry succeed.

## 5. Invariants

| Invariant | Guarantee |
|-----------|-----------|
| No data loss on migration failure | Backup always exists for any DB with version > 0 |
| No partial migration remains | Each migration runs in its own transaction — atomic per migration |
| Idempotent re-run | Every migration uses `IF NOT EXISTS` / `pragma table_info` guards |
| Backup retention | At least 5 backups kept, pruned oldest first |

## 6. What we deliberately do NOT do

- No **automatic** rollback to a previous backup. Restoring user data is a high-stakes operation requiring human confirmation.
- No rollback scripts per migration. Greenfield stance: migrations only go forward; if a migration is wrong, we ship a corrected version, not an inverse.
- No cloud backup. Capibara is a local-first application; backups live next to the DB file.
- No migrate-on-background-thread. better-sqlite3 is synchronous and main-process-bound; running migrations off the main thread would require IPC plumbing that isn't worth the complexity.

## 7. Developer guidance

When adding a new migration:

- Bump the `version` to `max(existing) + 1`
- Write SQL idempotently (`CREATE TABLE IF NOT EXISTS`, `ADD COLUMN` guarded by `pragma table_info`)
- **Never** `DROP TABLE` a production table; rename it to `{table}_legacy_v{N}` and drop in a later version after migration stability is confirmed
- Test locally against a copy of a real user DB before releasing
- Update this document if the recovery protocol changes

## 8. Phase 0 baseline

Phase 0 of the refactor ships a single `v1` migration that creates all tables from scratch. Existing developer machines with leftover dev data from older schemas will hit a `CHECK` or foreign-key mismatch on v1 — the failure protocol above applies. The pragmatic resolution on a dev machine is: delete the old DB file and let v1 create a fresh one.

---

*End of Policy*
