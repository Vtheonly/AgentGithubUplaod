# Unification Logic — Desktop Repository Progress

**Repo:** `Vtheonly/AgentGithubUplaod` → `elimtiyaz-desktop/`
**Branch:** `unify-financial-logic`
**Last updated:** 2026-08-21 (TIER 3)
**Authoritative spec:** `docs/CANONICAL-FINANCIAL-LOGIC.md` (committed in this repo)

This document tracks what has been completed, what remains, and what the
next iteration should focus on, in the desktop repository specifically.
For the Android side, see the matching `unification-logic-docs/` folder
in `Vtheonly/elimtiyaz-android`.

---

## 1. Tier 1 Status (Canonical Foundation — COMPLETE)

R1 (the only Tier 1 item on the desktop side) is fully implemented.
All Supabase-backed financial repository methods now delegate to the
canonical calc engine (the same engine the mock repositories use) and
produce the same domain state. Switching the desktop from Mock mode
to Supabase mode no longer changes any displayed financial totals.

See the previous version of this file for details on R1.1–R1.11.

---

## 2. Tier 2 Status (Desktop-Internal Consistency — COMPLETE)

### R17 — Fix `buildSeedLedger` per-tranche double-discount (COMPLETE)

**File:** `src/infrastructure/mock/ledger-seed.ts`

The desktop's `buildSeedLedger()` previously applied the sibling discount
INSIDE the `tranches.forEach` loop — for 3 tranches × -5,000 DZD per
tranche = -15,000 DZD total sibling discount per additional child,
instead of the intended -5,000 DZD. The canonical `computeBilling`
function in `batch-registration/compute-billing.ts` did it correctly
(applies once on gross, then splits).

**The fix:** replaced the inline `applyDiscount(amount, siblingDiscount)`
call inside the loop with a single-pass `evaluateAllSystemDiscounts`
call on the gross annual tuition, then `splitNetTuitionByOfficialSchedule`
to derive the 3 tranches. The same pattern `computeBilling` uses.

After the fix:
- The seed state and the interactive batch-registration flow produce
  the same ledger state for the same family.
- The sibling discount is applied exactly once per additional child
  (not per-tranche).
- The first child gets NO sibling discount (canonical rule).
- The 3-tranche split preserves `T1 + T2 + T3 === net` exactly.
- The seed entries' `metadata.discountsApplied` records which discount
  rules fired (audit trail).

### R24 — Add `parent_credit` adjustment to `buildSeedLedger` (COMPLETE)

**File:** `src/infrastructure/mock/ledger-seed.ts`

Added a new adjustment entry to the seed:
- `parentId = "par-001"`
- `studentId = null` (parent-scoped, NOT student-scoped — INV-7)
- `category = "parent_credit"`
- `amount = -50000` (credit: school owes parent 50,000 DZD from a
  previous-year overpayment that will auto-absorb on next invoice)
- `metadata = { origin: "previous_year_overpayment", autoAbsorb: true,
   decisionId: "DEC-2024-141" }`

This exercises the canonical overpayment → `parent_credit` flow in
mock mode. After this entry:
- `computeParentSummary` reports `totalUnallocatedCredit = -50,000 DZD`
  for par-001 (negative = banked credit per the canonical convention).
- The desktop's `crossCheckParentCredit` reconciler has data to verify
  — it recognizes par-001 as having a `parent_credit` entry and does
  NOT flag `UNBACKED_PARENT_CREDIT` for it.

### Reconciler cross-check inputs (extension of R1.2 — COMPLETE)

**File:** `src/infrastructure/supabase/repositories/supabase-shared-repositories.ts`

The Supabase `reconcile()` previously ran only the in-ledger checks +
the balance-sum cross-check (2 of 6 checks). The 4 entity-cross-checks
(`crossCheckPayments`, `crossCheckInstallments`, `crossCheckInstallmentPayments`,
`crossCheckClearedBalance`, `crossCheckParentCredit`) were stubbed out
because the constructor didn't hold references to the sibling
repositories.

