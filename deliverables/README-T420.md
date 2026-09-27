# T-420 Delivery Manifest — the issue-#20 Excel-import financial integrity (104th session, 2026-09-27)

## What this delivery contains

| Archive | Contents |
|---|---|
| `AgentGithubUplaod-T420.zip` | The hub repository at `main` @ `6c6ba2e` — the desktop staff application (`elimtiyaz-desktop/`), the canonical Supabase backend (`elimtiyaz-desktop/supabase/` — migrations 0001–0121 + the Edge Functions), the unified testing architecture (`src/tests/` + `financial-tests/equivalence/`), the forensic Excel workbooks, and the complete documentation system (`docs/`). |
| `elimtiyaz-website-T420.zip` | The parent web portal at `main` @ `5c530b6` (unchanged by this task — the import is desktop-side). |
| `elimtiyaz-all-systems-T420.zip` | Both archives in one bundle. |

Both zips exclude `node_modules/`, build output, and `.git` internals. Run `npm install` inside `elimtiyaz-desktop/` to restore dependencies.

## The issue-#20 mandate and its resolution

**The report:** the bulk Excel import appeared to set ALL students as fully paid with no outstanding debt, and the import was extremely slow.

**The forensic finding (docs/recovery/t-420-import-integrity-baseline.md):** the correct source of truth is `Excel/2027-2026.xlsx` (1,139 named student rows — the newer, larger workbook; 942 rows (82.7%) carry outstanding balances). The in-memory import pipeline was proven CORRECT — the corruption happened in the LIVE SUPABASE WRITE PATH, where FIVE defects interacted:

1. **IMPORT-112** — SupabaseLedgerRepository.bulkAppend funneled any thrown error into appendMany, which silently dropped every failed entry and returned Ok — the flush read "success with 0 of ~3,346 ledger entries written". With no charge entries, every account replays to balance 0: "fully paid".
2. **IMPORT-113** — the identical lossy fallback in bulkImportInstallments (0 of ~5,963 installments).
3. **IMPORT-114** — the compensating rollback's partial failure was swallowed (384 soft-deletes landed, 463 students survived from the "failed" import).
4. **PERF-504** — the financial-realtime bridge re-seeded 8 full collections per 75 ms-debounced event for the import's whole duration — the UI's own read storm exhausted the connection pool (159 statement timeouts + 166 gateway 504s in the owner's logs), triggering 1+2.
5. **IMPORT-115 (THE deterministic trigger)** — the workbook's 2 same-name merge rows buffer WITHIN-BATCH duplicate financial identities; PostgreSQL's ON CONFLICT DO NOTHING cannot suppress duplicates inside one INSERT statement, so every import of this workbook truncated at exactly ledger 2,000 / payments 1,500 / installments 4,000 — and the pre-fix fallbacks swallowed that error into the reported state.

**The fixes (all on main, each with its regression pins):** honest-error contracts on the bulk writers; the pauseFinancialRealtime()/resumeFinancialRealtime() seam wired around the import commit; the PARTIAL_ROLLBACK_STATE rollback surfacing; and the within-batch dedup (FIRST WINS — the DB's own chunk-by-chunk semantics).

**The definitive live verification (ALL GREEN):** the full workbook imported through the fixed code in 216.9 s — 1,137 students + 741 parents + 3,342 ledger entries + 2,198 payments + 5,963 installments ALL landed; the indebted census 940 with debt / 197 settled (the workbook's own truth; the bug's signature was 0); DETTES 6/6; the Sigma amounts verified against the workbook. The live database now matches the Excel source of truth.

**The regression suite (permanent):** t-420-payment-state-regression.test.ts (the synthetic tri-state workbook + the real-workbook per-student balance oracle — every one of the 1,137 students), t-420-honest-bulk-errors.test.ts, t-420-realtime-pause-seam.test.ts, t-420-partial-rollback-surfacing.test.ts — 22 new tests, all green; the FULL vitest failing set stayed byte-identical to the documented 25-failure baseline.

## The key commits (main)

6c6ba2e docs(recovery): T-420 Phase 7 — the closeout (IMPORT-115 registered, all five problems RESOLVED/TESTED)
66377fc fix(desktop): T-420 Phase 6 — the within-batch financial dedup (IMPORT-115 — the deterministic flush killer)
315884c test(desktop): T-420 Phase 4 — the payment-state regression suite (the issue's own test mandate)
7246638 fix(desktop): T-420 Phase 3 — surface partial-rollback failures (IMPORT-114)
5dbc336 perf(desktop): T-420 Phase 2 — the financial-realtime pause seam around bulk imports (PERF-504)
298cfac fix(desktop): T-420 Phase 1 — honest errors on the Supabase bulk financial write paths (IMPORT-112/113)
07e1a30 docs(recovery): register T-420 + IMPORT-112/113/114 + PERF-504 — the issue-#20 forensic baseline

## Notes for the owner

- The live DB already carries the correct data (the definitive verification run imported the full workbook). The CRM should show the 940 indebted students.
- A packaged-app import re-run is safe and idempotent (re-imports skip already-landed identities).
- If a re-import ever fails with "duplicate key value violates unique constraint parents_tenant_id_parent_code_key", a previous failed import's rollback left soft-deleted parents holding the codes — hard-delete the soft-deleted rows and re-import (AGENTS.md §15.61d).
