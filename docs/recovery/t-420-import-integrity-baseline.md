# T-420 Baseline Evidence — Issue #20: Bulk Excel Import Incorrect Payment Status

**Task:** T-420 (issue #20 — GitHub) · **Registered:** 2026-09-27 (104th session) · **Status:** the pre-fix forensic evidence + root-cause identification
**Related problems:** IMPORT-112 · IMPORT-113 · IMPORT-114 · PERF-504 (all registered BEFORE the fix per §13)
**Source evidence:** the owner's console log (`logs.txt`, GitHub issue #20 attachment) · the live DB census (Management-API SQL endpoint, 2026-09-27) · a full local reproduction of the import against the REAL workbook (`Excel/2027-2026.xlsx`, the NEWER of the two versions — 1,139 named student rows vs the old workbook's 390)

---

## 1. The mandate (the owner's issue-#20 brief)

The bulk Excel import appears to set **all students as fully paid with no outstanding debt**, regardless of their actual payment status in the Excel file. The investigation must: verify payment information against the Excel source of truth; determine at which stage the corruption happens (parsing / payment-status mapping / debt calculation / record creation / payment/tranche creation / final normalization); treat the Excel file with MORE rows as the newer source of truth; make the import significantly faster without sacrificing correctness; and add tests covering fully-paid, partially-paid, and indebted students.

## 2. The Excel source of truth (the forensic census)

**Which workbook is the source of truth:** `Excel/2027-2026.xlsx` (558 KB, ETAT sheet with **1,139 named student rows**) — NOT `Excel/Suivis clients  2026_2027.xlsx` (213 KB, 390 named rows). The issue's own rule: "The version with more rows is the newer version." The logged import (`filePath: "2027-2026.xlsx"`, checksum `b293b2…`) confirms the owner imported the newer workbook.

**Independent Python census of the ETAT sheet (openpyxl, cached formula results):**

| Metric | Value |
|---|---|
| Named student rows (col F) | **1,139** |
| Σ DEVIS ANNUEL (L) | 356,882,800 DZD |
| Σ payments (R+S+T+U+W+X+Y = P) | 162,807,000 DZD |
| Rows with DETTES (N) > 0 | 6 (Σ 636,500 DZD) |
| Rows with REGLEMENTS DETTES (O) > 0 | 3 |
| Rows with REMBOURCEMENT (M) > 0 | 1 |
| **Rows fully paid (L+N−M−(P+O) ≤ 0)** | **197 (17.3%)** |
| **Rows with outstanding balance** | **942 (82.7%)** — Σ TOTAL*CREANCE (Q) = 193,983,800 DZD |
| Rows with negative CREANCE SEPT (underpaid 1st installment) | 296 |

**The source-of-truth financial state: 82.7% of students carry an outstanding balance.** Any import result that shows "all students fully paid" is catastrophically wrong — and that is exactly what the live DB shows (§4).

## 3. Local reproduction — the import pipeline is CORRECT in the happy path

A diagnostic harness (the t-105 stub-repository convention) imported the REAL `2027-2026.xlsx` through the canonical `ImportEngine` + `RepositoryStorageAdapter` and compared **every student's ledger balance against the Excel row's own arithmetic** (`L + N − M − (P + O)`):

