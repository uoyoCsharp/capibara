# Tech Stack - capibara

## Runtime & Language
- **Node.js** >= 22 LTS
- **TypeScript** 5.x (strict mode, ESM, ES2023 target)
- **Module system**: ESM (`"type": "module"`)
- **Package manager**: pnpm

## Platform
- **Electron** 41.1.0 (Main/Preload/Renderer three-layer process model)
- **electron-vite** 5.0.0 (Build tooling)
- **electron-builder** 26.8.1 (Packaging)

## Core Dependencies
| Package | Purpose |
|---------|---------|
| `tsyringe` + `reflect-metadata` | Dependency injection (decorator-based) |
| `zod` | Configuration and input validation |
| `dotenv` | Environment variable loading |
| `pino` + `pino-pretty` | Structured logging |
| `emittery` | Event bus (typed, async) |
| `better-sqlite3` | SQLite database |

## Frontend Dependencies
| Package | Purpose |
|---------|---------|
| `React` 19.2.4 | UI framework |
| `Zustand` 5.0.12 | State management |
| `TailwindCSS` 4.2.2 | Styling |
| `Framer Motion` 12.38.0 | Animations |
| `React Router` 7 | Routing (memory mode) |

## Dev Dependencies
| Package | Purpose |
|---------|---------|
| `typescript` | Compiler |
| `vitest` | Unit + integration testing |
| `playwright` | E2E testing |
| `prettier` | Code formatting |
| `rimraf` | Clean builds |

## Build & Run
- **Dev**: `pnpm dev` (electron-vite dev server)
- **Build**: `pnpm build` (electron-vite build)
- **Test**: `pnpm test` (vitest)
- **Package**: `pnpm build:electron` (electron-builder)

## Architecture Constraints
1. DI only in composition-root; domain layer never imports container API
2. Business layer uses interface injection, never direct `new` for infrastructure
3. Main process handles business logic; Renderer is UI-only (no Node.js access)
4. Zod validates all config at startup (fail-fast)
5. tsyringe tokens centralized in `tokens.ts`; default singleton lifecycle
6. IPC communication via context bridge with Zod validation
