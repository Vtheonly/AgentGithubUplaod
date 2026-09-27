# T-422 — The Finance-Zeros Diagnosis: Encaissement/Créances/Tranches/Paiements show 0 DZD while the Dettes tab shows the real debts

> **Task:** the owner's report — *Finances → Encaissement shows every KPI at 0 DZD, "Aucune tranche T1/T2/T3", "Aucune tranche ne correspond aux filtres", Page 1/1, default filters, while the Suivi des Dettes tab shows real debts* — traced read-only across the whole chain (spreadsheet/import → DB → calculations → créances → tranches → paiements → historique → UI) and classified per the owner's six hypotheses.
> **GitHub issue:** #23 (OPEN — the fix is owner-gated and tracked there).
> **Mode:** READ-ONLY. Zero writes to the live DB, zero production code changes, zero migration/RPC/RLS changes. The three probe scripts are read-only evidence tools.
> **Registered before any fix (§13):** CACHE-103 · DATA-038 · PERF-505 · ACAD-511 · DATA-039 (all OPEN).
> **Session:** the 106th (2026-09-27). Knowledge: AGENTS.md §15.63.

---

## 1. The mandate and the constraint

The owner's instruction was explicit: *investigate first, changes forbidden* — trace the complete chain from the Excel spreadsheet and the import, through the database and the financial calculations, to créances, tranches, paiements, historique, and the UI; then decide which of six hypotheses holds:

1. the financial workflow itself is correct;
2. the debts/receivables should have generated or be linked to payments and installments;
3. the historical data is correctly connected to the prior-year imports;
4. the spreadsheet data conforms to the business logic;
5. an application / API / database bug;
6. the spreadsheet/import itself is wrong or incomplete.

The constraint that shaped everything: **do not treat missing data in the UI as proof the UI is right or the data is gone — locate the root cause's layer (business logic / import data / DB state / API / UI) before proposing any change.** This document is the answer; the fix plan (§8) is registered and owner-gated, not executed.

## 2. The method

Four evidence sources, all read-only:

1. **`scripts/t-422-finance-zeros-probe.mjs`** — the live census (students/parents alive vs soft-deleted, ledger_entries, payments, installments, payment_allocations), per-status/tranche/category/année breakdowns, the `compute_debt_aging_summary` RPC, the repository's EXACT installments read (capturing any error the repo code swallows), created-at timelines by hour, and the academic_years + student_academic_histories census (the historique question).
2. **`scripts/t-422-flakiness-meter.mjs`** — the reliability measurement: 5 rounds each of (A) the payments paginated seed (the repository's exact loop: 1,000/page by `collected_at desc`), (B) the installments single read (the repository's exact query: `select *` ordered by `due_date`), (C) the `compute_debt_aging_summary` RPC — recording rows, latency, and error codes.
3. **`scripts/t-422-e2e-simulation.mjs`** — the UI path simulation: replicates the current build's exact repository reads and computes the exact KPI values the Finances page would render (Encaissé, Revenu mensuel, Encours créances, dont échues), plus the live column lists and the PostgREST count quirks.
4. **The code trace** — `src/infrastructure/supabase/repositories/supabase-shared-repositories.ts` (the seed implementations and their catch blocks), the financials-page data paths, and the degradation conventions already in the repository (OPS-317/T-392, DATA-026/T-411, seedAging).

The probes ran **twice**: during the 01:00 backup window (the documented slow period) and fresh at **03:17–03:21 Algiers (outside the window)** — the failure reproduces in both conditions, which rules out "it only happens during the backup" as the whole story.

## 3. The evidence

### 3.1 The database is INTACT — nothing was purged, nothing drifted

Census (identical in both probe rounds, and identical to the T-421-verified state):

| Table | Live | T-420/T-421 verified |
|---|---|---|
| students (alive) | **1,137** | 1,137 |
| parents (alive) | **741** | 741 |
| ledger_entries | **3,342** | 3,342 |
| payments | **2,198** | 2,198 |
| installments | **5,963** | 5,963 |
| payment_allocations | 0 | 0 |

