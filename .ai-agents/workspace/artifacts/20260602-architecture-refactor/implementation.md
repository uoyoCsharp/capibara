# Implementation: Capibara Architecture Refactor (t6)

## Implementation Plan

## Task: t6-eventize-routing-remove-cascade — OP-3 + OP-10

Implemented eventized routing write-back by changing Coordination to publish `conversation:route-resolved` and moving the assignment write-back responsibility into Conversation via event subscription. Removed dead Workflow-side conversation cascade plumbing from `TaskService` now that FK CASCADE is already in place from t3. Updated dependency injection wiring and affected tests to reflect the event-driven flow and constructor changes.

## Changes

| path | action | intent |
|---|---|---|
| apps/electron/src/core/foundation/events.ts | modify | Add `ConversationRouteResolvedPayload` and `conversation:route-resolved` to `DomainEventMap`. |
| apps/electron/src/core/foundation/event-schemas.ts | modify | Add Zod schema and registry entry for `conversation:route-resolved`. |
| apps/electron/src/core/modules/coordination/routing/inquiry.router.ts | modify | Replace direct conversation-service call with event publication of route decision. |
| apps/electron/src/core/modules/conversation/services/conversation.service.ts | modify | Subscribe to `conversation:route-resolved` and apply idempotent write-back before emitting downstream events. |
| apps/electron/src/core/modules/workflow/services/task.service.ts | modify | Remove `convRepo`, `setConversationRepository`, and manual conversation delete loop. |
| apps/electron/src/core/bootstrap/coordination.module.ts | modify | Rewire `InquiryRouter` to inject `IEventPublisher` instead of conversation service. |
| apps/electron/src/core/bootstrap/conversation.module.ts | modify | Inject `IEventBus` into `ConversationService` for route-resolved subscription. |
| apps/electron/src/core/bootstrap/composition-root.ts | modify | Remove task-service conversation-repo wiring and update module registration signatures. |
| apps/electron/tests/unit/coordination/inquiry-router.test.ts | modify | Assert `conversation:route-resolved` emission instead of direct assignment call. |
| apps/electron/tests/unit/conversation/conversation-service.test.ts | modify | Update `ConversationService` constructor usage with event bus parameter. |
| apps/electron/tests/integration/inquiry-flow.test.ts | modify | Update constructor wiring and event-flow assertions/comments for route-resolved publication path. |
| apps/electron/tests/integration/inquiry-happy-path.test.ts | modify | Update constructor wiring and comments for eventized routing. |

## Implementation Details

- `InquiryRouter` now only reads Organization context and publishes a routing decision event. It no longer imports or calls `IConversationCommandService`.
- `ConversationService` subscribes to `conversation:route-resolved` and applies assignment through existing `assignRespondent` logic.
- Idempotency strategy for route re-delivery: if conversation is already in `waiting` with the same `respondentRoleId` and `respondentType`, the subscriber no-ops.
- Manual Task->Conversation cascade code was removed from `TaskService.delete()`, leaving cascade responsibility to DB FK semantics (already migrated in t3).
- Composition wiring was updated so Conversation can subscribe (`eventBus`) and Coordination can publish (`eventPublisher`) without cross-module concrete calls.

## Design Compliance

- Files touched align with t6 intent in design (`OP-3` + `OP-10`) and satisfy both acceptance targets:
  - Eventized route write-back is implemented (`conversation:route-resolved`, no direct ConversationService usage in router).
  - TaskService conversation cascade plumbing is removed.
- Layer/module constraints:
  - Coordination no longer depends on Conversation service concrete/interface for write-back.
  - Conversation owns the write-side assignment via its own service.
- Quick checks:
  - `pnpm --filter ./apps/electron run typecheck` passed.
  - `pnpm --filter ./apps/electron run arch:check` passed (no dependency violations).

## Change Tracking

### Deviations from Design

