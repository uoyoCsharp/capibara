# Code Review Report: Worker & Pipeline Abstraction (v2)

> Change ID: `20260320-worker-pipeline-abstraction`
> 日期: 2026-03-20
> 阶段: review

---

## Summary

- **Overall Assessment**: Good
- **Files Reviewed**: 29 (20 new, 6 modified, 3 config)
- **Critical Issues**: 0
- **Warnings**: 3
- **Suggestions**: 3

### Build Status
`npx tsc --noEmit` passes with **zero errors**.

---

## Warnings

### W1: Misleading `tokensUsed` variable name
**File**: `src/infrastructure/executors/claude-cli.executor.ts:38`
**Issue**: `tokensUsed = parsed.num_turns ?? 0` — the variable name implies token count but actually stores turn count. This is a pre-existing pattern from the original `ClaudeCliWorker`, carried over faithfully. The `ClaudeCliJsonOutput` type lacks a token count field.
**Suggestion**: Rename to `numTurns` or remove the duplicate variable:
```typescript
// Current (misleading)
tokensUsed = parsed.num_turns ?? 0;
numTurns = parsed.num_turns ?? 0;

// Suggested
numTurns = parsed.num_turns ?? 0;
// Remove tokensUsed from metadata, or set to 0 until Claude CLI exposes token count
```

### W2: `PipelineDefinitionLoader` uses `require()` for YAML
**File**: `src/infrastructure/pipeline/pipeline-definition.loader.ts:41`
**Issue**: Uses `require('yaml')` inside a `try/catch` for optional YAML support. In strict ESM mode, `require()` is not available without `createRequire`. This will throw a ReferenceError if a `.yaml` pipeline definition is loaded.
**Suggestion**: Use `createRequire(import.meta.url)` or dynamic `await import('yaml')`:
```typescript
const { default: yaml } = await import('yaml');
```

### W3: `resume()` is unimplemented
**File**: `src/application/pipeline/pipeline.service.ts:130`
**Issue**: `resume()` throws `Error('Pipeline resume is not yet implemented for DAG-based pipelines')`. The CLI `main.ts` exposes a `resume` command that will fail at runtime.
**Suggestion**: Acceptable for MVP. Consider adding a more descriptive error or disabling the CLI `resume` subcommand until implemented.

---

## Suggestions

### S1: Consider adding `IPromptFramework` to `MvttWorker` constructor
**File**: `src/implementations/mvtt/mvtt-worker.ts`
**Suggestion**: The design doc shows `MvttWorker` receiving `IPromptFramework`, but the implementation omits it. While the Messenger currently handles prompt assembly, having framework access in Worker could be useful for future prompt customization. Non-blocking — current behavior is correct since Messenger handles `formatForWorker()`.

### S2: `MvttEvaluator.parseResult()` retry logic is redundant
**File**: `src/implementations/mvtt/mvtt-evaluator.ts:67-78`
**Suggestion**: The retry loop calls `outputParser.parseEvaluationResult()` multiple times on the same response, which will produce the same result each time (no randomness). The fallback already lives inside `parseEvaluationResult()`. The retry loop can be simplified to a single call.

### S3: DAGExecutor parallel mutation of shared `context`
**File**: `src/application/pipeline/dag-executor.ts:57-59`
**Suggestion**: When `readyNodes.length > 1`, multiple `NodeExecutor.execute()` calls run in parallel and all mutate the shared `context` object (e.g., `context.currentPhase`, `context.phaseAttempts`). In the current default linear pipeline this never happens (only 1 ready node at a time), but future DAG configurations with parallel nodes will hit race conditions. Consider cloning context per node or using node-local state.

---

## Highlights

- **Clean three-layer decoupling**: Core → Implementations → Infrastructure is strictly enforced. Zero layer violations across all 29 files.
- **Single-call DI registration**: `registerMvtt(container)` in composition-root.ts is elegant and extensible.
- **DAG validation**: Kahn's algorithm implementation is correct and includes edge reference validation.
- **Faithful migration**: All business logic (rule engine, evaluation parsing, feedback synthesis, permissions) was ported without behavioral changes.
- **Generic state machine**: Dynamic node state tracking is much cleaner than the old 39-entry enum + transition table.

---

## Architecture Compliance Checklist

| Check | Status |
|-------|--------|
| Core layer has zero external imports | ✓ Pass |
| Application layer imports only from core | ✓ Pass |
| Implementations import only from core + sibling files | ✓ Pass |
| Infrastructure imports only from core | ✓ Pass |
| Only composition-root.ts crosses all layers | ✓ Pass |
| New tokens in `src/tokens.ts` | ✓ Pass |
| Registration only in composition-root.ts | ✓ Pass |
| Roles implement core interfaces fully | ✓ Pass |
| Worker commands go through IMessenger.formatForWorker() | ✓ Pass |
| Phase executor loop maintained: Worker → Evaluator → Conductor | ✓ Pass |
| Budget check present before execution | ✓ Pass |
| Barrel exports updated | ✓ Pass |
| Config types/schema/defaults aligned | ✓ Pass |

---

**Suggested Next Steps**:
- `#fix W2` to fix the ESM `require()` issue in PipelineDefinitionLoader
- `#test` to generate unit tests for the new modules
