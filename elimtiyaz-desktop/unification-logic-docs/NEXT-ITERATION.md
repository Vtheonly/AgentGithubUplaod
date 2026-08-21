# Next Iteration Roadmap — Desktop

**Last updated:** 2026-08-21 (TIER 3)

**Goal:** Close the remaining Tier 4 items. The desktop is now fully
aligned with the canonical spec after Tier 1 + Tier 2 + Tier 3 — these
items are UI parity, Android-side refactors, and design clarifications.

**Priority order** is by impact. Items marked 🟢 are polish /
future-proofing. Items marked "Design clarification" require a
canonical-spec decision (or an infrastructure decision) before they
can be implemented.

---

## Tier 4 — UI Parity + Android Refactors + Design Clarifications

### 🟢 R9 — Android charge builders (refactor)

The Android repository currently builds charge entries inline. The
desktop has named factories in `src/domain/calc/ledger/charges.ts` +
`non-tuition-charges.ts`. This is a refactor — it does NOT affect
business semantics (Android's inline builders already produce canonical
entries). Once ported, both apps produce charge entries via the same
factory pattern, reducing the surface area for future divergence.

**Where:** Android repo — `app/src/main/java/com/example/core/financial/ledger/`

### 🟢 R13 — Android `Payment.expectedAmount/excessAmount/excessRemark`

Display fields used by the `AdaptivePaymentSlider` to surface
"expected X DZD, paid Y DZD, excess Z DZD (remark: ...)" to the user.
The desktop has these on its `Payment` domain model; Android is
missing them. Once added, the Android `AdaptivePaymentSlider` (R22)
can display the same breakdown the desktop does.

**Where:** Android repo — `app/src/main/java/com/example/core/domain/model/Payment.kt`

### 🟢 R22 — Android `AdaptivePaymentSlider` (3-mode UI component)

~397-line React component on the desktop
(`src/features/financials/payment-slider.tsx`) supporting 3 modes
(`single_item`, `installment_tranche`, `consolidated_debt`). The
Android counterpart is a basic slider. Porting the 3-mode logic + the
overpayment preview banner is a UI task — no canonical engine change
required.

**Where:** Android repo — `app/src/main/java/com/example/ui/financial/`

### 🟢 R23 — Android `UnifiedDebtMeter` (UI component)

Desktop component (`src/features/financials/debt-meter.tsx`) showing
outstanding / overdue / unallocatedCredit in a single meter. Android
has no equivalent. Porting is a UI task.

**Where:** Android repo — `app/src/main/java/com/example/ui/financial/`

### 🟢 Desktop `AdaptivePaymentSlider` — banked credit display

The desktop's `AdaptivePaymentSlider` computes its own `overpayment`
preview from the in-progress payment (line 176) but does NOT display
the parent's banked credit from prior overpayments. The component
needs an optional `bankedCredit?: number` prop (defaulting to 0) that,
when > 0, displays a banner like "Crédit parent disponible: X DZD —
sera absorbé automatiquement".

**Where:** `src/features/financials/payment-slider.tsx`
**Test:** new file `src/tests/features/financials/AdaptivePaymentSlider.test.tsx`
(covering all 3 modes + the new banked-credit banner)

### Design clarification — Desktop `UnifiedDebtMeter` sign convention bug + caller wiring

The `unallocatedCredit` prop is declared at line 48 of
`src/features/financials/debt-meter.tsx` with the comment "Positive
numbers represent the magnitude (e.g. 5000 = 5,000 DA credit)" and
the render check is `unallocatedCredit > 0`. The canonical spec INV-3
says `unallocatedCredit` is reported as a NEGATIVE number. If a caller
passes the canonical value (-50,000), the row would NOT render.

Two options:
1. Change the prop to accept the canonical negative value and use
   `Math.abs()` in the render.
2. Keep the prop positive and document the `abs()` conversion at the
   call site (`unified-payment-modal.tsx`).

Additionally: `src/features/financials/unified-payment-modal.tsx`
(lines ~686-698) invokes `<DebtMeter />` WITHOUT passing
`unallocatedCredit` — the prop is never supplied by any caller. The
fix needs to fetch `summary.totalUnallocatedCredit` via
`repos.ledger.summary(parentId)` (which already calls
`computeParentSummary`) and pass it to `<DebtMeter>`.

**Where:** `src/features/financials/debt-meter.tsx` +
`src/features/financials/unified-payment-modal.tsx`
**Test:** new file `src/tests/features/financials/UnifiedDebtMeter.test.tsx`
(credit row renders when prop > 0, sign convention, caller wiring)