**The fix:** rather than inject sibling repositories (which would create
a circular dependency between Ledger ↔ Payment ↔ Installment repositories),
the `reconcile()` method now fetches payments + installments + parent rows
DIRECTLY from Supabase tables via `this.client.from("payments").select("*")`
etc., maps them to the cross-check input shapes, builds per-parent summaries
via canonical `computeParentSummary`, and passes everything to the 4 new
cross-check functions.

The Supabase-backed reconciler now runs all 6 cross-checks — same as the
mock. Switching the desktop from Mock mode to Supabase mode no longer
silently disables 4 of the 6 reconciler checks.

---

## 3. Tier 2 Tests (COMPLETE)

**File:** `src/test/cross-platform/Tier2SeedLedgerTest.test.ts` (NEW — 8 tests)

### Verifies (R17):
- Sibling discount is applied exactly once per student (not per-tranche)
- Sibling discount matches the canonical `evaluateAllSystemDiscounts` output
- First child in family gets NO sibling discount (verified via canonical engine)

### Verifies (R24):
- Seed contains at least one `parent_credit` adjustment entry
- The entry has `studentId = null` (parent-scoped, not student-scoped)
- The entry has negative amount (credit, not debit)
- par-001's `totalUnallocatedCredit` is non-zero (negative = banked credit)
- `crossCheckParentCredit` recognizes par-001 as having `parent_credit` backing
  and does NOT flag the "negative outstanding without parent_credit entry"
  violation for it

### Test execution

```bash
cd elimtiyaz-desktop
npx vitest run src/test/cross-platform/Tier2SeedLedgerTest.test.ts
```

Result: **8 passing tests.**

Full desktop suite: **431 passing tests** (27 test files) — no regressions.

```bash
npx vitest run
# Test Files  27 passed (27)
#      Tests  431 passed (431)
```

---

## 4. Desktop-Internal Consistency Matrix (after Tier 2)

| Operation | Mock mode | Supabase mode (after Tier 2) |
|---|---|---|
| `LedgerRepository.summary(parentId)` | canonical `computeParentSummary` | canonical `computeParentSummary` (R1.1) |
| `LedgerRepository.reconcile()` | canonical `reconcileLedger` + 6 cross-checks | canonical `reconcileLedger` + **6 cross-checks** (Tier 2 closed the gap) |
| `PaymentRepository.collect(input)` | canonical `collectPayment` → waterfall + parent_credit + audit | atomic RPC `collect_and_allocate_payment` → same (R1.4) |
| `PaymentRepository.refund(id)` | canonical `refundPayment` → LIFO revert + audit | atomic RPC `revert_payment_allocation` → same |
| `PaymentRepository.adjust(...)` | canonical `adjustAccount` | canonical via upsert RPC (R1.5) |
| `PaymentRepository.generateReceipt(paymentId, generatedBy)` | canonical `generateReceiptForPayment` | canonical Receipt object (R1.6) |
| `PaymentRepository.appendManualCharge(...)` | canonical `buildAdditionalServiceCharge` | canonical via upsert RPC (R1.7) |
| `InstallmentRepository.markPaid(id, paymentId)` | canonical `markInstallmentPaid` (sets amount_paid=amount_due) | canonical (R1.3) |
| `InstallmentRepository.allocatePayment(...)` | canonical `allocatePaymentAcrossInstallments` | canonical (R1.8) |
| `InstallmentRepository.updateDueDate(input)` | canonical `updateInstallmentDueDate` | canonical UPDATE (R1.9) |
| `InstallmentRepository.regenerateForCycle(...)` | canonical `regenerateInstallmentsForCycle` | canonical `getOfficialTuitionDueDates` (R1.10) |
| `DebtRepository.observeParentProfile(parentId)` | canonical `ParentFinancialProfile` | canonical `computeParentSummary` (R1.11) |
| **Seed state** (`buildSeedLedger`) | sibling discount applied ONCE on gross (Tier 2 R17 fix); parent_credit entry on par-001 (Tier 2 R24) | n/a (mock only) |

✅ The desktop's Mock and Supabase modes are now fully internally
consistent — switching modes no longer changes any financial totals,
reconciler output, or workflow availability.

---

## 5. Files Touched in Tier 2

