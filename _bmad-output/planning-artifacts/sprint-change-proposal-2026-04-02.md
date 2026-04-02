# Sprint Change Proposal: Internationalization (i18n) Support

**Date:** 2026-04-02
**Author:** uoyo (facilitated by Scrum Master)
**Status:** Approved
**Change Scope:** Minor

---

## 1. Issue Summary

### Problem Statement

Capibara currently has no internationalization (i18n) framework. All UI strings are hardcoded in English via a single `shared/locale.ts` file containing a flat `LOCALE` object. The target user base includes Chinese-speaking users who need to operate the system in their native language.

### Context

- This is a **new product requirement**, not discovered during implementation
- The existing `shared/locale.ts` already centralizes string management — providing a solid foundation for i18n expansion
- The `settings` SQLite table already exists (key-value store) but has no Repository implementation yet
- No i18n library is currently installed

### Requirements

1. **MVP Languages:** Chinese (zh-CN) and English (en-US)
2. **Auto-Detection:** On first launch, detect the OS locale and set the default language
3. **User Switching:** Users can switch language at any time
4. **Persistence:** Language preference is stored and restored across sessions

---

## 2. Impact Analysis

### Epic Impact

| Epic | Impact Level | Description |
|------|-------------|-------------|
| Epic 1 (Shell & Infrastructure) | **Direct** | New Story 1.7 for i18n infrastructure |
| Epic 2-7 | **Indirect** | UI stories must use i18n keys instead of hardcoded strings (pattern compliance, not structural change) |
| Epic 8 (Human Intervention) | **Direct** | Story 8.3 — notification text must be localized |
| Epic 9 (Narrative Engine) | **Direct** | Story 9.1 — LLM polish layer must generate in user's preferred language |
| Epic 10 (Resilience) | **None** | No UI-facing changes |

### Story Impact

| Story | Change Type | Detail |
|-------|------------|--------|
| **NEW Story 1.7** | Addition | Full i18n infrastructure: locale module, Settings Repository, React Context, language selector UI |
| Story 9.1 | AC modification | Narrative LLM polish receives locale parameter |
| Story 8.3 | AC modification | Notification text uses locale |

### Artifact Conflicts

| Artifact | Conflict | Resolution |
|----------|----------|------------|
| PRD | No i18n functional requirement | Add FR-14, update MVP scope to FR-01–FR-14 |
| Architecture | `shared/locale.ts` is a flat file, no i18n strategy | Add Section 16, expand to `shared/locale/` module |
| UX Design | No language switcher | Add Pattern 4 (Language Selector), update Journey 1 |
| Project Structure | Single locale.ts | Replace with locale/ directory |

### Technical Impact

- **Dependencies:** None required for MVP (React Context approach, no i18next)
- **Database:** Settings table already exists; need to implement `ISettingsRepository` + `SqliteSettingsRepository`
- **IPC:** Three new channels: `capibara:settings:get`, `capibara:settings:update`, `capibara:settings:locale-changed`
- **Renderer:** New `LocaleProvider` context, `useLocale()` and `useT()` hooks
- **Existing Code:** `shared/locale.ts` content migrated to `shared/locale/en-US.ts`, original file replaced

---

## 3. Recommended Approach

### Selected Path: Direct Adjustment

Add i18n as a new Story within existing Epic 1, with minor AC updates to Epic 8 and Epic 9. No rollback, no MVP scope reduction needed.

### Rationale

1. **Low effort:** The existing `shared/locale.ts` already centralizes strings — migration to a structured locale module is straightforward
2. **Low risk:** i18n is additive; it doesn't change business logic, data flow, or architecture patterns
3. **No timeline impact:** Story 1.7 can be implemented alongside or after other Epic 1 stories
4. **No dependency changes:** React Context is sufficient for MVP; no new npm packages required
5. **Foundation exists:** Settings table is already in the database, just needs Repository wiring

### Effort Estimate: Low-Medium

- Story 1.7 implementation: ~1 session (locale module + Settings Repository + React Context + language selector)
- Story 9.1 / 8.3 modifications: Minimal (parameter passing)
- Document updates: Already detailed in this proposal

### Risk Assessment: Low

- No architectural changes
- No database schema changes (settings table exists)
- No new external dependencies
- Backward compatible — English remains the fallback

---

## 4. Detailed Change Proposals

### 4.1 PRD Changes

#### PRD-1: Add FR-14 Internationalization

**Location:** Section 3. Functional Requirements (after FR-13)

**Add:**

```markdown
### FR-14: Internationalization (i18n)

**Priority: MVP**

The system shall support multilingual user interface:

- **MVP Languages**: Chinese (zh-CN) and English (en-US)
- **Auto-Detection**: On first launch, detect the operating system's locale
  and set the default language accordingly (fallback to en-US)
- **User Preference**: Users can switch language at any time via the
  application settings
- **Preference Persistence**: Selected language is stored in the Settings
  table and restored on subsequent launches
- **Scope**: All static UI strings (navigation labels, button text, status
  labels, error messages, placeholder text) are translated
- **Narrative Engine Integration**: The Narrative Engine's LLM polish layer
  receives the user's language preference and generates narratives in the
  selected language
- **Desktop Notifications**: Notification text follows the user's language
  preference
```