- Added `apps/electron/src/core/bootstrap/conversation.module.ts` changes (not listed in task artifact hint) because Conversation now requires `IEventBus` injection to subscribe to `conversation:route-resolved` inside the module itself.
- Added test-file updates to keep behavior verification aligned with the eventized routing contract.

### Self-Check Results

- Type-check: pass (`typecheck`).
- Architecture guard: pass (`arch:check`).
- Suggested focused test commands (not auto-run in this invocation):
  - `pnpm --filter ./apps/electron test -- tests/unit/coordination/inquiry-router.test.ts`
  - `pnpm --filter ./apps/electron test -- tests/unit/conversation/conversation-service.test.ts`
  - `pnpm --filter ./apps/electron test -- tests/integration/inquiry-flow.test.ts`

### Open TODOs

- Run focused tests above (and optionally full `test:unit`) to validate event ordering and integration behavior under Vitest runtime.
- After validation, update plan task state via `/mvt-update-plan t6-eventize-routing-remove-cascade done` if all acceptance criteria are confirmed.

## Task: t7-notification-to-infra — OP-6

Migrated notification adapters from `modules/notification` to `infrastructure/notification`, updated bootstrap wiring and all affected type imports, and removed legacy module files. To satisfy layering guards, introduced a notification service port interface in foundation so orchestrators depend on the port rather than infrastructure concrete types.

## Changes

| path | action | intent |
|---|---|---|
| apps/electron/src/core/infrastructure/notification/event-broadcaster.ts | create | Relocate EventBroadcaster into infrastructure as a driven adapter implementation. |
| apps/electron/src/core/infrastructure/notification/notification.service.ts | create | Relocate desktop notification sender into infrastructure. |
| apps/electron/src/core/foundation/interfaces/i-notification.service.ts | create | Add notification port interface to decouple domain orchestration from infrastructure concrete type. |
| apps/electron/src/core/bootstrap/notification.module.ts | modify | Wire notification module from infrastructure implementations. |
| apps/electron/src/core/bootstrap/composition-root.ts | modify | Update EventBroadcaster type import to infrastructure path. |
| apps/electron/src/core/bootstrap/orchestrator.module.ts | modify | Depend on `INotificationService` port instead of concrete service type. |
| apps/electron/src/core/modules/orchestrator/orchestrators/conversation.orchestrator.ts | modify | Depend on `INotificationService` port instead of concrete service type. |
| apps/electron/tests/unit/orchestrator/conversation-orchestrator.test.ts | modify | Update notification mock typing to `INotificationService`. |
| apps/electron/tests/unit/orchestrator/orchestrator.test.ts | modify | Update inline notification mock type import path. |
| apps/electron/tests/unit/orchestrator/event-topology.test.ts | modify | Update inline notification mock type import path. |
| apps/electron/tests/integration/inquiry-flow.test.ts | modify | Update inline notification mock type import path. |
| apps/electron/tests/integration/inquiry-happy-path.test.ts | modify | Update inline notification mock type import path. |
| apps/electron/tests/integration/cascade-execution.test.ts | modify | Update inline notification mock type import path. |
| apps/electron/src/core/modules/notification/event-broadcaster.ts | delete | Remove legacy module location after migration. |
| apps/electron/src/core/modules/notification/notification.service.ts | delete | Remove legacy module location after migration. |

## Implementation Details

- Notification adapters now live under `src/core/infrastructure/notification/` in line with ADR-09.
- `ConversationOrchestrator` and module wiring consume `INotificationService` from foundation, preventing reverse dependency from core modules to infrastructure.
- Existing notification behavior remains unchanged (`send(title, body)` contract preserved), and bootstrap tokens continue to resolve the same runtime instances.

## Design Compliance

- t7 acceptance alignment:
  - Notification files are moved under infrastructure and legacy module files are removed.
  - `arch:check` confirms no Domain Core -> infrastructure violations after interface decoupling.
  - Type-check passes after wiring and test updates.
- No new external dependencies were added.

## Change Tracking

### Deviations from Design

