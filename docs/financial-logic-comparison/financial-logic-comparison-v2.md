# El-Imtiyaz — Comprehensive Financial Discrepancy Audit (v2 — Deeper)

**Auditor:** Super Z (full code-level audit, second pass)
**Date:** 2026-08-19
**Repos audited:**
- Desktop: `https://github.com/Vtheonly/AgentGithubUplaod` → `elimtiyaz-desktop/`
- Android: `https://github.com/Vtheonly/elimtiyaz-android`

This v2 report supersedes the first. The first pass covered only the **pure-domain layer** (entries, balance, waterfall, pricing, reconcile) and found 18 discrepancies. This second pass traces the **complete flow** — domain → mock repository → Supabase repository → UI features → sync queue → Android Room → Android UI — and finds that the discrepancies are far more pervasive: **the desktop itself is internally inconsistent** between its Mock-mode and Supabase-mode implementations, and Android is missing the entire sync-push side of the unified architecture.

---

## 0. Executive summary

The situation is worse than the first report indicated. There are **five distinct layers** where financial logic diverges, and the divergences compound across layers:

1. **Domain layer** — Android's enum/model surface is missing 4 `PaymentCategory` values, 2 `PaymentStatus` values, `unallocatedCredit`/`totalUnallocatedCredit`, `paymentPlan`, `amountPending` (in domain), `expectedAmount`/`excessAmount`/`excessRemark`, `metadata` (in Room entity), and `adjustments` on `ParentFinancialProfile`. (Findings D1–D11 from v1, plus D50–D51, D57.)

2. **Calc / factory layer** — Android's overpayment credit lands on the wrong account (`tuition` instead of `parent_credit`); Android's refund LIFO revert doesn't branch on `originalWasPending`; Android's `createRefundEntry` and `createAdjustmentEntry` produce different field values than desktop; Android lacks 4 of 5 discount evaluators and the master `evaluateAllSystemDiscounts`; Android lacks all `build*TuitionChargeEntries` / `build*Charge` builders. (D3, D4, D5, D6, D9, D10 from v1.)

3. **Mock repository workflow layer (Desktop)** — the desktop's mock `LedgerRepository.reconcile()` correctly runs all 6 cross-checks; the desktop's mock `seedLedger` STILL has the per-tranche sibling-discount double-counting bug that the unified refactor was supposed to fix. (D32, D33 — new.)

4. **Supabase repository layer (Desktop)** — **the desktop's Supabase-backed repositories are essentially stubs**. `summary()` uses naive Σ amounts and hardcodes `totalOverdue: 0`, `totalCleared: totalPaid`, `totalPending: 0`, `totalUnallocatedCredit: 0`, `accounts: []`. `reconcile()` returns an empty report. `PaymentRepository.collect()` calls the upsert helper RPC instead of the atomic `collect_and_allocate_payment` RPC. `InstallmentRepository.markPaid()` marks tranches paid without incrementing `amountPaid` (violates the canonical invariant). `InstallmentRepository.allocatePayment()` is a no-op stub. `adjust()` / `generateReceipt()` / `appendManualCharge()` all return `Err("not implemented")`. (D19–D31 — new.)

5. **Sync / data exchange layer** — Android has a `SyncSupport.tryThenEnqueue()` helper and a `SyncQueueDispatcher` with full push implementations for parent / student / payment / ledger_entry, but **none of Android's local repositories inject `SyncSupport` or call `syncService.enqueue()`**. Android's financial writes stay in Room forever. The "shared unification" doc's claim that "Both clients now read + write the SAME tables" is false — Android is read-only relative to Supabase for payments + ledger entries + installments. (D39–D43, D49 — new.)

6. **UI / workflow layer** — Android's `BatchRegistrationViewModel` does NOT call a `computeBilling` equivalent (just writes parent + students + inline charges with only sibling discount); Android's `CounterPaymentScreen` uses a basic 0..1 slider with no remaining-balance snap points, no mode switching, no overpayment awareness, no `unallocatedCredit` display; Android's `LocalDashboardRepository` computes `outstandingDebt` by direct sum of ledger amounts (excludes refunds, includes reversed originals, doesn't replay per-account); Android's dashboard returns hardcoded fallback numbers when Room is empty. (D34, D52–D56, D62–D65 — new.)

7. **Identity / idempotency layer** — Android's `batchRegister` generates RANDOM `parent_code` and `activation_code`, breaking idempotency at the source. Desktop's `createParent` uses FNV-1a deterministic codes; Android uses `UUID.randomUUID().toString().takeLast(4).toUpperCase()`. Even if Android's sync push were wired, the upsert RPC's primary identity match would never hit. (D35, D36 — new.)

