# Next Iteration Roadmap — Desktop

**Goal:** Close the remaining Tier 3 polish items. The desktop is now
fully aligned with the canonical spec after Tier 1 + Tier 2 — these
items are future-proofing and UI regression tests.

**Priority order** is by impact. Items marked 🟢 are polish /
future-proofing.

---

## Tier 3 — Polish + Future-Proofing (next iteration, ~1 session)

### 🟢 R1.5 — `adjust()` category parameter
The current `adjust()` auto-resolves the category based on the sign of
the amount: negative → `parent_credit`, positive → `tuition`. A future
iteration can add an optional `category?: PaymentCategory` parameter
to the `adjust` signature (with the auto-resolve as the fallback when
the caller omits it). This lets callers apply a positive adjustment
to a non-tuition category (e.g., a canteen surcharge).

**Where:**
- `src/domain/repository/repository.ts` (interface)
- `src/infrastructure/supabase/repositories/supabase-shared-repositories.ts` (impl)
- `src/infrastructure/mock/repositories/financial/payment-ops.ts` (mock impl)

### 🟢 R1.7 — `appendManualCharge()` actual pricing
The current `appendManualCharge()` uses the canonical
`buildAdditionalServiceCharge` factory, which has flat-rate defaults
for each service. A future iteration can pull the actual amount from
the `pricing_config` table so admin-configured prices are respected.

**Where:** `src/infrastructure/supabase/repositories/supabase-shared-repositories.ts`
**How:** Fetch the pricing config via `SupabasePricingRepository` (or
similar), pass it to `buildAdditionalServiceCharge`.

### 🟢 Verify `AdaptivePaymentSlider` uses `unallocatedCredit` correctly
After Tier 2 R3 (Android side) added `unallocatedCredit` to the canonical
engine, verify the desktop's `AdaptivePaymentSlider` displays it in
all 3 modes (`single_item`, `installment_tranche`, `consolidated_debt`).
The component already supports it but a regression test would be valuable.

**Where:** New test file `src/tests/features/financials/AdaptivePaymentSlider.test.tsx`

### 🟢 Verify `UnifiedDebtMeter` displays `totalUnallocatedCredit`
After Tier 2 R24 added a `parent_credit` seed entry to par-001, verify
the desktop's debt meter shows the correct credit value (not 0) in
mock mode.

**Where:** New test file `src/tests/features/financials/UnifiedDebtMeter.test.tsx`

### 🟢 Sync charge builders to Android
Cross-reference: the Android repo's NEXT-ITERATION.md item R9 / R20
covers porting the desktop's named charge builders to Android. The
desktop's `domain/calc/ledger/charges.ts` + `non-tuition-charges.ts`
are the canonical source — once Android ports them, both apps will
produce identical charge entries via the same factory pattern.

---

## Sequencing

The recommended order for Tier 3:

1. **R1.5 + R1.7** (adjust category + appendManualCharge pricing) — small
   interface additions, can be done in one PR.
2. **UI regression tests** (AdaptivePaymentSlider + UnifiedDebtMeter) —
   prevent future regressions when the underlying data shape changes.
3. **Cross-reference Android R9/R20** — once Android ports the charge
   builders, add a cross-platform test that runs the same charge
   construction through both apps' factories and asserts identical
   output.

Tier 3 is non-blocking. The desktop is production-ready after Tier 2.
