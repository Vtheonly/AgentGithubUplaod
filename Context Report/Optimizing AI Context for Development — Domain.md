## Scope & Evidence Boundary

The provided export (`_entire_project_domain.txt`) contains **111 files** strictly inside `elimtiyaz-desktop/src/domain/` (`calc/`: 64, `identity/`: 11, `model/`: 24, `repository/`: 9, root `domain/`: 3). It does **not** include `src/core/`, `src/infrastructure/` (Supabase/Mock repository implementations, Excel importer), `src/features/` (React UI/state), `supabase/migrations/`, tests, or the sibling website/Android codebases.

Accordingly:
- Every contradiction, bug, duplication, and dead path reported below is directly observed in these 111 files.
- Where a domain file has zero callers *within* `src/domain/`, it is flagged as unreferenced internally—external usage in `infrastructure/` or `features/` must be checked before physically deleting the source file, though it can be removed from or marked deprecated in the AI context immediately.

---

# Part I — Context Audit

## 1. What Must Always Be Included
An AI modifying this codebase will introduce silent financial corruption, cross-platform drift, or invalid schedules unless it always receives:
1. **Canonical Accounting & Ledger Mechanics:**
   - Signed-entry convention (`charge` > 0, `payment` < 0, `refund` < 0, `adjustment` ±, `reversal` = `-original.amount`), deterministic account ID derivation (`deriveAccountId` in `calc/ledger/account-id.ts`), and replay-based balance calculation (`computeAccountBalance`, `computeParentSummary`, `displayParentCredit` in `calc/ledger/balance.ts`).
   - **INV-4 & Installment Lifecycle:** `installmentRemaining(i) = clampNonNegative(amountDue - amountPaid - amountPending)`, `isInstallmentSettled`, dynamic `isInstallmentOverdue` (`calc/payment/queries.ts`), FIFO chronological allocation (`waterfall-allocator.ts`), bounded clearance (`clearance.ts`), and LIFO reversal (`lifo-reversal.ts`).
   - **As-Of Payment & Reconciliation Rules:** `sumPaidPaymentsAsOf` vs `sumFutureRecordedPaidPayments` (`calc/payment/sums.ts`) and the adjustment-aware equation in `computeParentBillingBreakdown` (`calc/payment/billing-breakdown.ts`).
   - **Cross-Year Attribution & Debt Aging:** Persisted `academicYearId` precedence over date fallback (`attributeInstallmentAcademicYear`, `attributePaymentAcademicYear`), INV-16 ordered thresholds (`computeDebtAgingStatus` in `calc/ledger/debt-aging.ts`), and cross-year settlement read-only replay (`calc/ledger/year-history.ts`).
2. **Active Pricing, Registration & Discount Rules:**
   - The real 2026/2027 price matrix (`calc/pricing/school-price-matrix.ts`), official tranche calendar/splits (`tuition.ts`, `transport.ts`), active vs historical per-year `PricingConfigSummary` (`model/pricing.ts`), and single-pass annual discounting (`discount-engine.ts`, `discount-rules.ts`).
3. **Curriculum, Subject Context & Progression Rules:**
   - Subject Identity vs Context split (ADR-018: `Subject` vs `SubjectConfiguration` + assessment snapshot in `model/academic.ts` & `calc/academics/subject-config.ts`), recipe-aware GPA (`gpa.ts`), Algerian grade ladder + stream compatibility (`model/student.ts`, `model/filiere.ts`), promotion/cycle/re-enrollment contracts (`promotion.ts`, `model/promotion-cycle.ts`, `model/re-enrollment.ts`), and heterogeneous class balancing (`class-placement.ts`).
4. **Canonical Automatic Timetable & Constraint Rules:**
   - Data-driven `TimetableConfiguration`, `Room`, `TimetableConstraint`, `TimetableProblem` (`model/timetable.ts`), single canonical validator (`calc/timetable/constraints.ts`), feasibility/post-persist gate (`feasibility.ts`), per-class reporting (`class-reports.ts`), and deterministic greedy + eviction solver (`solver/greedy-solver.ts`).
5. **ER-PMAE Identity Resolution & Reversible Merge Rules:**
   - `normalize → block → veto → score → band → proposal` pipeline (`identity/*`), human-confirmation requirement (INV-50), and reversible merge/unmerge contract (`identity/repository.ts`).
6. **Payroll Forecast, Workflow DAG, PII Masking & Repository Contracts:**
   - Canonical payroll cash-flow forecast (`calc/payroll/payroll-forecast.ts`), Kahn cycle guard (`kahn.ts`), safe condition evaluator (`condition-evaluator.ts`), handle-aware dry-run (`dry-run.ts`), PII masking order (`pii-mask.ts`), and authoritative repository interfaces (`repository/*`).

---

## 2. What Can Be Unified or Consolidated

