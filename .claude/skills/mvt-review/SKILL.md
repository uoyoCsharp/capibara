---
name: 'mvt-review'
description: 'Perform code review for quality, standards compliance, and best practices. This skill should be used when user wants code reviewed, quality checked, or to identify issues before merging.'
---

# MVT Review

## Purpose

Review code for quality, standards compliance, and best practices. Identify issues by severity, suggest improvements, and ensure architecture compliance.

## Role

You are the **Reviewer** -- a Code Quality Guardian.

### Decision Rules
- Critical issue found (security, data loss, crash) -> Mark as CRITICAL, require fix before merge
- Layer violation found -> Flag for Architect, suggest `/mvt-design`
- Minor style issue -> Note as suggestion, don't block
- Subjective preference -> Mark as "non-blocking" optional improvement
- Good code pattern found -> Highlight positively
- Bug found -> Document with reproduction steps, suggest `/mvt-fix`
- Insufficient test coverage -> Recommend specific scenarios, suggest `/mvt-test`

### Boundaries
- Do NOT fix code directly (use `/mvt-fix` instead)
- Do NOT make architecture decisions (use `/mvt-design` instead)
- Do NOT modify source code (use `(This is a read-only review)` instead)

## Aspect Options

| Aspect | Focus Areas |
|--------|-------------|
| `architecture` | Layer compliance, module boundaries, dependency direction |
| `security` | Input validation, injection prevention, authentication |
| `performance` | N+1 queries, memory leaks, caching |
| `style` | Naming conventions, formatting, documentation |

Usage: `/mvt-review` or `/mvt-review --aspect {type}`

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
| 2 | `no code to review` is empty | WARN | No code to review. Run `/mvt-implement` first or specify files. |

## Execution Flow

### Step 1: Load Inputs
- **Required**:
  - The set of files to review (see Step 2 for resolution).
- **Fallback**:
  - If `design.md`/`implementation.md` are missing, downgrade to "code-only review": skip the design-compliance checks (Step 4 row group A) and note the limitation in the artifact.
  - If `project-context.md` is missing, skip layer-compliance checks and note the limitation.

### Step 2: Resolve Review Target
- **What**: produce a definitive file list to review.
- **How**: pick the FIRST source that yields a non-empty list.

  | Source | Condition |
  |--------|-----------|
  | User-provided file paths | User passed paths/globs as arguments |
  | `--aspect` filter | User specified an aspect; intersect aspect-relevant files with the active change's `Change Tracking` |
  | `implementation.md` -> `Files Touched` | Active change has implementation artifact |
  | `git diff --name-only main...HEAD` | Inside a feature branch |
  | `git diff --name-only HEAD~1` | Last-commit fallback |

- If the resolved list is empty, STOP and ask the user to specify the target.
- If the list exceeds ~30 files, ask the user to scope down OR confirm a high-level (per-module) review depth.

### Step 3: Determine Review Depth
- **Default**: full review across all axes (Step 4).
- `--aspect <name>`: narrow to a single axis. Supported aspects: `architecture`, `quality`, `errors`, `edge-cases`, `security`, `naming`, `tests`. Other aspects -> ask user to clarify.
- For files >300 lines, do a structural pass first (interfaces, exports, key paths) before line-level review; do not attempt line-by-line on huge files.

### Step 4: Run Review Checks
- **What**: produce findings, each tagged with severity, location, and a concrete remedy.
- **How**: walk the checklist below. Skip any group whose inputs were missing per Step 1 fallback notes.

  **Group A -- Design / Layer Compliance** (requires design.md OR project-context.md)
  - Each file is in the module/layer assigned by design or project-context.
  - Dependency direction respects layer rules (no upward imports, no forbidden cross-module reaches).
  - Public interfaces match `Key Interfaces` from design.
  - Implementation `Deviations from Design` are documented; undocumented deviations are findings.

  **Group B -- Code Quality**
  - Functions are small and focused; flag functions > ~50 lines or with > ~3 nested control levels.
  - Naming is clear, consistent with `naming-conventions.md`, and matches surrounding code.
  - No duplication: same logic appearing >= 3 times warrants extraction.
  - No premature abstraction: a single-use helper / interface / wrapper is a finding.
  - No dead code, unused imports, commented-out blocks left behind.

  **Group C -- Error Handling**
  - Error handling appears only at system boundaries (HTTP, DB, external API, file IO, queue).
  - Interior try/catch must have an explicit reason in a one-line comment, otherwise findable.
  - No swallowed errors (catch without rethrow / log / explicit recovery).
  - Error types are specific where the language supports it (no bare `catch Exception` without rethrow).

  **Group D -- Edge Cases**
  - Boundary inputs handled: empty / null / max length / negative / zero / unicode.
  - Concurrency: shared state, async ordering, idempotency where required by design.
  - Resource lifecycle: opened resources are closed on all paths.
  - Off-by-one: loop bounds, slice indices, pagination cursors.

  **Group E -- Tests** (if test files are in scope)
  - Each business rule from `project-context.md` has at least one test case.
  - Tests assert behavior, not implementation details.
  - No `skip` / `only` / commented-out tests left in.
  - Test names describe the scenario, not the function name.

  **Group F -- Security** (if user requirements mention auth/data sensitivity OR `--aspect security`)
  - No secrets in code or test fixtures.
  - Input validation at every external boundary.
  - Auth/authz checks present on every protected endpoint or operation.
  - SQL/NoSQL/HTML rendered through parameterized / escaped APIs.

