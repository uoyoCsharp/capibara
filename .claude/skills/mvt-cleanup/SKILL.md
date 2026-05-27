---
name: 'mvt-cleanup'
description: 'Clean up workspace artifacts, summarize completed changes, and maintain workspace health. This skill should be used when workspace has accumulated old artifacts, token footprint needs reduction, or to archive completed change records.'
---

# MVT Cleanup

## Purpose

Clean up workspace artifacts, summarize completed changes, and maintain workspace health. Reduces token footprint by archiving old artifacts and removing stale data.

## Role

You are the **Conductor** -- a Workflow Coordinator.

### Decision Rules
- No arguments -> Interactive cleanup (review items before action)
- `--dry-run` flag -> Show what would be cleaned without taking action
- Completed changes found -> Summarize and archive
- Orphaned artifacts found -> List for user review
- Stale session data found -> Summarize into single entry

### Boundaries
- Do NOT analyze requirements (use `/mvt-analyze` instead)
- Do NOT design architecture (use `/mvt-design` instead)
- Do NOT write implementation code (use `/mvt-implement` instead)

## Variants

| Variant | Description |
|---------|-------------|
| `/mvt-cleanup` | Interactive cleanup (review before action) |
| `/mvt-cleanup --dry-run` | Preview what would be cleaned |

## Activation Protocol

### Step 1: Load Context (Context Foundation)
Load the following files as foundational context:
- `.ai-agents/workspace/session.yaml` -- Current workflow state
- `.ai-agents/workspace/project-context.yaml` -- Project index (structural info)
- `.ai-agents/registry.yaml` -- Available skills registry and knowledge declarations

Extended context for this skill:
- Scan all files under `.ai-agents/workspace/artifacts/` (all change-id directories)

### Step 2: Load Knowledge

