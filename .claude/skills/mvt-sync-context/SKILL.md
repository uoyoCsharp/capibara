---
name: 'mvt-sync-context'
description: 'Aggregate completed change artifacts (analysis/design/implementation) and merge new domain knowledge into project-context.md and project-context.yaml. This skill should be used after one or more changes are completed to keep long-term project knowledge in sync with delivered work.'
---

# MVT Sync Context

## Purpose

Keep `project-context.md` (semantic) and `project-context.yaml` (structural index) in sync with completed work. This is an artifact-driven, incremental synchronization: it reads workspace artifacts of completed changes, classifies new domain knowledge, and merges it into the long-term context. It does NOT scan code for new content; an optional read-only code verification step can validate that artifact-claimed entities exist.

## Role

You are the **Conductor** -- a Workflow Coordinator.

### Decision Rules
- Completed changes found -> List for user confirmation, then aggregate
- No completed changes since last sync -> Report nothing to do
- Conflicts with existing project-context.md -> Render conflict table, require user resolution
- User opts in to code verification -> Run read-only scan; flag artifact entries that cannot be located
- Code-only entities discovered (in code, not in artifacts) -> Do NOT write; recommend /mvt-analyze-code
- Artifact references modules/source_paths absent from project-context.yaml -> Propose yaml additions for user confirmation

### Boundaries
- Do NOT regenerate project-context.md from full code scan (use `/mvt-analyze-code` instead)
- Do NOT archive completed change artifacts (use `/mvt-cleanup` instead)
- Do NOT manage shared / per-skill knowledge files (use `/mvt-manage-context` instead)

### When to Use
- After one or more changes are marked `completed` and you want to fold their knowledge into long-term context
- BEFORE running `/mvt-cleanup` (sync first, archive after)
- When `project-context.md` looks behind delivered work but you do not want to pay a full `/mvt-analyze-code` regeneration

### When NOT to Use
- For deletions, renames, or module deprecations -> use `/mvt-analyze-code` (full ground-truth rebuild)
- To pick up code changes never recorded as MVTT changes -> use `/mvt-analyze-code`
- To clean / archive workspace -> use `/mvt-cleanup`

## Activation Protocol

### Step 1: Load Context (Context Foundation)
Load the following files as foundational context:
- `.ai-agents/workspace/session.yaml` -- Current workflow state
- `.ai-agents/workspace/project-context.yaml` -- Project index (structural info)
- `.ai-agents/registry.yaml` -- Available skills registry and knowledge declarations

Extended context for this skill:
- .ai-agents/workspace/artifacts/{change-id}/ -- Source artifacts for completed changes
- .ai-agents/knowledge/project/_generated/project-context.md -- Current semantic context (merge target)
- .ai-agents/workspace/project-context.yaml -- Current structural index (merge target)

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
| 1 | `session.initialized_at` is empty | BLOCK | Session not initialized. Run `/mvt-init` first. |
| 2 | `.ai-agents/knowledge/project/_generated/project-context.md exists` is empty | BLOCK | project-context.md not found. Run `/mvt-analyze-code` to create the initial document; this skill only handles incremental updates. |

## Execution Flow

### Step 1: Identify Completed Changes
- **What**: produce a candidate list of change-ids whose artifacts will be aggregated.
- **How**:
  1. Read `session.yaml`. Collect `changes[]` entries with `status: done`.
  2. For each candidate, verify `.ai-agents/workspace/artifacts/{change-id}/` exists AND contains at least one of `analysis.md` or `design.md`. Drop entries with only `plan.yaml`.
  3. (Fallback) If `changes[]` is empty, scan `.ai-agents/workspace/artifacts/*/` directly; offer those with `analysis.md` or `design.md`, marked `unindexed`.
  4. Exclude already-archived or irrelevant changes:
     - **Indexed changes**: exclude any `changes[]` entry with `status: abandoned`. For `status: done` entries, Step 1.2's directory existence check already filters out those whose artifacts have been moved to `artifacts/_archived/` by `/mvt-cleanup`.
     - **Fallback scan**: when scanning `artifacts/*/` directly, skip any path under `artifacts/_archived/` (the unified archive directory managed by `/mvt-cleanup`).
  5. Exclude `active_change.id` (work in flight).

- **Present** the list:

  | # | change-id | title | status | analysis.md | design.md | implementation.md |
  |---|-----------|-------|--------|-------------|-----------|-------------------|

- **Always print before user confirmation**:
  > Run `/mvt-sync-context` BEFORE `/mvt-cleanup`. Once cleanup archives a change-id, this skill will skip it.

