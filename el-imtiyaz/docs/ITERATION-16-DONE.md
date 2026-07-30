# ITERATION 16 — DONE

## Settings Tab Navigation Refactor + Codebase Structure Cleanup

**Date:** 2026-07-31
**Baseline:** Iteration 15 (1149 tests, typecheck clean, build clean)
**Final state:** 1180 tests passing (+31 new), typecheck clean, build clean, electron main compiles

---

## Scope

Per the user's explicit priorities:

1. **Settings page tab navigation.** "I want the Settings page to use a tab-based navigation system, similar to the other sections of the application. Each settings category should have its own tab, following the same navigation pattern, layout, and design language used elsewhere in the app."

2. **Refactor the codebase structure.** "The current codebase structure is poorly organized and difficult to maintain. Refactor the project into a clean, scalable, and production-quality architecture. Reorganize the folder structure to follow modern best practices. Group related files logically, eliminate unnecessary nesting, remove dead or duplicate code, and establish a clear separation of concerns. The final structure should be consistent, easy to navigate, and maintainable."

---

## Completed

### Part 1 — Settings Page Tab Navigation Refactor

#### Problem

The Settings page was the ONLY Hub page using `variant="rail"` (left vertical rail) for its tab navigation. Every other Hub page (Dashboard, CRM, Financials, Academics, Personnel, Workflow) uses the DEFAULT `variant="elevated"` (segmented control). This made Settings visually inconsistent with the rest of the application.

#### Fix

**File:** `src/features/settings/settings-page.tsx` (rewritten — 461 → 150 lines)

- Removed `variant="rail"` — now uses the default `variant="elevated"` (segmented control), matching every other Hub page.
- Removed `flex flex-row gap-6` className — now uses `flex-1 flex flex-col px-6 pb-6 min-h-0` (the same pattern as CRM, Financials, Academics, etc.).
- Added `scrollable` prop to `<PageTabList>` so the 10-tab list scrolls horizontally on narrower windows instead of overflowing.
- Refactored the tab param validation into a `VALID_TABS` constant + `SettingsTabId` type (was a long inline conditional).

#### File extraction

The 461-line `settings-page.tsx` had inline `AuditLogTab`, `AuditDiffDrawer`, `LockedFeaturesTab`, `AccessDeniedCard`, `RbacMatrixTab`, `AiConfigTab`, and `BackupTab` functions. Extracted each into its own file so the page is a thin shell that just wires tabs to components — matching the structure of every other feature module:

- **New:** `src/features/settings/audit-log-tab.tsx` — `AuditLogTab` + `AuditDiffDrawer` + `AccessDeniedCard` (exported).
- **New:** `src/features/settings/locked-features-tab.tsx` — `LockedFeaturesTab`.
- `settings-page.tsx` is now a thin shell (~150 lines) that imports all 10 tab components.

#### Result

