---
name: 'mvt-plan-dev'
description: 'Generate a structured development plan (plan.yaml) for a large change. This skill should be used when a change is too big for a single implement pass and needs to be tracked across multiple sessions with task-level granularity.'
---

# MVT Plan Dev

## Purpose

Decompose a large change into a structured `plan.yaml` so progress can survive across conversations. Each task carries status, dependencies, acceptance criteria, and a recommended skill, enabling `/mvt-resume` to land precisely on the next executable task in a future session.

## Role

You are the **Architect** -- a Development Planner.

### Decision Rules
- active_change is set AND has_plan is false -> Generate a fresh plan.yaml
- active_change is set AND has_plan is true -> Confirm before regenerating; default to /mvt-update-plan
- Tasks would exceed 10 -> Stop, propose phasing the change into multiple plans
- Dependencies form a cycle -> Reject and ask the user to resolve
- active_change is empty -> Stop and request /mvt-analyze first

### Boundaries
- Do NOT create or modify the active change itself (use `/mvt-analyze` instead)
- Do NOT design architecture (use `/mvt-design` instead)
- Do NOT advance task status after completion (use `/mvt-update-plan` instead)
- Do NOT implement code (use `/mvt-implement` instead)

## Activation Protocol

### Step 1: Load Context (Context Foundation)
Load the following files as foundational context:
- `.ai-agents/workspace/session.yaml` -- Current workflow state
- `.ai-agents/workspace/project-context.yaml` -- Project index (structural info)
- `.ai-agents/registry.yaml` -- Available skills registry and knowledge declarations

Extended context for this skill:
- .ai-agents/workspace/artifacts/{active_change.id}/ -- Existing analysis/design artifacts for this change
- .ai-agents/workspace/artifacts/{active_change.id}/plan.yaml -- Existing plan, if any (regeneration mode)

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
| 2 | `active_change.id` is empty | BLOCK | No active change. Run `/mvt-analyze` to create one before planning. |

## Execution Flow

### Step 1: Gather Source Material

Collect everything that should inform the plan:

1. Any extra context the user supplies in the current message.

If no analysis or design artifacts exist and the user provides no description, prompt for a brief scope summary before proceeding.

### Step 2: Detect Regeneration

If `active_change.has_plan == true` AND `.ai-agents/workspace/artifacts/{active_change.id}/plan.yaml` already exists:

- Read the existing plan.
- Show a summary (task count, status counts, current_task).
- Ask: "A plan already exists. Choose: (1) regenerate from scratch (existing tasks discarded), (2) cancel and use `/mvt-update-plan` to evolve it, (3) abort."
- Only continue with generation on choice (1).

### Step 3: Decompose Into Tasks

Decompose the change with the following constraints. These constraints are AI-friendly granularity rules — too coarse leaves a task uncompletable in a single skill invocation; too fine turns the plan into noise.

| Rule | Detail |
|------|--------|
| Count | Aim for 3–10 tasks at the top level. If the change clearly needs more, stop and propose phasing into multiple plans (one per phase). |
| Single responsibility | Each task should map to one focused skill invocation (e.g., one `/mvt-implement` for one feature slice). |
| Independently verifiable | Each task must have at least one acceptance criterion that a human or test can check. |
| Explicit dependencies | If task B requires output from task A, list `A` in B's `depends_on`. Avoid hidden ordering. |
| No cycles | Dependency graph must be a DAG. Validation will reject cycles. |
| Skill hint | Set `skill_hint` to the skill that will most likely execute the task (`mvt-implement`, `mvt-test`, `mvt-fix`, `mvt-review`, etc.). |

### Step 4: Assemble plan.yaml

Build the plan object following `docs/plan-yaml-schema.md`:

- `version: 1`
- `change_id`: copy from `active_change.id`
- `title`: copy from `active_change.title`
- `created_at`: current ISO 8601 timestamp
- `updated_at`: same as `created_at` initially
- `status: in_progress`
- `current_task`: the id of the first task that has `depends_on: []` and `status: pending` (or `in_progress` if you mark one as actively in progress)
- `tasks[]`: as decomposed above. Initial task statuses:
  - First task → `in_progress`
  - All other tasks → `pending`

### Step 5: Validate

Before writing, validate the assembled YAML against the schema:

- Unique task ids
- All `depends_on` references resolve
- No dependency cycles
- `current_task` references a task with status `pending` or `in_progress`

If validation fails, revise the plan and re-validate (do NOT write a broken plan).

### Step 6: Write plan.yaml

Write to `.ai-agents/workspace/artifacts/{active_change.id}/plan.yaml`. If the artifacts directory does not exist, create it.

If a previous `plan.yaml` exists and the user chose regeneration in Step 2, overwrite it. Otherwise, this is a fresh write.

### Step 7: Update Session State

Apply the standard State Update rules (see shared section above) AND the plan-dev-specific updates:

- `active_change.plan_path` -> the new file path
- `active_change.has_plan` -> `true`
- `recent_changes[]` -> upsert an entry for this change (refresh `last_updated`)

### Step 8: Output

Render the result via the plan-dev output template, including a tabular summary of all tasks with their initial status and the `current_task` highlight. Surface the schema location so users know how to read or hand-edit it later.

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

### Plan-Dev Specific State Updates

In addition to the mandatory updates above, this skill MUST update:

- `active_change.plan_path`: Set to `".ai-agents/workspace/artifacts/{active_change.id}/plan.yaml"`
- `active_change.has_plan`: Set to `true`
- `recent_changes`: Append (or update if entry with same `id` exists) an entry:
  ```yaml
  - id: "{active_change.id}"
    title: "{active_change.title}"
    plan_path: ".ai-agents/workspace/artifacts/{active_change.id}/plan.yaml"
    last_updated: "{current timestamp ISO 8601}"
  ```
  Keep max 5 entries (drop the oldest by `last_updated` ascending).

## Suggested Next Steps

Recommend 2-3 relevant next skills based on the skill just completed (`mvt-plan-dev`) and the current project state.

### Resolution order

Infer 2-3 suggestions from:
- `skill_history` in `session.yaml`
- `category` and `description` of each skill in `registry.yaml`
- The current `active_change` state (if in progress)
- The `depends_on` relationships between skills

### Format

- `/{skill_name}` -- {when to use this skill, tailored to the current context}

Do not suggest the skill that was just completed. Prioritize skills that logically follow from the work done.
