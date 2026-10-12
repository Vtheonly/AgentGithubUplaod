# T-511 — Live Verification — the Webhook & Ledger Traceability Diagnostics (AUDIT-506, issue #30)

**Session:** the 159th, 2026-10-13 · **Script:** `elimtiyaz-desktop/scripts/t511-webhook-diagnostics-live.ts` · **Result:** **9/9 GREEN** (read-only — zero writes, zero RPC mutations; the engine is a pure consumer of the warmed streams).

The run went through the app's OWN client (the exact wiring the packaged app uses): the app-client sign-in (`admin@elimtiyaz.dz` — the owner-pinned credential, §15.23), the real Supabase repositories, the `warmExportSources` seam, and the EXACT engine the Finance → Diagnostics « Diagnostic Webhooks » card renders (`runWebhookDiagnostics`).

## The ladder

| # | Check | Result |
|---|---|---|
| L1 | admin sign-in (the app's own client) | PASS — admin@elimtiyaz.dz |
| L2 | live migration chain head | PASS — head=0152 (the T-510 session's apply) |
| L3a | the audit's sources warmed | PASS — all warmed (parents/students/payments/installments/ledger/debtSummaries) |
| L3b | the streams hold REAL data | PASS — parents=741 · students=1137 · payments=2198 · installments=5956 · ledger=3342 · debtSummaries=634 · allocations=0 |
| L4 | runWebhookDiagnostics over the real data | PASS — findings=6638 (actionable=3826, reconciled=2705, unverified=107) |
| L5 | coverage ≡ real volumes · counts ≡ findings | PASS — Σcounts=6638 = findings=6638 (the no-silent-omission contract) |
| L6 | every non-empty category carries evidence-backed findings | PASS — 6/7 categories populated on the real books |
| L7 | the Example-A live shape (collected payments dated in the future) | PASS — **735 payments · 45 491 400 DZD** (the T-502 class is STILL PRESENT in the live data — reported honestly; the remediation did not cover all rows) |
| L8 | read-only + deterministic | PASS — the second run's counts are identical; the row counts never move |

## The findings census on the REAL books (2026-10-12)

| Category | Count | Reading |
|---|---|---|
| confirmed_mismatch | 2 198 | **Every imported payment lacks its ledger twin** — the `upsert_payment_from_import` path writes payment rows (ids `IMP-…-T3`) with NO `type=payment` ledger entry: the exact BUSINESS-002 class (the payment is invisible to every ledger-derived balance). The canonical write-time guard (`crossCheckPayments` — "every payment has a matching ledger entry") exists but the import path never runs it. |
| duplicate_event | 162 | Exact business-tuple replays (same parent/amount/method/date/status, DIFFERENT receipts) — mostly the ETAT tranche buckets where several rows share amount+date; flagged for review, never auto-cancelled. |
| outlier_review | 3 | Imported annual totals materially above the price matrix (sample: delta 394 000 DZD on the last tranche) — the Example-B shape, live. |
| date_semantic_conflict | 1 463 | 735 future-dated COLLECTED payments (45.5M DZD) + the per-family false-debt reconciliations they cause — **the Example-A shape is REAL in production**: the as-of replay (`computeParentSummary`'s `isAtOrBefore` filter) excludes them, so paid accounts report apparent debt. |
| unverified | 107 | Families with ledger entries but no server debt summary (the seed's coverage) + price bases with missing student/grade data — honestly unverified, never "fraudulent". |
| reconciled | 2 705 | Traceable movements: documented import charges, adjustments with motives, canonical parent credits. |
| unjustified_amount | 0 | No generic-description unbacked charge exists in the current live corpus. |

## What this proves

1. **The diagnostics are connected to the real frontend and actual data path** (issue #30's acceptance criterion): the same engine the card renders ran over the owner's 741-family books and produced evidence-backed findings in every populated category.
2. **The read-only guarantee holds live**: two consecutive runs produce identical counts and the observable row counts never move; the script performs zero writes by construction.
3. **The four illustrative failure patterns are detectable on real data**: (A) future-dated false debt — 735 payments / 45.5M DZD live; (B) outlier absorption — 3 live; (C) unjustified amounts — the check exists (0 in the current corpus); (D) webhook↔ledger divergence — 2 198 live (the import-without-ledger-twin class) + 162 duplicate signatures.
4. **The findings are explainable**: every sample carries its evidence inventory (the compared values, the source references, the arithmetic) — no generic warnings.

## The honest caveats

- The 2 198 "payment without ledger entry" findings reflect a STRUCTURAL property of the import path (payments land without ledger twins by design of the legacy importer). The diagnostics surface them per the canonical reconciliation contract; whether to treat the import's no-twin convention as a legitimate historical state or as a defect to remediate is an **owner decision** (registered as the T-511 follow-up question in the problem-registry closeout) — the diagnostics never auto-correct anything.
- The 162 duplicate signatures may be legitimate sibling tranche rows sharing amount+date in the ETAT source; they are flagged for review, not cancelled.
- The allocations stream read 0 rows through the warmed observable (the allocations ride `observeAllocations` — the FinancialsPage wiring includes it; the live census records the stream as empty for this run, so allocation checks had no rows to audit).
