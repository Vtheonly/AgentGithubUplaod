# Refactor State — `elimtiyaz-desktop`

> Single source of truth for the multi-session architectural refactor of the `elimtiyaz-desktop` codebase.

This document tracks the phased refactoring of the desktop application: domain layer modularization, UI primitive adoption, dead-code cleanup, and the ongoing migration of feature views to shared primitives.

---

## Baseline Metrics

- **Repository:** `https://github.com/Vtheonly/AgentGithubUplaod` (`main` branch)
- **Stack:** Vite 6 + React 18 + TypeScript 5.7 + Electron 33 + Supabase + Tailwind 3 + Vitest 2
- **Original baseline:** 398 files / 82,143 lines / 21 test files / 370 tests

---

## Session 1 — Phase 0 + Phase 1 (Factories) + Phase 2 (Domain Layer)

- Built 5 parametric fixture factories in `src/infrastructure/mock/fixtures/`.
- Built DZD money adapter wrapping Dinero.js v2 in `src/domain/calc/shared/money-dzd.ts`.
- Refactored `discounts.ts` (359 → 50 lines) → `discount-rules.ts` + `discount-engine.ts`.
- Split `installments.ts` (460 → 75 lines) → `waterfall-allocator.ts` + `lifo-reversal.ts`.
- Built `reconcile/reconciliation.ts` (unified cross-checks).
- Built `ledger/ledger-balance.ts` (replay helpers).
- **Final:** `tsc --noEmit` exit 0, 24 test files / 402 tests passing.

---

## Session 2 — Phase 3 (UI Primitives)

Built all 5 UI primitives, with 12 smoke tests:

1. **`<DataTable<T>>`** (`src/shared/ui/data-table/`, ~165 lines) — generic table with global search (debounced 200ms), column sorting, pagination, empty state, row actions. Built on `@tanstack/react-table` v8.
2. **`<AutoFormModal<T>>`** (`src/shared/ui/auto-form/`, ~135 lines) — schema-driven modal using `react-hook-form` + `zod`. Renders 9 field types.
3. **`<EntityDetailDrawer<T>>`** (`src/shared/ui/entity-drawer/`, ~140 lines) — slide-over drawer with avatar header, metadata grid, tabbed body, sticky action bar.
4. **`<Wizard>`** (`src/shared/ui/wizard/`, ~130 lines) — multi-step wizard with progress bar, clickable step pills, per-step async validation.
5. **`<RoleDashboardLayout>`** (`src/features/personnel/dashboards/role-dashboard-layout.tsx`, ~165 lines) — unified dashboard shell with KPI row, tasks grid, activity feed.

**Phase 1 seed swap (ADR-010):** Cancelled. The 5 remaining seed files contain canonical reference data (`pricing-seed.ts` = official fee schedule; `teacher-seed.ts` and `workflow-seed.ts` = demo scenarios the UI tests depend on).

**Final state:** `tsc --noEmit` exit 0, 25 test files / 414 tests passing.

---

## Session 3 — Phase 4 Academics (Feature Views Refactoring)

Refactored 4 academic feature files, achieving ~52% line reduction:

| File | Before | After | Savings | Primitive Used |
| :--- | :--- | :--- | :--- | :--- |
| `subjects-directory-tab.tsx` | 473 | 209 | −264 (−56%) | `<DataTable>` + `<AutoFormModal>` |
| `clubs-tab.tsx` | 702 | 331 | −371 (−53%) | `<AutoFormModal>` + `<ConfirmModal>` |
| `homework-history-tab.tsx` | 178 | 103 | −75 (−42%) | `<DataTable>` |
| `school-years-tab.tsx` | 645 | 315 | −330 (−51%) | `<AutoFormModal>` + `<ConfirmModal>` |
| **Total** | **1,998** | **958** | **−1,040 (−52%)** | |

### Architectural decisions

- **ADR-011 (Subjects):** Replaced bespoke `<ul>` list + manual search/cycle filter + `UnifiedModal` form with `<DataTable>` + `<AutoFormModal>`.
- **ADR-012 (Clubs):** Card grid preserved (rich visual info per club). Only modals refactored.
- **ADR-013 (Homework):** Replaced bespoke `<ul>` + manual sort with `<DataTable>`.
- **ADR-014 (School Years):** 3 separate modals consolidated into 1 `<AutoFormModal>` + 1 `<ConfirmModal>`.
- **ADR-015 (Psychology/Orthophonie — SKIPPED):** These tabs have a domain-specific "Ouvrir & Encaisser" dual-action flow. Forcing them into `<AutoFormModal>` (single submit button) would lose this feature.

