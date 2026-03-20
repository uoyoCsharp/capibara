# Review Checklist: Role-Based Pipeline Architecture

## Layer Integrity
- [ ] Core layer (`src/core/`) has zero imports from application, roles, infrastructure, or config
- [ ] Application layer imports only from core
- [ ] Role implementations import only from core interfaces/types
- [ ] Infrastructure imports only from core interfaces/types
- [ ] Only `composition-root.ts` imports across all layers

## DI & Tokens
- [ ] New tokens added to `src/tokens.ts` (not scattered)
- [ ] Registration happens only in `composition-root.ts`
- [ ] No direct `container.resolve()` calls outside composition root
- [ ] Token naming follows `UPPER_SNAKE_TOKEN` convention

## Role Contracts
- [ ] New roles implement their core interface fully
- [ ] Roles do not depend on other role implementations
- [ ] Evaluators implement `getDimension()` returning their dimension name
- [ ] Worker commands go through `IMessenger.formatForWorker()`

## Pipeline & State Machine
- [ ] New phases added to `PipelineStateName` enum
- [ ] State transitions registered in transitions map
- [ ] Phase executor loop maintained: Worker -> Evaluator -> Conductor
- [ ] Budget checks present before phase execution

## Naming & Structure
- [ ] Files: `kebab-case.role.ts`
- [ ] Interfaces: `I` + PascalCase
- [ ] Classes: PascalCase
- [ ] Barrel exports updated in `index.ts`
- [ ] New modules placed in correct layer directory

## Error Handling
- [ ] Custom errors extend `AppError` from `core/errors/base.error.ts`
- [ ] Errors are domain-specific (not generic Error)
- [ ] Pipeline errors emitted via event bus before throwing
