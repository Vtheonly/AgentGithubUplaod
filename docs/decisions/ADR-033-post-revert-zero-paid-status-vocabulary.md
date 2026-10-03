# ADR-033: The Post-Revert Zero-Paid Future-Due Status Vocabulary (PARITY-010 settled: 'unpaid')

- **Status:** ACCEPTED (2026-10-04, 138th session — T-473 / PARITY-010; the owner's 2026-10-04 session mandate delegated the ruling to the session)
- **Context:** PARITY-010 (registered by T-470's INV-8 settlement, 2026-10-03) — the SQL RPC `revert_payment_allocation` (migration 0034) writes `'unpaid'` for the post-revert zero-paid FUTURE-due installment while both TS engines (desktop `lifo-reversal.ts` `reevaluateInstallmentStatus` and the Kotlin mirror `kotlin_mirror_engine.ts`) return `'pending'`. AGENTS.md §15.2 forbids changing business behaviour without establishing the expected behaviour; the legacy CANONICAL-FINANCIAL-LOGIC.md §7.3 note ("'unpaid' is reserved for initial installment creation") is gone; financial-rules.md §8 did not settle the vocabulary. This ADR is the owner-delegated ruling.

## Decision

**The canonical status for a post-revert zero-paid, zero-pending, FUTURE-due installment is `'unpaid'`.** The TS engines were the drift and are fixed in the same change; the SQL RPC (0034) was already correct and is untouched — no migration, no live-apply round. The installments CHECK constraint already allows the value (`('unpaid', 'partial', 'paid', 'overdue', 'pending', 'pending_clearance')`), and the corpus re-pins in the same change.

## The evidence (seven decisive points, all read at ruling time)

1. **The model's own canonical documentation** — `src/domain/model/payment.ts`: *"`unpaid` is the installment-specific status for a tranche that has had NO payment activity (no cleared funds, no pending check)."* A fully-reverted tranche with `amountPaid = 0` and `amountPending = 0` is EXACTLY that state; the reverted payment no longer exists as activity.
2. **The creation paths** — the installments table DEFAULT is `'unpaid'` (migration 0007), and the canonical manual-debt creation RPC `create_manual_debt` (migration 0137, T-466) writes `'unpaid'` for a zero-paid future-due tranche. A full revert returns a tranche to its creation-equivalent state; the vocabulary should be idempotent with creation.
3. **The server-side debt views** — migrations 0021/0022 define the outstanding-debt set as `status IN ('unpaid', 'partial', 'overdue')`. A tranche written `'pending'` by a revert would **vanish from the server's outstanding-debt set** — an under-counting behavioural consequence, not a cosmetic difference.
4. **The desktop display layer** — `billing-breakdown.ts` `toTrancheNode` classifies the zero-paid/zero-pending tranche as `"unpaid"` (its `"pending"` is reserved for tranches carrying uncleared funds). The engine's `'pending'` contradicted its own platform's display vocabulary for the identical state.
5. **The vocabulary collision** — in the payment domain `'pending'` means UNCLEARED FUNDS: payments sit `'pending'` until bank clearance; installments carry `'pending_clearance'` while an uncleared check sits on them. Writing `'pending'` onto a zero-funds tranche implies uncleared money exists — a latent misreading for every future consumer.
6. **The mock/production divergence was live** — the mock repository persists the engine's `rev.newStatus` DIRECTLY into `store.installments[].status` (`payment-ops.ts`), so the same refund produced `'pending'` in mock mode and `'unpaid'` in Supabase mode: the DRIFT-011 class ("two implementations of one rule drifting apart until a surface starts caring") already realized, invisible only because every current surface re-derives status from amounts.
7. **The majority argument inverted** — "both TS engines return 'pending'" was really ONE drifted implementation plus its verbatim mirror (the Kotlin mirror exists to mirror the TS engine, not as independent scholarship). Semantics beat count.

## Consequences

- `reevaluateInstallmentStatus` (desktop) and its Kotlin mirror return `'unpaid'` in the future-due zero-paid branch; the `RevertAllocation.newStatus` / `ClearAllocation.newStatus` unions widen to include `'unpaid'` (the clearance path cannot reach the branch in practice — a clearance always moves funds IN — but the type must admit the shared classifier's range).
- The corpus re-pins: ScenarioRunner's companion future-due assertion, Tier4Boundary, Tier4OperationSequences, phase2-modules, and waterfall-allocation — all flip to `'unpaid'` with comments citing this ADR (the T-470-era pins cited the now-removed legacy §7.3 note; those citations are updated).
- financial-rules.md §8 records the ruling as a canonical refund rule.
- **No SQL change** — the RPC was already right; this is deliberately the LOW-RISK direction (no migration, no live-apply, no owner-gated step).
- The desktop read-side is unaffected by construction (every current surface re-derives status from amounts), and the mock-mode persistence now ALIGNS with production instead of diverging.
- **Cross-repo follow-up (registered, not blocking):** the REAL Android Kotlin engine (the `LifoReversal.kt` line the mirror mirrors) carries the same `'pending'` branch — a divergence note in the Android repo's registry, fixable in the Android mirrors round.

## Verification plan (executed in T-473)

The six re-pinned suites re-run GREEN; the full battery re-run (the baseline moved in the same commit if counts changed); the tier-4 mirror comparison still equivalent (both engines changed together); tsc + eslint clean.

## Related

- PARITY-010 (the problem entry) · T-470 (the registering task; the parity evidence in `docs/recovery/t-470-live-verification.md` §5) · T-473 (the fix task) · INV-8 (the refund-revert invariant) · financial-rules.md §8 · migration 0034 (`revert_payment_allocation`) · migration 0007 (the 'unpaid' default) · migration 0137 (`create_manual_debt`) · migrations 0021/0022 (the outstanding-debt views) · TEST-502 (the settled past-due half — 'overdue' on both sides) · DRIFT-011 (the class precedent) · ADR-009 lineage (the vocabulary documentation duty).
