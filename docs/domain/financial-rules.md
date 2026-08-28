# Canonical Financial Rules

> The financial invariants of the system, reconstructed from the audited code and the (now removed) legacy `CANONICAL-FINANCIAL-LOGIC.md` spec, with §-references preserved where the audits cite them. These rules are **the** business rules: the SQL RPCs (canonical writer), the desktop TS engine (reference implementation), the Android Kotlin engine (mirror), and the website port must all satisfy them. Any behaviour change here requires an ADR and equivalence-suite runs.

## 1. Money & precision

- Currency is DZD. Desktop uses dinero.js; Android uses centime `Long`s; SQL uses numeric. Equality comparisons use a **0.001 DZD epsilon** (see overdue rule).

## 2. Identity codes — determinism (§7.1) [ADR-003]

- `parent_code` = `PAR-{year}-{4-char hash}` where the hash is **FNV-1a over the trimmed, non-empty identity fields (firstName|lastName|primaryPhone) joined by `|`** — deterministic, idempotent.
- `student_code` = `ELV-…` derived deterministically from `(parentId, displayName, firstName, lastName)`.
- Activation codes: deterministic variant is FNV-1a over `tenantId|parentCode`, mapped into a 6-digit range (canonical function `deterministicActivationCode`).
- Consequence: the same logical entity pushed/imported twice converges to one row (idempotent upsert). Random or sequential generators are **forbidden** — every remaining one is registered under `DRIFT-001`.
- ⚠ Open question on activation-code *entropy* (DB currently uses non-crypto `random()`, 7 digits): see `WEAK-100` / `UNKNOWN-008`.

## 3. Ledger & balances (INV-1)

- **Balances are never stored; they are always replayed** from `ledger_entries` (charges, payments, adjustments, refunds, reversals, transfers).
- Ledger entry types are exactly: `charge | payment | adjustment | refund | reversal | transfer`.
- The reference replay is the desktop `computeParentSummary`; the SQL `compute_parent_summary` (migration 0042) mirrors it; Android mirrors it; the website port replays fetched rows (⚠ limited to 500 — WEAK-022).

## 4. Waterfall allocation (INV-6)

- A payment allocates to outstanding installments **oldest-due-date first**, within the payment's category filter.
- Category filter semantics: `NULL` / absent = **all categories** (canonical). A specific category (tuition, transport, canteen, …) restricts allocation to that category's installments.
- Remaining installment amount (INV-4 family): `clampNonNegative(amount_due − amount_paid − amount_pending)` — uncleared pending funds reduce what the parent owes.
- Overpayment → `parent_credit` adjustment (never negative installment amounts).

## 5. Overdue rule (INV-4)

- An account is overdue iff:
  1. `balance > 0.001 DZD`, AND
  2. the latest charge (`MAX(charge.at)`) predates `now`, AND
  3. the category due date (`overdueCategoryDueDates[account]`) predates `now`.
- The due-date map MUST be built (desktop `buildOverdueDueDateMap`) and passed to the summary computation — omitting it silently yields 0 overdue (the Android defect WEAK-007).
- "Days overdue" is measured from the due date, never from the charge creation date (Android violation: BUSINESS-007).

## 6. Reconciliation (INV-9)

- The reconciler MUST run **all 6 cross-checks**: `crossCheckPayments`, `crossCheckInstallments`, `crossCheckBalanceSum`, `crossCheckInstallmentPayments`, `crossCheckClearedBalance`, `crossCheckParentCredit`. "A reconciler that runs only 3 is broken." (Desktop currently runs 4 — BUSINESS-001.)

## 7. Payments & lifecycle

- Payment statuses: `pending, partial, paid, overdue, refunded, cancelled, pending_clearance, unpaid`.
- Terminal states `refunded` and `cancelled` are immutable; a refund cannot be un-refunded.
- Proof requirements: `method=check` ⇒ `proof_path + check_number + check_bank_name` required; `method=transfer` ⇒ `proof_path + transfer_reference` required (enforced by `enforce_payment_proof` trigger on INSERT; re-validating unchanged rows on UPDATE is a registered defect — WEAK-200).
- Collection is atomic: payment + ledger entry + waterfall updates + optional parent_credit + audit entry (canonical RPC `collect_and_allocate_payment`). Any path that writes less and reports success is a defect (BUSINESS-002/100).

## 8. Refunds (§7.2)

- Refund = **LIFO reversal** via `revert_payment_allocation`: creates compensating ledger entries and reverts installment allocations in reverse allocation order.
- A refund MUST carry the actor's identity and a meaningful reason (≥3 chars); hardcoded reasons or dropped actor identity are audit violations (BUSINESS-003, CROSS-102).
- Refunds of `refunded`/`cancelled` payments must be rejected (idempotency guard) — re-refunding creates duplicate reversals and negative `amount_paid` (BUSINESS-102).
- Refund state changes (payment status AND installment reverts) must propagate to the server so all platforms converge (CROSS-103).

## 9. Receipt numbers (§7.x) [ADR-004]

- Canonical format: `REC-YYYY-NNNNNN`, sequential per (tenant, year), generated **server-side, atomically** inside the canonical RPC (`MAX(suffix)+1`, zero-padded).
- Client-side numbering (random `PAY-YYYY-…`, per-device counters) is forbidden (DRIFT-011).

## 10. Discounts & pricing

- System discount engine has 5 rules; two (`passage_palier` −10,000 DZD, `highest_average` −10%) require `previousGradeLevel`/`previousRank` inputs; `sibling_fixed` depends on sibling linkage. Discounts apply **once, on gross**.
- Pricing tables (migration 0006) + fee schedule drive tranche amounts; installment due dates come from the official tranche schedule (Sep 15 / Dec 15 / Mar 15 pattern) unless a custom schedule is set.

## 11. Audit trail (§7.6)

- **Every mutation MUST emit at least one audit entry** with `{action, entityType, entityId, actorId, actorRole, before, after}`; actions come from the canonical `AuditActions` registry (desktop `src/core/audit-actions.ts`, Android mirror `AuditActions.kt`).
- Audit-log write failures must NOT be silently swallowed (SEC-001).
- Actor identity and tenant must be the real session's, never hardcoded demo values (WEAK-011).

## 12. Tenant isolation

- Every financial row carries `tenant_id`; every query path filters by the caller's tenant; RPCs verify `p_tenant_id` against the payment/parent's actual tenant (violations registered: SEC-111, SEC-112, TENANT-*).

## 13. Synchronization semantics

- Sync pushes are idempotent upserts keyed by deterministic identity; a push must either succeed observably or stay queued — never report success for a rejected write (CROSS-200).
- Offline collections captured locally must eventually produce **the same server-side state** as an online collection through the canonical path (TARGET — ADR-005).
