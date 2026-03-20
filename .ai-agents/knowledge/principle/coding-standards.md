# Coding Standards - capibara

## Naming Conventions
| Object | Rule | Example |
|--------|------|---------|
| Interface | `I` + PascalCase | `IWorker`, `IEvaluator` |
| Type/Enum | PascalCase | `Phase`, `EvaluationVerdict`, `PipelineStateName` |
| Class | PascalCase | `ClaudeCliWorker`, `RuleEngineConductor` |
| DI Token | UPPER_SNAKE + `_TOKEN` | `WORKER_TOKEN`, `CLI_ADAPTER_TOKEN` |
| File | kebab-case.role.ts | `claude-cli.worker.ts`, `pipeline.service.ts` |
| Directory | kebab-case | `cli-adapter/`, `state-machine/` |

## Module Organization
- Each module has barrel exports via `index.ts`
- Imports use `.js` extension (ESM requirement)
- Type-only imports use `import type {}`

## DI Rules
- All tokens defined in `src/tokens.ts` (string tokens for ESM compatibility)
- All registration in `src/composition-root.ts`
- Default lifecycle: `registerSingleton`
- No `container.resolve()` outside composition root
- Unit tests inject mocks directly, no real container

## Error Handling
- Custom errors extend `AppError` (base class in `core/errors/`)
- Domain-specific error classes (e.g., `BudgetExceededError`, `CliExecutionError`)
- Pipeline errors emitted via event bus before propagation

## Code Style
- TypeScript strict mode enforced
- Prettier for formatting (see `.prettierrc`)
- No `any` types (use `unknown` when needed)
- Prefer `const` over `let`
- Use `experimentalDecorators` + `emitDecoratorMetadata` for tsyringe