**Verification:** `tsc --noEmit` exit 0, 25 test files / 414 tests passing.

---

## Session 4 — Phase 4A (Dead Code + Shim Cleanup) + Phase 4B (CRM Refactor)

### Phase 4A — Dead Code, Legacy Shims & Model Consolidation

**Deleted dead/duplicate files (2):**

- `src/features/academics/hooks/use-class-details.ts` — exact duplicate of `use-batch-promotion.ts`
- `src/infrastructure/pdf/bulletin-pdf-generator.ts` — redundant with `receipt-pdf/bulletin.ts` (+ empty `infrastructure/pdf/` directory)

**Deleted legacy re-export shims (6) — consumers migrated to direct submodule imports:**

- `src/domain/calc/pricing/discounts.ts` → 3 helpers (`applyDiscount`, `findDiscountByCode`, `computeSiblingDiscount`) moved into `discount-rules.ts`
- `src/domain/calc/payment/installments.ts` → 6 query helpers extracted into new `payment/queries.ts`
- `src/domain/calc/ledger/ledger-balance.ts` → 3 helpers moved into `balance.ts`
- `src/domain/reconcile.ts` → callers point to `calc/reconcile`; types properly re-exported from `calc/reconcile/index.ts` (fixed a hidden bug)
- `src/infrastructure/receipt-pdf.ts` → new `receipt-pdf/index.ts` barrel created
- `src/infrastructure/mock/workforce-mock-repositories.ts` + `operations-mock-repositories.ts` → direct imports from `./workforce` and `./operations`

**Domain model consolidation (single source of truth):**

- `AcademicCycle` now defined exclusively in `academic.ts`; `payment.ts` imports and re-exports.
- `AcademicHistoryEntry` and `PromotionDecision` now defined exclusively in `academic.ts`; `student.ts` imports and re-exports.
- `PROMOTION_DECISION_LABELS_FR` canonical definition lives in `academic.ts`; `student.ts` re-exports.

**Files created:** `payment/queries.ts` (75 lines), `receipt-pdf/index.ts` (20 lines).
**Files modified:** 14 consumer files updated to point at new module paths.

### Phase 4B — CRM Module Refactoring

| File | Before | After | Primitive Used |
| :--- | :--- | :--- | :--- |
| `crm-page.tsx` | ~569 | 595 | `<DataTable>` (Parents + Students) |
| `parent-detail-drawer.tsx` | ~499 | 558 | `<EntityDetailDrawer>` + sibling modals |
| `student-detail-drawer.tsx` | ~121 | 86 | `<EntityDetailDrawer>` |
| `batch-registration-modal.tsx` | ~306 | 243 | `<Wizard>` |

**Key changes:**

- `ParentsTab` and `StudentsTab` now use `<DataTable>` with declarative row actions.
- Both detail drawers migrated to `<EntityDetailDrawer<T>>` with tabs/metadata/actions callbacks.
- `BatchRegistrationModal` migrated to `<Wizard>` with 4 steps; validators return error strings.

**Verification:** `tsc --noEmit` exit 0, 25 test files / 414 tests passing, `npm run build` succeeds (16.48s).

---

## Hand-off Checklist for Session 5

### Phase 4C — Financials Module Refactoring

1. **`financials-page.tsx`:** Replace custom lists in `PaymentsTab`, `DebtTab`, `ExpensesTab` with `<DataTable<T>>`.
2. **`installment-schedule-tab.tsx` & `receipts-tab.tsx`:** Refactor to `<DataTable<Installment>>` and `<DataTable<Payment>>`.
3. **`expense-submit-modal.tsx`:** Refactor to `<AutoFormModal<T>>` with Zod schema.
4. **`expense-detail-drawer.tsx`:** Refactor to `<EntityDetailDrawer<Expense>>`. Replace nested raw Radix `<Dialog>` with `<ConfirmModal>` and `<UnifiedModal>`.

### Phase 4D — Personnel & Workforce Dashboards Unification

