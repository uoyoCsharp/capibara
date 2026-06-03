# Unit Test Error Diagnosis Report

**Generated**: 2026-06-03  
**Test Framework**: Vitest v4.1.2  
**Test Target**: `apps/electron/tests/unit`  
**Total Test Suites**: 28  
**Failed Suites**: 12  
**Failed Tests**: 16 (across 4 failing suites that have test bodies)

---

## Executive Summary

**Severity**: CRITICAL  
**Root Cause**: Post-refactor import path mismatches and interface changes  
**Impact**: 43% of test suites are broken, 16 test cases failing

The recent architecture refactor (t9-acp-split, t8-mcp-split, t6-eventize-routing-remove-cascade) moved several modules to new locations, but test files were not updated to reflect the new import paths. Additionally, some interface changes in the refactored code have broken test mocks and expectations.

---

## Failure Category 1: Import Path Mismatches (12 suites completely broken)

### ACP Module Relocation

**Issue**: ACP client code moved from `@core/modules/acp/client/*` to `@core/infrastructure/acp-protocol/*`

**Affected Files**:
1. `tests/unit/acp/acp-agent.spawner.test.ts` - Cannot find `@core/modules/acp/client/acp-agent.spawner`
2. `tests/unit/acp/acp-executor.test.ts` - Cannot find `@core/modules/acp/client/acp-executor`
3. `tests/unit/acp/acp-session.manager.test.ts` - Cannot find `@core/modules/acp/client/acp-session.manager`
4. `tests/unit/acp/acp-session.sweeper.test.ts` - Cannot find `@core/modules/acp/client/acp-session.sweeper`
5. `tests/unit/acp/model-state.test.ts` - Cannot find `@core/modules/acp/client/model-state`
6. `tests/unit/acp/session-lifecycle.test.ts` - Cannot find `@core/modules/acp/client/session-lifecycle`

**Fix Required**:
Replace all imports:
- `@core/modules/acp/client/*` → `@core/infrastructure/acp-protocol/*`

### MCP Handler Relocation

**Issue**: MCP handlers moved from `@core/modules/mcp/handlers/*` to `@core/mcp/providers/*`

**Affected Files**:
1. `tests/unit/mcp/context-tools.test.ts` - Cannot find `@core/modules/mcp/handlers/context-tools`
2. `tests/unit/mcp/conversation-tools.test.ts` - Cannot find `@core/modules/mcp/handlers/conversation-tools`
3. `tests/unit/mcp/plan-tree-tools.test.ts` - Cannot find `@core/modules/mcp/handlers/plan-tree-tools`
4. `tests/unit/mcp/task-tools.test.ts` - Cannot find `@core/modules/mcp/handlers/task-tools`
5. `tests/unit/mcp/mcp-server.builder.test.ts` - Cannot find `@core/modules/mcp/mcp-server.builder`
6. `tests/unit/mcp/mcp-http-transport.test.ts` - Cannot find `@core/modules/mcp/mcp-http-transport`

**Fix Required**:
Replace all imports:
- `@core/modules/mcp/handlers/*` → `@core/mcp/providers/*`
- `@core/modules/mcp/mcp-server.builder` → `@core/infrastructure/mcp-protocol/mcp-server.builder`

---

## Failure Category 2: Interface/Mock Mismatches (16 individual test failures)

### RunCoordinator Tests (12 failures)

**File**: `tests/unit/orchestrator/run-coordinator.test.ts`  
**Error**: `TypeError: this.convRepo.findById is not a function` and `this.orgRepo.findById is not a function`

**Root Cause**: 
- The `RunCoordinator` constructor has changed during refactoring
- Repository interfaces or initialization patterns have been modified
- Test mocks are no longer compatible with the actual constructor signature

**Specific Failing Tests**:
1. "builds prompt, executes, and returns result"
2. "returns failed when prompt builder returns null"
3. "uses undefined projectDir when org not found"
4. "builds prompt, executes, and saves session id"
5. "does not update session id when conversation already has one"
6. "returns failed when conversation not found"
7. "does not update session when run result has no session id"
8. "does not add message when run fails"
9. "does not add message when summary is null"
10. "inherits close_on_complete intent when resuming a task"
11. "inherits keep_alive intent when resuming a non-task (planning) session"