#### PRD-2: Update Data Model — Settings Entity

**Location:** Section 7. Data Model

**Old:**
```
| Settings | Application settings | key, value |
```

**New:**
```
| Settings | Application settings | key, value (e.g., locale: 'zh-CN' | 'en-US') |
```

#### PRD-3: Update MVP Scope

**Location:** Section 9. MVP Scope vs Future > MVP (V1)

**Old:**
```
All FR-01 through FR-13 as defined above.
```

**New:**
```
All FR-01 through FR-14 as defined above.
```

---

### 4.2 Architecture Changes

#### ARCH-1: Add Section 16 — i18n Strategy

**Location:** After Section 15 (ADR Index)

**Add:**

```markdown
## 16. Internationalization (i18n)

### 16.1 Strategy

MVP uses a lightweight React Context-based i18n approach. No external i18n
library required.

### 16.2 Locale Module Structure

`shared/locale/` replaces the single `shared/locale.ts` file:

| File | Purpose |
|------|---------|
| `shared/locale/types.ts` | `SupportedLocale` type, `LocaleMessages` interface |
| `shared/locale/en-US.ts` | English translation strings |
| `shared/locale/zh-CN.ts` | Chinese translation strings |
| `shared/locale/index.ts` | Locale registry, `getMessages(locale)` lookup |

### 16.3 Architecture Layers

| Layer | i18n Responsibility |
|-------|-------------------|
| **shared/** | Locale type definitions, translation message objects |
| **Main Process** | Reads `locale` from Settings table, provides via IPC |
| **Preload** | Bridges locale IPC methods |
| **Renderer** | `LocaleProvider` React Context, `useLocale()` hook, `useT()` hook |

### 16.4 OS Language Detection

On first launch (no `locale` key in Settings):
1. Main Process reads `app.getLocale()` (Electron API)
2. Maps to supported locale: `zh` prefix -> `zh-CN`, else -> `en-US`
3. Stores result in Settings table

### 16.5 Language Switching Flow

User clicks language selector (Renderer)
  -> IPC call: capibara:settings:update { key: 'locale', value: 'zh-CN' }
  -> Main Process updates Settings table
  -> Main Process emits 'settings:locale-changed' on EventBus
  -> IPC push: capibara:settings:locale-changed { locale: 'zh-CN' }
  -> Renderer LocaleProvider updates context
  -> All components re-render with new locale

### 16.6 Narrative Engine Integration

The Narrative Engine's Layer 3 (LLM Polish) receives the user's locale
preference as a parameter. The LLM polish prompt includes an instruction
like: "Generate the narrative in {locale_language}."

### 16.7 IPC Channels

| Channel | Direction | Payload |
|---------|-----------|---------|
| `capibara:settings:get` | Renderer -> Main | `{ key: string }` |
| `capibara:settings:update` | Renderer -> Main | `{ key: string, value: string }` |
| `capibara:settings:locale-changed` | Main -> Renderer | `{ locale: SupportedLocale }` |
```

#### ARCH-2: Update Project Structure

**Location:** Section 11. Project Structure > `shared/`

**Old:**
```
│   └── shared/
│       ├── contracts.ts
│       └── locale.ts
```

**New:**
```
│   └── shared/
│       ├── contracts.ts
│       └── locale/
│           ├── types.ts
│           ├── en-US.ts
│           ├── zh-CN.ts
│           └── index.ts
```

#### ARCH-3: Update IPC Channel Examples

**Location:** Section 10.2 IPC Channel Naming (examples)

**Append:**
```
- `capibara:settings:get`
- `capibara:settings:update`
- `capibara:settings:locale-changed`
```

---

### 4.3 Epic/Story Changes

#### EPIC-1: Add Story 1.7 — i18n Infrastructure

**Location:** After Story 1.6 in Epic 1

**Add:**

