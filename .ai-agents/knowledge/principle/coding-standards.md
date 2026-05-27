# Capibara Coding Standards

## Naming Conventions

- **Components**: PascalCase, one component per file, filename matches component name (e.g., `Sidebar.tsx` exports `Sidebar`)
- **Hooks**: camelCase with `use` prefix in function name, `use-` prefix in filename (e.g., `use-event-subscription.ts` exports `useEventSubscription`)
- **Stores**: camelCase with `.store.ts` suffix (e.g., `app.store.ts`). Exported hook is PascalCase: `useAppStore`, `useTaskStore`
- **Services**: PascalCase class names (e.g., `ConversationService`, `RunEngine`)
- **Interfaces**: `I` prefix for abstraction contracts (e.g., `IEventBus`, `IConversationRepository`). Data shape interfaces have no prefix (e.g., `ConversationBase`, `SidebarProps`)
- **Types**: camelCase type aliases (e.g., `ConversationType`, `ConversationState`)
- **Constants**: UPPER_SNAKE_CASE for tokens and transition tables (e.g., `CONVERSATION_TRANSITIONS`, `CONFIG_TOKEN`)
- **Error classes**: PascalCase with `Error` suffix, extending `CapibaraError` (e.g., `NotFoundError`, `ValidationError`, `TaskStateError`)

## File Naming

- **Source files**: kebab-case (e.g., `use-event-subscription.ts`, `conversation-event.logger.ts`)
- **Component files**: PascalCase (e.g., `Sidebar.tsx`, `DashboardPage.tsx`)
- **Type files**: `<domain>.types.ts` pattern (e.g., `conversation.types.ts`)
- **Interface files**: `i-<name>.ts` pattern (e.g., `i-event-bus.ts`, `i-logger.ts`)
- **Module directories**: kebab-case, organized by domain
- **Sub-folders per module**: `interfaces/`, `persistence/`, `services/`, `types/`, `handlers/`, `policies/`, `client/`, `engines/`

## Component Patterns

- Functional components only -- no class components
- Props defined as `interface` just above the component
- `React.forwardRef` for UI primitives needing ref forwarding
- Smaller helper/sub-components co-located in the same file
- Custom hooks for reusable logic, single-purpose, `useXxx` naming

## Import Style

- Alias-based imports via path aliases: `@shared/*`, `@main/*`, `@renderer/*`, `@core/*`
- Relative imports for sibling files within the same directory
- `import type` used consistently for type-only imports
- No barrel exports (index.ts) except `src/core/index.ts` and `src/shared/locale/index.ts`

## State Management

- Zustand v5 for all renderer state
- Stores in `src/renderer/store/` with `<domain>.store.ts` pattern
- Structure: `interface <Domain>State` defines state + actions, `create<State>((set, get) => ({ ... }))`
- `init()` method for lazy/one-time initialization (idempotent, guarded by `isInitialized`)
- Event subscriptions managed inside `init()` via `subscribeToEvents()`
- Selector pattern: `useAppStore((s) => s.activeSection)` for fine-grained subscriptions

## Styling

- Tailwind CSS v4 + shadcn/ui (Radix UI primitives + CVA + Tailwind)
- `cn()` utility from `clsx` + `tailwind-merge` for conditional class merging
- CVA for variant-based component styling
- HSL CSS variables for theming in `globals.css` with light/dark mode via `[data-theme='dark']`
- `@theme` block for custom design tokens
- No CSS modules, no styled-components, no SCSS

## Error Handling

- Custom error hierarchy: `CapibaraError` (base) -> domain errors (`NotFoundError`, `ValidationError`, etc.)
- Each error carries a `code` string (e.g., `'NOT_FOUND'`, `'INVALID_TASK_TRANSITION'`)
- Errors include structured context in the message
- `Error.cause` chain supported via `options?.cause`
- `DesktopResult<T>` discriminated union for IPC results: `{ ok: true; data: T } | { ok: false; error: { code, message } }`
- Try/catch in stores: errors logged with `[store-name]` prefix

## Type Usage

- Strict mode enabled in all tsconfig.json
- `interface` for object shapes and contracts; `type` for unions, intersections, and aliases
- Discriminated unions for type-safe narrowing (e.g., `Conversation`, `DesktopResult<T>`)
- Zod schemas for runtime validation of configuration
- Symbol-based DI tokens (e.g., `CONFIG_TOKEN = Symbol('CONFIG_TOKEN')`)
- `experimentalDecorators` + `emitDecoratorMetadata` for tsyringe DI

## Architecture

- Monorepo: pnpm workspaces with `apps/*` and `packages/*`
- Dependency Injection: tsyringe with `@injectable()` decorators, modular `register<Module>Module()` in composition root
- Event-driven: `IEventBus` + `IEventPublisher` with typed domain events via `DomainEventMap`
- IPC contract: `CapibaraApi` interface for typed renderer-to-main bridge
- Electron-vite build tooling with separate main/preload/renderer configs

## Formatting (Prettier)

- `semi: true`, `singleQuote: true`, `trailingComma: 'all'`
- `printWidth: 100` (120 for markdown/JSON), `tabWidth: 2`, spaces
- `arrowParens: 'always'`, `endOfLine: 'lf'`, `bracketSpacing: true`

## Testing

- Vitest with `globals: true` and V8 coverage provider
- Testing Library for component tests
- Test file convention: `tests/**/*.test.ts`, DOM tests: `*.dom.test.tsx`
- DOM tests opt-in via `// @vitest/environment jsdom` docblock pragma
