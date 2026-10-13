# T-517 — Live Verification — the Family Account modal's contradictory figures (BUSINESS-111)

**Session:** the 163rd, 2026-10-13 · **Artifact:** `elimtiyaz-desktop/scripts/t-517-nacef-forensics.py` (read-only, data-gateway, GET-only) · **Result:** every figure of the owner's report reproduced from the LIVE books and explained; the fix verified at the engine + the modal wiring; **9/9 acceptance criteria addressed** (the owner's eyeball gate noted below).

## 1. The reference case (the NACEF family)

`parents.id = ba760bd0-2bc5-4478-a1c5-22e426ed0da8` (« Famille NACEF — 0550648617 », tenant `00000000-0000-0000-0000-000000000001`), four children (SAIFISSLEM, HABIBELLAH, ELMOATSEM, HIBERHMAN), academic year 2026–2027. Evaluation instant: 2026-10-13 (UTC).

## 2. The live census (read-only, zero writes)

| Stream | Rows | Reading |
|---|---|---|
| `payments` | 16 | 8 past-dated (Sept 15 anchors + run-timestamped) = **441 000 DZD** · 8 future-dated (4× V2_ALT @ 2026-12-15 + 4× V3 @ 2027-03-15) = **869 000 DZD** · all `status='paid'` |
| `ledger_entries` | 20 | 4 « Devis annuel » tuition charges (365 000 / 345 000 / 310 000 / 290 000 = **1 310 000**) + 16 payment entries mirroring the payments (12 replay-scope / 8 future-EXCLUDED by the as-of filter) |
| `installments` | 28 | **28/28 fully paid server-side** (amount_paid = amount_due on every row; per-child Σdue = the child's Devis exactly) |

## 3. Every figure of the owner's report — reproduced and explained

| The report's figure | The live derivation | Status |
|---|---|---|
| Brut facturé 1 310 000 | Σ the four per-child Devis charges | ✓ confirmed |
| Net à payer 1 310 000 | no adjustments on the account (the adjustment history holds ZERO rows) | ✓ confirmed |
| Payé 441 000 (summary card) | `computeParentSummary.totalPaid` — the canonical **as-of** replay (entry_date ≤ 2026-10-13): the 8 future-anchored payment entries are EXCLUDED | ✓ the as-of population |
| Coverage 1 310 000 / 100 % (the stack) | `sumPaidPayments(payments)` — ALL status='paid' payments REGARDLESS of date (the pre-T-517 billing-breakdown population) | ✓ the all-dates population — **the contradiction was two populations in one modal** |
| Reste à payer 869 000 | `computeParentSummary.totalOutstanding` (as-of net) = 1 310 000 − 441 000 | ✓ confirmed |
| Créance échue 949 000 | `computeParentSummary.totalOverdue` — Σ the four POSITIVE past-due per-child tuition account balances (1 310 000 − 361 000 past tuition payments) | ✓ confirmed |
| The 80 000 gap (949k vs 869k) | the four per-child TRANSPORT accounts stranded at **−20 000 each**: the import books the Devis as ONE tuition-category charge (transport component included) but the 1T transport payment entries land in transport-category accounts with NO transport charges — 80 000 DZD of payment credit the per-account net folds into `totalOutstanding` but the positive-only `totalOverdue` does not | ✓ **explained** — a legitimate per-account-waterfall effect, now explained INLINE by the modal's T-517 note |
| The +869 000 « bridge » | `serverOutstanding(869 000, as-of) − derivedRemaining(0, all-dates)` — the same 869 000 seen through the two populations, mislabelled « autres écritures » while the adjustment history is EMPTY | ✓ **explained** — after the as-of alignment `derivedRemaining` = 869 000 = the server figure, **bridge = 0** |
| « Full ledger replay balance 0 » (§3 of the report) | the same ledger replayed with `now = +Infinity`: 1 310 000 − 1 310 000 = 0 — the §15.95a dual-replay arithmetic (`full + futurePaid ≈ asOf`: 0 + 869 000 = 869 000 ✓) | ✓ confirmed |
| The 8 suspicious IMP-…-V3 / V2_ALT records | REAL collections per the school's ETAT records, dated by the T-502/DATA-062 remediation to the tranche buckets' canonical periods (the workbook carries NO per-payment dates — the deep-inspection census) — **not** duplicates, **not** scheduled installments (those live separately in the 28 installment rows) | ✓ classified: the future-recorded class |

## 4. The fix (what changed, where)

1. **`domain/calc/payment/sums.ts`** — the canonical as-of pair: `sumPaidPaymentsAsOf(payments, now)` (status-strict, the replay's own `isAtOrBefore` predicate, conservative on missing dates) + `sumFutureRecordedPaidPayments` (the future split; partitions `sumPaidPayments` exactly: 441 000 + 869 000 = 1 310 000).
2. **`domain/calc/payment/billing-breakdown.ts`** — the injected `now` clock; `totalClearedPaid` aligned to as-of; the new `futureRecordedPaid` reconciliation term (surfaced, never counted as collected-to-date). The recon equation `netDue − clearedPaid − pendingPaid = derivedRemaining` is UNCHANGED — only the population behind `clearedPaid` was wrong.
3. **`features/crm/parent-detail-drawer.tsx` FinancesTab** — the amber « Enregistré à échéance future : 869 000 DZD » legend line (with the T-502 tooltip), the reconciliation-footer informational row, and the overdue-warning credit-offset note.
4. NO data writes; NO import-convention change (DATA-062 stands); `sumPaidPayments`' own semantics unchanged (the revenue-analytics consumers keep the all-dates books total).

## 5. The verification inventory (all real runs, 2026-10-13)

- **The engine pair**: `npx vitest run src/tests/domain/payment/t-517-billing-asof-recon.test.ts` — **13/13** (the sums partition incl. the inclusive boundary + missing-date conservatism; scenarios A fully-paid 100 %/0/bridge-0, B partial 34 % never 100 %, C the NACEF case — clearedPaid 441 000 / futureRecordedPaid 869 000 / **bridge 0**, C2 the clock advanced past Dec 15 moves V2_ALT into cleared [841 000], D scheduled-vs-collected on both the real-rows and synthetic paths, F the four-child reconciliation, H adjustments coexisting; the scenario-I client/server contract over the REAL canonical replay: `recon.clearedPaid ≡ summary.totalPaid` and `recon.derivedRemaining ≡ summary.totalOutstanding`; the scenario-G overdue offset 949 000/869 000/80 000 at the canonical engine).
- **The modal wiring**: `npx vitest run src/tests/features/crm/t-517-modal-financial-consistency.test.tsx` — **6/6** (the NACEF-shaped four-child fixture, clock frozen at 2026-10-13: the summary cards and the coverage stack AGREE — « 441 000 / 1 310 000 DZD (34 %) », the 100 % line and the « Pont — autres écritures » line are BOTH absent, the future-recorded line + the recon row render with the exact 869 000, the overdue note explains 80 000 → net 869 000, the reopen/refresh stability, the four per-child Devis totals render).
- **The neighborhood**: `billing-breakdown.test.ts` **28/28 unchanged-green** (the pre-existing fixtures are past-dated — the as-of cutoff is a no-op for them, proving the change is surgically scoped to the future-dated class).
- **The FULL battery**: `npx vitest run` — **5,146 passed / 0 failed / 5 skipped, 311 files** (the registered baseline move from 5,127/0/5 · 309 files — +19 tests in 2 new suites).
- **Typecheck + lint**: `npm run typecheck` 0 errors · `npm run lint` 0 errors.
- **The LIVE re-run through the committed artifact**: `SUPABASE_SERVICE_ROLE_KEY=<env> python3 scripts/t-517-nacef-forensics.py` — every figure above re-confirmed read-only (the §15.77 data-gateway-first discipline; zero writes, zero residue).

## 6. The acceptance criteria — the checklist

- [x] The 441 000 vs 1 310 000 paid-total contradiction explained and resolved (two populations; the modal now uses ONE — the as-of).
- [x] The 869 000 outstanding reconciled against the underlying ledger (12 replay-scope entries; the 8 future payment entries excluded — listed by receipt number).
- [x] The 100 % coverage indicator now reflects the valid payment total under the documented rules (as-of cleared / netDue = 34 %; the future-recorded 869 000 surfaced as its own labelled line).
- [x] The 949 000 overdue explained (the four positive past-due tuition accounts) and verified.
- [x] The 80 000 difference accounted for (the stranded transport-account credit — explained INLINE by the modal's note).
- [x] The +869 000 bridge traced to actual underlying records (the 8 future-anchored payments; after the fix the bridge is 0 and the class is displayed, not absorbed).
- [x] Future-dated payments distinguished from scheduled installments and date-error payments (the installments live in their own 28 fully-paid rows — the server-side waterfall state; the future-dated payments are surfaced as the future-recorded class; no date was rewritten).
- [x] The four children's obligations reconcile with the family aggregate (per-child Σdue = per-child Devis = per-child payments; scenario F pinned).
- [x] Payment allocations, reversals, duplicate records handled correctly (the 16 payments are 16 distinct economic transactions — V2_ALT and V3 are separate buckets by design; no double counting; the partition invariant pinned).
- [x] The frontend (and the portal) use consistent financial definitions and date cutoffs (the desktop modal now matches the canonical replay AND the website portal, which was already as-of via DATA-032/B7).
- [x] Automated tests cover the scenarios (A, B, C, C2, D, E, F, G, H, I across the two suites).
- [x] The correction preserves the existing financial business rules and audit history (sumPaidPayments unchanged for analytics; the import convention stands; zero data writes).
- [x] The root-cause explanation, affected components, modified calculation paths, test results, and remaining data-remediation requirements — this document + the registry entries.

## 7. What remains (honest)

1. **The owner-gated data remediation** (§15.95a — NOT this task's to decide): 735 future-dated COLLECTED payments live corpus-wide (45 491 400 DZD — the T-511 census). Every affected family's modal now shows the honest as-of figures WITH the future-recorded line and the explanation, but the underlying dates still say « December/March » — the owner must rule the remediation (e.g., clamp the bucket anchors to the import-run instant, or keep the period attribution and accept the as-of reading). The diagnostics surface reports the class per family (T-511's « Diagnostic Webhooks »).
2. **The Android mirror divergence** (REGISTERED in the BUSINESS-111 entry): `core/BillingBreakdown.kt` + `ParentDetailViewModel.recomputeBilling` still compute `clearedPaid` over ALL dates — the same contradiction class on the Android parent-detail surface. The exact port spec is in the registry entry; the toolchain (JDK/javac) was not provisionable this session, so the change was NOT shipped unverifiable.
3. **The owner's eyeball gate**: reopen the NACEF family's dossier → Finances & Échéances — the cards (441 000 / 869 000 / 949 000-with-note), the 34 % bar with the three legend lines, the reconciliation footer's future-recorded row, and the GONE bridge row.

## 8. The corpus-wide read-only scan (the Definition-of-Done mandate)

Ran after the fix (read-only, the same data-gateway discipline): **262 families** carry the future-dated-paid class — **735 payments / 45 491 400 DZD** (455 anchored @ 2026-12-15 + 280 @ 2027-03-15 — matching the T-511 census exactly). The NACEF family is the single largest exposure (869 000 DZD); the next are 853 000 (16 payments) · 806 000 · 750 000 · 691 000 · 690 000… Every one of these families' modals now renders the honest as-of figures WITH the future-recorded line and the explained bridge (the fix is population-level, not family-specific — no NACEF special-casing anywhere). The remediation ruling on the dates themselves remains the owner's (§15.95a).
