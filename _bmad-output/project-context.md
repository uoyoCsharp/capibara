---
project_name: 'capibara'
user_name: 'uoyo'
date: '2026-03-27'
sections_completed: ['technology_stack', 'language_rules', 'framework_rules', 'testing_rules', 'code_quality', 'critical_rules']
status: 'complete'
rule_count: 46
optimized_for_llm: true
---

# Project Context for AI Agents

_This file contains critical rules and patterns that AI agents must follow when implementing code in this project. Focus on unobvious details that agents might otherwise miss._

---

## Technology Stack & Versions

- **Runtime**: Node.js >= 22.0.0, ESM (`"type": "module"`)
- **Language**: TypeScript (ES2023 target, NodeNext module, strict mode, decorators enabled)
- **Package Manager**: pnpm
- **CLI**: commander ^13.1.0
- **Database**: better-sqlite3 ^12.8.0 (native C++ module)
- **DI**: tsyringe ^4.8.0 + reflect-metadata ^0.2.2
- **Logging**: pino ^9.6.0
- **Validation**: zod ^3.24.0
- **Events**: emittery ^1.1.0
- **Testing**: vitest (v8 coverage)
- **Formatting**: prettier (single quotes, trailing commas, 100 width)

## Critical Implementation Rules

### Language-Specific Rules

- **ESM Only**: All imports must use ESM syntax. Use `.js` extensions in import paths (TypeScript NodeNext resolution requires this even for `.ts` files).
- **Strict Mode**: `tsconfig.json` enables full strict mode — no `any` types, no implicit returns, strict null checks enforced.
- **Decorators**: `experimentalDecorators` + `emitDecoratorMetadata` enabled for tsyringe DI. Every injectable class must have `@injectable()` decorator.
- **reflect-metadata**: Must import `reflect-metadata` at application entry point (`composition-root.ts`) before any DI resolution.
- **Zod for Validation**: Use Zod schemas for all external input validation (config, CLI args, API responses). Do not use manual type guards.
- **Error Handling**: Custom error classes in `src/core/errors/`. Throw typed errors, not plain `Error` or strings.
- **Interface Convention**: All interfaces use `I` prefix (e.g., `IWorker`, `ICommandExecutor`). Defined in `src/core/interfaces/`.
- **Type Definitions**: All shared types in `src/core/types/`. Do not define types inline in implementation files.
- **DI Tokens**: Defined as `Symbol` constants in `src/tokens.ts` using SCREAMING_SNAKE_CASE (e.g., `CONFIG_TOKEN`, `LOGGER_TOKEN`).
- **No Default Exports**: Use named exports throughout the codebase.

### Framework-Specific Rules

- **Layered Architecture**: `application/` → `core/` (interfaces/types) ← `infrastructure/`. Never import from `infrastructure/` in `application/` directly — depend on `core/` interfaces.
- **DI Registration**: All service bindings in `src/composition-root.ts`. Use token-based registration (`container.register(TOKEN, { useClass: Impl })`). Never use `new` for services outside composition root.
- **Role Abstractions**: Five core roles — `IWorker`, `IEvaluator`, `IConductor`, `IMessenger`, `ITrigger`. New implementations go in `src/implementations/{framework-name}/`.
- **Pipeline DAG**: Pipeline phases execute via DAG executor in `src/application/pipeline/`. Each phase has a dedicated node handler. Add new phases by creating a handler and registering in pipeline definition.
- **State Machine**: Generic state machine in `src/application/state-machine/` drives pipeline state transitions. State changes emit events via `IEventBus`.
- **Event Bus**: Use Emittery-based `IEventBus` for cross-cutting communication. Subscribe in services, do not use direct method calls between layers.
- **Config Pattern**: Config loaded via `src/config/config.loader.ts`, validated with Zod schemas in `config.schema.ts`, defaults in `config.defaults.ts`. Access config through DI token, not direct import.
- **CLI Commands**: All commands defined in `src/main.ts` using Commander. Each command delegates to an application service — no business logic in command handlers.
- **Persistence Stores**: Multiple store implementations in `src/infrastructure/persistence/` (SQLite, JSON, File). All implement interfaces from `core/interfaces/`.

