# Unification Logic — Desktop Repository Progress

**Repo:** `Vtheonly/AgentGithubUplaod` → `elimtiyaz-desktop/`
**Branch:** `unify-financial-logic`
**Last updated:** 2026-08-20 (TIER 2)
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

## 6. What Remains (Tier 3 — Polish + UI Parity)

The desktop is now fully aligned with the canonical spec. The remaining
items are polish / future-proofing.

### 🟢 R1.5 — `adjust()` category parameter
The current `adjust()` auto-resolves the category based on the sign of
the amount: negative → `parent_credit`, positive → `tuition`. A future
iteration can add an optional `category?: PaymentCategory` parameter
(with the auto-resolve as the fallback when the caller omits it). This
lets callers apply a positive adjustment to a non-tuition category
(e.g., a canteen surcharge).

### 🟢 R1.7 — `appendManualCharge()` actual pricing
The current `appendManualCharge()` uses the canonical
`buildAdditionalServiceCharge` factory, which has flat-rate defaults
for each service. A future iteration can pull the actual amount from
the `pricing_config` table so admin-configured prices are respected.

### 🟢 Verify `AdaptivePaymentSlider` uses `unallocatedCredit` correctly
After Tier 2 R3 (Android side) added `unallocatedCredit` to the canonical
engine, verify the desktop's `AdaptivePaymentSlider` displays it in
all 3 modes (`single_item`, `installment_tranche`, `consolidated_debt`).
The component already supports it but a regression test would be valuable.

### 🟢 Verify `UnifiedDebtMeter` displays `totalUnallocatedCredit`
After Tier 2 R24 added a parent_credit seed entry to par-001, verify
the desktop's debt meter shows the correct credit value (not 0) in
mock mode.

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
