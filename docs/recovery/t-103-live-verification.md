# T-103 — Live Verification Record (2026-09-01, 15th session)

> Evidence file for the T-103 financial reconciliation (migration 0062) and the
> canonical read-path alignment. All checks were executed against the LIVE
> Supabase project `hkvkefubghbbotgnteir` with the owner-supplied access token.
> The verification script is `elimtiyaz-desktop/scripts/verify_t-103.sql`
> (rollback-safe: wrapped in `BEGIN; … ROLLBACK;` — re-runnable any time).

## 1. Session-opening chain check (AGENTS.md §15 rule 11)

- Local chain at open: 58 files (0001–0061; the 0015–0017 gap is the documented
  pre-audit numbering gap). Live `supabase_migrations.schema_migrations`: 58
  rows. JSON-diffed version sets: IDENTICAL, zero drift.
- After applying 0062 (atomic apply + registration): local 59 files == live 59
  rows — **CHAIN CONSISTENT 59/59 = 0001–0062**.

## 2. Pre-fix divergence measurements (why the owner saw the problem)

| Measurement (per-parent, 258 parents) | Parents mismatching |
|---|---|
| payments table Σ ≠ ledger payment Σ (DATA-002) | 1 (e3e90f1f, Δ+10,000) |
| Σ installments due ≠ Σ ledger charges + adjustments (DATA-003) | **197** (76%) |
| installments remaining (due−paid−pending) ≠ ledger balance | **181** (70%) |
| Over-applied tranches (amount_paid > amount_due) | present (e.g. e3e90f1f T2: 165,000 paid on a 63,000 tranche; T1 unpaid) |
| payment_allocations rows | **0** (waterfall never run — DATA-001) |
| payments.expected_amount / excess_amount populated | **0 of 888** (DATA-004) |

Forensic source: `Suivis clients  2026_2027.xlsx` (repo root), sheet
`ETAT 20262027` — row 235 (SIDI MAMER SAMYI, CM2): REMISE 63,250 / DEVIS
236,750 / V2 66,750 / **2V 100,000** / v3 100,000; row 236 (NAGHMOUCH YANIS
MED, CM1): REMISE 63,250 / DEVIS 226,750 / V2 26,750 / 2V 100,000 / v3
100,000; row 242 (a DIFFERENT parent's student with the identical name
SIDI MAMER SAMYI): 2V 90,000 — the source of the payments-import mis-read.

## 3. The canonical-writer overpayment shape (empirical, rollback transaction)

`collect_and_allocate_payment` with 150,000 against a 100,000 tranche
(charge pre-seeded), rolled back:

| entry | category | amount |
|---|---|---|
| adjustment | parent_credit | −50,000 |
| charge | tuition | +100,000 |
| payment | tuition | −150,000 |

`compute_parent_summary` → total_charged 100,000 / total_paid 150,000 /
**total_outstanding −100,000** / total_unallocated_credit −50,000.

→ The raw ledger balance DOUBLE-COUNTS the credit (a 50k overpayment shows as
−100k). Registered as **DATA-009**; the 0062 backfill deliberately does not
materialize parent_credit entries for the 59 historical overpayers (their
balance stays −excess = the true credit).

## 4. Migration 0062 apply (MIG-TOKENS — atomic with registration)

`bash scripts/apply_0062_live.sh` → `[]` (success), registration verified
(`0062 / finance_reconciliation`), post-apply state: **1,310
payment_allocations covering 860 payments** (the other 28 payments are
pure-excess — zero allocations by design).

Dry-run FIRST: the full migration (audit blocks included) executed in a
`BEGIN; … ROLLBACK;` transaction against the live DB — all consistency checks
green before the real apply.

## 5. Post-fix verification — `scripts/verify_t-103.sql` (live, 8/8)

| Check | Meaning | Result |
|---|---|---|
| C1 | payment_allocations internally consistent (Σ allocations per payment == amount − excess) | **true** |
| C2 | payments table == ledger payment entries for EVERY parent | **true** (0/258 residual) |
| C3 | Σ installments due == Σ charges + Σ adjustments per parent | **true** (0/258 residual — was 197) |
| C4 | waterfall allocations; zero over-applied tranches | **true** |
| C5 | debtors: installments remaining == ledger balance | **true** (0/199 residual — was 181 family) |
| C6 | overpayers: 0 remaining, credit balance | **true** (59 overpayers) |
| C7 | expected_amount/excess_amount populated on all payments | **true** (888/888) |
| C8 | transport charges present for every transport student | **true** (54 charges / 34 parents) |

Population: 258 parents → 199 debtors / 59 overpayers (credit position) /
0 unsettled-straddlers.

## 6. Owner's reported parent — spot-check (e3e90f1f, SIDI MAMER SAMYI)

| Quantity | Value | Consistency |
|---|---|---|
| Ledger charges + adjustments | 463,500 − 126,500 = **337,000** | == Σ installments due ✓ |
| Ledger payments | **493,500** | == payments table (after the 90k→100k fix) ✓ |
| Waterfall-allocated (Σ installments paid) | **337,000** | all tranches paid, 0 remaining ✓ |
| Ledger balance | **−156,500** | == −excess (parent credit 156,500) ✓ |

Before the fix this parent displayed three different stories (Finance
"Tranches" tab: over-applied T2/T3 with unpaid T1; payments list: 6 payments;
dossier: gross totalDue 463,500 / paid 493,500 / negative "Reste"). Now every
surface reconciles: the kids' tranches total 337,000 (all paid) + the parent's
156,500 credit == the 493,500 they actually paid.

## 7. Desktop verification (code layer)

- NEW suite `src/tests/domain/calc/t-103-finance-consistency.test.ts` —
  10/10 (INV-4 formula ×3, totalOutstanding ×3, sumInstallmentsPending,
  mapPaymentRow hint-fields ×2, net-profile derivation with the mock store).
- FULL desktop suite: **67 files / 2187 tests ALL PASS** (baseline 2177 + 10).
- `npx tsc --noEmit` clean · `npm run lint` 0 errors · append-only migration
  guard green (59 files, +1 = 0062, machine-enforced).

## 8. What remains

- DATA-005 (first_name split) — still open under T-085 (cosmetic, not
  financial).
- DATA-009 (canonical parent_credit double-count) — registered, needs an ADR
  (T-104); live path unchanged.
- crossCheckParentCredit will emit UNBACKED_PARENT_CREDIT *warnings* for the
  59 historical overpayers — accepted consequence of the documented decision.
- Android/website: no code changes required (both already implement the
  canonical INV-4-family formula); their data converges on the next
  pull-sync / page load.
