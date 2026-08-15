# REFACTOR_STATE — `elimtiyaz-desktop`

> Single source of truth for the multi-session architectural refactor.

---

## 0. Baseline Metrics

- **Repository:** https://github.com/Vtheonly/AgentGithubUplaod (`main` branch)
- **Stack:** Vite 6 + React 18 + TypeScript 5.7 + Electron 33 + Supabase + Tailwind 3 + Vitest 2
- **Original baseline:** 398 files / 82,143 lines / 21 test files / 370 tests

---

## 1. Session 1 — Phase 0 + Phase 1 (factories) + Phase 2

- Built 5 parametric fixture factories in `src/infrastructure/mock/fixtures/`.
- Built DZD money adapter wrapping Dinero.js v2 in `src/domain/calc/shared/money-dzd.ts`.
- Refactored `discounts.ts` (359→50 lines) → `discount-rules.ts` + `discount-engine.ts`.
- Split `installments.ts` (460→75 lines) → `waterfall-allocator.ts` + `lifo-reversal.ts`.
- Built `reconcile/reconciliation.ts` (unified cross-checks).
- Built `ledger/ledger-balance.ts` (replay helpers).
- Final: `tsc --noEmit` exit 0, 24 test files / 402 tests passing.

---

## 2. Session 2 — Phase 3 UI Primitives

Built all 5 UI primitives per directive §3, with 12 smoke tests:

1. **`<DataTable<T>>`** (`src/shared/ui/data-table/`, ~165 lines) — generic table with global search (debounced 200ms), column sorting, pagination, empty state, row actions. Built on `@tanstack/react-table` v8.
2. **`<AutoFormModal<T>>`** (`src/shared/ui/auto-form/`, ~135 lines) — schema-driven modal using `react-hook-form` + `zod` (via `@hookform/resolvers/zod`). Renders 9 field types.
3. **`<EntityDetailDrawer<T>>`** (`src/shared/ui/entity-drawer/`, ~140 lines) — slide-over drawer with avatar header, metadata grid, tabbed body, sticky action bar.
4. **`<Wizard>`** (`src/shared/ui/wizard/`, ~130 lines) — multi-step wizard with progress bar, clickable step pills, per-step async validation.
5. **`<RoleDashboardLayout>`** (`src/features/personnel/dashboards/role-dashboard-layout.tsx`, ~165 lines) — unified dashboard shell with KPI row, tasks grid, activity feed.

**Phase 1 seed swap (ADR-010):** Cancelled. The 5 remaining seed files contain canonical reference data (`pricing-seed.ts` = official fee schedule per `Prices.md`; `teacher-seed.ts` and `workflow-seed.ts` = demo scenarios the UI tests depend on). Swapping them with parametric fixtures would lose domain accuracy.

**Final state:** `tsc --noEmit` exit 0, 25 test files / 414 tests passing.

---

## 3. Session 3 — Phase 4 Feature Views Refactoring (Academics)

### Refactored 4 Academic Feature Files

Applied the Phase 3 UI primitives to existing feature views, achieving ~52% line reduction across the 4 refactored files:

| File | Before | After | Savings | Primitive Used |
|---|---|---|---|---|
| `subjects-directory-tab.tsx` | 473 | 209 | -264 (-56%) | `<DataTable>` + `<AutoFormModal>` |
| `clubs-tab.tsx` | 702 | 331 | -371 (-53%) | `<AutoFormModal>` + `<ConfirmModal>` (card grid preserved) |
| `homework-history-tab.tsx` | 178 | 103 | -75 (-42%) | `<DataTable>` |
| `school-years-tab.tsx` | 645 | 315 | -330 (-51%) | `<AutoFormModal>` + `<ConfirmModal>` (card grid preserved) |
| **Total** | **1,998** | **958** | **-1,040 (-52%)** | |

### Architectural Decisions