### 🟢 Desktop R1.7 — `appendManualCharge()` actual pricing

The current `appendManualCharge()` uses the canonical
`buildAdditionalServiceCharge` factory, which reads flat-rate defaults
from `src/infrastructure/mock/pricing-seed.ts` (canteen_term=12,000 /
uniform=8,500 / books=6,500 / second_apron=2,000 DZD). The
`additional_services` table exists in migration 0006 (lines 104-115)
but no `SupabasePricingRepository` reads from it. A future iteration
should:

1. Create `SupabasePricingRepository` that fetches the active
   `pricing_config_id` then the `additional_services` rows.
2. Refactor `buildAdditionalServiceCharge` to accept a `PricingConfig`
   parameter (or have the repository map the table rows to the
   `PricingConfig` shape).
3. Both mock and Supabase impls pass their respective configs.

**Where:**
- `src/infrastructure/supabase/repositories/` (new `SupabasePricingRepository`)
- `src/domain/calc/ledger/non-tuition-charges.ts:163-208` (factory signature)
- `src/infrastructure/supabase/repositories/supabase-shared-repositories.ts:1067-1125` (caller — currently uses mock defaults)
- `supabase/migrations/0006_pricing.sql:104-115` (source table — already exists)

### Design clarification — Overpayment canonical design issue (source account goes negative)

On an overpayment, the canonical workflow writes the FULL payment
amount (-input.amount) on the source category account (e.g. tuition)
AND a separate adjustment (-unallocated) on `parent_credit`. Result:
the source account ends up with a NEGATIVE balance equal to the
overpayment, while the `parent_credit` account also has a negative
balance equal to the overpayment.

Both desktop and Android have the SAME behavior, so they are
EQUIVALENT — but the canonical spec INV-3 says "A negative balance on
any other account is a reconciler violation (`UNBACKED_PARENT_CREDIT`)".
The current behavior triggers this violation on every overpayment.

**Open question for the canonical-spec maintainer:** should the
overpayment be moved off the source account via a `transfer` entry
(after the waterfall detects `unallocatedAmount > 0`)? Or is the
source account's negative balance considered "expected" because the
payment entry pre-dates the overpayment detection?

If a fix is approved, it would affect:
- Mock: `src/infrastructure/mock/repositories/financial/payment-ops.ts:92, :139`
- Supabase RPC: `supabase/migrations/0026_unified_financial.sql:162, :223`
- Test: `src/test/cross-platform/ScenarioRunner.test.ts:197-216` currently
  asserts the double-counted behavior — would need to be updated.

### 🟢 Live-DB backend RPC equivalence tests

`financial-tests/equivalence/comparison/backend_rpc_equivalence.test.ts`
was rewritten in Tier 3 to add real contract tests + app-side ground
truth tests. The live-DB tests are SKIPPED when `SUPABASE_URL` +
`SUPABASE_SERVICE_ROLE_KEY` env vars are not set. Implementing them
requires:

1. A running Supabase instance with migrations 0001-0035 applied
   (0035 fixes the DROP signature mismatches that left divergent SQL
   functions callable).
2. A scenario setup helper that inserts a parent + student +
   installments + ledger entries, then invokes the canonical RPC and
   compares the DB state to the app-side expected state at
   centime-level precision.
3. CI integration so the live-DB tests run on every PR (not just
   locally).

**Where:** `financial-tests/equivalence/comparison/backend_rpc_equivalence.test.ts`
(currently the live-DB `describe` blocks at lines 172, 338 are guarded
by `describeOrSkip` and stubbed with `if (!client) return;`).

---

## Sequencing

The recommended order for Tier 4:

1. **Canonical-spec clarification on overpayment** — needs a decision
   before the implementation can proceed. Blocks the overpayment fix.
2. **Desktop UI parity** — `AdaptivePaymentSlider` `bankedCredit`
   prop + `UnifiedDebtMeter` sign convention + caller wiring. Small
   UI changes, can be done in one PR.
3. **Android UI parity** — R22 (`AdaptivePaymentSlider`) + R23
   (`UnifiedDebtMeter`). Depends on R13 (display fields).
4. **R1.7 pricing config** — backend repository + canonical factory
   refactor.
5. **R9 Android charge builder refactor** — pure refactor, no
   semantic change.
6. **Live-DB backend RPC tests** — requires CI infrastructure.

Tier 4 is non-blocking. The desktop is production-ready after Tier 3.
