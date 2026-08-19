# Canonical Financial & Business Logic — El-Imtiyaz

**Version:** 1.0
**Status:** Authoritative. Both the desktop (TypeScript / Electron / React) and Android (Kotlin / Compose / Room) implementations MUST conform to the rules in this document.
**Supersedes:** any prior in-tree or branch-local interpretation. When a code path diverges from this document, this document wins and the code is wrong.

This document is intentionally framework-agnostic. It defines **what** the system does, not **how** a specific stack implements it. Each repository ships an identical copy of this file so that engineers on either side can refer to the same source of truth.

---

## 1. Domain Overview

El-Imtiyaz is a private school management system with two client applications (Desktop and Android) reading from / writing to a shared Supabase/PostgreSQL backend.

The financial domain models a family (parent) with one or more enrolled children (students). Each student incurs **charges** (tuition, transport, canteen, uniform, books, extracurricular, therapy). Parents make **payments** against those charges. The system tracks every monetary movement as an immutable **ledger entry** with a signed amount.

**Signed-amount convention** (identical on both apps):
| Entry type     | Amount sign | Meaning                              |
|----------------|-------------|--------------------------------------|
| `charge`        | `+`         | Parent owes more                     |
| `payment`       | `-`         | Money received from parent            |
| `refund`        | `-`         | Money returned to parent              |
| `adjustment`    | `+` or `-`  | Debit (+) or credit (−)               |
| `reversal`      | `-original` | Negates a prior entry                 |
| `transfer`      | net zero    | Intra-account move                    |

All money is stored in **centimes (Long)** in the Android app and **DZD (number)** in the desktop domain layer. Conversion: `centimes = round(dzd × 100)`. Sub-centime values are forbidden; charge builders must round to the nearest centime before persisting.

---

## 2. Canonical Enums

### 2.1 `PaymentCategory` (11 values, wire codes)

```text
tuition, transport, canteen, uniform, books,
extracurricular, parent_credit,
therapy_psychology, therapy_speech, second_apron,
other
```

**Behavioral rule:** `PaymentCategory.fromCode(code)` MUST be **total** — when given an unknown string it MUST fall back to `other` (or a nullable `null` sentinel), NEVER throw. This is so that adding a new category in a future migration does not crash clients that haven't yet been updated.

### 2.2 `PaymentMethod` (3 values)

```text
cash, check, transfer
```

`requiresProof := (method != cash)`. Only these three are legal tender; nothing else may appear in the `method` column of a payment row.

### 2.3 `PaymentStatus` (8 values)

```text
paid, pending, partial, overdue, refunded, cancelled,
pending_clearance, unpaid
```

| Code                | When used                                                                                          |
|---------------------|----------------------------------------------------------------------------------------------------|
| `paid`              | A payment whose funds have cleared (cash, or check/transfer after bank clearance).                |
| `pending`           | A check/transfer payment that has not yet cleared.                                                  |
| `partial`           | An installment whose `amountPaid > 0` and `amountPaid < amountDue`.                                 |
| `overdue`           | An installment whose `amountDue > 0`, `amountPaid = 0`, and `dueDate < now`.                        |
| `refunded`          | A payment that has been reversed via the refund workflow.                                          |
| `cancelled`         | A payment that has been administratively voided (distinct from refunded).                          |
| `pending_clearance` | An installment that has a pending (uncleared) payment allocation but no cleared funds yet.         |
| `unpaid`            | An installment that has no payment activity and is not yet overdue (e.g., due date in the future). |

**Behavioral rule:** same as `PaymentCategory` — `fromCode` MUST be total, falling back to `null` (NOT throwing) on unknown codes.

### 2.4 `LedgerEntryType` (6 values)

```text
charge, payment, adjustment, refund, reversal, transfer
```

### 2.5 `LedgerSourceType` (7 values)

```text
installment, payment, expense, adjustment, refund, bulk_import, manual_entry
```

### 2.6 `PaymentPlan` (2 values)

```text
full_annual, tranches
```

A student on `full_annual` is billed as a single charge; a student on `tranches` is billed as 3 charges due Sept 15 / Dec 15 / Mar 15.

---

## 3. Account IDs

The `accountId` string is derived, never stored as a separate column in a separate table:

```text
deriveAccountId(parentId, category, studentId?) =
  "parent:" + parentId + ":category:" + category.code
  + (studentId != null ? ":student:" + studentId : "")
```

**Special case — `parent_credit`:** the overpayment credit account is parent-scoped, NOT student-scoped:

