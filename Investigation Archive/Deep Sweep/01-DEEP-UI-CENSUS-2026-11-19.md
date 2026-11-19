# Deep UI Census — Session 7 (2026-11-19)

The complete, line-numbered inventory behind the owner's UI mandate (all 12 categories). Raw evidence: `censuses/ui-*.txt`, `censuses/agg-*.txt` at HEAD `37e9b1f7`. This document verifies, corrects, and extends `UI Component Audit/00-05` (Session 2).

## 0. The radix primitive layer — exactly what exists (verified)

`censuses/ui-radix-overlay-imports.txt` — **8 import sites, 3 primitives in use:**

| Primitive | Importers (exact) |
|---|---|
| `@radix-ui/react-dialog` (6) | `shared/ui/unified-modal.tsx:16` · `shared/ui/unified-modal/modal-shell.tsx:10` · `shared/ui/unified-modal/parts.tsx:8` · `shared/ui/auto-form/auto-form-modal.tsx:17` · `shared/ui/wizard/wizard.tsx:6` · `shared/ui/entity-drawer/entity-detail-drawer.tsx:16` |
| `@radix-ui/react-dropdown-menu` (1) | `shared/ui/dropdown-menu.tsx:2` |
| `@radix-ui/react-tooltip` (1) | `shared/ui/tooltip.tsx:2` |