- **ADR-011 (Subjects):** Replaced bespoke `<ul>` list + manual search/cycle filter + `UnifiedModal` form with `<DataTable>` (built-in search/sort/pagination) + `<AutoFormModal>` (Zod-driven form). Reduced 473→209 lines.
- **ADR-012 (Clubs):** Card grid preserved (rich visual info per club). Only modals refactored to `<AutoFormModal>`. Two modals (create + edit) consolidated into one driven by `editTarget` state.
- **ADR-013 (Homework):** Replaced bespoke `<ul>` + manual sort with `<DataTable>`. The "Renvoyer" action is now a row action button.
- **ADR-014 (School Years):** 3 separate modal components (Create/Edit/Delete) consolidated into 1 `<AutoFormModal>` (driven by `editTarget`) + 1 `<ConfirmModal>`. Card grid preserved.
- **ADR-015 (Psychology/Orthophonie — SKIPPED):** These tabs have a domain-specific "Ouvrir & Encaisser" dual-action flow (create follow-up + immediately open UnifiedPaymentModal to collect the semester forfait). Forcing them into `<AutoFormModal>` (which has a single submit button) would lose this feature. The directive's "preserve 100% domain accuracy" invariant takes precedence over UI compression here.

### Verification

- ✅ `npx tsc --noEmit` → exit 0
- ✅ `npm test` → **25 test files / 414 tests passing** (zero regressions)

---

## 4. Hand-off Checklist for Session 4

### 4.1 — Phase 4 Continued (CRM, Financials, Personnel, Settings)

The Academics slice is done. Next highest-leverage targets:

1. **Personnel Dashboards** (`src/features/personnel/dashboards/`):
   - Replace the 7 role dashboards (`administrator-dashboard.tsx`, `manager-dashboard.tsx`, `teacher-dashboard.tsx`, `buyer-dashboard.tsx`, `driver-dashboard.tsx`, `warehouse-worker-dashboard.tsx`, `worker-dashboard.tsx`) with thin configs passed to `<RoleDashboardLayout>`.
   - Estimated savings: ~2,000 lines.

2. **CRM** (`src/features/crm/`):
   - `parent-detail-drawer.tsx` + `student-detail-drawer.tsx` → swap to `<EntityDetailDrawer<T>>`
   - `batch-registration-modal.tsx` (5 step files) → swap to `<Wizard>` with 4 steps
   - `crm-page.tsx` → swap parent/student lists to `<DataTable<T>>`
   - Estimated savings: ~1,500 lines.

3. **Financials** (`src/features/financials/`):
   - `expense-detail-drawer.tsx` → swap to `<EntityDetailDrawer<Expense>>`
   - `installment-schedule-tab.tsx` → swap table to `<DataTable<Installment>>`
   - `expense-submit-modal.tsx` → swap to `<AutoFormModal>` with Zod schema
   - Estimated savings: ~600 lines.

4. **Settings** (`src/features/settings/`):
   - All hand-written modals (`secret-edit-modal.tsx`, `task-form-modal.tsx`, `employee-form-modal.tsx`) → `<AutoFormModal>`
   - Estimated savings: ~1,500 lines.

### 4.2 — Phase 5 (Excel Engine + PDF + DAG Skeleton)

- Refactor `infrastructure/excel/import-engine/` preserving the 4 schemas (`etat`, `bon`, `devis`, `ref`).
- Replace manual `pdf-lib` coordinate math in `infrastructure/receipt-pdf/` with `@react-pdf/renderer` declarative templates. Needs `npm i @react-pdf/renderer`.
- Keep `features/workflow/` DAG editor visual UI pristine, execution runtime stubbed.

### 4.3 — ADR Cleanup

Once all consumers of the old `discounts.ts` migrate to direct imports from `discount-rules` / `discount-engine`, delete the re-export shim. Same for `installments.ts` → `waterfall-allocator` + `lifo-reversal` direct imports.

---

## 5. Architectural Decisions Record (ADR)

