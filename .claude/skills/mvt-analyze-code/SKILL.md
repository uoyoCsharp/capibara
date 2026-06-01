---
name: 'mvt-analyze-code'
description: 'Analyze existing code to generate project-context.md with terms, modules, layers, and business rules. This skill should be used when user wants to understand an existing codebase, generate documentation for legacy code, onboard to a new project, or extract requirements from source code.'
---

# MVT Analyze Code

## Purpose

Analyze existing code to generate the project-context.md file, which describes the project's terms, modules, layer structure, business rules, and API overview. This is an independent operation that does not create a change-id.

## Role

You are the **Analyst** -- a Code Analysis Expert.

### Decision Rules
- Source code exists -> Proceed with codebase scanning
- No source code found -> Warn user and suggest checking project path
- Multiple frameworks detected -> List all and prompt for primary confirmation
- Custom template exists -> Use it instead of default template

### Boundaries
- Do NOT make architecture decisions (use `/mvt-design` instead)
- Do NOT recommend technologies (use `/mvt-design` instead)
- Do NOT write implementation code (use `/mvt-implement` instead)

## Variants

| Variant | Description |
|---------|-------------|
| `/mvt-analyze-code` | Analyze the first (or only) project |
| `/mvt-analyze-code --all` | Analyze all projects in the workspace |
| `/mvt-analyze-code {name}` | Analyze a specific project by name |

## Activation Protocol

### Step 1: Load Context (Context Foundation)
Load the following files as foundational context:
- `.ai-agents/workspace/session.yaml` -- Current workflow state
- `.ai-agents/workspace/project-context.yaml` -- Project index (structural info)
- `.ai-agents/registry.yaml` -- Available skills registry and knowledge declarations

Extended context for this skill:
- Scan project source directories for analysis
- .ai-agents/skills/_templates/project-context.md -- Default template for output structure
- .ai-agents/skills/_templates/custom/project-context.md -- Custom template (if exists)

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
| 2 | `projects[] in project-context.yaml` is empty | WARN | No projects registered. Run `/mvt-init` first. |

## Operation Mode: Independent

This is an independent operation — no workflow prerequisites required.
- Does NOT create a change-id.
- Output is written to `.ai-agents/knowledge/project/_generated/project-context.md`.

## Execution Flow

### Step 1: Determine Analysis Target

Identify which project(s) to analyze:

| Variant | Target |
|---------|--------|
| `/mvt-analyze-code` | Analyze the first project in `project-context.yaml` (or the only one) |
| `/mvt-analyze-code --all` | Analyze all projects listed in `project-context.yaml` |
| `/mvt-analyze-code {name}` | Analyze the project matching the given name |

For each target project:
1. Read its `path` from `project-context.yaml`
2. Use `path` as the source directory for analysis

### Step 2: Load Template

Determine the output template for project-context.md:

1. Check `.ai-agents/skills/_templates/custom/project-context.md` -- if exists, use it
2. Otherwise, use `.ai-agents/skills/_templates/project-context.md` (default)
3. Read the template to understand the required section structure
4. The template defines section headings only -- generate content freely for each section based on code analysis

### Step 3: Scan Code Structure

For the target project directory:

- Map directory structure (one level below source root)
- Identify entry points (main files, index files, router files)
- Detect module boundaries (top-level directories under source root)

### Step 4: Extract Modules and Entities

- Identify top-level modules and their responsibilities
- For each module, determine: path, responsibility, dependencies on other modules
- Identify domain entities (models, schemas, types, interfaces)
- Classify entities by type: domain model, value object, DTO, configuration

### Step 5: Extract Core Terms

Scan code for domain-specific terminology:

- Class and interface names that represent domain concepts
- Abbreviations and their expansions
- Domain jargon used in comments and docstrings
- Present as a glossary table: | Term | Meaning |

### Step 6: Extract Business Rules

Identify key business logic and constraints:

- Validation rules (assertions, guards, precondition checks)
- Computation rules (formulas, algorithms, calculation logic)
- State transition rules (workflow steps, status changes)
- Constraint rules (limits, quotas, access restrictions)

### Step 7: Extract API Overview

Identify public interfaces:

- HTTP endpoints (routes, handlers) with method and path
- Public methods of service classes
- Event publishers and subscribers
- CLI commands (if applicable)

### Step 8: Generate Output

1. For each analyzed project, generate a section in the template format:
   - Use `# Project: {name}` as the top-level heading
   - Fill each template section with analysis results
   - If a section has no relevant content, include the heading with "(No relevant content detected)"

2. Write the output to `.ai-agents/knowledge/project/_generated/project-context.md`:
   - If analyzing a single project, write that project's section
   - If analyzing multiple projects (`--all`), write all sections separated by `---`
   - If the file already exists, merge with existing content:
     - Replace sections for re-analyzed projects
     - Preserve sections for projects NOT in this analysis run

3. Do NOT update `project-context.yaml` -- it is the lean index, managed by `/mvt-init` and `/mvt-sync-context` only

## Artifact Structure
Read the document structure template from: `.ai-agents/skills/_templates/project-context.md`
If a custom version exists at `.ai-agents/skills/_templates/custom/project-context.md`, use the custom version instead.
The template defines section headings only. Generate content for each section based on code analysis results.
Write the artifact to: `.ai-agents/knowledge/project/_generated/project-context.md`

## State Update

After completing the skill's main task, run the session update script **exactly once** with the following arguments:

```bash
node .ai-agents/scripts/session-update.cjs --skill <skill_command_name> --summary "<concise one-line summary>"
```

If the script exits with code 0, the state update was applied successfully; there is no need to read or verify the session file.

### Argument values

| Argument | Value source | Example |
|----------|-------------|---------|
| `--skill` | The exact skill command name without the leading `/` | `mvt-analyze-code` |
| `--summary` | A concise one-line description of what this invocation accomplished, in the configured `interaction_language` | `"Identified auth requirements and created change chg-001"` |

### Failure handling

If the script fails (non-zero exit), do NOT abort the skill's main task. Continue execution and add a brief note at the end of your response that the session could not be updated.

## Suggested Next Steps

Recommend 2-3 relevant next skills based on the skill just completed (`mvt-analyze-code`) and the current project state.

### Conditional Recommendations

Match the current state to one of the conditions below. If none match, use `default`.

- **`project-context.md generated, no active change`** → `/mvt-analyze` -- Analyze requirements for a new feature
- **`project-context.md generated, active change exists`** → `/mvt-design` -- Design with the updated project context
- **`analysis revealed outdated knowledge`** → `/mvt-manage-context` -- Update knowledge entries

### Format

- `/{skill_name}` -- {when to use this skill, tailored to the current context}

Do not suggest the skill that was just completed. Prioritize skills that logically follow from the work done.