```text
deriveAccountId(parentId, parent_credit, null) = "parent:{parentId}:category:parent_credit"
```

A credit on a student-scoped account (e.g. `parent:X:category:tuition:student:Y`) is **a bug**, not a partial state. The canonical overpayment flow ALWAYS writes `category=parent_credit, studentId=null, accountId=parent:X:category:parent_credit`.

---

## 4. The 10 Canonical Invariants

These are the rules every operation MUST preserve. If any operation would violate one, the operation is invalid and must be rejected before commit.

### INV-1 — Balance is computed, never stored

```text
accountBalance = Σ entries.amount where (e.accountId = accountId) AND (e.at <= now) AND (e is NOT a reversed original)
```

The reversed-original entries still contribute their signed `amount` to the running balance (because the reversal entry already negates them); they are only excluded from the *typed totals* (`totalCharged`, `totalPaid`, etc.) so the totals stay auditable as gross activity.

There is **no `balance` column** in any table. Any UI surface that displays a balance MUST call `computeAccountBalance` (single account) or `computeParentSummary` (parent aggregate). Hardcoding the formula in 2+ places is forbidden.

### INV-2 — Typed totals exclude reversed originals

```text
totalCharged = Σ entries.amount where type=charge AND NOT reversed
totalPaid    = Σ |entries.amount| where type=payment AND NOT reversed
totalRefunded = Σ |entries.amount| where type=refund AND NOT reversed
totalAdjusted = Σ entries.amount where type=adjustment AND NOT reversed
totalCleared = Σ |entries.amount| where type=payment AND paymentStatus=paid AND NOT reversed
totalPending = Σ |entries.amount| where type=payment AND paymentStatus=pending AND NOT reversed
```