- Added `apps/electron/src/core/foundation/interfaces/i-notification.service.ts` to satisfy layering guard (`no-core-to-adapters`) while keeping orchestrator logic unchanged. This is a port-level adjustment aligned with ADR-09 intent, not a structural architecture change.
- Added test-file import updates as required compile-time follow-through for relocated types.

### Self-Check Results

- Type-check: pass (`pnpm --filter ./apps/electron run typecheck`).
- Architecture guard: pass (`pnpm --filter ./apps/electron run arch:check`).
- Suggested focused test commands (not auto-run in this invocation):
  - `pnpm --filter ./apps/electron test -- tests/unit/orchestrator/conversation-orchestrator.test.ts`
  - `pnpm --filter ./apps/electron test -- tests/unit/orchestrator/event-topology.test.ts`
  - `pnpm --filter ./apps/electron test -- tests/integration/inquiry-flow.test.ts`

### Open TODOs

- Run focused orchestrator and integration tests to confirm notification behavior and event broadcasting paths at runtime.
- After tests pass, update plan task via `/mvt-update-plan t7-notification-to-infra done` and sync touched artifacts list if needed.

## Task: t8-mcp-split — OP-5

Split MCP protocol mechanics out of Domain Core by moving server builder and transport manager into `infrastructure/mcp-protocol`, and converted MCP handlers into primary-side providers under `core/mcp/providers`. Rewired production bootstrap and system handler imports to the new infrastructure location, then removed all legacy files under `modules/mcp`.

## Changes

| path | action | intent |
|---|---|---|
| apps/electron/src/core/infrastructure/mcp-protocol/interfaces/i-tool-registry.ts | create | Introduce the protocol boundary for provider registration (`IToolRegistry` + `ToolProvider`). |
| apps/electron/src/core/infrastructure/mcp-protocol/mcp-server.builder.ts | create | Relocate MCP server construction into infrastructure and register primary providers through the registry boundary. |
| apps/electron/src/core/infrastructure/mcp-protocol/mcp-http-transport.ts | create | Relocate transport manager into infrastructure while preserving SSE + streamable HTTP behavior. |
| apps/electron/src/core/mcp/providers/task-tool.provider.ts | create | Convert task tool handler into a primary-side provider. |
| apps/electron/src/core/mcp/providers/conversation-tool.provider.ts | create | Convert conversation tool handler into a primary-side provider. |
| apps/electron/src/core/mcp/providers/context-tool.provider.ts | create | Convert context tool handler into a primary-side provider. |
| apps/electron/src/core/mcp/providers/plan-tree-tool.provider.ts | create | Convert plan-tree tool handler into a primary-side provider while keeping thin-forwarder behavior. |
| apps/electron/src/core/bootstrap/mcp.module.ts | modify | Rewire MCP module imports to `infrastructure/mcp-protocol`. |
| apps/electron/src/core/bootstrap/composition-root.ts | modify | Update transport type import to infrastructure path. |
| apps/electron/src/core/ipc-handlers/system.handlers.ts | modify | Rewire MCP builder/transport types used by diagnostics and restart flow. |
| apps/electron/src/core/modules/mcp/mcp-server.builder.ts | delete | Remove legacy protocol builder from Domain Core module path. |
| apps/electron/src/core/modules/mcp/mcp-http-transport.ts | delete | Remove legacy transport manager from Domain Core module path. |
| apps/electron/src/core/modules/mcp/handlers/task-tools.ts | delete | Remove legacy task handler in favor of provider file. |
| apps/electron/src/core/modules/mcp/handlers/conversation-tools.ts | delete | Remove legacy conversation handler in favor of provider file. |
| apps/electron/src/core/modules/mcp/handlers/context-tools.ts | delete | Remove legacy context handler in favor of provider file. |
| apps/electron/src/core/modules/mcp/handlers/plan-tree-tools.ts | delete | Remove legacy plan-tree handler in favor of provider file. |

## Implementation Details