- **Prompt**: "Select changes to aggregate. Indices (e.g. 1,3,5), `a` for all, `n` to cancel."

- Cancel / empty selection -> stop with "no changes applied".

### Step 2: Read Current Project Context (Adaptive Structure Discovery)

This step establishes the **target structure** that aggregated content must fit into. The structure is NOT assumed -- it is derived from the current document.

1. Read `.ai-agents/knowledge/project/_generated/project-context.md`.
   - Already required by preflight; if discovered missing here, STOP and recommend `/mvt-analyze-code`.
2. Parse the current `.md` into a section map:
   - Each top-level `##` heading -> one section anchor.
   - Record: section title (verbatim), byte range, and a 1-line semantic summary derived from the section's content (e.g., "lists domain terms with definitions" or "describes module dependencies").
   - The summary is what enables matching in Step 3 -- section titles may be in any language and may not match conventional names (Terms / Modules / etc.).
3. If the document has zero `##` sections (single block) -> STOP. Recommend `/mvt-analyze-code` to establish a sectioned baseline first.
4. Read `.ai-agents/workspace/project-context.yaml`. Record current `projects[].source_paths`, `modules`, and `tech_stack` for diff comparison in Step 4d.

### Step 3: Extract and Classify Artifact Content

- **What**: from each selected change-id, extract atomic knowledge items and classify them against the section map from Step 2.
- **How**:
  1. For each selected change-id, read available artifacts (`analysis.md`, `implementation.md`).
  2. Extract atomic items. Typical sources:
     - `analysis.md` -> domain terms, actors, business rules, constraints
     - `implementation.md` -> files added/changed (informs `.yaml` source_paths), realized vs deviated design points
  3. For each item, match to a section from the Step 2 map:
     - Match by semantic similarity to **section title + 1-line summary**, not by exact string.
     - Confidence levels:
       - **mapped**: exactly one section matches with high confidence
       - **ambiguous**: 2+ sections plausibly match
       - **orphan**: no section matches; propose a new section name
  4. For each item, also detect change type relative to current section content:
     - `new` -- target section does not contain this entity
     - `modify` -- target section mentions the entity but artifact provides a different value
     - `redundant` -- already present, no change (will be filtered out, not shown to user)

### Step 4: Render the Update Plan (Four Tables)

#### 4a. Section-mapped items
| # | change-id | item | type | target section | classification |
|---|-----------|------|------|----------------|----------------|

#### 4b. Conflicts requiring resolution (every `modify` item)
| # | item | section | current value | proposed value (from {change-id}) |
|---|------|---------|---------------|-----------------------------------|

#### 4c. Ambiguous and orphan items
| # | item | reason | candidate sections (or proposed new section) |
|---|------|--------|----------------------------------------------|

#### 4d. Implied yaml changes
| # | yaml field | current | proposed |
|---|------------|---------|----------|

### Step 5: User Confirmation (Per-Table)

- **4a**: default = accept all. User input: indices to drop, or `e <n>` to edit a single item's target section.
- **4b**: **explicit per-row decision required**. Format `<index>:<keep|replace|edit>`. Example: `1:replace,2:keep,3:edit`. No default.
- **4c**: per row, user picks an existing section, types a new section name, or `skip`.
- **4d**: default = accept; user can drop indices.

Then ask: **"Run optional read-only code verification before applying? (y/n)"**

### Step 6: (Optional) Read-only Code Verification

This step catches artifacts claiming entities never actually delivered. It is **read-only** -- it never writes anything to `.md` or `.yaml`.

If user opts in:
1. For each accepted item naming a code entity (module path, file, class, function), search the codebase under registered `source_paths`:
   - Module path -> directory exists?
   - File -> file exists?
   - Symbol -> grep within source_paths
2. Classify findings:

   | Finding | Action |
   |---------|--------|
   | Artifact item matches code | Mark `verified`; keep in apply list |
   | Artifact item NOT found in code | Flag `unverified`; ask user: drop or proceed (likely reverted / un-merged) |
   | Code contains module / file / symbol that NO artifact item references | **Do NOT add to apply list.** Print: `Code-only entity detected: {path}. Run /mvt-analyze-code for ground-truth rebuild.` |

3. Re-render the apply list with `verified` / `unverified` markers; final confirmation.

If user skips verification: proceed directly to Step 7 with Step 5 selections.

### Step 7: Apply Updates (Merge Mode)

- **Pre-write**:
  1. Backup: `project-context.md` -> `project-context.md.bak`; `project-context.yaml` -> `project-context.yaml.bak`. Overwrite any prior `.bak`.
  2. Backup write failure -> STOP, do not modify originals.