The **balance** still includes the reversed original (because the reversal entry's `amount = -original.amount` already nets it out).

### INV-3 — Parent credit is a separate bucket

```text
unallocatedCredit = Σ entries.amount where type=adjustment AND category=parent_credit AND NOT reversed
totalUnallocatedCredit = Σ accounts.unallocatedCredit across all parent accounts
```

`unallocatedCredit` is reported as a **negative** number (or zero). It is **always** on a `parent:X:category:parent_credit` account with `studentId=null`. A negative balance on any other account is a reconciler violation (`UNBACKED_PARENT_CREDIT`).

### INV-4 — Overdue classification

```text
account is overdue iff (balance > 0.001 DZD) AND (latestCharge.at < now) AND (overdueDueDate[accountId] < now)
```

The threshold is **0.001 DZD** (= 1 millime), NOT 1 DZD. Both implementations MUST use 0.001 DZD so a 0.5 DZD outstanding account is flagged overdue on both apps. The Android app must change its current `> 100L centimes` (= 1 DZD) threshold.

### INV-5 — Valid payments only

A "valid payment" for balance purposes is any `payment` entry whose `paymentStatus ∈ {paid, pending, partial, overdue, pending_clearance, unpaid}` AND that has not been reversed. `refunded` and `cancelled` payments are NOT valid.

A `pending` payment reduces the parent's outstanding balance **immediately** — the parent has handed over the check and the school has acknowledged it. The bank-clearance step only promotes the payment's status from `pending` → `paid`; it does NOT change the balance.

What changes during clearance:
- `totalPending` decreases by `|amount|`
- `totalCleared` increases by `|amount|`
- `installment.status` may transition `pending_clearance` → `paid` (if `amountPaid >= amountDue`)
- **`balance` does NOT change** (the payment was already counted when it was created)

### INV-6 — Waterfall allocation

When a payment is collected, the system allocates the payment amount across the family's outstanding installments **in chronological order** (oldest due-date first), filtered by category if the payment specifies one.

For a **cleared** (`paid`) payment:
```text
for each installment in (eligible, sorted by dueDate asc):
  insRemaining = max(0, amountDue - amountPaid)
  allocate = min(remaining, insRemaining)
  newAmountPaid = amountPaid + allocate
  if newAmountPaid >= amountDue: status = "paid"
  else if newAmountPaid > 0:     status = "partial"
  else if dueDate < now:         status = "overdue"
  else:                          status = "pending"
```

For a **pending** payment (check/transfer not yet cleared):
```text
for each installment in (eligible, sorted by dueDate asc):
  insRemaining = max(0, amountDue - amountPaid)
  allocate = min(remaining, insRemaining)
  newAmountPending = amountPending + allocate
  status = "pending_clearance"  // NEVER "paid" from uncleared funds
```

Any amount that cannot be absorbed by any outstanding installment becomes `unallocatedAmount` → written as a `parent_credit` adjustment entry (see INV-7).

### INV-7 — Overpayment → parent_credit

If a payment's `unallocatedAmount > 0` after the waterfall, the system writes exactly **one** adjustment entry:

```text
createAdjustmentEntry(
  category       = parent_credit,
  studentId      = null,                         // parent-scoped, NOT student-scoped
  accountId      = deriveAccountId(parentId, parent_credit, null),
  amount         = -unallocatedAmount,           // negative = credit
  sourceType     = adjustment,                   // NOT hardcoded; this is the canonical sourceType for overpayment credits
  sourceId       = originalPaymentId,
  reason         = "Crédit parent (trop-perçu) " + receiptNumber,
)
```

Any future charge against this parent will **auto-absorb** the credit by scanning `parent:X:category:parent_credit` accounts first. The auto-absorb logic:
```text
for each account where category=parent_credit AND balance < 0:
  absorbAmount = min(|account.balance|, newCharge.amount)
  write a transfer entry debiting the credit account and crediting the new charge account
```

### INV-8 — Refund = LIFO reversal

When a payment is refunded:
1. Look up the original payment's ledger entry. Determine `originalWasPending := (original.paymentStatus == pending)`.
2. Create a `reversal` entry with `amount = -original.amount, reversesId = original.id`.
3. Run a **LIFO reverse-waterfall** that branches on `originalWasPending`:
   - If `originalWasPending = true`: subtract from `installment.amountPending` (the uncleared bucket).
   - If `originalWasPending = false`: subtract from `installment.amountPaid` (the cleared bucket).
4. Re-evaluate each affected installment's status (`paid → partial`, `partial → pending`, etc.).
5. Mark the payment row as `status = refunded`.

**Critical:** if `originalWasPending` is not passed, the default `false` causes uncleared refunds to subtract from `amountPaid` (which is 0 for an uncleared payment), so the revert is a silent no-op and `amountPending` stays inflated. Both apps MUST pass the correct value.

### INV-9 — Reconciliation (6 cross-checks)

The reconciler MUST run all 6 cross-checks. A reconciler that runs only 3 is broken:

1. `crossCheckPayments` — every payment row has a matching ledger entry (same `sourceId`), amounts match, statuses match. Violation codes: `PAYMENT_WITHOUT_LEDGER_ENTRY`, `PAYMENT_AMOUNT_MISMATCH`, `PAYMENT_STATUS_MISMATCH`.
2. `crossCheckInstallments` — every installment row has a matching charge entry (same `sourceId`), `amountDue` matches. Violation codes: `INSTALLMENT_WITHOUT_LEDGER_ENTRY`, `INSTALLMENT_AMOUNT_MISMATCH`.
3. `crossCheckBalanceSum` — `Σ entries.amount` equals `Σ accounts.balance`, drift ≤ 1 centime (0.01 DZD). Violation code: `BALANCE_SUM_MISMATCH`.
4. `crossCheckInstallmentPayments` — every `installment.amountPaid` is fully backed by cleared (non-reversed) payment entries. Violation code: `UNBACKED_TRANCHE_SATISFACTION`.
5. `crossCheckClearedBalance` — `Σ payments.amount where status=paid` equals `Σ |ledger payment entries| where paymentStatus=paid AND NOT reversed`. Violation code: `PAYMENT_LEDGER_MISMATCH`.
6. `crossCheckParentCredit` — every account with a negative balance has `category=parent_credit` and a corresponding `parent_credit` adjustment entry. Violation code: `UNBACKED_PARENT_CREDIT`.

### INV-10 — Single source of truth

For any derived financial value, exactly one function/SQL view is canonical:

| Derived value                | Canonical source                                                              |
|------------------------------|--------------------------------------------------------------------------------|
| Account balance              | `computeAccountBalance(entries, accountId)`                                   |
| Parent summary               | `computeParentSummary(entries, parentId, parentName, overdueDueDates)`        |
| Installment allocation       | `allocatePaymentToInstallments(installments, amount, categoryFilter, status)` |
| Installment revert           | `revertPaymentAllocation(installments, amount, categoryFilter, originalWasPending)` |
| Family-level discount        | `evaluateAllSystemDiscounts(student, family, config, academicYear)`          |
| Tenant-wide outstanding      | `totalOutstandingAcrossAccounts(entries)`                                      |
| Reconciliation report        | `reconcileLedger(entries, crossCheckInputs)`                                   |

Any code path that computes the same value with a different formula is a bug. Replace the duplicate; do not leave both.

---

## 5. The 5-Rule Discount Engine

Discounts are applied **once on the gross annual tuition**, then the net is split into 3 tranches via `splitNetTuitionByOfficialSchedule`. Applying a discount per-tranche (3 times) is a bug — that triples the discount.

```text
gross = tuition.annual  (per student, by grade level)
discounts = evaluateAllSystemDiscounts(student, family, config, academicYear)
net = gross + Σ(discounts.amount)  // discounts are negative
(t1, t2, t3) = splitNetTuitionByOfficialSchedule(net)
  // t1 = round(net * 0.40), t2 = round(net * 0.30), t3 = net - t1 - t2
```

The 5 rules, evaluated in this order:

| # | Code             | Condition                                                                 | Amount                       |
|---|------------------|---------------------------------------------------------------------------|------------------------------|
| 1 | `passage_palier` | Student's previous grade was `5ap` and current is `1am` OR `4am` → `1ere_annee` | −10,000 DZD (fixed)         |
| 2 | `sibling_fixed`  | Student has siblings in the same family also enrolled this year           | −5,000 DZD × (childrenCount − 1) |
| 3 | `full_annual`    | `student.paymentPlan == full_annual` AND payment date ≤ June 30 of start year | −10% of gross (percentage) |
| 4 | `highest_average`| Student was rank 1 in their previous palier last year                    | −10% of gross (percentage)   |
| 5 | `seniority_5y`   | Student has been enrolled ≥ 5 years before academic year start            | −5% of gross (percentage)   |

**Ordering matters:** percentage discounts are applied to the gross (pre-discount) amount, not to the running total. A student qualifying for `full_annual` + `highest_average` + `seniority_5y` gets −10% −10% −5% of gross (sum of percentages × gross), not compounding.

A student who qualifies for all 5 rules and pays early annual:
```text
gross = 330,000 DZD
passage_palier  = -10,000 DZD
sibling_fixed   = -5,000 DZD (1 sibling)
full_annual     = -33,000 DZD (10% of 330k)
highest_average = -33,000 DZD (10% of 330k)
seniority_5y    = -16,500 DZD (5% of 330k)
net = 330,000 - 10,000 - 5,000 - 33,000 - 33,000 - 16,500 = 232,500 DZD
(t1, t2, t3) = (93,000, 69,750, 69,750)
```

---

## 6. Charge Entry Builders

Charge entries are produced by **named builders**, not inline factories:

### 6.1 `buildTuitionChargeEntries(parent, student, pricingConfig, academicYear)`

Branches on `student.paymentPlan`:
- `full_annual`: emits **1** charge entry with `metadata: { tranche: null, paymentPlan: "full_annual", academicCycle, gradeLevel }`.
- `tranches`: emits **3** charge entries (one per tranche) with `metadata: { tranche: 1|2|3, paymentPlan: "tranches", academicCycle, gradeLevel, dueDate }`.

The `amount` on each charge entry is the tranche amount from `splitNetTuitionByOfficialSchedule(netAnnual)`, after discounts.

### 6.2 `buildTransportChargeEntry(parent, student, pricingConfig)`

Emits 1 or 3 transport charges per the official transport schedule. Tranche amounts come from `TransportPricing.tranche1/2/3` (NOT split by 40/30/30 — transport has its own zone-derived amounts).

### 6.3 `buildClubEnrollmentCharge(enrollment)`

Emits an `extracurricular` charge with `metadata: { clubCategory, clubName, pricingSource: "club_pricing" }`.

### 6.4 `buildTherapyCharge(therapy)`

Emits a `therapy_psychology` or `therapy_speech` charge (the actual category depends on `therapy.kind`) with `metadata: { therapyKind, sessionCount, period, pricingSource: "therapy_pricing" }`.

### 6.5 `buildAdditionalServiceCharge(service)`

Emits a `canteen`, `uniform`, `books`, or `second_apron` charge (the category depends on `service.kind`) with `metadata: { serviceQualifier, pricingSource: "additional_service_pricing" }`.

---

## 7. Lifecycle Rules

### 7.1 Student / Parent

- **`parent_code`** MUST be deterministic — derived from a hash of identity fields (first name + last name + primary phone + year). Both apps use FNV-1a hash of `(year, firstName, lastName, phone)`, formatted `PAR-{year}-{4-char-hash}`. Random `parent_code` breaks idempotency: re-registrations and sync retries would create duplicates.
- **`activation_code`** MUST also be deterministic — derived from a hash of `(parent_code, parent.tenantId)`, formatted as a 6-digit numeric string.
- A parent can be created standalone or as part of a batch registration (parent + N students + their charges + installments in one transaction).
- Soft delete only: `isActive = false`. Never hard-delete a parent with ledger entries — the ledger is immutable.
- A student's `paymentPlan` is set at enrollment. Changing it later requires re-generating the tuition charges (which itself requires reversing the old charges and writing new ones — see Reversal workflow).

### 7.2 Payment

- A payment row has a unique `receiptNumber` formatted `REC-{year}-{6-digit-seq}`. The sequence is per-tenant per-year.
- A payment's initial status is:
  - `paid` if `method == cash`
  - `pending` if `method ∈ {check, transfer}`
- A pending payment can transition to `paid` via a clearance event (manual or scheduled). It cannot transition back to `pending`.
- A payment can be `refunded` (which writes a reversal entry + LIFO revert) or `cancelled` (administrative void — no reversal entry, just a status flag).
- A refunded payment cannot be un-refunded. To "undo" a refund, write a new compensating payment + adjustment — never mutate the refund row.

### 7.3 Installment

- An installment row has `(parentId, studentId, category, trancheNumber)` as its identity. Re-importing the same family for the same year hits the same rows.
- `amountDue` is immutable once written. To change the price, write an `adjustment` entry (NOT mutate `amountDue`).
- `amountPaid` and `amountPending` are derived ONLY by replaying ledger payment entries against the installment's account. Any code that mutates `amountPaid` directly (e.g. `UPDATE installments SET amount_paid = amount_paid + X`) MUST be paired with a corresponding ledger payment entry — otherwise INV-1 is violated.
- `status` transitions:
  - `unpaid → pending → partial → paid` (forward)
  - `paid → partial` (when a refund reverts allocation) — backward transitions are allowed only via the refund workflow
  - `pending → pending_clearance` (when a check/transfer is allocated to it)
  - `pending_clearance → paid` (when the check clears)
  - `pending_clearance → pending` (when the check bounces — refund workflow)

### 7.4 Receipt

- A receipt is a **derived** view of one payment: it shows `receiptNumber`, `parentName`, `amount`, `method`, `date`, `collectedBy`, `category`, `installmentBreakdown`.
- The receipt is regenerated from the payment + ledger entry on demand. There is no `receipts` table — the `payments.receipt_number` column IS the receipt identifier.
- A receipt can be re-printed (PDF generation) at any time after the payment is created; the data is immutable from the moment the payment is collected.
- Cancelling/refunding a payment does NOT destroy the receipt — it adds a `REVERSED` watermark to any future print and the receipt shows "ANNULÉE / REMBOURSÉE" with the refund reason.

### 7.5 Ledger

- The ledger is **append-only**. The only operation that "modifies" a prior entry is writing a `reversal` entry that points to it via `reversesId`.
- Hard-delete of a ledger entry is forbidden. If an entry was written in error, write a reversal.
- Each entry carries full actor attribution: `actorId`, `actorName`, `at` (ISO-8601 with offset). Anonymous entries are forbidden (reconciler warning `MISSING_ACTOR_ID`).
- `metadata` is a JSONB column. It carries semantic context: `tranche`, `level`, `gradeLevel`, `paymentPlan`, `academicCycle`, `clubCategory`, `therapyKind`, `period`, `sessionCount`, `serviceQualifier`, `pricingSource`, `reversedEntryId`, `reason`. Dropping `metadata` on sync is forbidden.

### 7.6 Financial History

- Historical state is reconstructed by replaying the ledger at a point in time: `entries.filter { it.at <= when }`.
- Records are immutable. "Correcting" a historical entry means writing a new reversal + a new correct entry — both with `at = now`. The historical record shows the original (wrong) entry, the reversal, and the new entry, in chronological order.
- Audit log entries capture `{action, entityType, entityId, actorId, actorName, beforeJson, afterJson, note, createdAt}`. Every mutation MUST emit at least one audit entry.

---

## 8. Synchronization Rules

Both apps MUST round-trip financial operations through the shared Supabase backend:

### 8.1 Push (write) side

```text
Local write (Room / mock store)
  → SyncService.enqueue(entity, operation, payload, isMock, sourceScreen)
  → SyncQueueDispatcher drains queue
  → Calls one of the canonical upsert_*_from_import RPCs (migration 0027)
  → Supabase validates, idempotent upsert (matched by stable identifiers)
  → Returns 200/201
  → Queue entry marked "synced"
```

Stable identifiers:
- `parent` → `parent_code`
- `student` → `student_code`
- `payment` → `payment_number` (a.k.a. `receiptNumber`)
- `ledger_entry` → `(tenant_id, source_type, source_id)`

Re-pushing the same queue entry is safe — the upsert RPCs are idempotent.

### 8.2 Pull (read) side

```text
PullSyncRepository.pullAll()
  → Calls pull_*_for_sync RPCs for: parents, students, payments, ledger_entries, installments
  → Returns rows newer than the device's last sync cursor
  → Device upserts them into Room / mock store
  → Updates last sync cursor
```

Both apps MUST pull all 5 entity types. Skipping any breaks the bidirectional sync contract.

### 8.3 Unit conversion

The Android app stores money as `Long` centimes. The Supabase schema stores money as `NUMERIC(12,2)` DZD. Conversion is mandatory on both directions:

```text
Push: payload.amount = (domain.amount_in_centimes / 100.0)  // Long → Double DZD
Pull: domain.amount_in_centimes = round(dto.amount_in_dzd * 100)  // Double DZD → Long centimes
```

A push that omits the `/100.0` produces 100× inflation. A pull that omits `*100` produces 100× deflation.

### 8.4 Metadata preservation

`p_metadata` MUST be sent on every ledger_entry push. It is a JSONB object. The pull side MUST store it verbatim and the local Room entity MUST have a `metadata` TEXT column to persist it. Dropping `metadata` makes the ledger audit-blind.

### 8.5 Check / transfer metadata

For payments with `method ∈ {check, transfer}`:
- `p_check_number`, `p_check_bank_name`, `p_check_issue_date`, `p_check_clearance_date` MUST be sent when method=check.
- `p_transfer_reference`, `p_transfer_source_bank` MUST be sent when method=transfer.
- `p_installment_id` MUST be sent when the payment is allocated to a specific installment.

### 8.6 Direction-neutrality

The same operation MUST produce the same resulting database state regardless of which client initiated it:

```text
Desktop collects 5,000 DZD payment
  → Supabase: payments row + ledger_entries row + installments.amountPaid increment
  → Android pulls → Android sees the same balance, same paid state, same receipt

Android collects 5,000 DZD payment
  → Supabase: payments row + ledger_entries row + installments.amountPaid increment
  → Desktop pulls → Desktop sees the same balance, same paid state, same receipt
```

If the two directions produce different `unallocatedCredit` or different `installment.status` values, the system is broken.

---

## 9. Acceptance Checklist

A change is acceptable only if all of these hold:

- [ ] Both apps implement the same 11 `PaymentCategory` codes and the same 8 `PaymentStatus` codes.
- [ ] Both apps' `fromCode` is total — returns `other` / `null` on unknown codes, never throws.
- [ ] Both apps compute balance ONLY via `computeAccountBalance` / `computeParentSummary`.
- [ ] Both apps expose `unallocatedCredit` (per-account) and `totalUnallocatedCredit` (parent summary).
- [ ] Both apps route overpayment credits to `parent:X:category:parent_credit` with `studentId=null`.
- [ ] Both apps pass `originalWasPending` correctly in the refund LIFO revert.
- [ ] Both apps implement all 5 discount rules via `evaluateAllSystemDiscounts`.
- [ ] Both apps run all 6 reconciler cross-checks.
- [ ] Both apps pull all 5 entity types (`parents, students, payments, ledger_entries, installments`).
- [ ] Both apps convert centimes ↔ DZD correctly on push/pull (no 100× inflation).
- [ ] Both apps preserve `metadata` on ledger entries through the full sync cycle.
- [ ] Both apps use deterministic `parent_code` and `activation_code` (no `UUID.randomUUID()` for identity).
- [ ] Both apps apply discounts ONCE on gross annual (never per-tranche).
- [ ] Both apps use the same overdue threshold (0.001 DZD).
- [ ] Both apps' Supabase-backed repositories call the canonical calc engine, not naive Σ.

---

## 10. Change Log

| Version | Date       | Author          | Notes                                            |
|---------|------------|-----------------|--------------------------------------------------|
| 1.0     | 2026-08-20 | Super Z (main)  | Initial canonical spec. Both apps must conform.  |
