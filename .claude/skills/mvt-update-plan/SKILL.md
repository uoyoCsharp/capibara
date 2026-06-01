---
name: 'mvt-update-plan'
description: "Update a single task in the active change's plan.yaml: change status, attach artifacts, leave notes, and auto-advance current_task. This skill should be used after a workflow skill finishes work that maps to a plan task, or whenever the user wants to mark a task as done, blocked, or skipped."
---

# MVT Update Plan

## Purpose

Apply incremental updates to the active plan.yaml: mark a task done/blocked/skipped, attach the artifacts produced, and let the skill auto-advance `current_task` to the next executable task. AI may invoke this skill on the user's behalf when the user replies to a soft-prompt with `done` / `blocked: <reason>`.

## Role

You are the **Architect** -- a Development Planner.

### Decision Rules
- Task id provided AND target status valid -> Apply update, advance current_task, write back
- Task id missing AND only one task is in_progress -> Default to that task
- Target status would create an invalid current_task -> Recompute current_task automatically
- All tasks become done -> Set plan.status = done, current_task = null
- active_change.plan_path is empty -> Stop and suggest /mvt-plan-dev

### Boundaries
- Do NOT create new tasks or restructure the plan (use `/mvt-plan-dev` instead)
- Do NOT create or modify the active change itself (use `/mvt-analyze` instead)
- Do NOT implement code (use `/mvt-implement` instead)

## Activation Protocol

### Step 1: Load Context (Context Foundation)
Load the following files as foundational context:
- `.ai-agents/workspace/session.yaml` -- Current workflow state
- `.ai-agents/workspace/project-context.yaml` -- Project index (structural info)
- `.ai-agents/registry.yaml` -- Available skills registry and knowledge declarations

Extended context for this skill:
- {active_change.plan_path} -- The plan to update (resolved from session.yaml)

### Step 2: Load Knowledge

