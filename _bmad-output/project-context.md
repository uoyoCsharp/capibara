---
project_name: 'capibara'
user_name: 'uoyo'
date: '2026-04-16'
sections_completed: ['technology_stack', 'language_rules', 'framework_rules', 'testing_rules', 'code_quality', 'workflow_rules', 'critical_rules']
status: 'complete'
rule_count: 68
optimized_for_llm: true
---

# Project Context for AI Agents

_This file contains critical rules and patterns that AI agents must follow when implementing code in this project. Focus on unobvious details that agents might otherwise miss._

---

## Technology Stack & Versions

- **Platform**: Electron 41.1.0 (desktop app with main/preload/renderer processes)
- **Runtime**: Node.js >= 22.0.0, ESM (`"type": "module"`)
- **Language**: TypeScript 5.8.0 (ES2022 target, Bundler module resolution, strict mode, decorators enabled)
- **Frontend**: React 19.2.4 (react-jsx transform), Tailwind CSS 4.2.1, Radix UI primitives
- **State Management**: Zustand 5.0.12 (renderer process)
- **Build**: electron-vite 5.0.0, Vite 7.0.0, electron-builder 26.8.1
- **Package Manager**: pnpm 10.0.0 (monorepo workspace)
- **Database**: better-sqlite3 12.8.0 (synchronous, native C++ module)
- **DI**: tsyringe 4.8.0 + reflect-metadata 0.2.2
- **Validation**: Zod 3.24.0
- **Logging**: pino 9.6.0
- **Icons**: @phosphor-icons/react
- **UI Utilities**: class-variance-authority (CVA), clsx + tailwind-merge via `cn()`
- **Testing**: Vitest 4.1.0 (v8 coverage)
- **Formatting**: Prettier 3.4.0 (single quotes, trailing commas, 100 width)
- **No ESLint configured**

## Critical Implementation Rules

### Language-Specific Rules

- **ESM Only**: All imports use ESM syntax. Unlike the old NodeNext setup, this project uses Bundler module resolution — do NOT add `.js` extensions to import paths. Use bare specifiers and path aliases instead.
- **Strict Mode**: Full strict mode enabled — no `any` types, no implicit returns, strict null checks enforced.
- **Decorators**: `experimentalDecorators` + `emitDecoratorMetadata` enabled for tsyringe DI.
- **Path Aliases**: Use `@shared/*`, `@main/*`, `@renderer/*`, `@preload/*` aliases (defined in `tsconfig.json` and `electron.vite.config.ts`). Never use relative paths that cross process boundaries.
- **Zod for Validation**: Use Zod schemas for all external input validation (IPC inputs, config, API responses). Do not use manual type guards.
- **Error Handling**: Custom error hierarchy extending `CapibaraError` in `src/main/core/errors/`. All domain errors must include a structured `code` property (e.g., `'NOT_FOUND'`, `'VALIDATION_ERROR'`). Support error chaining with `cause` option. Never throw plain `Error` or strings.
- **Interface Convention**: All interfaces use `I` prefix (e.g., `ILogger`, `ITaskRepository`). Defined in `src/main/core/interfaces/`, one interface per file.
- **Type Definitions**: All shared types in `src/main/core/types/` or `src/shared/`. Do not define types inline in implementation files.
- **DI Tokens**: Defined as `Symbol` constants in `src/main/core/tokens.ts` using `SCREAMING_SNAKE_CASE_TOKEN` (e.g., `LOGGER_TOKEN`, `ORGANIZATION_REPO_TOKEN`).
- **No Default Exports**: Use named exports throughout the codebase.

### Framework-Specific Rules

#### Electron Architecture (Three-Process Model)

- **Main Process** (`src/main/`): Application logic, database, DI container, IPC handlers. Node.js APIs available.
- **Preload** (`src/preload/`): Context bridge only. Exposes `window.capibara` API via `contextBridge.exposeInMainWorld()`. Builds to CommonJS (`.cjs`).
- **Renderer** (`src/renderer/`): React UI. No direct Node.js access — all main process communication via `window.capibara` API.