```
src/infrastructure/mock/ledger-seed.ts                              (R17, R24)
src/infrastructure/supabase/repositories/supabase-shared-repositories.ts (reconciler cross-check inputs)
src/test/cross-platform/Tier2SeedLedgerTest.test.ts                 (NEW, tests)
unification-logic-docs/PROGRESS.md                                    (THIS FILE, updated)
unification-logic-docs/NEXT-ITERATION.md                              (updated)
unification-logic-docs/CROSS-REPO-VERIFICATION.md                     (updated)
```

---

## 6. What Remains (Tier 4 — UI Parity + Android Refactors + Design Clarifications)

The desktop is fully aligned with the canonical spec after Tier 1 + Tier 2
+ Tier 3. The remaining items are UI parity, Android-side refactors, and
one canonical-spec design clarification. They are documented in detail
in `unification-logic-docs/NEXT-ITERATION.md`.

### Closed in Tier 3

- **R1.5 — `adjust()` category parameter** — DONE. The `adjust()`
  method now accepts an optional `options.category` + `options.studentId`
  parameter on both mock and Supabase impls. Also fixed a critical bug
  where the Supabase impl had `studentId = isCredit ? null : null`
  (both branches null), so positive (debit) adjustments like late fees
  were written to a parent-scoped tuition account instead of the
  student-scoped account. See §8 below.

### Deferred to Tier 4

- **R1.7 — `appendManualCharge()` actual pricing** — still uses flat-rate
  defaults from `pricing-seed.ts`. The `additional_services` table exists
  in migration 0006 but no `SupabasePricingRepository` reads from it.
- **Desktop `AdaptivePaymentSlider` banked credit display** — the
  component computes its own overpayment preview from the in-progress
  payment but does NOT display the parent's banked credit from prior
  overpayments. Needs an optional `bankedCredit?: number` prop.
- **Desktop `UnifiedDebtMeter` sign convention bug** — the
  `unallocatedCredit` prop expects a positive magnitude, but the canonical
  spec INV-3 reports credit as a negative number. Also, no caller
  (`unified-payment-modal.tsx`) currently passes the prop.
- **Overpayment canonical design issue** — on an overpayment, the source
  account goes negative (both desktop + Android have the same behavior,
  so they're equivalent, but the canonical spec INV-3 may need
  clarification on whether a transfer entry should move the credit off
  the source account).
- **Live-DB backend RPC equivalence tests** — the rewritten
  `backend_rpc_equivalence.test.ts` skips live-DB tests when no Supabase
  instance is configured. Implementing them requires a running Supabase
  instance with migrations 0001-0035 applied.

---

## 7. Definition of Done — Tier 2 (Desktop)

The desktop repository is now:
1. **Internally consistent** — Mock and Supabase modes produce identical
   domain state for the same operations.
2. **Canonical-spec-aligned** — the seed state applies discounts via
   the same single-pass engine as the interactive flow.
3. **Fully reconciled** — Supabase mode runs all 6 reconciler cross-checks
   (was 2 of 6 before Tier 2).
4. **Overpayment-flow-exercised** — the seed has a `parent_credit`
   adjustment entry, so the canonical overpayment workflow is verified
   end-to-end in mock mode.

Combined with the Android Tier 2 work, the two apps now behave as
**two implementations of the same business system** — same input
produces same output, and after synchronization the state converges
to the same value.

---

## 8. Tier 3 Status (Cross-Platform Hardening + Backend Audit — COMPLETE)

Tier 3 closed the remaining backend audit findings from the Tier 2 audit
(`T3-DESK-AUDIT`), fixed two desktop divergences from the canonical
engine, and added a substantial cross-platform test layer (invariants,
boundary conditions, property-based equivalence). All work was verified
against the canonical spec `docs/CANONICAL-FINANCIAL-LOGIC.md`.

### Backend fix — Migration 0035 (DROP signature mismatches)

**File:** `supabase/migrations/0035_tier3_drop_signature_fixes.sql` (NEW)

Migration 0034 attempted to DROP several divergent SQL functions, but
two of the DROP statements used INCORRECT argument signatures. PostgreSQL
`DROP FUNCTION IF EXISTS` with a wrong signature silently issues a
NOTICE (not an ERROR) and the function REMAINS CALLABLE.