1. Unify the 7 role dashboards to use `<RoleDashboardLayout>` (currently 0% adopted).
2. Refactor `employee-directory.tsx` + `task-management.tsx` to `<DataTable<T>>`.
3. Refactor `employee-form-modal.tsx` + `task-form-modal.tsx` to `<AutoFormModal<T>>`.
4. Refactor `employee-profile-drawer.tsx` + `task-detail-drawer.tsx` to `<EntityDetailDrawer<T>>`.
5. Refactor `onboarding-wizard.tsx` (12 files) to use `<Wizard>`.

### Phase 4E — Dashboard, Profile & Settings Unification

1. Refactor `alert-creator-modal.tsx` and `calendar-event-creator-modal.tsx` using `<AutoFormModal<T>>`.
2. Clean up `alerts-tab.tsx` (remove duplicate modal instance).
3. Refactor `change-password-modal.tsx` using `<AutoFormModal<T>>` with Zod password entropy validation.
4. Refactor `audit-log-tab.tsx` using `<DataTable<AuditEntry>>`.
5. Refactor `secret-edit-modal.tsx` using `<AutoFormModal<T>>`.
6. Standardize typography: page headers `text-xl font-semibold`, card headers `text-sm font-semibold`, KPI numbers `text-xl font-semibold tnum`.

### Phase 5 — Declarative PDF Engine & Final Verification

1. Replace manual canvas coordinate math in `payment-receipt.ts`, `account-statement.ts`, `bulletin.ts`, `payslip.ts` with `@react-pdf/renderer` declarative templates.
2. Final test sweep + `npm run build`.

---

## Architectural Decisions Record (ADR)

| ADR | Decision |
| :--- | :--- |
| ADR-001 | Deferred Phase 1 Seed Swap (CANCELLED per ADR-010) |
| ADR-002 | Money Adapter Approach (Not Full Replacement) |
| ADR-003 | Split `discounts.ts` into rules + engine |
| ADR-004 | `installments.ts` Split |
| ADR-005 | `reconciliation.ts` as Higher-Level Orchestrator |
| ADR-006 | `ledger-balance.ts` as Convenience Layer |
| ADR-007 | DataTable Column Adapter Pattern |
| ADR-008 | AutoFormModal Renders Fields from Field Definitions (Not from Zod Schema) |
| ADR-009 | EntityDetailDrawer Uses Callback Props |
| ADR-010 | Phase 1 Seed Swap Cancelled (Canonical Demo Data) |
| ADR-011 | Subjects Tab Refactored to DataTable + AutoFormModal |
| ADR-012 | Clubs Tab: Card Grid Preserved, Modals Refactored |
| ADR-013 | Homework Tab Refactored to DataTable |
| ADR-014 | School Years Tab: 3 Modals Consolidated to 1 AutoFormModal + ConfirmModal |
| ADR-015 | Psychology/Orthophonie Tabs Skipped (Domain-Specific Dual-Action Flow) |
| ADR-016 | Phase 4A Shim Deletion + Direct Submodule Imports |
| ADR-017 | `queries.ts` Extracted from `installments.ts` Shim (Pure Functions Stay Pure) |
| ADR-018 | `receipt-pdf/index.ts` Barrel Replaces Root Shim |
| ADR-019 | Model Type Consolidation: `academic.ts` is the Single Source of Truth |
| ADR-020 | CRM Page: DataTable Replaces Manual `<ul>` Lists |
| ADR-021 | ParentDetailDrawer: EntityDetailDrawer Shell + Sibling Modals |
| ADR-022 | StudentDetailDrawer: Pure EntityDetailDrawer Shell (Per-Tab Files Unchanged) |
| ADR-023 | BatchRegistrationModal: Wizard Replaces Custom Stepper (validators return strings) |

---

## Verification Status (End of Session 4)

- ✅ `npx tsc --noEmit` → exit 0 (zero type errors)
- ✅ `npm test` → 25 test files / 414 tests passing (zero regressions)
- ✅ `npm run build` → production build succeeds (16.48s)

---

## Reproduction Commands

```bash
cd elimtiyaz-desktop
npx tsc --noEmit     # Type-check (should be exit 0)
npm test             # Run all 414 tests (should be 25 files, 414 passing)
npm run build        # Production build (should succeed)
```