8. **Latent RPC bugs (Android sync dispatcher)** — `SyncQueueDispatcher.pushPayment()` and `pushLedgerEntry()` read `amount` as String → Double without centimes-to-DZD conversion. If Android ever enqueued a payment (it doesn't today), the RPC would receive 15,000,000 (centimes) and store it as 15,000,000 DZD — a 100× inflation. Also missing: `p_installment_id`, `p_check_*`, `p_transfer_*`, `p_metadata`. (D44–D48 — new.)

---

## 1. The five layers of divergence

```
                       Desktop (TypeScript / React)
                       ===========================
   ┌─ domain/calc/*  (canonical — computeAccountBalance, waterfall, LIFO, 5-rule discount)
   │
   ├─ mock/repo/*    (correct — uses canonical calc, but buildSeedLedger has the OLD
   │                  per-tranche sibling-discount double-counting bug)
   │
   ├─ supabase/repo/* (STUBBED — does NOT use canonical calc:
   │                   summary() = naive Σ amounts, hardcoded zeros
   │                   reconcile() = empty report
   │                   collect() = upsert RPC, NOT atomic collect_and_allocate_payment
   │                   markPaid() = UPDATE status='paid' WITHOUT incrementing amount_paid
   │                   allocatePayment() = no-op stub
   │                   adjust/generateReceipt/appendManualCharge = "not implemented")
   │
   └─ features/financials/* (rich UI: AdaptivePaymentSlider with 3 modes + remaining-balance
                              snap points, UnifiedDebtMeter with unallocatedCredit display,
                              computeBilling with 5-rule discount engine)

                                │
                                │  Supabase (PostgreSQL)
                                │  ===================
                                │  - canonical schema (migrations 0007, 0025, 0026, 0027,
                                │    0028, 0032, 0033)
                                │  - atomic RPCs: collect_and_allocate_payment,
                                │    revert_payment_allocation, allocate_payment_waterfall
                                │  - upsert RPCs: upsert_parent/student/payment/ledger_entry_from_import
                                │  - pull RPCs: pull_*_for_sync
                                │
                                ▼
                       Android (Kotlin / Compose)
                       ==========================
   ┌─ core/*  (partial canonical — waterfall + LIFO + 40/30/30 split, but missing 4 of 11
   │            PaymentCategory, 2 of 8 PaymentStatus, unallocatedCredit, 4 of 5 discount rules,
   │            all charge builders, 3 of 6 reconciler cross-checks)
   │
   ├─ domain/model/* (missing fields: Student.paymentPlan, Payment.expectedAmount/excessAmount,
   │                  Installment.amountPending (domain), ParentFinancialProfile.adjustments)
   │
   ├─ infrastructure/room/* (LedgerEntryEntity missing metadata column;
   │                         StudentEntity missing paymentPlan;
   │                         ParentEntity missing cityTier;
   │                         PaymentEntity missing expectedAmount/excessAmount/excessRemark;
   │                         InstallmentEntity HAS amountPending but domain drops it)
   │
   ├─ infrastructure/local/* (Local*Repository implementations:
   │                          - batchRegister: only sibling discount, random codes, NO sync enqueue
   │                          - collect: overpayment credit on WRONG account, NO sync enqueue
   │                          - refund: doesn't pass originalWasPending, NO sync enqueue
   │                          - ledger append/reverse: NO sync enqueue
   │                          - dashboard: hardcoded fallback numbers, wrong outstanding calc)
   │
   ├─ infrastructure/sync/* (SyncSupport + SyncQueueDispatcher EXIST but NEVER INVOKED
   │                        from any Local*Repository. PullSyncRepository pulls parents +
   │                        students + payments + ledger entries + installments, but
   │                        toEntity() mappers crash on parent_credit/therapy_*/pending_clearance
   │                        via PaymentCategory.fromCode / PaymentStatus.fromCode.)
   │
   └─ ui/features/financials/* (basic slider with 500-DZD snap, no modes, no overpayment
                                awareness, no unallocatedCredit display)
```

**Key architectural reality**: Android is effectively **read-only** relative to Supabase for the financial tables. Desktop writes flow Desktop → Supabase → Android (with 15-min WorkManager latency). Android writes stay in Room forever. So the "shared backend" the unification doc describes is, in practice, a one-way desktop-to-android data feed for payments + ledger entries + installments.

---

## 2. Master discrepancy table (D1–D65)

For readability, findings are grouped by layer. The IDs are stable across v1 and v2 (v1's D1–D18 are unchanged; D19 onward is new in v2).

### Layer A — Pure-domain discrepancies (D1–D18, from v1)

| # | Area | Status |
|---|------|--------|
| D1 | `PaymentCategory` enum — Android missing 4 of 11 (`parent_credit`, `therapy_psychology`, `therapy_speech`, `second_apron`) | confirmed |
| D2 | `PaymentStatus` enum — Android missing 2 of 8 (`pending_clearance`, `unpaid`) | confirmed |
| D3 | Overpayment credit goes to wrong account on Android (`tuition:student:X` instead of `parent_credit`) | confirmed |
| D4 | Refund LIFO revert doesn't branch on `originalWasPending` on Android | confirmed |
| D5 | Android implements only 1 of 5 discount rules (only sibling) | confirmed |
| D6 | Android lacks all charge-entry builders (`buildTuitionChargeEntries`, `buildTransportChargeEntriesForDestination`, `buildClubEnrollmentCharge`, `buildTherapyCharge`, `buildAdditionalServiceCharge`) | confirmed |
| D7 | Android missing 3 of 6 reconciler cross-checks | confirmed |
| D8 | Android `AccountBalance` / `ParentLedgerSummary` missing `unallocatedCredit` / `totalUnallocatedCredit` | confirmed |
| D9 | `createRefundEntry` field values differ (Android: method=param, paymentStatus=REFUNDED; Desktop: method=null, paymentStatus=null) | confirmed |
| D10 | `createAdjustmentEntry` field values differ (Android: hardcoded sourceType=ADJUSTMENT, accepts receiptRef; Desktop: sourceType=param, never accepts receiptRef) | confirmed |
| D11 | Android `LedgerEntryEntity` (Room) has NO `metadata` column; `toDomain()` hardcodes `metadata = emptyMap()` | confirmed |
| D12 | Android `Student` domain missing `paymentPlan` field | confirmed |
| D13 | Android `Payment` domain missing `expectedAmount`, `excessAmount`, `excessRemark` | confirmed |
| D14 | Android `Installment` domain missing `amountPending` (entity has it but `toDomain()` drops it) | confirmed |
| D15 | Android `ParentEntity` (Room) missing `cityTier` column | confirmed |
| D16 | Android `PaymentCategory.fromCode` / `PaymentStatus.fromCode` THROW on unknown codes | confirmed |
| D17 | Android DTO amount precision trap: `(amount * 100).toLong()` is lossy | confirmed |
| D18 | Android `PullSyncRepository` doesn't pull payments/ledger entries | **OVERTURNED** — Android DOES pull them via `pullPayments` / `pullLedgerEntries` / `pullInstallments` (see D50/D51 for the new actual bug) |

### Layer B — Desktop-internal inconsistencies (D19–D33, new in v2)

| # | Area | Evidence |
|---|------|----------|
| D19 | Desktop Supabase `LedgerRepository.summary()` (lines 1095-1118) uses naive Σ amounts: `totalCharged = Σ amount>0` (includes positive adjustments), `totalPaid = Σ |amount| where type=payment`, `outstanding = totalCharged - totalPaid + totalAdjusted` (formula is wrong — double-counts positive adjustments, ignores refunds, ignores reversals). Hardcodes `totalOverdue: 0`, `totalCleared: totalPaid`, `totalPending: 0`, `totalUnallocatedCredit: 0`, `accounts: []`, `parentName: ""`. | `supabase-shared-repositories.ts:1095-1118` vs canonical `computeParentSummary` in `domain/calc/ledger/balance.ts:141-205` |
| D20 | Desktop Supabase `LedgerRepository.reconcile()` returns an EMPTY report (lines 1121-1131). Does NOT call `reconcileLedger()` or any of the 6 cross-checks. The comment admits: "Reconciliation is a desktop-only sweep; the mock + supabase impls both return an empty report." This is FALSE for the mock — the mock DOES run all 6 cross-checks (`ledger-repository.ts:119-201`). | `supabase-shared-repositories.ts:1121-1131` vs `mock/repositories/ledger-repository.ts:119-201` |
| D21 | Desktop Supabase `PaymentRepository.collect()` (lines 758-802) calls `upsert_payment_from_import` RPC (just an upsert helper) — does NOT call the atomic `collect_and_allocate_payment` RPC (migration 0026) that does waterfall + parent_credit + audit in one transaction. So Supabase-mode payments never get waterfall-allocated at the RPC layer. | `supabase-shared-repositories.ts:758-802` vs `mock/repositories/financial/payment-ops.ts:50-199` and migration `0026_unified_financial.sql:93-290` |
| D22 | Desktop Supabase `PaymentRepository.adjust()` returns `Err(Errors.server("adjust not implemented for Supabase repository"))` (line 892-894). The discretionary adjustment workflow is unavailable in Supabase mode. | `supabase-shared-repositories.ts:892-894` |
| D23 | Desktop Supabase `PaymentRepository.generateReceipt()` returns `Err(Errors.server("generateReceipt not implemented for Supabase repository"))` (line 896-898). No PDF receipt generation in Supabase mode. | `supabase-shared-repositories.ts:896-898` |
| D24 | Desktop Supabase `PaymentRepository.appendManualCharge()` returns `Err(Errors.server("appendManualCharge not implemented for Supabase repository"))` (line 900-902). The canteen/uniform/books/second_apron charge workflow is unavailable in Supabase mode. | `supabase-shared-repositories.ts:900-902` |
| D25 | Desktop Supabase `InstallmentRepository.markPaid()` (lines 1208-1229) does a direct `UPDATE installments SET status='paid', paid_date=now()` — does NOT increment `amount_paid`! Marks a tranche as paid WITHOUT recording any amountPaid delta, violating the invariant "amountPaid >= amountDue". This is a CATASTROPHIC data corruption bug — the tranche shows `status='paid'` but `amount_paid` remains whatever it was before. Reconciler's `crossCheckInstallmentPayments` would flag it as `UNBACKED_TRANCHE_SATISFACTION` (which the Supabase `reconcile()` doesn't run anyway). | `supabase-shared-repositories.ts:1208-1229` |
| D26 | Desktop Supabase `InstallmentRepository.allocatePayment()` (lines 1231-1241) is a NO-OP STUB: returns `Ok({ allocations: [], unallocatedAmount: 0, allocatedAmount: 0 })`. The waterfall allocator is never invoked on the Supabase side. | `supabase-shared-repositories.ts:1231-1241` |
| D27 | Desktop Supabase `InstallmentRepository.updateDueDate()` returns `Err(Errors.server("updateDueDate not implemented for Supabase repository"))` (line 1243-1245). Flexible schedules unavailable in Supabase mode. | `supabase-shared-repositories.ts:1243-1245` |
| D28 | Desktop Supabase `InstallmentRepository.regenerateForCycle()` returns `Err(Errors.server("regenerateForCycle not implemented for Supabase repository"))` (line 1247-1249). Schedule regeneration unavailable in Supabase mode. | `supabase-shared-repositories.ts:1247-1249` |
| D29 | Desktop Supabase `InstallmentRepository.importInstallment()` (line 1346) and `bulkImportInstallments()` (line 1279) hardcode `amount_pending: 0`. Even if a pending check was on the tranche, the importer never records it. | `supabase-shared-repositories.ts:1279, 1346` |
| D30 | Desktop Supabase `DebtRepository.observeSummary()` (lines 1432-1436) returns an EMPTY observable. The cross-parent debt dashboard doesn't work in Supabase mode. | `supabase-shared-repositories.ts:1432-1436` |
| D31 | Desktop Supabase `DebtRepository.observeParentProfile()` (lines 1453-1494) computes totals with naive filters: `totalCharged = Σ amount>0 AND type ∉ reversal,refund` (includes positive adjustments), `totalPaid = Σ |amount|<0 AND (type=payment OR type=adjustment)` (counts negative adjustments as paid!), `outstanding = max(0, totalCharged - totalPaid)`, `overdueAmount = outstanding` (always equal to outstanding). `installments`, `recentPayments`, `adjustments` all empty arrays. | `supabase-shared-repositories.ts:1471-1488` |
| D32 | Desktop mock `buildSeedLedger()` (lines 104-109) applies the sibling discount PER TRANCHE: `amount = applyDiscount(amount, { amount: siblingDiscount.amount, discountType: "fixed_amount" })` inside the tranches.forEach loop. This is the EXACT double-discounting bug the unified refactor was supposed to fix. For 3 tranches × -5,000 DZD per tranche = -15,000 DZD total sibling discount, instead of the intended -5,000 DZD. The `computeBilling` function in `batch-registration/compute-billing.ts` does it correctly (applies once on gross, then splits). | `mock/ledger-seed.ts:104-109` vs `features/crm/batch-registration/compute-billing.ts:58-92` |
| D33 | Desktop mock `buildSeedLedger()` (the whole 253-line file) does NOT seed any `parent_credit` adjustments. Only 2 adjustment entries exist: hardship waiver (-5000 on par-003, category=tuition) and late penalty (+2000 on par-005, category=tuition). The canonical overpayment → parent_credit flow is never exercised in mock seed. | `mock/ledger-seed.ts:208-237` |

### Layer C — Sync / data exchange (D34–D49, new in v2)

| # | Area | Evidence |
|---|------|----------|
| D34 | Android `BatchRegistrationViewModel.register()` (lines 32-65) does NOT call any `computeBilling` equivalent — it just calls `studentRepository.batchRegister(parent, students, ...)` which writes parent + students + charges + installments inline with ONLY sibling discount. No 5-rule discount engine. No payment plan. | `ui/features/crm/BatchRegistrationViewModel.kt:32-65` |
| D35 | Android `LocalStudentRepository.batchRegister()` (line 396) generates RANDOM `parent_code`: `"PAR-$year-${UUID.randomUUID().toString().takeLast(4).toUpperCase()}"`. Breaks idempotency. Compare desktop's `createParent` (line 410) which uses `deterministicParentCode(year, input)` derived from FNV-1a hash of identity fields. | `LocalRepositories.kt:396` vs `supabase-shared-repositories.ts:410` |
| D36 | Android `LocalStudentRepository.batchRegister()` (line 397) generates RANDOM `activationCode`: `(100_000..999_999).random().toString()`. Non-deterministic across runs. | `LocalRepositories.kt:397` |
| D37 | Android `LocalStudentRepository.batchRegister()` (line 436) applies ONLY sibling discount: `val siblingDiscount = if (index > 0) -500_000L else 0L`. Misses passage_palier, full_annual, highest_average, seniority_5y. | `LocalRepositories.kt:436` |
| D38 | Android `LocalStudentRepository.batchRegister()` (lines 463-466) always creates 3 tranches, never 1 full-annual entry. No `paymentPlan` support. | `LocalRepositories.kt:463-466` |
| D39 | Android `LocalStudentRepository.batchRegister()` does NOT call `syncService.enqueue()` for any of: parent create, student create, ledger entry append, installment append. Desktop never sees newly-registered families from Android. | `LocalRepositories.kt:391-501` |
| D40 | Android `LocalPaymentRepository.collect()` (lines 538-607) does NOT call `syncService.enqueue()` for: payment create, ledger payment entry append, ledger credit adjustment append, installment updates. Desktop never sees Android-collected payments. | `LocalRepositories.kt:538-607` |
| D41 | Android `LocalPaymentRepository.refund()` (lines 609-643) does NOT call `syncService.enqueue()` for: payment status update, ledger reversal entry, installment revert updates. Desktop never sees Android refunds. | `LocalRepositories.kt:609-643` |
| D42 | Android `LocalLedgerRepository.append()` / `appendMany()` / `reverse()` (lines 707+) do NOT call `syncService.enqueue()`. All Android ledger writes stay local. | `LocalRepositories.kt:707+` |
| D43 | Android `SyncSupport.tryThenEnqueue()` (lines 117-150) exists as a helper for offline-first writes, but is NEVER INJECTED into ANY of the Local*Repository classes. The sync push infrastructure is wired but unused. | `infrastructure/sync/SyncSupport.kt:117-150` — no Local*Repository constructor takes `SyncSupport` |
| D44 | Android `SyncQueueDispatcher.pushPayment()` (line 148) reads `amount` as String → `toDoubleOrNull()` and sends to RPC. Android domain stores `amount` as Long (centimes); RPC expects DZD (NUMERIC(12,2)). NO centimes-to-DZD conversion. So 15,000,000 centimes (150,000 DZD) becomes 15,000,000.0 → stored as 15,000,000 DZD. **100× inflation.** Latent bug — never triggered today because payments are never enqueued (D40). | `SyncQueueDispatcher.kt:148` |
| D45 | Android `SyncQueueDispatcher.pushLedgerEntry()` (line 175) has the same 100× amount inflation bug. Latent — never triggered (D42). | `SyncQueueDispatcher.kt:175` |
| D46 | Android `SyncQueueDispatcher.pushPayment()` does NOT send `p_installment_id`, `p_check_number`, `p_check_bank_name`, `p_check_issue_date`, `p_check_clearance_date`, `p_transfer_reference`, `p_transfer_source_bank`. The RPC accepts these; Android omits them. Check/transfer metadata + installment linkage lost on push. | `SyncQueueDispatcher.kt:143-156` |
| D47 | Android `SyncQueueDispatcher.pushLedgerEntry()` does NOT send `p_metadata`. RPC accepts JSONB; Android omits it. Tranche/clubCategory/therapyKind/paymentPlan/etc. metadata lost on push. | `SyncQueueDispatcher.kt:168-187` |
| D48 | Android `SyncQueueDispatcher` comment line 75-78: "Other entity kinds (installment, expense, attendance, grade, homework, audit_log, notification, calendar_event) are currently local-only." Installments, expenses, etc. NEVER push. | `SyncQueueDispatcher.kt:74-82` |
| D49 | Android `PullSyncRepository.pullLedgerEntries()` (lines 147-176) DOES pull ledger entries (correcting my earlier claim). But the `LedgerEntryDto.toEntity()` stores the raw `category` and `paymentStatus` strings in the Room entity. When the entity is later converted to domain via `LocalMappers.LedgerEntryEntity.toDomain()` (LocalMappers.kt:111-122), `PaymentCategory.fromCode(category)` THROWS on `parent_credit`/`therapy_*`/`second_apron`, and `PaymentStatus.fromCode(paymentStatus)` THROWS on `pending_clearance`/`unpaid`. So pulling a parent_credit entry succeeds at the storage layer but crashes any UI code that consumes it. | `PullSyncRepository.kt:147-176` + `LocalMappers.kt:111-122` |

### Layer D — Android UI / dashboard / mappers (D50–D65, new in v2)

| # | Area | Evidence |
|---|------|----------|
| D50 | Android has TWO mappers for ledger entries with DIFFERENT crash behavior:<br>- `LocalMappers.LedgerEntryEntity.toDomain()` (LocalMappers.kt:111-122) — uses `PaymentCategory.fromCode(category)` which **THROWS** on unknown codes.<br>- `CacheMappers.LedgerCacheEntity.toDomain()` (CacheMappers.kt:99-116) — uses `runCatching { PaymentCategory.valueOf(category) }.getOrDefault(OTHER)` which **SILENTLY CORRUPTS** unknown categories to `OTHER` and unknown statuses to `null`.<br>Same data, different behavior depending on which entity it lives in. | `LocalMappers.kt:111-122` vs `CacheMappers.kt:99-116` |
| D51 | Android `LocalDashboardRepository.observeKpis()` (lines 231-233) computes `totalOutstanding` by summing ledger amounts DIRECTLY: `g2.ledger.filter { it.type == "charge" || it.type == "payment" || it.type == "adjustment" }.sumOf { it.amount }`. Does NOT call `computeAccountBalance` / `computeParentSummary` / `totalOutstandingAcrossAccounts`. Does NOT exclude reversed entries (reversed originals still summed). Does NOT include refund entries (type=refund is filtered out). Wrong on multiple counts. | `LocalRepositories2.kt:231-233` |
| D52 | Android `LocalDashboardRepository.observeKpis()` (lines 235-237) computes `overdueDebt = overdueInstallments.sumOf { (it.amountDue - it.amountPaid).coerceAtLeast(0L) }`. Doesn't account for `amountPending` (overdue should arguably subtract pending too). Doesn't aggregate per parent first (canonical approach: classify accounts as overdue, then sum balances). | `LocalRepositories2.kt:235-237` |
| D53 | Android `LocalDashboardRepository.observeKpis()` (line 220) computes `monthlyRevenue` filter as `it.collectedAt >= monthStart` with NO upper bound (`< nextMonthStart`). Future-dated payments would be counted as current-month revenue. (The 12-month chart at line 274-310 DOES apply the upper bound correctly — inconsistency within the same file.) | `LocalRepositories2.kt:220` vs `:274-310` |
| D54 | Android `LocalDashboardRepository.observeKpis()` (lines 250-265) has HARDCODED fallback values when Room is empty:<br>- `totalStudents = if (activeStudents.isNotEmpty()) activeStudents.size else 390`<br>- `totalParents = if (g1.parents.isNotEmpty()) g1.parents.size else 185`<br>- `totalStaff = if (activeStaff.isNotEmpty()) activeStaff.size else 45`<br>- `totalClassesCount = if (activeClasses.isNotEmpty()) activeClasses.size else 7`<br>- `attendanceRateToday = ... else 96.5`<br>Fabricated numbers shown when no data exists. | `LocalRepositories2.kt:250-265` |
| D55 | Android `LocalDashboardRepository.observeRevenueLast12Months()` (lines 297-309) returns HARDCODED fake monthly revenue when all actual data is zero: `[Sept=13_400_000_00L, Oct=12_900_000_00L, ...]`. So Android shows fabricated revenue trend when no payments exist. | `LocalRepositories2.kt:297-309` |
| D56 | Android `LocalDebtRepository.observeParentProfile()` (lines 538-548) builds `ParentFinancialProfile` WITHOUT `adjustments` field — Android's domain model `ParentFinancialProfile` (DebtRepository.kt:17-21) doesn't have it. Desktop's interface (payment.ts:266-276) DOES have `adjustments: readonly AccountAdjustment[]`. So Android can never display discretionary adjustment history. | `LocalRepositories2.kt:538-548` + `DebtRepository.kt:17-21` vs `payment.ts:266-276` |
| D57 | Android `LocalExpenseRepository.settleProof()` (lines 765-771) accepts `finalAmount: Long` parameter but **silently drops it** — only updates `proofUrl`, `settledAt`, `status`. The "final spent amount" concept (present in desktop's `ExpenseTicketDto.final_spent_amount`, migration 0008) is lost on Android. | `LocalRepositories2.kt:765-771` |
| D58 | Android `LocalAuditRepository.log()` (lines 617-627) hardcodes `actorId = "system"`, `actorName = "System"` even when `AuditLogInput` carries a real actor. All Android audit logs lose actual actor identity. | `LocalRepositories2.kt:617-627` |
| D59 | Android `LocalAuditRepository.query()` (line 615) returns `Result.Ok(emptyList())` — audit query is fully stubbed. | `LocalRepositories2.kt:615` |
| D60 | Android `CounterPaymentScreen` (lines 211-231) uses a basic 0..1 `Slider` with hardcoded 500-DZD rounding: `val rounded = ((pos * maxSliderAmount) / 500).toInt() * 500`. Compare desktop's `AdaptivePaymentSlider` (397 lines) with 3 modes (`single_item` / `installment_tranche` / `consolidated_debt`), REMAINING-balance snap points (not gross), magnetic snap (within 500 DZD), per-tranche live preview, overpayment credit display, `allowPartial` flag. | `CounterPaymentScreen.kt:211-231` vs `payment-slider.tsx:1-404` |
| D61 | Android `CounterPaymentScreen` (line 213-214) computes `maxSliderAmount = maxOf(debt, 100_000f)` — HARDCODED 100,000 DZD floor. Doesn't reflect actual remaining debt structure. Desktop's `AdaptivePaymentSlider` derives max from sum of remaining balances. | `CounterPaymentScreen.kt:212-215` |
| D62 | Android `CounterPaymentScreen` doesn't display `unallocatedCredit` (because Android's `ParentLedgerSummary` doesn't have that field — see D8). Desktop's `UnifiedDebtMeter` (debt-meter.tsx:122-129) shows "Crédit parent disponible — sera absorbé sur la prochaine facture" when parent has banked credit. | `CounterPaymentScreen.kt` (no such display) vs `debt-meter.tsx:122-129` |
| D63 | Android `CounterPaymentScreen` has no `mode` prop — only one mode (a basic installment_tranche equivalent). No `single_item` mode for clubs/uniforms/aprons. No `consolidated_debt` mode for paying across multiple services. | `CounterPaymentScreen.kt:200-231` vs `payment-slider.tsx:49` (`PaymentSliderMode = "single_item" | "installment_tranche" | "consolidated_debt"`) |
| D64 | Android `CounterPaymentScreen` doesn't show per-tranche live preview row (which tranche gets how much of the current payment, plus "will complete" / "remaining after" indicators). Desktop's `AdaptivePaymentSlider` shows this preview (payment-slider.tsx:312-360). | `CounterPaymentScreen.kt` vs `payment-slider.tsx:312-360` |
| D65 | Android `CounterPaymentScreen` doesn't display overpayment credit warning ("Excédent (crédit parent)") when slider exceeds total remaining. Desktop's `AdaptivePaymentSlider` shows this (payment-slider.tsx:351-358). | `CounterPaymentScreen.kt` vs `payment-slider.tsx:351-358` |

---

## 3. Concrete divergent scenarios (deeper than v1)

### Scenario A — Desktop Mock vs Desktop Supabase (the new desktop-internal inconsistency)

Parent `par-003` has 3 students, paid 200,000 DZD cash for tuition, 50,000 DZD overpayment.

| Step | Desktop Mock mode | Desktop Supabase mode |
|------|-------------------|-----------------------|
| `LedgerRepository.summary("par-003")` | calls `computeParentSummary` → returns correct `totalOutstanding`, `totalOverdue` (computed from latest charge per account vs now), `totalCleared` (sum of `paymentStatus='paid'` entries), `totalPending` (sum of `paymentStatus='pending'`), `totalUnallocatedCredit` (sum of `parent_credit` adjustments), `accounts: [per-account balances]` | naive Σ amounts. `totalOverdue: 0`. `totalCleared: totalPaid` (ignores `paymentStatus`). `totalPending: 0`. `totalUnallocatedCredit: 0`. `accounts: []`. Outstanding formula double-counts positive adjustments. |
| `LedgerRepository.reconcile()` | runs all 6 cross-checks (duplicate IDs, required fields, signed-amount, account IDs, reversal integrity, duplicate receipts, tenant consistency, payment/installment cross-checks, balance sum, **installment-payments backing, cleared-balance, parent-credit backing**) | returns empty report. No checks run. |
| `PaymentRepository.collect(input)` | calls `collectPayment` → writes payment row + ledger entry + runs waterfall allocator + writes `parent_credit` adjustment on overpayment + audit | calls `upsert_payment_from_import` RPC → inserts payment row + ledger entry. No waterfall. No parent_credit. No audit. |
| `PaymentRepository.refund(id)` | calls `refundPayment` → updates payment status + writes reversal entry + runs LIFO revert + audit | calls `revert_payment_allocation` RPC (the atomic one) → does the right thing server-side. |
| `PaymentRepository.adjust(...)` | calls `adjustAccount` → writes adjustment ledger entry + audit | `Err("not implemented")` |
| `PaymentRepository.generateReceipt(paymentId)` | calls `generateReceiptForPayment` → returns Receipt with mock URL | `Err("not implemented")` |
| `PaymentRepository.appendManualCharge(...)` | calls `appendManualCharge` → writes charge via `buildAdditionalServiceCharge` + audit | `Err("not implemented")` |
| `InstallmentRepository.markPaid(id, paymentId)` | calls `markInstallmentPaid` → sets `amountPaid = amountDue`, `paidDate = now`, `status = 'paid'` | direct UPDATE installments SET status='paid', paid_date=now() — does NOT touch `amount_paid`. So tranche shows `status='paid'` with stale `amount_paid`. |
| `InstallmentRepository.allocatePayment(...)` | calls `allocatePaymentAcrossInstallments` → runs the waterfall + persists allocations + audit | `Ok({ allocations: [], unallocatedAmount: 0, allocatedAmount: 0 })` — no-op stub |
| `InstallmentRepository.regenerateForCycle(...)` | calls `regenerateInstallmentsForCycle` → re-derives due dates from `getOfficialTuitionDueDates` | `Err("not implemented")` |

**Result**: switching from Mock mode to Supabase mode on the desktop changes the displayed `totalOutstanding`, `totalOverdue`, `totalCleared`, `totalPending`, `totalUnallocatedCredit`, all cross-check results, and the entire payment-collection workflow — without any code change at the call site.

### Scenario B — Android collect vs Desktop collect (same parent, same operation)

Parent pays 150,000 DZD cash for tuition where outstanding is 100,000 DZD (50,000 overpayment).

| Step | Desktop Mock | Android Local |
|------|--------------|---------------|
| Generate payment row | `pay-${seq}`, `REC-${year}-${seq padded 6}` | `pay-${UUID}`, `REC-${year}-${seq padded 6}` |
| Determine status | `status = method === "cash" ? "paid" : "pending"` ✓ | `status = if (input.method == PaymentMethod.CASH) PaymentStatus.PAID else PaymentStatus.PENDING` ✓ |
| Append payment ledger entry | `createPaymentEntry(...)` with `paymentStatus = status` ✓ | `createPaymentEntry(...)` with `paymentStatus = status` ✓ |
| Run waterfall | `allocatePaymentAcrossInstallments(ctx, parentId, amount, paymentId, category, actorId, "Session courante", status)` — branches on `paymentStatus` (paid → amountPaid; pending → amountPending + status='pending_clearance') | `allocatePaymentToInstallments(familyInstallments, paymentAmount, categoryFilter, paymentStatus)` — same branching ✓ |
| Write parent_credit on overpayment | `createAdjustmentEntry(category: "parent_credit", studentId: null, accountId: parent:X:category:parent_credit, amount: -unallocated, sourceType: "adjustment", ...)` | `createAdjustmentEntry(category = input.category /* e.g. "tuition" */, studentId = input.studentId /* NOT null */, amount = -unallocated, sourceType = LedgerSourceType.ADJUSTMENT, ...)` — **WRONG account, wrong category, wrong studentId** |
| Audit | structured `before/after` JSON with `{amount, method, receipt, ledgerEntryId, status, allocations, unallocatedCredit}` | `audit("payment.collect", "payment", paymentId, actorId, actorName, after = """{"receipt":"...","amount":...,"method":"..."}""")` — flat JSON string, no before/after structure |
| Sync push to Supabase | not applicable (mock mode) | NOT performed — `LocalPaymentRepository.collect` doesn't call `syncService.enqueue` |
| Atomicity | in-memory (no transaction) | in-memory (no transaction) — but the canonical atomic RPC `collect_and_allocate_payment` (migration 0026) is unused by BOTH the desktop's Supabase `collect()` (uses `upsert_payment_from_import` instead) AND Android |

**Result**: the overpayment credit ends up on `parent:X:category:tuition:student:Y` (Android) vs `parent:X:category:parent_credit` (Desktop). When the desktop syncs Android's credit back via `pull_ledger_entries_for_sync`, the desktop's `computeAccountBalance` would NOT pick it up in `unallocatedCredit` (which only sums `category === "parent_credit"`), and `crossCheckParentCredit` would flag it as `UNBACKED_PARENT_CREDIT`. **But this scenario is unreachable in practice** because Android never pushes the credit to Supabase (D40).

### Scenario C — Sync push round-trip (latent bug, currently unreachable)

If Android WERE to push a 150,000 DZD cash payment via `SyncQueueDispatcher.pushPayment()`:

1. Android `Payment` domain has `amount: 15_000_000L` (Long centimes).
2. `SyncService.enqueue` serializes the payment as JSON: `{"amount": 15000000, ...}`.
3. `SyncQueueDispatcher.pushPayment` reads `p.str("amount")?.toDoubleOrNull()` → `15000000.0` (Double, no /100 conversion).
4. RPC `upsert_payment_from_import(p_amount := 15000000.0, ...)` stores `amount = 15000000.00` in `numeric(12,2)` (DZD).
5. Desktop's `pull_payments_for_sync` returns `amount = 15000000.00`.
6. Desktop's `mapPaymentRow` does `amount: Number(r.amount)` → `15000000` in domain.
7. Desktop UI displays "Paiement: 15,000,000 DZD" for what Android meant as 150,000 DZD.

**100× inflation.** Latent — currently unreachable because Android never enqueues payments (D40). But the moment anyone wires `SyncSupport` into `LocalPaymentRepository`, this bug fires on every payment.

### Scenario D — Android pull → crash on parent_credit

If desktop creates a 50,000 DZD overpayment (correctly producing a `parent_credit` adjustment) and Android pulls it:

1. Desktop writes ledger entry: `category='parent_credit'`, `payment_status=null`, `amount=-50000.00`.
2. Android `PullSyncRepository.pullLedgerEntries` calls `pull_ledger_entries_for_sync` RPC → receives `LedgerEntryDto(category="parent_credit", ...)`.
3. `LedgerEntryDto.toEntity()` stores raw `category="parent_credit"` in `LedgerEntryEntity.category` (no validation).
4. Later, when Android's `LocalDebtRepository.observeParentProfile` calls `LedgerEngine.computeParentSummary(ledgerEntries.map { LocalMappers.run { it.toDomain() } }, ...)`, the `LedgerEntryEntity.toDomain()` invokes `PaymentCategory.fromCode("parent_credit")` which throws `IllegalArgumentException("Unknown PaymentCategory: parent_credit")`.
5. The exception propagates up through the Flow, and the parent profile screen shows nothing or crashes.

**Same applies to any ledger entry with `category` ∈ {`therapy_psychology`, `therapy_speech`, `second_apron`} or `payment_status` ∈ {`pending_clearance`, `unpaid`}** — i.e. every category/status the unified architecture added that Android didn't.

---

## 4. Categorization of root causes

The discrepancies fall into 5 root-cause buckets:

### RC1 — Android lags one architectural iteration behind desktop
The desktop went through the "Unified Financial Architecture" refactor (Epic 1–8 in `financial-refactor.md`). Android was synced on infrastructure (FCM, pull sync, displayName) but never on the financial domain layer. Symptoms: D1, D2, D5, D6, D7, D8, D11, D12, D13, D14, D15.

### RC2 — Android has the wrong implementation, not just missing pieces
Android implements the overpayment credit flow (D3), the refund LIFO (D4), and the batchRegister billing (D37, D38) — but each implements a SIMPLER, older version of what desktop does. These aren't "missing features"; they're "implemented differently in a way that produces different state".

### RC3 — Desktop's Supabase mode is a stub
The desktop's `MockLedgerRepository` / `MockPaymentRepository` / `MockInstallmentRepository` / `MockDebtRepository` correctly call the canonical calc engine. But `SupabaseLedgerRepository` / `SupabasePaymentRepository` / `SupabaseInstallmentRepository` / `SupabaseDebtRepository` are stubs that return hardcoded zeros or `Err("not implemented")`. The desktop is internally inconsistent: the same call site produces wildly different results depending on whether Supabase is configured. Symptoms: D19–D31.

### RC4 — Android's sync-push side is wired but disconnected
`SyncSupport`, `SyncService`, `SyncQueueDispatcher` all exist with full implementations. But none of the Local*Repository classes inject them. So Android's financial writes are local-only. The "shared unification" doc claims bidirectional sync; in practice it's desktop→android one-way. Symptoms: D39–D43, D48.

### RC5 — Latent bugs in Android sync dispatcher
Even if Android were to wire sync push, the dispatcher has bugs: 100× amount inflation (no centimes-to-DZD conversion), missing `p_installment_id`, missing check/transfer metadata, missing `p_metadata`. These are unreachable today but would activate the moment the sync push is connected. Symptoms: D44–D47.

### RC6 — Android data display fabricates numbers
`LocalDashboardRepository` has hardcoded fallback values (390 students, 185 parents, 96.5% attendance, 13.4M DZD monthly revenue) when Room is empty. The desktop never fabricates — its mock store seeds real (though incorrect — see D32) data. Symptoms: D54, D55.

### RC7 — Random identity generation
Android's `batchRegister` uses `UUID.randomUUID()` and `random()` for `parent_code` and `activation_code`. Desktop's `createParent` uses deterministic FNV-1a hash. Even if Android pushed, idempotency would break. Symptoms: D35, D36.

### RC8 — Per-tranche discount application (desktop seed bug)
The desktop's `buildSeedLedger()` STILL applies the sibling discount per-tranche — the exact bug the unified refactor's `computeBilling` was supposed to eliminate. So the desktop's seed state is internally inconsistent with the desktop's interactive billing state. Symptoms: D32.

---

## 5. Concrete impact summary

### What this means for the user

1. **Switching the desktop from Mock to Supabase mode changes all displayed financial totals** — `totalOutstanding`, `totalOverdue`, `totalCleared`, `totalPending`, `totalUnallocatedCredit` — without any user action. The desktop's own UI is unreliable depending on backend config.

2. **The atomic RPC `collect_and_allocate_payment` (migration 0026) is dead code on desktop** — the desktop's `SupabasePaymentRepository.collect()` calls the simpler `upsert_payment_from_import` RPC instead. The waterfall + parent_credit + audit transaction the migration defines is never invoked by the desktop client. Only `revert_payment_allocation` IS used (by `SupabasePaymentRepository.refund`).

3. **Android is read-only relative to Supabase for financial tables** — every payment, ledger entry, installment, and adjustment Android writes stays in Room. The desktop never sees them. The "shared backend" is one-directional.

4. **Android crashes on any desktop-originated `parent_credit` / `therapy_*` / `pending_clearance` / `unpaid` row** — the moment Android's UI tries to display a parent profile whose ledger has any of these categories/statuses, `PaymentCategory.fromCode` throws and the screen breaks.

5. **Android's dashboard fabricates numbers when Room is empty** — 390 students, 96.5% attendance, 13.4M DZD monthly revenue. Not real data, just hardcoded fallbacks.

6. **Sibling discount is triple-counted on desktop mock seed** — every multi-child family in the desktop's mock seed state has 3× the intended sibling discount applied. `computeBilling` (interactive batch-registration) does it correctly; `buildSeedLedger` (initial state) does it wrong. Different code paths, different math.

7. **Same parent, same operation, different ledger state** — A 50,000 DZD overpayment on desktop mock produces a `parent_credit` adjustment on `parent:X:category:parent_credit` with `studentId=null`. The same operation on Android produces a `tuition` adjustment on `parent:X:category:tuition:student:Y` with `studentId=studentId`. The two ledger rows have different `accountId`, different `category`, different `studentId` — they don't even live in the same account.

8. **`SupabaseInstallmentRepository.markPaid` corrupts installment state** — it sets `status='paid'` without incrementing `amount_paid`. So a tranche shows `status='paid'` with `amount_paid=0`. The canonical invariant "amountPaid >= amountDue" is silently violated. The reconciler that would catch this (crossCheckInstallmentPayments) is never run in Supabase mode.

---

## 6. Recommendations (prioritized by impact)

### Tier 1 — Critical (blocks any chance of cross-app consistency)

| # | Action |
|---|--------|
| R1 | **Make desktop's Supabase repositories call the canonical calc engine.** Replace `SupabaseLedgerRepository.summary()`'s naive Σ with `computeParentSummary`. Replace `reconcile()`'s empty-report with `reconcileLedger` + 6 cross-checks. Wire `SupabasePaymentRepository.collect()` to call the atomic `collect_and_allocate_payment` RPC (migration 0026). Implement `adjust()`, `generateReceipt()`, `appendManualCharge()`. Fix `markPaid()` to also increment `amount_paid`. Implement `allocatePayment()` to actually run the waterfall. Implement `regenerateForCycle()` and `updateDueDate()`. |
| R2 | **Add 4 missing `PaymentCategory` values + 2 missing `PaymentStatus` values to Android's `core/Ledger.kt`.** Make `fromCode` return a sentinel `OTHER` / default instead of throwing, so future desktop additions don't crash Android. |
| R3 | **Add `unallocatedCredit` to Android's `AccountBalance` and `totalUnallocatedCredit` to `ParentLedgerSummary`.** Update `LedgerEngine.computeAccountBalance` to sum `parent_credit` adjustments separately. |
| R4 | **Fix Android's `LocalPaymentRepository.collect` overpayment path** to write the credit on `category = PaymentCategory.PARENT_CREDIT`, `studentId = null`, `accountId = deriveAccountId(parentId, PaymentCategory.PARENT_CREDIT, null)`. Same fix in `DatabaseSeeder.seedDemoPayment`. |
| R5 | **Fix Android's `LocalPaymentRepository.refund` to pass `originalWasPending = (originalLedger.paymentStatus == PaymentStatus.PENDING)`.** |
| R6 | **Port the 5-rule discount engine + master `evaluateAllSystemDiscounts` + `sumDiscounts` to a new `core/DiscountEngine.kt` on Android.** Replace the inline sibling-only logic in `LocalStudentRepository.batchRegister` and `DatabaseSeeder.seedLedgerForFamily`. |
| R7 | **Wire Android's `SyncSupport` into `LocalPaymentRepository`, `LocalLedgerRepository`, `LocalInstallmentRepository`, `LocalStudentRepository` constructors** so writes propagate to Supabase. |
| R8 | **Fix `SyncQueueDispatcher.pushPayment` and `pushLedgerEntry` to convert centimes → DZD** before sending to the RPC: `put("p_amount", (p.str("amount")?.toLongOrNull() ?: 0L) / 100.0)`. Add `p_installment_id`, `p_check_*`, `p_transfer_*`, `p_metadata` to the push payloads. |

### Tier 2 — High-impact (closes most of the remaining divergence)

| # | Action |
|---|--------|
| R9 | Port the charge builders (`buildTuitionChargeEntries`, `buildTransportChargeEntriesForDestination`, `buildClubEnrollmentCharge`, `buildTherapyCharge`, `buildAdditionalServiceCharge`) to Android so the same category/metadata-rich charge entries are produced. |
| R10 | Port the 3 missing reconciler cross-checks (`crossCheckInstallmentPayments`, `crossCheckClearedBalance`, `crossCheckParentCredit`) and their 3 violation codes to Android. Wire them into `LocalLedgerRepository.reconcile()`. |
| R11 | Add `metadata` column to Android `LedgerEntryEntity` (TEXT/JSON) and update mappers + DAOs. |
| R12 | Add `paymentPlan` to Android `Student` + `StudentEntity` + `StudentDto.toEntity()` mapping. Add `amountPending` to domain `Installment` and update `InstallmentEntity.toDomain()`. |
| R13 | Add `expectedAmount`, `excessAmount`, `excessRemark` to Android `Payment` domain + `PaymentEntity` + `PaymentDto`. |
| R14 | Align `createRefundEntry` and `createAdjustmentEntry` field semantics between desktop and Android (null `method` and `paymentStatus` for refund; parameterized `sourceType` for adjustment). |
| R15 | Replace Android's `batchRegister` random `parent_code` with a deterministic FNV-1a hash like desktop's `deterministicParentCode`. Replace random `activationCode` with a deterministic derivation. |
| R16 | Fix Android's `LocalDashboardRepository.observeKpis()` to call `LedgerEngine.computeParentSummary` / `totalOutstandingAcrossAccounts` instead of naive Σ amounts. Remove the hardcoded fallback values (390 students, 96.5%, etc.). Remove the hardcoded fake 12-month revenue. |
| R17 | Fix desktop's `buildSeedLedger()` to apply the sibling discount ONCE on the gross annual (via `evaluateAllSystemDiscounts`), then split via `splitNetTuitionByOfficialSchedule` — exactly what `computeBilling` does. |
| R18 | Add `adjustments` field to Android's `ParentFinancialProfile` and populate it from `LedgerEngine`. |
| R19 | Add upper bound (`< nextMonthStart`) to Android's `monthlyRevenue` filter in `LocalDashboardRepository.observeKpis()`. |
| R20 | Implement `LocalExpenseRepository.settleProof` to actually persist `finalAmount`. |
| R21 | Fix `LocalAuditRepository.log()` to use the real `actorId` / `actorName` from `AuditLogInput` instead of hardcoding "system". Implement `LocalAuditRepository.query()`. |

### Tier 3 — UI parity

| # | Action |
|---|--------|
| R22 | Port desktop's `AdaptivePaymentSlider` to Android (3 modes, REMAINING-balance snap points, magnetic snap, per-tranche preview, overpayment credit display, `allowPartial` flag). Replace the basic `Slider` in `CounterPaymentScreen`. |
| R23 | Port desktop's `UnifiedDebtMeter` (with `unallocatedCredit` row) to Android. |
| R24 | Add `parent_credit` adjustment seeding to desktop's `buildSeedLedger()` so the canonical overpayment flow is exercised in mock mode. |

---

## 7. Files touched (for traceability)

### Desktop files inspected (this audit)
- `docs/project-specification/07-financial-engine.md`
- `docs/development/financial-refactor.md`
- `docs/development/shared-unification.md`
- `supabase/migrations/0007_financial.sql`
- `supabase/migrations/0025_waterfall_allocation.sql`
- `supabase/migrations/0026_unified_financial.sql`
- `supabase/migrations/0027_shared_unification.sql`
- `supabase/migrations/0028_shared_schema_extensions.sql`
- `supabase/migrations/0032_installments_bulk_import_support.sql`
- `supabase/migrations/0033_payment_allocations.sql`
- `src/domain/model/payment.ts`
- `src/domain/model/ledger.ts`
- `src/domain/calc/ledger/balance.ts`
- `src/domain/calc/ledger/entries.ts`
- `src/domain/calc/ledger/account-id.ts`
- `src/domain/calc/ledger/charges.ts`
- `src/domain/calc/ledger/overdue.ts`
- `src/domain/calc/ledger/non-tuition-charges.ts`
- `src/domain/calc/payment/waterfall-allocator.ts`
- `src/domain/calc/payment/lifo-reversal.ts`
- `src/domain/calc/payment/sums.ts`
- `src/domain/calc/payment/queries.ts`
- `src/domain/calc/payment/revenue.ts`
- `src/domain/calc/pricing/tuition.ts`
- `src/domain/calc/pricing/discount-engine.ts`
- `src/domain/calc/pricing/discount-rules.ts`
- `src/domain/calc/reconcile/index.ts`
- `src/domain/calc/reconcile/checks.ts`
- `src/domain/calc/reconcile/cross-checks.ts`
- `src/infrastructure/mock/repositories/ledger-repository.ts`
- `src/infrastructure/mock/repositories/financial/payment-ops.ts`
- `src/infrastructure/mock/repositories/financial/installment-ops.ts`
- `src/infrastructure/mock/repositories/financial/charge-ops.ts`
- `src/infrastructure/mock/repositories/financial/types.ts`
- `src/infrastructure/mock/repositories/mock-store.ts`
- `src/infrastructure/mock/ledger-seed.ts`
- `src/infrastructure/supabase/repositories/supabase-shared-repositories.ts`
- `src/features/crm/batch-registration/compute-billing.ts`
- `src/features/financials/payment-slider.tsx`
- `src/features/financials/debt-meter.tsx`

### Android files inspected (this audit)
- `app/src/main/java/com/example/core/Ledger.kt`
- `app/src/main/java/com/example/core/LedgerEngine.kt`
- `app/src/main/java/com/example/core/LedgerEntryFactory.kt`
- `app/src/main/java/com/example/core/AccountBalance.kt`
- `app/src/main/java/com/example/core/WaterfallAllocation.kt`
- `app/src/main/java/com/example/core/ParentLedgerSummary.kt`
- `app/src/main/java/com/example/core/Pricing.kt`
- `app/src/main/java/com/example/core/Reconcile.kt`
- `app/src/main/java/com/example/domain/model/Payment.kt`
- `app/src/main/java/com/example/domain/model/Installment.kt`
- `app/src/main/java/com/example/domain/model/Student.kt`
- `app/src/main/java/com/example/domain/model/PricingConfig.kt`
- `app/src/main/java/com/example/domain/model/DebtSummary.kt`
- `app/src/main/java/com/example/domain/model/GradeLevelTuition.kt`
- `app/src/main/java/com/example/domain/repository/PaymentRepository.kt`
- `app/src/main/java/com/example/domain/repository/InstallmentRepository.kt`
- `app/src/main/java/com/example/domain/repository/LedgerRepository.kt`
- `app/src/main/java/com/example/domain/repository/DebtRepository.kt`
- `app/src/main/java/com/example/infrastructure/room/Entities.kt`
- `app/src/main/java/com/example/infrastructure/room/LocalEntities.kt`
- `app/src/main/java/com/example/infrastructure/room/LocalMappers.kt`
- `app/src/main/java/com/example/infrastructure/room/CacheMappers.kt`
- `app/src/main/java/com/example/infrastructure/room/DatabaseSeeder.kt`
- `app/src/main/java/com/example/infrastructure/local/LocalRepositories.kt`
- `app/src/main/java/com/example/infrastructure/local/LocalRepositories2.kt`
- `app/src/main/java/com/example/infrastructure/supabase/SharedDtos.kt`
- `app/src/main/java/com/example/infrastructure/supabase/SharedDtoMappers.kt`
- `app/src/main/java/com/example/infrastructure/sync/PullSyncRepository.kt`
- `app/src/main/java/com/example/infrastructure/sync/SyncQueueDispatcher.kt`
- `app/src/main/java/com/example/infrastructure/sync/SyncService.kt`
- `app/src/main/java/com/example/infrastructure/sync/SyncSupport.kt`
- `app/src/main/java/com/example/infrastructure/stub/StubRepositories.kt`
- `app/src/main/java/com/example/ui/features/financials/CounterPaymentScreen.kt`
- `app/src/main/java/com/example/ui/features/crm/BatchRegistrationViewModel.kt`
