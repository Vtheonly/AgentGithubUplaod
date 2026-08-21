# El-Imtiyaz — Desktop vs Android Financial Logic Comparison

**Investigator:** Super Z (code-level audit)
**Date:** 2026-08-19
**Repos audited:**
- Desktop: `https://github.com/Vtheonly/AgentGithubUplaod` → `elimtiyaz-desktop/` (TypeScript + React + Electron)
- Android: `https://github.com/Vtheonly/elimtiyaz-android` (Kotlin + Jetpack Compose + Room)

**Shared canonical contract:** `elimtiyaz-desktop/supabase/migrations/0026_unified_financial.sql` + `0027_shared_unification.sql` + `0028_shared_schema_extensions.sql`.

---

## TL;DR — Verdict

**No — the two applications do NOT produce the same financial state for the same operations.** The Android app is **one full architectural iteration behind the Desktop app**. The Desktop went through a "Unified Financial Architecture" refactor (Epic 1–8 in `docs/development/financial-refactor.md`) that added:

- 4 new `PaymentCategory` values (`parent_credit`, `therapy_psychology`, `therapy_speech`, `second_apron`)
- 2 new `PaymentStatus` values (`pending_clearance`, `unpaid`)
- A `parent_credit` overpayment accounting flow with its own account
- A pending-vs-cleared dual-bucket waterfall (`amountPending` separate from `amountPaid`)
- A 5-rule single-pass discount engine (`passage_palier`, `sibling_fixed`, `full_annual`, `highest_average`, `seniority_5y`)
- A LIFO reversal flow that branches on `originalWasPending`
- 3 new reconciliation cross-checks (`UNBACKED_TRANCHE_SATISFACTION`, `PAYMENT_LEDGER_MISMATCH`, `UNBACKED_PARENT_CREDIT`)
- An `unallocatedCredit` / `totalUnallocatedCredit` balance rollup

The Android app implements the **prerefactor** logic. It does not expose most of the new fields in its domain layer, never produces the new categories/statuses, cannot parse them when received from Supabase, applies the wrong category when recording an overpayment credit, and skips 4 of the 5 official discount rules entirely.

Below is the area-by-area evidence. File paths and line numbers are given for every claim so each finding can be verified.

---

## 1. What the two apps are *supposed* to do (per the shared spec)

Per `docs/project-specification/07-financial-engine.md` and the SQL migration `0026_unified_financial.sql`, both apps are mandated to:

1. Accept **only three payment methods** — cash, check, transfer. Non-cash starts in `PENDING`, becomes `PAID` only after bank clearance.
2. Bill tuition + transport as **3 tranches** (Sept 15 / Dec 15 / Mar 15) OR as **1 full-annual** payment (eligible for a 10% early-annual discount if paid before June 30).
3. Split net tuition 40% / 30% / 30% across the 3 tranches.
4. Apply **5 canonical discount rules** in a single pass: `passage_palier` (−10,000 DZD), `sibling_fixed` (−5,000 DZD per additional child), `full_annual` (−10% before June 30), `highest_average` (−10% for rank 1), `seniority_5y` (−5% for 5+ years).
5. Allocate every collected payment across the family's outstanding tranches via a **chronological waterfall** (oldest first).
6. For uncleared (pending) payments, increment `amountPending` — **never mark a tranche `paid` from uncleared funds**.
7. On overpayment, write a `parent_credit` adjustment on a **parent-scoped `parent_credit` account** (`parent:{id}:category:parent_credit`, `studentId = null`), so future charges auto-absorb it.
8. On refund, run a **LIFO reverse-waterfall** that branches on `originalWasPending` — subtract from `amountPending` for uncleared reversals, from `amountPaid` for cleared ones — and re-evaluate tranche status.
9. Compute balances **only by replaying the ledger** — never store balances.
10. Reconcile the ledger against the payments/installments/balances with the full check suite.

The Desktop implementation follows all 10 points. The Android implementation follows points 1, 3, 5, 9 partially and **diverges** on points 2, 4, 6, 7, 8, 10.

---

## 2. Discrepancy Matrix