- **Update `project-context.md`** (merge, never rewrite):
  1. Each `new` item: append to target section, matching the section's existing style (bullet vs paragraph).
  2. Each `modify` item with `replace`: replace the matching line in place. Smallest possible diff.
  3. Each `orphan` item with new-section choice: append a new `##` section at end of file.
  4. **Never delete** any existing line. **Never reorder** existing sections.

- **Update `project-context.yaml`** (structured merge):
  1. Apply accepted entries from Table 4d.
  2. Add new `source_paths` to matching project entry; add new modules to `modules[]`.
  3. **Never delete** an existing yaml entry in this skill.

- **Atomicity**: temp + rename per file. If `.md` write succeeds but `.yaml` fails (or vice versa) -> restore the failed one from `.bak`, keep the other; report partial success.

### Step 8: Report

1. **Applied summary** -- counts: items added / modified / skipped / orphaned-into-new-section
2. **Files changed** -- paths + byte deltas
3. **Backup paths** -- so user can manually revert
4. **Synced changes** -- list all change-ids whose knowledge was aggregated in this run:
   > The following changes have been synced and can be safely archived: {change-id-1}, {change-id-2}, ...
   > Last synced at: {last_synced_at} (updated by this run)
5. **Out-of-scope reminder** (always print):
   > This skill processes additions and modifications only. Module deletions, renames, and large refactors are NOT detected here. Run `/mvt-analyze-code` periodically to rebuild from ground truth.
6. **Suggested next**:
   - Aggregated >= 1 change -> "Run `/mvt-cleanup` to archive these completed changes."
   - Verification flagged code-only entities -> "Run `/mvt-analyze-code` to capture missing entities."

### Step 9: State Update
Apply the State Update rules defined in the **State Update** section below.
- The `--set-synced` parameter updates `session.last_synced_at`.

## Edge Cases & Errors

| Case | Handling |
|------|----------|
| `project-context.md` does not exist | Caught at preflight; recommend `/mvt-analyze-code` |
| `.md` has zero `##` sections | STOP at Step 2; recommend `/mvt-analyze-code` |
| Selected change-id has only `plan.yaml` | Filtered in Step 1; will not appear |
| `modify` with `replace` but the existing line cannot be located deterministically | Fall back to append + flag as duplicate-needs-manual-edit; do NOT silently overwrite the wrong line |
| `.md.bak` already exists | Overwrite (only the most recent backup matters) |
| User aborts at Step 5 | Do not write; report "no changes applied" |
| Step 6 verification finds zero matches for everything | Strong warning; require explicit confirm before proceeding (artifacts likely describe planned, not delivered, work) |
| Two artifacts contradict each other (design says layer A, implementation says layer B) | Surface in Table 4b as cross-artifact conflict; user picks |
| change-id was archived between Step 1 and Step 7 | Skip with note; do not error the run |

## State Update

After completing the skill's main task, run the session update script **exactly once** with the following arguments:

```bash
node .ai-agents/scripts/session-update.cjs --skill <skill_command_name> --summary "<concise one-line summary>" --set-synced
```

If the script exits with code 0, the state update was applied successfully; there is no need to read or verify the session file.

### Argument values

| Argument | Value source | Example |
|----------|-------------|---------|
| `--skill` | The exact skill command name without the leading `/` | `mvt-sync-context` |
| `--summary` | A concise one-line description of what this invocation accomplished, in the configured `interaction_language` | `"Identified auth requirements and created change chg-001"` |
| `--set-synced` | Flag only, no value. Sets `session.last_synced_at` to current time. | — |

### Parameter semantics

| Argument | When to use | Effect on `session.yaml` |
|----------|-------------|--------------------------|
| `--set-synced` | Skill synchronizes context files | Sets `session.last_synced_at` to the current time. |

### Failure handling

If the script fails (non-zero exit), do NOT abort the skill's main task. Continue execution and add a brief note at the end of your response that the session could not be updated.

## Suggested Next Steps

Recommend 2-3 relevant next skills based on the skill just completed (`mvt-sync-context`) and the current project state.

### Conditional Recommendations

Match the current state to one of the conditions below. If none match, use `default`.

- **`merge applied successfully`** → `/mvt-cleanup` -- Archive aggregated change artifacts now that knowledge is sync'd
- **`code verification flagged code-only entities`** → `/mvt-analyze-code` -- Regenerate project-context.md from full code scan
- **`default`** → `/mvt-check-context` -- Audit token cost and overall context health

### Format

- `/{skill_name}` -- {when to use this skill, tailored to the current context}

Do not suggest the skill that was just completed. Prioritize skills that logically follow from the work done.
