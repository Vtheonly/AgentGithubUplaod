# Next Iteration Roadmap — Desktop

**Goal:** Close the remaining divergences (Tier 2 + Tier 3) so the
desktop repository is fully aligned with the canonical spec and the
Supabase-backed repositories produce byte-for-byte equivalent state to
the mock repositories.

**Priority order** is by impact on cross-app consistency. Items marked
🔴 block desktop-internal consistency. Items marked 🟡 close more of
the divergence surface. Items marked 🟢 are polish / future-proofing.

---

## Tier 2 — Desktop-Internal Consistency (next iteration, ~1 session)

### 🔴 R17 — Fix `buildSeedLedger` per-tranche double-discount (D32)

**Why:** The desktop's `mock/ledger-seed.ts:buildSeedLedger` STILL
applies the sibling discount PER TRANCHE. For 3 tranches × -5,000 DZD
per tranche = -15,000 DZD total sibling discount, instead of the
intended -5,000 DZD. The canonical `computeBilling` function in
`batch-registration/compute-billing.ts` does it correctly (applies
once on gross, then splits).

This is a desktop-internal inconsistency: the mock seed state has 3×
the intended sibling discount, but the interactive batch-registration
flow produces the correct discount. The two paths produce different
ledger state for the same family.

**Where:** `src/infrastructure/mock/ledger-seed.ts:104-109`
**How:**
1. Move the `applyDiscount(amount, siblingDiscount)` call OUT of the
   `tranches.forEach` loop.
2. Apply it ONCE on the gross annual tuition BEFORE splitting.
3. Then split the net via `splitNetTuitionByOfficialSchedule`.
4. Mirror the pattern in `compute-billing.ts:58-92`.

### 🟡 Reconciler cross-check inputs (extension of R1.2)

**Why:** The Supabase `reconcile()` now runs the in-ledger checks +
balance-sum cross-check inline, but the 4 entity-cross-checks (payments,
installments, clearedBalance, parentCredit) require external inputs
from sibling repositories that aren't currently injected into the
`SupabaseLedgerRepository` constructor.

**Where:** `src/infrastructure/supabase/repositories/supabase-shared-repositories.ts`
**How:**
1. Inject `SupabasePaymentRepository` + `SupabaseInstallmentRepository` +
   `SupabaseParentRepository` into the `SupabaseLedgerRepository`
   constructor. (Use a factory pattern or lazy injection to break the
   circular dependency — Ledger ↔ Payment ↔ Installment.)
2. Update `reconcile()` to fetch payments + installments + parent list
   and pass them as cross-check inputs.
3. Mirror the mock's `ledger-repository.ts:119-201` pattern.

### 🟡 R24 — Add `parent_credit` adjustments to `buildSeedLedger`

**Why:** The canonical overpayment → `parent_credit` flow is never
exercised in mock mode. Adding a `parent_credit` adjustment to a seed
family would let developers verify the overpayment workflow end-to-end
without needing to perform an actual overpayment.

**Where:** `src/infrastructure/mock/ledger-seed.ts`
**How:** Add a third adjustment entry: e.g., a parent_credit of
-50,000 on `parent:par-001:category:parent_credit` representing an
overpayment from the previous year. Then the `crossCheckParentCredit`
reconciler cross-check would have data to verify.

### 🟢 R1.5 — `adjust()` category parameter

The current `adjust()` auto-resolves the category based on the sign of
the amount: negative → `parent_credit`, positive → `tuition`. A future
iteration can add an optional `category?: PaymentCategory` parameter
to the `adjust` signature (with the auto-resolve as the fallback when
the caller omits it). This lets callers apply a positive adjustment
to a non-tuition category (e.g., a canteen surcharge).

**Where:** `src/domain/repository/repository.ts` (interface) +
`src/infrastructure/supabase/repositories/supabase-shared-repositories.ts`
(impl) + `src/infrastructure/mock/repositories/financial/payment-ops.ts`
(mock impl).

### 🟢 R1.7 — `appendManualCharge()` actual pricing

The current `appendManualCharge()` uses the canonical
`buildAdditionalServiceCharge` factory, which has flat-rate defaults
for each service. A future iteration can pull the actual amount from
the `pricing_config` table so admin-configured prices are respected.

**Where:** `src/infrastructure/supabase/repositories/supabase-shared-repositories.ts`
**How:** Fetch the pricing config via `SupabasePricingRepository` (or
similar), pass it to `buildAdditionalServiceCharge`.

---

## Tier 3 — UI Parity (lower priority)

The desktop already has the canonical UI components
(`AdaptivePaymentSlider`, `UnifiedDebtMeter`). The Tier 3 work for the
desktop is mostly about ensuring those components remain in sync with
the canonical spec as it evolves. See the Android repo's
`unification-logic-docs/NEXT-ITERATION.md` for the cross-reference.

### 🟢 Verify `AdaptivePaymentSlider` uses `unallocatedCredit` correctly
After R3 (Android side) added `unallocatedCredit` to the canonical
engine, verify the desktop's `AdaptivePaymentSlider` displays it in
all 3 modes (`single_item`, `installment_tranche`, `consolidated_debt`).
The component already supports it but a regression test would be valuable.

### 🟢 Verify `UnifiedDebtMeter` displays `totalUnallocatedCredit`
The `UnifiedDebtMeter` component already has the credit row, but it
reads from the canonical `ParentLedgerSummary.totalUnallocatedCredit`.
After R1's desktop Supabase fixes, verify the Supabase-backed debt
meter shows the correct credit value (not 0).

---

## Sequencing

The recommended order for the next iteration:

1. **R17** (buildSeedLedger double-discount) — most impactful desktop-
   internal fix. Closes the per-tranche sibling-discount bug.
2. **Reconciler cross-check inputs** — completes the Supabase-side
   reconciliation (closes the gap between the mock's 6 cross-checks
   and the Supabase's 2 cross-checks).
3. **R24** (parent_credit in seedLedger) — exercises the canonical
   overpayment flow in mock mode.
4. **R1.5 + R1.7** (adjust category + appendManualCharge pricing) —
   polish / future-proofing.
5. **UI parity verification** — regression tests for the desktop UI.

Items R22 + R23 (AdaptivePaymentSlider + UnifiedDebtMeter) are Android-
side ports; the desktop already has them.