| # | Area | Desktop | Android | Impact |
|---|------|---------|---------|--------|
| D1 | `PaymentCategory` enum | 11 values (incl. `parent_credit`, `therapy_psychology`, `therapy_speech`, `second_apron`) | 7 values — **missing 4** | Sync crashes when Android pulls a desktop-originated `parent_credit` / `therapy_*` / `second_apron` row |
| D2 | `PaymentStatus` enum | 8 values (incl. `pending_clearance`, `unpaid`) | 6 values — **missing 2** | Sync crashes when Android pulls a `pending_clearance` or `unpaid` row |
| D3 | Overpayment credit account/category | `parent_credit` category on `parent:{id}:category:parent_credit` (studentId = null) | Same `input.category` (e.g. `tuition`) on `parent:{id}:category:tuition:student:{sid}` | Desktop's `unallocatedCredit` rollup returns 0 for Android-originated credits; desktop reconciler flags `UNBACKED_PARENT_CREDIT` |
| D4 | Refund LIFO branch | `originalWasPending = (originalLedgerEntry.paymentStatus === "pending")` | `originalWasPending = false` (hardcoded default) | Refunding an uncleared check/transfer tries to subtract from `amountPaid` (= 0) — revert is a silent no-op, `amountPending` stays inflated |
| D5 | Discount engine | 5-rule `evaluateAllSystemDiscounts` master + 5 individual evaluators + `sumDiscounts` | Only `computeSiblingDiscount` + `computeTuitionTotal` — **4 of 5 rules missing** | A student who transitioned paliers, paid early-annual, was rank 1, or has 5+ years seniority gets a different (higher) net tuition on Android |
| D6 | Charge builders | `buildTuitionChargeEntries` (full_annual vs tranches), `buildTransportChargeEntriesForDestination`, `buildClubEnrollmentCharge`, `buildTherapyCharge`, `buildAdditionalServiceCharge` | None of these exist — Android only has the bare `createChargeEntry` factory + an inline seeder | Android cannot generate a 1-entry full-annual schedule; cannot emit `extracurricular` / `therapy_psychology` / `therapy_speech` / `second_apron` charges |
| D7 | Reconciler cross-checks | 6 cross-checks (3 unified-architecture additions) | 3 cross-checks (the original 3 only) | Android cannot detect `UNBACKED_TRANCHE_SATISFACTION` (pending check wrongly marked tranche `paid`), `PAYMENT_LEDGER_MISMATCH`, or `UNBACKED_PARENT_CREDIT` |
| D8 | `AccountBalance` / `ParentLedgerSummary` | Carries `unallocatedCredit` and `totalUnallocatedCredit` | Neither field exists | Android can never tell the UI "this parent has X DZD of advance credit to auto-apply" |
| D9 | Refund entry factory | `createRefundEntry` → `method = null`, `paymentStatus = null`, `sourceType = "refund"` | `createRefundEntry` → `method = parameter`, `paymentStatus = REFUNDED`, `sourceType = REFUND` | Same logical operation produces ledger rows with **different field values** — breaks desktop's `crossCheckPayments` status comparison |
| D10 | Adjustment entry factory | Accepts `sourceType` parameter; never accepts `receiptRef` | Hardcodes `sourceType = ADJUSTMENT`; accepts `receiptRef` → stored as `receiptNumber` | Desktop adjustment entries can carry `sourceType = "manual_entry"` or `"bulk_import"`; Android-originated ones always say `adjustment`. ReceiptRef lost on desktop |
| D11 | `LedgerEntryEntity` (Room) | `metadata` JSONB column persisted (e.g. `tranche: 1`, `paymentPlan`, `clubCategory`) | **No `metadata` column at all** → `LedgerEntryEntity.toDomain()` hardcodes `metadata = emptyMap()` | Every desktop-originated metadata field is dropped on Android; future audit / debug / schedule-regen workflows cannot use it |
| D12 | `Student` domain | Has `paymentPlan` field (`full_annual` / `tranches`) | **No `paymentPlan` field** — neither domain nor Room entity | Android cannot represent or apply the 10% early-annual discount |
| D13 | `Payment` domain | Has `expectedAmount`, `excessAmount`, `excessRemark` | None of these fields — domain, Room entity, and DTO all omit them | Android cannot display or persist overpayment breakdown |
| D14 | `Installment` domain | Has `amountPending`, `paymentPlan`, `isCustomSchedule` | Only `amountPaid` — `amountPending` exists in the Room entity but is **dropped** by `InstallmentEntity.toDomain()` | Domain layer can never read `amountPending`; UI shows `0` even when a pending check is sitting on the tranche |
| D15 | `ParentEntity` (Room) | Migration 0028 adds `transport_destination` + `city_tier` | Has `transportDestination`; **missing `cityTier`** | `upsert_parent_from_import(p_transport_destination, p_city_tier)` → Android pushes `city_tier = null` |
| D16 | `PaymentCategory.fromCode` / `PaymentStatus.fromCode` behavior | Tolerant — accepts any string the DB constraint allows (incl. new ones) | **Throws `IllegalArgumentException` on unknown code** | Pull sync crashes when Android encounters `parent_credit`, `pending_clearance`, `unpaid`, etc. |
| D17 | Amount precision | Domain uses JS `number` (Double); SQL column is `NUMERIC(12,2)` (decimal) | Domain uses `Long` (centimes); DTO uses `Double` (DZD); conversion `(amount * 100).toLong()` is **lossy** | A payment of `100.005 DZD` becomes `10000` centimes on Android but `100.01` DZD on desktop — sub-centime drift |
| D18 | Pull sync | `pull_*_for_sync` for parents, students, payments, ledger entries, device tokens | Pulls only parents + students — **does NOT pull payments or ledger entries** | Even if Android could parse the new fields, it never receives payment/ledger updates originating on Desktop |

