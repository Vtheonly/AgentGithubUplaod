# T-421 Delivery — The Re-Import Failure Quartet (issue #20's follow-up log)

**Date:** 2026-09-27 (105th session) · **Repos:** `Vtheonly/AgentGithubUplaod` @ `4cc6b29` (main) · `Vtheonly/elimtiyaz-website` @ `5c530b6` (main, unchanged this session — the concurrent agent's line)

## What this delivery answers

The owner's pasted follow-up log: the 23:00:40 re-import of `2027-2026.xlsx` died at the bulk flush with `ledger_entries_source_uidx` / `payments_tenant_id_payment_number_key` duplicate-key violations, a THIRD 409 (installments) the surfaced error never mentioned, and installments GET 500s afterwards.

## The forensic verdict (what actually happened at 23:00)

1. **The 23:00:13 "success" (21.4 s, "1139 imported") was the modal DRY-RUN preview** — it writes nothing (DB row histograms: zero rows in that window).
2. **The 23:00:40 commit ran a build that predated the 23:57 IMPORT-115 fix** — the workbook's same-name merge rows carried within-batch duplicate identities into the chunks → 23505 at ledger chunk @2000 / payments rows 1501–2000.
3. **The deeper defect (live-proven, residue-free):** PostgREST's `ignoreDuplicates` arbitrates ONLY the primary key — cross-run conflicts on the financial identity constraints raise 23505 on ANY build, and `on_conflict` cannot express partial-index predicates (42P10). Re-imports could never work through that wire form.
4. **The installments 409 was silently dropped** (the flush awaited the Result and ignored it), **the error message falsely claimed "aucune écriture partielle"** while ~7,500 rows from earlier chunks sat orphaned, and **the rollback soft-deleted its 1,137 students** (correct that time — the DB was post-purge empty — but the same machinery over existing data would delete REAL students).
5. **The installments 500s were transient** (the exact GET returns 200 now); the DB ended in the verified good state.

## The four fixes (IMPORT-116..119 — registered before the fixes per §13)

| ID | Defect | Fix |
|---|---|---|
| IMPORT-116 | Cross-run re-import not idempotent on the wire; payments/installments had NO cross-run filter, the ledger's was cache-based | DB-based preflight of all three streams — keyset-paginated on the PK, retried as a unit, **FAIL-CLOSED** (an unreadable stream aborts the flush before any write; partial knowledge never returned) |
| IMPORT-117 | The installments flush Result awaited and dropped | The Result is honored — an Err fails the import |
| IMPORT-118 | Chunks independently committed; the false "aucune écriture partielle" message | WithProgress bulk variants report landed chunks; honest ÉTAT PARTIEL / état-intact end-state sentences |
| IMPORT-119 | The rollback could soft-delete pre-existing students via upsert-matches; stats miscounted upserts as inserts | `createStudentTracked`/`createParentTracked` surface the RPC's `out_was_inserted` — only truly-created ids are compensated; upsert-matches count as updates |

## The definitive live verification (ALL GREEN)

Re-importing the real `2027-2026.xlsx` over the fully-imported DB — **the owner's exact scenario** — is now a clean NO-OP:
- 57 s; stats **0 imported / 1,139 updated / 2 skipped** (honest)
- Preflight sets **3342 / 2198 / 5963** (every identity read from the DB)
- Census IDENTICAL before/after: **1137 students / 741 parents / 3342 ledger / 2198 payments / 5963 installments**
- **Zero rows written.**

The FAIL-CLOSED path was exercised LIVE under the 01:00 scheduled backup's real load (financial queries at 4–6.5 s): both aborts wrote ZERO rows with the honest "Réessayez dans quelques minutes" message — the conditions that produced the 23:00 catastrophe now produce a harmless, explainable retry.

## Gates

`t-421-reimport-idempotency.test.ts` 10/10 · import suites 55/55 · typecheck 0 · eslint 0 errors · FULL vitest failing set byte-identical to pre-change main (stash-verified — 34 environment-class UI flakes, pre-existing).

## What the owner should do

1. **Pull main + rebuild the desktop app before the next import** — the 23:00 build predated the IMPORT-115 dedup; with main, re-importing the same workbook is a verified no-op, and a first import after a purge completes with the full census.
2. **Expect a harmless "Réessayez" message if importing during the 01:00 backup window** — that is the fail-closed guard protecting the data, not a failure.
3. Registered follow-up (needs the owner's Supabase token): the single-transaction flush RPC (migration 0122) and an index-coverage review of the financial tables' identity columns.

## Archives

- `AgentGithubUplaod-T421.zip` — the full hub repo at `4cc6b29` (desktop + docs + scripts; `deliverables/` excluded to avoid recursive zip bloat)
- `elimtiyaz-website-T421.zip` — the website repo at `5c530b6` (the concurrent agent's line, unchanged this session)
- `elimtiyaz-all-systems-T421.zip` — both systems side by side