```markdown
### Story 1.7: Implement Internationalization (i18n) Infrastructure

As a user,
I want the application to display in my preferred language (Chinese or English),
So that I can use the system comfortably in my native language.

**Acceptance Criteria:**

**Given** the application shell and config system from Stories 1.5-1.6
**When** the i18n infrastructure is created
**Then** `shared/locale/` module exists with `types.ts`, `en-US.ts`,
  `zh-CN.ts`, and `index.ts`
**And** `SupportedLocale` type is defined as `'en-US' | 'zh-CN'`
**And** `LocaleMessages` interface defines typed keys for all UI strings
**And** both `en-US.ts` and `zh-CN.ts` implement the full `LocaleMessages`
  interface
**And** existing hardcoded strings in `shared/locale.ts` are migrated to the
  new structure
**And** `ISettingsRepository` interface is defined in `core/interfaces/` with
  `get(key)`, `set(key, value)`, `getAll()` methods
**And** `SqliteSettingsRepository` implements the interface using the existing
  `settings` table
**And** the repository is registered in composition-root.ts via
  `SETTINGS_REPO_TOKEN`
**And** on first launch, Main Process detects OS locale via `app.getLocale()`
  and stores in Settings as `locale` key
**And** locale detection maps `zh*` prefixes to `zh-CN`, all others to `en-US`
**And** IPC channels `capibara:settings:get` and `capibara:settings:update`
  are defined in `shared/contracts.ts` with Zod schemas
**And** IPC channel `capibara:settings:locale-changed` pushes locale changes
  to Renderer
**And** Renderer provides `LocaleProvider` React Context wrapping `App.tsx`
**And** `useLocale()` hook returns current `SupportedLocale`
**And** `useT()` hook returns the `LocaleMessages` object for the current
  locale
**And** a language selector is available in the navigation sidebar (bottom
  area or settings dropdown)
**And** switching language immediately updates all UI strings without page
  reload
**And** language preference persists across application restarts
```

#### EPIC-9: Update Story 9.1 Acceptance Criteria

**Location:** Story 9.1, Acceptance Criteria

**Old:**
```
**And** Layer 3 (LLM Polish): a single LLM call converts the structured
template into natural language narrative prose
```

**New:**
```
**And** Layer 3 (LLM Polish): a single LLM call converts the structured
template into natural language narrative prose in the user's preferred
language (read from Settings `locale` key)
```

#### EPIC-8: Update Story 8.3 Acceptance Criteria

**Location:** Story 8.3, Acceptance Criteria

**Old:**
```
**Then** an Electron native desktop notification is shown with: task title,
role requiring approval, a brief summary line
```

**New:**
```
**Then** an Electron native desktop notification is shown with: task title,
role requiring approval, a brief summary line — all text localized per the
user's language preference
```

---

### 4.4 UX Design Changes

#### UX-1: Add Pattern 4 — Language Selector

**Location:** UX Patterns section (after Pattern 3)

**Add:**

```markdown
### Pattern 4: Language Selector

A compact language selector is placed in the bottom area of the left
navigation sidebar, near application-level settings. It displays the current
language as a short label (e.g., "EN" / "中文"). Clicking it opens a dropdown
with the two supported languages. Switching language immediately updates all
interface text without page reload or navigation disruption. The selector
uses a globe icon to indicate its purpose.
```

#### UX-2: Update User Journey 1

**Location:** Key User Journeys > 1. Organization & Skills Setup

**Old (first line):**
```
- **Scenario:** A user configures AI roles upon first use or when starting
  a new project.
```

**New (first line):**
```
- **Scenario:** A user launches the application for the first time. The
  system automatically detects the OS language and displays the interface in
  the appropriate language (Chinese or English). The user then configures AI
  roles or starts a new project.
```

---

## 5. Implementation Handoff

### Change Scope Classification: Minor

All changes can be implemented directly by the development team within the existing sprint structure.

### Handoff Plan

| Recipient | Responsibility | Deliverables |
|-----------|---------------|-------------|
| **Developer (Architect)** | Update Architecture document with Section 16, project structure, IPC channels | Updated `architecture.md` |
| **Developer (Implementation)** | Implement Story 1.7: locale module, Settings Repository, React Context, language selector | Working i18n infrastructure |
| **Developer (Implementation)** | Update existing UI components to use `useT()` hook instead of hardcoded `LOCALE` object | Migrated string references |
| **Product Manager** | Update PRD with FR-14, data model, MVP scope | Updated `prd.md` |
| **Scrum Master** | Update epic/story tracking, add Story 1.7 to sprint plan | Updated `epics.md`, sprint status |

### Success Criteria

1. Application launches in the user's OS language (Chinese or English)
2. Language selector in sidebar allows switching between zh-CN and en-US
3. All static UI strings update immediately on language switch
4. Language preference persists across application restarts
5. Narrative Engine generates text in the selected language

### Dependencies

- Story 1.7 depends on Stories 1.3 (SQLite) and 1.5 (Renderer Shell)
- Story 1.7 should be completed before UI stories in Epics 2-9 to establish the i18n pattern

---

## Change Summary

| Metric | Value |
|--------|-------|
| **Issue addressed** | No i18n support; Chinese users cannot use the system in their native language |
| **Change scope** | Minor — Direct adjustment within existing Epic structure |
| **New stories** | 1 (Story 1.7) |
| **Modified stories** | 2 (Story 8.3, Story 9.1 — AC updates only) |
| **Artifacts modified** | PRD, Architecture, Epics, UX Design Specification |
| **New epics** | 0 |
| **Removed epics** | 0 |
| **Timeline impact** | None — fits within current sprint plan |
| **Risk level** | Low |
