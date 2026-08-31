# ADR-010 — parent_credit balance semantics: keep the canonical writer, standardize a display-level credit derivation

- **Status:** Accepted (2026-09-01, 17th repair session)
- **Task:** T-104 · **Problem:** DATA-009
- **Context input:** ADR-002 (canonical financial engine), T-103/T-105 live evidence, the desktop + website + Android equivalence suites (259/259 × 3, pinned)

## Context

The canonical writer `collect_and_allocate_payment` (migration 0034) books the FULL payment entry (−amount) AND a `parent_credit` adjustment (−unallocated) when a payment exceeds every due tranche. The raw ledger replay (`totalOutstanding`, INV-1) therefore double-counts the credit for canonical-path overpayments: charge 100k + payment −150k + credit −50k → totalOutstanding **−100k** while the parent's TRUE credit is **50k** (= |totalUnallocatedCredit|, the Σ of `parent_credit` adjustments).

Separately, the 0062 reconciliation deliberately did NOT materialize `parent_credit` entries for historical overpayers ("balance = −excess is exact there") — for those parents the raw negative balance IS the credit. After T-105's corpus alignment only 2 such parents remain; DATA-009 henceforth affects only NEW overpayments made through the canonical path.

Two candidate resolutions were on the table:
- **(a)** change the canonical writer to book only the allocated portion of the payment entry — a breaking change to the pinned writer shape; every equivalence suite (desktop 259/259 vs the backend RPC, Android 259/259, website 262/262, triple comparator 304/304) pins the current shape, so this requires a full equivalence re-run + migration + three-platform alignment.
- **(b)** keep the writer and standardize a display-level convention that read surfaces use to present "Crédit parent".

## Decision

**Option (b).** The writer is canonical and stays; the credit DISPLAY is derived by one pure, platform-shared rule:

```
credit = outstanding < 0 ? (unallocatedCredit < 0 ? -unallocatedCredit : -outstanding)
                         : 0
```

i.e. **when the parent's net position is a credit, BOOKED unallocated credit wins; otherwise the raw negative balance is the credit.** Rationale per population:

| Population | balance | booked credit | derived | why |
|---|---|---|---|---|
| Canonical overpayment (DATA-009) | −100k | −50k | **50k** | booked credit is the true value; the raw balance double-counts |
| Historical overpayer (0062) | −50k | 0 | **50k** | no entries exist; the raw balance is exact |
| Standalone goodwill credit (booked ahead of any charge) | −50k | −50k | **50k** | the credit entry is the sole source |
| Normal debtor / absorbed credit | ≥ 0 | any | **0** | net position is not a credit |

Both inputs are canonical aggregates (`totalOutstanding` INV-1 raw replay; `totalUnallocatedCredit` Σ `adjustment`/`parent_credit`); the helper never mutates them and never feeds back into balances, waterfall, or the backend.

## Consequences

- Positive: zero change to the canonical writer, the SQL RPCs, or any equivalence-pinned shape; the display fix is immediate and testable per platform; both live populations display correctly.
- Costs: the display rule is a SECOND derivation that must stay in sync across platforms (mitigated: verbatim port + pinning tests on both sides).
- Deferred: option (a) remains possible if the owner ever wants the ledger balance itself to be the single credit carrier — that decision would be a new ADR with a full equivalence re-run, out of scope here.

## Implementation map

| Platform | Artifact | Status |
|---|---|---|
| Desktop | `displayParentCredit(totalOutstanding, totalUnallocatedCredit)` in `src/domain/calc/ledger/balance.ts` (source of truth); `ParentFinancialProfile.totalUnallocatedCredit` fed by BOTH profile builders (Supabase + Mock); the dossier FinancesTab "Crédit parent" card renders the derived value (was `-outstanding`) | TESTED |
| Website | `displayCredit(outstanding, unallocatedCredit)` in `src/lib/canonical/portal-derive.ts` (verbatim port); the Finance tab credit KPI renders the derived value (was `Math.abs(unallocatedCredit)`) | TESTED |
| Android | no dedicated credit KPI exists; when one is built it MUST port `displayParentCredit` verbatim and cite this ADR (registered as a note under DATA-009) | n/a |
| Debt-meter (`unified-payment-modal`) | its `unallocatedCredit` prop is currently never passed (dormant row) — left as-is; if wired later it must receive the derived value | noted |

## Verification regime

- Desktop: `src/tests/domain/calc/t-104-display-credit.test.ts` (8 tests: all populations + source-scan guards on the card + both builders).
- Website: `src/test/t-104-display-credit.test.ts` (6 tests: identical vectors + KPI guard).
- Suites: desktop 2204 passed (+8); website 425 passed (+6); `tsc --noEmit` clean; `next build` green. The equivalence suites (pinning the UNCHANGED writer) are untouched and still green as part of the full desktop run.
