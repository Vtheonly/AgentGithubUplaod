# Menus, Popovers, Flyouts, Context Menus & Tooltips — Comparison and Unification Plan

Session 2 UI audit, category 3. All paths relative to `elimtiyaz-desktop/src/`.

## 1. Category reality check (grep-verified)

- **Popover / HoverCard: ZERO implementations.** No Radix Popover, no hand-rolled popover, no flyout pattern anywhere (`rg 'Popover|HoverCard' --type tsx` → 0 files). The owner's "popovers/flyouts" category is served entirely by the **DropdownMenu** family below.
- **Context menus: ZERO implementations.** `onContextMenu` has 0 call sites. Right-click menus do not exist in the app. (Recorded so the next session does not hunt for them.)
- **Pop-up menus = DropdownMenu (exactly one primitive, correctly wrapped).**

## 2. Pop-up menu implementations

### 2.1 The base primitive — `shared/ui/dropdown-menu.tsx` (75 lines)

Radix DropdownMenu wrapper: `z-50 min-w-[10rem] rounded-md border border-border bg-popover p-1 shadow-md`, fade+zoom animate-in/out, items `focus:bg-accent/15`. Consistent with the modal token vocabulary (`bg-popover`/`border-border`). **Direct importers (5):**

- `i18n/language-switcher.tsx`
- `features/workflow/dag-canvas.tsx` (canvas node menus)
- `features/settings/audit-log-tab.tsx`
- `features/academics/placement/student-placement-card.tsx`
- `features/dashboard/academic-year-selector.tsx`

### 2.2 The standardized actions-menu pair (the app's best UI-unification story)

- **`shared/ui/parent-actions-menu.tsx`** (178 lines) and **`shared/ui/student-actions-menu.tsx`**: identical pattern — ghost icon Button trigger (`MoreHorizontal`, `h-7 w-7`), `DropdownMenuContent align w-60`, label header with person name + code, then navigation actions wired to `usePersonNavigation()` (Aperçu rapide → drawer; Ouvrir dans CRM/Finances/Pédagogie → deep links), contact actions (WhatsApp/phone/mail via `window.open`), stopPropagation guards.
- Used across every person table/list surface (CRM, financials debt tabs, dashboard Pareto, academics directory) — one visual and behavioral dialect for "actions on a person".
- Known duplication (S1 DUP-022): ParentActionsMenu hand-rolls `cleanPhone` + `wa.me` URL instead of `shared/utils/whatsapp.ts` — logic-level, fix is already roadmap item 1.8.

### 2.3 Other in-page "menu-like" surfaces (inventory for completeness)

- `features/settings/pricing/pricing-year-config-bar.tsx` — year selection bar (Select-based, not a menu).
- `features/dashboard/components/analytics/analytics-slicers.tsx` — filter chips row (segmented toggles, not pop-ups).
- `features/dashboard/components/analytics/reference-population-selector.tsx` — selection controls for analytics population.
- `features/financials/payment-slider.tsx`, `cross-service-matrix.tsx` — in-card interactive widgets, not pop-ups.
- `shared/layout/tenant-switcher.tsx` — tenant switcher in topbar (layering offender ARCH-003, but UI-wise part of the topbar chrome).

None of these are pop-up menus; they are listed to prove the census is exhaustive.

## 3. Tooltip implementations (the real redundancy in this category)

| System | Files | Usage | Styling | Behavior |
|---|---|---|---|---|
| **Native `title=` attribute** | **90 occurrences across 40+ files** (settings/backup-tab 7, general-tab 7, dag-canvas 10, financials 20+, academics, personnel…) | the DE-FACTO tooltip system | browser-default (unstyled, not theme-aware) | ~1s hover delay, no keyboard focus trigger, not dismissible, clipped by viewport/scroll containers |
| **Shared Radix Tooltip** `shared/ui/tooltip.tsx` | 4 direct importers (`app.tsx` provider, `sidebar.tsx`, `infrastructure/sync/sync-indicator.tsx`, + InfoTip) | infrastructure + nav | `z-[70] rounded-md border border-border bg-popover px-3 py-1.5 text-xs shadow-md` + fade/zoom, `collisionPadding=8`, side flip | keyboard-focusable trigger, instant, dismissible (T-546/UI-353 contract) |
| **`InfoTip`** `features/dashboard/components/analytics/info-tip.tsx` (127 lines) | dashboard Statistics surfaces | rich explainability tooltip | wraps shared TooltipContent with `max-w-[380px]` structured body (measures/calc/status + KaTeX formula block) | self-contained TooltipProvider (nested-safe), delayDuration 200, aria-labelled ⓘ trigger |

### Verdict

The tooltip layer has the **inverted adoption curve**: the best system (Radix, theme-aware, accessible) has 4 consumers; the worst (native `title=`, unstyled, inaccessible) has 90. This is the single largest visual-identity gap in the app's micro-surfaces — native browser tooltips appearing over a polished dark-glass design system.

### Recommendation

1. **Canonical: shared Radix Tooltip** (`shared/ui/tooltip.tsx`) for ALL simple hover hints. `InfoTip` remains the rich-content variant (dashboard-scoped today; promote to `shared/ui/` if other areas grow glossary tips — its i18n namespace `statsTips` is dashboard-specific).
2. **`title=` eradication pass**: mechanical replacement `<X title="…">` → `<Tooltip><TooltipTrigger asChild><X/></TooltipTrigger><TooltipContent>…</TooltipContent></Tooltip>` in the 40+ files. Two cautions: (a) `title` on non-interactive `<div>`s requires making the host focusable or wrapping — apply the InfoTip trigger-button pattern; (b) table cells with `title` used for overflow-truncation hints (EntityDrawer metadata ribbon, table columns) should switch to the Tooltip with `max-w` rather than native title. Effort: M (mechanical, per-file T-tasks).
3. **Do NOT introduce** Popover/ContextMenu primitives unless a real need appears — the current DropdownMenu coverage is complete and consistent. This is a "keep" category, documented as such.

## 4. Migration impact

| Change | Files touched | Risk |
|---|---|---|
| title= → Tooltip pass | 40+ files (90 sites) | Low per site; batch by feature area; guard: some `title` on icons duplicated with aria-label — dedupe then |
| InfoTip promotion (optional) | 1 file move + imports | Low |
| whatsapp.ts consolidation (DUP-022) | parent-actions-menu.tsx | already roadmap 1.8 |

No consumer of dropdown-menu.tsx changes. No new primitives added. Zero functionality dropped.
