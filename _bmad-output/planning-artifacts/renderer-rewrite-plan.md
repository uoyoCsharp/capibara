# Renderer Rewrite Plan

> **Version**: 1.0
> **Date**: 2026-04-24
> **Status**: Draft for review
> **Precondition**: Backend refactor v2.1 (Phases 0–8) complete — 653 tests green, TSC clean, IPC contract stable
> **Scope boundary**: Frontend only. No backend changes expected; backend drift surfaced here is fixed by aligning the renderer, not moving the backend.

---

## 1. Current State — What We're Rewriting From

### 1.1 Metrics
- **53 .ts/.tsx files**, **5,383 LOC**
- **36 components** / **7 stores** / **5 hooks** / **18 UI kit wrappers**
- **0 renderer tests**
- **9 top-level sections** (Dashboard, Tasks, Inbox, Team, Planning, Workspace/OrgSettings, Settings, Onboarding, Skills)

### 1.2 What works
- UI kit foundation is solid: Tailwind v4 + Radix + shadcn pattern + CVA, applied consistently
- State layer is clean: Zustand with fine-grained selectors, 7 well-scoped stores
- Onboarding flow matches UX spec
- Event subscription plumbing exists (`api().subscribe` + `use-event-subscription` hook)
- Light/dark theme infrastructure in place

