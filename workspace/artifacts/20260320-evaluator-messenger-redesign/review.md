# Code Review Report: Evaluator / Messenger Redesign

> Change ID: `20260320-evaluator-messenger-redesign`
> Date: 2026-03-20

---

## Summary

- **Overall Assessment**: Good
- **Files Reviewed**: 17 (8 rewritten, 5 modified, 3 deleted, 1 deleted test)
- **Critical Issues**: 0
- **Warnings**: 3
- **Suggestions**: 2

---

## Warnings

### W1: Orphaned config fields — `MessengerConfig.summarizeThreshold` and `fallbackToRaw`

**Files**: `src/core/types/config.types.ts:26-27`, `src/config/config.schema.ts:26-27`, `src/config/config.defaults.ts:28-29`

**Issue**: `summarizeThreshold` and `fallbackToRaw` were used by the old `summarize()` and `synthesizeFeedback()` methods. The new MvttMessenger no longer references them. They remain defined in types, zod schema, and defaults but are dead config.

**Suggestion**: Remove from `MessengerConfig`, `messengerSchema`, and `CONFIG_DEFAULTS`. Update test accordingly.

### W2: Orphaned config fields — `ConductorConfig.autoApproveThreshold` and `escalateThreshold`

**Files**: `src/core/types/config.types.ts:32-33`, `src/config/config.schema.ts:32-33`, `src/config/config.defaults.ts:33-34`

**Issue**: These were used by the old rule engine in `MvttConductor.applyRules()`. The new conductor uses pure LLM decision-making and never reads these values. Dead config.

**Suggestion**: Remove from `ConductorConfig`, `conductorSchema`, and `CONFIG_DEFAULTS`. Update test accordingly.

### W3: Orphaned types — `OutputSchema` and `StructuredData` in `messenger.types.ts`

**File**: `src/core/types/messenger.types.ts`

**Issue**: These types are defined but never imported anywhere. They were used by the old `IMessenger.structurize()` method which was removed.

**Suggestion**: Delete the entire file or remove these types. If the file becomes empty, also remove the re-export from `src/core/types/index.ts`.

---

## Suggestions

### S1: `PhaseResult.finalScore` is now always 0

**File**: `src/application/pipeline/worker-node-handler.ts:138`

**Issue**: The `PhaseResult` interface still has `finalScore: number`, and `worker-node-handler.ts` hardcodes it to `0`. With the dimension/score system removed, this field has lost its semantic meaning.

**Suggestion**: Consider removing `finalScore` from `PhaseResult` in a follow-up, or repurpose it if there's a future use case. Non-blocking for this change.

### S2: `config.evaluator.parseRetries` is unused

**Files**: `src/core/types/config.types.ts:21`, `src/config/config.schema.ts:21`

**Issue**: The new `MvttEvaluator` returns plain text and does no parsing, so `parseRetries` is never read. It was used by the old output parser for evaluation result retries.

**Suggestion**: Remove from `EvaluatorConfig` alongside the W1/W2 cleanup. Non-blocking.

---

## Highlights

- **Clean type decoupling**: All old evaluation type references (`EvaluationResult`, `EvaluationDimension`, etc.) are completely gone — zero stale imports confirmed via grep.
- **Well-structured data flow**: The new `WorkerNodeHandler` clearly expresses the routing branch (`shouldEvaluate` → evaluate path vs. skip path) with readable control flow.
- **Good error handling in Messenger**: Both `shouldEvaluate` (defaults to `true` on failure) and `synthesize` (falls back to concatenation) have sensible fallback behavior.
- **Interface design is minimal**: `IEvaluator`, `IConductor`, `IMessenger` are lean and implementation-agnostic — no MVTT-specific concepts leak into core.
- **Dimension subclasses fully cleaned**: All three files deleted, all factory code removed, no orphan references.
- **Build and tests pass**: `tsc --noEmit` clean, `config-schema.test.ts` 5/5 passing.