The created-at histograms show every financial row landed in the **2026-09-26 23:00 → 2026-09-27 00:00:45** window (the T-420/T-421 verification imports) and **zero rows written since** — no purge ran (T-416's RPC was never executed), no re-import ran, no drift occurred. The audit log shows no recent entries. **The data the Finances page should render exists, right now, in the verified-correct state.**

### 3.2 The import half of the chain is already live-verified correct (the history this builds on)

The T-422 question "is the import wrong or incomplete?" (hypothesis ⑥) was not re-litigated — it was **settled with live evidence** by the two preceding sessions, and the fresh census (§3.1) confirms their state persists:

- **T-417/PERF-503** (issue #19): the import's 26× performance repair — 1,026 per-row identity round trips → 2 snapshot reads; the canonical per-family write RPCs untouched.
- **T-420/IMPORT-112..115 + PERF-504** (issue #20): the silent-loss repair. The definitive live verification imported the real `2027-2026.xlsx` (1,139 named rows, 942 with outstanding balance — 82.7%) through the FIXED code: **1,137 students + 741 parents + 3,342 ledger + 2,198 payments + 5,963 installments, 216.9 s; the indebted census 940 with debt / 197 settled — matching the workbook's own Q-column truth; DETTES 6/6 (Σ 636,500); Σ payments 162,713,000 / Σ charges 356,859,300 vs the workbook's 162,901,000 / 357,519,300** (the documented same-name merge-dedup delta). The per-student oracle matched **every one of the 1,137 students** against the workbook's own arithmetic.
- **T-421/IMPORT-116..119** (issue #20 follow-up): re-import idempotency — a re-import of the same workbook over the fully-imported DB is a **clean 57 s no-op** (0 imported / 1,139 updated / 2 skipped; census identical before/after; zero rows written), live-verified, including the fail-closed path under the real 01:00 backup load.

### 3.3 The business logic is correct — the KPIs compute the right numbers when the reads succeed

The e2e simulation replicated the page's exact computation over the real, live data:

- **Encaissé (cumul):** Σ `status='paid'` payments = **162,713,000 DZD** (all 2,198 payments are status `paid`).
- **Revenu mensuel:** the same set filtered to the current month = **162,713,000 DZD** (every payment was collected in September 2026 — the import wrote them with the import-run timestamp).
- **Encours créances:** over the FULL installment set the client-side formula reproduces the RPC's independent server-side answer, **207,773,800 DZD** — two different computation paths, one number.

Hypotheses ① and ② are confirmed: the workflow and the debt→payment/installment linkage are correct.

### 3.4 The UI data-path map — the heart of the diagnosis

| UI surface | Data path (code) | Paginated? | On read failure |
|---|---|---|---|
| KPIs Encaissé/Revenu mensuel + Paiements tab | `SupabasePaymentRepository.seed()` — PostgREST read, 1,000/page ordered `collected_at desc` | ✅ (DATA-035, T-411) | ❌ `catch { this.cache.set([]) }` (line ~1944) → **silent zeros** |
| Tranches tab + Créances KPI | `SupabaseInstallmentRepository.seed()` — ONE read, `select *` ordered `due_date` | ❌ | ❌ `catch { this.cache.set([]) }` (line ~3136) → **silent zeros** |
| Créances tab (Top débiteurs) | `SupabaseDebtRepository.seedSummary()` — installments `.neq(status,'paid')`, one read | ❌ | ❌ `catch { … this.summarySubject.set([]) }` (line ~3925) → **empty list** |
| Ledger-backed surfaces | `SupabaseLedgerRepository.seed()` | ❌ (reads ≤1,000 by construction) | ❌ `catch { this.cache.set([]) }` (line ~2643) → **silent zeros** |
| **Suivi des Dettes tab** | `compute_debt_aging_summary` RPC (migration 0111, **SECURITY DEFINER**) via `seedAging()` | n/a (server-side) | ✅ **keeps the last known analysis** ("never fabricate rows" — the comment in the code), warns in console |

The one path that degrades honestly is the one tab that kept its data. The parents/students seeds already carry the OPS-317/T-392 seed-diagnostics treatment (the classified honest-empty degradation, lines ~709/~1031); **the financial seeds never received it.**

### 3.5 The live reproduction — 57014 statement timeouts on the direct reads, at 100% contrast with the RPC

Fresh flakiness run (2026-09-27, 03:19 Algiers — **outside** the backup window):

```
A. PAYMENTS paginated seed (the repo's exact loop):
   round 1: OK rows=2198 (15.2s)
   round 2: OK rows=2198 (7.3s)
   round 3: OK rows=2198 (7.4s)
   round 4: FAIL after 2000 rows → 57014 canceling statement due to statement timeout (13.5s)
   round 5: OK rows=2198 (6.5s)

B. INSTALLMENTS single read (the repo's exact query):
   round 1: OK rows=1000 (5.8s)      [5,963 exist — capped at 1,000]
   round 2: OK rows=1000 (6.2s)
   round 3: FAIL 57014 canceling statement due to statement timeout (8.3s)
   round 4: OK rows=1000 (8.6s)
   round 5: OK rows=1000 (6.1s)

C. compute_debt_aging_summary RPC (the Dettes path):
   round 1: OK rows=741 (0.8s)
   round 2: OK rows=741 (1.5s)
   round 3: OK rows=741 (0.8s)
   round 4: OK rows=741 (0.8s)
   round 5: OK rows=741 (1.0s)
```

The earlier round (inside the 01:00 backup window) was worse: payments 4/5 at **7.5–19.9 s** (1× 57014), installments **3/5** (2× 57014), RPC 5/5 at 1.7–6.7 s. The standalone probe's installments read also died with 57014 at 03:18 (outside the window).

**The differential is the diagnosis:** same tenant, same data, same client — the SECURITY DEFINER RPC answers in **0.8–1.5 s at 100% reliability**; the direct RLS-filtered reads take **6–15 s at ~80–90%** and hard-fail with 57014 intermittently. The structural suspect for the direct reads' cost: **the per-row RLS policy-function chain** evaluated on every row of every page (plus thin index coverage on the ordering columns `due_date`/`collected_at` — the T-421-registered index-coverage concern). The definitive attribution (EXPLAIN under superuser) is Phase B work; registered as **PERF-505**.

Also captured: `count: exact` + `limit 1` on installments **timed out** (57014) while `head: true, count: exact` returns 5,963 cleanly — count queries are subject to the same load sensitivity.

### 3.6 The second defect — the 1000-row cap corrupts even the SUCCESS path

PostgREST caps every response at 1,000 rows. The installments seed and the debtSummary seed are single unpaginated reads. Measured live (03:20):

- The installments read returns **1,000 of 5,963** rows in 7.45 s.
- Ordered by `due_date` ascending, the cached 1,000 rows are **exactly tranche 1**: `by tranche_number = [[1, 1000]]`, statuses within the cap `unpaid 799 / partial 9 / paid 192`, Σ due 25,332,000 / Σ paid 4,942,500 (first-1,000 basis).
- The Créances KPI computed from the capped read: **43,650,000 DZD (dont échues 9,239,000)** vs the true full-table **207,773,800 DZD** — a 4.8× undercount.
- The debtSummary (Top-débiteurs) aggregation runs over the same capped ≤1,000-row unpaid set.

So even when the reads succeed, the Tranches tab shows **T1 only** (T2/T3 "Aucune tranche") and the Créances KPI is wrong by 164 M DZD. This is the DATA-035 defect class (the payments seed's identical cap, fixed in T-411 by pagination); the treatment never reached the installments/debtSummary seeds. Registered as **DATA-038**.

### 3.7 Why the owner saw ALL zeros — the failure mode, not the cap mode

The reported symptom includes **"Aucune tranche T1"** — even tranche 1 empty — which the cap alone cannot produce (a capped-but-successful read shows 1,000 T1 rows). The all-zeros state is the **failure** mode: the payments and/or installments seeds hit the 57014 timeout (§3.5: ~1-in-5 per attempt outside the backup window, worse inside), the catch blocks swallowed the error into empty caches, and the page rendered the emptiness as 0 DZD KPIs + empty tranches with **zero error indication**.

The freshness layer (30 s TTL + re-seed on window focus) makes it worse in a specific way: each failed re-seed **replaces** the cache with empty again — so a page that briefly loaded correct data can zero itself minutes later. A refresh failure must never degrade an already-populated cache (the seedAging convention); the financial seeds violate exactly that. Registered as **CACHE-103**.

### 3.8 The historique answer (the owner's suspicion, settled)

- `student_academic_histories`: **0 rows**. The Excel import engine has **never written that table** — zero references in the import code path. The "Historique académique" card reads it and therefore always shows "Aucune année antérieure enregistrée". A real gap, but a *separate* defect: registered as **ACAD-511**, scope-shared with GitHub issue #18 (Student Re-enrollment, Academic History, …).
- `academic_years`: exactly one row — **2026-2027** (current, not archived). There are no prior années scolaires in the system and thus **no prior-year import for the current data to "mismatch"** — this is the first academic year. Hypothesis ③ is false *as a cause of the zeros*: the zeros would reproduce identically on a fresh single-year install.
- The Dettes tab's year attribution ("2026-2027" for all 741 debtors) derives from `attribute_academic_year` over installment due-dates — not from historique rows.
- The 741 debtors all show status **green** because `inactivity_days ≤ 60` and the financial data is one day old — green means "active payer", not "no debt". (A display-semantics nuance worth remembering when reading the Dettes tab.)

### 3.9 The reconciliation nuance (recorded so it is not mistaken for a bug later)

Two correct-but-different créances totals coexist:

- **Installment basis** (Créances KPI / Dettes tab): Σ remaining over unpaid installments = **207,773,800 DZD**.
- **Ledger basis** (a balance replay / the workbook's own créance column): 356,859,300 charges − 162,713,000 payments = **194,146,300 DZD** ≈ the workbook's 193,983,800.
- The **13,627,500 DZD gap = payments beyond tranche remaining** (overpayment/excess — the workbook's R>0 rows; payments carry `excess_amount` for exactly this).

Both bases are internally correct; the UI presents both without labeling the basis. Registered as **DATA-039** (low priority): label the basis (or reconcile the excess) so the two numbers explain each other.

### 3.10 Schema-drift notes (forensic hygiene)

The first probe draft queried `installments.academic_year` and `payments.payment_date` and received **42703 column-does-not-exist**. The live column lists (captured by the e2e script) confirm: installments carries `academic_cycle`; payments carries `collected_at`. The repository code uses the correct columns — no app impact. Recorded so the next probe author does not chase it. (The full live column lists are preserved in the e2e script's output section 1.)

## 4. The verdict — the six hypotheses

| # | Hypothesis | Verdict | Evidence |
|---|---|---|---|
| ① | The financial workflow itself is correct | **TRUE** | §3.3 — the page's own math reproduces the workbook truth over the live data |
| ② | Debts/receivables correctly generated/linked payments & installments | **TRUE** | §3.1/§3.2 — 3,342 ledger + 2,198 payments + 5,963 installments landed and reconcile to the workbook |
| ③ | Historical data correctly connected to prior-year imports | **FALSE — not the cause** | §3.8 — no prior-year data exists; the historique table was never written by any import (ACAD-511) |
| ④ | The spreadsheet data conforms to business logic | **TRUE** | §3.2 — T-420's per-student oracle: all 1,137 students match the workbook's arithmetic |
| ⑤ | An app / API / database bug | **TRUE — THE ROOT** | §3.4–§3.7 — CACHE-103 (app: silent zeros) + DATA-038 (app: the cap), triggered by PERF-505 (DB/API: the fragile direct reads) |
| ⑥ | The spreadsheet/import is wrong or incomplete | **FALSE** | §3.2 — the import is live-verified complete against the Excel source of truth |

**Root-cause attribution: an APP + API reliability failure on the read path.** The business logic, the imported data, and the DB contents are exonerated. The Finances page converts transient server failures into a silent, confident zero — and even its success path is truncated by the 1,000-row cap. The Dettes tab survives because its path (SECURITY DEFINER RPC + keep-last-known degradation) is structurally immune to both defects.

## 5. What was changed to fix it

**Nothing — by mandate.** T-422 ran under the owner's explicit "investigate first, no changes" constraint. No production code, no migration, no RPC, no RLS change was made. The three probe scripts are read-only evidence tools (committed alongside this doc). The five defects/risks were registered in the problem registry **before any fix**, per §13: CACHE-103, DATA-038, PERF-505, ACAD-511, DATA-039. The fix plan (§6) is registered and owner-gated; **GitHub issue #23 stays OPEN to track it.**

## 6. The fix plan (owner-gated) and why each element works

### Phase A — app-side (no token needed; delivers most of the owner-visible recovery)

1. **Honest degradation in the financial seeds (CACHE-103).** Extend the OPS-317/T-392 seed-diagnostics treatment (already on the parents/students seeds) to the payments, ledger, installments, and debtSummary seeds: on a failed read, **keep the last known cache** (the `seedAging` convention, already in the debt repository: *"Keep the last known truthful analysis on a transient failure — never fabricate rows"*) and surface a classified degradation state to the page ("Échec du chargement — Réessayer") instead of zeros. *Why it works: the convention is already proven in-repo — it is precisely why the Dettes tab never blanked while every other surface zeroed.*
2. **Retry with backoff on the seed reads.** *Why it works: measured per-attempt success is 80–90% (§3.5); 2–3 spaced retries reduce an unrecovered failure to ≈0.5–5%, after which the honest error state shows — never a false zero.*
3. **Paginate the installments seed and the debtSummary seed (DATA-038)** — the exact DATA-035 treatment the payments seed received in T-411; keyset on `id` per the §15.62c rule (index-scan pages, no OFFSET re-scan). *Why it works: the payments seed already reads all 2,198 rows through this pattern in the same environment; the Tranches tab will then see all 5,963 rows across T1/T2/T3 and the Créances KPI will match the RPC's 207,773,800.*
4. **(Recommended) Seed the Créances KPI from the fast RPC** (or a sibling SECURITY DEFINER summary RPC) instead of client-side aggregation over the installment set. *Why it works: measured 0.8–1.5 s at 100% reliability vs 6–15 s at ~80% for the direct read of the same truth — the differential is the proof.*

### Phase B — DB-side (needs the owner's `sbp_` token / console)

5. **SECURITY DEFINER read RPCs for the financial collections (PERF-505)** following the 0111 debt-aging pattern. *Why it works: the RPC path is measurably immune (5/5, sub-1.5 s) while the per-row-policy direct reads are the fragile ones — same data, same DB.*
6. **The registered index-coverage review** of the financial tables (`due_date`, `collected_at`, the identity columns) — the standing owner-gated item from T-421.
7. **The definitive PERF-505 attribution**: EXPLAIN ANALYZE of the direct reads' policy evaluation under real load (superuser) — names the exact dominant cost.
8. *(Adjacent, separately registered)* migration 0122 — the single-transaction flush RPC (IMPORT-118's structural close).

### Acceptance criteria (issue #23's checklist)

- Finances → Encaissement shows **Encaissé 162,713,000 DZD** / **Revenu mensuel 162,713,000 DZD** (September 2026).
- **Encours créances 207,773,800 DZD** (matching the Dettes tab), basis labeled (DATA-039).
- **Tranches shows T1+T2+T3** (5,963 rows total).
- A forced read failure (e.g., inside the 01:00 backup window) shows an **error/retry state, never zeros**, and does **not wipe** previously-loaded data.
- A regression suite pins: failed-seed ≠ empty-UI, no 1,000-row truncation, and the KPI values cross-checked against the RPC.
- ACAD-511 / DATA-039 fixed or explicitly re-registered with their own acceptance criteria.

## 7. Testing and verification record

**Run (all read-only, live, zero writes):**

| Script | Purpose | Results |
|---|---|---|
| `t-422-finance-zeros-probe.mjs` | census · breakdowns · RPC · the repo's exact read · timelines · historique | census identical to verified state (§3.1); RPC healthy (741 / 207,773,800 DZD / all 2026-2027); **the repo's exact installments read FAILED 57014** (03:18, outside the window); `student_academic_histories` = 0; `academic_years` = 1 row |
| `t-422-flakiness-meter.mjs` | 5 rounds × 3 paths, two sessions (in + out of the backup window) | §3.5 — direct reads 6.5–19.9 s, 3–4/5 success, 57014 on failure; RPC 5/5 at 0.8–6.7 s |
| `t-422-e2e-simulation.mjs` | the page's exact reads + KPI computations | §3.3/§3.6 — Encaissé 162,713,000; capped créances 43,650,000 vs true 207,773,800; tranches [[1,1000]]; live column lists; the count quirks (head+count:exact OK at 5,963; count:exact+limit 1 → 57014; count:planned → 3,754) |

**Manually verified:** the census against the T-421-verified state (identical); the created-at histograms (no writes since the verification imports); the live column lists vs the repository's field usage (`academic_cycle` / `collected_at` — correct); the seed catch blocks (five `cache.set([])` sites at lines ~709/~1031/~1944/~2643/~3136 + the seedSummary `set([])` at ~3925 + the seedAging keep-last-known contrast at ~3803); the DATA-035 lineage (payments paginated, installments/debtSummary not); the OPS-317 lineage (parents/students carry diagnostics, the financial seeds do not); the RPC output shape (741 debtors, Σ matching the installment-remaining computation).

**Not run / not possible under the mandate:** any fix; the superuser EXPLAIN (Phase B item 7).

## 8. What remains unresolved

1. **The fix** — Phase A + Phase B (§6), owner-gated; **tracked in GitHub issue #23 (OPEN)**.
2. **PERF-505's definitive attribution** — which policy function/join dominates the direct reads (needs superuser EXPLAIN or the sbp token).
3. **ACAD-511** — the historique table is never populated by the import engine (issue #18's scope).
4. **DATA-039** — the dual-basis créances display (207.77 M installment-basis vs 194.15 M ledger-basis; the 13.63 M excess) needs labeling or reconciliation.
5. The 01:00 backup window overlapping working hours + thin index coverage (standing T-421 items).
6. The pre-existing 34-failure vitest baseline (environment-class UI flakes, byte-identical pre/post T-421 — unrelated, owned by its own entries).

## 9. How to re-run the evidence

```bash
cd elimtiyaz-desktop
node scripts/t-422-finance-zeros-probe.mjs      # census + the repo's exact read + historique
node scripts/t-422-flakiness-meter.mjs          # the 3-path reliability measurement
node scripts/t-422-e2e-simulation.mjs           # the page's exact reads + KPI values
```

All three are read-only by construction (SELECT/COUNT/RPC only), use the owner-pinned probe credential, and print their own evidence. Re-run them before and after the fix lands — the acceptance criteria (§6) are checkable with these three scripts plus the app itself.