Read `.ai-agents/registry.yaml` and load every file referenced under:
- `knowledge.shared` (loaded by all skills)
- `skills.<current-skill>.knowledge` (this skill's specific knowledge, if present)

For each entry, resolve files relative to `.ai-agents/{source}`:
- If the entry lists `files: [...]`, load those files.
- If the entry lists `files_from_manifest: true`, read `{source}/manifest.yaml` and load every `files[]` entry where `auto_load: true`.

Skip any path that does not exist.

### Archived Artifacts Convention

The directory `.ai-agents/workspace/artifacts/_archived/` contains change-id directories that have been archived by `/mvt-cleanup`. All skills that scan `artifacts/` MUST exclude `_archived/` from their scan scope unless explicitly inspecting archived content.

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
| 2 | `active_change.plan_path` is empty | BLOCK | No active plan. Run `/mvt-plan-dev` to create one. |

## Operation Mode: Shortcut

This skill operates as a shortcut — it can execute at any time when an active plan exists.
- Performs surgical edits only — never overwrites the whole plan structure.
- Re-validates the resulting plan before writing; aborts on validation failure.

## Execution Flow

### Step 1: Resolve Target

Required inputs:

- **task_id** -- which task to update
- **new_status** -- one of: `pending`, `in_progress`, `done`, `blocked`, `skipped`
- **artifacts** (optional, comma-separated paths) -- files produced or touched
- **notes** (optional) -- free-form note string

Resolution rules:

- If `task_id` is omitted AND exactly one task currently has status `in_progress` -> default to that task.
- If `task_id` is omitted AND zero or multiple tasks are in_progress -> ask the user to specify.
- If the user reply is the natural-language form `done` / `blocked: <reason>` (from a workflow skill's soft-prompt) -> map to:
  - `done` -> task = plan.current_task, new_status = done
  - `blocked: <reason>` -> task = plan.current_task, new_status = blocked, notes = `<reason>`

### Step 2: Load and Validate Existing Plan

1. Read `active_change.plan_path` (the file location is fixed by `/mvt-plan-dev`).
2. Parse YAML; if parse fails or schema is invalid -> stop and report. Do not attempt to repair silently.
3. Verify the target `task_id` exists in `tasks[]`. If not, list valid ids and stop.

### Step 3: Apply the Update

Mutate the in-memory plan:

1. Find the target task; capture `old_status` for the report.
2. Set `tasks[i].status = new_status`.
3. If `artifacts` provided -> append to `tasks[i].artifacts` (de-duplicate).
4. If `notes` provided -> overwrite `tasks[i].notes`.
5. Update `plan.updated_at` to current ISO 8601 timestamp.

### Step 4: Recompute current_task

Selection logic, in order:

1. If any task has status `in_progress` AND it is **not** the task we just changed to a terminal status (done/blocked/skipped) -> `current_task` = that task's id.
2. Otherwise pick the first task (by array order) where:
   - `status == pending`
   - All ids in `depends_on` reference tasks with status `done`
3. If no such task exists AND every task is `done` -> set `plan.status = done`, `current_task = null`.
4. If no such task exists but some tasks are still `pending` (because their dependencies are not done -- e.g., everything reachable is blocked) -> set `current_task = null`, leave `plan.status = in_progress`. Surface a warning in the output ("All remaining tasks are blocked by dependencies; resolve a blocker before continuing").

If the selected next task is currently `pending` -> promote it to `in_progress` (so the plan accurately reflects the active focus). Skip this promotion if `plan.status` just transitioned to `done`.

### Step 5: Validate and Write

1. Run the plan validator on the mutated structure.
2. If validation fails -> abort the write, report the validation errors, leave the original file untouched.
3. Otherwise, write back to `active_change.plan_path`.

### Step 6: Update Session State

Apply the State Update rules defined in the **State Update** section below, AND the update-plan-specific updates:

- Refresh the matching entry in `changes[]`: `updated_at` -> current ISO 8601 timestamp.
- Do NOT touch `active_change.plan_path`.

### Step 7: Output

Emit the Plan Update summary block defined in the Output Format section. Include:

- The task that changed (id, title, old -> new status).
- A compact table of all tasks with their current status.
- The new `current_task` (or "(plan complete)" if `plan.status == done`).
- A one-line "Next" hint:
  - If a new `current_task` is set -> recommend the skill matching its `skill_hint`.
  - If plan complete -> recommend `/mvt-cleanup` or starting a new change via `/mvt-analyze`.
  - If all remaining tasks are blocked -> recommend resolving the blocker (point at the `notes` of the blocked task).

## Edge Cases & Errors

| Case | Handling |
|------|----------|
| `plan.yaml` not found at `active_change.plan_path` | Abort with error: "No plan found. Run `/mvt-plan-dev` to create one." |
| Task id provided does not exist in `plan.yaml` | Abort with error listing valid task ids |
| Transition to `done` but `depends_on` tasks are not all `done` | Warn but allow: "Task marked done despite unfinished dependencies — verify correctness" |
| All tasks are `done` but user marks another as `in_progress` | Reject: plan is already complete; suggest creating a new change |
| Circular dependency detected in `depends_on` | Report the cycle and refuse to auto-advance `current_task`; suggest manual fix |
| `plan.yaml` write fails (permission denied, invalid YAML state) | Abort; do not update session; report the write error |

## Output Format

Render an inline summary (no external template). Structure:

```markdown
## Plan Update

### Change Applied
- **Task**: {task_id} -- {task_title}
- **Status**: {old_status} -> {new_status}
- **Artifacts attached**: {comma_separated_list_or_"(none)"}
- **Notes**: {notes_or_"(unchanged)"}

### Plan Progress
| # | id | title | status |
|---|----|----|--------|
| ... |

Progress: {done_count}/{total_count}
Current task: {new_current_task_id_or_"(plan complete)"}

### Next
{one-line guidance: continue to next task, resolve blocker, or run /mvt-cleanup}
```

Every response MUST end with a Suggested Next Steps section.

## State Update

After completing the skill's main task, run the session update script **exactly once** with the following arguments:

```bash
node .ai-agents/scripts/session-update.cjs --skill <skill_command_name> --summary "<concise one-line summary>" --update-change
```

If the script exits with code 0, the state update was applied successfully; there is no need to read or verify the session file.

### Argument values

| Argument | Value source | Example |
|----------|-------------|---------|
| `--skill` | The exact skill command name without the leading `/` | `mvt-update-plan` |
| `--summary` | A concise one-line description of what this invocation accomplished, in the configured `interaction_language` | `"Identified auth requirements and created change chg-001"` |
| `--update-change` | Flag only, no value. Upserts the current `active_change` into `changes[]`. | — |

### Parameter semantics

| Argument | When to use | Effect on `session.yaml` |
|----------|-------------|--------------------------|
| `--update-change` | Skill modifies a plan (i.e., after `plan.yaml` is updated) | Upserts current `active_change` into `changes[]` (with `status: active`), sets `updated_at`, sorts ascending, truncates to configured limit. |

### Failure handling

If the script fails (non-zero exit), do NOT abort the skill's main task. Continue execution and add a brief note at the end of your response that the session could not be updated.

## Suggested Next Steps

Recommend 2-3 relevant next skills based on the skill just completed (`mvt-update-plan`) and the current project state.

### Conditional Recommendations

Match the current state to one of the conditions below. If none match, use `default`.

- **`plan_done`** → `/mvt-cleanup` -- All tasks complete -- clean up artifacts and prepare to start the next change
- **`default`** → `/mvt-implement` -- Continue with the next current_task
- `/mvt-resume` -- Refresh context after task transitions
- `/mvt-status` -- Inspect overall progress across changes

### Format

- `/{skill_name}` -- {when to use this skill, tailored to the current context}

Do not suggest the skill that was just completed. Prioritize skills that logically follow from the work done.