---

## 3. Area-by-area evidence

### 3.1 Ledger & balance computation

**Equivalent:**
- Account ID derivation: `deriveAccountId(parentId, category, studentId)` returns `parent:{parentId}:category:{category}[:student:{studentId}]` — identical strings on both sides. (`core/LedgerEntryFactory.kt:21-25` vs `domain/calc/ledger/account-id.ts:23-32`.)
- `computeAccountBalance` core replay loop: filter by accountId + `at ≤ now`, sort by `(timestamp, id)`, sum amounts, exclude reversed entries from typed totals but include them in `balance`. (`core/LedgerEngine.kt:38-95` vs `domain/calc/ledger/balance.ts:39-125`.)
- `computeParentSummary` aggregates per-account balances and applies the overdue rule (balance > threshold AND latest charge past due). (`core/LedgerEngine.kt:98-142` vs `domain/calc/ledger/balance.ts:141-205`.)

**Divergent:**
- **Desktop adds `unallocatedCredit` rollup** that sums `adjustment` entries with `category === "parent_credit"` (`balance.ts:84-91`). Android's `AccountBalance` data class has no such field (`core/AccountBalance.kt:1-9`), so Android silently lumps parent_credit adjustments into `totalAdjusted`.
- **Overdue threshold:** Desktop uses `balance > 0.001` DZD; Android uses `balance > 100L` centimes (1 DZD). Minor but means an account with 0.5 DZD outstanding is flagged overdue on Desktop, ignored on Android.

### 3.2 Payment tracking

**Equivalent:**
- The waterfall allocator function signature + algorithm is byte-for-byte equivalent on both sides: chronological sort, fill oldest unpaid tranche first, branch on `paymentStatus === "paid"` vs `"pending"`. (`core/WaterfallAllocation.kt:38-108` vs `domain/calc/payment/waterfall-allocator.ts:33-91`.)

**Divergent:**
- Android's `PaymentCategory` enum does not include `parent_credit` (`core/Ledger.kt:51-55`), so when Android's `LocalPaymentRepository.collect` writes the overpayment credit, it uses **`input.category`** (e.g. `tuition`) instead of `parent_credit`:
  ```kotlin
  // LocalRepositories.kt:594-602
  if (allocation.unallocatedAmount > 0L) {
      val creditEntry = com.example.core.createAdjustmentEntry(
          tenantId = entity.tenantId, parentId = input.parentId, studentId = input.studentId,
          category = input.category,  // ← BUG: should be PaymentCategory.PARENT_CREDIT (which doesn't exist on Android)
          amount = -allocation.unallocatedAmount,
          sourceId = paymentId, actorId = actorId, actorName = actorName,
          reason = "Crédit parent (trop-perçu) $receipt",
      )
      ledgerDao.upsert(creditEntry.toEntity())
  }
  ```
  Compare to the desktop's `payment-ops.ts:131-156` which uses `category: "parent_credit"` and `accountId: deriveAccountId(input.parentId, "parent_credit", null)`.

  The seeder makes the same mistake (`DatabaseSeeder.kt:436-451`), proving this is the implementation's intended pattern, not a one-off bug.

  **Concrete consequence:** A 200,000 DZD overpayment on Android produces a `parent_credit`-intended adjustment that lands on the `tuition` account. When Desktop syncs this back, `computeAccountBalance` puts the credit in `totalAdjusted` instead of `unallocatedCredit`, and `crossCheckParentCredit` raises `UNBACKED_PARENT_CREDIT` because a non-`parent_credit` account has a negative balance. The desktop's auto-absorb-on-future-invoices logic also fails to fire because it scans only `parent_credit` adjustments.

