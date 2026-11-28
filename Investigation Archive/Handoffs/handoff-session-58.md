# Handoff — Session 58 → 59

Date: 2026-11-28. Read `docs/recovery/session/next-task.md`, current `SESSION-STATE.md`, then `session-58-report.md` and the relevant task cards.

## Delivered

**T-628..T-636: nine RESOLVED-TESTED tasks**, pushed incrementally to main. Placement recovery, layout lifecycle, revenue Excel period, portal reversal parity, complete inspector exports, Website fixture typecheck, student-code collision protection (new migration 0008 / ADR-037), payment-plan date-only serialization, and lint blockers are complete locally.

Desktop final frozen-source battery at `fcc28d79`: **379 files (378 passed / 1 skipped), 6,040 passed / 0 failed / 5 skipped**, 534.49 s. Registered baseline moved from 6,013 to 6,040 (+27) and 376 to 379 files (+3); no assertions or skips removed.

Website: 62 files / 773 passed; both TypeScript programs on Desktop and Website tsc 0; both builds pass; Desktop lint 0 errors / 1,380 warnings, Website lint 0 errors. Vercel reports deployment success for website d0bbc69; browser/runtime behavior was not manually verified.

## Real-data checks

- WB2 double-import: 0 new / 1,139 updated / 0 rejected, stable business counts. Raw 356,882,800 → documented identity projection **356,222,800 DZD**, all mapped financial columns **exactly equal** DB (zero tolerance).
- WB1 double-import independently: DB = projection = raw **113,503,800 DZD**, stable 253 parents / 390 students / 1,283 ledger / 891 payments / 1,966 installments.
- Actual inspector exports: all **2,198** real WB2 payments, every PDF receipt and exact XLSX record/sum population; primary text omits support tokens, secondary sheet retains raw details.
- 25 real families: SQL/Desktop charged/paid/outstanding exact; Website/Desktop charged/paid/adjusted/outstanding exact, with the actual sibling Website module executed.
- Forced code-collision matrix 10/10 twice + SQL 4/4; backend equivalence 282/38 explicit skips/0 errors; sync 21/21; tier-4 784/820 plus 36 explicit skips, 0 discrepancies; sanity 820/820 and canonical 319/319.
- Local offline chain only; no remote Supabase testing, migration apply, RLS relaxation or account mutation.

## Next priorities

1. **T-637 OPEN — C-25 placement draft synchronization contract:** v1 shape validation exists now; first establish the shared-draft write/concurrency contract. It is still device-local. Dashboard fallback wording is done.
2. ARCH-054 reconciliation ADR: map one code per concept and review each role’s diff before changing default effective permissions.
3. T-612/T-587 diagnostics year/pricing lane, then T-613’s remaining trigger/debt-basis work. **Do not redo T-632’s export increment** or mark the entire overhaul complete.
4. In the authorized production window, inspect the actual chain and arrange **0006 + 0007 + 0008** together; review the historically Stage-A-pinned preflight census against the full local chain. Packaged Electron and rendered Desktop/Website live flows remain verification gaps.

## Traps and exact boundaries

- A finite short code is not an identity proof. Migration 0008 prevents a different parent’s child being stolen by a matching proposed code, using one canonical writer and stable alternate code. Do not change the client hash or fork the write path. Same-family updates/name fallback are preserved.
- A pre-fix WB2 run was 240,000 short. The forced collision proves a real overwrite mechanism, but the original ephemeral DB is gone; do not claim the old gap conclusively attributed or historical production rows repaired. On a future mismatch, capture per-identity details before teardown.
- Layout load sentinel must remain **once per view string**, not per repository-wrapper object. Keyed view sessions and reset/save revision fencing solve different problems. t-504’s original controls must stay green.
- The inspector exports now use a deferred adapter over the canonical engines. Do not reintroduce row/text caps, a local PDF/XLSX engine or raw UUIDs in primary clerk exports. Technical provenance is in its secondary XLSX sheet. Shared notes/footnotes flow line by line.
- `buildPaymentPlan` constructs local calendar dates: serialize with `toIsoDay`, not `toISOString().slice(0,10)`. Monthly date construction was deliberately preserved.
- `npx tsx` CLI failed on Unix IPC in this environment. `node --import tsx <same-script> ...` executed the tools without IPC; the unified wrapper itself was not certified green.
- Keep all database fixtures local. PGlite has one backend session; reset roles between personas and run suites sequentially on a chosen server. Do not run multiple import suites on 5435 concurrently.
- No lint rules or assertions were weakened. The 1,380 warnings are an explicit existing backlog, outside this bounded repair.

All code changes are committed; use the final closeout SHA and both origin/main refs to establish your next clean base. Detailed commands, hashes, failed controls and evidence are in the session report and authoritative change-log.