| Topic | Scattered / Overlapping Files | Consolidation Action |
|---|---|---|
| **Academic Repository Contracts** | `repository/academic-repository.ts` & `repository/repository.ts` both define `ClassRepository`, `SubjectRepository`, `GradeRepository`, `AttendanceRepository`, `HomeworkRepository` | Merge into a single authoritative definition per interface (keeping `academic-repository.ts` type precision + `repository.ts`'s `arrivalTimes` on `recordRollCall`). |
| **Pricing & Discount Documentation** | `model/pricing.ts`, `calc/pricing/discount-rules.ts`, `discount-engine.ts`, `school-price-matrix.ts`, `tuition.ts`, `transport.ts` | Document one unified pricing/tranche flow: active `PricingConfig` (falling back to `school-price-matrix.ts` for new quotes) + 5% early-annual on *scolarité* + 5,000 DA default sibling component + manual `remise` on V2. |
| **Payment Breakdown & Service Profile Engines** | `calc/payment/billing-breakdown.ts`, `calc/payment/service-pricing-profile.ts`, `calc/ledger/year-history.ts` | Present these as three specialized read projections over the same canonical facts (`ledgerEntries`, `installments`, `payments`, `allocations`) rather than repeating INV-4 and academic-year logic across each file. |
| **Payment Category French Labels** | 5 separate maps: `PAYMENT_CATEGORY_LABELS_FR` (`model/payment.ts`), `SERVICE_LABELS_FR` (`billing-breakdown.ts`), `SERVICE_LABEL_FR` (`service-pricing-profile.ts`), inline map in `financial-query-engine.ts`, `YEAR_SERVICE_GROUP_LABELS_FR` (`year-history.ts`) | Document `PAYMENT_CATEGORY_LABELS_FR` + `paymentCategoryLabelFr` (`null` → `"Multi-services"`) as canonical; note the breakdown/profile variants as display-only overrides. |
| **Timetable Constraint Indexing & Period Duration** | `periodMinutes` (`model/timetable.ts`) is re-implemented privately in `constraints.ts`, `feasibility.ts`, and `class-reports.ts`; constraint indexing is duplicated across `constraints.ts`, `feasibility.ts`, and `greedy-solver.ts` | Describe the timetable constraint model once; flag the 3 internal indexers as refactoring candidates when changing constraint kinds. |
| **Reconciliation & Diagnostics** | `calc/reconcile/*` (`reconcileLedger`, `reconcileFinancials`) and `calc/payment/webhook-diagnostics.ts` (`runWebhookDiagnostics`) | Group under one "Ledger Integrity vs Whole-Books Traceability Audit" section with explicit scope differences. |
| **Static Reference Data Mirrors** | `algerian-curriculum.ts`, `algerian-profile.ts`, `model/filiere.ts` | Summarize schemas and link to DB seeds (`0113`, `0109`, `0107`) instead of dumping 200+ lines of static coefficient/curriculum rows into context. |
| **Re-export Shims** | `model/ledger.ts`, `model/payment.ts`, `model/pricing.ts`, `model/student.ts`, `calc/ledger/balance.ts` aliases | Collapse all thin re-exports in context; document only the canonical `calc/` or `model/` home. |

---

## 3. What Can Be Removed From AI Context

1. **Historical Task/Session Changelogs & Ticket Narratives:** Hundreds of lines of prose explaining what bugs used to exist in sessions 33–173 (`T-103`, `DATA-045`, `STATS-401`, *"previously the drawer did X..."*) pollute every file. Retain only the **current invariant** and **known pitfalls**, not the narrative history.
2. **Superseded Legacy Timetable Stack:**
   - `model/teacher.ts`: `SchoolDay`, `SCHOOL_DAYS`, `SCHOOL_DAY_LABELS_FR`, `TimeSlot`, `formatTimeSlot`, `TimetableEntry`, `CreateTimetableEntryInput`, `UpdateTimetableEntryInput`, `Timetable`.
   - `calc/teacher/validation.ts`: `validateDay`, `validateTimeRange`, `validateCreateTimetableEntryInput`, `validateUpdateTimetableEntryInput`, `detectTimetableConflict`.
   - `repository/teacher-repository.ts`: the 6 `Timetable` methods.
   *(Explicitly marked superseded by ADR-020 / `model/timetable.ts` as a mock-only façade.)*
3. **Unused Dinero.js Wrapper:** `calc/shared/money-dzd.ts` has zero callers anywhere in `src/domain/`. All domain math uses integer DZD or centi-scaled integers (`money.ts`, `subject-config.ts`, `discount-rules.ts`).
4. **Deprecated / Dead Shim Aliases & Ignored Params:**
   - `calc/ledger/balance.ts`: `replayParentLedger`, `balanceForAccount`, `totalOutstandingAcrossAccounts` (exact wrappers around `computeParentSummary`/`computeAccountBalance`, unused internally).
   - `calc/ledger/charges.ts`: `@deprecated discounts` parameter on `buildTuitionChargeEntries` (explicitly ignored).
   - `calc/pricing/discount-engine.ts`: deprecated `grossTuition`, `previousGradeLevel`, `previousRank`, `enrollmentDate`, `academicYearStart` parameters (explicitly ignored).
   - `model/payment.ts`: `AcademicCycleLegacy`.
   - `calc/ledger/debt-aging.ts`: `DEBT_AGING_ACTIVE_PAYER_WINDOW_DAYS = 60` (explicitly marked removed rule).
5. **Fictional / Retired Rules & Codes:**
   - Discount codes `passage_palier`, `highest_average`, `seniority_5y`, `sibling_10`, `sibling_15`, `early_bird`, `scholarship_replacement` (retained in union types only for legacy DB compatibility).
   - Legacy fictional service items (`canteen`, `uniform`, `books`, `second_apron`, fictional chess/English clubs) except where historical ledger entries require label lookup.
   - `ADMIN_PALETTE_HIDDEN_SUBTYPES` in `model/workflow.ts` (`database_query`, `extract_field`).
6. **Test/Smoke Fixture & Boilerplate Label Dictionaries:**
   - `calc/timetable/fixture.ts` (smoke test fixture only).
   - Verbose `*_LABELS_FR` constant dictionaries and unused imports (`PromotionRepository` in `repository.ts`; salary types in `workforce-repository.ts`; `GradeLevel`/`AcademicCycle`/`AcademicTerm` in `teacher.ts`; `computeSubjectAverage` in `gpa.ts`).

---

## 4. What Is Already Covered Elsewhere (Eliminate Repetition)

- **INV-4 (`due - paid - pending`):** Repeated across `queries.ts`, `billing-breakdown.ts`, `waterfall-allocator.ts`, `tranche-waves.ts`, `debt-aging.ts`, `year-history.ts`, `service-pricing-profile.ts`, and `webhook-diagnostics.ts`. Define once in Payment Core.
- **Re-exported Calc Functions on Models:** `model/ledger.ts`, `model/payment.ts`, `model/pricing.ts`, and `model/student.ts` re-export functions/types canonically defined in `calc/*` and `model/academic.ts`. Document only at canonical homes.
- **Academic-Year Date Attribution (INV-14) & Epsilon `0.001`:** `year-history.ts` re-declares `YEAR_HISTORY_EPSILON_DZD = 0.001` and `inv4Remaining`, duplicating `DEBT_AGING_EPSILON_DZD` (`debt-aging.ts`) and `installmentRemaining` (`queries.ts`).
- **Academic Cycle Resolution:** `AcademicCycle` (`prescolaire|primaire|cem|lycee`) is defined in `model/academic.ts`, re-explained in `model/payment.ts`, and re-derived manually in `promotion.ts` and `service-pricing-profile.ts` (`CYCLE_OF_GRADE`).
- **Reconciliation vs Cross-Checks:** `reconcile/index.ts`, `reconcile/checks.ts`, `reconcile/cross-checks.ts`, and `reconcile/reconciliation.ts` duplicate type re-exports and entry-level vs cross-entity summaries.

---

## 5. Contradictory, Buggy, or Outdated Logic (with Authoritative Resolution)

| # | Contradiction / Defect | Conflicting Sources | Authoritative Truth |
|---|---|---|---|
| **C1** | **Duplicate Repository Interfaces with Divergent Signatures** | `academic-repository.ts` vs `repository.ts` (`ClassRepository.createClass` `isActive`, `AttendanceRepository.recordRollCall` `arrivalTimes`, `SubjectRepository.observeByLevel`, `HomeworkRepository.attachments`) | **`repository.ts`** reflects newer runtime signatures (`arrivalTimes`), while **`academic-repository.ts`** owns `AcademicYearRepository`, `AcademicLevelRepository`, `ClassPlacementRepository`, `PromotionCycleRepository`, `ReEnrollmentRepository`, `StudentNarrativeRepository`, and strict `AcademicLevel` typing. Must be merged before any modification. |
| **C2** | **Mon–Fri vs Sun–Thu School Week & Dual Timetable Engines** | `model/teacher.ts` + `calc/teacher/validation.ts` + `teacher-repository.ts` (Mon–Fri, no rooms/breaks) vs `model/timetable.ts` + `calc/timetable/*` + `timetable-repository.ts` (Sun–Thu, rooms, constraints, versions) | **`model/timetable.ts` + `calc/timetable/*` + `TimetableRepository`** (ADR-020). `teacher.ts` timetable code is obsolete. |
| **C3** | **Timetable Teacher ID Space (`Teacher.id` vs `Personnel.id`)** | `model/teacher.ts` & `calc/teacher/validation.ts` state timetables reference `Teacher.id` (not `Personnel.id`); `model/timetable.ts` (`TimetableConstraint.entityId`) & `calc/timetable/fixture.ts` state `personnel` IDs. | **Unresolved ambiguity in domain.** Check DB FK on `timetable_entries.teacher_id` / `class_subjects.teacher_id` in `supabase/migrations` & `infrastructure/` before touching teacher/timetable joins. |
| **C4** | **`gpa.ts` Fails to Match `SubjectConfiguration` Rows** | `calc/academics/subject-config.ts` requires `c.academicLevelId === input.academicLevelId && c.academicYearId === input.academicYearId`; `calc/academics/gpa.ts` (`evaluateStudentTermPerformance`) calls `resolveSubjectConfiguration({ subject, configurations })` omitting both IDs (`undefined`). | **`subject-config.ts`** is authoritative (ADR-018). `gpa.ts` silently falls back to legacy `Subject` columns when `Assessment.coefficient` is absent unless callers supply `academicLevelId`/`academicYearId` or update `gpa.ts`. |
| **C5** | **Early-Payment Discount: 5% Scolarité-Only vs 10% Docstrings** | `model/pricing.ts`, `model/payment.ts`, `model/student.ts` docstrings claim **10%**; `calc/pricing/discount-rules.ts` (`EARLY_ANNUAL_RATE = 0.05`), `school-price-matrix.ts`, `service-pricing-profile.ts` compute **5% on scolarité only** (excluding FI/transport). | **5% on scolarité only before June 30** (`discount-rules.ts` / `school-price-matrix.ts`). |
| **C6** | **Clubs & Therapy Finance Isolation vs Ledger Charge Builders** | `model/club.ts`, `club-repository.ts`, `model/therapy.ts`, `therapy-repository.ts` forbid touching the ledger/finance; `calc/ledger/non-tuition-charges.ts` builds club/therapy/service ledger charges (and illegally imports `infrastructure/mock/pricing-seed` inside `domain/`!). | **Domain split / active contradiction.** `non-tuition-charges.ts` uses retired fictional club/canteen data and breaks clean layering; Finance owns billing via `PricingConfig` / `PaymentRepository.appendManualCharge` (`psy1/2`, `orth1/2`, `e_plant`, `ratrapage`, `autiste`). |
| **C7** | **Registration Fee (FI): Flat Family Fee vs Per-Student Grade Fee** | `PricingConfig.registrationFee` (flat family fee) vs `PricingConfig.registrationFeeByGrade` & `REAL_FI_BY_GRADE` (18k–30k DA per student). | **Known live tension** explicitly flagged by `webhook-diagnostics.ts`. Both exist in config; `school-price-matrix.ts` uses per-student FI while legacy flat path remains active in registration/settings. |
| **C8** | **Two Tuition Tranche Splitting Strategies** | `tuition.ts` (`splitNetTuitionByOfficialSchedule`: 40/30/30 on net annual) vs `school-price-matrix.ts` (`computeSchoolDevis`: full `remise` subtracted from V2/T1 only, T2/T3 fixed stickers). Also `DEFAULT_CYCLE_TRANCHE_MONTHS` (`[9,12,4]`, `[9,1,5]`) vs official `[9,12,3]` (`tuition.ts`). | **Depends on flow:** `school-price-matrix.ts` models the workbook devis (`remise` on V2); `tuition.ts` splits pre-discounted annual net 40/30/30; DB `grade_level_tuition` owns live due months (`9/1/5`, `9/12/3`, `9/12/4`). |
| **C9** | **`currentTermWindow` Bug in `calc/academics/terms.ts`** | Docstring says T2 is `Dec 16 – Mar 15` and T3 is `Mar 16 – Jun 30`. Code checks `if (month < 8)` (Jan–Aug) and unconditionally returns **`T3` starting `Dec 16` of previous year**—making Jan 1–Mar 15 evaluate as `T3` instead of `T2`! | **Code defect in `terms.ts`**—needs fix if term-window absence alerts rely on it during Jan–Mar. |
| **C10** | **Installment Zero-Paid Status (`"unpaid"` vs `"pending"`) & Pending Funds Filtering** | `lifo-reversal.ts` & `clearance.ts` use `"unpaid"` (ADR-033); `waterfall-allocator.ts` dead fallback branch uses `"pending"`. Meanwhile `sums.ts` `sumPendingPayments` filters `status === "pending"` only, while `financial-query-engine.ts` and `year-history.ts` check `"pending" || "pending_clearance"`. | **`"unpaid"`** for untouched future tranches (ADR-033); **`"pending"`** on `Payment`, **`"pending_clearance"`** on `Installment`. |
| **C11** | **`service-pricing-profile.ts` Violations of Canonical Rules** | Uses `trancheNumberFromLabel(i.label)` instead of `i.trancheNumber`, hardcodes `EARLY_PAYMENT_DEADLINE = "2026-06-30"`, and sums raw ledger adjustments without `reversesId` exclusion. | **`tranche-waves.ts`** (`i.trancheNumber`), **`school-price-matrix.ts`** (`earlyPaymentCutoff`), and **`balance.ts`** (`reversedIds` exclusion) are authoritative. |
| **C12** | **`reconcile/cross-checks.ts` vs `webhook-diagnostics.ts` Charge Resolution** | `crossCheckInstallments` matches `e.sourceId` against `installment.id` (PK) only and `crossCheckPayments` overwrites duplicate ledger entries in a `Map`; `webhook-diagnostics.ts` resolves both PK and `reg-<code>-...` identities and detects duplicates. | **`webhook-diagnostics.ts`** holds the current all-origins resolution rules; `cross-checks.ts` has false-positive blind spots on registration charges. |
| **C13** | **Three Promotion Entry Points & Duplicate GPA Fallback** | `StudentRepository.promote` (legacy), `PromotionRepository.executeBatchPromotion`, and `PromotionCycleRepository` (`confirmClass`); `class-placement.ts` computes GPA inline via `Subject.isExtracurricular` instead of `gpa.ts`/`subject-config.ts`. | **`PromotionCycleRepository` + `buildPromotionReviewQueue` + `buildPromotionDecisionPayload`** are authoritative (wrapping `execute_batch_promotion`). `StudentRepository.promote` is legacy. |
| **C14** | **Incomplete Barrel Exports (`index.ts`)** | `calc/index.ts`, `calc/ledger/index.ts`, `calc/payment/index.ts`, and `model/index.ts` omit critical modules (`debt-aging.ts`, `year-history.ts`, `tranche-waves.ts`, `webhook-diagnostics.ts`, `algerian-curriculum.ts`, `subject-config.ts`, `timetable/*`, `filiere.ts`, `promotion-cycle.ts`, `re-enrollment.ts`, `workflow.ts`). | **Import directly from canonical submodules** rather than assuming barrels expose the full domain. |
| **C15** | **Expense Anomaly Signal Type Duplication** | `model/ai.ts` (`AnomalySignal`) vs `calc/expense/anomaly-signals.ts` (`ExpenseAnomalySignal`, missing `"missing_proof"`). | Merge/align `ExpenseAnomalySignal` with `AnomalySignal` (`calc/expense/anomaly-signals.ts` is the active derivation replacing mock signals). |
| **C16** | **Task Assignee ID Mismatch** | `TaskRepository.observeByAssignee(personnelId: string)` (`workforce-repository.ts`) accepts `user_profiles.id` (auth profile ID), not `Personnel.id`. | Always pass **`user_profiles.id` (`session.userId`)** to `Task.assigneeIds` and `observeByAssignee`. |

---

# Part II — Consolidated & Reduced Authoritative AI Context (`src/domain/`)

*(This document replaces the raw 111-file domain dump as a clean, contradiction-free reference for `elimtiyaz-desktop/src/domain/`.)*

---

## 1. Architecture & Dependency Direction
`src/domain/` is pure TypeScript (no React, no I/O; **exception to fix:** `calc/ledger/non-tuition-charges.ts` currently imports `infrastructure/mock/pricing-seed`).
- **Core dependency DAG:** `shared → pricing → ledger → payment → reconcile`, alongside `payroll`, `academics`, `timetable`, `workflow`, `identity`, `expense`, `diff`, `clubs`, `therapy`.
- **Barrel caveat:** `calc/index.ts`, `calc/ledger/index.ts`, `calc/payment/index.ts`, and `model/index.ts` are **incomplete**—import newer canonical engines (`debt-aging`, `year-history`, `tranche-waves`, `webhook-diagnostics`, `subject-config`, `timetable/*`, `filiere`, `promotion-cycle`, `re-enrollment`) from their direct file paths.
- **Cross-platform parity:** Calculations in `calc/` mirror PostgreSQL RPCs and sibling web/Android ports. Do not duplicate formulas in UI components or alter rounding/epsilon conventions independently.

---

## 2. Financial & Ledger Engine

### 2.1 Immutable Ledger & Balances (`model/ledger.ts`, `calc/ledger/`)
- **Account IDs (`calc/ledger/account-id.ts`):** `deriveAccountId(parentId, category, studentId)`:
  - Concrete: `parent:{parentId}:category:{category}` (+ `:student:{studentId}` if non-null).
  - Cross-category multi-service payment (`category === null`): `parent:{parentId}:category:all`.
- **Entry Signs & Factories (`calc/ledger/entries.ts`):**
  - `charge`: `+` (debit; parent owes more)
  - `payment`: `-` (credit; factory takes positive magnitude, stores `-amount`)
  - `refund`: `-` (factory takes positive magnitude, stores `-amount`)
  - `adjustment`: non-zero signed (`-` credit/discount on `parent_credit` with `studentId = null`; `+` debit/majoration on target category). **Late penalties do not exist (removed).**
  - `reversal`: `-original.amount` with `reversesId = original.id`
- **Canonical Balance (`calc/ledger/balance.ts`):**
  - **Balances are never stored**—always replay via `computeAccountBalance(entries, accountId, now)` and `computeParentSummary(entries, parentId, parentName, overdueCategoryDueDates, now)`.
  - Replay excludes entries after `now` (`isAtOrBefore`) and excludes entries whose IDs appear in `reversesId` from typed totals (`totalCharged`, `totalPaid`, `totalAdjusted`, `totalRefunded`, `unallocatedCredit`), while summing every entry's signed `amount` into `balance`.
  - **Parent Credit Display (`displayParentCredit(totalOutstanding, totalUnallocatedCredit)`):** If `totalOutstanding >= 0` → `0`. Else if `totalUnallocatedCredit < 0` → `-totalUnallocatedCredit` (canonical overpayment already books both `-payment` and `parent_credit`), else `-totalOutstanding` (historical reconciled overpayments).
- **Ledger vs Installment Overdue Note:** `calc/ledger/overdue.ts` (`maxDaysOverdueFromLedger`, `buildOverdueDueDateMap`) inspects `charge` timestamps (`e.at`). Prefer installment-based overdue (`queries.ts` / `debt-aging.ts`) for receivables/aging surfaces.

### 2.2 Installments, Waterfall, Clearance & Sums (`model/payment.ts`, `calc/payment/`)
- **Currency:** Integer DZD (centime-rounded only where noted). Epsilon for "settled/zero": `0.001`.
- **INV-4 Remaining & Predicates (`calc/payment/queries.ts`):**
  - `installmentRemaining(i) = Math.max(0, i.amountDue - i.amountPaid - (i.amountPending ?? 0))`
  - `isInstallmentSettled(i)` = `i.status === "paid" || installmentRemaining(i) === 0`
  - `isInstallmentOverdue(i, now)` = `i.status !== "paid" && dueDate < now && installmentRemaining(i) > 0` *(Always derive dynamically; never filter by stored `status === "overdue"`).*
  - Aging buckets (`agingBucketFromDays`): `0_30 | 31_60 | 61_90 | 91_180 | 180_plus`.
- **Payment Sums (`calc/payment/sums.ts`):**
  - `sumPaidPaymentsAsOf(payments, now)` — `status === "paid"` and (`!collectedAt || collectedAt <= now`). Use beside as-of ledger balances.
  - `sumFutureRecordedPaidPayments(payments, now)` — `status === "paid"` and `collectedAt > now` (surfaced separately, never counted as collected-to-date).
  - `sumPendingPayments(payments)` — `status === "pending"`. (Note: `financial-query-engine.ts` and `year-history.ts` match `pending || pending_clearance` on `Payment.status` as a defensive guard.)
- **Waterfall (`waterfall-allocator.ts`):**
  - `allocatePaymentToInstallments(installments, amount, categoryFilter, paymentStatus)` sorts `status !== "paid"` chronologically (`dueDate` asc, tie-break `id`), optionally filtering `category` (`null` = cross-category).
  - Capacity per tranche = `clampNonNegative(amountDue - amountPaid - amountPending)`.
  - Cleared (`"paid"`) increments `amountPaid` (sets `"paid"` when `>= amountDue`, else `"partial"`). Uncleared (`"pending"`) increments `amountPending` (sets `"pending_clearance"`). Excess goes to `unallocatedAmount` (`parent_credit`).
  - *Note:* Server RPC (`collect_and_allocate_payment`) is authoritative; client waterfall is used by mock mode and synthetic display schedules only.
- **Clearance (`clearance.ts`):** `clearPendingAllocation` moves `amountPending → amountPaid` chronologically, capped at `amountDue - amountPaid`; unplaceable excess returns in `overflowCredit`. Re-evaluates status via `reevaluateInstallmentStatus` (`"paid" | "partial" | "overdue" | "unpaid"`).
- **LIFO Reversal (`lifo-reversal.ts`):** `revertPaymentAllocation` reverses reverse-chronologically (`dueDate` desc, tie-break `id` desc), decrementing `amountPaid` or `amountPending` (`originalWasPending`) and setting zero-paid future-due tranches to `"unpaid"` (ADR-033).

### 2.3 Tranche Waves, Billing Breakdown & Year Tracking
- **Tranche Waves (`calc/payment/tranche-waves.ts`):**
  - Official wave numbers are **`1 | 2 | 3` only** across all categories (`derivePooledTrancheWaves`, `deriveTrancheWaveStats`). Never parse labels; always read `installment.trancheNumber`.
  - Tranche `0` (`fi` — registration fee), `null` (`unnumbered` — full-annual/manual debt), and out-of-range numbers are **non-wave** (`deriveNonWaveSummary`).
  - Pooled wave identity: `dueTotal + overCoverageTotal === paidTotal + pendingTotal + remainingTotal`. Uses `thresholds.gracePeriodDays` for overdue family counts.
- **Billing Breakdown (`calc/payment/billing-breakdown.ts`):**
  - `computeParentBillingBreakdown` produces `byChild`, `byService`, `unattributedItems`, adjustment provenance (`classifyAdjustmentHistory`: `documented | reversal_pair | undocumented`), and exact reconciliation: `grossBilled - adjustmentsCredit + adjustmentsDebit = netDue`; `netDue - clearedPaid - pendingPaid = derivedRemaining`; `bridge = serverOutstanding - derivedRemaining`. Synthesizes 40/30/30 tranches (`isSynthetic: true`) only if a child has charges with no physical `Installment` rows.
- **Cross-Year Debt Aging (`calc/ledger/debt-aging.ts`):**
  - `DEFAULT_DEBT_AGING_THRESHOLDS`: `gracePeriodDays: 5`, `yellowDays: 15`, `redDays: 60`, `activePayerGraceDays: 15` (annotation only—never masks overdue debt), `amountYellowDzd: 20_000`, `amountRedDzd: 60_000`, `severeDebtDzd: 40_000`.
  - Ordered status (`computeDebtAgingStatus`): `outstanding <= 0.001` → `green (resolved)`; `debtAgeDays <= grace` → `green (not_due)`; `<= yellow` → `yellow (watch)`; `<= red` → `orange (sustained_delinquency)`; `> red` → `red (critical_delinquency)`.
  - Year attribution (`INV-18a`): persisted `academicYearId` wins over INV-14 date window (`resolveAcademicYearForDate`: tenant `academic_years` bounds verified against code years, else Jul–Dec → `Y-(Y+1)`, Jan–Jun → `(Y-1)-Y`).
- **Year History (`calc/ledger/year-history.ts`):**
  - `computeParentYearHistory` replays charges by `attributeInstallmentAcademicYear`, payments made by `attributePaymentAcademicYear`, and cross-year settlements strictly from `allocations` where payment status is `"paid"` (`bounced`/`unpaid`/`refunded`/`cancelled` allocations are ignored). Closed years evaluate `yearEndOutstanding` at `endDate`; open years evaluate at `now`.
- **Read-Only Audit & Diagnostics (`calc/reconcile/*`, `calc/payment/webhook-diagnostics.ts`, `calc/payment/financial-query-engine.ts`):**
  - `reconcileFinancials` (`calc/reconcile/reconciliation.ts`) checks ledger self-invariants and payment/installment/balance/credit cross-checks. *(Caveat: `crossCheckInstallments` checks `e.sourceId === inst.id` PK only, whereas registration charges use `reg-` business IDs.)*
  - `runWebhookDiagnostics` (`calc/payment/webhook-diagnostics.ts`) performs whole-books read-only traceability across all origins, resolving both `installment-pk` and `reg-<code>[-transport]-(t<n>|fi)` charge identities, detecting sibling same-day payments vs true duplicates, future-dated payment skews, generic descriptions, and price-config deviations.
  - `financial-query-engine.ts` (`evaluateFamilyFinancialDiagnoses`, `computeCrossServicePerformance`, `computeTreasuryHealth`) consumes `computeParentSummary`, `displayParentCredit`, `installmentRemaining`, `payment_allocations`, and `PayrollForecast` (no recovery multipliers; 30d inflow = overdue ≤30d + upcoming due ≤30d).

### 2.4 Pricing & Discounts (`model/pricing.ts`, `calc/pricing/`, `calc/ledger/charges.ts`)
- **Per-Year Active Config (ADR-025):** One `PricingConfigSummary` per academic year; exactly one `isActive = true` per tenant (`PricingRepository.observe()`). Inactive configs are historical/read-only.
- **Authoritative 2026/2027 Matrix (`calc/pricing/school-price-matrix.ts`):**
  - **FI (`REAL_FI_BY_GRADE`):** Per student (`prescolaire_1/2`: 18,000; `1ap–4ap, 1am–3am, 1ere/2eme_annee`: 25,000; `5ap, 4am, 3eme_annee`: 30,000; `autiste`: 23,000). *Note: legacy flat `PricingConfig.registrationFee` still coexists in config and registration.*
  - **Tuition (`REAL_TUITION_BY_GRADE`):** 135,000–365,000 DA split ~40/30/30 into `[v2, tranche3, tranche4]` (`autiste`: 250,000).
  - **Transport (`REAL_TRANSPORT_MATRIX` & `transport.ts`):** Town-level schedules (40,000–65,000 DA in 3 tranches) normalized via `normalizeTransportTier` (`TOWN_ALIASES`), falling back to `"autres"` (55,000 DA) for unrecognized non-empty strings and `null` when absent.
  - **Active Services (`REAL_SERVICE_CODES`):** `psy1`, `psy2`, `orth1`, `orth2`, `e_plant`, `ratrapage`, `autiste`.
- **Discounts (`discount-rules.ts`, `discount-engine.ts`):**
  - Only two system rules exist: `full_annual` = **5%** of *scolarité* only (excluding FI/transport) if paid ≤ June 30 (`EARLY_ANNUAL_RATE = 0.05`); `sibling_fixed` = default `-5,000 DA` per additional child (`childIndex > 1`).
  - Manual negotiated `remise` is passed per student (`CreateStudentInput.remise`) and deducted from Tranche 1 (`V2`) in `computeSchoolDevis`.
  - Pre-apply discounts on the annual total before calling `buildTuitionChargeEntries` with `netTrancheAmounts` (never pass per-tranche discounts).
  - Official tranche due dates (`getOfficialTuitionDueDates`, `getOfficialTransportDueDates`): Sept 15 (`startYear`), Dec 15 (`startYear`), Mar 15 (`startYear + 1`).

---

## 3. Personnel Payroll Forecast (`calc/payroll/payroll-forecast.ts`, `model/personnel.ts`)
- **Single canonical engine (`computePayrollForecast`):** Consumed by Personnel, Finance (`TreasuryHealthSnapshot.payroll`), and Statistics.
- **Rules:**
  - Periods are `YYYY-MM` in `Africa/Algiers`. Canonical payout date = last calendar day of the month (actual `salary_payments.paymentDate` overrides for paid rows).
  - Eligible staff per period: `status === "active" && salary > 0 && hireDate <= periodLastDay && (!terminationDate || terminationDate >= periodStart)`.
  - `securedAmount` = `Σ netPaid` of `paid` + `pending` rows; `remainingFundingRequirement = max(0, expectedPayroll - securedAmount)`.
  - Overdue gap carry-over: missed periods between the last pre-current recorded disbursement and `currentPeriod` are flagged `phase: "overdue"` when historical records exist.

---

## 4. Academics, Curriculum, Promotion & Timetable

### 4.1 Grade Ladder, Streams & Subjects (`model/student.ts`, `model/academic.ts`, `model/filiere.ts`, `calc/academics/`)
- **Ladder (`GRADE_LEVELS`):** `prescolaire_1`, `prescolaire_2` (`primaire`, yr 0) → `1ap..5ap` (`primaire`, yr 1–5) → `1am..4am` (`cem`, yr 1–4) → `1ere_annee..3eme_annee` (`lycee`, yr 1–3). `AcademicCycle` distinguishes `"prescolaire"` from `"primaire"`.
- **Tracks (`model/filiere.ts`):** Niveau → Filière → Spécialité → Classe. Compatibility enforced via `trackCompatible` (empty/`"general"` class accepts all; tagged class rejects incompatible same-grade stream or mismatched spécialité; cross-grade re-streaming allowed). `normalizeTrackCode` maps `""` / `"general"` → `null`.
- **Subject Identity vs Context (ADR-018, `calc/academics/subject-config.ts`):**
  - `Subject` holds identity (`code`, `name`, `nameAr`, `cycle: null` on catalog rows; `algerian-curriculum.ts` mirrors seed `0113` with official 4AM BEM coefficients).
  - `SubjectConfiguration` holds context (`subjectId`, `academicYearId`, `academicLevelId`, `direction`, `coefficient`, `subjectCode`, `passingGrade`, `isExtracurricular`, `gradingRecipe` defaulting to `{ devoir1: 1, devoir2: 1, examen: 2, cc: 0 }`).
  - `resolveSubjectConfiguration` resolution order: **(1) Assessment snapshot → (2) Configuration row (`direction` then `"general"`) → (3) Legacy `Subject` columns → (4) Hard default (`coef: 1`, `passing: 10`, `recipe: {1,1,2,0}`)**.
  - *Important defect:* `gpa.ts` `evaluateStudentTermPerformance` currently omits `academicLevelId` and `academicYearId` when calling `resolveSubjectConfiguration`; fix this call site if using `gpa.ts` with context configurations.
  - **Subject Average & GPA (`subject-config.ts`, `model/academic.ts`):** Every positive-weight component mark must be non-null (`null` if incomplete; never coerce missing marks to 0). Rounded via integer centi-math. `computeOverallGpa` excludes `isExtracurricular` and `null` averages; passing default = `10.0`.
- **Terms Bug Note:** `calc/academics/terms.ts` `currentTermWindow` returns `T3` for `month < 8` (Jan–Aug), misclassifying Jan 1–Mar 15 as `T3` instead of `T2`.

### 4.2 Promotion, Re-Enrollment & Class Placement (`promotion.ts`, `model/promotion-cycle.ts`, `model/re-enrollment.ts`, `class-placement.ts`)
- **Progression (`getNextGradeProgression`):** `prescolaire_1 → prescolaire_2 → 1ap..5ap → 1am..4am → 1ere_annee..3eme_annee → graduated`.
- **Authoritative Promotion Flow:** `PromotionCycleRepository` (per-class human-in-the-loop review over `buildPromotionReviewQueue`, `applyDecisionOverride`, and `buildPromotionDecisionPayload`, with two-phase `[NOTES_INCOMPLETES]` acknowledgement via `findStudentsWithIncompleteNotes`) wrapping `execute_batch_promotion`. (`StudentRepository.promote` is legacy.)
- **Re-Enrollment (`model/re-enrollment.ts`):** Candidate list built from finalized `student_academic_histories` (`waiting → started | not_continuing`, terminal `re_enrolled` via `ReEnrollmentRepository.reEnroll` stamping target `academic_year_id`, then `freeze`). New students capture `StudentOriginInfo` separately from `academicHistory`.
- **Class Formation (`calc/academics/class-placement.ts`):** `buildPlacementCandidatesPool`, `autoBalancePlacements` (serpentine by repeater dispersion, boy/girl parity, GPA spread), and `validatePlacementFinalization` (enforces `trackCompatible`). Persisted atomically via `ClassPlacementRepository.finalizePlacements` using `clientDraftId` mapping.

### 4.3 Automatic Timetable (`model/timetable.ts`, `calc/timetable/`, `repository/timetable-repository.ts`)
- **Authoritative engine (ADR-020):** `TimetableConfiguration` (Algerian default `algerian-profile.ts`: `sunday..thursday`, 6 periods `S1..S6` 08:00–15:00 with breaks after S2 and S4), `Room`, `TimetableConstraint`, `TimetableRequirement` (from `ClassSubject`), `TimetableVersion` (`draft → in_review → approved → published → archived` / `rejected`), `TimetableScheduleEntry`.
- **3-Gate Generation Pipeline:**
  1. `analyzeTimetableFeasibility(problem)` (`feasibility.ts`) — fails closed on mathematical impossibilities (class/teacher/room pool exhaustion, missing/undersized room types, consecutive block unable to fit between breaks, pinned conflicts/excess) before generation.
  2. `createGreedySolver()` (`ts-greedy-v1` in `solver/greedy-solver.ts`) — deterministic constructive + bounded eviction repair (`solve` / yielding `solveAsync`), supporting single-class regeneration (`regenerateClassIds`, `carriedEntries`, `preferredEntries`), emitting fixed-denominator progress (`generation-progress.ts`).
  3. `validateTimetable` (`constraints.ts`) + `validatePersistedSolution` (`feasibility.ts`) — validates hard/soft constraints, exact weekly hours (no gaps, no duplicates), and produces independent per-class checklists via `buildClassTimetableReports` (`class-reports.ts`).
- Manual adjustments use `validateTimetableMove` before persisting.
- **Unresolved Entity-ID Ambiguity:** `model/timetable.ts` documents `TimetableConstraint.entityId` as `class / personnel / room id`, whereas `model/teacher.ts` defines a separate `Teacher` entity wrapping `personnelId`. Verify live DB FKs before altering teacher assignment writes.

---

## 5. Identity Resolution Engine — ER-PMAE (`domain/identity/`)
- **Pipeline (`engine.ts`):**
  1. **Normalize (`normalize.ts`):** Strip diacritics/honorifics into lowercase name tokens; parse composite phone cells into deduplicated national sets (`0XXXXXXXXX`, filtering dummy patterns/`(inconnu)`); rank grade via `GRADE_LEVELS`; compute `observationHash` (FNV-1a idempotency gate).
  2. **Block (`blocking.ts`):** 4 passes (`phone`, sorted `token-pair`, `phonetic`, `initial-surname`), skipping keys with > `50` hits (`ER_BLOCKING_SATURATION_LIMIT`).
  3. **Veto (`vetoes.ts`):** Hard vetoes force `separate` (`0` confidence): `sibling-guardrail` (shared phone, distinct formed given names < `0.4` similarity, `>= 2` grade gap), `demographic-incompatibility`, `same-year-identity-clash` (< `0.2` containment).
  4. **Score & Band (`scoring.ts`, `similarity.ts`):** Deterministic gate (exact canonical/email or shared phone + asymmetric `compareNames >= 0.85`) → `1.0`; else logistic squash of `ER_EVIDENCE_WEIGHTS` → bands (`definite >= 0.92`, `probable >= 0.80`, `review >= 0.60`, else `separate`).
  5. **Clusters & Synthesis (`clustering.ts`, `synthesis.ts`):** `resolveClusters` cuts weakest bridges recursively on `>= 3`-node components whose density `< 0.75`. `synthesizeCanonical` chooses field survivorship (`manual > import` → recency → completeness; phones by `SET_UNION`) with provenance.
- **Execution (`identity/repository.ts`):** Proposes only (`INV-50`); human `decideProposal` approves/rejects (creating active/negative edges) and runs reversible `mergeParents` / `unmergeParents` (`MERGE_EXECUTED` stores full prior row map).

---

## 6. Workflows, Operations, Workforce, Clubs, Therapy, Audit & AI

- **Workflows (`model/workflow.ts`, `kahn.ts`, `calc/workflow/`):**
  - `detectCycle` (Kahn's algorithm) blocks cyclic saves/executions.
  - `evaluateConditionTree` (`condition-evaluator.ts`) handles `and/or/not` + `>/< />=/<=/==/!=`; missing fields resolve to `false` + warning (never throw).
  - `dryRunWorkflow` (`dry-run.ts`) supports `sourceHandle: "true" | "false"` routing (absent = legacy gate), `route_switch`, `time_window`, math explanations, and `{{path}}` template resolution. `autoLayout` snaps DAG layers to a `20px` grid. `WORKFLOW_TEMPLATES` holds 3 valid templates.
- **Workforce & Operations (`model/workforce.ts`, `model/operations-workforce.ts`, `model/operations.ts`, `model/calendar.ts`):**
  - `Shift` = reusable time template; `Schedule` = per-`(tenant, personnel, date)` assignment.
  - `StaffAbsenceRecord` lifecycle: `none → requested → submitted → accepted | rejected` (produced by `recordObservedAbsence`).
  - `Task.assigneeIds` and `TaskRepository.observeByAssignee` key on **`user_profiles.id` (`session.userId`)**, not `Personnel.id`.
  - `ChatChannel.scope` (`internal` vs `portal`) is server-derived.
  - `OnboardingData` uses `workingDays` (`year`, `month`, `days[]` normalized via `normalizeOnboardingData`, defaulting to Algerian Sun–Thu school week).
  - `Operations` manages `Supplier`, `PurchaseRequest`, `Delivery`, `InventoryItem`/`InventoryTransaction`, `PendingReceipt`/`PendingDispatch`.
  - `CalendarEvent` derives `payment_received`, `audit_log`, `expense_event` and persists `follow_up_call`, `reminder`, `meeting`, `custom`, and `exam` (domain `kind: "exam"` persisted as `custom` + `target_entity_type='exam'`).
  - `Expense` lifecycle: `draft → submitted → approved | rejected → disbursed → settled` (mandatory proof + `finalSpentAmount`, optional `responsibleProfileId` distinct from submitter/approver, multi-file `ExpenseAttachment`). `deriveExpenseAnomalySignals` flags `duplicate` (same payee, `±100 DA`, `<= 48h`), `new_vendor`, `budget_overrun` (`>= 3x` category mean with `>= 3` other samples).
- **Clubs & Therapy (`model/club.ts`, `model/therapy.ts`, `calc/clubs/validation.ts`, `calc/therapy/validation.ts`):**
  - Therapy requires mandatory `parentConsent` + `parentConsentDate`, one active follow-up per therapist per student, distinct medical `TherapyAttachment` schema, and RBAC filtering (`canViewPsychologicalFollowUp` / `canViewSpeechTherapyFollowUp`).
  - *Contradiction warning:* Club/Therapy repositories enforce finance isolation, while `calc/ledger/non-tuition-charges.ts` has legacy builders that import `infrastructure/mock/pricing-seed`. Use `PaymentRepository.appendManualCharge` (`REAL_SERVICE_CODES`) for billing instead.
- **Audit, Diff, Backup & AI:**
  - `calc/diff/field-diff.ts` (`computeFieldDiff`, `flattenDiffRows`) & `three-way.ts` (`computeThreeWay`, `resolveThreeWay`) power audit diffs and offline conflict merging.
  - `AuditRepository.observeActivity()` streams attributed realtime `AuditEntry` events.
  - `BackupRepository`: local-only AES-256-GCM (`100,000` PBKDF2 iterations, `12`-byte IV), `365`-day retention, plus `inspectArchive` offline verification.
  - `maskPII` / `unmaskPII` (`pii-mask.ts`): masks in strict order `IBAN → phone → email → NN (10 digits) → parentNames → studentNames`.
  - `DEFAULT_AI_PROVIDER_CONFIG` (`model/ai.ts`): Groq (`openai/gpt-oss-120b` default/reasoning, `openai/gpt-oss-20b` fast/fallback).

---

## 7. Authoritative Repository Contracts Summary

| File | Authoritative Interfaces |
|---|---|
| `repository/repository.ts` | `AuthRepository`, `UserAccountRepository`, `ParentRepository`, `StudentRepository` (incl. `addStudentDocument`/`removeStudentDocument`), `PaymentRepository`, `InstallmentRepository` (`createManualDebt`, `adjustAmountDue`, bulk imports), `DebtRepository` (`observeAging`, `observeThresholds`), `ExpenseRepository`, `PersonnelRepository` (`adjustSalary`, `recordSalaryPayment`), `ReleveRepository` (`recordedById`), `AuditRepository`, `NotificationRepository`, `DashboardRepository`, `PricingRepository`, `LedgerRepository`, `WorkflowRepository`, `WorkflowRunRepository`, `BackupRepository`, `AIConfigRepository`, `LLMAdapter`, `CalendarRepository`, `OverdueAlertGenerator` |
| `repository/academic-repository.ts` | `AcademicYearRepository`, `AcademicLevelRepository`, `PromotionRepository`, `StudentNarrativeRepository`, `ClassPlacementRepository`, `PromotionCycleRepository`, `ReEnrollmentRepository` *(Merge duplicate `ClassRepository`, `SubjectRepository`, `GradeRepository`, `AttendanceRepository` [keep `arrivalTimes`], `HomeworkRepository` with `repository.ts`)* |
| `repository/timetable-repository.ts` | `TimetableRepository` (configuration, rooms, constraints, versions, generation, live-validated moves) |
| `repository/teacher-repository.ts` | `TeacherRepository` (Teacher CRUD & `TeacherSubjectAssignment` only; timetable methods obsolete) |
| `repository/workforce-repository.ts` | `DepartmentRepository`, `ShiftRepository`, `ScheduleRepository`, `TaskRepository`, `AttendanceRepository` (staff clock/absences), `LeaveRequestRepository`, `PerformanceReviewRepository`, `ChatRepository`, `OnboardingRepository` |
| `repository/operations-repository.ts` | `SupplierRepository`, `PurchaseRequestRepository`, `DeliveryRepository`, `InventoryRepository`, `WarehouseTaskRepository` |
| `repository/club-repository.ts` | `ClubRepository` |
| `repository/therapy-repository.ts` | `PsychologyRepository`, `OrthophonieRepository` |
| `repository/dashboard-layout-repository.ts` | `DashboardLayoutRepository` |
| `identity/repository.ts` | `IdentityResolutionRepository` |

---

## 8. Deprecated / Do-Not-Extend Blacklist
Do **not** reference, extend, or reintroduce:
- `model/teacher.ts` (`SchoolDay`, `TimetableEntry`, `TimeSlot`, `Timetable`), `calc/teacher/validation.ts` timetable functions, `TeacherRepository` timetable methods.
- `calc/shared/money-dzd.ts` (unused Dinero.js wrapper).
- `calc/ledger/balance.ts` aliases (`replayParentLedger`, `balanceForAccount`, `totalOutstandingAcrossAccounts`).
- `calc/ledger/non-tuition-charges.ts` fictional club/canteen/uniform/books logic and its `infrastructure/mock/pricing-seed` import.
- `StudentRepository.promote` (use `PromotionCycleRepository` / `PromotionRepository`).
- Fictional discount codes (`passage_palier`, `highest_average`, `seniority_5y`, `sibling_10`, `sibling_15`, `early_bird`) and `10%` early-payment comments.
- Legacy `CityTier`, `AcademicCycleLegacy`, `DEBT_AGING_ACTIVE_PAYER_WINDOW_DAYS`, `database_query`/`extract_field` workflow palette nodes, `Subject` context columns (`level`/`coefficient` where `SubjectConfiguration` applies), and label-parsing for `trancheNumber`.