### ADR-001 — Deferred Phase 1 Seed Swap (CANCELLED per ADR-010)
### ADR-002 — Money Adapter Approach (Not Full Replacement)
### ADR-003 — Split discounts.ts into rules + engine
### ADR-004 — installments.ts Split
### ADR-005 — reconciliation.ts as Higher-Level Orchestrator
### ADR-006 — ledger-balance.ts as Convenience Layer
### ADR-007 — DataTable Column Adapter Pattern
### ADR-008 — AutoFormModal Renders Fields from Field Definitions (Not from Zod Schema)
### ADR-009 — EntityDetailDrawer Uses Callback Props
### ADR-010 — Phase 1 Seed Swap Cancelled (Canonical Demo Data)
### ADR-011 — Subjects Tab Refactored to DataTable + AutoFormModal
### ADR-012 — Clubs Tab: Card Grid Preserved, Modals Refactored
### ADR-013 — Homework Tab Refactored to DataTable
### ADR-014 — School Years Tab: 3 Modals Consolidated to 1 AutoFormModal + ConfirmModal
### ADR-015 — Psychology/Orthophonie Tabs Skipped (Domain-Specific Dual-Action Flow)

---

## 6. Files Created / Refactored Across All Sessions

### Sessions 1+2 — Domain Layer + UI Primitives (26 new files)

| File | Lines | Purpose |
|---|---|---|
| `src/infrastructure/mock/fixtures/{rng,parent,student,payment,academic}-fixtures.ts` + `index.ts` | ~515 | Parametric fixture factories |
| `src/domain/calc/shared/money-dzd.ts` | 100 | Dinero.js DZD money adapter |
| `src/domain/calc/pricing/{discount-rules,discount-engine}.ts` | 195 | 5 canonical discount rules + orchestrator |
| `src/domain/calc/payment/{waterfall-allocator,lifo-reversal}.ts` | 205 | Allocation + reversal engines |
| `src/domain/calc/reconcile/reconciliation.ts` | 95 | Unified cross-checks orchestrator |
| `src/domain/calc/ledger/ledger-balance.ts` | 70 | Replay helpers |
| `src/shared/ui/data-table/{types,data-table,index}.tsx` | 230 | Generic DataTable<T> |
| `src/shared/ui/auto-form/{types,auto-form-modal,index}.tsx` | 210 | Schema-driven AutoFormModal<T> |
| `src/shared/ui/entity-drawer/{types,entity-detail-drawer,index}.tsx` | 200 | EntityDetailDrawer<T> |
| `src/shared/ui/wizard/{wizard,index}.tsx` | 135 | Multi-step Wizard |
| `src/features/personnel/dashboards/role-dashboard-layout.tsx` | 165 | Unified dashboard shell |
| `src/tests/{infrastructure/fixtures, domain/shared/money-dzd, domain/calc/phase2-modules, ui/primitives}.test.{ts,tsx}` | 700 | 44 tests total |

### Session 3 — Phase 4 Academics (4 refactored files)

| File | Before | After | Savings |
|---|---|---|---|
| `src/features/academics/subjects-directory-tab.tsx` | 473 | 209 | -264 (-56%) |
| `src/features/academics/clubs/clubs-tab.tsx` | 702 | 331 | -371 (-53%) |
| `src/features/academics/homework-history-tab.tsx` | 178 | 103 | -75 (-42%) |
| `src/features/academics/school-years-tab.tsx` | 645 | 315 | -330 (-51%) |
| **Total** | **1,998** | **958** | **-1,040 (-52%)** |

### Refactored Shims (Sessions 1+2)

| File | Before | After |
|---|---|---|
| `src/domain/calc/pricing/discounts.ts` | 359 | 50 (re-export shim) |
| `src/domain/calc/payment/installments.ts` | 460 | 75 (re-export shim) |
| `src/domain/calc/ledger/index.ts` | 21 | 22 (+ ledger-balance) |

---

## 7. Verification Status (End of Session 3)

- ✅ `npx tsc --noEmit` → exit 0 (zero type errors)
- ✅ `npm test` → **25 test files / 414 tests passing** (was 21 / 370 at project start)
  - 370 baseline tests (zero regressions)
  - +6 fixture tests
  - +8 money adapter tests
  - +18 Phase 2 calc integration tests
  - +12 UI primitive tests

---

## 8. Reproduction Commands

```bash
cd /home/z/my-project/elimtiyaz-desktop/elimtiyaz-desktop
npx tsc --noEmit     # Type-check (should be exit 0)
npm test             # Run all 414 tests (should be 25 files, 414 passing)
```