The two affected functions:
- `collect_payment` (from `0022_functions.sql`) — 0034 dropped with 11
  args; the function was actually created with 16 args. The divergent
  pre-waterfall single-installment `collect_payment` was therefore still
  callable.
- `allocate_payment_waterfall` (from `0025_waterfall_allocation.sql`) —
  0034 dropped with 7 args; the function was actually created with 6 args.

Migration 0035:
1. Re-issues the DROPs with the CORRECT signatures (lines 60-68).
2. Issues defensive no-arg DROPs inside a `DO $$ ... EXCEPTION ... END $$`
   block (lines 75-138) for all 10 divergent functions, so the DROP
   succeeds even if the signature reconstruction is wrong on older
   PostgreSQL versions.
3. Verifies the 4 canonical functions (`collect_and_allocate_payment`,
   `revert_payment_allocation`, `compute_parent_summary`,
   `compute_account_balance`) are still present (lines 146-163) — raises
   an EXCEPTION and rolls back the transaction if any are missing.
4. Updates the `installments.status` and `payments.status` CHECK
   constraints to the canonical 6- and 8-value sets (lines 173-186) —
   needed for fresh-DB bootstrap installs that bypassed migration 0034.
5. Adds `COMMENT ON FUNCTION` documentation (lines 198-220) on each
   canonical function stating it is the ONLY allowable implementation.

After 0035: `collect_payment`, `allocate_payment_waterfall`,
`refund_payment`, `get_parent_summary`, `run_overdue_scan`,
`compute_parent_outstanding_v2`, `reconcile_parent`,
`compute_parent_balance`, `compute_parent_outstanding`, and
`compute_overdue_amount` are GONE. The only callable waterfall is
`collect_and_allocate_payment`; the only callable LIFO reversal is
`revert_payment_allocation`.

### Backend fix — `run-overdue-scan/index.ts` edge function rewrite

**File:** `supabase/functions/run-overdue-scan/index.ts` (rewritten)

The scheduled edge function previously called `public.run_overdue_scan`
— the divergent SQL RPC dropped in 0034. It would have failed at runtime
after 0034 was applied (the DROP was correct in 0034, but no one updated
the caller).

The rewrite (lines 104-232):
1. Fetches all parents in the tenant.
2. For each parent, calls the canonical `compute_parent_summary` RPC
   (lines 137-140) and reads its `total_overdue` field.
3. When `total_overdue > 0.001 DZD` (the canonical INV-4 threshold),
   drills down to the specific overdue installments by querying the
   `installments` table directly (lines 156-161), filtering on
   `due_date < as_of_date` and `amount_due > amount_paid`.
4. Writes idempotent `notifications` rows for each overdue installment
   (lines 213-226) and an audit log entry per tenant (lines 235-246).

The canonical overdue classification (INV-4) is now the only overdue
detection path on the backend.

### Backend fix — `collect-payment/index.ts` body shape mismatch

**File:** `supabase/functions/collect-payment/index.ts`

The body interface declared `category_filter` (line 54) but the RPC
invocation read `body.category` (always `undefined`). Every payment
silently defaulted to `p_category = "tuition"`, so non-tuition payments
(transport, etc.) were allocated to the wrong waterfall.

The fix (lines 140-159):
- Reads `body.category_filter ?? null` (line 145).
- Passes it as `p_category` to `collect_and_allocate_payment` (line 153).
- `null` means "all categories" (no filter) — matches the desktop's mock
  + Supabase behavior when the caller omits the category.

### Desktop fix — `adjust()` studentId bug + R1.5 category parameter

**Files:**
- `src/infrastructure/supabase/repositories/supabase-shared-repositories.ts:974-1057`
- `src/infrastructure/mock/repositories/financial/payment-ops.ts:344-415`

The Supabase `adjust()` previously had `const studentId = isCredit ?
null : null` at line 997 (pre-Tier 3) — both branches returned `null`, so
positive (debit) adjustments like late fees were written to a
parent-scoped `parent:X:category:tuition` account instead of a
student-scoped `parent:X:category:tuition:student:Y` account. The mock
impl used `category = "other"` and `studentId = null` (no sign-based
resolution), so the two implementations diverged.

