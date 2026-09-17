# T-389 — Live Verification (INSPECT-500, 78th session, 2026-09-17)

The definitional contract of the data-lineage inspector — every trigger's
`sourceValue` and its resolution share ONE derivation — verified against
BOTH live Supabase projects (read-only SELECTs through the Management API
SQL endpoint; the reusable script is
`elimtiyaz-desktop/scripts/verify_t-389_live.sh`).

## The probe matrix (17 checks, all HTTP 201)

### Production `hkvkefubghbbotgnteir` (the real school data)

| Check | What it proves | Live result |
|---|---|---|
| C1 | The revenue window `[2025-09-01, 2026-09-01)` EXCLUSIVE upper bound (the `revenueForRange` / fixed `inRange` semantics) | **55 227 100 DZD / 891 paid payments** — the exact number the KPI card and the inspector now both derive |
| C1b | No payment is double-counted on the boundary day | 0 payments on 2026-09-01 (excluded) |
| C2 | The YEAR-scoped outstanding debt (`deriveOutstandingDebt(installments, "2025-2026")` — status ≠ paid + due-date window + INV-4) | **58 354 700 DZD / 691 unpaid installments** |
| C2b | The ALL-years scope (the Pareto/debt-summaries semantics) | **58 602 700 DZD / 695 unpaid installments** |
| C3 | The aging-bucket computation (the `debtByAgingForRange` mirror the inspector's `agingBucket` filter applies) | 180_plus = 58 354 700 DZD / 691 (every unpaid tranche is > 180 j overdue on this data) |
| C4 | The remise identification contract (`isRemiseAdjustment`: negative adjustments, `metadata.field = 'REMISE'`) | **9 709 700 DZD / 318 remise entries** — byte-identical to the deriveDiscountErosion documented census (2026-09-14) |
| C5 | The transport-domain scoping (transport installments, year window) | 0 (no transport installment due-dated inside 2025-2026 yet — the honest live state) |
| C6 | The top-10 debtor ranking (the input the 10-color contributor view renders) | #1 = 1 507 000 · #2 = 1 215 000 · #3 = 960 000 · #4 = 958 000 · #5 = 926 000 · #6 = 813 000 · #7 = 700 000 · #8 = 689 000 · #9 = 683 000 · #10 = 645 000 DZD |

### New clone `vebfehrpzajhstyhinnw` (the user-supplied test project)

| Check | Live result |
|---|---|
| C1 / C1b | 0 paid payments (the clone carries no payment history yet) |
| C2 (year scope) | **0** |
| C2b (all years) | **275 000 DZD / 6 unpaid installments** — all out-of-year |
| C4 | 0 remise entries |
| C6 | one debtor = 275 000 DZD |

## The decisive evidence — the scope defect was REAL

`C2b − C2 = 58 602 700 − 58 354 700 = 248 000 DZD` on production (and
`275 000 − 0 = 275 000 DZD` on the clone): the pre-T-389 "Créances"
trigger displayed the ALL-years total (from the debt-summaries stream)
while its resolution replayed the YEAR-scoped window — **a permanent,
unexplainable false "Écart" of 248 000 DZD on production**. The repair
gives each trigger the matching `scope` (`Créances {année}` → year, the
Pareto → all-years) and both now reconcile to 0 on the same data.

## What this verifies

- The **revenue** inspection resolves the same population the KPI query
  selects (same window arithmetic, same status filter) — C1/C1b.
- The **debt** inspections match `buildInstallmentsQuery` semantics in
  BOTH scopes, and the INV-4 remaining formula produces the same totals —
  C2/C2b.
- The **aging-bucket** filter partitions the year-scoped total with the
  same `daysBetweenFloor → agingBucketFromDays` computation the aging
  card uses — C3.
- The **discount** inspection traces the exact 318-entry remise corpus
  the identification contract selects — C4.
- The **transport** domain scopes transport installments by the year
  billing window and reports the honest live state — C5.
- The **top-10 contributor** ranking exists, is rank-ordered by amount,
  and is the exact input the 10-color palette renders — C6.

## Known limits (documented, not blockers)

- The desktop inspector itself is a client-side consumer; this probe
  verifies the DERIVATIONS against live data (the same SQL semantics the
  streams feed the client). A rendered-UI pass in the Electron app is the
  owner's visual acceptance step (the suite pins the logic: t-389
  34/34).
- The clone project carries almost no financial data (0 payments) — the
  production project is the meaningful corpus; both were probed
  read-only.
