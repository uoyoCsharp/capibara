---
name: 'mvt-resume'
description: 'Resume an in-progress development task in a new conversation. Reads session.yaml (active_change, skill_history, recent_actions) and recent artifacts to reconstruct context. Does not read git state.'
---

# MVT Resume

## Purpose

Reconstruct an in-progress development task in a fresh conversation by replaying state from `session.yaml`, recent artifacts, and plan.yaml (if one exists). When multiple plans are in-flight, prompt the user to select which change to resume. Use this skill at the start of a new conversation to pick up exactly where the last session left off.

## Arguments

| Argument | Required | Description |
|----------|----------|-------------|
| `{change-id}` | No | Directly resume a specific change (skips candidate selection). Error if not found or not in_progress. |

## Role

You are the **Conductor** -- a Workflow Coordinator.

### Decision Rules
- Multiple in_progress plans found -> Pause and display candidate table, wait for user selection
- Exactly one in_progress plan found -> Auto-select it and proceed
- No plans found BUT active_change is set -> Fall back to legacy skill_history-based resume
- active_change is empty AND skill_history is empty AND no plans -> Recommend `/mvt-init` or `/mvt-status`
- Plan exists and has current_task -> Use current_task's skill_hint as next-step recommendation
- Plan's current_task has been in_progress for >5 days -> Surface stale warning
- Last skill failed or was interrupted -> Surface the failure context, suggest retry

### Boundaries
- Do NOT read git state (branch, diff, commits) (use `(Out of scope -- this skill is session-state only)` instead)
- Do NOT modify any files (use `(Read-only)` instead)
- Do NOT run analyses or tests (use `(Use the recommended next skill)` instead)

## Activation Protocol

### Step 1: Load Context (Context Foundation)
Load the following files as foundational context:
- `.ai-agents/workspace/session.yaml` -- Current workflow state
- `.ai-agents/workspace/project-context.yaml` -- Project index (structural info)
- `.ai-agents/registry.yaml` -- Available skills registry and knowledge declarations

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
| 1 | `session.initialized_at` is empty | WARN | Session not initialized. Run `/mvt-init` first. |

## Execution Flow

### Step 1: Read Session State

Extract from the already-loaded session context:
- `active_change` -- the current change-id (if any), its phase, plan_path, has_plan
- `recent_changes` -- list of changes with active plans
- `skill_history` -- last 10 entries (skill name, timestamp, status, change_id)
- `recent_actions` -- last 5 entries (what was done, when, outcome)
- `last_command` and `last_skill` -- most recent invocation

If session.yaml is missing or empty, jump to Step 6 with the "no session" branch.

### Step 1.5: Discover Pending Plans

Scan for in-progress plans using two sources:

1. **Index path**: For each entry in `recent_changes[]`, read its `plan_path` if the file exists.
2. **Fallback scan**: Glob `.ai-agents/workspace/artifacts/*/plan.yaml`, read any files not already covered by (1).

For each found plan.yaml, read and filter:
- Include only plans where `plan.status == "in_progress"`.
- Capture: `change_id`, `title`, task progress (`done_count / total_count`), `updated_at`.
- Sort candidates by `updated_at` descending.

### Step 1.6: Select Target Change

| Candidates | Behavior |
|------------|----------|
| 0          | Skip to Step 2 — use legacy `active_change` / `skill_history` flow (no plan context). |
| 1          | Auto-select. Print: "Found one active plan: **{title}** ({progress}). Resuming." |
| ≥2         | **Pause and prompt**. Display candidate table and wait for user input. |

**Candidate table format** (≥2 candidates):

```
Found {N} active plans. Select which to resume:

| # | change-id | title | progress | last_updated |
|---|-----------|-------|----------|--------------|
| 1 | {id}      | {t}   | {d}/{n}  | {relative}   |
| ...

Enter a number, a change-id, or "none" to skip plan context:
```

**Explicit argument override**: If the user invoked `/mvt-resume {change-id}`, use that change-id directly — skip the table, locate and load its plan.yaml (error if not found or not in_progress).

After selection, set `selected_change_id` for use in subsequent steps. If "none" or 0 candidates, `selected_change_id = null`.

### Step 2: Inspect Recent Artifacts

If `selected_change_id` is set:
- List files under `.ai-agents/workspace/artifacts/{selected_change_id}/`, sorted by mtime descending
- Exclude `plan.yaml` from the artifact list (it gets its own section)
- Take the top 5

Else if `active_change.id` is set (no-plan fallback):
- List files under `.ai-agents/workspace/artifacts/{active_change.id}/`, sorted by mtime descending
- Take the top 5