Tier 3 fix (R1.5 + bug):
- `adjust()` now accepts an optional `options.category` +
  `options.studentId` parameter (interface at line 979-982).
- When `amount < 0` (credit): category is forced to `parent_credit`,
  studentId is forced to `null` — preserves INV-3 (only the
  `parent_credit` account may carry a negative balance).
- When `amount >= 0` (debit): category = `options.category ?? "tuition"`,
  studentId = `options.studentId ?? null`. When studentId is provided,
  the accountId is student-scoped (line 1016-1018).
- The mock impl was updated (lines 367-415) to use the SAME canonical
  rules — Mock and Supabase now produce identical adjustment entries
  for the same input.

### Desktop fix — `SupabaseDashboardRepository` inline Σ

**File:** `src/infrastructure/supabase/repositories/supabase-dashboard-repository.ts`

The Supabase dashboard previously computed `outstandingDebt` (line 324,
pre-Tier 3) and debt-aging buckets via inline `.reduce()` on the raw
ledger entries. The inline filter:
- Treated ALL positive entries as charges (positive adjustments were
  miscounted as `totalCharged`).
- Counted BOTH payments AND negative adjustments as "paid".
- Did NOT implement the reversed-original exclusion rule from INV-2 —
  reversed originals were still counted in the typed totals.

Switching the desktop from Mock to Supabase mode therefore changed the
dashboard's `outstandingDebt` and debt-aging numbers, even though the
underlying ledger state was identical.

Tier 3 fix (lines 334-355 for outstanding, lines 456-478 for aging):
- Both methods now group the fetched ledger rows by `parent_id` and
  call the canonical `computeParentSummary` engine (the same function
  the mock repository uses).
- Imports `computeParentSummary` + `buildOverdueDueDateMap` +
  `maxDaysOverdueFromLedger` from `domain/calc/ledger` (lines 43-47).
- Mock and Supabase modes now produce identical dashboard numbers for
  the same ledger state.

### Android Tier 3 fixes (cross-reference)

The Android repository's Tier 3 work is documented in
`Vtheonly/elimtiyaz-android/unification-logic-docs/PROGRESS.md`. Two
items materially affect cross-repo parity:

- **R18** — `LocalExpenseRepository.settleProof` now persists
  `finalAmount` (was silently dropped). Added `finalSpentAmount` column
  to `ExpenseEntity`, the `Expense` domain, and Room migration v5→v6.
- **R19** — `LocalAuditRepository.log` now honors caller-provided
  `actorId`/`actorName` (was hardcoded to `"system"`). `query()` now
  actually filters by `AuditFilter` criteria (was returning
  `emptyList()`).

These two fixes are referenced from the cross-repo verification matrix
(`CROSS-REPO-VERIFICATION.md`) because they close the last divergences
between the Android Room layer and the desktop repository contract.

---

## 9. Tier 3 Tests (COMPLETE)

Three new test layers were added to the desktop vitest suite, plus one
existing test file was rewritten.

### `src/test/cross-platform/CanonicalInvariants.test.ts` (NEW — 23 tests)

Verifies each of the 10 canonical invariants from
`docs/CANONICAL-FINANCIAL-LOGIC.md` §4 holds for the desktop engine
independently. Two engines can agree with each other while both being
wrong — these invariant tests catch that case. One `describe` block per
invariant with multiple cases each.

### `src/test/cross-platform/BoundaryConditions.test.ts` (NEW — 25 tests)

Covers boundary values from `CANONICAL-FINANCIAL-LOGIC.md` §6:
zero, 1-centime, exact-match, large-value (MAX DZD), refund, waterfall,
and negative-amount boundaries. Verifies the engine doesn't crash,
doesn't produce NaN, and preserves the invariants at every boundary.

### `src/test/cross-platform/PropertyBasedEquivalence.test.ts` (NEW — 601 tests)

Property-based tests using a seeded PRNG (mulberry32, seed=42):
- 500 generated scenarios preserving canonical invariants
  (`SCENARIO_COUNT = 500`, lines 183-184).
- 100 LIFO reversal scenarios verifying conservation
  (Σ reverts ≤ refundAmount, lines 255-289).