- Android's `refund` does not branch on `originalWasPending`:
  ```kotlin
  // LocalRepositories.kt:623-627
  val revert = com.example.core.revertPaymentAllocation(
      installments = familyInstallments,
      reversalAmount = existing.amount,
      categoryFilter = PaymentCategory.fromCode(existing.category),
      // ← originalWasPending NOT passed → defaults to false
  )
  ```
  Compare to desktop's `payment-ops.ts:264-269` which passes `originalWasPending = originalLedgerEntry.paymentStatus === "pending"`. **Result:** if a parent pays with a check (status `pending`), then bounces it, Android's LIFO revert subtracts from `installment.amountPaid` (= 0 for a pending payment) — the revert loop produces zero allocations and the installment's `amountPending` stays inflated.

### 3.3 Account balances & receipts

**Divergent — factory field mismatches:**

| Factory | Desktop field values | Android field values |
|---|---|---|
| `createRefundEntry` | `method = null`, `paymentStatus = null`, `sourceType = "refund"` | `method = parameter`, `paymentStatus = REFUNDED`, `sourceType = REFUND` |
| `createAdjustmentEntry` | Accepts `sourceType` param, `receiptNumber = null` always | Hardcodes `sourceType = ADJUSTMENT`, accepts `receiptRef` → stored as `receiptNumber` |
| `createChargeEntry` / `createPaymentEntry` / `createReversalEntry` | Match | Match |

(`entries.ts:184-221` vs `LedgerEntryFactory.kt:102-122`; `entries.ts:138-179` vs `LedgerEntryFactory.kt:80-100`.)

Even though the **balance** contribution of each entry is identical (the signed `amount` is correct), the **metadata field values** differ. This breaks:
- Desktop's `crossCheckPayments` which compares `entry.paymentStatus !== p.status` — for a refund, desktop stores `paymentStatus = null` but Android stores `REFUNDED`. The reconciler raises `PAYMENT_STATUS_MISMATCH` warnings on every Android-originated refund.
- Desktop's audit-log "before/after" JSON deltas which key on `sourceType` — Android adjustments always say `adjustment` even when desktop's spec wants `manual_entry` or `bulk_import`.

### 3.4 Student/client tracking

**Divergent:**
- **`Student.paymentPlan` is missing on Android** at every layer: domain (`domain/model/Student.kt:16-47`), Room (`Entities.kt:71-102`), and DTO mapper (`SharedDtoMappers.kt:73-121` maps `StudentDto.paymentPlan` field into nothing). The Desktop's `Student` interface has `paymentPlan: PaymentPlan` (`domain/model/payment.ts:95`) and migration 0028 mandates the column. So even though the column exists in Supabase and the Android `StudentDto` correctly parses it, the value is **silently dropped** when converting DTO → Entity → Domain. The Android UI therefore has no way to render or apply the 10% early-annual discount.

- Android's `ParentEntity` has `transportDestination` but **not** `cityTier` (`Entities.kt:23-44`). When Android pushes a parent upsert, it sends `city_tier = null`, which the desktop's `pull_parents_for_sync` then reads as `null`, overwriting any value the desktop previously stored.

- Android's `LedgerEntryEntity` has **no `metadata` column** (`Entities.kt:239-259`), and `LocalMappers.LedgerEntryEntity.toDomain()` hardcodes `metadata = emptyMap()` (`LocalMappers.kt:111-122`). So every ledger entry pushed from Supabase to Android loses all of: `tranche`, `level`, `gradeLevel`, `paymentPlan`, `academicCycle`, `clubCategory`, `therapyKind`, `period`, `sessionCount`, `serviceQualifier`, `pricingSource`, `reversedEntryId`, `reason`. This makes Android's ledger effectively an audit-blind ledger.