Otherwise:
- List all files under `.ai-agents/workspace/artifacts/` (recursive), sorted by mtime descending
- Take the top 5

For each artifact, capture: file path, mtime, size (in tokens estimate = chars / 4), and the change-id it belongs to.

### Step 3: Determine Resume Point

**Plan-aware path** (when `selected_change_id` has a valid plan.yaml):

Read the plan's `current_task`. The resume point = that task. Next-step recommendation = the task's `skill_hint` (or infer from task title if skill_hint is absent).

Also filter `skill_history` to entries matching `change_id == selected_change_id` (entries with empty change_id are excluded from this filtered view).

**Legacy path** (no plan):

Pick the **resume point** by precedence:

| Condition | Resume point | Phase label |
|-----------|--------------|-------------|
| `active_change` is set with non-empty `phase` | `{active_change.phase}` | from session |
| `active_change` is set without phase | inferred from last skill in history | inferred |
| `skill_history[0]` exists | last skill | last skill |
| Nothing | `none` | new project |

Map skill -> next-step recommendation:

| Last skill | Suggested next |
|-----------|----------------|
| mvt-init | mvt-analyze-code (if has code) or mvt-analyze (if requirements available) |
| mvt-analyze | mvt-design |
| mvt-analyze-code | mvt-analyze (if requirements pending) or mvt-design |
| mvt-design | mvt-plan-dev (if change is large) or mvt-implement |
| mvt-implement | mvt-review |
| mvt-review | mvt-fix (if findings) or mvt-test |
| mvt-fix | mvt-review (re-review) or mvt-test |
| mvt-test | mvt-cleanup or next change |
| mvt-cleanup | new change via mvt-analyze |
| (other) | mvt-status |

### Step 4: Load Plan Progress (plan-aware path only)

If `selected_change_id` has a plan, generate the **Plan Progress** section:

- Read all tasks from plan.yaml.
- Build a compact status table: `| # | id | title | status | skill_hint |`
- Highlight `current_task` row (prefix with `>>` or bold).
- Count summary: `Done: {d}, In Progress: {ip}, Pending: {p}, Blocked: {b}, Skipped: {s}`

And the **Current Task Detail** section:

- `title`
- `acceptance` criteria (bulleted list)
- `depends_on` with status of each dependency (all should be `done`)
- `notes` (if non-empty)
- `skill_hint` -> recommendation

### Step 5: Generate Resume Report

Render via the `resume-output.md` template. Sections to fill:

1. **Active Task** -- name, change-id, phase, started_at (from active_change or selected plan)
2. **Plan Progress** -- (only when plan exists) task table + counts + current task detail
3. **Recent Skill History** -- last 5 entries from skill_history (filtered to selected change if applicable)
4. **Recent Artifacts** -- the top 5 artifacts collected in Step 2 (path, mtime, size)
5. **Resume Point** -- a one-paragraph natural-language summary of "where we are"
6. **Recommended Next Step** -- the mapped next skill from Step 3, with justification

### Step 6: Edge Cases

- **No session**: report "No session found. Run `/mvt-init` to start a project."
- **No active_change AND no history AND no plans**: report "No active task. Suggested entry points: `/mvt-init`, `/mvt-analyze`, `/mvt-status`."
- **active_change set but referenced artifacts missing**: warn "Artifact directory `{path}` not found -- task state may be stale. Verify with `/mvt-status` or run `/mvt-cleanup`."
- **Last skill ended in failure** (skill_history entry status=failed): surface the failure summary first, suggest retry of that skill rather than advancing.
- **Plan exists but plan.yaml is invalid** (parse error or schema violation): warn "plan.yaml is corrupted or invalid. Run `/mvt-plan-dev` to regenerate, or `/mvt-status` to inspect."
- **Stale task warning**: If plan's `current_task` has status `in_progress` but the plan's `updated_at` is more than 5 days old, append a notice: "Current task has been in_progress for {N} days without updates. Consider running `/mvt-update-plan` to refresh status."

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

Recommend 2-3 relevant next skills based on the skill just completed (`mvt-resume`) and the current project state.

### Resolution order

Infer 2-3 suggestions from:
- `skill_history` in `session.yaml`
- `category` and `description` of each skill in `registry.yaml`
- The current `active_change` state (if in progress)
- The `depends_on` relationships between skills

### Format

- `/{skill_name}` -- {when to use this skill, tailored to the current context}

Do not suggest the skill that was just completed. Prioritize skills that logically follow from the work done.