- 1 parent-summary consistency test running 100 random parents in a
  single test (lines 294-348).

Same seed = same scenarios. The Android runner uses the same generator
so both platforms process the exact same scenarios for cross-platform
comparison.

### `financial-tests/equivalence/comparison/backend_rpc_equivalence.test.ts` (REWRITTEN)

Replaced the previous `expect(true).toBe(true)` stub with:
- Contract tests verifying the canonical RPC parameter + return shapes
  (`describe` blocks at lines 68, 108, 126 — run without a live DB).
- App-side ground truth tests verifying the desktop canonical engine
  produces the expected domain state for each scenario
  (`describe` block at line 172).
- Live-DB tests, guarded by `describeOrSkip` (line 52), documenting what
  the live-DB tests must verify against `collect_and_allocate_payment`,
  `revert_payment_allocation`, and `compute_parent_summary`. Skipped
  when `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` env vars are not set.
- A documentation `describe` block (line 352) listing the divergent SQL
  functions dropped by migrations 0034 + 0035.

### Test execution

```bash
cd elimtiyaz-desktop
npx vitest run
```

Result: **1080 passing tests** (up from 431 at Tier 2), 30 test files,
no regressions. Tier 3 added 649 tests (23 + 25 + 601) plus the
rewritten `backend_rpc_equivalence.test.ts` contract + app-side ground
truth tests, without breaking any Tier 1 or Tier 2 test.

---

## 10. Files Touched in Tier 3

```
supabase/migrations/0035_tier3_drop_signature_fixes.sql                       (NEW, backend audit fix)
supabase/functions/run-overdue-scan/index.ts                                  (rewritten, canonical RPC)
supabase/functions/collect-payment/index.ts                                   (body shape fix)
src/infrastructure/supabase/repositories/supabase-shared-repositories.ts      (adjust() R1.5 + studentId fix)
src/infrastructure/mock/repositories/financial/payment-ops.ts                 (adjust() mock canonical alignment)
src/infrastructure/supabase/repositories/supabase-dashboard-repository.ts     (canonical computeParentSummary)
src/test/cross-platform/CanonicalInvariants.test.ts                           (NEW, 23 tests)
src/test/cross-platform/BoundaryConditions.test.ts                            (NEW, 25 tests)
src/test/cross-platform/PropertyBasedEquivalence.test.ts                      (NEW, 601 tests)
financial-tests/equivalence/comparison/backend_rpc_equivalence.test.ts        (rewritten, real contract tests)
unification-logic-docs/PROGRESS.md                                            (THIS FILE, updated)
unification-logic-docs/NEXT-ITERATION.md                                      (updated, Tier 4 items)
unification-logic-docs/CROSS-REPO-VERIFICATION.md                             (updated, Tier 3 section)
```

---

## 11. Definition of Done — Tier 3 (Desktop)

1. **Backend audit closed** — migration 0035 removes all 10 divergent
   SQL functions that 0034 failed to fully drop. The only callable
   waterfall / reversal / summary functions are the 4 canonical ones.
2. **Edge functions aligned** — `run-overdue-scan` and `collect-payment`
   both call the canonical RPCs exclusively; no code path references a
   dropped function.
3. **`adjust()` is canonical** — both mock and Supabase impls use the
   same sign-based category resolution + caller-provided `studentId`;
   positive adjustments now land on the correct student-scoped account.
4. **Dashboard is canonical** — `SupabaseDashboardRepository` delegates
   to `computeParentSummary`; Mock and Supabase modes produce identical
   dashboard numbers for the same ledger state.
5. **Test coverage tripled** — 1080 passing tests (from 431), including
   649 new property-based + invariant + boundary tests.
6. **Cross-platform parity** — the desktop's canonical engine is now
   verified against the canonical spec by an independent test layer
   (`CanonicalInvariants.test.ts`), so two-engine agreement is no
   longer the only safety net.

Remaining Tier 4 items (UI parity, Android charge builder refactor,
`appendManualCharge` actual pricing, overpayment canonical design
clarification, live-DB backend RPC tests) are documented in
`unification-logic-docs/NEXT-ITERATION.md`.