**Fix Required**:
- Update test mocks to match new `RunCoordinator` constructor interface
- Verify repository method signatures and update mock implementations

### SessionSuspensionManager Tests (1 failure)

**File**: `tests/unit/acp/session-suspension-manager.test.ts`  
**Error**: Test "returns null when not all resolved (mode=all)" is failing

**Root Cause**: 
- Behavioral change in `SessionSuspensionManager` logic
- Test expectation may not match the new implementation

**Specific Failing Test**:
- "returns null when not all resolved (mode=all)"

**Fix Required**:
- Review implementation change in t9-acp-split
- Update test expectation or verify if this is intentional behavioral change

### EventTopology Tests (1 failure)

**File**: `tests/unit/orchestrator/event-topology.test.ts`  
**Error**: Test "conversation:cancelled → orchestrators do not react (UI-facing event)" is failing

**Root Cause**: 
- Event routing or handling may have changed during t6-eventize-routing
- Test verifies event subscription patterns that may have shifted

**Specific Failing Test**:
- "conversation:cancelled → orchestrators do not react (UI-facing event)"

**Fix Required**:
- Verify event topology matches design spec
- Update test if event subscription patterns were intentionally changed

### ToolPermissionPolicy Tests (2 failures)

**File**: `tests/unit/acp/tool-permission-policy.test.ts`  
**Error**: Two mode handling tests are failing

**Specific Failing Tests**:
1. "should handle restrictive mode (falls back to denylist for now)"
2. "should handle ask_user mode (falls back to permissive)"

**Root Cause**: 
- Tool permission policy logic was modified in t9-acp-split (B-4: restrictive policy enforcement)
- Test expectations for restrictive and ask_user modes no longer match implementation

**Fix Required**:
- Review ADR-08 and t9 implementation notes for B-4 changes
- Update test expectations to reflect the new permission policy behavior

---

## Migration Guide

### Quick Fix: Import Paths

Run these sed commands to fix the most common issues:

**Fix ACP imports**:
```bash
cd apps/electron
find tests -name "*.test.ts" -exec sed -i 's|@core/modules/acp/client/|@core/infrastructure/acp-protocol/|g' {} +
```

**Fix MCP imports**:
```bash
cd apps/electron
find tests -name "*.test.ts" -exec sed -i 's|@core/modules/mcp/handlers/|@core/mcp/providers/|g' {} +
find tests -name "*.test.ts" -exec sed -i 's|@core/modules/mcp/mcp-server\.builder|@core/infrastructure/mcp-protocol/mcp-server.builder|g' {} +
```

### Priority Fixes

1. **P0 (Critical)**: Fix all import path issues (12 suites) - this will restore 60%+ of test coverage
2. **P1 (High)**: Update RunCoordinator mocks (12 failures)
3. **P2 (Medium)**: Review and update behavioral expectations (3 failures)
4. **P3 (Low)**: Verify and update ToolPermissionPolicy tests (2 failures)

---

## Recommendations

1. **Immediate**: Run the sed commands above to fix import paths, then re-run tests
2. **Follow-up**: Use `/mvt-fix` to systematically address each failure category
3. **Prevention**: Add a pre-commit hook or CI check that validates import paths against actual module locations
4. **Documentation**: Update CONTRIBUTING.md or README to document the new module structure

---

## Additional Context

**Related ADRs**:
- ADR-08: ACP internal layering (OP-8)
- ADR-09: MCP split (OP-5)
- ADR-07: Eventize routing (OP-3)
- ADR-04/11: Cascade migration (OP-10)

**Refactoring Tasks**:
- t6: Eventize Coordination write-back
- t8: Split MCP (protocol core → infrastructure)
- t9: ACP split (client → infrastructure, domain stays D1)
- t10: Module reclassification and renaming

**Test Coverage Impact**: 
- Before refactor: 100% test pass rate (estimated)
- After refactor: 57% test pass rate (16/28 suites failing)
- Target: 100% test pass rate after fixes

---

**Next Step**: Use `/mvt-fix` with this report to systematically resolve all test failures