### Step 5: Categorize and De-duplicate Findings
- **Severity**: assign each finding using the table below.

  | Level | Definition | Examples |
  |-------|------------|----------|
  | **Critical** | Bug, security flaw, broken contract, data loss risk, layer violation that breaks isolation | Swallowed exception in payment path; missing auth on protected endpoint; forbidden cross-layer import |
  | **Warning** | Likely problem or significant quality issue: not a bug today, but high-risk or maintainability hazard | Function 200 lines; duplicated logic 3x; missing tests for a documented business rule |
  | **Suggestion** | Improvement, polish, taste preference | Variable name could be clearer; could split a small helper; minor docstring gap |

- Merge duplicate findings (same root cause appearing in multiple files) into one entry with a list of locations.
- Each finding must include: file, line range, severity, observation, recommendation.

### Step 6: Write Artifact
- **Path**: `.ai-agents/workspace/artifacts/{active_change.id}/review.md` if `active_change` exists; else `.ai-agents/workspace/artifacts/_ad-hoc-review-{YYYY-MM-DD-HHMM}/review.md`.
- **Template**: `.ai-agents/skills/_templates/review-output.md` (custom override at `_templates/custom/...` takes precedence).
- **Required content** (mapped to template headings):
  - `Review Scope` -- file list, depth, aspect filter, fallbacks applied (e.g., "design.md missing -> Group A skipped").
  - `Summary` -- counts per severity + one-paragraph overall verdict (Approve / Approve with comments / Request changes / Block).
  - `Critical Findings` -- one entry per finding.
  - `Warnings`.
  - `Suggestions`.
  - `Skipped Checks` -- groups skipped because inputs were missing, with reason.
  - `Recommended Next Skill` -- e.g., `/mvt-fix` for Critical, `/mvt-test` if Group E gaps, `/mvt-refactor` if Group B is dominant.

### Step 7: Verdict Rule
- Critical > 0 -> verdict is `Request changes`. Suggest `/mvt-fix`.
- Critical = 0, Warnings > 5 -> verdict is `Approve with comments`.
- Critical = 0, Warnings <= 5, Suggestions only -> verdict is `Approve`.
- Code-only review (design.md missing) -> verdict cannot be higher than `Approve with comments` (call it out explicitly).

### Step 8: (session update handled by shared section)

## Edge Cases & Errors

| Case | Handling |
|------|----------|
| Review target is generated code (build output, lockfile, vendored dep) | Skip with a one-line note in artifact; do not flag findings |
| All Group A inputs missing | Run as code-only review; cap verdict at `Approve with comments` |
| User asked for review but there are zero changes | STOP, report "no diff to review", do not write artifact |
| Findings in the same file conflict (e.g., quality says "extract", architecture says "do not introduce a new module") | Defer to architecture; record the tension in `Suggestions` |
| Implementation explicitly documents a deviation from design (in `Deviations from Design`) | Treat as accepted -- flag only if the deviation is itself problematic |
| Reviewer finds bugs requiring discussion before fix | Mark Critical, but do NOT auto-invoke `/mvt-fix`; leave the call to the user |

## Artifact Structure
Read the document structure template from: `.ai-agents/skills/_templates/review-output.md`
If a custom version exists at `.ai-agents/skills/_templates/custom/review-output.md`, use the custom version instead.
The template defines section headings only. Generate content for each section based on review results.
Write the artifact to: `.ai-agents/workspace/artifacts/{change-id}/review.md`

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

Recommend 2-3 relevant next skills based on the skill just completed (`mvt-review`) and the current project state.

### Resolution order

Infer 2-3 suggestions from:
- `skill_history` in `session.yaml`
- `category` and `description` of each skill in `registry.yaml`
- The current `active_change` state (if in progress)
- The `depends_on` relationships between skills

### Format

- `/{skill_name}` -- {when to use this skill, tailored to the current context}

Do not suggest the skill that was just completed. Prioritize skills that logically follow from the work done.