#### Main Process — Clean Architecture

- **Layered Architecture**: `application/` -> `core/` (interfaces/types) <- `infrastructure/`. Never import from `infrastructure/` in `application/` — depend on `core/` interfaces.
- **DI Registration**: All service bindings in `src/main/composition-root.ts`. Uses manual instantiation with `container.register<Type>(TOKEN, { useValue: instance })`. Dependencies injected via constructor parameters in dependency order.
- **Composition Root Lifecycle**: `bootstrap()` initializes all services, runs migrations, seeds data, registers IPC handlers. `shutdown()` cleans up resources.
- **Core as Contract Layer**: `src/main/core/` contains only interfaces, types, constants, tokens, and errors — no implementation logic.
- **No Barrel Exports**: No `index.ts` barrel files. Import directly from specific files.

#### IPC Communication

- **Centralized Contracts**: All IPC channels, types, and validation schemas defined in `src/shared/contracts.ts`. This is the single source of truth for main/renderer communication.
- **Channel Naming**: `capibara:{domain}:{action}` format (e.g., `capibara:org:create`, `capibara:session:start`).
- **Result Type**: All IPC responses use `DesktopResult<T>` discriminated union: `{ ok: true; data: T } | { ok: false; error: { code: string; message: string } }`.
- **Event System**: Main process pushes events to renderer via `DesktopEvent` union type through a single `rendererEvent` channel. Renderer subscribes via `window.capibara.subscribe()` which returns a cleanup function.
- **Input Validation**: All IPC inputs validated with Zod schemas defined in `contracts.ts` at the IPC boundary.

#### Renderer — React UI

- **Component Pattern**: Functional components with TypeScript props interfaces. Export as named functions (`export function ComponentName()`).
- **Styling**: Tailwind CSS utility classes. Use `cn()` helper (clsx + tailwind-merge) for conditional classes. Use CVA (`class-variance-authority`) for component variants.
- **UI Primitives**: Radix UI for accessible primitives (Dialog, Select, Tabs, etc.). Wrapped in `src/renderer/components/ui/` with project styling.
- **Icons**: `@phosphor-icons/react` exclusively. Do not mix icon libraries.
- **State Management**: Zustand stores in `src/renderer/store/`. Named `use{Entity}Store`. Interface defines state + actions. Async actions return promises and call `window.capibara` API.
- **Zustand Selectors**: Use fine-grained selectors `useAppStore((s) => s.field)` — never destructure the entire store to avoid unnecessary re-renders.
- **Custom Hooks**: Located in `src/renderer/hooks/`. Named `use{Feature}`. Handle data fetching, subscriptions, and lifecycle. Use `useRef` to prevent duplicate initialization calls.
- **i18n**: Type-safe nested object structure. Access via `useT()` hook (e.g., `t.planning.phaseDiverge`). Locales: `en-US`, `zh-CN`. All locale types defined in `src/shared/locale/types.ts`. When adding UI text, add keys to both locale files.

#### Infrastructure Layer

- **Adapters**: Implement core interfaces (e.g., `ICliAdapter`). Located in `src/main/infrastructure/adapters/`.
- **Repositories**: Follow `I{Entity}Repository` pattern. SQLite implementations in `src/main/infrastructure/persistence/`.
- **better-sqlite3 is synchronous**: Unlike most Node.js database drivers, all operations are sync. Do not wrap in unnecessary `async/await`.
- **Multiple Entry Points**: Main process builds three entry points — `index.ts` (main), `capibara-mcp-bridge.ts` (MCP server), `capibara-worker.ts` (background worker). Each runs in a separate Node.js process.

### Testing Rules

