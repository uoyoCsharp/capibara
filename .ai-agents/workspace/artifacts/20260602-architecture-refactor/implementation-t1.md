---
id: 'implement-output'
version: '1.0'
skill: 'mvt-implement'
change_id: '20260602-architecture-refactor'
task_id: 't1-layering-ci-guard'
---

# Implementation: G-1 Layering CI Guard (dependency-cruiser) + arch:check gate

## Implementation Plan

Add `dependency-cruiser` as a per-PR CI gate to enforce the layer dependency DAG from architecture-final-v2 §7/§8. Four forbidden rules detect reverse/cross-layer/cross-module-concrete violations; all start at `severity: 'warn'` so existing violations do not block CI. The §8.2 allowed-edge whitelist is documented in the config for future conversion to `allowed` rules.

## Changes

| File | Action | Intent |
|------|--------|--------|
| `apps/electron/.dependency-cruiser.cjs` | create | 4 forbidden rules + §8.2 whitelist + tsPreCompilationDeps option |
| `apps/electron/package.json` | modify | Add `arch:check` script; add `dependency-cruiser` devDependency |

## Implementation Details

### `.dependency-cruiser.cjs`

Four forbidden rules per ADR-02 / §8.1:

1. **no-core-to-adapters** — `modules/` must not import `infrastructure/`, `mcp/`, or `ipc-handlers/`
2. **d0-must-stay-leaf** — `modules/organization/` must not import other domain modules
3. **no-upward-d1-to-d3** — D1 modules (conversation, workflow, execution, acp, planning) must not import D3 (coordination, orchestrator)
4. **no-cross-module-concrete** — cross-module imports must go through `interfaces/`, not `services/` or `engines/`; same-module imports allowed via capture-group backref

Key implementation decision: `tsPreCompilationDeps: true` is enabled so `import type` from concrete classes is also flagged. Type-only imports still couple the consumer to the concrete class shape and violate the "depend on interfaces, not implementations" principle.

§8.2 allowed-edge whitelist is documented as a structured comment block. It will be converted to `allowed` rules once OP-1/OP-2 reduce the violation count.

### `package.json`

Added `arch:check` script: `depcruise src/core --config .dependency-cruiser.cjs`

Added `dependency-cruiser` as devDependency.

## Design Compliance

| Check | Result |
|-------|--------|
| Files touched == Change Tracking | Passed — only `.dependency-cruiser.cjs` (new) and `package.json` (modified) |
| Each file lives in assigned module/layer | Passed — build tooling per design §8 |
| Public interfaces match Key Interfaces | N/A — no public interfaces changed |
| Forbidden cross-layer imports absent | Passed — no new imports introduced |
| Error handling at boundaries only | N/A — config file, no runtime error handling |
| No new external deps not in design ADRs | Passed — dependency-cruiser is the tool specified in ADR-02 |

## Change Tracking

**Created:**
- `apps/electron/.dependency-cruiser.cjs`

**Modified:**
- `apps/electron/package.json` (arch:check script + dependency-cruiser devDependency)

## Deviations from Design

1. **tsPreCompilationDeps: true** — Not mentioned in §8.1 config but required because all 20 current cross-module concrete imports are `import type`. Without this option, depcruise reports 0 violations, defeating the guard's purpose. This is a necessary implementation-level addition.

2. **§8.2 whitelist as comments, not `allowed` rules** — The design implies §8.2 should be enforced as `allowed` rules. Implementing them now would flag every cross-module edge not in the whitelist (including same-layer dependencies) as violations, creating excessive noise. The whitelist is documented in the config and will be converted to `allowed` rules once OP-1/OP-2 reduce violations.

3. **Path constant `C = 'src/core'`** — The design uses `C = 'apps/electron/src/core'` but the `arch:check` script runs from `apps/electron/`, so paths must be relative to that directory. Functionally equivalent.

## Self-Check Results

- **TypeScript**: `tsc --noEmit` — passed (exit 0)
- **arch:check**: `pnpm arch:check` — passed (exit 0, 20 warnings)
- **Violation summary**: 20 warnings (all `no-cross-module-concrete`), 0 errors, 0 violations for other 3 rules

## Open TODOs

- Flip `no-cross-module-concrete` severity from `warn` to `error` after OP-1/OP-2 extract service/engine interfaces
- Convert §8.2 whitelist from comments to `allowed` rules once cross-module violations are resolved
- Consider adding `--output-type dot` for visual DAG output in CI artifacts