| Metric | Result |
|---|---|
| Students imported / matched to an Excel row | 1,137 / 1,137 |
| Ledger entries built | 3,346 (charges + payments + adjustments, `sourceType: bulk_import`) |
| Payment rows built | 2,198 |
| Installment rows built | 5,963 |
| **Students showing debt (ledger balance > 0)** | **940 — vs 942 expected** (the 2 deltas are same-name students in the diagnostic's name-matching, verified by hand) |
| DETTES charge entries | 6/6 |
| Per-student spot checks | BOUAICHA ACIL balance 143,000 = Excel Q 143,000 ✓ · SEDIKI ISHAK 230,000 = Q 230,000 ✓ · SEDIKI YAKOUB 157,000 = Q 157,000 ✓ · SEDIKI YACINE 255,000 = Q 255,000 ✓ |

**Conclusion (the issue's own stage checklist):** Excel parsing ✓ correct (cached formula results read; DETTES/REGLEMENTS/REMBOURSEMENT all mapped) · payment-status mapping ✓ correct · debt/balance calculation ✓ correct (ledger replay matches the workbook's own Q column) · student creation ✓ correct · payment/tranche creation ✓ correct in-memory. **The corruption happens in the LIVE SUPABASE WRITE PATH, after the in-memory build, during the deferred bulk flush.**

## 4. The live database census (2026-09-27, Management-API SQL endpoint)

| Table | Live rows | Expected from the workbook | Survival |
|---|---|---|---|
| students (alive) | **753** (463 from the 18:21 run + 290 from the 03:03 run) | 1,139 | 66% |
| students (soft-deleted) | 384 | 0 — the partial rollback's corpses | — |
| parents (alive) | 741 | ~741 | ✓ |
| **ledger_entries** | **7** (4 from a 1-student probe import at 03:04 + 3 T-396 probes) | **~3,346** | **0.2%** |
| **payments** | **503** (Σ 33.3M of 162.8M DZD) | ~2,198 | 23% |
| **installments** | **6** (all T-396/older probes — ZERO from the import) | ~5,963 | **0%** |

**The live DB has (almost) NO charge entries.** Balances are computed by ledger replay (`computeAccountBalance` — INV-1); with no charges, every account replays to balance = 0 → the CRM shows every student **"fully paid, no outstanding debt"** — the exact reported symptom. The 503 payment rows make some students look even MORE paid (payments with no matching charges).

## 5. The reconstructed failure timeline (logs.txt + audit_logs + row timestamps)

```
18:21:12  App starts. Parents seed FAILS: "PGRST303: JWT issued at future" (client clock skew)
          → parents cache degraded to EMPTY.
18:21:47  RUN 1 = the DRY-RUN preview (dryRun: true — no writes): 1,141 rows read,
          1,139 "imported" in 3,833 ms. run_completed audit ✓.
18:21:53  RUN 2 = the REAL import (dryRun: false) against live Supabase.
          During the next ~6.5 min: 159 statement timeouts (57014), 166 gateway 504s,
          "Timed out acquiring connection from connection pool" on parent/student creates
          (rows 1125, 668, … — collected per-row, import continues).
18:28:18  Sheet done: 844 imported / 292 updated / 5 skipped. commitTransaction() begins.
          ├─ LEDGER flush: bulkAppend chunk throws (pool exhausted) → catch → FALLBACK
          │  appendMany() → 3,346 upsert_ledger_entry_from_import RPCs each fail FAST with
          │  PGRST003 pool errors → appendMany returns Ok([]) — SUCCESS WITH ZERO WRITES.
          │  (IMPORT-112)
          ├─ PAYMENTS flush: chunk 1 (500 rows) lands at 18:28:27.048 ✓ — chunk 2 fails →
          │  bulkCollect returns Err → the flush throws → the import FAILS.
          └─ never reaches the installments flush (IMPORT-113 would have dropped them anyway).
18:28:27+ ROLLBACK: compensating per-row soft-deletes of created students — 384 succeed,
          then the rollback itself dies against the exhausted pool; the engine SWALLOWS the
          rollback failure (`catch { /* Ignore */ }`). (IMPORT-114)
RESULT    463 new students + 546 new parents + 500 payments persist; 0 ledger entries;
          0 installments; no run_completed audit row (confirmed live). The UI then shows
          every student fully paid.
```

The same pattern killed the earlier 03:03 import (290 students created, 3 payments, 4 ledger entries — one student's flush landed before the pool died; no run_completed).

## 6. Why the pool died: the realtime refresh storm (PERF-504)

`src/infrastructure/supabase/financial-realtime.ts` subscribes to postgres_changes on **6 tables** (`payments, installments, ledger_entries, expense_tickets, parents, students`) with a **75 ms debounce**. Every insert the import itself produces (1,393 parents+students, then the payment chunks) re-triggers `refreshAll()` — which re-seeds **8 full collections** (`parents.observe() + students.observe() + payments.observe() + installments.observe() + ledger.observe() + expenses.observe() + debt.refreshSummary() + debt.refreshAging()`), each an unlimited `SELECT *`. Under a continuous insert stream the debounce never gets ahead: the UI hammers the transaction pooler with full-table reads **while the import is writing**, exhausting PostgREST's connection pool. The logs show exactly this: hundreds of `students?select=*&…` 500/504 errors interleaved with the import's own writes, every one traced through `supabase-audit-log-repository.ts:205 → financial-realtime.ts:370`. This is the issue's own "unnecessary UI updates/re-renders during the import" bullet — it is simultaneously the performance killer AND the trigger that breaks the financial flush's correctness.

## 7. The four defects (registered before the fix — §13)

1. **IMPORT-112** — `SupabaseLedgerRepository.bulkAppend` catches any thrown error and falls back to `appendMany`, which loops `append()` and **returns Ok with only the successful entries — silently dropping every failure**. The import adapter's atomic contract checks `result.ok === false`, so an Ok-with-zero-writes reads as success. Live evidence: 0/3,346 ledger entries on a run whose UI reached the payments flush.
2. **IMPORT-113** — `SupabaseInstallmentRepository.bulkImportInstallments` has the identical lossy fallback loop (catch → per-row `importInstallment` → `if (r.ok) results.push` → `return Ok(results)`). Live evidence: 0/5,963 installments.
3. **IMPORT-114** — the engine swallows rollback failures; a partial rollback leaves a half-imported state with no surfaced indication that the DB is inconsistent (384 soft-deleted corpses + 463 live students from a "failed" import).
4. **PERF-504** — the realtime refreshAll storm during bulk imports (75 ms debounce × 8 full-collection re-seeds × continuous insert events) saturates the connection pool, which is what converts a merely-slow import into a corrupted one by killing the financial flush mid-flight.

## 8. The fix plan (the phases, each a verified commit)

1. **Phase 0 (this commit):** registration — T-420 + IMPORT-112/113/114 + PERF-504 + this evidence doc.
2. **Phase 1:** honest-error contract on the three lossy paths (`bulkAppend` no fallback; `appendMany` returns Err when any entry fails; `bulkImportInstallments` no fallback) + the mocked-client unit pins.
3. **Phase 2:** `pause()/resume()` on the financial-realtime bridge, wired around the import modal's commit — one refresh at the end instead of a 6.5-minute storm.
4. **Phase 3:** surface rollback failures in the engine's thrown error (the user must know the DB is partial).
5. **Phase 4:** the regression suite the issue demands: fully-paid / partially-paid / indebted students through the REAL workbook + a synthetic tri-state workbook + the Excel source-of-truth per-student balance oracle + the flush-failure atomicity pins (a repo whose bulk write fails must FAIL the import — the exact live defect, made impossible to regress).
6. **Phase 5:** full gates vs the documented baselines.
7. **Phase 6:** live verification with the owner-supplied credentials (probe import + census) + the registries closeout + the delivery zips.
