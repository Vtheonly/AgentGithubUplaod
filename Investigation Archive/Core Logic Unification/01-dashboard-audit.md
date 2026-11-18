# Dashboard Unification Audit — Session 2 (2026-11-19)

Scope: "the entire dashboard and all dashboard features" — `features/dashboard/` (40 files) **plus** the second dashboard estate the first sweep must not miss: `features/personnel/dashboards/` (9 files, role-based workspaces). Read-only sweep; all findings below are file:line-verified.

## 1. The dashboard estate (three distinct systems)

| System | Files | Entry | Navigation | Data pattern |
|---|---|---|---|---|
| **Main dashboard** | `features/dashboard/**` (40) | route `/` (`dashboard-page.tsx`) | 4 PageTabs: overview / analytics / alerts / reports | page-level subscriptions + imperative fetches, props drilled down |
| **Role dashboards** | `features/personnel/dashboards/**` (9) | `personnel-page.tsx` → `role-dashboard-router.tsx` | role switch (7 dashboards + ComingSoonCard fallback) | per-dashboard `useObservable` + AutoFormModal quick actions |
| **Class detail view** | `features/academics/class-detail-page.tsx` (+ tabs) | route `/academics/class/:id` | PageTabs attendance/grades/subjects/… | same observable idiom |

The two big estates do **not** share a dashboard framework: no shared dashboard-layout component, no shared KPI grid, no shared empty/loading state contract between them (`role-dashboard-layout.tsx` exists but is personnel-local; the main dashboard has its own `dashboard-layout-editor` + `dashboard-layout-storage` + `dashboardLayouts` repository).

## 2. Main dashboard — verified architecture (dashboard-page.tsx, 466 lines)

**Data layer (lines 106-299):** 6 reactive subscriptions (`academicYears.observeAll`, `debt.observeSummary`, `debt.observeThresholds`, `payments.observe`, `installments.observe`, `notifications.observeForSession`) + 2 imperative `Promise.all` fetch blocks (`repos.dashboard.kpisForRange/revenueForRange/debtByAgingForRange/demographics`, lines 181-201; previous-year revenue, lines 251-268). Result: `DashboardData` state assembled in the page.

**Delivery to tabs:** `OverviewTab` receives 8 props; `AnalyticsTab` receives **12 props** (revenue, prevRevenue, onOpenParent, academicYear, prevAcademicYear, debtAging, topDebtors, debtSummaries, payments, installments, range, editing + thresholds pair) — pure props-drilling; no per-tab view-model hooks. `dataProp` is a `useMemo(() => data, [data])` no-op memo (line 322) — a code smell marking where a real selector layer is missing.

**Business logic in the feature layer (S1 ARCH-009, re-verified):** `analytics-derivations.ts` (filtering, year scoping, `previousAcademicYear`, `shiftIsoYearBack`), `executive-statistics.ts` (`deriveDebtTriage` — DUP-016 parallel aging vocabulary vs domain `computeDebtAgingStatus`), `operational-query-engine.ts` (hardcoded thresholds 25k/30k/30 days), `analytics-slicers.tsx` (filter state).

**Good patterns found (keep):** single `useThresholdsConfigHost` feeding both tabs with live preview (T-507); `?tab=` deep-link consumption (mount-time); reuse of global `openParent` for Pareto drill-down (T-514) instead of a local drawer.

## 3. Fetch-pattern census (the cross-cutting measurement)