### 1.3 What's broken or stale
| Issue | Count | Severity |
|------|------:|----------|
| Renderer calls methods missing from `CapibaraApi` interface | 14 | High (type-unsafe) |
| Methods with no IPC handler (runtime error) | 1 (`deleteSkill`) | High (user-facing bug) |
| Backend events not subscribed by renderer | 10/18 | Medium (UI doesn't live-update) |
| Stale locale keys (discussion / narrative / etc.) | ~80 | Low (clutter) |
| Renderer tests | 0 | Medium (regression risk) |
| `TasksPage.tsx` size | 997 LOC | Medium (maintainability) |
| `TeamPage.tsx` size | 713 LOC | Medium (maintainability) |
| Missing Narrative dashboard per UX spec | — | Medium (feature gap) |

### 1.4 UX specs available
- `_bmad-output/planning-artifacts/ux-design-specification.md` (117 lines — executive UX spec)
- `_bmad-output/planning-artifacts/ux-final-wireframes.md` (219 lines — ASCII wireframes for all flows)
- `_bmad-output/planning-artifacts/ux-redesign-proposal-organization-flow.md` (64 lines)

These are authoritative for visual/interaction decisions.

---

## 2. Strategy: Incremental Rewrite, Not Greenfield

### 2.1 The decision
**Incremental rewrite in place** rather than write-a-fresh-tree-and-cut-over.

### 2.2 Rationale
- The UI kit (`components/ui/*`), styles, and stores are not broken — only pages and business glue are stale
- A greenfield tree would double the churn (recreate 18 UI wrappers, re-establish Tailwind theme, redo i18n) for no behavioral gain
- Section-by-section replacement keeps the app runnable throughout; we can QA each section as it lands
- Preserves commit history and PR reviewability

### 2.3 What "rewrite" means in practice
- **Replace**: page components (DashboardPage, TasksPage, TeamPage, InboxPage, PlanningPage, OrgSettingsPage, SettingsPage, SkillsPage, OnboardingWizard)
- **Refactor**: Zustand stores (realign to current `CapibaraApi`, add event subscriptions, remove dead methods)
- **Realign**: `CapibaraApi` interface + event subscription coverage
- **Preserve**: UI kit, Tailwind theme, hooks skeleton (`use-locale`, `use-event-subscription`, `use-app-snapshot`), directory structure
- **Introduce**: renderer test infrastructure (Vitest + React Testing Library), `App.tsx` router abstraction

---

## 3. Design Principles

| Principle | How it shows up |
|-----------|-----------------|
| **Pages are thin; stores own data** | Page components fetch via store selectors and render; no `api()` calls inline in pages |
| **One store per domain slice** | Match store-to-backend-module roughly 1:1 |
| **Event subscriptions live in stores** | Each store's `init()` subscribes to its relevant events; pages don't wire subs |
| **Every section has a test** | Smoke test + one flow test per section at minimum |
| **Type safety through `CapibaraApi`** | Drift between preload and interface is impossible — see §4.1 |
| **Locale strings strictly typed** | New `LocaleMessages` shape deletes unused namespaces |
| **No routing library yet** | `App.tsx` stays the section switcher; revisit only if scope demands nested routes |
| **Accessibility budget** | Every interactive component uses Radix primitives (already true); keyboard nav + ARIA verified |

---

## 4. Phased Plan

### Phase 9 — Type-safety baseline (1 day)
Fix the drift between `CapibaraApi` and reality so subsequent phases build on solid ground.

**Deliverables**
1. Rewrite `core/shared/api.ts` `CapibaraApi` to match preload exactly (all 61 methods, correct signatures)
2. Fix `deleteSkill` — either add an IPC handler or remove the renderer call (recommend add, since UI has delete button)
3. Add a CI/test check that greps every `ipcRenderer.invoke(X)` in preload against every `ipcMain.handle(X)` in handlers — fail if mismatch
4. Add a test asserting the keys of the `api` object in preload match `keyof CapibaraApi`

**Exit criteria**
- TSC clean
- All 14 drift methods now typed
- `deleteSkill` works end-to-end
- Drift-prevention test in CI

### Phase 10 — Store layer refresh (2 days)
Bring stores in line with the v2.1 backend + add event subscriptions.

**Deliverables**
1. Remove dead methods from stores (anything calling a method that doesn't exist)
2. Each store gains an `init(eventBus)` that subscribes to relevant events and updates state reactively
   - `conversation.store` ← `conversation:changed`, `conversation:response-needed`, `conversation:resolved`
   - `task.store` ← `task:changed`, `task:entered-approval`, `task:completed`
   - `run.store` ← `run:changed`, `run:assistant-text`, `run:status`, `run:completed`
   - `organization.store` ← `org:changed`, `role:changed`, `skill:changed`
   - `planning.store` ← `planning:plan-ready`
3. `App.tsx` calls `allStores.init()` on mount (ordered: organization first, then others)
4. Delete/archive the 10 dead event subscription paths scattered in components; they move to stores
5. Unit tests per store (vitest) using a `MockCapibaraApi` helper

**Exit criteria**
- `grep -rn "api()" src/renderer/components/` returns near-zero (pages don't call api directly anymore except one-shot mutations like `cancelRun`)
- Every `DesktopEvent` type has a subscriber in some store (check with a typed test)
- Store unit tests at ~50% coverage

### Phase 11 — Section rewrites (5–7 days, parallelizable)
Rewrite each section against the UX wireframes. Order by complexity, starting low-risk.

For each section: **rewrite page → wire to store → write smoke test → review against UX spec**

**Order (suggested)**

| # | Section | LOC before | Complexity | Notes |
|---|---------|-----------:|-----------|-------|
| 1 | **OnboardingWizard** | 386 | Low | Already matches spec; mostly tighten + add test |
| 2 | **SettingsPage** | 184 | Low | Remove log-management sprawl if possible; keep lean |
| 3 | **SkillsPage** | 132 | Low | Currently placeholder; build out list+search+create flow |
| 4 | **OrgSettingsPage** (Workspace) | 225 | Medium | Clean up delete confirmation UX |
| 5 | **DashboardPage** | 112 | Medium-High | Biggest UX gap — spec calls for Narrative Engine; this is a feature add, not just rewrite |
| 6 | **PlanningPage** | 202 | Medium | Align with v2.1 plan:submitted flow (pending plan display + confirm/discard) |
| 7 | **InboxPage** | 273 | Medium-High | Dual-layer (Blocked / Monitoring) per spec; uses new conversation store subs |
| 8 | **TeamPage** | 713 | High | Split into: TeamPage + RoleHierarchy + RoleDrawer + SkillSelector |
| 9 | **TasksPage** | 997 | Highest | Split into: TasksPage + TaskTree + TaskDetailDrawer + TaskCreateModal + RunOutputPanel + RunLogStream; target ~300 LOC for the root page |

**Per-section deliverables**
- Page component ≤ 300 LOC
- All data access through stores
- At least one smoke test per page (render + primary interaction)
- Locale keys reviewed; dead keys removed
- Visual review against `ux-final-wireframes.md`

**Exit criteria**
- All 9 sections match wireframes
- No single component file > 400 LOC
- Renderer test coverage > 40% by LOC
- Manual walkthrough of each section passes

### Phase 12 — Navigation & shell (1 day)
Finalize the shell.

**Deliverables**
1. Decision: stay with home-grown switcher OR adopt `wouter` / TanStack Router (recommendation: stay — see §5)
2. `App.tsx` cleaned up (current: 110 LOC with inline switch and subscription wiring → target: thin shell that delegates to stores)
3. `Sidebar.tsx` split into `Sidebar` + `SidebarNavItem` + `SidebarFooter` (execution control)
4. Section transitions instrumented (log navigation events for observability)

**Exit criteria**
- App.tsx ≤ 80 LOC
- Sidebar.tsx ≤ 200 LOC
- Keyboard shortcut for section nav (Cmd/Ctrl+1..9)

### Phase 13 — i18n cleanup (0.5 day)
**Deliverables**
1. Delete dead keys (`discussions.*`, `projectNarrative`, `discussion`, `discussionTab` if removed from TaskDetailDrawer, etc.)
2. Audit `en-US.ts` and `zh-CN.ts` for completeness (symmetric keys)
3. Add a test: every key path in `LocaleMessages` resolves in both locale files

**Exit criteria**
- Symmetric locale files
- No dead key namespaces
- Compile-time proof via `LocaleMessages` interface

### Phase 14 — Renderer test infrastructure (1 day)
**Deliverables**
1. Vitest + React Testing Library setup for `src/renderer/`
2. `MockCapibaraApi` factory + `MockEventBus` (reuse from existing tests if feasible)
3. `renderWithProviders` test helper (locale context, router stub, toast, etc.)
4. CI job running renderer tests separately

**Exit criteria**
- `pnpm test` runs renderer tests
- Example test passes for each store and each page

---

## 5. Key Design Decisions

### D1 — Incremental rewrite, preserve UI kit
See §2. Greenfield would double churn for no gain.

### D2 — No router library introduced
**Current**: App.tsx switch-statement. **Keep it.**

Routing libraries pay off when you need:
- Deep linking with URL state (Electron app: irrelevant)
- Nested routes with independent layouts (not needed; single shell)
- Route-level code splitting (bundle already small)

The `SectionId` type gives us type-safe navigation; no library needed.

### D3 — Event subscriptions centralize in stores, not components
Mirrors v2.1 backend: service owns its events. Components become dumb renderers.

### D4 — `CapibaraApi` is the single renderer-facing contract
Preload's object shape must match `CapibaraApi` exactly. A CI grep guarantees this.

### D5 — No state management library migration
Zustand stays. It's working; migrating to Redux/Jotai/etc. is a religious war with no payoff.

### D6 — Tailwind v4 stays; theme tokens move to `@theme`
Already done in current renderer. Don't regress.

### D7 — Large pages split aggressively
`TasksPage.tsx` (997 LOC) and `TeamPage.tsx` (713 LOC) are the biggest maintenance risks. Every large page gets split into ≤3 well-named components.

### D8 — Feature add: Narrative Dashboard
The UX spec asks for a Narrative Engine dashboard (replaces dry tabular reporting). This is a **feature addition during rewrite**, not a translation of existing code. Deliverable includes a lightweight template-based narrative renderer (no AI call needed — backend already aggregates data).

### D9 — Accessibility baseline
All interactive elements: keyboard-navigable, focus-visible, correct ARIA roles (Radix handles most). Add a quick axe-core pass per page.

### D10 — No IPC contract changes in this plan
Phase 9 fixes the TypeScript interface to match reality; zero backend IPC surface changes. Phase 10–14 stay within renderer.

---

## 6. Risks & Mitigations

| Risk | Severity | Mitigation |
|------|----------|-----------|
| UX wireframes outdated vs. current backend capabilities | Medium | Review each wireframe against v2.1 entities before implementing; annotate deviations |
| Store subscriptions cause re-render storms | Medium | Zustand fine-grained selectors + React.memo where needed; benchmark top 3 pages |
| Test infra setup eats a day unexpectedly | Low | Start with one example test; expand iteratively |
| Narrative dashboard scope creep | Medium | Template-based v1, no AI calls; future enhancement separate |
| Parallel section rewrites create merge conflicts | Low | Sections touch independent files; rewire `App.tsx` last |
| Silent regressions without tests | High | Phase 14 (test infra) could slot before Phase 11 if bandwidth allows — **revised recommendation: do Phase 14 before Phase 11** |

---

## 7. Revised Phase Order (recommended)

Given the regression risk, reorder:

| Seq | Phase | Description |
|-----|-------|-------------|
| 1 | Phase 9 | Type-safety baseline |
| 2 | Phase 14 | Renderer test infrastructure ← moved earlier |
| 3 | Phase 10 | Store layer refresh (now with test coverage as you go) |
| 4 | Phase 13 | i18n cleanup (cheap, unblocks page rewrites) |
| 5 | Phase 11 | Section rewrites (1→9 as listed) |
| 6 | Phase 12 | Navigation & shell |

**Estimated total**: 10–13 working days for one engineer, 6–8 days with parallel work on sections.

---

## 8. Definition of Done — Whole Renderer Rewrite

- [ ] `CapibaraApi` perfectly matches preload (CI-enforced)
- [ ] Zero orphan `api()` calls (every method called has a handler)
- [ ] All 18 `DesktopEvent` types have at least one subscriber (or are documented as intentionally unhandled)
- [ ] No component file > 400 LOC
- [ ] Each section has a smoke test + one flow test
- [ ] Locale files symmetric, dead keys removed
- [ ] Dashboard has Narrative component (template-based)
- [ ] `pnpm test --run` runs backend + renderer suites, all green
- [ ] Manual walk-through of every section passes UX spec review
- [ ] `docs/` refresh note added to `refactoring-architecture-plan.v2.1-completion.md` pointing to this doc

---

## 9. Out of Scope (this plan)

- Mobile/responsive — app is desktop Electron only
- Theming beyond light/dark (brand tokens are minimal)
- Accessibility audit beyond baseline (full WCAG 2.2 AA audit is a future initiative)
- Localization beyond en-US and zh-CN
- Performance profiling (unless a page regresses noticeably)
- Renderer-side persistence (localStorage) — not used today, no driver to add

---

## 10. Resolved Decisions (2026-04-24)

| # | Question | Decision | Impact |
|---|----------|----------|--------|
| 1 | Dashboard Narrative rendering | **Template-based v1** — no AI call. Backend already aggregates the needed data; renderer composes a human-readable summary from it. | No new MCP tool / backend handler needed. Narrative module is pure renderer code. |
| 2 | Skills page depth | **Standard list + search + create + delete** (functional, non-game). Align with the other "entity management" pages (Roles, Organizations) for UX consistency. The "game-like" vision in the UX spec is deferred to a future initiative. | Scope bounded: ~200 LOC for SkillsPage; reuse list/search patterns from Team and Org pages. |
| 3 | Test coverage target | **50% LOC** on renderer code. | Phase 14 test infra must support component + store + hook tests; CI gate at 50%. |
| 4 | Merge strategy | **Feature branch until whole rewrite complete**, then single merge to `main`. | All Phase 9–14 work lives on a branch (e.g. `renderer-rewrite`). No partial-state `main`. Reduces merge conflicts with any backend hotfix work. |

Additional item noted (deferred):
- **Bundle size budget**: not set now. Revisit after Phase 11 when we have real numbers.

---

*Plan approved. Phase 9 starts immediately.*