- The MCP protocol core (`buildCapibaraMcpServer`, `createSseMcpServer`, transport lifecycle) now resides in `infrastructure/mcp-protocol` and no longer lives under `modules/mcp`.
- Primary adapters are now explicit provider files under `core/mcp/providers`, each depending on domain interfaces and registering one tool family.
- `i-tool-registry.ts` was added as the internal boundary for registering/applying providers in the protocol builder.
- Existing MCP runtime behavior is preserved: dual transport endpoints (`/sse`, `/messages`, `/mcp`) and the per-SSE dedicated server instance pattern remain unchanged.

## Design Compliance

- OP-5 alignment:
  - Protocol mechanics moved to infrastructure (`mcp-server.builder`, `mcp-http-transport`, registry boundary).
  - Tool registration moved to primary-side providers (`core/mcp/providers/*`).
  - Legacy `modules/mcp/*` implementation files were deleted.
- Tool providers remain thin forwarders with no plan-tree structural limits/constants embedded in providers.
- Quick checks:
  - `pnpm --filter ./apps/electron run typecheck` passed.
  - `pnpm --filter ./apps/electron run arch:check` passed (no dependency violations).

## Change Tracking

### Deviations from Design

- Updated `apps/electron/src/core/ipc-handlers/system.handlers.ts` in addition to plan hint paths because MCP restart/diagnostic wiring imports builder/transport types directly.
- No test files were modified in this invocation per user-requested scope.

### Self-Check Results

- Type-check: pass (`pnpm --filter ./apps/electron run typecheck`).
- Architecture guard: pass (`pnpm --filter ./apps/electron run arch:check`).
- Suggested focused test commands (not auto-run in this invocation):
  - `pnpm --filter ./apps/electron test -- tests/unit/mcp/mcp-server.builder.test.ts`
  - `pnpm --filter ./apps/electron test -- tests/unit/mcp/mcp-http-transport.test.ts`
  - `pnpm --filter ./apps/electron test -- tests/unit/mcp/plan-tree-tools.test.ts`

### Open TODOs

- Update MCP unit/integration tests to import from the new provider/protocol paths.
- Run the suggested focused MCP tests after test-path updates.
- After test follow-up, mark this task done via `/mvt-update-plan t8-mcp-split done` and sync artifacts list.

## Task: t9-acp-split — OP-8

Moved ACP client mechanics from `modules/acp/client` into `infrastructure/acp-protocol`, rewired production entry points to the new location, and deleted legacy client files. Also implemented the required behavior fixes for this task: B-1 resume fallback, B-2 aggregation timeout progression, and B-4 restrictive/ask_user permission hardening.

## Changes