The Settings page now uses the SAME tab navigation pattern as every other Hub page. The 10 settings categories (Général, Tarification, Journal d'audit, Matrice RBAC, Inscriptions, Configuration, Synchronisation, IA, Sauvegardes, Fonctionnalités verrouillées) each have their own tab in a horizontal segmented control that scrolls on narrow windows.

### Part 2 — Codebase Structure Refactor

A thorough audit (see "Audit Findings" below) identified 10 high-impact refactors. This iteration completed 8 of them (the remaining 2 — splitting the 3,246-LOC `mock-repositories.ts` megafile and renaming 16 `iteration-N-*.test.ts` files — were deferred as too risky for a single iteration).

#### 2.1 Dead code removal

**Deleted files (3):**

- `src/shared/components/confirm-dialog.tsx` — was a transparent passthrough wrapper around `ConfirmModal`, kept "for backward compatibility" per its own comment. Migrated 3 callers (`pricing-tab.tsx`, `subjects-directory-tab.tsx`, `expense-detail-drawer.tsx`) to import `ConfirmModal` directly from `unified-modal.tsx`, then deleted the shim.
- `src/infrastructure/sync/mock-data-flag.ts` — exported `isMockMode()` and `dataSourceLabel()` but `sync-provider.tsx` inlined the logic and never imported this module. Zero importers anywhere.
- (The previously-deleted `src/shared/ui/dialog.tsx` from iteration 15 stays deleted.)

**Deleted API surface:**

- `PricingRepository.updateTuition()` — declared `@deprecated` in `domain/repository/repository.ts`, implemented in `infrastructure/mock/mock-repositories.ts`, zero callers anywhere. Replaced by `updateTuitionForGradeLevel()`.
- `PricingRepository.updateTransport()` — same. Replaced by `updateTransportForDestination()`.

**Removed unused import + suppression:**

- `src/features/profile/change-password-modal.tsx` — had `import { Button }` + `void Button; // satisfy unused import` at the end. Deleted both.

#### 2.2 `shared/components/` reorganization (24 files → 0)

The `shared/components/` folder mixed 6 unrelated concerns (app chrome, layout helpers, primitives, domain modals, form helpers, animation). Reorganized into:

- **`shared/layout/`** (9 files) — app chrome + layout helpers:
  - `topbar.tsx`, `sidebar.tsx`, `modal-host.tsx`, `toast-viewport.tsx` (app chrome — rendered once at the app root)
  - `page-header.tsx`, `page-tabs.tsx`, `state-views.tsx`, `coming-soon-card.tsx`, `gated-content.tsx` (layout helpers used across many feature pages)

- **`shared/ui/`** (+6 files) — generic stateless UI primitives:
  - `unified-modal.tsx`, `form-field.tsx`, `money-input.tsx`, `kpi-card.tsx`, `status-chip.tsx`, `particle-canvas.tsx`

- **Feature folders** (8 files) — domain-specific components moved to their consuming feature:
  - `features/dashboard/`: `alert-creator-modal.tsx`, `alert-detail-modal.tsx`, `dashboard-calendar.tsx`, `calendar-event-creator-modal.tsx`, `academic-year-selector.tsx`
  - `features/profile/`: `change-password-modal.tsx`
  - `infrastructure/sync/`: `sync-indicator.tsx`
  - `i18n/`: `language-switcher.tsx`

- **Deleted:** `shared/components/confirm-dialog.tsx` (see 2.1)

After the moves, `shared/components/` is empty and deleted. The folder no longer exists.

#### 2.3 Provider consolidation (6 files → `app/providers/`)

Previously, 4 React Context providers lived in `state/` and 2 more lived in `infrastructure/`. The split was arbitrary — all 6 are React Context providers that scope a service to the React tree. Consolidated all 6 into `app/providers/`:

- `state/auth-context.tsx` → `app/providers/auth-provider.tsx`
- `state/modal-context.tsx` → `app/providers/modal-provider.tsx`
- `state/toast-context.tsx` → `app/providers/toast-provider.tsx`
- `state/user-preferences-context.tsx` → `app/providers/user-preferences-provider.tsx`
- `infrastructure/repository-provider.tsx` → `app/providers/repository-provider.tsx`
- `infrastructure/sync/sync-provider.tsx` → `app/providers/sync-provider.tsx`

Hook names stay the same (`useAuth`, `useModal`, `useToast`, `useUserPreferences`, `useRepositories`, `useSyncStatus`/`useSyncActions`); only the import paths change. The `state/` folder is deleted.

This establishes a single convention: **all React Context wiring lives in `app/providers/`**. The `infrastructure/` folder is now purely for service implementations (Supabase, mock, sync service, backup, etc.), not React glue.

#### 2.4 Single-file subfolder flattening (11 folders → 0)

Folders with only 1 file add a navigation hop without adding information. Flattened 11 single-file subfolders:

| Before | After |
|---|---|
| `core/audit/audit-actions.ts` | `core/audit-actions.ts` |
| `core/errors/app-error.ts` | `core/app-error.ts` |
| `core/logging/logger.ts` | `core/logger.ts` |
| `core/result/result.ts` | `core/result.ts` |
| `domain/ai/pii-mask.ts` | `domain/pii-mask.ts` |
| `domain/reconciliation/reconcile.ts` | `domain/reconcile.ts` |
| `domain/workflow/kahn.ts` | `domain/kahn.ts` |
| `infrastructure/config/system-config.ts` | `infrastructure/system-config.ts` |
| `infrastructure/pdf/receipt-pdf.ts` | `infrastructure/receipt-pdf.ts` |
| `shared/search/search-index.ts` | `shared/search-index.ts` |
| `shared/particle-engine/color/interpolator.ts` | `shared/particle-engine/color-interpolator.ts` |

#### 2.5 Import path updates

After all the moves, 160 + 72 + 191 = **423 import statements** across **190 files** were updated to reflect the new paths. Three Python scripts (in `/home/z/my-project/scripts/`) handled the mechanical replacements:

- `update-imports.py` — updated `shared/components/X` → `shared/layout/X` or `shared/ui/X` (160 replacements in 68 files).
- `flatten-imports.py` — updated flattened subfolder paths (72 replacements in 38 files).
- `consolidate-providers.py` — updated `state/X-context` → `app/providers/X-provider` (191 replacements in 84 files).

Plus targeted `sed` fixes for relative-path adjustments within the moved files themselves.

---

## Final Structure

```
src/
  app/                          # App shell + providers
    app.tsx                     # Root component with provider tree
    app-shell.tsx               # Layout shell (sidebar + topbar + content)
    splash-gate.tsx             # Splash screen gate
    providers/                  # All React Context providers (NEW)
      auth-provider.tsx
      modal-provider.tsx
      toast-provider.tsx
      user-preferences-provider.tsx
      repository-provider.tsx
      sync-provider.tsx

  core/                         # Pure utilities (no React, no I/O)
    app-error.ts                # (was core/errors/app-error.ts)
    audit-actions.ts            # (was core/audit/audit-actions.ts)
    logger.ts                   # (was core/logging/logger.ts)
    result.ts                   # (was core/result/result.ts)
    format/                     # currency, date, phone (3 files — kept as folder)
    rbac/                       # roles, permissions, session, feature-registry, access-state (5 files)

  domain/                       # Domain models + repository contracts
    model/                      # 16 model files + index.ts barrel
    repository/                 # repository.ts, workforce-repository.ts, operations-repository.ts
    pii-mask.ts                 # (was domain/ai/pii-mask.ts)
    reconcile.ts                # (was domain/reconciliation/reconcile.ts)
    kahn.ts                     # (was domain/workflow/kahn.ts)

  features/                     # Feature modules (each self-contained)
    academics/    auth/    crm/    dashboard/    financials/
    personnel/    profile/    routing/    settings/    workflow/
    # Domain-specific components now co-located with their consumers:
    #   dashboard/alert-creator-modal.tsx, alert-detail-modal.tsx,
    #   dashboard-calendar.tsx, calendar-event-creator-modal.tsx,
    #   academic-year-selector.tsx
    #   profile/change-password-modal.tsx

  infrastructure/               # External adapters (no React)
    ai/                         # llm-adapter, ai-config-storage
    backup/                     # backup-service, indexed-db-vault, backup-scheduler
    excel/                      # export-engine, reports, import-engine/ (subsystem)
    mock/                       # mock-repositories + workforce + operations mock
    supabase/                   # supabase-client, types, supabase-repositories, repositories/
    sync/                       # sync-service, sync-types, sync-queue-store, online-detector, sync-indicator
    receipt-pdf.ts              # (was infrastructure/pdf/receipt-pdf.ts)
    system-config.ts            # (was infrastructure/config/system-config.ts)

  shared/                       # Shared UI + layout + hooks
    layout/                     # NEW — app chrome + layout helpers (9 files)
      topbar.tsx, sidebar.tsx, modal-host.tsx, toast-viewport.tsx,
      page-header.tsx, page-tabs.tsx, state-views.tsx,
      coming-soon-card.tsx, gated-content.tsx
    ui/                         # shadcn primitives + moved UI primitives (22 files)
      button, input, card, badge, label, textarea, select, switch,
      dropdown-menu, scroll-area, separator, tooltip, progress, avatar,
      cn,
      unified-modal, form-field, money-input, kpi-card, status-chip,
      particle-canvas
    hooks/                      # use-observable
    particle-engine/            # 12 files (physics, pipeline, color-interpolator, etc.)
    search-index.ts             # (was shared/search/search-index.ts)

  i18n/                         # Internationalization
    i18n.ts, fr.ts, ar.ts
    language-switcher.tsx       # (was shared/components/language-switcher.tsx)

  test/                         # 55 test files
    setup.ts
    component/    integration/    unit/

  app.tsx is in app/, main.tsx is at src/ root
```

**Key improvements:**
- `shared/components/` folder is GONE (was 24 files mixing 6 concerns).
- `state/` folder is GONE (providers moved to `app/providers/`).
- 11 single-file subfolders are flattened.
- Domain-specific components are co-located with their consumers.
- Layout primitives are separated from UI primitives.
- All React Context wiring is in one place (`app/providers/`).

---

## Tests — 31 New Tests, 0 Regressions

**New test files:**

- `src/test/unit/iteration-16-settings-tabs-refactor.test.ts` (16 tests):
  - settings-page.tsx uses the DEFAULT elevated tab variant (NOT rail).
  - settings-page.tsx uses the SAME className pattern as every other Hub page.
  - settings-page.tsx PageTabList is scrollable (so 10 tabs don't overflow).
  - settings-page.tsx is a thin shell (under 200 lines).
  - settings-page.tsx does NOT contain inline AuditLogTab / LockedFeaturesTab functions.
  - audit-log-tab.tsx exists and exports AuditLogTab + AccessDeniedCard.
  - locked-features-tab.tsx exists and exports LockedFeaturesTab.
  - settings-page.tsx imports AuditLogTab + LockedFeaturesTab from their own files.
  - Every Settings tab file is under 1000 lines.
  - 7 Hub-page consistency tests (every Hub page uses the default elevated variant).

- `src/test/unit/iteration-16-structure-refactor.test.ts` (15 tests):
  - The dead `shared/components/` folder is gone.
  - The dead `state/` folder is gone.
  - The dead `confirm-dialog.tsx` shim is gone.
  - The dead `mock-data-flag.ts` module is gone.
  - `shared/layout/` folder exists with the expected 9 layout primitives.
  - `shared/ui/` contains the 7 primitives that were moved from `shared/components/`.
  - `app/providers/` contains all 6 React Context providers.
  - Domain-specific components live in their feature folders (not shared/).
  - 11 single-file subfolders were flattened.
  - `PricingRepository` no longer declares the deprecated `updateTuition` / `updateTransport` methods.
  - `mock-repositories.ts` no longer implements the deprecated methods.
  - No production file imports from the old `shared/components/` path.
  - No production file imports from the old `state/` path.
  - No production file imports from the old `infrastructure/repository-provider` path.
  - The dead `change-password-modal.tsx` Button import + void suppression are gone.

**Final test count: 1180 passing** (was 1149 baseline + 31 new, 0 regressions)

---

## Build Verification

- `tsc --noEmit` — clean (0 errors)
- `tsc -p electron/tsconfig.json` — clean (electron main compiles)
- `vite build` — succeeds in ~15s, all chunks build successfully
- `vitest run` — 55 files, 1180 tests passing in ~110s

---

## Audit Findings (Pre-Refactor)

A thorough audit of the existing codebase revealed:

- **1 truly dead file** (`infrastructure/sync/mock-data-flag.ts` — zero importers).
- **2 deprecated API methods** (`PricingRepository.updateTuition` / `updateTransport` — zero callers).
- **1 duplicate file** (`confirm-dialog.tsx` ≡ `ConfirmModal` preset — kept "for backward compatibility" but there's nothing to be backward-compatible with).
- **13 single-file subfolders** (over-nesting).
- **2 overloaded folders** (`shared/components/` with 24 files, `domain/model/` with 17).
- **8 giant files needing split** (>700 LOC, led by `mock-repositories.ts` at 3,246).
- **4 TODO/FIXME markers** (very clean codebase).
- **54 test files** (16 with `iteration-N-` prefix, 38 descriptive).

The audit produced a ranked top-10 list of highest-impact refactors. This iteration completed items #1 (shared/components reorg), #2 (provider consolidation), #3 (dead code removal), #4 (ConfirmDialog deletion), #5 (deprecated methods), #6 (single-file subfolder flattening), #9 (Button import cleanup), and the Settings tab navigation refactor. Items #7 (split mock-repositories.ts megafile) and #8 (rename iteration-N test files) were deferred as too risky for a single iteration.

---

## Architecture Decisions

1. **`variant="elevated"` (default) for Settings** — matches every other Hub page. The `scrollable` prop on `PageTabList` handles the 10-tab count on narrower windows.

2. **Each Settings tab in its own file** — matches the structure of every other feature module. The settings-page.tsx is now a thin shell (~150 lines) that just wires tabs to components.

3. **`shared/layout/` for app chrome + layout helpers** — separates "things that define the page structure" (PageHeader, PageTabs, StateViews) from "things that are interactive primitives" (Button, Input, Modal). The split makes both folders easier to navigate.

4. **Domain-specific components co-located with consumers** — `alert-creator-modal.tsx` lives in `features/dashboard/` because that's its primary consumer. The personnel feature imports it via `../dashboard/alert-creator-modal`. This is the standard feature-module pattern.

5. **`app/providers/` for all React Context** — establishes a single convention. Previously, providers were split across `state/` and `infrastructure/` arbitrarily. Now there's one place to look.

6. **Flattened single-file subfolders** — `core/audit/audit-actions.ts` is more keystrokes than `core/audit-actions.ts` and conveys the same information. The folder was just an extra navigation hop.

7. **Did NOT split `mock-repositories.ts` (3,246 LOC)** — this would touch 100+ imports across the codebase and is too risky for a single iteration. Documented as remaining work for iteration 17. The pattern is already established with `workforce-mock-repositories.ts` and `operations-mock-repositories.ts`.

8. **Did NOT rename `iteration-N-*.test.ts` files** — 16 test files use the iteration prefix. Renaming them would lose the traceability to `docs/ITERATION-N-DONE.md`. The iteration prefix is preserved as a header comment in each renamed file (deferred to a future cleanup iteration).

---

## Known Issues

1. **`mock-repositories.ts` is still 3,246 LOC** (carried from iteration 14) — contains 26 mock repository classes. Splitting it into per-domain files is documented as iteration-17 work.

2. **`domain/model/index.ts` barrel is incomplete** (carried from iteration 15) — re-exports only 9 of 16 model files. Only 1 file uses the barrel. Either complete it or delete it (deferred).

3. **`domain/model/` still has 17 files** (carried from iteration 15) — could be sub-grouped by domain (crm/, financials/, academics/, etc.). Deferred.

4. **16 test files still use `iteration-N-` prefix** — renaming them is documented as low-priority cleanup.

5. **AI keys still have two storage layers** (carried from iteration 13) — `AIConfigTab` writes to localStorage, `ConfigurationTab → IA` writes to Supabase Edge Function env. Consolidation requires either disabling the AI tab in mock mode or implementing a fallback chain.

6. **38 repositories still on mock** (carried from iteration 12) — only Auth + Approval repositories are fully ported to Supabase.

---

## Next Iteration Roadmap

1. **Split `mock-repositories.ts` (3,246 LOC) into per-domain mock files** — apply the established pattern (`workforce-mock-repositories.ts`, `operations-mock-repositories.ts`) to the remaining 21 mock classes. Turn the megafile into ~10 manageable files of 200-500 LOC each.

2. **Complete or delete the `domain/model/index.ts` barrel** — either add the missing 7 re-exports and migrate consumers, or delete the barrel and migrate the 1 caller to direct imports.

3. **Sub-group `domain/model/` by domain** — `domain/model/crm/`, `domain/model/financials/`, `domain/model/academics/`, etc.

4. **Rename 16 `iteration-N-*.test.ts` files to descriptive names** — preserve iteration traceability via a header comment block.

5. **Consolidate AI key storage** (carried from iteration 13).

6. **Port remaining 38 repositories to Supabase** (carried from iteration 12).

7. **Per-entity sync push routing** (carried from iteration 14).

8. **Realtime sync conflict resolution** (carried from iteration 14).

9. **BON + Devis sheet importers** (carried from iteration 11).

10. **Unify `overdueAmount` semantics** (carried from iteration 6).