**ZERO imports of:** Popover, HoverCard, ContextMenu, Accordion, Collapsible, AlertDialog, Toast (primitive), NavigationMenu, Menubar — the S2 verdict re-proved at HEAD. App-level `createPortal` appears in exactly ONE file: `shared/layout/modal-host.tsx:11,17` (the dead ARCH-018 modal stack; `censuses/ui-portals.txt` has 3 lines total — the third is `main.tsx`'s `createRoot`). **The portal/overlay estate is 100% Radix except the dead host and the two hand-rolled surfaces below.**

## 1. Modals & dialogs — the complete consumer map (corrected)

- **UnifiedModal importers: 68 files** (complete list in `censuses/ui-unified-modal-import.txt`; `rg -l 'from "[^"]*unified-modal"'`): 66 feature files + `shared/layout/topbar.tsx` + the family's own `confirm-modal.tsx`. Distribution: academics 22, settings 12, financials 6, workflow 5, crm 6, dashboard 7, personnel 7, topbar 1, family 1. The S2 audit's "by usage (70 files)" is hereby pinned at **68 exact** (C-17 scope note).
- **AutoFormModal importers: 68 raw matches** (`censuses/ui-autoform-modal-import.txt`) — matches the "21 consumers" claim only because the raw pattern also hits type/aux references; the consumer-grade count remains 21 per S2 (import-shape `rg -l` on `auto-form-modal` module path — see census file for the full match set).
- **Wizard importers: 4 raw matches** (wizard.tsx itself + 3 consumers — onboarding-wizard, re-enrollment, batch-registration: S2's 3-consumer claim EXACT).
- **EntityDetailDrawer consumers: 22 raw matches** (`censuses/ui-entity-drawer-import.txt`) = the 7 documented call sites + the drawer module's own files + `person-navigation-context` mounts; S2's 7-site claim holds.
- **variant="drawer" call sites: 10** (S6-verified, unchanged at this HEAD).
- **Native browser dialogs: exactly ONE real site** (`censuses/ui-native-dialogs.txt` + `ui-native-prompt.txt`): `features/settings/configuration-tab.tsx:149` — bare `confirm("Réinitialiser la configuration?...")` — a native window-level confirm bypassing the app's ConfirmModal system. The other raw matches are false positives (a local `async function confirm(...)` in promotion-class-review-modal.tsx:135,197,251; `console.info` in supabase-overdue-alert-generator.ts:500). Zero `alert(`, zero `window.prompt(`. **New finding DUP-034.**
- **The dead imperative stack re-proved:** `useModal(` appears in 4 raw matches = provider + host + types only (`censuses/ui-usemodal-consumers.txt`) — zero feature consumers (ARCH-018 stands).

## 2. Drawers / side panels / mini-windows — the fixed-anchored estate at file granularity

`censuses/agg-fixed-surfaces.txt` — **20 files carry `fixed`-anchored surfaces** (complete list; the S2 audit documented 8 of them):

| Layer | Files (exact, with count) |
|---|---|
| Shared shells (6) | `unified-modal/modal-shell.tsx` (4) · `wizard/wizard.tsx` (2) · `entity-drawer/entity-detail-drawer.tsx` (2) · `auto-form/auto-form-modal.tsx` (2) · `layout/toast-viewport.tsx` (1) · `layout/modal-host.tsx` (dead, 1 — in agg-zindex not fixed) |
| Hand-rolled overlays (2) | `features/ai/copilot-drawer.tsx` (1 — right-0, no portal) · `features/personnel/dashboards/teacher-dashboard.tsx` (1 — inset-0, role="dialog" at :336) |
| Feature-level fixed chrome (12 — **not previously inventoried**) | `features/ai/chart-svg.tsx` (2) · `academics/timetable/timetable-tab.tsx` (2) · `personnel/management/upcoming-payroll-payments.tsx` (1) · `personnel/management/task-detail-drawer.tsx` (1) · `personnel/management/payroll-management.tsx` (1) · `financials/receipts-tab.tsx` (1) · `financials/manual-debt-modal.tsx` (1) · `financials/installment-schedule-tab.tsx` (1) · `dashboard/components/analytics/data-inspector-core.tsx` (1) · `crm/parent-year-history-section.tsx` (1) · `crm/crm-page.tsx` (1) · `auth/splash-screen.tsx` (1) · `academics/timetable/timetable-entry-dialog.tsx` (1) |

The 12 feature-level fixed surfaces are the depth the S2 audit lacked: receipts-tab's floating action, chart-svg's positioned annotations, installment-schedule-tab's sticky headers, payroll/task-detail's floating rows, crm-page/parent-year-history's positioned panels. Each now has file:line evidence in `censuses/ui-fixed-better.txt`. Classification for the unification plan: 9 are sticky/anchored chrome (legitimately `fixed`), 3 are floating panels that should express through the shared overlay contracts (receipts-tab floating action, data-inspector inline float, chart-svg annotations).

## 3. Pop-up menus, popovers, flyouts, tooltips — corrected consumer counts

- **DropdownMenu usage: 10 files** (`censuses/agg-dropdown-usage.txt`, complete): `shared/layout/topbar.tsx` **23** (the biggest consumer — alerts bell dropdown at :290-317 + user menu + more; **undocumented in S2's "5 direct importers"** — correction C-19), `academics/placement/student-placement-card.tsx` 18, `shared/ui/parent-actions-menu.tsx` 17, `shared/ui/student-actions-menu.tsx` 16, `dashboard/academic-year-selector.tsx` 14, `i18n/language-switcher.tsx` 10, `shared/layout/tenant-switcher.tsx` 9, `workflow/dag-canvas.tsx` 9, `shared/ui/dropdown-menu.tsx` 8 (the primitive itself), `settings/audit-log-tab.tsx` 8.
- **Tooltip usage: 10 files** (`censuses/agg-tooltip-usage.txt`, complete): `dashboard/components/analytics/info-tip.tsx` 13 (InfoTip — the rich variant), `shared/layout/sidebar.tsx` 7, `shared/ui/tooltip.tsx` 6 (primitive), `infrastructure/sync/sync-indicator.tsx` 6, `app/app.tsx` 4 (provider), **and 5 analytics-card consumers S2 never listed**: `mix-cards.tsx` 2, `weekly-operating-rhythm.tsx` 1, `yoy-comparison-card.tsx` 1, `payroll-cost-trend-card.tsx` 1, `debtors-pareto-card.tsx` 1. The S2 "4 direct importers" undercounted the Radix Tooltip's real surface (C-18 scope).
- **Popover / HoverCard / ContextMenu: 0** (re-verified). **`onContextMenu`: 0** (S6-verified, unchanged).
- **Native `title=`: 194 occurrences / 102 files — C-10 CONFIRMED EXACTLY, now with the complete per-file table** (`censuses/agg-title-attribute.txt`): top files dag-canvas 10, general-tab 7, backup-tab 7, financials 6+..., full distribution in the census file. The UI-U5 eradication backlog now has its worklist.

## 4. Expandable panels — the aria evidence

`censuses/ui-aria.txt` — **the whole app carries `aria-expanded` on exactly 2 hand-rolled collapsible sites** (`crm/parent-year-history-section.tsx:145`, `crm/student-detail/academic-tab.tsx:398`) and `role="dialog"`+`aria-modal` on exactly 1 (the non-compliant teacher overlay, `teacher-dashboard.tsx:336-337`). The other ~8 expandable-panel sites from S2's census (financials sections, webhook card, therapy card, subject-config, entity-drawer ribbon, settings rows, pricing cards) have NO aria-expanded — the a11y gap is now measured: 2 of ~10 sites.

## 5. The z-index scale — 7 layers, not 4+2 (correction C-15)

`censuses/vocab-zindex.txt` (distinct values with counts) + `censuses/agg-zindex.txt` (29 files):

| Layer | Count | Files (the sites) |
|---|---|---|
| `z-50` | 24 | every overlay shell + copilot + teacher overlay + timetable-tab + dashboard-layout-editor + financial consoles |
| `z-10` | **13** | `page-tabs.tsx` (sticky tab bars ×2) · `rbac-matrix-editor.tsx` (2) · `timetable-grid.tsx` (2) · +9 single sites — **the undocumented in-flow sticky layer** |
| `z-[70]` | 3 | `tooltip.tsx` (2 — the tooltip layer) + `data-inspector-core.tsx` |
| `z-40` | **3** | `dashboard-layout-editor.tsx` — **undocumented layer** |
| `z-[90]` | 1 | `modal-host.tsx` (the dead stack) |
| `z-[100]` | 1 | `toast-viewport.tsx` |
| `z-[200]` | 1 | `auth/splash-screen.tsx` (boot overlay) |

**The measured scale is 7 layers: 10 / 40 / 50 / 70 / 90 / 100 / 200 — 46 occurrences across 29 files.** C-12's "4-layer scale + 2 exceptions" undercounted: `z-10` (13 sites — sticky tab bars and grids) and `z-40` (3 — layout editor) are load-bearing layers the foundation spec must place on the official scale (proposed: 10=sticky-in-flow, 40=layout-editor chrome, keep 50/70/90/100/200 as C-12 recorded). The UI-U1 z-scale deliverable now has the complete per-site worklist.

## 6. The measured size vocabulary (new evidence for the foundation spec)

- **Width literals: 36 distinct values, 71 occurrences, 41 files** (`censuses/vocab-widths.txt`): the drawer trio `w-[400px]`/`w-[560px]`/`w-[820px]` (the DRAWER_SIZE_CLASS values) + `w-[720px]`, `w-[760px]`, `w-[340px]`, `w-[240px]`… and a long tail of small controls (`w-[16px]`, `w-[92px]`, `w-[1px]`…). Panel-scale widths: ~15 distinct values — the foundation spec's size-scale worklist.
- **Height caps: 13 distinct values, 23 occurrences, 18 files** (`censuses/vocab-height-caps.txt`): `max-h-[88vh]`×3 (the ModalShell policy) · `max-h-[60vh]`×2 (Wizard) · **+ 10 more values S2 never counted**: 85vh×2, 40vh×3, 45vh×2, 50vh, 400px×3, 380px×2, 540px, 500px, 460px, 420px, 260px. The height-policy fragmentation is 13 dialects, not 3 (C-16) — the unified one-rule policy (88vh shell + internal scroll) now has its complete migration worklist.
- **Physical vs logical positioning: 55 occurrences / 37 files physical** (`censuses/agg-physical-positioning.txt`) **vs 8 occurrences / 5 files logical** (`censuses/ui-logical-positioning.txt` — modal-shell, entity-drawer, topbar, sync-indicator, ai-config-tab). The RTL-readiness surface: the two shared drawer shells are logical; the rest of the app is 7:1 physical. Side-border vocabulary (`censuses/vocab-border-sides.txt`): `border-b` 160, `border-t` 90 (vertical — RTL-safe), `border-l` 15 + `border-r` 7 physical sides vs `border-s` 3 + `border-e` 1 logical — **22:4 physical:logical on side borders**. The app is structurally LTR; the RTL story (fonts swap at `index.css:219-223`, nothing else) is i18n-only.

## 7. Hand-rolled tables & native selects — exact lists

- **`<table` markup: 46 occurrences / 40 files** (`censuses/agg-handrolled-tables.txt` — the COMPLETE list, correcting DUP-015's "39 feature files"): 38 feature files + `shared/ui/markdown-view.tsx` (markdown table rendering — legitimate) + `shared/ui/data-table/data-table.tsx` (the shared primitive itself — its internal `<table`). Top hand-rollers: see-details-modal 3, upcoming-payroll-payments 2, expense-review-section 2, operational-query-console 2, student-detail/academic-tab 2, + 35 singles across academics (11), settings (7), personnel (6), dashboard (5), financials (3), crm (1), workflow (1).
- **Native `<select`: 19 occurrences / 9 files** (`censuses/agg-native-selects.txt`) — the "9 files" claim EXACT: timetable-tab 7, timetable-entry-dialog 4, unified-payment-modal 2, + 6 singles (managers-step, departments-step, staff-attendance-center, documents-tab, parent-detail-drawer, therapy-attachments-card). The Radix `select.tsx` primitive exists (90 lines) and is bypassed at exactly these 9 sites.
- **Shared `DataTable` consumers: 12** (S2's count; the `<table` census above is the complement).

## 8. Toasts, loading, focus — the interaction census

- **Toast call sites: 132 occurrences / 107 files** (`censuses/agg-toast-usage.txt`) — one toast system (toast-provider + toast-viewport), consumed everywhere; the S2 "single toast system" verdict stands, now with the complete consumer table.
- **`transition-all`: 63 occurrences** vs transition-colors 109, transform 15, opacity 8 (`censuses/vocab-transitions.txt`) — a perf/consistency smell for the foundation spec (recommend constraining to specific properties).
- **Focus handling:** Radix owns focus traps in the 6 Dialog shells; hand-rolled surfaces (copilot, teacher overlay) have none (`censuses/ui-focus.txt` shows app-level `onKeyDown`/Escape handling absent from both — the a11y gap S2 flagged, now measured).

## 9. Corrections to the Session 2 UI audit (register: C-15, C-16, C-17, C-18)

| Prior claim | Verdict | Corrected value |
|---|---|---|
| Z-scale "4 layers + 2 exceptions (34 sites)" (C-12) | CORRECTED (C-15) | 7 layers / 46 occurrences / 29 files — z-10 (13) and z-40 (3) are real layers |
| Height policies "3 (88vh/60vh/none)" | CORRECTED (C-16) | 13 distinct height-cap values across 18 files |
| UnifiedModal "70 files" | PINNED (C-17) | 68 importers exactly (complete list in census) |
| DropdownMenu "5 direct importers" | CORRECTED (C-18) | 10 usage files; topbar.tsx is the biggest consumer (23 matches) — undocumented in S2 |
| Tooltip "4 direct importers" | CORRECTED (C-18) | 10 usage files incl. 5 analytics-card consumers |
| DUP-015 "39 feature files hand-roll tables" | PINNED EXACT (scope note) | 40 files = 38 feature + markdown-view + data-table itself |
| Native selects "9 files" | VERIFIED EXACT | 9 files / 19 occurrences (complete list banked) |
| title= "194/102" (C-10) | VERIFIED EXACT | complete per-file table now exists (agg-title-attribute.txt) |

**New findings registered:** DUP-034 (native `confirm()` at configuration-tab.tsx:149), plus the token-layer defects in `02-DEEP-TOKEN-CENSUS` (BUG-039, ARCH-036, DEAD-017).

## 10. What this changes in the unification plan (execution deltas)

1. **UI-U1 (z-scale):** the spec must define the FULL 7-layer scale with roles (10 sticky / 40 layout chrome / 50 overlay / 70 tooltip / 90 dead-host / 100 toast / 200 boot) and audit the 29 files against it. Effort: unchanged (documentation + spot migrations); the dead `z-[90]` layer retires with ARCH-018's host deletion.
2. **UI-U5 (title= eradication):** the worklist is now per-file exact (102 files, top-20 by count in the agg) — batch order by feature dir as C-10 proposed, now with real per-file counts for effort sizing.
3. **The 12 fixed-chrome surfaces (§2):** add to the E6 overlay-compliance pass — 3 need contract migration (receipts-tab float, data-inspector float, chart-svg annotations), 9 are legitimately-sticky chrome to document in the spec.
4. **Height-cap policy (E6.1):** the 13-value census is the migration worklist for the one-rule `max-h-[88vh]` policy; wizard's 60vh becomes a body constraint (S2's recommendation, now with the full site list).
5. **DUP-034:** fold into the E6 pass — replace the native confirm with ConfirmModal (1 file, XS effort; preserves the same user intent).
6. **Expandable-panel primitive (S2 recommendation):** the 2-of-10 aria-expanded measurement upgrades its priority evidence; the 10 sites are enumerated in S2 §1 + this census's fixed/aria files.