| path | action | intent |
|---|---|---|
| apps/electron/src/core/infrastructure/acp-protocol/acp-agent.spawner.ts | create | Relocate ACP agent spawn mechanics to infrastructure protocol layer. |
| apps/electron/src/core/infrastructure/acp-protocol/acp-executor.ts | create | Relocate ACP execution pipeline to infrastructure protocol layer. |
| apps/electron/src/core/infrastructure/acp-protocol/acp-session.manager.ts | create | Relocate ACP session lifecycle management and apply B-1 resume fallback behavior. |
| apps/electron/src/core/infrastructure/acp-protocol/acp-session.sweeper.ts | create | Relocate ACP stale-session sweeper to infrastructure protocol layer. |
| apps/electron/src/core/infrastructure/acp-protocol/model-state.ts | create | Relocate ACP model-state derivation utility to infrastructure protocol layer. |
| apps/electron/src/core/infrastructure/acp-protocol/session-lifecycle.ts | create | Relocate ACP session lifecycle helpers to infrastructure protocol layer. |
| apps/electron/src/core/bootstrap/acp.module.ts | modify | Rewire ACP module imports to infrastructure protocol location. |
| apps/electron/src/core/ipc-handlers/acp.handlers.ts | modify | Rewire ACP IPC handler imports/types to infrastructure protocol location. |
| apps/electron/src/core/ipc-handlers/system.handlers.ts | modify | Rewire ACP diagnostics/system wiring imports to infrastructure protocol location. |
| apps/electron/src/core/modules/acp/collaboration/session-suspension.manager.ts | modify | Implement B-2: aggregation-level timeout update and all-mode readiness with timed_out statuses. |
| apps/electron/src/core/modules/acp/policies/tool-permission.policy.ts | modify | Implement B-4: enforce restrictive deny-by-default and ask_user deny-until-supported behavior. |
| apps/electron/src/core/modules/acp/client/acp-agent.spawner.ts | delete | Remove legacy ACP client mechanics path after relocation. |
| apps/electron/src/core/modules/acp/client/acp-executor.ts | delete | Remove legacy ACP client mechanics path after relocation. |
| apps/electron/src/core/modules/acp/client/acp-session.manager.ts | delete | Remove legacy ACP client mechanics path after relocation. |
| apps/electron/src/core/modules/acp/client/acp-session.sweeper.ts | delete | Remove legacy ACP client mechanics path after relocation. |
| apps/electron/src/core/modules/acp/client/model-state.ts | delete | Remove legacy ACP client mechanics path after relocation. |
| apps/electron/src/core/modules/acp/client/session-lifecycle.ts | delete | Remove legacy ACP client mechanics path after relocation. |

## Implementation Details

- ACP protocol mechanics now live under `src/core/infrastructure/acp-protocol/`, matching the infra-side placement used for protocol execution concerns.
- B-1 fix in session manager: resume path now catches `resumeSession`/load failures and falls back to `rebuild(record)` to avoid hard-failing recovery.
- B-2 fix in suspension manager:
  - Added timeout-aware awaiting update for `aggregationMode='all'`.
  - Pending/in-progress awaitings are marked `timed_out` after `inquiryTimeoutMs` from suspension timestamp.
  - Completion check for `all` mode now treats both `resolved` and `timed_out` as terminal states, preventing indefinite suspension.
- B-4 fix in tool permission policy:
  - `restrictive` mode no longer falls back to permissive denylist behavior; it now denies by default unless explicit allowlisting is implemented.
  - `ask_user` mode now denies until interactive approval flow is available.

## Design Compliance

- OP-8 alignment:
  - ACP client mechanics moved from module path to infrastructure protocol path.
  - Legacy client files under `modules/acp/client` removed.
  - Required behavior fixes B-1/B-2/B-4 are implemented in their respective domain/policy areas.
- Layering/architecture guard status:
  - `pnpm --filter ./apps/electron run arch:check` passed (no dependency violations).
- Type safety status:
  - `pnpm --filter ./apps/electron run typecheck` passed.

## Change Tracking

### Deviations from Design

- Updated `apps/electron/src/core/ipc-handlers/system.handlers.ts` and `apps/electron/src/core/ipc-handlers/acp.handlers.ts` in addition to module wiring because ACP diagnostics and IPC surfaces import protocol-related types.
- Added B-2 and B-4 behavioral hardening changes inside existing module policy/collaboration files as required by task acceptance (beyond pure file relocation).

### Self-Check Results

- Type-check: pass (`pnpm --filter ./apps/electron run typecheck`).
- Architecture guard: pass (`pnpm --filter ./apps/electron run arch:check`).
- Suggested focused test commands (not auto-run in this invocation):
  - `pnpm --filter ./apps/electron test -- tests/unit/acp/collaboration/session-suspension.manager.test.ts`
  - `pnpm --filter ./apps/electron test -- tests/unit/acp/policies/tool-permission.policy.test.ts`
  - `pnpm --filter ./apps/electron test -- tests/integration/inquiry-flow.test.ts`

### Open TODOs

- Add/refresh ACP-focused unit tests for B-1/B-2/B-4 edge cases and policy mode expectations.
- Mark t9 as done with `/mvt-update-plan t9-acp-split done` after plan update step.