### Testing Rules

- **Framework**: Vitest with global test utilities enabled. Node environment.
- **Test Location**: All tests in `tests/` directory, mirroring `src/` structure. Pattern: `tests/unit/*.test.ts`, `tests/diagnostic/*.ts`.
- **File Naming**: Test files use `{feature-name}.test.ts` convention.
- **Coverage**: v8 provider. `src/main.ts` and `src/composition-root.ts` excluded from coverage.
- **Mocking DI**: When testing services, mock dependencies by providing fake implementations of `core/interfaces/` — do not mock tsyringe container directly.
- **No Integration Tests Yet**: Current tests are unit-level. Keep tests focused on single-class behavior.
- **Diagnostic Tests**: Non-automated diagnostic scripts in `tests/diagnostic/` for manual verification of external integrations (e.g., CLI spawn behavior).

### Code Quality & Style Rules

- **Prettier Config**: 100 char width (markdown/JSON: 120), single quotes, trailing commas, 2-space indent, LF line endings. Run `pnpm format` before committing.
- **No ESLint**: Project uses Prettier only for formatting. No linter configured.
- **File Naming**: kebab-case for all source files (e.g., `claude-cli-adapter.ts`, `config.loader.ts`). Dot notation for layer/type separation (e.g., `config.schema.ts`, `config.defaults.ts`).
- **Class Naming**: PascalCase (e.g., `RequirementOrchestrator`, `SqliteStore`).
- **Directory Structure**: Feature-based organization within layers. Each feature gets its own directory under the appropriate layer (`application/`, `infrastructure/`).
- **Core as Contract Layer**: `src/core/` contains only interfaces, types, constants, and errors — no implementation logic.
- **No Barrel Exports**: No `index.ts` barrel files. Import directly from specific files.
- **Comments**: Minimal comments. Code should be self-documenting. Only comment non-obvious business logic or workarounds.

### Critical Don't-Miss Rules

- **NEVER import from `infrastructure/` in `application/` layer**. Always depend on `core/interfaces/`. Violating this breaks the dependency inversion principle that the entire architecture relies on.
- **ALWAYS use `.js` extension in imports** even though source files are `.ts`. NodeNext module resolution requires this. Forgetting causes runtime `ERR_MODULE_NOT_FOUND`.
- **ALWAYS add `@injectable()` decorator** to any new class registered in the DI container. Missing this causes cryptic tsyringe resolution errors at runtime.
- **NEVER instantiate services with `new`** outside `composition-root.ts`. All service creation goes through the DI container.
- **NEVER put business logic in `src/main.ts`**. CLI command handlers must only parse args and delegate to application services.
- **NEVER store runtime state in `src/core/`**. Core is for contracts only (interfaces, types, constants, errors).
- **better-sqlite3 is synchronous**. Unlike most Node.js database drivers, all operations are sync. Do not wrap in `async/await` unnecessarily.
- **Emittery events are typed**. When adding new events, define the event type map in the appropriate interface first.
- **Config is immutable after load**. Do not mutate config objects at runtime. If you need runtime-variable state, use a dedicated state store.
- **pnpm only**. Do not use `npm` or `yarn`. Lock file is `pnpm-lock.yaml`.

---

## Usage Guidelines

**For AI Agents:**

- Read this file before implementing any code
- Follow ALL rules exactly as documented
- When in doubt, prefer the more restrictive option
- Update this file if new patterns emerge

**For Humans:**

- Keep this file lean and focused on agent needs
- Update when technology stack changes
- Review quarterly for outdated rules
- Remove rules that become obvious over time

Last Updated: 2026-03-27
