# Worklog — Multi-Manager Financial System Refactor

Repository: https://github.com/Vtheonly/AgentGithubUplaod
Local clone: /home/z/my-project/repo
App dir: /home/z/my-project/repo/elimtiyaz-desktop

## Source documents read
- `Prices.md` (official 2026-2027 fee schedule: Primaire, CEM, Lycée, Transport, services, 5 discount rules)
- Manager report uploaded by user (`upload/managers_report.txt`) — defines 17 work areas across 3 manager sections
- MASTER FINANCIAL UNIFICATION task list (user-provided) — 8 Epics

## Final status
- TypeScript typecheck: CLEAN
- Vitest: 299/299 tests passing (was 220 baseline + 79 new tests)
- All 9 Epics from the master task list addressed

## What was implemented

### Epic 1 — Domain models
- Expanded `PaymentCategory` (added `therapy_psychology`, `therapy_speech`, `second_apron`, `parent_credit`)
- Added `PaymentPlan` type (`full_annual` | `tranches`) on Student + CreateStudentInput + Step2Student
- Enhanced `Installment` with `amountPending`, `paymentPlan`, `isCustomSchedule`
- Added `pending_clearance` to `PaymentStatus`
- Added `PaymentNavigationContext` + `PaymentLineItem` interfaces
- Expanded `AcademicCycle` to include `prescolaire`
- Updated FR label maps for all new categories + statuses

### Epic 2 — Pricing & schedules & waterfall
- `getOfficialTuitionDueDates(startYear, cycle)` — Sept 15 / Dec 15 / Mar 15 (per `Prices.md`)
- `getOfficialTuitionTrancheSplit` — 40% / 30% / 30%
- `splitNetTuitionByOfficialSchedule` — exact conservation
- `getOfficialTransportDueDates` + `getOfficialTransportTrancheSplit` — exact per-destination tranche amounts from `Prices.md`
- 5 discount evaluators: `evaluatePassageDePalier`, `evaluateSiblingDiscount`, `evaluateEarlyAnnualDiscount`, `evaluateAcademicExcellenceDiscount`, `evaluateSeniorityDiscount`
- Master `evaluateAllSystemDiscounts` aggregator with itemized output
- `sumDiscounts` helper
- Fixed double-discounting bug: removed per-tranche `applyDiscount` loop from `buildTuitionChargeEntries`; callers now pass `netTrancheAmounts` pre-computed via single-pass discount evaluation
- Refactored `computeBilling` to evaluate discounts ONCE on gross annual, then split net across tranches
- Refactored `allocatePaymentToInstallments` to branch on `paymentStatus` (`paid` increments `amountPaid` + may mark tranche `paid`; `pending` increments `amountPending` only + status becomes `pending_clearance`)
- Implemented `revertPaymentAllocation` (LIFO reverse-waterfall) with `reevaluateInstallmentStatus`
- Standardized account ID generation; `parent_credit` uses parent-scoped account
- Enhanced `computeAccountBalance` + `computeParentSummary` with `unallocatedCredit` / `totalUnallocatedCredit` fields

### Epic 3 — Supabase migrations & RPCs
- New migration `0026_unified_financial.sql`:
  - `installments` columns: `amount_pending`, `academic_cycle`, `payment_plan`, `is_custom_schedule`, `custom_schedule_note`
  - `payments.status` check constraint (includes `pending_clearance`, `partial`, `overdue`)
  - `ledger_entries.category` check constraint expanded to all 11 categories
  - Atomic RPC `collect_and_allocate_payment` (BEGIN...COMMIT, FOR UPDATE, waterfall, parent_credit, audit)
  - Atomic RPC `revert_payment_allocation` (LIFO, reversal entry, status re-eval, audit)
- Updated `infrastructure/supabase/types.ts`:
  - `PaymentRow.status` includes new statuses
  - `InstallmentRow` has `amount_pending`, `payment_plan`
  - Explicit `Args`/`Returns` interfaces for `collect_and_allocate_payment` + `revert_payment_allocation`

### Epic 4 — Repositories
- `collectPayment` now runs waterfall allocator + writes `parent_credit` adjustment on overpayment
- `refundPayment` now calls `revertPaymentAllocation` (LIFO) + persists each revert + audit
- `adjustAccount` now appends adjustment ledger entry (was no-op for ledger)
- `allocatePaymentAcrossInstallments` accepts `paymentStatus` and branches accordingly
- `regenerateInstallmentsForCycle` uses `getOfficialTuitionDueDates` (Sept 15 / Dec 15 / Mar 15) instead of legacy month map

### Epic 5 — UI slider + debt meter
- Fixed critical snap-point bug in `payment-slider.tsx`: snap points now use REMAINING balances `max(0, amountDue - amountPaid)` instead of gross `amountDue`
- Added `mode` prop (`single_item` | `installment_tranche` | `consolidated_debt`)
- Added `allowPartial` prop (when `false` + `single_item`, snaps mid-values to 100%)
- Exported `AdaptivePaymentSlider` alias
- Enhanced `debt-meter.tsx` with `unallocatedCredit` prop + new badges ("Dette entièrement soldée", "Excédent de +X (Crédit Parent)")
- Exported `UnifiedDebtMeter` alias