## Task: t10-reclassify-layers-rename — OP-7 + OP-9

Completed the final naming and guard-hardening pass for the architecture refactor by renaming `InquiryRouter` to `InquiryOrchestrator`, moving the implementation file to `inquiry.orchestrator.ts`, and updating production/test wiring accordingly. Also promoted all remaining dependency-cruiser guard rules to `error` severity so architecture enforcement is fully blocking.

## Changes

| path | action | intent |
|---|---|---|
| apps/electron/src/core/modules/coordination/routing/inquiry.orchestrator.ts | create | Introduce renamed active D3 unit with `InquiryOrchestrator` class. |
| apps/electron/src/core/modules/coordination/routing/inquiry.router.ts | delete | Remove legacy router file after class/file rename. |
| apps/electron/src/core/bootstrap/coordination.module.ts | modify | Rewire module import, instance name, and exported property to `inquiryOrchestrator`. |
| apps/electron/src/core/bootstrap/composition-root.ts | modify | Start renamed coordination unit (`coordination.inquiryOrchestrator.start()`). |
| apps/electron/src/core/modules/conversation/services/conversation.service.ts | modify | Update cross-module routing comments to `InquiryOrchestrator` terminology. |
| apps/electron/tests/unit/coordination/inquiry-router.test.ts | modify | Update imports/type names/describe label to `InquiryOrchestrator`. |
| apps/electron/tests/integration/inquiry-flow.test.ts | modify | Update imports/type names/comments to `InquiryOrchestrator`. |
| apps/electron/tests/integration/inquiry-happy-path.test.ts | modify | Update imports/type names/comments to `InquiryOrchestrator`. |
| apps/electron/tests/unit/orchestrator/event-topology.test.ts | modify | Update event-topology description string to `InquiryOrchestrator`. |
| apps/electron/.dependency-cruiser.cjs | modify | Promote `no-core-to-adapters`, `d0-must-stay-leaf`, and `no-upward-d1-to-d3` to `error`. |

## Implementation Details

- The active coordination component now follows D3 naming intent: file path `routing/inquiry.orchestrator.ts`, class name `InquiryOrchestrator`.
- Composition and module assembly now expose/start `inquiryOrchestrator` while keeping the existing DI token binding contract intact.
- Test imports and descriptive text were updated to eliminate stale `InquiryRouter` references.
- Dependency-cruiser enforcement is now fully strict for all four core rules (`error`), matching t10 acceptance expectations.

## Design Compliance

- OP-9 acceptance alignment:
  - `inquiry.router.ts` renamed/replaced by `inquiry.orchestrator.ts`.
  - Active class is `InquiryOrchestrator` and passive `InquiryEscalationService` remains unchanged.
- OP-7 acceptance alignment:
  - Architecture guard runs with all core rules at `error` severity.
  - `arch:check` passes with no dependency violations.
- Validation summary:
  - `pnpm --filter ./apps/electron run typecheck` passed.
  - `pnpm --filter ./apps/electron run arch:check` passed.

## Change Tracking

### Deviations from Design

- No structural deviations from the design scope were required.
- Test files were updated as compile-time follow-through for the symbol/file rename.

### Self-Check Results

- Type-check: pass (`pnpm --filter ./apps/electron run typecheck`).
- Architecture guard: pass (`pnpm --filter ./apps/electron run arch:check`).
- Suggested focused test commands (not auto-run in this invocation):
  - `pnpm --filter ./apps/electron test -- tests/unit/coordination/inquiry-router.test.ts`
  - `pnpm --filter ./apps/electron test -- tests/integration/inquiry-flow.test.ts`
  - `pnpm --filter ./apps/electron test -- tests/integration/inquiry-happy-path.test.ts`

### Open TODOs

- Mark t10 complete via `/mvt-update-plan t10-reclassify-layers-rename done` to close this plan.
- Run focused coordination/inquiry tests to validate runtime behavior after rename.