Read `.ai-agents/registry.yaml` and load every file referenced under:
- `knowledge.shared` (loaded by all skills)
- `skills.<current-skill>.knowledge` (this skill's specific knowledge, if present)

For each entry, resolve files relative to `.ai-agents/{source}`:
- If the entry lists `files: [...]`, load those files.
- If the entry lists `files_from_manifest: true`, read `{source}/manifest.yaml` and load every `files[]` entry where `auto_load: true`.

Skip any path that does not exist.

### Step 3: Load Config & Apply Preferences (Config Foundation)
Read `.ai-agents/config.yaml` and enforce the following throughout this entire session:

**Language**:
- `preferences.interaction_language` → Use for everything spoken to the user (chat, prompts, tables); NOT for files written to disk.
- `preferences.document_output_language` → See **Output Language Constraint** section below for the full rules governing files written to disk.

**Other preferences**:
- `preferences.output.no_emojis` → If true, never use emojis
- `preferences.output.data_format` → Use this format for data sections in artifacts
- `preferences.context_routing.relevance_threshold` → Used by `/mvt-manage-context add` for AI routing (default 70 if missing)

## Output Language Constraint (Mandatory)

All persisted document output (files written to disk) MUST be written in the language specified by `preferences.document_output_language` from config.yaml.

**Scope**: artifact files, generated reports, plans, and any markdown written to disk.

**Rules**:
- Section headings defined in templates may remain in their original language, but all generated **content** MUST use the configured language
- If `document_output_language` is not set, fall back to `interaction_language`
- Do NOT infer output language from template headings, user prompt language, or source code comments
- This constraint is NON-NEGOTIABLE and overrides any other language signals

### Step 4: Pre-flight Checks

For each check below, if the condition holds, perform the action implied by its **Level**:

- **WARN** -- emit the message, then ask "Continue anyway? (y/n)". Default to **y** if the user does not respond.
- **BLOCK** -- emit the message and stop. Do not proceed until the prerequisite is satisfied.
- **REQUIRED** -- same as BLOCK; the prerequisite is mandatory.
- **INFO** -- emit the message and proceed; no confirmation needed.

| # | Condition | Level | Message |
|---|-----------|-------|---------|
| 1 | `project not initialized` is empty | REQUIRED | Project must be initialized (session.yaml exists) |

## Cleanup Rules

| Category | Rule | Action |
|----------|------|--------|
| Completed changes | Change with `status: completed` older than current task | Summarize -> archive |
| Orphaned artifacts | Files in `artifacts/` not referenced by any active change | List for user review |
| Stale session data | Session history entries older than 5 phases ago | Summarize into single entry |

## Execution Flow

### Step 1: Load Inputs
- **Fallback**: if `session.yaml` is missing, refuse to clean -- without state we can't tell what is in-progress vs completed; recommend `/mvt-init` and stop.

### Step 2: Inventory Artifacts
- **What**: produce a per-change-id inventory with size and last-modified data.
- **How**:
  1. Walk `.ai-agents/workspace/artifacts/` and group files by their parent change-id directory.
  2. For each file: characters, estimated tokens (`chars / 4`), last-modified (mtime).
  3. For each change-id directory, sum tokens and file count.
  4. Mark each change-id as `active | in-recent-changes | unindexed | legacy-pattern`:
     - `active` if it matches `session.active_change.id`.
     - `in-recent-changes` if it appears in `session.recent_changes[]` (any status).
     - `unindexed` if neither condition holds and it sits under `artifacts/`.
     - `legacy-pattern` if the directory is `knowledge/patterns/` or matches other legacy markers.

### Step 3: Apply Cleanup Rules
- **What**: compute Cleanup Candidates from the inventory.
- **How**: run the rules table (defined in the shared section above) plus the additions below. A single change-id may match multiple rows; collect all proposed actions.

  | Source | Rule | Proposed action |
  |--------|------|-----------------|
  | `recent_changes[]` entry with `status: completed` AND any task in plan is older than the active change's start | Summarize: collapse multi-file artifacts into a single `summary.md`, keep the plan.yaml verbatim, archive the rest under `artifacts/{id}/_archive/` |
  | Change-id directory marked `unindexed` | List for user review (do NOT auto-archive -- could be in-flight work the user just hasn't registered) |
  | `skill_history` entries beyond the most recent 10 | Collapse into a single summary entry inside session.yaml (rule from Cleanup Rules table) |
  | Directory `knowledge/patterns/` exists | Flag for deletion (legacy pattern data; no replacement) |
  | Empty change-id directories (zero files inside) | Propose deletion of the directory itself |

- For each candidate, compute: `current size (tokens)` -> `projected size (tokens)`, expected savings.

### Step 4: Present Cleanup Plan
- Render the plan as a table:

  | Item | Category | Current Size | Action | Result |
  |------|----------|-------------|--------|--------|
  | {change-id or path} | {completed | unindexed | stale-history | legacy} | ~{tokens} | {summarize | archive | review-only | delete} | ~{reduced tokens} |
  | **Total** | | **{total}** | | **{new_total} ({savings} saved)** |

- Below the table, list any items marked `review-only` (unindexed) with a one-line note: user must decide manually.
- If `--dry-run` is set, STOP here. Print "(dry run -- no changes applied)" and exit cleanly.

### Step 5: Confirm Before Destructive Steps
- **Always require confirmation** if the plan includes any of:
  - File deletion (legacy patterns, empty dirs).
  - `summarize` action (collapses multi-file content).
  - `archive` action (moves files into `_archive/`).
- Confirmation format: a single prompt `Apply cleanup plan? (y / n / show-details)`. `show-details` prints the per-file actions, then re-asks.
- Do NOT silently delete. Do NOT skip confirmation when `--dry-run` is absent.

### Step 6: Execute the Plan
- **What**: apply the confirmed actions.
- **How**:
  1. **Summarize action**: read the full set of files in the change-id directory; produce a `summary.md` with: title, change-id, status, key decisions (list each ADR/decision title), final outcomes, list of original files. Then move originals to `_archive/`.
  2. **Archive action**: move files into `_archive/` under the same change-id directory, preserving relative paths.
  3. **Delete action**: remove only the items explicitly marked for deletion in the confirmed plan; never recurse beyond what was listed.
  4. **Stale skill_history collapse**: rewrite `session.yaml`'s `skill_history` keeping the most recent 10 detailed entries plus one rolled-up entry summarizing the older ones (count + earliest/latest date).
  5. All file mutations atomic where possible (write-temp + rename, copy-then-delete for moves).
  6. If any single action fails, STOP further actions; report what completed, what failed, and leave a recoverable state (do not partially overwrite a file with truncated content).

### Step 7: Report Result
- Print the actually-applied actions (may differ from the plan if Step 6 stopped early).
- Show new totals: files cleaned, tokens saved.
- Recommend `/mvt-check-context` to validate the post-cleanup state if savings exceed ~5k tokens.

### Step 8: (session update handled by shared section)
- This skill mutates `session.skill_history` directly in Step 6 (collapse). The standard `skill_history` append from the shared section still applies; the collapse runs BEFORE the append so the new entry is preserved at full detail.

## Edge Cases & Errors

| Case | Handling |
|------|----------|
| `active_change.id` directory matches a "stale completed" rule | Skip cleanup of the active change; never archive in-progress work |
| `--dry-run` set | Stop after Step 4; do not request confirmation; do not modify any file |
| Plan would archive ALL artifacts (workspace becomes empty) | Require an extra confirmation: `This will archive every artifact. Continue? (y/n)` |
| User aborts at Step 5 confirmation | Report "no changes applied" |
| `_archive/` already exists with content from a prior run | Preserve existing `_archive/` content; new archives are added alongside |
| File targeted for action no longer exists (concurrent removal) | Skip with a note; do not error out the whole run |
| Unindexed change-id directory contains only `plan.yaml` | List as review-only; suggest user runs `/mvt-update-plan` or registers it via `/mvt-plan-dev` instead of cleaning |
| `session.yaml.bak` present from a previous failed run | Overwrite during Step 6 collapse (only the most recent backup is useful) |

## State Update (Required)

After execution, update `.ai-agents/workspace/session.yaml` with the following fields.

### Mandatory (every skill must set)

- `session.last_command`: Set to the current skill command (e.g., `"/mvt-analyze"`)
- `skill_history`: Append entry:
  ```yaml
  - command: "/{skill-name}"
    completed_at: "{current timestamp ISO 8601}"
    summary: "{one-line summary of what was accomplished}"
    change_id: "{active_change.id if set, otherwise empty string}"
  ```
  Keep max 10 entries. If exceeds, drop the oldest. The `change_id` field enables `/mvt-resume` to filter history per change when multiple changes are in flight.
- `recent_actions`: Append one-line summary with format:
  `[{YYYY-MM-DD HH:MM}] /{command}: {one-line summary}`
  Keep max 5 entries. If exceeds, drop the oldest.

### Forbidden

- Do NOT update fields not listed above
- Do NOT overwrite `active_change` unless this skill creates a new change
- Do NOT modify `skill_history` entries other than appending a new one
- Do NOT modify `recent_changes` -- it is owned by `/mvt-plan-dev` and `/mvt-update-plan`
- Do NOT modify `active_change.plan_path` or `active_change.has_plan` -- these are owned by `/mvt-plan-dev`

## Suggested Next Steps

Recommend 2-3 relevant next skills based on the skill just completed (`mvt-cleanup`) and the current project state.

### Resolution order

Infer 2-3 suggestions from:
- `skill_history` in `session.yaml`
- `category` and `description` of each skill in `registry.yaml`
- The current `active_change` state (if in progress)
- The `depends_on` relationships between skills

### Format

- `/{skill_name}` -- {when to use this skill, tailored to the current context}

Do not suggest the skill that was just completed. Prioritize skills that logically follow from the work done.
