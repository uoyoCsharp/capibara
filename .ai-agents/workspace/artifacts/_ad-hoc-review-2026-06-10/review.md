# Code Review Report

## Summary

| Severity | Count |
|----------|-------|
| Critical | 0 |
| Warning | 1 |
| Suggestion | 2 |

**Verdict**: Approve with comments

The implementation cleanly follows existing patterns, respects the hexagonal architecture, and introduces no layer violations or security issues. One performance concern regarding synchronous process spawning during bootstrap should be addressed before production release.

## Critical Issues

None.

## Warnings

### W-1: `execSync` blocks Electron main thread during bootstrap

**File**: `apps/electron/src/core/bootstrap/composition-root.ts:55-69`
**Severity**: Warning
**Observation**: `resolveOpenCodeExecutable()` uses `execSync` with a 3-second timeout to locate the `opencode` binary. This blocks the Electron main thread during `bootstrap()`. On systems where `opencode` is not installed, this adds up to 3 seconds to app startup time.
**Recommendation**: Consider deferring agent discovery to a background task or using async `child_process.exec` with a promise wrapper. Alternatively, cache the discovery result to a file so subsequent launches skip the PATH lookup.

## Suggestions

### S-1: Registry array uses inline type instead of existing `AgentRegistryEntry`

**File**: `apps/electron/src/core/bootstrap/composition-root.ts:96-103`
**Severity**: Suggestion
**Observation**: The registry array is annotated with an explicit inline type:
```typescript
const registry: Array<{
  id: string;
  name: string;
  command: string;
  args: string[];
  env?: Record<string, string>;
  mcpTransport: 'sse' | 'http';
}> = [...]
```
The codebase already defines `AgentRegistryEntry` in `acp.types.ts` with the same shape.
**Recommendation**: Import and use `AgentRegistryEntry` for consistency:
```typescript
const registry: AgentRegistryEntry[] = [...]
```

### S-2: No loading/error feedback in `handleSetDefault`

**File**: `apps/electron/src/renderer/components/settings/AgentConfigPanel.tsx:22-27`
**Severity**: Suggestion
**Observation**: The `handleSetDefault` function silently fails if the IPC call returns an error. Users receive no visual feedback about success or failure.
**Recommendation**: Add a loading state to disable the button during the request, and show a toast notification on success/failure using the existing toast system.

## Highlights

- Clean separation of concerns: agent discovery logic is isolated in a single function with clear responsibility.
- Consistent use of existing patterns: the `set-default-agent` IPC handler follows the same structure as other settings handlers (e.g., `scheduler:pause`).
- Proper fallback chain: `OPENCODE_EXECUTABLE` env var -> PATH lookup -> skip registration with warning.
- Locale strings added for both `en-US` and `zh-CN`, maintaining i18n consistency.