`useObservable(...)` = **165 occurrences across 45+ files** (paginated count; every feature area). Heaviest: `financials-page.tsx` **18**, `academic-year-detail-drawer.tsx` **18**, `timetable-tab.tsx` 9, `academics-page.tsx` 8, `class-detail-page.tsx` 7. No `@tanstack/react-query` usage anywhere in features (only `data-table.tsx` imports `@tanstack/react-table`; `main.tsx` the only other @tanstack import) — **the observable+repository pattern IS the data layer**, undocumented as such (fold into ARCH-005's service-locator ADR).

**Duplication consequence (DUP-029):** every page re-implements the same ceremony: subscribe-in-effect + `?? []` default + local state + manual refetch keys. 18-subscription pages are the ceiling of what is maintainable without a shared view-model layer.

## 4. KPI/metric widget proliferation (5 implementations)

| Widget | File | Lines | Used by |
|---|---|---|---|
| `KpiCard` | `shared/ui/kpi-card.tsx` | 50 | financials-page, debt-aging-tab, overview-tab, role-dashboard-layout, academic-year-detail-drawer |
| `SparklineKpiCard` | `features/dashboard/components/sparkline-kpi-card.tsx` | 225 | overview-tab |
| `StatStrip` | `…/analytics/stat-strip.tsx` | 137 | analytics tab |
| `ExecutiveCards` | `…/analytics/executive-cards.tsx` | **1,096** | analytics tab |
| `MixCards` | `…/analytics/mix-cards.tsx` | 288 | analytics tab |

Tone vocabulary is already shared (`KpiTone` ≡ `ICON_TONE_CLASS`), but the widget layering is 5 parallel trees. **Recommendation:** KpiCard as composition root with slot props (chart/sparkline/mix); ExecutiveCards' 1,096 lines decomposed into compositions on it (biggest single UI-consolidation win in the dashboard area; pairs with ARCH-009 domain relocation of its derivation logic).

## 5. Role dashboards (personnel) — verified structure

`role-dashboard-router.tsx` maps role → 7 dashboards (super_admin/financial_officer/support_staff → Administrator; manager/buyer/driver/warehouse_worker/teacher/worker → own). Each dashboard hand-builds its own grid of KpiCard/AutoFormModal quick actions. **Divergences found:** `teacher-dashboard.tsx:335` hand-rolls a fullscreen `role="dialog"` overlay (design-system break — see UI audit `01`/`04`); the other six use shared primitives. **Recommendation:** extract `RoleDashboardTemplate` (header + KPI grid + quick-action registry) from the 7 near-parallel layouts; wire teacher overlay into the shared system or a route.

## 6. Dashboard storage/layout subsystem

`dashboard-layout-editor.tsx` + `dashboard-layout-storage.ts` + `dashboardLayouts` repo (migration 0134 Supabase / localStorage mock) serve the overview+analytics "Personnaliser" mode. `dashboard-tab-layout-editor.tsx` (267 lines) is DEAD (S1 DEAD-003). One caveat: `mock/dashboard-layout-repository` imports a features constant (ARCH-004 layering) — relocate the constant to shared/domain during any dashboard work.

## 7. Unification plan (dashboard-specific, feeds ROADMAP)

1. **D-U1:** per-tab view-model hooks (`use-overview-data`, `use-analytics-data`) extracting the 6 subscriptions + 2 fetch blocks out of `dashboard-page.tsx`; tabs stop receiving 8-12 props (they read their hook). Page keeps only tab + year-range + layout-editing state. (M effort; no behavior change; per-tab tests unchanged.)
2. **D-U2:** KPI composition refactor (§4) — after/with ARCH-009 threshold parameterization.
3. **D-U3:** `RoleDashboardTemplate` extraction (7 personnel dashboards).
4. **D-U4:** teacher-dashboard overlay compliance (UI audit `01` §4).
5. **D-U5:** delete `dashboard-tab-layout-editor.tsx` (DEAD-003, Phase 0.2 already).
6. **Keep:** PageTabs hub navigation (already unified across all 6 hubs — verified `PageTab` usage: crm 12, financials 16, academics 16, personnel 20, workflow 6), thresholds host, person-navigation drill-downs, deep-link idiom (but fix the mount-time-only read — BUG-026 class, also present in settings-page, registered BUG-031).

## 8. Migration impact

- D-U1 touches `dashboard-page.tsx` + 4 tab files + `tabs/types.ts`; zero API changes; risk = prop-vs-hook parity (typecheck + existing tab tests cover).
- D-U2 touches the 5 widget files + their consumers in 2 tabs + financials; visual snapshot per card.
- D-U3 touches 8 personnel files; role-routing tests exist (t-4xx suites).
- Cross-check Android parity: dashboard KPIs are desktop-only surfaces (no Android mirror found in repo evidence; standing §10 rule applies if the Android repo consumes the same RPCs).