### 3.5 Pricing & discounts

**Massive divergence:**

Desktop implements a 5-rule single-pass discount engine (`domain/calc/pricing/discount-engine.ts` + `discount-rules.ts`):
- `evaluatePassageDePalier` — −10,000 DZD when student transitions `5ap → 1am` or `4am → 1ere_annee`
- `evaluateSiblingDiscount` — −5,000 DZD per additional child
- `evaluateEarlyAnnualDiscount` — −10% if `paymentPlan === "full_annual"` AND payment before June 30 of start year
- `evaluateAcademicExcellenceDiscount` — −10% if student was rank 1 last year
- `evaluateSeniorityDiscount` — −5% if enrolled > 5 years before academic year start
- `evaluateAllSystemDiscounts` — runs all 5 in one pass on the GROSS annual total (avoids double-discounting per-tranche)
- `sumDiscounts` — aggregator

Android implements **only `computeSiblingDiscount` + `computeTuitionTotal`** (`core/Pricing.kt:32-55`). The other 4 evaluators do not exist anywhere in the Android codebase.

**Concrete consequence:** A family with a single child who:
- transitions from `5ap` to `1am` (−10,000 DZD on desktop, **0 on Android**),
- pays annual tuition in full before June 30 (−10% on desktop, **0 on Android**),
- was rank 1 last year (−10% on desktop, **0 on Android**),
- has been enrolled 6 years (−5% on desktop, **0 on Android**)

...would get a net tuition of, say, 330,000 DZD − 10,000 − 33,000 − 33,000 − 16,500 = **237,500 DZD on desktop**, but the full **330,000 DZD on Android**. The two apps would write different charge entries to Supabase for the same student on the same day.

### 3.6 Charge-entry builders