- **Framework**: Vitest 4.1.0 with v8 coverage provider.
- **Test Location**: Tests in `tests/` directory at project root, mirroring `src/` structure. Pattern: `tests/unit/*.test.ts`, `tests/diagnostic/*.ts`.
- **File Naming**: `{feature-name}.test.ts` convention.
- **Mocking DI**: When testing services, mock dependencies by providing fake implementations of `core/interfaces/`. Do not mock the tsyringe container directly.
- **Diagnostic Tests**: Non-automated diagnostic scripts in `tests/diagnostic/` for manual verification of external integrations.
- **Coverage Exclusions**: `src/main/index.ts` and `src/main/composition-root.ts` excluded from coverage.

### Code Quality & Style Rules

- **Prettier Config**: 100 char width (markdown/JSON: 120), single quotes, trailing commas (`all`), 2-space indent, LF line endings, `arrowParens: always`. Run `pnpm format` before committing.
- **No ESLint**: Project uses Prettier only for formatting.
- **File Naming**: kebab-case for all source files (e.g., `claude-local.adapter.ts`, `app.slice.ts`). Dot notation for layer/type separation (e.g., `config.schema.ts`, `capibara.errors.ts`).
- **Class Naming**: PascalCase (e.g., `ClaudeLocalAdapter`, `SqliteOrganizationRepository`).
- **Directory Structure**: Feature-based organization within layers. Each feature gets its own directory under the appropriate layer.
- **Comments**: Minimal comments. Code should be self-documenting. Only comment non-obvious business logic or workarounds.

### Development Workflow Rules

- **pnpm only**: Do not use `npm` or `yarn`. Lock file is `pnpm-lock.yaml`.
- **Dev Command**: `pnpm dev` starts the Electron app in development mode via electron-vite.
- **Build**: `pnpm build:electron` for production build. Uses electron-builder for packaging (macOS DMG, Windows NSIS, Linux AppImage/deb).
- **Monorepo**: Configured as pnpm workspace. Currently only `apps/electron` exists. Root `tsconfig.json` has project references but only the electron app is active.
- **Native Modules**: `better-sqlite3` requires rebuild for Electron via `electron-rebuild` in postinstall script. If native module errors occur, run `pnpm --filter @capibara/electron postinstall`.

### Critical Don't-Miss Rules

- **NEVER import from `infrastructure/` in `application/` layer**. Always depend on `core/interfaces/`. Violating this breaks the dependency inversion principle.
- **NEVER use relative paths across process boundaries** (e.g., `../../shared/` from renderer). Always use path aliases (`@shared/`, `@main/`, `@renderer/`).
- **NEVER instantiate services with `new`** outside `composition-root.ts`. All service creation goes through the DI container.
- **NEVER put business logic in IPC handlers**. Handlers in `src/main/ipc-handlers/` must only validate input, delegate to application services, and wrap results in `DesktopResult`.
- **NEVER access Node.js APIs from the renderer process**. All system operations go through the preload bridge (`window.capibara`).
- **NEVER store runtime state in `src/main/core/`**. Core is for contracts only (interfaces, types, constants, errors, tokens).
- **NEVER destructure the entire Zustand store**. Use individual selectors to prevent unnecessary re-renders.
- **ALWAYS add new IPC channels to `contracts.ts`** — define the channel constant, Zod input schema, response type, and `CapibaraApi` method. Then implement in preload and register the handler in composition root.
- **ALWAYS add `@injectable()` decorator** to any new class registered in the DI container. Missing this causes cryptic tsyringe resolution errors.
- **ALWAYS add i18n keys to BOTH `en-US.ts` and `zh-CN.ts`** when adding UI text. The `LocaleMessages` interface enforces type safety — missing keys cause compile errors.
- **Config is immutable after load**. Do not mutate config objects at runtime.
- **Preload builds to CommonJS** (`.cjs`). Do not use ESM-only dependencies in preload scripts unless excluded from externalization (like `zod`).

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

Last Updated: 2026-04-16
