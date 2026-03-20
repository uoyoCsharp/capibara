# Role-Based Pipeline Architecture

## Layer Structure

```
src/
  core/              # Domain core: interfaces, types, errors, constants
  application/       # Orchestration: pipeline, state machine, context, human interaction
  roles/             # Role implementations: worker, evaluator, conductor, messenger, trigger
  infrastructure/    # Adapters: CLI, GitHub, persistence, observability
  config/            # Configuration loading & validation (zod)
  composition-root.ts  # DI assembly (only file importing all layers)
  tokens.ts          # Centralized DI token definitions
  main.ts            # CLI entry point (commander)
```

## Dependency Rules

1. **core/** depends on nothing (pure types/interfaces)
2. **application/** depends on core/ only
3. **roles/** depends on core/ only (implements core interfaces)
4. **infrastructure/** depends on core/ only (implements core interfaces)
5. **config/** depends on core/types only
6. **composition-root.ts** is the only file that imports from ALL layers
7. **main.ts** imports only composition-root and core/types

## Role Model (Core Interfaces)

| Role | Interface | Responsibility |
|------|-----------|---------------|
| Worker | `IWorker` | Executes phase commands via Claude CLI |
| Evaluator | `IEvaluator` | Assesses worker output (quality/security/consistency) |
| Conductor | `IConductor` | Makes approve/revise/escalate decisions |
| Messenger | `IMessenger` | Formats context between roles |
| Trigger | `ITrigger` | Initiates pipeline from external events |

## Pipeline Flow (per phase)

```
Worker.executeCommand()
  -> Messenger.formatForEvaluator()
  -> Evaluator[].evaluate()  (parallel)
  -> Messenger.synthesizeFeedback()
  -> Conductor.decide()
  -> approve: next phase
     revise: retry current phase (max N attempts)
     escalate: human intervention
```

## DI Convention

- All tokens in `src/tokens.ts` as string constants (`UPPER_SNAKE_TOKEN`)
- Registration in `composition-root.ts` only
- Default lifecycle: singleton
- Evaluators registered as array (`IEvaluator[]`)

## Naming Conventions

| Object | Pattern | Example |
|--------|---------|---------|
| Interface | `I` + PascalCase | `IWorker`, `IEvaluator` |
| Class | PascalCase | `ClaudeCliWorker`, `RuleEngineConductor` |
| DI Token | UPPER_SNAKE + `_TOKEN` | `WORKER_TOKEN`, `CLI_ADAPTER_TOKEN` |
| File | kebab-case.role.ts | `claude-cli.worker.ts`, `pipeline.service.ts` |
| Directory | kebab-case | `cli-adapter/`, `state-machine/` |
| Barrel export | `index.ts` | Each module exports via index.ts |

## State Machine

Pipeline states follow pattern: `{phase}` -> `{phase}_evaluating` -> `{phase}_decision`
Terminal states: `completed`, `failed`, `human_intervention`

## Adding a New Role Implementation

1. Define interface in `src/core/interfaces/`
2. Define types in `src/core/types/`
3. Add token in `src/tokens.ts`
4. Implement in `src/roles/{role}/` or `src/infrastructure/`
5. Register in `src/composition-root.ts`

## Adding a New Evaluator Dimension

1. Create `src/roles/evaluator/{dimension}.evaluator.ts` implementing `IEvaluator`
2. Add to `evaluatorMap` in `composition-root.ts`
3. Add dimension name to config `evaluator.dimensions`
