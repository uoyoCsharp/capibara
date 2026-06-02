# Architecture Rules

> Structural details in `project-context.md`. This file is constraints only.

## Layering

Layer = role label, not dependency rank; same-layer deps allowed.

| Layer | Name | Character | Active |
|:-----:|------|-----------|:------:|
| D0 | Structural core | Most stable, most referenced | No |
| D1 | Capability domain | Owns entities, invariants, state machines | No |
| D2 | Derived service | No entities, no persistence, computes from multiple domains | No |
| D3 | Reactive orchestration | Event-driven, self-subscribing, most volatile | Yes |

## Naming

| Suffix | Role | Active |
|--------|------|:------:|
| `Service` | Domain service, called on demand | No |
| `Engine` | Stateful domain rules | No |
| `Builder` | Assembly / construction | No |
| `Coordinator` | Orchestration intent -> execution | No |
| `Orchestrator` | Subscribes to events, self-driven | **Yes** |

Active D3 units MUST use `Orchestrator` suffix; NEVER `Service`. Periodically-invoked (not event-subscribed) classes are passive; `Service` is correct.

## Dependency

| Rule | Meaning |
|------|---------|
| No core-to-adapters | Core MUST NOT import adapters (inbound or outbound) |
| D0 stays leaf | D0 MUST NOT import other domain modules |
| No upward | D0/D1 MUST NOT import D3 |
| No cross-module concrete | Cross-module MUST go through `interfaces/`, never `services/` or `engines/` |

D3 orchestrators may depend on all lower layers.

## Domain Invariants

MUST be enforced in domain services, never in adapters. Adapters are thin forwarding. Any adapter holding validation logic must sink it to domain service before refactor.

## Event Idempotency

Outbox = at-least-once delivery. All `eventBus.on(...)` handlers MUST be idempotent:

| Approach | Mechanism |
|----------|-----------|
| Idempotency key | Event carries `eventId`, subscriber records processed IDs, skip duplicates |
| Skip-if-exists | Unique constraint + upsert / `INSERT OR IGNORE` |

Every new handler must declare its idempotency strategy in the PR.

## Cascade Delete

Task deletion force-cascades to conversations (all states) via `ON DELETE CASCADE` FK. Do NOT use domain events for this (hits terminal-state guard -> orphans). Owning service MUST NOT hold dependent's repository reference for cascade.

## AI Boundary

`IExecutor` is the sole abstraction. No new shared AI abstraction. Swap backends by implementing `IExecutor`. Planning never calls AI directly.

## Directory Grouping

| Group | Content |
|-------|---------|
| `infrastructure/` | All pure protocol/persistence/observability (inbound + outbound) |
| Primary side | Business-facing adapters that depend on domain interfaces |

Direction is conceptual, not encoded in folder names.