Desktop has dedicated builders (`domain/calc/ledger/charges.ts` + `non-tuition-charges.ts`):
- `buildTuitionChargeEntries` — branches on `paymentPlan: "full_annual" | "tranches"` → emits **1 or 3** charge entries with `metadata: { tranche, paymentPlan, academicCycle, ... }`
- `buildTransportChargeEntry` + `buildTransportChargeEntriesForDestination` — 1 or 3 transport charges per official destination schedule
- `buildClubEnrollmentCharge` — emits an `extracurricular` charge with `metadata: { clubCategory, clubName, pricingSource }`
- `buildTherapyCharge` — emits a `therapy_psychology` or `therapy_speech` charge (categories Android doesn't even have)
- `buildAdditionalServiceCharge` — emits a `canteen` / `uniform` / `books` / `second_apron` charge

Android has **none of these builders**. Its `DatabaseSeeder.seedLedgerForFamily` (`DatabaseSeeder.kt:246-322`) constructs raw `LedgerEntryEntity` rows inline with hardcoded `category = "tuition" | "transport"`, `metadata = absent` (because the entity has no metadata column), and no notion of `paymentPlan`. The seeder always emits 3 tranches per student — there is no code path to emit a single full-annual charge.

### 3.7 Reconciliation

Desktop's reconciler has 6 cross-checks (`domain/calc/reconcile/cross-checks.ts`):
1. `crossCheckPayments` — every payment has matching ledger entry, amounts match, statuses match
2. `crossCheckInstallments` — every installment has matching charge entry, amountDue matches
3. `crossCheckBalanceSum` — `Σ entries.amount === Σ balances` (tolerance 0.01 DZD)
4. **`crossCheckInstallmentPayments`** — every `installment.amountPaid` is fully backed by cleared payment entries (excludes reversed); emits `UNBACKED_TRANCHE_SATISFACTION` when a tranche is marked `paid` without backing
5. **`crossCheckClearedBalance`** — `Σ payments.amount where status=paid === Σ |ledger payment entries| where paymentStatus=paid` (excludes reversed); emits `PAYMENT_LEDGER_MISMATCH`
6. **`crossCheckParentCredit`** — every negative account balance corresponds to a `parent_credit` adjustment entry; emits `UNBACKED_PARENT_CREDIT`

Android's reconciler has only the first 3 (`core/Reconcile.kt:167-205`). The 3 unified-architecture cross-checks are absent. So Android cannot detect:
- A pending check that wrongly marked a tranche as `paid`
- A payment table row whose amount doesn't match its ledger entry
- An overpayment credit sitting on a non-`parent_credit` account (which is exactly the bug D3 produces)

### 3.8 Sync & data exchange

**Divergent — D16 + D18:**

Android's `PaymentCategory.fromCode` and `PaymentStatus.fromCode` use `values().firstOrNull { it.code == code } ?: throw IllegalArgumentException(...)` (`core/Ledger.kt:42, 48, 54, 59, 66`). When Android's `PullSyncRepository.pullAll()` calls `pull_ledger_entries_for_sync` and the result contains any row whose `category` is `parent_credit` / `therapy_psychology` / `therapy_speech` / `second_apron` OR whose `payment_status` is `pending_clearance` / `unpaid`, the SharedDtoMappers crash with `IllegalArgumentException`. The pull sync aborts partway.

Furthermore, `PullSyncRepository` only calls `pull_parents_for_sync` + `pull_students_for_sync` — it does **not** call `pull_payments_for_sync` or `pull_ledger_entries_for_sync` at all (per `docs/development/shared-unification.md` Android Pull-Side Sync section). So even if the mappers were tolerant, Android would still never see payments or ledger entries written by Desktop. The two apps are **effectively write-only on Android for ledger entries and payments** — Desktop → Supabase → Android sync is one-way for those tables.

### 3.9 Financial history

The Desktop's `ParentFinancialProfile` (`domain/model/payment.ts:266-276`) aggregates `installments`, `recentPayments`, `adjustments`. Android has no equivalent aggregate — each repository (`PaymentRepository`, `InstallmentRepository`, `LedgerRepository`) is queried separately by the UI, and the UI manually composes them. There is no canonical "snapshot of a parent's financial state" type on Android.

---

## 4. Concrete scenario where the two apps diverge

Take the demo family from `DatabaseSeeder.kt`:
- Parent `par-003` (Mohamed Saidi) with 3 children (Lina 2ap, Omar 4ap, Rania 1am).
- Lina: enrollment date 2024 (only 2 years seniority — no seniority discount).
- Omar: was rank 1 in his palier last year (qualifies for `highest_average` −10%).
- Rania: just transitioned from 5ap → 1am (qualifies for `passage_palier` −10,000 DZD).
- Parent decides to pay Rania's annual tuition in full on June 15, 2026 (qualifies for `full_annual` −10%).

For Rania (1am, annual tuition 330,000 DZD):

| Discount | Desktop applies | Android applies |
|---|---|---|
| `passage_palier` | −10,000 DZD | **0** (not implemented) |
| `full_annual` (early) | −33,000 DZD | **0** (no `paymentPlan` field) |
| Subtotal | 287,000 DZD | 330,000 DZD |
| Sibling (child #3) | −5,000 DZD | −5,000 DZD |
| **Net charged** | **282,000 DZD** | **325,000 DZD** |

The two apps would write **charge entries that differ by 43,000 DZD** to Supabase for the same student on the same day. This is not a rounding error — it is a structural divergence in the discount engine.

Then if the parent pays 350,000 DZD cash (a 68,000 DZD overpayment on desktop, a 25,000 DZD overpayment on Android):

- **Desktop** writes a `parent_credit` adjustment of −68,000 DZD on account `parent:par-003:category:parent_credit` with `studentId = null`.
- **Android** writes a `tuition` adjustment of −25,000 DZD on account `parent:par-003:category:tuition:student:stu-006` with `studentId = "stu-006"`.

When the desktop's reconciler runs against the Android-originated row:
- `crossCheckParentCredit` raises `UNBACKED_PARENT_CREDIT` (negative balance on a non-`parent_credit` account).
- `computeAccountBalance` for `parent:par-003:category:parent_credit` returns `unallocatedCredit = 0` → desktop UI shows "no advance credit available" even though the parent has 25,000 DZD banked.
- Future tuition charges for stu-006 will not auto-absorb the credit because the auto-absorb logic only looks at `parent_credit` accounts.

---

## 5. Areas where the two apps ARE consistent

To be fair to the Android implementation:

1. **Account ID derivation** — identical string format on both sides.
2. **Balance replay loop** — same filter / sort / sum / reversal-exclusion logic.
3. **Waterfall allocator** — byte-for-byte equivalent algorithm.
4. **LIFO reversal algorithm** — equivalent algorithm (when `originalWasPending` is correctly passed — which Android doesn't do).
5. **40/30/30 tranche split** — `splitNetTuitionByOfficialSchedule` matches `splitNetTuitionByOfficialSchedule`.
6. **Official tuition due dates** — both produce Sept 15 / Dec 15 / Mar 15 (minor ISO-format difference: Android `OffsetDateTime.toString()` → `"2026-09-15T00:00+00:00"` vs Desktop `Date.toISOString()` → `"2026-09-15T00:00:00.000Z"`; both parse fine).
7. **Payment methods** — both have `cash`, `check`, `transfer` with `requiresProof = (method != cash)`.
8. **Signed-amount convention** — `+charge`, `-payment`, `-refund`, `±adjustment`, `-original.amount` for reversal — identical.
9. **Pricing config seed data** — Android's `DatabaseSeeder` seeds the same 14 grade levels, 4 transport zones, and 5 discount codes as desktop's `defaultPricingConfig`. The discount code metadata is right; the **evaluators** are what's missing.

---

## 6. Recommendations

If the goal is for the two apps to be functionally interchangeable (i.e., the same operation in either app produces the same ledger state and the same balance), the Android app needs a port of the Desktop's Unified Financial Architecture refactor. Concretely:

1. **Add the 4 missing `PaymentCategory` values** (`parent_credit`, `therapy_psychology`, `therapy_speech`, `second_apron`) and the 2 missing `PaymentStatus` values (`pending_clearance`, `unpaid`) to `core/Ledger.kt`. Make `fromCode` return a sentinel `OTHER` / default instead of throwing, so future desktop additions don't crash Android sync.
2. **Add `unallocatedCredit` to `AccountBalance` and `totalUnallocatedCredit` to `ParentLedgerSummary`**, and update `LedgerEngine.computeAccountBalance` to sum `parent_credit` adjustments separately.
3. **Fix `LocalPaymentRepository.collect`'s overpayment path** to write the credit on `category = PaymentCategory.PARENT_CREDIT`, `studentId = null`, `accountId = deriveAccountId(parentId, PaymentCategory.PARENT_CREDIT, null)`. Same fix in `DatabaseSeeder.seedDemoPayment`.
4. **Fix `LocalPaymentRepository.refund`** to pass `originalWasPending = (originalLedger.paymentStatus == PaymentStatus.PENDING)`.
5. **Port the 5-rule discount engine** from `domain/calc/pricing/discount-rules.ts` + `discount-engine.ts` to a new `core/DiscountEngine.kt`. Replace the inline sibling-only logic in `DatabaseSeeder.seedLedgerForFamily` with a call to `evaluateAllSystemDiscounts`.
6. **Port the charge builders** (`buildTuitionChargeEntries`, `buildTransportChargeEntriesForDestination`, `buildClubEnrollmentCharge`, `buildTherapyCharge`, `buildAdditionalServiceCharge`) so Android can produce the same category/metadata-rich charge entries as desktop.
7. **Port the 3 missing reconciler cross-checks** (`crossCheckInstallmentPayments`, `crossCheckClearedBalance`, `crossCheckParentCredit`) and their 3 violation codes.
8. **Add `paymentPlan` to `Student` + `StudentEntity` + `StudentDto.toEntity()` mapping.**
9. **Add `amountPending` to the domain `Installment` model** (it already exists in `InstallmentEntity`) and update `InstallmentEntity.toDomain()` to pass it through.
10. **Add `metadata` column to `LedgerEntryEntity`** (TEXT / JSON) and update mappers + DAOs.
11. **Align `createRefundEntry` and `createAdjustmentEntry` field semantics** with desktop (null `method` and `paymentStatus` for refund; parameterized `sourceType` for adjustment; drop `receiptRef` or accept it on desktop too).
12. **Extend `PullSyncRepository`** to also call `pull_payments_for_sync` and `pull_ledger_entries_for_sync`. Without this, even after fixing all the above, Android never sees desktop-originated payment/ledger rows.
13. **Switch the amount representation in DTOs** from `Double` (DZD) to `Long` (centimes) end-to-end, or use `BigDecimal`, to eliminate the `* 100).toLong()` precision trap.

Until items 1–12 land, **the two apps will produce different financial state for the same logical operation**, and the shared Supabase schema will be a quiet battleground where each app overwrites or invalidates the other's records.
