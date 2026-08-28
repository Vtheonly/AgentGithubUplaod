# Cross-Platform Verification

> Purpose: prevent different implementations of the same business behaviour from silently diverging across Desktop, Android, Website and Backend. The financial/academic engines exist in four places (SQL RPCs, desktop TS, Android Kotlin, website port); equivalence is a first-class requirement, not a nice-to-have.

## 1. What must be equivalent

| Behaviour | Implementations that must agree | Canonical |
|---|---|---|
| Parent/student balance (ledger replay) | desktop `computeParentSummary`, SQL `compute_parent_summary` (0042), Android `LedgerEngine.computeParentSummary`, website `parentFinancialSummary` | desktop TS (reference) |
| Overdue classification + amount | same four | desktop TS (INV-4) |
| Waterfall allocation (given installments + payment + category) | SQL (inside canonical RPC), desktop `allocatePaymentToInstallments`, Android local allocator | SQL canonical RPC + desktop reference |
| Installment remaining | SQL, desktop, Android `Installment.remaining`, website `installmentRemainingAmount` | `amount_due − amount_paid − amount_pending` |
| Identity codes (PAR-/ELV-/activation) | desktop `id.ts`, Android `IdentityCodes.kt`, SQL import RPCs | deterministic FNV-1a (ADR-003) |
| Receipt numbering | SQL canonical generator only | server `REC-YYYY-NNNNNN` (ADR-004) |
| Attendance rate | desktop `calculateAttendanceRate`, Android, website portal-derive, bulletin/narrative views | `(present + late) / total` |
| GPA / subject averages | desktop `computeOverallGpa`/`computeSubjectAverage`, website port | desktop TS |
| Refund reversal state | SQL `revert_payment_allocation`, desktop refund flow, Android local refund + sync | SQL canonical RPC |

## 2. Canonical comparison strategy

1. **Shared scenario corpus** (`financial-tests/equivalence/scenarios/*.json`): each scenario = initial state (parents, students, installments, ledger entries) + operations (collect X, refund Y, clear Z) + expected invariants (balances, overdue flags, installment states, receipt sequence). One corpus feeds every runner (ADR-006).
2. **Per-platform runners** execute the SAME scenario against their implementation:
   - desktop runner → TS engine (+ optional live Supabase runner for the SQL path);
   - Android runner → Kotlin engine (via the documented corpus access);
   - website → `portal-derive` read-side functions;
   - SQL → run against a fresh schema with the full canonical chain applied.
3. **One comparator, one normalization** (post-ADR-006): normalization may only canonicalize *representation* (timestamps → ISO, amounts → minor units, key ordering), never *semantics* (thresholds, rounding modes, category defaults). If two implementations need different normalization to agree, that IS the divergence.
4. **Invariants over snapshots** where possible: prefer asserting the domain invariants (INV-1…INV-9) over byte-equality, so cosmetic changes don't mask/hide real drift — but never weaken an assertion to make a platform pass.

## 3. Expected verification process (per change)

1. Add/extend a scenario that exercises the changed behaviour (e.g. "partial refund after cleared cheque").
2. Run all runners; all must pass. If one fails: **the failing platform diverges — fix the platform or (with an ADR) change the canonical rule everywhere**. Never special-case the comparator.
3. Record the run (command + summary) in the change-log entry.
4. For write-path changes, additionally verify **server-state equivalence**: a desktop-collected payment and an Android-collected payment (post ADR-005) must leave identical rows in `payments`, `ledger_entries`, `installments`, `audit_logs` (modulo actor/device metadata).

## 4. Divergences currently known (must be closed, not accommodated)

Registered in the problem registry — the headline ones: payment write paths ×3 (CROSS-005/BUSINESS-002), receipt numbering ×5 (DRIFT-011), overdue ×3 (DRIFT-006/WEAK-007/BUSINESS-007), attendance rate ×2 (WEAK-019 family), remaining-amount ×2 (WEAK-018), unread counts ×3 (NOTIF-102/103/104). The comparator must NOT gain per-platform quirks for any of these.

## 5. Anti-patterns (forbidden)

- Adding platform-specific expected-values to make a divergent platform pass.
- Comparing against a stale mirror (the `_tier4` Kotlin mirror — DUP-002) instead of the real engine.
- Marking equivalence "verified" without the corpus run output.
- Testing only the happy path — scenarios must include overpayment→parent_credit, refund-after-clearance, category-filtered payments, multi-year ledgers (>500 entries for the website — WEAK-022).