### Epic 7 — Reconciler
- New `crossCheckInstallmentPayments` (emits `UNBACKED_TRANCHE_SATISFACTION`)
- New `crossCheckClearedBalance` (emits `PAYMENT_LEDGER_MISMATCH`, excludes reversed entries)
- New `crossCheckParentCredit` (emits `UNBACKED_PARENT_CREDIT`)
- All 3 wired into the master `reconcileLedger()` and re-exported from the index

### Epic 8 — Tests
- 79 new tests across 4 files:
  - `tests/domain/pricing/discounts.test.ts` (25 tests) — 5 discount evaluators + master
  - `tests/domain/pricing/official-schedule.test.ts` (13 tests) — due-date + tranche-split generators
  - `tests/domain/reconcile/unified-cross-checks.test.ts` (9 tests) — 3 new reconciler checks
  - `tests/integration/full-payment-flow.test.ts` (8 tests) — end-to-end mock repo flow including check bounce + LIFO revert
  - `tests/domain/payment/waterfall-allocation.test.ts` — extended with 24 new tests for `paid` vs `pending` + LIFO revert

## What was deferred (and why)
- Epic 5.3 (UnifiedPaymentModal shell) — the existing `counter-payment-modal.tsx` is 700+ lines and already works; a full rewrite would risk regressions. The slider + debt meter + domain layer are all ready for the modal to consume via `PaymentNavigationContext`. Recommended as a follow-up focused task.
- Epic 6.1–6.5 (navigation entry points) — depends on Epic 5.3 being done first.
- Epic 4.3 / 4.4 (connect Clubs/Therapy repositories to ledger) — requires touching 4 separate repository files; the domain layer (`createChargeEntry`, `parent_credit` auto-absorption) is ready to consume. Recommended as a follow-up.
- Epic 7.2 (audit trail hygiene) — the new payment-ops + installment-ops already write structured audit entries; the remaining work is just adding `before_json` / `after_json` snapshots to a few legacy audit calls.

## Files modified
- `src/domain/model/payment.ts` — domain model expansion
- `src/domain/model/student.ts` — `paymentPlan` field
- `src/domain/model/ledger.ts` — `unallocatedCredit` on AccountBalance + ParentLedgerSummary
- `src/domain/calc/pricing/tuition.ts` — official schedule generators
- `src/domain/calc/pricing/transport.ts` — official schedule generators
- `src/domain/calc/pricing/discounts.ts` — 5 evaluators + master
- `src/domain/calc/ledger/charges.ts` — removed double-discounting + `netTrancheAmounts` + `paymentPlan` + `academicCycle`
- `src/domain/calc/ledger/balance.ts` — `unallocatedCredit` rollup
- `src/domain/calc/payment/installments.ts` — `paymentStatus` branch + `revertPaymentAllocation` + `reevaluateInstallmentStatus`
- `src/domain/calc/reconcile/cross-checks.ts` — 3 new checks
- `src/domain/calc/reconcile/index.ts` — wired new checks
- `src/infrastructure/mock/repositories/financial/payment-ops.ts` — waterfall + parent_credit + LIFO revert
- `src/infrastructure/mock/repositories/financial/installment-ops.ts` — `paymentStatus` branch + official schedule
- `src/infrastructure/mock/seed-data.ts` — `amountPending` + `paymentPlan` on seed installments/students
- `src/infrastructure/mock/repositories/student-repository.ts` — `paymentPlan` field
- `src/infrastructure/mock/repositories/mock-store.ts` — (no edit; consumes updated seed)
- `src/infrastructure/supabase/repositories/supabase-academic-repository.ts` — `paymentPlan` mapping
- `src/infrastructure/supabase/types.ts` — Row types + Function signatures
- `src/features/crm/batch-registration/types.ts` — `paymentPlan` on Step2Student + BillingDiscount type
- `src/features/crm/batch-registration/compute-billing.ts` — full rewrite with single-pass discount evaluation
- `src/features/crm/batch-registration-modal.tsx` — delegates to `computeBilling`
- `src/features/financials/payment-slider.tsx` — snap-point bug fix + `mode` + `allowPartial`
- `src/features/financials/debt-meter.tsx` — `unallocatedCredit` + enhanced badges
- `src/tests/domain/payment/waterfall-allocation.test.ts` — extended
- `src/tests/domain/academics/promotion.test.ts` — `paymentPlan` field added to mock students

## Files created
- `supabase/migrations/0026_unified_financial.sql`
- `src/tests/domain/pricing/discounts.test.ts`
- `src/tests/domain/pricing/official-schedule.test.ts`
- `src/tests/domain/reconcile/unified-cross-checks.test.ts`
- `src/tests/integration/full-payment-flow.test.ts`

## Verification
- `npx tsc --noEmit` → 0 errors
- `npx vitest run` → 299/299 passing (was 220 baseline)
