# T-423 — The Finance-Zeros Fix: the issue-#23 implementation (Phases A+B) — the verification record

> **Task:** the owner-approved implementation of the T-422 fix plan (GitHub issue #23) — Phase A (app-side: honest degradation + retry + keyset pagination) and Phase B (DB-side: the SECURITY DEFINER read RPCs), with the live acceptance-criteria run.
> **Session:** the 107th (2026-09-27). Knowledge: AGENTS.md §15.64. Commits: c285286 (registration) → 25fca3b (A1+A2) → eab9ea7 (A3) → 2e7cebc (B) → this closeout.
> **Mode:** the fixes are production code + migration 0123 (live-applied atomically with its registration, HTTP 201, chain head 0123). All probes against the live DB are read-only.

---

## 1. What was implemented

### Phase A1+A2 — the honest degradation (CACHE-103) + the retry ladder

- **The reactive seed-health registry** (`observeSeedHealth()` / `getSeedHealth()`): OPS-317's diagnostics record WHY a seed degraded; this new stream broadcasts WHETHER each source is currently degraded. The Finances page renders it as the banner *"Échec du chargement des données financières (…sources…) — les dernières valeurs connues sont conservées. Sauvegarde planifiée ou charge en cours ?"* with a **Réessayer** button (`repos.payments.refresh?.()` ×4 — the optional-method pattern).
- **`readWithSeedRetry`** — the whole-read retry ladder (3 attempts, 1s/3s backoff; a `__setSeedRetryBackoffForTests` seam). Live-measured per-attempt success was 80–90% ⇒ ≈0.5–5% unrecovered after the ladder.
- **`finishSeed`** — the honest finish: SUCCESS replaces the cache + clears the degradation; FINAL FAILURE keeps the last known cache (the seedAging convention), records the OPS-317 diagnostic, and surfaces the degradation. **A failed refresh can no longer wipe a populated cache** — the exact defect that let a page zero itself minutes after loading correctly.
- **The KPI cards** render **"—"** (unknown) when their source is degraded AND the cache is empty — a failed first load is *"no data + Échec du chargement"*, never a confident "0 DZD" (§15.63e: an honest error state is a forensic instrument).
- Applied to all five financial seed sites: payments, ledger, installments, debtSummary, allocations (`seedAllocations` had the same bare catch).

### Phase A3 — the keyset pagination (DATA-038 + DATA-040)

- **`paginateKeyset`** — the §15.62c wire form (`WHERE id > last ORDER BY id LIMIT 1000` — every page a primary-key index scan) + **`sortByRawColumn`** (the cache's observable order contract restored in-memory).
- Converted: the payments seed (from `.range()` OFFSET), the installments seed (from a single capped read), the ledger seed (from `.limit(2000)` — which PostgREST capped at 1,000 of 3,342), the debtSummary's two reads (unpaid installments: 1,000 of 4,227; students count: 1,000 of 1,137), and — the DATA-040 class sweep — the **students seed (1,000 of 1,137 — 137 students were silently missing from the CRM cache)** and the parents seed (741/741 today, one growth-year from the cap).

### Phase B — migration 0123: the SECURITY DEFINER read RPCs (PERF-505)

- **Four staff-gated, tenant-scoped, SECURITY DEFINER RPCs** (the 0111 pattern): `read_payments_collection`, `read_installments_collection`, `read_ledger_entries_collection` (jsonb payloads — ONE row, immune to the 1,000-row cap by construction; PK-order aggregation) and `read_debt_summary_collection` (the readSummaries aggregates computed server-side over the FULL unpaid set — the §15/INV-4 basis, byte-identical formula, raw display fields so every display decision stays client-side).
- **The seeds read RPC-first** (`callCollectionRpc`): unavailable-class errors (PGRST202/42501/42883, "Could not find the function", "is not a function" — version skew, including clients without the `.rpc` surface) fall back to the direct keyset read; transient errors THROW so the retry ladder retries the RPC.
- **Applied live atomically** with the T-091/MIG-TOKENS registration (`scripts/apply_0123_live.sh`; HTTP 201; chain head 0123 — 0122 stays reserved for IMPORT-118/REALTIME-105).

## 2. The PERF-505 definitive attribution (Phase B item 7 — live evidence)

The superuser EXPLAINs and timings (`scripts/t-423-perf505-attribution-timing.py` + the EXPLAINs in §3):

| Query shape (superuser, same tenant) | Server-side execution |
|---|---|
| The OLD direct seed read (`select * … order by due_date limit 1000`) | **50 ms** (Sort 44ms, Seq Scan 7ms) |
| `jsonb_agg(to_jsonb(i) order by i.id)` (the committed RPC body) | **0.5–0.6 s** (the to_jsonb×5,963 aggregate) |
| The same with `order by due_date, id` (the first draft) | 0.5–1.2 s (the sort itself ~97ms) |
| The same reads over the **staff JWT** (the direct PostgREST wire) | **6.5–19.9 s at 80–90%** (T-422's measurement) |

**The SQL was never the problem.** The direct reads' cost is the **per-row RLS policy-function evaluation under the authenticated role** — the only delta between the 50ms superuser plan and the multi-second staff path. The sort by unindexed columns is real but secondary (~100ms server-side); the first RPC draft's 4.4–10.1s staff-path run (one 57014) was confounded with post-DDL cold caches, and the committed PK-order + client-sort design sidesteps the question entirely (§15.62c extended to collection RPCs: never sort server-side by unindexed columns when the client can sort for free).

## 3. The live acceptance-criteria run (issue #23's checklist)

`scripts/t-423-post-fix-verification.mjs` (read-only, the real staff JWT, 2026-09-27 — re-runnable):

```
1. The migration-0123 RPCs over the staff JWT (3 rounds each):
   read_payments_collection:        3/3 OK rows=2198 latencies=[1.31s, 1.59s, 0.47s]
   read_installments_collection:    3/3 OK rows=5963 latencies=[0.71s, 1.70s, 0.72s]
   read_ledger_entries_collection:  3/3 OK rows=3342 latencies=[0.65s, 0.61s, 1.39s]
   read_debt_summary_collection:    3/3 OK rows=741  latencies=[0.56s, 0.32s, 0.51s]

2. Encaissé (cumul, Σ status=paid):        162,713,000 DZD  (expected 162,713,000) ✓
   Revenu mensuel (Sept 2026, Σ paid):      162,713,000 DZD  (expected 162,713,000) ✓

3. Créances: read_debt_summary_collection   741 rows, Σ 207,773,800 DZD ✓
   cross-check compute_debt_aging_summary:  741 rows, Σ 207,773,800 DZD — MATCH ✓

4. Tranches: installments 5,963 rows — by tranche_number [[1,1609],[2,1608],[3,1609],[4,1137]]
   T1+T2+T3(+T4) all present ✓   (the pre-fix capped read was [[1,1000]])

5. Ledger: 3,342 rows ✓ (was capped at 1,000)

6. The staff gate: the anon/no-session call REJECTED (permission denied) ✓

VERDICT: ALL ACCEPTANCE CHECKS PASS
```

**The acceptance criteria, item by item:**

| Issue #23 criterion | Status | Evidence |
|---|---|---|
| Encaissé 162,713,000 / Revenu mensuel 162,713,000 | **PASS (live)** | §3.2 — the page's exact computation over the RPC data |
| Encours créances 207,773,800, basis labeled | **PASS (live)** | §3.3 — matches the aging RPC; the KPI hint now reads "base échéancier · dont X échues" + the excess_amount bridge in the tooltip (DATA-039) |
| Tranches shows T1+T2+T3 (5,963 rows) | **PASS (live)** | §3.4 — all four tranches present in one RPC round trip |
| A forced read failure shows an error/retry state, never zeros; loaded data not wiped | **PASS (unit-pinned)** | The regression suite A–G: keep-last-known on every site, the reactive degradation state, the Réessayer hook, the retry ladder's in-cycle recovery. A live forced outage was NOT staged (the DB is healthy); the degradation semantics are pinned by the suite and the RPC path's 12/12 reliability makes the failure window ≈0. |
| The regression suite pins degradation / no-truncation / KPI cross-check | **PASS** | `t-423-finance-seed-degradation.test.ts` 11/11: A–G (degradation), K (a 2,500-row table at the 1,000/page cap lands WHOLE — no truncation), H–J (the RPC path: serves, retries, maps). The KPI cross-check runs live (§3.3). |
| ACAD-511 / DATA-039 fixed or re-registered | **DONE** | DATA-039 labeled (this pass). ACAD-511 re-registered with its own acceptance criteria → issue #18's scope (the problem-registry entry updated). |

## 4. The gates

- `tsc --noEmit`: **0 errors** (every phase).
- eslint on every changed file: **0 errors**.
- FULL vitest: **4,191 passed / 21 failed / 10 failing files — BASELINE-MATCHED** (the documented environment-class set; `scripts/test-baseline.json` moved by the registered T-423 change: t-034's 4 documented failures are FIXED — its fake supports the keyset chain but not `.range()`; the failing count 25 → 21).
- `npm run check:migrations`: append-only OK (118 files, +1 new).
- The 11 T-423 tests green; the five patched fake files (t-392, t-372, t-402, t-393, t-034) green — 62 tests total across them.

## 5. What remains unresolved (registered)

1. **ACAD-511** — the historique writer (issue #18's design call; the import path and T-403's promotion cycle are the natural writers). NOT this issue's scope — re-registered with its own acceptance criteria.
2. **Migration 0122** — IMPORT-118's single-transaction flush RPC (deliberately left free; T-423 took 0123).
3. **The 01:00 backup window** overlapping working hours (the standing T-421 item — an owner scheduling decision, not a code fix).
4. **Index coverage** — now LOW priority: the staff read path no longer touches the direct wire; only the portal's parent-scoped direct reads remain (small sets, per-parent filters). The registered review can close on that evidence.
5. **The parents/students seeds' OPS-317 set([]) semantics** — their PAGINATION was fixed (DATA-040) but their catch still sets `[]` on a first-load failure (with the classified diagnostic, per the OPS-317-registered behavior). The §15.63a rule (keep-last-known for EVERY observable-cache seed) is deliberately NOT extended to them in this pass — a scope boundary, registered here; extend it the next time those seeds are touched.
6. **The pre-existing 21-failure vitest baseline** (environment-class, owned by its own entries — 4 fewer than before this session, all in t-034, fixed by the registered baseline move).

## 6. How to re-run everything

```bash
cd elimtiyaz-desktop
npx vitest run src/tests/infrastructure/t-423-finance-seed-degradation.test.ts  # the regression suite (11)
node scripts/t-423-post-fix-verification.mjs        # the LIVE acceptance run (read-only)
node scripts/t-422-flakiness-meter.mjs              # the direct-wire reliability measurement (for contrast)
SUPABASE_ACCESS_TOKEN=… python3 scripts/t-423-perf505-attribution-timing.py  # the attribution experiment
node scripts/t-423-class-sweep-probe.mjs            # the unpaginated-seed census (pre-fix evidence)
```
