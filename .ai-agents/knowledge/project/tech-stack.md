# Tech Stack - capibara

## Runtime & Language
- **Node.js** >= 22 LTS
- **TypeScript** 5.x (strict mode, ESM, ES2023 target)
- **Module system**: ESM (`"type": "module"`)
- **Package manager**: pnpm

## Core Dependencies
| Package | Purpose |
|---------|---------|
| `commander` | CLI command parsing and entry organization |
| `tsyringe` + `reflect-metadata` | Dependency injection (decorator-based) |
| `zod` | Configuration and input validation |
| `dotenv` | Environment variable loading |
| `pino` + `pino-pretty` | Structured logging |
| `emittery` | Event bus (typed, async) |

## Dev Dependencies
| Package | Purpose |
|---------|---------|
| `typescript` | Compiler |
| `tsx` | Dev-time TypeScript execution |
| `vitest` | Unit + integration testing |
| `prettier` | Code formatting |
| `rimraf` | Clean builds |

## Build & Run
- **Build**: `pnpm build` (tsc)
- **Dev**: `pnpm dev` (tsx)
- **Test**: `pnpm test` (vitest)
- **CLI binary**: `cpbr` (via `dist/main.js`)

## Architecture Constraints
1. DI only in composition-root; domain layer never imports container API
2. Business layer uses interface injection, never direct `new` for infrastructure
3. CLI is entry-only; no business logic in CLI layer
4. Zod validates all config at startup (fail-fast)
5. tsyringe tokens centralized in `tokens.ts`; default singleton lifecycle
